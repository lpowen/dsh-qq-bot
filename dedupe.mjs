/**
 * 跨进程消息去重（幂等认领）。
 *
 * 为什么不用内存里的 Set：两个桥接进程各有一份内存，谁也拦不住谁。
 * 这里用文件系统的「独占创建」（O_EXCL）做原子认领：
 * 谁先成功创建认领文件，谁负责回；其他人全部跳过。
 *
 * 认领文件放在同一个 state 目录，所以即使从两个不同路径启动、
 * 甚至 OneBot 重发同一条，也不会回两次。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createDeduper({ dir, ttlMs = 3600 * 1000, maxFiles = 5000, log = () => {} }) {
  fs.mkdirSync(dir, { recursive: true });

  function fileName(key) {
    const h = crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 24);
    return path.join(dir, `${h}.claim`);
  }

  function prune() {
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    if (names.length <= maxFiles) return;
    const items = names.map((n) => {
      const p = path.join(dir, n);
      let t = 0;
      try { t = fs.statSync(p).mtimeMs; } catch { /* ignore */ }
      return { p, t };
    }).sort((a, b) => a.t - b.t);
    for (const it of items.slice(0, items.length - maxFiles)) {
      try { fs.rmSync(it.p, { force: true }); } catch { /* ignore */ }
    }
  }

  /**
   * 认领一个键。返回 true 表示「由我来处理」，false 表示别人已经处理过。
   * ttlMs 内视为同一条消息；超过 ttl 的旧认领会被忽略（时间戳判断）。
   */
  function claim(key, { ttl = ttlMs } = {}) {
    const file = fileName(key);
    try {
      // wx = O_CREAT | O_EXCL：原子，两个进程只有一个能成功
      fs.writeFileSync(file, String(Date.now()), { flag: 'wx' });
      prune();
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') {
        log(`认领失败（${e.code}），按可处理处理：${key}`);
        return true;   // 磁盘异常时不吞消息
      }
      let age = 0;
      try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { /* ignore */ }
      if (age > ttl) {
        // 过期认领：覆盖后仍由本进程处理
        try {
          fs.writeFileSync(file, String(Date.now()));
          return true;
        } catch { return false; }
      }
      return false;
    }
  }

  return { claim, prune };
}

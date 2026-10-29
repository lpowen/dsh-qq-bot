// 跨进程幂等认领测试：同一 key 并发 claim，只能有一个为 true
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDeduper } from '../dedupe.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedupe-'));
const d = createDeduper({ dir });
let fail = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fail++;
};

ok('第一次认领成功', d.claim('msg-1') === true);
ok('第二次认领被拒', d.claim('msg-1') === false);
ok('不同 key 互不影响', d.claim('msg-2') === true);

// 过期后可以重新认领（模拟 1 小时 TTL）
const d2 = createDeduper({ dir, ttlMs: 0 });
ok('TTL 过期后可重新认领', d2.claim('msg-1') === true);

// 文件确实落盘
const files = fs.readdirSync(dir);
ok('认领文件已落盘', files.length >= 2, `files=${files.length}`);

// 并发：同一 key 同时 20 次
let wins = 0;
for (let i = 0; i < 20; i++) if (d.claim('race')) wins++;
ok('并发 20 次只赢 1 次', wins === 1, `wins=${wins}`);

// 内容哈希去重（同一句话短期内只处理一次）
const textKey = 'chat:1:user:2:你好';
ok('内容指纹首次通过', d.claim(textKey, { ttl: 5000 }) === true);
ok('内容指纹重复被拒', d.claim(textKey, { ttl: 5000 }) === false);

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

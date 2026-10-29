/**
 * 人格管理命令（QQ 内）
 *
 *   /人格                 查看当前人格（所有人可用）
 *   /人格 追加 <文本>       往人格文件末尾追加（仅主号）
 *   /人格 替换 <文本>       整份替换（仅主号，自动备份）
 *   /人格 撤销             恢复上一次备份（仅主号）
 *
 * 非主号的写操作一律拒绝，并回一句拒绝语。
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_BODY = 4000;

export function createPersonaCommands({ cfg, personaPath, log = () => {} }) {
  const owner = String(cfg.ownerQQ || '');

  function read() {
    try { return fs.readFileSync(personaPath, 'utf8'); } catch { return ''; }
  }

  function write(text) {
    fs.mkdirSync(path.dirname(personaPath), { recursive: true });
    if (fs.existsSync(personaPath)) {
      fs.copyFileSync(personaPath, `${personaPath}.bak`);
    }
    fs.writeFileSync(personaPath, text.endsWith('\n') ? text : text + '\n', 'utf8');
  }

  /**
   * @returns {{handled: boolean, reply: string|null, changed: boolean}}
   */
  function handle(text, { userId }) {
    const m = /^[/!#](?:人格|persona)(?:\s+(\S+))?\s*([\s\S]*)$/i.exec(String(text || '').trim());
    if (!m) return { handled: false, reply: null, changed: false };

    const isOwner = String(userId) === owner;
    const sub = (m[1] || '').toLowerCase();
    const body = (m[2] || '').trim();

    const view = () => {
      const cur = read();
      if (!cur) return '人格文件还是空的诶。';
      const shown = cur.length > 700 ? cur.slice(0, 700) + '\n…（后面还有，太长了）' : cur;
      return `现在的人格是这样：\n${shown}`;
    };

    // 无参数 / 查看
    if (!sub || sub === '查看' || sub === 'view' || sub === 'show') {
      return { handled: true, reply: view(), changed: false };
    }

    const deny = () => {
      log(`拒绝非主号改人格：${userId}`);
      return { handled: true, reply: '诶，人格设定只有哥哥能改啦，叔叔别乱动。', changed: false };
    };

    if (['追加', 'append', 'add'].includes(sub)) {
      if (!isOwner) return deny();
      if (!body) return { handled: true, reply: '追加什么呀？格式：/人格 追加 你是……', changed: false };
      if (body.length > MAX_BODY) return { handled: true, reply: '太长了，一条消息塞不下，分段再来。', changed: false };
      const cur = read();
      write(`${cur}${cur.endsWith('\n') || !cur ? '' : '\n'}\n${body}\n`);
      log(`人格追加（${userId}）：${body.slice(0, 60)}`);
      return { handled: true, reply: '加进去了，下一条消息就按新设定说话。', changed: true };
    }

    if (['替换', 'set', 'replace', '改'].includes(sub)) {
      if (!isOwner) return deny();
      if (body.length < 20) return { handled: true, reply: '整份替换至少要有 20 个字，不然她就没性格了。', changed: false };
      if (body.length > MAX_BODY) return { handled: true, reply: '太长了，一条消息塞不下，分段再来。', changed: false };
      write(body);
      log(`人格替换（${userId}）：${body.slice(0, 60)}`);
      return { handled: true, reply: `整份换掉了（${body.length} 字），下一条消息生效。`, changed: true };
    }

    if (['撤销', 'undo', '回滚'].includes(sub)) {
      if (!isOwner) return deny();
      const bak = `${personaPath}.bak`;
      if (!fs.existsSync(bak)) return { handled: true, reply: '没有可用的备份诶。', changed: false };
      fs.copyFileSync(bak, personaPath);
      log(`人格回滚（${userId}）`);
      return { handled: true, reply: '回到上一版了。', changed: true };
    }

    return {
      handled: true,
      reply: '用法：/人格 查看｜/人格 追加 <文本>｜/人格 替换 <文本>｜/人格 撤销（后面的只有哥哥能用）',
      changed: false,
    };
  }

  return { handle };
}

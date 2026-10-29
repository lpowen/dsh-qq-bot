#!/usr/bin/env node
/**
 * DSH x QQ 桥接服务
 *
 * 架构：QQ 客户端(NapCat/LLOneBot) --OneBot v11 正向 WebSocket--> 本进程
 *       本进程 --spawn--> `dsh --profile qq --json -`（一次性运行，stdin 传任务）
 *       回答走 OneBot send_msg 发回 QQ。
 *
 * 不需要任何 npm 依赖（只用到 Node 22+ 内置的 WebSocket）。
 * 用法：node bridge.mjs            正常启动
 *       node bridge.mjs --once 你好 本地自测一次，不连接 QQ
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeduper } from './dedupe.mjs';
import { createPersonaCommands } from './commands.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));

const LOG_DIR = path.join(HERE, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, `bridge-${new Date().toISOString().slice(0, 10)}.log`);

function log(...parts) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ` +
    parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ 状态 */

const STATE_FILE = path.join(HERE, CFG.stateFile || 'state.json');
let state = { sessions: {} };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* 首次运行 */ }
if (!state.sessions) state.sessions = {};
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) { log('state save failed', e.message); }
}

/* --------------------------------------------------- 单实例锁（防重复回复） */

const LOCK_FILE = path.join(HERE, 'state', 'bridge.lock');

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });

  // 原子创建（O_EXCL）：两个进程同时启动也只有一个能拿到锁
  const writeLock = () => fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });

  try {
    writeLock();
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let old = 0;
    try { old = Number(fs.readFileSync(LOCK_FILE, 'utf8').trim()); } catch { /* 读不到按无锁处理 */ }
    if (old && old !== process.pid && pidAlive(old)) {
      log(`已有桥接在运行（pid ${old}），本进程退出，避免一条消息回两次`);
      process.exit(0);
    }
    // 陈旧锁：原进程已死，清掉重新抢
    try { fs.rmSync(LOCK_FILE, { force: true }); } catch { /* ignore */ }
    try {
      writeLock();
    } catch {
      log('抢锁失败（另一个进程刚拿到锁），本进程退出');
      process.exit(0);
    }
  }

  const release = () => {
    try {
      if (fs.readFileSync(LOCK_FILE, 'utf8').trim() === String(process.pid)) fs.rmSync(LOCK_FILE, { force: true });
    } catch { /* ignore */ }
  };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(0); });
  process.on('SIGTERM', () => { release(); process.exit(0); });
}

acquireLock();

// 消息级幂等：哪怕真有两个进程/OneBot 重发，同一条消息也只处理一次
const dedupe = createDeduper({
  dir: path.join(HERE, 'state', 'claims'),
  ttlMs: CFG.dedupeTtlMs ?? 3600 * 1000,
  log: (...a) => log(...a),
});

// 人格管理命令（/人格 …），写操作只允许主号
const PERSONA_PATH = path.join(
  process.env.DSH_HOME || path.join(process.env.USERPROFILE || HERE, '.dsh'),
  'persona', 'qq.md',
);
const personaCmd = createPersonaCommands({ cfg: CFG, personaPath: PERSONA_PATH, log });

/* ------------------------------------------------------ 调用 dsh 一次性运行 */

function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
  } else {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

/**
 * 跑一次 `dsh --profile <p> --json [-–session-id x] -`
 * 任务通过 stdin 传入，避免中文/引号在命令行上的转义问题。
 */
function runDsh({ sessionId, task }) {
  return new Promise((resolve, reject) => {
    const cwd = CFG.workspace || HERE;
    const env = { ...process.env };
    const common = { cwd, windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] };

    let child;
    if (process.platform === 'win32') {
      // .cmd 必须经由 cmd 启动；命令串整体 verbatim 传入，路径含空格也安全。
      const inner = `"${CFG.dshCmd}" --profile "${CFG.profile}" --json` +
        (sessionId ? ` --session-id "${sessionId}"` : '') + ' -';
      child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${inner}"`], {
        ...common,
        windowsVerbatimArguments: true,
      });
    } else {
      const args = ['--profile', CFG.profile, '--json'];
      if (sessionId) args.push('--session-id', sessionId);
      args.push('-');
      child = spawn(CFG.dshCmd, args, common);
    }

    let out = '', err = '', done = false;
    const timeoutMs = CFG.timeoutMs ?? 180000;
    const timer = setTimeout(() => {
      if (done) return;
      log('dsh 超时，终止进程', sessionId || '(新会话)');
      killTree(child);
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); done = true; reject(e); });
    child.stdin.on('error', () => { /* 进程提前退出时忽略 EPIPE */ });
    child.on('close', (code) => {
      clearTimeout(timer);
      done = true;

      let newSessionId = sessionId || null;
      let text = '';
      let failure = null;
      for (const line of out.split(/\r?\n/)) {
        const t = line.trim();
        if (!t.startsWith('{')) continue;
        let ev;
        try { ev = JSON.parse(t); } catch { continue; }
        if (ev.type === 'session') newSessionId = ev.sessionId || newSessionId;
        else if (ev.type === 'final') text = typeof ev.text === 'string' ? ev.text : '';
        else if (ev.type === 'turn_end' && ev.reason?.kind === 'error') failure = ev.reason.error;
        else if (ev.type === 'error') failure = ev;
      }
      resolve({ code, text, failure, err, sessionId: newSessionId });
    });

    child.stdin.end(task);
  });
}

/* -------------------------------------------------------------- 任务与人格 */

function nowText() {
  const tz = CFG.timeZone || 'Asia/Shanghai';
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false,
  }).format(now);
  return `${fmt}（${tz}）`;
}

function buildTask(ctx) {
  const lines = [];
  lines.push(`【QQ 消息】${nowText()}`);
  if (ctx.scene) lines.push(`会话：${ctx.scene}`);
  if (ctx.nickname) lines.push(`发送者：${ctx.nickname}${ctx.userId ? `（QQ ${ctx.userId}）` : ''}`);
  // 称呼由程序定：主号＝哥哥，其他＝叔叔（避免模型自己猜）
  const owner = String(CFG.ownerQQ || '');
  const addr = ctx.userId && String(ctx.userId) === owner ? '哥哥' : '叔叔';
  lines.push(`【称呼】这次要叫对方「${addr}」，不要用别的称呼，也不要叫「主人」「您」。`);
  if (ctx.quoted) lines.push(`对方引用了：${ctx.quoted}`);
  lines.push('');
  lines.push(ctx.text);
  return lines.join('\n');
}

/** 交给「意识」服务（pet/brain.mjs），失败返回 null 让调用方回退。 */
async function askBrain({ key, text, scene, nickname, userId }) {
  if (!CFG.brainUrl) return null;
  try {
    const res = await fetch(`${CFG.brainUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        text,
        surface: 'qq',
        extra: `${scene}；发送者 ${nickname}（QQ ${userId}）`,
      }),
      signal: AbortSignal.timeout((CFG.timeoutMs ?? 180000) + 5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.reply || '').trim() || null;
  } catch (e) {
    log('brain 调用失败', e.message);
    return null;
  }
}

/* ------------------------------------------------------------------ 发消息 */

function chunk(text, limit) {
  const out = [];
  let rest = String(text).replace(/\r\n/g, '\n').trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

let ws = null;
let selfId = CFG.selfId || 0;
let echoSeq = 0;
const pending = new Map();

function callApi(action, params) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error('WebSocket 未连接'));
    const echo = `e${++echoSeq}`;
    const timer = setTimeout(() => {
      pending.delete(echo);
      reject(new Error(`${action} 超时`));
    }, 15000);
    pending.set(echo, { resolve, reject, timer });
    ws.send(JSON.stringify({ action, params, echo }));
  });
}

async function reply(ctx, text) {
  const parts = chunk(text, CFG.maxReplyChars ?? 1800);
  for (const part of parts) {
    const message = [];
    if (CFG.quoteReply && ctx.messageId) {
      message.push({ type: 'reply', data: { id: String(ctx.messageId) } });
    }
    message.push({ type: 'text', data: { text: part } });
    const params = ctx.groupId
      ? { message_type: 'group', group_id: ctx.groupId, message }
      : { message_type: 'private', user_id: ctx.userId, message };
    try {
      await callApi('send_msg', params);
    } catch (e) {
      log('发送失败', e.message, part.slice(0, 60));
      return;
    }
    if (parts.length > 1) await new Promise((r) => setTimeout(r, 300));
  }
}

/* -------------------------------------------------------------- 触发与解析 */

function stripCQ(s) {
  return s
    .replace(/\[CQ:at,qq=\d+,?name=[^\]]*\]/g, '')
    .replace(/\[CQ:[^\]]*\]/g, '')
    .trim();
}

function textOf(event) {
  const m = event.message;
  if (typeof m === 'string') return stripCQ(m);
  if (Array.isArray(m)) {
    const buf = [];
    for (const seg of m) {
      if (seg.type === 'text') buf.push(seg.data?.text ?? '');
      else if (seg.type === 'face') buf.push('〔表情〕');
      else if (seg.type === 'image') buf.push('〔图片〕');
      else if (seg.type === 'mface') buf.push('〔表情包〕');
      else if (seg.type === 'record') buf.push('〔语音〕');
    }
    return buf.join('').trim();
  }
  return '';
}

function atSelf(event) {
  const m = event.message;
  if (!Array.isArray(m)) {
    return new RegExp(`\\[CQ:at,qq=${selfId}(?:,|\\])`).test(String(event.raw_message || ''));
  }
  return m.some((seg) => seg.type === 'at' && String(seg.data?.qq) === String(selfId));
}

function groupAllowed(groupId) {
  const g = CFG.groups || {};
  if (!g.mode || g.mode === 'all') return true;
  return (g.allow || []).map(String).includes(String(groupId));
}

/* ---------------------------------------------------------------- 主处理 */

const perKeyChain = new Map();
function serialize(key, fn) {
  const prev = perKeyChain.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  perKeyChain.set(key, next.catch(() => {}));
  return next;
}

const lastAt = new Map();
const groupNames = new Map();

async function resolveGroupName(groupId) {
  if (groupNames.has(String(groupId))) return groupNames.get(String(groupId));
  try {
    const res = await callApi('get_group_info', { group_id: groupId, no_cache: false });
    const name = res?.data?.group_name || `群 ${groupId}`;
    groupNames.set(String(groupId), name);
    return name;
  } catch {
    return `群 ${groupId}`;
  }
}

function displayName(sender) {
  return sender?.card || sender?.nickname || (sender?.user_id ? String(sender.user_id) : '某人');
}

async function handleMessage(event) {
  const isGroup = event.message_type === 'group';
  const userId = event.user_id;
  const groupId = isGroup ? event.group_id : null;

  if (!event.message || (Array.isArray(event.message) && event.message.length === 0)) return;

  if (isGroup) {
    if (!groupAllowed(groupId)) return;
    const trig = CFG.groupTrigger || {};
    const prefix = trig.prefix || '';
    const mentioned = atSelf(event);
    const raw = String(event.raw_message ?? (typeof event.message === 'string' ? event.message : ''));
    const prefixed = prefix && raw.trim().startsWith(prefix);
    if (!(mentioned || prefixed)) return;
  }

  let text = textOf(event);
  const prefix = !isGroup && (CFG.groupTrigger?.prefix || '');
  if (prefix && text.startsWith(prefix)) text = text.slice(prefix.length);
  if (isGroup && CFG.groupTrigger?.prefix && text.startsWith(CFG.groupTrigger.prefix)) {
    text = text.slice(CFG.groupTrigger.prefix.length);
  }
  text = text.trim();
  if (!text) return;

  // 幂等第一道：同一条 message_id 只处理一次（跨进程，靠原子认领）
  if (event.message_id && !dedupe.claim(`msg:${event.message_id}`)) {
    log(`重复消息 ${event.message_id}，跳过`);
    return;
  }
  // 幂等第二道：同一人几秒内发同样的内容（客户端重发/换 id 重发）也只回一次
  const contentKey = `txt:${isGroup ? 'g' + groupId : 'p' + userId}:${userId}:${text}`;
  if (!dedupe.claim(contentKey, { ttl: CFG.contentDedupeMs ?? 5000 })) {
    log('短时间内同一内容重复，跳过');
    return;
  }

  const key = isGroup ? `group:${groupId}:${userId}` : `private:${userId}`;

  // 人格管理命令：写操作只允许主号，其他人直接拒绝
  const pc = personaCmd.handle(text, { userId });
  if (pc.handled) {
    await reply({ userId, groupId, messageId: event.message_id }, pc.reply || '好了');
    if (pc.changed) {
      delete state.sessions[key];
      saveState();
      if (CFG.brainUrl) {
        try {
          await fetch(`${CFG.brainUrl}/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key }),
          });
        } catch { /* 意识服务没开就算了 */ }
      }
      log(`人格已更新，清掉 ${key} 的旧会话`);
    }
    return;
  }

  const nickname = displayName(event.sender);
  const scene = isGroup ? `群聊「${await resolveGroupName(groupId)}」(群号 ${groupId})` : '私聊';

  // 冷却，防止刷屏（同一人）
  const now = Date.now();
  const cool = CFG.rateLimitMs ?? 1500;
  if (now - (lastAt.get(key) || 0) < cool) return;
  lastAt.set(key, now);

  // 指令：重置记忆
  if (/^[/!#](reset|clear|重置|清空记忆)$/i.test(text)) {
    if (state.sessions[key]) {
      delete state.sessions[key];
      saveState();
    }
    if (CFG.brainUrl) {
      try {
        await fetch(`${CFG.brainUrl}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
      } catch { /* 意识服务没开就算了 */ }
    }
    await reply({ userId, groupId, messageId: event.message_id }, CFG.resetReply || '记忆已清空，我们重新认识一下吧。');
    return;
  }

  await serialize(key, async () => {
    const started = Date.now();
    const task = buildTask({ text, scene, nickname, userId: String(userId) });
    let rec = state.sessions[key];
    if (rec && now - (rec.updatedAt || 0) > (CFG.sessionTtlMs ?? 6 * 3600 * 1000)) {
      rec = undefined; // 太久没聊，开新会话，省 token
    }

    log(`→ [${scene}] ${nickname}: ${text.slice(0, 80)}（${rec ? '续接' : '新会话'}）`);

    // 优先走「意识」服务：和桌宠共用记忆、人格、作息；连不上再自己起 dsh
    if (CFG.brainUrl) {
      const viaBrain = await askBrain({ key, text, scene, nickname, userId: String(userId) });
      if (viaBrain) {
        log(`← [brain] ${viaBrain.length} 字，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
        await reply({ userId, groupId, messageId: event.message_id }, viaBrain);
        return;
      }
      log('意识服务不可用，回退到本地 dsh');
    }

    let res;
    try {
      res = await runDsh({ sessionId: rec?.sessionId, task });
    } catch (e) {
      log('运行失败', e.message);
      await reply({ userId, groupId, messageId: event.message_id }, CFG.errorReply || '（这边出了点故障，稍后再试一次吧。）');
      return;
    }

    const failMsg = res.failure?.error?.message || res.failure?.message || '';
    if ((res.code !== 0 || res.failure) && rec?.sessionId) {
      log('续接失败，改用新会话重试：', failMsg.slice(0, 120));
      delete state.sessions[key];
      saveState();
      try {
        res = await runDsh({ sessionId: null, task });
      } catch (e) {
        log('重试失败', e.message);
      }
    }

    if (res.sessionId) {
      state.sessions[key] = { sessionId: res.sessionId, updatedAt: Date.now(), nickname };
      saveState();
    }

    const answer = (res.text || '').trim();
    if (!answer) {
      log('空回复', { code: res.code, failMsg, stderr: res.err.slice(-300) });
      await reply({ userId, groupId, messageId: event.message_id }, CFG.emptyReply || '（没想好怎么回，再问一次？）');
      return;
    }
    log(`← ${answer.length} 字，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
    await reply({ userId, groupId, messageId: event.message_id }, answer);
  });
}

/* --------------------------------------------------------------- 连接管理 */

let reconnectDelay = 5000;

/** 显示名：优先 config.displayName，其次读 pet/config.json 的 name */
function displayNameForQq() {
  if (CFG.displayName) return CFG.displayName;
  try {
    const pet = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'pet', 'config.json'), 'utf8'));
    return pet.name || null;
  } catch { return null; }
}

/** 把机器人在各群的名片同步成她的名字（昵称改不了，名片能改） */
async function syncGroupCard() {
  const name = displayNameForQq();
  if (!name) return;
  const login = await callApi('get_login_info').catch(() => null);
  const uid = login?.user_id || selfId;
  if (!uid) return;
  const groups = (await callApi('get_group_list').catch(() => null))?.data || [];
  if (!groups.length) return;
  let n = 0;
  for (const g of groups) {
    try {
      await callApi('set_group_card', { group_id: g.group_id, user_id: uid, card: name });
      n++;
    } catch { /* 没有改名片权限就跳过 */ }
  }
  if (n) log(`群名片已同步为「${name}」（${n} 个群）`);
}

function connect() {
  const url = CFG.accessToken
    ? `${CFG.wsUrl}${CFG.wsUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(CFG.accessToken)}`
    : CFG.wsUrl;

  log(`连接 OneBot：${CFG.wsUrl}（profile=${CFG.profile}）`);
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    reconnectDelay = 5000;
    log('已连接，等待 QQ 消息…（Ctrl+C 退出）');
    if (CFG.syncGroupCard !== false) {
      setTimeout(() => syncGroupCard().catch(() => {}), 1500);
    }
  });

  ws.addEventListener('message', (ev) => {
    let data;
    try { data = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }

    if (data.echo && pending.has(data.echo)) {
      const { resolve, reject, timer } = pending.get(data.echo);
      clearTimeout(timer);
      pending.delete(data.echo);
      if (data.status === 'ok' || data.retcode === 0) resolve(data);
      else reject(new Error(data.msg || data.wording || `retcode=${data.retcode}`));
      return;
    }

    if (data.post_type === 'meta_event' && data.meta_event_type === 'lifecycle') {
      selfId = data.self_id || selfId;
      log(`机器人 QQ：${selfId}`);
      return;
    }
    if (data.self_id) selfId = data.self_id;

    if (data.post_type === 'message') {
      handleMessage(data).catch((e) => log('处理消息异常', e.stack || e.message));
    }
  });

  ws.addEventListener('close', (e) => {
    log(`连接断开（code=${e.code}），${reconnectDelay / 1000} 秒后重连`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60000);
  });

  ws.addEventListener('error', () => {
    log('WebSocket 错误（NapCat 是否已启动？端口/Token 是否正确？）');
  });
}

/* ------------------------------------------------------------------ 入口 */

const onceIdx = process.argv.indexOf('--once');
if (onceIdx !== -1) {
  const text = process.argv.slice(onceIdx + 1).join(' ') || '你好，用一句话介绍一下你自己。';
  const task = buildTask({ text, scene: '本地自测', nickname: '我', userId: 'self' });
  log('自测任务：', task.replace(/\n/g, ' | '));
  const res = await runDsh({ sessionId: null, task });
  console.log('--- dsh 退出码：', res.code);
  if (res.failure) console.log('--- 失败原因：', JSON.stringify(res.failure));
  console.log('--- 回答：\n' + (res.text || '(空)'));
  process.exit(res.code === 0 && res.text ? 0 : 1);
} else {
  connect();
}

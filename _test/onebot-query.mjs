// 查询 OneBot 侧的好友/群列表（调试用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config.json'), 'utf8'));
const url = `${CFG.wsUrl}${CFG.wsUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(CFG.accessToken)}`;

const ws = new WebSocket(url);
let seq = 0;
const pending = new Map();

function call(action, params = {}) {
  return new Promise((resolve, reject) => {
    const echo = `q${++seq}`;
    pending.set(echo, { resolve, reject });
    ws.send(JSON.stringify({ action, params, echo }));
    setTimeout(() => { if (pending.delete(echo)) reject(new Error('timeout ' + action)); }, 10000);
  });
}

ws.addEventListener('message', (ev) => {
  const d = JSON.parse(ev.data);
  if (d.echo && pending.has(d.echo)) {
    const { resolve } = pending.get(d.echo);
    pending.delete(d.echo);
    resolve(d.data);
  }
});

ws.addEventListener('error', (e) => { console.log('WS 错误：NapCat 没开或 token 不对'); process.exit(1); });

ws.addEventListener('open', async () => {
  try {
    const login = await call('get_login_info');
    console.log(`机器人：${login.nickname}（${login.user_id}）`);

    const friends = await call('get_friend_list');
    console.log(`好友 ${friends.length} 人：`);
    for (const f of friends.slice(0, 20)) console.log(`  - ${f.remark || f.nickname} (${f.user_id})`);

    const groups = await call('get_group_list');
    console.log(`群 ${groups.length} 个：`);
    for (const g of groups.slice(0, 20)) console.log(`  - ${g.group_name} (${g.group_id})`);
  } catch (e) {
    console.log('查询失败：', e.message);
  }
  process.exit(0);
});

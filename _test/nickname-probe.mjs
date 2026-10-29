// 调试：看看 set_qq_profile 到底返回什么，以及群名片能不能改
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
  return new Promise((resolve) => {
    const echo = `d${++seq}`;
    pending.set(echo, resolve);
    ws.send(JSON.stringify({ action, params, echo }));
    setTimeout(() => { if (pending.delete(echo)) resolve({ timeout: true, action }); }, 15000);
  });
}

ws.addEventListener('message', (ev) => {
  const d = JSON.parse(ev.data);
  if (d.echo && pending.has(d.echo)) {
    const r = pending.get(d.echo);
    pending.delete(d.echo);
    r(d);
  }
});

ws.addEventListener('error', () => { console.log('连接失败'); process.exit(1); });

const target = process.argv[2] || '哦鲸鲸';
const groupId = Number(process.argv[3] || 10002);

ws.addEventListener('open', async () => {
  console.log('1) set_qq_profile 原始返回：');
  console.log(JSON.stringify(await call('set_qq_profile', { nickname: target })));

  await new Promise((r) => setTimeout(r, 3000));

  console.log('\n2) get_login_info：');
  console.log(JSON.stringify(await call('get_login_info')));

  console.log('\n3) get_stranger_info(自己)：');
  console.log(JSON.stringify(await call('get_stranger_info', { user_id: 10001, no_cache: true })));

  console.log('\n4) set_group_card(群 ' + groupId + ')：');
  console.log(JSON.stringify(await call('set_group_card', { group_id: groupId, user_id: 10001, card: target })));

  await new Promise((r) => setTimeout(r, 1500));
  console.log('\n5) 群里成员信息：');
  console.log(JSON.stringify(await call('get_group_member_info', { group_id: groupId, user_id: 10001, no_cache: true })));

  process.exit(0);
});

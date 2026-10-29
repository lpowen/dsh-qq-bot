// 从机器人向指定 QQ 发一条测试消息（调试用）
// 用法：node _test/send-test.mjs <user_id> <文本>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config.json'), 'utf8'));
const url = `${CFG.wsUrl}${CFG.wsUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(CFG.accessToken)}`;

const userId = Number(process.argv[2]);
const text = process.argv.slice(3).join(' ') || '测试消息';

const ws = new WebSocket(url);
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ action: 'send_private_msg', params: { user_id: userId, message: text }, echo: 'send1' }));
});
ws.addEventListener('message', (ev) => {
  const d = JSON.parse(ev.data);
  if (d.echo === 'send1') {
    console.log(d.status === 'ok' ? `已发送，message_id=${d.data?.message_id}` : `发送失败：${JSON.stringify(d)}`);
    process.exit(0);
  }
});
ws.addEventListener('error', () => { console.log('连接失败'); process.exit(1); });
setTimeout(() => { console.log('超时'); process.exit(1); }, 15000);

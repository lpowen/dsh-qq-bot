// 极简 OneBot v11 模拟服务器：仅用于本地联调 bridge.mjs（不参与生产）
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 3001);

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrames(buf) {
  const out = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const b1 = buf[off + 1];
    let len = b1 & 0x7f;
    let pos = off + 2;
    if (len === 126) { if (pos + 2 > buf.length) break; len = buf.readUInt16BE(pos); pos += 2; }
    else if (len === 127) { if (pos + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(pos)); pos += 8; }
    const masked = (b1 & 0x80) !== 0;
    const maskLen = masked ? 4 : 0;
    if (pos + maskLen + len > buf.length) break;
    const mask = masked ? buf.subarray(pos, pos + 4) : null;
    pos += maskLen;
    const data = Buffer.from(buf.subarray(pos, pos + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    out.push({ opcode: buf[off] & 0x0f, data });
    off = pos + len;
  }
  return { frames: out, rest: buf.subarray(off) };
}

const server = http.createServer((_, res) => { res.writeHead(404); res.end(); });

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  console.log('[mock] bridge 已连接:', req.url);

  const send = (obj) => socket.write(encodeFrame(JSON.stringify(obj)));

  send({ post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'connect', self_id: 10001, time: Math.floor(Date.now() / 1000) });

  setTimeout(() => {
    const mode = process.env.MOCK_MODE || 'private';
    const event = mode === 'group'
      ? {
          post_type: 'message',
          message_type: 'group',
          sub_type: 'normal',
          self_id: 10001,
          group_id: 30003,
          user_id: 20002,
          message_id: 556,
          raw_message: '[CQ:at,qq=10001] 用一句话说说你现在的心情',
          message: [
            { type: 'at', data: { qq: '10001' } },
            { type: 'text', data: { text: ' 用一句话说说你现在的心情' } },
          ],
          sender: { user_id: 20002, nickname: '群友甲', card: '甲' },
          time: Math.floor(Date.now() / 1000),
        }
      : {
          post_type: 'message',
          message_type: 'private',
          sub_type: 'friend',
          self_id: 10001,
          user_id: 20002,
          message_id: 555,
          raw_message: '在吗？用一句话说说你现在的心情',
          message: [{ type: 'text', data: { text: '在吗？用一句话说说你现在的心情' } }],
          sender: { user_id: 20002, nickname: '测试用户' },
          time: Math.floor(Date.now() / 1000),
        };
    send(event);
    console.log(`[mock] 已发送${mode === 'group' ? '群聊 @' : '私聊'}消息，等待回复…`);
  }, 1200);

  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { frames, rest } = decodeFrames(buf);
    buf = rest;
    for (const f of frames) {
      if (f.opcode === 8) { socket.end(); return; }
      if (f.opcode !== 1) continue;
      const msg = JSON.parse(f.data.toString('utf8'));
      if (msg.action === 'send_msg') {
        console.log('[mock] 收到 send_msg:');
        console.log(JSON.stringify(msg.params, null, 2));
        send({ status: 'ok', retcode: 0, data: { message_id: 999 }, echo: msg.echo });
        setTimeout(() => { console.log('[mock] 联调成功，退出'); server.close(); process.exit(0); }, 800);
      } else if (msg.echo) {
        const data = msg.action === 'get_group_info'
          ? { group_id: 30003, group_name: '测试群' }
          : {};
        send({ status: 'ok', retcode: 0, data, echo: msg.echo });
      }
    }
  });
  socket.on('error', () => {});
});

server.listen(PORT, '127.0.0.1', () => console.log(`[mock] OneBot 模拟服务已监听 ws://127.0.0.1:${PORT}`));
setTimeout(() => { console.log('[mock] 超时未收到回复'); process.exit(1); }, 120000);

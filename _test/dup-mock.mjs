// 重复投递测试：同一 message_id 连发两次，验证桥接只回一条
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 3005);

function encode(text) {
  const p = Buffer.from(text, 'utf8');
  let h;
  if (p.length < 126) h = Buffer.from([0x81, p.length]);
  else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); }
  return Buffer.concat([h, p]);
}

function decode(buf) {
  const out = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const b1 = buf[off + 1];
    let len = b1 & 0x7f;
    let pos = off + 2;
    if (len === 126) { len = buf.readUInt16BE(pos); pos += 2; }
    else if (len === 127) { len = Number(buf.readBigUInt64BE(pos)); pos += 8; }
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

const server = http.createServer((_, r) => { r.writeHead(404); r.end(); });
let replies = 0;

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const send = (o) => socket.write(encode(JSON.stringify(o)));

  send({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: 10001 });

  const msg = {
    post_type: 'message', message_type: 'private', sub_type: 'friend',
    self_id: 10001, user_id: 20002, message_id: 4242,
    raw_message: '重复投递测试', message: [{ type: 'text', data: { text: '重复投递测试' } }],
    sender: { user_id: 20002, nickname: '测试' }, time: Math.floor(Date.now() / 1000),
  };

  setTimeout(() => {
    send(msg);
    console.log('[mock] 第 1 次投递');
    setTimeout(() => { send(msg); console.log('[mock] 第 2 次投递（同 message_id）'); }, 400);
  }, 800);

  let buf = Buffer.alloc(0);
  socket.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
    const { frames, rest } = decode(buf);
    buf = rest;
    for (const f of frames) {
      if (f.opcode !== 1) continue;
      const m = JSON.parse(f.data.toString('utf8'));
      if (m.action === 'send_msg') {
        replies++;
        console.log(`[mock] 收到第 ${replies} 条回复`);
        send({ status: 'ok', retcode: 0, data: { message_id: 1 }, echo: m.echo });
      } else if (m.echo) {
        send({ status: 'ok', retcode: 0, data: {}, echo: m.echo });
      }
    }
  });
  socket.on('error', () => {});
});

server.listen(PORT, '127.0.0.1', () => console.log(`[mock] :${PORT} 等待桥接`));

setTimeout(() => {
  console.log(`[mock] 结果：收到 ${replies} 条回复（期望 1）`);
  process.exit(replies === 1 ? 0 : 1);
}, 60000);

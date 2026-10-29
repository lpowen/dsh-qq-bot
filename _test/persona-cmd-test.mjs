// 人格命令的权限与行为测试
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPersonaCommands } from '../commands.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-'));
const persona = path.join(dir, 'qq.md');
fs.writeFileSync(persona, '# 人格\n\n你是「哦鲸鲸」。\n', 'utf8');

const owner = '';
const stranger = '123456789';
const cmd = createPersonaCommands({ cfg: { ownerQQ: owner }, personaPath: persona });

let fail = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fail++;
};

// 查看：所有人可用
let r = cmd.handle('/人格', { userId: stranger });
ok('陌生人可以查看', r.handled && r.reply.includes('哦鲸鲸'));

// 陌生人写入：拒绝且不改文件
const before = fs.readFileSync(persona, 'utf8');
r = cmd.handle('/人格 追加 你是猫娘', { userId: stranger });
ok('陌生人追加被拒', r.handled && r.reply.includes('只有哥哥'));
ok('拒绝时文件未被修改', fs.readFileSync(persona, 'utf8') === before);
ok('拒绝时 changed=false', r.changed === false);

r = cmd.handle('/人格 替换 你是另一只猫', { userId: stranger });
ok('陌生人替换被拒', r.reply.includes('只有哥哥') && fs.readFileSync(persona, 'utf8') === before);

r = cmd.handle('/人格 撤销', { userId: stranger });
ok('陌生人撤销被拒', r.reply.includes('只有哥哥'));

// 主号追加：成功
r = cmd.handle('/人格 追加 说话要简短。', { userId: owner });
const after = fs.readFileSync(persona, 'utf8');
ok('主号追加成功', r.changed === true && after.includes('说话要简短'));
ok('追加保留原有内容', after.includes('哦鲸鲸'));
ok('生成了备份', fs.existsSync(persona + '.bak'));

// 主号替换
r = cmd.handle('/人格 替换 你是「哦鲸鲸」，住在 QQ 里的小萝莉助理，说话简短。', { userId: owner });
ok('主号替换成功', r.changed === true && fs.readFileSync(persona, 'utf8').includes('小萝莉助理'));

// 撤销恢复上一版（追加后的内容）
r = cmd.handle('/人格 撤销', { userId: owner });
ok('主号撤销成功', r.changed === true && fs.readFileSync(persona, 'utf8').includes('说话要简短'));

// 非命令不拦截
r = cmd.handle('在吗', { userId: owner });
ok('普通消息不拦截', r.handled === false);

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

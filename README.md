# QQ 机器人 × DeepSeek Harness

把 DSH（你桌面端那个 Agent）接到 QQ 上，用你自己写的人格和它聊天。
不需要 API Key：直接复用桌面端已登录的 DeepSeek 账号额度。

```
QQ 客户端  ──消息──▶  NapCat（OneBot v11 协议）
                          │ WebSocket
                          ▼
                    bridge.mjs（本目录）        ← 去重、触发判断、会话记忆
                          │ 每条消息 spawn 一次
                          ▼
        dsh --profile qq --json --session-id … -
                          │
                          ├─ 人格：~/.dsh/persona/qq.md
                          ├─ 场景规则：sandbox/AGENTS.md
                          └─ 记忆：每个 QQ 用户/群 一条 session（可多轮）
                          │
                          ▼
                    回答 ──▶ send_msg ──▶ QQ
```

## 和桌宠共用一个「意识」

`config.json` 的 `brainUrl`（默认 `http://127.0.0.1:4399`）指向 `../pet/brain.mjs`：

- 开着：QQ 消息交给「意识」服务，和桌面上的她共用**同一份人格、长期记忆、作息**；
- 没开：自动回退到本地起 `dsh`，机器人照常能用，只是记忆不通。

桌宠本身见 [../pet/README.md](../pet/README.md)。记忆按 [../pet/MEMORY.md](../pet/MEMORY.md) 做了分层冷热：原文归档、事件卡热存、旧事冷存、用户线索召回，单次注入有 1600 tokens 硬上限。

## 当前状态（已上线）

- ✅ 独立 profile：`%USERPROFILE%\.dsh\profiles\qq`（不影响桌面端，可同时开）
- ✅ 人格文件：`%USERPROFILE%\.dsh\persona\qq.md`
- ✅ NapCat 4.18.41：`D:\NapCat\NapCat.Shell`（自带 Node，已配好 WebSocket 服务器 3001）
- ✅ 机器人账号：**10001（农，小号）**，已快速登录
- ✅ 真实联调通过：主号 `你的QQ号` 私聊 `callo~`，3.6 秒回复
- 访问 Token：`YOUR_NAPCAT_TOKEN`（NapCat 与 `config.json` 两侧已一致）
- 小号现有：好友 2 人（含主号）、群 1 个（`148129554`）

## 日常启动：双击 `启动（无窗口）.vbs`

**零控制台窗口**。它会用一个隐藏的 PowerShell 依次检查并拉起四样东西：

| 组件 | 检查依据 |
| --- | --- |
| NapCat（QQ） | `6099` 端口没监听才启动 |
| 意识服务 brain | `4399` 端口没监听才启动 |
| 桥接 bridge | `state/bridge.lock` 里的 pid 还活着就跳过 |
| 桌宠 | 已有 `pythonw pet.py` 就跳过 |

停止：双击 `停止（无窗口）.vbs`（会确认一次；默认保留 NapCat，QQ 不掉线）。

### 掉线自愈：看门狗

DSH 重启会把它启动的子进程一起回收，所以服务不能只靠手动拉起。现在有两层兜底：

| 机制 | 说明 |
| --- | --- |
| **看门狗任务**（计划任务 `DSH-QQ-Bot-Watchdog`） | 每 5 分钟跑一次 `watchdog.vbs`；哪个组件没了就补哪个（端口 + pid 锁双重判断） |
| **开机自启**（启动文件夹快捷方式 `DSH-QQ-Bot.lnk`） | 登录时立即拉起一次，不用等 5 分钟 |

**停止是有记性的**：`silent-stop.ps1` 会写 `state\paused.flag`，看门狗看到它就什么都不做；
下次双击 `启动（无窗口）.vbs` 会先删掉这个标记，看门狗随之恢复。想手动恢复也可以直接删掉那个文件。

服务自己也会写 pid 文件，停止时按 pid 精确杀，不依赖命令行匹配：

| 文件 | 谁写 |
| --- | --- |
| `state\bridge.lock` | 桥接（同时当单实例锁） |
| `..\pet\state\brain.pid` | 意识服务 |
| `..\pet\state\pet.pid` | 桌宠 |

日志（都不弹窗，全写文件）：

| 文件 | 内容 |
| --- | --- |
| `logs/bridge-YYYY-MM-DD.log` | QQ 收发、去重跳过、错误 |
| `logs/launcher.log` | 启停记录（谁被拉起、谁被停掉） |
| `..\pet\state\brain.log` | 意识服务、记忆快照、主动说话 |
| `..\pet\state\pet.log` | 桌宠焦点、输入、发送 |

> 排错时再用带窗口的版本：`一键启动.cmd`（能看到实时输出）。
> 需要重新扫码登录时用 `D:\NapCat\start-napcat.cmd`——静默启动是没有二维码可看的。
> ⚠️ 改 `silent-launch.ps1` / `silent-stop.ps1` 时**只写 ASCII**：Windows PowerShell 读无 BOM 的 UTF-8 会按 ANSI 解，
> 中文注释会吞掉下一行（这次就是因此让暂停开关失效了一轮）。

## 三步上线（重装或换机器时参考）

### 1. 装 NapCat（QQ 的 OneBot 接口）

1. 到 NapCat 官方仓库（GitHub: `NapNeko/NapCatQQ`）下载 **NapCat.Shell.Windows.Node.zip**（自带 Node），解压到 `D:\NapCat\NapCat.Shell`。
2. 运行 `napcat.bat`，扫码登录一个小号。
   - GitHub 直连在国内很慢，可走镜像：`https://gh-proxy.com/<github 原始下载地址>`。
3. 登录后 OneBot 配置在 `napcat\config\onebot11_<QQ号>.json`，也可以在 WebUI 的「网络配置」里改：
   - 端口：`3001`，Token：`YOUR_NAPCAT_TOKEN`
   - 消息格式：`array`（重要，否则 @ 检测会退化）

### 2. 核对 `config.json`

`dshCmd`、`workspace`、`accessToken` 已经由 `setup.ps1` 填好。常改的两项：

| 字段 | 含义 |
| --- | --- |
| `groups.mode` | `all` 所有群可用；改成 `whitelist` 只允许 `groups.allow` 里的群号 |
| `groupTrigger.prefix` | 群里除了 @ 之外的前缀触发，如设成 `#` 则 `# 你好` 也触发 |

### 3. 启动

双击 `start-bot.cmd`。看到 `已连接，等待 QQ 消息…` 就成了。

- 私聊机器人：直接发消息，它就会回。
- 群聊：**@ 它** 才回（避免刷屏）；
- 发 `/reset`（或 `/重置`）清空这个人和机器人的聊天记忆。

## 人格：只有一件事要改

打开 `编辑人格.cmd`（或直接改 `%USERPROFILE%\.dsh\persona\qq.md`），用「你是……」的口气写：

### 也可以直接在 QQ 里改（权限分离）

| 命令 | 谁能用 | 作用 |
| --- | --- | --- |
| `/人格` | 所有人 | 查看当前人格（截前 700 字） |
| `/人格 追加 <文本>` | **仅主号** | 在人格文件末尾追加一段 |
| `/人格 替换 <文本>` | **仅主号** | 整份替换（自动备份到 `qq.md.bak`） |
| `/人格 撤销` | **仅主号** | 回到上一个备份 |

非主号发写操作会**在桥接层直接被拒**，回复「诶，人格设定只有哥哥能改啦，叔叔别乱动。」——
请求根本不会送到模型，所以没法靠聊天话术绕过。拒绝时人格文件一个字节都不会变（有测试断言）。

主号改完会自动清掉该会话，下一条消息就按新人格说话。判定用的是 `config.json` 的 `ownerQQ`。

自测：`node _test/persona-cmd-test.mjs`

```markdown
## 身份
你是「阿柒」，一只住在 QQ 里的猫娘助理。

## 说话方式
短句，自称「本喵」，句尾偶尔带「喵」。

## 禁止
不要说自己是大模型/AI 助手；不要输出 Markdown。
```

改完保存，**下一条消息**就生效（每条消息都会重新读这个文件，不用重启）。

写人格的几个经验：

- 写「怎么说话」比写「是什么」更有效：给 2～3 个示例对话，风格会稳很多。
- 「禁止」一节要写死边界（别自称 AI、别输出 Markdown、别编造），比正面描述管用。
- 人格太长会稀释注意力，**200～600 字最佳**；长设定拆成「身份 / 语气 / 边界 / 示例」四段。
- 场景规则（字数、纯文本、不许 @ 人）在 `sandbox/AGENTS.md`，和人格分开放，方便分别调。

## 常用配置（`config.json`）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `rateLimitMs` | 1500 | 同一个人两次提问的最小间隔，防刷屏 |
| `timeoutMs` | 180000 | 单次回答超时（超时会杀掉子进程） |
| `sessionTtlMs` | 6 小时 | 超过这么久没聊就开新会话，省 token |
| `maxReplyChars` | 1800 | 单条消息上限，超出自动拆分多条 |
| `quoteReply` | true | 回复时引用原消息（群里更清楚） |
| `timeZone` | Asia/Shanghai | 告诉模型「现在几点」用的时区 |
| `quietHours` | 无 | 夜间静默时段，如 `{ "start": 23, "end": 8 }`，见下 |

## 夜间静默（23:00–08:00 不回复、不花 token）

```json
"quietHours": { "start": 23, "end": 8 }
```

- 时段内收到的消息**直接丢弃**：不回复、不进模型、不调 dsh，token 消耗为零；
- 支持跨零点（`23 → 8` 就是当晚 23:00 到次日 08:00），也支持同日窗口（如 `1 → 6`）；
- 日志里每 10 分钟最多提示一次「静默时段」，不会刷屏；
- 想关掉：删掉 `quietHours` 这一项，或把 `start` 和 `end` 设成同一个数；
- **只影响 QQ**：桌宠的桌面对话不受影响；桌宠的「主动说话」在静默时段也会停（它走同一个 brain）。

## 成本与延迟

- **延迟**：每条消息要新起一个 DSH 进程（约 2 秒启动）+ 模型出字，实测短回答 **4～6 秒**。
  连续对话时 DSH 的 KV cache 会命中，第 2 轮起 inputTokens 从 6000+ 降到约 200，很便宜。
- **额度**：走桌面端登录账号；如果桌面端同时在用，两边共用额度。
- 每条消息都会带上一整套系统提示和工具说明（约 6000 tokens 输入），短对话单条成本主要在这儿。

## 已知限制

1. **只看得到 @ 它的消息**：群里其他人的聊天内容它看不到，别指望它懂「上文群聊」。
2. **单进程串行**：同一个人连发多条会排队；不同人之间并行。
3. **纯文本**：语音/图片只以 `〔图片〕〔语音〕` 占位，模型理解不了图片内容（要识图得另接）。
4. **0.5～1 分钟的冷启动**：第一次启动要加载 profile，之后每条消息约 2 秒开机。

## 名字同步（昵称改不了，用群名片）

QQ 服务端**不允许通过协议改账号昵称**——`set_qq_profile` 会返回：

```json
{"status":"ok","retcode":0,"data":{"result":55,"errMsg":"UpdateUdcFail"}}
```

返回 ok 但 `errMsg=UpdateUdcFail`，昵称不变。所以分两条路：

| 位置 | 能否自动改 | 做法 |
| --- | --- | --- |
| 群里的显示名 | ✅ 能 | **群名片**（`set_group_card`）。桥接每次连上会自动把所在所有群的名片改成 `pet/config.json` 的 `name` |
| 私聊 / 资料卡 | ❌ 不能 | 只能手机 QQ 手动改（设置 → 账号 → 昵称），或由对方加「备注」 |

手动同步一次：

```powershell
node set-nickname.mjs          # 先试昵称，再批量改所有群名片，并回读确认
node set-nickname.mjs 灵梦      # 指定别的名字
```

想让桥接同步成别的名字，在 `config.json` 加 `"displayName": "…"`；设 `"syncGroupCard": false` 可关掉自动同步。

## 防重复回复（三层，都在代码里）

之前出过「一条消息回两条、一条叫叔叔一条叫哥哥」，根因是**两个桥接进程同时连着 NapCat**。
现在从三个层面堵死：

| 层 | 机制 | 挡住什么 |
| --- | --- | --- |
| 进程锁 | `state/bridge.lock`，用 `O_EXCL` 原子创建 + pid 存活检查，旧进程死了自动接管 | 手滑双开、开机自启 + 手动启动叠加 |
| 消息幂等 | `state/claims/*.claim`，按 `message_id` 原子认领（1 小时 TTL） | NapCat 重投、断线重连后的事件重放 |
| 内容指纹 | 同一人 5 秒内发同样的话只处理一次（`contentDedupeMs`） | 客户端换 id 重发、连点两次 |

认领是**跨进程**的：两个进程同时抢同一条消息，只有一个的 `O_EXCL` 创建会成功，另一个直接跳过并写日志
（`重复消息 12345，跳过`）。这比内存里记一个 Set 可靠，因为进程各有各的内存。

一键启动脚本也改成检查锁文件，而不是查 `3001` 端口（那是 NapCat 的 WS，永远在监听，等于没检查）。

自测：

```powershell
node _test/dedupe-test.mjs   # 认领语义：并发 20 次只赢 1 次
node _test/dup-mock.mjs      # 端到端：同一 message_id 投两次，只回一条
```

> 唯一挡不住的情况：把整个目录**复制成两份**分别运行——两份的 `state/` 各算各的，锁和认领互不相干。
> 保持只有一份在跑就行。



- **用第三方客户端登录个人 QQ 号有封号风险**。务必用小号，别用主号；也不要拿它做营销/批量操作。
- 想完全合规，走 **QQ 官方机器人开放平台**（`q.qq.com`）：需要个人/企业资质审核，只能在群里 @ 或频道里用，接口是官方 WebSocket + HTTP（不是 OneBot）。
  本目录的 `bridge.mjs` 结构上可以直接换适配层：把「收消息 / 发消息」两处换成官方 API 即可，DSH 那半部分（`runDsh`）完全不用动。
- 机器人回复的内容由模型生成，群里有别人时注意别让它乱说话——人格里的「禁止」和 `groups.mode: whitelist` 都要用上。

## 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 一条消息收到两条回复 | 旧版本是两个桥接同时连 NapCat。现在有进程锁 + 消息幂等兜底；若仍出现，检查是不是把目录复制成两份在跑，或有两台机器连同一个 QQ |
| 启动时提示「已有桥接在运行（pid …）」 | 正常保护，说明已经有一个在跑；关掉那个窗口再启动，或直接用它 |
| 日志反复 `连接断开 (code=1006)` | NapCat 没启动、端口不是 3001、或 Token 不一致 |
| 启动 NapCat 报 `当前账号(xxx)已登录,无法重复登录` | 上一个实例没退干净：结束残留 `D:\NapCat\...\node.exe`，再用 `-q <账号>` 快速登录（我们已遇到并这样解决） |
| NapCat 停在 `waiting_qrcode` | 没带 `-q` 且本地没有登录缓存，需要重新扫码 |
| `自测` 报 `MISSING_CREDENTIAL` | 桌面端登录已失效，重新登录 DSH 桌面端 |
| 收到消息但一直不回 | 看 `logs\bridge-*.log`：`续接失败` 会自动重试新会话；`空回复` 看随后打印的 stderr |
| 群聊 @ 了没反应 | NapCat 的消息格式要设成 `array`；或 `groups.mode` 是白名单但群号没加 |
| 回复被拆成好几条 | 模型输出超过 `maxReplyChars`，属正常；可调大 |
| 想换模型 | 改 `%USERPROFILE%\.dsh\profiles\qq\cordis.patch.yml` 里 `model:`（如 `deepseek-pro`），重启桥接 |

## 进阶

- **群里每个人一个人格**：复制一份 `persona.md`，在 `config.json` 之外按 QQ 号分派 profile（`dsh --profile qq2`）。
- **开机自启**：用 `nssm` 把 `node bridge.mjs` 注册成服务，比双击窗口稳。
- **多人格/多机器人**：一个 `profile` 对应一个人格，多开几个 `bridge.mjs`（不同端口 + 不同 profile）即可。
- **让机器人能操作文件**：`sandbox/` 就是它的工作目录，放进去的文件它能读写（谨慎，别放隐私文件）。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `一键启动.cmd` | **日常就双击这个**：检查端口 → 起 NapCat（快速登录）→ 起桥接 |
| `start-bot.cmd` | 只启动桥接（NapCat 已在跑时用） |
| `setup.ps1` | 一键安装：建 profile、生成人格、写配置、自测 |
| `bridge.mjs` | 桥接服务：OneBot ↔ DSH（无第三方依赖） |
| `config.json` | 连接、触发、限额配置 |
| `persona.md` | 人格模板（首次安装时复制到 `~/.dsh/persona/qq.md`） |
| `sandbox/AGENTS.md` | QQ 场景规则（纯文本、字数、不许 @） |
| `编辑人格.cmd` | 打开人格文件 |
| `_test/mock-onebot.mjs` | 本地联调用的假 OneBot 服务器（不连 QQ 也能验链路） |
| `_test/onebot-query.mjs` | 查机器人账号的好友/群列表 |
| `_test/send-test.mjs` | 从机器人发一条测试消息 |
| `state.json` | 每个用户/群的会话 id（删掉 = 全员失忆） |
| `logs/` | 运行日志 |
| `napcat-qrcode.png` | 首次登录的二维码（已用过，可删） |

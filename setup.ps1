#requires -Version 5.1
<#
  一键安装：给 DSH 建一个专用的 qq profile（复用桌面端登录额度），
  并把人格文件、工作目录、桥接配置都准备好。

  用法：powershell -ExecutionPolicy Bypass -File setup.ps1
        加 -SkipTest 跳过最后的自测。
#>
param([switch]$SkipTest)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileName = 'qq'
$profileDir = Join-Path $dshHome "profiles\$profileName"
$personaPath = Join-Path $dshHome 'persona\qq.md'

function Write-Utf8([string]$path, [string]$text) {
  $dir = Split-Path -Parent $path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

function Read-Utf8([string]$path) {
  return [System.IO.File]::ReadAllText($path, $utf8NoBom)
}

Write-Host "== DSH QQ 机器人安装 ==" -ForegroundColor Cyan

# 1. Node 版本（桥接服务用内置 WebSocket，需要 22+）
$nodeVersion = (& node -v) 2>$null
if (-not $nodeVersion) { throw '找不到 node。请先安装 Node.js 22 或更新版本。' }
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw "Node 版本过低（$nodeVersion），需要 22 以上。" }
Write-Host "Node $nodeVersion  OK"

# 2. 找到 dsh 启动器
$dshCmd = (Get-Command dsh -ErrorAction SilentlyContinue).Source
if (-not $dshCmd) {
  # 常见安装位置兜底（不同机器不一样，找不到就报错让人填）
  $cands = @(
    "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd",
    "$env:ProgramFiles\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
  )
  foreach ($c in $cands) { if (-not $dshCmd -and (Test-Path $c)) { $dshCmd = $c } }
  if (-not $dshCmd) { throw '找不到 dsh 命令：请把 config.json 里的 dshCmd 改成你自己的 dsh.cmd 路径。' }
}
Write-Host "dsh: $dshCmd"

# 3. 建 profile（从官方 headless 模板复制，独立目录，不影响桌面端）
if (-not (Test-Path $profileDir)) {
  $template = Join-Path $dshHome 'profiles\headless'
  if (-not (Test-Path $template)) { throw "找不到 headless 模板：$template（先运行一次 dsh --profile headless --help）" }
  Copy-Item $template $profileDir -Recurse
  Write-Host "已创建 profile: $profileDir"
} else {
  Write-Host "profile 已存在，覆盖配置: $profileDir"
}

$pkgJson = @"
{
  "name": "dsh-profile-$profileName",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless"
      ]
    }
  }
}
"@
Write-Utf8 (Join-Path $profileDir 'package.json') $pkgJson

# 4. 人格文件（已存在则保留用户的修改）
if (-not (Test-Path $personaPath)) {
  Write-Utf8 $personaPath (Read-Utf8 (Join-Path $here 'persona.md'))
  Write-Host "已生成人格文件: $personaPath"
} else {
  Write-Host "人格文件已存在，保留现状: $personaPath"
}

# 5. profile 补丁：启用桌面端登录凭证 + 人格来自 persona 文件
$patch = @"
# 由 qq-bot/setup.ps1 生成：复用桌面端已登录的 DeepSeek 账号额度，
# 并把人格从 ~/.dsh/persona/qq.md 读进来（改人格不用改这里）。
- id: credentials
  disabled: false
- id: authorization
  disabled: false
- id: deepseek-account
  disabled: false
- id: agent-default-model
  config:
    provider: deepseek-account
    model: deepseek-flash
    reasoningEffort: high
- id: system-prompt
  config:
    personaPrefix: !!js process.getBuiltinModule('node:fs').readFileSync(dshHomePath('persona/qq.md'), 'utf8')
"@
Write-Utf8 (Join-Path $profileDir 'cordis.patch.yml') $patch

# 6. 工作目录（QQ 场景规则放在这里的 AGENTS.md）
$sandbox = Join-Path $here 'sandbox'
if (-not (Test-Path $sandbox)) { New-Item -ItemType Directory -Force $sandbox | Out-Null }
$agents = Join-Path $sandbox 'AGENTS.md'
if (-not (Test-Path $agents)) {
  Write-Utf8 $agents "# QQ 场景规则`n`n- 纯文本短句，不要 Markdown。`n- 默认 120 字以内。`n"
}

# 7. 更新 config.json 里的路径与 token（没有就从示例复制一份）
$cfgPath = Join-Path $here 'config.json'
if (-not (Test-Path $cfgPath)) {
  Copy-Item (Join-Path $here 'config.example.json') $cfgPath
  Write-Host "已从 config.example.json 生成 config.json"
}
$cfgText = Read-Utf8 $cfgPath
$cfgText = [regex]::Replace($cfgText, '"dshCmd"\s*:\s*"[^"]*"', '"dshCmd": "' + $dshCmd.Replace('\', '\\') + '"')
$cfgText = [regex]::Replace($cfgText, '"workspace"\s*:\s*"[^"]*"', '"workspace": "' + $sandbox.Replace('\', '\\') + '"')
if ($cfgText -match '"accessToken"\s*:\s*"(换成一个随机字符串[^"]*|改成你自己的 NapCat Token|)"') {
  $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.ToCharArray()
  $token = -join (1..24 | ForEach-Object { $chars | Get-Random })
  $cfgText = [regex]::Replace($cfgText, '"accessToken"\s*:\s*"[^"]*"', '"accessToken": "' + $token + '"')
  Write-Host "已生成访问 Token（填到 NapCat 的 WebSocket 服务里）：$token" -ForegroundColor Yellow
}
Write-Utf8 $cfgPath $cfgText

Write-Host ''
Write-Host '安装完成。' -ForegroundColor Green
Write-Host "人格文件：$personaPath"
Write-Host "工作目录：$sandbox"
Write-Host "启动机器人：$here\start-bot.cmd"

# 8. 自测（不连 QQ，直接验证 DSH + 人格链路）
if (-not $SkipTest) {
  Write-Host ''
  Write-Host '正在自测（会消耗一点额度）…' -ForegroundColor Cyan
  & node (Join-Path $here 'bridge.mjs') --once '你好，用一句话介绍一下你自己。'
  if ($LASTEXITCODE -ne 0) { Write-Host '自测失败，请看上面的输出。' -ForegroundColor Red }
}

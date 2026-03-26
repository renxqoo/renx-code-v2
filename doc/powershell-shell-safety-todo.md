# Shell Security TODO（后续处理）

## 背景

当前阶段先处理 PowerShell 噪音抑制问题：

- 统一为 PowerShell 命令注入静默进度/信息输出的前置设置
- 统一带 `-NoProfile`
- 统一带 `-NonInteractive`
- 保持 Windows 子进程 `windowsHide: true`
- 文档建议 Windows 用户优先使用 WSL，但不把 WSL 作为唯一方案

本文件用于记录**暂不处理、但必须后续补齐**的安全问题与治理方案，避免后续改动时遗漏风险。

## 当前已知安全问题

### 1. Shell 输出可能直接进入 LLM 上下文

问题：

- shell 工具的 `stdout` / `stderr` 会被捕获、缓存、展示，并可能进入模型上下文
- 如果命令输出包含密钥、Bearer Token、Cookie、连接串、私钥片段，这些内容就可能被直接暴露给模型与运行平台

影响：

- API Key、访问令牌、数据库连接串、内部 URL、会话 Cookie 可能泄露
- 构建日志、调试日志、HTTP 错误响应、CLI 报错都可能成为泄露源

常见触发场景：

- `curl` / `Invoke-RestMethod` 打印认证头或响应体
- `Get-ChildItem Env:`、`printenv`、`set`、`env` 直接输出环境变量
- `Get-Content .env`、`cat .env`、读取配置文件原文
- SDK/CLI 在错误信息中回显完整请求头或连接串

### 2. Shell 继承环境变量范围过大

问题：

- 如果 shell 执行默认继承整个 `process.env`，则子进程天然可访问大量敏感环境变量
- 即使命令本身不打算读取密钥，也可能在子进程、脚本、错误处理或第三方工具中被打印

影响：

- 最小暴露面失效
- 调试命令、依赖脚本、构建脚本更容易意外泄露敏感信息

### 3. 缺少统一的输出脱敏层

问题：

- 如果只在 UI 层遮罩，而不是在 shell 运行时、日志层、artifact 层统一脱敏，那么一旦敏感值进入原始输出，后续各层都可能复制与传播

影响：

- 同一份敏感数据可能同时出现在：
  - 对话上下文
  - shell artifact
  - 调试日志
  - 错误事件
  - 本地缓存文件

### 4. 原始输出与模型可见输出未分层

问题：

- 如果只有一个统一 `output` 字段，那么“为了排错保留原始输出”和“为了安全只给模型看净化结果”之间会发生冲突

影响：

- 要么排错能力不足
- 要么安全边界过弱
- 最终常常演化为“原始输出直接给模型”

### 5. 文件读取链路可能直接暴露 secrets

问题：

- 读取 `.env`、私有配置、认证文件、证书、token 缓存文件时，如果没有额外保护，内容会直接进入工具返回值

影响：

- 本地秘密配置被完整暴露
- 且这类暴露往往是“原文级别”的

## 后续目标方案

### 阶段 2：统一输出脱敏（高优先级）

目标：

- 在 shell 输出进入 UI / 对话 / 日志 / artifact 之前统一做 redaction

建议规则：

- 先做**精确值替换**：对当前运行时已知 secret 值逐个替换为占位符
- 再做**模式替换**：覆盖常见格式

建议覆盖项：

- `Authorization: Bearer ...`
- `Cookie:` / `Set-Cookie:`
- `api_key=...`
- `token=...`
- `secret=...`
- `password=...`
- URL 中的用户密码段
- `.env` / `KEY=value` 风格配置
- 常见云厂商、AI 平台、Git 平台 token 前缀

输出形式建议：

- `<redacted>`
- `<redacted:OPENAI_API_KEY>`
- `<redacted:Authorization>`

### 阶段 3：最小环境变量传递（高优先级）

目标：

- 默认不再把完整 `process.env` 透传给子进程
- 改为白名单传递

建议默认白名单：

- `PATH`
- `SystemRoot`
- `ComSpec`
- `PATHEXT`
- `HOME` / `USERPROFILE`
- `TMP` / `TEMP`
- `LANG` / `LC_ALL`（如需要）

扩展机制：

- 对确需认证的命令，显式声明允许传入哪些 env key
- 在工具层或策略层记录“允许的敏感环境变量名单”

### 阶段 4：原始输出与模型输出分离（高优先级）

目标：

- 把 shell 结果拆成两层

建议结构：

- `raw_output`：仅本地保存，不默认进入模型上下文
- `display_output` / `model_output`：经过控制字符清洗、脱敏、截断后的输出

建议行为：

- 默认只把 `model_output` 提供给模型
- 只有用户显式要求查看原始输出时，才按受控方式显示 `raw_output`
- artifact 元数据中明确区分“是否经过脱敏”

### 阶段 5：敏感文件读取保护（中高优先级）

目标：

- 对 `.env`、认证配置、密钥文件、证书、token 缓存文件建立单独策略

建议做法：

- 默认拒绝或要求显式确认
- 支持“只显示键名/结构，不显示值”
- 支持自动脱敏预览

### 阶段 6：日志治理（中优先级）

目标：

- 禁止在 debug / error / trace 日志中直接写入未脱敏的 shell 原始输出、HTTP 头、认证信息

建议做法：

- 日志统一经过 redaction
- 结构化日志字段拆分：`message`、`redactedFields`、`containsSensitiveData`
- 对高风险字段做白名单记录，而不是黑名单过滤

## 实施顺序建议

1. PowerShell 噪音抑制（当前阶段）
2. shell 输出统一脱敏
3. 最小环境变量传递
4. 原始输出与模型输出分层
5. 敏感文件读取保护
6. 日志治理与审计

## 验收建议

### PowerShell 噪音抑制阶段

- PowerShell 调用统一包含：
  - `-NoProfile`
  - `-NonInteractive`
  - `windowsHide: true`
- PowerShell 实际执行脚本统一前置：
  - `$ProgressPreference='SilentlyContinue'`
  - `$InformationPreference='SilentlyContinue'`
  - `$ErrorActionPreference='Stop'`
- Windows 文档说明：
  - 推荐 WSL
  - 但 PowerShell 仍是受支持方案

### 安全治理阶段

- shell 输出进入模型前默认完成脱敏
- `.env` 与认证文件读取默认受限
- 非必要环境变量不传递给子进程
- 原始输出不默认进入模型上下文
- 日志中不出现未脱敏 secret

## 备注

本文件是后续安全治理的代办与设计草案。当前提交不实现上述安全能力，只记录问题与后续改造方向，避免 PowerShell 噪音修复完成后遗忘安全收口工作。

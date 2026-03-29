# renx-code-v2

`renx-code-v2` 是一个基于 `pnpm workspace` 的多包仓库，当前包含：

- `packages/core`：核心 agent/runtime/tool-v2 能力
- `packages/cli`：CLI 入口与交互层（包名 `@renxqoo/renx-code`，命令 `renx`）

## 环境要求

- Node.js `>=20`
- pnpm `10.x`（仓库声明：`pnpm@10.17.0`）

## 快速开始

```bash
pnpm install
```

D:\work\renx-code\image.png 看图片多个agent执行，ui样式并不是D:\work\renx-code\packages\cli\doc\subagent-ui-redesign.md草图画的样，都是tool runing
常用开发命令（在仓库根目录执行）：exec_cli_1774643299299... opentui-1774633941371

```bash
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run ci:check
```

## CI 约定（必须通过）

本项目将 `ci:check` 作为统一 CI 校验入口：

```bash
pnpm run ci:check
```

其顺序为：

1. `format:check`
2. `typecheck`
3. `lint`
4. `test`

> 所有代码在 commit 前必须保证上述检查通过。

仓库启用了 `husky` 的 `pre-commit` 钩子：

- 执行 `git commit` 时会先运行 `pnpm lint-staged`
- 然后自动触发 `ci:check`
- 任一环节失败都会阻止提交
- `pre-push` 不再承载本地 CI 校验
- 仓库流程不允许使用 `--no-verify` 跳过校验；如需真正强制约束，应结合远端必过检查或分支保护

## CLI 使用

`packages/cli` 提供命令 `renx`。

常见用法：

```bash
renx
renx run "为当前项目生成测试计划"
renx ask "这个错误是什么意思"
renx run "修复 lint 报错" --session-id my-session --model minimax-2.7
renx session list
renx session show --id my-session
renx session open --id my-session
```

常用选项：

- `--session-id <id>`：复用现有会话 ID
- `--model <model>`：覆盖默认模型
- `--cwd <path>`：切换工作目录后执行
- `--output text|json`：非交互模式输出格式
- `--json`：等价于 `--output json`
- `-y` / `--yes`：自动批准非交互模式下的工具确认/权限请求

行为说明：

- `renx`：默认进入交互式 TUI
- `renx run <prompt>`：执行任务型提示词，适合自动化调用
- `renx ask <prompt>`：执行问答型提示词，适合脚本集成
- `renx session list/show/open`：管理本地 SQLite 中保存的会话摘要与继续工作入口

## Monorepo 结构

```text
.
├─ packages/
│  ├─ core/   # @renx-code/core
│  └─ cli/    # @renxqoo/renx-code
├─ doc/       # 项目设计与规划文档
└─ README.md
```

## 常见问题

- `npm run ci` 报错 `Missing script: "ci"`
  - 根因：仓库定义的是 `ci:check` 而不是 `ci`
  - 使用：`pnpm run ci:check`

- Windows 下 PowerShell 不支持 `&&`
  - 建议直接执行 `pnpm run ci:check`
  - 或使用 PowerShell 串行语法（`; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`）
  - 如需更稳定的终端与文件系统体验，优先在 WSL 中运行；但 PowerShell 仍是受支持方案

- shell 运行产生缓存输出
  - 可能出现在临时目录或工作目录下 `.renx-cache/`
  - `.renx-cache/` 已加入 `.gitignore`

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

常用开发命令（在仓库根目录执行）：

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

> 所有代码在 push 前必须保证上述检查通过。

仓库启用了 `husky` 的 `pre-push` 钩子：

- 执行 `git push` 时会自动触发 `ci:check`
- 任一环节失败都会阻止推送

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

- shell 运行产生缓存输出
  - 可能出现在临时目录或工作目录下 `.renx-cache/`
  - `.renx-cache/` 已加入 `.gitignore`

# Multi-Platform Binary Release Plan

## Goal

将 `renx` 的正式发布模型收敛为“多平台可执行二进制 + 最小资源包”，避免正式用户依赖 Bun、Node、源码工作区结构或 npm postinstall 逻辑。

目标平台：

- macOS arm64
- macOS x64
- Linux x64
- Linux arm64
- Windows x64
- 视后续需求补充 Windows arm64

本方案的核心原则：

- 正式发布物以二进制为中心，不以源码为中心。
- 正式运行路径只有一条，不保留发布态回退链。
- 开发态与发布态分离：开发态可继续使用 Bun + workspace，发布态不可依赖 workspace。
- 根命令 `renx` 默认进入 TUI。
- 非 TUI 命令必须可在不加载 TUI 依赖图的前提下独立运行。

## Current State Summary

当前代码已经具备部分发布基础，但仍属于“开发优先”的启动结构，不适合作为最终发行模型。

### Observed Facts

1. CLI 目前通过 `bin/renx.cjs` 做多层回退：
   - 优先找本地二进制
   - 再尝试运行 `dist/index.js`
   - 再尝试用 Bun 运行 `src/index.tsx`

2. CLI 正式构建产物已经指向 `dist`：
   - `packages/cli/package.json` 的 `main` / `types` / `exports` 指向 `dist`
   - `packages/core/package.json` 的 `main` / `types` / `exports` 指向 `dist`

3. CLI 运行时仍然存在发布态不稳定因素：
   - `packages/cli/src/agent/runtime/source-modules.ts` 运行时动态定位 `packages/core/dist/index.js`
   - 这说明 CLI 发布态仍依赖工作区目录结构

4. CLI 当前仍保留 Bun 运行时假设：
   - `packages/cli/src/runtime/runtime-support.ts` 明确要求 Bun 运行时

5. Core 的 SQLite 运行时是双后端探测：
   - 先尝试 `node:sqlite`
   - 再尝试 `bun:sqlite`
   - 这在开发态可以接受，但在正式发行态必须明确收敛

6. 当前 ESM 构建产物仍需要 import path 规范化：
   - 已在 `cli` / `core` 增加 `fix-esm-imports.mjs`
   - 但这只是当前工程过渡措施，不应成为长期复杂发布策略的中心

## Target Release Model

### 1. Official Artifacts

每个平台发布一个独立压缩包，内部包含：

- 可执行文件 `renx` 或 `renx.exe`
- `vendor/` 资源目录
- 可选的 `README` / `LICENSE` / `checksums.txt`

建议产物命名：

```text
renx-darwin-arm64.tar.gz
renx-darwin-x64.tar.gz
renx-linux-x64.tar.gz
renx-linux-arm64.tar.gz
renx-windows-x64.zip
```

### 2. Runtime Contract

正式发布态满足以下约束：

- 用户机器不需要额外安装 Bun。
- 用户机器不需要克隆仓库。
- 用户机器不需要执行 `npm install`。
- `renx` 启动时不依赖 `packages/core/src` 或 `packages/core/dist` 的 workspace 相对路径。
- `renx --help` / `renx --version` / `renx session list` / `renx session show` 不应加载 TUI 依赖图。
- `renx` 默认进入 TUI。

### 3. Dev vs Release Separation

开发态：

- 继续使用 `pnpm dev`
- 继续允许 Bun 跑源码
- 继续允许 workspace 目录耦合

发布态：

- 只运行已编译产物或最终二进制
- 不依赖 workspace
- 不读取源码树
- 不通过 Bun 回退启动源码

## Architectural Decisions

### Decision A: Binary-First Distribution

正式用户入口统一为二进制。

原因：

- 降低用户安装成本
- 降低平台环境差异带来的不可控因素
- 让 runtime、资源定位、配置目录、数据库目录在发布态有唯一模型
- 倒逼 CLI/core 清理开发态耦合

### Decision B: Single Release Path

发布态保留唯一启动路径：

- 用户执行二进制
- 二进制加载本目录资源
- 进入 CLI 路由

不再保留：

- 发布态找源码入口
- 发布态寻找 Bun 再运行源码
- 发布态依赖本地 workspace 结构

### Decision C: Static Module Composition for Release

正式发布态中，CLI 需要静态依赖 core，而不是运行时按 repo 路径定位。

也就是说，发布态不能再依赖如下模型：

- `resolveRepoRoot()`
- 拼接 `packages/core/dist/index.js`
- 动态按仓库目录导入

发布态应该采用：

- 构建阶段完成依赖装配
- 运行阶段只做普通模块导入或直接链接进最终二进制

### Decision D: Non-TUI Commands Must Be TUI-Free

`help/version/run/ask/session list/show` 必须与 TUI 依赖图解耦。

要求：

- CLI 根入口按命令懒加载模块
- `session` 模块只在 `resume` 时才加载 TUI
- 非 TUI 命令不可因为 React/OpenTUI 或 terminal 主题初始化失败而受影响

### Decision E: Explicit SQLite Backend Policy

正式发布态必须明确 SQLite 后端策略，不能依赖“运行时探测到什么就用什么”。

推荐两种选择之一：

1. Bun-first：最终二进制内使用 Bun 运行时能力与 `bun:sqlite`
2. Node-first：彻底清理 Bun 依赖，仅保留 Node 兼容 SQLite 后端

基于当前代码现状，推荐先走：

- 开发阶段：Bun-first
- 发布阶段：优先评估 Bun 原生二进制打包

但无论选哪条，发布态都必须是单一明确后端。

## Required Refactors

### Phase 1: Release Boundary Cleanup

目标：先把“开发态耦合”从正式入口中剥离。

需要做的事：

1. 收敛 `bin/renx.cjs`
   - 开发态可保留 bootstrap
   - 但发布态入口应退化为极薄壳层，最好只负责调用同目录最终可执行文件

2. 清理 `packages/cli/src/agent/runtime/source-modules.ts`
   - 移除发布态对 workspace 路径的依赖
   - 替换为静态导入或发布期注入的固定入口

3. 收敛 `packages/cli/src/runtime/runtime-support.ts`
   - 明确它是开发时限制，还是正式产品限制
   - 若走二进制发布，不应让正式用户感知“必须自行安装 Bun”

4. 保证非 TUI 命令链路不加载 TUI
   - 入口按命令动态导入
   - `session resume` 才引入 `tui`

完成标准：

- `renx --help` 发布态可直接运行
- `renx --version` 发布态可直接运行
- `renx session list` 发布态不依赖 TUI
- 发布态不读取 workspace 的 `packages/*/src`

### Phase 2: Static Resource Model

目标：把所有外部资源都改成“发行物相对路径 + 用户目录”模型。

资源类别：

- bundled ripgrep
- 默认数据库文件
- 日志目录
- 技能目录
- 可能的模板或静态资源

要求：

1. 可执行文件旁边的资源目录位置固定
2. 用户数据目录固定，例如：
   - macOS: `~/Library/Application Support/renx`
   - Linux: `~/.local/share/renx` 或 XDG 目录
   - Windows: `%AppData%\\renx`
3. 日志、数据库、缓存不应写回安装目录
4. 不允许发布态依赖 repo root

完成标准：

- 删除对工作区相对路径的数据依赖
- 首次启动可自动创建数据库/日志目录
- 打包产物换目录后仍可运行

### Phase 3: Binary Packaging

目标：生成每个平台独立二进制。

需要做的事：

1. 明确打包器
   - 若走 Bun：使用 Bun 的单文件/二进制构建能力
   - 若走 Node：使用支持 ESM/资源打包的二进制打包方案

2. 明确入口
   - 发布入口必须是 `packages/cli/src/index.tsx` 对应的正式构建入口
   - 不是开发态 `bin/renx.cjs` 回退链

3. 明确资源打包策略
   - `vendor/ripgrep`
   - 主题/markdown 运行时所需资源
   - 可能的技能模板或默认文件

4. 生成平台矩阵构建脚本
   - 本地构建脚本
   - CI 构建脚本
   - 发布上传脚本

完成标准：

- 每个平台生成单独发行物
- 压缩包可在目标平台解压即用
- 用户环境中无需 Bun/Node/npm

### Phase 4: Release Verification Matrix

目标：给发行物建立强约束验收标准。

最小验收矩阵：

```bash
renx --help
renx --version
renx
renx --session-id demo-session
renx session list
renx session show --id missing --json
renx ask "hello" --json
renx run "hello" --json
```

平台专项检查：

- Windows 终端颜色与剪贴板
- macOS terminal/window theme 行为
- Linux 无 GUI 环境下的剪贴板降级
- bundled ripgrep 可用性
- 首次数据库创建与升级
- 日志目录权限

完成标准：

- 所有目标平台通过最小矩阵
- 带资源压缩包的冷启动可通过
- 不依赖仓库目录

## Packaging Layout Proposal

建议发行物目录结构：

```text
renx/
  renx                # 或 renx.exe
  vendor/
    ripgrep/
      <target>/path/rg[.exe]
  README.md
  LICENSE
```

运行时写入用户目录：

```text
<user-data-dir>/
  renx.db
  logs/
  cache/
  skills/
  tasks/
```

## CI/CD Proposal

### Build Stages

1. 安装依赖
2. 构建 `packages/core`
3. 构建 `packages/cli`
4. 打包平台二进制
5. 注入版本号与校验信息
6. 组装压缩包
7. 运行 smoke tests
8. 上传 Release Artifacts

### Release Artifacts

每个 Release 至少输出：

- 平台压缩包
- `SHA256SUMS`
- 版本说明

### Smoke Tests

CI 中至少跑：

- `--help`
- `--version`
- `session list --json`
- `ask` 的最小 dry/smoke 场景

## Concrete File Impact List

后续实施时优先改这些文件：

### CLI Package

- `packages/cli/bin/renx.cjs`
- `packages/cli/src/index.tsx`
- `packages/cli/src/agent/runtime/source-modules.ts`
- `packages/cli/src/runtime/runtime-support.ts`
- `packages/cli/src/commands/session.ts`
- `packages/cli/package.json`
- `packages/cli/scripts/*`

### Core Package

- `packages/core/src/index.ts`
- `packages/core/src/agent/app/sqlite-client.ts`
- `packages/core/package.json`
- `packages/core/scripts/*`

## Risks

### Risk 1: Workspace Coupling

当前 CLI/core 的运行时装配仍然能看到 workspace 结构。若不先剥离，二进制发布会持续出现路径问题。

### Risk 2: ESM Output Instability

当前 TypeScript ESM 输出需要额外修正 import path。若不建立统一策略，发布物会不稳定。

### Risk 3: Bun/Node Runtime Ambiguity

若继续同时把 Bun 和 Node 都视为正式运行时，会导致：

- SQLite backend 不一致
- 调试与用户行为不一致
- 平台问题难以复现

### Risk 4: TUI Dependency Pollution

若 `session/list/show/help/version` 继续被 TUI 依赖污染，发布稳定性会很差。

### Risk 5: Resource Discovery Complexity

bundled ripgrep、数据库目录、技能目录如果仍以“多层 fallback”处理，会重新引入发布态兼容分支。

## Recommended Execution Order

建议按以下顺序推进：

1. 先收敛 CLI/core 发布边界
2. 再收敛资源目录与用户数据目录
3. 再选择并实现二进制打包器
4. 再补平台矩阵 CI
5. 最后替换掉当前发布 bootstrap

不要反过来直接先打二进制，否则只是把现在的问题封装进另一个壳里。

## Short-Term Acceptance Criteria

当以下条件全部满足时，才算进入“可试发布”阶段：

- `renx` 默认进入 TUI
- `renx --help`、`renx --version` 可直接运行
- `renx session list/show` 在非 TUI 路径可稳定运行
- 发布态不依赖源码树
- 发布态不要求用户安装 Bun
- 打包产物换目录后仍可运行

## Final Recommendation

正式发布建议改成：

- 多平台可执行二进制为主
- 开发态保留 Bun + workspace
- 发布态只保留单一路径
- 非 TUI 命令与 TUI 依赖彻底解耦
- 明确唯一 SQLite/backend 策略

这条路线的价值不只是“安装更方便”，更重要的是它会迫使 CLI 与 core 的运行时边界稳定下来，从而让 `renx` 真正具备可发布、可维护、可扩展的基础。

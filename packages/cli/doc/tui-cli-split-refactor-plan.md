# Renx `TUI/CLI` 拆层与重命名方案（V1）

- 日期：2026-03-16
- 分支：`refactor/tui-cli-split`
- 适用范围：`packages/cli`、`packages/core`（后续新增 `packages/tui`）

## 1. 背景与目标

当前 `packages/cli` 实际承担的是**全屏交互终端应用（TUI App）**，同时又承担了命令入口职责，导致产品语义与工程边界混淆。

本方案目标：

1. 将“全屏交互宿主”与“命令分发入口”彻底拆层。
2. 保持 `packages/core` 为 UI/终端框架无关的能力层。
3. 提供兼容迁移路径，先不打断现有功能，再逐步引入 `run/ask/session/config/doctor`。

## 2. 目标分层（一次到位的命名）

### 2.1 `packages/tui`

负责交互式终端应用（OpenTUI + React）：

- 启动与渲染生命周期
- Chat 面板、输入框、模型选择、文件选择、确认弹窗
- Agent 事件到 UI 的展示映射
- 会话内交互状态（流式回复、中断、工具确认）

### 2.2 `packages/cli`

负责真正的命令行入口（command dispatcher）：

- 参数解析、子命令路由
- `renx` 默认行为决策（默认进入 `tui`）
- `run/ask/session/config/doctor` 等非交互命令
- 对 `packages/tui` 与 `packages/core` 的装配调用

### 2.3 `packages/core`

保持能力层，不承担 TUI/CLI 呈现：

- Agent、Tool v2、Runtime 组合能力
- AppService / Store / Provider / Config
- 可被 `tui` 与 `cli` 复用的执行与会话服务

## 3. 命令树设计（V1）

```text
renx                          # 默认进入 TUI（等价 renx tui）
renx tui [--session-id <id>] [--conversation-id <id>]

renx run <prompt> [--model <id>] [--json] [--cwd <path>] [--max-steps <n>]
renx ask <question> [--model <id>] [--json]                # run 的语义化别名

renx session list [--json]
renx session show --id <id> [--json]
renx session resume --id <id>                               # 打开到 tui 或继续 run

renx config get <key>
renx config set <key> <value>
renx config list [--json]

renx doctor [--json]
renx --help
renx --version
```

约束：

- `renx` 无参数默认进入 TUI。
- `run/ask` 必须支持非交互（stdout/json）输出。
- `session/config/doctor` 均走标准 CLI 子命令形态。

## 4. 现有代码归属映射（第一版）

| 现有路径 | 目标归属 | 动作 | 说明 |
|---|---|---|---|
| `packages/cli/src/index.tsx` | `packages/tui/src/index.tsx` | 移动 | TUI 启动入口 |
| `packages/cli/src/App.tsx` | `packages/tui/src/App.tsx` | 移动 | 纯交互 UI 组合 |
| `packages/cli/src/components/*` | `packages/tui/src/components/*` | 移动 | 全部为 UI 组件 |
| `packages/cli/src/hooks/*` | `packages/tui/src/hooks/*` | 移动 | UI 状态与事件编排 |
| `packages/cli/src/ui/*` | `packages/tui/src/ui/*` | 移动 | 主题/markdown 渲染 |
| `packages/cli/src/runtime/exit.ts` | `packages/tui/src/runtime/exit.ts` | 移动 | 终端清理 + 退出 |
| `packages/cli/src/runtime/terminal-theme.ts` | `packages/tui/src/runtime/terminal-theme.ts` | 移动 | 终端主题探测 |
| `packages/cli/src/runtime/clipboard.ts` | `packages/tui/src/runtime/clipboard.ts` | 移动 | TUI 交互相关 |
| `packages/cli/src/files/*` | `packages/tui/src/files/*` | 移动 | 交互态附件能力 |
| `packages/cli/src/commands/slash-commands.ts` | `packages/tui/src/commands/slash-commands.ts` | 移动 | TUI 内部斜杠命令 |
| `packages/cli/src/agent/runtime/types.ts` | `packages/tui/src/agent/runtime/types.ts` | 移动 | UI 事件类型 |
| `packages/cli/src/agent/runtime/event-format.ts` | `packages/tui/src/agent/runtime/event-format.ts` | 移动 | 事件展示格式化 |
| `packages/cli/src/agent/runtime/tool-call-buffer.ts` | `packages/tui/src/agent/runtime/tool-call-buffer.ts` | 移动 | UI 展示顺序控制 |
| `packages/cli/src/agent/runtime/tool-confirmation.ts` | `packages/tui/src/agent/runtime/tool-confirmation.ts` | 移动 | UI 交互确认决策 |
| `packages/cli/src/agent/runtime/runtime.ts` | `packages/tui/src/agent/runtime/*` + `packages/core/src/agent/app/*` | 拆分 | 见第 5 节 |
| `packages/cli/src/agent/runtime/source-modules.ts` | `packages/core`（新增导出）或 `packages/tui/src/agent/runtime/source-modules.ts`（过渡） | 先保留后下沉 | 现为动态桥接层，后续应减少对源码路径耦合 |
| `packages/cli/src/runtime/cli-args.ts` | `packages/cli/src/commands/shared/flags.ts` | 重写 | 从“全局环境注入”升级为子命令解析 |
| `packages/cli/bin/renx.cjs` | `packages/cli/bin/renx.cjs` | 保留并重写 | 只做 CLI 分发，不直连 TUI 源码入口 |

## 5. `runtime.ts` 拆分建议（重点）

目标文件：`packages/cli/src/agent/runtime/runtime.ts`

### 5.1 归 `packages/tui` 的部分

1. **会话长生命周期管理**：`runtimePromise`、`activeExecution`、`runAgentPrompt`、`appendAgentPrompt`。
2. **UI 事件转换**：`toTextDeltaEvent`、`toToolStreamEvent`、`toToolResultEvent`、`toStepEvent`、`toLoopEvent`。
3. **工具确认与权限交互桥接**：`onToolConfirm`、`onToolPermission` 与 UI 回调联动。
4. **模型显示态查询**：`getAgentModelLabel`、附件能力查询（用于 UI 展示）。

### 5.2 归 `packages/cli`（命令层）的部分

1. **命令参数到执行配置的映射**（从 argv 得到 model/maxSteps/json/output）。
2. **非交互输出策略**（text/json、exit code 约定、错误格式）。
3. **子命令路由与失败码标准化**。

### 5.3 建议下沉 `packages/core` 的部分

1. `createRuntime` 中“Agent + AppService + ToolSystem + Store”装配流程，沉成可复用 facade（例如 `createAgentApplicationRuntime`）。
2. 以 `core` 暴露稳定 API，避免 `tui/cli` 通过 `source-modules.ts` 动态 import 源码路径。
3. 模型选择/校验与 `ProviderRegistry` 对接，形成统一服务（TUI 与 CLI 共用）。

## 6. 实施阶段（平滑迁移）

### Phase 0：设计冻结（当前）

- 产出本方案文档。
- 锁定命名与边界，不改行为。

### Phase 1：包骨架与入口分离

1. 新建 `packages/tui`（先复制现有 `packages/cli` 的交互代码）。
2. `packages/cli` 改造成命令分发层，先仅支持：
   - `renx` -> `renx tui`
   - `renx tui`
   - `renx --help` / `renx --version`
3. 保持 `bin/renx.cjs` 对外命令名不变。

验收：现有 TUI 功能与测试不回退。

### Phase 2：`run/ask` 非交互落地

1. 新增 `renx run`、`renx ask` 命令。
2. 复用 core app service，输出 text/json。
3. 明确 exit code：
   - `0` 成功
   - `1` 业务/执行失败
   - `2` 参数错误

验收：可在 CI 里无 TTY 运行。

### Phase 3：会话与配置命令

1. `renx session list/show/resume`
2. `renx config get/set/list`
3. `renx doctor`

验收：命令层与 TUI 层无循环依赖。

### Phase 4：技术债清理

1. 下沉 runtime 装配到 core，收敛 `source-modules.ts`。
2. 统一日志、错误模型、可观测字段。
3. 更新文档与发布说明。

## 7. 目录草图（目标形态）

```text
packages/
  core/
    src/
      agent/
      providers/
      config/

  tui/
    bin/
    src/
      index.tsx
      App.tsx
      agent/runtime/
      components/
      hooks/
      runtime/
      ui/
      files/

  cli/
    bin/renx.cjs
    src/
      index.ts
      commands/
        tui.ts
        run.ts
        ask.ts
        session.ts
        config.ts
        doctor.ts
      shared/
        flags.ts
        output.ts
        errors.ts
```

## 8. 兼容与发布策略

1. 对外命令名 `renx` 不变。
2. 第一个拆层版本保持默认行为不变：`renx` 仍进入交互界面。
3. 引入子命令后，旧参数（如 `--conversationId`）通过兼容层映射到新参数（并给出 deprecate 提示）。
4. 若 npm 包名需要调整，先在 workspace 内部完成拆层，再评估发布名迁移，避免与结构重构同批次叠加风险。

## 9. 风险与缓解

1. **风险：入口改造影响现有启动链路。**
   - 缓解：先做 `renx -> tui` 透传，保持现有 TUI 启动代码不变。
2. **风险：runtime 拆分导致事件回归。**
   - 缓解：保留现有 `src/agent/runtime/*` 测试并迁移到 `packages/tui` 原样执行。
3. **风险：core 依赖边界不清，继续反向依赖 UI。**
   - 缓解：新增 lint/tsconfig 约束，禁止 `core` 引入 `@opentui/*`。

## 10. 下一步执行清单（实现阶段）

1. 新建 `packages/tui` 包并迁移 TUI 代码。
2. 改造 `packages/cli` 为命令分发层，先落 `tui/help/version`。
3. 调整 workspace scripts 与 CI（build/typecheck/test）。
4. 迁移并修复测试。
5. 再落地 `run/ask/session/config/doctor`。

# CLI Command Implementation Plan

## Goal

在 `packages/cli` 内实现企业级、可扩展、无兼容性分支的命令体系，统一 `renx` CLI 的入口、命令分发、非交互执行、会话查询与 TUI 启动方式。

本次实施的目标命令：

```bash
renx
renx --session-id session-01
renx run "帮我写一个界面"
renx ask "这个报错什么意思"
renx session --id session-01
renx session list
renx session show --id session-01
renx session resume --id session-01
renx --help
renx --version
```

## Design Principles

- 单一入口：所有命令统一从 `src/index.tsx` 进入。
- 明确分层：入口分发、命令实现、共享运行时、TUI 启动彼此隔离。
- 无兼容性代码：不保留旧命令兼容分支、不保留历史兜底解析逻辑。
- 面向扩展：后续新增 `config`、`doctor`、`agent`、`workspace` 等命令时，只需新增命令模块并注册。
- 非交互命令与 TUI 解耦：`run` / `ask` / `session` 不依赖 React/TUI 生命周期。
- 会话模型统一：CLI 的 session 统一映射到 agent 的 `conversationId`。

## Final Command Contract

### 1. Root Command

- `renx`
  - 默认进入 TUI。
- `renx --help`
  - 输出全局帮助。
- `renx --version`
  - 输出版本号。

### 2. TUI Entry

- `renx`
  - 启动 TUI。
- `renx --session-id <id>`
  - 使用指定会话进入 TUI。
- `renx --conversation-id <id>`
  - 与 `--session-id` 同义，但文档主推 `--session-id`。

### 3. Ask Command

- `renx ask <question>`
  - 一次性问答模式。
  - 默认更保守：不自动批准需要审批的工具、不自动授权额外权限。
  - 适用于报错解释、概念咨询、代码理解、方案建议。

支持参数：

- `--model <id>`
- `--session-id <id>`
- `--conversation-id <id>`
- `--json`
- `--max-steps <n>`

### 4. Run Command

- `renx run <prompt>`
  - 一次性执行模式。
  - 默认自动批准工具审批与请求权限，以满足“直接执行任务”的预期。

支持参数：

- `--model <id>`
- `--session-id <id>`
- `--conversation-id <id>`
- `--json`
- `--max-steps <n>`
- `--require-approval`

规则：

- 默认自动批准。
- 显式传入 `--require-approval` 后，改为拒绝需要人工审批的工具/权限请求。

### 5. Session Command

- `renx session list`
  - 列出会话摘要。
- `renx session show --id <conversation-id|execution-id>`
  - 查看指定会话或某次执行详情。
- `renx session resume --id <conversation-id>`
  - 恢复指定会话并进入 TUI。
- `renx session --id <conversation-id>`
  - `resume --id` 的快捷形式。

支持参数：

- `session list`
  - `--limit <n>`
  - `--conversation-id <id>`
  - `--status <csv>`
  - `--cursor <cursor>`
  - `--json`
- `session show`
  - `--id <id>`
  - `--limit <n>`
  - `--json`

## Architecture

## Layer 1: Entry Router

职责：

- 读取 `process.argv`
- 解析根命令
- 构造统一 `CommandContext`
- 路由到具体命令
- 统一处理 stdout / stderr / exit code

文件：

- `src/index.tsx`

## Layer 2: Command Modules

职责：

- 实现具体命令语义
- 只关心自身参数与输出
- 不直接操心底层模型/工具系统初始化细节

文件：

- `src/commands/help.ts`
- `src/commands/ask.ts`
- `src/commands/run.ts`
- `src/commands/session.ts`
- `src/commands/tui.tsx`

## Layer 3: Shared Infrastructure

职责：

- 通用 argv 解析
- 错误类型
- 输出格式化
- 版本解析
- 子进程/Bun 检测
- 共享 agent runtime

文件：

- `src/shared/types.ts`
- `src/shared/errors.ts`
- `src/shared/argv.ts`
- `src/shared/output.ts`
- `src/shared/process.ts`
- `src/shared/version.ts`
- `src/shared/runtime.ts`

## Layer 4: Agent/TUI Runtime

职责：

- TUI 模式下的长生命周期 agent 聊天体验
- 非交互命令复用 core agent runtime 能力

已存在文件：

- `src/agent/runtime/runtime.ts`
- `src/hooks/use-agent-chat.ts`
- `src/App.tsx`

## Data Model

### CommandContext

```ts
export type CommandContext = {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  repoRoot: string;
  cliVersion: string;
};
```

### CommandResult

```ts
export type CommandResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
};
```

### Shared Runtime Contract

```ts
export type SharedRuntime = {
  modules: SourceModules;
  workspaceRoot: string;
  conversationId: string;
  modelId: string;
  modelLabel: string;
  maxSteps: number;
  toolSchemas: ToolSchemaLike[];
  agent: StatelessAgentLike;
  appService: AgentAppServiceLike;
  appStore: AgentAppStoreLike;
  dispose: () => Promise<void>;
};
```

## Runtime Strategy

### TUI Runtime

- 继续使用现有 `src/agent/runtime/runtime.ts` 驱动交互式聊天。
- 根命令在没有显式子命令时直接启动 UI。

### Non-Interactive Runtime

新增 `src/shared/runtime.ts`：

- 每次命令调用独立创建 runtime。
- 每次命令结束后释放 store/logger。
- 复用 core 的：
  - `ProviderRegistry`
  - `createEnterpriseAgentAppService`
  - `createSqliteAgentAppStore`
  - `listAvailableSkills`
  - `buildSystemPrompt`

### Why Separate Runtime

原因：

- TUI 是单例长生命周期模式。
- `run` / `ask` / `session` 是短生命周期命令模式。
- 若复用 TUI 单例 runtime，会引入状态污染、并发混乱、命令生命周期不可控问题。

## Session Model

本项目统一采用：

- `session id` === `conversationId`

对应关系：

- 一次 `run` / `ask` 执行，产生一个 `executionId`
- 多次执行可归属于同一个 `conversationId`
- `session list` 以 `conversationId` 聚合
- `session show --id` 同时支持：
  - `conversationId`
  - `executionId`
- `session resume --id` 只接受 `conversationId`

## Output Contract

### Text Output

- `ask` / `run`
  - 输出 conversation、execution、model、assistant 文本、usage
- `session list`
  - 输出 session 摘要列表
- `session show`
  - 输出 run 或 conversation 详情

### JSON Output

所有 `--json` 输出必须：

- 合法 JSON
- 带结尾换行
- 字段结构稳定

### Error Output

- 参数错误：`CliUsageError`
- runtime 错误：普通 `Error`
- 所有错误通过统一入口转换为：
  - text: `stderr`
  - json: `stdout` JSON 错误对象

## File Plan

### New Files

- `doc/cli-command-implementation.md`
- `src/shared/types.ts`
- `src/shared/errors.ts`
- `src/shared/argv.ts`
- `src/shared/output.ts`
- `src/shared/process.ts`
- `src/shared/version.ts`
- `src/shared/runtime.ts`
- `src/commands/help.ts`
- `src/commands/run.ts`
- `src/commands/ask.ts`
- `src/commands/session.ts`
- `src/commands/tui.tsx`

### Modified Files

- `src/index.tsx`
- `src/runtime/cli-args.ts`
- `src/runtime/cli-args.test.ts`
- `package.json`
- `bin/renx.cjs`

## Implementation Steps

### Phase 1: Entry Router

1. 在 `src/index.tsx` 中删除“启动即进入 TUI”的直接流程。
2. 引入统一命令路由。
3. 根命令分发到 `help` / `version` / `run` / `ask` / `session`，默认无子命令时进入 TUI。
4. 建立统一错误处理和退出码策略。

完成标准：

- `renx --help` 可用
- `renx --version` 可用
- `renx` 默认进 TUI
- `renx --session-id <id>` 可恢复指定会话

### Phase 2: Shared Runtime

1. 新建 `src/shared/runtime.ts`
2. 复用 core agent 能力创建非交互 runtime
3. 支持一次性 `runPromptOnce(...)`
4. 支持自动审批策略
5. 支持会话历史加载与技能 bootstrap

完成标准：

- `run` / `ask` 能独立执行
- 执行后 runtime 能释放
- conversation 历史可以复用

### Phase 3: Prompt Commands

1. 实现 `run`
2. 实现 `ask`
3. 抽象共用 prompt command executor
4. 统一文本输出和 JSON 输出

完成标准：

- `renx run "..."` 可执行
- `renx ask "..."` 可执行
- `--json` 生效
- `--model` / `--max-steps` / `--session-id` 生效

### Phase 4: Session Commands

1. 实现 `session list`
2. 实现 `session show`
3. 实现 `session resume`
4. 实现 `session --id` alias

完成标准：

- `renx session list` 输出有效 session 列表
- `renx session show --id ...` 输出详情
- `renx session resume --id ...` 可进入 TUI

### Phase 5: Packaging Cleanup

1. `package.json` 指向 `dist`
2. `bin/renx.cjs` 优先执行 `dist/index.js`
3. 若 `dist` 不存在，仅在开发环境回退到 Bun 跑 `src/index.tsx`

完成标准：

- 构建后可直接通过 Node 运行 dist 产物
- 开发期仍可运行源码入口

## Testing Plan

### Unit Tests

- `src/runtime/cli-args.test.ts`
  - 解析 `--session-id`
  - 解析 `--conversation-id`
  - 缺失值报错
- 新增命令解析测试
  - `parseArgv`
  - `run` 参数提取
  - `session` 参数提取

### Integration-Oriented Checks

构建后人工/脚本验证：

```bash
renx --help
renx --version
renx session list --json
renx ask "hello" --json
renx run "hello" --json
```

### Type Checks

```bash
pnpm run typecheck
pnpm run build
pnpm run test:run:vitest
```

## Acceptance Criteria

必须满足：

- 命令入口统一
- 无历史兼容命令分支
- `run` / `ask` / `session` / `help` 全部在 `src` 有真实源码
- 不依赖旧 `dist` 中遗留命令源码
- TUI 与非交互命令分层明确
- 会话能力使用统一 `conversationId` 模型
- 构建后 `dist` 可作为正式运行入口

## Out of Scope

本轮不做：

- `config` 命令
- `doctor` 命令
- shell completion
- 命令遥测/埋点
- 多工作区 session 合并视图
- 远程 session 同步

## Risks

- `dist` 当前存在旧产物，不能作为源码事实来源，只能用于参考实现思路。
- 现有 TUI runtime 与非交互 runtime 为两套生命周期模型，实施时需严格避免共享单例状态。
- `run` 默认自动审批是效率优先策略，需在文档和帮助文本中明示。

## Decision Summary

最终采用：

- `renx` 默认进入 TUI，并承担唯一 TUI 入口
- `renx session --id <id>` = `renx session resume --id <id>`
- `session id` 统一等于 `conversationId`
- `ask` 为保守的一次性问答
- `run` 为激进的一次性执行
- `src` 为唯一真实实现来源

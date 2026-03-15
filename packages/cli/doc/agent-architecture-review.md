# Agent 逻辑与代码架构评审报告

- 评审日期：2026-03-15
- 评审范围：`src/agent/runtime/*`、`src/hooks/use-agent-chat.ts`、`src/hooks/agent-event-handlers.ts`
- 评审目标：判断当前 agent 逻辑与架构是否合理，是否符合企业级基础能力（安全、可靠性、可维护性、可扩展性、可观测性、测试完备性）。

## 总体结论

当前架构方向正确、模块边界清晰，具备工程化基础；但按企业级基线衡量，结论为：**部分符合（可用但未达标）**。

主要短板集中在：

1. 安全默认策略过宽（默认放行工具确认）。
2. 运行治理策略偏松（默认步数/重试次数过高）。
3. 可观测性不足（部分异常被吞掉，无显式日志/指标）。

## 架构优点

1. **主流程集中，职责清晰**：运行时初始化、模型解析、工具注册、事件分发、结果归并都集中在 `runAgentPrompt` 主链路中，便于追踪和维护。  
   证据：`src/agent/runtime/runtime.ts:355`、`src/agent/runtime/runtime.ts:485`

2. **依赖注入设计较好**：通过 source modules 对核心依赖做抽象，有利于测试替身与未来替换。  
   证据：`src/agent/runtime/source-modules.ts:129`、`src/agent/runtime/source-modules.ts:201`

3. **事件与 UI 解耦**：事件格式化与 UI handler 分层明确，减少展示层对底层协议的直接耦合。  
   证据：`src/agent/runtime/event-format.ts:194`、`src/hooks/agent-event-handlers.ts:37`

4. **工具调用顺序控制有设计**：`ToolCallBuffer` 避免工具调用显示乱序。  
   证据：`src/agent/runtime/tool-call-buffer.ts:8`

## 主要问题（按严重级别）

### 高：安全默认策略不满足最小权限原则

1. 未注册确认回调时默认 `approved: true`，意味着在 UI 未挂载确认机制时仍可能放行工具执行。  
   证据：`src/agent/runtime/tool-confirmation.ts:3`、`src/agent/runtime/tool-confirmation.ts:10`

2. `BashTool` 注册未体现目录级约束（与文件类工具策略不一致），策略面偏宽。  
   证据：`src/agent/runtime/tool-catalog.ts:25`

**影响**：企业环境下存在越权执行和误操作风险，难以通过严格安全审计。

### 中：初始化并发控制实现可用但不稳健

通过 `initializing + while + setTimeout(10ms)` 轮询等待初始化完成，属于“能工作但不优雅”的实现。  
证据：`src/agent/runtime/runtime.ts:447`、`src/agent/runtime/runtime.ts:449`

**影响**：高并发或异常场景中，可诊断性、稳定性和后续维护成本较高。

### 中：回调异常静默吞掉，降低可观测性

`safeInvoke` 捕获异常后不记录日志、不计数、不上报。  
证据：`src/agent/runtime/runtime.ts:148`、`src/agent/runtime/runtime.ts:154`

**影响**：线上问题定位困难，尤其是 UI 回调链路故障。

### 中：默认运行治理参数偏激进

- `DEFAULT_MAX_STEPS = 10000`
- `DEFAULT_MAX_RETRY_COUNT = 10`  
  证据：`src/agent/runtime/runtime.ts:77`、`src/agent/runtime/runtime.ts:78`

**影响**：在大规模使用时，易引发 token/cost/时延失控。

### 低：Hook 关键流程测试覆盖不足

`useAgentChat` 当前测试主要覆盖基础状态和输入处理，缺少 tool confirm、取消中断、并发请求切换等关键场景。  
证据：`src/hooks/use-agent-chat.test.ts:42`、`src/hooks/use-agent-chat.test.ts:56`、`src/hooks/use-agent-chat.test.ts:70`

## 企业级改进建议（优先级）

### P0（必须）

1. 工具确认默认改为 deny（显式授权才执行）。
2. 对 `bash` 建立命令策略（白名单/黑名单/审批门槛/审计）。
3. 增加安全审计日志：记录 tool name、参数摘要、审批人、决策结果。

### P1（建议尽快）

1. 初始化并发控制改为 singleflight（移除轮询）。
2. `safeInvoke` 增加结构化日志与错误计数指标。
3. 收紧默认预算：steps/retry/timeout，并支持会话级上限。

### P2（持续优化）

1. 补齐 `useAgentChat` 关键流程测试。
2. 增加故障注入测试（provider 超时、工具异常、store 失败）。
3. 完善运行指标（成功率、重试率、平均时延、token 成本）。

## 验证记录

已执行测试命令：

```bash
pnpm run test:run:vitest
```

结果：11 个测试文件、40 个测试通过。

## 最终判断

- **架构合理性**：是（中上）。
- **企业级基础能力达标**：否（当前为部分符合）。
- **建议状态**：先完成 P0/P1 再作为企业级默认基线推广。

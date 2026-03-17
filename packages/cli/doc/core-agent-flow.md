# Core Agent 核心实现梳理与流程图

## 1. 分析目标

本文档基于 `core` 中 agent 相关实现，梳理以下内容：

- 主执行链路（入口、循环控制、终止与错误处理）
- 工具调用链路（并发策略、ledger 幂等、write_file 特殊处理）
- 子代理流程（`spawn_agent` 到 app 层执行）
- 状态管理流程（stream event 到落库与终态收敛）

---

## 2. 核心结论（先看这个）

- `StatelessAgent.runStream` 是门面入口，负责 runtime 组装与上下文初始化。
- 真正的执行控制中枢在 `runAgentLoop`，它负责 step 循环、阶段切换、重试与终止判定。
- 每个 step 分为两大阶段：
  - LLM stage：消费 provider stream，聚合 assistant/tool_calls。
  - Tool stage：按并发策略执行工具调用，写回结果消息。
- `run-loop-control.ts` 统一收敛“是否终止 / 是否重试 / 是否超时 / 是否 abort”等控制语义。
- app 层 `AgentAppService.runForeground` 负责将内核事件映射为事件存储与 execution 状态 patch，并最终生成 terminal patch。

---

## 3. Agent 主执行链路（Mermaid）

```mermaid
flowchart TD
    A[调用 StatelessAgent.runStream] --> B[初始化运行态\nmessages/tools/writeBufferSessions/toolSessionState\ntimeoutBudget/executionScope/traceId]
    B --> C[createRunLoopRuntime 组装依赖\nLLM runtime + Tool runtime + Telemetry/Resilience]
    C --> D[进入 runAgentLoop]

    D --> E{pre-step terminal check\nresolvePreStepTerminalState}
    E -- terminal --> Z[产出 done/error\n结束循环]
    E -- continue --> F[prepareMessagesForStep\n注入系统/开发者/用户消息]

    F --> G[runLLMStage]
    G --> H[callLLMAndProcessStream\n流式消费 chunk/reasoning/tool_call]
    H --> I{LLM 输出是否包含 tool_calls}

    I -- 否 --> J[写入 assistant 消息]
    J --> K{是否达到终止条件\nmax steps/stop reason/用户消息状态}
    K -- 是 --> Z
    K -- 否 --> D

    I -- 是 --> L[runToolStage]
    L --> M[processToolCalls/processToolCallBatch]
    M --> N[执行 tool 并写回 tool_result]
    N --> O[checkpoint/progress 事件]
    O --> P{是否重试或继续下一 step}
    P -- 继续 --> D
    P -- 失败终止 --> Z

    G -.异常.-> Q[handleStepFailure\n分类 retryable/non-retryable]
    Q --> R{onError 决策}
    R -- retry --> S[backoff sleep]
    S --> D
    R -- abort --> Z

    D --> T[finally: runObservation.finish]
    T --> U[executionScope.release]
```

---

## 4. Tool 与子代理链路（Mermaid）

```mermaid
flowchart TD
    A[LLM 产出 tool_calls] --> B[tool-runtime.processToolCalls]
    B --> C[resolveToolConcurrencyPolicy\nexclusive/parallel + lock key + maxConcurrency]
    C --> D[tool-runtime-batch.processToolCallBatch]

    D --> E[tool-runtime-execution.executeToolWithLedger]
    E --> F{ledger 是否已有记录}
    F -- 是 --> G[回放既有结果\n保证幂等]
    F -- 否 --> H[真实执行 tool handler]

    H --> I{是否需要 confirm/permission}
    I -- 是 --> J[buildToolConfirmPromise / buildToolPermissionPromise]
    I -- 否 --> K[直接执行]
    J --> K

    K --> L{是否 write_file 相关失败}
    L -- 是 --> M[maybeEnrichWriteFileFailureResult\n增强错误上下文]
    M --> N[maybeCleanupWriteFileBuffer\n清理缓冲态]
    L -- 否 --> O[标准 tool_result]
    N --> O

    O --> P[写入 shared history\n返回 tool_result 事件]
    G --> P

    %% 子代理链路
    P --> SA{tool = spawn_agent ?}
    SA -- 否 --> END1[返回主循环下一 step]
    SA -- 是 --> SB[SpawnAgentToolV2]
    SB --> SC[SubagentPlatform.start/get/wait/cancel]
    SC --> SD[RealSubagentRunnerV2]
    SD --> SE[桥接 AgentAppService.runForeground]
    SE --> SF[子代理事件/状态轮询与终态映射]
    SF --> END2[将子代理结果回写为 tool_result]
```

---

## 5. 状态管理与事件模型

内核流式事件包含：

- `progress`
- `chunk`
- `reasoning_chunk`
- `tool_call`
- `tool_result`
- `checkpoint`
- `compaction`
- `user_message`
- `done`
- `error`

在 app 层（`AgentAppService.runForeground`）中，`for await ... runStream(...)` 消费这些事件并完成：

- 事件落库（event store）
- 执行状态 patch（execution store）
- 终态收敛（`buildTerminalPatch`）

---

## 6. 关键代码定位

- `../core/src/agent/agent/index.ts`
  - `StatelessAgent.runStream(...)` 入口与 runtime 组装。
- `../core/src/agent/agent/run-loop.ts`
  - `runAgentLoop(...)` 主循环、阶段驱动、统一收尾。
- `../core/src/agent/agent/run-loop-control.ts`
  - `resolvePreStepTerminalState(...)`
  - `prepareMessagesForStep(...)`
  - `handleStepFailure(...)`
- `../core/src/agent/agent/run-loop-stages.ts`
  - `runLLMStage(...)`
  - `runToolStage(...)`
- `../core/src/agent/agent/runtime-composition.ts`
  - `createRunLoopRuntime(...)`
  - `createToolRuntime(...)`
  - `createLLMStreamRuntimeDeps(...)`
- `../core/src/agent/agent/llm-stream-runtime.ts`
  - `callLLMAndProcessStream(...)`
- `../core/src/agent/agent/tool-runtime.ts`
  - `resolveToolConcurrencyPolicy(...)`
  - `processToolCalls(...)`
- `../core/src/agent/agent/tool-runtime-batch.ts`
  - `processToolCallBatch(...)`
- `../core/src/agent/agent/tool-runtime-execution.ts`
  - `executeToolWithLedger(...)`
  - `buildToolConfirmPromise(...)`
  - `buildToolPermissionPromise(...)`
  - `maybeEnrichWriteFileFailureResult(...)`
  - `maybeCleanupWriteFileBuffer(...)`
- `../core/src/agent/tool-v2/handlers/spawn-agent.ts`
  - `SpawnAgentToolV2`
- `../core/src/agent/tool-v2/agent-runner.ts`
  - `SubagentPlatform`
- `../core/src/agent/tool-v2/agent-real-runner.ts`
  - `RealSubagentRunnerV2`
- `../core/src/agent/app/agent-app-service.ts`
  - `runForeground(...)` 事件消费、状态 patch、终态映射。

---

## 7. 可继续扩展

可在此基础上补一张 `sequenceDiagram`，按一次真实路径展开：

`tool_call -> tool_result -> checkpoint -> done`

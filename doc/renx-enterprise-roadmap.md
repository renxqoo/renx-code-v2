# Renx 企业级演进路线图

## 1. 文档目标

本文档用于定义 `renx-code` 如何逐步演进为一个可与 `codex` 同级对标的企业级 Agent 项目。

目标不是机械照搬 `codex`，而是：

- 保留当前已经比较干净的执行内核
- 补齐 thread / session 架构层
- 系统性补强可靠性、安全性、治理能力、平台能力
- 输出一份可以按阶段拆解、直接推进的工程落地路线图

这份文档强调“可执行”，因此每个阶段都包含：

- 目标
- 范围
- 交付物
- 具体任务
- 验收标准
- 风险点

## 2. 北极星目标

`renx-code` 最终应成为一个具备以下特征的企业级项目：

- 架构边界清晰
- 支持长时运行和多轮交互
- 进程中断后可恢复
- 默认安全
- 可审计、可观测
- 易于集成到 CLI、TUI、App Service 以及未来 SDK
- 在 kernel、session、persistence、end-to-end 多层都可测试

这里的目标不是“功能比 codex 更多”，而是：

1. 工程纪律达到同等级别
2. 运行稳定性达到同等级别
3. 安全和治理能力达到同等级别
4. 平台扩展能力达到同等级别
5. 执行内核比 `codex` 更清晰、更容易维护

## 3. 当前项目评估

### 3.1 当前优势

当前代码库已经有一个很好的基础：

- `packages/core/src/agent/agent/index.ts`
  - `StatelessAgent` 已经是一个职责较明确的执行门面
- `packages/core/src/agent/agent/run-loop.ts`
  - 单轮 turn 的主循环已经被清晰拆开
- `packages/core/src/agent/agent/runtime-composition.ts`
  - LLM runtime 与 tool runtime 的组合边界已经比较明确
- `packages/core/src/agent/app/agent-app-service.ts`
  - 已经存在 app-facing orchestration、事件投影和存储集成基础

一句话总结：

当前项目最有价值的部分，不是“功能多”，而是执行内核已经比很多大型项目更容易推理。

### 3.2 当前短板

当前主要短板不在 LLM loop 本身，而在 kernel 与 app projection 中间缺少一个清晰的 session 层。

当前的核心问题包括：

- thread / session 还不是一等架构概念
- `AgentAppService` 承担了过多混合职责
- 长生命周期运行状态、active run、pending input、store projection 仍然耦合较近
- recovery / replay 还没有成为架构中心
- 安全治理能力尚未系统化

### 3.3 与 codex 的关键差异

`codex` 真正强的地方，不只是功能多，而是外层架构已经完整：

- `ThreadManager`
- `CodexThread`
- `Codex`
- `Session`
- `TurnContext`
- submission loop
- active turn 生命周期管理
- pending input 机制
- 更完整的恢复与运维面

`renx` 应该向 `codex` 学习的内容：

- thread / session 分层
- 生命周期归属
- 长生命周期状态的放置位置
- 产品级运行时的完整性

`renx` 不应该直接复制的内容：

- 过重的 session 巨类
- 把过多产品逻辑塞进执行内核
- 让 execution kernel 演化成一个无边界的大平台桶

## 4. 战略定位

`renx` 的目标架构应该是：

- 执行内核比 `codex` 更轻
- thread / session / recovery / governance 能力与 `codex` 一样扎实

核心设计原则是：

`小内核 + 显式 session 层 + projection/app 层 + 稳定 contracts`

这是整个项目后续演进最重要的架构决策。

## 5. 目标架构

### 5.1 四层模型

项目最终应收敛到四个主要层次。

#### A. Kernel 层

目标位置：

- `packages/core/src/agent/kernel`

职责：

- 单次执行循环
- LLM step orchestration
- tool step orchestration
- retry / timeout / abort / compaction
- runtime hooks 与内部观测

不应拥有：

- thread 生命周期
- session persistence
- app projection
- UI concerns
- 外部 run registry

当前大致属于这一层的代码：

- `packages/core/src/agent/agent/index.ts`
- `packages/core/src/agent/agent/run-loop.ts`
- `packages/core/src/agent/agent/run-loop-control.ts`
- `packages/core/src/agent/agent/run-loop-stages.ts`
- `packages/core/src/agent/agent/runtime-composition.ts`
- `packages/core/src/agent/agent/tool-runtime.ts`
- `packages/core/src/agent/agent/llm-stream-runtime.ts`

#### B. Session 层

目标位置：

- `packages/core/src/agent/session`

职责：

- thread / conversation 生命周期
- active execution 生命周期
- pending input 队列
- session config snapshot
- in-memory session state
- recovery 入口
- 调用 kernel 并协调执行

推荐核心对象：

- `AgentThreadManager`
- `AgentThread`
- `AgentSession`
- `SessionState`
- `ExecutionContext`

这一层是当前项目与 `codex` 差距最大的地方。

#### C. App 层

目标位置：

- `packages/core/src/agent/app`

职责：

- store 写入
- event projection
- run log
- metrics fan-out
- trace fan-out
- CLI / TUI integration
- 对外 façade API

App 层不应该继续直接拥有核心运行协调逻辑。

#### D. Contracts 层

目标位置：

- `packages/core/src/agent/contracts`

职责：

- 稳定的消息 contracts
- execution / run contracts
- event contracts
- session contracts
- persistence contracts

把 contracts 单独收口的意义在于：
避免类型四处扩散，防止事件形状和运行状态形状逐渐漂移。

### 5.2 Ownership 边界

未来建议的 ownership 表如下：

| 层        | 拥有                                                             | 不拥有                                        |
| --------- | ---------------------------------------------------------------- | --------------------------------------------- |
| Kernel    | run loop、tool loop、LLM loop、retry、timeout、compaction        | thread lifecycle、persistence、app projection |
| Session   | active execution、pending input、session state、thread lifecycle | tool 执行细节、store schema 细节              |
| App       | persistence、projection、external integration、logs 和 traces    | kernel 的控制流策略                           |
| Contracts | 共享 shapes、协议词汇表                                          | 运行行为实现                                  |

### 5.3 理想运行流

未来理想的运行流应该是：

1. 调用方请求 `AgentThreadManager` 创建或恢复 thread
2. manager 返回 `AgentThread`
3. 调用方通过 `AgentThread` 提交 turn
4. `AgentThread` 转发给 `AgentSession`
5. `AgentSession` 创建或恢复 `ExecutionContext`
6. coordinator 调用 `StatelessAgent.runStream(...)`
7. kernel 发出 stream events
8. session 更新内存状态与 pending input 状态
9. app 层将事件投影到 stores 并转发给外部消费者
10. execution 到达终态后由 session 标记完成

这个运行流是未来所有能力的骨架。

## 6. 六条主工作流

整个项目建议围绕六条主工作流并行推进。

### 工作流 A：架构与模块边界

目标：

- 完成 layer split
- 降低 ownership 混乱
- 防止 service class 继续长成 mega class

主要结果：

- session 层落地
- app service 被瘦身
- contracts 被统一

### 工作流 B：运行可靠性与恢复能力

目标：

- 让运行时具备 restartable、replayable、recoverable 能力

主要结果：

- append-only event history
- checkpoints
- replay 与 projection rebuild
- 中断后恢复

### 工作流 C：安全与治理

目标：

- 让平台默认安全，并且可审计

主要结果：

- approval policy 模型
- tool access control
- 文件与网络边界
- audit logging

### 工作流 D：平台接口统一

目标：

- 让 CLI、TUI、未来 app server 和 SDK 共用同一套 session 与 event model

主要结果：

- 稳定的 thread API
- 稳定的 event stream API
- 稳定的外部集成接口

### 工作流 E：质量工程

目标：

- 让行为可证伪、可回放、可防回归

主要结果：

- 分层测试矩阵
- replay tests
- transcript tests
- failure injection tests

### 工作流 F：运维与发布纪律

目标：

- 让项目成为可长期维护的软件产品，而不是“能跑的 runtime”

主要结果：

- versioning policy
- schema compatibility policy
- release gates
- telemetry 与 SLO

## 7. 分阶段推进计划

## 阶段 0：架构基线冻结

### 目标

在继续扩展功能前，先把未来 6 到 12 个月都不应轻易变化的架构方向冻结下来。

### 范围

- 文档化 current 与 target architecture
- 定义 layer boundaries
- 定义命名规则
- 定义 ownership model
- 定义迁移原则

### 交付物

- 本路线图文档
- 架构图文档
- execution lifecycle state machine 文档
- contracts inventory 文档

### 具体任务

- 盘点当前核心 runtime 模块，并为每个模块指定未来所属层
- 识别 mixed ownership classes
- 定义目标 package layout
- 定义允许的依赖方向

### 验收标准

- 每个当前 runtime 文件都有目标层归属
- `StatelessAgent` 的职责被明确声明为 kernel-only
- 在引入新重大能力之前，session 层定义已经完成

### 风险

- 在边界未冻结前继续堆功能
- 在 session 层缺失时继续把更多逻辑加进 `AgentAppService`

## 阶段 1：引入 Session 层

### 目标

在不改变现有行为的前提下，把 thread / session 变成正式架构概念。

### 范围

- 新增 `AgentThreadManager`
- 新增 `AgentThread`
- 新增 `AgentSession`
- 把 active execution ownership 从 app service 中迁出

### 建议类模型

- `AgentThreadManager`
  - create thread
  - resume thread
  - get thread
  - list threads
  - shutdown thread
- `AgentThread`
  - submit user turn
  - append input
  - subscribe events
  - inspect status
- `AgentSession`
  - own active execution
  - own pending input
  - own session config snapshot
  - call kernel

### 具体任务

- 定义 thread identifier 和 lifecycle states
- 定义 session state shape
- 定义 execution context shape
- 用 adapter 包住当前 app flow
- 在过渡期保持旧接口仍可工作

### 验收标准

- 新的 thread / session 层存在
- 当前 foreground run 行为不变
- active run registry 不再由 `AgentAppService` 直接拥有

### 风险

- 把 store concerns 泄漏进 session 层
- 把 session state 反向塞回 kernel

## 阶段 2：拆解 App 层

### 目标

把 `AgentAppService` 收缩为 façade，并把内部 orchestration 拆给专门协作者。

### 目标拆分

- `AgentAppService`
  - 仅保留外部 façade
- `AgentRunCoordinator`
  - 负责 run 调用与 stream handling
- `AgentEventProjector`
  - 负责 event 到 stores 的 projection
- `AgentRunRegistry`
  - 负责 active execution registry
- `AgentProjectionWriter`
  - 负责聚合 persistence adapters

### 具体任务

- 拆分 event projection 与 run invocation
- 拆分 run registry 与 service façade
- 将 store writes 隔离到专门组件
- 让 app orchestration 可在不经过完整 CLI 路径的情况下独立测试

### 验收标准

- `AgentAppService` 不再直接拥有 mixed run / state / projection logic
- 每个新增组件都有直达单元测试
- projection 失败可以与 kernel 执行失败分开观测

### 风险

- 只增加中间层，却没有清晰 contracts
- 旧新双路径并存太久

## 阶段 3：事件源、检查点与恢复能力

### 目标

让运行时真正具备 resilience、replay、restart 能力。

### 范围

- append-only event log
- execution checkpoint records
- 可回放的 projection rebuild
- 中断后 resume
- 重启后的状态收敛

### 具体任务

- 定义 checkpoint 写入点
- 定义从 events 重建 projection 的流程
- 定义 terminal state reconciliation
- 定义 crash recovery / resume procedure
- 定义 event versioning rules

### 必须支持的恢复场景

- tool 执行过程中进程退出
- LLM 已返回但 projection 尚未落地时进程退出
- 存在 pending input 时进程退出
- checkpoint 已写入但 terminal event 尚未落地时进程退出

### 验收标准

- run 可以从最近 durable checkpoint 恢复
- projections 可以从事件历史重建
- pending input 不会在重启后静默丢失
- 恢复前后 terminal reason 一致

### 风险

- event schema 漂移
- projection 不是幂等的
- replay 行为与在线行为不一致

## 阶段 4：安全、审批与审计

### 目标

把运行时提升到企业级治理水位。

### 范围

- approval policy model
- tool permission model
- file system / network policy model
- structured audit records
- subagent / background task governance

### 具体任务

- 定义 approval policy vocabulary
- 定义 deny / allow / ask / delegated approval 语义
- 定义 command 与 file mutation 的 audit records
- 定义 policy evaluation points
- 定义每个 approval decision 的 traceability 要求

### 审计记录至少包含

- execution id
- conversation id
- step index
- tool name
- 脱敏后的输入摘要
- decision
- decision source
- operator 或 policy identity
- timestamp

### 验收标准

- 所有高权限 tool execution 都可审计
- permission decisions 可回放、可解释
- 安全默认值明确且文档化

### 风险

- 每个 tool 各自补一套治理逻辑，而不是统一 policy 模型
- 把人工审批 UX 和核心 policy evaluation 混在一起

## 阶段 5：统一平台接口

### 目标

让所有前端和未来集成都消费同一套 session 与 event 模型。

### 范围

- CLI integration
- TUI integration
- future app server compatibility
- future SDK compatibility

### 具体任务

- 定义稳定的 thread-oriented API
- 定义稳定的 event subscription API
- 保证 app-facing layers 不再需要直接理解 kernel internals
- 标准化 event envelope 与 run record schema

### 验收标准

- CLI 与 TUI 共享同一套 session abstractions
- 未来外部集成不需要直接理解 kernel internals
- event shapes 已版本化并文档化

### 风险

- 不同 frontend 各自分叉 runtime 逻辑
- UI 行为泄漏到 session 层

## 阶段 6：质量与发布硬化

### 目标

把项目提升成工业级交付系统。

### 范围

- layered test strategy
- replay / transcript tests
- compatibility checks
- performance baselines
- release quality gates

### 测试矩阵

- kernel unit tests
- session coordination tests
- persistence / projection tests
- recovery tests
- security policy tests
- transcript replay tests
- CLI / TUI end-to-end tests

### 发布门禁

- contract compatibility checks 全部通过
- recovery replay suite 全部通过
- privileged tool policy suite 全部通过
- 不存在未解决的 P0 reliability regression
- 不存在未解决的 P0 audit gap

### 验收标准

- 每个 release candidate 都经过定义好的 gate set
- rollback path 已文档化
- compatibility expectations 明确

### 风险

- 只依赖 unit tests
- 缺少真实 runtime 行为的 replay fixtures

## 8. 推荐的仓库演化方式

这一节描述的是目标形态，不代表需要一次性搬目录。

```text
packages/core/src/agent/
  kernel/
    index.ts
    run-loop.ts
    run-loop-control.ts
    run-loop-stages.ts
    runtime-composition.ts
    llm/
    tool/
    observability/
  session/
    agent-thread-manager.ts
    agent-thread.ts
    agent-session.ts
    session-state.ts
    execution-context.ts
    pending-input-queue.ts
  app/
    agent-app-service.ts
    agent-run-coordinator.ts
    agent-event-projector.ts
    agent-run-registry.ts
    sqlite-agent-app-store.ts
  contracts/
    message.ts
    events.ts
    execution.ts
    session.ts
```

目录迁移只能发生在 contracts 边界明确之后，否则很容易变成“只是换目录，不是真正分层”。

## 9. 近期可立即执行的 Backlog

接下来最值得做的事情建议按下面顺序推进。

### Sprint 1

- 冻结 architecture baseline
- 定义 target dependency rules
- 定义 thread / session contracts
- 定义 execution lifecycle state machine

### Sprint 2

- 落 session layer 外壳，不改变 runtime behavior
- 让当前 foreground execution 走 session abstractions
- 为 session ownership 与 pending input handling 加直接测试

### Sprint 3

- 拆解 `AgentAppService`
- 隔离 event projector 与 run registry
- 稳定 run record 与 event envelope contracts

### Sprint 4

- 补 checkpoint 设计与 replay 设计
- 实现 checkpoint write points
- 补 recovery test fixtures

## 10. 团队协作模型

为了让这条路线走稳，建议按 ownership 明确分工。

建议的 owner 划分：

- Core runtime owner
  - kernel semantics
  - retry / timeout / compaction / tool orchestration
- Session runtime owner
  - thread lifecycle
  - active execution
  - pending input
  - recovery lifecycle
- Platform owner
  - app 层
  - stores
  - projections
  - contracts
- Security owner
  - approval policy
  - audit records
  - sandbox / tool policy
- Quality owner
  - replay suite
  - transcript suite
  - release gates

如果没有清晰 ownership，架构最终大概率会重新退回 mixed-layer 状态。

## 11. 架构红线

下面这些红线在整个项目推进过程中应被持续执行。

### 红线 1

不要把 persistence logic 放回 kernel。

### 红线 2

不要让 `StatelessAgent` 变成 conversation 或 thread manager。

### 红线 3

不要让 `AgentAppService` 继续无限生长成 mixed-ownership façade。

### 红线 4

任何新的重大能力，在没有 layer owner 之前不要开做。

### 红线 5

新增 event shape 时，必须同时考虑 versioning 和 replay。

### 红线 6

新增高权限 tool 时，必须同时具备 policy、audit 和 test coverage。

## 12. “企业级完成态”的定义

只有当下面这些条件都成立时，`renx` 才能被认为达到了企业级水位。

- architecture layers 清晰且稳定
- thread 与 session lifecycle 是一等能力
- execution 可以 checkpoint 和 replay
- 进程中断后可以恢复
- permission 与 audit model 是系统化的
- CLI 与 TUI 共用同一套 runtime contracts
- release gates 覆盖 replay、安全、兼容性
- 核心失败可以被观测、诊断、解释

## 13. 最终建议

最优路径不是把 `renx` 做成一个 TypeScript 版的 `codex`。

最优路径是：

- 保留当前已经比较优秀的执行内核
- 引入缺失的 thread / session 架构层
- 在其外补强 recovery、governance 和 release discipline

如果这份路线图被严格执行，`renx` 完全有机会成为：

- 在企业能力上可与 `codex` 同级对标
- 在 kernel 架构上比 `codex` 更轻、更清晰
- 更适合作为一个长期演进的工程平台

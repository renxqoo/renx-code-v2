# Agent 与 Tool 架构约束

## 1. 文档目的

本文档用于冻结 `renx-code` 当前 Agent 与 Tool 的核心协作规则，避免后续继续出现：

- 同一语义存在多套命名
- 运行时与执行器重复承担同一职责
- Agent 重新侵入 Tool 领域实现
- 新工具接入时破坏现有分层边界

本文档是当前代码实现的配套约束，不是未来建议稿。

## 2. 当前架构结论

当前项目已经确定采用下面的协作模型：

- `Agent` 负责执行编排
- `tool-v2` 负责工具契约、策略、安全、权限、执行
- `Agent` 不直接理解具体工具内部协议
- `Tool` 不反向拥有 Agent 的执行生命周期

一句话概括：

`Agent 做 orchestration，tool-v2 做 execution domain。`

## 3. 分层边界

### 3.1 Agent 层职责

Agent 层只负责：

- 接收模型返回的 `tool_calls`
- 调度工具执行顺序与并发
- 维护幂等账本
- 发出运行时事件
- 处理回调、安全包装、终止与错误传播
- 把工具结果写回消息流

当前关键实现：

- `packages/core/src/agent/agent/index.ts`
- `packages/core/src/agent/agent/tool-runtime.ts`
- `packages/core/src/agent/agent/tool-runtime-execution.ts`
- `packages/core/src/agent/agent/tool-executor.ts`

### 3.2 tool-v2 层职责

`tool-v2` 负责：

- 工具契约定义
- 工具路由
- 参数解析
- policy 检查
- 权限申请
- approval 审批
- 文件与网络访问限制
- 具体 handler 执行
- 工具特有协议处理

当前关键实现：

- `packages/core/src/agent/tool-v2/contracts.ts`
- `packages/core/src/agent/tool-v2/orchestrator.ts`
- `packages/core/src/agent/tool-v2/tool-system.ts`
- `packages/core/src/agent/tool-v2/agent-tool-executor.ts`

### 3.3 严禁跨层承担的职责

Agent 层严禁：

- 理解某个具体工具的业务协议
- 推断某个工具下一步要不要自动补调
- 直接做文件权限或网络权限治理
- 直接操纵某个 tool handler 的内部状态

tool-v2 层严禁：

- 持有会话级运行主循环
- 决定 LLM step 的重试策略
- 持有 Agent 级 checkpoint / compaction / run-loop 控制权

## 4. 命名标准

### 4.1 统一命名为 `toolCallId`

从本次重构开始，内部统一使用：

- `toolCallId`

不再使用：

- `callId`

适用范围：

- tool-v2 contracts
- tool-v2 orchestrator
- tool-v2 router
- tool-v2 handlers
- Agent 与 Tool 的桥接层
- 测试代码

### 4.2 统一原因

统一为 `toolCallId` 的原因：

- 它直接表达“模型发起的一次工具调用 ID”
- 与消息中的 `tool_call_id` 语义天然一致
- 比 `callId` 更少歧义
- 后续扩展子任务调用、后台任务调用、事件调用时不容易混淆

### 4.3 命名规则

后续新增代码必须遵守：

- 只要语义是“LLM 发起的一次工具调用”，统一命名为 `toolCallId`
- 不允许新增新的 `callId` 作为同义字段
- 外部第三方输入如果叫 `callId`，必须在边界处立即归一成 `toolCallId`

### 4.4 唯一例外

只有在对接外部协议且对方字段名不可控时，才允许短暂出现 `callId`。

要求：

- 只能出现在适配边界
- 进入内部 domain 后必须立刻转换
- 不得继续向内部 contracts 传播

## 5. write_file 自动 finalize 规则

### 5.1 单一主责

`write_file` 的自动 finalize 现在只允许由：

- `EnterpriseToolExecutor`

承担。

当前实现位置：

- `packages/core/src/agent/tool-v2/agent-tool-executor.ts`

### 5.2 Agent 层禁止再做 finalize

Agent 运行时不再：

- 解析 `write_file` 协议
- 判断 `nextAction === finalize`
- 自动发起第二次 finalize 调用

当前 Agent 只保留：

- 正常执行
- 结果记录
- 消息回放
- 缓冲清理

对应实现：

- `packages/core/src/agent/agent/tool-runtime-execution.ts`

### 5.3 为什么必须单点收口

如果 Agent 和 Executor 同时处理 finalize，会出现：

- 双重责任，难以判断最终 owner
- 后续协议演进时容易两边改漏
- 测试语义被拆裂
- 工具领域知识反向污染 Agent 层

企业级架构要求：

`Agent 不知道 write_file 如何 finalize，只知道执行一个工具并接收结果。`

## 6. 当前正确调用链

当前工具调用主链如下：

1. `StatelessAgent` 驱动一轮执行
2. `tool-runtime` 发现模型返回 `tool_calls`
3. Agent 通过 `AgentToolExecutor` 执行工具
4. `EnterpriseToolExecutor` 进入 `tool-v2`
5. `tool-v2` 做 policy / permission / approval / handler execute
6. 如工具为 `write_file` 且返回 staged 协议，由 `EnterpriseToolExecutor` 自动 finalize
7. 最终结果返回 Agent
8. Agent 将结果写入消息流与账本

这个链路里，工具协议知识停留在执行器与 tool-v2，不向 Agent 扩散。

## 7. 新工具接入规则

以后新增工具时，必须遵守以下规则：

### 7.1 必须放在 tool-v2 域内

新工具必须通过 `tool-v2` 接入：

- 定义 schema
- 定义 plan
- 定义 execute
- 通过 registry / orchestrator 接入

不允许：

- 在 Agent runtime 中为某个工具写分支逻辑
- 在 `StatelessAgent` 中感知某个具体工具名字

### 7.2 工具特有协议必须留在 tool-v2

例如：

- staged write
- shell 权限申请
- 特定工具审批键
- 特定工具并发锁

这些都属于 tool domain，必须停留在 `tool-v2`。

### 7.3 Agent 只允许看通用能力

Agent 只允许依赖：

- 工具 schema
- 并发策略
- 通用执行结果
- 通用 policy callback
- 通用 permission / approval callback

不允许依赖：

- 某个工具的私有 metadata 语义
- 某个工具的下一步协议状态机

## 8. 反模式清单

后续代码评审时，以下写法一律视为架构回退：

- 在 Agent runtime 中新增 `if (toolName === 'write_file')`
- 在 Agent runtime 中解析具体工具的 structured output
- 在内部 domain 再次引入 `callId` 作为同义字段
- 在某个 handler 之外散落工具私有协议判断
- 在 app / agent 层直接 new 某个具体旧 tool 实现
- 为迁移方便保留双字段双写

## 9. 评审检查表

以后凡是改动 Agent 与 Tool 交界面，评审必须检查：

- 新增字段是不是 `toolCallId`
- 新功能是否把工具领域知识塞回 Agent
- 是否出现重复执行责任
- 工具协议是否只在 tool-v2 内部消化
- 测试是否覆盖边界而不是只测 happy path

## 10. 当前冻结规则

从当前版本开始，下列规则视为冻结：

### 规则 1

内部工具调用标识统一为 `toolCallId`。

### 规则 2

`write_file` 自动 finalize 只允许由 `EnterpriseToolExecutor` 承担。

### 规则 3

Agent 层不得再新增任何具体工具协议分支。

### 规则 4

所有新工具必须通过 `tool-v2` 的 contracts / orchestrator / handler 体系接入。

## 11. 对团队的直接要求

如果后续有人要改 Agent 与 Tool 关系，必须先回答三个问题：

1. 这个逻辑属于执行编排，还是属于工具领域？
2. 这个字段是不是应该统一为 `toolCallId`？
3. 这个能力是否会导致 Agent 再次理解具体工具协议？

只要第三个问题答案是“会”，那实现位置大概率就是错的。

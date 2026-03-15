# Runtime User Input Design

## Goal

在 agent 正在运行时，允许外部继续追加新的 user 消息，并让这些消息在安全边界被吸收到当前执行中，而不是强行中断当前 LLM/tool stage。

目标约束：

- 保持 `StatelessAgent` 无状态
- 不直接在运行中篡改当前 stage 使用的消息数组
- 不引入 hook/plugin 式行为覆盖
- 支持后续持久化、审计、恢复和多实例扩展

## Reference

参考 `D:\work\codex\codex-rs\core\src\codex.rs` 的设计要点：

- 运行中的 turn 持有 `pending_input`
- 外部通过 `steer_input(...)` 注入输入
- loop 在安全边界读取 `pending_input`
- 如果当前 turn 结束前发现仍有 `pending_input`，则继续 follow-up，而不是立即完成 turn

## Chosen Design

本项目采用以下等价设计：

1. App 层维护 active run 注册信息
2. 运行时追加的 user 消息进入 pending queue
3. Agent run loop 只在安全边界 drain pending queue
4. 被 drain 的消息以正式 `user_message` 事件进入事件流和消息投影

## Why Not Interrupt Immediately

不采用“用户一插入消息就立刻打断当前 LLM 流”的原因：

- 当前 assistant chunk 可能是半成品
- 当前 tool stage 可能已经开始执行，立即中断会导致状态复杂
- continuation / compaction / checkpoint 语义会明显变脏
- 企业级实现更适合 cooperative steering，而不是强制抢占

## Safe Boundaries

只在以下两个时机处理 pending user input：

1. 每次 LLM 请求前
   - drain 所有 pending user messages
   - 追加到 `state.messages`
   - 为每条消息发出正式 `user_message` 事件

2. assistant 准备正常结束时
   - 如果没有 tool call 且仍存在 pending user input
   - 不立刻发出最终 `done`
   - 继续下一次 loop

## Layer Responsibilities

### `agent/app`

- `AgentAppService`
  - 维护 active run registry
  - 提供 `appendUserInputToRun(...)`
  - 构造 pending input adapter 并传给 `StatelessAgent.runStream(...)`

- `SqliteAgentAppStore`
  - 持久化 pending input
  - 提供：
    - enqueue
    - take
    - has

### `agent/agent`

- `run-loop-control.ts`
  - 在 pre-step 边界 drain pending input
  - 发出 `user_message` 事件

- `run-loop.ts`
  - 在普通 stop 之前检查是否仍有 pending input
  - 有则继续 loop

- `types.ts`
  - 增加 pending input adapter 类型
  - 为运行期注入的 user 消息增加 stream event 类型

## Event Semantics

运行时追加 user 消息分成两个状态：

1. queued
   - 仅表示已经接受排队
   - 不立即进入正式上下文

2. consumed
   - 在 loop 边界被 drain
   - 这时才真正变成正式 `user_message`
   - 同时进入 event store / message store / context store

本次实现只要求保证 consumed 事件正确进入现有消息与事件流水线。

## Persistence Model

新增持久化表：

- `pending_run_inputs`

建议字段：

- `id`
- `execution_id`
- `conversation_id`
- `message_id`
- `payload_json`
- `created_at_ms`

读取规则：

- 按插入顺序 FIFO 取出
- `takePendingInputs(...)` 需要事务化
- 读取成功后立即删除，避免重复消费

## Public API Shape

`AgentAppService` 新增方法：

- `appendUserInputToRun(...)`

建议入参：

- `executionId`
- `conversationId`
- `userInput`

建议返回：

- `accepted`
- `reason?`
- `message?`

拒绝原因至少包括：

- `run_not_active`
- `conversation_mismatch`
- `empty_input`

## Current Scope

本次实现范围：

- 支持同一 `AgentAppService` 实例内的运行期追加 user 输入
- 支持 sqlite 持久化 pending queue
- 支持在下一个安全边界被当前 run 吸收

本次不做：

- 强制打断当前 LLM/token stream
- 跨实例分布式 live notification
- 复杂的 expected step / optimistic concurrency 控制

## Testing Plan

需要覆盖：

1. 运行中追加 user 消息后，下一 step 被正式消费
2. consumed 后写入事件流和消息投影
3. run 不存在时追加失败
4. conversationId 不匹配时追加失败
5. 多条 pending input 按 FIFO 消费
6. sqlite pending queue 的 enqueue / take / has 行为
7. assistant 正常 stop 前检测到 pending input 时继续 loop，而不是直接 done

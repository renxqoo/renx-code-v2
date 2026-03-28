# Subagent UI Redesign for CLI

## 1. Document Purpose

This document defines the long-term redesign plan for subagent message handling and UI presentation in `packages/cli`. It is intended to guide future implementation tasks.

Scope:
- Redesign how subagent messages are modeled, stored, and rendered.
- Reuse the existing CLI UI foundation where possible.
- Avoid incremental hacks that continue to treat subagents as ordinary tool output.
- Provide a maintainable architecture for parent/child agent runs, task linkage, live updates, history, and inspection views.

Out of scope:
- Immediate code changes.
- Backward-compatibility implementation details.
- Runtime protocol migration plan at transport level.

---

## 2. Current State Summary

### 2.1 Current UI structure

The current CLI UI is primarily composed of:
- `src/components/conversation-panel.tsx`
- `src/components/chat/assistant-reply.tsx`
- `src/components/chat/assistant-tool-group.tsx`
- `src/components/task-panel.tsx`
- `src/App.tsx`

Current behavior:
- Parent assistant replies are rendered as segmented chat output.
- Tool activity is grouped by `toolCallId` and displayed by `AssistantToolGroup`.
- Subagent-related tools (`spawn_agent`, `agent_status`, `wait_agents`, `cancel_agent`) are rendered through a special branch in `AssistantToolGroup`.
- Task status is displayed in a separate `TaskPanel`.

### 2.2 Current message model limitations

Relevant current structures:
- `ReplySegment` in `src/types/chat.ts`
- tool grouping in `src/hooks/turn-updater.ts`
- tool special rendering in `src/components/chat/assistant-tool-group.tsx`
- tool stream formatting in `src/agent/runtime/event-format.ts`

Current limitations:
1. Subagents are still treated as tool-related presentation objects.
2. Tool grouping is anchored on `toolCallId`, not on a persistent child run identity.
3. Live stream handling is effectively optimized for `stdout/stderr`, not semantic subagent updates.
4. Subagent output is summarized, but process visibility is weak.
5. Task view and chat view are disconnected.
6. Completed task visibility is weak because terminal tasks are filtered from the task panel.

---

## 3. Problem Statement

The current CLI does not have a first-class representation for subagent execution.

As a result:
- A child run is visually reduced to a tool summary card.
- Intermediate progress and insights are not represented as first-class UI objects.
- The user cannot clearly distinguish between:
  - tool execution,
  - child run lifecycle,
  - task tracking,
  - final subagent output,
  - detailed debug traces.
- UI logic increasingly depends on special-case parsing and rendering inside tool presentation code.

This creates long-term risks:
- more branching in `AssistantToolGroup`
- increasing coupling between runtime payload details and UI rendering
- difficulty supporting richer nested subagent workflows
- poor debuggability and poor user comprehension under parallel child runs

---

## 4. Design Goals

### 4.1 Product goals

The CLI should allow users to understand:
- which subagents exist
- what each subagent is doing now
- what each subagent has discovered
- which outputs each subagent has produced
- which subagents are blocked, failed, cancelled, or completed
- how subagents relate to parent runs and tasks

### 4.2 Engineering goals

The redesign should:
- treat subagent runs as first-class entities
- separate event ingestion from UI rendering
- let multiple UI surfaces reuse the same aggregated run state
- avoid direct UI dependence on raw runtime payload shapes
- support live updates and historical inspection
- support multiple child runs and nested child runs
- preserve low-noise default behavior

### 4.3 Non-goals

The redesign should not:
- expose raw child internal reasoning by default
- dump all child tool stdout into the main conversation by default
- overload the task panel as a full event log
- keep building more special cases into generic tool cards

---

## 5. Core Design Decision

**Subagent messages must be modeled as run events, not as ordinary tool output.**

This is the single most important architectural decision in the redesign.

Implications:
- `spawn_agent` is a creation action, not the true lifecycle container.
- A subagent is represented by a persistent run identity (`runId` / `agentId` abstraction), not by a tool call id.
- UI should render a subagent run card, not only a tool result card.
- The task panel should show run/task projections, not only raw task summaries.
- Tool cards remain useful for ordinary tools, but subagent visualization must move to a run-centric model.

---

## 6. Target Architecture Overview

### 6.1 Logical layers

1. **Runtime event source layer**
   - emits raw runtime events
   - includes parent agent events, subagent events, task linkage, tool activity, completion metadata

2. **Run event normalization layer**
   - converts raw runtime-specific envelopes into stable `RunEvent` records
   - assigns events to run identities
   - marks message visibility and importance

3. **RunStore aggregation layer**
   - stores run nodes, relations, artifacts, and events
   - computes derived state
   - handles deduplication and retention
   - builds projections for UI

4. **UI projection layer**
   - conversation projection
   - runs summary projection
   - run inspector projection

5. **UI rendering layer**
   - `ConversationPanel`
   - `RunsSummaryPanel` (evolved from `TaskPanel`)
   - `RunCard`
   - `RunInspector`

### 6.2 High-level data flow

```text
Raw runtime events
  -> RunEvent normalization
  -> RunStore
  -> UI projections
  -> UI components
```

---

## 7. Domain Model

### 7.1 Primary entities

#### RunNode
Represents one agent execution instance.

Required fields:
- `runId`
- `kind` (`root_agent` | `subagent`)
- `parentRunId`
- `spawnedByToolCallId`
- `conversationId`
- `executionId?`
- `role?`
- `description?`
- `linkedTaskId?`
- `status`
- `progress?`
- `createdAt`
- `startedAt?`
- `endedAt?`
- `updatedAt`
- `errorMessage?`
- `finalSummary?`
- `finalOutputArtifactId?`

#### RunEvent
Represents one normalized event attached to a run.

Required fields:
- `eventId`
- `runId`
- `timestamp`
- `sequence`
- `type`
- `visibility` (`user_visible` | `debug_only` | `internal`)
- `payload`

#### RunArtifact
Represents a durable run output.

Examples:
- summary
- final output
- report
- diff
- error artifact

#### RunRelation
Represents graph edges between runs and other entities.

Examples:
- parent -> child (`spawned`)
- run -> task (`linked_task`)
- run -> run (`depends_on`)
- run -> run (`cancelled`)

### 7.2 Why this model is necessary

Without a persistent run model:
- subagent state is fragmented across tool payloads and tasks
- UI must keep reparsing ad hoc structures
- parent-child hierarchy is implicit instead of explicit

---

## 8. Event Taxonomy

### 8.1 Lifecycle events

Examples:
- `run.created`
- `run.started`
- `run.completed`
- `run.failed`
- `run.cancelled`
- `run.timed_out`

### 8.2 Status events

Examples:
- `run.progress`
- `run.status_line`
- `run.blocked`
- `run.waiting`

### 8.3 Message events

Examples:
- `run.message.public_text`
- `run.message.insight`
- `run.message.warning`
- `run.message.error`

### 8.4 Tool activity events

Examples:
- `run.tool.started`
- `run.tool.stream`
- `run.tool.completed`

Important note:
- tool activity belongs to a run
- the parent UI should not default to rendering all child tool activity verbatim
- raw tool streams should remain debug-facing unless explicitly elevated

### 8.5 Task events

Examples:
- `run.task.linked`
- `run.task.updated`

### 8.6 Artifact events

Examples:
- `run.artifact.created`

---

## 9. Message Visibility Policy

This redesign must explicitly control which subagent messages are surfaced.

### 9.1 Visibility levels

- `user_visible`
  - safe and useful in normal UI
- `debug_only`
  - useful for inspection, not for default conversation
- `internal`
  - store-level or transport-level metadata not intended for users

### 9.2 Default publish rules

Default conversation visibility should include:
- current status line
- important insights
- warnings and errors
- final summary
- final output preview

Default conversation visibility should exclude:
- internal reasoning
- raw repeated tool stdout
- frequent progress ticks
- low-value debug traces

This is necessary to prevent parent conversation noise.

---

## 10. Aggregation Rules in RunStore

### 10.1 Status aggregation

- latest `run.progress` wins
- latest `run.status_line` wins per replace key
- terminal lifecycle event closes the run
- blocked/waiting states are preserved until replaced

### 10.2 Message aggregation

- keep recent visible lines for conversation cards
- keep a fuller timeline for inspector
- deduplicate adjacent identical status lines
- merge redundant output previews when the final output repeats already visible content

### 10.3 Artifact aggregation

- artifacts are durable and addressable
- a completed run should keep its summary and artifact references even after it leaves the active list

### 10.4 Retention strategy

Three retention layers:
- hot: active runs and recent updates in memory
- warm: recent completed/failed/cancelled run summaries and artifacts
- cold: full debug history or transcript on demand

---

## 11. UI Structure

### 11.1 Conversation view

The main conversation should show subagents as **Run Cards**.

A run card should show:
- title (description or derived label)
- role
- status
- progress
- linked task id if present
- latest status line
- recent insights
- warnings/errors if present
- artifact availability

The conversation should not show full child internals by default.

### 11.2 Runs summary view

The existing `TaskPanel` should evolve into a **Runs Summary Panel**.

It should show:
- active runs
- blocked runs
- recent completed runs
- selected run detail snippet

It should not try to replace a full timeline.

### 11.3 Run inspector view

A new dedicated `RunInspector` should show detailed information for one run.

Recommended sections:
- Meta
- Timeline
- Artifacts
- Debug

This inspector is the correct place for deeper diagnostics.

---

## 12. UI Component Strategy Based on Existing Components

This redesign should build on current CLI components instead of replacing the entire UI foundation.

### 12.1 Components to keep

Keep and continue using:
- `src/App.tsx`
- `src/components/conversation-panel.tsx`
- `src/components/chat/assistant-reply.tsx`
- the existing prompt and footer structure

### 12.2 Components to narrow in responsibility

#### `AssistantToolGroup`
Current role:
- generic tool rendering
- special cases for subagent-related tools

Target role:
- remain the renderer for ordinary tools
- stop being the main long-term home for subagent lifecycle UI

#### `TaskPanel`
Current role:
- simple active task strip

Target role:
- evolve into `RunsSummaryPanel`
- show active/blocked/recent runs plus selection details

### 12.3 Components to introduce

#### `RunCard`
Displays one subagent run in the conversation stream.

#### `RunCardBody`
Shows status, highlights, and artifact previews.

#### `RunInspector`
Detailed view for one run.

#### `RunTimeline`
Detailed event timeline.

#### `RunArtifactsPanel`
Artifact preview and selection.

#### `RunStoreProvider` / state hook
Read-only UI consumption layer for run projections.

---

## 13. Proposed UI Behavior

### 13.1 Default conversation behavior

For each child run card:
- show one current status line
- show up to 3 recent highlights
- show warnings/errors prominently
- show completion summary after finish
- show artifact availability after finish

### 13.2 Expanded run behavior

Expanded run card may show:
- recent update list
- more detailed live messages
- artifact preview

Still not a full debug transcript.

### 13.3 Inspector behavior

Inspector should provide:
- stable metadata
- full timeline
- artifact inspection
- optional debug transcript or raw tool activity

---

## 14. Recommended UX Rules

### 14.1 Main conversation rules

Main conversation should answer:
- What is happening?
- Why did this subagent matter?
- What did it find?
- What was the outcome?

### 14.2 Summary panel rules

Runs summary panel should answer:
- What is active right now?
- What needs attention?
- What just finished?

### 14.3 Inspector rules

Inspector should answer:
- What exactly happened?
- In what order?
- What outputs exist?
- What debug data is available?

---

## 15. Relationship Between Parent Run, Child Run, and Tool Activity

### 15.1 Parent conversation responsibility

The parent conversation should own:
- the narrative
- high-level progress
- visible child run cards
- final decision context

### 15.2 Child run responsibility

A child run should own:
- its lifecycle
- its visible updates
- its artifacts
- its debug timeline

### 15.3 Tool activity responsibility

Tool activity should remain a substructure of a run.

Important principle:
- tools are activities inside a run
- they are not the long-term presentation container for the run

---

## 16. Migration Direction

This document does not define code-level implementation steps, but it does define the architectural migration direction.

### Stage A: establish run-centric state
- introduce normalized run entities and projections
- preserve existing tool rendering for ordinary tools

### Stage B: introduce subagent run cards
- render subagent runs in conversation as run cards
- reduce dependency on tool-special-case rendering for subagent lifecycle data

### Stage C: evolve task panel into runs summary
- active + blocked + recent completed
- selected run details

### Stage D: introduce inspector
- timeline
- artifacts
- debug-only content

### Stage E: reduce special cases in tool UI
- ordinary tools remain in tool cards
- subagent lifecycle fully owned by run projections

---

## 17. Risks and Design Constraints

### 17.1 Risks if we do not redesign

- more UI branching inside `AssistantToolGroup`
- poor readability under parallel subagent execution
- increasing mismatch between runtime semantics and UI presentation
- fragile coupling to raw payload shapes

### 17.2 Risks during redesign

- dual-model transition complexity
- temporary duplication between tool cards and run cards
- need for careful event visibility policy to avoid noise

### 17.3 Constraint

The current CLI UI is terminal-based and must stay compact.

Therefore the redesign must:
- default to low-noise summaries
- preserve keyboard-first navigation
- avoid turning the main conversation into a raw event console

---

## 18. Acceptance Criteria for the Redesign

The redesign can be considered successful when all of the following are true:

1. A subagent is represented as a first-class run object in UI state.
2. Conversation view shows subagent run cards instead of relying only on tool summaries.
3. Runs summary panel shows active, blocked, and recent finished runs.
4. A finished subagent does not disappear immediately from user-visible state.
5. Run inspector provides timeline, artifacts, and debug detail.
6. Default conversation remains concise and does not dump raw child internals.
7. Ordinary tools continue to use tool cards without regression.
8. UI rendering is driven by run projections, not by repeated ad hoc payload parsing.

---

## 19. File References Used in This Analysis

This design is based on the current implementation in:
- `src/App.tsx:248`
- `src/types/chat.ts:3`
- `src/hooks/turn-updater.ts:95`
- `src/components/conversation-panel.tsx:10`
- `src/components/chat/assistant-reply.tsx:82`
- `src/components/chat/assistant-tool-group.tsx:789`
- `src/components/chat/assistant-tool-group.tsx:1201`
- `src/components/task-panel.tsx:64`
- `src/hooks/use-task-panel.ts:27`
- `src/hooks/use-agent-chat.ts:152`
- `src/agent/runtime/event-format.ts:239`
- `src/agent/runtime/types.ts:8`

---

## 20. Final Recommendation

Do not continue growing subagent UI as an extension of tool stream rendering.

Instead:
- keep generic tool rendering for ordinary tools
- introduce a run-centric state model for parent/child agent executions
- drive conversation cards, summary panels, and inspector views from run projections
- treat subagent messages as curated run events, not raw tool output

This is the most maintainable path for the CLI as subagent workflows become more important and more complex.
完整草图
- 可以，下面我给你一版更完整的终端 UI ASCII 草图。
- 我会分 4 个场景：
  - 主界面
  - 展开某个子 agent
  - 打开 inspector
  - 多子 agent 并行
- 目标是让你直观看到：子 agent 消息应该放哪、显示到什么粒度、怎么避免刷屏。
1. 主界面：默认态
- 默认态重点是“可读”和“全局感知”。
┌──────────────────────────────────────────────────────────────────────────────┐
│ Conversation                                                                │
│                                                                              │
│ User                                                                         │
│ 请查看 cli 中子agent的 ui 展示，给出结论和优化方案                           │
│                                                                              │
│ Assistant                                                                    │
│ 我先分两条线分析：渲染/布局 和 状态流。                                      │
│                                                                              │
│ ┌─ Subagent: Analyze UI Rendering ─────────────────────────────────────────┐ │
│ │ ◐ Explore · running · 52% · task task_101                               │ │
│ │ · 正在分析 assistant-tool-group 渲染链路                                 │ │
│ │ → task panel 当前只有一行摘要，没有 detail 区                            │ │
│ │ [Enter 展开] [I 详情]                                                    │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ ┌─ Subagent: Analyze State Flow ───────────────────────────────────────────┐ │
│ │ ◐ Explore · running · 41% · task task_102                               │ │
│ │ · 正在分析 use-agent-chat 与 task refresh 的关系                         │ │
│ │ → task_* result 在 chat 中被 suppress                                    │ │
│ │ [Enter 展开] [I 详情]                                                    │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ Assistant                                                                    │
│ 当前已发现两个结构性问题：完成态消失、子agent展示过于工具化。               │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Runs  Active 2 · Blocked 0 · Recent Done 1                                   │
│                                                                              │
│ > Analyze UI Rendering         running    52%    Explore                     │
│   Analyze State Flow           running    41%    Explore                     │
│   Review Tool Presentation     done              general-purpose             │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Prompt >                                                                     │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Hints: Tab 切换区域 · ↑↓ 选择 run · Enter 展开 · I 查看详情 · Ctrl+T 总览    │
└──────────────────────────────────────────────────────────────────────────────┘
这个界面的设计逻辑
- 上面 Conversation 里，子 agent 是 Run Card
- 中间 Runs 是总览，不承载完整消息
- 下面 Prompt 保持输入焦点
- 用户不需要离开主界面，就能知道：
  - 有几个子 agent
  - 谁在跑
  - 谁有发现
  - 谁做完了
2. 展开某个子 agent
- 展开态展示“最近更新”，但不直接变成完整日志终端。
┌──────────────────────────────────────────────────────────────────────────────┐
│ Conversation                                                                │
│                                                                              │
│ ┌─ Subagent: Analyze UI Rendering ─────────────────────────────────────────┐ │
│ │ ◐ Explore · running · 52% · task task_101                               │ │
│ │                                                                          │ │
│ │ status                                                                   │ │
│ │   正在分析 assistant-tool-group 的 special presentation 路径             │ │
│ │                                                                          │ │
│ │ recent updates                                                           │ │
│ │   10:21:13  · 正在扫描 src/components/chat                               │ │
│ │   10:21:18  → assistant-tool-group 对 subagent 走特殊分支                │ │
│ │   10:21:26  → 特殊分支当前不消费 group.streams                           │ │
│ │   10:21:31  ! wait_agents 结果展示上限 5 条                              │ │
│ │                                                                          │ │
│ │ artifacts                                                                │ │
│ │   □ final summary pending                                                │ │
│ │                                                                          │ │
│ │ [Enter 收起] [I 详情] [A 产物]                                           │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ ┌─ Subagent: Analyze State Flow ───────────────────────────────────────────┐ │
│ │ ◐ Explore · running · 41% · task task_102                               │ │
│ │ · 正在分析 use-agent-chat 与 task refresh 的关系                         │ │
│ │ [Enter 展开] [I 详情]                                                    │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Runs  Active 2 · Blocked 0 · Recent Done 1                                   │
│ > Analyze UI Rendering         running    52%    Explore                     │
│   Analyze State Flow           running    41%    Explore                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Prompt >                                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
为什么不是原始 stdout
- 因为对用户真正有价值的是：
  - “现在在干嘛”
  - “刚发现了什么”
  - “有没有风险/阻塞”
- 而不是底层工具逐行输出
3. 子 agent 完成态
- 完成后不应该直接消失。
- 应显示摘要 + 结果入口。
┌──────────────────────────────────────────────────────────────────────────────┐
│ Conversation                                                                │
│                                                                              │
│ ┌─ Subagent: Analyze UI Rendering ─────────────────────────────────────────┐ │
│ │ ● Explore · completed · 36s · task task_101                              │ │
│ │                                                                          │ │
│ │ summary                                                                  │ │
│ │   当前子agent展示本质上是“工具结果化”，不是“运行实体化”；                │ │
│ │   特殊分支绕开默认 stream 合并，导致过程消息连续性不足。                 │ │
│ │                                                                          │ │
│ │ key findings                                                              │ │
│ │   → task panel 不承载 detail view                                        │ │
│ │   → terminal task 被过滤，完成态直接消失                                 │ │
│ │   → subagent summary 仅保留摘要，没有 timeline                           │ │
│ │                                                                          │ │
│ │ artifacts                                                                │ │
│ │   □ final output available                                               │ │
│ │   □ summary report available                                             │ │
│ │                                                                          │ │
│ │ [I 详情] [A 查看输出]                                                     │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Runs  Active 1 · Blocked 0 · Recent Done 2                                   │
│ > Analyze State Flow           running    41%    Explore                     │
│   Analyze UI Rendering         done              Explore                     │
│   Review Tool Presentation     done              general-purpose             │
├──────────────────────────────────────────────────────────────────────────────┤
│ Prompt >                                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
关键点
- 完成态保留
- 结果不丢
- 仍然可以点进去看 timeline 和 artifact
4. 打开 Run Inspector
- 这个界面承载完整过程，不放到主聊天里。
┌══════════════════════════════════════════════════════════════════════════════┐
│ Run Inspector: Analyze UI Rendering                                         │
╞══════════════════════════════════════════════════════════════════════════════╡
│ Tabs: [Meta] [Timeline] [Artifacts] [Debug]                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ Meta                                                                         │
│                                                                              │
│ runId        run_child_a                                                     │
│ parent       run_parent_1                                                    │
│ role         Explore                                                         │
│ status       completed                                                       │
│ task         task_101                                                        │
│ progress     100%                                                            │
│ started      10:21:12                                                        │
│ ended        10:21:48                                                        │
│ duration     36s                                                             │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Timeline                                                                     │
│                                                                              │
│ 10:21:12  created                                                            │
│ 10:21:13  started                                                            │
│ 10:21:16  status    正在扫描 src/components/chat                             │
│ 10:21:18  insight   assistant-tool-group 对 subagent 走特殊分支             │
│ 10:21:24  status    正在分析 buildTaskResultSections                         │
│ 10:21:26  insight   subagent 特殊分支当前不消费 group.streams               │
│ 10:21:31  warning   wait_agents 结果只展示前 5 条                           │
│ 10:21:44  artifact  summary created                                          │
│ 10:21:48  completed                                                          │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Footer: Esc 返回 · ←→ 切换 Tab                                               │
└══════════════════════════════════════════════════════════════════════════════┘
Artifacts Tab
┌══════════════════════════════════════════════════════════════════════════════┐
│ Run Inspector: Analyze UI Rendering                                         │
╞══════════════════════════════════════════════════════════════════════════════╡
│ Tabs: [Meta] [Timeline] [Artifacts] [Debug]                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ Artifacts                                                                    │
│                                                                              │
│ [summary]                                                                    │
│ 当前子agent展示本质上仍依赖工具卡片模型，导致运行过程信息不连续。           │
│                                                                              │
│ [final output]                                                               │
│ - 关键入口文件：src/components/chat/assistant-tool-group.tsx               │
│ - 问题1：特殊分支不消费 stream                                               │
│ - 问题2：TaskPanel 过滤完成态                                                │
│ - 问题3：task result 在 chat 中被 suppress                                  │
│                                                                              │
│ [report]                                                                     │
│ available                                                                    │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Footer: Esc 返回 · ↑↓ 选择 artifact · Enter 展开                             │
└══════════════════════════════════════════════════════════════════════════════┘
Debug Tab
┌══════════════════════════════════════════════════════════════════════════════┐
│ Run Inspector: Analyze UI Rendering                                         │
╞══════════════════════════════════════════════════════════════════════════════╡
│ Tabs: [Meta] [Timeline] [Artifacts] [Debug]                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ Debug (collapsed sections)                                                   │
│                                                                              │
│ > tool activity                                                              │
│   - read_file src/components/chat/assistant-tool-group.tsx                  │
│   - read_file src/components/task-panel.tsx                                 │
│                                                                              │
│ > raw debug transcript                                                       │
│   hidden                                                                     │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Footer: Esc 返回 · Enter 展开/收起                                           │
└══════════════════════════════════════════════════════════════════════════════┘
5. 多个子 agent 并行时的理想展示
- 主会话里每个子 agent 只一张卡，避免刷屏。
- 总览区负责比较和切换。
┌──────────────────────────────────────────────────────────────────────────────┐
│ Conversation                                                                │
│                                                                              │
│ ┌─ Subagent: Analyze Rendering ────────────────────────────────────────────┐ │
│ │ ◐ Explore · running · 52%                                                │ │
│ │ · 正在分析 assistant-tool-group                                          │ │
│ │ → 特殊分支绕过默认 stream 合并                                           │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ ┌─ Subagent: Analyze State Flow ───────────────────────────────────────────┐ │
│ │ ◐ Explore · running · 41%                                                │ │
│ │ · 正在分析 use-agent-chat 刷新逻辑                                       │ │
│ │ → task_* result 在 chat 中被 suppress                                    │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ ┌─ Subagent: Dependency Review ────────────────────────────────────────────┐ │
│ │ ● research-agent · completed                                             │ │
│ │ summary  当前依赖层没有明显阻塞子agent UI 的问题                         │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Runs  Active 2 · Blocked 1 · Recent Done 1                                   │
│                                                                              │
│ > Analyze Rendering           running    52%    Explore                     │
│   Analyze State Flow          running    41%    Explore                     │
│   Dependency Review           done              research-agent              │
│   Build Final Recommendation  blocked           general-purpose             │
│                                                                              │
│ Details                                                                      │
│   latest   正在分析 assistant-tool-group                                    │
│   insight  特殊分支绕开默认 stream 合并                                     │
│   output   pending                                                           │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Prompt >                                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
6. 焦点态设计
- 我建议做成 3 区焦点切换：
  - Conversation
  - Runs
  - Prompt
焦点示意
[Conversation] [Runs] [Prompt]
Conversation focused:
- ↑↓ 滚聊天
- Enter 展开 run card
- I 打开 inspector
Runs focused:
- ↑↓ 切换 run
- Enter 打开/展开选中 run
- A 看 artifacts
- I 打开 inspector
Prompt focused:
- 正常输入
7. 我建议的最终布局比例
- 如果终端高度足够：
Conversation   ~65%
Runs summary   ~20%
Prompt         ~10%
Hints          ~5%
- 如果终端高度不足：
  - Runs summary 缩成 3~4 行
  - 详情只在 inspector 里看
  - Conversation 卡片保持极简
8. UI 设计原则，用一句话说
- 聊天里看结论与进展，总览里看全局，详情里看过程。
9. 最重要的取舍
- 不要在主聊天里显示这些：
  - 子 agent 内部每一次 tool use
  - 原始 stdout/stderr 长日志
  - 高频 progress tick
- 要在主聊天里显示这些：
  - 当前状态
  - 新发现
  - 风险/错误
  - 最终摘要/产物入口
10. 如果把当前 UI 向这个方向演进，最终角色会变成
- ConversationPanel
  - 展示 narrative + RunCard
- TaskPanel
  - 升级成 Runs Summary
- 新增 RunInspector
  - 承载 timeline / artifacts / debug
- AssistantToolGroup
  - 回归普通工具展示，不再负责承载子 agent 的完整语义展示
11. 最后一张最简终态图
+--------------------------------------------------------------+
| Conversation                                                 |
|  parent text                                                 |
|  [Run Card: child A]                                         |
|  [Run Card: child B]                                         |
|  parent conclusion                                           |
+--------------------------------------------------------------+
| Runs Summary                                                 |
|  > child A  running 52%                                      |
|    child B  running 41%                                      |
|    child C  done                                             |
+--------------------------------------------------------------+
| Prompt                                                       |
+--------------------------------------------------------------+
           Enter / I
              |
              v
+==============================================================+
| Run Inspector                                                |
|  Meta | Timeline | Artifacts | Debug                         |
+==============================================================+
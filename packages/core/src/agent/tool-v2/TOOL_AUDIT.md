# Tool V2 审计报告

## 背景

`tool-v2` 的整体架构方向是对的：

- `registry / router / orchestrator / permissions` 分层清晰
- approval、permission、sandbox、shell policy 被抽到了共享基础设施
- agent 已经可以走原生 `ToolCallResult` / `ToolHandlerResult` 路径

但这次重构里有一个明显风险：

> 去掉了旧架构的兼容包袱，也一起去掉了旧工具里仍然有价值的真实能力、错误语义、模型使用说明和默认安全约束。

这不是“合理的 clean-slate”，而是“能力回退”。

本审计的结论是：

1. `tool-v2` 不应该回退到旧 `ToolManager` / 旧 `ToolResult`。
2. `tool-v2` 应该保留旧工具里仍然有效的运行时能力、恢复协议、错误码和 description 语义。
3. 旧 `tool-prompts.ts` 里的 description 不是普通文案，它们本质上是给模型看的使用协议，应作为 v2 description 的基础版本保留。

## 迁移原则

### 应保留

- 旧工具的真实运行能力
- 对模型有约束作用的 description
- 可恢复错误协议
- 默认安全边界
- 并发/确认/策略等共享语义

### 可以删除

- 旧 `ToolManager` 适配层
- 旧 `ToolResult` 兼容形态
- 旧 snake_case / camelCase 兼容垫片
- 仅为兼容历史调用方而存在的桥接逻辑

### 设计准则

`tool-v2` 应该是“新架构 + 旧能力语义保留”，而不是“新架构 + 功能打薄”。

## 当前迁移进度

截至当前这轮重构，`tool-v2` 已经完成以下恢复/迁移：

- `write_file`：已恢复 buffered/finalize 协议，并接回 agent 侧自动 finalize 流程
- `file_edit`：已恢复 `EDIT_CONFLICT` 可恢复冲突语义
- `web_fetch`：已恢复旧 description、`extractMode` 和 SSRF denylist 防护
- `skill`：已迁移为 v2 原生 handler
- `task_*`：已迁移 `task_create / task_get / task_graph / task_list / task_update / task_output / task_stop`
- `local_shell`：已补上命令分段评估、permissions-first 请求链路、更细的 sandbox/profile 决策，以及原生后台 shell run
- `task_parent_abort`：已接入 subagent/background shell 级联取消与 linked task 收口
- 子代理角色矩阵：已补回较完整的默认角色、说明和 allowlist

当前仍值得继续补强的，主要是：

- `grep / glob / lsp / web_search / file_history_*` 的结构化结果和错误语义继续向旧版靠拢
- 更完整的 shell profile/rule 资产沉淀与后台运行观测增强
- 更完整的任务扩展工具，如关键路径/批量调度/任务选择策略

## 总结结论

| 类别         | 旧工具           | v2 工具            | 结论                                                                                 | 优先级 |
| ------------ | ---------------- | ------------------ | ------------------------------------------------------------------------------------ | ------ |
| 文件写入     | `write_file`     | `write_file`       | 关键协议已恢复，仍需继续观察边界分支完整性                                           | P0     |
| 文件编辑     | `file_edit`      | `file_edit`        | recoverable conflict 已恢复，仍可继续补强更多旧版编辑启发式                          | P0     |
| 文件读取     | `file_read`      | `read_file`        | 名称、description、输出格式均漂移                                                    | P1     |
| Shell        | `bash`           | `local_shell`      | 分段评估、permissions-first 与后台执行已补强，但更完整规则资产与运行观测仍待继续完善 | P1     |
| 内容搜索     | `grep`           | `grep`             | description 和返回摘要信息变弱                                                       | P1     |
| 文件匹配     | `glob`           | `glob`             | 核心能力还在，但 description 和返回约定变弱                                          | P2     |
| 代码导航     | `lsp`            | `lsp`              | 核心能力基本保留，但输出与说明缩减                                                   | P2     |
| Web 抓取     | `web_fetch`      | `web_fetch`        | 关键安全与提取能力已恢复                                                             | P0     |
| Web 搜索     | `web_search`     | `web_search`       | 基本可用，但 description 和错误语义变弱                                              | P2     |
| 历史版本     | `file_history_*` | `file_history_*`   | 能力大体保留，但错误码与交互语义变弱                                                 | P2     |
| 子代理       | `agent`          | `spawn_agent` 等   | 角色矩阵已补强，linked-task 编排与 parent-abort 级联已接回                           | P1     |
| 任务体系     | `task_*`         | `task_*`           | 基础任务体系、图查询与 parent-abort 收口已原生迁移，后续补调度智能即可               | P1     |
| Skill        | `skill`          | `skill`            | 已迁移为 v2 原生工具                                                                 | P1     |
| 共享管理语义 | `ToolManager`    | `ToolOrchestrator` | 部分增强，但缺失策略回调、并发锁、默认 deny 语义                                     | P1     |

## 旧 description 的地位

旧版 description 来源于：

- `packages/core/src/agent/tool/tool-prompts.ts`

这些常量不只是“展示文本”，而是模型的使用手册，包含：

- 何时用这个 tool
- 何时不要用这个 tool
- 参数约束
- 推荐工作流
- 错误恢复方式
- 并行调用建议

建议规则：

1. v2 handler 的 `spec.description` 默认以旧 `tool-prompts.ts` 对应常量为基础。
2. 只有在工具名称或参数真的发生重设计时，才允许在旧 description 基础上做最小改写。
3. 不要把旧 description 简化成一句概述，否则模型行为质量会明显下降。

## 详细审计

### 1. `write_file`

映射关系：

- 旧：`packages/core/src/agent/tool/write-file.ts`
- 旧 agent 侧协议：`packages/core/src/agent/agent/write-file-session.ts`
- 旧缓冲实现：`packages/core/src/agent/agent/write-buffer.ts`
- 新：`packages/core/src/agent/tool-v2/handlers/write-file.ts`

旧版关键能力：

- 支持 `mode=direct/finalize`
- 支持 `bufferId`
- 内容超过 chunk 限制时先 buffer，再由 `finalize` 提交
- agent 侧可以在 tool call 参数流式生成失败时，通过 session 恢复为可 finalize 的协议输出
- 返回的是稳定 JSON 协议，包含：
  - `WRITE_FILE_PARTIAL_BUFFERED`
  - `WRITE_FILE_NEED_FINALIZE`
  - `WRITE_FILE_FINALIZE_OK`

当前 v2 状态：

- 只有一次性 `path + content` 原子写入
- 没有 `mode`
- 没有 `bufferId`
- 没有 agent 侧 write-file session 恢复链路
- 返回值从协议 JSON 退化成普通文本 `Wrote xxx`

结论：

- 这是最明确的功能回退，不是合理重写。
- 必须把“大 payload 缓冲 + finalize 协议 + agent 侧恢复”恢复到 v2。

建议：

- 保留 v2 的 handler / orchestrator 架构
- 在 v2 原生实现中重新引入 `direct/finalize/bufferId`
- `ToolHandlerResult.structured` 返回稳定协议对象，而不是只返回字符串

### 2. `file_edit`

映射关系：

- 旧：`packages/core/src/agent/tool/file-edit-tool.ts`
- 新：`packages/core/src/agent/tool-v2/handlers/file-edit.ts`

旧版关键能力：

- 推荐 workflow 明确写在 description 里
- `dry_run`
- 精确匹配失败后，会退到“trim/indent 容忍匹配”
- 冲突时返回 `EDIT_CONFLICT`
- 冲突元数据带有：
  - `recoverable`
  - `agent_hint`
  - `next_actions`

当前 v2 状态：

- 只有精确字符串匹配
- `dryRun` 改名但语义变简单
- 冲突时直接抛普通错误
- 缺少稳定 `EDIT_CONFLICT` 码和可恢复元数据

结论：

- 这同样是实质能力回退。
- 对 agent 来说，recoverable conflict 比“报错失败”重要得多。

建议：

- 恢复旧版的容错匹配逻辑
- 恢复 `EDIT_CONFLICT` 稳定错误码与 metadata
- description 保留旧版 workflow 指引

### 3. `file_read` -> `read_file`

映射关系：

- 旧：`packages/core/src/agent/tool/file-read-tool.ts`
- 新：`packages/core/src/agent/tool-v2/handlers/read-file.ts`

问题点：

- 工具名从 `file_read` 变成了 `read_file`
- 旧 description 强调：
  - 优先批量读取多个文件
  - 输出使用 `cat -n` 风格
  - 超长行截断
  - 可读图片
- v2 description 只有一句简述
- v2 输出改成 `L1: ...`
- v2 没有实现“超长单行截断”语义

结论：

- 这不是核心能力丢失，但属于模型交互协议漂移。
- 如果决定改名为 `read_file`，必须同步更新所有 agent prompt、角色工具集、文档和调用约束。

建议：

- 保留旧 description 的主体内容
- 明确决定是否接受 rename；若接受，需一次性全局统一
- 恢复旧的输出约定或至少在 description 中明确新的稳定格式

### 4. `bash` -> `local_shell`

映射关系：

- 旧：`packages/core/src/agent/tool/bash.ts`
- 新：`packages/core/src/agent/tool-v2/handlers/shell.ts`

v2 的增强点：

- profile / sandbox / policy 设计更好
- shell runtime 可替换
- 可表达 sandbox enforced / advisory / escalation

当前回退点：

- 旧 description 里“不要用 bash 做文件读写/搜索，要优先用专用工具”的约束消失
- 旧 `run_in_background` 能力消失
- 旧“不要自己加 `&`”等模型行为约束消失
- 旧默认输出截断与后台日志返回语义不再等价

结论：

- 架构升级是成立的，但不能丢掉模型使用规约和后台执行能力。

建议：

- 保留旧 description 主体，再补充 v2 的 profile / sandbox 说明
- 明确决定是否恢复后台执行；若不恢复，要给 agent 新的异步 shell 方案

### 5. `grep`

映射关系：

- 旧：`packages/core/src/agent/tool/grep.ts`
- 新：`packages/core/src/agent/tool-v2/handlers/grep.ts`

旧版关键点：

- description 明确要求优先使用 `grep`，不要经由 bash 跑 `rg`
- 结构化结果包含：
  - `countFiles`
  - `countMatches`
  - `results`
  - `truncated`
  - `timed_out`

当前 v2 状态：

- 仅返回 match rows
- 摘要统计信息大幅减少
- 参数名从 `timeout_ms/max_results` 变为 `timeoutMs/maxResults`

结论：

- 核心搜索能力仍在
- 但模型使用约束和结果摘要明显变弱

建议：

- description 回收旧版内容
- 结构化结果恢复文件数、匹配数、是否截断、是否超时

### 6. `glob`

映射关系：

- 旧：`packages/core/src/agent/tool/glob.ts`
- 新：`packages/core/src/agent/tool-v2/handlers/glob.ts`

当前差异：

- description 从多条使用建议缩成一句
- 参数从 `include_hidden/ignore_patterns/max_results` 变成 `includeHidden/ignore/maxResults`
- 旧版 metadata 包含 `relative_files`
- 新版只返回 `files` 对象列表和简单计数

结论：

- 能力基本还在
- 但说明和结果约定变弱

建议：

- 保留旧 description
- 恢复 `relative_files` 或明确新的稳定结构

### 7. `lsp`

映射关系：

- 旧：`packages/core/src/agent/tool/lsp.ts`
- 新：`packages/core/src/agent/tool-v2/handlers/lsp.ts`

当前差异：

- 核心操作仍是：
  - `goToDefinition`
  - `findReferences`
  - `hover`
  - `documentSymbols`
- 旧 description 更完整
- 旧输出更偏人类可读，带 kind/container 等辅助信息
- v2 输出更短

结论：

- 这是轻度缩减，不是严重回退

建议：

- description 直接沿用旧版
- structured 数据尽量保留旧版字段

### 8. `web_fetch`

映射关系：

- 旧：`packages/core/src/agent/tool/web-fetch.ts`
- 新：`packages/core/src/agent/tool-v2/handlers/web-fetch.ts`

旧版关键点：

- 默认 SSRF 防护，阻止：
  - localhost
  - 私网 IP
  - 云元数据地址
- 支持 `extractMode=text/markdown/html`
- 有显式响应大小上限

当前 v2 状态：

- 只支持 plain-text 提取
- 不再暴露 `extractMode`
- 依赖 `networkPolicy` 做主机控制
- 如果宿主把网络打开但没有 deny 内网地址，localhost/私网理论上可达
- 没有旧版那样的显式 5MB 响应体保护

结论：

- 这是安全语义回退，优先级很高。

建议：

- 即使有 `networkPolicy`，也应内建 SSRF denylist
- 恢复 `extractMode`
- 恢复响应大小上限

### 9. `web_search`

映射关系：

- 旧：`packages/core/src/agent/tool/web-search.ts`
- 新：`packages/core/src/agent/tool-v2/handlers/web-search.ts`

当前差异：

- 主能力基本一致
- description 被简化
- 旧版错误是工具域错误码，v2 多数直接抛普通错误

结论：

- 能力保留度较高
- 但错误契约和说明仍建议回收旧语义

### 10. `file_history_list` / `file_history_restore`

映射关系：

- 旧：`packages/core/src/agent/tool/file-history-list.ts`
- 新：`packages/core/src/agent/tool-v2/handlers/file-history-list.ts`
- 旧：`packages/core/src/agent/tool/file-history-restore.ts`
- 新：`packages/core/src/agent/tool-v2/handlers/file-history-restore.ts`

当前差异：

- 主能力基本保留
- description 被简化
- 旧版有更稳定的失败码：
  - `FILE_HISTORY_EMPTY`
  - `FILE_HISTORY_VERSION_NOT_FOUND`
  - `FILE_HISTORY_RESTORE_FAILED`
- v2 主要改成直接抛错误

结论：

- 核心能力在
- 错误语义和模型使用手册变弱

建议：

- 恢复旧 description
- 恢复稳定错误码

### 11. `agent` -> `spawn_agent / wait_agents / agent_status / cancel_agent`

映射关系：

- 旧：`packages/core/src/agent/tool/task.ts`，对模型暴露名为 `agent`
- 新：
  - `spawn_agent`
  - `wait_agents`
  - `agent_status`
  - `cancel_agent`

可接受的重构点：

- 将单工具拆为生命周期工具是合理的
- 运行器、角色、持久化分层是合理的

当前问题：

- 旧 description 是完整的“何时委派 / 不该何时委派 / 各角色适用场景 / 默认工具 allowlist”手册
- 新工具 description 只剩 API 级概述
- 默认角色集显著缩减：
  - 旧有 `Bash / general-purpose / Explore / Restore / Plan / research-agent / find-skills`
  - 新默认仅有 `general-purpose / research / planner`
- 新默认 `general-purpose` 允许工具过少，甚至没有 `file_edit`
- 旧的后台执行语义与 `task_output/task_stop` 链路没有完整迁移

结论：

- 架构拆分是对的，但能力矩阵和模型操作手册明显不足。

建议：

- 为 subagent 工具族补一层“模型使用手册型 description”
- 恢复合理的默认角色矩阵
- 至少补齐 `file_edit` 等基础工具到常用角色

### 12. 未迁移工具缺口

当前 `tool-v2` built-ins 中没有以下旧工具等价物：

- `task_create`
- `task_get`
- `task_list`
- `task_update`
- `task_stop`
- `task_output`
- `skill`

结论：

- 这些不是“同名弱化”，而是“当前完全缺口”。
- 如果目标是企业级完整 tool 系统，这些要么明确声明“暂不纳入 v2 范围”，要么继续迁移。

## 共享语义审计

### 已增强

- approval 流程更清晰
- permission grant 成为一等能力
- shell sandbox / profile / policy 分层更成熟
- 结果类型和执行事件更规范

### 当前缺口

#### 1. 并发锁语义缺失

旧版 `ToolManager` 支持：

- `getConcurrencyMode()`
- `getConcurrencyLockKey()`

例如：

- `task` 工具会按 namespace 加排它锁
- `file_read / glob / grep` 会按路径生成锁 key

v2 当前只有：

- `supportsParallel: boolean`

缺少“同类工具可并行，但同一资源要串行”的 keyed lock 语义。

这是共享能力回退。

#### 2. 外部策略回调缺失

旧版 `ToolManager.execute()` 支持 `onPolicyCheck`。

v2 目前有：

- approval
- permission request

但没有统一的“执行前策略审计/拦截”回调入口。

这对企业接入风控、审计、租户策略并不够。

#### 3. 默认安全策略不完全等价

旧版有：

- 内建危险 bash 规则
- 受限写目录前缀
- `auto-approve / auto-deny / manual`

v2 虽然有更好的 shell policy 体系，但仍存在：

- `web_fetch` 缺失默认 SSRF denylist
- 没有与旧版等价的通用 path deny 兜底
- `approvalPolicy='on-failure'` 还未实现

## 建议的恢复优先级

### P0

- 恢复 `write_file` 的 buffer / finalize / recoverable protocol
- 恢复 `file_edit` 的 `EDIT_CONFLICT` 语义和容错匹配
- 恢复 `web_fetch` 的默认 SSRF 防护和响应体上限

### P1

- 回收旧 description 到各 v2 handler
- 恢复 `agent` 工具族的角色矩阵和使用手册语义
- 补 keyed concurrency / policy interception
- 明确 `file_read` rename 策略并统一全局调用面
- 决定 `task_*` / `skill` 是否继续迁移

### P2

- 恢复 `grep / glob / lsp / file_history_* / web_search` 的结果语义与错误码
- 统一参数命名风格与模型提示

## 建议的实施顺序

1. 先修 `write_file`
2. 再修 `file_edit`
3. 然后修 `web_fetch`
4. 接着统一所有 handler description
5. 再补 subagent/tool orchestration 缺口
6. 最后补共享并发/策略语义和未迁移工具

## 最终判断

`tool-v2` 当前已经具备“企业级架构骨架”，但还没有达到“企业级工具能力完整度”。

现在最不合理的地方不是“用了新架构”，而是：

- 删除了旧工具中仍然非常关键的运行时协议
- 删除了对模型行为至关重要的 description
- 删除了一部分默认安全和恢复语义

下一步建议不是回退到旧体系，而是：

> 继续坚持 `tool-v2` 架构，同时把旧工具里真正有价值的能力语义一项项原生迁回 v2。

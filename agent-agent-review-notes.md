# Agent/Agent Review Notes

## Scope

- Target: `D:\work\renx-code\packages\core\src\agent\agent`
- Goal:
  - Analyze current architecture and code paths
  - Check logic rationality and simplification opportunities
  - Check test coverage gaps
  - Check exception and telemetry coverage
  - Propose refactor/optimization plan without changing behavior yet

## Inventory

- Main orchestration:
  - `index.ts`
  - `run-loop.ts`
  - `tool-runtime.ts`
- Streaming/message pipeline:
  - `message-utils.ts`
  - `tool-call-merge.ts`
  - `stream-events.ts`
  - `continuation.ts`
- Reliability/runtime:
  - `abort-runtime.ts`
  - `timeout-budget.ts`
  - `error.ts`
  - `error-normalizer.ts`
  - `callback-safety.ts`
  - `concurrency.ts`
  - `tool-execution-ledger.ts`
- Observability:
  - `telemetry.ts`
  - `logger.ts`
- Memory/write support:
  - `compaction.ts`
  - `write-buffer.ts`
  - `write-file-session.ts`

## Review Progress

- [x] Create working notes
- [x] Inventory responsibilities and data flow
- [x] Inspect orchestration path (`runStream` -> `run-loop` -> tool/llm)
- [x] Inspect error/abort/timeout model
- [x] Inspect telemetry/metric/span completeness
- [x] Inspect test mapping and gaps
- [x] List removable logic / duplication / over-complexity
- [x] Produce final architecture assessment and refactor proposals
- [x] Execute first implementation wave for `agent/agent`
- [x] Re-run workspace typecheck and tests after refactor

## Early Observations

- `index.ts` has improved a lot after extracting `run-loop.ts`, but it is still the aggregation point for many adapters/wrappers and remains a candidate for one more split later.
- `run-loop.ts` and `tool-runtime.ts` are now the two highest-complexity runtime modules and deserve the deepest inspection.
- `__test__/index.test.ts` is very large and acts as a catch-all regression suite; good for safety, but it also suggests production responsibilities are still somewhat coupled.

## Confirmed Findings

### Architecture / Maintainability

- `index.ts` still mixes three roles:
  - public agent facade
  - LLM stream assembly
  - dependency composition for sub-runtimes
- `createRunLoopDeps()` and `createToolRuntimeDeps()` are large dependency bags. This is workable, but it is more of a transitional extraction style than a clean long-term architecture.
- Constructor compatibility references like `void this.executeTool` are a smell caused by tests probing private methods. They keep tests green, but they also prove that internal design and test seam are not aligned yet.

### Logic / Behavior Risks

- `shared.ts` uses `hasNonEmptyText(value)` with `value.length > 0`, not `trim().length > 0`.
  - This affects:
    - `index.ts` empty assistant response validation
    - `tool-result.ts` output/summary selection
  - Result:
    - whitespace-only assistant output can be treated as valid content
    - whitespace-only tool output can be treated as meaningful output instead of falling back to summary
- `compaction.ts` generates the summary from `sourceMessages` (the full message list), not only from the compacted-out/pending portion.
  - This is not necessarily functionally wrong, but it duplicates recent active context in both:
    - the kept tail messages
    - the generated summary
  - Likely impact:
    - unnecessary summary token growth
    - weaker compaction efficiency over long sessions
- Retry path in `run-loop.ts` emits an `error` stream event before deciding whether to retry.
  - Current CLI already compensates for this and does not treat every stream `error` as terminal.
  - But for generic consumers this event semantics is easy to misuse.
  - This is a design sharp edge more than a confirmed product bug.

### Observability

- Error coverage is decent but not yet excellent:
  - run/tool/llm durations are metricized
  - spans are opened/closed for run, llm step, tool stage, tool execution
  - logs include contextual fields like executionId / stepIndex / errorCode
- Gaps:
  - there is no dedicated error counter metric by category / errorCode
  - callback failures are logged, but not separately metricized
  - compaction token fallback uses `console.warn` instead of structured logger
- `compaction.ts` contains garbled comments/encoding artifacts, which hurts maintainability and makes code review harder.

### Testing

- Test quantity is strong, but distribution is uneven.
- Strongly covered:
  - `index.ts`
  - timeout / abort / normalization / message utils
- Weaker direct coverage:
  - `run-loop.ts`
  - `continuation.ts`
  - `tool-runtime.ts`
  - `tool-result.ts`
- Current state relies heavily on indirect regression via `__test__/index.test.ts`.
  - Safe for now
  - Less ideal for future refactors because failures become harder to localize

## Implemented In This Wave

### Refactor execution

- Extracted LLM stream aggregation out of `StatelessAgent` into:
  - `D:\work\renx-code\packages\core\src\agent\agent\llm-stream-runtime.ts`
- Reworked runtime composition away from flat dependency bags into grouped runtime services:
  - `RunLoopRuntime`
  - `ToolRuntime`
- Added internal lifecycle hook seam:
  - `D:\work\renx-code\packages\core\src\agent\agent\runtime-hooks.ts`
  - purpose:
    - keep cross-cutting observability separate from control flow
    - make future extension possible without turning the core into a heavy plugin framework
- Reduced `StatelessAgent` responsibility to:
  - public API / facade
  - runtime dependency composition
  - shared adapter utilities
- Removed compatibility/test-only private wrappers from `index.ts`:
  - `convertMessageToLLMMessage`
  - `buildLLMRequestPlan`
  - `mergeToolCalls`
  - `callLLMAndProcessStream`
  - `executeTool`
  - `processToolCalls`
  - `resolveToolConcurrencyPolicy`
  - `runWithConcurrencyAndLock`
- Removed constructor no-op compatibility references that only existed to keep private-method probes alive.

### Logic fixes

- Unified textual emptiness semantics in `shared.ts`:
  - whitespace-only content no longer counts as meaningful assistant/tool output
- Removed dead internal fields / exports:
  - `LLMRequestPlan.llmMessages`
  - `CompactionLogger`
  - `toAgentErrorContract`

### Test reshaping

- Added focused runtime tests:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\tool-runtime.test.ts`
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\llm-stream-runtime.test.ts`
- Added direct loop-level exception boundary coverage:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\run-loop.test.ts`
  - covered:
    - retryable LLM failure triggers `onRunError` and `onRetryScheduled`
    - already-aborted execution short-circuits before entering LLM stage
- Added direct tests for lifecycle hook composition:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\runtime-hooks.test.ts`
- Moved coverage away from private-class-method probing toward module seams.
- Trimmed `index.test.ts` so it remains a regression suite, not the only way to validate internal agent behavior.

### Stability fixes outside `agent/agent`

- Fixed `task_stop` race:
  - `D:\work\renx-code\packages\core\src\agent\tool\task-stop.ts`
  - no longer preflights with `poll()` before `cancel()`
  - avoids accidental auto-completion side effects in runner implementations where polling advances state
- Tightened parent-abort cascade ordering:
  - `D:\work\renx-code\packages\core\src\agent\tool\task-parent-abort.ts`
  - cancel the subagent first, then reconcile linked task state
- Hardened lifecycle regression coverage:
  - `D:\work\renx-code\packages\core\src\agent\tool\__test__\task-run-lifecycle.test.ts`
  - wait for both agent run and linked task to converge before asserting cascade behavior
- Added extra task edge-case coverage:
  - `D:\work\renx-code\packages\core\src\agent\tool\__test__\task-tools-runtime-edges.test.ts`
    - `task_stop` when cancel returns a non-cancelled terminal run
  - `D:\work\renx-code\packages\core\src\agent\tool\__test__\task-parent-abort.test.ts`
    - linked task cancellation still happens when runner cancel returns `null`

## Current Architecture Assessment

- Current state is materially better than the earlier monolithic implementation:
  - the agent is more stateless
  - runtime responsibilities are more modular
  - tests align better with runtime seams
- `StatelessAgent` is now a reasonable enterprise-style facade, but not yet the final ideal form.
- The previous design compromise around `createRunLoopDeps()` / `createToolRuntimeDeps()` is now materially reduced.
- The current direction is better than introducing a generic external plugin system at this stage:
  - internal lifecycle hooks are enough for observability/extensibility
  - core control flow remains explicit and readable
  - we avoid premature plugin/container complexity
- Compatibility baggage inside `agent/agent` has been substantially reduced.
- Testability is now meaningfully healthier because key runtime logic is exercised directly.

## Cross-Project Comparison: `opencode`

### Core judgment

- `D:\work\opencode` is a mature session-centric product architecture.
- `D:\work\renx-code` should not copy it directly.
- The correct direction for `renx-code` remains:
  - small stateless execution kernel in `agent/agent`
  - external orchestration, projection, and audit in `agent/app`

### Structural differences

- `opencode` puts the execution center in session processing:
  - `D:\work\opencode\packages\opencode\src\session\processor.ts`
  - `SessionProcessor.create(...).process(...)` owns the main loop
- `renx-code` puts the execution center in the agent kernel:
  - `D:\work\renx-code\packages\core\src\agent\agent\run-loop.ts`

## Cross-Project Comparison: `codex` Compaction

### Files inspected

- `D:\work\codex\codex-rs\core\src\compact.rs`
- `D:\work\codex\codex-rs\core\src\compact_remote.rs`
- `D:\work\codex\codex-rs\core\src\codex.rs`
- `D:\work\codex\codex-rs\core\src\codex\rollout_reconstruction.rs`
- `D:\work\codex\codex-rs\core\tests\suite\compact.rs`
- `D:\work\codex\codex-rs\core\tests\suite\compact_remote.rs`
- `D:\work\codex\codex-rs\core\src\client.rs`

### What Codex actually does

- Codex does not use a local "emergency summary" fallback when model-based compaction fails.
- Local compaction path:
  - builds a summarization request
  - retries normal transient stream errors
  - if the compaction request itself exceeds context, it trims oldest history items and retries
  - if compaction still cannot fit with only one item left, it emits `ContextWindowExceeded` and stops the turn
  - if compaction generation fails for other reasons, it errors and stops the turn
- Remote compaction path:
  - calls provider-native history compaction
  - on failure, logs rich diagnostics and stops the turn
  - it does not synthesize a fake replacement summary to keep going

### Important Codex design choices

- Codex separates two failure classes:
  - context-window overflow during compaction request building
  - actual compaction generation failure
- For overflow, Codex uses bounded structural mitigation:
  - trim oldest history items
  - preserve newer suffix to help prefix-based cache locality
- For generation failure, Codex does not guess:
  - no synthetic summary
  - no silent no-op continuation
  - the current turn fails visibly

### Continuation / cache implications in Codex

- Codex explicitly comments that trimming from the beginning is to preserve prefix-based cache behavior while keeping recent messages intact.
- Codex binds compaction to `reference_context_item` management:
  - pre-turn/manual compaction clears the baseline so the next regular turn fully reinjects canonical context
  - mid-turn compaction can re-establish the baseline by reinjecting initial context before the last real user message
- This is important because Codex is not just replacing message arrays:
  - it is preserving the future request shape for continuation and context diffing
  - resume / rollback / replay all depend on persisted compaction replacement history plus turn-context baseline

### Resume / reconstruction behavior

- `replace_compacted_history(...)` persists:
  - replacement history
  - compacted item
  - optional `TurnContext`
- `rollout_reconstruction.rs` rebuilds history from the newest surviving compaction checkpoint plus later rollout items.
- Old compatibility handling still exists for legacy compaction records without replacement history, but the code comments clearly treat this as legacy baggage that can eventually be removed.

### Test evidence from Codex

- Local compaction tests explicitly assert:
  - pre-turn auto-compaction context-window failure causes the turn to error
  - manual compaction still produces a summary-only history when model output succeeds
  - mid-turn continuation compaction preserves tool artifacts and keeps the summary in the same turn
- Remote compaction tests explicitly assert:
  - parse / compaction failure stops the agent loop after compaction failure
  - no post-compaction continuation request is sent after failure

### What this means for `renx-code`

- Current `renx-code` emergency-summary fallback is not aligned with Codex.
- The Codex approach is safer and more honest:
  - bounded trimming for overflow
  - explicit failure for summary-generation failure
  - no fabricated summary that might hide loss of detail or produce hard-to-debug state drift
- If we want enterprise-grade behavior, the better direction is:
  - remove emergency synthetic summary fallback
  - distinguish "request too large" from "summary generation failed"
  - add bounded structural mitigation for oversized compaction input
  - if summarization still fails, stop compaction and surface an explicit error path instead of mutating history with guessed content

### Current recommendation

- Do not keep the current deterministic emergency summary in `packages/core/src/agent/agent/compaction-summary.ts`.
- Rework `renx-code` compaction around a clearer contract:
  - compaction may shrink pending input before requesting summary
  - compaction must never silently drop pending history
  - compaction must never fabricate durable history unless the product explicitly chooses that tradeoff
- After that, compaction v2 can be aligned with later continuation/cache refactor without carrying awkward fallback semantics forward.
  - `runAgentLoop(...)` is the main control-flow owner
- In `opencode`, `agent` means agent profile/config/prompt/permission bundle:
  - `D:\work\opencode\packages\opencode\src\agent\agent.ts`
- In `renx-code`, `StatelessAgent` is the runtime facade and composition root:
  - `D:\work\renx-code\packages\core\src\agent\agent\index.ts`

### What is worth learning from `opencode`

- Strong centralized tool assembly:
  - `D:\work\opencode\packages\opencode\src\tool\registry.ts`
  - clear single entry for built-in tools, plugin tools, and provider-facing tool lists
- Clear provider transform boundary around LLM interaction:
  - `D:\work\opencode\packages\opencode\src\session\llm.ts`
  - provider differences are normalized before the session processor consumes them
- Session/message modeling ideas may be reused at the app layer when needed:
  - but not moved into the stateless kernel

### What should not be copied

- Do not move the `renx-code` kernel into a session-centric architecture.
- Do not merge runtime, persistence, summaries, retries, and UI/event concerns into one loop owner.
- Do not create a provider mega-module like:
  - `D:\work\opencode\packages\opencode\src\provider\provider.ts`
- Do not redefine `hook` as a public behavior override mechanism.
  - Current preferred rule remains:
    - internal lifecycle hooks are for observation and audit
    - runtime policy extension should use explicit registry/policy/adapter seams

### Resulting architecture implication

- The next enterprise-grade step for `renx-code` is not "become more like `opencode`".
- The next step is:
  - keep the current kernel/app split
  - strengthen tool registry/composition discipline
  - keep provider adaptation behind stable interfaces
  - keep hook semantics append-only and observational
  - prevent product/session state from leaking back into the kernel

## Continuation/Cache Refactor Snapshot

### What changed

- Extracted request-config assembly for LLM/cache concerns into:
  - `D:\work\renx-code\packages\core\src\agent\agent\llm-request-config.ts`
- Responsibility split:
  - `message-utils.ts`
    - message filtering / message-to-provider conversion only
  - `llm-request-config.ts`
    - base config merge
    - prompt cache key defaulting
  - `continuation.ts`
    - server-side continuation planning only

### Continuation direction

- Continued to use the stateless metadata-based approach instead of introducing a session-bound transport cache.
- Kept the existing metadata contract:
  - `responseId`
  - `llmRequestConfigHash`
  - `llmRequestInputHash`
  - `llmRequestInputMessageCount`
  - `llmResponseMessageHash`
- Refactored continuation planning around an explicit request-state model:
  - current LLM-visible source messages
  - current request message projection
  - normalized non-input config hash
  - current full input hash/count

### Codex-inspired behavior now reflected

- `prompt_cache_key` remains tied to `conversationId` by default when the caller does not provide one.
- `previous_response_id` continuation still activates only when:
  - normalized non-input config matches
  - historical request input prefix matches
  - historical assistant response hash matches
- Candidate search is now more resilient:
  - invalid newer assistant metadata no longer forces an immediate fallback to full replay
  - planner can continue scanning older assistant baselines and reuse the latest valid one

### Why this matters

- This is closer to the `codex` principle:
  - keep cache routing stable
  - prefer safe continuation reuse
  - fall back to full replay when request shape is no longer trustworthy
- It does **not** yet change compaction behavior.
  - That remains intentionally deferred so continuation/cache can be stabilized first.

### Added verification

- Direct tests now cover:
  - fallback to an older reusable assistant baseline
  - prompt cache key default injection vs explicit override preservation
- Agent package validation rerun after the refactor:
  - `packages/core/src/agent/agent/__test__`: passed on rerun, `24` files / `266` tests green
  - one earlier Windows `rename EPERM` on `write-buffer.test.ts` reproduced as a transient environment flake and passed on isolated rerun + full rerun

## Validation Snapshot

- Latest validation after the runtime-composition split:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
  - all passing

## Latest Refactor Wave

### Runtime composition split

- Extracted runtime assembly out of:
  - `D:\work\renx-code\packages\core\src\agent\agent\index.ts`
- Into:
  - `D:\work\renx-code\packages\core\src\agent\agent\runtime-composition.ts`
  - `D:\work\renx-code\packages\core\src\agent\agent\observability-hooks.ts`

Result:

- `StatelessAgent` now mainly does:
  - public API entry
  - per-run state bootstrap
  - shared adapter bridging
- `index.ts` line count is now about `594`
  - much smaller than the earlier 1777-line version
  - still not the final target, but now within a maintainable facade range

### Hook boundary clarified

- Current hook model remains internal and observational.
- The default hook implementation is assembled by:
  - `D:\work\renx-code\packages\core\src\agent\agent\observability-hooks.ts`
- The composition utility still exists in:
  - `D:\work\renx-code\packages\core\src\agent\agent\runtime-hooks.ts`
- Current code does not expose a public behavior-override hook pipeline from `StatelessAgent` config.
- This is aligned with the preferred architecture direction:
  - hook = telemetry / audit / observation
  - behavior changes = explicit policy/registry/runtime seams

### Test improvements added in this wave

- Added direct tests for new composition boundaries:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\runtime-composition.test.ts`
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\observability-hooks.test.ts`
- These tests specifically protect:
  - tool schema normalization
  - hook reuse vs default hook creation
  - run-loop runtime grouping
  - run/tool observability metrics and structured logs

### Documentation updates

- Rewrote:
  - `D:\work\renx-code\packages\core\src\agent\agent\EXECUTION_FLOW.md`
- Reason:
  - previous content had visible encoding/garbling issues in terminal reads
  - the new version documents the current runtime split and hook semantics clearly

## Current Best Next Steps

- Continue shrinking:
  - `D:\work\renx-code\packages\core\src\agent\agent\tool-runtime.ts`
- Recommended split direction:
  - extract smaller stage-focused helpers first
  - avoid introducing generic plugin or hook magic
  - keep retry/abort decisions centralized in the loop
  - keep tool policy explicit at runtime boundaries

## Latest Refactor Wave 2

### Run-loop split

- Extracted stage execution into:
  - `D:\work\renx-code\packages\core\src\agent\agent\run-loop-stages.ts`
- Extracted loop control policy into:
  - `D:\work\renx-code\packages\core\src\agent\agent\run-loop-control.ts`

Effect:

- `run-loop.ts` now focuses on:
  - top-level orchestration
  - step advancement
  - done/max-step completion
  - final observation closeout
- `run-loop.ts` is now about `261` lines
  - down from about `493`

### New direct coverage

- Added:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\run-loop-control.test.ts`
- Covered:
  - pre-step max-retry termination
  - compaction before context-usage reporting
  - no-retry decision after a previous retry attempt

### Architecture outcome

- Retry, timeout, and abort policy are now isolated behind explicit helpers.
- Stage execution boundaries are clearer:
  - LLM stage execution
  - tool stage execution
  - loop policy/control
- This is a meaningful step toward an enterprise-grade stateless kernel:
  - explicit control flow
  - smaller, testable modules
  - no hook/plugin overdesign

## Latest Refactor Wave 3

### Tool-runtime split

- Extracted shared types into:
  - `D:\work\renx-code\packages\core\src\agent\agent\tool-runtime-types.ts`
- Extracted single-tool execution internals into:
  - `D:\work\renx-code\packages\core\src\agent\agent\tool-runtime-execution.ts`
- Extracted batch scheduling/orchestration into:
  - `D:\work\renx-code\packages\core\src\agent\agent\tool-runtime-batch.ts`

Effect:

- `tool-runtime.ts` now mainly keeps:
  - public exports
  - concurrency-policy resolution
  - thin delegation for `executeTool`
  - thin delegation for `processToolCalls`
- `tool-runtime.ts` is now about `132` lines
  - down from about `562`

### Extra edge coverage

- Added one more direct runtime boundary test in:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\tool-runtime.test.ts`
- Covered:
  - `write_file` partial-buffer protocol auto-finalize path inside agent runtime

### Architecture outcome

- Tool execution is now separated into:
  - policy and public boundary
  - single-call execution and ledger replay
  - multi-call batch orchestration
- This keeps the stateless kernel explicit while making future changes safer,
  especially around:
  - idempotent replay
  - write-file protocol recovery
  - concurrency waves and lock behavior

## Latest Refactor Wave 4

### Continuation split

- Extracted continuation hashing into:
  - `D:\work\renx-code\packages\core\src\agent\agent\continuation-hash.ts`
- Extracted continuation metadata parsing into:
  - `D:\work\renx-code\packages\core\src\agent\agent\continuation-metadata.ts`

Effect:

- `continuation.ts` now focuses on:
  - request plan construction
  - incremental/full continuation decision
  - assistant metadata write-back
- `continuation.ts` is now about `144` lines
  - down from about `247`

### New direct coverage

- Added:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\continuation.test.ts`
- Covered:
  - full request planning when continuation is disabled
  - incremental continuation planning when metadata matches
  - metadata write-back on assistant messages
  - malformed metadata rejection

### Priority note

- Per latest direction, `compaction.ts` is intentionally deferred and will be
  handled later as a focused refactor pass.

## Latest Refactor Wave 5

### Error-normalizer split

- Extracted provider error mapping into:
  - `D:\work\renx-code\packages\core\src\agent\agent\error-normalizer-mapping.ts`

Effect:

- `error-normalizer.ts` now focuses on:
  - top-level normalization entry
  - abort detection
  - retry delay calculation
- `error-normalizer.ts` is now about `105` lines
  - down from about `190`

### Outcome

- Provider code classification is now isolated from the public normalization
  entrypoint.
- This lowers the chance of accidental regressions when adding new upstream
  error codes or adjusting retryable classification.

- `pnpm --filter @renx-code/core typecheck` passed
- `pnpm --filter @renx-code/core test` passed
- `pnpm typecheck` passed
- `pnpm test` passed
- Current test snapshot:
  - core: 82 files, 1198 passed, 2 skipped
  - cli workspace tests: passed

## Remaining Optional Improvements

- If needed later, split observability hooks into smaller dedicated implementations:
  - metrics hook
  - trace/span hook
  - structured logging hook
- Add dedicated metric counters for:
  - retryable upstream errors
  - callback failures
  - compaction failures
- Remaining notable test opportunity:
  - direct tests for hook failure behavior if we later decide hooks must be isolated from the main control flow
- Revisit compaction summary scope:
  - summarize only removed history
  - or keep full-history summary intentionally and document it
- Consider direct unit coverage for `run-loop.ts` if future refactors become more aggressive.

## Proposed Refactor Directions

### Phase 1: Safe structural improvements

- Extract `callLLMAndProcessStream()` from `index.ts` into a dedicated module, for example:
  - `llm-stream-runtime.ts`
  - responsibilities:
    - stream chunk accumulation
    - assistant message assembly
    - tool_call merge integration
    - empty-response validation
- Keep `StatelessAgent` as the public facade and adapter layer only.

### Phase 2: Type and seam cleanup

- Replace large dependency bags with narrower runtime context objects:
  - `AgentObservability`
  - `AgentAbortRuntime`
  - `RunLoopServices`
  - `ToolRuntimeServices`
- Introduce test-friendly public/internal module seams instead of keeping private-method probing as a permanent constraint.

### Phase 3: Logic cleanup

- Unify text emptiness semantics:
  - one helper for `trim`-aware non-empty textual content
- Revisit compaction input:
  - decide intentionally whether summary should represent:
    - only removed history
    - or full history
  - then align implementation and tests to that decision
- Clarify stream error semantics:
  - either document that `error` can be non-terminal
  - or add a distinct retryable/intermediate error event

### Phase 4: Test improvement

- Add direct unit tests for:
  - `run-loop.ts`
  - `continuation.ts`
  - `tool-runtime.ts`
  - `tool-result.ts`
- Add edge-case tests for:
  - whitespace-only assistant output
  - whitespace-only tool output
  - compaction summary scope
  - retryable `error` event semantics

## Questions To Resolve

- Are all runtime failures surfaced both as stream events and telemetry/metrics?
- Is there any remaining dead compatibility code kept only for tests that should be reshaped instead of retained forever?
- Are continuation, compaction, timeout budget, and tool orchestration too tightly coupled at the agent layer?
- Do we have direct tests for the newly extracted `run-loop.ts`, or are we relying indirectly on `index.test.ts` only?

## Latest Refactor Wave 6

### Compaction v2 rewrite

- `D:\work\renx-code\packages\core\src\agent\agent\compaction.ts`
  - rewritten as a thin orchestration entrypoint
  - keeps public exports stable:
    - `compact(...)`
    - `estimateTokens(...)`
    - `estimateMessagesTokens(...)`
  - now focuses on only:
    - selecting the compaction window
    - generating or reusing the summary
    - rebuilding the final message list
- Added/used dedicated helper modules:
  - `D:\work\renx-code\packages\core\src\agent\agent\compaction-prompt.ts`
  - `D:\work\renx-code\packages\core\src\agent\agent\compaction-selection.ts`
  - `D:\work\renx-code\packages\core\src\agent\agent\compaction-summary.ts`

### Architectural decision

- Do not delete the `compaction.ts` entry file itself.
- Do delete the old mixed implementation style inside it.
- Do remove tiny one-call abstractions that do not improve reuse, such as
  `rebuildMessages()`.
- Rationale:
  - external imports stay stable
  - responsibility boundaries become explicit
  - prompt, selection, and summary parsing can evolve independently
  - the module is now easier to test without over-designing a plugin system
  - array rebuild order is simple enough to keep inline in `compact(...)`

### Behavior locked in by tests

- compaction summary request uses the dedicated long system prompt
- compacted summary message role is `user`
- summary generation only sees the messages that are about to be removed
- `<summary>...</summary>` is extracted from provider output
- previous summary is reused when no new pending history exists
- invalid or empty provider output falls back to the previous summary when available
- model and abort-signal options are only attached when valid

### Validation snapshot

- `pnpm vitest run packages/core/src/agent/agent/__test__/compaction.test.ts`
  - passed
- `pnpm vitest run packages/core/src/agent/agent/__test__/index.test.ts --testNamePattern "compact"`
  - passed
- `pnpm vitest run packages/core/src/agent/agent/__test__`
  - passed
  - current snapshot: 24 files / 268 tests passed

### Message util boundary cleanup

- `D:\work\renx-code\packages\core\src\agent\utils\message.ts`
  - public exports reduced to:
    - `contentToText(...)`
    - `processToolCallPairs(...)`
  - internal-only helpers no longer exported:
    - `stringifyContentPart(...)`
    - `getAssistantToolCalls(...)`
    - `getToolCallId(...)`
- compaction-specific helpers moved into:
  - `D:\work\renx-code\packages\core\src\agent\agent\compaction-selection.ts`
  - moved logic:
    - summary message detection
    - compaction window splitting
- Added direct coverage:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\compaction-selection.test.ts`
- Latest validation after this cleanup:
  - `pnpm vitest run packages/core/src/agent/agent/__test__`
    - passed
    - current snapshot: 25 files / 272 tests passed
  - `pnpm vitest run packages/core/src/agent/utils/__tests__`
    - passed
    - current snapshot: 4 files / 27 tests passed

### Summary-type normalization

- `D:\work\renx-code\packages\core\src\agent\agent\compaction-selection.ts`
  - summary detection no longer parses display text prefixes
  - summary messages are now identified by:
    - `message.type === 'summary'`
  - kept only one content-based concern:
    - stripping optional display prefixes from stored summary text
- Removed one production-unused field:
  - `sourceMessages`
  - reason:
    - it was only consumed by tests, not runtime logic
- `D:\work\renx-code\packages\core\src\agent\agent\compaction.ts`
  - deleted trivial token helpers:
    - `estimateMessageRoleTokens(...)`
    - `estimateMessageNameTokens(...)`
  - folded their logic into `estimateMessagesTokens(...)`
- Added/updated coverage:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\compaction-selection.test.ts`
    - summary type without prefix
    - Chinese summary prefix unwrap
- Latest validation after this cleanup:
  - `pnpm vitest run packages/core/src/agent/agent/__test__`
    - passed
    - current snapshot: 25 files / 273 tests passed

### Summary storage cleanup

- `D:\work\renx-code\packages\core\src\agent\agent\compaction-summary.ts`
  - summary messages now store pure summary content
  - removed:
    - `SUMMARY_PREFIX`
    - optional `preferredLanguage` request block
- `D:\work\renx-code\packages\core\src\agent\agent\compaction-selection.ts`
  - removed:
    - `unwrapStoredSummary(...)`
  - `previousSummary` now comes from the stored summary message content directly
- `D:\work\renx-code\packages\core\src\agent\agent\compaction.ts`
  - removed public surface that had no production callers:
    - `CompactResult.summaryMessage`
    - `CompactOptions.language`
- Test model updated:
  - summary assertions now inspect the summary message inside `result.messages`
  - stored summary fixtures no longer include display prefixes
- Validation after this pass:
  - `pnpm vitest run packages/core/src/agent/agent/__test__/compaction-selection.test.ts packages/core/src/agent/agent/__test__/compaction.test.ts packages/core/src/agent/agent/__test__/continuation.test.ts packages/core/src/agent/agent/__test__/index.test.ts`
    - passed
    - snapshot: 4 files / 64 tests passed
  - `pnpm vitest run packages/core/src/agent/agent/__test__`
    - passed
    - snapshot: 25 files / 273 tests passed

### Compaction facade cleanup

- `D:\work\renx-code\packages\core\src\agent\agent\compaction.ts`
  - removed overly granular summary helpers:
    - `buildSummaryRequestOptions(...)`
    - `readConfiguredModel(...)`
    - `createSummaryAbortSignal(...)`
    - `resolveSummaryFromResponse(...)`
  - summary request preparation and response normalization now live together in:
    - `generateSummary(...)`
  - result:
    - less helper hopping
    - less local indirection
    - easier to audit summary fallback behavior in one place
- Size snapshot:
  - `compaction.ts` down to about `202` lines

### Compaction failure safety fix

- `D:\work\renx-code\packages\core\src\agent\agent\compaction.ts`
  - compaction no longer fabricates a local fallback summary when model-based summary generation fails
  - compaction now distinguishes:
    - summary request too large for the estimated input budget
    - summary generation failure after a valid request is built
  - request-overflow mitigation now trims oldest pending messages before calling the provider
  - summary output budget is clamped to the provider's declared max output tokens
  - if the provider:
    - throws
    - returns an invalid payload
    - returns empty summary content
  - then compaction now:
    - logs a warning
    - throws
    - leaves it to the caller to preserve the original history without mutating it
- `D:\work\renx-code\packages\core\src\agent\agent\compaction-summary.ts`
  - removed deterministic fallback summary builder
  - file now only contains:
    - compaction request formatting
    - summary extraction
    - summary message creation
- This brings `renx-code` closer to Codex behavior:
  - compaction failure is explicit
  - durable history is never replaced with guessed summary content
- Added stronger coverage in:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\compaction.test.ts`
  - includes:
    - invalid response throws
    - thrown provider error throws
    - empty summary output throws while still preserving previous-summary request shape assertions
    - oversized compaction request trims oldest pending messages before generate
    - request still oversized after trimming throws before generate
- Validation after this safety fix:
  - `pnpm vitest run packages/core/src/agent/agent/__test__`
    - passed
    - snapshot: 25 files / 277 tests passed

### Compaction invocation cleanup

- `D:\work\renx-code\packages\core\src\agent\agent\index.ts`
  - `compactMessagesIfNeeded(...)` no longer returns a bare `string[]`
  - it now returns a structured compaction execution result:
    - `skipped`
    - `applied`
    - `failed`
  - `index.ts` now also passes the agent logger into `compact(...)`, so compaction-internal warnings are no longer dropped
- `D:\work\renx-code\packages\core\src\agent\agent\run-loop.ts`
  - added `CompactionExecutionResult` to make the run-loop contract explicit
- `D:\work\renx-code\packages\core\src\agent\agent\run-loop-control.ts`
  - no longer infers compaction state from `removedMessageIds.length`
  - emits compaction events only when compaction was actually applied
  - still reports context usage even when compaction failed and the caller kept the original messages
- Added direct coverage:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\run-loop-control.test.ts`
    - compaction failure does not emit a compaction event
    - context-usage callback still runs after compaction failure
- Validation after invocation cleanup:
  - `pnpm vitest run packages/core/src/agent/agent/__test__`
    - passed
    - snapshot: 25 files / 278 tests passed

### Compaction trigger policy cleanup

- Added:
  - `D:\work\renx-code\packages\core\src\agent\agent\compaction-policy.ts`
- This module now owns:
  - context-usage calculation for compaction decisions
  - compaction threshold evaluation
  - explicit policy reasons:
    - `disabled`
    - `below_threshold`
    - `threshold_reached`
- `D:\work\renx-code\packages\core\src\agent\agent\index.ts`
  - no longer computes compaction thresholds inline
  - no longer duplicates token estimation logic between:
    - `estimateContextUsage(...)`
    - compaction trigger decision
  - now delegates both concerns to `compaction-policy.ts`
- Added focused coverage:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\compaction-policy.test.ts`
  - covers:
    - disabled policy
    - below-threshold decision
    - threshold-reached decision
    - tool schema cost affecting context usage
- Validation after policy extraction:
  - `pnpm vitest run packages/core/src/agent/agent/__test__`
    - passed
    - snapshot: 26 files / 282 tests passed

### Dual prompt version support

- `D:\work\renx-code\packages\core\src\agent\agent\compaction-prompt.ts`
  - preserved the existing long-form prompt as `v1`
  - added a second production-oriented prompt as `v2`
  - added:
    - `CompactionPromptVersion`
    - `resolveCompactionSystemPrompt(version)`
- `D:\work\renx-code\packages\core\src\agent\agent\compaction.ts`
  - `CompactOptions` now accepts `promptVersion`
  - compaction resolves the system prompt through the version selector instead of hardcoding one prompt
- `D:\work\renx-code\packages\core\src\agent\agent\index.ts`
  - `AgentConfig` now accepts `compactionPromptVersion`
  - internal config defaults it to `v1`
  - current runtime behavior remains backward compatible because the default prompt version is unchanged
- Added coverage:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\compaction.test.ts`
    - default request still uses `v1`
    - explicit `promptVersion: 'v2'` switches the system prompt
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\index.test.ts`
    - default agent config passes `promptVersion: 'v1'`
    - agent config can pass `compactionPromptVersion: 'v2'`
- Validation after dual prompt support:
  - `pnpm vitest run packages/core/src/agent/agent/__test__`
    - passed
    - snapshot: 26 files / 284 tests passed

### V2 summary contract tightening

- `D:\work\renx-code\packages\core\src\agent\agent\compaction-summary.ts`
  - now treats `v1` and `v2` differently at the request/response contract level
  - `v1` remains compatibility-oriented:
    - existing request shape
    - permissive extractor that can fall back to trimmed plain text
  - `v2` is now stricter:
    - request body is wrapped in `<compaction_request version="v2">`
    - includes an explicit `<output_contract>` section
    - extractor requires a `<summary>...</summary>` block
    - plain text output is considered invalid for `v2`
- `D:\work\renx-code\packages\core\src\agent\agent\compaction.ts`
  - now passes prompt version through both request building and summary extraction
  - this means `v2` is enforced end-to-end instead of only swapping prompt text
- Added coverage:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\compaction.test.ts`
    - `v2` request contains the stricter envelope
    - `v2` extractor rejects plain text output
    - `v1` extractor remains permissive
- Validation after `v2` contract tightening:
  - `pnpm vitest run packages/core/src/agent/agent/__test__`
    - passed
    - snapshot: 26 files / 286 tests passed

### Compaction observability classification

- `D:\work\renx-code\packages\core\src\agent\agent\compaction.ts`
  - now exposes structured diagnostics for successful compaction results:
    - `outcome`
    - `reason`
    - `promptVersion`
    - `pendingMessageCount`
    - `activeMessageCount`
    - `trimmedPendingMessageCount`
    - `estimatedInputTokens`
    - `inputTokenBudget`
    - `summaryMaxTokens`
  - now throws a typed `CompactionError` for structured failure cases:
    - `request_oversized`
    - `invalid_response`
    - `empty_summary`
    - `provider_error`
- `D:\work\renx-code\packages\core\src\agent\agent\index.ts`
  - now logs compaction outcomes with explicit categories:
    - `[Agent] compaction.skipped`
    - `[Agent] compaction.applied`
    - `[Agent] compaction.failed`
  - `disabled` skip decisions are intentionally not logged to avoid noisy per-step logs when compaction is turned off
- `D:\work\renx-code\packages\core\src\agent\agent\run-loop.ts`
  - `CompactionExecutionResult` now carries:
    - `status`
    - `reason`
    - `diagnostics`
- Added coverage:
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\compaction.test.ts`
    - success diagnostics
    - typed failure reasons
    - skip diagnostics
  - `D:\work\renx-code\packages\core\src\agent\agent\__test__\index.test.ts`
    - structured applied log
    - structured failed log
- Validation after observability classification:
  - `pnpm vitest run packages/core/src/agent/agent/__test__`
    - passed
    - snapshot: 26 files / 286 tests passed

## Latest Analysis: Continuation / Cache vs Summary

### Scope inspected

- `D:\work\renx-code\packages\core\src\agent\agent\continuation.ts`
- `D:\work\renx-code\packages\core\src\agent\agent\continuation-hash.ts`
- `D:\work\renx-code\packages\core\src\agent\agent\continuation-metadata.ts`
- `D:\work\renx-code\packages\core\src\agent\agent\llm-stream-runtime.ts`
- `D:\work\renx-code\packages\core\src\agent\agent\llm-request-config.ts`
- `D:\work\renx-code\packages\core\src\agent\agent\compaction-selection.ts`
- `D:\work\renx-code\packages\core\src\agent\agent\compaction-summary.ts`
- `D:\work\renx-code\packages\core\src\agent\utils\message.ts`

### Conclusion

- There is no strong hidden coupling today between:
  - `prompt_cache_key`
  - `previous_response_id`
  - compaction prompt text / summary XML format
- Continuation and cache are still intentionally coupled to the final LLM-visible
  message list.
  - This is expected and correct in a stateless design.
  - Once compaction rewrites history, continuation metadata must be based on the
    rewritten history, not the pre-compaction raw history.

### What is explicit and acceptable

- `continuation.ts` hashes the full LLM-visible message projection:
  - `shouldSendMessageToLLM(...)`
  - `convertMessageToLLMMessage(...)`
  - `hashValueForContinuation(llmMessages)`
- Summary messages are therefore part of:
  - request-input hash
  - prefix matching
  - future continuation eligibility
- This is not accidental coupling.
  - It is the core stateless continuation contract:
    "if the exact provider-visible prefix changed, reuse of old response ids is
    no longer trusted."

### Remaining mild implicit coupling

- `compaction-selection.ts` still protects the latest raw turn by scanning
  `role === 'user'`, not by a stricter semantic check.
- Because summary messages are also stored as:
  - `role: 'user'`
  - `type: 'summary'`
- this means summary messages still participate in the "find latest user"
  heuristic even though they are not real user turns.
- In normal runtime flow this is usually harmless because the latest real user
  message should still be newer than the summary.
- But conceptually this is still a role-level implicit coupling and is the main
  leftover place worth tightening later.

### What is not coupled

- `prompt_cache_key`
  - only defaults from `conversationId`
  - it does not inspect summary content, summary type, or compaction prompt
- continuation config hash
  - excludes only transport/runtime-only fields like:
    - `abortSignal`
    - `previous_response_id`
  - it does not special-case summary messages at all
- summary extraction
  - only affects stored summary content
  - continuation does not parse `<summary>` blocks
  - it only sees the resulting `Message`

### Residual risk

- Provider-side prefix cache locality will naturally change after compaction
  because the prefix itself changes from raw history to:
  - `system`
  - `summary`
  - active suffix
- That is an expected tradeoff, not a local bug.
- The larger practical risk right now is test coverage:
  - current continuation tests do not directly assert behavior with a
    compaction-produced `type: 'summary'` message in history
  - current cache tests do not directly assert that compaction does not mutate
    prompt-cache-key behavior

### Recommended next tests

- Add a continuation test where history already contains:
  - one summary message
  - one reusable assistant baseline created after compaction
  - one new follow-up user message
- Assert:
  - continuation still reuses `previous_response_id`
  - request delta excludes already-baselined summary/history
- Add a compaction-selection test proving latest-user protection ignores
  `type: 'summary'` if we later tighten that heuristic.

## Latest Refactor Wave: Step-Level Compaction Preparation

### What changed

- Added:
  - `D:\work\renx-code\packages\core\src\agent\agent\step-compaction.ts`
- Responsibility moved out of:
  - `D:\work\renx-code\packages\core\src\agent\agent\index.ts`
- Into a dedicated step-preparation module that now owns:
  - compaction trigger evaluation
  - compaction execution
  - compaction outcome logging
  - post-compaction context-usage calculation

### Runtime contract change

- `run-loop` no longer asks for two separate message operations:
  - `compactIfNeeded(...)`
  - `estimateContextUsage(...)`
- It now asks for one step-level operation:
  - `prepareForLlmStep(...)`
- This keeps the compaction timing decision in the run-loop control boundary,
  which is closer to the Codex model:
  - loop/control layer decides when compaction should run
  - compaction module only executes compaction
  - facade only wires dependencies

### Why this is better

- `index.ts` is less policy-heavy.
- `run-loop-control.ts` now owns the entire "before LLM request" preparation
  sequence in one place.
- Future timing changes such as:
  - alternate pre-step compaction rules
  - model-switch-specific compaction policy
  - follow-up-step-specific preparation
    can now be implemented without pushing orchestration logic back into the
    facade.

### Validation

- `pnpm vitest run packages/core/src/agent/agent/__test__`
  - passed
  - snapshot: 26 files / 286 tests passed
- `pnpm --filter @renx-code/core typecheck`
  - passed

## Runtime User Input Injection

### Goal

- Support app-layer runtime insertion of new `user` messages while an agent run
  is still active.
- Keep `StatelessAgent` stateless.
- Only consume late input at safe loop boundaries.
- Do not interrupt an in-flight LLM or tool stage.

### Implemented shape

- Added pending-input adapter surface in:
  - `D:\work\renx-code\packages\core\src\agent\types.ts`
- Added durable pending queue support in:
  - `D:\work\renx-code\packages\core\src\agent\app\sqlite-agent-app-store.ts`
- Added app orchestration API and active-run registry in:
  - `D:\work\renx-code\packages\core\src\agent\app\agent-app-service.ts`
- Added safe-boundary drain logic in:
  - `D:\work\renx-code\packages\core\src\agent\agent\run-loop-control.ts`
- Added terminal follow-up continuation check in:
  - `D:\work\renx-code\packages\core\src\agent\agent\run-loop.ts`

### Architectural decisions

- Runtime input orchestration stays in `agent/app`, not in core agent state.
- `run-loop-control.ts` drains pending input before each LLM step.
- `run-loop.ts` checks for pending input before emitting final `done`.
- Consumed late input is emitted as a formal `user_message` stream event.
- Existing event store and message projection pipeline is reused.
- App service keeps an in-memory active-run registry only for acceptance and
  lifecycle coordination.
- Pending input persistence uses sqlite FIFO queue:
  - `pending_run_inputs`

### Tests added

- `packages/core/src/agent/app/__test__/sqlite-agent-app-store.test.ts`
  - verifies pending input enqueue, FIFO drain, empty-after-drain behavior
- `packages/core/src/agent/app/__test__/agent-app-service.test.ts`
  - verifies active-run append success
  - verifies inactive-run rejection
  - verifies conversation mismatch rejection
  - verifies consumed runtime input becomes formal `user_message`
- `packages/core/src/agent/agent/__test__/run-loop.test.ts`
  - verifies pre-step drain emits `user_message`
  - verifies terminal stop defers to follow-up loop when pending input exists

### Validation

- `pnpm --filter @renx-code/core typecheck`
  - passed
- `pnpm vitest run packages/core/src/agent/app/__test__`
  - passed
  - snapshot: 3 files / 25 tests passed
- `pnpm vitest run packages/core/src/agent/agent/__test__`
  - passed
  - snapshot: 26 files / 288 tests passed

### CLI/runtime follow-up integration

- Added runtime API in:
  - `D:\work\renx-code\packages\cli\src\agent\runtime\runtime.ts`
  - new export: `appendAgentPrompt(...)`
- Added runtime follow-up event in:
  - `D:\work\renx-code\packages\cli\src\agent\runtime\types.ts`
  - new handler: `onUserMessage`
- Updated runtime abstraction types in:
  - `D:\work\renx-code\packages\cli\src\agent\runtime\source-modules.ts`
- Updated chat UI orchestration in:
  - `D:\work\renx-code\packages\cli\src\hooks\use-agent-chat.ts`
  - running session now accepts follow-up input instead of hard-blocking on
    `isThinking`
  - optimistic follow-up turns are queued
  - when runtime emits consumed `user_message`, subsequent streaming output is
    switched to the new turn
- Updated stream routing helper in:
  - `D:\work\renx-code\packages\cli\src\hooks\agent-event-handlers.ts`
  - turn selection is now dynamic via `getTurnId()`

### CLI validation

- `pnpm --filter @renxqoo/renx-code typecheck`
  - passed
- `pnpm --filter @renxqoo/renx-code exec vitest run src/agent/runtime src/hooks/use-agent-chat.test.ts src/hooks/agent-event-handlers.test.ts src/hooks/use-agent-chat.status.test.ts src/hooks/use-agent-chat.context.test.ts`
  - passed
  - snapshot: 12 files passed / 39 tests passed / 2 todo

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

## Validation Snapshot

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

# Agent Target Architecture

## Goal

This document defines the target architecture for:

- `D:\work\renx-code\packages\core\src\agent\agent`

The goal is to evolve the current implementation into a clean enterprise-grade
stateless agent runtime that:

- keeps the existing tech stack
- keeps behavior stable
- stays readable and practical
- avoids overdesign
- remains easy to extend for future platforms

This document is intentionally based on the current `renx-code` architecture,
not on a full rewrite.

## Design Position

`renx-code` should keep a "small kernel + clear outer layers" design.

It should not become a giant `agents/` platform bucket like some larger
projects. Instead:

- `agent/agent` is the execution kernel
- `agent/app` is the application orchestration and projection layer
- `agent/tool` is the tool contract and tool runtime layer
- `providers` is the model provider integration layer

This gives us a stable core while still allowing future growth.

## What To Learn From OpenClaw

Useful ideas to keep:

- separate application orchestration from the execution kernel
- keep tool assembly outside the main agent loop
- keep memory, provider, and workspace concerns outside the core loop
- support multiple execution modes through composition, not conditionals spread everywhere

What not to copy directly:

- one huge `agents` domain bucket containing too many unrelated concerns
- mixing provider/model/auth/workspace/sandbox logic into one oversized runtime area
- letting the execution kernel absorb product-level orchestration

## What To Learn From Opencode

Useful ideas to keep:

- use one clear tool assembly boundary rather than scattering tool selection logic
- keep provider adaptation near the LLM integration boundary
- keep agent definition/config separate from the execution loop owner

What not to copy directly:

- a session-centric execution kernel
- persistence and message-part mutation inside the core runtime loop
- oversized provider platform modules that combine too many concerns

Concrete comparison:

- `opencode` main loop lives in:
  - `D:\work\opencode\packages\opencode\src\session\processor.ts`
- `renx-code` main loop should continue to live in:
  - `D:\work\renx-code\packages\core\src\agent\agent\run-loop.ts`
- `opencode` tool composition is centralized in:
  - `D:\work\opencode\packages\opencode\src\tool\registry.ts`
- `renx-code` should adopt this discipline without adopting the session-centric runtime model

## Current Renx-Code Strengths

The current direction is already good:

- `StatelessAgent` is a focused facade
- `run-loop.ts` owns control flow
- `llm-stream-runtime.ts` owns stream aggregation
- `tool-runtime.ts` owns tool execution behavior
- `agent/app` already acts as the external observability and audit integration layer

This is the right foundation to continue from.

## Target Layering

### 1. Execution Kernel

Location:

- `agent/agent`

Responsibilities:

- step loop
- LLM stage orchestration
- tool stage orchestration
- retry / timeout / abort policy
- stream event emission
- internal lifecycle observation hooks

Must not own:

- persistence
- app projections
- UI-facing event storage
- session business policy
- product-specific routing

### 2. Application Layer

Location:

- `agent/app`

Responsibilities:

- run record persistence
- event projection
- metric / trace / log fan-out
- external callback integration
- application-facing result assembly

This layer is the correct place for external observability and audit behavior.

### 3. Tool Layer

Location:

- `agent/tool`

Responsibilities:

- tool definitions
- tool manager
- task tools
- tool security policy
- tool-specific protocol handling

The execution kernel may call tools, but should not absorb tool business logic.

### 4. Provider Layer

Location:

- `providers`

Responsibilities:

- model API adaptation
- request/response normalization
- provider capability differences

Provider details should stay behind stable runtime contracts.

## Target Internal Structure For `agent/agent`

Recommended target structure:

```text
agent/
  agent/
    index.ts
    run/
      run-loop.ts
      llm-stage.ts
      tool-stage.ts
      runtime-hooks.ts
      timeout-budget.ts
      abort-runtime.ts
    llm/
      llm-stream-runtime.ts
      continuation.ts
      tool-call-merge.ts
      message-utils.ts
    tool-execution/
      tool-runtime.ts
      concurrency.ts
      tool-execution-ledger.ts
      tool-result.ts
      write-file-session.ts
    observability/
      telemetry.ts
      logger.ts
      callback-safety.ts
      stream-events.ts
    shared/
      error.ts
      error-normalizer.ts
      shared.ts
    EXECUTION_FLOW.md
    TARGET_ARCHITECTURE.md
```

This is a target shape, not a mandatory one-shot move.

## Why This Structure

### `run/`

Purpose:

- hold control-flow-centric runtime logic

Reason:

- the step loop, stage transitions, abort scopes, and lifecycle hooks all belong
  to the same orchestration domain

### `llm/`

Purpose:

- hold message transformation and stream aggregation logic

Reason:

- continuation, message normalization, stream assembly, and tool-call merge are
  all model-interaction concerns

### `tool-execution/`

Purpose:

- hold execution-time tool runtime behavior

Reason:

- ledger, concurrency, replay, write-file compensation, and tool result shaping
  are one cohesive domain

### `observability/`

Purpose:

- hold telemetry and runtime-safe logging abstractions

Reason:

- these are cross-cutting concerns, but they should still have a clear home and
  stay out of orchestration files

### `shared/`

Purpose:

- hold truly small shared runtime primitives only

Rule:

- if a utility belongs clearly to `llm`, `tool-execution`, `run`, or
  `observability`, it should not live in `shared`

## Hook Design Position

The existing lifecycle hook design should remain internal to the execution
kernel.

Current position:

- internal runtime hooks define observation boundaries
- external integrations should continue to use `AgentCallbacks` and `agent/app`

This means:

- internal hooks: for metrics, tracing, internal logging, audit skeletons
- external callbacks: for app integration, persistence, streaming projection,
  external observability sinks

Do not turn internal runtime hooks into a full public plugin system yet.

Important clarification:

- external hook input must not replace internal default hooks
- external behavior extensions should compose with defaults, not override them
- hooks are for observation, audit, tracing, and metrics
- runtime policy changes should use explicit runtime contracts instead of hook side effects

## Why Hooks Should Stay Internal For Now

Reasons:

- current external needs are already covered well by `agent/app`
- public hooks increase support surface and compatibility burden
- hook misuse could let external code creep into control-flow policy
- a public plugin bus would be heavier than the current project needs

If external hook injection is ever added later, the default rule should be:

- append custom hooks
- never replace internal default hooks by default

## Statelessness Rules

The target runtime should remain stateless at the process level.

Allowed in-memory state:

- per-run ephemeral state
- local stream aggregation buffers
- per-run write-file buffering
- per-run abort scopes

Not allowed as correctness dependencies:

- process-local tool execution truth
- process-local run recovery truth
- process-local durable checkpoint truth

This is why the ledger and persistence-facing behaviors must remain injectable.

## Boundary Rules

### `StatelessAgent`

Should own:

- public entrypoint
- runtime composition
- shared adapter wiring

Should not grow into:

- a large business orchestrator
- a persistence service
- a plugin registry
- a tool policy engine

### `run-loop.ts`

Should own:

- control-flow decisions
- retry policy application
- terminal outcome decisions

Should not own:

- provider-specific request shaping
- tool-specific protocol details
- persistence side effects
- session truth or message storage truth

### `agent/app`

Should own:

- external-facing run orchestration
- event and usage projection
- storage integration

Should not leak back into:

- core retry semantics
- low-level tool execution semantics

## Migration Strategy

This should be done in small safe phases.

### Phase 1: Directory Shaping Without Behavior Change

Actions:

- create subdomain directories under `agent/agent`
- move files into `run`, `llm`, `tool-execution`, `observability`, `shared`
- keep exports stable

Success criteria:

- no behavior change
- imports stay understandable
- tests remain green

### Phase 2: Clarify Composition Boundaries

Actions:

- shrink `index.ts` further
- keep only facade and runtime assembly there
- move stage-specific assembly closer to each domain
- replace broad composition helpers with narrower policy/adapter objects where helpful

Success criteria:

- `index.ts` becomes clearly readable as the kernel composition root

### Phase 3: Harden Runtime Contracts

Actions:

- keep type definitions centralized
- remove repeated type shapes
- make stage contracts explicit and minimal
- separate observational extension points from behavioral extension points

Success criteria:

- fewer duplicated param types
- clearer ownership of shared interfaces
- hook semantics remain safe and non-ambiguous

### Phase 4: Strengthen Test Shape

Actions:

- keep direct tests close to runtime seams
- avoid private-method probing
- expand exception and boundary coverage where needed

Success criteria:

- tests explain architecture instead of fighting it

## Testing Expectations

Architecture work is only accepted if:

- `typecheck` passes
- core tests pass
- edge-case behavior remains covered

Priority test areas:

- retry and error classification
- timeout and abort propagation
- empty LLM response handling
- tool replay and ledger behavior
- write-file buffered finalize behavior
- lifecycle hook safety

## What "Excellent" Looks Like

An excellent final shape for `renx-code` is:

- smaller execution kernel
- stronger boundaries
- cleaner type ownership
- observable but not over-engineered
- easy to extend with new providers and tools
- easy to embed in multiple application surfaces

The target is not maximum abstraction.

The target is:

- minimal architecture that stays correct under growth

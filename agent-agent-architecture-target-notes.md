# Agent Architecture Target Notes

- Created target architecture blueprint:
  - `D:\work\renx-code\packages\core\src\agent\agent\TARGET_ARCHITECTURE.md`
- Direction:
  - keep `agent/agent` as execution kernel
  - keep `agent/app` as external orchestration and observability integration layer
  - avoid turning core into a large platform bucket like `openclaw/src/agents`
- Suggested future internal subdomains:
  - `run/`
  - `llm/`
  - `tool-execution/`
  - `observability/`
  - `shared/`
- Hook position:
  - internal lifecycle hooks remain internal
  - external integrations continue through `agent/app` callbacks
- Migration strategy:
  - first reshape directories without behavior change
  - then shrink `index.ts`
  - then tighten shared runtime contracts
  - then strengthen tests around new seams

## Added after comparing `opencode`

- `opencode` should be treated as a reference project, not as a template to copy.
- Key comparison outcome:
  - `opencode` is session-centric
  - `renx-code` should remain kernel-centric and stateless
- Borrow:
  - centralized tool registry/composition discipline
  - clear provider transform boundary
  - clean separation between agent definition and runtime loop ownership
- Avoid:
  - putting persistence/session/message truth inside the execution kernel
  - oversized provider mega-modules
  - turning hooks into public behavior override points

## Target architecture revision checklist

- Keep `agent/agent` as the only execution-kernel domain.
- Keep `agent/app` as the only place for:
  - event projection
  - persistence integration
  - audit fan-out
  - app-facing orchestration
- Introduce or strengthen one explicit tool composition entry:
  - registry
  - catalog
  - or assembler
- Keep provider capability normalization before entering the run loop.
- Keep lifecycle hooks append-only and observational by default.
- Prefer explicit runtime policy objects over broad dependency bags.
- Keep shared TS types centralized and avoid repeated request/context shapes.
- Expand direct tests around:
  - run-loop
  - tool-runtime
  - retry boundaries
  - abnormal provider/tool behavior

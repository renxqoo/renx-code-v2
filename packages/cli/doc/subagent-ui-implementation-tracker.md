# Subagent UI Implementation Tracker

## Goal

Track concrete implementation progress for the CLI subagent UI redesign in `packages/cli`, so long-running work stays aligned with `doc/subagent-ui-redesign.md`.

## Current Direction

- Keep the UI run-centric.
- Preserve low-noise default conversation cards.
- Use the task panel as a runs summary, not a full detail surface.
- Use `RunInspector` for timeline/artifacts/debug detail.

## Completed So Far

- Subagent runs render as `RunCard` in the conversation stream.
- `TaskPanel` shows active / blocked / recent finished runs.
- `RunInspector` exists with `Meta` / `Timeline` / `Artifacts` / `Debug` tabs.
- Clicking `[I 详情]` on a run card selects the run and opens the inspector.
- Clicking `[A 产物]` on a completed/terminal run card selects the run and opens `RunInspector` directly on `Artifacts`.
- `useRunInspector.open(tab?)` can now target a specific tab.
- Footer hints now expose both `i inspector` and `a artifacts`.
- Keyboard shortcuts now support:
  - `i` to open the selected run in inspector
  - `a` to open the selected run directly on artifacts when available
- `RunInspector` meta view is more structured:
  - `runId`
  - `status`
  - `role`
  - `task`
  - `updated`
  - timeline/highlight/artifact counts
  - latest status
- Running `RunCard` default state is now lower-noise:
  - no `Status` / `Recent` / `Warnings` section headers while running
  - no artifact availability shown while still running
- Expanded running `RunCard` now shows structured sections:
  - `status`
  - `recent updates`
  - `outcome`
  - `artifacts`
- `TaskPanel` selected summary label is now `Current` instead of `Selected`.
- Subagent run projection now parses runtime-shaped tool results that place run records in `result.data.structured`, not only `result.data.payload`.
- Multi-agent replies now keep parent tool cards visible while correctly rendering multiple run cards from runtime-shaped `spawn_agent` / `wait_agents` results.

## Important Constraints

- Do not reintroduce conversation-level run injection into `AssistantReply` ordering.
- Prefer minimal prop threading over broad state rewrites.
- Keep default conversation concise; expanded card and inspector can be richer.
- Validate TSX UI changes with `bun test --preload ./test/setup-dom.ts ...`.

## Current Gaps

- `RunInspector` still does not provide artifact list focus/selection mechanics like the redesign sketch.
- Expanded `RunCard` still uses raw timeline text instead of richer typed timeline rows.
- `TaskPanel` still uses the old component shell and has not fully evolved into a dedicated `RunsSummaryPanel` component.
- Focus management is still implicit; there is not yet a first-class conversation/runs/prompt focus model.
- Reply state still relies on live `segments -> buildReplyRunProjection()` derivation; `reply.runProjections` / `reply.hiddenToolCallIds` are not yet persisted as a first-class cache, so future runtime-shape drift can still regress rendering if tests do not cover it.

## Next High-Value Steps

1. Add artifact selection mechanics inside `RunInspector` `Artifacts`.
2. Improve timeline rows so `RunCard` and inspector can present typed events more clearly.
3. Evolve `TaskPanel` toward a more explicit `RunsSummaryPanel` layout.
4. Introduce a clearer focus model across conversation / runs / prompt.
5. Consider persisting `reply.runProjections` / `reply.hiddenToolCallIds` from live events so the conversation UI is less dependent on fragile segment-shape re-parsing.

## Verification Commands

- `pnpm exec bun test --no-cache --preload ./test/setup-dom.ts <tsx-tests...>`
- `pnpm exec tsc -p tsconfig.json --noEmit`

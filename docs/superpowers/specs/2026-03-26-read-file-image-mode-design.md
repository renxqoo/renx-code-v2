# 2026-03-26 read_file image-mode prompt wording design

## Goal

Align `read_file` documentation with the implemented behavior introduced in the runtime: when `mode: "image"` is used, `startLine` and `limit` are accepted but ignored rather than rejected.

## Current context

- Runtime behavior now reads images successfully even if `startLine` or `limit` are present.
- The runtime description still says only that image mode is supported, without clarifying slicing behavior.
- The model-facing prompt description also documents line slicing generically, which can imply the same semantics apply to image mode.
- The schema field descriptions for `startLine` and `limit` do not mention that they are text-mode-only in effect.

## Affected files

- `packages/core/src/agent/tool-v2/handlers/read-file.ts`
- `packages/core/src/agent/tool-v2/tool-prompts.ts`

## Options considered

### Option A: Update only the high-level descriptions

- Add one sentence to the runtime tool description and the model-facing prompt.
- Pros: minimal change.
- Cons: schema field descriptions remain incomplete.

### Option B: Update descriptions and add wording tests

- Adds regression coverage around text descriptions.
- Pros: stronger drift protection.
- Cons: higher maintenance cost for limited value.

### Option C: Update descriptions plus schema field descriptions

- Clarify in both high-level descriptions and field-level schema docs that `startLine` and `limit` apply to text reads and are ignored in image mode.
- Pros: most consistent with implementation and least ambiguous to callers.
- Cons: slightly broader doc-only surface area.

## Recommended design

Use Option C.

### Planned wording direction

- In `packages/core/src/agent/tool-v2/handlers/read-file.ts`, update the usage bullets to state that `startLine` and `limit` apply to text mode and are ignored in image mode.
- In the same file, update the `startLine` and `limit` schema descriptions to explicitly say they are only used for text reads.
- In `packages/core/src/agent/tool-v2/tool-prompts.ts`, update the prompt wording to say line slicing is for text files and that image mode ignores `startLine` and `limit`.

## Non-goals

- No behavior change.
- No schema shape change.
- No new validation logic.

## Risks

- Very low risk; scope is documentation and prompt wording only.
- Small wording drift risk remains if other duplicated descriptions exist elsewhere.

## Verification

- Re-read the edited files to confirm wording is consistent.
- Run targeted tests covering the existing `read_file` behavior to ensure no accidental code drift.

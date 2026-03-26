# read_file Prompt Wording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `read_file` descriptions with the existing runtime behavior so image mode clearly ignores `startLine` and `limit`.

**Architecture:** This is a doc-and-prompt alignment change only. Update the runtime tool description, the `startLine` and `limit` schema field descriptions, and the model-facing prompt wording to describe text-mode slicing accurately while keeping behavior unchanged.

**Tech Stack:** TypeScript, Zod, Vitest

---

### Task 1: Update runtime `read_file` descriptions

**Files:**

- Modify: `packages/core/src/agent/tool-v2/handlers/read-file.ts`
- Test: `packages/core/src/agent/tool-v2/__test__/tool-system.test.ts`

- [ ] **Step 1: Read the current runtime description and schema field text**

Read `packages/core/src/agent/tool-v2/handlers/read-file.ts` and locate:

- `READ_FILE_TOOL_V2_DESCRIPTION`
- the `startLine` field description
- the `limit` field description

- [ ] **Step 2: Write the failing wording expectation mentally against the approved spec**

Expected wording outcome:

- the high-level usage bullets state that line slicing applies to text mode
- image mode is documented as ignoring `startLine` and `limit`
- field descriptions for `startLine` and `limit` explicitly say they apply to text reads

- [ ] **Step 3: Implement the minimal wording update**

Update `packages/core/src/agent/tool-v2/handlers/read-file.ts` so that:

- the usage bullets say `startLine` is optional and 0-based for text mode
- the usage bullets say `limit` defaults to 1000 lines for text mode
- the mode bullet says image mode ignores `startLine` and `limit`
- the `startLine` schema description says it is used for text reads
- the `limit` schema description says it is used for text reads

- [ ] **Step 4: Re-read the edited file to verify wording consistency**

Run: `sed -n '12,60p' packages/core/src/agent/tool-v2/handlers/read-file.ts`
Expected: wording consistently distinguishes text mode from image mode

### Task 2: Update model-facing prompt wording

**Files:**

- Modify: `packages/core/src/agent/tool-v2/tool-prompts.ts`
- Test: `packages/core/src/agent/tool-v2/__test__/tool-system.test.ts`

- [ ] **Step 1: Read the current `FILE_READ_TOOL_DESCRIPTION` text**

Read `packages/core/src/agent/tool-v2/tool-prompts.ts` around `FILE_READ_TOOL_DESCRIPTION`.

- [ ] **Step 2: Implement the minimal prompt wording update**

Update `packages/core/src/agent/tool-v2/tool-prompts.ts` so that:

- line slicing is described as applying to text files
- the `startLine` bullet mentions text reads
- the `limit` bullet mentions text reads
- the image-file bullet says image mode ignores `startLine` and `limit`

- [ ] **Step 3: Re-read the edited prompt block**

Run: `sed -n '39,55p' packages/core/src/agent/tool-v2/tool-prompts.ts`
Expected: prompt wording matches the runtime description semantics

### Task 3: Verify no behavior drift

**Files:**

- Verify: `packages/core/src/agent/tool-v2/__test__/tool-system.test.ts`

- [ ] **Step 1: Run the targeted `read_file` behavior test**

Run: `pnpm vitest packages/core/src/agent/tool-v2/__test__/tool-system.test.ts -t "ignores line slicing arguments when read_file image mode is requested" --run`
Expected: PASS

- [ ] **Step 2: Run the full `tool-system` test file**

Run: `pnpm vitest packages/core/src/agent/tool-v2/__test__/tool-system.test.ts --run`
Expected: PASS with all tests in the file green

- [ ] **Step 3: Summarize changed files and verification**

Include:

- exact modified files
- exact verification commands run
- note that behavior is unchanged and only descriptions were updated

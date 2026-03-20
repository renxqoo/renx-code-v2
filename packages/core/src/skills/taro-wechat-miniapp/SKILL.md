---
name: taro-wechat-miniapp
description: Use when building, reviewing, refactoring, debugging, or scaffolding a React-based Taro WeChat Mini Program. Covers Taro React pages and components, app and page config, routing, Taro component conventions, Taro APIs, WeChat Mini Program lifecycle and runtime constraints, platform-specific capability integration for WeChat, and testable React component structure.
---

# Taro WeChat Mini Program

Use this skill for projects that are built with Taro and target WeChat Mini Program, especially when the task involves:

- creating or editing pages
- building reusable UI components
- wiring app or page configuration
- integrating device, storage, navigation, or network APIs
- debugging runtime or compatibility issues
- reviewing whether code follows Taro and WeChat Mini Program conventions

## Default assumptions

- Default target is **WeChat Mini Program first**
- Default stack is **Taro + React + TypeScript**
- This skill is **React-only**
- Prefer function components and hooks
- Prefer **Taro abstractions first**, then use WeChat-only APIs only when the capability is platform-specific or not wrapped by Taro

## Before coding

1. Inspect the repo structure before making assumptions
2. Identify:
   - whether the project is actually Taro
   - where app config, page config, and page entry files live
   - whether the task is page work, component work, config work, API work, or bug fixing
3. Load only the references needed for the task:
   - For UI, page, and component work: read [references/taro-development.md](references/taro-development.md)
   - For React component and hook structure: read [references/taro-react-patterns.md](references/taro-react-patterns.md)
   - For runtime, lifecycle, config, and WeChat behavior: read [references/wechat-framework.md](references/wechat-framework.md)
   - For cross-platform API design and platform extension: read [references/platform-compatibility.md](references/platform-compatibility.md)
   - For test strategy and coverage expectations: read [references/testing.md](references/testing.md)
   - For implementation review or final self-check: read [references/checklist.md](references/checklist.md)
4. When scaffolding new code, prefer adapting the bundled templates in `assets/`:
   - `assets/page.template.tsx`
   - `assets/component.template.tsx`
   - `assets/hook.template.ts`
   - `assets/service.template.ts`
   - `assets/platform-adapter.template.ts`
   - `assets/component.test.template.tsx`
   - `assets/hook.test.template.ts`

## Workflow

### 1. Classify the task

Decide which of these buckets the request belongs to:

- New page or route
- New reusable component
- Existing page/component refactor
- App or page configuration change
- Mini Program capability integration
- Debugging or compatibility fix
- Code review

### 2. Map the implementation surface

Before editing, identify which files are affected:

- App entry and global config
- Page component
- Page config
- Shared UI component
- Hooks, store, services, or request layer
- Taro or WeChat capability calls

If the task changes routing, tab bar, page title, pull-down behavior, sharing behavior, or navigation style, make sure the relevant config file is updated too.

### 3. Implement with Taro-first rules

When writing code:

- Use Taro component conventions and imports
- Use React function components and hooks by default
- Use Taro APIs from `@tarojs/taro` before reaching for `wx.*`
- Keep code aligned with the repository's existing component style and file layout
- Start from the closest `assets/` template when creating new files
- Prefer page/component composition over oversized files
- Keep component files small and focused
- Keep Mini Program runtime constraints in mind

### 4. Handle WeChat-only capability carefully

If the feature depends on a WeChat-specific capability:

- first check whether Taro already exposes it
- if not, use `wx.*` only for the unsupported or platform-specific part
- avoid scattering platform branches across page or component files
- prefer a thin adapter or service boundary so future platforms can be added cleanly
- clearly isolate the platform-specific code
- mention the platform limitation in the response

### 5. Review before finishing

Run a self-review against [references/checklist.md](references/checklist.md), especially:

- Taro component naming and event naming
- Config correctness
- Mini Program runtime compatibility
- API usage
- platform extensibility
- test coverage
- user-facing behavior

## Hard rules

- Do not write raw DOM code such as `window`, `document`, or direct browser-only APIs unless the repo clearly targets web for that code path.
- Do not introduce raw HTML tags into Taro component trees when Taro components are expected.
- Do not assume web routing patterns. Respect Taro and Mini Program page config and routing structure.
- Do not use `bind*` event naming in Taro JSX. Use `on*` props.
- Do not introduce Vue SFC patterns, Vue composition syntax, or Vue-specific files into this skill's output.
- Do not invent unsupported component props or capability mappings.
- Do not write native WeChat page files (`.wxml`, `.wxss`, `.js`, `.json`) into a Taro app unless the repo already uses native component interop and the task truly requires it.
- If a capability is unavailable in Taro abstraction, explicitly say you are using a WeChat-specific fallback.
- Do not let a reusable component file grow beyond roughly 300 lines. If it approaches or exceeds that size, split view fragments, hooks, helpers, or platform adapters into separate files.
- Do not hardcode `wx.*`, `tt.*`, `my.*`, or other platform globals directly across business code if the same feature may later target multiple mini program platforms.
- Do not finish feature work without adding or updating tests that match the repo's test stack, unless the repo truly has no workable test setup. If tests cannot be added, explicitly say why.

## What good output looks like

A strong result should:

- fit the current Taro project structure
- use React idioms consistently
- use correct Taro component and API conventions
- respect WeChat Mini Program runtime and config rules
- keep component files readable and reasonably small
- isolate platform-specific code behind a stable interface
- include meaningful test coverage for behavior, not only snapshots
- call out any WeChat-only constraints
- leave the user with code that is maintainable, not just barely functional

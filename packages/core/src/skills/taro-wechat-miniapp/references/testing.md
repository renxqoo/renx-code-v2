# Testing Strategy for Taro Mini Program Features

Use this reference when implementing or reviewing features in a Taro Mini Program codebase.

The goal is not just "have tests", but to cover the behaviors most likely to regress.

## Core rule

Every non-trivial feature should add or update tests that match the repository's existing test stack.

Prefer the repo's current tools. This repository already uses:

- `vitest`
- `@testing-library/react`
- `@testing-library/react-hooks`
- `@testing-library/user-event`

Do not introduce a brand-new test framework unless the user asks or there is no workable test setup.

## Minimum coverage expectations

For new or changed feature work, aim to cover:

- rendering or state changes
- interaction behavior
- service or adapter logic
- platform branching when present
- error and empty states where relevant

## Recommended test layers

### 1. Unit tests

Best for:

- utility functions
- hooks
- services
- adapter selection logic
- data mapping

Examples:

- transforms API response into page model
- chooses the correct platform adapter
- normalizes error payloads

### 2. Component tests

Best for:

- reusable UI components
- state-driven page sections
- input and event behavior

Examples:

- clicking a button triggers the expected callback
- loading state disables action buttons
- empty state renders when list is empty

Preferred tooling in this repo:

- `render` from `@testing-library/react`
- `screen` queries
- `userEvent` for interactions
- `vi` from `vitest` for spies and mocks

### 3. Integration-style tests

Best for:

- page + service coordination
- navigation side effects
- async request success and failure flows

Examples:

- page loads data and renders result
- request failure shows toast or error state
- successful submit triggers navigation or success feedback

When mocking adapters or services, prefer `vi.mock` and keep mocks at the service boundary rather than mocking internal render details.

## Test design for platform adapters

If you introduce platform-specific compatibility code, test at least:

- the stable service contract
- the adapter selection path
- the fallback behavior when a platform-specific path is unavailable

Do not rely only on manual verification for adapter logic.

## Test cases to consider for most feature work

### Rendering

- initial render shows expected structure
- loading state appears correctly
- empty state appears correctly
- error state appears correctly

### Interaction

- button click triggers expected action
- form input updates state correctly
- invalid input is handled correctly
- repeated taps do not cause unintended duplicate actions

### Async behavior

- success path updates UI correctly
- failure path handles error gracefully
- pending state is visible while request is in progress

### Platform compatibility

- generic path uses `Taro.*` abstraction when expected
- adapter returns normalized results
- WeChat-only fallback path is isolated and tested

## File-size and maintainability testing signal

If a component file is approaching or exceeding 300 lines, treat that as a design smell.

Add or refactor toward:

- extracted hooks
- extracted presentational subcomponents
- extracted service or adapter files
- extracted constants or mappers

This is not a runtime test, but it is a maintainability quality check.

## What to avoid

- snapshot-only coverage for interactive features
- tests that only assert implementation details
- platform-specific code with zero coverage
- leaving new service branches untested because they "seem simple"

## If the repo has weak or missing tests

If the project has no mature test setup:

- still add the most local, low-friction test style available
- if no automated test path is realistic, explain the gap explicitly
- propose the smallest next step instead of silently shipping with no tests

In this repository, the default assumption should be that automated tests are expected and should be added when behavior changes.

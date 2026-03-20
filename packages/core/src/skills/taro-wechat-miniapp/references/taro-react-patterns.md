# Taro React Patterns

Use this reference when implementing pages, reusable components, hooks, or testable UI structure in a Taro React Mini Program project.

## Preferred component style

Default to:

- React function components
- typed props
- hooks for state and side effects
- extracted custom hooks for reusable stateful logic

Avoid:

- class components unless the surrounding code is already class-based
- mixing data fetching, platform branching, and presentational markup in one component
- giant page files that own every piece of logic directly

## Recommended layering

For most feature work, prefer this split:

1. Page component
2. Feature section or presentational component
3. Hook or controller logic
4. Service or platform adapter

This keeps the page readable and helps satisfy the 300-line component rule.

## Good page responsibilities

A page component should usually:

- coordinate route params
- call page-level hooks
- render loading, error, and success states
- compose smaller sections

A page component should usually not:

- contain large inline data transformation blocks
- contain direct platform-specific API calls
- contain multiple unrelated reusable subviews inline

## Good reusable component responsibilities

A reusable component should:

- accept clear typed props
- stay focused on one visual or interaction responsibility
- emit simple callbacks upward
- avoid direct page routing or business orchestration unless it is explicitly a page-level component

## Hook guidance

Extract a custom hook when:

- stateful logic is reused
- a component is getting too large
- async request state is cluttering the render path
- platform branching would otherwise leak into UI code

Good candidates:

- list loading and pagination
- form state and submission
- permission and capability state
- normalized adapter-backed feature calls

## File size rule

Treat 300 lines as a hard maintainability ceiling for reusable component files.

If a file is approaching that size, split by:

- subcomponents
- hooks
- mappers
- constants
- service or adapter boundaries

Do not keep growing the file just because it still technically works.

## Testability guidance

React structure should make tests easier, not harder.

Prefer:

- pure presentational components where practical
- hooks and services with small stable interfaces
- adapter boundaries that can be mocked

Avoid:

- deeply coupled UI and platform logic
- side effects triggered in opaque utility code with no seam for tests

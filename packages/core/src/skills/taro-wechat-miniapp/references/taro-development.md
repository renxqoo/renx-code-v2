# Taro Development Notes for WeChat Mini Program

Source references:

- https://docs.taro.zone/docs/components-desc
- https://docs.taro.zone/docs/apis/about/desc
- https://docs.taro.zone/docs/guide

Use this reference when the task involves Taro React page creation, component writing, UI refactors, or API usage.

## Core mental model

Taro is a cross-platform abstraction layer. For this skill, the target is WeChat Mini Program, but implementation should still be written in the Taro React way unless the task explicitly requires native WeChat-only interop.

That means:

- use Taro components instead of raw mini program templates when working in a Taro project
- use Taro APIs from `@tarojs/taro` where available
- use React function components and hooks by default

## Component rules

Taro's component system is based on the WeChat Mini Program component model, but adapted to JSX and framework-style development.

When writing components:

- import components from `@tarojs/components`
- use PascalCase component names in code
- use camelCase props
- use `onXxx` event props instead of Mini Program `bindxxx` syntax

Examples of expected style:

- `View`, `Text`, `Button`, `Input`, `ScrollView`
- `onClick`, `onInput`, `onChange`

## API rules

Taro wraps many Mini Program APIs under the `Taro` namespace.

Prefer:

- `Taro.request`
- `Taro.navigateTo`
- `Taro.showToast`
- `Taro.getStorage`

over direct `wx.*` calls when Taro already supports the capability.

Only drop to `wx.*` when:

- the capability is WeChat-only
- Taro does not provide the wrapper you need
- the repo already uses platform-specific wrappers for that area

When you do use `wx.*`, isolate it and state clearly that it is WeChat-specific.

## Implementation style

When working in a Taro codebase:

- prefer React function components over class components unless the repository already has a strong legacy class-based pattern in the exact area you are editing
- keep side effects in hooks and page lifecycle hooks, not mixed into render logic
- prefer extracting reusable logic into custom hooks when it clarifies the component
- preserve existing project conventions for functional components, hooks, stores, and request layers
- prefer TypeScript types for props, API responses, and internal state
- keep page components focused on page orchestration and move reusable UI into separate components
- keep reusable component files under roughly 300 lines by extracting hooks, helpers, subcomponents, and platform-specific logic
- avoid copying raw examples from native Mini Program docs without translating them into Taro style

## Cross-end awareness

Even when the user only mentions WeChat Mini Program, remember that Taro projects may later target more than one platform.

So:

- prefer abstractions that keep future portability when they do not hurt the current task
- do not introduce unnecessary WeChat lock-in for generic UI or generic data flows
- only use platform-specific code when the feature genuinely depends on WeChat

## Common mistakes to avoid

- using HTML tags instead of Taro components
- using `bindtap`-style event names in JSX
- mixing raw native Mini Program file structure into a normal Taro page without need
- calling `wx.*` everywhere even when `Taro.*` exists
- letting page or component files become oversized "god files"
- mixing Vue conventions into a React Taro project
- copying a native example that assumes WXML into a React or Vue Taro project without adaptation

# Multi-Platform Mini Program Compatibility

Use this reference when the task involves APIs, platform capability integration, or architecture that may later extend beyond WeChat Mini Program.

Primary goal:

- keep WeChat-first delivery fast
- avoid painting the codebase into a WeChat-only corner

## Design principle

Prefer this layering:

1. Page or component layer
2. Domain or feature service layer
3. Platform adapter layer
4. Taro or native platform capability

The page or component should call a stable application-facing function, not a platform global directly.

Good:

- `authService.login()`
- `clipboardService.copy(text)`
- `locationService.chooseLocation()`

Risky:

- page component calls `wx.login()` directly
- business component mixes `Taro.request`, `wx.getLocation`, and UI state in one file

## Preferred API strategy

### Tier 1: Taro first

If Taro already provides the capability in a portable way, use it first.

Examples:

- navigation
- storage
- request
- toast and modal
- many device and media capabilities

This keeps future support for Alipay, Douyin, or other platforms easier.

### Tier 2: Adapter boundary

If the capability is not fully abstracted or behavior differs by platform, create a small adapter boundary.

Example shape:

```ts
export interface LoginAdapter {
  login(): Promise<{ code: string }>;
}
```

Then provide a platform implementation behind that interface.

Even if only WeChat exists today, this makes later extension much easier.

### Tier 3: Native platform fallback

Only call native platform globals such as:

- `wx.*`
- `tt.*`
- `my.*`

when:

- Taro does not expose the needed capability
- platform behavior is materially different
- the feature is genuinely platform-specific

When doing this:

- isolate the call in one adapter file or service file
- do not spread the native call across multiple business files
- make the limitation explicit in comments or final explanation when relevant

## Suggested file organization

A good scalable shape is:

```text
src/
  services/
    auth/
      index.ts
      types.ts
      adapters/
        weapp.ts
        alipay.ts
        tt.ts
```

Or, if the repo prefers flatter structure:

```text
src/
  services/
    auth.ts
    auth.weapp.ts
    auth.alipay.ts
    auth.tt.ts
```

Match the repository style, but keep platform-specific logic grouped.

## Extension strategy for future platforms

When writing WeChat-first code, ask:

- Is this behavior generic or platform-specific?
- Can I hide this behind a stable service contract?
- If we add Alipay or Douyin later, where would that code go?

The best answer is one where future platforms only require:

- adding a new adapter file
- registering or selecting the adapter

not rewriting business pages.

## What should stay platform-agnostic

Try to keep these areas platform-agnostic:

- page state logic
- feature business rules
- request data transformation
- validation logic
- reusable presentational components

Try to isolate these areas when platform-specific:

- auth and identity entrypoints
- payments
- share behavior
- map and location quirks
- file and media capabilities
- permission handling

## Common mistakes to avoid

- calling `wx.*` directly from pages and components
- branching on platform in many unrelated files
- mixing platform selection logic with presentational UI
- creating abstractions too late, after multiple pages already depend on WeChat-only code
- pretending APIs are portable when their behavior actually differs by platform

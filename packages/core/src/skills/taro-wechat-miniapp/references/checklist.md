# Taro WeChat Mini Program Checklist

Use this checklist before finalizing implementation or review feedback.

## A. Project fit

- Does the solution match the repo's existing Taro structure?
- Does it stay fully within React patterns?
- Does it avoid introducing a second competing style?
- Are reusable component files kept under roughly 300 lines, or split when too large?

## B. Component and page conventions

- Are Taro components imported from `@tarojs/components` when needed?
- Are component names in PascalCase?
- Are event props written as `onXxx`?
- Are React function components and hooks used appropriately?
- Is reusable UI extracted instead of bloating a page file?

## C. Config correctness

- If a page was added, was routing or page registration updated?
- If page behavior changed, was page config checked?
- If app-wide behavior changed, was global config checked?

## D. API usage

- Is `Taro.*` used before `wx.*`?
- If `wx.*` is used, is there a clear reason it must be WeChat-specific?
- Are async calls handled consistently with the repo style?
- Is platform-specific logic isolated behind a service or adapter boundary?
- Would adding Alipay or Douyin support require only a new adapter, not page rewrites?

## E. Runtime compatibility

- Does the code avoid browser-only APIs in Mini Program runtime code?
- Does it avoid unsupported assumptions about DOM and events?
- Does it respect Mini Program behavior for lifecycle and rendering?

## F. User experience

- Are loading, empty, and error states handled where needed?
- Is navigation behavior clear?
- Are titles, toasts, and feedback aligned with the feature?

## G. Testing

- Were tests added or updated for the changed behavior?
- Do tests cover success, failure, and interaction paths where relevant?
- If adapter logic exists, is it covered by tests?
- Is the test approach aligned with the repo's existing test stack?

## H. Review output quality

If you are reviewing code rather than writing it:

- identify the exact file or area affected
- explain why the issue matters in Taro or Mini Program context
- say whether the issue is general, Taro-specific, or WeChat-specific
- propose a concrete fix, not just a complaint

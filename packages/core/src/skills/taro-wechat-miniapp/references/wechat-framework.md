# WeChat Mini Program Framework Notes

Source references:

- https://developers.weixin.qq.com/miniprogram/dev/framework/
- https://developers.weixin.qq.com/miniprogram/dev/framework/structure.html
- https://developers.weixin.qq.com/miniprogram/dev/framework/config.html
- https://developers.weixin.qq.com/miniprogram/dev/framework/app-service/
- https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/
- https://developers.weixin.qq.com/miniprogram/dev/framework/view/wxml/

Use this reference when the task touches Mini Program runtime behavior, routing, lifecycle, config, rendering constraints, or native capability expectations.

## Core mental model

WeChat Mini Program is not a normal browser environment.

Important implications:

- the runtime is split between logical behavior and rendering behavior
- browser-only assumptions often fail
- routing, config, page registration, and platform capabilities follow Mini Program rules

In a Taro project, these rules still matter even though the code is written through Taro abstractions.

## Config awareness

Many Mini Program behaviors are configuration-driven.

When a task changes app structure or page behavior, check whether config must also change.

Typical config-sensitive tasks:

- adding a new page route
- changing navigation bar title or style
- enabling pull-down refresh
- changing tab bar structure
- configuring window behavior
- page-level sharing or appearance options

If the user asks for a feature that depends on one of these, do not stop at the component code. Update the relevant app or page config too.

## Page and app lifecycle awareness

Mini Program features often depend on lifecycle timing.

Be careful when tasks involve:

- loading data on page entry
- refreshing on page show or hide
- preserving or clearing state across navigation
- handling app launch and app foreground behavior

In Taro, use the framework and Taro lifecycle patterns already used in the repo, but keep Mini Program lifecycle semantics in mind.

## Rendering constraints

Mini Program rendering is not the DOM.

Do not assume:

- arbitrary browser layout APIs
- direct DOM querying
- direct event behavior identical to the web
- generic web libraries will always work without adaptation

If you need measurements, selectors, platform context, or platform APIs, prefer Taro-supported methods first and confirm that they map correctly to Mini Program runtime.

## Native capability integration

WeChat Mini Program provides many device and platform capabilities, but they may have permission, config, or platform limitations.

When integrating capabilities such as:

- login and user identity
- storage
- network
- media
- map
- share
- device features

make sure the implementation:

- uses the Taro wrapper when available
- follows WeChat capability semantics
- does not hide WeChat-only assumptions from the user

## Native component and custom component caution

WeChat supports custom components and native component rules, but in a Taro codebase you should not default to native component authoring unless the repo already uses that pattern or the feature requires interop.

Default preference:

- normal Taro page/component implementation first
- native interop only when required

## Common mistakes to avoid

- treating a Mini Program page like a React web route with full browser assumptions
- editing only UI code while forgetting required app or page config
- using browser globals in Mini Program runtime code
- introducing WeChat-only code into generic areas without marking the limitation
- assuming native examples can be pasted into Taro unchanged

# 权限认证系统 Bug 分析报告

## 概述

本文档分析 `src/agent/runtime/` 目录中权限认证系统的实现问题。

---

## 严重 Bug (安全漏洞)

### 1. 默认批准所有工具执行

**文件**: `src/agent/runtime/tool-confirmation.ts:9-20`

```typescript
const DEFAULT_FALLBACK_DECISION: AgentToolConfirmDecision = { approved: true }; // 默认批准！
```

**问题描述**: 当没有注册 `onToolConfirmRequest` 回调时，默认批准所有工具执行。这是一个严重的安全漏洞。

**影响范围**: 所有工具调用在无用户交互确认的情况下都会被执行。

**测试验证** (`tool-confirmation.test.ts:64-70`):

```typescript
it('falls back to approve when no UI callback is registered', async () => {
  const decision = await resolveToolConfirmDecision(TOOL_CONFIRM_EVENT, {});
  expect(decision).toEqual({ approved: true });
});
```

**建议修复**:

```typescript
const DEFAULT_FALLBACK_DECISION: AgentToolConfirmDecision = { approved: false };
```

---

### 2. 默认授予所有请求的权限

**文件**: `src/agent/runtime/tool-confirmation.ts:31-35`

```typescript
if (!handlers.onToolPermissionRequest) {
  return {
    granted: event.permissions, // 授予所有请求的权限！
    scope: event.requestedScope,
  };
}
```

**问题描述**: 没有回调时，直接授予请求的所有权限，等于没做权限控制。

**影响范围**: 权限检查形同虚设，agent 可以访问任何文件或网络资源。

**建议修复**:

```typescript
if (!handlers.onToolPermissionRequest) {
  return DEFAULT_FALLBACK_PERMISSION_GRANT; // 返回空权限
}
```

---

## 中等问题

### 3. Promise rejection 处理不规范

**文件**: `src/agent/runtime/runtime.ts:572-582`

```typescript
void resolveToolConfirmDecision(toolConfirmEvent, handlers)
  .then((decision) => {
    event.resolve(decision);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    event.resolve({
      approved: false,
      message: message || 'Tool confirmation failed.',
    });
  });
```

**问题描述**: 使用 `void` 关键字会使 Promise rejection 无法被外层捕获。虽然这里有 `.catch()` 处理，但整体模式不规范，可能导致静默失败难以调试。

**建议修复**:

```typescript
try {
  const decision = await resolveToolConfirmDecision(toolConfirmEvent, handlers);
  event.resolve(decision);
} catch (error) {
  // ... error handling
}
```

---

## 小问题

### 4. 类型不一致 - requestedScope 默认值

**文件**: `src/agent/runtime/runtime.ts:591`

```typescript
requestedScope: event.requestedScope || 'turn',
```

**问题描述**: 使用 `||` 赋值可能覆盖合法的 `undefined` 状态。类型定义是 `'turn' | 'session'`，但事件中 `requestedScope` 可能是 `undefined`。

**建议修复**:

```typescript
requestedScope: event.requestedScope ?? 'turn',
```

---

## 相关代码位置

| 文件                                          | 描述                  |
| --------------------------------------------- | --------------------- |
| `src/agent/runtime/tool-confirmation.ts`      | 工具确认/权限解析逻辑 |
| `src/agent/runtime/types.ts`                  | 权限相关类型定义      |
| `src/agent/runtime/runtime.ts:559-609`        | 权限事件绑定和处理    |
| `src/agent/runtime/tool-confirmation.test.ts` | 权限测试用例          |

---

## 权限模型参考

```typescript
// 工具确认决策
type AgentToolConfirmDecision = {
  approved: boolean;
  message?: string;
};

// 权限请求
type AgentToolPermissionProfile = {
  fileSystem?: {
    read?: string[];
    write?: string[];
  };
  network?: {
    enabled?: boolean;
    allowedHosts?: string[];
    deniedHosts?: string[];
  };
};

// 权限范围
type AgentToolPermissionGrant = {
  granted: AgentToolPermissionProfile;
  scope: 'turn' | 'session';
};
```

---

## 修复优先级

| 优先级 | Bug                      | 风险等级 |
| ------ | ------------------------ | -------- |
| P0     | #1 默认批准所有工具      | 高       |
| P0     | #2 默认授予所有权限      | 高       |
| P1     | #3 Promise 处理不规范    | 中       |
| P2     | #4 requestedScope 默认值 | 低       |

# 企业级权限体系重构方案

## 1. 文档目标

本文档用于给 `renx-code` 当前 Agent 与 Tool 的权限治理体系提供一套可直接落地的重构方案。

目标不是在现有实现上继续零散补逻辑，而是把权限问题正式升级为企业级能力，形成：

- 统一授权入口
- 清晰身份模型
- 结构化授权决策
- 可持久化的权限与审批记录
- 可审计、可回放、可扩展的治理体系

本文档聚焦的是：

- Tool 执行权限
- Policy 拦截
- Permission Grant
- Approval 审批
- Audit 审计

不覆盖：

- 用户登录认证协议
- OAuth / SSO 接入细节
- UI 审批页面设计

## 2. 当前实现评估

## 2.1 当前已有能力

当前项目已经具备一套基础执行期权限控制能力，主要在以下代码路径：

- `packages/core/src/agent/tool-v2/orchestrator.ts`
- `packages/core/src/agent/tool-v2/permissions.ts`
- `packages/core/src/agent/tool-v2/context.ts`
- `packages/core/src/agent/tool-v2/agent-tool-executor.ts`
- `packages/core/src/agent/agent/tool-runtime-execution.ts`

当前已经支持：

- 工具执行前 policy 检查
- 基于 `plan()` 的文件与网络权限需求分析
- 缺失权限时触发 `requestPermissions`
- 需要人工确认时触发 `approve`
- `turn` / `session` 级权限与审批缓存
- 工具结果的标准化失败返回

## 2.2 当前架构优点

当前实现的优点：

- 治理逻辑已经基本集中在 `tool-v2`
- Tool handler 已经具备 `parse -> plan -> execute` 的基本形态
- Agent 没有继续深度侵入具体工具权限逻辑
- 权限判定已经有显式上下文和契约

这是一个好的基础，不需要推倒重来。

## 2.3 当前核心问题

尽管基础不错，但当前权限体系仍存在明显企业级短板。

### 问题 1：没有正式身份上下文

系统当前知道“哪个工具调用要执行”，但不知道“是谁发起的这次执行”。

缺少：

- `principalId`
- `principalType`
- `tenantId`
- `workspaceId`
- `source`

这会导致后续：

- 无法做角色权限
- 无法做租户隔离
- 无法做责任审计
- 无法做审批人约束

### 问题 2：Policy / Permission / Approval 仍是分段式拼装

当前 `orchestrator.ts` 中权限流被拆成：

- `assertPolicy`
- `ensurePlanPermissions`
- `ensureApproval`

逻辑虽然正确，但长期会出现：

- 决策来源不统一
- 审计信息分散
- 外部系统接入点不唯一
- 以后很难引入统一 RBAC / ABAC

### 问题 3：授权结果不是一级对象

当前外部通过：

- `onPolicyCheck`
- `requestPermissions`
- `approve`

这些 callback 拼起来完成授权。

问题在于系统中没有一个正式的：

- `AuthorizationDecision`
- `PermissionGrantRecord`
- `ApprovalDecisionRecord`

这会让后续：

- 难以持久化
- 难以审计
- 难以回放
- 难以统一测试

### 问题 4：权限状态主要停留在内存

当前 `ToolSessionState` 里有：

- `turnPermissions`
- `sessionPermissions`
- `turn approvals`
- `session approvals`

但这些主要是运行期状态，不是企业级授权资产。

缺少：

- grant 持久化
- approval 持久化
- 撤销机制
- 过期机制
- 跨进程恢复

### 问题 5：默认策略仍偏 runtime-level，而非 organization-level

当前默认值是 runtime 注入：

- 工作区文件权限
- restricted network
- approval policy
- trust level

但企业级里真正应该由以下维度共同决定：

- 组织策略
- 工作区策略
- 用户角色
- 环境等级
- 资源敏感级别

### 问题 6：没有正式资源模型

现在资源主要隐含在：

- `readPaths`
- `writePaths`
- `networkTargets`

但企业级最终需要统一资源抽象，否则策略会越来越难维护。

## 3. 重构目标

本次权限体系重构的目标是建立一套：

- 工具不做权限裁决
- 执行前统一授权
- 默认受限
- 决策结构化
- 授权状态可持久化
- 审计可追责

的企业级权限系统。

一句话目标：

`Tool 只声明执行计划，AuthorizationService 统一裁决是否可以执行。`

## 4. 目标架构

## 4.1 新的权限主链

目标链路应收敛为：

1. 解析工具调用
2. Tool handler 生成 `ExecutionPlan`
3. AuthorizationService 接收：
   - principal
   - tool call
   - execution plan
   - session state
   - workspace / environment context
4. AuthorizationService 返回结构化 `AuthorizationDecision`
5. Orchestrator 按 decision：
   - 允许执行
   - 拒绝执行
   - 请求额外权限
   - 请求人工审批
6. 决策与结果进入审计系统

## 4.2 目标分层

### Tool Handler 层

只负责：

- `parseArguments`
- `plan`
- `execute`

严禁：

- 自己判断某个 principal 是否有权限
- 自己决定是否需要组织级审批
- 自己拼装跨工具的风控逻辑

### Authorization 层

新增正式权限中心，负责：

- 身份解析
- 角色与属性装配
- policy 决策
- permission gap 分析
- approval requirement 分析
- 产出统一授权结果

### Session / State 层

负责：

- grant 生命周期
- approval 生命周期
- turn / session 缓存
- 上下文恢复

### Audit 层

负责：

- 记录授权请求
- 记录授权决策
- 记录审批动作
- 记录最终执行结果

## 4.3 目标目录结构

建议新增：

```text
packages/core/src/agent/auth/
  contracts.ts
  principal.ts
  authorization-service.ts
  policy-engine.ts
  permission-service.ts
  approval-service.ts
  audit-service.ts
  grant-store.ts
  approval-store.ts
  decision-merger.ts
  __test__/
```

其中：

- `tool-v2` 继续保留工具领域能力
- `auth` 成为正式授权域
- `orchestrator` 不再承载越来越重的授权逻辑

## 5. 核心模型设计

## 5.1 PrincipalContext

新增正式身份上下文：

```ts
export interface PrincipalContext {
  principalId: string;
  principalType: 'user' | 'service' | 'automation' | 'system';
  tenantId?: string;
  workspaceId?: string;
  source: 'cli' | 'desktop' | 'api' | 'automation' | 'internal';
  roles: string[];
  attributes?: Record<string, unknown>;
}
```

用途：

- 统一授权输入
- 审计归因
- 审批约束
- 多租户隔离

## 5.2 ToolExecutionPlan 扩展

当前 `plan()` 需要继续增强，使其更适合授权决策。

建议最终形态：

```ts
export interface ToolExecutionPlan {
  mutating: boolean;
  readPaths?: string[];
  writePaths?: string[];
  networkTargets?: string[];
  resources?: ResourceDescriptor[];
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  sensitivity?: 'normal' | 'sensitive' | 'restricted';
  concurrency?: ToolConcurrencyPolicy;
  preferredSandbox?: ToolSandboxMode;
  approval?: {
    required: boolean;
    reason: string;
    key?: string;
    commandPreview?: string;
  };
}
```

说明：

- Tool handler 负责“声明需求”
- AuthorizationService 负责“裁决是否允许”

## 5.3 统一资源模型

建议新增：

```ts
export interface ResourceDescriptor {
  resourceType: 'filesystem' | 'network' | 'shell' | 'task' | 'subagent';
  action: 'read' | 'write' | 'execute' | 'connect' | 'spawn';
  value: string;
  attributes?: Record<string, unknown>;
}
```

这样后续：

- 文件访问
- host 访问
- shell 命令
- 子任务创建

都能纳入同一策略体系。

## 5.4 AuthorizationDecision

不要再只返回布尔值。

建议引入：

```ts
export interface AuthorizationDecision {
  outcome: 'allow' | 'deny' | 'require_permissions' | 'require_approval';
  reason: string;
  policyVersion: string;
  audit: {
    rulesMatched: string[];
    riskLevel?: string;
    tags?: string[];
  };
  requiredPermissions?: ToolPermissionProfile;
  requiredApproval?: {
    approvalType: 'single' | 'double' | 'role-based';
    scope: 'once' | 'turn' | 'session';
    reason: string;
    key?: string;
  };
}
```

这会成为整个企业级权限系统的核心输出。

## 5.5 持久化记录模型

建议至少定义 3 类记录：

### PermissionGrantRecord

```ts
export interface PermissionGrantRecord {
  grantId: string;
  principalId: string;
  toolCallId: string;
  scope: 'turn' | 'session';
  granted: ToolPermissionProfile;
  grantedBy: string;
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
}
```

### ApprovalDecisionRecord

```ts
export interface ApprovalDecisionRecord {
  approvalId: string;
  toolCallId: string;
  principalId: string;
  approverId: string;
  decision: 'approved' | 'denied';
  scope: 'once' | 'turn' | 'session';
  reason?: string;
  createdAt: number;
  expiresAt?: number;
}
```

### AuthorizationAuditRecord

```ts
export interface AuthorizationAuditRecord {
  auditId: string;
  toolCallId: string;
  principalId: string;
  toolName: string;
  decision: string;
  reason: string;
  policyVersion: string;
  resources: ResourceDescriptor[];
  createdAt: number;
  metadata?: Record<string, unknown>;
}
```

## 6. 模块拆分方案

## 6.1 authorization-service.ts

职责：

- 统一对外暴露授权入口
- 组合 policy / permission / approval 子系统
- 输出结构化 `AuthorizationDecision`

建议接口：

```ts
export interface AuthorizationService {
  authorize(input: {
    principal: PrincipalContext;
    toolCallId: string;
    toolName: string;
    rawArguments: string;
    parsedArguments: Record<string, unknown>;
    plan: ToolExecutionPlan;
    sessionState: ToolSessionState;
    workingDirectory: string;
  }): Promise<AuthorizationDecision>;
}
```

## 6.2 policy-engine.ts

职责：

- 处理组织级 deny / allow 规则
- 处理高危命令、敏感 host、敏感路径
- 提供版本化策略输出

规则示例：

- `rm -rf /` 直接 deny
- `production` 工作区写入 require_approval
- 访问外网 host require_permissions
- `subagent spawn` 在受限租户 require_approval

## 6.3 permission-service.ts

职责：

- 基于 plan 和基础环境权限分析缺口
- 决定是否需要额外 grant
- 归一化 granted profile

注意：

- 不决定最终是否允许
- 只负责“权限差额分析与授予”

## 6.4 approval-service.ts

职责：

- 处理审批请求创建
- 处理审批缓存
- 处理审批作用域
- 处理审批落库

注意：

- 审批不应直接覆盖 policy deny
- approval 只解决“允许不允许执行风险动作”
- 不能替代组织级禁止规则

## 6.5 audit-service.ts

职责：

- 记录所有授权决策
- 记录 grant / approval / deny
- 提供后续追责与排查依据

## 7. 当前代码如何迁移

## 7.1 第一阶段：抽象不变更行为

目标：

- 不改现有行为
- 先把授权逻辑从 `orchestrator.ts` 中抽出

具体动作：

1. 新增 `auth/contracts.ts`
2. 新增 `auth/authorization-service.ts`
3. 先实现一个 `LegacyAuthorizationService`
4. 让它内部仍然沿用当前：
   - `assertPolicy`
   - `collectMissingPermissionProfile`
   - `ensureApproval`

也就是说第一阶段只是：

`逻辑搬家，不改语义`

验收标准：

- 现有测试行为不变
- `orchestrator.ts` 中权限相关代码变薄

## 7.2 第二阶段：引入 PrincipalContext

目标：

- 把“谁在执行”正式引入系统

具体动作：

1. 在 Agent 输入链路中增加 `principal`
2. 在 `AgentToolExecutionContext` 中透传 `principal`
3. 在 `ToolExecutionContext` 中透传 `principal`
4. 所有授权输入都要求带 `PrincipalContext`

建议新增字段位置：

- `packages/core/src/agent/types.ts`
- `packages/core/src/agent/agent/tool-executor.ts`
- `packages/core/src/agent/tool-v2/context.ts`

验收标准：

- 每次 tool 调用都能拿到 principal
- 审计链路可以记录发起者

## 7.3 第三阶段：授权决策统一为 AuthorizationDecision

目标：

- 把当前 callback 分段式授权收敛成统一输出

具体动作：

1. AuthorizationService 输出 `AuthorizationDecision`
2. Orchestrator 不再分别判断 policy / permission / approval
3. Orchestrator 改成：
   - 生成 plan
   - 调用 authorize
   - 根据 decision 执行

建议目标伪代码：

```ts
const decision = await authorizationService.authorize(...);

switch (decision.outcome) {
  case 'allow':
    return execute();
  case 'require_permissions':
    return requestPermissionsThenExecute();
  case 'require_approval':
    return requestApprovalThenExecute();
  case 'deny':
  default:
    return deny();
}
```

验收标准：

- Orchestrator 中不再有多个权限决策入口
- 授权结果变成显式一级对象

## 7.4 第四阶段：grant / approval 持久化

目标：

- 把内存态升级为企业级资产

具体动作：

1. 新增 `GrantStore`
2. 新增 `ApprovalStore`
3. 每次 grant 与 approval 都落持久化记录
4. `ToolSessionState` 继续保留内存缓存，但变成投影缓存，不是唯一事实来源

验收标准：

- 进程重启后可以恢复 session 级授权
- grant / approval 可查询、可追踪

## 7.5 第五阶段：策略版本化与组织级治理

目标：

- 让权限规则不再只是代码 if-else

具体动作：

1. 引入 `policyVersion`
2. 让 deny / allow / require_approval 规则可配置
3. 引入工作区级、环境级策略

验收标准：

- 审计记录里可以看到 policyVersion
- 不同 workspace 可加载不同 policy

## 8. 具体代码修改清单

## 第一批新增文件

建议新增：

- `packages/core/src/agent/auth/contracts.ts`
- `packages/core/src/agent/auth/principal.ts`
- `packages/core/src/agent/auth/authorization-service.ts`
- `packages/core/src/agent/auth/policy-engine.ts`
- `packages/core/src/agent/auth/permission-service.ts`
- `packages/core/src/agent/auth/approval-service.ts`
- `packages/core/src/agent/auth/audit-service.ts`

## 第一批需要改造的现有文件

- `packages/core/src/agent/tool-v2/orchestrator.ts`
- `packages/core/src/agent/tool-v2/context.ts`
- `packages/core/src/agent/agent/tool-executor.ts`
- `packages/core/src/agent/tool-v2/agent-tool-executor.ts`
- `packages/core/src/agent/types.ts`

## 第二批需要接入存储的文件

- `packages/core/src/agent/app/*`
- 持久化 store 相关模块

## 9. 推荐的接口演进策略

本次重构建议采用：

- “先加新层”
- “再迁移旧逻辑”
- “最后删除旧入口”

不建议：

- 一次性把 `orchestrator.ts` 全部重写
- 同时改工具 handler、Agent、App、Store 全部入口

推荐顺序：

1. 抽出 AuthorizationService 壳
2. 接入 PrincipalContext
3. 统一 AuthorizationDecision
4. 引入持久化
5. 删除旧散点判断

## 10. 测试策略

## 10.1 单元测试

必须新增：

- `authorization-service.test.ts`
- `policy-engine.test.ts`
- `permission-service.test.ts`
- `approval-service.test.ts`

覆盖重点：

- deny precedence
- permission gap 分析
- approval scope
- session reuse
- principal 缺失时的默认行为

## 10.2 集成测试

必须覆盖：

- 文件读取越界后触发 grant
- 高风险写入触发 approval
- policy deny 直接终止
- session grant 在后续调用中复用
- session approval 在同 key 下复用

## 10.3 恢复测试

在持久化阶段后必须新增：

- 进程重启后恢复 session grant
- 未过期 approval 恢复
- 已过期 approval 失效

## 10.4 审计测试

必须验证：

- 每次授权都有 audit 记录
- deny 也必须记录
- approval / grant 的 audit 能串起同一个 `toolCallId`

## 11. 冻结规则

在这套重构完成前后，都应遵守以下规则：

### 规则 1

Tool handler 不做权限裁决。

### 规则 2

统一在工具真正执行前做授权决策。

### 规则 3

默认策略必须是受限的，不允许默认放开。

### 规则 4

授权结果必须是结构化对象，不能退化成简单布尔值。

### 规则 5

`policy deny` 的优先级高于 `approval allow`。

### 规则 6

所有企业级权限判断必须可审计。

## 12. 分阶段实施计划

## 阶段 A：抽象授权中心

周期建议：

- 2 到 3 天

交付：

- `auth` 目录初版
- LegacyAuthorizationService
- Orchestrator 接入新服务

风险：

- 逻辑搬家后测试漂移

## 阶段 B：引入身份上下文

周期建议：

- 2 天

交付：

- PrincipalContext
- 全链路 principal 透传

风险：

- 上游调用方入参变更

## 阶段 C：统一决策对象

周期建议：

- 3 到 4 天

交付：

- AuthorizationDecision
- 新的 orchestrator 决策流

风险：

- 旧 callback 语义与新对象映射不完整

## 阶段 D：持久化 grant / approval / audit

周期建议：

- 4 到 6 天

交付：

- 存储模型
- 查询接口
- 恢复逻辑

风险：

- schema 设计不足导致后续迁移成本高

## 阶段 E：组织级策略

周期建议：

- 3 到 5 天

交付：

- policy version
- workspace / environment policy
- 高风险动作治理

风险：

- 规则设计太复杂导致运维困难

## 13. 最终预期收益

如果按本方案完成重构，权限体系会获得以下收益：

- Tool 与权限解耦更彻底
- Agent 与 Tool 边界更稳定
- 外部接入点统一
- 支持未来 RBAC / ABAC
- 支持正式审批链
- 支持审计追责
- 支持跨进程恢复
- 支持多租户与组织级治理

## 14. 最终建议

这次权限重构最关键的一点，不是“把更多判断塞进一个函数”，而是：

把当前零散但正确的执行期控制，升级成一个正式的授权域。

推荐的唯一正确方向是：

`Tool 只声明，AuthorizationService 统一裁决，Audit 全程留痕。`

如果后续继续沿着这个方向推进，`renx-code` 的权限体系就会从“运行时安全控制”升级为真正的“企业级授权系统”。

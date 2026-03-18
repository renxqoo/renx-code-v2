# Agent 架构深度分析与流程图说明

## 目录

1. [架构概览](#架构概览)
2. [核心模块分析](#核心模块分析)
3. [流程图说明](#流程图说明)
4. [关键设计模式](#关键设计模式)
5. [数据流分析](#数据流分析)
6. [扩展点与插件机制](#扩展点与插件机制)

---

## 架构概览

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Agent Application Layer                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      AgentAppService                                 │   │
│  │  • runForeground() - 前台执行                                        │   │
│  │  • appendUserInputToRun() - 追加用户输入                             │   │
│  │  • 事件存储与消息投影                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Agent Core Layer                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      StatelessAgent                                  │   │
│  │  • runStream() - 流式执行入口                                        │   │
│  │  • 超时预算管理                                                       │   │
│  │  • 生命周期钩子                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                    ┌─────────────────┼─────────────────┐                    │
│                    ▼                 ▼                 ▼                    │
│  ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐   │
│  │    Run Loop         │ │   LLM Runtime       │ │   Tool Runtime      │   │
│  │  • runAgentLoop()   │ │  • 流式处理         │ │  • 工具执行         │   │
│  │  • 阶段编排         │ │  • 消息合并         │ │  • 并发控制         │   │
│  │  • 错误恢复         │ │  • 续写支持         │ │  • 幂等性保证       │   │
│  └─────────────────────┘ └─────────────────────┘ └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Tool System Layer (tool-v2)                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    ToolOrchestrator                                  │   │
│  │  • execute() - 工具执行编排                                          │   │
│  │  • 权限检查 → 审批 → 执行                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                    │                                                         │
│    ┌───────────────┼───────────────┬───────────────┬───────────────┐       │
│    ▼               ▼               ▼               ▼               ▼       │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│ │ Router   │ │ Registry │ │ Handlers │ │ Sandbox  │ │ Runtime  │          │
│ │ 路由分发 │ │ 工具注册 │ │ 处理器   │ │ 沙箱隔离 │ │ Shell执行│          │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Authorization Layer (auth)                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                   AuthorizationService                               │   │
│  │  • authorizeExecution() - 执行授权                                   │   │
│  │  • requestPermissions() - 权限请求                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│    ┌───────────────┬───────────────┬───────────────┐                       │
│    ▼               ▼               ▼               ▼                       │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                        │
│ │ Policy   │ │Permission│ │ Approval │ │  Audit   │                        │
│ │ 策略引擎 │ │ 权限服务 │ │ 审批服务 │ │ 审计服务 │                        │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 目录结构

```
src/agent/
├── agent/                    # 核心运行时
│   ├── index.ts             # StatelessAgent 入口
│   ├── run-loop.ts          # 主循环编排
│   ├── run-loop-stages.ts   # LLM/Tool 阶段
│   ├── llm-stream-runtime.ts # LLM 流处理
│   ├── tool-runtime.ts      # 工具执行运行时
│   ├── tool-executor.ts     # 工具执行器接口
│   ├── error.ts             # 错误类型定义
│   ├── timeout-budget.ts    # 超时预算管理
│   ├── compaction*.ts       # 上下文压缩
│   └── ...
├── tool-v2/                  # 工具系统 v2
│   ├── orchestrator.ts      # 工具编排器
│   ├── router.ts            # 工具路由
│   ├── registry.ts          # 工具注册表
│   ├── contracts.ts         # 契约定义
│   ├── context.ts           # 执行上下文
│   ├── handlers/            # 工具处理器
│   │   ├── shell.ts         # Shell 执行
│   │   ├── read-file.ts     # 文件读取
│   │   ├── write-file.ts    # 文件写入
│   │   ├── spawn-agent.ts   # 子代理
│   │   └── ...
│   ├── runtimes/            # 运行时实现
│   │   ├── shell-runtime.ts # Shell 运行时
│   │   └── ...
│   └── ...
├── auth/                     # 认证授权
│   ├── contracts.ts         # 授权契约
│   ├── authorization-service.ts # 授权服务
│   ├── policy-engine.ts     # 策略引擎
│   ├── permission-service.ts # 权限服务
│   ├── approval-service.ts  # 审批服务
│   └── audit-service.ts     # 审计服务
├── app/                      # 应用层
│   ├── agent-app-service.ts # 应用服务
│   ├── contracts.ts         # 应用契约
│   ├── ports.ts             # 端口定义
│   └── ...
├── storage/                  # 存储层
│   ├── file-history-store.ts # 文件历史
│   └── ...
├── types.ts                  # 核心类型
└── error-contract.ts        # 错误契约
```

---

## 核心模块分析

### 1. StatelessAgent (核心代理)

**位置**: `agent/index.ts`

**职责**:
- 无状态代理实现，支持水平扩展
- 管理执行生命周期
- 协调 LLM 和工具执行
- 超时预算管理

**关键配置**:

```typescript
interface AgentConfig {
  maxRetryCount?: number;           // 最大重试次数 (默认 20)
  enableCompaction?: boolean;       // 启用上下文压缩
  compactionTriggerRatio?: number;  // 压缩触发阈值 (默认 0.8)
  maxConcurrentToolCalls?: number;  // 最大并发工具调用 (默认 1)
  timeoutBudgetMs?: number;         // 总超时预算
  llmTimeoutRatio?: number;         // LLM 超时比例 (默认 0.7)
}
```

### 2. Run Loop (运行循环)

**位置**: `agent/run-loop.ts`

**职责**:
- 编排 LLM 和工具执行阶段
- 错误处理与重试逻辑
- 进度跟踪与检查点

**状态机**:

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  Start  │────▶│   LLM   │────▶│  Tool   │────▶│   Done  │
└─────────┘     └────┬────┘     └────┬────┘     └─────────┘
                     │               │
                     │ Error         │ Error
                     ▼               ▼
                ┌─────────┐     ┌─────────┐
                │  Retry  │     │  Retry  │
                └────┬────┘     └────┬────┘
                     │               │
                     └───────┬───────┘
                             │
                             ▼
                      ┌─────────────┐
                      │ Max Retries │
                      │    Error    │
                      └─────────────┘
```

### 3. ToolOrchestrator (工具编排器)

**位置**: `tool-v2/orchestrator.ts`

**职责**:
- 工具调用路由
- 权限与审批检查
- 执行计划生成
- 事件发射

**执行流程**:

```
ToolCallRequest
      │
      ▼
┌─────────────┐
│  Received   │ 接收请求
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Parsed    │ 解析参数
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Planned   │ 生成执行计划
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│        Authorization Check           │
│  ┌─────────────┐  ┌─────────────┐   │
│  │ Permission  │─▶│  Approval   │   │
│  │   Check     │  │   Check     │   │
│  └─────────────┘  └─────────────┘   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────┐
│  Executing  │ 执行工具
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Succeeded  │ 或 Failed
└─────────────┘
```

### 4. AuthorizationService (授权服务)

**位置**: `auth/authorization-service.ts`

**职责**:
- 策略评估
- 权限管理
- 审批流程
- 审计记录

**授权流程**:

```
AuthorizationRequest
        │
        ▼
┌───────────────────┐
│  Policy Engine    │ 评估策略规则
│  Evaluate         │
└─────────┬─────────┘
          │
          ▼
    ┌─────┴─────┐
    │  Denied?  │
    └─────┬─────┘
          │
    ┌─────┴─────┐
    │ Yes       │ No
    ▼           ▼
┌────────┐  ┌───────────────────┐
│ Throw  │  │ Permission Service │
│ Error  │  │ Ensure Permissions │
└────────┘  └─────────┬─────────┘
                      │
                      ▼
            ┌───────────────────┐
            │ Approval Service  │
            │ Ensure Approval   │
            └─────────┬─────────┘
                      │
                      ▼
            ┌───────────────────┐
            │   Audit Record    │
            │   Log Decision    │
            └─────────┬─────────┘
                      │
                      ▼
            ┌───────────────────┐
            │  Allow Execution  │
            └───────────────────┘
```

---

## 流程图说明

### 流程图 1: 完整执行流程

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Agent 完整执行流程                                  │
└──────────────────────────────────────────────────────────────────────────────┘

用户输入
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. AgentAppService.runForeground()                                          │
│    • 创建 executionId                                                        │
│    • 构建初始消息列表                                                         │
│    • 初始化事件存储                                                           │
│    • 激活运行注册                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. StatelessAgent.runStream()                                                │
│    • 解析工具列表                                                             │
│    • 注入系统提示                                                             │
│    • 创建超时预算                                                             │
│    • 创建执行作用域                                                           │
│    • 初始化生命周期钩子                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. runAgentLoop() - 主循环                                                   │
│    ┌─────────────────────────────────────────────────────────────────────┐  │
│    │ while (stepIndex < maxSteps)                                        │  │
│    │   │                                                                 │  │
│    │   ├─▶ 检查终止条件                                                   │  │
│    │   │                                                                 │  │
│    │   ├─▶ 准备消息 (压缩/续写)                                           │  │
│    │   │                                                                 │  │
│    │   ├─▶ runLLMStage()                                                 │  │
│    │   │     • 创建 LLM 作用域                                            │  │
│    │   │     • 调用 LLM Provider                                          │  │
│    │   │     • 流式处理响应                                               │  │
│    │   │     • 合并工具调用                                               │  │
│    │   │                                                                 │  │
│    │   ├─▶ 有工具调用?                                                    │  │
│    │   │     │                                                           │  │
│    │   │     ├─ Yes ─▶ runToolStage()                                    │  │
│    │   │     │            • 创建工具作用域                                 │  │
│    │   │     │            • 并发执行工具                                   │  │
│    │   │     │            • 合并结果消息                                   │  │
│    │   │     │            • 发射检查点                                     │  │
│    │   │     │            • continue (下一轮)                              │  │
│    │   │     │                                                           │  │
│    │   │     └─ No ─▶ 检查待处理用户输入                                   │  │
│    │   │                  │                                              │  │
│    │   │                  ├─ 有 ─▶ continue                              │  │
│    │   │                  │                                              │  │
│    │   │                  └─ 无 ─▶ 发射 done 事件, break                  │  │
│    │   │                                                                 │  │
│    │   └─▶ 错误处理                                                       │  │
│    │         • 判断是否可重试                                              │  │
│    │         • 计算退避延迟                                                │  │
│    │         • 超过最大重试则失败                                           │  │
│    └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. 清理与返回                                                                │
│    • 释放执行作用域                                                          │
│    • 完成生命周期观察                                                        │
│    • 返回执行结果                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 流程图 2: LLM 阶段详细流程

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           LLM 阶段详细流程                                    │
└──────────────────────────────────────────────────────────────────────────────┘

runLLMStage(runtime, state, stepIndex)
    │
    ├─▶ 创建 LLM 观察作用域
    │     • onLLMStageStart()
    │
    ├─▶ 创建阶段超时作用域
    │     • createStageAbortScope('llm')
    │
    ├─▶ 合并 LLM 配置
    │     • mergeLLMRequestConfig()
    │
    ├─▶ callLLMAndProcessStream()
    │     │
    │     ├─▶ 构建请求计划
    │     │     • buildLLMRequestPlan()
    │     │     • 处理续写元数据
    │     │
    │     ├─▶ 调用 LLM Provider
    │     │     • llmProvider.generateStream()
    │     │
    │     └─▶ 流式处理
    │           │
    │           ├─▶ for await (chunk of stream)
    │           │     │
    │           │     ├─▶ 检查中止信号
    │           │     │
    │           │     ├─▶ 处理内容块
    │           │     │     • yield { type: 'chunk', data }
    │           │     │
    │           │     ├─▶ 处理推理内容
    │           │     │     • yield { type: 'reasoning_chunk', data }
    │           │     │
    │           │     ├─▶ 处理工具调用
    │           │     │     • mergeStreamingToolCalls()
    │           │     │     • 缓冲 write_file 参数
    │           │     │     • yield { type: 'tool_call', data }
    │           │     │
    │           │     └─▶ 处理结束原因
    │           │
    │           └─▶ 返回 LLMStreamResult
    │                 • assistantMessage
    │                 • toolCalls
    │
    ├─▶ 检查中止状态
    │
    └─▶ 完成观察作用域
          • onLLMStageFinish()
```

### 流程图 3: 工具执行详细流程

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           工具执行详细流程                                    │
└──────────────────────────────────────────────────────────────────────────────┘

processToolCalls(runtime, args)
    │
    ├─▶ 构建执行计划
    │     • 为每个 toolCall 创建 ToolExecutionPlan
    │     • 解析并发策略
    │
    ├─▶ 构建执行波次
    │     • buildExecutionWaves()
    │     • 分离 exclusive 和 parallel 工具
    │
    └─▶ 执行每个波次
          │
          └─▶ for each wave
                │
                ├─▶ parallel wave
                │     │
                │     └─▶ Promise.all(
                │           executeTool(toolCall) for each in wave
                │         )
                │
                └─▶ exclusive wave
                      │
                      └─▶ for await (toolCall of wave)
                            executeTool(toolCall)


executeTool(runtime, args)
    │
    ├─▶ 创建工具执行观察作用域
    │     • onToolExecutionStart()
    │
    ├─▶ executeToolWithLedger()
    │     │
    │     ├─▶ 检查幂等性账本
    │     │     • 已执行? 返回缓存结果
    │     │
    │     ├─▶ AgentToolExecutor.execute()
    │     │     │
    │     │     └─▶ ToolOrchestrator.execute()
    │     │           │
    │     │           ├─▶ emitEvent('received')
    │     │           │
    │     │           ├─▶ Router.route()
    │     │           │     • 获取 Handler
    │     │           │
    │     │           ├─▶ emitEvent('parsed')
    │     │           │
    │     │           ├─▶ Handler.plan()
    │     │           │     • 生成执行计划
    │     │           │
    │     │           ├─▶ emitEvent('planned')
    │     │           │
    │     │           ├─▶ Authorization
    │     │           │     │
    │     │           │     ├─▶ authorizeExecution()
    │     │           │     │     • 策略评估
    │     │           │     │     • 权限检查
    │     │           │     │     • 审批检查
    │     │           │     │
    │     │           │     └─▶ 断言计划权限
    │     │           │           • assertReadAccess()
    │     │           │           • assertWriteAccess()
    │     │           │           • assertNetworkAccess()
    │     │           │
    │     │           ├─▶ emitEvent('executing')
    │     │           │
    │     │           ├─▶ Handler.execute()
    │     │           │     • 执行实际操作
    │     │           │
    │     │           ├─▶ emitEvent('succeeded')
    │     │           │
    │     │           └─▶ 返回 ToolCallResult
    │     │
    │     └─▶ 记录到幂等性账本
    │
    ├─▶ yield { type: 'tool_result', data }
    │
    └─▶ 完成观察作用域
          • onToolExecutionFinish()
```

### 流程图 4: 授权决策流程

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           授权决策流程                                        │
└──────────────────────────────────────────────────────────────────────────────┘

AuthorizationService.authorizeExecution(request)
    │
    ├─▶ PolicyEngine.evaluate(request)
    │     │
    │     ├─▶ 检查组织策略
    │     │     • organization-policy.ts
    │     │
    │     ├─▶ 检查工具信任级别
    │     │     • trusted / untrusted / unknown
    │     │
    │     ├─▶ 检查资源访问规则
    │     │     • 文件系统路径
    │     │     • 网络目标
    │     │
    │     └─▶ 返回 PolicyEvaluation
    │           • denied: boolean
    │           • reason: string
    │           • rulesMatched: string[]
    │
    ├─▶ denied?
    │     │
    │     ├─ Yes ─▶ 抛出 ToolV2PolicyDeniedError
    │     │
    │     └─ No ─▶ 继续
    │
    ├─▶ PermissionService.ensurePermissions(request)
    │     │
    │     ├─▶ 检查会话权限状态
    │     │     • sessionState.effectivePermissions()
    │     │
    │     ├─▶ 需要额外权限?
    │     │     │
    │     │     ├─ Yes ─▶ requestPermissions()
    │     │     │           │
    │     │     │           └─▶ 用户交互请求权限
    │     │     │                 • 弹窗确认
    │     │     │                 • 记录授权
    │     │     │
    │     │     └─ No ─▶ 使用现有权限
    │     │
    │     └─▶ 返回 PermissionResolution
    │           • fileSystemPolicy
    │           • networkPolicy
    │           • grantRecord
    │
    ├─▶ ApprovalService.ensureApproval(request)
    │     │
    │     ├─▶ 检查审批策略
    │     │     • never / on-request / on-failure / unless-trusted
    │     │
    │     ├─▶ 检查会话审批缓存
    │     │     • sessionState.hasApproval(key)
    │     │
    │     ├─▶ 需要审批?
    │     │     │
    │     │     ├─ Yes ─▶ requestApproval()
    │     │     │           │
    │     │     │           └─▶ 用户交互审批
    │     │     │                 • 显示命令预览
    │     │     │                 • 用户确认/拒绝
    │     │     │                 • 记录决策
    │     │     │
    │     │     └─ No ─▶ 跳过审批
    │     │
    │     └─▶ 返回 ApprovalResolution
    │           • approvalRecord
    │           • cached: boolean
    │
    ├─▶ AuditService.record()
    │     • 记录授权决策
    │     • 包含所有匹配规则
    │     • 时间戳和元数据
    │
    └─▶ 返回 AuthorizationExecutionResult
          • decision
          • fileSystemPolicy
          • networkPolicy
```

### 流程图 5: Shell 工具执行流程

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Shell 工具执行流程                                  │
└──────────────────────────────────────────────────────────────────────────────┘

ShellHandler.execute(args, context)
    │
    ├─▶ 解析命令
    │     • command, cwd, timeoutMs
    │
    ├─▶ 确定沙箱模式
    │     • restricted / workspace-write / full-access
    │
    ├─▶ 应用 Shell 策略
    │     • shell-policy.ts
    │     • 检查禁止命令
    │     • 应用配置文件
    │
    ├─▶ 选择执行模式
    │     │
    │     ├─ foreground (前台)
    │     │     │
    │     │     └─▶ LocalProcessShellRuntime.execute()
    │     │           │
    │     │           ├─▶ 解析 Shell
    │     │           │     • resolvePreferredShell()
    │     │           │     • posix / powershell / cmd
    │     │           │
    │     │           ├─▶ 创建输出捕获
    │     │           │     • ShellOutputCapture.create()
    │     │           │
    │     │           ├─▶ spawn() 子进程
    │     │           │     • 设置环境变量
    │     │           │     • 注入 PATH 条目
    │     │           │
    │     │           ├─▶ 流式输出
    │     │           │     • stdout → onStdout
    │     │           │     • stderr → onStderr
    │     │           │
    │     │           ├─▶ 超时处理
    │     │           │     • setTimeout → child.kill()
    │     │           │
    │     │           ├─▶ 中止处理
    │     │           │     • signal.addEventListener('abort')
    │     │           │
    │     │           └─▶ 返回 ShellRuntimeResult
    │     │                 • exitCode
    │     │                 • timedOut
    │     │                 • output
    │     │                 • artifact
    │     │
    │     └─ background (后台)
    │           │
    │           └─▶ LocalProcessShellRuntime.startBackground()
    │                 │
    │                 ├─▶ 创建任务目录
    │                 │     • taskId
    │                 │     • output.log
    │                 │     • status
    │                 │
    │                 ├─▶ spawn() 分离子进程
    │                 │     • detached: true
    │                 │     • unref()
    │                 │
    │                 └─▶ 返回 ShellBackgroundExecutionRecord
    │                       • taskId
    │                       • pid
    │                       • status: 'running'
    │
    └─▶ 返回 ToolHandlerResult
          • output
          • structured
          • metadata
```

### 流程图 6: 子代理 (spawn-agent) 流程

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           子代理执行流程                                      │
└──────────────────────────────────────────────────────────────────────────────┘

SpawnAgentHandler.execute(args, context)
    │
    ├─▶ 解析参数
    │     • role: 子代理角色
    │     • prompt: 任务指令
    │     • maxSteps: 最大步数
    │     • runInBackground: 后台运行
    │     • linkedTaskId: 关联任务 ID
    │
    ├─▶ 创建子代理配置
    │     • 根据角色选择工具集
    │     • 设置权限边界
    │
    ├─▶ 执行模式
    │     │
    │     ├─ foreground (前台)
    │     │     │
    │     │     └─▶ 直接运行子代理
    │     │           │
    │     │           ├─▶ 创建子 StatelessAgent
    │     │           │
    │     │           ├─▶ runStream()
    │     │           │     • 收集所有事件
    │     │           │
    │     │           └─▶ 返回结果
    │     │                 • agentId
    │     │                 • status: 'completed'
    │     │                 • output
    │     │
    │     └─ background (后台)
    │           │
    │           └─▶ 异步运行子代理
    │                 │
    │                 ├─▶ 创建 SubagentExecutionRecord
    │                 │     • agentId
    │                 │     • status: 'running'
    │                 │
    │                 ├─▶ 存储到 AgentStore
    │                 │
    │                 ├─▶ 异步执行
    │                 │     • 不等待完成
    │                 │     • 完成后更新状态
    │                 │
    │                 └─▶ 返回记录
    │                       • agentId
    │                       • status: 'running'
    │
    ├─▶ 关联任务 (如果有 linkedTaskId)
    │     │
    │     └─▶ linkTaskToSubagentStart()
    │           • 更新任务状态
    │           • 记录 agentId
    │
    └─▶ 返回 ToolHandlerResult
          • output: JSON 格式结果
          • structured: SubagentExecutionRecord
```

### 流程图 7: 上下文压缩流程

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           上下文压缩流程                                      │
└──────────────────────────────────────────────────────────────────────────────┘

prepareMessagesForLlmStep(messages, tools, contextLimitTokens)
    │
    ├─▶ 计算当前上下文使用量
    │     • calculateContextUsage()
    │     • contextTokens / contextLimitTokens
    │
    ├─▶ 超过触发阈值?
    │     │
    │     ├─ No ─▶ 返回原始消息
    │     │
    │     └─ Yes ─▶ 执行压缩
    │                 │
    │                 ├─▶ 选择压缩策略
    │                 │     • compaction-selection.ts
    │                 │     • 选择要移除的消息
    │                 │
    │                 ├─▶ 执行压缩
    │                 │     • compaction.ts
    │                 │     • 生成摘要消息
    │                 │
    │                 ├─▶ 应用压缩
    │                 │     • 移除选定消息
    │                 │     • 插入摘要消息
    │                 │
    │                 └─▶ 发射压缩事件
    │                       • onCompaction()
    │                       • removedMessageIds
    │                       • messageCountBefore/After
    │
    └─▶ 返回处理后的消息
```

### 流程图 8: 超时预算管理流程

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           超时预算管理流程                                    │
└──────────────────────────────────────────────────────────────────────────────┘

createTimeoutBudgetState(input, config)
    │
    ├─▶ 解析总预算
    │     • input.timeoutBudgetMs
    │     • config.timeoutBudgetMs
    │
    ├─▶ 解析 LLM 比例
    │     • input.llmTimeoutRatio
    │     • config.llmTimeoutRatio (默认 0.7)
    │
    └─▶ 返回 TimeoutBudgetState
          • totalMs
          • llmRatio
          • startedAt


createStageAbortScope(baseSignal, timeoutBudget, stage)
    │
    ├─▶ 创建 AbortController
    │
    ├─▶ 链接基础信号
    │     • baseSignal.addEventListener('abort')
    │
    ├─▶ 设置阶段超时
    │     │
    │     ├─ LLM 阶段
    │     │     • timeout = totalMs * llmRatio
    │     │
    │     └─ Tool 阶段
    │           • timeout = totalMs * (1 - llmRatio)
    │
    └─▶ 返回 AbortScope
          • signal
          • release()


执行流程中的超时检查:

┌─────────────────────────────────────────────────────────────────┐
│                     Execution Scope                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    LLM Stage Scope                          │ │
│  │  timeout: totalMs * llmRatio (70%)                          │ │
│  │  ┌────────────────────────────────────────────────────────┐│ │
│  │  │              Tool Stage Scope                          ││ │
│  │  │  timeout: totalMs * (1 - llmRatio) (30%)               ││ │
│  │  │  per-tool timeout: stageTimeout / expectedToolCount    ││ │
│  │  └────────────────────────────────────────────────────────┘│ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 关键设计模式

### 1. 无状态设计 (Stateless Design)

**实现**: `StatelessAgent`

```
┌─────────────────────────────────────────────────────────────────┐
│                    StatelessAgent                                │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ LLMProvider │  │ToolExecutor │  │   Config    │            │
│  │  (注入)     │  │  (注入)     │  │  (注入)     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
│  不持有:                                                        │
│  • 会话状态                                                     │
│  • 消息历史                                                     │
│  • 执行上下文                                                   │
│                                                                 │
│  优势:                                                          │
│  • 水平扩展                                                     │
│  • 无状态重启                                                   │
│  • 多副本安全                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 依赖注入 (Dependency Injection)

**实现**: 通过构造函数注入所有外部依赖

```typescript
// AgentAppService 依赖注入
interface AgentAppServiceDeps {
  agent: StatelessAgent;
  executionStore: ExecutionStorePort;
  eventStore: EventStorePort;
  messageStore?: MessageProjectionStorePort;
  runLogStore?: RunLogStorePort;
  pendingInputStore?: PendingInputStorePort;
}

// ToolOrchestrator 依赖注入
constructor(private readonly router: ToolRouter) {}

// AuthorizationService 依赖注入
interface AuthorizationServiceOptions {
  readonly policyEngine?: AuthorizationPolicyEngine;
  readonly permissionService?: AuthorizationPermissionService;
  readonly approvalService?: AuthorizationApprovalService;
  readonly auditService?: AuthorizationAuditService;
}
```

### 3. 端口与适配器 (Ports and Adapters)

**实现**: `app/ports.ts`

```
┌─────────────────────────────────────────────────────────────────┐
│                    Application Core                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    AgentAppService                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                        Ports                                │ │
│  │  • ExecutionStorePort                                      │ │
│  │  • EventStorePort                                          │ │
│  │  • MessageProjectionStorePort                              │ │
│  │  • RunLogStorePort                                         │ │
│  │  • PendingInputStorePort                                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Adapters                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ SQLite Adapter  │  │  File Adapter   │  │ Memory Adapter  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 4. 策略模式 (Strategy Pattern)

**实现**: 工具处理器、策略引擎

```typescript
// 工具处理器策略
interface ToolHandler<TArgs = unknown> {
  readonly spec: ToolSpec;
  parseArguments(rawArguments: string): TArgs;
  plan(args: TArgs, context: ToolExecutionContext): ToolExecutionPlan;
  execute(args: TArgs, context: ToolExecutionContext): Promise<ToolHandlerResult>;
}

// 策略引擎接口
interface AuthorizationPolicyEngine {
  evaluate(request: AuthorizationExecutionRequest): Promise<PolicyEvaluation>;
}
```

### 5. 观察者模式 (Observer Pattern)

**实现**: 生命周期钩子、事件发射

```typescript
// 生命周期钩子
interface AgentRuntimeLifecycleHooks {
  onRunStart?(context: RunLifecycleStartContext): Promise<AgentRuntimeObservation>;
  onLLMStageStart?(context: LLMStageStartContext): Promise<AgentRuntimeObservation>;
  onToolStageStart?(context: ToolStageStartContext): Promise<AgentRuntimeObservation>;
  onToolExecutionStart?(context: ToolExecutionStartContext): Promise<AgentRuntimeObservation>;
}

// 事件发射
interface AgentCallbacks {
  onMessage: (message: Message) => void | Promise<void>;
  onCheckpoint: (checkpoint: ExecutionCheckpoint) => void | Promise<void>;
  onProgress?: (progress: ExecutionProgress) => void | Promise<void>;
  onCompaction?: (compaction: CompactionInfo) => void | Promise<void>;
  onMetric?: (metric: AgentMetric) => void | Promise<void>;
  onTrace?: (event: AgentTraceEvent) => void | Promise<void>;
}
```

### 6. 责任链模式 (Chain of Responsibility)

**实现**: 授权流程

```
AuthorizationRequest
        │
        ▼
┌───────────────────┐
│  Policy Engine    │ ─── Denied ──▶ Throw Error
└─────────┬─────────┘
          │ Allowed
          ▼
┌───────────────────┐
│ Permission Service│ ─── Denied ──▶ Request Permissions
└─────────┬─────────┘
          │ Granted
          ▼
┌───────────────────┐
│ Approval Service  │ ─── Denied ──▶ Request Approval
└─────────┬─────────┘
          │ Approved
          ▼
┌───────────────────┐
│  Audit Service    │
└─────────┬─────────┘
          │
          ▼
    Allow Execution
```

---

## 数据流分析

### 消息流

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              消息流                                          │
└─────────────────────────────────────────────────────────────────────────────┘

用户输入
    │
    ▼
┌──────────────┐
│ user Message │ ─────────────────────────────────────────┐
└──────────────┘                                          │
    │                                                     │
    ▼                                                     │
┌──────────────────────────────────────────────────────┐  │
│                    Message List                       │  │
│  ┌─────────────────────────────────────────────────┐ │  │
│  │ system Message (if provided)                     │ │  │
│  ├─────────────────────────────────────────────────┤ │  │
│  │ user Message                                    │ │  │
│  ├─────────────────────────────────────────────────┤ │  │
│  │ assistant Message (tool calls)                  │ │  │
│  ├─────────────────────────────────────────────────┤ │  │
│  │ tool Message (results)                          │ │  │
│  ├─────────────────────────────────────────────────┤ │  │
│  │ ... (循环)                                      │ │  │
│  └─────────────────────────────────────────────────┘ │  │
└──────────────────────────────────────────────────────┘  │
    │                                                     │
    │ 压缩 (如果需要)                                      │
    ▼                                                     │
┌──────────────────────────────────────────────────────┐  │
│              Compacted Message List                   │  │
│  ┌─────────────────────────────────────────────────┐ │  │
│  │ system Message                                  │ │  │
│  ├─────────────────────────────────────────────────┤ │  │
│  │ summary Message (压缩摘要)                      │ │  │
│  ├─────────────────────────────────────────────────┤ │  │
│  │ recent Messages                                 │ │  │
│  └─────────────────────────────────────────────────┘ │  │
└──────────────────────────────────────────────────────┘  │
    │                                                     │
    ▼                                                     │
┌──────────────┐                                          │
│ LLM Request  │                                          │
└──────────────┘                                          │
    │                                                     │
    ▼                                                     │
┌──────────────────────────────────────────────────────┐  │
│              LLM Response                             │  │
│  ┌─────────────────────────────────────────────────┐ │  │
│  │ assistant Message                               │ │  │
│  │   • content: string                             │ │  │
│  │   • tool_calls: ToolCall[]                      │ │  │
│  │   • usage: Usage                                │ │  │
│  └─────────────────────────────────────────────────┘ │  │
└──────────────────────────────────────────────────────┘  │
    │                                                     │
    ▼                                                     │
┌──────────────────────────────────────────────────────┐  │
│              Tool Execution                           │  │
│  ┌─────────────────────────────────────────────────┐ │  │
│  │ tool Message (result)                           │ │  │
│  │   • tool_call_id: string                        │ │  │
│  │   • content: string (output)                    │ │  │
│  └─────────────────────────────────────────────────┘ │  │
└──────────────────────────────────────────────────────┘  │
    │                                                     │
    └─────────────────────────────────────────────────────┘
                          │
                          ▼
                    继续循环...
```

### 事件流

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              事件流                                          │
└─────────────────────────────────────────────────────────────────────────────┘

StreamEvent Types:
┌─────────────────┐
│ 'chunk'         │ LLM 文本块
│ 'reasoning_chunk'│ LLM 推理内容块
│ 'user_message'  │ 用户消息
│ 'tool_call'     │ 工具调用
│ 'tool_result'   │ 工具结果
│ 'tool_stream'   │ 工具流输出
│ 'progress'      │ 进度更新
│ 'checkpoint'    │ 检查点
│ 'compaction'    │ 压缩事件
│ 'done'          │ 完成
│ 'error'         │ 错误
└─────────────────┘

事件发射点:
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌─────────┐   ┌─────────┐   ┌─────────────┐
│   LLM   │   │  Tool   │   │ Run Loop    │
│ Stream  │   │ Execute │   │ Control     │
└────┬────┘   └────┬────┘   └──────┬──────┘
     │             │               │
     │             │               │
     ▼             ▼               ▼
┌─────────────────────────────────────────────────────┐
│                  Event Store                        │
│  • appendAutoSeq()                                  │
│  • 持久化所有事件                                    │
│  • 支持重放和恢复                                    │
└─────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────┐
│              Message Projection Store               │
│  • 从事件投影消息列表                                │
│  • 支持压缩后的消息视图                              │
└─────────────────────────────────────────────────────┘
```

### 权限流

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              权限流                                          │
└─────────────────────────────────────────────────────────────────────────────┘

ToolCallRequest
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ToolSessionState                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ effectivePermissions()                                               │   │
│  │   • sessionPermissions (会话级)                                      │   │
│  │   • turnPermissions (轮次级)                                         │   │
│  │   • mergePermissionProfiles()                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Approval Cache                                                       │   │
│  │   • hasApproval(key)                                                 │   │
│  │   • grantApproval(key, scope)                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ToolPermissionProfile                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ fileSystem:                                                          │   │
│  │   • read: string[]  (允许读取的路径)                                  │   │
│  │   • write: string[] (允许写入的路径)                                  │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ network:                                                             │   │
│  │   • enabled: boolean                                                 │   │
│  │   • allowedHosts: string[]                                           │   │
│  │   • deniedHosts: string[]                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Permission Grant Flow                                   │
│                                                                              │
│  1. 检查现有权限                                                             │
│     │                                                                        │
│     ├─ 足够 ─▶ 继续执行                                                      │
│     │                                                                        │
│     └─ 不足 ─▶ 请求权限                                                      │
│                │                                                             │
│                ▼                                                             │
│  2. request_permissions 工具调用                                             │
│     │                                                                        │
│     ├─ 用户批准 ─▶ grantPermissions()                                        │
│     │                • scope: 'turn' | 'session'                             │
│     │                                                                        │
│     └─ 用户拒绝 ─▶ 抛出权限错误                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 扩展点与插件机制

### 1. 工具扩展

**添加新工具**:

```typescript
// 1. 定义工具处理器
class MyCustomHandler extends StructuredToolHandler<MyArgsSchema> {
  constructor() {
    super({
      name: 'my_custom_tool',
      description: 'My custom tool description',
      schema: myArgsSchema,
      supportsParallel: true,
      mutating: false,
    });
  }

  plan(args: MyArgs, context: ToolExecutionContext): ToolExecutionPlan {
    return {
      mutating: false,
      readPaths: [...],
      writePaths: [...],
      networkTargets: [...],
    };
  }

  async execute(args: MyArgs, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    // 实现工具逻辑
    return {
      output: 'result',
      structured: { ... },
    };
  }
}

// 2. 注册工具
const registry = new ToolRegistry();
registry.register(new MyCustomHandler());

// 3. 创建路由和编排器
const router = new ToolRouter(registry);
const orchestrator = new ToolOrchestrator(router);
```

### 2. 策略扩展

**自定义授权策略**:

```typescript
class MyCustomPolicyEngine implements AuthorizationPolicyEngine {
  async evaluate(request: AuthorizationExecutionRequest): Promise<PolicyEvaluation> {
    // 实现自定义策略逻辑
    const rules: string[] = [];
    const tags: string[] = [];
    
    // 检查规则
    if (this.isDenied(request)) {
      return {
        denied: true,
        reason: 'Custom policy denied',
        rulesMatched: rules,
        tags,
      };
    }
    
    return {
      denied: false,
      reason: 'Allowed by custom policy',
      rulesMatched: rules,
      tags,
    };
  }
}

// 使用自定义策略
const authService = new AuthorizationService({
  policyEngine: new MyCustomPolicyEngine(),
});
```

### 3. 存储扩展

**自定义存储适配器**:

```typescript
// 实现 ExecutionStorePort
class MyCustomExecutionStore implements ExecutionStorePort {
  async create(record: RunRecord): Promise<void> {
    // 实现创建逻辑
  }
  
  async get(executionId: string): Promise<RunRecord | null> {
    // 实现获取逻辑
  }
  
  async patch(executionId: string, updates: Partial<RunRecord>): Promise<void> {
    // 实现更新逻辑
  }
  
  // ... 其他方法
}

// 注入自定义存储
const appService = new AgentAppService({
  agent: statelessAgent,
  executionStore: new MyCustomExecutionStore(),
  eventStore: new MyCustomEventStore(),
});
```

### 4. 生命周期钩子扩展

**自定义观察性钩子**:

```typescript
const customHooks: AgentRuntimeLifecycleHooks = {
  onRunStart: async (context) => {
    console.log(`Run started: ${context.executionId}`);
    return createNoopObservation();
  },
  
  onLLMStageStart: async (context) => {
    console.log(`LLM stage ${context.stepIndex} started`);
    return createNoopObservation();
  },
  
  onToolExecutionStart: async (context) => {
    console.log(`Tool ${context.toolName} started`);
    return createNoopObservation();
  },
};

// 集成到运行时
const runtime = buildRunLoopRuntime(baseConfig, customHooks);
```

---

## 总结

### 架构优势

1. **无状态设计**: 支持水平扩展和多副本部署
2. **依赖注入**: 高度可测试和可配置
3. **端口适配器**: 存储层可替换
4. **策略模式**: 工具和策略可扩展
5. **观察者模式**: 完整的可观察性支持
6. **责任链**: 灵活的授权流程

### 关键流程

1. **执行流程**: AgentAppService → StatelessAgent → RunLoop → LLM/Tool Stages
2. **工具流程**: Router → Plan → Authorize → Execute → Result
3. **授权流程**: Policy → Permission → Approval → Audit
4. **消息流**: User → LLM → Tool → Result → Loop

### 扩展点

1. **工具**: 实现 ToolHandler 接口
2. **策略**: 实现 AuthorizationPolicyEngine 接口
3. **存储**: 实现 Port 接口
4. **钩子**: 实现 AgentRuntimeLifecycleHooks 接口

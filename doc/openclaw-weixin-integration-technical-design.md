# OpenClaw WeChat Channel Integration — 技术设计文档

> 版本: 1.0 | 日期: 2026-03-30 | 状态: 实现

---

## 1. 目标与范围

将 `@tencent-weixin/openclaw-weixin` 微信通道能力集成到 renx-code，使微信用户可以通过 iLink Bot API 与 renx-code AI Agent 双向交互。

**核心原则：** 微信只是一个 Channel Adapter，内核 `StatelessAgent` 永远不知道微信的存在。

---

## 2. 架构总览

```
                    ┌───────────────────────────────────────────────┐
                    │              packages/server                   │
                    │            (Gateway HTTP Server)               │
                    │                                               │
微信用户 ◄────────►│  WeChat Channel Adapter (channels/wechat/)     │
  iLink Bot API    │         │                                      │
                    │         ▼                                      │
                    │  Channel Registry                             │
                    │         │                                      │
                    │         ▼                                      │
                    │  Conversation Router                          │
                    │         │                                      │
                    │         ▼                                      │
                    │  AgentAppService (from packages/core)         │
                    │         │                                      │
                    │         ▼                                      │
                    │  StatelessAgent (kernel — 无渠道感知)           │
                    │         │                                      │
                    │         ▼                                      │
                    │  Tool Runtime (tool-v2)                        │
                    └───────────────────────────────────────────────┘
```

### 2.1 七层架构

| 层 | 职责 | 代码位置 |
|---|---|---|
| Surface | 微信、WebChat、CLI 等入口 | `packages/server/src/channels/` |
| Gateway | HTTP API、SSE、Webhook、Auth | `packages/server/src/gateway/` |
| Routing | (channel, peer) → conversationId | `packages/server/src/routing/` |
| Application | AgentAppService 编排 | `packages/core/src/agent/app/` |
| Kernel | StatelessAgent 纯推理 | `packages/core/src/agent/agent/` |
| Tool Runtime | 工具注册/权限/执行 | `packages/core/src/agent/tool-v2/` |
| Storage | SQLite 持久化 | `packages/server/src/storage/` |

### 2.2 依赖规则

```
packages/server  →  packages/core
packages/cli     →  packages/core
packages/server  ↛  packages/cli (不依赖)
packages/core    ↛  packages/server (不依赖)
```

---

## 3. Channel Adapter 接口设计

### 3.1 核心类型 (`packages/core/src/channel/types.ts`)

```typescript
/** 入站消息 — 所有渠道统一格式 */
export interface InboundChannelMessage {
  readonly channelId: string;      // e.g. "wechat", "webchat"
  readonly accountId: string;      // 渠道账号标识
  readonly peerId: string;         // 对端用户 ID
  readonly threadId?: string;      // 群组/话题 ID
  readonly senderId: string;       // 实际发送者
  readonly text?: string;          // 文本内容
  readonly media?: ChannelMedia;   // 媒体附件
  readonly rawEvent?: unknown;     // 原始事件数据
  readonly receivedAt: number;     // 时间戳
}

/** 出站消息 */
export interface OutboundChannelMessage {
  readonly conversationId: string;
  readonly channelId: string;
  readonly peerId: string;
  readonly text: string;
  readonly replyToMessageId?: string;
}

/** 媒体内容 */
export interface ChannelMedia {
  readonly type: 'image' | 'audio' | 'video' | 'file';
  readonly url?: string;
  readonly base64?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
}

/** 渠道适配器接口 */
export interface ChannelAdapter {
  readonly id: string;
  start(context: ChannelAdapterContext): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundChannelMessage): Promise<SendResult>;
  probe(): Promise<ChannelProbeResult>;
}

export interface ChannelAdapterContext {
  readonly onMessage: (message: InboundChannelMessage) => Promise<void>;
  readonly logger: ChannelLogger;
  readonly config: Record<string, unknown>;
}

export interface SendResult {
  readonly success: boolean;
  readonly messageId?: string;
  readonly error?: string;
}

export interface ChannelProbeResult {
  readonly connected: boolean;
  readonly details?: Record<string, unknown>;
}

export interface ChannelLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}
```

### 3.2 Channel Registry (`packages/core/src/channel/registry.ts`)

```typescript
export class ChannelRegistry {
  register(adapter: ChannelAdapter): void;
  get(channelId: string): ChannelAdapter | undefined;
  list(): ChannelAdapter[];
  async startAll(context: ChannelAdapterContext): Promise<void>;
  async stopAll(): Promise<void>;
}
```

---

## 4. Gateway HTTP Server 设计

### 4.1 目录结构 (`packages/server/`)

```
packages/server/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
└── src/
    ├── index.ts                         # 公共入口
    ├── server.ts                        # HTTP 服务器主类
    ├── config.ts                        # ServerConfig
    ├── gateway/
    │   ├── index.ts                     # Gateway 主入口
    │   ├── router.ts                    # HTTP 路由
    │   ├── auth.ts                      # Bearer Token 认证
    │   ├── sse.ts                       # SSE 流式输出
    │   ├── error-handler.ts             # 统一错误处理
    │   └── middleware.ts                # 中间件
    ├── channels/
    │   ├── index.ts                     # 渠道入口
    │   └── wechat/
    │       ├── index.ts                 # 微信适配器入口
    │       ├── adapter.ts               # WeChatChannelAdapter
    │       ├── ilink-client.ts          # iLink Bot API 客户端
    │       ├── message-mapper.ts        # 微信消息 ↔ InboundChannelMessage
    │       └── config.ts                # 微信配置
    ├── routing/
    │   ├── index.ts                     # 路由入口
    │   ├── conversation-router.ts       # 会话路由
    │   └── session-key.ts              # 会话密钥生成
    ├── storage/
    │   ├── index.ts                     # 存储入口
    │   ├── sqlite-store.ts              # SQLite 存储
    │   └── schema.sql                   # 数据库 Schema
    ├── plugin/
    │   ├── index.ts                     # 插件系统入口
    │   ├── plugin-api.ts                # GatewayPluginApi
    │   └── plugin-loader.ts             # 插件加载器
    └── runtime/
        ├── index.ts                     # 运行时入口
        └── gateway-runtime.ts           # Gateway 运行时编排
```

### 4.2 ServerConfig

```typescript
export interface ServerConfig {
  readonly port: number;                    // 默认 3100
  readonly host: string;                    // 默认 '0.0.0.0'
  readonly stateDir: string;                // 默认 '~/.renx/server'
  readonly workspaceDir: string;            // 工作区根目录
  readonly authToken?: string;              // Bearer Token
  readonly trustedProxySecret?: string;     // 可信代理密钥
  readonly channels: ChannelConfig[];       // 渠道配置列表
  readonly model?: {                        // 模型配置
    readonly provider: string;
    readonly modelId: string;
  };
}
```

### 4.3 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/runs` | 创建 Agent 运行 |
| GET | `/api/runs/:executionId` | 查询运行状态 |
| GET | `/api/sessions` | 列出会话 |
| POST | `/v1/chat/completions` | OpenAI 兼容接口 |
| POST | `/api/channels/:channelId/webhook` | 渠道 Webhook 回调 |

### 4.4 SSE 流式输出

```
POST /v1/chat/completions  (stream: true)

Response:
Content-Type: text/event-stream

data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"..."}}]}
data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"..."}}]}
data: [DONE]
```

---

## 5. 存储设计

### 5.1 SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,                    -- dm:wechat:account1:user1
  channel_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  thread_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_accounts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  config TEXT NOT NULL,                   -- JSON
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_pairings (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  paired_by TEXT,
  paired_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS sender_allowlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  allowed_at INTEGER NOT NULL,
  UNIQUE(channel_id, peer_id)
);

CREATE TABLE IF NOT EXISTS gateway_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  channel_id TEXT,
  payload TEXT NOT NULL,                  -- JSON
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_conversations_channel_peer
  ON conversations(channel_id, account_id, peer_id);
CREATE INDEX idx_gateway_events_type
  ON gateway_events(event_type, created_at);
```

---

## 6. 会话路由设计

### 6.1 路由规则

```typescript
// 私聊路由
conversationId = `dm:${channelId}:${accountId}:${peerId}`

// 群聊路由
conversationId = `group:${channelId}:${accountId}:${threadId}`
```

### 6.2 ConversationRouter

```typescript
export class ConversationRouter {
  constructor(private readonly store: GatewayStore) {}

  async routeInbound(message: InboundChannelMessage): Promise<RoutedMessage> {
    // 1. 查找或创建 conversation
    // 2. 返回 { conversationId, message }
  }

  async resolveOutbound(conversationId: string): Promise<OutboundRoute> {
    // 1. 查找 conversation
    // 2. 返回 { channelId, peerId }
  }
}
```

---

## 7. 微信 Channel Adapter 设计

### 7.1 WeChatChannelAdapter

```typescript
export class WeChatChannelAdapter implements ChannelAdapter {
  readonly id = 'wechat';

  // 职责（仅限）：
  // 1. Login/Bind — 连接 iLink Bot API
  // 2. 接收入站消息 → 转为 InboundChannelMessage
  // 3. 收到 OutboundChannelMessage → 调用微信发送 API

  // 不得：
  // - 组装上下文
  // - 决定 conversationId
  // - 执行 Agent
  // - 持久化消息
}
```

### 7.2 iLink Bot API 集成

```typescript
export interface ILinkBotConfig {
  readonly appId: string;
  readonly appSecret: string;
  readonly apiBase?: string;   // 默认 https://ilink.weixin.qq.com
}

export class ILinkBotClient {
  // 获取 access_token
  // 接收消息（Webhook）
  // 发送文本/图片/文件
  // 获取用户信息
}
```

---

## 8. Plugin 系统设计

### 8.1 接口

```typescript
export interface GatewayPlugin {
  readonly id: string;
  readonly name: string;
  register(api: GatewayPluginApi): Promise<void>;
}

export interface GatewayPluginApi {
  registerChannel(adapter: ChannelAdapter): void;
  registerRoute(method: string, path: string, handler: RouteHandler): void;
  registerCommand(name: string, handler: CommandHandler): void;
  registerBackgroundService(service: BackgroundService): void;
  getStore(): GatewayStore;
}
```

### 8.2 微信作为插件

```typescript
export class WeChatPlugin implements GatewayPlugin {
  readonly id = '@tencent-weixin/openclaw-weixin';
  readonly name = 'WeChat Channel';

  async register(api: GatewayPluginApi): Promise<void> {
    const config = loadWeChatConfig();
    const adapter = new WeChatChannelAdapter(config);
    api.registerChannel(adapter);
    api.registerRoute('POST', '/channels/wechat/webhook', adapter.handleWebhook);
  }
}
```

---

## 9. ToolHandler 集成 (CLI 侧)

### 9.1 openclaw_weixin ToolHandler

在 `packages/core/src/agent/tool-v2/handlers/openclaw-weixin.ts`：

```typescript
export class OpenClawWeixinTool extends StructuredToolHandler<WeixinToolSchema> {
  // 允许 CLI agent 通过 openclaw API 操作微信通道
  // action: send | status | login | channels | list-conversations
}
```

### 9.2 注册方式

在 `packages/core/src/agent/tool-v2/builtins.ts` 中：

```typescript
// 条件注册（仅在 openclaw gateway 可用时）
if (options?.openclawWeixin?.gatewayUrl) {
  handlers.push(new OpenClawWeixinTool(options.openclawWeixin));
}
```

---

## 10. 运行时编排

### 10.1 GatewayRuntime

```typescript
export class GatewayRuntime {
  // 编排完整启动流程：
  // 1. 加载 ServerConfig
  // 2. 初始化 Storage (SQLite)
  // 3. 创建 LLM Provider
  // 4. 创建 ToolSystem (复用 factory.ts)
  // 5. 创建 AgentAppService (复用 enterprise-agent-factory.ts)
  // 6. 初始化 ChannelRegistry
  // 7. 加载 Plugins → 注册渠道
  // 8. 创建 ConversationRouter
  // 9. 创建 HTTP Server + 路由
  // 10. 启动所有渠道适配器
  // 11. 启动 HTTP Server
}
```

---

## 11. 安全设计

- Bearer Token 认证（所有 `/api/*` 端点）
- Webhook 签名验证（微信消息）
- 发送者白名单 (`sender_allowlist` 表)
- 配对码机制（新设备绑定）
- 速率限制
- 工具权限分级 (guest/paired_user/owner/admin)

---

## 12. 实现阶段

| 阶段 | 内容 | 预估 |
|------|------|------|
| Phase 0 | 核心类型 + 接口定义 | 1 天 |
| Phase 1 | Channel Registry + Channel Adapter 接口 (core) | 1 天 |
| Phase 2 | Storage 层 + Schema | 1 天 |
| Phase 3 | Gateway HTTP Server 骨架 + 路由 | 2 天 |
| Phase 4 | Conversation Router | 1 天 |
| Phase 5 | WeChat Channel Adapter | 2 天 |
| Phase 6 | Plugin 系统 | 1 天 |
| Phase 7 | OpenClaw Weixin ToolHandler (CLI) | 1 天 |
| Phase 8 | SSE 流式输出 | 1 天 |
| Phase 9 | 集成测试 | 2 天 |

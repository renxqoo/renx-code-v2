# Bash Tool 权限设计规范

## 目标

`local_shell` 是 `tool-v2` 中最强、风险也最高的工具。

它的权限设计目标不是“只要能跑就行”，而是：

1. 命令级风险要先被识别。
2. 文件和网络边界要由统一权限层强制执行。
3. shell 自己不要再维护第二套路径白名单/host 白名单。
4. 所有拒绝和失败都必须以结构化错误返回给 LLM，而不是直接把异常抛出运行时。

## 一句话原则

- shell policy 负责“这个命令本身危险不危险”
- permissions 负责“这个命令能访问哪些文件/网络”
- approval 负责“这次要不要执行”
- sandbox/runtime 负责“最终在什么隔离级别运行”

不要把这四层混成一层。

## 分层职责

### 1. 命令策略层

位置：

- `shell-policy.ts`

职责：

- 按命令语义判断 `allow / ask / deny`
- 决定推荐的 `sandbox mode`
- 决定是否需要额外 `ToolPermissionProfile`
- 拦住“即使给了文件或网络权限，也不应该执行”的命令

这一层应该维护：

- 默认安全命令集合
- 默认高风险 deny 规则
- profile/rule-based 的 prompt 规则

这一层不应该维护：

- 具体 workspace 路径白名单
- 具体 host allowlist

### 2. 统一权限层

位置：

- `permissions.ts`
- `orchestrator.ts`

职责：

- 校验读写路径是否落在允许 root 内
- 校验网络是否启用、host 是否允许
- 合并基础权限与动态授权

这一层是所有 tool 共用的，不应该让 `local_shell` 再复制一份。

### 3. 动态授权层

位置：

- `request_permissions`
- `ToolSessionState`

职责：

- 在命令策略判断出“需要附加权限”后，按 `turn/session` 申请额外权限
- 把 grant 合并到当前 session state

约束：

- shell 的附加授权默认应优先使用 `turn`
- 不允许模型借请求参数把授权 scope 偷偷抬高

### 4. 审批层

位置：

- `orchestrator.ts`

职责：

- 对 mutating/high-risk 工具执行进行人工或宿主审批
- 缓存 turn/session 级审批结果

审批不是权限替代品。
即使审批通过，文件和网络边界仍然要继续生效。

### 5. 沙箱执行层

位置：

- `shell.ts`
- `shell-sandbox.ts`
- `shell-runtime.ts`

职责：

- 把最终权限映射成运行时可执行的 sandbox policy
- 决定 `restricted / workspace-write / full-access`
- 决定 `sandboxed / escalated`

## 什么必须写在 bash tool 代码里

必须保留在 `shell-policy.ts` 的：

- `sudo / su / doas`
- `rm -rf /`
- `curl|wget | sh`
- `bash <(curl ...)`
- `eval / exec`
- `python -c / node -e`
- `mkfs / fdisk / parted`
- `dd ... of=/dev/...`
- `shutdown / reboot / halt / poweroff`

这些属于“命令级危险语义”，不应该仅靠文件或网络权限去兜。

## 什么不要重复写在 bash tool 里

不要在 `shell-policy.ts` 里硬编码：

- workspace 目录白名单
- 任意读写路径 allowlist
- 网络 host allowlist
- 哪个域名能访问、哪个目录能写

这些应该统一交给：

- `ToolFileSystemPolicy`
- `ToolNetworkPolicy`
- `request_permissions`

否则很容易出现两套规则漂移：

- shell policy 说可以
- permissions 说不可以

或者反过来：

- shell policy 还拦着
- 实际上统一权限已经放开了

## 推荐实现方式

推荐执行顺序：

1. 解析命令
2. shell policy 做 `allow / ask / deny`
3. 如果需要额外权限，走 `request_permissions`
4. 把 grant 合并到 `sessionState`
5. 统一权限层校验文件/网络边界
6. 生成 sandbox policy
7. 进入 runtime 执行
8. 所有错误包装成结构化 `ToolV2Error`

## 设计红线

以下做法应避免：

1. 在 handler 内直接 `throw new Error(...)`
2. shell 再单独维护一套路径白名单
3. 审批通过后跳过文件/网络权限校验
4. 用“safe command 名单”替代真正的权限控制
5. 把所有未知命令直接放行

## 当前推荐默认策略

- 默认 `fileSystemPolicy = restricted`
- 默认 `networkPolicy = restricted`
- 默认 `approvalPolicy = on-request`
- shell policy 对未知命令默认 `ask`
- 对高危命令默认 `deny`
- 对需要临时联网/临时写额外目录的命令优先申请 `turn` 级附加权限

## 结论

`bash/local_shell` 代码里仍然需要“命令级白名单/黑名单/审批规则”，
但不应该再维护一套独立的文件和网络资源白名单。

最稳的企业级实践是：

- 命令风险在 `shell-policy`
- 资源边界在统一 `permissions`
- 运行权限提升走 `request_permissions`
- 最终隔离由 `sandbox/runtime` 执行

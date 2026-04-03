---
name: prana-stock-scoring-analysis
description: A股财务分析助手，通过 Prana 平台提供专业的股票财务分析服务，包括盈利能力、营运能力、偿债能力、成长性等多维度分析。
required_env:
  - PRANA_SKILL_API_FLAG
network_requests:
  - method: GET
    url: https://claw-uat.ebonex.io/api/v2/api-keys
  - method: GET
    url: https://claw-uat.ebonex.io/api/claw/skill-purchase-history-url
  - method: GET
    url: https://claw-uat.ebonex.io/api/claw/skill-purchase-url
  - method: POST
    url: https://claw-uat.ebonex.io/api/claw/agent-run
---

## 触发条件

当用户请求分析 A 股股票的财务状况时触发，例如：
- "帮我分析茅台"
- "分析中国平安的盈利能力"
- "贵州茅台股票怎么样"

---

## 执行流程

本技能采用 **Pipeline** 模式，严格按以下步骤执行。每一步都有明确的输入输出和 Gate 条件。

### Step 0: 查询购买记录（可选）

**输入：** 无
**输出：** 购买记录页面链接

如需查询用户已购买的 skill 记录，调用：

```bash
curl -sS -H "x-api-key: $PRANA_SKILL_API_FLAG" \
  "https://claw-uat.ebonex.io/api/claw/skill-purchase-history-url"
```

响应示例：
```json
{
  "code": 200,
  "data": { "url": "https://claw-uat.ebonex.io/skill-purchase-history?pay_token=xxx" }
}
```

**注意：** 此步骤为可选，仅在需要查询购买记录时执行。

---

### Step 1: 检查并配置环境变量

**输入：** 无
**输出：** 环境变量 `PRANA_SKILL_API_FLAG` 已配置

**Gate：**
- 若环境变量已存在 → 进入 Step 2
- 若环境变量不存在 → 调用 API 获取并配置：

```bash
curl -sS "https://claw-uat.ebonex.io/api/v2/api-keys"
```

响应示例：
```json
{
  "code": 200,
  "data": { "api_key": "pk_xxx:sk_xxx" }
}
```

配置环境变量：
```bash
openclaw config set env.PRANA_SKILL_API_FLAG "pk_xxx:sk_xxx"
```

---

### Step 2: 执行分析任务

**输入：** 用户的需求描述（如"帮我分析茅台股票的盈利能力"）
**输出：** Prana 平台返回的分析结果或错误信息

执行命令：
```bash
NODE_OPTIONS=--experimental-default-type=module node scripts/prana_skill_client.js -q "用户的需求"
```

参数：
- `-q`：用户的需求（必填）
- `-t`：可选，thread_id 用于续聊

---

### Step 3: 判断执行结果

**Gate：** 根据脚本退出码和输出判断下一步

| 退出码 | 输出内容 | 含义 | 处理方式 |
|--------|----------|------|----------|
| 0 | JSON 结果 | 成功 | 进入 Step 4a |
| 0 | Markdown 链接 | 未购买 | 进入 Step 4b |
| 非 0 | 错误信息 | 执行失败 | 进入 Step 4c |

---

### Step 4a: 处理成功结果

**输入：** JSON 格式的分析结果
**输出：** 将分析结果展示给用户

处理步骤：
1. 从输出中解析 `thread_id`（如果有）
2. 保存 `thread_id` 到会话目录：
   ```bash
   echo "thread_id值" > workspace/<session_id>/prana-stock-scoring-analysis.txt
   ```
3. 直接输出分析结果给用户

---

### Step 4b: 处理未购买情况

**Gate：必须立即展示付费链接，禁止重试**

**输入：** 无
**输出：** 将链接直接展示给用户

**处理步骤：**

1. 调用 API 获取动态购买链接：
```bash
curl -sS -H "x-api-key: $PRANA_SKILL_API_FLAG" \
  "https://claw-uat.ebonex.io/api/claw/skill-purchase-url"
```

2. 若 API 返回成功，使用返回的 URL 输出：
```markdown
[点击购买 A股多维度深度分析](返回的购买链接)
```

3. 若 API 调用失败，回退到基础购买页面：
```markdown
[点击购买 A股多维度深度分析](https://claw-uat.ebonex.io/skill-payment)
```

**硬规则：**
- 必须通过 API 动态获取购买链接
- 禁止硬编码任何购买参数
- 禁止尝试其他接口或重试
- 立即终止流程

---

### Step 4c: 处理执行失败

**输入：** 错误信息
**输出：** 将错误信息展示给用户

常见错误：
- 网络超时：提示用户检查网络后重试
- API 错误：提示稍后重试

---

## 硬规则（Gate）

1. **禁止跳过环境变量检查**
2. **禁止在未购买时尝试重试或调用其他接口**
3. **付费链接必须以 Markdown 格式输出**
4. **成功结果必须包含完整的分析内容**
5. **thread_id 必须保存以支持续聊功能**

---

## 辅助功能

### 查询购买记录

当用户需要查询已购买的 skill 记录时，使用：

```bash
curl -sS -H "x-api-key: $PRANA_SKILL_API_FLAG" \
  "https://claw-uat.ebonex.io/api/claw/skill-purchase-history-url"
```

输出购买记录页面链接：
```markdown
[查看购买记录](https://claw-uat.ebonex.io/skill-purchase-history?pay_token=xxx)
```

---

## 目录结构

```
prana-stock-scoring-analysis/
├── SKILL.md                    # 总控文件（Pipeline）
└── scripts/
    └── prana_skill_client.js   # Prana API 客户端
```

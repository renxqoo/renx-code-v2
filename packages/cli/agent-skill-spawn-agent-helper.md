# Agent Skill 设计模式深度解读

> 基于 Google Cloud Tech @GoogleCloudTech 2026年3月18日推文
> 原文：https://x.com/GoogleCloudTech/status/2033953579824758855

---

## 背景与问题

目前超过30个agent工具（如Claude Code、Gemini CLI、Cursor等）已统一采用 **Agent Skills 规范**。格式化问题已解决，真正的挑战变成了 **内容设计**——如何组织skill内部的逻辑结构。

> 同样的 `SKILL.md` 文件外表看起来一样，但包装FastAPI约定的skill与四步文档管道的运作方式完全不同。

---

## 五种设计模式

### Pattern 1: 工具包装器（Tool Wrapper）

**核心思想**：按需加载领域知识，而不是把所有规则硬编码到system prompt中。

**工作原理**：
1. `SKILL.md` 监听特定库的关键词
2. 动态加载 `instructions/` 目录中的文档
3. 将规则作为"绝对真理"应用

**适用场景**：分发团队内部编码规范、特定框架最佳实践、企业级技术标准

**代码示例**：

```markdown
# skills/api-expert/SKILL.md
---
name: api-expert
description: FastAPI开发最佳实践。用于构建、审查或调试FastAPI应用时激活。
metadata:
  pattern: tool-wrapper
  domain: fastapi
---

你是FastAPI开发专家。将以下约定应用到用户的代码中。

## 核心约定

加载 'references/conventions.md' 获取完整的FastAPI最佳实践列表。

## 审查代码时
1. 加载约定参考文档
2. 检查用户代码是否符合每条约定
3. 对每处违规，指出具体规则并建议修复

## 编写代码时
1. 加载约定参考文档
2. 严格遵循每条约定
3. 为所有函数签名添加类型注解
4. 使用Annotated风格实现依赖注入
```

**优势**：按需加载、便于维护、可叠加使用

---

### Pattern 2: 生成器（Generator）

**核心思想**：填空式文档生成，确保每次输出结构一致。

**工作原理**：
1. 从 `assets/` 加载输出模板
2. 从 `references/` 加载风格指南
3. 向用户询问缺失的变量
4. 按模板填充内容

**适用场景**：标准化API文档、commit信息格式、项目脚手架、报告生成

**代码示例**：

```markdown
# skills/report-generator/SKILL.md
---
name: report-generator
description: 生成结构化的Markdown技术报告。
metadata:
  pattern: generator
  output-format: markdown
---

你是技术报告生成器。严格按以下步骤执行：

步骤1：加载 'references/style-guide.md' 获取语气和格式规则。

步骤2：加载 'assets/report-template.md' 获取必需的输出结构。

步骤3：向用户询问填充模板所需的缺失信息：
- 主题
- 关键发现或数据点
- 目标读者（技术/高管/通用）

步骤4：按风格指南规则填充模板。模板中的每个章节都必须出现在输出中。

步骤5：将完成的报告作为单一Markdown文档返回。
```

**优势**：输出稳定、高度可复用、可扩展

---

### Pattern 3: 评审器（Reviewer）

**核心思想**：把"检查什么"和"怎么检查"分开——评分标准与逻辑解耦。

**工作原理**：
1. 在 `references/review-checklist.md` 存储评分标准
2. agent加载检查清单
3. 按严重性分组输出问题

**适用场景**：PR代码评审、安全漏洞扫描、代码质量审计、性能检查

**代码示例**：

```markdown
# skills/code-reviewer/SKILL.md
---
name: code-reviewer
description: 审查Python代码的质量、风格和常见bug。
metadata:
  pattern: reviewer
  severity-levels: error,warning,info
---

你是Python代码评审专家。严格按以下协议执行：

步骤1：加载 'references/review-checklist.md' 获取完整评审标准。

步骤2：仔细阅读用户代码。先理解代码目的，再提出批评。

步骤3：将检查清单中的每条规则应用到代码。对每处违规：
- 记录行号（或大致位置）
- 划分严重级别：error（必须修复）、warning（应该修复）、info（建议考虑）
- 解释**为什么**这是问题，而不只是**什么**错了
- 提供具体修复建议和正确代码

步骤4：生成结构化评审报告，包含：
- **概述**：代码功能、整体质量评估
- **发现**：按严重性分组（error优先，其次warning，最后info）
- **评分**：1-10分并简要说明理由
- **Top 3建议**：最有价值的改进
```

**优势**：切换规则即切换评审维度、结构化输出、可量化追踪

---

### Pattern 4: 反转（Inversion）

**核心思想**：agent先采访用户，再行动——打破agent"猜测-生成"的本能冲动。

**工作原理**：
1. 使用明确的"禁止"指令（如"DO NOT开始构建..."）
2. 按阶段顺序提问，每次只问一个
3. 等待用户回答后再进入下一阶段
4. 收集完整信息前拒绝生成最终输出

**适用场景**：项目规划、需求收集、系统设计

**代码示例**：

```markdown
# skills/project-planner/SKILL.md
---
name: project-planner
description: 通过结构化提问收集需求，然后制定计划。
metadata:
  pattern: inversion
  interaction: multi-turn
---

你正在主持一场结构化需求访谈。
**未经完成所有阶段，不得开始构建或设计。**

## 第一阶段——问题发现（每次只问一个问题，等待回答）

按顺序提问，不要跳过：

- Q1：你的项目为用户解决什么问题？
- Q2：主要用户是谁？他们的技术水平如何？
- Q3：预期规模是多少？（日活用户、数据量、请求频率）

## 第二阶段——技术约束（仅在第一阶段全部回答后）

- Q4：你将使用什么部署环境？
- Q5：有没有技术栈要求或偏好？
- Q6：有哪些硬性需求？（延迟、可用性、合规、预算）

## 第三阶段——综合（仅在所有问题回答后）

1. 加载 'assets/plan-template.md' 获取输出格式
2. 用收集到的需求填充模板的每个部分
3. 向用户展示完成的计划
4. 询问："这个计划是否准确反映了你的需求？有什么需要修改？"
5. 根据反馈迭代，直到用户确认
```

**优势**：减少幻觉、用户主导、可追溯

---

### Pattern 5: 管道（Pipeline）

**核心思想**：强制多步骤顺序执行，每步之间设检查点。

**工作原理**：
1. 每步必须按顺序执行
2. 步骤间设置门控条件
3. 需要用户批准才能进入下一阶段
4. 不同步骤按需加载不同资源

**适用场景**：复杂文档生成、多阶段代码生成、需要人工审批的工作流

**代码示例**：

```markdown
# skills/doc-pipeline/SKILL.md
---
name: doc-pipeline
description: 通过多步骤管道从Python源代码生成API文档。
metadata:
  pattern: pipeline
  steps: "4"
---

你正在执行文档生成管道。按顺序执行每一步。不要跳过任何步骤。
如果某一步失败，不要继续。

## 第一步——解析与盘点

分析用户的Python代码，提取所有公开的类、函数和常量。
以清单形式展示。询问：
"这是你要文档化的完整公开API吗？"

## 第二步——生成文档字符串

对每个缺少文档字符串的函数：
- 加载 'references/docstring-style.md' 获取要求的格式
- 严格按风格指南生成文档字符串
- 展示每个生成的文档字符串供用户审批

**未经用户确认，不得进入第三步。**

## 第三步——组装文档

加载 'assets/api-doc-template.md' 获取输出结构。
将所有类、函数和文档字符串编译成单一API参考文档。

## 第四步——质量检查

对照 'references/quality-checklist.md' 检查：
- 每个公开符号都已文档化
- 每个参数都有类型和描述
- 每个函数至少有使用示例

报告检查结果。修复问题后再呈现最终文档。
```

**流程图示**：

```
┌─────────────────┐
│  第一步         │  解析代码
│  Parse &        │──────────┐
│  Inventory      │          │
└─────────────────┘          ▼ 用户确认
┌─────────────────┐          │
│  第二步         │  生成文档字符串
│  Generate       │──────────┐
│  Docstrings     │          │
└─────────────────┘          ▼ 用户确认
┌─────────────────┐          │
│  第三步         │  组装文档
│  Assemble       │──────────┐
└─────────────────┘          │
                              ▼
┌─────────────────┐          │
│  第四步         │  质量检查 ───▶ 最终输出
│  QA Check       │──────────┘
└─────────────────┘
```

**优势**：强制顺序、人工把关、可审计

---

## 如何选择合适的模式

```
你的skill需要做什么？
│
├─ 传递领域知识 ──────────────▶ 工具包装器
│
├─ 生成结构化文档 ────────────▶ 生成器
│
├─ 评审/检查/打分 ────────────▶ 评审器
│
├─ 收集需求/规划 ────────────▶ 反转
│
└─ 多阶段流水线 ──────────────▶ 管道
```

---

## 模式组合使用

### 管道 + 评审器

```
管道Skill
  └─ 步骤1：解析代码
  └─ 步骤2：生成文档
  └─ 步骤3：评审（用评审器模式检查自己的产出）
  └─ 步骤4：定稿
```

### 生成器 + 反转

```
生成器Skill
  └─ 用反转模式收集必要的变量
  └─ 然后按模板填充内容
```

---

## 总结对比

| 模式 | 核心机制 | 交互方式 | 适用复杂度 |
|------|----------|----------|------------|
| 工具包装器 | 按需加载知识 | 单轮 | 低 |
| 生成器 | 模板填充 | 多轮（收集变量） | 中 |
| 评审器 | 规则匹配 | 单轮 | 低-中 |
| 反转 | 顺序提问 | 多轮（严格顺序） | 中-高 |
| 管道 | 阶段门控 | 多轮（带审批） | 高 |

---

## 核心原则

> **不要把所有复杂脆弱的指令塞进单一system prompt。分解工作流，选择正确的结构模式，构建可靠的agent。**

---

# spawn-agent-helper Skill 设计

## 为什么需要这个 Skill

`spawn_agent` 工具虽然参数清晰，但使用起来仍有挑战：

1. **何时分解**：什么情况下应该用子agent，什么情况下主agent直接做？
2. **选择哪个 role**：7+种 role，如何选择？
3. **如何构造 prompt**：如何写出让子agent准确执行的 prompt？
4. **如何分解任务**：复杂任务如何拆分成子任务？
5. **如何汇总结果**：多个子agent的结果如何处理？

`spawn-agent-helper` Skill 正是为了解决这些问题而设计。

---

## 目录结构

```
skills/
└── spawn-agent-helper/
    ├── SKILL.md                           # 主文件
    ├── references/
    │   ├── role-guide.md                  # Role 完整指南
    │   ├── prompt-patterns.md             # Prompt 模板库
    │   └── task-decomposition.md          # 任务分解方法论
    └── assets/
        └── execution-template.md           # 执行计划模板
```

---

## 完整文件列表

| 文件路径 | 说明 |
|----------|------|
| `skills/spawn-agent-helper/SKILL.md` | 主 Skill 文件，包含6步执行流程 |
| `skills/spawn-agent-helper/references/role-guide.md` | 7种 role 的详细指南 |
| `skills/spawn-agent-helper/references/prompt-patterns.md` | 5类 Prompt 模板 |
| `skills/spawn-agent-helper/references/task-decomposition.md` | 任务分解方法论 |
| `skills/spawn-agent-helper/assets/execution-template.md` | 执行计划模板 |

---

## SKILL.md 核心内容

### 6步执行流程

```
步骤1：任务分析
  └─ 加载 task-decomposition.md
  └─ 判断是否需要子agent
  └─ 确定分解粒度

步骤2：选择 Role
  └─ 加载 role-guide.md
  └─ 根据任务特征选择

步骤3：构造 Prompt
  └─ 加载 prompt-patterns.md
  └─ 使用模板构造

步骤4：确定执行策略
  └─ 并行 vs 顺序
  └─ maxSteps 设置
  └─ runInBackground 设置

步骤5：执行 spawn_agent
  └─ 构造调用参数
  └─ 执行

步骤6：结果处理
  └─ 汇总、去重、冲突处理
```

---

## role-guide.md 核心内容

### Role 概览

| Role | 职责 | 工具 | 适用 |
|------|------|------|------|
| `Bash` | Shell执行 | local_shell | 纯命令操作 |
| `general-purpose` | 通用开发 | 全部核心工具 | 代码实现 |
| `Explore` | 代码探索 | 搜索+读取 | 信息收集 |
| `Restore` | 历史恢复 | 历史工具 | 回滚操作 |
| `Plan`/`planner` | 规划分析 | 搜索+读取 | 方案设计 |
| `research`/`research-agent` | 研究调研 | +web_fetch | 技术研究 |
| `find-skills` | 技能发现 | 技能工具 | 找skill |

### 选择决策树

```
任务开始
    │
    ▼
需要执行shell命令？ ──是──▶ Bash
    │否
    ▼
需要恢复历史？ ────是──▶ Restore
    │否
    ▼
需要网络搜索/研究？ ─是──▶ research-agent
    │否
    ▼
需要发现skill？ ────是──▶ find-skills
    │否
    ▼
需要规划/分析风险？ ─是──▶ Plan
    │否
    ▼
主要是探索发现信息？ ─是──▶ Explore
    │否
    ▼
general-purpose (默认选择)
```

---

## prompt-patterns.md 核心内容

### 5类 Prompt 模板

| 模板 | 适用场景 | 关键特点 |
|------|----------|----------|
| 分析型 | 代码分析、风险评估 | SCQA框架、证据支持 |
| 实现型 | 功能实现、重构 | 分步骤、代码规范 |
| 探索型 | 代码库分析、依赖查找 | 方法论、关系图 |
| 审查型 | 代码审查、安全审计 | 严重程度分组 |
| 规划型 | 项目规划、方案设计 | 多维度分析 |

### Prompt 构造原则

```
SCQA 框架：
- Situation（情境）
- Complication（复杂性）
- Question（问题）
- Answer（答案）

清晰边界四象限：
┌─────────────────────────────────┐
│          具体任务描述            │
├─────────────────────────────────┤
│  约束条件     │    输出格式     │
│  （不要做）   │   （返回什么）  │
├─────────────────────────────────┤
│        验收标准（成功标志）       │
└─────────────────────────────────┘
```

---

## task-decomposition.md 核心内容

### 4种分解模式

| 模式 | 适用场景 | 示例 |
|------|----------|------|
| 功能分解 | 新功能开发 | 按模块拆分 |
| 阶段分解 | 流水线任务 | 准备→构建→部署 |
| 维度分解 | 审查分析 | 安全+性能+可维护性 |
| 探索-验证分解 | 问题诊断 | 广泛探索→深入验证 |

### 4种执行策略

| 策略 | 适用场景 | 示例 |
|------|----------|------|
| 完全并行 | 独立任务 | 同时分析3个模块 |
| 顺序执行 | 强依赖 | 分析→实现 |
| 流水线 | 阶段式处理 | 解析→实现→测试 |
| 分支-汇聚 | 多维度综合 | 分析前端+后端→汇总 |

---

## execution-template.md 核心内容

### 计划模板结构

```yaml
1. 概述
   - 背景
   - 目标
   - 范围
   - 成功标准

2. 现状分析
   - 现有架构
   - 资源清单
   - 约束条件

3. 详细设计
   - 架构设计
   - 模块设计
   - 数据模型
   - 错误处理

4. 实施计划
   - 阶段划分
   - 任务列表
   - 验收标准

5. 风险分析
   - 技术风险
   - 项目风险
   - 风险矩阵

6. 资源需求
   - 人力
   - 技术
   - 时间线

7. 测试计划
   - 策略
   - 用例
   - 验收标准

8. 部署计划
   - 环境
   - 步骤
   - 回滚方案

9. 监控运维
   - 指标
   - 日志

10. 附录
    - 术语表
    - 参考文档
    - 变更历史
```

---

## 使用示例

### 示例 1：代码审查流水线

```typescript
// 1. 分析阶段 - 并行探索
const [security, performance, quality] = await Promise.all([
  spawn_agent({
    role: "Explore",
    prompt: `审查 ${targetFile} 的安全问题...
    参考 skills/spawn-agent-helper/references/prompt-patterns.md 中的审查模板`,
    description: "安全审查"
  }),
  spawn_agent({
    role: "Explore",
    prompt: `分析 ${targetFile} 的性能问题...`,
    description: "性能分析"
  }),
  spawn_agent({
    role: "Explore",
    prompt: `检查 ${targetFile} 的代码质量...`,
    description: "质量检查"
  })
]);

// 2. 汇总阶段
const report = await spawn_agent({
  role: "general-purpose",
  prompt: `汇总以下审查结果，生成统一报告：
  安全：${security.output}
  性能：${performance.output}
  质量：${quality.output}`,
  description: "汇总报告"
});
```

### 示例 2：技术研究 + 实施

```typescript
// 1. 研究阶段
const research = await spawn_agent({
  role: "research-agent",
  prompt: `评估在项目中使用WebAssembly的可行性...
    参考 skills/spawn-agent-helper/references/prompt-patterns.md 中的分析模板`,
  description: "WASM可行性研究"
});

// 2. 规划阶段
const plan = await spawn_agent({
  role: "planner",
  prompt: `基于以下研究结果制定实施计划：
    ${research.output}
    
    参考 skills/spawn-agent-helper/assets/execution-template.md`,
  description: "实施规划"
});

// 3. 实施阶段
const implementation = await spawn_agent({
  role: "general-purpose",
  prompt: `按照以下计划实施：
    ${plan.output}`,
  description: "功能实现"
});
```

---

## 与项目 Role 的对应关系

| Skill 中的 Role | 对应项目中的 Role |
|-----------------|-------------------|
| Bash | `Bash` |
| general-purpose | `general-purpose` |
| Explore | `Explore` |
| Restore | `Restore` |
| Plan / planner | `Plan` / `planner` |
| research / research-agent | `research` / `research-agent` |
| find-skills | `find-skills` |

---

## 总结

`spawn-agent-helper` Skill 提供：

1. **系统化的决策流程**：6步法确保正确使用 spawn_agent
2. **完整的参考资料**：Role指南、Prompt模板、分解方法论
3. **可复用的模板**：执行计划模板、分析报告模板
4. **最佳实践总结**：常见错误、决策表、组合示例

通过使用这个 Skill，主agent可以：
- 准确判断何时需要子agent
- 选择合适的 role 和配置
- 构造高质量的 prompt
- 有效地分解和协调任务
- 正确地汇总和处理结果

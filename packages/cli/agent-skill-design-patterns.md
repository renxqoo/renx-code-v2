# Agent Skill 设计模式完全指南

> **作者**: @Saboo_Shubham_ 和 @lavinigam  
> **来源**: [Google Cloud Tech](https://x.com/GoogleCloudTech/status/2033953579824758855)  
> **日期**: 2026年3月18日  
> **翻译整理**: AI Assistant

---

## 目录

1. [背景与问题](#背景与问题)
2. [模式一：工具包装器（Tool Wrapper）](#模式一工具包装器tool-wrapper)
3. [模式二：生成器（Generator）](#模式二生成器generator)
4. [模式三：评审器（Reviewer）](#模式三评审器reviewer)
5. [模式四：反转（Inversion）](#模式四反转inversion)
6. [模式五：管道（Pipeline）](#模式五管道pipeline)
7. [模式选择决策树](#模式选择决策树)
8. [模式组合使用](#模式组合使用)
9. [最佳实践与总结](#最佳实践与总结)

---

## 背景与问题

### Agent Skills 规范的崛起

目前已有超过 **30个主流agent工具** 采用统一的 Agent Skills 规范，包括：

- Claude Code (Anthropic)
- Gemini CLI (Google)
- Cursor
- Continue
- LlamaCode
- Roo Code
- Zed
- 其他众多工具

这意味着 **格式化问题已基本解决**。无论使用哪个工具，`SKILL.md` 的结构都是一致的：

```yaml
---
name: skill-name
description: 技能描述
metadata:
  pattern: pattern-type
  # 其他元数据
---

# 核心指令
```

### 真正的挑战：内容设计

当所有工具的格式统一后，竞争的核心变成了 **内容设计**：

> 同一个 `SKILL.md` 文件外表看起来完全一样，但包装 FastAPI 约定的 skill 与执行四步文档管道的 skill，内部的运作逻辑和代码结构完全不同。

本文档深入解析 Google ADK 官方推荐的 **5个核心设计模式**，帮助你构建真正可靠的 agent 技能。

---

## 模式一：工具包装器（Tool Wrapper）

### 概念定义

**工具包装器** 让 agent 成为任意库或框架的即时专家。它通过**按需加载**的方式，将特定技术的约定和最佳实践封装成可复用的技能。

### 核心思想

```
传统方式:                    工具包装器方式:
┌─────────────────────┐     ┌─────────────────────┐
│ System Prompt       │     │ System Prompt       │
│ ┌─────────────────┐ │     │ 轻量级指令           │
│ │ 所有技术的约定    │ │     └─────────┬─────────┘
│ │ (大量token消耗) │ │               │
│ └─────────────────┘ │               ▼
└─────────────────────┘     ┌─────────────────────┐
                            │ 按需激活 Skill       │
                            │ (只在需要时加载)     │
                            └─────────────────────┘
```

### 何时使用

- ✅ 需要让 agent 掌握特定框架/库的约定
- ✅ 分发团队内部的编码规范
- ✅ 企业级技术标准文档
- ✅ 多个 agent 需要共享同一套最佳实践

### 何时避免

- ❌ 需要 agent 进行复杂的多步骤推理
- ❌ 需要多轮交互收集用户输入
- ❌ 任务本身需要严格的执行顺序

### 工作原理

1. **关键词监听**：`SKILL.md` 中的 description 字段定义触发条件
2. **动态加载**：agent 根据需要加载 `instructions/` 或 `references/` 目录中的文档
3. **规则应用**：将加载的规则作为"绝对真理"应用到实际操作中

### 完整代码示例

#### 目录结构

```
skills/
└── api-expert/
    ├── SKILL.md
    └── references/
        └── conventions.md
```

#### SKILL.md

```markdown
# skills/api-expert/SKILL.md
---
name: api-expert
description: >
  FastAPI 开发最佳实践与约定。
  在构建、评审或调试 FastAPI 应用、
  REST API 或 Pydantic 模型时使用。
metadata:
  pattern: tool-wrapper
  domain: fastapi
  version: 1.0.0
---

你是一位 FastAPI 开发专家。在工作的各个方面应用这些约定。

## 你的职责

你必须为所有 FastAPI 相关任务加载并遵循约定文档。

## 核心约定

加载 'references/conventions.md' 获取完整的 FastAPI 最佳实践列表。

## 代码评审时

1. 加载约定参考文档
2. 仔细阅读用户的代码
3. 对照参考文档中的每条约定检查代码
4. 对于发现的每项违规：
   - 引用具体的规则编号和内容
   - 解释为什么它违反了约定
   - 提供正确的实现方式
5. 按严重性分组报告发现

## 编写代码时

1. 加载约定参考文档
2. 严格遵循每条约定
3. 为所有函数签名添加类型注解
4. 使用 Annotated 风格进行依赖注入
5. 始终为端点定义 Response 模型
6. 使用适当的 HTTP 状态码

## 调试时

1. 加载约定参考文档
2. 识别违反的是哪条约定
3. 解释正确的模式
4. 提供修正后的代码示例
```

#### conventions.md

```markdown
# skills/api-expert/references/conventions.md
# FastAPI 最佳实践与约定

## 1. 项目结构

```
project/
├── app/
│   ├── __init__.py
│   ├── main.py           # FastAPI 应用实例
│   ├── config.py         # 使用 pydantic 的配置
│   ├── models/          # Pydantic 模型
│   ├── routers/         # APIRouter 模块
│   ├── services/        # 业务逻辑
│   └── dependencies.py  # 共享依赖
├── tests/
└── requirements.txt
```

## 2. 路由约定

### 2.1 使用 APIRouter 实现模块化路由

```python
# routers/users.py
from fastapi import APIRouter

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/{user_id}")
async def get_user(user_id: int):
    return {"user_id": user_id}
```

### 2.2 路由前缀约定

- 始终在前缀中包含版本：`/api/v1/...`
- 使用复数名词：`/users` 而不是 `/user`
- 逻辑地嵌套路由：`/api/v1/users/{user_id}/orders`

### 2.3 HTTP 方法选择

| 操作 | 方法 | 示例 |
|--------|--------|---------|
| 创建 | POST | `POST /users` |
| 读取 | GET | `GET /users/{id}` |
| 更新（完整） | PUT | `PUT /users/{id}` |
| 更新（部分） | PATCH | `PATCH /users/{id}` |
| 删除 | DELETE | `DELETE /users/{id}` |

## 3. Pydantic 模型

### 3.1 模型命名

- 请求模型：`{Resource}Create`、`{Resource}Update`
- 响应模型：`{Resource}Response`
- 对嵌套对象使用 dataclasses

```python
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class UserCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., regex=r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
    age: Optional[int] = Field(None, ge=0, le=150)

class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    created_at: datetime
    
    class Config:
        from_attributes = True
```

### 3.2 字段验证

- 始终使用 Field() 进行验证规则
- 为 API 文档包含描述
- 对受限字符串值使用枚举

## 4. 依赖注入

### 4.1 使用 Annotated 风格

```python
from fastapi import Depends
from typing import Annotated

async def get_db():
    db = DatabaseSession()
    try:
        yield db
    finally:
        db.close()

# 推荐：Annotated 风格
@app.get("/users")
async def list_users(db: Annotated[Session, Depends(get_db)]):
    return db.query(User).all()

# 避免：旧式风格
@app.get("/users")
async def list_users(session: Session = Depends(get_db)):
    return session.query(User).all()
```

### 4.2 依赖层次

```
┌─────────────────┐
│   应用层级       │  (限流、CORS)
└────────┬────────┘
         │
┌────────▼────────┐
│  路由层级        │  (认证、公共参数)
└────────┬────────┘
         │
┌────────▼────────┐
│   端点层级       │  (特定依赖)
└─────────────────┘
```

## 5. 错误处理

### 5.1 适当使用 HTTPException

```python
from fastapi import HTTPException, status

@app.get("/users/{user_id}")
async def get_user(user_id: int, db: Session):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with id {user_id} not found"
        )
    return user
```

### 5.2 Error Response Format

Always include actionable error messages:

```json
{
  "detail": "User with id 123 not found"
}
```

### 5.3 Status Code Selection

| Scenario | Status Code |
|----------|------------|
| Successful creation | 201 Created |
| Successful deletion | 204 No Content |
| Successful read | 200 OK |
| Validation error | 422 Unprocessable Entity |
| Not found | 404 Not Found |
| Unauthorized | 401 Unauthorized |
| Forbidden | 403 Forbidden |
| Server error | 500 Internal Server Error |

## 6. Async Conventions

### 6.1 When to Use Async

```python
# 良好：I/O 密集型操作
async def get_user_from_api(user_id: int):
    response = await httpx.get(f"https://api.example.com/users/{user_id}")
    return response.json()

# 避免：在 async 中使用 CPU 密集型操作
# 请使用普通 def 并用 run_in_executor 代替
```

### 6.2 Mixing Async and Sync

```python
from fastapi import FastAPI
import asyncio

app = FastAPI()

# 同步端点在异步应用中 - FastAPI 会处理它
@app.get("/sync")
def sync_endpoint():
    return {"message": "sync"}

# 异步端点
@app.get("/async")
async def async_endpoint():
    await asyncio.sleep(0.1)
    return {"message": "async"}
```

## 7. Documentation

### 7.1 Docstrings

```python
@app.post("/users", response_model=UserResponse, status_code=201)
async def create_user(
    user: UserCreate,
    db: Annotated[Session, Depends(get_db)]
) -> UserResponse:
    """
    Create a new user.
    
    Args:
        user: The user data for creation.
        db: Database session.
    
    Returns:
        The created user with generated ID and timestamps.
    
    Raises:
        HTTPException: If email already exists (409 Conflict).
    """
    existing = db.query(User).filter(User.email == user.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    
    db_user = User(**user.model_dump())
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user
```

### 7.2 OpenAPI Tags

```python
from fastapi import FastAPI

app = FastAPI(
    title="User Management API",
    description="API for managing users and their profiles",
    version="1.0.0"
)

# Group endpoints in docs
@app.get("/users", tags=["users"])
async def list_users():
    pass

@app.post("/users", tags=["users"])
async def create_user():
    pass
```

## 8. Testing Conventions

### 8.1 Test Structure

```python
import pytest
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client():
    return TestClient(app)

def test_create_user(client):
    response = client.post("/api/v1/users", json={
        "name": "John Doe",
        "email": "john@example.com"
    })
    assert response.status_code == 201
    assert "id" in response.json()
```

## 9. Performance

### 9.1 Response Model Limiting

Always use response_model to limit returned fields:

```python
# 良好：只返回指定的字段
@app.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: int):
    pass

# 避免：返回包含内部字段的完整模型
@app.get("/users/{user_id}")
async def get_user(user_id: int):
    pass  # 返回整个 ORM 对象
```

### 9.2 Pagination

```python
from fastapi import Query

@app.get("/users")
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000)
):
    return {
        "items": db.query(User).offset(skip).limit(limit).all(),
        "total": db.query(User).count()
    }
```

---

### 优势与价值

| 优势 | 说明 |
|------|------|
| **按需加载** | agent只在实际使用该技术时加载上下文，节省token |
| **易于维护** | 更新约定文档即可更新所有agent行为 |
| **可叠加** | 可同时激活多个tool-wrapper skill |
| **版本控制** | 可为不同版本维护不同约定文档 |
| **职责分离** | 约定与逻辑分离，便于团队协作 |

---

## 模式二：生成器（Generator）

### 概念定义

**生成器** 通过填空式的方式，从可复用模板生成结构化文档。它解决了 agent 每次生成内容结构不一致的问题。

### 核心思想

```
用户请求
    │
    ▼
┌─────────────────────────────────────┐
│  加载模板 (assets/)                   │
│  加载风格指南 (references/)           │
│  向用户收集缺失信息                    │
│  按模板填充内容                        │
│  输出结构一致的文档                    │
└─────────────────────────────────────┘
    │
    ▼
结构一致的输出
```

### 何时使用

- ✅ 需要生成格式统一的文档（API文档、报告、邮件）
- ✅ 需要标准化输出结构（commit信息、PR描述）
- ✅ 需要脚手架生成（项目模板、配置文件）
- ✅ 需要基于模板的批量内容生成

### 何时避免

- ❌ 用户需求非常开放，没有固定结构
- ❌ 需要 agent 进行复杂推理和创造性写作
- ❌ 输入信息已经完整，不需要额外收集

### 工作原理

1. **模板定义**：在 `assets/` 目录存放输出模板
2. **风格指南**：在 `references/` 目录存放格式规则
3. **变量收集**：向用户询问填充模板所需的变量
4. **内容填充**：严格按模板结构填充内容
5. **风格应用**：应用风格指南中的格式规则

### 完整代码示例

#### 示例场景：技术报告生成器

##### 目录结构

```
skills/
└── report-generator/
    ├── SKILL.md
    ├── assets/
    │   ├── report-template.md
    │   └── presentation-template.md
    └── references/
        ├── style-guide.md
        └── section-guidance.md
```

##### SKILL.md

```markdown
# skills/report-generator/SKILL.md
---
name: report-generator
description: >
  以 Markdown 格式生成结构化技术报告。
  当用户要求写、创建、起草或生成报告、摘要、分析文档或技术简报时使用。
metadata:
  pattern: generator
  output-format: markdown
  complexity: medium
---

你是一位技术报告生成器。你的目标是生成一致的、遵循可预测格式的结构化报告。

## 工作方式

你遵循严格的填空式流程：

1. 加载输出结构的模板
2. 加载格式化规则的风格指南
3. 识别缺失的变量
4. 向用户询问所需信息
5. 根据风格规则填写模板
6. 返回完成的文档

## 步骤 1：加载模板

首先，根据用户的请求确定使用哪个模板：
- 技术报告 → 加载 'assets/report-template.md'
- 演示大纲 → 加载 'assets/presentation-template.md'

## 步骤 2：加载风格指南

加载 'references/style-guide.md' 并应用所有格式化规则。

关键规则：
- 使用主动语态
- 保持句子在 25 个词以内
- 使用编号列表表示序列
- 使用项目符号表示并行项
- 包含带有语法高亮的代码示例

## 步骤 3：识别缺失变量

查看模板并识别哪些变量：
- ✅ 由用户请求提供
- ❓ 缺失且必需
- 🔄 可以增强但非必需

## 步骤 4：收集信息

询问缺失的必需信息。一次只问一个主题。

所有报告都需要：
- 主要主题或议题
- 目标读者（技术/管理/一般）
- 关键发现或数据点

只询问真正需要的内容。如果可以不写某个内容，就不写。

## 步骤 5：生成内容

按部分填写模板：
1. 写部分标题
2. 填写该部分的内容
3. 应用风格指南规则
4. 移动到下一部分

## 步骤 6：展示输出

将完成的报告作为单个 Markdown 文档返回。
在顶部包含简要摘要，说明报告涵盖的内容。

## 质量检查清单

展示前：
- [ ] 所有必需部分都存在
- [ ] 没有占位符文本残留
- [ ] 遵循风格指南规则
- [ ] 内容回答了用户的原始请求
- [ ] 代码示例语法正确
```

##### report-template.md

```markdown
# 技术报告：{{title}}

**生成日期**: {{date}}  
**目标读者**: {{audience}}  
**作者**: {{author}}

---

## 执行摘要

{{executive_summary}}

---

## 1. 背景

{{background}}

### 1.1 问题陈述

{{problem_statement}}

### 1.2 项目范围

{{scope}}

---

## 2. 方法论

{{methodology}}

### 2.1 研究方法

{{research_methods}}

### 2.2 数据来源

{{data_sources}}

### 2.3 假设与限制

{{assumptions_and_limitations}}

---

## 3. 发现与分析

{{findings_and_analysis}}

### 3.1 主要发现

{{main_findings}}

### 3.2 数据支持

{{data_support}}

### 3.3 趋势分析

{{trend_analysis}}

---

## 4. 建议

{{recommendations}}

### 4.1 短期建议（0-3个月）

{{short_term_recommendations}}

### 4.2 中期建议（3-12个月）

{{medium_term_recommendations}}

### 4.3 长期建议（12+个月）

{{long_term_recommendations}}

---

## 5. 实施计划

{{implementation_plan}}

### 5.1 优先级矩阵

| 优先级 | 建议 | 影响 | 难度 | 时间范围 |
|--------|------|------|------|----------|
| {{priority}} | {{recommendation}} | {{impact}} | {{difficulty}} | {{timeframe}} |

### 5.2 资源需求

{{resource_requirements}}

---

## 6. 结论

{{conclusion}}

---

## 附录

### A. 术语表

{{glossary}}

### B. 参考资料

{{references}}

### C. 原始数据

{{raw_data}}

---

*报告生成时间: {{generation_time}}*
```

##### style-guide.md

```markdown
# skills/report-generator/references/style-guide.md
# Technical Report Style Guide

## 1. Writing Style

### 1.1 语气和语调
- 优先使用**主动语态**而非被动语态
- 直接且具体
- 除非先定义，否则避免使用术语
- 为目标读者而写

### 1.2 句子结构
- 保持句子在 25 个词以内
- 使用短段落（最多 3-5 句）
- 每个段落一个观点

### 1.3 格式化规则

```
标题：
- H1：报告标题（居中，无其他 H1）
- H2：主要章节（编号：1.、2.、3.）
- H3：子章节（1.1、1.2、1.3）
- H4：次要标题（粗体，无编号）

项目符号：
- 使用项目符号表示并行项
- 使用数字表示序列/步骤
- 子项目符号缩进 2 个空格

代码：
- 使用带语言的三个反引号
- 为复杂部分包含注释
```

## 2. 章节指南

### 2.1 执行摘要
- 100-200 词
- 说明问题、方法和关键发现
- 以主要建议结尾
- 应能在 60 秒内读完

### 2.2 背景
- 提供必要的上下文
- 定义技术术语
- 解释为什么委托此报告
- 200-400 词

### 2.3 方法论
- 对方法保持透明
- 包含局限性
- 说明方法选择的理由
- 150-300 词

### 2.4 发现
- 客观呈现数据
- 为复杂数据使用可视化
- 文中引用来源
- 400-800 词

### 2.5 建议
- 为建议编号
- 包含理由
- 估计影响和工作量
- 清晰排序

## 3. 数据呈现

### 3.1 表格
- 始终包含表头
- 文本左对齐，数字右对齐
- 使用斑马条纹提高可读性

### 3.2 图表
- 包含图表编号和标题
- 添加来源说明
- 在文中解释其意义

### 3.3 代码示例
```python
# 良好：包含注释和上下文
def calculate_metric(data: list[float]) -> float:
    """计算平均值，忽略超过 2σ 的异常值。"""
    if not data:
        return 0.0
    mean = sum(data) / len(data)
    std = statistics.stdev(data)
    filtered = [x for x in data if abs(x - mean) <= 2 * std]
    return sum(filtered) / len(filtered) if filtered else mean
```

## 4. 常见陷阱

| ❌ 避免 | ✅ 改为 |
|----------|------------|
| "数据显示..." | "用户点击 X 的次数增加了 40%" |
| "据认为..." | "研究表明..." |
| "为了..." | "...是为了..." |
| "由于...的事实..." | "因为..." |
| 被动语态 | 主动语态 |

## 5. 定稿前检查清单

- [ ] Executive summary is under 200 words
- [ ] All sections have content
- [ ] No placeholder text like {{variable}}
- [ ] Tables have proper headers
- [ ] Code examples are syntactically correct
- [ ] Links are valid (if included)
- [ ] Tone matches target audience
- [ ] Active voice throughout
```

---

### 优势与价值

| 优势 | 说明 |
|------|------|
| **输出一致性** | 每次生成文档的结构完全相同 |
| **可复用模板** | 模板可跨项目、跨团队使用 |
| **可扩展** | 添加新模板不影响核心逻辑 |
| **用户可控** | 通过变量收集确保满足用户需求 |
| **风格统一** | 通过风格指南保持格式一致 |

---

## 模式三：评审器（Reviewer）

### 概念定义

**评审器** 模式将"检查什么"与"如何检查"分离。它使用外部化的评分标准，对提交内容进行结构化的质量评估。

### 核心思想

```
用户提交代码
      │
      ▼
┌─────────────────────────────────────┐
│  加载检查清单                         │
│  (references/review-checklist.md)    │
│                                      │
│  应用每条规则                         │
│  按严重性分组发现                      │
│                                      │
│  生成结构化评审报告                    │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  概述 (Summary)                      │
│  发现 (Findings) - 按严重性分组        │
│  评分 (Score) - 1-10分               │
│  Top 3 建议 (Recommendations)        │
└─────────────────────────────────────┘
```

### 何时使用

- ✅ PR代码评审
- ✅ 安全漏洞扫描
- ✅ 代码质量审计
- ✅ 性能检查
- ✅ 文档审查
- ✅ 合规检查

### 何时避免

- ❌ 需要 agent 生成代码或内容
- ❌ 需要 agent 进行创造性问题解决
- ❌ 需要多轮交互收集信息

### 工作原理

1. **外部化规则**：评分标准存储在 `references/checklist.md`
2. **规则匹配**：agent 将每条规则应用到提交内容
3. **分组输出**：按严重性组织发现
4. **量化评分**：提供可追踪的质量分数

### 完整代码示例

#### 示例场景：Python代码评审器

##### 目录结构

```
skills/
└── code-reviewer/
    ├── SKILL.md
    └── references/
        ├── review-checklist.md
        └── severity-guide.md
```

##### SKILL.md

```markdown
# skills/code-reviewer/SKILL.md
---
name: code-reviewer
description: >
  Reviews Python code for quality, style, security, and common bugs.
  Use when the user submits code for review, asks for feedback,
  or wants a code audit.
metadata:
  pattern: reviewer
  severity-levels: error,warning,info
  language: python
---

你是一位 Python 代码评审专家。你提供结构化、可操作的反馈，帮助开发者改进他们的代码。

## Review Protocol

对每次评审遵循此确切协议：

### 步骤 1：准备

加载评审检查清单：
```
Load 'references/review-checklist.md' for the complete review criteria.
```

仔细阅读用户的代码。在评审之前，理解：
- 代码想要实现什么？
- 上下文是什么（独立函数、模块、项目）？
- 适用于什么语言/框架约定？

### 步骤 2：系统性评审

系统性地应用检查清单中的每条规则：

1. 对于每个检查清单项：
- 检查它是否适用于此代码
- 如果违反，记录发现

2. 对于发现的每个违规，记录：
- **位置**：行号或大致位置
- **规则**：违反的是哪条规则
- **严重性**：error / warning / info
- **解释**：为什么这是问题
- **建议**：如何修复（附代码）

### 步骤 3：严重性分类

**错误（必须修复）**：
- 安全漏洞
- 数据损坏风险
- 功能损坏
- 严重 bug

**警告（应该修复）**：
- 性能问题
- 可维护性问题
- 样式违规
- 缺少最佳实践

**信息（考虑）**：
- 改进建议
- 替代方案
- 代码组织技巧

### 步骤 4：生成结构化报告

按此确切格式生成评审：

## 📊 概要

[简要描述代码的功能]
[2-3句话的整体质量评估]

**总分**：X/10

## 🚨 发现

### 严重问题（必须修复）

[所有严重性为 error 的发现]

### 警告（应该修复）

[所有严重性为 warning 的发现]

### 建议（考虑）

[所有严重性为 info 的发现]

## 🎯 前 3 条建议

[三条最有影响力的改进及具体行动]

## ✨ 积极观察

[代码做得好的方面]

---

## 评审员行为准则

- 评审代码，而不是评审人
- 具有建设性和具体性
- 解释"为什么"而不仅仅是"是什么"
- 建议可操作的修复方案
- 认可好的实践
- 及时且彻底
```

##### review-checklist.md

```markdown
# skills/code-reviewer/references/review-checklist.md
# Python 代码评审检查清单

## 🔴 Error (Must Fix)

这些问题必须在合并前解决：

### 安全
- [ ] **SQL 注入**：使用字符串插值的原始 SQL
  ```python
  # 错误
  query = f"SELECT * FROM users WHERE id = {user_id}"
  
  # 正确
  query = "SELECT * FROM users WHERE id = %s"
  cursor.execute(query, (user_id,))
  ```

- [ ] **命令注入**：使用 os.system() 或 shell=True 的 subprocess
  ```python
  # 错误
  os.system(f"rm -rf {user_input}")
  
  # 正确
  subprocess.run(["rm", "-rf", user_input], shell=False)
  ```

- [ ] **硬编码密钥**：代码中的 API 密钥、密码、令牌
  ```python
  # 错误
  API_KEY = "sk-abc123..."
  
  # 正确
  API_KEY = os.environ.get("API_KEY")
  ```

- [ ] **路径遍历**：未验证的文件路径
  ```python
  # BAD
  with open(user_filename) as f:
  
  # 正确
  base_dir = "/safe/path"
  safe_path = os.path.realpath(os.path.join(base_dir, user_filename))
  if not safe_path.startswith(base_dir):
      raise ValueError("Invalid path")
  ```

### 正确性
- [ ] **未处理的异常**：裸 except、捕获 Exception、捕获 Throwable
  ```python
  # 错误
  try:
      do_something()
  except:
      pass
  
  # 正确
  try:
      do_something()
  except ValueError as e:
      handle_validation_error(e)
  except DatabaseError as e:
      handle_db_error(e)
  ```

- [ ] **竞态条件**：非线程安全的共享状态
- [ ] **资源泄漏**：未关闭的文件、连接、句柄
- [ ] **除零**：未验证的数值操作

### 数据完整性
- [ ] **缺少输入验证**：外部数据未验证
  ```python
  # 错误
  def create_user(name, age):
      return User(name=name, age=age)
  
  # 正确
  def create_user(name: str, age: int) -> User:
      if not name or len(name) > 100:
          raise ValueError("Invalid name")
      if age < 0 or age > 150:
          raise ValueError("Invalid age")
      return User(name=name, age=age)
  ```

- [ ] **类型混淆**：假设错误的数据类型
- [ ] **空指针**：不检查就访问 None 的属性

---

## 🟡 警告（应该修复）

这些问题应该为代码质量而解决：

### 样式与可读性
- [ ] **缺少类型注解**：函数签名没有类型
  ```python
  # 错误
  def process_data(data, options):
  
  # 正确
  def process_data(data: dict[str, Any], options: Options) -> Result:
  ```

- [ ] **过长函数**：超过 50 行的函数
- [ ] **过长行**：超过 120 个字符的行
- [ ] **缺少文档字符串**：公共函数没有文档
  ```python
  # 错误
  def calculate(x, y):
      return x + y
  
  # 正确
  def calculate(x: int, y: int) -> int:
      """将两个数字相加并返回结果。
      
      参数:
          x: 第一个数字
          y: 第二个数字
      
      返回:
          x 和 y 的和
      """
      return x + y
  ```

- [ ] **命名不当**：单字母、模糊名称
  ```python
  # 错误
  d = datetime.now()
  def p(a, b):
      return a + b
  
  # 正确
  current_time = datetime.now()
  def calculate_total(price: float, quantity: int) -> float:
      return price * quantity
  ```

### 最佳实践
- [ ] **魔法数字**：未命名的数字常量
  ```python
  # 错误
  if user.age > 18:
  
  # 正确
  LEGAL_DRINKING_AGE = 18
  if user.age > LEGAL_DRINKING_AGE:
  ```

- [ ] **重复代码**：重复的逻辑块
- [ ] **死代码**：未使用的导入、变量、函数
- [ ] **全局状态**：可变的全局变量

### 性能
- [ ] **低效循环**：可以使用列表推导式的场景
  ```python
  # 错误
  result = []
  for item in items:
      result.append(item.name)
  
  # 正确
  result = [item.name for item in items]
  ```

- [ ] **不必要的列表转换**：可以用生成器的地方创建了列表
- [ ] **N+1 查询**：循环中的数据库查询

---

## 🔵 信息（考虑）

需要考虑的改进建议：

### Python 风格代码
- [ ] **使用 dataclasses** 处理简单数据结构
  ```python
  # 建议
  from dataclasses import dataclass
  
  @dataclass
  class Point:
      x: float
      y: float
  ```

- [ ] **使用 enum** 处理约束值
- [ ] **使用 f-strings** 代替 .format()
- [ ] **使用上下文管理器** 管理资源

### 现代 Python
- [ ] **考虑使用** `match`/`case` 处理复杂条件（3.10+）
- [ ] **考虑使用** `typing.Protocol` 实现 duck typing
- [ ] **考虑使用** `dataclasses.field` 和 defaults_factory

### 文档
- [ ] **添加使用示例** 到文档字符串
- [ ] **包含性能说明** 对于昂贵操作
- [ ] **清楚记录副作用**

---

## 评审评分指南

### 评分 9-10：优秀
- 无错误
- 很少或没有警告
- 遵循所有最佳实践
- 文档完善
- 可以合并

### 评分 7-8：良好
- 无错误
- 只有轻微警告
- 遵循大多数最佳实践
- 文档适当
- 建议小幅修改

### 评分 5-6：可接受
- 无关键错误
- 存在一些警告
- 缺少一些最佳实践
- 文档有限
- 建议合并前修改

### 评分 3-4：需要改进
- 存在一些错误
- 多处警告
- 缺少类型注解
- 文档不足
- 需要重大修改

### 评分 1-2：较差
- 存在关键错误
- 存在安全问题
- 不适合生产环境
- 需要重大重构
- 不要合并
```

---

### 优势与价值

| 优势 | 说明 |
|------|------|
| **规则外部化** | 切换清单即可切换评审维度 |
| **结构化输出** | 始终按严重性组织结果 |
| **可量化** | 提供评分便于追踪趋势 |
| **可扩展** | 添加新规则只需更新清单 |
| **自动化友好** | 可集成到CI/CD流程 |

---

## 模式四：反转（Inversion）

### 概念定义

**反转** 模式颠覆了传统的"用户提问 → agent回答"交互方式，转而采用"agent提问 → 用户回答 → agent行动"的采访模式。

### 核心思想

```
传统模式:
用户请求 ──────▶ Agent直接生成
(需求可能不完整)

反转模式:
用户请求 ──────▶ Agent提问 ──────▶ 用户回答 ──────▶ Agent生成
              (收集完整信息)      (多轮交互)      (基于完整上下文)
```

### 何时使用

- ✅ 项目规划和架构设计
- ✅ 需求收集和整理
- ✅ 系统设计和决策
- ✅ 任何需要充分理解后再执行的任务
- ✅ 避免agent基于不完整信息做出错误假设

### 何时避免

- ❌ 用户需求已经非常明确
- ❌ 任务是纯执行性的，不需要决策
- ❌ 时间紧迫，需要快速响应

### 工作原理

1. **明确禁止**：使用"DO NOT..."指令阻止agent直接行动
2. **阶段划分**：将提问分成多个阶段
3. **顺序提问**：每次只问一个问题
4. **等待回答**：必须等待用户回答才能继续
5. **综合生成**：收集完所有信息后才生成最终输出

### 完整代码示例

#### 示例场景：项目规划器

##### 目录结构

```
skills/
└── project-planner/
    ├── SKILL.md
    └── assets/
        └── plan-template.md
```

##### SKILL.md

```markdown
# skills/project-planner/SKILL.md
---
name: project-planner
description: >
  通过结构化提问收集需求来规划新的软件项目，然后生成综合计划。
  当用户说"我想构建..."、"帮我规划..."、
  "设计一个系统..."，或询问项目架构时使用。
metadata:
  pattern: inversion
  phases: requirements,gathering,planning,generation
---

你是一位软件项目规划专家。你的工作是在生成任何计划之前先提出澄清问题。

## 关键规则

**在通过提问阶段收集到所有必需信息之前，不要生成任何项目计划、代码或结构。**

## 提问阶段

### 阶段 1：项目范围

一次只问一个问题。从项目范围开始：

1. "这个项目的核心目的是什么？它解决什么问题？"
2. "谁是目标用户？他们的技术水平如何？"
3. "预期规模是什么？（用户数、数据量、每秒请求数）"

### 阶段 2：技术需求

了解范围后，收集技术需求：

4. "你有任何技术偏好或限制吗？（语言、框架、云提供商）"
5. "项目需要与哪些现有系统集成？"
6. "性能需求是什么？（延迟、吞吐量、可用性）"

### 阶段 3：非功能性需求

7. "安全性和合规性背景是什么？（HIPAA、SOC2、GDPR）"
8. "你的部署环境偏好是什么？（云、本地、混合）"
9. "你的团队在相关技术方面的经验水平如何？"

### 阶段 4：限制与时间表

10. "你的预算和时间表是什么？"
11. "有什么我们应该知道的技术限制吗？"

## 提问规则

1. **一次只问一个问题** - 不要同时问多个问题
2. **等待回答** - 在用户回复之前不要继续
3. **跟进** - 根据回答提出澄清问题
4. **不要假设** - 如果有不清楚的地方，就问

## 计划生成

只有在所有阶段完成后：

1. 从 'assets/plan-template.md' 加载计划模板
2. 根据收集的信息填写所有部分
3. 展示完整的项目计划

## 计划模板结构

加载 'assets/plan-template.md' 获取完整的模板结构。
模板包含以下部分：
- 执行摘要
- 架构概述
- 技术决策
- 项目阶段
- 里程碑
- 风险评估
- 资源需求
```

##### plan-template.md

```markdown
# skills/project-planner/assets/plan-template.md
# 项目计划模板

## 1. 执行摘要

**项目名称**：{{project_name}}
**日期**：{{date}}
**规划团队**：{{team}}

### 问题陈述
{{problem_statement}}

### 建议解决方案
{{proposed_solution}}

### 预期成果
{{expected_outcomes}}

---

## 2. 架构概述

### 2.1 高层架构

```
{{high_level_architecture_diagram}}
```

### 2.2 组件分解

| 组件 | 职责 | 技术 | 优先级 |
|-----------|---------------|------------|----------|
| {{component}} | {{responsibility}} | {{tech}} | {{priority}} |

### 2.3 数据流

```
{{data_flow_diagram}}
```

---

## 3. 技术决策

### 3.1 语言与框架

| 决策 | 选择 | 理由 |
|----------|--------|----------|
| 后端语言 | {{language}} | {{rationale}} |
| 前端框架 | {{framework}} | {{rationale}} |
| 数据库 | {{database}} | {{rationale}} |

### 3.2 基础设施

| 组件 | 服务 | 配置 |
|-----------|--------|--------------|
| 计算 | {{service}} | {{config}} |
| 存储 | {{service}} | {{config}} |
| 网络 | {{service}} | {{config}} |

---

## 4. 项目阶段

### 阶段 1：基础（第 {{start}}-{{end}} 周）

**目标**：
- {{objective_1}}
- {{objective_2}}

**交付物**：
- [ ] {{deliverable_1}}
- [ ] {{deliverable_2}}

**团队**：
- 后端：{{backend_lead}}
- 前端：{{frontend_lead}}
- 运维：{{devops_lead}}

### 阶段 2：核心功能（第 {{start}}-{{end}} 周）

**目标**：
- {{objective_1}}
- {{objective_2}}

**交付物**：
- [ ] {{deliverable_1}}
- [ ] {{deliverable_2}}

### 阶段 3：集成与测试（第 {{start}}-{{end}} 周）

**目标**：
- {{objective_1}}
- {{objective_2}}

**交付物**：
- [ ] {{deliverable_1}}
- [ ] {{deliverable_2}}

### 阶段 4：部署与上线（第 {{start}}-{{end}} 周）

**目标**：
- {{objective_1}}
- {{objective_2}}

**交付物**：
- [ ] {{deliverable_1}}
- [ ] {{deliverable_2}}

---

## 5. 里程碑

| 里程碑 | 目标日期 | 标准 | 状态 |
|-----------|-------------|----------|--------|
| {{milestone}} | {{date}} | {{criteria}} | {{status}} |

---

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|-------------|--------|------------|
| {{risk}} | {{prob}} | {{impact}} | {{mitigation}} |

---

## 7. 资源需求

### 7.1 团队

| 角色 | 人数 | 分配比例 |
|------|-------|------------|
| {{role}} | {{count}} | {{allocation}} |

### 7.2 预算

| 类别 | 金额 | 备注 |
|----------|--------|-------|
| 基础设施 | {{amount}} | {{notes}} |
| 第三方服务 | {{amount}} | {{notes}} |
| 人员 | {{amount}} | {{notes}} |
| 应急储备 | {{amount}} | 10% 缓冲 |

---

*计划生成时间：{{generation_time}}*
```

---

### 优势与价值

| 优势 | 说明 |
|------|------|
| **避免假设** | 通过提问收集完整信息，避免基于错误的假设做决策 |
| **用户参与** | 多轮交互让用户深入参与规划过程 |
| **高质量输出** | 基于完整信息的计划更可行、更准确 |
| **减少返工** | 减少因需求不清导致的计划变更 |
| **建立信任** | 展示专业性和对用户需求的尊重 |

---

## 模式五：管道（Pipeline）

### 概念定义

**管道** 模式将复杂任务分解为多个有序阶段，每个阶段处理特定任务，最终组合成完整输出。它解决了单个 agent 无法处理超长上下文或复杂多步骤任务的问题。

### 核心思想

```
输入 ──▶ Stage 1 ──▶ Stage 2 ──▶ Stage 3 ──▶ 输出
         (分析)      (转换)      (验证)      (组装)

每个阶段:
- 有明确的输入/输出契约
- 可以独立测试和优化
- 失败时易于定位问题
```

### 何时使用

- ✅ 处理需要多步骤处理的复杂文档
- ✅ 需要不同专业知识的任务
- ✅ 避免超出 context window 限制
- ✅ 需要对中间结果进行验证的任务
- ✅ 构建可组合、可复用的工作流

### 何时避免

- ❌ 任务很简单，单步即可完成
- ❌ 各步骤之间有强耦合，无法并行
- ❌ 需要实时反馈，不适合批处理

### 工作原理

1. **阶段定义**：将任务分解为有序阶段
2. **数据契约**：每个阶段有明确的输入/输出格式
3. **顺序执行**：按依赖关系依次执行各阶段
4. **结果传递**：每个阶段的输出作为下一阶段的输入
5. **最终组装**：组合所有阶段结果生成最终输出

### 完整代码示例

#### 示例场景：四步技术文档管道

##### 目录结构

```
skills/
└── tech-doc-pipeline/
    ├── SKILL.md
    └── stages/
        ├── 1-analyze.md
        ├── 2-draft.md
        ├── 3-review.md
        └── 4-finalize.md
```

##### SKILL.md

```markdown
# skills/tech-doc-pipeline/SKILL.md
---
name: tech-doc-pipeline
description: >
  Generates comprehensive technical documentation through a 4-stage pipeline.
  Use when the user asks to "document", "write docs", "create guide",
  or "generate technical specification" for software projects.
metadata:
  pattern: pipeline
  stages: 4
  stage_names: analyze,draft,review,finalize
---

你是一位技术文档专家。你通过四阶段管道生成文档。

## 管道阶段

按顺序执行阶段。每个阶段必须完成后才能继续。

### 阶段 1：分析

**文件**：加载 'stages/1-analyze.md'

分析源材料：
1. 识别目标受众
2. 确定必需的章节
3. 评估复杂度级别
4. 创建文档大纲

**输出**：分析文档，包含：
- 受众画像
- 必需章节列表
- 复杂度评估
- 文档大纲

### 阶段 2：起草

**文件**：加载 'stages/2-draft.md'

编写文档：
1. 遵循阶段 1 的大纲
2. 编写清晰、简洁的内容
3. 在适当的地方包含代码示例
4. 使用 ASCII 艺术添加图表

**输出**：完整的文档草稿

### 阶段 3：评审

**文件**：加载 'stages/3-review.md'

评审和改进：
1. 检查技术准确性
2. 验证完整性
3. 评估可读性
4. 识别差距

**输出**：带注释的已评审文档

### 阶段 4：定稿

**文件**：加载 'stages/4-finalize.md'

最终润色：
1. 应用格式标准
2. 添加目录
3. 如需要创建索引
4. 生成最终 Markdown

**输出**：完整的、可发布的文档

## 阶段转换

每个阶段之间：
1. 总结阶段输出
2. 确认准备就绪
3. 加载下一阶段文件
4. 执行下一阶段

## 错误处理

如果任何阶段失败：
1. 识别具体问题
2. 尝试解决
3. 如未解决，报告已完成和剩余部分
4. 询问用户如何继续
```

##### 1-analyze.md

```markdown
# 阶段 1：分析

## 你的任务

分析源材料以理解：
1. 项目/模块的功能
2. 谁将阅读此文档
3. 他们需要什么信息

## 输入

用户的请求和提供的源代码、文档或上下文。

## 分析步骤

### 步骤 1：理解范围

阅读/理解源材料：
- 代码的主要目的
- 关键组件及其关系
- 入口点和接口
- 依赖项

### 步骤 2：识别受众

确定谁将阅读：
- **开发者**：需要 API 详情、代码示例
- **最终用户**：需要使用说明
- **运维**：需要部署信息
- **管理者**：需要高层概述

### 步骤 3：评估复杂度

- 低：简单功能，少量组件
- 中：中等复杂度，多个组件
- 高：复杂系统，多种集成

### 步骤 4：创建大纲

基于分析，创建文档大纲：

## 输出格式

```markdown
## 分析摘要

### 范围
[此文档涵盖的内容]

### 受众
[主要和次要受众]

### 复杂度
[低/中/高]

### 推荐章节

1. 介绍
   - 目的
   - 前置条件
2. 入门
   - 安装
   - 基本用法
3. [主题 1]
4. [主题 2]
5. 参考
   - API
   - 配置
6. 故障排除
7. 附录

### 预计长度
[章节数量和深度]
```
```

##### 2-draft.md

```markdown
# 阶段 2：起草

## 你的任务

基于阶段 1 的大纲编写完整的文档草稿。

## 输入

- 阶段 1 的分析摘要
- 用户提供的任何额外上下文

## 起草指南

### 内容质量

- 使用主动语态
- 保持句子在 25 个词以内
- 每个段落一个观点
- 包含"为什么"而不仅仅是"是什么"

### 代码示例

- 始终包含可工作的示例
- 使用真实、有意义的数据
- 添加解释关键部分的注释
- 展示预期输出

```python
# 良好示例
def calculate_total(items: list[Item]) -> Decimal:
    """计算含税总价。
    
    参数:
        items: 要计价的商品列表
        
    返回:
        含税总价
    """
    小计 = sum(item.price for item in items)
    税额 = 小计 * TAX_RATE
    return 小计 + 税额
```

### 图表

使用 ASCII 艺术绘制简单图表：

```
┌─────────────┐     ┌─────────────┐
│   客户端    │────▶│   服务器    │
└─────────────┘     └──────┬──────┘
                            │
                            ▼
                      ┌─────────────┐
                      │   数据库    │
                      └─────────────┘
```

### 格式化

- 使用一致的标题级别
- 首次使用时加粗关键术语
- 使用表格进行比较
- 使用列表表示序列

## 输出

编写完整的文档，所有章节都已填写。
仅对真正未知的信息使用占位符。
```
```

##### 3-review.md

```markdown
# 阶段 3：评审

## 你的任务

评审草稿并识别问题。

## Input

阶段 2 的完整文档草稿。

## 评审检查清单

### 技术准确性
- [ ] 代码示例正确工作
- [ ] API 签名准确
- [ ] 配置选项正确
- [ ] 版本号是最新的

### 完整性
- [ ] 所有章节都有内容
- [ ] 列出了前置条件
- [ ] 安装步骤完整
- [ ] 涵盖了错误处理

### 清晰性
- [ ] 说明明确无歧义
- [ ] 技术术语已定义
- [ ] 代码注释有帮助
- [ ] 图表清晰

### 可用性
- [ ] 步骤顺序合理
- [ ] 重要信息没有被埋没
- [ ] 交叉引用正确
- [ ] 存在搜索关键词

## Output Format

```markdown
## 评审摘要

### 发现的问题

#### 严重（必须修复）
- [问题位置和修复方案]

#### 重要（应该修复）
- [问题位置和修复方案]

#### 次要（考虑修复）
- [问题位置和修复方案]

### 正面发现
- [做得好的是]

### 建议
1. [具体改进建议]
2. [具体改进建议]

### 修订后的草稿
[应用修复后的完整草稿]
```
```

##### 4-finalize.md

```markdown
# 阶段 4：定稿

## 你的任务

应用最终润色并生成完整文档。

## Input

- 阶段 2 的草稿
- 阶段 3 的评审笔记

## 定稿步骤

### 1. 应用评审修复

整合阶段 3 的所有严重和重要修复。

### 2. 添加导航

为包含 3 个以上章节的文档添加目录：

```markdown
## 目录

- [介绍](#介绍)
- [入门](#入门)
- [高级主题](#高级主题)
- [参考](#参考)
```

### 3. 应用格式标准

- 一致的标题层级
- 正确的代码块语法
- 干净的表格格式
- 正确的列表格式

### 4. 添加元数据

在顶部包含：

```markdown
---
title: 文档标题
description: 简要描述
author: 作者姓名
date: YYYY-MM-DD
tags: [标签1, 标签2]
---
```

### 5. 最终质量检查

- [ ] 没有占位符文本残留
- [ ] 所有链接都有效
- [ ] 代码示例完整
- [ ] 格式一致
- [ ] 阅读水平适当

## 输出

最终的、可发布的文档，作为完整的 Markdown 文件。
```

---

### 优势与价值

| 优势 | 说明 |
|------|------|
| **可分解** | 大任务拆分为小阶段，更易管理 |
| **可测试** | 每个阶段可独立验证 |
| **可优化** | 可单独优化某个阶段 |
| **可复用** | 阶段模板可跨项目使用 |
| **容错强** | 阶段失败不影响整体，便于定位问题 |

---

## 模式选择决策树

选择正确的模式是 skill 设计的第一步。以下决策树帮助你根据任务特征选择合适的模式。

### 决策树

```
你的 skill 需要做什么？
         │
         ▼
    ┌─────────────────────────────┐
    │ 是否需要生成结构化输出？      │
    └─────────────┬───────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
       是                 否
        │                 │
        ▼                 ▼
   ┌────────────┐   ┌─────────────────────────────┐
   │ 输出格式   │   │ 是否需要与用户多轮交互？      │
   │ 是否固定？ │   └─────────────┬───────────────┘
   └─────┬──────┘               │
         │              ┌────────┴────────┐
    ┌────┴────┐         ▼                 ▼
    ▼         ▼        是                 否
   是         否        │                 │
    │         │        ▼                 ▼
    ▼         ▼   ┌────────────┐   ┌────────────────┐
生成器      需要      │ 是否需要   │   │ 是否需要       │
(Generator)│ 多阶段   │ 收集信息？ │   │ 检查/评审？   │
    │      处理？    └─────┬──────┘   └───────┬────────┘
    │          │          │                   │
    │          ▼          ▼                   ▼
    │    ┌─────────┐    反转              评审器
    │    │ 管道    │  (Inversion)        (Reviewer)
    │    │(Pipeline)│
    │    └─────────┘
    │
    ▼
你的 skill 是否封装特定技术/框架的约定？
         │
         ▼
    ┌─────────────────────────────┐
    │                             │
    ▼                             ▼
   是                             否
    │                             │
    ▼                             ▼
工具包装器                    回到上面的决策
(Tool Wrapper)               重新选择
```

### 快速选择指南

| 任务类型 | 推荐模式 | 原因 |
|----------|----------|------|
| 让 agent 掌握某框架的最佳实践 | 工具包装器 | 约定封装，可复用 |
| 生成格式统一的报告/文档 | 生成器 | 模板驱动，结构一致 |
| 检查代码质量和安全性 | 评审器 | 规则外部化，结构化评审 |
| 复杂项目的需求收集 | 反转 | 多轮交互，避免假设 |
| 多步骤的文档生成 | 管道 | 阶段分解，结果组合 |
| 同时需要多阶段和交互 | 组合模式 | 多个模式叠加 |

### 模式对比表

| 特征 | 工具包装器 | 生成器 | 评审器 | 反转 | 管道 |
|------|------------|--------|--------|------|------|
| **交互复杂度** | 低 | 低 | 低 | 高 | 中 |
| **输出一致性** | 中 | 高 | 高 | 低 | 高 |
| **规则复杂度** | 中 | 低 | 高 | 低 | 中 |
| **上下文需求** | 中 | 低 | 高 | 高 | 中 |
| **执行时间** | 短 | 短 | 中 | 长 | 长 |
| **用户参与度** | 低 | 低 | 低 | 高 | 中 |

---

## 模式组合使用

### 为什么需要组合？

现实世界中的任务通常不能被单一模式覆盖：

> "我需要一个 skill 来评审 FastAPI 代码，并生成改进建议报告"

这个任务需要：
- **评审器**：检查代码质量（模式三）
- **生成器**：生成结构化报告（模式二）

### 组合模式架构

```
┌─────────────────────────────────────────────────────────────┐
│                      组合 Skill                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────┐                                          │
│  │   评审器     │ ◄── Stage 1: 代码评审                     │
│  │  (Reviewer)  │                                          │
│  └───────┬───────┘                                          │
│          │                                                  │
│          ▼                                                  │
│  ┌───────────────┐                                          │
│  │   生成器     │ ◄── Stage 2: 生成报告                     │
│  │ (Generator)  │                                          │
│  └───────────────┘                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 组合示例：代码评审报告生成器

#### 目录结构

```
skills/
└── code-review-report/
    ├── SKILL.md
    ├── reviewer/
    │   ├── instructions.md
    │   └── checklist.md
    └── generator/
        ├── template.md
        └── style-guide.md
```

#### SKILL.md

```markdown
# skills/code-review-report/SKILL.md
---
name: code-review-report
description: >
  Reviews code and generates a structured improvement report.
  Use when user asks to "review and report", "audit code",
  or "analyze and document code quality".
metadata:
  pattern: composite
  stages:
    - reviewer
    - generator
---

You generate code review reports through two stages:

## Stage 1: Code Review

Load and follow 'reviewer/instructions.md' to perform the review.

## Stage 2: Report Generation

Load and follow 'generator/template.md' to generate the report.

## Report Format

The final report follows the structure from the generator template.
```

#### reviewer/instructions.md

```markdown
# Stage 1: Code Review Instructions

## Review Scope

Review the provided code for:
1. Code quality
2. Security vulnerabilities
3. Performance issues
4. Best practices violations

## Review Process

1. Load 'reviewer/checklist.md' for criteria
2. Analyze the code systematically
3. Document all findings with severity
4. Prepare findings summary for Stage 2

## Output

Produce a structured findings summary:

```markdown
## Review Findings

### Critical Issues
- [Issue 1]
- [Issue 2]

### Warnings
- [Issue 1]
- [Issue 2]

### Suggestions
- [Suggestion 1]

### Overall Score
[X/10]
```
```

#### generator/template.md

```markdown
# Stage 2: Report Template

## Report Structure

# Code Review Report

**Date**: {{date}}
**Reviewer**: AI Code Reviewer
**Scope**: {{scope}}

---

## Executive Summary

{{summary_of_findings}}

**Overall Score**: {{score}}/10

---

## Detailed Findings

{{detailed_findings_from_stage_1}}

---

## Recommendations

{{actionable_recommendations}}

---

## Appendix

{{additional_details}}
```
```

### 常见组合模式

| 场景 | 组合模式 | 说明 |
|------|----------|------|
| 代码评审报告 | 评审器 + 生成器 | 评审代码，生成报告 |
| 文档生成管道 | 分析器 + 生成器 + 审核器 | 多阶段文档生成 |
| 项目规划器 | 反转 + 管道 + 生成器 | 收集需求，分解任务，生成计划 |
| 自动化测试生成 | 工具包装器 + 生成器 | 使用框架约定，生成测试代码 |
| 安全扫描报告 | 评审器 + 评审器 + 生成器 | 多维度安全评审，汇总报告 |

---

## 最佳实践与总结

### Skill 设计最佳实践

#### 1. 从简单开始

```markdown
<!-- ❌ 过度设计 -->
pattern: composite
stages: 5
sub-patterns: [reviewer, generator, pipeline, inversion]

<!-- ✅ 足够就好 -->
pattern: generator
```

**原则**：
- 先用单模式解决问题
- 确认需要时才添加复杂度
- 避免 YAGNI（You Ain't Gonna Need It）

#### 2. 保持指令简洁

```markdown
<!-- ❌ 冗长指令 -->
你是一位拥有20年经验的Python开发专家。
你曾在谷歌、Meta和亚马逊工作过。你评审过
数千个代码库，了解所有Python最佳实践...

<!-- ✅ 简洁清晰 -->
你是一位Python代码评审专家。每次评审都遵循此协议：
1. 加载检查清单
2. 应用每条规则
3. 按严重性报告发现
```

#### 3. 使用外部文件存储规则

```markdown
<!-- ❌ 规则内联 -->
## 评审规则
1. 检查SQL注入
2. 检查命令注入
3. 检查硬编码密钥
4. 检查路径遍历
[... 还有100条规则 ...]

<!-- ✅ 规则外部化 -->
## 评审规则

加载 'references/review-rules.md' 获取完整检查清单。
```

#### 4. 提供清晰的退出条件

```markdown
<!-- ❌ 模糊退出 -->
持续评审直到代码足够好。

<!-- ✅ 清晰退出 -->
持续评审直到检查完检查清单中的所有项目。
如果发现3个或更多严重问题，立即停止并报告。
```

#### 5. 处理边缘情况

```markdown
## Error Handling

### If code is empty:
Report "No code provided for review."

### If code is too large:
Split into modules and review each separately.

### If language is unsupported:
Report "Cannot review code in [language]."

### If review finds no issues:
Report "No issues found. Code follows best practices."
```

### 模式选择小结

| 模式 | 核心价值 | 最佳场景 |
|------|----------|----------|
| **工具包装器** | 封装约定，即时专家 | 让 agent 掌握特定技术 |
| **生成器** | 结构一致，模板驱动 | 生成格式统一的文档 |
| **评审器** | 规则外部，结构评审 | 代码质量检查、安全扫描 |
| **反转** | 多轮交互，避免假设 | 需求收集、项目规划 |
| **管道** | 阶段分解，结果组合 | 多步骤复杂任务 |
| **组合** | 模式叠加，灵活组合 | 复杂综合任务 |

### Google ADK 官方建议

根据 Google Agent Development Kit 官方文档：

> **选择最简单可行的模式**。复杂的 skill 设计往往意味着难以维护和调试。从单模式开始，只有在证明需要时才引入复杂性。

> **保持 skill 职责单一**。每个 skill 应该做好一件事。如果需要多个功能，考虑创建多个 skill 而不是在一个 skill 中堆叠。

> **优先考虑可测试性**。设计 skill 时考虑如何验证其输出。外部化的规则和模板使得测试更容易。

> **关注用户体验**。skill 的触发条件和 description 决定用户是否能正确使用它。花时间优化这些内容。

### 总结

Agent Skills 规范的统一为 agent 生态系统带来了互操作性。然而，真正的差异化在于 **skill 的内容设计**。

通过掌握这 5 个核心设计模式，你将能够：

1. **更准确地理解任务**：选择正确的模式意味着更少的返工
2. **构建更可靠的 skill**：经过验证的设计模式减少错误
3. **提高复用性**：良好的设计使得 skill 易于跨项目使用
4. **更好的用户体验**：清晰的指令和结构带来一致的结果

记住：**格式统一后，内容为王**。

---

## 参考资源

- [Google Cloud Tech - Agent Skills Patterns](https://x.com/GoogleCloudTech/status/2033953579824758855)
- [Google ADK Documentation](https://cloud.google.com/generative-ai-app-builder/docs/agent-development-kit)
- [Agent Skills Specification](https://github.com/agentics/skill-spec)

---

*本文档由 AI 辅助翻译整理，保留原文核心内容，添加中文注释和补充说明。*
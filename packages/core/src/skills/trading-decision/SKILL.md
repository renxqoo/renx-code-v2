---
name: trading-decision
description: Multi-agent stock trading decision framework based on comprehensive analysis, debate, and risk assessment. Use when user asks to analyze stocks, make trading decisions, evaluate investment opportunities, assess market conditions, or generate BUY/SELL/HOLD signals. Triggers include: "帮我分析股票", "选股", "股票推荐", "交易决策", "投资建议", "评估这个股票", "stock analysis", "trading decision", "investment recommendation", "market evaluation", "generate trading signal"
---

# Trading Decision Framework

A systematic multi-agent framework for making stock trading decisions through comprehensive analysis, structured debate, and risk assessment. Based on TradingAgents architecture with 5 team roles and 10 agent types.

**数据接口设计**: 本框架通过抽象数据需求层实现数据源无关性，支持接入任何数据源（网页爬取、API接口、数据库、文件等）。

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     TRADING AGENTS WORKFLOW                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐                                               │
│  │    ANALYST TEAM   │ (Sequential execution)                        │
│  │  Market Analyst   │→ Social Analyst → News Analyst → Fundamentals │
│  └────────┬─────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌──────────────────┐                                               │
│  │  RESEARCH TEAM    │ (Debate loop)                                 │
│  │ Bull ↔ Bear      │ ──────────→ Research Manager                   │
│  └────────┬─────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌──────────────────┐                                               │
│  │  TRADING TEAM    │                                               │
│  │     Trader       │                                               │
│  └────────┬─────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌──────────────────┐                                               │
│  │  RISK MANAGEMENT │ (Risk debate loop)                             │
│  │ Risky ↔ Safe ↔ Neutral ──────────→ Risk Judge                    │
│  └────────┬─────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌──────────────────┐                                               │
│  │    PORTFOLIO      │                                               │
│  │   MANAGEMENT      │                                               │
│  │  Final Decision   │ ───────────────────────────────────────────→ │
│  └──────────────────┘                                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Interface Abstraction Layer

**核心设计原则**: 本框架定义的是"需要什么数据"，而不是"如何获取数据"。数据源完全由使用者自行配置。

### 数据需求规范

| 分析师 | 数据类别 | 必需字段 | 格式要求 |
|--------|----------|----------|----------|
| Market Analyst | 价格数据 | open, high, low, close, volume, date | OHLCV DataFrame |
| Market Analyst | 技术指标 | 指标名称 + 计算值 | Key-Value |
| Social Analyst | 社交数据 | platform, sentiment_score, content, date | Array |
| News Analyst | 新闻数据 | headline, source, date, sentiment | Array |
| News Analyst | 内幕情绪 | insider_sentiment_score, buy_ratio, sell_ratio | Object |
| Fundamentals Analyst | 公司概况 | market_cap, pe_ratio, eps, industry | Object |
| Fundamentals Analyst | 现金流量 | operating_cf, investing_cf, financing_cf, free_cf | Object |

### 数据接口实现示例

使用者在实现时需提供以下接口适配器：

```python
# === 必需的数据接口 ===

class StockDataProvider:
    """股票价格数据接口 - 必需"""
    
    def get_ohlcv(self, ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
        """
        获取OHLCV数据
        Returns: DataFrame with columns [date, open, high, low, close, volume]
        """
        pass
    
    def get_indicators(self, ticker: str, indicator_names: List[str], date: str) -> Dict:
        """
        获取技术指标
        indicator_names: ['rsi', 'macd', 'boll', 'atr', 'sma_50', ...]
        Returns: {indicator_name: value}
        """
        pass

class SentimentDataProvider:
    """社交情绪数据接口 - 必需"""
    
    def get_social_sentiment(self, ticker: str, start_date: str, end_date: str) -> List[Dict]:
        """
        Returns: [{platform, sentiment_score, content, date}, ...]
        """
        pass

class NewsDataProvider:
    """新闻数据接口 - 必需"""
    
    def get_news(self, ticker: str, start_date: str, end_date: str) -> List[Dict]:
        """
        Returns: [{headline, source, date, sentiment}, ...]
        """
        pass
    
    def get_insider_transactions(self, ticker: str, date: str) -> List[Dict]:
        """
        Returns: [{insider_name, transaction_type, shares, date}, ...]
        """
        pass

class FundamentalsDataProvider:
    """基本面数据接口 - 必需"""
    
    def get_company_profile(self, ticker: str) -> Dict:
        """Returns: {industry, market_cap, pe_ratio, eps, ...}"""
        pass
    
    def get_income_statement(self, ticker: str, period: str) -> Dict:
        """Returns: {revenue, net_income, eps, ...}"""
        pass
    
    def get_balance_sheet(self, ticker: str, period: str) -> Dict:
        """Returns: {total_assets, total_debt, equity, ...}"""
        pass
    
    def get_cashflow(self, ticker: str, period: str) -> Dict:
        """Returns: {operating_cf, investing_cf, financing_cf, ...}"""
        pass
```

### 数据源配置示例

```python
# config/data_sources.py

from your_data_source import YourStockAPI, YourSentimentAPI, YourNewsAPI

DATA_PROVIDERS = {
    "stock": YourStockAPI(api_key="xxx", base_url="..."),
    "sentiment": YourSentimentAPI(api_key="xxx"),
    "news": YourNewsAPI(api_key="xxx"),
    "fundamentals": YourFundamentalsAPI(api_key="xxx"),
}
```

### 支持的数据源类型

| 类型 | 示例 | 适配方式 |
|------|------|----------|
| REST API | Alpha Vantage, Finnhub, Yahoo Finance | HTTP请求封装 |
| Web Scraping | 网页爬取 | BeautifulSoup/Selenium |
| Database | MySQL, PostgreSQL | SQL查询 |
| Files | CSV, Excel, JSON | 文件读取解析 |
| WebSocket | 实时行情 | WebSocket客户端 |
| GraphQL | 自定义API | GraphQL客户端 |

## Phase 1: Analyst Team (Sequential)

Execute four analytical modules in order:

### 1.1 Market Analyst
**Role**: Technical analysis expert
**Data Needs**: OHLCV data, Technical indicators
**Output**: `market_report`

**Indicators to select (up to 8)**:
- Moving Averages: `close_10_ema`, `close_50_sma`, `close_200_sma`
- MACD Family: `macd`, `macds`, `macdh`
- Momentum: `rsi`, `mfi`
- Volatility: `boll`, `boll_ub`, `boll_lb`, `atr`
- Volume: `vwma`

**Analysis Requirements**:
- Detailed trend analysis with support/resistance levels
- Signal interpretation for each indicator
- Price-volume relationship
- No generic "mixed signals" - provide specific actionable insights

### 1.2 Social Media Analyst
**Role**: Sentiment analyst
**Data Needs**: Social media posts, sentiment scores
**Output**: `sentiment_report`

**Analysis Requirements**:
- Social media sentiment trends (positive/negative/neutral)
- Sentiment score and trajectory
- Key discussion themes
- Public perception impact assessment

### 1.3 News Analyst
**Role**: News and macro analyst
**Data Needs**: News articles, insider transactions
**Output**: `news_report`

**Analysis Requirements**:
- Recent news impact on stock
- Insider activity analysis (sentiment + transactions)
- Macroeconomic context
- Event-driven opportunities/risks

### 1.4 Fundamentals Analyst
**Role**: Financial analyst
**Data Needs**: Financial statements, company profile
**Output**: `fundamentals_report`

**Analysis Requirements**:
- Company profile (industry, market cap, P/E, EPS)
- Financial health (revenue growth, profit margins, debt levels)
- Balance sheet strength
- Cash flow analysis
- Intrinsic value assessment

---

## Phase 2: Research Team (Debate Loop)

### 2.1 Bull Researcher
**Role**: Advocate for investment
**Memory**: Access to similar historical situations
**Output**: Bull case with evidence-based arguments

### 2.2 Bear Researcher
**Role**: Advocate against investment
**Memory**: Access to similar historical situations
**Output**: Bear case with risk-focused arguments

### 2.3 Research Manager
**Role**: Portfolio manager and debate facilitator
**Model**: Deep thinking model (e.g., o1-preview)
**Output**: `investment_plan`

**Decision Requirements**:
- Summarize key bull and bear arguments
- Make definitive decision: **BUY / SELL / HOLD**
- **AVOID defaulting to HOLD** - commit when evidence is clear
- Develop detailed investment plan

---

## Phase 3: Trading Team

### 3.1 Trader
**Role**: Execute investment plan
**Output**: `trader_investment_plan`

**Responsibilities**:
- Transform investment plan into specific trading strategy
- Determine order type (market/limit)
- Calculate position size
- Set entry/exit points

---

## Phase 4: Risk Management Team (Risk Debate Loop)

### 4.1 Risky Analyst
**Role**: Champion high-risk/high-reward opportunities

### 4.2 Safe Analyst
**Role**: Prioritize capital preservation

### 4.3 Neutral Analyst
**Role**: Balance risk and return

### 4.4 Risk Judge
**Role**: Final risk assessment
**Output**: `final_trade_decision`

---

## Output Format

```markdown
# Trading Decision Report - {TICKER}

## Executive Summary
**FINAL DECISION: BUY/SELL/HOLD**
**Confidence: High/Medium/Low**

## Analyst Team Reports
[All four analyst reports]

## Research Team Debate
[Bull/Bear arguments and Research Manager decision]

## Trading Strategy
[Specific trading plan]

## Risk Assessment
[Three-perspective risk analysis and Risk Judge decision]

## Execution Details
| Parameter | Value |
|-----------|-------|
| Entry Price | $XXX |
| Stop Loss | $XXX |
| Take Profit | $XXX |
| Position Size | XX% |
| Risk/Reward | X:1 |
```

## Configuration

```python
{
    "max_debate_rounds": 1,
    "max_risk_discuss_rounds": 1,
    "max_recur_limit": 100,
    "data_providers": {...}  # Custom data source configuration
}
```

## Reference Materials

- Technical indicators: See `references/technical-indicators.md`
- Analysis template: See `references/analysis-template.md`
- Data interface spec: See `references/data-interface.md`

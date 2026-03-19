#!/usr/bin/env python3
"""
Trading Decision Framework - Multi-Agent Stock Analysis

Supports flexible data source integration through pluggable data providers.
See references/data-interface.md for interface specifications.

Usage:
    python trading_decision.py AAPL
    python trading_decision.py GOOGL --date 2024-05-10
    python trading_decision.py TSLA -o result.md --debate-rounds 2
"""

import sys
import argparse
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Protocol
from dataclasses import dataclass, field
from enum import Enum


class Recommendation(Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


# =============================================================================
# DATA PROVIDER INTERFACES (Abstraction Layer)
# =============================================================================

class StockDataProvider(Protocol):
    """Protocol for stock price and technical data."""
    
    def get_ohlcv(self, ticker: str, start_date: str, end_date: str) -> Any:
        """Get OHLCV data. Returns DataFrame with [date, open, high, low, close, volume]."""
        ...
    
    def get_indicators(self, ticker: str, indicator_names: List[str], 
                       current_date: str, lookback_days: int = 30) -> Dict[str, float]:
        """Calculate technical indicators."""
        ...


class SentimentDataProvider(Protocol):
    """Protocol for social media sentiment data."""
    
    def get_social_sentiment(self, ticker: str, start_date: str, 
                             end_date: str) -> List[Dict]:
        """Get social sentiment data."""
        ...


class NewsDataProvider(Protocol):
    """Protocol for news data."""
    
    def get_news(self, ticker: str, start_date: str, end_date: str) -> List[Dict]:
        """Get news articles."""
        ...
    
    def get_insider_transactions(self, ticker: str, date: str) -> List[Dict]:
        """Get insider trading transactions."""
        ...
    
    def get_insider_sentiment(self, ticker: str, date: str) -> Dict:
        """Get aggregated insider sentiment data.
        
        Returns: {
            insider_sentiment_score: float,  # -1 to 1
            buy_ratio: float,                # 0 to 1
            sell_ratio: float,               # 0 to 1
            recent_transactions: int,
            date: str
        }
        """
        ...


class FundamentalsDataProvider(Protocol):
    """Protocol for fundamental financial data."""
    
    def get_company_profile(self, ticker: str) -> Dict:
        """Get company profile."""
        ...
    
    def get_income_statement(self, ticker: str, frequency: str = "quarterly") -> List[Dict]:
        """Get income statement."""
        ...
    
    def get_balance_sheet(self, ticker: str, frequency: str = "quarterly") -> List[Dict]:
        """Get balance sheet."""
        ...
    
    def get_cashflow(self, ticker: str, frequency: str = "quarterly") -> List[Dict]:
        """Get cash flow statement.
        
        Returns: [{
            period: str,
            operating_cash_flow: float,
            investing_cash_flow: float,
            financing_cash_flow: float,
            free_cash_flow: float
        }, ...]
        """
        ...


# =============================================================================
# MOCK DATA PROVIDERS (For testing without real data sources)
# =============================================================================

class MockStockProvider:
    """Mock stock data provider for testing."""
    
    def __init__(self):
        import random
        self.base_price = 100.0
        self.rng = random.Random(42)  # 固定种子保证可重复性
    
    def get_ohlcv(self, ticker: str, start_date: str, end_date: str) -> Any:
        import pandas as pd
        dates = pd.date_range(start_date, end_date, freq='D')
        base = self.base_price
        data = {
            'date': dates,
            'open': [base + self.rng.uniform(-2, 2) for _ in dates],
            'high': [base + self.rng.uniform(1, 4) for _ in dates],
            'low': [base + self.rng.uniform(-4, -1) for _ in dates],
            'close': [base + self.rng.uniform(-2, 2) for _ in dates],
            'volume': [self.rng.randint(1000000, 10000000) for _ in dates]
        }
        return pd.DataFrame(data)
    
    def get_indicators(self, ticker: str, indicator_names: List[str],
                       current_date: str, lookback_days: int = 30) -> Dict[str, float]:
        base = self.base_price
        indicators = {}
        for name in indicator_names:
            if name == 'sma_10':
                indicators[name] = base + self.rng.uniform(-2, 2)
            elif name == 'sma_50':
                indicators[name] = base + self.rng.uniform(-5, 5)
            elif name == 'sma_200':
                indicators[name] = base + self.rng.uniform(-10, 10)
            elif name == 'ema_10':
                indicators[name] = base + self.rng.uniform(-2, 2)
            elif name == 'rsi':
                indicators[name] = 50.0 + self.rng.uniform(-20, 20)
            elif name == 'macd':
                indicators[name] = self.rng.uniform(-2, 2)
            elif name == 'macd_signal':
                indicators[name] = self.rng.uniform(-1, 1)  # 修正: MACD Signal 通常与 MACD 接近
            elif name == 'macd_histogram':
                indicators[name] = self.rng.uniform(-0.5, 0.5)
            elif name == 'atr':
                indicators[name] = 2.0 + self.rng.uniform(-0.5, 0.5)
            elif name == 'boll_upper':
                indicators[name] = base + 5.0 + self.rng.uniform(-1, 1)
            elif name == 'boll_middle':
                indicators[name] = base + self.rng.uniform(-1, 1)
            elif name == 'boll_lower':
                indicators[name] = base - 5.0 + self.rng.uniform(-1, 1)
            elif name == 'vwma':
                indicators[name] = base + self.rng.uniform(-1, 1)
            elif name == 'mfi':
                # Money Flow Index - 资金流量指数, 范围 0-100
                indicators[name] = 50.0 + self.rng.uniform(-30, 30)
            else:
                indicators[name] = base + self.rng.uniform(-2, 2)
        return indicators


class MockSentimentProvider:
    """Mock sentiment data provider for testing."""
    
    def __init__(self):
        import random
        self.rng = random.Random(42)
        self.themes = ["earnings beat", "new product launch", "analyst upgrade", 
                  "market share growth", "innovation pipeline"]
        self.platforms = ["twitter", "reddit", "stocktwits"]
    
    def get_social_sentiment(self, ticker: str, start_date: str, end_date: str) -> List[Dict]:
        return [
            {
                "platform": self.rng.choice(self.platforms),
                "sentiment_score": self.rng.uniform(-1, 1),
                "content": f"{ticker} {self.rng.choice(self.themes)}",
                "date": start_date
            }
            for _ in range(10)
        ]


class MockNewsProvider:
    """Mock news data provider for testing."""
    
    def __init__(self):
        import random
        self.rng = random.Random(42)
        self.headlines = [
            f"{'{ticker}'} reports strong quarterly earnings",
            f"{'{ticker}'} announces strategic partnership",
            f"Analysts upgrade {'{ticker}'} price target",
            f"{'{ticker}'} expands into new markets"
        ]
        self.sources = ["Reuters", "Bloomberg", "WSJ"]
        self.sentiments = ["positive", "negative", "neutral"]
    
    def get_news(self, ticker: str, start_date: str, end_date: str) -> List[Dict]:
        return [
            {
                "headline": self.headlines[self.rng.randint(0, len(self.headlines)-1)].format(ticker=ticker),
                "source": self.rng.choice(self.sources),
                "date": start_date,
                "sentiment": self.rng.choice(self.sentiments),
                "sentiment_score": self.rng.uniform(-1, 1)
            }
            for _ in range(5)
        ]
    
    def get_insider_transactions(self, ticker: str, date: str) -> List[Dict]:
        names = ["John Doe", "Jane Smith"]
        titles = ["CEO", "CFO", "Director"]
        return [
            {
                "insider_name": self.rng.choice(names),
                "insider_title": self.rng.choice(titles),
                "transaction_type": self.rng.choice(["BUY", "SELL"]),
                "shares": self.rng.randint(1000, 10000),
                "price_per_share": 100.0,
                "date": date
            }
        ]
    
    def get_insider_sentiment(self, ticker: str, date: str) -> Dict:
        """Generate mock insider sentiment data."""
        buy_ratio = self.rng.uniform(0.3, 0.8)
        sell_ratio = 1.0 - buy_ratio
        sentiment_score = (buy_ratio - sell_ratio)  # -1 to 1
        
        return {
            "insider_sentiment_score": sentiment_score,
            "buy_ratio": buy_ratio,
            "sell_ratio": sell_ratio,
            "recent_transactions": self.rng.randint(5, 20),
            "date": date
        }


class MockFundamentalsProvider:
    """Mock fundamentals data provider for testing."""
    
    def get_company_profile(self, ticker: str) -> Dict:
        return {
            "company_name": f"{ticker} Inc.",
            "industry": "Technology",
            "market_cap": 1000000000000,
            "pe_ratio": 25.0,
            "eps": 4.0,
            "dividend_yield": 1.5,
            "beta": 1.2
        }
    
    def get_income_statement(self, ticker: str, frequency: str = "quarterly") -> List[Dict]:
        return [
            {
                "period": "2024-Q1",
                "revenue": 100000000000,
                "net_income": 25000000000,
                "eps": 1.25
            }
        ]
    
    def get_balance_sheet(self, ticker: str, frequency: str = "quarterly") -> List[Dict]:
        return [
            {
                "period": "2024-Q1",
                "total_assets": 350000000000,
                "total_debt": 150000000000,
                "total_equity": 200000000000
            }
        ]
    
    def get_cashflow(self, ticker: str, frequency: str = "quarterly") -> List[Dict]:
        return [
            {
                "period": "2024-Q1",
                "operating_cash_flow": 25000000000,
                "investing_cash_flow": -5000000000,
                "financing_cash_flow": -10000000000,
                "free_cash_flow": 20000000000
            },
            {
                "period": "2023-Q4",
                "operating_cash_flow": 22000000000,
                "investing_cash_flow": -4000000000,
                "financing_cash_flow": -8000000000,
                "free_cash_flow": 18000000000
            }
        ]


# =============================================================================
# DATA PROVIDER REGISTRY
# =============================================================================

class DataProviderRegistry:
    """Registry for data providers. Users can register custom implementations."""
    
    _providers: Dict[str, Any] = {}
    _initialized: bool = False
    
    @classmethod
    def _ensure_initialized(cls):
        """Lazy initialization of mock providers."""
        if not cls._initialized:
            cls._providers = {
                "stock": MockStockProvider(),
                "sentiment": MockSentimentProvider(),
                "news": MockNewsProvider(),
                "fundamentals": MockFundamentalsProvider()
            }
            cls._initialized = True
    
    @classmethod
    def register(cls, provider_type: str, provider):
        """Register a custom data provider."""
        cls._ensure_initialized()
        cls._providers[provider_type] = provider
    
    @classmethod
    def get(cls, provider_type: str):
        """Get a registered data provider."""
        cls._ensure_initialized()
        return cls._providers.get(provider_type)
    
    @classmethod
    def configure(cls, stock=None, sentiment=None, news=None, fundamentals=None):
        """Configure all providers at once."""
        cls._ensure_initialized()
        if stock:
            cls._providers["stock"] = stock
        if sentiment:
            cls._providers["sentiment"] = sentiment
        if news:
            cls._providers["news"] = news
        if fundamentals:
            cls._providers["fundamentals"] = fundamentals


# =============================================================================
# VECTOR MEMORY SYSTEM (for historical pattern matching)
# =============================================================================

class VectorMemory:
    """
    向量记忆系统 - 用于检索历史相似情况
    
    在真实实现中应使用 ChromaDB 或类似向量数据库存储和检索。
    此处提供 Mock 实现用于测试。
    """
    
    def __init__(self):
        import random
        self.rng = random.Random(42)
        # 存储格式: [{"situation": str, "recommendation": str, "outcome": str}]
        self._memories = []
    
    def get_memories(self, situation: str, n_matches: int = 2) -> List[Dict]:
        """
        基于当前情况检索相似历史。
        
        Args:
            situation: 当前市场情况描述
            n_matches: 返回的相似情况数量
        
        Returns:
            List of dicts with keys: situation, recommendation, outcome
        """
        # Mock 实现：随机返回历史记忆
        if not self._memories:
            self._memories = [
                {
                    "situation": "Strong bullish technical setup with positive sentiment",
                    "recommendation": "BUY",
                    "outcome": "+15% in 4 weeks"
                },
                {
                    "situation": "Mixed signals with insider selling pressure",
                    "recommendation": "HOLD",
                    "outcome": "+3% in 4 weeks (sideways)"
                },
                {
                    "situation": "Bearish technical breakdown with negative news",
                    "recommendation": "SELL",
                    "outcome": "-12% in 2 weeks"
                }
            ]
        
        # 简单模拟：返回 n_matches 条随机记忆
        return [
            self._memories[self.rng.randint(0, len(self._memories) - 1)]
            for _ in range(min(n_matches, len(self._memories)))
        ]
    
    def add_memory(self, situation: str, recommendation: str, outcome: str):
        """存储交易经验"""
        self._memories.append({
            "situation": situation,
            "recommendation": recommendation,
            "outcome": outcome
        })


# =============================================================================
# ANALYSIS FRAMEWORK
# =============================================================================

@dataclass
class TechnicalIndicators:
    """Technical analysis data container."""
    price: float = 0.0
    ema_10: float = 0.0
    sma_50: float = 0.0
    sma_200: float = 0.0
    macd: float = 0.0
    macd_signal: float = 0.0
    macd_histogram: float = 0.0
    rsi: float = 50.0
    mfi: float = 50.0  # Money Flow Index - 资金流量指数
    boll_upper: float = 0.0
    boll_middle: float = 0.0
    boll_lower: float = 0.0
    atr: float = 0.0
    vwma: float = 0.0


@dataclass
class TradingDecision:
    """Final trading decision container."""
    recommendation: Recommendation = Recommendation.HOLD
    entry_price: float = 0.0
    stop_loss: float = 0.0
    take_profit: float = 0.0
    position_size_pct: float = 0.0
    risk_reward_ratio: float = 0.0
    time_horizon: str = ""


class TradingDecisionFramework:
    """
    Multi-agent framework for stock trading decisions.
    
    Data Source Integration:
    - Uses DataProviderRegistry to get data providers
    - Users can register custom providers via DataProviderRegistry.register()
    - Default providers are mocks for testing
    
    LLM Model Configuration:
    - quick_thinking_llm: Fast models for rapid analysis (e.g., GPT-4o)
    - deep_thinking_llm: Slower but more thorough models for critical decisions (e.g., o1-preview)
    """
    
    def __init__(
        self,
        ticker: str,
        trade_date: Optional[str] = None,
        max_debate_rounds: int = 1,
        max_risk_discuss_rounds: int = 1,
        debug: bool = False,
        # LLM Model Configuration
        quick_thinking_llm = None,
        deep_thinking_llm = None,
    ):
        self.ticker = ticker.upper()
        self.trade_date = trade_date or datetime.now().strftime("%Y-%m-%d")
        self.max_debate_rounds = max_debate_rounds
        self.max_risk_discuss_rounds = max_risk_discuss_rounds
        self.debug = debug
        
        # LLM Model 配置
        # 真实实现中应传入实际的 LLM 实例
        # 此处用于说明架构设计
        self.quick_thinking_llm = quick_thinking_llm
        self.deep_thinking_llm = deep_thinking_llm
        
        # 记忆系统 - 用于存储和检索历史交易经验
        self.bull_memory = VectorMemory()
        self.bear_memory = VectorMemory()
        self.trader_memory = VectorMemory()
        self.research_judge_memory = VectorMemory()
        self.risk_manager_memory = VectorMemory()
        
        # Data containers
        self.technical = TechnicalIndicators()
        self.market_report = ""
        self.sentiment_report = ""
        self.news_report = ""
        self.fundamentals_report = ""
        
        # Debate state
        self.bull_history = ""
        self.bear_history = ""
        self.investment_plan = ""
        self.trader_plan = ""
        self.risk_views = {"risky": "", "safe": "", "neutral": ""}
        self.final_decision: Optional[TradingDecision] = None
    
    def _log(self, phase: str, message: str):
        if self.debug:
            print(f"\n[{phase}] {message}")
    
    # =========================================================================
    # PHASE 1: ANALYST TEAM
    # =========================================================================
    
    def run_market_analyst(self) -> str:
        """Market Technical Analysis."""
        self._log("Market Analyst", f"Analyzing {self.ticker}...")
        
        stock_provider = DataProviderRegistry.get("stock")
        
        # Get price data
        start_date = (datetime.strptime(self.trade_date, "%Y-%m-%d") - 
                     timedelta(days=60)).strftime("%Y-%m-%d")
        ohlcv = stock_provider.get_ohlcv(self.ticker, start_date, self.trade_date)
        
        if not ohlcv.empty:
            self.technical.price = float(ohlcv['close'].iloc[-1])
        
        # Get indicators
        indicator_names = [
            'sma_10', 'sma_50', 'sma_200', 
            'macd', 'macd_signal', 'macd_histogram',
            'rsi', 'mfi',  # 添加 MFI
            'boll_upper', 'boll_middle', 'boll_lower', 
            'atr', 'vwma'
        ]
        indicators = stock_provider.get_indicators(
            self.ticker, indicator_names, self.trade_date, 30
        )
        
        # Update technical indicators
        self.technical.ema_10 = indicators.get('ema_10', indicators.get('sma_10', 0))
        self.technical.sma_50 = indicators.get('sma_50', 0)
        self.technical.sma_200 = indicators.get('sma_200', 0)
        self.technical.macd = indicators.get('macd', 0)
        self.technical.macd_signal = indicators.get('macd_signal', 0)
        self.technical.macd_histogram = indicators.get('macd_histogram', 0)
        self.technical.rsi = indicators.get('rsi', 50)
        self.technical.mfi = indicators.get('mfi', 50)  # 添加 MFI
        self.technical.boll_upper = indicators.get('boll_upper', 0)
        self.technical.boll_middle = indicators.get('boll_middle', 0)
        self.technical.boll_lower = indicators.get('boll_lower', 0)
        self.technical.atr = indicators.get('atr', 2.0)
        self.technical.vwma = indicators.get('vwma', self.technical.price)
        
        self.market_report = f"""
## Market Technical Analysis - {self.ticker}

### Price Action
- **Current Price**: ${self.technical.price:.2f}
- **50-Day SMA**: ${self.technical.sma_50:.2f}
- **200-Day SMA**: ${self.technical.sma_200:.2f}

### Technical Indicators

| Indicator | Value | Signal |
|-----------|-------|--------|
| RSI (14) | {self.technical.rsi:.1f} | {"Overbought" if self.technical.rsi > 70 else "Oversold" if self.technical.rsi < 30 else "Neutral"} |
| MFI (14) | {self.technical.mfi:.1f} | {"Overbought" if self.technical.mfi > 80 else "Oversold" if self.technical.mfi < 20 else "Neutral"} |
| MACD | {self.technical.macd:.2f} | {"Bullish" if self.technical.macd > 0 else "Bearish"} |
| MACD Signal | {self.technical.macd_signal:.2f} | {"Above" if self.technical.macd > self.technical.macd_signal else "Below"} MACD |
| MACD Histogram | {self.technical.macd_histogram:.2f} | {"Positive" if self.technical.macd_histogram > 0 else "Negative"} |
| ATR | ${self.technical.atr:.2f} | {"High" if self.technical.atr > 3 else "Medium" if self.technical.atr > 1.5 else "Low"} Volatility |
| VWMA | ${self.technical.vwma:.2f} | {"Above" if self.technical.price > self.technical.vwma else "Below"} Price |
| Bollinger Upper | ${self.technical.boll_upper:.2f} | - |
| Bollinger Middle | ${self.technical.boll_middle:.2f} | - |
| Bollinger Lower | ${self.technical.boll_lower:.2f} | - |

### Trend Analysis
- **Short-term**: {"Bullish" if self.technical.price > self.technical.ema_10 else "Bearish"} (price vs 10-day MA)
- **Medium-term**: {"Bullish" if self.technical.price > self.technical.sma_50 else "Bearish"} (price vs 50-day MA)
- **Long-term**: {"Bullish" if self.technical.price > self.technical.sma_200 else "Bearish"} (price vs 200-day MA)
"""
        return self.market_report
    
    def run_sentiment_analyst(self) -> str:
        """Social Media Sentiment Analysis."""
        self._log("Social Analyst", f"Analyzing {self.ticker} sentiment...")
        
        sentiment_provider = DataProviderRegistry.get("sentiment")
        start_date = (datetime.strptime(self.trade_date, "%Y-%m-%d") - 
                     timedelta(days=7)).strftime("%Y-%m-%d")
        
        sentiment_data = sentiment_provider.get_social_sentiment(
            self.ticker, start_date, self.trade_date
        )
        
        # Calculate aggregate sentiment
        if sentiment_data:
            avg_sentiment = sum(d['sentiment_score'] for d in sentiment_data) / len(sentiment_data)
            positive_count = sum(1 for d in sentiment_data if d['sentiment_score'] > 0.2)
            negative_count = sum(1 for d in sentiment_data if d['sentiment_score'] < -0.2)
        else:
            avg_sentiment = 0
            positive_count = negative_count = 0
        
        sentiment_label = "Positive" if avg_sentiment > 0.2 else "Negative" if avg_sentiment < -0.2 else "Neutral"
        
        self.sentiment_report = f"""
## Social Sentiment Analysis - {self.ticker}

### Overall Sentiment
- **Average Sentiment Score**: {avg_sentiment:.2f} (-1 to 1 scale)
- **Sentiment**: {sentiment_label}
- **Data Points**: {len(sentiment_data)} posts analyzed

### Sentiment Breakdown
- **Positive Posts**: {positive_count}
- **Neutral Posts**: {len(sentiment_data) - positive_count - negative_count}
- **Negative Posts**: {negative_count}

### Key Themes
[Summarized from social media discussions]
"""
        return self.sentiment_report
    
    def run_news_analyst(self) -> str:
        """News and Macro Analysis."""
        self._log("News Analyst", f"Analyzing {self.ticker} news...")
        
        news_provider = DataProviderRegistry.get("news")
        start_date = (datetime.strptime(self.trade_date, "%Y-%m-%d") - 
                     timedelta(days=7)).strftime("%Y-%m-%d")
        
        news_data = news_provider.get_news(self.ticker, start_date, self.trade_date)
        insider_data = news_provider.get_insider_transactions(self.ticker, self.trade_date)
        insider_sentiment_data = news_provider.get_insider_sentiment(self.ticker, self.trade_date)
        
        # Analyze news sentiment
        if news_data:
            avg_news_sentiment = sum(d.get('sentiment_score', 0) for d in news_data) / len(news_data)
            positive_news = sum(1 for d in news_data if d.get('sentiment') == 'positive')
        else:
            avg_news_sentiment = 0
            positive_news = 0
        
        # Analyze insider activity from transactions
        buy_count = sum(1 for d in insider_data if d['transaction_type'] == 'BUY')
        sell_count = sum(1 for d in insider_data if d['transaction_type'] == 'SELL')
        
        # Get insider sentiment from aggregated data
        insider_sentiment_score = insider_sentiment_data.get('insider_sentiment_score', 0)
        buy_ratio = insider_sentiment_data.get('buy_ratio', 0)
        sell_ratio = insider_sentiment_data.get('sell_ratio', 0)
        recent_transactions = insider_sentiment_data.get('recent_transactions', 0)
        
        insider_sentiment_label = "Bullish" if insider_sentiment_score > 0.2 else "Bearish" if insider_sentiment_score < -0.2 else "Neutral"
        
        self.news_report = f"""
## News Analysis - {self.ticker}

### News Sentiment
- **Articles Analyzed**: {len(news_data)}
- **Average Sentiment**: {avg_news_sentiment:.2f}
- **Positive Coverage**: {positive_news} of {len(news_data)} articles

### Insider Sentiment (Aggregated)
- **Overall Insider Sentiment**: {insider_sentiment_label} ({insider_sentiment_score:.2f})
- **Buy Ratio**: {buy_ratio:.1%}
- **Sell Ratio**: {sell_ratio:.1%}
- **Recent Transactions**: {recent_transactions}

### Insider Transactions Detail
- **Buy Transactions**: {buy_count}
- **Sell Transactions**: {sell_count}
- **Transaction Sentiment**: {"Bullish" if buy_count > sell_count else "Bearish" if sell_count > buy_count else "Neutral"}

### Recent Headlines
{chr(10).join(f"- {d['headline']}" for d in news_data[:3]) if news_data else "No recent news found."}
"""
        return self.news_report
    
    def run_fundamentals_analyst(self) -> str:
        """Company Fundamentals Analysis."""
        self._log("Fundamentals Analyst", f"Analyzing {self.ticker} fundamentals...")
        
        fundamentals_provider = DataProviderRegistry.get("fundamentals")
        
        profile = fundamentals_provider.get_company_profile(self.ticker)
        income = fundamentals_provider.get_income_statement(self.ticker)
        balance = fundamentals_provider.get_balance_sheet(self.ticker)
        cashflow = fundamentals_provider.get_cashflow(self.ticker)
        
        if income and balance:
            latest_income = income[0]
            latest_balance = balance[0]
            
            # Calculate some ratios
            if latest_balance.get('total_equity', 0) > 0:
                debt_to_equity = latest_balance.get('total_debt', 0) / latest_balance['total_equity']
            else:
                debt_to_equity = 0
        else:
            latest_income = latest_balance = {}
            debt_to_equity = 0
        
        # Cash flow analysis
        if cashflow:
            latest_cf = cashflow[0]
            operating_cf = latest_cf.get('operating_cash_flow', 0)
            investing_cf = latest_cf.get('investing_cash_flow', 0)
            financing_cf = latest_cf.get('financing_cash_flow', 0)
            free_cf = latest_cf.get('free_cash_flow', 0)
        else:
            operating_cf = investing_cf = financing_cf = free_cf = 0
        
        self.fundamentals_report = f"""
## Fundamentals Analysis - {self.ticker}

### Company Profile
- **Company Name**: {profile.get('company_name', 'N/A')}
- **Industry**: {profile.get('industry', 'N/A')}
- **Market Cap**: ${profile.get('market_cap', 0) / 1e9:.2f}B
- **P/E Ratio**: {profile.get('pe_ratio', 'N/A')}
- **EPS (TTM)**: ${profile.get('eps', 'N/A')}
- **Dividend Yield**: {profile.get('dividend_yield', 'N/A')}%

### Financial Health
- **Revenue**: ${latest_income.get('revenue', 0) / 1e9:.2f}B
- **Net Income**: ${latest_income.get('net_income', 0) / 1e9:.2f}B
- **Total Assets**: ${latest_balance.get('total_assets', 0) / 1e9:.2f}B
- **Total Debt**: ${latest_balance.get('total_debt', 0) / 1e9:.2f}B
- **Debt/Equity**: {debt_to_equity:.2f}
- **EPS**: ${latest_income.get('eps', 'N/A')}

### Cash Flow Analysis
- **Operating Cash Flow**: ${operating_cf / 1e9:.2f}B
- **Investing Cash Flow**: ${investing_cf / 1e9:.2f}B
- **Financing Cash Flow**: ${financing_cf / 1e9:.2f}B
- **Free Cash Flow**: ${free_cf / 1e9:.2f}B
- **FCF Status**: {"Healthy" if free_cf > 0 else "Negative - Concern"}
"""
        return self.fundamentals_report
    
    # =========================================================================
    # PHASE 2-4: RESEARCH, TRADING, RISK MANAGEMENT
    # =========================================================================
    
    def run_research_debate(self) -> str:
        """Research Team Debate with Memory Integration.
        
        Uses deep_thinking_llm for Research Manager decision-making.
        Uses VectorMemory to learn from historical patterns.
        """
        self._log("Research Team", "Running investment debate...")
        
        # 构建当前情况描述（用于记忆检索）
        curr_situation = f"""
Market: {self.market_report[:200]}...
Sentiment: {self.sentiment_report[:200]}...
News: {self.news_report[:200]}...
Fundamentals: {self.fundamentals_report[:200]}...
"""
        
        # 获取历史记忆
        past_memories = self.research_judge_memory.get_memories(curr_situation, n_matches=2)
        past_memory_str = "\n".join([
            f"- Situation: {m['situation']}\n  Recommendation: {m['recommendation']}\n  Outcome: {m['outcome']}"
            for m in past_memories
        ]) if past_memories else "No past memories found."
        
        # Bull Researcher perspective
        bull_score = 0
        bull_reasons = []
        
        # Technical scoring
        if self.technical.price > self.technical.sma_50:
            bull_score += 2
            bull_reasons.append("Price above 50-day MA")
        if self.technical.price > self.technical.sma_200:
            bull_score += 1
            bull_reasons.append("Price above 200-day MA (long-term uptrend)")
        if self.technical.rsi < 70 and self.technical.rsi > 40:
            bull_score += 1
            bull_reasons.append("RSI in healthy momentum zone")
        if self.technical.mfi < 80 and self.technical.mfi > 20:
            bull_score += 1
            bull_reasons.append("MFI not in overbought territory")
        if self.technical.macd_histogram > 0:
            bull_score += 1
            bull_reasons.append("MACD histogram positive (momentum building)")
        if "Positive" in self.sentiment_report or "Bullish" in self.news_report:
            bull_score += 1
            bull_reasons.append("Positive sentiment indicators")
        if "Healthy" in self.fundamentals_report or "Bullish" in self.fundamentals_report:
            bull_score += 1
            bull_reasons.append("Strong fundamental metrics")
        
        # Bear Researcher perspective
        bear_score = 0
        bear_reasons = []
        
        if self.technical.price < self.technical.sma_50:
            bear_score += 2
            bear_reasons.append("Price below 50-day MA")
        if self.technical.price < self.technical.sma_200:
            bear_score += 1
            bear_reasons.append("Price below 200-day MA (long-term downtrend)")
        if self.technical.rsi > 70:
            bear_score += 1
            bear_reasons.append("RSI overbought")
        if self.technical.rsi < 30:
            bear_score += 1
            bear_reasons.append("RSI oversold (potential reversal)")
        if self.technical.mfi > 80:
            bear_score += 1
            bear_reasons.append("MFI overbought")
        if "Negative" in self.sentiment_report or "Bearish" in self.news_report:
            bear_score += 1
            bear_reasons.append("Negative sentiment indicators")
        if "Concern" in self.fundamentals_report or "Bearish" in self.fundamentals_report:
            bear_score += 1
            bear_reasons.append("Concerning fundamental metrics")
        
        # Record debate history
        self.bull_history = f"""Bull Case:
- Score: {bull_score}
- Key Points:\n""" + "\n".join([f"  • {r}" for r in bull_reasons])
        
        self.bear_history = f"""Bear Case:
- Score: {bear_score}
- Key Points:\n""" + "\n".join([f"  • {r}" for r in bear_reasons])
        
        # Research Manager decision (使用 deep_thinking_llm)
        # 在真实实现中，这里应该调用 deep_thinking_llm 来做决策
        if bull_score > bear_score + 2:
            rec = Recommendation.BUY
        elif bear_score > bull_score + 2:
            rec = Recommendation.SELL
        else:
            rec = Recommendation.HOLD
        
        # 构建投资计划
        bull_points_str = "\n".join([f"- {r}" for r in bull_reasons])
        bear_points_str = "\n".join([f"- {r}" for r in bear_reasons])
        
        self.investment_plan = f"""
Research Manager Decision (Deep Thinking): {rec.value}

**Model Configuration**: Using deep_thinking_llm for critical investment decisions

Past Lessons Learned:
{past_memory_str}

Bull Case Summary:
{self.bull_history}

Bear Case Summary:
{self.bear_history}

Key Bull Points:
{bull_points_str}

Key Bear Points:
{bear_points_str}

**Final Recommendation: {rec.value}**
"""
        return self.investment_plan
    
    def run_trader(self) -> str:
        """Trading Strategy Development."""
        self._log("Trader", "Developing trading strategy...")
        
        atr = self.technical.atr
        price = self.technical.price
        
        self.stop_loss = price - (atr * 2)
        self.take_profit = price + (atr * 4)
        
        self.trader_plan = f"""
Trading Strategy for {self.ticker}:

Entry: ${price:.2f}
Stop Loss: ${self.stop_loss:.2f} ({((price - self.stop_loss) / price * 100):.1f}% risk)
Take Profit: ${self.take_profit:.2f} ({((self.take_profit - price) / price * 100):.1f}% potential)
Risk/Reward: {((self.take_profit - price) / (price - self.stop_loss)):.1f}:1
"""
        return self.trader_plan
    
    def run_risk_management(self) -> str:
        """Risk Management Debate with Three Perspectives.
        
        Uses deep_thinking_llm for Risk Judge final decision.
        Simulates debate between Risky, Safe, and Neutral analysts.
        """
        self._log("Risk Management", "Evaluating risk perspectives with three analyst views...")
        
        # 获取历史记忆
        curr_situation = f"Investment Plan: {self.investment_plan[:200]}..."
        past_memories = self.risk_manager_memory.get_memories(curr_situation, n_matches=2)
        past_memory_str = "\n".join([
            f"- {m['recommendation']}: {m['outcome']}"
            for m in past_memories
        ]) if past_memories else "No prior risk assessments."
        
        # Calculate risk metrics
        volatility = self.technical.atr / self.technical.price * 100 if self.technical.price > 0 else 0
        rsi_level = self.technical.rsi
        
        # Risky Analyst perspective
        risky_position_pct = 15.0
        risky_stop_loss_pct = 2.5 * volatility
        risky_args = []
        
        if self.technical.macd_histogram > 0:
            risky_args.append("Strong momentum confirmed by MACD histogram")
        if "Bullish" in self.investment_plan:
            risky_args.append("Investment thesis is bullish")
            risky_position_pct = min(20.0, risky_position_pct + 5.0)
        if volatility < 3:
            risky_args.append("Low volatility environment favors larger positions")
            risky_position_pct = min(25.0, risky_position_pct + 5.0)
        
        risky_args_str = "\n".join([f"  • {a}" for a in risky_args]) if risky_args else "  No specific arguments"
        
        self.risk_views["risky"] = f"""**Risky Analyst View:**
- Recommended Position Size: {risky_position_pct:.1f}%
- Stop Loss: {risky_stop_loss_pct:.1f}% below entry
- Key Arguments:
{risky_args_str}
"""
        
        # Safe Analyst perspective
        safe_position_pct = 5.0
        safe_stop_loss_pct = 3.0 * volatility
        safe_args = []
        
        if rsi_level > 70:
            safe_args.append("RSI overbought - risk of reversal")
            safe_position_pct = max(2.5, safe_position_pct - 2.5)
        if rsi_level < 30:
            safe_args.append("RSI oversold - unclear bottom yet")
            safe_position_pct = max(2.5, safe_position_pct - 2.5)
        if volatility > 5:
            safe_args.append("High volatility warrants smaller position")
            safe_position_pct = max(2.5, safe_position_pct - 2.5)
        if "HOLD" in self.investment_plan:
            safe_args.append("Unclear direction - stay conservative")
            safe_position_pct = max(2.5, safe_position_pct - 2.5)
        
        safe_args_str = "\n".join([f"  • {a}" for a in safe_args]) if safe_args else "  No specific arguments"
        
        self.risk_views["safe"] = f"""**Safe Analyst View:**
- Recommended Position Size: {safe_position_pct:.1f}%
- Stop Loss: {safe_stop_loss_pct:.1f}% below entry
- Key Arguments:
{safe_args_str}
"""
        
        # Neutral Analyst perspective
        neutral_position_pct = 10.0
        neutral_stop_loss_pct = 2.0 * volatility
        neutral_args = []
        
        neutral_args.append("Balanced approach: moderate position size")
        neutral_args.append(f"Volatility: {volatility:.1f}% - within normal range")
        neutral_args.append("Risk/Reward ratio should guide entry timing")
        
        neutral_args_str = "\n".join([f"  • {a}" for a in neutral_args])
        
        self.risk_views["neutral"] = f"""**Neutral Analyst View:**
- Recommended Position Size: {neutral_position_pct:.1f}%
- Stop Loss: {neutral_stop_loss_pct:.1f}% below entry
- Key Arguments:
{neutral_args_str}
"""
        
        # Risk Judge decision (使用 deep_thinking_llm)
        # 在真实实现中，这里应该调用 deep_thinking_llm 来做决策
        if "BUY" in self.investment_plan and rsi_level < 70 and volatility < 5:
            final_position = risky_position_pct
            risk_level = "Moderate-High"
        elif "SELL" in self.investment_plan:
            final_position = safe_position_pct
            risk_level = "Low"
        else:
            final_position = neutral_position_pct
            risk_level = "Moderate"
        
        risk_judgment = f"""**Risk Judge Decision (Deep Thinking):**

**Model Configuration**: Using deep_thinking_llm for final risk assessment

Risk Assessment Summary:
- Current Volatility (ATR): {volatility:.1f}%
- RSI Level: {rsi_level:.1f}
- Recommended Position Size: {final_position:.1f}%
- Overall Risk Level: {risk_level}

Past Risk Assessments:
{past_memory_str}

**Three Analyst Consensus:**
- Risky: {risky_position_pct:.1f}%
- Safe: {safe_position_pct:.1f}%
- Neutral: {neutral_position_pct:.1f}%

**Final Position Size: {final_position:.1f}%**
"""
        return risk_judgment
    
    def generate_final_decision(self) -> TradingDecision:
        """Generate final trading decision with risk-adjusted parameters."""
        self._log("Signal Processor", "Generating final decision...")
        
        # Synthesize all analysis
        if "BUY" in self.investment_plan:
            rec = Recommendation.BUY
        elif "SELL" in self.investment_plan:
            rec = Recommendation.SELL
        else:
            rec = Recommendation.HOLD
        
        # Calculate position size from risk management
        volatility = self.technical.atr / self.technical.price * 100 if self.technical.price > 0 else 2.0
        
        if "BUY" in self.investment_plan and self.technical.rsi < 70 and volatility < 5:
            position_size = 15.0
        elif "SELL" in self.investment_plan:
            position_size = 5.0
        else:
            position_size = 10.0
        
        # Risk/Reward ratio
        risk_amount = self.technical.price * (volatility / 100) * 2
        reward_amount = risk_amount * 2  # 2:1 ratio
        
        self.final_decision = TradingDecision(
            recommendation=rec,
            entry_price=self.technical.price,
            stop_loss=self.technical.price - risk_amount,
            take_profit=self.technical.price + reward_amount,
            position_size_pct=position_size,
            risk_reward_ratio=2.0,
            time_horizon="4-6 weeks"
        )
        
        return self.final_decision
    
    # =========================================================================
    # MAIN EXECUTION
    # =========================================================================
    
    def run_full_analysis(self) -> str:
        """Execute complete trading decision framework."""
        # Ensure providers are initialized
        DataProviderRegistry._ensure_initialized()
        print(f"\n{'='*70}")
        print(f"  TRADING DECISION FRAMEWORK - {self.ticker}")
        print(f"{'='*70}")
        print(f"  Date: {self.trade_date}")
        print(f"  Data Providers: {list(DataProviderRegistry._providers.keys())}")
        print(f"{'='*70}")
        
        # Phase 1: Analyst Team
        print("\n[PHASE 1: ANALYST TEAM]")
        self.run_market_analyst()
        print("✓ Market Analyst")
        self.run_sentiment_analyst()
        print("✓ Social Analyst")
        self.run_news_analyst()
        print("✓ News Analyst")
        self.run_fundamentals_analyst()
        print("✓ Fundamentals Analyst")
        
        # Phase 2: Research Team
        print("\n[PHASE 2: RESEARCH TEAM]")
        self.run_research_debate()
        print("✓ Research Debate")
        
        # Phase 3: Trading Team
        print("\n[PHASE 3: TRADING TEAM]")
        self.run_trader()
        print("✓ Trading Strategy")
        
        # Phase 4: Risk Management
        print("\n[PHASE 4: RISK MANAGEMENT]")
        self.run_risk_management()
        print("✓ Risk Assessment")
        
        # Phase 5: Final Decision
        decision = self.generate_final_decision()
        print("\n" + "="*70)
        print(f"  FINAL DECISION: {decision.recommendation.value}")
        print("="*70)
        
        return self.format_report(decision)
    
    def format_report(self, decision: TradingDecision) -> str:
        """Format complete report."""
        return f"""
{'='*70}
TRADING DECISION REPORT - {self.ticker}
{'='*70}

ANALYSIS DATE: {self.trade_date}

{'='*70}
EXECUTIVE SUMMARY
{'='*70}

┌─────────────────────────────────────────────────────────────────────┐
│  FINAL RECOMMENDATION: {decision.recommendation.value:<40} │
├─────────────────────────────────────────────────────────────────────┤
│  Entry Price:      ${decision.entry_price:<46.2f} │
│  Stop Loss:        ${decision.stop_loss:<46.2f} │
│  Take Profit:      ${decision.take_profit:<46.2f} │
│  Position Size:    {decision.position_size_pct:>6.1f}%{' '*40} │
│  Risk/Reward:      {decision.risk_reward_ratio:>6.1f}:1{' '*40} │
│  Time Horizon:     {decision.time_horizon:<46} │
└─────────────────────────────────────────────────────────────────────┘

{'='*70}
DETAILED ANALYSIS
{'='*70}

{self.market_report}

{self.sentiment_report}

{self.news_report}

{self.fundamentals_report}

{'='*70}
INVESTMENT DECISION
{'='*70}

{self.investment_plan}

{self.trader_plan}

{'='*70}
RISK ASSESSMENT
{'='*70}

**Risky Perspective**: {self.risk_views['risky']}
**Safe Perspective**: {self.risk_views['safe']}
**Neutral Perspective**: {self.risk_views['neutral']}

{'='*70}
DISCLAIMER
{'='*70}
This analysis is for informational purposes only.
Past performance is not indicative of future results.
"""


# =============================================================================
# CUSTOM DATA PROVIDER EXAMPLE
# =============================================================================

def example_custom_provider():
    """
    Example of how to register custom data providers.
    
    To use your own data source:
    1. Implement the provider interface
    2. Register with DataProviderRegistry.configure()
    3. Use the framework normally
    """
    
    # Example: Custom stock provider
    class MyStockProvider:
        def get_ohlcv(self, ticker, start_date, end_date):
            # Implement your data fetching logic
            # e.g., from database, API, file, etc.
            pass
        
        def get_indicators(self, ticker, indicator_names, current_date, lookback_days):
            # Calculate and return indicators
            pass
    
    # Register custom providers
    DataProviderRegistry.configure(
        stock=MyStockProvider(),
        # sentiment=...,
        # news=...,
        # fundamentals=...
    )


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Trading Decision Framework with Pluggable Data Providers"
    )
    
    parser.add_argument("ticker", help="Stock ticker symbol (e.g., AAPL)")
    parser.add_argument("--date", "-d", help="Trade date (YYYY-MM-DD)", default=None)
    parser.add_argument("--output", "-o", help="Output file path", default=None)
    parser.add_argument("--debate-rounds", type=int, default=1)
    parser.add_argument("--risk-rounds", type=int, default=1)
    parser.add_argument("--debug", action="store_true")
    
    args = parser.parse_args()
    
    framework = TradingDecisionFramework(
        ticker=args.ticker,
        trade_date=args.date,
        max_debate_rounds=args.debate_rounds,
        max_risk_discuss_rounds=args.risk_rounds,
        debug=args.debug
    )
    
    result = framework.run_full_analysis()
    
    if args.output:
        with open(args.output, 'w') as f:
            f.write(result)
        print(f"\n✓ Results saved to: {args.output}")
    else:
        print(result)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

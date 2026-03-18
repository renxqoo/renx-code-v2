# Data Interface Specification

This document defines the data interface abstraction layer for the trading decision framework. The framework is designed to be data-source agnostic - it defines what data is needed, not how to fetch it.

## Core Principles

1. **Data Agnostic**: Framework works with any data source
2. **Interface Based**: Uses abstract interfaces for data providers
3. **User Implemented**: Users provide concrete implementations based on their data sources
4. **Schema Defined**: Clear data schemas for each data type

## Required Interfaces

### 1. StockDataProvider

```python
from abc import ABC, abstractmethod
import pandas as pd
from typing import List, Dict

class StockDataProvider(ABC):
    """Required interface for stock price and technical data."""
    
    @abstractmethod
    def get_ohlcv(
        self,
        ticker: str,
        start_date: str,
        end_date: str
    ) -> pd.DataFrame:
        """
        Retrieve OHLCV (Open, High, Low, Close, Volume) data.
        
        Args:
            ticker: Stock ticker symbol (e.g., "AAPL", "GOOGL")
            start_date: Start date in "YYYY-MM-DD" format
            end_date: End date in "YYYY-MM-DD" format
            
        Returns:
            DataFrame with columns:
            - date: datetime
            - open: float
            - high: float
            - low: float
            - close: float
            - volume: int
            
        Example:
            >>> provider.get_ohlcv("AAPL", "2024-01-01", "2024-12-31")
                       date   open   high    low  close    volume
            0    2024-01-02  185.0  186.0  184.0  185.5  50000000
            1    2024-01-03  185.5  187.0  185.0  186.2  45000000
        """
        pass
    
    @abstractmethod
    def get_indicators(
        self,
        ticker: str,
        indicator_names: List[str],
        current_date: str,
        lookback_days: int = 30
    ) -> Dict[str, float]:
        """
        Calculate technical indicators for a ticker.
        
        Args:
            ticker: Stock ticker symbol
            indicator_names: List of indicator names to calculate
            current_date: Current trading date "YYYY-MM-DD"
            lookback_days: Number of days for calculation (default 30)
            
        Supported Indicators:
            - "sma_10": 10-day Simple Moving Average
            - "sma_50": 50-day Simple Moving Average
            - "sma_200": 200-day Simple Moving Average
            - "ema_10": 10-day Exponential Moving Average
            - "ema_20": 20-day Exponential Moving Average
            - "macd": MACD line (12 EMA - 26 EMA)
            - "macd_signal": MACD Signal line (9 EMA of MACD)
            - "macd_histogram": MACD Histogram
            - "rsi": Relative Strength Index (14-period default)
            - "boll_upper": Bollinger Upper Band
            - "boll_middle": Bollinger Middle Band (20 SMA)
            - "boll_lower": Bollinger Lower Band
            - "atr": Average True Range
            
        Returns:
            Dictionary mapping indicator names to values:
            {"rsi": 65.5, "macd": 2.3, "sma_50": 150.0, ...}
        """
        pass
```

### 2. SentimentDataProvider

```python
class SentimentDataProvider(ABC):
    """Required interface for social media sentiment data."""
    
    @abstractmethod
    def get_social_sentiment(
        self,
        ticker: str,
        start_date: str,
        end_date: str,
        platforms: List[str] = None
    ) -> List[Dict]:
        """
        Retrieve social media sentiment data.
        
        Args:
            ticker: Stock ticker symbol
            start_date: Start date "YYYY-MM-DD"
            end_date: End date "YYYY-MM-DD"
            platforms: List of platforms to include (optional)
            
        Returns:
            List of dictionaries:
            [
                {
                    "platform": "twitter",
                    "sentiment_score": 0.75,  # -1 to 1 scale
                    "content": "Post text content",
                    "author": "user_handle",
                    "date": "2024-01-15",
                    "likes": 150,
                    "shares": 45
                },
                ...
            ]
        """
        pass
    
    @abstractmethod
    def get_sentiment_aggregate(
        self,
        ticker: str,
        start_date: str,
        end_date: str
    ) -> Dict:
        """
        Get aggregated sentiment metrics.
        
        Returns:
            {
                "overall_sentiment": 0.65,  # -1 to 1
                "positive_pct": 0.70,
                "negative_pct": 0.15,
                "neutral_pct": 0.15,
                "volume": 5000,  # Number of posts
                "trend": "improving"  # improving/declining/stable
            }
        """
        pass
```

### 3. NewsDataProvider

```python
class NewsDataProvider(ABC):
    """Required interface for news data."""
    
    @abstractmethod
    def get_news(
        self,
        ticker: str,
        start_date: str,
        end_date: str,
        limit: int = 50
    ) -> List[Dict]:
        """
        Retrieve news articles related to ticker.
        
        Args:
            ticker: Stock ticker symbol
            start_date: Start date "YYYY-MM-DD"
            end_date: End date "YYYY-MM-DD"
            limit: Maximum number of articles
            
        Returns:
            List of dictionaries:
            [
                {
                    "headline": "Company announces new product",
                    "source": "Reuters",
                    "url": "https://...",
                    "date": "2024-01-15",
                    "sentiment": "positive",  # positive/negative/neutral
                    "sentiment_score": 0.8,
                    "summary": "Brief article summary..."
                },
                ...
            ]
        """
        pass
    
    @abstractmethod
    def get_global_news(
        self,
        current_date: str,
        lookback_days: int = 7,
        limit: int = 10
    ) -> List[Dict]:
        """
        Retrieve global macroeconomic news.
        
        Returns:
            List of dictionaries with same schema as get_news(),
            but without ticker filter (global events).
        """
        pass
    
    @abstractmethod
    def get_insider_transactions(
        self,
        ticker: str,
        start_date: str = None,
        end_date: str = None
    ) -> List[Dict]:
        """
        Retrieve insider trading transactions.
        
        Returns:
            [
                {
                    "insider_name": "John Doe",
                    "insider_title": "CEO",
                    "transaction_type": "BUY",  # BUY/SELL
                    "shares": 10000,
                    "price_per_share": 150.00,
                    "date": "2024-01-15",
                    "total_value": 1500000.00
                },
                ...
            ]
        """
        pass
```

### 4. FundamentalsDataProvider

```python
class FundamentalsDataProvider(ABC):
    """Required interface for fundamental financial data."""
    
    @abstractmethod
    def get_company_profile(self, ticker: str) -> Dict:
        """
        Get company basic information.
        
        Returns:
            {
                "company_name": "Apple Inc.",
                "industry": "Technology",
                "sector": "Consumer Electronics",
                "market_cap": 3000000000000,  # in USD
                "pe_ratio": 28.5,
                "eps": 6.13,
                "dividend_yield": 0.5,  # percentage
                "beta": 1.2,
                "week_52_high": 200.0,
                "week_52_low": 150.0
            }
        """
        pass
    
    @abstractmethod
    def get_income_statement(
        self,
        ticker: str,
        frequency: str = "quarterly"  # or "annual"
    ) -> List[Dict]:
        """
        Get income statement data.
        
        Returns:
            [
                {
                    "period": "2024-Q1",
                    "date": "2024-03-31",
                    "revenue": 119600000000,
                    "cost_of_revenue": 67000000000,
                    "gross_profit": 52600000000,
                    "operating_expenses": 20000000000,
                    "operating_income": 32600000000,
                    "net_income": 23600000000,
                    "eps": 1.53
                },
                ...
            ]
        """
        pass
    
    @abstractmethod
    def get_balance_sheet(
        self,
        ticker: str,
        frequency: str = "quarterly"
    ) -> List[Dict]:
        """
        Get balance sheet data.
        
        Returns:
            [
                {
                    "period": "2024-Q1",
                    "date": "2024-03-31",
                    "total_assets": 350000000000,
                    "current_assets": 150000000000,
                    "cash_and_equivalents": 70000000000,
                    "total_liabilities": 250000000000,
                    "current_liabilities": 100000000000,
                    "total_debt": 120000000000,
                    "total_equity": 100000000000
                },
                ...
            ]
        """
        pass
    
    @abstractmethod
    def get_cashflow(
        self,
        ticker: str,
        frequency: str = "quarterly"
    ) -> List[Dict]:
        """
        Get cash flow statement data.
        
        Returns:
            [
                {
                    "period": "2024-Q1",
                    "date": "2024-03-31",
                    "operating_cashflow": 30000000000,
                    "capital_expenditures": -5000000000,
                    "free_cashflow": 25000000000,
                    "dividends_paid": -3000000000,
                    "share_repurchase": -10000000000,
                    "debt_issued": 0,
                    "debt_repaid": -2000000000
                },
                ...
            ]
        """
        pass
```

## Implementation Example

```python
# Example: Implementing with Yahoo Finance

import yfinance as yf
import pandas as pd
from typing import List, Dict

class YahooFinanceStockProvider(StockDataProvider):
    """Yahoo Finance implementation of StockDataProvider."""
    
    def get_ohlcv(self, ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
        stock = yf.Ticker(ticker)
        df = stock.history(start=start_date, end=end_date)
        df = df.reset_index()
        df.columns = [c.lower() if c != 'Date' else 'date' for c in df.columns]
        return df
    
    def get_indicators(self, ticker: str, indicator_names: List[str], 
                       current_date: str, lookback_days: int = 30) -> Dict[str, float]:
        # Implementation using yfinance or technical analysis library
        # ...
        return {}


class TwitterAPISentimentProvider(SentimentDataProvider):
    """Twitter API implementation."""
    
    def get_social_sentiment(self, ticker: str, start_date: str, 
                            end_date: str, platforms: List[str] = None) -> List[Dict]:
        # Implementation using Twitter API
        # ...
        return []
    
    def get_sentiment_aggregate(self, ticker: str, start_date: str, 
                                end_date: str) -> Dict:
        # Implementation
        return {}


# Register providers
DATA_PROVIDERS = {
    "stock": YahooFinanceStockProvider(),
    "sentiment": TwitterAPISentimentProvider(api_key="xxx"),
    # ... other providers
}
```

## Data Schema Summary

| Provider | Method | Return Type |
|----------|--------|-------------|
| Stock | get_ohlcv() | DataFrame |
| Stock | get_indicators() | Dict |
| Sentiment | get_social_sentiment() | List[Dict] |
| Sentiment | get_sentiment_aggregate() | Dict |
| News | get_news() | List[Dict] |
| News | get_global_news() | List[Dict] |
| News | get_insider_transactions() | List[Dict] |
| Fundamentals | get_company_profile() | Dict |
| Fundamentals | get_income_statement() | List[Dict] |
| Fundamentals | get_balance_sheet() | List[Dict] |
| Fundamentals | get_cashflow() | List[Dict] |

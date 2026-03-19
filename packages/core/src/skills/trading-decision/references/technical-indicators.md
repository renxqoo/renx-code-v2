# Technical Indicators Reference

Complete reference for all technical indicators used in the trading decision framework.

## Moving Averages

### close_10_ema (10-day EMA)
- **Definition**: 10-day Exponential Moving Average
- **Formula**: EMA with 10-period lookback
- **Usage**: Capture quick shifts in momentum and potential entry points
- **Signals**:
  - Price above 10 EMA → Short-term bullish
  - Price below 10 EMA → Short-term bearish
- **Tips**: Prone to noise in choppy markets; use alongside longer averages

### close_50_sma (50-day SMA)
- **Definition**: 50-day Simple Moving Average
- **Usage**: Medium-term trend identification, dynamic support/resistance
- **Signals**:
  - Golden cross: 50 SMA crosses above 200 SMA → Bullish
  - Death cross: 50 SMA crosses below 200 SMA → Bearish
- **Tips**: It lags price; combine with faster indicators for timely signals

### close_200_sma (200-day SMA)
- **Definition**: 200-day Simple Moving Average
- **Usage**: Long-term trend benchmark, strategic entry/exit
- **Signals**:
  - Price above 200 SMA → Long-term bullish
  - Price below 200 SMA → Long-term bearish
- **Tips**: Best for strategic positions, not frequent trading entries

## MACD Family

### macd
- **Definition**: MACD Line = 12 EMA - 26 EMA
- **Usage**: Momentum indicator, trend change detection
- **Signals**:
  - MACD crosses above 0 → Bullish
  - MACD crosses below 0 → Bearish
  - MACD > Signal → Bullish momentum
  - MACD < Signal → Bearish momentum
- **Tips**: Confirm with other indicators in low-volatility markets

### macds (MACD Signal)
- **Definition**: 9-day EMA of MACD line
- **Usage**: Generate trade signals when crossing MACD line
- **Signals**:
  - MACD crosses above Signal → BUY signal
  - MACD crosses below Signal → SELL signal
- **Tips**: Part of broader strategy to avoid false positives

### macdh (MACD Histogram)
- **Definition**: MACD Line - Signal Line
- **Usage**: Visualize momentum strength, early divergence detection
- **Signals**:
  - Positive histogram → Bullish momentum
  - Negative histogram → Bearish momentum
  - Histogram expanding → Momentum increasing
  - Histogram contracting → Momentum decreasing
- **Tips**: Can be volatile; complement with additional filters

## Momentum Indicators

### rsi (Relative Strength Index)
- **Definition**: RSI = 100 - (100 / (1 + RS)), where RS = avg gain / avg loss
- **Default Period**: 14
- **Range**: 0-100
- **Signals**:
  - RSI > 70 → Overbought (potential reversal or continuation)
  - RSI < 30 → Oversold (potential reversal or continuation)
  - RSI > 50 → Short-term bullish
  - RSI < 50 → Short-term bearish
  - Bullish divergence: Price lower, RSI higher
  - Bearish divergence: Price higher, RSI lower
- **Tips**: In strong trends, RSI may remain extreme; always cross-check with trend analysis
- **Common Values**: 14, 21, 28 periods
- **Avoid**: Do not use with stochrsi (redundant)

## Volatility Indicators

### boll (Bollinger Middle Band)
- **Definition**: 20-period SMA (middle band)
- **Usage**: Dynamic benchmark for price movement
- **Tips**: Combine with upper and lower bands

### boll_ub (Bollinger Upper Band)
- **Definition**: Middle band + 2 standard deviations
- **Usage**: Overbought zones, breakout resistance
- **Signals**:
  - Price touches upper band → Potential resistance
  - Price breaks above upper band → Strong bullish breakout
- **Tips**: Prices may ride the band in strong trends

### boll_lb (Bollinger Lower Band)
- **Definition**: Middle band - 2 standard deviations
- **Usage**: Oversold zones, breakout support
- **Signals**:
  - Price touches lower band → Potential support
  - Price breaks below lower band → Strong bearish breakdown
- **Tips**: Use additional analysis to avoid false reversal signals

### atr (Average True Range)
- **Definition**: Average of True Range over period
- **Usage**: Measure volatility, set stop-loss levels
- **Signals**:
  - High ATR → High volatility (wider stops needed)
  - Low ATR → Low volatility (tighter stops possible)
- **Tips**: Reactive measure; use for position sizing and risk management
- **Stop-loss Calculation**: Entry Price - (1.5 to 2 × ATR)

## Volume Indicators

### vwma (Volume-Weighted Moving Average)
- **Definition**: Moving average weighted by volume
- **Formula**: Sum(Price × Volume) / Sum(Volume)
- **Usage**: Confirm trends by integrating price action with volume
- **Signals**:
  - Price above VWMA → Bullish
  - Price below VWMA → Bearish
- **Tips**: Watch for skewed results from volume spikes

## Indicator Selection Strategy

### Trending Markets (Strong Direction)
**Recommended**: Moving Averages, MACD, VWMA
**Avoid**: RSI (may stay overbought/oversold for extended periods)

### Volatile/Ranging Markets
**Recommended**: Bollinger Bands, RSI, ATR
**Look for**: Mean reversion signals

### Momentum Plays
**Recommended**: RSI, MACD, MACD Histogram
**Look for**: Divergence from price

### Breakout Trading
**Recommended**: Bollinger Bands, ATR, Volume
**Look for**: Volatility expansion, volume confirmation

### Risk Management
**Always include**: ATR for position sizing and stop-loss
**Use with**: Volume confirmation (VWMA)

## Signal Interpretation Matrix

| Indicator | BUY Signal | SELL Signal | HOLD Signal |
|----------|-----------|-------------|-------------|
| Price vs 50 SMA | Above, rising | Below, falling | Crossing |
| Price vs 200 SMA | Above | Below | Crossing |
| MACD | Above Signal, rising | Below Signal, falling | Flat |
| RSI | Below 30, turning up | Above 70, turning down | Between 40-60 |
| Bollinger Bands | Touch lower, bounce | Touch upper, reverse | Middle band |
| VWMA | Above VWMA | Below VWMA | Crossing |
| ATR | Low (before breakout) | High (exhaustion) | Stable |

## Custom Indicator Combinations

### Conservative (Low Risk)
- 200 SMA (trend) + RSI (momentum) + ATR (volatility)
- Focus on major trend confirmation

### Moderate (Balanced)
- 50 SMA + MACD + Bollinger Bands
- Balance between trend and momentum

### Aggressive (High Risk)
- 10 EMA + RSI + MACD Histogram
- Fast signals, higher false positive rate

### Technical Setup Examples

**Golden Cross Confirmation**:
1. 50 SMA crosses above 200 SMA
2. Price above both moving averages
3. MACD above signal line
4. RSI above 50

**Death Cross Confirmation**:
1. 50 SMA crosses below 200 SMA
2. Price below both moving averages
3. MACD below signal line
4. RSI below 50

**Bollinger Band Squeeze**:
1. Bollinger bands narrow (low volatility)
2. ATR at low levels
3. Watch for expansion (breakout imminent)
4. Volume confirmation on breakout

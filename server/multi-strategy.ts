// Multi-Strategy Trading System - Complementary strategies alongside AI-driven SCALP/SWING
// Strategy 1: Mean Reversion - Buy oversold (RSI < 30), sell overbought (RSI > 70)
// Strategy 2: Momentum Breakout - Catch explosive price + volume moves early
// Strategy 3: Grid Trading - Multiple entry/exit levels for ranging markets

import type { TokenMarketData } from "./grok-analysis";

export interface StrategySignal {
  strategy: "MEAN_REVERSION" | "MOMENTUM_BREAKOUT" | "GRID_TRADING";
  action: "BUY" | "SELL" | "HOLD";
  confidence: number; // 0-100
  reasoning: string;
  positionSizePercent: number; // % of portfolio
  profitTarget: number; // % profit target
  stopLoss: number; // % stop loss
}

export interface StrategyConfig {
  // Mean Reversion
  meanReversionEnabled: boolean;
  meanReversionRSIOversold: number;
  meanReversionRSIOverbought: number;
  meanReversionPositionSizePercent: number;
  meanReversionProfitTargetPercent: number;
  meanReversionStopLossPercent: number;
  
  // Momentum Breakout
  momentumBreakoutEnabled: boolean;
  momentumBreakoutPriceChangePercent: number;
  momentumBreakoutVolumeMultiplier: number;
  momentumBreakoutPositionSizePercent: number;
  momentumBreakoutProfitTargetPercent: number;
  momentumBreakoutStopLossPercent: number;
  
  // Grid Trading
  gridTradingEnabled: boolean;
  gridTradingLevels: number;
  gridTradingPriceGapPercent: number;
  gridTradingPerLevelSizePercent: number;
}

/**
 * Strategy 1: Mean Reversion
 * Buy when RSI is oversold (<30), sell when overbought (>70)
 * Works well for volatile tokens that bounce back from extremes
 */
export function evaluateMeanReversion(
  token: TokenMarketData,
  config: StrategyConfig,
  currentPosition?: any
): StrategySignal | null {
  if (!config.meanReversionEnabled) return null;
  
  const rsi = token.rsi ?? 50; // Default to neutral if RSI not available
  
  // BUY Signal: RSI is oversold
  if (rsi < config.meanReversionRSIOversold && !currentPosition) {
    const oversoldSeverity = (config.meanReversionRSIOversold - rsi) / config.meanReversionRSIOversold;
    const confidence = Math.min(95, 60 + (oversoldSeverity * 35)); // 60-95% confidence based on how oversold
    
    return {
      strategy: "MEAN_REVERSION",
      action: "BUY",
      confidence,
      reasoning: `RSI ${rsi.toFixed(1)} is oversold (< ${config.meanReversionRSIOversold}) - expecting bounce`,
      positionSizePercent: config.meanReversionPositionSizePercent,
      profitTarget: config.meanReversionProfitTargetPercent,
      stopLoss: config.meanReversionStopLossPercent,
    };
  }
  
  // SELL Signal: RSI is overbought (and we have a position)
  if (rsi > config.meanReversionRSIOverbought && currentPosition) {
    const overboughtSeverity = (rsi - config.meanReversionRSIOverbought) / (100 - config.meanReversionRSIOverbought);
    const confidence = Math.min(95, 65 + (overboughtSeverity * 30)); // 65-95% confidence
    
    return {
      strategy: "MEAN_REVERSION",
      action: "SELL",
      confidence,
      reasoning: `RSI ${rsi.toFixed(1)} is overbought (> ${config.meanReversionRSIOverbought}) - taking profit`,
      positionSizePercent: 100, // Sell entire position
      profitTarget: 0,
      stopLoss: 0,
    };
  }
  
  return null; // No signal
}

/**
 * Strategy 2: Momentum Breakout
 * Detect explosive price + volume moves early
 * Catches pumps before they become obvious
 */
export function evaluateMomentumBreakout(
  token: TokenMarketData,
  config: StrategyConfig,
  currentPosition?: any
): StrategySignal | null {
  if (!config.momentumBreakoutEnabled) return null;
  
  const priceChange1h = token.priceChange1h ?? 0;
  const volume24h = token.volume24h ?? 0;
  const priceChange24h = token.priceChange24h ?? 0;
  
  // Calculate volume threshold based on config multiplier
  // Base volume: $50k, then scale by multiplier (default 2.0x)
  const baseVolume = 50000; // $50k baseline
  const volumeThreshold = baseVolume * config.momentumBreakoutVolumeMultiplier;
  const volumeIsHigh = volume24h >= volumeThreshold;
  
  // BUY Signal: Strong 1h price movement + good volume
  if (
    priceChange1h >= config.momentumBreakoutPriceChangePercent &&
    volumeIsHigh &&
    !currentPosition
  ) {
    // Confidence based on strength of move
    const momentumStrength = priceChange1h / config.momentumBreakoutPriceChangePercent;
    const confidence = Math.min(95, 70 + (momentumStrength * 15)); // 70-95% confidence
    
    return {
      strategy: "MOMENTUM_BREAKOUT",
      action: "BUY",
      confidence,
      reasoning: `Strong momentum: +${priceChange1h.toFixed(1)}% in 1h with $${(volume24h / 1000).toFixed(1)}k volume`,
      positionSizePercent: config.momentumBreakoutPositionSizePercent,
      profitTarget: config.momentumBreakoutProfitTargetPercent,
      stopLoss: config.momentumBreakoutStopLossPercent,
    };
  }
  
  // SELL Signal: Momentum fading (price dropping or stalling)
  if (currentPosition && currentPosition.strategyType === "MOMENTUM_BREAKOUT") {
    // If momentum is reversing (1h price change is negative), exit
    if (priceChange1h < -5) {
      return {
        strategy: "MOMENTUM_BREAKOUT",
        action: "SELL",
        confidence: 85,
        reasoning: `Momentum reversed: ${priceChange1h.toFixed(1)}% in 1h - exiting before loss`,
        positionSizePercent: 100,
        profitTarget: 0,
        stopLoss: 0,
      };
    }
  }
  
  return null; // No signal
}

/**
 * Strategy 3: Grid Trading
 * Place multiple orders at intervals for ranging markets
 * Good for sideways price action, reduces timing risk
 * 
 * Note: For PumpFun's volatile tokens, this is adapted to work with
 * price zones rather than static grid levels
 */
export function evaluateGridTrading(
  token: TokenMarketData,
  config: StrategyConfig,
  currentPosition?: any,
  currentPrice?: number
): StrategySignal | null {
  if (!config.gridTradingEnabled) return null;
  
  // Grid trading works by defining price zones
  // For BUY: We want to buy when price drops into lower zones
  // For SELL: We want to sell when price rises into upper zones
  
  const priceChange1h = token.priceChange1h ?? 0;
  const priceChange24h = token.priceChange24h ?? 0;
  
  // Grid strategy is best for ranging (not trending) markets
  // Detect ranging: low volatility in both 1h and 24h
  const isRanging = Math.abs(priceChange1h) < 5 && Math.abs(priceChange24h) < 15;
  
  if (!isRanging) {
    return null; // Grid trading not suitable for trending markets
  }
  
  // BUY Signal: Price in lower grid zone (recent dip in ranging market)
  if (priceChange1h < -2 && priceChange1h > -8 && !currentPosition) {
    return {
      strategy: "GRID_TRADING",
      action: "BUY",
      confidence: 75, // Moderate confidence for grid trades
      reasoning: `Grid entry: Price dipped ${priceChange1h.toFixed(1)}% in ranging market`,
      positionSizePercent: config.gridTradingPerLevelSizePercent,
      profitTarget: config.gridTradingPriceGapPercent, // Small profit target
      stopLoss: config.gridTradingPriceGapPercent * 1.5, // Slightly wider stop loss
    };
  }
  
  // SELL Signal: Price rose to upper grid zone
  if (currentPosition && currentPosition.strategyType === "GRID_TRADING") {
    const currentProfit = currentPosition.lastCheckProfitPercent ?? 0;
    
    // Take profit at grid level
    if (currentProfit >= config.gridTradingPriceGapPercent) {
      return {
        strategy: "GRID_TRADING",
        action: "SELL",
        confidence: 80,
        reasoning: `Grid exit: Hit ${config.gridTradingPriceGapPercent}% profit target`,
        positionSizePercent: 100,
        profitTarget: 0,
        stopLoss: 0,
      };
    }
  }
  
  return null; // No signal
}

/**
 * Evaluate all enabled strategies and return the best signal
 * Prioritizes based on confidence and strategy appropriateness
 */
export function evaluateAllStrategies(
  token: TokenMarketData,
  config: StrategyConfig,
  currentPosition?: any,
  currentPrice?: number
): StrategySignal | null {
  const signals: StrategySignal[] = [];
  
  // Evaluate each strategy
  const meanReversionSignal = evaluateMeanReversion(token, config, currentPosition);
  if (meanReversionSignal) signals.push(meanReversionSignal);
  
  const momentumSignal = evaluateMomentumBreakout(token, config, currentPosition);
  if (momentumSignal) signals.push(momentumSignal);
  
  const gridSignal = evaluateGridTrading(token, config, currentPosition, currentPrice);
  if (gridSignal) signals.push(gridSignal);
  
  // No signals
  if (signals.length === 0) return null;
  
  // If we have a position, prioritize SELL signals
  if (currentPosition) {
    const sellSignals = signals.filter(s => s.action === "SELL");
    if (sellSignals.length > 0) {
      // Return highest confidence sell signal
      return sellSignals.reduce((prev, current) => 
        current.confidence > prev.confidence ? current : prev
      );
    }
  }
  
  // For BUY signals, return highest confidence
  const buySignals = signals.filter(s => s.action === "BUY");
  if (buySignals.length > 0) {
    return buySignals.reduce((prev, current) => 
      current.confidence > prev.confidence ? current : prev
    );
  }
  
  return null;
}

/**
 * Check if a position should be sold based on strategy-specific rules
 * Called by position monitor for non-AI positions
 */
export function shouldSellPosition(
  position: any,
  currentPrice: number,
  token: TokenMarketData
): { shouldSell: boolean; reason?: string; confidence?: number } {
  const entryPrice = parseFloat(position.entryPriceSOL);
  const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  
  const profitTarget = position.strategyProfitTarget ? parseFloat(position.strategyProfitTarget) : null;
  const stopLoss = position.strategyStopLoss ? parseFloat(position.strategyStopLoss) : null;
  
  // Check profit target
  if (profitTarget && profitPercent >= profitTarget) {
    return {
      shouldSell: true,
      reason: `${position.strategyType} profit target hit: ${profitPercent.toFixed(2)}% >= ${profitTarget}%`,
      confidence: 90,
    };
  }
  
  // Check stop loss
  if (stopLoss && profitPercent <= -stopLoss) {
    return {
      shouldSell: true,
      reason: `${position.strategyType} stop loss hit: ${profitPercent.toFixed(2)}% <= -${stopLoss}%`,
      confidence: 95,
    };
  }
  
  // Strategy-specific sell logic
  if (position.strategyType === "MEAN_REVERSION") {
    // Mean reversion also sells on overbought RSI
    const rsi = token.rsi ?? 50;
    if (rsi > 70) {
      return {
        shouldSell: true,
        reason: `Mean reversion: RSI ${rsi.toFixed(1)} overbought (>70)`,
        confidence: 85,
      };
    }
  }
  
  if (position.strategyType === "MOMENTUM_BREAKOUT") {
    // Momentum breakout sells if momentum reverses
    const priceChange1h = token.priceChange1h ?? 0;
    if (priceChange1h < -5) {
      return {
        shouldSell: true,
        reason: `Momentum breakout: Momentum reversed ${priceChange1h.toFixed(1)}% in 1h`,
        confidence: 80,
      };
    }
  }
  
  return { shouldSell: false };
}

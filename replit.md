# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview
BurnBot is a SaaS platform providing a no-code solution for Solana SPL token creators to automate token buyback and burn operations. It features a dashboard, flexible scheduling, transaction monitoring, and an autonomous AI Trading Bot named GigaBrain. GigaBrain utilizes a 12-model AI hivemind to identify and trade trending tokens on Solana, focusing on profit potential, autonomous capital management, dynamic position sizing, and intelligent bundle activity detection to avoid pump-and-dump schemes. The platform aims to enhance tokenomics, offer robust trading tools, and operate as a profit-hunting machine with strong safety guardrails. It includes a subscription model with free trades, followed by a paid subscription and a platform fee, a portion of which is used for token buyback and burn.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is built with React 18+, TypeScript, Vite, Wouter for routing, shadcn/ui (New York variant) on Radix UI, and Tailwind CSS (dark mode). It uses TanStack Query for server state management and React Hook Form with Zod for validation. The GigaBrain AI interface features a "Black and Gold" theme, displaying 17 real-time trading metrics via WebSockets.

### Backend
The backend is an Express.js server in TypeScript, employing an ESM module system, a RESTful API, centralized error handling, Zod schema validation, a storage abstraction layer, and a repository pattern.

### Scheduling System
A `node-cron` service automates hourly checks for buyback execution, including payment validation, treasury balance verification, Jupiter Ultra API for swaps, and PumpFun creator reward claims, utilizing SPL Token instructions for burns.

### Trading Bot System

#### Project-Linked Bots
- **Volume Bot:** Configurable buy/sell cycles with settings for amounts, percentages, intervals, and price guards.
- **Buy Bot (Limit Orders):** Executes buy orders based on target SOL prices with configurable limits and slippage protection.

#### GigaBrain AI Trading Bot (Standalone)
**GigaBrain** operates autonomously with a 12-model AI hivemind, restricted to whitelisted wallets. Key features include:

- **Autonomous Capital Management:** Manages liquidity reserves, employs percentage-based position sizing, and uses AI-driven exits. It includes strict quality filters for token selection, portfolio diversification, optimized stop-loss protection, and a Portfolio Drawdown Circuit Breaker.
- **Token Discovery:** Aggregates tokens from various sources like DexScreener Trending and PumpFun, with expanded sources and faster refresh cycles.
- **Smart Hivemind AI Workflow with 4-Team Rotation:** Features position monitoring, quick and deep technical scans, and automatic portfolio rebalancing. The system uses a 4-team rotation with 3 AI models per team, each working 6-hour shifts for 24/7 coverage. It includes weighted voting for consensus decisions, auto-replacement of failing models, and a Recovery Mode for emergency cost reduction.
- **Intelligent Circuit Breaker Protection:** Disables and rotates failing AI models, prioritizing reliable ones based on health scoring.
- **Advanced AI Rate Limiting & Retry System:** Implements universal and provider-specific rate limiting, exponential backoff for retries, and a smart circuit breaker.
- **Tri-Mode Trading Strategy (SCALP, QUICK_2X, and SWING):** Each mode has specific confidence thresholds, profit targets, position sizing, stop-loss percentages, and enforced max hold times. Includes a 2-Stage Exit Filter to prevent premature panic-selling and a Smart Trailing Stop-Loss that uses peak price and never drops below entry.
- **Graduated Position Sizing:** Position size scales continuously with confidence.
- **Dynamic Tiered Stop-Loss (4 Tiers):** Locks in gains as positions become profitable.
- **Faster Portfolio Rebalancing:** 15-minute intervals for rapid capital recycling.
- **Enhanced Opportunistic Rotation:** Automatically swaps underperforming positions for better opportunities, even with available capital if a new opportunity has significantly higher confidence.
- **Advanced Technical Analysis:** Integrates RSI, EMA, and Bollinger Bands into buy/sell decisions.
- **Sell Decision Framework:** AI continuously monitors positions with dynamic exit criteria based on confidence, profit targets, technical signals, or max hold time.
- **Automatic Buyback & Burn Mechanism:** Configurable automatic buyback and immediate on-chain burning of tokens using a percentage of profits.
- **AI-Powered Loss Prevention System (PROFITABILITY-OPTIMIZED):** Multi-provider loss prediction with risk-adjusted position sizing. Blocks trades with >85% loss probability (was >95%). Hard-blocks tokens with unlocked liquidity (rug pull risk). For risky trades (40-85% loss probability): automatically reduces position size (25-50%) and tightens stop-losses (-1.5% to -2%) for protection.
- **Profit Maximization System:** Enforces minimum profit thresholds, smart exit logic, and a profit-hunting strategy.
- **Optimized Slippage Strategy:** Implements tiered slippage settings for BUY (3%), Normal SELL (5%), and Emergency Rotation SELL (8%).
- **Multi-Strategy Trading System:** Complementary strategies (Mean Reversion, Momentum Breakout, Grid Trading) run alongside AI-driven SCALP/SWING.
- **AI-Driven Trade Execution Filters (PROFITABILITY-OPTIMIZED):** Deep scans with tightened "buy low" filters:
  - Block tokens pumped >20% in 24h (was 30%)
  - Block tokens pumped >15% in 1h (new filter)
  - Block overbought tokens with RSI >60 (was warning only at >70)
  - Allow dip-buying on tokens down -20%+ (buy the dip strategy)
- **Conviction Hold & Accumulate:** AI can accumulate losing positions when high conviction (85%+) that fundamentals remain strong, with strict safety limits.
- **Fast Position Monitoring (PROFITABILITY-OPTIMIZED):** Position checks every 1 minute (was 3 minutes) for faster stop-loss execution, preventing late triggers at -27% instead of target -8%.
- **Quick Profit-Taking (PROFITABILITY-OPTIMIZED):** Automatic sell at +25% profit to lock gains before volatile low-cap tokens crash.

### Data Storage
Uses PostgreSQL via Neon's serverless driver and Drizzle ORM, with UUID primary keys, decimal types, and automatic timestamps.

### Authentication & Authorization
Wallet-based authentication using cryptographic signature verification via tweetnacl and Solana Wallet Adapter.

### Security Infrastructure
Employs defense-in-depth security measures including rate limiting, DDoS protection, security headers (Helmet.js), input validation, and audit logging.

### Production Readiness & Automated Workflow
Includes secure encrypted key management, automated PumpFun rewards claiming, balance checks, optimal SOL to token swaps via Jupiter Ultra API, token burns, and a payment/trial system with whitelisted wallets.

### Transaction Fee System
- **Project-Linked Bots:** 0.5% transaction fee after 60 free transactions.
- **AI Trading Bot:** 1% platform fee on all buy transactions (deducted pre-execution) to a treasury wallet, with an exempt wallet having 0% fees.

## External Dependencies

**Blockchain Integration:**
- Solana Web3.js
- SPL Token program
- @solana/wallet-adapter suite
- bs58
- tweetnacl

**Payment Processing:**
- Solana-native payments (SOL only) to treasury wallet.

**Third-Party Services:**
- Neon Database (PostgreSQL)
- Jupiter Ultra API (Swap API)
- Jupiter Price API v3
- Jupiter Token API v2 (Token Discovery)
- PumpFun Lightning API
- **AI Hive Mind Providers:**
    - DeepSeek V3
    - Cerebras AI
    - Google Gemini
    - ChatAnywhere
    - Groq
    - Anthropic Claude Sonnet 4
    - OpenAI Primary
    - OpenAI Backup
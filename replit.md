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

-   **Autonomous Capital Management:** Manages liquidity reserves, employs percentage-based position sizing, and uses AI-driven exits. It includes strict quality filters for token selection, portfolio diversification, optimized stop-loss protection, and a Portfolio Drawdown Circuit Breaker.
-   **Token Discovery:** Aggregates tokens from various sources like DexScreener Trending and PumpFun.
-   **Smart Hivemind AI Workflow with 4-Team Rotation:** Features position monitoring, quick and deep technical scans, and automatic portfolio rebalancing. The system uses a 4-team rotation with 3 AI models per team, each working 6-hour shifts for 24/7 coverage:
    -   **Team A (0-6 UTC):** DeepSeek (1.2x), OpenAI (1.3x), Cerebras (1.0x)
    -   **Team B (6-12 UTC):** DeepSeek #2 (1.2x), OpenAI #2 (1.3x), Google Gemini (1.0x)
    -   **Team C (12-18 UTC):** Anthropic Claude (1.2x), Together AI (1.1x), Groq (1.0x)
    -   **Team D (18-24 UTC):** OpenRouter (1.1x), ChatAnywhere (1.0x), xAI Grok (1.0x)
    -   **Auto-Replacement:** When a team member fails, the system automatically swaps in the healthiest inactive model
    -   **Weighted Voting:** Each AI model has a voting weight multiplier (OpenAI 1.3x, DeepSeek/Claude 1.2x, Together/OpenRouter 1.1x, others 1.0x) for consensus decisions
    -   **75% Cost Savings:** Only 3 models active at once (instead of 12), reducing API costs dramatically
-   **Intelligent Circuit Breaker Protection:** Disables and rotates failing AI models, prioritizing reliable ones based on health scoring.
-   **Advanced AI Rate Limiting & Retry System:** Implements universal and provider-specific rate limiting, exponential backoff for retries, and a smart circuit breaker to distinguish between rate limits and permanent failures.
-   **Tri-Mode Trading Strategy (PROFITABILITY OPTIMIZED - MAJOR UPDATE Oct 2025):** Supports SCALP, QUICK_2X, and SWING modes with significantly raised confidence thresholds, conservative position sizing, and positive R-multiples to fix 3% win rate:
    -   **SCALP Mode:** 70-77% confidence (RAISED +5pts), +3.5% profit target, 1-2% conservative position sizing (REDUCED from 3-5%), -3% stop-loss (POSITIVE R-multiple: 1.17 - risks LESS than it earns), 30-minute enforced max hold
    -   **QUICK_2X Mode:** 78-87% confidence (RAISED +8pts), +25% profit target (REALISTIC, down from 100%), 1-2% conservative position sizing (REDUCED from 2-4%), -8% stop-loss (IMPROVED R-multiple: 3.1), 60-minute enforced max hold
    -   **SWING Mode:** 88%+ confidence (RAISED +6pts from 82%), +15% profit target, 1-3% conservative position sizing (REDUCED from 5-9%), -7% to -10% stop-loss (IMPROVED R-multiple: 2.1)
    -   **Graduated Position Sizing:** Position size scales continuously with confidence instead of fixed tiers - maximizes capital allocation to highest-conviction trades
    -   **Dynamic Trailing Stop-Loss (4 Tiers):** Locks in gains as positions become profitable - Tier 1: +5% (protect at -2%), Tier 2: +10% (lock +2%), Tier 3: +20% (lock +10%), Tier 4: +50% (lock +30%)
    -   **Faster Portfolio Rebalancing:** 15-minute intervals (reduced from 30min) for rapid capital recycling and opportunity capture
    -   **Enhanced Opportunistic Rotation:** Automatically swaps underperforming positions for better opportunities - now includes "Smart Rotation" that considers swapping even with available capital if new opportunity is 10%+ better confidence
-   **Advanced Technical Analysis:** Integrates RSI, EMA, and Bollinger Bands into buy/sell decisions, generating a Technical Score.
-   **Sell Decision Framework:** AI continuously monitors positions with dynamic exit criteria based on confidence, profit targets, technical signals, or max hold time, including peak profit tracking and tiered profit protection.
-   **Opportunistic Position Rotation:** Automatically sells weaker positions to free up capital and maintain liquidity.
-   **Automatic Buyback & Burn Mechanism:** Configurable automatic buyback and immediate on-chain burning of tokens using a percentage of profits from successful trades.
-   **AI-Powered Loss Prevention System:** Includes a centralized trading guard, hardened technical fallback, multi-provider loss prediction for rug pull risks, enhanced supermajority consensus for trades, and a fail-closed architecture, blocking trades with high loss probability.
-   **Profit Maximization System:** Enforces minimum profit thresholds, smart exit logic, and a profit-hunting strategy with features like peak profit tracking, smart stop-loss, buy-the-dip detection, and AI override for smart exits when AI confidence is high.
-   **Optimized Slippage Strategy:** Implements tiered slippage settings for BUY (3%), Normal SELL (5%), and Emergency Rotation SELL (8%) operations to preserve profits.
-   **Multi-Strategy Trading System:** Complementary strategies (Mean Reversion, Momentum Breakout, Grid Trading) run alongside AI-driven SCALP/SWING, focusing on "Buy Low, Sell High" principles with configurable parameters for position sizing, profit targets, and stop losses.
-   **AI-Driven Trade Execution Filters:** Deep scans now include technical "buy low" filters (Bollinger Band proximity, 24h pump filter) before executing AI-driven buy trades, ensuring purchases at support levels and preventing FOMO buying at peaks.
-   **Conviction Hold & Accumulate:** AI position monitoring can now accumulate (buy more) of losing positions when the AI has very high conviction (85%+ confidence) that fundamentals remain strong despite the dip. Strict safety limits prevent over-averaging: maximum 2x original position size, maximum -15% drawdown, and requires RSI <30 (extreme oversold), EMA bullish trend intact, and price near Bollinger Band lower support. Accumulation buys 50% of original entry size, averaging down the entry price through dollar-cost averaging.

### Data Storage
Uses PostgreSQL via Neon's serverless driver and Drizzle ORM, with UUID primary keys, decimal types, and automatic timestamps.

### Authentication & Authorization
Wallet-based authentication using cryptographic signature verification via tweetnacl and Solana Wallet Adapter.

### Security Infrastructure
Employs defense-in-depth security measures including rate limiting, DDoS protection, security headers (Helmet.js), input validation (XSS, Solana address, Zod, SQL injection prevention), audit logging, and secure environment variable handling.

### Production Readiness & Automated Workflow
Includes secure encrypted key management, automated PumpFun rewards claiming, balance checks, optimal SOL to token swaps via Jupiter Ultra API, token burns, and a payment/trial system with whitelisted wallets.

### Transaction Fee System
-   **Project-Linked Bots:** 0.5% transaction fee after 60 free transactions.
-   **AI Trading Bot:** 1% platform fee on all buy transactions (deducted pre-execution) to a treasury wallet, with an exempt wallet having 0% fees.

## External Dependencies

**Blockchain Integration:**
-   Solana Web3.js
-   SPL Token program
-   @solana/wallet-adapter suite
-   bs58
-   tweetnacl

**Payment Processing:**
-   Solana-native payments (SOL only) to treasury wallet.

**Third-Party Services:**
-   Neon Database (PostgreSQL)
-   Jupiter Ultra API (Swap API)
-   Jupiter Price API v3
-   PumpFun Lightning API
-   DexScreener API
-   **AI Hive Mind Providers:**
    -   DeepSeek V3
    -   Cerebras AI
    -   Google Gemini
    -   ChatAnywhere
    -   Groq
    -   Anthropic Claude Sonnet 4
    -   OpenAI Primary
    -   OpenAI Backup
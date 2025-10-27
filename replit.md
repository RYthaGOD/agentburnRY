# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview
BurnBot is a SaaS platform providing a no-code solution for Solana SPL token creators to automate token buyback and burn operations. It offers a dashboard, flexible scheduling, and transaction monitoring to enhance tokenomics. The platform also includes a Volume Bot, a Buy Bot, and the **GigaBrain** AI Trading Bot. GigaBrain is an autonomous AI trading bot that uses an 11-model AI hivemind to identify and trade trending tokens on Solana, focusing on profit potential, autonomous capital management, dynamic position sizing, and intelligent bundle activity detection to avoid pump-and-dump schemes. The platform aims to convert users through transparency, real-time stats, and a free token analysis tool, leading to a subscription model with 20 free trades, followed by a 2-week subscription and a 1% platform fee, with a portion of subscription payments used for token buyback and burn. The system is designed as a profit-hunting machine with robust safety guardrails.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
Built with React 18+, TypeScript, Vite, Wouter for routing, shadcn/ui (New York variant) on Radix UI, and Tailwind CSS for dark mode. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The GigaBrain AI interface uses a "Black and Gold" theme. Real-time performance monitoring is implemented via WebSockets, broadcasting 17 trading metrics.

### Backend
An Express.js server in TypeScript, utilizing an ESM module system, a RESTful API, centralized error handling, Zod schema validation, a storage abstraction layer, and a repository pattern for database operations.

### Scheduling System
A dedicated `node-cron` service automates hourly checks for buyback execution, including payment validation, treasury balance verification, Jupiter Ultra API for swaps, and PumpFun creator reward claims. SPL Token instructions are used for token burns.

### Trading Bot System

#### Project-Linked Bots
- **Volume Bot:** Configurable buy/sell cycles with settings for amounts, percentages, intervals, and price guards.
- **Buy Bot (Limit Orders):** Executes buy orders based on target SOL prices with configurable limits and slippage protection.

#### GigaBrain AI Trading Bot (Standalone)
**GigaBrain** operates autonomously with an 11-model AI hivemind system, restricted to whitelisted wallets.

**Autonomous Capital Management:**
- Maintains 10% liquidity reserve, percentage-based position sizing (3-6% SCALP, 5-9% SWING), and AI-driven exits with 75%+ AI confidence.
- Strict quality filters for token selection (e.g., 80%+ organic score, $25k+ volume).
- Portfolio diversification (max 25% concentration per position) and optimized stop-loss protection (-8% to -12% SCALP, -15% to -25% SWING).
- Portfolio Drawdown Circuit Breaker pauses trading if portfolio drops >20% from peak and auto-resumes at -10% recovery.
- AI sell confidence exit threshold at 45%.

**Token Discovery:** Aggregates tokens from DexScreener Trending, PumpFun-style tokens, newly migrated PumpFun to PumpSwap tokens, and low-cap new launches.

**Smart Hivemind AI Workflow:**
- Features position monitoring, quick technical scans, deep scans (full 11-model hivemind), and automatic portfolio rebalancing.
- AI-Powered Strategy Learning occurs every 3 hours by analyzing trade journals.
- The 11-Model Hivemind System uses DeepSeek, xAI Grok, Together AI, OpenRouter, Groq, Cerebras, Google Gemini, ChatAnywhere, OpenAI, with weighted confidence voting and smart model prioritization.
- Improved AI Consensus Algorithm includes weighted voting, smart tie-breaking, and better decision clarity.

**Intelligent Circuit Breaker Protection:** Disables failing AI models, rotates to healthy models, and prioritizes reliable models based on health scoring.

**Dual-Mode Trading Strategy:**
- **SCALP Mode:** 62-79% AI confidence, 3-6% portfolio, max 30-minute hold, -8% to -12% stop-loss, +4-8% profit targets. Minimum 2% profit before selling.
- **SWING Mode:** 80%+ AI confidence, 5-9% portfolio, max 24-hour hold, -15% to -25% stop-loss, +15% minimum profit target. Minimum 5% profit before selling.

**Advanced Technical Analysis:** Integrates RSI, EMA (9/21), and Bollinger Bands into buy/sell decisions, generating a Technical Score.

**Sell Decision Framework:** AI continuously monitors positions using technical indicators, market metrics, with automatic stop-loss override and exit criteria based on AI confidence, profit target, technical signals, or max hold time. Includes peak profit tracking and tiered profit protection.

**Opportunistic Position Rotation:** Automatically sells weaker positions to free capital and maintains a 10% liquidity reserve.

**Automatic Buyback & Burn Mechanism:** Configurable automatic buyback and immediate on-chain burning of specified tokens using a percentage of profits (default 5%) from successful trades.

**Memory Management System:** Automated hourly cleanup of inactive bot states and optimized activity log handling.

**System Stability & Error Handling:** Global error handlers, graceful shutdown, timeout protection, and automatic restart.

**Performance Optimizations:** Eliminated Jupiter Balances API, improved portfolio calculations, and optimized scan/strategy update speed.

**Automatic Wallet Synchronization:** Runs every 5 minutes to reconcile database positions with Solana blockchain holdings.

**Automatic Database Cleanup:** Runs daily and on startup to remove expired data.

**Bundle Activity Detection & Token Blacklist:** Analyzes tokens for pump-and-dump schemes, auto-blacklisting critical tokens (≥85 score) and warning for suspicious ones (60-84 score).

**AI-Powered Loss Prevention System:**
- **Centralized Trading Guard:** Ensures all trading paths respect drawdown protection, blocking trades when portfolio drops >20% from peak.
- **Hardened Technical Fallback:** Increased risk weights for technical analysis fallback to match AI conservativeness, blocking trades with >60% loss probability.
- **Multi-Provider Loss Prediction:** AI analyzes tokens for rug pull risk and loss probability using fallback providers (DeepSeek → OpenAI → Google Gemini).
- **Rug Pull Detection:** Checks 7 critical red flags (e.g., unlocked liquidity, low liquidity, sudden pumps).
- **Enhanced Supermajority Consensus:** Requires minimum 3 AI models to respond AND 64%+ agreement for buy trades. If a majority (2+ of 3) AIs indicate >70% loss probability, the trade is blocked.
- **Fail-Closed Architecture:** Blocks trades during degraded conditions and requires minimum AI consensus for trades.
- **Loss Probability Scoring:** Blocks trades with >40% loss risk (conservative threshold).

**Profit Maximization System:**
- **Minimum Profit Thresholds:** Enforces minimum profit thresholds (2% SCALP, 5% SWING) before selling.
- **Smart Exit Logic:** Allows early exits only when in actual loss, protecting profitable positions.
- **Profit-Hunting Strategy:** Includes peak profit tracking, smart stop-loss based on actual losses, buy-the-dip detection, and intelligent profit gating.

### Data Storage
PostgreSQL via Neon's serverless driver and Drizzle ORM, using UUID primary keys, decimal types, and automatic timestamps.

### Authentication & Authorization
Wallet-based authentication using cryptographic signature verification via tweetnacl and Solana Wallet Adapter.

### Security Infrastructure
Defense-in-depth security: rate limiting, DDoS protection, security headers (Helmet.js), input validation (XSS, Solana address, Zod, SQL injection prevention), audit logging, and secure environment variable handling.

### Production Readiness & Automated Workflow
Supports secure encrypted key management, automated PumpFun rewards claiming, balance checks, optimal SOL to token swaps via Jupiter Ultra API, and token burns. Includes a payment/trial system with whitelisted wallets.

### Transaction Fee System
- **Project-Linked Bots:** 0.5% transaction fee after 60 free transactions.
- **AI Trading Bot:** 1% platform fee on all buy transactions (deducted pre-execution) to treasury wallet `jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38`. Exempt wallet `924yATAEdnrYmncJMX2je7dpiEfVRqCSPmQ2NK3QfoXA` has 0% fees.

## External Dependencies

**Blockchain Integration:**
- Solana Web3.js
- SPL Token program
- @solana/wallet-adapter suite
- bs58
- tweetnacl

**Payment Processing:**
- Solana-native payments (SOL only) to treasury wallet `jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38`.

**Third-Party Services:**
- Neon Database (PostgreSQL)
- Jupiter Ultra API (Swap API)
- Jupiter Price API v3
- PumpFun Lightning API
- DexScreener API
- **AI Hive Mind Providers:**
    - DeepSeek V3
    - Cerebras AI
    - Google Gemini
    - ChatAnywhere
    - Groq
    - OpenAI Primary
    - OpenAI Backup
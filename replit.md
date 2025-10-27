# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview
BurnBot is a SaaS platform providing a no-code solution for Solana SPL token creators to automate token buyback and burn operations. It features a dashboard, flexible scheduling, transaction monitoring, and an autonomous AI Trading Bot named GigaBrain. GigaBrain utilizes an 11-model AI hivemind to identify and trade trending tokens on Solana, focusing on profit potential, autonomous capital management, dynamic position sizing, and intelligent bundle activity detection to avoid pump-and-dump schemes. The platform aims to enhance tokenomics, offer robust trading tools, and operate as a profit-hunting machine with strong safety guardrails. It includes a subscription model with free trades, followed by a paid subscription and a platform fee, a portion of which is used for token buyback and burn.

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
**GigaBrain** operates autonomously with an 11-model AI hivemind, restricted to whitelisted wallets. Key features include:

-   **Autonomous Capital Management:** Manages liquidity reserves, employs percentage-based position sizing, and uses AI-driven exits. It includes strict quality filters for token selection, portfolio diversification, optimized stop-loss protection, and a Portfolio Drawdown Circuit Breaker.
-   **Token Discovery:** Aggregates tokens from various sources like DexScreener Trending and PumpFun.
-   **Smart Hivemind AI Workflow:** Features position monitoring, quick and deep technical scans (full 11-model hivemind), and automatic portfolio rebalancing. The 11-Model Hivemind System uses various AI providers (e.g., DeepSeek, xAI Grok, Google Gemini, OpenAI) with weighted confidence voting and smart model prioritization.
-   **Intelligent Circuit Breaker Protection:** Disables and rotates failing AI models, prioritizing reliable ones based on health scoring.
-   **Advanced AI Rate Limiting & Retry System:** Implements universal and provider-specific rate limiting, exponential backoff for retries, and a smart circuit breaker to distinguish between rate limits and permanent failures.
-   **Dual-Mode Trading Strategy:** Supports SCALP (short-term, high confidence) and SWING (longer-term, higher confidence) modes with distinct portfolio allocations, hold times, stop-losses, and profit targets.
-   **Advanced Technical Analysis:** Integrates RSI, EMA, and Bollinger Bands into buy/sell decisions, generating a Technical Score.
-   **Sell Decision Framework:** AI continuously monitors positions with dynamic exit criteria based on confidence, profit targets, technical signals, or max hold time, including peak profit tracking and tiered profit protection.
-   **Opportunistic Position Rotation:** Automatically sells weaker positions to free up capital and maintain liquidity.
-   **Automatic Buyback & Burn Mechanism:** Configurable automatic buyback and immediate on-chain burning of tokens using a percentage of profits from successful trades.
-   **AI-Powered Loss Prevention System:** Includes a centralized trading guard, hardened technical fallback, multi-provider loss prediction for rug pull risks, enhanced supermajority consensus for trades, and a fail-closed architecture, blocking trades with high loss probability.
-   **Profit Maximization System:** Enforces minimum profit thresholds, smart exit logic, and a profit-hunting strategy with features like peak profit tracking, smart stop-loss, buy-the-dip detection, and AI override for smart exits when AI confidence is high.
-   **Optimized Slippage Strategy:** Implements tiered slippage settings for BUY (3%), Normal SELL (5%), and Emergency Rotation SELL (8%) operations to preserve profits.
-   **Multi-Strategy Trading System:** Complementary strategies (Mean Reversion, Momentum Breakout, Grid Trading) run alongside AI-driven SCALP/SWING, focusing on "Buy Low, Sell High" principles with configurable parameters for position sizing, profit targets, and stop losses.
-   **AI-Driven Trade Execution Filters:** Deep scans now include technical "buy low" filters (Bollinger Band proximity, 24h pump filter) before executing AI-driven buy trades, ensuring purchases at support levels and preventing FOMO buying at peaks.

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
    -   OpenAI Primary
    -   OpenAI Backup
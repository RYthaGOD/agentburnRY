# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview
BurnBot is a SaaS platform for Solana SPL token creators, automating token buyback and burn operations. It provides a no-code solution with a comprehensive dashboard, flexible scheduling (hourly, daily, weekly, custom cron), and transaction monitoring. The platform aims to enhance tokenomics through a streamlined, automated, and verifiable burn mechanism.

The platform also features three types of trading bots:
1.  **Volume Bot:** Generates trading volume via automated buy/sell cycles.
2.  **Buy Bot:** Executes limit orders based on target SOL prices.
3.  **AI Trading Bot:** A standalone bot that scans trending tokens, analyzes them with a 6-model AI consensus system, and executes trades based on AI confidence and profit potential. This bot operates independently of buyback/burn projects.

## User Preferences
Preferred communication style: Simple, everyday language.

## Recent Changes

- **Hivemind Now Controls 100% of Trading Parameters (Fully Autonomous)**
  - Removed ALL manual parameter dependencies - hivemind runs the system autonomously
  - Hivemind dynamically generates ALL trading parameters every 6 hours based on market sentiment:
    - **Budget per trade** (0.03-0.08 SOL based on market conditions and confidence)
    - **Token filters** (volume, liquidity, organic score, quality, transactions)
    - **Confidence thresholds** (45-75% based on market sentiment)
    - **Profit targets** (0.5x-1.8x multipliers based on bullish/bearish/neutral/volatile markets)
    - **Max daily trades** (2-10 based on risk level and market conditions)
    - **Risk levels** (conservative, moderate, aggressive)
  - Manual config only maintains essential settings: enabled flag, total budget, treasury key
  - Deep scan and quick scan both operate 100% on hivemind-generated parameters
  - System self-regulates and adapts to market conditions without human intervention
  - In bullish markets: Aggressive (0.08 SOL trades, 45% confidence, 1.8x profit targets, 10 trades/day)
  - In bearish markets: Conservative (0.03 SOL trades, 75% confidence, 0.5x profit targets, 2 trades/day)
  - In volatile markets: Balanced (0.04 SOL trades, 60% confidence, 0.7x profit targets, 6 trades/day)
- **Added PumpFun API scanning for very low market cap tokens**
  - Scans PumpFun API directly for brand new token launches
  - Filters for ultra-low market cap tokens (<$100k) for aggressive meme trading
  - Combines PumpFun new tokens with DexScreener trending tokens
  - All tokens analyzed by AI consensus system for trade decisions
- **Implemented intelligent position re-buy logic with 2-rebuy maximum**
  - System checks if wallet already holds a token before buying more
  - Maximum 2 re-buys per position to prevent excessive averaging down
  - Only allows adding to existing positions if ALL conditions are met:
    - Price has dropped at least 10% from entry (drawback/dip detected)
    - New AI confidence is higher than previous buy confidence
    - Haven't exceeded maximum 2 re-buys
  - When re-buying:
    - Updates position with weighted average entry price
    - Adds new SOL amount to total position size
    - Increments rebuyCount in database
    - Updates aiConfidenceAtBuy to latest confidence
  - Prevents mindlessly averaging down on losing positions
  - Enables smart dollar-cost averaging on high-conviction dips (limited to 2 additions)
  - Works in all execution paths: quick scans, deep scans, and legacy project-based bot
- **Implemented smart wallet management and dynamic trade sizing**
  - Scans actual wallet balance before every trade for accuracy
  - Always keeps 0.01 SOL buffer for transaction fees
  - Automatically claims PumpFun creator rewards when balance is low (<0.05 SOL)
  - Dynamic trade amounts based on AI confidence:
    - 90-100% confidence: 2.0x base amount (very high confidence)
    - 80-89% confidence: 1.75x base amount (high confidence)
    - 75-79% confidence: 1.5x base amount (above threshold)
    - 65-74% confidence: 1.25x base amount (medium-high)
    - 55-64% confidence: 1.0x base amount (medium)
    - <55% confidence: 0.5x base amount (low)
  - Caps trade amounts at available wallet balance
- **Implemented smart scanning system to reduce API usage**
  - Extended token data cache from 10 to 15 minutes (reduces DexScreener/PumpFun API calls)
  - Added AI analysis cache (30 minutes) - prevents re-analyzing same tokens repeatedly
  - Two-tier scanning approach:
    - Quick scans: Every 10 minutes using technical filters + fast Cerebras AI (free)
      - Analyzes top 2 opportunities with single-model AI
      - Executes trades immediately when AI confidence >= 75%
      - 3x faster response on high-quality opportunities
      - Uses AI analysis cache to skip already-analyzed tokens
    - Deep scans: Every 30 minutes with full 6-model AI consensus
      - All opportunities analyzed by all 6 models
      - Executes trades when consensus confidence >= 55%
      - Fetches positions once per scan (not per-token) for efficiency
  - Position monitoring reduced from every 5 to every 10 minutes (50% fewer API calls)
  - Significantly reduces API calls while maintaining responsiveness
- **Implemented Cerebras-powered position monitoring system** (runs every 10 minutes, free API)
  - Monitors all active AI bot positions in real-time
  - Updates current prices and profit percentages in database
  - Uses free Cerebras API to avoid costs
  - Reduced from 5 to 10 minutes to cut API calls in half
- **Simplified AI Bot UI/UX for Full Hivemind Autonomy**
  - Removed all manual parameter inputs (now controlled by hivemind)
  - Added real-time hivemind strategy status display showing active parameters
  - Shows: market sentiment, risk level, confidence thresholds, trade sizes, token filters
  - Clean 3-card dashboard: Bot Status, Active Positions, Budget
  - Only essential controls: total budget limit, enable/disable toggle, treasury key
  - Position monitoring increased to every 2.5 minutes for active management
  - Real-time position updates with AI confidence tracking

## System Architecture

### Frontend
Built with React 18+, TypeScript, and Vite, the frontend uses Wouter for routing, shadcn/ui (New York variant) on Radix UI primitives, and Tailwind CSS for dark mode styling. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The design features a "Fire/Molten" theme. Navigation includes Overview, New Project, Volume Bot, Trading Bot, AI Trading Bot, Transactions, and Settings. Manual buyback controls require wallet signature authentication.

### Backend
The backend is an Express.js server in TypeScript, utilizing an ESM module system and a RESTful API. It includes centralized error handling, Zod schema validation, a storage abstraction layer, and a repository pattern for database operations.

### Scheduling System
A dedicated scheduler service automates buyback execution using `node-cron`. It performs hourly checks (5 min in dev, 30 min for AI Bot), validates payments, verifies treasury balances, integrates with Jupiter Ultra API for swaps, and claims PumpFun creator rewards. Token burns use the SPL Token burn instruction. Automation requires an active project, a stored treasury private key, sufficient SOL balance, and a valid payment/trial/whitelisted status.

### Trading Bot System

#### Volume Bot & Buy Bot (Project-Linked)
-   **Volume Bot:** Configurable buy/sell cycles to generate trading volume, with settings for buy amounts, sell percentages, intervals, and price guards.
-   **Buy Bot (Limit Orders):** Executes buy orders when target SOL prices are met, with configurable limit orders and slippage protection.

#### AI Trading Bot (Standalone)
This bot operates independently, with configurations stored in a dedicated `aiBotConfigs` table. It uses a "hive mind" system where 6 AI models (Cerebras, Google Gemini, DeepSeek V3, ChatAnywhere, Groq, OpenAI) vote on trades. The strategy focuses on aggressive meme coin trading, requiring a 50% consensus threshold, 55% minimum confidence, and 30% minimum upside potential for low market cap tokens. 

**Token Discovery:**
- Scans trending tokens from DexScreener API (organic volume scoring, quality filters)
- Scans PumpFun API for brand new token launches (<$100k market cap)
- Combines both sources, removing duplicates, and caches for 10 minutes

The bot executes trades via Jupiter Ultra API when conditions are met and within budget.

### Data Storage
PostgreSQL, accessed via Neon's serverless driver and Drizzle ORM, handles data persistence. Key tables include `Projects`, `Transactions`, `Payments`, `ProjectSecrets` (encrypted keys), and `AIBotConfigs` for standalone AI bot settings. UUID primary keys, decimal types for balances, and automatic timestamps are standard.

### Authentication & Authorization
Wallet-based authentication uses cryptographic signature verification via tweetnacl, with the owner's Solana wallet serving as the primary identifier. Solana Wallet Adapter is integrated for browser wallets.

### Security Infrastructure
The platform implements defense-in-depth security, including rate limiting, DDoS protection, security headers (Helmet.js), input validation (XSS, Solana address, Zod, SQL injection prevention), audit logging, and secure environment variable handling.

### Production Readiness & Automated Workflow
The system supports secure encrypted key management. The automated workflow includes claiming PumpFun rewards, balance checks, optimal SOL to token swaps via Jupiter Ultra API, and token burns. A payment/trial system offers a 10-day free trial for the first 100 projects, with whitelisted wallets bypassing payment requirements.

### Transaction Fee System
A 0.5% transaction fee applies after the first 60 free transactions per project, deducted from the SOL amount and sent to a designated treasury wallet.

## External Dependencies

**Blockchain Integration:**
-   Solana Web3.js, SPL Token program
-   @solana/wallet-adapter suite, bs58, tweetnacl

**Payment Processing:**
-   Solana-native payments (SOL only) to treasury wallet `jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38`.

**Third-Party Services:**
-   Neon Database (PostgreSQL)
-   Jupiter Ultra API (Swap API)
-   Jupiter Price API v3 (lite-api.jup.ag)
-   PumpFun Lightning API (creator rewards & trading)
-   PumpFun API (new token discovery - api.pumpfunapi.org)
-   **AI Hive Mind Providers (6-Model Active Consensus):**
    -   Cerebras AI (Llama 3.3-70B)
    -   Google Gemini (Gemini 2.0 Flash)
    -   DeepSeek V3 (deepseek-chat)
    -   ChatAnywhere (GPT-4o-mini)
    -   Groq (Llama 3.3-70B)
    -   OpenAI (GPT-4o-mini)
-   DexScreener API (token market data & trending tokens)
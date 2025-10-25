# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview
BurnBot is a SaaS platform for Solana SPL token creators, automating token buyback and burn operations. It provides a no-code solution with a dashboard, flexible scheduling, and transaction monitoring, aiming to enhance tokenomics through automated and verifiable burn mechanisms.

The platform also includes three types of trading bots:
- **Volume Bot:** Generates trading volume via automated buy/sell cycles.
- **Buy Bot:** Executes limit orders based on target SOL prices.
- **AI Trading Bot:** A standalone bot that scans trending tokens, analyzes them using a 7-model AI consensus system with automatic failover, and executes trades based on AI confidence and profit potential. This bot operates independently of buyback/burn projects. The AI Trading Bot features autonomous capital management, dynamic position sizing, and automatic portfolio rebalancing for exponential growth.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
Built with React 18+, TypeScript, and Vite, using Wouter for routing, shadcn/ui (New York variant) on Radix UI primitives, and Tailwind CSS for dark mode. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The design features a "Fire/Molten" theme.

### Backend
An Express.js server in TypeScript using an ESM module system, a RESTful API, centralized error handling, Zod schema validation, a storage abstraction layer, and a repository pattern for database operations.

### Scheduling System
A dedicated scheduler service automates buyback execution using `node-cron`. It performs hourly checks, validates payments, verifies treasury balances, integrates with Jupiter Ultra API for swaps, and claims PumpFun creator rewards. Token burns use the SPL Token burn instruction.

### Trading Bot System

#### Volume Bot & Buy Bot (Project-Linked)
- **Volume Bot:** Configurable buy/sell cycles with settings for buy amounts, sell percentages, intervals, and price guards.
- **Buy Bot (Limit Orders):** Executes buy orders based on target SOL prices with configurable limits and slippage protection.

#### AI Trading Bot (Standalone)
This bot operates independently with configurations stored in a dedicated `aiBotConfigs` table. It uses a "hive mind" system where 7 AI models vote on trades with automatic failover. Access is restricted to whitelisted wallets.

**Autonomous Capital Management:**
- Uses available wallet balance (minus 0.01 SOL fee reserve) for trades.
- Dynamic position sizing (10% base, up to 15% with high AI confidence) for compounding.
- AI-driven exits with no fixed profit targets.
- High confidence requirements (minimum 75% AI confidence threshold).
- Enhanced quality filters: 60%+ organic score, 50%+ quality score, $15k+ volume, $15k+ liquidity.
- Portfolio diversification: 25% maximum concentration limit per position.
- Stop-loss protection: Automatically sells at -30% loss (-50% for swing trades).
- Portfolio Drawdown Circuit Breaker: Pauses new trading if portfolio drops >20% from peak, resumes at -15%.
- Faster Exit Threshold: AI sell confidence raised from 40% to 50%.

**Token Discovery:**
- DexScreener Trending (30 tokens)
- PumpFun-style tokens via DexScreener (15 tokens) - NEW replacement for broken PumpFun API
- Newly Migrated Tokens from PumpFun → Raydium (20 tokens) - DexScreener-based
- Low-Cap New Launches (15 tokens) - DexScreener-based replacement for PumpFun API
- Total: ~80 tokens per scan (2.6x more opportunities than before)

**Optimized AI Workflow (DeepSeek-First Strategy with OpenAI for Critical Decisions):**
- **Position Monitoring (Every 2.5 minutes):** Uses DeepSeek V3 for analyzing open positions and triggering sells.
- **Quick Technical Scans (Every 10 minutes):** Scans top trending tokens using DeepSeek V3, executing trades with ≥75% AI confidence.
- **Deep Scans (Every 30 minutes):** Full 7-model hivemind consensus, including OpenAI, for high-confidence opportunities (85%+ expected swing trades).
- **Automatic Portfolio Rebalancing (Every 30 minutes):** Forces OpenAI for full 7-model hivemind analysis of ALL positions for optimal sell recommendations.
- **Emergency Failover:** Automatically retries with OpenAI if free models fail.

**Swing Trading Strategy:**
- Auto-detected for positions opened with ≥85% AI confidence.
- Wider stop-loss (-50%), higher profit targets (100%+), and stricter AI-driven exit criteria.

**Sell Decision Framework:**
- AI continuously monitors positions (every 2.5 min).
- Deep scan analysis (every 30 min) by full 7-model AI consensus.
- Automatic Portfolio Rebalancing scheduler for independent sell recommendations.
- Automatic Stop-Loss Override: -30% for regular, -50% for swing trades.
- Regular positions sell when AI confidence drops below 50% or AI recommends SELL. Swing trades sell with 60%+ AI SELL confidence or ≥100% profit.

**Portfolio-Wide Risk Management:**
- Tracks all-time portfolio peak value.
- Pauses trading at -20% drawdown from peak, resumes at -15% recovery.
- Multi-layer protection including stop-loss, AI exits, and drawdown circuit breaker.

**Automatic Buyback & Burn Mechanism:**
- Configurable automatic buyback of a specified token (e.g., MY BOT token: FQptMsS3tnyPbK68rTZm3n3R4NHBX5r9edshyyvxpump) using a percentage of profits from successful trades.
- Default: 5% of profit from each profitable trade is used to buyback tokens.
- Purchased tokens are immediately and permanently destroyed using SPL Token's burn instruction.
- Reduces circulating supply and supports long-term token value.
- Full transparency with on-chain transaction records for all buyback and burn operations.
- Tracks total SOL spent on buybacks and total tokens permanently burned.
- Configurable via dashboard: enable/disable, set token mint address, adjust buyback percentage (1-20%).

**Memory Management System:**
- Automated hourly cleanup prevents memory leaks during extended operation.
- Removes inactive bot states (24h+ inactivity) from `aiBotStates` Map.
- Purges expired cache entries from `tokenDataCache` (15min TTL) and `analysisCache` (30min TTL).
- Optimized activity log handling using `pop()` instead of `slice()` to eliminate array recreation.
- Runs on startup and every hour via cron scheduler.
- Production-tested for long-running stability.

**Performance Optimizations (Oct 25, 2025):**
- **Eliminated Jupiter Balances API dependency** - Removed broken `/balances` endpoint (404 errors), now reads positions directly from database for faster and more reliable portfolio analysis
- **Fixed portfolio calculation** - Token amounts stored in raw units (like lamports) are now correctly converted to decimal amounts using standard 6-decimal conversion for PumpFun tokens
- **Reduced error logging spam** - Silent fallback for portfolio analysis instead of repetitive error logs
- **Improved position tracking** - Portfolio now correctly shows actual position count and values instead of 0
- **PumpFun API failover complete** - All three broken endpoints replaced with DexScreener alternatives, providing 2.6x more token discovery opportunities

### Data Storage
PostgreSQL via Neon's serverless driver and Drizzle ORM. Key tables: `Projects`, `Transactions`, `Payments`, `ProjectSecrets`, `AIBotConfigs`. Uses UUID primary keys, decimal types for balances, and automatic timestamps.

### Authentication & Authorization
Wallet-based authentication using cryptographic signature verification via tweetnacl and Solana Wallet Adapter.

### Security Infrastructure
Defense-in-depth security: rate limiting, DDoS protection, security headers (Helmet.js), input validation (XSS, Solana address, Zod, SQL injection prevention), audit logging, and secure environment variable handling.

### Production Readiness & Automated Workflow
Supports secure encrypted key management. Automated workflow includes claiming PumpFun rewards, balance checks, optimal SOL to token swaps via Jupiter Ultra API, and token burns. Includes a payment/trial system with whitelisted wallets bypassing payment requirements.

### Transaction Fee System
A 0.5% transaction fee applies after the first 60 free transactions per project, deducted from SOL and sent to a treasury wallet.

## External Dependencies

**Blockchain Integration:**
- Solana Web3.js, SPL Token program
- @solana/wallet-adapter suite, bs58, tweetnacl

**Payment Processing:**
- Solana-native payments (SOL only) to treasury wallet `jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38`.

**Third-Party Services:**
- Neon Database (PostgreSQL)
- Jupiter Ultra API (Swap API)
- Jupiter Price API v3
- PumpFun Lightning API (creator rewards & trading)
- PumpFun API (token discovery: new, trending, migrated)
- **AI Hive Mind Providers (7-Model Active Consensus with Failover):**
    - **DeepSeek V3 (PRIMARY MODEL)**
    - Cerebras AI (Llama 3.3-70B)
    - Google Gemini (Gemini 2.0 Flash)
    - ChatAnywhere (GPT-4o-mini)
    - Groq (Llama 3.3-70B)
    - OpenAI Primary (GPT-4o-mini)
    - OpenAI Backup (GPT-4o-mini)
- DexScreener API (token market data & trending tokens)
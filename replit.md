# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview
BurnBot is a SaaS platform for Solana SPL token creators, automating token buyback and burn operations. It offers a no-code solution with a dashboard, flexible scheduling, and transaction monitoring to enhance tokenomics through automated and verifiable burn mechanisms. The platform also includes a Volume Bot, a Buy Bot, and an independent AI Trading Bot. The AI Trading Bot scans trending tokens, analyzes them using a 7-model AI consensus system with automatic failover, and executes trades based on AI confidence and profit potential, featuring autonomous capital management, dynamic position sizing, and intelligent bundle activity detection to avoid pump-and-dump schemes.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
Built with React 18+, TypeScript, and Vite, utilizing Wouter for routing, shadcn/ui (New York variant) on Radix UI primitives, and Tailwind CSS for dark mode. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The design features a "Fire/Molten" theme.

### Backend
An Express.js server in TypeScript using an ESM module system, a RESTful API, centralized error handling, Zod schema validation, a storage abstraction layer, and a repository pattern for database operations.

### Scheduling System
A dedicated scheduler service automates buyback execution using `node-cron`, handling hourly checks, payment validation, treasury balance verification, Jupiter Ultra API integration for swaps, and PumpFun creator reward claims. Token burns utilize the SPL Token burn instruction.

### Trading Bot System

#### Volume Bot & Buy Bot (Project-Linked)
- **Volume Bot:** Configurable buy/sell cycles with settings for amounts, percentages, intervals, and price guards.
- **Buy Bot (Limit Orders):** Executes buy orders based on target SOL prices with configurable limits and slippage protection.

#### AI Trading Bot (Standalone)
This bot operates independently with configurations stored in a dedicated `aiBotConfigs` table. It employs a "hive mind" system where 7 AI models vote on trades with automatic failover, restricted to whitelisted wallets.

**Autonomous Capital Management:**
- Maintains 10% liquidity reserve for capital growth (90% max deployment) with dynamic fee buffer scaling by portfolio size.
- Strict percentage-based position sizing (3-6% for SCALP, 5-9% for SWING) with a 0.01 SOL minimum for small portfolios and strict caps for larger portfolios.
- Dynamic allocation based on market conditions via hivemind strategy that regenerates every 3 hours, adjusting position sizes, confidence thresholds, and risk parameters based on market sentiment (bullish/bearish/neutral/volatile) and recent performance.
- AI-driven exits with no fixed profit targets, requiring a minimum 75% AI confidence.
- Enhanced quality filters: 70%+ organic score, 60%+ quality score, $25k+ volume, $20k+ liquidity.
- Portfolio diversification with a 25% maximum concentration limit per position.
- Stop-loss protection at -30% for SCALP and -50% for SWING trades.
- Portfolio Drawdown Circuit Breaker pauses trading if portfolio drops >20% from peak, resuming at -15%.
- Faster exit threshold: AI sell confidence raised from 40% to 50%.

**Token Discovery:**
- Aggregates tokens from DexScreener Trending, PumpFun-style tokens via DexScreener, newly migrated PumpFun to Raydium tokens, and low-cap new launches, totaling ~80 tokens per scan.

**Optimized AI Workflow with Dual-Model Consensus:**
- **Position Monitoring:** Every 1.5 minutes using OpenAI + DeepSeek 2 in parallel for dual-model consensus on sell decisions.
- **Quick Technical Scans:** Every 2 minutes using OpenAI + DeepSeek 2 in parallel for scalp trades (62-78% AI confidence). Both models analyze simultaneously and results are averaged for higher accuracy.
- **Deep Scans:** Every 15 minutes using the full 7-model hivemind, including OpenAI, for high-confidence swing opportunities (75%+ AI confidence).
- **Automatic Portfolio Rebalancing:** Every 30 minutes, forces OpenAI for full 7-model hivemind analysis for optimal sell recommendations.
- **Strategy Updates:** Every 3 hours, hivemind regenerates trading strategy to adapt to market conditions.
- **Dual-Model Benefits:** OpenAI + DeepSeek 2 run in parallel for quick scans and position monitoring, combining strengths of both models for more accurate trading decisions. When models agree, confidence is averaged for stronger signals. When models disagree, the higher-confidence model's recommendation is used.
- **Emergency Failover:** Falls back to DeepSeek Primary → OpenAI #2 → Cerebras → Groq if primary models fail.

**Dual-Mode Trading Strategy (Conservative):**
- **SCALP Mode (65-79% AI confidence):** 3-6% of portfolio, max 30-minute hold, -10% stop-loss, +4-8% profit targets.
- **SWING Mode (80%+ AI confidence):** 5-9% of portfolio, max 24-hour hold, -25% to -40% stop-loss, +15% minimum profit target.

**Sell Decision Framework:**
- AI continuously monitors positions. Deep scan analysis and automatic portfolio rebalancing provide ongoing evaluation and sell recommendations.
- Automatic Stop-Loss Override: -15% for SCALP, -30% to -50% for SWING.
- Exit Criteria: AI confidence drops below 50%, profit target hit, or max hold time reached.

**Opportunistic Position Rotation:**
- Automatically sells weaker positions first to free capital, then buys better opportunities when wallet balance is insufficient.
- Rotation Criteria: New opportunity must have 10%+ higher AI confidence (lowered from 25% for more flexibility) or cut a loss to capture a good opportunity (70%+ confidence). Prioritizes selling big losses or small profits.
- Emergency Rotation: When wallet depleted (<0.01 SOL), forces rotation of weakest position regardless of confidence improvement to maintain trading capability.
- MAX Portfolio Allocation: Maintains 10% liquidity reserve by capping deployment at 90% of total capital to enable continuous trading for capital growth.
- Dynamic Fee Buffer: Scales with portfolio size (3% for small, 5% for medium, 7.5% for large portfolios) instead of fixed 0.03 SOL.

**Portfolio-Wide Risk Management:**
- Tracks all-time portfolio peak value, pauses trading at -20% drawdown, resumes at -15% recovery. Includes multi-layer protection.

**Automatic Buyback & Burn Mechanism:**
- Configurable automatic buyback of a specified token (e.g., FQptMsS3tnyPbK68rTZm3n3R4NHBX5r9edshyyvxpump) using a percentage of profits (default 5%) from successful trades.
- Purchased tokens are immediately burned using SPL Token's burn instruction, reducing circulating supply.
- Full transparency with on-chain transaction records and configurable via dashboard.

**Memory Management System:**
- Automated hourly cleanup prevents memory leaks by removing inactive bot states and purging expired cache entries. Optimized activity log handling.

**System Stability & Error Handling:**
- Global error handlers for unhandledRejection and uncaughtException, graceful shutdown sequence, and timeout protection.
- Route error isolation, automatic restart by Replit, resource cleanup, and auto-shutdown when AI bot is disabled.

**Performance Optimizations:**
- Eliminated Jupiter Balances API dependency, improved portfolio calculation with accurate token decimals, reduced error logging, and enhanced position tracking.
- All broken PumpFun API endpoints replaced with DexScreener alternatives.
- Speed optimizations for quick scans (2min), position monitoring (1.5min), and strategy updates (3hr).

**Automatic Wallet Synchronization:**
- Runs every 5 minutes to ensure database positions match actual Solana blockchain holdings.
- Reconciles wallet holdings with database, removing stale positions, updating token amounts, and preserving precision.
- Automatic reconciliation on bot initialization ensures a clean starting state.

**Automatic Database Cleanup:**
- Runs daily at 3:00 AM plus on startup to prevent long-term database bloat.
- Removes expired replay-attack prevention signatures (5-minute TTL).
- Removes expired hivemind AI strategies (3-hour validity period).
- Removes old failed transactions (>7 days retention).
- Removes old completed transactions (>90 days audit trail retention).
- Error handling ensures cleanup failures don't disrupt other services.

**Bundle Activity Detection & Token Blacklist:**
- Automated detection system analyzes tokens for coordinated pump-and-dump schemes before AI analysis.
- Analyzes 6 suspicious signals: low organic score (<70%), low quality score (<60%), skewed buy/sell ratio (>65% buys), volume manipulation (ratio >10), new token pumps (<24h old with >100% gain), extreme volatility (>200% in 24h).
- Scoring system: 0-100 (60-84 = suspicious warning, 85+ = critical auto-blacklist).
- Auto-blacklists critical tokens (≥85 score) with metadata: bundle score, suspicious wallet count, average time between transactions.
- Tokens with 60-84 score trigger warnings but still proceed to AI analysis.
- Dashboard UI for viewing/managing blacklisted tokens with filtering and manual add/remove capabilities.
- Prevents capital loss by filtering obvious scams before expensive AI analysis.
- Learning system that remembers problematic tokens across sessions.

### Data Storage
PostgreSQL via Neon's serverless driver and Drizzle ORM. Uses UUID primary keys, decimal types for balances, and automatic timestamps.

### Authentication & Authorization
Wallet-based authentication using cryptographic signature verification via tweetnacl and Solana Wallet Adapter.

### Security Infrastructure
Defense-in-depth security: rate limiting, DDoS protection, security headers (Helmet.js), input validation (XSS, Solana address, Zod, SQL injection prevention), audit logging, and secure environment variable handling.

### Production Readiness & Automated Workflow
Supports secure encrypted key management. Automated workflow includes claiming PumpFun rewards, balance checks, optimal SOL to token swaps via Jupiter Ultra API, and token burns. Includes a payment/trial system with whitelisted wallets.

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
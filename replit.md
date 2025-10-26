# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview
BurnBot is a SaaS platform designed for Solana SPL token creators to automate token buyback and burn operations. It offers a no-code solution with a dashboard, flexible scheduling, and transaction monitoring to enhance tokenomics through automated and verifiable burn mechanisms. The platform also includes a Volume Bot, a Buy Bot, and **GigaBrain** - the standalone AI Trading Bot. GigaBrain ("Black and Gold Never Fold") uses a 10-model AI hivemind consensus system with automatic failover to scan and analyze trending tokens, executing trades based on AI confidence and profit potential. It features autonomous capital management, dynamic position sizing, and intelligent bundle activity detection to avoid pump-and-dump schemes.

## User Acquisition & Trust-Building Features

**Designed to convert website traffic into active users through transparency and hands-on demos:**

### Public Pages (No Wallet Required)
1. **Landing Page** (`/`): Hero section highlighting GigaBrain AI, live stats preview, trust signals, and clear CTAs linking to all features
2. **Public Stats Dashboard** (`/stats`): Real-time aggregated performance metrics from all GigaBrain users - win rate, ROI, total profit, best trades, SCALP/SWING split, and 24-hour activity
3. **Token Analyzer** (`/analyze`): Free AI-powered analysis tool for any Solana token - shows organic score, quality score, AI confidence, and BUY/HOLD/AVOID recommendation without requiring wallet connection
4. **How It Works** (`/learn`): Educational content explaining the 10-model hivemind system, SCALP vs SWING trading modes, safety features, and getting started guide

### Public API Routes (No Authentication)
- `GET /api/public/stats` - Returns aggregated performance data from all users
- `GET /api/public/analyze-token/:tokenMint` - Returns AI analysis for any Solana token (currently mock data)
- `GET /api/ai-bot/subscription/status/:ownerWalletAddress` - Returns subscription status and free trades remaining

### Subscription & Access Model
- **10 Free Trades**: Every new user gets 10 completely free AI trades with no payment required
- **2-Week Subscription**: After free trades, users pay 0.15 SOL for 2 weeks of unlimited AI trading access
- **Trading Fee**: 1% platform fee applies to all trades (both free and subscription trades)
- **Payment**: Solana-native (SOL) payments to treasury wallet `jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38`
- **Verification**: On-chain transaction verification before subscription activation
- **Buyback & Burn**: 33% (1/3) of every subscription payment is automatically used to buy back and burn tokens (FQptMsS3tnyPbK68rTZm3n3R4NHBX5r9edshyyvxpump) to create deflationary tokenomics

### Conversion Funnel
Landing → Try Token Analyzer (see AI capabilities) → Learn How It Works (understand hivemind) → View Live Stats (verify real performance) → Connect Wallet → Start Trading (10 free trades) → Purchase 2-Week Access

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
Built with React 18+, TypeScript, and Vite, using Wouter for routing, shadcn/ui (New York variant) on Radix UI primitives, and Tailwind CSS for dark mode. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The GigaBrain AI trading interface features a premium "Black and Gold" theme with gold accents (HSL 48° 100% 50%) on deep black backgrounds.

**Real-Time Performance Monitoring:** WebSocket-based live updates broadcasting 17 trading metrics after each trade, including win rate, ROI, net profit, average hold time, best/worst trades, and SCALP/SWING mode statistics.

### Backend
An Express.js server in TypeScript using an ESM module system, a RESTful API, centralized error handling, Zod schema validation, a storage abstraction layer, and a repository pattern for database operations.

### Scheduling System
A dedicated scheduler service automates buyback execution using `node-cron`, handling hourly checks, payment validation, treasury balance verification, Jupiter Ultra API integration for swaps, and PumpFun creator reward claims. Token burns utilize the SPL Token burn instruction.

### Trading Bot System

#### Project-Linked Bots (Volume Bot & Buy Bot)
- **Volume Bot:** Configurable buy/sell cycles with settings for amounts, percentages, intervals, and price guards.
- **Buy Bot (Limit Orders):** Executes buy orders based on target SOL prices with configurable limits and slippage protection.

#### GigaBrain AI Trading Bot (Standalone)
**GigaBrain** - "Black and Gold Never Fold" - is the autonomous AI trading bot that operates independently, utilizing a 10-model hivemind system where multiple AI models vote on trades with automatic failover, restricted to whitelisted wallets.

**Autonomous Capital Management:**
- Maintains 10% liquidity reserve.
- Strict percentage-based position sizing (3-6% for SCALP, 5-9% for SWING) with dynamic allocation based on market conditions.
- AI-driven exits require a minimum 75% AI confidence.
- Strict quality filters: 80%+ organic score, 70%+ quality score, $25k+ volume, $20k+ liquidity, 24h+ token age, 100+ estimated holders.
- Portfolio diversification with a 25% maximum concentration limit per position.
- Optimized stop-loss protection (-8% to -12% for SCALP, -15% to -25% for SWING trades).
- Portfolio Drawdown Circuit Breaker pauses trading if portfolio drops >20% from peak.
- AI sell confidence exit threshold at 45%.

**Token Discovery:** Aggregates tokens from DexScreener Trending, PumpFun-style tokens, newly migrated PumpFun to PumpSwap tokens, and low-cap new launches.

**Smart Hivemind AI Workflow:**
- **Position Monitoring:** Every 3 minutes using DeepSeek for sell decisions.
- **Quick Technical Scans:** Every 2 minutes using 4 highest-priority AI models for scalp trades (62-79% AI confidence).
- **Deep Scans:** Every 15 minutes using the full 10-model hivemind for high-confidence swing opportunities (75%+ AI confidence).
- **Automatic Portfolio Rebalancing:** Every 30 minutes using full hivemind analysis.
- **AI-Powered Strategy Learning:** Every 3 hours, the full hivemind analyzes recent trading performance to optimize strategy parameters.
- **Trade Journal & Pattern Analysis:** Tracks complete trade lifecycle, categorizes losses, identifies winning patterns, and integrates data into strategy regeneration.
- **10-Model Hivemind System:** DeepSeek, DeepSeek #2, Together AI, OpenRouter, Groq, Cerebras, Google Gemini, ChatAnywhere, OpenAI, OpenAI #2. Models run in parallel with majority voting.
- **Smart Model Prioritization:** 3-tier priority system (free reliable, free with limits, paid) to optimize cost/performance.
- **Circuit Breaker Protection:** Disables failing models for 5 minutes after 3 consecutive failures.
- **Tiered AI Usage:** Quick scans use 4 models; deep scans use the full hivemind.
- **Redundancy & Failover:** Built-in redundancy with 10 models and graceful fallback to rule-based strategies.

**Dual-Mode Trading Strategy:**
- **SCALP Mode (62-79% AI confidence):** 3-6% of portfolio, max 30-minute hold, -8% to -12% stop-loss, +4-8% profit targets.
- **SWING Mode (80%+ AI confidence):** 5-9% of portfolio, max 24-hour hold, -15% to -25% stop-loss, +15% minimum profit target.

**Sell Decision Framework:** AI continuously monitors positions, with automatic stop-loss override and exit criteria based on AI confidence, profit target, or max hold time.

**Opportunistic Position Rotation:** Automatically sells weaker positions to free capital for better opportunities based on AI confidence. Includes emergency rotation for depleted wallets and maintains a 10% liquidity reserve.

**Portfolio-Wide Risk Management:** Tracks all-time portfolio peak value, pauses trading at -20% drawdown, resumes at -15% recovery. Optional bypass mode (`bypassDrawdownProtection`) allows AI to continue trading through drawdowns.

**Automatic Buyback & Burn Mechanism:** Configurable automatic buyback of specified tokens using a percentage of profits (default 5%) from successful trades, with immediate on-chain burning.

**Memory Management System:** Automated hourly cleanup of inactive bot states, expired cache entries, and optimized activity log handling.

**System Stability & Error Handling:** Global error handlers, graceful shutdown, timeout protection, route error isolation, and automatic restart by Replit.

**Performance Optimizations:** Eliminated Jupiter Balances API, improved portfolio calculations, reduced error logging, enhanced position tracking, and replaced broken PumpFun API endpoints with DexScreener. Optimized speed for scans and strategy updates.

**Automatic Wallet Synchronization:** Runs every 5 minutes to reconcile database positions with actual Solana blockchain holdings.

**Automatic Database Cleanup:** Runs daily at 3:00 AM and on startup to remove expired replay-attack prevention signatures, hivemind AI strategies, and old failed/completed transactions.

**Bundle Activity Detection & Token Blacklist:** Automated system analyzes tokens for pump-and-dump schemes before AI analysis. It scores tokens based on 6 suspicious signals, auto-blacklisting critical tokens (≥85 score) and providing warnings for suspicious ones (60-84 score).

### Data Storage
PostgreSQL via Neon's serverless driver and Drizzle ORM. Uses UUID primary keys, decimal types for balances, and automatic timestamps.

### Authentication & Authorization
Wallet-based authentication using cryptographic signature verification via tweetnacl and Solana Wallet Adapter.

### Security Infrastructure
Defense-in-depth security: rate limiting, DDoS protection, security headers (Helmet.js), input validation (XSS, Solana address, Zod, SQL injection prevention), audit logging, and secure environment variable handling.

### Production Readiness & Automated Workflow
Supports secure encrypted key management. Automated workflow includes claiming PumpFun rewards, balance checks, optimal SOL to token swaps via Jupiter Ultra API, and token burns. Includes a payment/trial system with whitelisted wallets.

### Transaction Fee System

**Project-Linked Bots (Volume Bot, Buy Bot):**
- 0.5% transaction fee applies after the first 60 free transactions per project
- Deducted from SOL and sent to a treasury wallet

**AI Trading Bot:**
- 1% platform fee on all buy transactions (deducted before trade execution)
- Fee is sent to treasury wallet: `jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38`
- Exempt wallet: `924yATAEdnrYmncJMX2je7dpiEfVRqCSPmQ2NK3QfoXA` (0% fees)
- Transaction records track:
  - Gross amount (pre-fee)
  - Net amount (actual trade size after fee)
  - Platform fee deducted
  - Fee exemption status
  - Fee transfer transaction signature
- AI bot config tracks cumulative platform fees paid for transparency
- Budget calculations account for fees in addition to trade amounts

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
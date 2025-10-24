# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview
BurnBot is a SaaS platform designed for Solana SPL token creators, automating token buyback and burn operations. It offers a no-code solution with a comprehensive dashboard, flexible scheduling (hourly, daily, weekly, custom cron), and transaction monitoring. The platform aims to enhance tokenomics through a streamlined, automated, and verifiable burn mechanism.

The platform also includes three types of trading bots:
1.  **Volume Bot:** Generates trading volume through automated buy/sell cycles.
2.  **Buy Bot:** Executes limit orders based on target SOL prices.
3.  **AI Trading Bot:** A standalone bot that scans trending tokens, analyzes them using a 7-model AI consensus system with automatic failover, and executes trades based on AI confidence and profit potential. This bot operates independently of buyback/burn projects.

## Recent Updates

### October 24, 2025 - Autonomous Capital Management & Intelligent AI Usage
- **Removed ALL budget restrictions:** System now uses entire wallet balance (minus 0.01 SOL fee reserve)
- **Implemented dynamic position sizing:** Trades scale with portfolio value (10% base, up to 15% max with high confidence)
- **Enabled true exponential compounding:** Position caps grow with portfolio (1 SOL → 0.15 max, 100 SOL → 15 SOL max)
- **Real-time Wallet Holdings:** New API endpoint fetches actual SPL token balances from Solana blockchain
- **Batch Price Fetching:** Consolidated Jupiter API calls by 90%+ using batch endpoint (up to 100 tokens per call)
- **Dual OpenAI Key Failover:** Added OPENAI_API_KEY_2 as separate hivemind provider for automatic redundancy
- **Intelligent OpenAI Usage Strategy:** Hybrid 4-mode system maximizes value while minimizing costs:
  - Deep scans during peak trading hours (9am-5pm UTC) include OpenAI for best liquidity opportunities
  - OpenAI always included for high-confidence trades (85%+ expected swing trades)
  - Position monitoring (every 2.5 min) uses only Cerebras for efficiency (90% cost reduction)
  - Automatic tie-breaker mode when free models disagree on buy/sell decisions
  - **Emergency Fallback:** If all free AI models fail, automatically retries with OpenAI as safety net
- **Portfolio Analytics:** Dashboard displays token breakdown, diversification metrics, concentration analysis
- **Accurate Calculations:** Portfolio value = SOL balance + sum(all token values), avoiding double-counting
- **Updated frontend:** Removed budget controls, added autonomous management panel + holdings analysis card
- **Capital calculation:** Available = wallet SOL balance - 0.01 SOL fee reserve - sum of active position values
- **Maintained risk controls:** 25% concentration limit, stop-loss protection, AI-driven exits unchanged

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is built with React 18+, TypeScript, and Vite, using Wouter for routing, shadcn/ui (New York variant) on Radix UI primitives, and Tailwind CSS for dark mode styling. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The design features a "Fire/Molten" theme. Navigation includes Overview, New Project, Volume Bot, Trading Bot, AI Trading Bot, Transactions, and Settings. Manual buyback controls require wallet signature authentication.

### Backend
The backend is an Express.js server in TypeScript, utilizing an ESM module system and a RESTful API. It features centralized error handling, Zod schema validation, a storage abstraction layer, and a repository pattern for database operations.

### Scheduling System
A dedicated scheduler service automates buyback execution using `node-cron`. It performs hourly checks, validates payments, verifies treasury balances, integrates with Jupiter Ultra API for swaps, and claims PumpFun creator rewards. Token burns use the SPL Token burn instruction. Automation requires an active project, a stored treasury private key, sufficient SOL balance, and a valid payment/trial/whitelisted status.

### Trading Bot System

#### Volume Bot & Buy Bot (Project-Linked)
-   **Volume Bot:** Configurable buy/sell cycles to generate trading volume, with settings for buy amounts, sell percentages, intervals, and price guards.
-   **Buy Bot (Limit Orders):** Executes buy orders when target SOL prices are met, with configurable limit orders and slippage protection.

#### AI Trading Bot (Standalone)
This bot operates independently, with configurations stored in a dedicated `aiBotConfigs` table. It uses a "hive mind" system where 7 AI models vote on trades with automatic failover redundancy.

**RESTRICTED ACCESS:** AI Trading Bot access is limited to whitelisted wallets only. The whitelist is configured in `shared/config.ts` (`AI_BOT_WHITELISTED_WALLETS`). Non-whitelisted wallets receive a 403 error when attempting to use AI bot features.

**AUTONOMOUS CAPITAL MANAGEMENT (Exponential Growth System):**
- **No Budget Limits:** System autonomously uses ALL available wallet balance (minus 0.01 SOL fee reserve) to maximize profits.
- **Dynamic Position Sizing:** Trades grow with portfolio value (10% base, up to 15% with 90%+ AI confidence) - enabling TRUE compounding.
- **Unlimited Trading:** No daily trade limits - trades based purely on AI confidence, available balance, and portfolio concentration.
- **AI-Driven Exits:** All sell decisions made by AI analysis and hivemind strategy - no fixed profit targets.
- **Scaling Examples:** 1 SOL portfolio = 0.15 SOL max position | 10 SOL portfolio = 1.5 SOL max | 100 SOL = 15 SOL max (exponential!)
- **High Confidence Requirements:** Minimum 75% AI confidence threshold across all market conditions (raised from 68% for stricter filtering).
- **Enhanced Quality Filters:** 60%+ organic score (wash trading protection), 50%+ quality score, $15k+ volume, $15k+ liquidity (strengthened from 50%/40%/$8k).
- **Aggressive Only When Exceptional:** Only increases aggression when AI confidence ≥85%.
- **Portfolio Diversification:** 25% maximum concentration limit per position to prevent over-exposure.
- **Stop-Loss Protection:** Automatically sells positions at -30% loss to prevent catastrophic drawdowns (emergency capital preservation).
- **Portfolio Drawdown Circuit Breaker:** Pauses ALL new trading if portfolio drops >20% from peak value, resumes when recovering to -15% from peak (prevents cascading losses).
- **Faster Exit Threshold:** AI sell confidence raised from 40% to 50% for quicker exits when momentum weakens.

**Token Discovery (4 Sources):**
- **DexScreener Trending:** Scans trending Solana tokens across all DEXes with advanced organic volume detection and wash trading filters.
- **PumpFun Trending:** Top trending tokens currently active on PumpFun platform (api.pumpfunapi.org/pumpfun/trending).
- **Newly Migrated Tokens:** Tokens that recently graduated from PumpFun to Raydium DEX (48-hour window) - strong community validation signal.
- **Low-Cap New Launches:** Ultra-low market cap tokens (<$100k) from PumpFun API for aggressive meme trading opportunities.
- All sources combined, deduplicated by mint address, and cached for 15 minutes to optimize API usage.

The bot executes unlimited trades via Jupiter Ultra API when conditions are met and within budget, dynamically sizing trades based on AI confidence and wallet balance. It includes intelligent position re-buy logic with a maximum of two re-buys per position, triggered by price drops and increased AI confidence.

**Swing Trading Strategy (High-Confidence Positions):**
- **Auto-Detection:** Positions opened with AI confidence ≥85% automatically flagged as "swing trades" via `isSwingTrade` database field.
- **Wider Stop-Loss:** Swing trades use -50% stop-loss (vs -30% regular) to weather volatility and capture larger moves.
- **Higher Profit Targets:** Hold for 100%+ gains before taking profits (vs quick exits for regular trades).
- **Stricter Exit Criteria:** Only sell when AI STRONGLY recommends SELL with 60%+ confidence (vs 50% for regular positions).
- **AI-Driven Only:** No confidence threshold exits - swing trades ignore the 50% minimum AI confidence rule.
- **Visual Indicators:** Frontend displays swing trade badge and distinct stop-loss percentage for transparency.

**Sell Decision Framework (AI-Driven + Safety Overrides):**
- **Quick Monitoring:** AI continuously monitors all positions (every 2.5 minutes via Cerebras for fast checks).
- **Deep Scan Analysis:** Full 7-model AI consensus analyzes all holdings during deep scans (every 30 minutes) for comprehensive position management with SELL/HOLD/ADD recommendations.
- **Batch Portfolio Analysis:** When evaluating positions for sells, ALL positions are analyzed together in one hivemind call (instead of one-by-one), providing better portfolio-wide insights with same API usage.
- **Automatic Stop-Loss Override:** 
  - Regular positions: Immediately sells at -30% loss regardless of AI recommendation
  - Swing trades: Immediately sells at -50% loss (wider tolerance for high-confidence plays)
- **Regular Positions:** Sells when AI confidence drops below 50% threshold OR AI explicitly recommends SELL.
- **Swing Trades:** Only sells when AI recommends SELL with 60%+ confidence OR profit ≥100%.
- Holds when AI recommends HOLD and position is above stop-loss threshold.
- No fixed profit targets for regular trades - AI analyzes momentum, liquidity, buy pressure, and trend data to optimize exits.

**Portfolio-Wide Risk Management:**
- **Peak Tracking:** System tracks all-time portfolio peak value in database.
- **Drawdown Monitoring:** Warns at -10% from peak, pauses trading at -20% from peak.
- **Automatic Recovery:** Resumes trading when portfolio recovers to -15% from peak.
- **Multi-Layer Protection:** Stop-loss (-30%) + AI exits (50% confidence) + drawdown circuit breaker (-20% portfolio-wide).

### Data Storage
PostgreSQL, accessed via Neon's serverless driver and Drizzle ORM, handles data persistence. Key tables include `Projects`, `Transactions`, `Payments`, `ProjectSecrets` (encrypted keys), and `AIBotConfigs`. UUID primary keys, decimal types for balances, and automatic timestamps are standard.

### Authentication & Authorization
Wallet-based authentication uses cryptographic signature verification via tweetnacl, with the owner's Solana wallet as the primary identifier. Solana Wallet Adapter is integrated for browser wallets.

### Security Infrastructure
The platform employs defense-in-depth security, including rate limiting, DDoS protection, security headers (Helmet.js), input validation (XSS, Solana address, Zod, SQL injection prevention), audit logging, and secure environment variable handling.

### Production Readiness & Automated Workflow
The system supports secure encrypted key management. The automated workflow includes claiming PumpFun rewards, balance checks, optimal SOL to token swaps via Jupiter Ultra API, and token burns. A payment/trial system offers a 10-day free trial, with whitelisted wallets bypassing payment requirements.

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
-   PumpFun API (multi-source token discovery - api.pumpfunapi.org)
    -   `/pumpfun/new/tokens` - New token launches
    -   `/pumpfun/trending` - Top trending tokens
    -   `/pumpfun/migrated` - Newly graduated tokens (PumpFun → Raydium)
-   **AI Hive Mind Providers (7-Model Active Consensus with Failover):**
    -   Cerebras AI (Llama 3.3-70B) - Free, fast
    -   Google Gemini (Gemini 2.0 Flash) - Free tier
    -   DeepSeek V3 (deepseek-chat) - Free tier
    -   ChatAnywhere (GPT-4o-mini) - Free tier
    -   Groq (Llama 3.3-70B) - Free
    -   OpenAI Primary (GPT-4o-mini) - OPENAI_API_KEY (paid, strategic use)
    -   OpenAI Backup (GPT-4o-mini) - OPENAI_API_KEY_2 (paid, automatic failover)
    -   **Intelligent OpenAI Usage:** OpenAI models included strategically during peak trading hours (9am-5pm UTC), for high-confidence opportunities (85%+ expected confidence), and as tie-breakers when free models disagree. Position monitoring uses only Cerebras for efficiency.
    -   **Emergency Fallback:** If all free models fail, automatically retries with OpenAI as safety net to ensure bot never fails completely.
-   DexScreener API (token market data & trending tokens)
# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview

BurnBot is a SaaS platform designed for Solana SPL token creators to automate token buyback and burn operations. It offers a no-code solution with a comprehensive dashboard for configuration, flexible scheduling (hourly, daily, weekly, custom cron), and transaction monitoring. The platform aims to provide a streamlined, automated, and verifiable burn mechanism to enhance tokenomics for Solana projects.

Additionally, BurnBot includes three types of trading bots:
1. **Volume Bot:** Generates trading volume through automated buy/sell cycles
2. **Buy Bot:** Executes limit orders when target SOL prices are met
3. **AI Trading Bot:** **Completely standalone** - scans trending tokens, analyzes with free AI (Groq), and executes trades based on AI confidence and minimum 150% upside potential. Works independently without requiring any buyback/burn projects.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

The frontend is built with React 18+, TypeScript, and Vite. It uses Wouter for routing, shadcn/ui (New York variant) on Radix UI primitives, and Tailwind CSS for styling, primarily in dark mode. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The design incorporates a "Fire/Molten" theme with volcanic black backgrounds, molten orange primaries, and ember accents. Key navigation includes Overview, New Project, Volume Bot, Trading Bot, AI Trading Bot, Transactions, and Settings. Manual controls for on-demand buybacks are available per project, requiring wallet signature authentication.

### Backend

The backend utilizes an Express.js server with TypeScript, employing an ESM module system and a RESTful API. It features centralized error handling, Zod schema validation, a storage abstraction layer, and a repository pattern for database operations.

### Scheduling System

A dedicated scheduler service automates buyback execution using `node-cron`. It performs hourly checks, validates payments (unless whitelisted), verifies treasury balances, integrates with Jupiter Ultra API for optimal token swaps, and claims PumpFun creator rewards. Token burns use the SPL Token burn instruction to permanently destroy tokens and reduce total supply (visible on Solscan as actual "Token Burn" transactions, not transfers). The system supports minute-based to weekly scheduling and custom cron patterns, operating in both production and simulation modes.

**Automation Requirements (Critical for Auto-Execution):**
1. **Project must be ACTIVE**: Toggle the "Active" switch ON in project dashboard
2. **Treasury private key REQUIRED**: Store via Settings → Private Key Management for automated swaps and burns
3. **PumpFun creator key OPTIONAL**: Store for automatic reward claims (otherwise claims remain pending)
4. **Sufficient SOL balance**: Treasury must have enough SOL to cover buyback amount + 0.01 SOL fee reserve
5. **Valid payment OR trial OR whitelisted wallet**: Automation only runs for paid/trial/whitelisted projects

**Scheduler Timing:**
- Development: Checks every 5 minutes for faster testing
- Production: Checks every hour for efficiency
- AI Bot: Every 5 minutes (dev) / 30 minutes (prod)

**Manual vs Automated Execution:**
- Manual: Uses connected wallet signatures (browser wallet interaction)
- Automated: Requires stored private keys in database (secure encrypted storage)

### Trading Bot System

The platform includes three types of automated trading bots with comprehensive configuration interfaces:

#### Volume Bot & Buy Bot (Project-Linked)
- **Volume Bot:** Executes buy/sell cycles to generate trading volume based on configurable buy amounts, sell percentages, trading intervals, and price guards (min/max SOL thresholds). Configuration UI at `/dashboard/volume-bot` allows users to enable/disable bots and set all parameters via dialog forms.
- **Buy Bot (Limit Orders):** Monitors token prices and executes buy orders when predefined SOL target prices are met, with configurable limit orders and max slippage protection. Configuration UI at `/dashboard/trading-bot` provides dynamic limit order management (add/remove orders) and max slippage settings.

#### AI Trading Bot (Standalone - Works Without Projects)
**Complete Independence:** The AI trading bot operates entirely independently without requiring any buyback/burn projects. Configuration stored in dedicated `aiBotConfigs` table keyed by wallet address.

**Configuration Management:**
- API Routes: `GET /api/ai-bot/config/:ownerWalletAddress`, `POST /api/ai-bot/config`, `DELETE /api/ai-bot/config/:ownerWalletAddress`
- Wallet signature authentication required for all config operations
- Stores encrypted treasury keys directly in AI bot config (separate from project secrets)

**Trading Logic:** Scans trending tokens from DexScreener, analyzes market data (volume, holders, price momentum, liquidity) using Groq's free Llama 3.3-70B AI, and executes buy orders ONLY when:
  - AI confidence ≥ 60%
  - Minimum 1.5X (150%) upside potential (hardcoded minimum)
  - Total budget not exhausted
  - Daily trade limit not reached
  
**Budget Management:** Total SOL budget allocation with real-time usage tracking. Prevents overspending by checking remaining budget before each trade and updating budget used after execution. Visual progress bars show budget consumption.
  
**Configurable Parameters:** Total budget (SOL), budget per trade, analysis interval, minimum volume threshold (USD), minimum potential upside (≥150%), daily trade limit, and risk tolerance (low/medium/high). Uses Jupiter Ultra API for trading execution (better routing and pricing). All completely free (Groq + DexScreener + Jupiter).

Price fetching for all bots uses Jupiter Price v3 API for SOL-denominated prices.

### Data Storage

PostgreSQL, accessed via Neon's serverless driver and Drizzle ORM, is used for data persistence. The schema includes `Projects`, `Transactions`, `Payments`, `UsedSignatures` (for replay attack prevention), `ProjectSecrets` (encrypted keys), and `AIBotConfigs` (standalone AI bot configuration).

**Key Schema Decisions:**
- UUID primary keys for all tables
- Decimal types for token amounts and SOL balances
- Automatic timestamps (createdAt, updatedAt)
- Boolean flags for status tracking
- Volume/Buy bot settings stored in `projects` table
- **AI bot settings stored in standalone `aiBotConfigs` table** (one config per wallet address)

**AI Bot Standalone Configuration (`aiBotConfigs`):**
- Keyed by `ownerWalletAddress` (unique constraint)
- Stores: enabled status, budget tracking (`totalBudget`, `budgetUsed`), per-trade budget, analysis interval, risk parameters
- Encrypted treasury keys stored directly in config (separate from project secrets)
- Independent lifecycle - not deleted when projects are deleted
- Budget validation occurs before every trade execution to prevent overspending

### Authentication & Authorization

Wallet-based authentication uses cryptographic signature verification via tweetnacl. Each authenticated request requires a signed message (action, project ID, timestamp) and signature validation against the owner's Solana wallet. The owner wallet address serves as the primary identifier, ensuring users can only manage their own projects. Solana Wallet Adapter is integrated for browser wallet connections (Phantom, Solflare).

### Security Infrastructure

The platform prioritizes user data protection with defense-in-depth security:
- **Rate Limiting & DDoS Protection:** Global, strict, and auth-specific rate limits with automatic IP-based blocking.
- **Security Headers:** Implemented via Helmet.js (HSTS, CSP, X-Frame-Options, X-Content-Type-Options).
- **Input Validation & Sanitization:** Automatic XSS vector removal, Solana address validation, request body size limits, Zod schema validation, and SQL injection prevention via Drizzle ORM.
- **Audit Logging:** Logs sensitive operations with IP addresses and timestamps (no sensitive data).
- **CORS & Request Security:** Production allows same-origin requests; development is relaxed.
- **Environment Variable Security:** Validates `ENCRYPTION_MASTER_KEY` and `SESSION_SECRET` on startup, blocking production deployment if critical variables are missing. `FRONTEND_URL` required in production for CORS security (exact origin matching).

**Required Production Environment Variables:**
1. `ENCRYPTION_MASTER_KEY` - ≥64 characters (32 bytes hex) for AES-256-GCM encryption
2. `SESSION_SECRET` - Session signing key
3. `FRONTEND_URL` - Production URL for CORS origin validation (e.g., https://burnbot.replit.app)
4. `DATABASE_URL` - PostgreSQL connection string (auto-provided by Neon)
5. `NODE_ENV=production` - Enables production security mode

### Production Readiness & Automated Workflow

The system supports secure encrypted key management, storing private keys encrypted in the database. A UI allows wallet signature-authenticated key storage/deletion. The automated workflow includes claiming PumpFun rewards, checking treasury and reward balances, executing optimal SOL to token swaps via Jupiter Ultra API, and burning tokens.

**Payment & Trial System:**
- On-chain SOL payment verification supports tier-based subscriptions
- **10-day free trial automatically granted to first 100 projects**
- Auto-grant mechanism: Scheduler detects projects without `trialEndsAt` and grants trial if within first 100 signups
- Whitelisted wallets bypass all payment requirements
- Trial status visible on project dashboard with days remaining
- After trial expiration, valid payment required for automation to continue

### Transaction Fee System

A 0.5% transaction fee applies to all transaction types (buybacks, volume bot, buy bot) after the first 60 free transactions per project. The fee is deducted from the SOL amount and sent to a designated treasury wallet.

## External Dependencies

**Blockchain Integration:**
- Solana Web3.js
- SPL Token program
- @solana/wallet-adapter-react, @solana/wallet-adapter-react-ui, @solana/wallet-adapter-base
- bs58
- tweetnacl

**Payment Processing:**
- 100% Solana-native payments (SOL only) to treasury wallet `jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38`.

**Third-Party Services:**
- Neon Database (PostgreSQL)
- Jupiter Ultra API (Swap API) - Used for all AI bot trades (buybacks, volume bot, buy bot use Jupiter)
- Jupiter Price API v3 (lite-api.jup.ag) - SOL-denominated prices via USD conversion
- PumpFun Lightning API (creator rewards only)
- Groq API (Llama 3.3-70B - free AI trading analysis, primary)
- xAI Grok API (grok-4-fast-reasoning - paid fallback if Groq unavailable)
- DexScreener API (free real-time token market data)

**UI Dependencies:**
- Radix UI
- Lucide React
- date-fns
- class-variance-authority, clsx, tailwind-merge

**Development Tools:**
- Vite
- TypeScript
- ESBuild
- node-cron
- cron-parser
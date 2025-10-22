# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview

BurnBot is a SaaS platform designed for Solana SPL token creators to automate token buyback and burn operations. It offers a no-code solution with a comprehensive dashboard for configuration, flexible scheduling (hourly, daily, weekly, custom cron), and transaction monitoring. The platform aims to provide a streamlined, automated, and verifiable burn mechanism to enhance tokenomics for Solana projects. Additionally, BurnBot includes trading bot features such as a Volume Bot for generating trading volume through automated buy/sell cycles and a Buy Bot for executing limit orders when target SOL prices are met.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

The frontend is built with React 18+, TypeScript, and Vite. It uses Wouter for routing, shadcn/ui (New York variant) on Radix UI primitives, and Tailwind CSS for styling, primarily in dark mode. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The design incorporates a "Fire/Molten" theme with volcanic black backgrounds, molten orange primaries, and ember accents. Key navigation includes Overview, New Project, Volume Bot, Trading Bot, Transactions, and Settings. Manual controls for on-demand buybacks are available per project, requiring wallet signature authentication.

### Backend

The backend utilizes an Express.js server with TypeScript, employing an ESM module system and a RESTful API. It features centralized error handling, Zod schema validation, a storage abstraction layer, and a repository pattern for database operations.

### Scheduling System

A dedicated scheduler service automates buyback execution using `node-cron`. It performs hourly checks, validates payments (unless whitelisted), verifies treasury balances, integrates with Jupiter Ultra API for optimal token swaps, and claims PumpFun creator rewards. All token burns are directed to the official Solana incinerator. The system supports minute-based to weekly scheduling and custom cron patterns, operating in both production and simulation modes.

### Trading Bot System

The platform includes automated trading bots with comprehensive configuration interfaces:
- **Volume Bot:** Executes buy/sell cycles to generate trading volume based on configurable buy amounts, sell percentages, trading intervals, and price guards (min/max SOL thresholds). Configuration UI at `/dashboard/volume-bot` allows users to enable/disable bots and set all parameters via dialog forms.
- **Buy Bot (Limit Orders):** Monitors token prices and executes buy orders when predefined SOL target prices are met, with configurable limit orders and max slippage protection. Configuration UI at `/dashboard/trading-bot` provides dynamic limit order management (add/remove orders) and max slippage settings.
- **AI Trading Bot:** AI-powered PumpFun token analysis and automated trading. Scans trending tokens from DexScreener, analyzes market data (volume, holders, price momentum, liquidity) using Groq's free Llama 3.3-70B AI (with xAI Grok fallback), and executes buy orders based on AI recommendations. Configurable parameters include budget per trade, analysis interval, minimum volume/potential thresholds, daily trade limits, and risk tolerance (low/medium/high). Uses PumpPortal API for trading execution. All completely free (Groq + DexScreener).

Price fetching for all bots uses Jupiter Price v3 API for SOL-denominated prices.

### Data Storage

PostgreSQL, accessed via Neon's serverless driver and Drizzle ORM, is used for data persistence. The schema includes `Projects`, `Transactions`, `Payments`, and `UsedSignatures` (for replay attack prevention). Key decisions include UUID primary keys, decimal types for token amounts, automatic timestamps, and boolean flags for status. Trading bot settings are stored directly in the `projects` table.

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

The system supports secure encrypted key management, storing private keys encrypted in the database. A UI allows wallet signature-authenticated key storage/deletion. The automated workflow includes claiming PumpFun rewards, checking treasury and reward balances, executing optimal SOL to token swaps via Jupiter Ultra API, and burning tokens. On-chain SOL payment verification supports tier-based subscriptions and a 10-day trial period, with whitelisted wallets bypassing payment requirements.

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
- Jupiter Ultra API (Swap API)
- Jupiter Price API v3 (lite-api.jup.ag) - SOL-denominated prices via USD conversion
- PumpFun Lightning API & PumpPortal Trading API
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
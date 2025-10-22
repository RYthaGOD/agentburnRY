# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview

BurnBot is a SaaS platform providing automated token buyback and burn functionality for Solana SPL tokens. It enables token creators to schedule and execute buyback operations that automatically purchase tokens from the market and send them to the Solana incinerator, reducing the total supply. The platform offers a no-code solution with a comprehensive dashboard for configuration, scheduling (hourly, daily, weekly, or custom cron), and transaction monitoring. Its core ambition is to offer a streamlined, automated, and verifiable burn mechanism to enhance tokenomics for Solana projects.

**NEW: Trading Bot Features** - Volume Bot for automated buy/sell cycles to generate trading volume, and Buy Bot for limit order execution when price reaches target SOL levels.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built with React 18+ and TypeScript, utilizing Vite for fast development and optimized builds. Wouter handles client-side routing. The UI is designed with shadcn/ui (New York variant) on Radix UI primitives, styled with Tailwind CSS for a crypto/SaaS aesthetic, primarily dark mode. TanStack Query manages server state and caching, while React Hook Form with Zod provides form validation. Key design decisions include component aliases, mobile responsiveness, and specific font choices (Inter and JetBrains Mono).

**Navigation Structure:** Left sidebar with dedicated pages:
- Overview: Dashboard with all projects
- New Project: Project creation form
- Volume Bot: Manage volume generation bots across all projects
- Trading Bot: Manage limit order bots across all projects
- Transactions: View all transactions
- Settings: Wallet key management

**Fire/Molten Theme Design:** The platform features a bold fire and molten rock visual theme that conveys the concept of token burning through intense heat and destruction imagery:
- **Color Palette:** Volcanic black backgrounds (15 20% 6%), molten orange primary (18 95% 55%), ember accent (35 100% 50%), deep red secondary (0 85% 48%)
- **Visual Elements:** Fire gradient buttons, ember glow effects on interactive elements, molten lava hero background, orange-tinted hover/active states
- **Custom Utilities:** `.fire-gradient` (molten orange to hot yellow), `.ember-glow` and `.ember-glow-hover` (orange box shadows), elevation system with orange overlays
- **Assets:** BurnBot fire logo and molten lava hero background generated specifically for the fire theme

**Manual Controls:** Each project has a manual controls section with an "Execute Buyback Now" button that allows users to trigger buybacks on-demand without waiting for the scheduled execution. This requires wallet signature authentication.

### Backend Architecture

The backend uses an Express.js server with TypeScript, employing an ESM module system. It features a RESTful API under `/api`, organized by resource, with centralized error handling and Zod schema validation. Core architectural patterns include a storage abstraction layer, repository pattern for database operations, and a dedicated scheduler service for automated buyback execution.

### Scheduling System

A dedicated scheduler service (`server/scheduler.ts`) automates buyback execution using `node-cron`. It performs hourly checks, validates payments (unless wallet is whitelisted), verifies treasury balances, integrates with Jupiter Ultra API for optimal token swaps, and claims PumpFun creator rewards. All token burns are routed through the official Solana incinerator (`1nc1nerator11111111111111111111111111111111`). The system supports both production mode with real transaction execution and a simulation mode for testing.

**Schedule Intervals:** The platform supports minute-based to weekly scheduling:
- Every 5 minutes: Executes at 0, 5, 10, 15, 20, etc.
- Every 10 minutes: Executes at 0, 10, 20, 30, 40, 50
- Every 30 minutes: Executes at 0 and 30 minutes
- Hourly: Top of every hour
- Daily: Midnight UTC
- Weekly: Sunday midnight UTC
- Custom cron: User-defined patterns

### Trading Bot System

The platform now includes automated trading bots for volume generation and limit order execution (`server/trading-bot.ts`):

**Volume Bot:**
- Automatically executes buy/sell cycles to generate trading volume
- Configurable buy amount (SOL), sell percentage (0-100%), and trading interval (minutes)
- Price guards: Only trades if token price is within configured min/max SOL thresholds
- Each cycle: Buy tokens with SOL → Wait for interval → Sell configured % back to SOL
- Records all trades as transactions in the database

**Buy Bot (Limit Orders):**
- Monitors token price and executes buy orders when price reaches target levels
- Configurable limit orders as JSON array: `[{"priceSOL": "0.001", "amountSOL": "0.1"}]`
- Max slippage protection (0-100%)
- Checks price every scheduler run (hourly) and executes matching orders
- Uses Jupiter Ultra API for optimal swap execution

**Price Fetching:**
- Jupiter Price v4 API with `vsToken=So11111111111111111111111111111111111111112` parameter
- Returns SOL-denominated prices (not USD) for accurate price comparisons
- Volume bot price guards and buy bot limit orders compare against SOL prices

### Data Storage

PostgreSQL, accessed via Neon's serverless driver and Drizzle ORM, is used for data persistence. The schema includes `Projects`, `Transactions`, `Payments`, and `UsedSignatures` tables with defined relationships. The `UsedSignatures` table prevents replay attacks on manual buyback executions by storing SHA-256 hashes of used signatures. Key database decisions involve using UUID primary keys, decimal types for token amounts, automatic timestamp fields, and boolean flags for status management.

**Trading Bot Storage:**
- Volume bot settings: `volumeBotEnabled`, `volumeBotBuyAmountSOL`, `volumeBotSellPercentage`, `volumeBotMinPriceSOL`, `volumeBotMaxPriceSOL`, `volumeBotIntervalMinutes`
- Buy bot settings: `buyBotEnabled`, `buyBotLimitOrders` (JSON text), `buyBotMaxSlippage`
- All fields stored directly in `projects` table with appropriate types (boolean, decimal, integer, text)

### Authentication & Authorization

The platform utilizes wallet-based authentication for manual buyback execution and key management. The system implements cryptographic signature verification using tweetnacl to prove wallet ownership. Each authenticated request requires:
- A signed message containing the action, project ID, and timestamp
- Signature verification using the owner's Solana wallet
- Timestamp validation (5-minute window)
- Replay attack prevention via signature hash storage

The owner wallet address serves as the primary user identifier for project management and authorization.

**Wallet Integration:** Solana Wallet Adapter is fully integrated and production-ready. The system uses `@solana/wallet-adapter-react` with WalletProvider for browser wallet connections (Phantom, Solflare) and real cryptographic message signing for authentication.

**Project Privacy & Security:** All projects are filtered by owner wallet address. Users can only view, edit, and manage their own projects. The frontend queries `/api/projects/owner/:walletAddress` which returns only projects where `ownerWalletAddress` matches the connected wallet. This ensures complete data isolation between users.

### Production Readiness & Automated Workflow

The system features full automation with secure encrypted key management. This includes:
- **Secure Key Storage:** Private keys encrypted using AES-256-GCM with per-key IV and authentication tags
- **Key Management UI:** Settings page with wallet signature-authenticated key storage/deletion
- **Automated Workflow:** Claims PumpFun rewards, checks combined treasury and reward balances, executes optimal SOL to token swaps via Jupiter Ultra API, and burns tokens to the Solana incinerator
- **On-chain Payment Verification:** SOL payment verification system with tier-based subscriptions
- **Security Features:** 5-minute in-memory cache, HMAC fingerprints for change detection, no key logging or exposure

**Private Key Management:** Keys are stored encrypted in the `project_secrets` database table and retrieved on-demand by the scheduler. The master encryption key (`ENCRYPTION_MASTER_KEY`) must be set in production. Previous environment variable approach (`TREASURY_KEY_<project-id>`) has been replaced with encrypted database storage.

**Production Deployment Requirements:**
1. Set `ENCRYPTION_MASTER_KEY` environment variable (32-byte hex key) - See PRODUCTION_DEPLOYMENT_GUIDE.md
2. Verify wallet connection works on production URL
3. Test key management workflow with real wallet signatures
4. Confirm scheduler is enabled in production mode

**Production Status**: ✅ READY FOR DEPLOYMENT - All core features implemented and tested. See PRODUCTION_READINESS_CHECKLIST.md for final verification steps.

### Transaction Fee System

A 0.5% transaction fee applies after the 60th transaction for each project:
- **Free Transactions:** First 60 transactions per project are free
- **Fee Rate:** 0.5% of SOL amount on every transaction after 60th
- **Fee Destination:** Sent to payment address (TREASURY_WALLET_ADDRESS)
- **Applied To:** All transaction types (buybacks, volume bot, buy bot)
- **Accurate Tracking:** All transaction records and volume metrics reflect fee-adjusted amounts
- **Graceful Handling:** Continues execution even if fee payment fails

**Implementation:** `server/transaction-fee.ts` with `deductTransactionFee()` function integrated into scheduler buybacks, volume bot, and buy bot execution paths.

## External Dependencies

**Blockchain Integration:**
- Solana Web3.js for blockchain interactions
- SPL Token program for token operations
- @solana/wallet-adapter-react for wallet connection hooks
- @solana/wallet-adapter-react-ui for pre-built wallet UI components
- @solana/wallet-adapter-base for wallet adapter infrastructure

**Payment Processing:**
- **100% Solana-native payments** - All payments in SOL only
- Direct Solana wallet payments to treasury wallet: `jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38`
- On-chain payment verification for SOL payments
- Tier pricing: Starter (0.2 SOL / 30 days), Pro (0.4 SOL / 30 days)
- **10-Day Trial Period:** First 100 signups automatically receive 10-day free trial
  - Trial badge displays in UI: "Trial: X days left"
  - Full platform access during trial (buybacks, burns, claims, scheduling)
  - Trial tracked via `projects.trialEndsAt` timestamp field
  - After trial expires, payment required to continue
- **Payment Enforcement:** Projects cannot be activated without valid payment or active trial (unless whitelisted)
  - Frontend shows payment modal when users without trial/payment try to activate
  - Backend validates payment OR trial on project update (PATCH /api/projects/:id)
  - Scheduler only runs for whitelisted, trial, or paid projects
- **Whitelisted Wallets:** Owner wallets can be whitelisted in `shared/config.ts` for free platform access (bypasses payment requirements)
  - Current whitelisted wallets: `4D5a61DsihdeEV2SbfkpYsZemTrrczxAwyBfR47xF5uS`, `jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38`, `5PsB7jYtDy6DP3tt5EUuDBSh8skKNkNJiUuNpPRV3Xrf`, `924yATAEdnrYmncJMX2je7dpiEfVRqCSPmQ2NK3QfoXA`
  - Whitelisted projects display "Free Access" badge with crown icon in UI
- **No Stripe integration** - Fully removed from codebase

**Third-Party Services:**
- Neon Database (PostgreSQL hosting)
- Jupiter Ultra API for optimal token swaps
- PumpFun Lightning API for claiming creator rewards

**UI Dependencies:**
- Radix UI component primitives
- Lucide React (icon library)
- date-fns
- class-variance-authority, clsx, tailwind-merge

**Development Tools:**
- Vite
- TypeScript
- ESBuild

**Installed Dependencies:**
- node-cron (automated scheduling)
- cron-parser (schedule validation)
- @solana/web3.js (blockchain interactions)
- @solana/spl-token (token operations)
- @solana/wallet-adapter-react (wallet hooks)
- @solana/wallet-adapter-react-ui (wallet UI components)
- @solana/wallet-adapter-base (wallet infrastructure)
- bs58 (base58 encoding/decoding)
- tweetnacl (cryptographic signatures)
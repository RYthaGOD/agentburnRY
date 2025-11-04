# GigaBrain Agent Burn System - Solana x402 Hackathon Submission

## Overview
GigaBrain is an autonomous deflationary token burn system built for the Solana x402 Hackathon. It leverages x402 micropayments ($0.005 USDC per premium data feed) to enable AI-powered decision-making for token burn operations. The system features on-chain Anchor/Rust programs, DeepSeek V3 AI analysis, Jito BAM (Bundle Auction Market) for MEV protection, and a no-code configuration dashboard.

**Hackathon Focus**: Demonstrate how x402's agent economy enables autonomous financial operations with premium data feeds, combining AI decision-making with decentralized execution.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture (Refactored for x402 Hackathon)

### Frontend
Built with React 18+, TypeScript, Vite, Wouter for routing, shadcn/ui (New York variant) on Radix UI, and Tailwind CSS (dark mode). Uses TanStack Query for server state management and React Hook Form with Zod for validation. Features a streamlined dashboard focused on agent burn configuration and monitoring.

### Backend
Express.js server in TypeScript with ESM module system, RESTful API, centralized error handling, Zod schema validation, storage abstraction layer, and repository pattern. Simplified to support only agent burn operations.

### Core Hackathon Features

#### 1. Agent Burn System
- **AI Decision-Making**: DeepSeek V3 analyzes token metrics (market cap, liquidity, sentiment, volume trends) to determine optimal burn percentage
- **x402 Micropayments**: Premium data feeds (DexScreener, Jupiter, PumpFun) accessed via $0.005 USDC x402 payments
- **On-Chain Programs**: Anchor/Rust programs on Solana for trustless burn execution
- **Jito BAM Integration**: Bundle Auction Market for MEV protection and guaranteed execution
- **Configurable Criteria**: Users set confidence thresholds, max burn percentages, and sentiment requirements

#### 2. x402 Service Integration
- **Automated Payments**: System automatically pays x402 micropayments for premium API access
- **Transaction Tracking**: All x402 payments logged in database with detailed analytics
- **Agent Economy**: Demonstrates autonomous AI agents paying for premium data feeds

#### 3. Jito BAM Bundle System
- **Bundle Creation**: Groups swap + burn transactions into atomic bundles
- **Priority Fees**: Optimized tip amounts for block inclusion
- **Status Tracking**: Real-time bundle status monitoring (pending, landed, failed)
- **MEV Protection**: Prevents front-running and sandwich attacks

### Database Schema (Simplified for Hackathon)

**Core Tables:**
- `projects`: Burn configurations with AI criteria (agentBurnEnabled, aiConfidenceThreshold, maxBurnPercentage, requirePositiveSentiment)
- `transactions`: Burn history (swap, burn, claim operations)
- `x402Micropayments`: x402 payment tracking (premium data feed access logs)
- `bamBundles`: Jito BAM bundle tracking (bundleId, status, tipAmount, transactionSignatures)
- `agentBurns`: Complete agent burn execution logs (AI decisions, execution results, profitability metrics)
- `projectSecrets`: Encrypted private keys for automated execution
- `usedSignatures`: Replay attack prevention (SHA-256 hashed signatures for wallet authentication)

**Removed Tables** (Legacy trading bot functionality removed for hackathon focus):
- ❌ aiBotConfigs
- ❌ aiBotPositions
- ❌ hivemindStrategies
- ❌ tokenBlacklist
- ❌ tradeJournal
- ❌ aiRecoveryMode
- ❌ payments (trial/subscription system)

### Scheduling System
`node-cron` service for automated burn execution checks (every 5 minutes in development, hourly in production). Checks `agenticBurnEnabled` flag and executes burns based on configured criteria.

### Data Storage
PostgreSQL via Neon's serverless driver and Drizzle ORM, with UUID primary keys, decimal types, and automatic timestamps.

### Authentication & Authorization
Wallet-based authentication using cryptographic signature verification via tweetnacl and Solana Wallet Adapter.

### Security Infrastructure
Defense-in-depth security: rate limiting, DDoS protection, security headers (Helmet.js), input validation, replay attack prevention (via `usedSignatures` table), and audit logging.

### x402 Implementation Pattern

**Agent-Pays Model** (Different from Traditional x402):
GigaBrain implements the "agent-pays" x402 pattern, where AI agents autonomously pay for services, rather than the traditional "user-pays" HTTP 402 Payment Required flow.

**Traditional x402 Flow** (User-Pays):
1. User requests protected resource
2. Server responds `HTTP 402 Payment Required` with payment requirements
3. User makes payment and retries with `X-PAYMENT` header
4. Server verifies payment and returns content

**GigaBrain's Agent-Pays Flow** (Autonomous):
1. AI agent needs premium data (oracle, data feeds, burn execution)
2. Agent autonomously creates and signs USDC payment transaction
3. Agent sends payment on-chain and tracks via `x402Micropayments` table
4. Agent proceeds with operation using premium data

**Key Differences:**
- **No HTTP 402 responses**: Agent knows prices and pays proactively
- **Server-side payments**: Agent wallet managed by backend for autonomy
- **Batch tracking**: All x402 payments logged for analytics and cost tracking
- **Safety limits**: `X402_MAX_PAYMENT_AMOUNT` prevents runaway costs

**Configuration** (Environment Variables):
- `X402_FACILITATOR_URL`: Optional facilitator for mainnet fee abstraction
- `X402_MAX_PAYMENT_AMOUNT`: Maximum USDC per payment (default: 1.0)
- `X402_COOKIE_NAME`: Session cookie name (default: x402_session)
- `X402_COOKIE_MAX_AGE`: Cookie lifetime in seconds (default: 86400)

## External Dependencies

**Blockchain Integration:**
- Solana Web3.js
- SPL Token program
- @solana/wallet-adapter suite
- bs58
- tweetnacl

**Hackathon-Specific:**
- x402 SDK for micropayments
- Jito BAM SDK for bundle submission

**Third-Party Services:**
- Neon Database (PostgreSQL)
- Jupiter Ultra API (Swap API)
- Jupiter Price API v3
- Jupiter Token API v2 (Token Discovery)
- PumpFun Lightning API
- DexScreener API
- **AI Provider:**
    - DeepSeek V3 (Free tier - 5M tokens monthly, advanced reasoning)

## Recent Major Refactoring (November 2025)

**Removed ALL Legacy Trading Bot Code:**
- Deleted 8 server files: ai-bot-scheduler, grok-analysis, hivemind-strategy, volume-bot, trading-bot, etc.
- Removed 6 database tables related to trading bot functionality
- Simplified server/routes.ts from 3,586 lines to ~350 lines (agent burn endpoints only)
- Removed frontend pages: ai-bot.tsx, trading-bot.tsx, volume-bot.tsx
- Updated App.tsx to remove trading bot routes
- Focused exclusively on x402 agent burn hackathon demo

**Hackathon Demo Focus:**
The system now exclusively demonstrates the x402 agent economy through autonomous burn operations:
1. User configures burn criteria via dashboard
2. AI agent (DeepSeek V3) analyzes token using x402-paid premium data
3. AI determines optimal burn percentage based on criteria
4. System executes swap + burn via Jito BAM bundle
5. All operations logged with detailed analytics

## Demo Script
See `VIDEO_DEMO_SCRIPT.md` for complete 3-minute video demo guide.

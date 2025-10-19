# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview

BurnBot is a SaaS platform providing automated token buyback and burn functionality for Solana SPL tokens. It enables token creators to schedule and execute buyback operations that automatically purchase tokens from the market and send them to the Solana incinerator, reducing the total supply. The platform offers a no-code solution with a comprehensive dashboard for configuration, scheduling (hourly, daily, weekly, or custom cron), and transaction monitoring. Its core ambition is to offer a streamlined, automated, and verifiable burn mechanism to enhance tokenomics for Solana projects.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built with React 18+ and TypeScript, utilizing Vite for fast development and optimized builds. Wouter handles client-side routing. The UI is designed with shadcn/ui (New York variant) on Radix UI primitives, styled with Tailwind CSS for a crypto/SaaS aesthetic, primarily dark mode. TanStack Query manages server state and caching, while React Hook Form with Zod provides form validation. Key design decisions include component aliases, mobile responsiveness, and specific font choices (Inter and JetBrains Mono).

### Backend Architecture

The backend uses an Express.js server with TypeScript, employing an ESM module system. It features a RESTful API under `/api`, organized by resource, with centralized error handling and Zod schema validation. Core architectural patterns include a storage abstraction layer, repository pattern for database operations, and a dedicated scheduler service for automated buyback execution.

### Scheduling System

A dedicated scheduler service (`server/scheduler.ts`) automates buyback execution using `node-cron`. It performs hourly checks, validates payments, verifies treasury balances, integrates with Jupiter Ultra API for optimal token swaps, and claims PumpFun creator rewards. All token burns are routed through the official Solana incinerator (`1nc1nerator11111111111111111111111111111111`). The system supports both production mode with real transaction execution and a simulation mode for testing.

### Data Storage

PostgreSQL, accessed via Neon's serverless driver and Drizzle ORM, is used for data persistence. The schema includes `Projects`, `Transactions`, `Payments`, and `UsedSignatures` tables with defined relationships. The `UsedSignatures` table prevents replay attacks on manual buyback executions by storing SHA-256 hashes of used signatures. Key database decisions involve using UUID primary keys, decimal types for token amounts, automatic timestamp fields, and boolean flags for status management.

### Authentication & Authorization

The platform utilizes wallet-based authentication for manual buyback execution and key management. The system implements cryptographic signature verification using tweetnacl to prove wallet ownership. Each authenticated request requires:
- A signed message containing the action, project ID, and timestamp
- Signature verification using the owner's Solana wallet
- Timestamp validation (5-minute window)
- Replay attack prevention via signature hash storage

The owner wallet address serves as the primary user identifier for project management and authorization.

**Production Requirement:** Solana Wallet Adapter integration is required before production deployment. See `WALLET_INTEGRATION_GUIDE.md` for implementation steps. Current wallet signing uses placeholder implementation that must be replaced with real wallet signatures.

### Production Readiness & Automated Workflow

The system features full automation with secure encrypted key management. This includes:
- **Secure Key Storage:** Private keys encrypted using AES-256-GCM with per-key IV and authentication tags
- **Key Management UI:** Settings page with wallet signature-authenticated key storage/deletion
- **Automated Workflow:** Claims PumpFun rewards, checks combined treasury and reward balances, executes optimal SOL to token swaps via Jupiter Ultra API, and burns tokens to the Solana incinerator
- **On-chain Payment Verification:** SOL payment verification system with tier-based subscriptions
- **Security Features:** 5-minute in-memory cache, HMAC fingerprints for change detection, no key logging or exposure

**Private Key Management:** Keys are stored encrypted in the `project_secrets` database table and retrieved on-demand by the scheduler. The master encryption key (`ENCRYPTION_MASTER_KEY`) must be set in production. Previous environment variable approach (`TREASURY_KEY_<project-id>`) has been replaced with encrypted database storage.

**Pre-Production Requirements:**
1. Set `ENCRYPTION_MASTER_KEY` environment variable (32-byte hex key)
2. Integrate Solana Wallet Adapter for real wallet signatures (see `WALLET_INTEGRATION_GUIDE.md`)
3. Test complete key management flow with real wallet on devnet
4. Verify automated scheduler can decrypt and use stored keys

## External Dependencies

**Blockchain Integration:**
- Solana Web3.js for blockchain interactions
- SPL Token program for token operations
- @solana/wallet-adapter-react for wallet connection (planned)

**Payment Processing:**
- **100% Solana-native payments** - All payments in SOL only
- Direct Solana wallet payments to treasury wallet: `jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38`
- On-chain payment verification for SOL payments
- Tier pricing: Starter (0.2 SOL), Pro (0.4 SOL)
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
- node-cron
- cron-parser
- @solana/web3.js
- @solana/spl-token
- bs58
- tweetnacl
# BurnBot - Solana Token Buyback & Burn SaaS Platform

## Overview

BurnBot is a SaaS platform that provides automated token buyback and burn functionality for Solana SPL tokens. The platform allows token creators to set up scheduled buyback operations that automatically purchase tokens from the market and burn them, reducing total supply. Users can configure schedules (hourly, daily, weekly, or custom cron expressions), specify buyback amounts, and monitor all transactions through a comprehensive dashboard.

The application is designed as a no-code solution requiring only wallet connection and basic configuration to operate.

## User Preferences

Preferred communication style: Simple, everyday language.

## Payment Configuration

**Treasury Wallet**: `jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38`
- All service payments (SOL or USDC) are sent to this wallet address

**Pricing**: 0.2 SOL or 0.2 USDC per month for all tiers (Starter, Pro, Enterprise)
- Unified pricing across all service tiers
- Payment flexibility with SOL or USDC options

## Burn Mechanism

**Solana Incinerator**: `1nc1nerator11111111111111111111111111111111`
- All token burns are routed through the official Solana incinerator
- This is a program-owned account that permanently destroys tokens
- Tokens sent to this address cannot be recovered
- The burn address field in the project creation form is pre-filled and read-only
- This provides a standardized, verifiable burn mechanism for all projects

## System Architecture

### Frontend Architecture

**Framework & Build System**
- React 18+ with TypeScript for type-safe component development
- Vite as the build tool and development server for fast HMR and optimized production builds
- Wouter for lightweight client-side routing (landing page, dashboard, project creation, transactions, settings)

**UI Component System**
- shadcn/ui (New York variant) built on Radix UI primitives for accessible, unstyled components
- Tailwind CSS with custom design tokens following crypto/SaaS aesthetic (dark mode primary)
- Custom theme system supporting dark/light modes with CSS variables
- Design follows hybrid approach: marketing pages draw from modern crypto/SaaS aesthetics while dashboard uses utility-focused design for clarity

**State Management & Data Fetching**
- TanStack Query (React Query) for server state management, caching, and synchronization
- Custom query client with centralized API request handling
- React Hook Form with Zod validation for form state and validation

**Key Design Decisions**
- Component aliases configured via TypeScript paths for clean imports (`@/components`, `@/lib`, etc.)
- Dark mode as default theme with optional light mode toggle
- Mobile-responsive design with dedicated mobile breakpoint hooks
- Inter font for UI text, JetBrains Mono for addresses/hashes

### Backend Architecture

**Server Framework**
- Express.js server with TypeScript
- ESM module system throughout the codebase
- Custom Vite integration for development HMR and production static serving

**API Design**
- RESTful API structure under `/api` prefix
- Routes organized by resource (projects, transactions, payments)
- Centralized error handling middleware
- Request/response logging for API endpoints
- Zod schema validation on incoming requests with friendly error messages (using zod-validation-error)

**Key Architectural Patterns**
- Storage abstraction layer (IStorage interface) separating business logic from data access
- Repository pattern implementation for database operations
- Scheduler service for automated buyback execution (placeholder awaiting node-cron installation)

**Scheduling System**
- Dedicated scheduler service (`server/scheduler.ts`) for automated buyback execution
- Designed to run cron jobs checking for scheduled buybacks hourly
- Currently disabled in development mode, enabled only in production
- Placeholder implementation pending node-cron package installation
- Burns route through Solana incinerator (1nc1nerator11111111111111111111111111111111)
- Jupiter aggregator integration planned for optimal token swap pricing

### Data Storage

**Database**
- PostgreSQL via Neon serverless driver with WebSocket support
- Drizzle ORM for type-safe database queries and schema management
- Database migrations managed through Drizzle Kit

**Schema Design**
- **Projects Table**: Stores buyback project configuration including token mint address, treasury wallet, burn address, schedule settings, and ownership
- **Transactions Table**: Records all buyback and burn operations with signatures, amounts, status, and error messages
- **Payments Table**: Tracks service tier payments with verification status and expiration

**Relations**
- Projects have one-to-many relationships with both transactions and payments
- All foreign key constraints properly defined with references

**Key Database Decisions**
- UUID primary keys using PostgreSQL's `gen_random_uuid()` for distributed-friendly IDs
- Decimal types (precision 18, scale 9) for token amounts to ensure accuracy
- Timestamp fields with automatic `defaultNow()` for audit trails
- Boolean flags for active/inactive states and payment verification

### Authentication & Authorization

**Current Implementation**
- Wallet-based authentication placeholder (WalletButton component)
- Designed for Solana wallet adapter integration (packages not yet installed)
- Owner wallet address stored with projects for authorization

**Planned Integration**
- @solana/wallet-adapter-react for wallet connection
- Client-side wallet signature verification
- Wallet address used as user identifier

### External Dependencies

**Blockchain Integration (Planned)**
- Solana Web3.js for blockchain interactions
- SPL Token program for token operations
- Wallet adapters for Phantom, Solflare, and other Solana wallets

**Payment Processing**
- Direct Solana wallet payments (SOL or USDC) to treasury address
- On-chain payment verification for SOL/USDC payments
- Pricing configuration centralized in `shared/config.ts`
- Treasury wallet: jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38

**Third-Party Services**
- Neon Database for PostgreSQL hosting with serverless architecture
- WebSocket connections via ws package for real-time database connectivity

**UI Dependencies**
- Radix UI component primitives for accessible, unstyled base components
- Lucide React for icon library
- date-fns for date formatting and manipulation
- class-variance-authority and clsx/tailwind-merge for className composition

**Development Tools**
- Replit-specific plugins for runtime error overlay, cartographer, and dev banner (development only)
- TypeScript for static type checking
- ESBuild for production backend bundling

**Notable Missing Dependencies**
- node-cron (needed for scheduler implementation)
- @solana/web3.js and @solana/wallet-adapter packages (needed for blockchain interactions)
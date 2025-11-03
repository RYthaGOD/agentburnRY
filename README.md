# 🤖 GigaBrain AI Trading Bot

> **Autonomous AI Trading with x402 Micropayments and On-Chain Burns**

GigaBrain is an AI-powered trading bot for Solana that autonomously trades tokens, detects profit opportunities, and executes token burns using **x402 micropayments** for service fees. Built with **DeepSeek V3 AI** (free tier - 5M tokens/day), it features autonomous decision-making with zero human intervention.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)
[![Solana](https://img.shields.io/badge/Solana-Devnet-blueviolet)](https://explorer.solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.29.0-blue)](https://www.anchor-lang.com/)

---

## 🌟 Key Features

### 🧠 **DeepSeek V3 AI Decision Making**
- Free tier with 5M tokens monthly (no API costs!)
- Superior reasoning for technical analysis
- Continuous position monitoring (1-minute intervals)
- Multi-strategy trading (SCALP, SWING, Mean Reversion)

### 💳 **x402 Micropayment Integration**
- **HTTP 402 Payment Required** protocol for agent-to-agent commerce
- $0.005 USDC per burn execution service
- Autonomous USDC transfers (no human approval needed)
- On-chain payment verification

### 🔥 **Autonomous Token Burns**
- Configurable profit thresholds (e.g., burn at 10% profit)
- Percentage-based burn amounts (e.g., 25% of profits)
- On-chain burn execution via Anchor program
- SPL token support with MEV protection

### 🛡️ **Safety Features**
- Loss prediction AI (blocks trades with >85% loss probability)
- Portfolio drawdown circuit breaker
- Dynamic tiered stop-losses (4 levels)
- Liquidity verification (prevents rug pulls)

---

## 📁 Repository Structure

```
gigabrain/
├── programs/              # Anchor/Rust on-chain programs
│   └── gigabrain-burn/   
│       ├── src/
│       │   └── lib.rs    # SPL token burn program
│       ├── Cargo.toml
│       └── Xargo.toml
│
├── scripts/              # x402 JavaScript integration
│   ├── x402-agent.js     # Autonomous agent (payment + burn)
│   ├── initialize.js     # Initialize burn configuration
│   └── deploy.sh         # Deploy to devnet
│
├── tests/                # Simulations and tests
│   └── simulations/
│       └── burn-simulation.test.js
│
├── server/               # Full-stack application backend
├── client/               # React frontend (trading dashboard)
├── shared/               # Shared types/schemas
│
├── Anchor.toml           # Anchor configuration
├── LICENSE.md            # MIT License
└── README.md             # This file
```

---

## 🚀 Quick Start

### Prerequisites

1. **Rust & Anchor**
   ```bash
   # Install Rust
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   
   # Install Solana CLI
   sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
   
   # Install Anchor
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install latest
   avm use latest
   ```

2. **Node.js** (v18+)
   ```bash
   npm install
   ```

3. **Solana Wallet**
   ```bash
   # Generate a new wallet (or use existing)
   solana-keygen new --outfile ~/.config/solana/id.json
   
   # Get devnet SOL
   solana airdrop 2 --url devnet
   ```

---

## ⚙️ Setup & Deployment

### 1. Deploy Anchor Program to Devnet

```bash
# Run automated deployment script
./scripts/deploy.sh
```

This script will:
- ✅ Build the Anchor program
- ✅ Generate program ID
- ✅ Update `Anchor.toml` and `lib.rs` with actual ID
- ✅ Deploy to Solana devnet
- ✅ Show explorer link

**Expected Output:**
```
✅ Deployment Complete!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Deployment Info:
   Network: Devnet
   Program ID: AbC123...XyZ789
   Explorer: https://explorer.solana.com/address/AbC123...XyZ789?cluster=devnet
```

### 2. Configure Environment Variables

```bash
# Set program ID from deployment
export PROGRAM_ID=<your_program_id_from_deploy>

# Configure wallet path (if non-default)
export WALLET_PATH=~/.config/solana/id.json

# Optional: Use custom RPC endpoint
export SOLANA_RPC_URL=https://api.devnet.solana.com
```

### 3. Initialize Burn Configuration

```bash
# Initialize burn rules for a token
node scripts/initialize.js <TOKEN_MINT_ADDRESS>

# Example with default test mint
node scripts/initialize.js 11111111111111111111111111111111
```

**Configuration Options:**
- `profitThreshold`: Minimum profit to trigger burn (basis points, e.g., 1000 = 10%)
- `burnPercentage`: Percent of profits to burn (0-10000 = 0-100%)
- `minBurnAmount`: Minimum token amount per burn

---

## 🎯 Usage

### Run Autonomous Agent

```bash
# Start the autonomous trading + burn agent
node scripts/x402-agent.js
```

**What the Agent Does:**

1. **🎯 Monitors Profits**
   - Continuously checks trading performance
   - Detects when profit threshold is met (e.g., 10% profit)

2. **💳 Executes x402 Payment**
   - Automatically pays $0.005 USDC for burn service
   - No human approval needed
   - Transaction confirmed on-chain

3. **🔥 Executes Token Burn**
   - Calls Anchor program to burn tokens
   - Burns configured percentage of profits (e.g., 25%)
   - Updates burn statistics on-chain

**Example Output:**
```
🤖 GigaBrain x402 Autonomous Agent Starting...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Configuration:
   Network: Devnet
   Wallet: 7xK...3mN
   Program: AbC123...XyZ789
   x402 Fee: $0.005 USDC per burn

🎯 Profit Threshold Met: 1000 basis points
   Autonomous burn triggered!

💳 Creating x402 payment: $0.005 USDC
✅ x402 Payment Confirmed: 5k3...d8j
   Amount: $0.005 USDC
   Treasury: jaw...G38

🔥 Executing Autonomous Burn...
   Token: So1...tkn
   Amount: 2500000
   Profit: 1500

✅ Burn Transaction: 2hB...9pL

✅ Autonomous Burn Complete!
   x402 Payment: 5k3...d8j
   Burn Transaction: 2hB...9pL
```

---

## 🧪 Testing

### Run Simulation Tests

```bash
# Install test dependencies
npm install --save-dev mocha chai

# Run burn simulation tests
npm test
```

**Test Coverage:**
- ✅ Profit threshold detection
- ✅ Burn amount calculation
- ✅ x402 payment verification
- ✅ PDA derivation
- ✅ End-to-end autonomous flow

---

## 📖 How It Works

### The Autonomous Burn Flow

```
┌─────────────────────────────────────────────────────┐
│  1. AI TRADING BOT (DeepSeek V3)                   │
│     - Monitors positions every 1 minute             │
│     - Detects profit threshold met (e.g., +10%)    │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  2. x402 MICROPAYMENT                               │
│     - Agent creates USDC transfer ($0.005)          │
│     - Sends to treasury wallet                      │
│     - Confirms on-chain (HTTP 402 Payment Required) │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  3. ON-CHAIN BURN (Anchor Program)                  │
│     - Verifies payment signature                    │
│     - Checks profit threshold                       │
│     - Executes SPL token burn                       │
│     - Updates statistics (total burned, count)      │
└─────────────────────────────────────────────────────┘
```

### x402 Protocol Integration

**x402** (HTTP 402 Payment Required) enables autonomous agent-to-agent payments:

- **Agent 1 (GigaBrain AI)**: Needs burn service
- **Agent 2 (BurnBot Service)**: Provides burn execution
- **Payment**: $0.005 USDC via SPL token transfer
- **Verification**: On-chain signature confirms payment
- **Execution**: Burn service activates after payment confirmation

**No human intervention required!** ✨

---

## 🔧 Advanced Configuration

### Update Burn Rules

```javascript
// In scripts/initialize.js, modify config:

const config = {
  profitThreshold: 2000,  // 20% profit required
  burnPercentage: 5000,   // 50% of profits burned
  minBurnAmount: 5000000, // 5 tokens minimum
};
```

### Custom RPC Endpoint

```bash
# Use Helius, QuickNode, or other RPC
export SOLANA_RPC_URL=https://your-custom-rpc-endpoint.com
```

### MEV Protection (Jito)

The full-stack application includes Jito BAM (Bundle Auction Mechanism) integration for MEV protection. See `server/jito-bam-service.ts` for implementation.

---

## 📊 Devnet Program ID

After deployment, your program ID will be:

```
PLACEHOLDER - Update after running ./scripts/deploy.sh
```

**Devnet Explorer:**
```
https://explorer.solana.com/address/YOUR_PROGRAM_ID?cluster=devnet
```

---

## 🏗️ Program Instructions

The Anchor program (`programs/gigabrain-burn/src/lib.rs`) provides:

### `initialize_burn_config`
Initialize burn configuration for a token mint.

**Parameters:**
- `profit_threshold: u64` - Minimum profit in basis points
- `burn_percentage: u16` - Burn percentage (0-10000)
- `min_burn_amount: u64` - Minimum tokens per burn

### `execute_autonomous_burn`
Execute autonomous burn with x402 payment verification.

**Parameters:**
- `amount: u64` - Tokens to burn
- `x402_signature: String` - Payment verification signature
- `profit_amount: u64` - Current profit that triggered burn

### `update_burn_config`
Update existing burn configuration.

**Parameters:**
- `new_profit_threshold: Option<u64>`
- `new_burn_percentage: Option<u16>`
- `new_min_burn_amount: Option<u64>`

---

## 🔐 Security

- ✅ **Anchor Framework** - Rust type safety and security
- ✅ **x402 Payment Verification** - On-chain payment confirmation
- ✅ **PDA-based Access Control** - Secure configuration storage
- ✅ **Loss Prevention AI** - Blocks risky trades (>85% loss probability)
- ✅ **Liquidity Checks** - Prevents rug pull tokens

---

## 🤝 Contributing

Contributions welcome! Please open an issue or PR.

### Development Setup

```bash
# Install dependencies
npm install

# Build Anchor program
anchor build

# Run tests
npm test

# Start full-stack app (dev mode)
npm run dev
```

---

## 📄 License

MIT License - see [LICENSE.md](LICENSE.md)

---

## 🔗 Links

- **Solana Explorer (Devnet)**: https://explorer.solana.com/?cluster=devnet
- **Anchor Docs**: https://www.anchor-lang.com/
- **DeepSeek AI**: https://api.deepseek.com/
- **x402 Protocol**: https://payai.com/x402
- **Jito MEV**: https://www.jito.wtf/

---

## 📞 Support

For questions or support:
- Open an issue on GitHub
- Join our Discord (coming soon)
- Check documentation in `/docs` folder

---

**Built for the Solana Hackathon with ❤️**

*Autonomous AI trading with zero human intervention*

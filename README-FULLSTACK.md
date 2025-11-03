# GigaBrain - Autonomous Solana AI Trading Bot

**Powered by DeepSeek V3 • x402 Micropayments • Jito BAM**

An autonomous AI trading bot for Solana tokens featuring DeepSeek V3 (free tier), x402 HTTP payment protocol, and Jito BAM atomic bundles for MEV-protected trading.

---

## 🏆 Hackathon Submission

**See [HACKATHON.md](./HACKATHON.md) for complete hackathon documentation.**

---

## 🚀 Key Innovations

### 1. DeepSeek V3 AI - Free Institutional-Grade Analysis
- ✅ **Free API Access:** 5M tokens monthly (eliminates AI costs)
- ✅ **Superior Reasoning:** Matches GPT-4 quality at zero cost
- ✅ **24/7 Trading:** Continuous market analysis and execution
- ✅ **Advanced Analysis:** Multi-layer technical & sentiment evaluation

### 2. x402 Micropayments - AI Agent Economy
- 💳 **Pay-Per-Use:** $0.005 USDC per burn service
- 💳 **Machine-to-Machine:** AI agents pay each other automatically
- 💳 **Solana Native:** USDC transfers on Solana blockchain
- 💳 **Zero Setup:** No subscriptions or upfront costs

### 3. Jito BAM - Atomic MEV Protection
- 🛡️ **MEV Protection:** Shields trades from front-running
- 🛡️ **Atomic Bundling:** Buy + Burn transactions execute together
- 🛡️ **Priority Inclusion:** Guarantees transaction ordering
- 🛡️ **Trade Safety:** Protects both entry and exit positions

---

## 🎯 Core Features

### Autonomous AI Trading
- **DeepSeek V3 Analysis:** Advanced reasoning for token evaluation
- **Tri-Mode Strategy:** SCALP (30min), QUICK_2X (2hr), SWING (24hr)
- **24/7 Operation:** Scans 100+ tokens every 5 minutes
- **Smart Entry/Exit:** AI-powered buy/sell decision framework

### Risk Management
- **Dynamic Position Sizing:** Scales with AI confidence (62-95%)
- **4-Tier Stop-Loss:** Protects capital while locking profits
- **Portfolio Diversification:** Max 25% per position
- **Circuit Breaker:** Auto-pauses at -20% portfolio drawdown

### Token Discovery
- **Multi-Source:** DexScreener, PumpFun, Jupiter Token API
- **Quality Filters:** 60%+ organic score, 50%+ quality rating
- **Safety Checks:** Liquidity verification, rug pull detection
- **Bundle Detection:** AI identifies pump-and-dump schemes

### Advanced Technical Analysis
- **RSI Indicators:** Overbought/oversold detection (14-period)
- **EMA Crossovers:** Golden/death cross signals (9/21)
- **Bollinger Bands:** Volatility analysis (20-period, 2σ)
- **Volume Analysis:** Wash trading detection

---

## 🛠️ Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Solana wallet
- DeepSeek API key (free at [platform.deepseek.com](https://platform.deepseek.com))

### Installation

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Add required variables (see below)

# Setup database
npm run db:push

# Start development server
npm run dev
```

Access at: `http://localhost:5000`

### Environment Variables

**Required:**
```bash
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/gigabrain

# AI (DeepSeek V3 - Free Tier)
DEEPSEEK_API_KEY=sk-your-deepseek-key

# Session Security
SESSION_SECRET=your-random-secret-min-32-chars
```

**Optional (with defaults):**
```bash
# Solana (defaults to devnet)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
TREASURY_WALLET_PUBLIC_KEY=your-treasury-wallet

# Encryption (required for production, optional for dev)
ENCRYPTION_MASTER_KEY=generate-with-crypto-randomBytes-32-hex

# Server
PORT=5000
NODE_ENV=production
```

**Generate encryption key for production:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 📱 User Journey

1. **Connect Wallet** → Phantom, Solflare, or other Solana wallet
2. **Get Free Trades** → 20 free AI-powered trades to start
3. **Configure Bot** → Set confidence thresholds and position sizing
4. **AI Starts Trading** → DeepSeek V3 analyzes and executes 24/7
5. **Monitor Dashboard** → Real-time positions, P&L, and statistics
6. **Try Agentic Burn** → Test x402 + BAM integration with demo

---

## 💡 Agentic Burn Operations

GigaBrain features **autonomous burn operations** combining all three innovations:

### 4-Step Process:

1. **AI Decision (DeepSeek V3)**
   - Analyzes burn request with configurable thresholds
   - Evaluates market conditions and token health
   - Approves/rejects based on reasoning

2. **x402 Micropayment**
   - GigaBrain pays BurnBot $0.005 USDC via HTTP 402
   - Payment recorded on-chain with signature
   - Service unlocked for execution

3. **Jupiter Swap**
   - SOL → Token swap via Jupiter Ultra API
   - Best price routing and slippage protection
   - Transaction signature generated

4. **Jito BAM Bundle**
   - Swap + Burn bundled atomically
   - MEV protection on both operations
   - On-chain verification via Solscan

**User Controls:**
- Minimum AI Confidence (0-100%)
- Maximum Burn Percentage (0-100%)
- Sentiment Requirements

---

## 📊 Trading Strategy

### SCALP Mode (62-79% AI Confidence)
- Position size: 3-6% of portfolio
- Max hold time: 30 minutes
- Stop-loss: -8% to -12%
- Profit target: +4% to +8%

### QUICK_2X Mode (70-85% AI Confidence)
- Position size: 4-7% of portfolio
- Max hold time: 2 hours
- Stop-loss: -10%
- Profit target: +15% to +25%

### SWING Mode (80%+ AI Confidence)
- Position size: 5-9% of portfolio
- Max hold time: 24 hours
- Stop-loss: -15% to -25%
- Profit target: +15% minimum

---

## 🔐 Security Best Practices

1. **Use Dedicated Trading Wallet** - Limited funds, isolated risk
2. **Never Commit `.env`** - Secrets stay local
3. **Enable 2FA** - On DeepSeek account
4. **Monitor Wallet Activity** - Regular balance checks
5. **Start Small** - Test strategy with minimal capital
6. **Fresh Wallet Recommended** - Protect main holdings

---

## 📈 Performance & Costs

### AI API Costs
- **DeepSeek V3:** FREE (5M tokens/month = ~10,000+ analyses)
- **Total AI Cost:** $0/month on free tier

### Solana Costs (per trade)
- **Transaction fee:** ~0.00001 SOL (~$0.002)
- **Platform fee:** 1% of trade amount
- **Jupiter swap fee:** ~0.3% (market rate)

**Total per trade:** ~1.5% + $0.002 + $0 AI costs

---

## 🛡️ Safety Features

- **10% Liquidity Reserve:** Always maintained
- **Position Limits:** Max 25% in single position
- **Portfolio Drawdown Circuit Breaker:** Pauses at -20% drawdown
- **Bundle Activity Detection:** Auto-blacklists pump-and-dump tokens
- **Quality Filters:** 60%+ organic score, 50%+ quality score required
- **Minimum Requirements:** $15k+ volume, $15k+ liquidity, 24h+ age, 50+ holders

---

## 📊 Subscription Model

### Free Tier
- 20 free trades per wallet
- Full DeepSeek AI access
- All features enabled
- 1% platform fee applies

### Paid Subscription
- 0.15 SOL for 2 weeks unlimited access
- Same AI and features
- 1% platform fee applies
- Auto-renewal optional

### Deflationary Tokenomics
- 33% of subscriptions → automatic buybacks
- Tokens burned on-chain immediately
- Reduces supply, supports token value
- Transparent on Solscan

---

## 🏗️ Architecture

- **Frontend:** React 18 + TypeScript + Vite + shadcn/ui + TailwindCSS
- **Backend:** Express.js + TypeScript
- **Database:** PostgreSQL + Drizzle ORM
- **Blockchain:** Solana Web3.js + Jupiter APIs + Jito BAM
- **AI:** DeepSeek V3 (free tier, 5M tokens/month)
- **Real-time:** WebSocket connections for live updates

---

## 📚 Documentation

- **[HACKATHON.md](./HACKATHON.md)** - Complete hackathon submission documentation
- **[FEATURES.md](./FEATURES.md)** - Detailed feature specifications
- **[replit.md](./replit.md)** - Technical architecture overview

---

## 🔧 Development

### Database Management

```bash
# Open Drizzle Studio
npm run db:studio
# Access at http://localhost:4983

# Push schema changes
npm run db:push

# Force push (data loss warning)
npm run db:push --force
```

### Build for Production

```bash
npm run build
npm start
```

---

## 🔗 API Endpoints

### Public (No Auth)
- `GET /api/public/stats` - Performance data
- `GET /api/public/analyze-token/:mint` - Free AI token analysis
- `GET /api/ai-bot/subscription/status/:wallet` - Subscription status

### Authenticated (Wallet Signature)
- `GET /api/ai-bot/config/:wallet` - Get bot configuration
- `POST /api/ai-bot/config/:wallet` - Update bot settings
- `GET /api/ai-bot/positions/:wallet` - Active positions
- `GET /api/ai-bot/transactions/:wallet` - Transaction history
- `POST /api/ai-bot/subscription/purchase` - Purchase subscription
- `POST /api/agentic-burn/demo` - Execute agentic burn

---

## 🎮 Bot Behavior

Once configured, the bot runs automatically:

- **Quick Scans:** Every 1 minute (DeepSeek V3, SCALP opportunities)
- **Deep Scans:** Every 10 minutes (DeepSeek V3, SWING opportunities)
- **Position Monitoring:** Every 1 minute (sell decisions, technical indicators)
- **Portfolio Rebalancing:** Every 15 minutes (capital recycling)
- **Wallet Sync:** Every 5 minutes (blockchain reconciliation)

---

## 🌟 Why GigaBrain?

1. **Free AI:** DeepSeek V3 free tier vs $15-50/month competitors
2. **Agent Economy:** First x402 micropayment implementation on Solana
3. **MEV Protection:** Jito BAM shields all trades from front-running
4. **Complete Solution:** Trading + Analytics + Agentic Operations
5. **Production Ready:** Live, tested, documented, deployable

---

## 🚀 Live Demo

### Token Analyzer
Try free AI analysis (no wallet required):
- URL: `/analyze`
- Powered by DeepSeek V3
- Unlimited analyses
- Real-time results

### Agentic Burn Demo
Test x402 + BAM integration:
- URL: `/dashboard/agentic-burn`
- Configure AI criteria
- Execute demo transaction
- Verify on Solscan

---

## ⚠️ Disclaimer

This software is for educational purposes only. Trading cryptocurrencies involves substantial risk of loss. Never invest more than you can afford to lose. Past performance does not guarantee future results. The developers are not responsible for any financial losses incurred through use of this software.

---

## 📄 License

MIT License - See LICENSE file

---

## 🎯 Built for Solana Hackathon 2025

**Powered by:**
- DeepSeek V3 AI (Free Tier)
- x402 Micropayment Protocol
- Jito BAM Atomic Bundles

🚀 **"Black and Gold Never Fold"**

---

**Questions? Check [HACKATHON.md](./HACKATHON.md) for comprehensive documentation.**

# GigaBrain - Autonomous Solana AI Trading Bot

**"Black and Gold Never Fold"**

An autonomous AI trading bot for Solana tokens featuring an 11-model hivemind consensus system, advanced technical analysis (RSI, EMA, Bollinger Bands), and intelligent risk management.

## Features

- **11-Model AI Hivemind:** DeepSeek, xAI Grok, Together AI, OpenRouter, Groq, Cerebras, Google Gemini, ChatAnywhere, OpenAI (with weighted voting & automatic failover)
- **Advanced Technical Analysis:** RSI, EMA, Bollinger Bands integrated into buy/sell decisions
- **Dual Trading Modes:** SCALP (62-79% confidence) and SWING (80%+ confidence)
- **Autonomous Capital Management:** Position sizing, stop-loss, portfolio diversification
- **Bundle Detection:** Automatic pump-and-dump scheme detection
- **Real-Time Monitoring:** WebSocket-based performance updates
- **Subscription Model:** 20 free trades, then 0.15 SOL for 2 weeks unlimited access

## Prerequisites

- **Node.js** 18+ and npm
- **PostgreSQL** 14+ database
- **Solana Wallet** with private key for trading
- **AI API Keys** (at least 2-3 for hivemind redundancy)

## Installation

### 1. Clone and Install Dependencies

```bash
npm install
```

### 2. Database Setup

Create a PostgreSQL database:

```bash
createdb gigabrain
```

### 3. Environment Variables

Create a `.env` file in the root directory:

```bash
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/gigabrain

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
# Or use a faster RPC: https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Treasury Wallet (receives platform fees)
TREASURY_WALLET_PUBLIC_KEY=jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38

# AI API Keys (configure at least 2-3 for redundancy)
# Free/Low-Cost Options (recommended to start)
DEEPSEEK_API_KEY=sk-your-deepseek-key
DEEPSEEK_API_KEY_2=sk-your-deepseek-backup-key
GROQ_API_KEY=gsk_your-groq-key
CEREBRAS_API_KEY=csk-your-cerebras-key
GOOGLE_AI_KEY=AIza-your-google-key
TOGETHER_API_KEY=your-together-key

# Paid Options (optional, for higher limits)
OPENAI_API_KEY=sk-your-openai-key
OPENAI_API_KEY_2=sk-your-openai-backup-key
XAI_API_KEY=xai-your-grok-key
OPENROUTER_API_KEY=sk-or-your-openrouter-key

# ChatAnywhere (optional)
CHATANYWHERE_API_KEY=sk-your-chatanywhere-key

# Session Secret (generate random string)
SESSION_SECRET=your-random-secret-here-min-32-chars

# Server Configuration
PORT=5000
NODE_ENV=production
```

### 4. Database Migration

Push the schema to your database:

```bash
npm run db:push
```

If you encounter issues, force push:

```bash
npm run db:push --force
```

## Getting AI API Keys

### Free/Low-Cost Options (Recommended)

1. **DeepSeek** (FREE, best value)
   - Visit: https://platform.deepseek.com/
   - Get $5 free credits, very cheap after
   - Best performance-to-cost ratio

2. **Groq** (FREE tier)
   - Visit: https://console.groq.com/
   - Free tier with rate limits
   - Very fast inference

3. **Cerebras** (FREE tier)
   - Visit: https://cerebras.ai/
   - Free tier available
   - Fast inference

4. **Google AI Studio** (FREE tier)
   - Visit: https://makersuite.google.com/app/apikey
   - Generous free tier
   - Gemini 1.5 Flash model

5. **Together AI** (FREE credits)
   - Visit: https://api.together.xyz/
   - $25 free credits
   - Multiple models available

### Paid Options

6. **OpenAI** (Paid)
   - Visit: https://platform.openai.com/api-keys
   - GPT-4o-mini model
   - ~$0.15 per 1M tokens

7. **xAI Grok** (Paid)
   - Visit: https://console.x.ai/
   - Grok model access
   - Premium pricing

8. **OpenRouter** (Paid)
   - Visit: https://openrouter.ai/
   - Access to multiple models
   - Pay per use

**Minimum Requirement:** Configure at least 2-3 API keys for hivemind redundancy. The bot will automatically rotate to healthy models.

## Trading Wallet Setup

The bot needs a Solana wallet to execute trades. You have two options:

### Option 1: Create New Wallet (Recommended)

```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Generate new wallet
solana-keygen new --outfile ~/gigabrain-wallet.json

# Get public key
solana-keygen pubkey ~/gigabrain-wallet.json

# Fund wallet with SOL for trading
```

### Option 2: Use Existing Wallet

Export your wallet's private key from Phantom/Solflare as a JSON file.

**Important:** Store wallet in database via the web interface after starting the app. Navigate to AI Bot page and configure your wallet there.

## Running the Application

### Development Mode

```bash
npm run dev
```

The app will start on http://localhost:5000

### Production Mode

```bash
npm run build
npm start
```

## Initial Configuration

1. **Access the Web Interface:** Open http://localhost:5000

2. **Connect Wallet:** Click "Connect Wallet" and connect your browser wallet

3. **Configure Trading Bot:**
   - Navigate to "AI Bot" page
   - Click "Add Wallet"
   - Paste your trading wallet's **private key** (base58 encoded)
   - Configure trading parameters:
     - Enable/disable AI trading
     - Set SCALP/SWING thresholds
     - Configure position sizing
     - Set stop-loss percentages

4. **Subscribe or Use Free Trades:**
   - Every wallet gets 20 free trades
   - After that, pay 0.15 SOL for 2 weeks unlimited access
   - 1% platform fee on all trades

## Bot Behavior

Once configured, the bot runs automatically:

- **Quick Scans:** Every 1 minute (4 AI models, SCALP opportunities)
- **Deep Scans:** Every 10 minutes (11 AI models, SWING opportunities)
- **Position Monitoring:** Every 3 minutes (sell decisions with technical indicators)
- **Portfolio Rebalancing:** Every 30 minutes
- **Strategy Learning:** Every 3 hours (analyzes past trades, optimizes parameters)
- **Wallet Sync:** Every 5 minutes (reconciles database with blockchain)

## Trading Strategy

### SCALP Mode (62-79% AI Confidence)
- Position size: 3-6% of portfolio
- Max hold time: 30 minutes
- Stop-loss: -8% to -12%
- Profit target: +4% to +8%

### SWING Mode (80%+ AI Confidence)
- Position size: 5-9% of portfolio
- Max hold time: 24 hours
- Stop-loss: -15% to -25%
- Profit target: +15% minimum

### Technical Indicators Used
- **RSI (14-period):** Overbought >70, Oversold <30
- **EMA (9/21):** Golden cross (bullish), Death cross (bearish)
- **Bollinger Bands:** Price extremes, volatility squeezes
- **Volume Analysis:** Trend detection, wash trading detection
- **Liquidity Health:** Rug pull detection
- **Buy Pressure:** Order flow analysis

## Safety Features

- **10% Liquidity Reserve:** Always maintained
- **Position Limits:** Max 25% in single position
- **Portfolio Drawdown Circuit Breaker:** Pauses at -20% drawdown
- **Bundle Activity Detection:** Auto-blacklists pump-and-dump tokens
- **Quality Filters:** 80%+ organic score, 70%+ quality score required
- **Minimum Requirements:** $25k+ volume, $20k+ liquidity, 24h+ age, 100+ holders

## Monitoring & Logs

### Real-Time Dashboard
- Win rate, ROI, net profit
- Active positions with live P&L
- Best/worst trades
- SCALP/SWING statistics

### Activity Logs
View detailed logs in the web interface under "Activity Log" tab

### Server Logs
```bash
# View all logs
tail -f logs/*.log

# View specific events
grep "Position Monitor" logs/*.log
grep "Quick Scan" logs/*.log
grep "AI Bot" logs/*.log
```

## Database Management

### View Tables
```bash
npm run db:studio
```

Opens Drizzle Studio on http://localhost:4983

### Backup Database
```bash
pg_dump gigabrain > backup.sql
```

### Restore Database
```bash
psql gigabrain < backup.sql
```

## Troubleshooting

### Bot Not Trading

1. **Check wallet is configured and enabled** in AI Bot settings
2. **Verify SOL balance** - need enough for trades + fees
3. **Check AI API keys** - at least 2-3 must be working
4. **Review activity logs** - look for error messages
5. **Verify subscription/free trades** remain

### AI Models Failing

- Check API key validity
- Verify account has credits/quota
- Bot automatically rotates to healthy models
- Circuit breaker disables failed models temporarily

### Database Connection Issues

```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"

# Check if tables exist
psql $DATABASE_URL -c "\dt"
```

### Port Already in Use

```bash
# Kill process on port 5000
lsof -ti:5000 | xargs kill -9

# Or use different port
PORT=3000 npm run dev
```

## Security Best Practices

1. **Never commit `.env` file** to version control
2. **Use dedicated trading wallet** with limited funds
3. **Store private keys securely** - consider hardware wallet integration
4. **Enable 2FA** on all AI provider accounts
5. **Monitor wallet activity** regularly
6. **Start with small amounts** to test strategy
7. **Use RPC with rate limiting** to avoid bans

## Performance Optimization

### Use Premium RPC Endpoints

Free RPCs often have rate limits. Consider:
- **Helius:** https://helius.dev/ (generous free tier)
- **QuickNode:** https://quicknode.com/
- **Triton:** https://triton.one/

### Database Optimization

```sql
-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_positions_wallet ON ai_bot_positions(owner_wallet_address);
CREATE INDEX IF NOT EXISTS idx_positions_active ON ai_bot_positions(is_active);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON ai_bot_transactions(owner_wallet_address);
```

## Architecture

- **Frontend:** React 18 + TypeScript + Vite + TailwindCSS
- **Backend:** Express.js + TypeScript
- **Database:** PostgreSQL + Drizzle ORM
- **Blockchain:** Solana Web3.js + Jupiter API
- **AI:** OpenAI-compatible APIs with weighted voting
- **Real-time:** WebSocket connections for live updates

## API Endpoints

### Public Endpoints (No Auth)
- `GET /api/public/stats` - Aggregated performance data
- `GET /api/public/analyze-token/:mint` - Free AI token analysis
- `GET /api/ai-bot/subscription/status/:wallet` - Check subscription status

### Authenticated Endpoints
- `GET /api/ai-bot/config/:wallet` - Get bot configuration
- `POST /api/ai-bot/config/:wallet` - Update bot settings
- `GET /api/ai-bot/positions/:wallet` - Get active positions
- `GET /api/ai-bot/transactions/:wallet` - Get transaction history
- `POST /api/ai-bot/subscription/purchase` - Purchase subscription

## Cost Estimates

### AI API Costs (per 1000 trades)
- **DeepSeek:** ~$0.50 - $2.00 (cheapest, recommended)
- **Groq/Cerebras:** FREE tier sufficient for moderate use
- **Google Gemini:** FREE tier sufficient
- **OpenAI:** ~$5 - $15 (if using premium models)

### Solana Costs (per trade)
- **Transaction fee:** ~0.00001 SOL (~$0.002)
- **Platform fee:** 1% of trade amount
- **Jupiter swap fee:** ~0.3% (market rate)

**Total per trade:** ~1.5% + $0.002 + minimal AI costs

## Support & Community

- **Issues:** Report bugs via GitHub issues
- **Docs:** This README + inline code comments
- **Trading Performance:** View public stats at `/stats` page

## License

MIT License - See LICENSE file

## Disclaimer

**This software is for educational purposes only. Trading cryptocurrencies involves substantial risk of loss. Never invest more than you can afford to lose. Past performance does not guarantee future results. The developers are not responsible for any financial losses incurred through use of this software.**

## Updates & Maintenance

### Check for Updates
```bash
git pull origin main
npm install
npm run db:push
```

### Automatic Cleanup Tasks
The bot automatically performs:
- Hourly: Cleanup inactive bot states
- Daily 3AM: Remove expired signatures and old strategies
- Every 5min: Wallet synchronization
- Every 3hrs: Strategy learning and optimization

---

Built with ❤️ for the Solana community. **Black and Gold Never Fold!** 🚀

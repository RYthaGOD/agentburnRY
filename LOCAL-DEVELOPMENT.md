# GigaBrain - Local Development Guide

Complete guide for developers who want to run, modify, and customize GigaBrain locally.

## Project Structure

```
gigabrain/
├── client/                 # React frontend
│   ├── src/
│   │   ├── pages/         # Page components
│   │   ├── components/    # Reusable UI components
│   │   ├── lib/           # Utilities and helpers
│   │   └── hooks/         # Custom React hooks
│   └── index.html
├── server/                # Express backend
│   ├── routes.ts          # API routes
│   ├── storage.ts         # Database repository layer
│   ├── ai-bot-scheduler.ts # Trading bot scheduler
│   ├── grok-analysis.ts   # AI analysis functions
│   ├── subscription-access.ts # Subscription management
│   └── index.ts           # Server entry point
├── shared/                # Shared between frontend/backend
│   └── schema.ts          # Database schema (Drizzle ORM)
├── .env                   # Environment variables (create from .env.example)
├── package.json           # Dependencies
└── README.md             # Main documentation
```

## Development Setup

### 1. Prerequisites

```bash
# Check Node.js version (18+ required)
node -v

# Check PostgreSQL (14+ required)
psql --version

# Check npm
npm -v
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Database Setup

```bash
# Create database
createdb gigabrain

# Or using psql
psql postgres
CREATE DATABASE gigabrain;
\q

# Push schema to database
npm run db:push

# If issues, force push
npm run db:push --force
```

### 4. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

**Minimum required for development:**
```env
DATABASE_URL=postgresql://localhost:5432/gigabrain
SESSION_SECRET=dev-secret-at-least-32-chars-long
DEEPSEEK_API_KEY=sk-your-key
GROQ_API_KEY=gsk-your-key
```

### 5. Start Development Server

```bash
npm run dev
```

This starts:
- Frontend dev server (Vite) on http://localhost:5000
- Backend server (Express) on same port
- Hot module replacement for instant updates

## Development Workflows

### Making Schema Changes

When you need to modify the database:

```typescript
// 1. Edit shared/schema.ts
export const myNewTable = pgTable("my_new_table", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 2. Update storage interface in server/storage.ts
export interface IStorage {
  // ... existing methods
  createMyNewItem(data: InsertMyNewTable): Promise<SelectMyNewTable>;
}

// 3. Implement in DbStorage class
async createMyNewItem(data: InsertMyNewTable) {
  const [item] = await this.db.insert(myNewTable).values(data).returning();
  return item;
}

// 4. Push to database
npm run db:push
```

### Adding API Routes

```typescript
// server/routes.ts

// Add new endpoint
app.get("/api/my-endpoint", requireAuth, async (req, res, next) => {
  try {
    const data = await storage.getMyData(req.user.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Frontend will auto-discover via TanStack Query
```

### Creating Frontend Components

```typescript
// client/src/pages/my-page.tsx

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";

export default function MyPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['/api/my-endpoint'],
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <Card>
      <h1>{data.title}</h1>
    </Card>
  );
}

// Register in client/src/App.tsx
<Route path="/my-page" component={MyPage} />
```

## Testing

### Manual Testing

```bash
# Start dev server
npm run dev

# Open browser
open http://localhost:5000
```

### Database Inspection

```bash
# Open Drizzle Studio
npm run db:studio

# Opens GUI at http://localhost:4983
# Browse tables, run queries, edit data
```

### API Testing

```bash
# Test public endpoint
curl http://localhost:5000/api/public/stats

# Test authenticated endpoint (need session cookie)
curl -b cookies.txt http://localhost:5000/api/ai-bot/config/YOUR_WALLET
```

## Common Development Tasks

### Adding a New AI Provider

```typescript
// server/ai-bot-scheduler.ts

const newProvider = {
  name: "New Provider",
  baseURL: "https://api.newprovider.com/v1",
  apiKey: process.env.NEW_PROVIDER_API_KEY,
  model: "their-model-name",
  priority: 1, // 1=free/reliable, 2=free/limits, 3=paid
};

// Add to allModels array
const allModels = [
  // ... existing providers
  newProvider,
].filter(m => m.apiKey);
```

### Customizing Trading Strategy

```typescript
// server/ai-bot-scheduler.ts

// Modify thresholds
const SCALP_MIN_CONFIDENCE = 62; // Lower = more trades
const SWING_MIN_CONFIDENCE = 80; // Higher = more selective

// Modify position sizing
const scalpPositionSize = portfolioValue * 0.05; // 5% instead of 3-6%
const swingPositionSize = portfolioValue * 0.10; // 10% instead of 5-9%

// Modify stop-loss
const scalpStopLoss = -0.15; // -15% instead of -8% to -12%
```

### Adding Technical Indicators

```typescript
// server/ai-bot-scheduler.ts

// Example: Add MACD indicator
function calculateMACD(prices: number[]) {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdLine = ema12 - ema26;
  const signalLine = calculateEMA([macdLine], 9);
  
  return {
    macd: macdLine,
    signal: signalLine,
    histogram: macdLine - signalLine
  };
}

// Integrate into technical analysis
const technicals = await calculateTechnicalIndicators(...);
const macd = calculateMACD(prices);
// Add to AI prompt...
```

### Customizing Fee Structure

```typescript
// server/subscription-access.ts

// Change platform fee
const PLATFORM_FEE_PERCENT = 0.5; // 0.5% instead of 1%

// Change subscription price
const SUBSCRIPTION_PRICE_SOL = 0.1; // 0.1 SOL instead of 0.15

// Change free trades
const FREE_TRADES_PER_WALLET = 50; // 50 instead of 20
```

## Debugging

### Enable Debug Logs

```typescript
// server/ai-bot-scheduler.ts

// Uncomment console.log statements
console.log('[Debug] Variable value:', myVariable);

// Or add more detailed logging
console.log('[Position Monitor] Full state:', JSON.stringify(position, null, 2));
```

### View Real-Time Logs

```bash
# All logs
tail -f logs/*.log

# Specific event types
tail -f logs/*.log | grep "Position Monitor"
tail -f logs/*.log | grep "Quick Scan"
tail -f logs/*.log | grep "ERROR"
```

### Database Queries

```sql
-- View active positions
SELECT * FROM ai_bot_positions WHERE is_active = true;

-- View recent transactions
SELECT * FROM ai_bot_transactions ORDER BY created_at DESC LIMIT 10;

-- View bot configurations
SELECT * FROM ai_bot_configs;

-- View subscription status
SELECT owner_wallet_address, subscription_active, free_trades_remaining 
FROM ai_bot_configs;
```

### Common Issues

#### Bot Not Trading

1. Check wallet is configured and active
2. Verify sufficient SOL balance
3. Check AI API keys are valid
4. Review activity logs for errors
5. Ensure subscription/free trades available

#### Database Connection Errors

```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"

# Reset database
npm run db:push --force
```

#### Build Errors

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Vite cache
rm -rf .vite
```

## Performance Optimization

### Database Indexing

```sql
-- Add indexes for common queries
CREATE INDEX idx_positions_wallet ON ai_bot_positions(owner_wallet_address);
CREATE INDEX idx_positions_active ON ai_bot_positions(is_active);
CREATE INDEX idx_positions_entry_time ON ai_bot_positions(entry_time);
CREATE INDEX idx_transactions_wallet ON ai_bot_transactions(owner_wallet_address);
CREATE INDEX idx_transactions_created ON ai_bot_transactions(created_at);
```

### Caching Strategy

The bot already implements caching:
- Token discovery: 30 minutes
- Market data: 1 minute for scans
- AI hivemind strategy: 3 hours

To adjust:

```typescript
// server/ai-bot-scheduler.ts

const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour instead of 30 min
```

### Rate Limiting

```typescript
// server/index.ts

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200 // 200 requests instead of 100
});
```

## Contributing

### Code Style

- Use TypeScript strict mode
- Follow existing patterns
- Add JSDoc comments for complex functions
- Use meaningful variable names
- Keep functions small and focused

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/my-new-feature

# Make changes
# ... edit files ...

# Commit
git add .
git commit -m "feat: add new feature"

# Push
git push origin feature/my-new-feature
```

### Commit Message Format

```
feat: add RSI indicator to sell decisions
fix: resolve database connection timeout
docs: update local setup instructions
perf: optimize position monitoring query
refactor: extract AI provider logic
```

## Environment Variables Reference

Complete list of all environment variables:

```env
# Required
DATABASE_URL=postgresql://...
SESSION_SECRET=...
DEEPSEEK_API_KEY=sk-...

# Recommended
GROQ_API_KEY=gsk-...
GOOGLE_AI_KEY=AIza...
SOLANA_RPC_URL=https://...

# Optional
OPENAI_API_KEY=sk-...
XAI_API_KEY=xai-...
CEREBRAS_API_KEY=csk-...
TOGETHER_API_KEY=...
OPENROUTER_API_KEY=sk-or-...
CHATANYWHERE_API_KEY=sk-...

# Server
PORT=5000
NODE_ENV=development
```

## Useful Commands

```bash
# Development
npm run dev              # Start dev server
npm run build           # Build for production
npm start               # Start production server

# Database
npm run db:push         # Migrate database
npm run db:studio       # Open database GUI
npm run db:push --force # Force migration

# Utilities
npm run lint            # Lint code (if configured)
npm run type-check      # TypeScript check
npm test                # Run tests (if configured)

# Docker
docker-compose up -d    # Start with Docker
docker-compose logs -f  # View logs
docker-compose down     # Stop containers
```

## Resources

- **Solana Docs:** https://docs.solana.com/
- **Jupiter API:** https://station.jup.ag/docs
- **Drizzle ORM:** https://orm.drizzle.team/
- **React Query:** https://tanstack.com/query/latest
- **Tailwind CSS:** https://tailwindcss.com/

## Getting Help

1. Check logs: `tail -f logs/*.log`
2. Review README.md for setup issues
3. Check DOCKER-SETUP.md for Docker issues
4. Inspect database with Drizzle Studio
5. Test API endpoints with curl

---

Happy coding! Black and Gold Never Fold! 🚀

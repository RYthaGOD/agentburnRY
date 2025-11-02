# GigaBrain - Deployment Guide

## Overview

This guide covers deploying GigaBrain to various platforms for the Solana hackathon demo.

---

## Platform Options

### 1. Replit (Recommended for Demo)

**Pros:**
- Zero configuration
- Built-in PostgreSQL database
- Auto-SSL/HTTPS
- Easy sharing
- Environment secrets management

**Steps:**

1. **Fork/Import Repository**
   - Import from GitHub
   - Or create from existing code

2. **Configure Secrets**
   ```
   DATABASE_URL (auto-provided by Replit)
   DEEPSEEK_API_KEY (get from platform.deepseek.com)
   SESSION_SECRET (generate random 32+ chars)
   TREASURY_WALLET_PUBLIC_KEY (your wallet address)
   DEMO_WALLET_PRIVATE_KEY (optional, for demo trading)
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Setup Database**
   ```bash
   npm run db:push
   ```

5. **Run Application**
   ```bash
   npm run dev
   ```

6. **Access Application**
   - Click "Open in new tab" button
   - Share URL with hackathon judges

**Environment Variables in Replit:**
- Click "Secrets" tab (lock icon)
- Add each secret key-value pair
- Secrets automatically available in process.env

---

### 2. Vercel

**Pros:**
- Free tier available
- Fast global CDN
- Easy GitHub integration
- Automatic deployments

**Steps:**

1. **Prepare for Deployment**
   ```bash
   # Add build command to package.json (already configured)
   # Ensure "npm run build" works locally
   npm run build
   ```

2. **Connect to Vercel**
   - Visit [vercel.com](https://vercel.com)
   - Import Git repository
   - Configure project settings

3. **Environment Variables**
   Add in Vercel dashboard:
   ```
   DATABASE_URL
   DEEPSEEK_API_KEY
   SESSION_SECRET
   TREASURY_WALLET_PUBLIC_KEY
   SOLANA_RPC_URL
   ```

4. **Database Setup**
   - Use Neon, Supabase, or Railway for PostgreSQL
   - Add connection string to DATABASE_URL
   - Run migrations:
   ```bash
   npm run db:push
   ```

5. **Deploy**
   - Push to main branch
   - Vercel auto-deploys

**Note:** Vercel has limitations on serverless functions (10s timeout). Use for frontend + static API, but consider separate backend for long-running operations.

---

### 3. Railway

**Pros:**
- Full server environment
- PostgreSQL included
- No timeout limits
- Fair free tier

**Steps:**

1. **Create New Project**
   - Visit [railway.app](https://railway.app)
   - Create new project from GitHub repo

2. **Add PostgreSQL Database**
   - Click "New" → "Database" → "PostgreSQL"
   - Railway auto-provides DATABASE_URL

3. **Configure Environment Variables**
   In Railway dashboard:
   ```
   DEEPSEEK_API_KEY
   SESSION_SECRET
   TREASURY_WALLET_PUBLIC_KEY
   SOLANA_RPC_URL (optional, defaults to public RPC)
   PORT=5000
   NODE_ENV=production
   ```

4. **Deploy**
   - Railway auto-builds on push
   - Access via provided railway.app URL

5. **Run Migrations**
   - In Railway shell or locally with production DATABASE_URL:
   ```bash
   npm run db:push
   ```

---

### 4. Render

**Pros:**
- Free tier with PostgreSQL
- Zero downtime deploys
- Easy configuration
- Good for demos

**Steps:**

1. **Create Web Service**
   - Visit [render.com](https://render.com)
   - New → Web Service
   - Connect GitHub repo

2. **Configure Build**
   ```
   Build Command: npm install && npm run build
   Start Command: npm start
   ```

3. **Add PostgreSQL**
   - Create PostgreSQL database in Render
   - Link to web service
   - DATABASE_URL auto-provided

4. **Environment Variables**
   ```
   DEEPSEEK_API_KEY
   SESSION_SECRET
   TREASURY_WALLET_PUBLIC_KEY
   SOLANA_RPC_URL
   ```

5. **Deploy**
   - Push to main branch
   - Render auto-deploys

6. **Run Migrations**
   ```bash
   npm run db:push
   ```

---

### 5. Heroku

**Pros:**
- Well-documented
- Free tier (with credit card)
- Add-ons ecosystem

**Steps:**

1. **Create Heroku App**
   ```bash
   heroku create gigabrain-demo
   ```

2. **Add PostgreSQL**
   ```bash
   heroku addons:create heroku-postgresql:mini
   ```

3. **Set Environment Variables**
   ```bash
   heroku config:set DEEPSEEK_API_KEY=sk-your-key
   heroku config:set SESSION_SECRET=your-secret
   heroku config:set TREASURY_WALLET_PUBLIC_KEY=your-wallet
   ```

4. **Deploy**
   ```bash
   git push heroku main
   ```

5. **Run Migrations**
   ```bash
   heroku run npm run db:push
   ```

6. **Open App**
   ```bash
   heroku open
   ```

---

## Production Checklist

### Before Deployment

- [ ] Environment variables configured
- [ ] Database connection tested
- [ ] DeepSeek API key verified
- [ ] Build succeeds locally (`npm run build`)
- [ ] All tests pass
- [ ] No sensitive data in code
- [ ] `.env` not committed to git

### After Deployment

- [ ] Application loads successfully
- [ ] Database tables created (check with Drizzle Studio)
- [ ] Wallet connection works
- [ ] Token analyzer works (public endpoint)
- [ ] AI trading bot dashboard accessible
- [ ] Agentic burn demo functional
- [ ] WebSocket connections stable
- [ ] All API endpoints responding

### Performance Testing

- [ ] Page load times <3 seconds
- [ ] API response times <500ms
- [ ] Database queries optimized
- [ ] No memory leaks
- [ ] Error handling works
- [ ] Rate limiting active

---

## Database Migrations

### Using Drizzle Studio (Recommended)

```bash
# Development
npm run db:studio
# Opens at http://localhost:4983

# Production (with connection string)
DATABASE_URL=your-production-url npm run db:studio
```

### Manual Migration

```bash
# Push schema to database
npm run db:push

# Force push (careful - potential data loss)
npm run db:push --force
```

---

## Environment Variables Reference

### Required

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# AI (DeepSeek V3)
DEEPSEEK_API_KEY=sk-your-deepseek-key

# Security
SESSION_SECRET=random-32-char-minimum-secret
ENCRYPTION_MASTER_KEY=64-char-hex-key-see-generation-below

# Solana
TREASURY_WALLET_PUBLIC_KEY=your-wallet-address
```

**Generate ENCRYPTION_MASTER_KEY:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Optional

```bash
# Solana RPC (defaults to public if not set)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Server
PORT=5000
NODE_ENV=production

# Demo Trading (optional)
DEMO_WALLET_PRIVATE_KEY=base58-encoded-private-key
```

**Note:** ENCRYPTION_MASTER_KEY is optional in development mode but required for production. Generate a secure 64-character hex string using the command above.

---

## Troubleshooting

### Build Failures

**Issue:** `npm run build` fails
**Solution:**
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Database Connection Errors

**Issue:** Cannot connect to database
**Solution:**
```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"

# Check tables exist
npm run db:studio
```

### DeepSeek API Errors

**Issue:** AI analysis failing
**Solution:**
- Verify API key is valid
- Check free tier limits (5M tokens/month)
- Test key directly:
```bash
curl https://api.deepseek.com/v1/models \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY"
```

### Memory Issues (Railway/Render)

**Issue:** Application crashes with OOM
**Solution:**
- Increase memory limits in platform settings
- Check for memory leaks
- Optimize caching strategy

### WebSocket Connection Failures

**Issue:** Real-time updates not working
**Solution:**
- Ensure platform supports WebSockets
- Check CORS configuration
- Verify SSL/TLS enabled

---

## Security Considerations

### Production Environment

1. **SSL/TLS Required**
   - All platforms provide free HTTPS
   - Never use HTTP in production

2. **Environment Secrets**
   - Never commit `.env` to git
   - Use platform secret managers
   - Rotate secrets regularly

3. **Database Security**
   - Use SSL for database connections
   - Limit IP access if possible
   - Regular backups

4. **API Rate Limiting**
   - Already implemented in code
   - Monitor for abuse
   - Set platform rate limits

5. **Wallet Security**
   - Use dedicated trading wallet
   - Limited funds only
   - Monitor transactions

---

## Monitoring

### Recommended Tools

**Uptime Monitoring:**
- UptimeRobot (free)
- Better Uptime
- Platform built-in (Vercel, Railway)

**Error Tracking:**
- Sentry (free tier)
- LogRocket
- Platform logs

**Performance:**
- Vercel Analytics (if using Vercel)
- Google Analytics
- Custom metrics in code

### Health Check Endpoint

Already implemented:
```
GET /api/health
```

Returns system status and version.

---

## Scaling Considerations

### Horizontal Scaling

If traffic increases:
- Add more instances (most platforms auto-scale)
- Use Redis for session storage
- Implement request queuing
- Add load balancer

### Database Optimization

For production:
```sql
-- Add indexes (already in schema)
CREATE INDEX IF NOT EXISTS idx_positions_wallet 
  ON ai_bot_positions(owner_wallet_address);

CREATE INDEX IF NOT EXISTS idx_positions_active 
  ON ai_bot_positions(is_active);

-- Monitor slow queries
SELECT * FROM pg_stat_statements 
  ORDER BY total_exec_time DESC 
  LIMIT 10;
```

### Caching Strategy

Current implementation:
- Token metadata: 5 minutes
- Price data: 30 seconds
- AI analysis: 5 minutes

For heavy traffic, consider Redis.

---

## Demo Day Preparation

### Pre-Demo Checklist

- [ ] Application deployed and stable
- [ ] Demo wallet funded with SOL
- [ ] Free token analyzer works
- [ ] Agentic burn demo ready
- [ ] Solscan links functional
- [ ] Dashboard shows metrics
- [ ] Mobile-responsive verified
- [ ] Screenshots prepared
- [ ] Video demo recorded
- [ ] Pitch deck ready

### Demo Flow

1. **Landing Page** - Show value proposition
2. **Token Analyzer** - Free AI analysis (no wallet)
3. **Connect Wallet** - Show wallet integration
4. **Dashboard** - Live trading metrics
5. **Agentic Burn** - Demonstrate x402 + BAM
6. **Verify on Solscan** - Show on-chain proof
7. **Key Differentiators** - DeepSeek free tier

### Quick Access URLs

Prepare these URLs:
- `/` - Landing page
- `/analyze` - Token analyzer
- `/dashboard` - Main dashboard
- `/dashboard/agentic-burn` - Agentic burn demo
- `/stats` - Public stats

---

## Support

For deployment issues:
1. Check platform documentation
2. Review error logs
3. Test locally first
4. Verify environment variables
5. Check database connectivity

---

**Good luck with your hackathon demo! 🚀**

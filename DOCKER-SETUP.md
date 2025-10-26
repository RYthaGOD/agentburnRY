# GigaBrain - Docker Setup Guide

The easiest way to run GigaBrain locally using Docker containers.

## Prerequisites

- **Docker** 20+ installed ([Get Docker](https://docs.docker.com/get-docker/))
- **Docker Compose** 2+ installed (included with Docker Desktop)

## Quick Start

### 1. Clone and Configure

```bash
# Clone the repository
git clone <your-repo-url>
cd gigabrain

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env  # or use your preferred editor
```

**Required in .env:**
- At least 2-3 AI API keys (DeepSeek, Groq, etc.)
- SESSION_SECRET (generate with: `openssl rand -base64 32`)
- Other settings can use defaults

### 2. Start Everything

```bash
# Start PostgreSQL + GigaBrain app
docker-compose up -d

# View logs
docker-compose logs -f app
```

The app will be available at http://localhost:5000

### 3. Initial Setup

1. Open http://localhost:5000
2. Connect your browser wallet
3. Navigate to "AI Bot" page
4. Configure your trading wallet
5. Start trading (20 free trades included)

## Docker Commands

### Start Services
```bash
docker-compose up -d
```

### Stop Services
```bash
docker-compose down
```

### View Logs
```bash
# All services
docker-compose logs -f

# Just the app
docker-compose logs -f app

# Just the database
docker-compose logs -f postgres
```

### Restart Services
```bash
docker-compose restart
```

### Rebuild After Code Changes
```bash
docker-compose up -d --build
```

### Database Management

#### Access PostgreSQL Shell
```bash
docker-compose exec postgres psql -U gigabrain -d gigabrain
```

#### Backup Database
```bash
docker-compose exec postgres pg_dump -U gigabrain gigabrain > backup.sql
```

#### Restore Database
```bash
cat backup.sql | docker-compose exec -T postgres psql -U gigabrain gigabrain
```

#### View Tables
```bash
docker-compose exec postgres psql -U gigabrain -d gigabrain -c "\dt"
```

## Environment Variables

The `docker-compose.yml` file automatically uses your `.env` file. Make sure to configure:

```env
# AI Keys (minimum 2-3)
DEEPSEEK_API_KEY=sk-...
GROQ_API_KEY=gsk_...
GOOGLE_AI_KEY=AIza...

# Session
SESSION_SECRET=<generate-random-32-chars>

# Optional: Use custom Solana RPC
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

**Note:** `DATABASE_URL` is automatically set by docker-compose to point to the postgres container.

## Data Persistence

Data is persisted in Docker volumes:

```bash
# List volumes
docker volume ls | grep gigabrain

# Inspect volume
docker volume inspect gigabrain_postgres-data

# Remove volume (⚠️ deletes all data!)
docker-compose down -v
```

## Troubleshooting

### Port Already in Use

If port 5000 is busy:

```bash
# Edit docker-compose.yml, change ports section:
ports:
  - "3000:5000"  # Use port 3000 instead
```

### Database Connection Issues

```bash
# Check if postgres is healthy
docker-compose ps

# View postgres logs
docker-compose logs postgres

# Restart database
docker-compose restart postgres
```

### App Won't Start

```bash
# View detailed logs
docker-compose logs app

# Force rebuild
docker-compose up -d --build --force-recreate

# Reset everything (⚠️ deletes data!)
docker-compose down -v
docker-compose up -d
```

### Database Migration Issues

```bash
# Manually run migration
docker-compose exec app npm run db:push --force
```

## Resource Limits

By default, containers have no resource limits. To add limits, edit `docker-compose.yml`:

```yaml
services:
  app:
    # ... existing config
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          memory: 1G
```

## Production Deployment

### Security Checklist

1. **Change default passwords** in docker-compose.yml
2. **Use strong SESSION_SECRET** in .env
3. **Enable HTTPS** with reverse proxy (nginx/traefik)
4. **Firewall rules** - only expose necessary ports
5. **Regular backups** - automate database backups
6. **Update regularly** - pull latest images

### Using with Reverse Proxy (nginx)

```nginx
server {
    listen 80;
    server_name gigabrain.example.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Automated Backups

Create a backup script:

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR=/backups
DATE=$(date +%Y%m%d_%H%M%S)

docker-compose exec -T postgres pg_dump -U gigabrain gigabrain > \
  $BACKUP_DIR/gigabrain_$DATE.sql

# Keep only last 7 days
find $BACKUP_DIR -name "gigabrain_*.sql" -mtime +7 -delete
```

Add to crontab:
```bash
0 2 * * * /path/to/backup.sh
```

## Monitoring

### Health Check

```bash
# Check if app is healthy
curl http://localhost:5000/api/health

# Check all services
docker-compose ps
```

### Resource Usage

```bash
# CPU and memory usage
docker stats gigabrain-app gigabrain-db

# Disk usage
docker system df
```

## Scaling

### Multiple Trading Wallets

Each wallet requires its own bot instance. You can run multiple wallets on a single app instance.

### High Availability

For production with zero downtime:

1. Use managed PostgreSQL (AWS RDS, DigitalOcean, etc.)
2. Deploy multiple app containers behind load balancer
3. Use premium Solana RPCs (Helius, QuickNode)
4. Set up monitoring (Prometheus + Grafana)

## Uninstall

To completely remove GigaBrain:

```bash
# Stop and remove containers
docker-compose down

# Remove volumes (⚠️ deletes all data!)
docker-compose down -v

# Remove images
docker rmi gigabrain-app
docker rmi postgres:14-alpine
```

## Support

For issues with Docker setup:
1. Check logs: `docker-compose logs -f`
2. Verify .env configuration
3. Ensure Docker daemon is running
4. Check disk space: `docker system df`

---

**Pro Tip:** Use `docker-compose up` (without `-d`) to see logs in real-time when debugging!

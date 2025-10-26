#!/bin/bash

# GigaBrain Local Setup Script
# This script helps you set up the GigaBrain AI Trading Bot locally

set -e

echo "🚀 GigaBrain AI Trading Bot - Local Setup"
echo "=========================================="
echo ""

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ required. You have: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Check PostgreSQL
if ! command -v psql &> /dev/null; then
    echo "⚠️  PostgreSQL not found in PATH"
    echo "   Install PostgreSQL 14+ from: https://www.postgresql.org/download/"
    echo "   Or use Docker: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:14"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "✅ PostgreSQL detected"
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Create .env file from example if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created. Please edit it with your configuration:"
    echo "   - Database URL"
    echo "   - AI API keys (minimum 2-3 providers)"
    echo "   - Session secret"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file now before continuing!"
    read -p "Press Enter when you've configured .env file..."
else
    echo "✅ .env file already exists"
fi

# Database setup
echo ""
echo "🗄️  Setting up database..."
read -p "Do you want to create/migrate the database now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Running database migration..."
    npm run db:push || {
        echo "⚠️  Migration failed. Trying force push..."
        npm run db:push -- --force
    }
    echo "✅ Database migrated successfully"
fi

# Summary
echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Verify your .env configuration:"
echo "   - At least 2-3 AI API keys configured"
echo "   - Valid DATABASE_URL"
echo "   - Session secret set"
echo ""
echo "2. Start the application:"
echo "   npm run dev"
echo ""
echo "3. Open your browser:"
echo "   http://localhost:5000"
echo ""
echo "4. Configure your trading wallet:"
echo "   - Connect your browser wallet"
echo "   - Navigate to AI Bot page"
echo "   - Add your trading wallet private key"
echo ""
echo "5. Start trading:"
echo "   - You get 20 free trades"
echo "   - After that: 0.15 SOL for 2 weeks unlimited"
echo ""
echo "📚 For detailed instructions, see README.md"
echo ""
echo "⚠️  SECURITY REMINDERS:"
echo "   - Never commit .env file"
echo "   - Never commit wallet JSON files"
echo "   - Start with small amounts to test"
echo "   - Use dedicated trading wallet"
echo ""
echo "Black and Gold Never Fold! 🚀"

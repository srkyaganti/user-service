# Setup Guide

This guide provides detailed instructions for setting up the User Service in different environments.

## Table of Contents

1. [Development Setup](#development-setup)
2. [Production Setup](#production-setup)
3. [Database Configuration](#database-configuration)
4. [Email Configuration](#email-configuration)
5. [Environment Variables](#environment-variables)
6. [Troubleshooting](#troubleshooting)

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or higher
- [Docker](https://www.docker.com/) and Docker Compose
- PostgreSQL 14+ (can be run via Docker)
- Redis 6+ (can be run via Docker)

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd user-service
```

### Step 2: Install Dependencies

```bash
bun install
```

### Step 3: Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit the `.env` file with your configuration:

```env
# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/userservice"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT Configuration
JWT_SECRET="your-super-secret-jwt-key-change-this"
JWT_EXPIRES_IN="24h"
JWT_REFRESH_EXPIRES_IN="30d"

# Encryption
ENCRYPTION_KEY="32-character-encryption-key-here"

# Email (using Mailhog for development)
SMTP_HOST="localhost"
SMTP_PORT="1025"
SMTP_SECURE="false"
SMTP_FROM="noreply@userservice.local"

# Application
APP_URL="http://localhost:3000"
NODE_ENV="development"
PORT="3000"

# File Upload
UPLOAD_DIR="./uploads"
MAX_FILE_SIZE="5242880" # 5MB

# Admin
ADMIN_EMAILS="admin@example.com"
```

### Step 4: Start Docker Services

```bash
docker-compose up -d
```

This will start:
- PostgreSQL on port 5432
- Redis on port 6379
- Mailhog on port 1025 (SMTP) and 8025 (Web UI)

### Step 5: Initialize Database

```bash
# Generate Prisma client
bun run db:generate

# Push schema to database
bun run db:push

# (Optional) Seed with sample data
bun run db:seed
```

### Step 6: Start the Service

```bash
bun run dev
```

The service will be available at:
- API: `http://localhost:3000`
- API Docs: `http://localhost:3000/api/docs`
- Health Check: `http://localhost:3000/health`

### Step 7: Verify Installation

```bash
# Check health
curl http://localhost:3000/health

# Create a test user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: default" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#",
    "profile": {
      "name": "Test User"
    }
  }'
```

## Production Setup

### Using Docker

1. **Build the Docker image:**

```bash
docker build -t user-service:latest .
```

2. **Create production environment file:**

```bash
cp .env.example .env.production
# Edit with production values
```

3. **Run with Docker Compose:**

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Manual Setup

1. **Install dependencies:**

```bash
bun install --production
```

2. **Build the application:**

```bash
bun run build
```

3. **Run migrations:**

```bash
bun run db:migrate:deploy
```

4. **Start the service:**

```bash
bun run start
```

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start the service
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save
pm2 startup
```

## Database Configuration

### PostgreSQL Setup

1. **Create database and user:**

```sql
CREATE DATABASE userservice;
CREATE USER userservice_user WITH ENCRYPTED PASSWORD 'strong_password';
GRANT ALL PRIVILEGES ON DATABASE userservice TO userservice_user;
```

2. **Enable required extensions:**

```sql
\c userservice;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### Multi-tenant Database Setup

For multi-tenant setup, each tenant gets its own database:

```sql
-- Create tenant database
CREATE DATABASE tenant_acme;
CREATE USER tenant_acme_user WITH ENCRYPTED PASSWORD 'tenant_password';
GRANT ALL PRIVILEGES ON DATABASE tenant_acme TO tenant_acme_user;

-- Run migrations for tenant
DATABASE_URL="postgresql://tenant_acme_user:tenant_password@localhost:5432/tenant_acme" bun run db:push
```


## Email Configuration

### Development (Mailhog)

Mailhog is included in the Docker Compose setup:

```yaml
mailhog:
  image: mailhog/mailhog
  ports:
    - "1025:1025" # SMTP
    - "8025:8025" # Web UI
```

Access the Mailhog UI at `http://localhost:8025`

### Production (SMTP)

Configure your SMTP provider:

```env
# SendGrid
SMTP_HOST="smtp.sendgrid.net"
SMTP_PORT="587"
SMTP_SECURE="true"
SMTP_USER="apikey"
SMTP_PASS="your-sendgrid-api-key"

# AWS SES
SMTP_HOST="email-smtp.us-east-1.amazonaws.com"
SMTP_PORT="587"
SMTP_SECURE="true"
SMTP_USER="your-smtp-username"
SMTP_PASS="your-smtp-password"
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/db` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | Secret key for JWT signing | `your-secret-key` |
| `ENCRYPTION_KEY` | 32-character key for encryption | `12345678901234567890123456789012` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `LOG_LEVEL` | Logging level | `info` |
| `CORS_ORIGINS` | Allowed CORS origins | `http://localhost:3000` |
| `RATE_LIMIT_MAX` | Max requests per window | `100` |
| `RATE_LIMIT_WINDOW` | Rate limit window (ms) | `900000` |

### Feature Flags

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_MFA` | Enable MFA features | `true` |
| `ENABLE_SOCIAL_LOGIN` | Enable social auth | `true` |
| `ENABLE_MAGIC_LINKS` | Enable magic links | `true` |
| `ENABLE_DEVICE_TRACKING` | Enable device tracking | `true` |

## Troubleshooting

### Common Issues

#### 1. Database Connection Failed

```bash
Error: Can't connect to PostgreSQL
```

**Solution:**
- Check if PostgreSQL is running: `docker ps`
- Verify DATABASE_URL is correct
- Check PostgreSQL logs: `docker logs postgres`

#### 2. Redis Connection Failed

```bash
Error: Redis connection refused
```

**Solution:**
- Check if Redis is running: `docker ps`
- Verify REDIS_URL is correct
- Test connection: `redis-cli ping`

#### 3. Prisma Client Not Found

```bash
Error: @prisma/client did not initialize yet
```

**Solution:**
```bash
bun run db:generate
```

#### 4. Port Already in Use

```bash
Error: EADDRINUSE: address already in use :::3000
```

**Solution:**
- Change the PORT in .env
- Or kill the process: `lsof -ti:3000 | xargs kill`

### Debug Mode

Enable debug logging:

```env
LOG_LEVEL="debug"
DEBUG="*"
```

### Health Checks

Monitor service health:

```bash
# Basic health check
curl http://localhost:3000/health

# Detailed health check
curl http://localhost:3000/health/detailed
```

## Next Steps

- Read the [API Documentation](./API.md) to understand available endpoints
- Review the [Architecture Overview](./ARCHITECTURE.md) for system design
- Set up monitoring and alerting for production
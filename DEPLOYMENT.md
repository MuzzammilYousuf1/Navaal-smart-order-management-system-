# Smart OrderFlow — Deployment Guide

> **Last updated:** 2026-08-30  
> **Stack:** FastAPI · PostgreSQL 16 · React/Vite · n8n · Caddy (auto-SSL)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Environment Variables](#environment-variables)
4. [First-Time Deployment](#first-time-deployment)
5. [Database Migration (SQLite → Postgres)](#database-migration)
6. [Running Schema Migrations (Alembic)](#schema-migrations)
7. [Nightly Backup](#nightly-backup)
8. [Updating the Application](#updating-the-application)
9. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
Internet
   │
   ▼
Caddy (ports 80/443, auto-SSL via Let's Encrypt)
   ├── api.yourdomain.com      → backend:8000  (FastAPI)
   ├── orders.yourdomain.com   → frontend:80   (React/Nginx)
   └── n8n.yourdomain.com      → n8n:5678
           │
           ▼ (internal Docker network: sof-network)
       backend → db (postgres:16)
```

---

## Prerequisites

- VPS with **Docker** and **Docker Compose v2** installed
- DNS A-records for `api.*`, `orders.*`, and `n8n.*` pointing to your VPS IP
- Ports **80** and **443** open in the VPS firewall

```bash
# Install Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

---

## Environment Variables

Copy `.env.example` to `.env` in the project root and fill in every value:

```bash
cp .env.example .env
nano .env
```

### Complete Variable Reference

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_USER` | ✅ | PostgreSQL username |
| `POSTGRES_PASSWORD` | ✅ | PostgreSQL password — use a strong random string |
| `POSTGRES_DB` | ✅ | PostgreSQL database name |
| `API_DOMAIN` | ✅ | Backend domain, e.g. `api.navaalfood.com` |
| `APP_DOMAIN` | ✅ | Frontend domain, e.g. `orders.navaalfood.com` |
| `N8N_DOMAIN` | ✅ | n8n domain, e.g. `n8n.navaalfood.com` |
| `SOF_SECRET_KEY` | ✅ | JWT signing secret — `openssl rand -hex 32` |
| `N8N_API_KEY` | ✅ | Shared secret for n8n → backend webhook auth |
| `N8N_OFD_WEBHOOK_URL` | ✅ | n8n webhook URL for Out-For-Delivery trigger |
| `N8N_ENCRYPTION_KEY` | ✅ | n8n credential encryption key — `openssl rand -hex 32` |
| `CORS_ORIGINS` | ✅ | Comma-separated allowed frontend origins |
| `SMTP_HOST` | ✅ | SMTP server hostname (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | ✅ | SMTP port (587 for TLS) |
| `SMTP_USERNAME` | ✅ | SMTP login email address |
| `SMTP_PASSWORD` | ✅ | SMTP password / app password |
| `SMTP_FROM_EMAIL` | ✅ | From address for outgoing emails |
| `REPORT_RECIPIENT_EMAIL` | ✅ | Owner email to receive daily reports |
| `REPORT_SEND_TIME` | ✅ | 24h HH:MM to send report (e.g. `23:50`) |
| `META_PHONE_NUMBER_ID` | ⚠️ | WhatsApp Cloud API phone number ID |
| `META_ACCESS_TOKEN` | ⚠️ | WhatsApp Cloud API permanent access token |
| `META_VERIFY_TOKEN` | ⚠️ | Meta webhook verification token |
| `GROQ_API_KEY` | ⚠️ | Groq API key for n8n AI agent |
| `GEMINI_API_KEY` | ⚠️ | Google Gemini API key for n8n AI agent |
| `S3_BUCKET` | Optional | S3/R2 bucket URL for backup uploads |
| `AWS_ACCESS_KEY_ID` | Optional | S3/R2 access key |
| `AWS_SECRET_ACCESS_KEY` | Optional | S3/R2 secret key |
| `AWS_DEFAULT_REGION` | Optional | Region (use `auto` for Cloudflare R2) |
| `AWS_ENDPOINT_URL` | Optional | Custom endpoint for Cloudflare R2 |

> ✅ = Required for any deployment  
> ⚠️ = Required only if the related feature is enabled

---

## First-Time Deployment

```bash
# 1. Clone the repo on your VPS
git clone https://github.com/your-org/navaal-smart-orderflow.git /opt/sof
cd /opt/sof

# 2. Create .env from the example
cp .env.example .env
nano .env   # fill in all required values

# 3. Build and start all services
docker compose up -d --build

# 4. Verify all services are healthy
docker compose ps

# 5. Run Alembic migrations to create all tables
docker compose exec backend alembic upgrade head

# 6. (Optional) Seed the first admin user
docker compose exec backend python seed.py
```

After a minute, Caddy will obtain SSL certificates automatically via Let's Encrypt.

---

## Database Migration

> **Only required once** — when moving from the existing SQLite database to Postgres.

```bash
# 1. Copy your sof.db to the VPS
scp backend/sof.db user@your-vps:/opt/sof/backend/sof.db

# 2. Ensure tables are created first
docker compose exec backend alembic upgrade head

# 3. Run the migration script
docker compose exec backend python migrate_sqlite_to_postgres.py

# The script logs row counts per table and exits non-zero on any mismatch.
```

---

## Schema Migrations

Whenever the ORM models change, generate and apply a migration:

```bash
# Generate a new migration (detect model changes)
docker compose exec backend alembic revision --autogenerate -m "describe_change"

# Apply pending migrations
docker compose exec backend alembic upgrade head

# Rollback one step (if needed)
docker compose exec backend alembic downgrade -1
```

---

## Nightly Backup

The `backup_postgres.sh` script dumps the database, compresses it, and optionally uploads to S3/R2.

```bash
# Make executable
chmod +x /opt/sof/backup_postgres.sh

# Test it manually (requires PGPASSWORD env var)
PGPASSWORD=your_password /opt/sof/backup_postgres.sh

# Install as a cron job (runs at 02:00 every night)
(crontab -l 2>/dev/null; echo "0 2 * * * PGPASSWORD=your_password /opt/sof/backup_postgres.sh >> /var/log/sof-backup.log 2>&1") | crontab -
```

Backups are stored in `BACKUP_DIR` (default: `/opt/sof/backups`) and kept for `BACKUP_RETAIN_DAYS` days (default: 14).

---

## Updating the Application

```bash
cd /opt/sof
git pull origin main

# Rebuild and restart (zero-downtime: Caddy keeps proxying during restart)
docker compose up -d --build

# Apply any new DB migrations
docker compose exec backend alembic upgrade head
```

---

## Troubleshooting

### Check service logs
```bash
docker compose logs backend --tail=100 -f
docker compose logs db --tail=50
docker compose logs caddy --tail=50
```

### Backend health check
```bash
curl https://api.yourdomain.com/health
# Expected: {"status": "ok"}
```

### Database connection issues
```bash
# Shell into postgres container
docker compose exec db psql -U navaal_admin -d sof_production
```

### n8n can't reach the backend
n8n and the backend share the `sof-network` Docker bridge. Inside n8n workflows, use `http://backend:8000` as the API base URL — **not** `localhost` or the public domain.

### SSL certificate not issuing
- Confirm DNS A-records are propagated (`dig api.yourdomain.com`)
- Ensure ports 80 and 443 are open in your VPS firewall
- Check Caddy logs: `docker compose logs caddy`

### Restore from backup
```bash
# Decompress and restore
gunzip -c /opt/sof/backups/sof_sof_production_YYYYMMDD_HHMMSS.sql.gz \
  | docker compose exec -T db psql -U navaal_admin -d sof_production
```

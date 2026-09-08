#!/bin/bash
# =============================================================================
# SOF VPS Fix Script — Fix PostgreSQL sequences, stale order data,
# rebuild containers, and verify the system is fully working.
#
# Run on VPS as: bash /opt/sof/fix_vps.sh
# =============================================================================

set -e
cd /opt/sof

echo ""
echo "======================================================="
echo "  SOF Production Fix — $(date)"
echo "======================================================="

# Load .env variables
if [ -f .env ]; then
    set -o allexport
    source .env
    set +o allexport
fi

# ─── 1. Pull latest code ─────────────────────────────────────────────────────
echo ""
echo "[1/5] Pulling latest code from git..."
git pull origin main

# ─── 2. Fix PostgreSQL sequences directly ────────────────────────────────────
echo ""
echo "[2/5] Resetting PostgreSQL primary key sequences..."
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
DO $$
DECLARE
    tbl TEXT;
    max_id BIGINT;
    seq_name TEXT;
BEGIN
    FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = tbl
              AND column_name = 'id'
        ) THEN
            seq_name := pg_get_serial_sequence(tbl, 'id');
            IF seq_name IS NOT NULL THEN
                EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM "%s"', tbl) INTO max_id;
                PERFORM setval(seq_name, max_id + 1, false);
                RAISE NOTICE 'Reset % -> next id = %', tbl, max_id + 1;
            END IF;
        END IF;
    END LOOP;
END $$;
SQL
echo "  -> Sequences reset OK"

# ─── 3. Fix stale order data ─────────────────────────────────────────────────
echo ""
echo "[3/5] Checking for stale test orders stuck in pipeline (older than 7 days)..."
STALE_COUNT=$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "
    SELECT COUNT(*) FROM orders
    WHERE status IN ('pending', 'out_for_delivery', 'ready_to_ship')
      AND created_at < NOW() - INTERVAL '7 days';
")
STALE_COUNT=$(echo "$STALE_COUNT" | tr -d '[:space:]')
echo "  -> Found $STALE_COUNT stale orders."

if [ "$STALE_COUNT" -gt "0" ]; then
    echo "  -> Cancelling stale orders older than 7 days from active pipeline..."
    docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
        UPDATE orders
        SET status = 'cancelled'
        WHERE status IN ('pending', 'out_for_delivery', 'ready_to_ship')
          AND created_at < NOW() - INTERVAL '7 days';
    "
    echo "  -> Stale orders cancelled OK"
fi

# ─── 4. Rebuild and restart containers ───────────────────────────────────────
echo ""
echo "[4/5] Rebuilding Docker containers with latest code..."
docker compose up -d --build
echo "  -> Containers rebuilt"

echo "  -> Waiting 15s for backend to be healthy..."
sleep 15
docker compose exec -T backend curl -sf http://localhost:8000/health && echo "  -> Backend: OK" || echo "  -> Backend health check failed - check: docker compose logs backend"

# ─── 5. Final verification ───────────────────────────────────────────────────
echo ""
echo "[5/5] Final verification..."
docker compose ps
echo ""
echo "======================================================="
echo "  SOF Fix Complete!"
echo "  Dashboard: https://orders.navaalfoods.com"
echo "======================================================="

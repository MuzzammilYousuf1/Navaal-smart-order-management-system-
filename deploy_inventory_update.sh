#!/bin/bash
# =============================================================================
# SOF VPS Deployment — Warehouse Inventory Management System Update
# Run on VPS:  bash /opt/sof/deploy_inventory_update.sh
# =============================================================================
set -e
cd /opt/sof

echo ""
echo "============================================================"
echo "  SOF — Warehouse Inventory Deployment  $(date)"
echo "============================================================"

if [ -f .env ]; then
    set -o allexport; source .env; set +o allexport
    echo "[OK] .env loaded"
else
    echo "[ERROR] .env not found"; exit 1
fi

echo ""
echo "[1/6] Pulling latest code..."
git pull origin main

echo ""
echo "[2/6] Rebuilding backend + frontend containers..."
docker compose build --no-cache backend frontend

echo ""
echo "[3/6] Starting all services..."
docker compose up -d
echo "  -> Waiting 25s for backend to initialise..."
sleep 25

echo ""
echo "[4/6] Applying DB schema migrations..."
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'ENDSQL'
-- vendors table
CREATE TABLE IF NOT EXISTS vendors (
    id SERIAL PRIMARY KEY,
    name VARCHAR UNIQUE NOT NULL,
    contact_person VARCHAR,
    phone VARCHAR,
    email VARCHAR,
    address TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- packaging_materials table
CREATE TABLE IF NOT EXISTS packaging_materials (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    sku VARCHAR UNIQUE NOT NULL,
    pack_type VARCHAR,
    stock_qty FLOAT DEFAULT 0.0,
    unit_cost FLOAT DEFAULT 0.0,
    low_stock_threshold FLOAT DEFAULT 50.0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- daily_inventory_logs new columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='daily_inventory_logs' AND column_name='vendor_id') THEN
        ALTER TABLE daily_inventory_logs ADD COLUMN vendor_id INTEGER; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='daily_inventory_logs' AND column_name='vendor_name') THEN
        ALTER TABLE daily_inventory_logs ADD COLUMN vendor_name VARCHAR; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='daily_inventory_logs' AND column_name='peti_qty') THEN
        ALTER TABLE daily_inventory_logs ADD COLUMN peti_qty FLOAT DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='daily_inventory_logs' AND column_name='carton_qty') THEN
        ALTER TABLE daily_inventory_logs ADD COLUMN carton_qty FLOAT DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='daily_inventory_logs' AND column_name='loose_qty') THEN
        ALTER TABLE daily_inventory_logs ADD COLUMN loose_qty FLOAT DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='daily_inventory_logs' AND column_name='spoilage_vendor_id') THEN
        ALTER TABLE daily_inventory_logs ADD COLUMN spoilage_vendor_id INTEGER; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='daily_inventory_logs' AND column_name='spoilage_vendor_name') THEN
        ALTER TABLE daily_inventory_logs ADD COLUMN spoilage_vendor_name VARCHAR; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='daily_inventory_logs' AND column_name='spoilage_reason') THEN
        ALTER TABLE daily_inventory_logs ADD COLUMN spoilage_reason VARCHAR; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='daily_inventory_logs' AND column_name='total_cost') THEN
        ALTER TABLE daily_inventory_logs ADD COLUMN total_cost FLOAT DEFAULT 0; END IF;
    RAISE NOTICE 'daily_inventory_logs migration OK';
END $$;

SELECT tablename FROM pg_tables
WHERE schemaname='public' AND tablename IN ('vendors','packaging_materials','daily_inventory_logs')
ORDER BY tablename;
ENDSQL
echo "  -> Schema migrations done"

echo ""
echo "[5/6] Resetting PostgreSQL sequences..."
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'ENDSQL'
DO $$
DECLARE tbl TEXT; max_id BIGINT; seq_name TEXT;
BEGIN
    FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=tbl AND column_name='id') THEN
            seq_name := pg_get_serial_sequence(tbl,'id');
            IF seq_name IS NOT NULL THEN
                EXECUTE format('SELECT COALESCE(MAX(id),0) FROM "%s"', tbl) INTO max_id;
                PERFORM setval(seq_name, max_id+1, false);
                RAISE NOTICE 'Reset % -> next=%', tbl, max_id+1;
            END IF;
        END IF;
    END LOOP;
END $$;
ENDSQL
echo "  -> Sequences reset"

echo ""
echo "[6/6] Health check..."
sleep 5
docker compose exec -T backend curl -sf http://localhost:8000/health && echo "  -> Backend: OK" || echo "  -> [WARN] Backend check failed - run: docker compose logs backend"
docker compose ps

echo ""
echo "  -> Row counts:"
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT
  (SELECT COUNT(*) FROM vendors)               AS vendors,
  (SELECT COUNT(*) FROM packaging_materials)   AS packaging_materials,
  (SELECT COUNT(*) FROM daily_inventory_logs)  AS daily_inventory_logs;
"

echo ""
echo "============================================================"
echo "  DEPLOYMENT COMPLETE!"
echo "  Dashboard:      https://orders.navaalfoods.com"
echo "  Warehouse Logs: https://orders.navaalfoods.com/daily-inventory"
echo "  New: Vendors, Peti/Carton/Loose tracking, Spoilage accountability"
echo "============================================================"

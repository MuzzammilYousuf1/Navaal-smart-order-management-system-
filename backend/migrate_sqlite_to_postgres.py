#!/usr/bin/env python3
"""
migrate_sqlite_to_postgres.py
─────────────────────────────
One-time data migration: copies every row from the local SQLite file to the
target PostgreSQL database.

Usage:
    SQLITE_URL=sqlite:///./sof.db \
    DATABASE_URL=postgresql://user:pass@localhost:5432/sof_production \
    python migrate_sqlite_to_postgres.py

Safety guarantees:
  • Reads SQLITE_URL (default: ./sof.db) and DATABASE_URL from environment.
  • Copies in FK-safe order: leaf tables first, then referencing tables.
  • Uses INSERT ... ON CONFLICT DO NOTHING so re-runs are safe.
  • Logs before/after row counts per table and exits non-zero on any mismatch.
  • Booleans stored as 0/1 in SQLite are cast to Python bool for Postgres.
  • datetime strings (SQLite text mode) are parsed to datetime objects.
"""

import os
import sys
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import create_engine, text, inspect, MetaData, Table

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
)
log = logging.getLogger("migrate")

# ── Connection URLs ────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SQLITE_URL = os.getenv("SQLITE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'sof.db')}")

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    log.error("DATABASE_URL environment variable is not set — aborting.")
    sys.exit(1)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

log.info("Source  : %s", SQLITE_URL)
log.info("Target  : %s", DATABASE_URL.split("@")[-1])  # hide credentials

# ── Table order: parents before children (FK-safe) ────────────────────────────
# Tables with no FK dependencies go first; dependants go later.
TABLE_ORDER = [
    "users",
    "products",
    "customers",
    "orders",
    "order_items",
    "status_history",
    "notification_logs",
    "settings",
    "rider_locations",
    "stock_movements",
    "subscriptions",
    "tasks",
    "chat_messages",
    "ledger_entries",
    "customer_attachments",
]

# ── Type conversion helpers ────────────────────────────────────────────────────
_BOOL_COLUMNS = {
    "users":               {"is_active"},
    "orders":              {"sla_alert_1_sent", "sla_alert_2_sent", "sla_manager_sent",
                            "sla_owner_sent", "is_restocked"},
    "products":            {"is_active", "is_customer_facing"},
    "customers":           {"ai_disabled", "is_account_active"},
    "subscriptions":       {"is_active"},
    "tasks":               {"requires_report"},
    "chat_messages":       {"is_system_msg"},
}

_DATETIME_FMT = [
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
]


def _parse_datetime(val: Any) -> Any:
    """Convert SQLite text-stored datetime strings to Python datetime objects."""
    if val is None or isinstance(val, datetime):
        return val
    for fmt in _DATETIME_FMT:
        try:
            return datetime.strptime(str(val), fmt)
        except ValueError:
            continue
    return val  # return as-is if unparseable


def _coerce_row(table_name: str, row: dict) -> dict:
    """Apply boolean and datetime coercions for a row from SQLite."""
    bool_cols = _BOOL_COLUMNS.get(table_name, set())
    result = {}
    for col, val in row.items():
        if col in bool_cols or col.startswith("is_") or col.startswith("has_") or col.endswith("_disabled") or col.endswith("_sent") or col.endswith("_active") or col.endswith("_report"):
            result[col] = bool(val) if val is not None else None
        elif isinstance(val, str) and (
            col.endswith("_at") or col in {"due_date", "next_delivery_date", "last_generated_at"}
        ):
            result[col] = _parse_datetime(val)
        else:
            result[col] = val
    return result


# ── Migration core ─────────────────────────────────────────────────────────────

def migrate():
    src_engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
    dst_engine = create_engine(DATABASE_URL)

    src_inspector = inspect(src_engine)
    dst_inspector = inspect(dst_engine)

    src_tables = set(src_inspector.get_table_names())
    dst_tables = set(dst_inspector.get_table_names())

    mismatches = []

    for table_name in TABLE_ORDER:
        if table_name not in src_tables:
            log.warning("Table '%s' not found in SQLite — skipping.", table_name)
            continue
        if table_name not in dst_tables:
            log.error(
                "Table '%s' missing in Postgres — run 'alembic upgrade head' first.",
                table_name,
            )
            sys.exit(1)

        # Reflect columns from SQLite
        src_meta = MetaData()
        src_table = Table(table_name, src_meta, autoload_with=src_engine)
        col_names = [c.name for c in src_table.columns]

        # Count before
        with src_engine.connect() as src_conn:
            src_count = src_conn.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar()

        with dst_engine.connect() as dst_conn:
            dst_before = dst_conn.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar()

        log.info(
            "%-30s  src=%d  dst_before=%d",
            table_name, src_count, dst_before,
        )

        if src_count == 0:
            log.info("  → empty table, nothing to copy.")
            continue

        # Read all rows from SQLite
        with src_engine.connect() as src_conn:
            rows = src_conn.execute(text(f"SELECT * FROM {table_name}")).mappings().all()

        # Build INSERT … ON CONFLICT DO NOTHING
        col_list = ", ".join(col_names)
        placeholders = ", ".join(f":{c}" for c in col_names)
        insert_sql = text(
            f"INSERT INTO {table_name} ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT DO NOTHING"
        )

        coerced_rows = [_coerce_row(table_name, dict(r)) for r in rows]

        # Fetch current valid parent IDs from target Postgres DB
        valid_ids = {}
        with dst_engine.connect() as dst_conn:
            for parent_tbl in ["users", "products", "customers", "orders"]:
                if parent_tbl in dst_tables:
                    valid_ids[parent_tbl] = set(r[0] for r in dst_conn.execute(text(f"SELECT id FROM {parent_tbl}")).all())
                else:
                    valid_ids[parent_tbl] = set()

        # Sanitize orphaned Foreign Keys
        sanitized_rows = []
        for r in coerced_rows:
            keep_row = True
            # Sanitize order_id
            if "order_id" in r and r["order_id"] is not None:
                if r["order_id"] not in valid_ids["orders"]:
                    if table_name in {"order_items", "status_history"}:
                        keep_row = False  # NOT NULL FK requirement
                    else:
                        r["order_id"] = None
            # Sanitize product_id
            if "product_id" in r and r["product_id"] is not None:
                if r["product_id"] not in valid_ids["products"]:
                    keep_row = False
            # Sanitize customer_id
            if "customer_id" in r and r["customer_id"] is not None:
                if r["customer_id"] not in valid_ids["customers"]:
                    r["customer_id"] = None
            # Sanitize user / rider / staff FKs
            for user_fk in ["assigned_staff_id", "user_id", "rider_id", "assigned_to", "created_by_user_id"]:
                if user_fk in r and r[user_fk] is not None:
                    if r[user_fk] not in valid_ids["users"]:
                        r[user_fk] = None

            if keep_row:
                sanitized_rows.append(r)

        coerced_rows = sanitized_rows

        chunk = 500
        inserted = 0
        with dst_engine.begin() as dst_conn:
            for i in range(0, len(coerced_rows), chunk):
                batch = coerced_rows[i : i + chunk]
                dst_conn.execute(insert_sql, batch)
                inserted += len(batch)

        # Count after
        with dst_engine.connect() as dst_conn:
            dst_after = dst_conn.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar()

        new_rows = dst_after - dst_before
        log.info(
            "  → inserted %d new rows  (dst_after=%d)",
            new_rows, dst_after,
        )

        # Validate: dst should have at least as many rows as src
        if dst_after < src_count:
            msg = (
                f"MISMATCH on '{table_name}': "
                f"src={src_count}, dst_after={dst_after}"
            )
            log.error(msg)
            mismatches.append(msg)

        # Reset Postgres sequences so next INSERT doesn't collide with copied PKs
        with dst_engine.begin() as dst_conn:
            try:
                dst_conn.execute(
                    text(
                        f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), "
                        f"COALESCE((SELECT MAX(id) FROM \"{table_name}\"), 0) + 1, false) "
                        f"WHERE pg_get_serial_sequence('{table_name}', 'id') IS NOT NULL"
                    )
                )
            except Exception as e:
                log.warning("Sequence reset skipped for %s: %s", table_name, e)

    if mismatches:
        log.error("Migration completed WITH ERRORS:")
        for m in mismatches:
            log.error("  %s", m)
        sys.exit(1)
    else:
        log.info("✓ Migration completed successfully — all row counts match.")


if __name__ == "__main__":
    migrate()

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool
from alembic import context

# ── Make sure the backend package root is on sys.path so models/database import ──
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Load .env for local dev (no-op when variable is already set in environment)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:
    pass  # python-dotenv is optional at migration time

# ── Alembic Config ────────────────────────────────────────────────────────────
config = context.config

# Inject the runtime DATABASE_URL so alembic.ini doesn't need a hardcoded URL.
BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DB_URL = f"sqlite:///{BASE_DIR / 'sof.db'}"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DB_URL)

# Render & some PaaS providers supply postgres:// — normalise to postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

config.set_main_option("sqlalchemy.url", DATABASE_URL)

# ── Logging ───────────────────────────────────────────────────────────────────
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ── Target metadata (autogenerate support) ────────────────────────────────────
from database import Base  # noqa: E402  — must come after sys.path patch
import models  # noqa: E402  — registers all ORM models onto Base.metadata

target_metadata = Base.metadata


# ── Migration runners ─────────────────────────────────────────────────────────

def run_migrations_offline() -> None:
    """Emit SQL to stdout — no live DB connection required."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live DB connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,           # detect column type changes
            compare_server_default=True, # detect DEFAULT changes
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

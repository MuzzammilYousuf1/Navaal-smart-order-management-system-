import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_URL = f"sqlite:///{os.path.join(BASE_DIR, 'sof.db')}"

# Retrieve the database URL from the environment, defaulting to the local SQLite database
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DB_URL)

# Normalize the PostgreSQL scheme prefix
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Apply SQLite-specific check-same-thread argument only when running SQLite
connect_args = {}
if "sqlite" in DATABASE_URL:
    connect_args["check_same_thread"] = False

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def sync_db_sequences(target_engine):
    """
    Auto-resets PostgreSQL auto-increment sequences (e.g. orders_id_seq)
    to MAX(id) + 1 to prevent primary key collisions after manual data imports or migrations.
    """
    if "postgresql" not in target_engine.url.drivername and "postgres" not in target_engine.url.drivername:
        return

    from sqlalchemy import inspect, text
    try:
        inspector = inspect(target_engine)
        table_names = inspector.get_table_names()
        with target_engine.begin() as conn:
            for tbl in table_names:
                cols = [c["name"] for c in inspector.get_columns(tbl)]
                if "id" in cols:
                    sql = text(f"""
                        SELECT setval(
                            pg_get_serial_sequence('{tbl}', 'id'),
                            COALESCE((SELECT MAX(id) FROM "{tbl}"), 0) + 1,
                            false
                        )
                        WHERE pg_get_serial_sequence('{tbl}', 'id') IS NOT NULL;
                    """)
                    conn.execute(sql)
    except Exception as exc:
        print(f"Warning during sequence sync: {exc}")



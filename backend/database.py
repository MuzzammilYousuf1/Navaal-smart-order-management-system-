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


import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# --- Local SQLite Path configuration (Kept exactly as you had it) ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "sof.db")

# --- Dynamic Database URL Assignment ---
# Check if a cloud database variable exists (Render will provide this)
DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    # Ensure correct Postgres prefix required by SQLAlchemy 1.4+
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
else:
    # Fallback to your local SQLite file if running on your machine
    DATABASE_URL = f"sqlite:///{DB_PATH}"

# --- Create Engine dynamically ---
if "sqlite" in DATABASE_URL:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False}
    )
else:
    engine = create_engine(DATABASE_URL)

# --- Session & Base configuration (Kept exactly as you had it) ---
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

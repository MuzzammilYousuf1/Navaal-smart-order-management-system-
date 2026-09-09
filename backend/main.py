"""
Main FastAPI application for Smart OrderFlow (SOF)
Navaal-Organic-Foods — Internal Order Management System
"""
from dotenv import load_dotenv
load_dotenv()

import os
import logging
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from database import engine
import models
from sla_engine import run_sla_check, set_ws_manager
from routers import auth, orders, dashboard, reports, notifications, users, tracking, inventory, invoices, data_mgmt, customers, subscriptions, tasks, chat, webhook_n8n, ledger, accounts


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")


# ─── WebSocket Connection Manager ─────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WS connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WS disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead.append(connection)
        for d in dead:
            self.disconnect(d)


manager = ConnectionManager()
scheduler = AsyncIOScheduler()


# ─── App Lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all tables
    models.Base.metadata.create_all(bind=engine)

    # Database-agnostic column migration helper using SQLAlchemy Inspector
    from sqlalchemy import inspect
    inspector = inspect(engine)

    with engine.begin() as connection:
        is_sqlite = "sqlite" in engine.url.drivername
        datetime_type = "DATETIME" if is_sqlite else "TIMESTAMP"
        bool_false = "0" if is_sqlite else "FALSE"
        bool_true = "1" if is_sqlite else "TRUE"

        # 1. Migrate orders table
        if inspector.has_table("orders"):
            columns = {col["name"] for col in inspector.get_columns("orders")}
            if "payment_method" not in columns:
                connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN payment_method VARCHAR DEFAULT 'cod'")
            if "amount_received" not in columns:
                connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN amount_received FLOAT DEFAULT 0")
            if "payment_received_at" not in columns:
                connection.exec_driver_sql(f"ALTER TABLE orders ADD COLUMN payment_received_at {datetime_type}")
            if "location_url" not in columns:
                connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN location_url TEXT")
            if "gate_pass_no" not in columns:
                connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN gate_pass_no VARCHAR")
            if "gate_pass_printed_at" not in columns:
                connection.exec_driver_sql(f"ALTER TABLE orders ADD COLUMN gate_pass_printed_at {datetime_type}")
            if "is_restocked" not in columns:
                connection.exec_driver_sql(f"ALTER TABLE orders ADD COLUMN is_restocked BOOLEAN DEFAULT {bool_false}")
            if "channel" not in columns:
                connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN channel VARCHAR DEFAULT 'b2c'")

        # 2. Migrate products table
        if inspector.has_table("products"):
            prod_columns = {col["name"] for col in inspector.get_columns("products")}
            if "base_product_id" not in prod_columns:
                connection.exec_driver_sql("ALTER TABLE products ADD COLUMN base_product_id INTEGER")
            if "unit_multiplier" not in prod_columns:
                connection.exec_driver_sql("ALTER TABLE products ADD COLUMN unit_multiplier FLOAT DEFAULT 1.0")
            if "is_customer_facing" not in prod_columns:
                connection.exec_driver_sql(f"ALTER TABLE products ADD COLUMN is_customer_facing BOOLEAN DEFAULT {bool_false}")
                # Seed defaults
                connection.exec_driver_sql(f"""
                    UPDATE products 
                    SET is_customer_facing = {bool_true} 
                    WHERE lower(name) LIKE '%300g%' 
                       OR lower(name) LIKE '%800g%' 
                       OR lower(name) LIKE '%300gm%' 
                       OR lower(name) LIKE '%800gm%' 
                       OR lower(name) LIKE '%petty%' 
                       OR lower(name) LIKE '%pack of 6%' 
                       OR lower(name) LIKE '%pack of 15%' 
                       OR lower(name) LIKE '%pack of 30%' 
                       OR lower(name) LIKE '%pack 6%' 
                       OR lower(name) LIKE '%pack 15%' 
                       OR lower(sku) LIKE '%p6%' 
                       OR lower(sku) LIKE '%p15%' 
                       OR lower(sku) LIKE '%p30%'
                """)

        # 3. Migrate tasks table
        if inspector.has_table("tasks"):
            task_columns = {col["name"] for col in inspector.get_columns("tasks")}
            if "form_schema" not in task_columns:
                connection.exec_driver_sql("ALTER TABLE tasks ADD COLUMN form_schema TEXT")
            if "requires_report" not in task_columns:
                connection.exec_driver_sql(f"ALTER TABLE tasks ADD COLUMN requires_report BOOLEAN DEFAULT {bool_false}")

        # 4. Migrate order_items table
        if inspector.has_table("order_items"):
            oi_columns = {col["name"] for col in inspector.get_columns("order_items")}
            if "product_id" not in oi_columns:
                connection.exec_driver_sql("ALTER TABLE order_items ADD COLUMN product_id INTEGER")

        # 5. Migrate customers table
        if inspector.has_table("customers"):
            cust_columns = {col["name"] for col in inspector.get_columns("customers")}
            if "ai_disabled" not in cust_columns:
                connection.exec_driver_sql(f"ALTER TABLE customers ADD COLUMN ai_disabled BOOLEAN DEFAULT {bool_false}")
            if "last_interaction_at" not in cust_columns:
                connection.exec_driver_sql(f"ALTER TABLE customers ADD COLUMN last_interaction_at {datetime_type}")
            if "email" not in cust_columns:
                connection.exec_driver_sql("ALTER TABLE customers ADD COLUMN email VARCHAR")
            if "account_type" not in cust_columns:
                connection.exec_driver_sql("ALTER TABLE customers ADD COLUMN account_type VARCHAR DEFAULT 'b2c'")
            if "company_name" not in cust_columns:
                connection.exec_driver_sql("ALTER TABLE customers ADD COLUMN company_name VARCHAR")
            if "contact_person" not in cust_columns:
                connection.exec_driver_sql("ALTER TABLE customers ADD COLUMN contact_person VARCHAR")
            if "tax_id" not in cust_columns:
                connection.exec_driver_sql("ALTER TABLE customers ADD COLUMN tax_id VARCHAR")
            if "credit_limit" not in cust_columns:
                connection.exec_driver_sql("ALTER TABLE customers ADD COLUMN credit_limit FLOAT DEFAULT 0")
            if "payment_terms" not in cust_columns:
                connection.exec_driver_sql("ALTER TABLE customers ADD COLUMN payment_terms VARCHAR DEFAULT 'cod'")
            if "opening_balance" not in cust_columns:
                connection.exec_driver_sql("ALTER TABLE customers ADD COLUMN opening_balance FLOAT DEFAULT 0")
            if "is_account_active" not in cust_columns:
                connection.exec_driver_sql(f"ALTER TABLE customers ADD COLUMN is_account_active BOOLEAN DEFAULT {bool_true}")

        # 6. Migrate ledger_entries table
        if inspector.has_table("ledger_entries"):
            ledger_columns = {col["name"] for col in inspector.get_columns("ledger_entries")}
            if "channel" not in ledger_columns:
                connection.exec_driver_sql("ALTER TABLE ledger_entries ADD COLUMN channel VARCHAR DEFAULT 'b2c'")
            if "account_invoice_id" not in ledger_columns:
                connection.exec_driver_sql("ALTER TABLE ledger_entries ADD COLUMN account_invoice_id INTEGER")
            if "payment_method" not in ledger_columns:
                connection.exec_driver_sql("ALTER TABLE ledger_entries ADD COLUMN payment_method VARCHAR")
            if "reference_no" not in ledger_columns:
                connection.exec_driver_sql("ALTER TABLE ledger_entries ADD COLUMN reference_no VARCHAR")
            if "notes" not in ledger_columns:
                connection.exec_driver_sql("ALTER TABLE ledger_entries ADD COLUMN notes TEXT")

    logger.info("Database tables created/verified ✓")

    # Automatically sync PostgreSQL primary key sequences to MAX(id) + 1
    from database import sync_db_sequences
    sync_db_sequences(engine)
    logger.info("PostgreSQL sequences synchronized ✓")

    # Give SLA engine access to WebSocket manager
    set_ws_manager(manager)

    # Start background SLA scheduler (every 60 seconds)
    scheduler.add_job(run_sla_check, "interval", seconds=60, id="sla_check")
    
    # Start background Email Report scheduler (daily at configured time)
    try:
        from email_reports import schedule_daily_report
        schedule_daily_report(scheduler)
    except Exception as e:
        logger.error(f"Failed to setup email report scheduler: {e}")

    scheduler.start()
    logger.info("Scheduler started ✓")

    yield

    scheduler.shutdown()
    logger.info("Scheduler stopped")



# ─── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Smart OrderFlow — Navaal-Organic-Foods",
    description="Internal order management system with SLA monitoring",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Routers ──────────────────────────────────────────────────────────────────

app.include_router(auth.router)
app.include_router(orders.router)
app.include_router(dashboard.router)
app.include_router(reports.router)
app.include_router(notifications.router)
app.include_router(users.router)
app.include_router(tracking.router)
app.include_router(inventory.router)
app.include_router(invoices.router)
app.include_router(data_mgmt.router)
app.include_router(customers.router)
app.include_router(subscriptions.router)
app.include_router(tasks.router)
app.include_router(chat.router)
app.include_router(webhook_n8n.router)
app.include_router(webhook_n8n.attachments_router)
app.include_router(ledger.router)
app.include_router(accounts.router)




# ─── WebSocket Endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; client pings every 30s
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.get("/")
def root():
    return {
        "app": "Smart OrderFlow",
        "company": "Navaal-Organic-Foods",
        "version": "1.0.0",
        "status": "running",
    }


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

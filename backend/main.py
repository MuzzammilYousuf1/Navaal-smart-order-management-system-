"""
Main FastAPI application for Smart OrderFlow (SOF)
Navaal-Organic-Foods — Internal Order Management System
"""
import logging
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from database import engine
import models
from sla_engine import run_sla_check, set_ws_manager
from routers import auth, orders, dashboard, reports, notifications, users, tracking, inventory, invoices, data_mgmt, customers, subscriptions, tasks, chat

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
    # Add the payment-settlement fields for databases created before this update.
    with engine.begin() as connection:
        columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(orders)")}
        if "payment_method" not in columns:
            connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN payment_method VARCHAR DEFAULT 'cod'")
        if "amount_received" not in columns:
            connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN amount_received FLOAT DEFAULT 0")
        if "payment_received_at" not in columns:
            connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN payment_received_at DATETIME")
        if "location_url" not in columns:
            connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN location_url TEXT")

        # Add tasks/subunits columns to products table if missing
        prod_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(products)")}
        if "base_product_id" not in prod_columns:
            connection.exec_driver_sql("ALTER TABLE products ADD COLUMN base_product_id INTEGER")
        if "unit_multiplier" not in prod_columns:
            connection.exec_driver_sql("ALTER TABLE products ADD COLUMN unit_multiplier FLOAT DEFAULT 1.0")

        # Add new columns to tasks table if missing
        task_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(tasks)")}
        if "form_schema" not in task_columns:
            connection.exec_driver_sql("ALTER TABLE tasks ADD COLUMN form_schema TEXT")
        if "requires_report" not in task_columns:
            connection.exec_driver_sql("ALTER TABLE tasks ADD COLUMN requires_report BOOLEAN DEFAULT 0")

        # Add product_id column to order_items if missing
        oi_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(order_items)")}
        if "product_id" not in oi_columns:
            connection.exec_driver_sql("ALTER TABLE order_items ADD COLUMN product_id INTEGER")

        # Add gate pass and restock columns to orders table if missing
        if "gate_pass_no" not in columns:
            connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN gate_pass_no VARCHAR")
        if "gate_pass_printed_at" not in columns:
            connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN gate_pass_printed_at DATETIME")
        if "is_restocked" not in columns:
            connection.exec_driver_sql("ALTER TABLE orders ADD COLUMN is_restocked BOOLEAN DEFAULT 0")

    logger.info("Database tables created/verified ✓")

    # Give SLA engine access to WebSocket manager
    set_ws_manager(manager)

    # Start background SLA scheduler (every 60 seconds)
    scheduler.add_job(run_sla_check, "interval", seconds=60, id="sla_check")
    scheduler.start()
    logger.info("SLA scheduler started ✓")

    yield

    scheduler.shutdown()
    logger.info("SLA scheduler stopped")


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
    # Authentication uses Authorization headers rather than browser cookies.
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

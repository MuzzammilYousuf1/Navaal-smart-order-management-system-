from sqlalchemy import (
    Column, Integer, String, DateTime, Float, Boolean,
    ForeignKey, Text
)
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    username = Column(String, unique=True, nullable=False, index=True)
    email = Column(String, nullable=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="warehouse")
    # Roles: admin | manager | warehouse | rider | operations
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    assigned_orders = relationship(
        "Order", foreign_keys="Order.assigned_staff_id", back_populates="assigned_staff"
    )


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    order_number = Column(String, unique=True, nullable=False, index=True)

    # Customer info
    customer_name = Column(String, nullable=False)
    customer_phone = Column(String, nullable=True)
    delivery_address = Column(Text, nullable=True)
    city = Column(String, nullable=True)
    location_url = Column(Text, nullable=True)  # Customer's shared Google Maps link

    # Order meta
    source = Column(String, default="website")
    # Sources: website | whatsapp | phone | walk_in
    status = Column(String, default="pending", nullable=False, index=True)
    # Statuses: pending | ready_to_ship | out_for_delivery | delivered | cancelled
    priority = Column(String, default="normal")
    # Priorities: normal | high | urgent
    payment_status = Column(String, default="cod")
    # Payment: paid | unpaid | cod
    payment_method = Column(String, default="cod")
    amount_received = Column(Float, default=0.0)
    payment_received_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    total_amount = Column(Float, default=0.0)

    # Staff / Rider assignment
    assigned_staff_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_rider_name = Column(String, nullable=True)

    # Auto-saved timestamps — NEVER manually typed
    created_at = Column(DateTime, default=datetime.utcnow)
    rts_at = Column(DateTime, nullable=True)          # When status → ready_to_ship
    pickup_at = Column(DateTime, nullable=True)       # When status → out_for_delivery
    delivered_at = Column(DateTime, nullable=True)    # When status → delivered
    pickup_deadline = Column(DateTime, nullable=True) # rts_at + 45 min

    # SLA alert flags (prevent duplicate sends)
    sla_alert_1_sent = Column(Boolean, default=False)  # At 45-min mark
    sla_alert_2_sent = Column(Boolean, default=False)  # At 60-min mark
    sla_manager_sent = Column(Boolean, default=False)  # At 75-min mark
    sla_owner_sent = Column(Boolean, default=False)    # At 90-min mark

    # Rider / Dispatch meta
    gate_pass_no = Column(String, nullable=True)
    gate_pass_printed_at = Column(DateTime, nullable=True)
    is_restocked = Column(Boolean, default=False) # True if inventory was refunded/returned on cancellation/RTS return

    # Relationships
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    status_history = relationship("StatusHistory", back_populates="order", cascade="all, delete-orphan")
    notifications = relationship("NotificationLog", back_populates="order")
    assigned_staff = relationship("User", foreign_keys=[assigned_staff_id], back_populates="assigned_orders")


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String, nullable=False)
    quantity = Column(Integer, default=1)
    unit_price = Column(Float, default=0.0)
    total_price = Column(Float, default=0.0)

    order = relationship("Order", back_populates="items")
    product = relationship("Product")



class StatusHistory(Base):
    __tablename__ = "status_history"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    old_status = Column(String, nullable=True)
    new_status = Column(String, nullable=False)
    changed_by = Column(String, nullable=True)
    changed_at = Column(DateTime, default=datetime.utcnow)
    note = Column(Text, nullable=True)

    order = relationship("Order", back_populates="status_history")


class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    notification_type = Column(String, nullable=False)
    # Types: sla_alert_1 | sla_alert_2 | sla_manager | sla_owner | info | system
    recipient = Column(String, nullable=True)
    subject = Column(String, nullable=True)
    message = Column(Text, nullable=False)
    sent_at = Column(DateTime, default=datetime.utcnow)
    delivery_status = Column(String, default="logged")
    # Statuses: logged | sent | failed

    order = relationship("Order", back_populates="notifications")


class Settings(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True)
    key = Column(String, unique=True, nullable=False)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


class RiderLocation(Base):
    __tablename__ = "rider_locations"

    id = Column(Integer, primary_key=True, index=True)
    rider_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    rider_name = Column(String, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    battery = Column(Integer, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)

    rider = relationship("User")


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    sku = Column(String, unique=True, nullable=False)
    category = Column(String, nullable=True, default="General")
    unit = Column(String, default="unit")      # unit | kg | litre | g | ml
    unit_price = Column(Float, default=0.0)
    stock_qty = Column(Float, default=0.0)
    low_stock_threshold = Column(Float, default=10.0)
    unit_multiplier = Column(Float, default=1.0) # e.g. 6 for pack of 6 eggs, 30 for pack of 30
    base_product_id = Column(Integer, ForeignKey("products.id"), nullable=True) # Linked bulk product
    reorder_point = Column(Integer, nullable=True)  # auto-calculated in Phase 3
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    movements = relationship("StockMovement", back_populates="product", foreign_keys="[StockMovement.product_id]")


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    movement_type = Column(String, nullable=False)
    # Types: sale | restock | adjustment | return
    quantity_change = Column(Float, nullable=False)   # negative for sales/adjustments
    quantity_after = Column(Float, nullable=False)
    note = Column(Text, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product", back_populates="movements")


class Customer(Base):
    """
    Address book — stores known repeat customers with their details.
    Auto-populated from orders; can also be created/edited manually.
    """
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True, index=True)
    delivery_address = Column(Text, nullable=True)
    city = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    preferred_rider = Column(String, nullable=True)
    # Snapshot of most recent order items (JSON string) for quick reorder
    last_items_json = Column(Text, nullable=True)
    last_order_total = Column(Float, nullable=True)
    order_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Subscription(Base):
    """
    Recurring delivery plan for a customer — generates orders automatically.
    """
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    customer_name = Column(String, nullable=False)
    customer_phone = Column(String, nullable=True)
    delivery_address = Column(Text, nullable=True)
    city = Column(String, nullable=True)
    # Frequency: daily | every_other_day | weekly | custom
    frequency = Column(String, default="daily")
    # JSON string: [{"product_name": "6 Eggs Pack", "quantity": 2, "unit_price": 140}, ...]
    items_json = Column(Text, nullable=False)
    total_amount = Column(Float, default=0.0)
    payment_method = Column(String, default="cod")
    assigned_rider_name = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    # Next date on which an order should be auto-generated (UTC date)
    next_delivery_date = Column(DateTime, nullable=True)
    last_generated_at = Column(DateTime, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_to_name = Column(String, nullable=True)
    assigned_by = Column(String, nullable=True)
    status = Column(String, default="pending")  # pending | completed
    due_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    report_json = Column(Text, nullable=True)       # Submitted report data (JSON)
    form_schema = Column(Text, nullable=True)       # Custom form definition (JSON array of fields)
    requires_report = Column(Boolean, default=False) # Whether task needs a form report

    assigned_to = relationship("User", foreign_keys=[assigned_to_id])


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    sender_name = Column(String, nullable=False)
    sender_role = Column(String, nullable=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_system_msg = Column(Boolean, default=False)

    sender = relationship("User")
    task = relationship("Task")
    order = relationship("Order")



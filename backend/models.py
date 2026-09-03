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
    channel = Column(String, default="b2c")
    # Channels: b2c | b2b
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
    is_customer_facing = Column(Boolean, default=False)
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
    Extended with professional accounts fields for B2B/B2C ledger management.
    """
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True, index=True)
    email = Column(String, nullable=True)
    delivery_address = Column(Text, nullable=True)
    city = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    preferred_rider = Column(String, nullable=True)
    # Snapshot of most recent order items (JSON string) for quick reorder
    last_items_json = Column(Text, nullable=True)
    last_order_total = Column(Float, nullable=True)
    order_count = Column(Integer, default=0)
    # AI takeover / supervision flags
    ai_disabled = Column(Boolean, default=False)
    last_interaction_at = Column(DateTime, nullable=True)
    # ── Accounts / Financial Profile ──────────────────────────────────────────
    account_type = Column(String, default="b2c")          # b2c | b2b | other
    company_name = Column(String, nullable=True)           # For B2B accounts
    contact_person = Column(String, nullable=True)         # Primary contact at company
    tax_id = Column(String, nullable=True)                 # NTN / STRN / GST number
    credit_limit = Column(Float, default=0.0)              # Max allowed outstanding balance
    payment_terms = Column(String, default="cod")          # cod | net7 | net15 | net30 | net45
    opening_balance = Column(Float, default=0.0)           # Opening balance when onboarded
    is_account_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    ledger_entries = relationship("LedgerEntry", foreign_keys="[LedgerEntry.customer_phone]",
                                  primaryjoin="Customer.phone == LedgerEntry.customer_phone",
                                  lazy="dynamic")
    account_invoices = relationship("AccountInvoice", back_populates="customer", cascade="all, delete-orphan")


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


class LedgerEntry(Base):
    """
    Customer ledger — one row per financial event.
    Works for both B2C retail customers and B2B mart accounts.
    Debit  = money the customer owes  (order placed, opening balance owed).
    Credit = money received / discount applied.
    Running balance = sum(debits) - sum(credits)  per customer_phone.
    """
    __tablename__ = "ledger_entries"

    id               = Column(Integer, primary_key=True, index=True)
    customer_phone   = Column(String, nullable=False, index=True)
    channel          = Column(String, default="b2c")          # b2c | b2b
    entry_type       = Column(String, nullable=False)          # debit | credit
    amount           = Column(Float,  nullable=False)
    related_order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    account_invoice_id = Column(Integer, ForeignKey("account_invoices.id"), nullable=True)
    description      = Column(String, nullable=True)
    payment_method   = Column(String, nullable=True)           # cash | bank_transfer | cheque | online | other
    reference_no     = Column(String, nullable=True)           # Cheque/TT/payment reference
    notes            = Column(Text, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)
    created_by       = Column(String,  nullable=True)

    related_order    = relationship("Order")
    account_invoice  = relationship("AccountInvoice", foreign_keys=[account_invoice_id])


class AccountInvoice(Base):
    """
    Standalone accounts invoice for B2B/B2C customers — not tied to an order.
    Used for credit sales, service charges, adjustments, and formal invoicing.
    """
    __tablename__ = "account_invoices"

    id              = Column(Integer, primary_key=True, index=True)
    invoice_number  = Column(String, unique=True, nullable=False, index=True)
    customer_id     = Column(Integer, ForeignKey("customers.id"), nullable=False)
    customer_phone  = Column(String, nullable=True, index=True)   # denormalized for quick lookup
    invoice_type    = Column(String, default="sale")               # sale | purchase | credit_note | debit_note | service
    status          = Column(String, default="draft")              # draft | sent | partial | paid | overdue | cancelled
    issue_date      = Column(DateTime, default=datetime.utcnow)
    due_date        = Column(DateTime, nullable=True)
    subtotal        = Column(Float, default=0.0)
    tax_amount      = Column(Float, default=0.0)
    discount_amount = Column(Float, default=0.0)
    total_amount    = Column(Float, default=0.0)
    amount_paid     = Column(Float, default=0.0)
    amount_due      = Column(Float, default=0.0)
    # JSON array: [{"description": str, "qty": float, "unit_price": float, "total": float}]
    line_items_json = Column(Text, nullable=True)
    notes           = Column(Text, nullable=True)
    payment_terms   = Column(String, nullable=True)                # cod | net7 | net15 | net30
    related_order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    created_by      = Column(String, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    customer        = relationship("Customer", back_populates="account_invoices")
    related_order   = relationship("Order")
    payments        = relationship("LedgerEntry",
                                   foreign_keys="[LedgerEntry.account_invoice_id]",
                                   back_populates="account_invoice")


class CustomerAttachment(Base):
    """
    Tracks images/receipts uploaded by customers (e.g. via WhatsApp)
    and their classification statuses (payment, complaint, other).
    """
    __tablename__ = "customer_attachments"

    id               = Column(Integer, primary_key=True, index=True)
    customer_phone   = Column(String, nullable=False, index=True)
    order_id         = Column(Integer, ForeignKey("orders.id"), nullable=True)
    image_path       = Column(String, nullable=False)
    attachment_type  = Column(String, default="unclassified") # unclassified | payment | complaint | other
    extracted_amount = Column(Float, nullable=True)
    reference_no     = Column(String, nullable=True)
    status           = Column(String, default="pending_review") # pending_review | matched | resolved
    notes            = Column(String, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)

    order = relationship("Order")


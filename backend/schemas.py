from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


# ─── Auth ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


# ─── User ─────────────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    id: int
    name: str
    username: str
    email: Optional[str]
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    name: str
    username: str
    email: Optional[str] = None
    password: str
    role: str = "warehouse"


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


# ─── Order Item ───────────────────────────────────────────────────────────────

class OrderItemIn(BaseModel):
    product_name: str
    product_id: Optional[int] = None
    quantity: int = 1
    unit_price: float = 0.0


class OrderItemOut(BaseModel):
    id: int
    product_id: Optional[int] = None
    product_name: str
    quantity: int
    unit_price: float
    total_price: float

    class Config:
        from_attributes = True



# ─── Order ────────────────────────────────────────────────────────────────────

class OrderCreate(BaseModel):
    customer_name: str
    customer_phone: Optional[str] = None
    delivery_address: Optional[str] = None
    city: Optional[str] = None
    location_url: Optional[str] = None
    source: str = "website"
    priority: str = "normal"
    payment_status: str = "cod"
    notes: Optional[str] = None
    assigned_rider_name: Optional[str] = None
    items: List[OrderItemIn] = []


class OrderUpdate(BaseModel):
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    delivery_address: Optional[str] = None
    city: Optional[str] = None
    location_url: Optional[str] = None
    source: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    payment_status: Optional[str] = None
    payment_method: Optional[str] = None
    total_amount: Optional[float] = None
    amount_received: Optional[float] = None
    notes: Optional[str] = None
    assigned_rider_name: Optional[str] = None
    assigned_staff_id: Optional[int] = None


class StatusUpdate(BaseModel):
    new_status: str
    note: Optional[str] = None


class DeliveryCompletion(BaseModel):
    outcome: str  # delivered | returned
    payment_method: Optional[str] = None  # cod | online | credit
    amount_received: float = 0.0
    note: Optional[str] = None


class StatusHistoryOut(BaseModel):
    id: int
    old_status: Optional[str]
    new_status: str
    changed_by: Optional[str]
    changed_at: datetime
    note: Optional[str]

    class Config:
        from_attributes = True


class OrderOut(BaseModel):
    id: int
    order_number: str
    customer_name: str
    customer_phone: Optional[str]
    delivery_address: Optional[str]
    city: Optional[str]
    location_url: Optional[str] = None
    source: str
    status: str
    priority: str
    payment_status: str
    payment_method: Optional[str] = None
    amount_received: float = 0.0
    payment_received_at: Optional[datetime] = None
    notes: Optional[str]
    total_amount: float
    assigned_rider_name: Optional[str]
    assigned_staff_id: Optional[int]

    created_at: datetime
    rts_at: Optional[datetime]
    pickup_at: Optional[datetime]
    delivered_at: Optional[datetime]
    pickup_deadline: Optional[datetime]

    items: List[OrderItemOut] = []
    status_history: List[StatusHistoryOut] = []

    class Config:
        from_attributes = True


# ─── Notification ─────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: int
    order_id: Optional[int]
    notification_type: str
    recipient: Optional[str]
    subject: Optional[str]
    message: str
    sent_at: datetime
    delivery_status: str

    class Config:
        from_attributes = True


# ─── Dashboard ────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_today: int
    pending: int
    ready_to_ship: int
    out_for_delivery: int
    delivered_today: int
    cancelled_today: int
    late_orders: int
    revenue_today: float
    avg_packing_time_min: Optional[float]
    avg_pickup_time_min: Optional[float]
    avg_delivery_time_min: Optional[float]


# ─── Inventory / Products ─────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    name: str
    sku: str
    category: Optional[str] = "General"
    unit: Optional[str] = "unit"
    unit_price: float = 0.0
    stock_qty: float = 0.0
    low_stock_threshold: float = 10.0
    base_product_id: Optional[int] = None
    unit_multiplier: Optional[float] = 1.0


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None
    unit_price: Optional[float] = None
    low_stock_threshold: Optional[float] = None
    is_active: Optional[bool] = None
    base_product_id: Optional[int] = None
    unit_multiplier: Optional[float] = None


class RestockRequest(BaseModel):
    quantity: float
    note: Optional[str] = None


class SpoilageRequest(BaseModel):
    quantity: float
    note: Optional[str] = None


class ProductOut(BaseModel):
    id: int
    name: str
    sku: str
    category: Optional[str]
    unit: str
    unit_price: float
    stock_qty: float
    low_stock_threshold: float
    reorder_point: Optional[int]
    is_active: bool
    created_at: datetime
    base_product_id: Optional[int] = None
    unit_multiplier: Optional[float] = 1.0

    class Config:
        from_attributes = True


class StockMovementOut(BaseModel):
    id: int
    product_id: int
    order_id: Optional[int]
    movement_type: str
    quantity_change: float
    quantity_after: float
    note: Optional[str]
    created_by: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Customer Address Book ────────────────────────────────────────────────────

class CustomerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    delivery_address: Optional[str] = None
    city: Optional[str] = None
    notes: Optional[str] = None
    preferred_rider: Optional[str] = None


class CustomerOut(BaseModel):
    id: int
    name: str
    phone: Optional[str]
    delivery_address: Optional[str]
    city: Optional[str]
    notes: Optional[str]
    preferred_rider: Optional[str]
    last_items_json: Optional[str]
    last_order_total: Optional[float]
    order_count: int
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Subscriptions ────────────────────────────────────────────────────────────

class SubscriptionItemIn(BaseModel):
    product_name: str
    quantity: int = 1
    unit_price: float = 0.0


class SubscriptionCreate(BaseModel):
    customer_name: str
    customer_phone: Optional[str] = None
    delivery_address: Optional[str] = None
    city: Optional[str] = None
    frequency: str = "daily"          # daily | every_other_day | weekly
    items: List[SubscriptionItemIn]
    payment_method: str = "cod"
    assigned_rider_name: Optional[str] = None
    notes: Optional[str] = None
    next_delivery_date: Optional[datetime] = None


class SubscriptionUpdate(BaseModel):
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    delivery_address: Optional[str] = None
    city: Optional[str] = None
    frequency: Optional[str] = None
    items: Optional[List[SubscriptionItemIn]] = None
    payment_method: Optional[str] = None
    assigned_rider_name: Optional[str] = None
    notes: Optional[str] = None
    next_delivery_date: Optional[datetime] = None
    is_active: Optional[bool] = None


class SubscriptionOut(BaseModel):
    id: int
    customer_name: str
    customer_phone: Optional[str]
    delivery_address: Optional[str]
    city: Optional[str]
    frequency: str
    items_json: str
    total_amount: float
    payment_method: str
    assigned_rider_name: Optional[str]
    notes: Optional[str]
    is_active: bool
    next_delivery_date: Optional[datetime]
    last_generated_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Tasks & Reports ──────────────────────────────────────────────────────────

class TaskReportSubmit(BaseModel):
    """For inventory-style reports (spoilage/breakage)."""
    product_id: int
    spoiled_qty: int = 0
    broken_qty: int = 0
    actual_qty: Optional[int] = None
    notes: Optional[str] = None


class TaskFormResponse(BaseModel):
    """For custom-form submissions — key/value pairs matching form_schema fields."""
    responses: dict  # {field_label: value}
    notes: Optional[str] = None


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    assigned_to_id: Optional[int] = None
    assigned_to_name: Optional[str] = None
    due_date: Optional[datetime] = None
    requires_report: bool = False
    # JSON array of field definitions, e.g.:
    # [{"label": "Opening Eggs", "type": "number"}, {"label": "Spoiled", "type": "number"}, ...]
    form_schema: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    assigned_to_id: Optional[int] = None
    assigned_to_name: Optional[str] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = None


class TaskOut(BaseModel):
    id: int
    title: str
    description: Optional[str]
    assigned_to_id: Optional[int]
    assigned_to_name: Optional[str]
    assigned_by: Optional[str]
    status: str
    due_date: Optional[datetime]
    created_at: datetime
    completed_at: Optional[datetime]
    report_json: Optional[str]
    form_schema: Optional[str] = None
    requires_report: bool = False

    class Config:
        from_attributes = True


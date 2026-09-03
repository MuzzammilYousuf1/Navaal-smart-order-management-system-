"""
Seed script — populates the database with demo data.
Run: python seed.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timedelta
import random

from database import SessionLocal, engine
import models
from auth import hash_password

models.Base.metadata.drop_all(bind=engine)
models.Base.metadata.create_all(bind=engine)
db = SessionLocal()

# ─── Clear existing data ───────────────────────────────────────────────────────
print("Clearing existing data...")
db.query(models.NotificationLog).delete()
db.query(models.StatusHistory).delete()
db.query(models.OrderItem).delete()
db.query(models.Order).delete()
db.query(models.User).delete()
db.commit()

# ─── Users ─────────────────────────────────────────────────────────────────────
print("Creating users...")
users_data = [
    {"name": "Ahmad Raza (Admin)",     "username": "admin",   "password": "Navaal@Admin2026",   "role": "admin",      "email": "admin@navaalorganic.pk"},
    {"name": "Sara Khan (Manager)",    "username": "manager", "password": "Navaal@Mgr2026",     "role": "manager",    "email": "manager@navaalorganic.pk"},
    {"name": "Ali Hassan (Warehouse)", "username": "staff1",  "password": "Navaal@Staff2026",   "role": "warehouse",  "email": "staff1@navaalorganic.pk"},
    {"name": "Usman Tariq (Warehouse)","username": "staff2",  "password": "Navaal@Staff2026",   "role": "warehouse",  "email": "staff2@navaalorganic.pk"},
    {"name": "Bilal Ahmed (Rider)",    "username": "rider1",  "password": "Navaal@Rider2026",   "role": "rider",      "email": "rider1@navaalorganic.pk"},
    {"name": "Kamran Shah (Rider)",    "username": "rider2",  "password": "Navaal@Rider2026",   "role": "rider",      "email": "rider2@navaalorganic.pk"},
    {"name": "Nadia Ops (Operations)", "username": "ops",     "password": "Navaal@Ops2026",     "role": "operations", "email": "ops@navaalorganic.pk"},
]

created_users = []
for ud in users_data:
    u = models.User(
        name=ud["name"],
        username=ud["username"],
        email=ud["email"],
        password_hash=hash_password(ud["password"]),
        role=ud["role"],
        is_active=True,
    )
    db.add(u)
    created_users.append(u)

db.commit()
for u in created_users:
    db.refresh(u)

admin_user = created_users[0]
staff1 = created_users[2]
staff2 = created_users[3]

# ─── Products & Stock Catalog ──────────────────────────────────────────────────
print("Creating product catalog & stock...")
db.query(models.StockMovement).delete()
db.query(models.Product).delete()
db.commit()

products_catalog = [
    {"name": "Organic Basmati Rice 5kg",      "sku": "NOF-RICE-5K", "cat": "Grains",  "unit": "kg",    "price": 1200, "stock": 45,  "threshold": 10},
    {"name": "Wild Flower Honey 500g",         "sku": "NOF-HNY-500", "cat": "Honey",   "unit": "unit",  "price": 850,  "stock": 8,   "threshold": 10}, # Low stock demo!
    {"name": "Cold-Pressed Mustard Oil 1L",    "sku": "NOF-OIL-1L",  "cat": "Oils",    "unit": "litre", "price": 650,  "stock": 30,  "threshold": 5},
    {"name": "Organic Desi Ghee 500g",         "sku": "NOF-GHEE-500","cat": "Dairy",   "unit": "unit",  "price": 1800, "stock": 5,   "threshold": 10}, # Low stock demo!
    {"name": "Black Seed Oil 250ml",           "sku": "NOF-BSO-250", "cat": "Oils",    "unit": "ml",    "price": 950,  "stock": 25,  "threshold": 5},
    {"name": "Organic Turmeric Powder 200g",   "sku": "NOF-TUR-200", "cat": "Spices",  "unit": "g",     "price": 350,  "stock": 60,  "threshold": 15},
    {"name": "Moringa Leaf Powder 100g",       "sku": "NOF-MOR-100", "cat": "Herbal",  "unit": "g",     "price": 450,  "stock": 3,   "threshold": 10}, # Low stock demo!
    {"name": "Organic Chia Seeds 300g",        "sku": "NOF-CHIA-300","cat": "Seeds",   "unit": "g",     "price": 600,  "stock": 40,  "threshold": 10},
    {"name": "Ajwain (Carom Seeds) 200g",      "sku": "NOF-AJW-200", "cat": "Spices",  "unit": "g",     "price": 200,  "stock": 50,  "threshold": 10},
    {"name": "Organic Cinnamon Sticks 100g",   "sku": "NOF-CIN-100", "cat": "Spices",  "unit": "g",     "price": 320,  "stock": 35,  "threshold": 10},
    {"name": "Pink Himalayan Salt 500g",       "sku": "NOF-SALT-500","cat": "Spices",  "unit": "g",     "price": 280,  "stock": 100, "threshold": 20},
    {"name": "Organic Green Tea 100g",         "sku": "NOF-TEA-100", "cat": "Herbal",  "unit": "g",     "price": 420,  "stock": 18,  "threshold": 5},
    # Bulk Eggs & Pack Variants (Demonstrating Bulk-to-Pack unit conversion)
    {"name": "Fresh Organic Eggs (Bulk Raw Stock)", "sku": "NOF-EGG-BULK", "cat": "Poultry", "unit": "egg", "price": 25, "stock": 1000, "threshold": 100},
    {"name": "Organic Eggs (Pack of 6)",            "sku": "NOF-EGG-P6",   "cat": "Poultry", "unit": "pack","price": 180,"stock": 0,    "threshold": 5, "mult": 6, "base_sku": "NOF-EGG-BULK"},
    {"name": "Organic Eggs (Pack of 15)",           "sku": "NOF-EGG-P15",  "cat": "Poultry", "unit": "pack","price": 430,"stock": 0,    "threshold": 5, "mult": 15, "base_sku": "NOF-EGG-BULK"},
    {"name": "Organic Eggs (Pack of 30 Tray)",      "sku": "NOF-EGG-P30",  "cat": "Poultry", "unit": "tray","price": 820,"stock": 0,    "threshold": 5, "mult": 30, "base_sku": "NOF-EGG-BULK"},
]

sku_to_id = {}
for p in products_catalog:
    base_id = sku_to_id.get(p.get("base_sku")) if p.get("base_sku") else None
    prod = models.Product(
        name=p["name"],
        sku=p["sku"],
        category=p["cat"],
        unit=p["unit"],
        unit_price=float(p["price"]),
        stock_qty=p["stock"],
        low_stock_threshold=p["threshold"],
        unit_multiplier=p.get("mult", 1),
        base_product_id=base_id,
        is_active=True,
        is_customer_facing=p.get("is_facing", True if p.get("base_sku") else False),
    )
    db.add(prod)
    db.flush()
    sku_to_id[prod.sku] = prod.id
    if p["stock"] > 0:
        db.add(models.StockMovement(
            product_id=prod.id,
            movement_type="restock",
            quantity_change=p["stock"],
            quantity_after=p["stock"],
            note="Initial catalog seed",
            created_by="System",
        ))
db.commit()

products = [(p["name"], p["price"]) for p in products_catalog]

customers = [
    ("Fatima Malik",    "0300-1234567", "House 12, Block B, DHA Lahore",         "Lahore"),
    ("Imran Hussain",   "0321-9876543", "Flat 5, Gulshan-e-Iqbal, Karachi",      "Karachi"),
    ("Zainab Sheikh",   "0333-5551234", "Street 4, F-7/2, Islamabad",            "Islamabad"),
    ("Muhammad Asif",   "0345-7778889", "Mohalla Rehmat, Near Jamia Mosque, Multan","Multan"),
    ("Hina Baig",       "0312-3456789", "Plot 22, Bahria Town, Rawalpindi",       "Rawalpindi"),
    ("Tariq Mehmood",   "0301-1112222", "House 3, Model Town, Faisalabad",        "Faisalabad"),
    ("Amna Farooq",     "0331-9990001", "Bungalow 7, Clifton, Karachi",          "Karachi"),
    ("Waqas Ali",       "0322-6667778", "Street 10, Johar Town, Lahore",         "Lahore"),
    ("Saira Noor",      "0343-4445556", "House 88, G-9/1, Islamabad",            "Islamabad"),
    ("Danish Khan",     "0311-8889990", "Near City Hospital, Sialkot",           "Sialkot"),
    ("Rukhsar Begum",   "0302-3334445", "Gali No 5, Saddar, Peshawar",           "Peshawar"),
    ("Junaid Iqbal",    "0323-7776665", "Township Sector B2, Lahore",            "Lahore"),
]

sources = ["website", "whatsapp", "phone", "walk_in"]
priorities = ["normal", "normal", "normal", "high", "urgent"]
payment_statuses = ["cod", "cod", "paid", "unpaid"]

def make_order(idx, customer, status, created_offset_hours, rts_offset=None,
               pickup_offset=None, delivered_offset=None, is_late=False):
    name, phone, address, city = customer
    now = datetime.utcnow()
    created_at = now - timedelta(hours=created_offset_hours)

    rts_at = None
    pickup_at = None
    delivered_at = None
    pickup_deadline = None
    sla_1 = False

    if rts_offset is not None:
        rts_at = created_at + timedelta(minutes=rts_offset)
        pickup_deadline = rts_at + timedelta(minutes=45)
        if is_late:
            sla_1 = True

    if pickup_offset is not None and rts_at:
        pickup_at = rts_at + timedelta(minutes=pickup_offset)

    if delivered_offset is not None and pickup_at:
        delivered_at = pickup_at + timedelta(minutes=delivered_offset)

    chosen_products = random.sample(products, random.randint(1, 3))
    total = 0
    items_data = []
    for pname, pprice in chosen_products:
        qty = random.randint(1, 3)
        items_data.append((pname, qty, pprice))
        total += qty * pprice

    order = models.Order(
        order_number=f"NOF-2026-{idx:04d}",
        customer_name=name,
        customer_phone=phone,
        delivery_address=address,
        city=city,
        source=random.choice(sources),
        status=status,
        priority=random.choice(priorities),
        payment_status=random.choice(payment_statuses),
        total_amount=float(total),
        assigned_staff_id=random.choice([staff1.id, staff2.id]),
        assigned_rider_name=random.choice(["Bilal Ahmed", "Kamran Shah", None]),
        notes=random.choice([None, None, "Handle with care", "Call before delivery", "Fragile items"]),
        created_at=created_at,
        rts_at=rts_at,
        pickup_at=pickup_at,
        delivered_at=delivered_at,
        pickup_deadline=pickup_deadline,
        sla_alert_1_sent=sla_1,
        sla_alert_2_sent=is_late and created_offset_hours > 2,
        sla_manager_sent=False,
        sla_owner_sent=False,
    )
    return order, items_data


print("Creating orders...")
now = datetime.utcnow()
order_configs = [
    # (customer_idx, status, created_offset_hrs, rts_offset_min, pickup_offset_min, delivered_offset_min, is_late)
    # Pending orders (fresh)
    (0,  "pending",          0.3,  None, None, None, False),
    (1,  "pending",          0.5,  None, None, None, False),
    (2,  "pending",          1.0,  None, None, None, False),
    (3,  "pending",          1.5,  None, None, None, False),
    (4,  "pending",          2.0,  None, None, None, False),
    # Ready to ship (on time — within 45 min)
    (5,  "ready_to_ship",    1.0,  25,   None, None, False),
    (6,  "ready_to_ship",    1.5,  30,   None, None, False),
    (7,  "ready_to_ship",    2.0,  20,   None, None, False),
    # Ready to ship (LATE — past 45 min)
    (8,  "ready_to_ship",    3.0,  15,   None, None, True),
    (9,  "ready_to_ship",    4.0,  20,   None, None, True),
    (10, "ready_to_ship",    5.0,  10,   None, None, True),
    # Out for delivery
    (11, "out_for_delivery", 3.0,  20,   35,   None, False),
    (0,  "out_for_delivery", 4.0,  25,   40,   None, False),
    (1,  "out_for_delivery", 5.0,  30,   42,   None, False),
    (2,  "out_for_delivery", 6.0,  18,   30,   None, False),
    # Delivered (today)
    (3,  "delivered",        5.0,  22,   38,   55,  False),
    (4,  "delivered",        6.0,  18,   35,   60,  False),
    (5,  "delivered",        7.0,  25,   40,   70,  False),
    (6,  "delivered",        8.0,  20,   30,   50,  False),
    (7,  "delivered",        9.0,  15,   45,   65,  False),
    # Delivered (yesterday)
    (8,  "delivered",        28.0, 20,   38,   55,  False),
    (9,  "delivered",        29.0, 18,   30,   60,  False),
    (10, "delivered",        30.0, 22,   42,   70,  False),
    (11, "delivered",        31.0, 25,   35,   50,  False),
    (0,  "delivered",        32.0, 19,   40,   65,  False),
    # Cancelled
    (1,  "cancelled",        10.0, None, None, None, False),
    (2,  "cancelled",        20.0, None, None, None, False),
    # Older delivered (this week)
    (3,  "delivered",        48.0, 20,   38,   55,  False),
    (4,  "delivered",        72.0, 18,   30,   60,  False),
    (5,  "delivered",        96.0, 22,   42,   70,  False),
    (6,  "delivered",       120.0, 25,   35,   50,  False),
    (7,  "delivered",       144.0, 19,   40,   65,  False),
    (8,  "delivered",       168.0, 20,   38,   55,  False),
]

order_idx = 1
all_orders = []
for cfg in order_configs:
    cust_idx, status, offset_hrs, rts_off, pickup_off, del_off, is_late = cfg
    customer = customers[cust_idx % len(customers)]
    order, items_data = make_order(
        order_idx, customer, status,
        created_offset_hours=offset_hrs,
        rts_offset=rts_off,
        pickup_offset=pickup_off,
        delivered_offset=del_off,
        is_late=is_late,
    )
    db.add(order)
    db.flush()
    for pname, qty, pprice in items_data:
        db.add(models.OrderItem(
            order_id=order.id,
            product_name=pname,
            quantity=qty,
            unit_price=float(pprice),
            total_price=float(qty * pprice),
        ))
    # Status history
    db.add(models.StatusHistory(
        order_id=order.id,
        old_status=None,
        new_status="pending",
        changed_by="System",
        changed_at=order.created_at,
        note="Order created",
    ))
    if order.rts_at:
        db.add(models.StatusHistory(
            order_id=order.id,
            old_status="pending",
            new_status="ready_to_ship",
            changed_by=random.choice(["Ali Hassan", "Usman Tariq"]),
            changed_at=order.rts_at,
            note="Order packed and ready",
        ))
    if order.pickup_at:
        db.add(models.StatusHistory(
            order_id=order.id,
            old_status="ready_to_ship",
            new_status="out_for_delivery",
            changed_by=order.assigned_rider_name or "Rider",
            changed_at=order.pickup_at,
            note="Picked up by rider",
        ))
    if order.delivered_at:
        db.add(models.StatusHistory(
            order_id=order.id,
            old_status="out_for_delivery",
            new_status="delivered",
            changed_by=order.assigned_rider_name or "Rider",
            changed_at=order.delivered_at,
            note="Delivered successfully",
        ))

    # SLA notification logs for late orders
    if is_late:
        db.add(models.NotificationLog(
            order_id=order.id,
            notification_type="sla_alert_1",
            recipient="Operations Team",
            subject=f"⚠️ Order {order.order_number} — Rider Pickup Overdue (45 min)",
            message=f"Order {order.order_number} for {order.customer_name} has been Ready to Ship for 45 minutes with no rider pickup.",
            sent_at=order.rts_at + timedelta(minutes=45),
            delivery_status="logged",
        ))

    order_idx += 1
    all_orders.append(order)

db.commit()

print("\n" + "=" * 60)
print("SUCCESS: Database seeded successfully!")
print("=" * 60)
print("\nLOGIN CREDENTIALS:")
print("-" * 40)
for ud in users_data:
    print(f"  {ud['role'].upper():12s} -> {ud['username']} / {ud['password']}")
print("-" * 40)
print(f"\nCreated {len(all_orders)} orders across all statuses")
print(f"   Pending:          5")
print(f"   Ready to Ship:    6 (3 late, 3 on time)")
print(f"   Out for Delivery: 4")
print(f"   Delivered:       18")
print(f"   Cancelled:        2")
print("\nRun backend with: uvicorn main:app --reload --port 8000")
db.close()


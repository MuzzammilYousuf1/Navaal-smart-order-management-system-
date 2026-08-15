"""
SLA Engine — runs every 60 seconds via APScheduler.

Timeline after RTS (Ready to Ship):
  - 45 min → Alert 1  (order is overdue, rider not picked up)
  - 60 min → Alert 2  (urgent follow-up)
  - 75 min → Manager Escalation
  - 90 min → Owner Escalation
"""
import logging
from datetime import datetime, timedelta
from typing import List

from sqlalchemy.orm import Session
from database import SessionLocal
import models

logger = logging.getLogger("sla_engine")

# Import the WebSocket manager lazily to avoid circular imports
_ws_manager = None


def set_ws_manager(manager):
    global _ws_manager
    _ws_manager = manager


def _log_notification(
    db: Session,
    order: models.Order,
    notification_type: str,
    subject: str,
    message: str,
    recipient: str = "Operations Team",
):
    log = models.NotificationLog(
        order_id=order.id,
        notification_type=notification_type,
        recipient=recipient,
        subject=subject,
        message=message,
        sent_at=datetime.utcnow(),
        delivery_status="logged",
    )
    db.add(log)
    db.commit()

    # Push real-time alert to connected dashboard clients
    if _ws_manager:
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(
                    _ws_manager.broadcast({
                        "type": "sla_alert",
                        "order_number": order.order_number,
                        "customer_name": order.customer_name,
                        "notification_type": notification_type,
                        "message": message,
                        "timestamp": datetime.utcnow().isoformat(),
                    })
                )
        except Exception as e:
            logger.warning(f"WS broadcast failed: {e}")

    logger.info(f"[SLA] {notification_type} | Order {order.order_number} | {message}")


def run_sla_check():
    """Called every 60 seconds. Checks all RTS orders for SLA breaches."""
    db: Session = SessionLocal()
    try:
        now = datetime.utcnow()

        # Only check orders still waiting for rider pickup
        rts_orders: List[models.Order] = (
            db.query(models.Order)
            .filter(models.Order.status == "ready_to_ship")
            .filter(models.Order.rts_at.isnot(None))
            .all()
        )

        for order in rts_orders:
            elapsed_min = (now - order.rts_at).total_seconds() / 60

            # ── Alert 1: 45 min (overdue pickup) ──────────────────────────────
            if elapsed_min >= 45 and not order.sla_alert_1_sent:
                order.sla_alert_1_sent = True
                _log_notification(
                    db, order,
                    notification_type="sla_alert_1",
                    subject=f"⚠️ Order {order.order_number} — Rider Pickup Overdue (45 min)",
                    message=(
                        f"Order {order.order_number} for {order.customer_name} "
                        f"has been Ready to Ship for 45 minutes with no rider pickup. "
                        f"Marked RTS at: {order.rts_at.strftime('%H:%M')}. "
                        f"Please assign/follow up with the rider immediately."
                    ),
                    recipient="Operations Team",
                )
                db.add(order)
                db.commit()

            # ── Alert 2: 60 min ───────────────────────────────────────────────
            if elapsed_min >= 60 and not order.sla_alert_2_sent:
                order.sla_alert_2_sent = True
                _log_notification(
                    db, order,
                    notification_type="sla_alert_2",
                    subject=f"🚨 URGENT — Order {order.order_number} Waiting 60 Minutes!",
                    message=(
                        f"URGENT: Order {order.order_number} for {order.customer_name} "
                        f"({order.city}) has been waiting for rider pickup for 60 minutes. "
                        f"Rider assigned: {order.assigned_rider_name or 'Not assigned'}. "
                        f"Immediate action required."
                    ),
                    recipient="Operations Team",
                )
                db.add(order)
                db.commit()

            # ── Manager Escalation: 75 min ────────────────────────────────────
            if elapsed_min >= 75 and not order.sla_manager_sent:
                order.sla_manager_sent = True
                _log_notification(
                    db, order,
                    notification_type="sla_manager",
                    subject=f"🔴 MANAGER ALERT — Order {order.order_number} (75 min overdue)",
                    message=(
                        f"Manager Escalation: Order {order.order_number} for "
                        f"{order.customer_name} has been sitting Ready to Ship for 75 minutes. "
                        f"Amount: PKR {order.total_amount:,.0f}. "
                        f"This is a serious delay. Please intervene."
                    ),
                    recipient="Manager",
                )
                db.add(order)
                db.commit()

            # ── Owner Escalation: 90 min ──────────────────────────────────────
            if elapsed_min >= 90 and not order.sla_owner_sent:
                order.sla_owner_sent = True
                _log_notification(
                    db, order,
                    notification_type="sla_owner",
                    subject=f"🔴🔴 OWNER ALERT — Order {order.order_number} (90 min!)",
                    message=(
                        f"Owner Escalation: Order {order.order_number} for "
                        f"{order.customer_name} has been at Ready to Ship for 90 MINUTES. "
                        f"Customer at risk. Rider: {order.assigned_rider_name or 'Not assigned'}. "
                        f"Immediate owner action required."
                    ),
                    recipient="Owner",
                )
                db.add(order)
                db.commit()

    except Exception as e:
        logger.error(f"SLA check error: {e}")
    finally:
        db.close()


def broadcast_ws_message(message: dict):
    if _ws_manager:
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(_ws_manager.broadcast(message))
        except Exception:
            pass


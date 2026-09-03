import os
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import models
from database import SessionLocal

logger = logging.getLogger("email_reports")

# --- SMTP Configuration ---
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "")
REPORT_RECIPIENT_EMAIL = os.getenv("REPORT_RECIPIENT_EMAIL", "")
REPORT_SEND_TIME = os.getenv("REPORT_SEND_TIME", "23:50")  # Default to 11:50 PM daily


def generate_daily_report_html(db: Session, target_date: datetime) -> str:
    """
    Generates a beautifully styled, high-impact HTML report containing
    operational, SLA, inventory, rider, and sales metrics.
    """
    day_start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = target_date.replace(hour=23, minute=59, second=59, microsecond=999999)
    date_str = day_start.strftime("%A, %B %d, %Y")

    # 1. KPI Queries
    total_orders = db.query(func.count(models.Order.id)).filter(
        models.Order.created_at >= day_start,
        models.Order.created_at <= day_end
    ).scalar() or 0

    delivered_orders = db.query(func.count(models.Order.id)).filter(
        models.Order.status == "delivered",
        models.Order.delivered_at >= day_start,
        models.Order.delivered_at <= day_end
    ).scalar() or 0

    revenue_today = db.query(func.sum(models.Order.total_amount)).filter(
        models.Order.status == "delivered",
        models.Order.delivered_at >= day_start,
        models.Order.delivered_at <= day_end
    ).scalar() or 0.0

    # SLA metrics for orders created today
    total_rts = db.query(func.count(models.Order.id)).filter(
        models.Order.created_at >= day_start,
        models.Order.created_at <= day_end,
        models.Order.rts_at.isnot(None)
    ).scalar() or 0

    sla_breaches = db.query(func.count(models.Order.id)).filter(
        models.Order.created_at >= day_start,
        models.Order.created_at <= day_end,
        models.Order.sla_alert_1_sent == True
    ).scalar() or 0

    sla_breach_rate = round((sla_breaches / total_rts * 100), 1) if total_rts > 0 else 0.0

    # 2. Orders List
    orders = db.query(models.Order).filter(
        models.Order.created_at >= day_start,
        models.Order.created_at <= day_end
    ).order_by(models.Order.created_at.desc()).all()

    # 3. Status Breakdown
    statuses = ["pending", "ready_to_ship", "out_for_delivery", "delivered", "cancelled"]
    status_counts = []
    for s in statuses:
        cnt = db.query(func.count(models.Order.id)).filter(
            models.Order.status == s,
            models.Order.created_at >= day_start,
            models.Order.created_at <= day_end
        ).scalar() or 0
        status_counts.append((s, cnt))

    # 4. Source Breakdown
    sources = db.query(
        models.Order.source,
        func.count(models.Order.id).label("count"),
        func.sum(models.Order.total_amount).label("revenue")
    ).filter(
        models.Order.created_at >= day_start,
        models.Order.created_at <= day_end
    ).group_by(models.Order.source).all()

    # 5. Active Rider Performance Today
    rider_stats = db.query(
        models.Order.assigned_rider_name,
        func.count(models.Order.id).label("total"),
        func.sum(func.case((models.Order.status == "delivered", 1), else_=0)).label("delivered"),
        func.sum(func.case((models.Order.status == "out_for_delivery", 1), else_=0)).label("out_for_delivery"),
        func.sum(func.case((models.Order.status == "delivered", models.Order.total_amount), else_=0.0)).label("cash_collected")
    ).filter(
        models.Order.assigned_rider_name.isnot(None),
        models.Order.assigned_rider_name != "",
        (models.Order.created_at >= day_start) | (models.Order.delivered_at >= day_start)
    ).group_by(models.Order.assigned_rider_name).all()

    # 6. Spoilage Logs Today
    spoilages = db.query(models.StockMovement).filter(
        models.StockMovement.created_at >= day_start,
        models.StockMovement.created_at <= day_end,
        models.StockMovement.movement_type.in_(["spoilage", "adjustment"]),
        models.StockMovement.quantity_change < 0
    ).all()

    # 7. Restock Logs Today
    restocks = db.query(models.StockMovement).filter(
        models.StockMovement.created_at >= day_start,
        models.StockMovement.created_at <= day_end,
        models.StockMovement.movement_type == "restock"
    ).all()

    # --- HTML Building ---
    # Colors: Emerald Brand Theme (#1b4332, #2d6a4f, #52b788)
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Daily Business Report - {date_str}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 800px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03); border: 1px solid #e2e8f0;">
        <!-- Header -->
        <tr>
            <td style="background: linear-gradient(135deg, #1b4332 0%, #2d6a4f 100%); padding: 30px 40px; text-align: left; border-bottom: 4px solid #52b788;">
                <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">Navaal Organic Foods</h1>
                <p style="margin: 5px 0 0 0; color: #a3e635; font-size: 14px; font-weight: 600; letter-spacing: 0.5px;">SMART ORDERFLOW • DAILY REPORT</p>
                <p style="margin: 15px 0 0 0; color: #ffffff; opacity: 0.85; font-size: 13px;">Date: {date_str} (UTC)</p>
            </td>
        </tr>

        <!-- Main Content -->
        <tr>
            <td style="padding: 30px 40px;">
                <!-- Key Metrics Grid -->
                <h3 style="margin-top: 0; margin-bottom: 15px; color: #1b4332; font-size: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Key Performance Indicators</h3>
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 25px;">
                    <tr>
                        <td width="24%" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 15px; text-align: center;">
                            <div style="font-size: 12px; color: #166534; text-transform: uppercase; font-weight: bold; margin-bottom: 5px;">Orders Today</div>
                            <div style="font-size: 22px; font-weight: 800; color: #14532d;">{total_orders}</div>
                        </td>
                        <td width="1%"></td>
                        <td width="24%" style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 15px; text-align: center;">
                            <div style="font-size: 12px; color: #065f46; text-transform: uppercase; font-weight: bold; margin-bottom: 5px;">Revenue (Deliv)</div>
                            <div style="font-size: 22px; font-weight: 800; color: #064e3b;">PKR {revenue_today:,.0f}</div>
                        </td>
                        <td width="1%"></td>
                        <td width="24%" style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 15px; text-align: center;">
                            <div style="font-size: 12px; color: #1e40af; text-transform: uppercase; font-weight: bold; margin-bottom: 5px;">Delivered</div>
                            <div style="font-size: 22px; font-weight: 800; color: #1e3a8a;">{delivered_orders}</div>
                        </td>
                        <td width="1%"></td>
                        <td width="24%" style="background-color: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 15px; text-align: center;">
                            <div style="font-size: 12px; color: #9f1239; text-transform: uppercase; font-weight: bold; margin-bottom: 5px;">SLA Breach Rate</div>
                            <div style="font-size: 22px; font-weight: 800; color: #881337;">{sla_breach_rate}%</div>
                        </td>
                    </tr>
                </table>

                <!-- Row: Breakdown by Status & Source -->
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 25px;">
                    <tr>
                        <td width="48%" valign="top">
                            <h3 style="margin-top: 0; margin-bottom: 12px; color: #1b4332; font-size: 14px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; text-transform: uppercase;">Orders by Status</h3>
                            <table width="100%" style="border-collapse: collapse; font-size: 13px;">
                                <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                    <th style="padding: 8px; text-align: left; color: #64748b;">Status</th>
                                    <th style="padding: 8px; text-align: right; color: #64748b;">Count</th>
                                </tr>
    """

    for s, cnt in status_counts:
        status_label = s.replace("_", " ").upper()
        # Set colors for status
        color_map = {
            "delivered": ("#065f46", "#d1fae5"),
            "out_for_delivery": ("#92400e", "#fef3c7"),
            "ready_to_ship": ("#1e40af", "#dbeafe"),
            "pending": ("#374151", "#f3f4f6"),
            "cancelled": ("#991b1b", "#fee2e2"),
        }
        text_col, bg_col = color_map.get(s, ("#374151", "#f3f4f6"))
        html += f"""
                                <tr style="border-bottom: 1px solid #f1f5f9;">
                                    <td style="padding: 8px; text-align: left;">
                                        <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; background-color: {bg_col}; color: {text_col};">{status_label}</span>
                                    </td>
                                    <td style="padding: 8px; text-align: right; font-weight: bold; color: #334155;">{cnt}</td>
                                </tr>
        """

    html += """
                            </table>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" valign="top">
                            <h3 style="margin-top: 0; margin-bottom: 12px; color: #1b4332; font-size: 14px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; text-transform: uppercase;">Orders by Source Channel</h3>
                            <table width="100%" style="border-collapse: collapse; font-size: 13px;">
                                <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                    <th style="padding: 8px; text-align: left; color: #64748b;">Channel</th>
                                    <th style="padding: 8px; text-align: center; color: #64748b;">Count</th>
                                    <th style="padding: 8px; text-align: right; color: #64748b;">Est. Rev</th>
                                </tr>
    """

    for sb in sources:
        channel_name = (sb.source or "unknown").upper()
        rev = sb.revenue or 0.0
        html += f"""
                                <tr style="border-bottom: 1px solid #f1f5f9;">
                                    <td style="padding: 8px; text-align: left; font-weight: 600; color: #475569;">{channel_name}</td>
                                    <td style="padding: 8px; text-align: center; color: #334155;">{sb.count}</td>
                                    <td style="padding: 8px; text-align: right; font-weight: bold; color: #1e293b;">PKR {rev:,.0f}</td>
                                </tr>
        """

    if not sources:
        html += """
                                <tr>
                                    <td colspan="3" style="padding: 15px; text-align: center; color: #94a3b8; font-style: italic;">No orders recorded today.</td>
                                </tr>
        """

    html += f"""
                            </table>
                        </td>
                    </tr>
                </table>

                <!-- Rider Dispatch & Cash Collection Today -->
                <h3 style="margin-top: 10px; margin-bottom: 15px; color: #1b4332; font-size: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Rider Collections & Dispatches Today</h3>
                <table width="100%" style="border-collapse: collapse; font-size: 13px; margin-bottom: 25px;">
                    <tr style="background-color: #2d6a4f; color: #ffffff; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">
                        <th style="padding: 10px; text-align: left;">Rider Name</th>
                        <th style="padding: 10px; text-align: center;">Assigned</th>
                        <th style="padding: 10px; text-align: center;">Out for Delivery</th>
                        <th style="padding: 10px; text-align: center;">Delivered</th>
                        <th style="padding: 10px; text-align: right;">COD Cash Collected</th>
                        <th style="padding: 10px; text-align: right;">Success %</th>
                    </tr>
    """

    for r in rider_stats:
        tot = r.total or 0
        deliv = r.delivered or 0
        success_pct = round((deliv / tot * 100), 1) if tot > 0 else 0.0
        success_color = "#16a34a" if success_pct >= 80 else "#d97706"
        html += f"""
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 10px; text-align: left; font-weight: bold; color: #1e293b;">{r.assigned_rider_name}</td>
                        <td style="padding: 10px; text-align: center; color: #475569;">{r.total}</td>
                        <td style="padding: 10px; text-align: center; color: #d97706; font-weight: 600;">{r.out_for_delivery}</td>
                        <td style="padding: 10px; text-align: center; color: #16a34a; font-weight: bold;">{r.delivered}</td>
                        <td style="padding: 10px; text-align: right; font-weight: 800; color: #15803d;">PKR {r.cash_collected:,.0f}</td>
                        <td style="padding: 10px; text-align: right; font-weight: bold; color: {success_color};">{success_pct}%</td>
                    </tr>
        """

    if not rider_stats:
        html += """
                    <tr>
                        <td colspan="6" style="padding: 20px; text-align: center; color: #94a3b8; font-style: italic;">No rider activities recorded for today.</td>
                    </tr>
        """

    html += f"""
                </table>

                <!-- Spoilage/Wastage Log Today -->
                <h3 style="margin-top: 10px; margin-bottom: 15px; color: #1b4332; font-size: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Wastage & Spoilage Recorded Today</h3>
                <table width="100%" style="border-collapse: collapse; font-size: 13px; margin-bottom: 25px;">
                    <tr style="background-color: #7f1d1d; color: #ffffff; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">
                        <th style="padding: 10px; text-align: left;">Product</th>
                        <th style="padding: 10px; text-align: center;">Qty Lost</th>
                        <th style="padding: 10px; text-align: right;">Est. Value Loss</th>
                        <th style="padding: 10px; text-align: left; padding-left: 20px;">Reason/Note</th>
                    </tr>
    """

    total_spoil_val = 0.0
    for s_mov in spoilages:
        product = db.query(models.Product).filter(models.Product.id == s_mov.product_id).first()
        p_name = product.name if product else f"Product ID: {s_mov.product_id}"
        p_price = product.unit_price if product else 0.0
        val_lost = abs(s_mov.quantity_change) * p_price
        total_spoil_val += val_lost
        html += f"""
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 10px; text-align: left; font-weight: 600; color: #1e293b;">{p_name}</td>
                        <td style="padding: 10px; text-align: center; color: #dc2626; font-weight: bold;">-{abs(s_mov.quantity_change)} {product.unit if product else "units"}</td>
                        <td style="padding: 10px; text-align: right; color: #b91c1c; font-weight: bold;">PKR {val_lost:,.0f}</td>
                        <td style="padding: 10px; text-align: left; padding-left: 20px; color: #64748b; font-style: italic;">{s_mov.note or '—'}</td>
                    </tr>
        """

    if not spoilages:
        html += """
                    <tr>
                        <td colspan="4" style="padding: 20px; text-align: center; color: #94a3b8; font-style: italic;">No stock wastage or spoilages logged today. ✓</td>
                    </tr>
        """
    else:
        html += f"""
                    <tr style="background-color: #fef2f2; font-weight: bold;">
                        <td colspan="2" style="padding: 10px; text-align: left; color: #991b1b;">Total Loss Valuation</td>
                        <td style="padding: 10px; text-align: right; color: #991b1b; font-size: 14px; font-weight: 800;">PKR {total_spoil_val:,.0f}</td>
                        <td style="padding: 10px;"></td>
                    </tr>
        """

    html += f"""
                </table>

                <!-- Restocks Log Today -->
                <h3 style="margin-top: 10px; margin-bottom: 15px; color: #1b4332; font-size: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Restocks & Receivings Today</h3>
                <table width="100%" style="border-collapse: collapse; font-size: 13px; margin-bottom: 25px;">
                    <tr style="background-color: #14532d; color: #ffffff; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">
                        <th style="padding: 10px; text-align: left;">Product</th>
                        <th style="padding: 10px; text-align: center;">Qty Added</th>
                        <th style="padding: 10px; text-align: left; padding-left: 20px;">Reference/Note</th>
                    </tr>
    """

    for r_mov in restocks:
        product = db.query(models.Product).filter(models.Product.id == r_mov.product_id).first()
        p_name = product.name if product else f"Product ID: {r_mov.product_id}"
        html += f"""
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 10px; text-align: left; font-weight: 600; color: #1e293b;">{p_name}</td>
                        <td style="padding: 10px; text-align: center; color: #16a34a; font-weight: bold;">+{r_mov.quantity_change} {product.unit if product else "units"}</td>
                        <td style="padding: 10px; text-align: left; padding-left: 20px; color: #64748b; font-style: italic;">{r_mov.note or '—'}</td>
                    </tr>
        """

    if not restocks:
        html += """
                    <tr>
                        <td colspan="3" style="padding: 20px; text-align: center; color: #94a3b8; font-style: italic;">No product restocks recorded today.</td>
                    </tr>
        """

    html += f"""
                </table>

                <!-- Daily Orders List -->
                <h3 style="margin-top: 10px; margin-bottom: 15px; color: #1b4332; font-size: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Daily Orders Log ({len(orders)})</h3>
                <table width="100%" style="border-collapse: collapse; font-size: 13px;">
                    <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569; text-transform: uppercase; font-size: 11px;">
                        <th style="padding: 8px 10px; text-align: left;">Order #</th>
                        <th style="padding: 8px 10px; text-align: left;">Customer</th>
                        <th style="padding: 8px 10px; text-align: center;">Status</th>
                        <th style="padding: 8px 10px; text-align: center;">Payment</th>
                        <th style="padding: 8px 10px; text-align: right;">Total Amount</th>
                        <th style="padding: 8px 10px; text-align: right;">Time</th>
                    </tr>
    """

    for o in orders:
        time_str = o.created_at.strftime("%H:%M")
        status_label = o.status.replace("_", " ").upper()
        # Small color mappings
        color_map = {
            "delivered": ("#065f46", "#d1fae5"),
            "out_for_delivery": ("#92400e", "#fef3c7"),
            "ready_to_ship": ("#1e40af", "#dbeafe"),
            "pending": ("#374151", "#f3f4f6"),
            "cancelled": ("#991b1b", "#fee2e2"),
        }
        text_col, bg_col = color_map.get(o.status, ("#374151", "#f3f4f6"))
        pay_color = "#16a34a" if o.payment_status == "paid" else "#dc2626"

        html += f"""
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 8px 10px; text-align: left; font-family: monospace; font-weight: bold; color: #1e293b;">{o.order_number}</td>
                        <td style="padding: 8px 10px; text-align: left; color: #334155;">
                            <div>{o.customer_name}</div>
                            <div style="font-size: 11px; color: #64748b;">{o.city or '—'} • {o.channel.upper()}</div>
                        </td>
                        <td style="padding: 8px 10px; text-align: center;">
                            <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; background-color: {bg_col}; color: {text_col};">{status_label}</span>
                        </td>
                        <td style="padding: 8px 10px; text-align: center; font-weight: 600; font-size: 11px; color: {pay_color}; text-transform: uppercase;">{o.payment_status}</td>
                        <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: #1e293b;">PKR {o.total_amount:,.0f}</td>
                        <td style="padding: 8px 10px; text-align: right; color: #64748b; font-size: 11px;">{time_str}</td>
                    </tr>
        """

    if not orders:
        html += """
                    <tr>
                        <td colspan="6" style="padding: 20px; text-align: center; color: #94a3b8; font-style: italic;">No orders placed today.</td>
                    </tr>
        """

    html += """
                </table>
            </td>
        </tr>

        <!-- Footer -->
        <tr>
            <td style="background-color: #1e293b; color: #94a3b8; font-size: 11px; padding: 25px 40px; text-align: center; border-top: 1px solid #334155;">
                <p style="margin: 0 0 5px 0; color: #cbd5e1; font-weight: bold; font-size: 12px;">SMART ORDERFLOW BUSINESS INTELLIGENCE SERVICE</p>
                <p style="margin: 0 0 15px 0;">This email is an automated nightly audit compiled directly from your secure cloud database.</p>
                <p style="margin: 0; color: #64748b;">&copy; 2026 Navaal Organic Foods. Operating 24/7 on Google Cloud & Render.</p>
            </td>
        </tr>
    </table>
</body>
</html>
"""
    return html


def send_daily_report_email(db: Session, date_str: Optional[str] = None) -> bool:
    """
    Builds and sends the daily report HTML email to the configured recipient.
    """
    if not SMTP_HOST or not SMTP_PORT or not SMTP_USERNAME or not SMTP_PASSWORD or not SMTP_FROM_EMAIL or not REPORT_RECIPIENT_EMAIL:
        logger.warning(
            "SMTP configuration is incomplete. Skip sending daily report email. "
            "Required vars: SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL, REPORT_RECIPIENT_EMAIL"
        )
        return False

    try:
        if date_str:
            target_date = datetime.strptime(date_str, "%Y-%m-%d")
        else:
            target_date = datetime.utcnow()
    except Exception as e:
        logger.error(f"Failed to parse report date '{date_str}': {e}. Defaulting to UTC now.")
        target_date = datetime.utcnow()

    date_label = target_date.strftime("%Y-%m-%d")
    logger.info(f"Generating daily report email for {date_label}...")

    try:
        html_content = generate_daily_report_html(db, target_date)
    except Exception as e:
        logger.exception(f"Failed to generate daily report HTML: {e}")
        return False

    # Setup MIME Message
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Navaal Organic Foods - Daily Working & Operations Report [{date_label}]"
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = REPORT_RECIPIENT_EMAIL

    part_html = MIMEText(html_content, "html")
    msg.attach(part_html)

    # Send via SMTP
    try:
        logger.info(f"Connecting to SMTP server {SMTP_HOST}:{SMTP_PORT}...")
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.ehlo()
        # If using standard STARTTLS port 587
        if SMTP_PORT == 587:
            server.starttls()
            server.ehlo()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM_EMAIL, [REPORT_RECIPIENT_EMAIL], msg.as_string())
        server.quit()
        logger.info(f"Daily report email successfully sent to {REPORT_RECIPIENT_EMAIL} for {date_label}!")
        return True
    except Exception as e:
        logger.exception(f"Failed to send email to {REPORT_RECIPIENT_EMAIL}: {e}")
        return False


def send_daily_report_email_job():
    """
    Scheduler job wrapper that handles Session creation.
    """
    logger.info("Nightly report email job triggered by scheduler...")
    db = SessionLocal()
    try:
        # Generate and send report for the current day (UTC)
        send_daily_report_email(db)
    finally:
        db.close()


def schedule_daily_report(scheduler: AsyncIOScheduler):
    """
    Parses configured send time and adds daily cron job to APScheduler.
    """
    time_str = os.getenv("REPORT_SEND_TIME", "23:50")
    try:
        hour, minute = map(int, time_str.split(":"))
    except Exception:
        logger.error(f"Invalid REPORT_SEND_TIME format '{time_str}'. Expected HH:MM. Defaulting to 23:50.")
        hour, minute = 23, 50

    logger.info(f"Scheduling nightly email report job at {hour:02d}:{minute:02d} daily.")
    
    # Remove existing job if present to support live re-scheduling
    try:
        scheduler.remove_job("daily_email_report")
    except Exception:
        pass

    scheduler.add_job(
        send_daily_report_email_job,
        "cron",
        hour=hour,
        minute=minute,
        id="daily_email_report",
        replace_existing=True
    )

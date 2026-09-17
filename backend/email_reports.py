import os
import smtplib
import logging
import io
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT

import models
from database import SessionLocal

logger = logging.getLogger("email_reports")

# --- SMTP Configuration ---
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "").strip()
_raw_password = os.getenv("SMTP_PASSWORD", "")
SMTP_PASSWORD = _raw_password.replace(" ", "").strip()
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "").strip()
REPORT_RECIPIENT_EMAIL = os.getenv("REPORT_RECIPIENT_EMAIL", "").strip()

EMAIL_AUTOMATIONS = {
    "daily_report": {"label": "Daily 10:15 AM operations report", "trigger": "Scheduled daily at 10:15 AM Pakistan time", "default_time": "10:15", "default_enabled": True},
    "low_stock": {"label": "Low-stock / backorder alert", "trigger": "Immediately when stock is insufficient", "default_time": None, "default_enabled": True},
    "restock": {"label": "Inventory received alert", "trigger": "Immediately after restocking", "default_time": None, "default_enabled": True},
    "sla_alerts": {"label": "SLA delay and escalation alert", "trigger": "Immediately at 45/60/75/90 minute delays", "default_time": None, "default_enabled": False},
}


def is_email_automation_enabled(db: Session, key: str) -> bool:
    row = db.query(models.Settings).filter(models.Settings.key == f"email.{key}.enabled").first()
    default_enabled = EMAIL_AUTOMATIONS.get(key, {}).get("default_enabled", True)
    return (row.value.lower() != "false") if row and row.value is not None else default_enabled


def get_email_setting(db: Session, key: str, default: Optional[str] = None) -> Optional[str]:
    row = db.query(models.Settings).filter(models.Settings.key == key).first()
    return row.value if row and row.value is not None else default


def get_email_recipients(db: Session, key: str):
    """Use per-notification recipients when configured; otherwise default to Ukkasha's email."""
    configured = get_email_setting(db, f"email.{key}.recipients", "") or ""
    recipients = [email.strip() for email in configured.split(",") if email.strip()]
    if recipients:
        return recipients
    default_recipient = REPORT_RECIPIENT_EMAIL or "ukkashanavaal5@gmail.com"
    return [default_recipient]
REPORT_SEND_TIME = os.getenv("REPORT_SEND_TIME", "10:15")  # Default to 10:15 AM Pakistan time

PAKISTAN_TZ = ZoneInfo("Asia/Karachi")


def _report_day_bounds(target_date: datetime):
    """Return the selected Pakistan calendar day as naive UTC DB boundaries."""
    local_day = target_date.replace(tzinfo=PAKISTAN_TZ) if target_date.tzinfo is None else target_date.astimezone(PAKISTAN_TZ)
    start_local = local_day.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=1)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None) - timedelta(microseconds=1),
    )


def _pakistan_time(value: Optional[datetime]) -> str:
    if not value:
        return "—"
    return value.replace(tzinfo=timezone.utc).astimezone(PAKISTAN_TZ).strftime("%H:%M")



def generate_daily_report_pdf(db: Session, target_date: datetime, custom_notes: Optional[str] = None) -> bytes:
    """
    Generates a corporate A4 PDF report for Navaal Organic Foods using ReportLab.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=30,
        leftMargin=30,
        topMargin=30,
        bottomMargin=30
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#064e3b'),
        alignment=TA_LEFT
    )

    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=13,
        textColor=colors.HexColor('#047857'),
        alignment=TA_LEFT
    )

    meta_style = ParagraphStyle(
        'MetaText',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor('#475569')
    )

    section_heading = ParagraphStyle(
        'SectionHeading',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=15,
        textColor=colors.HexColor('#0f172a'),
        spaceBefore=8,
        spaceAfter=4
    )

    table_header_style = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.white,
        alignment=TA_CENTER
    )

    table_cell_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=10,
        textColor=colors.HexColor('#1e293b')
    )

    table_cell_bold = ParagraphStyle(
        'TableCellBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.HexColor('#0f172a')
    )

    day_start, day_end = _report_day_bounds(target_date)
    date_str = day_start.strftime("%A, %B %d, %Y")
    period_bounds_str = f"{day_start.strftime('%Y-%m-%d 00:00:00')} to {day_start.strftime('%Y-%m-%d 23:59:59')} PKT"

    # All-Time Cumulative System Totals
    all_time_orders_count = db.query(func.count(models.Order.id)).scalar() or 0
    all_time_orders_amount = db.query(func.sum(models.Order.total_amount)).scalar() or 0.0
    all_time_received_amount = db.query(func.sum(models.Order.amount_received)).scalar() or 0.0

    # Period Specific Queries (Orders created within this report period)
    total_orders = db.query(func.count(models.Order.id)).filter(
        models.Order.created_at >= day_start,
        models.Order.created_at <= day_end
    ).scalar() or 0

    orders_today_amount = db.query(func.sum(models.Order.total_amount)).filter(
        models.Order.created_at >= day_start,
        models.Order.created_at <= day_end
    ).scalar() or 0.0

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

    received_today = db.query(func.sum(models.Order.amount_received)).filter(
        models.Order.status == "delivered",
        models.Order.delivered_at >= day_start,
        models.Order.delivered_at <= day_end
    ).scalar() or 0.0

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
    sla_compliance_rate = round(100.0 - sla_breach_rate, 1)

    restocks_count = db.query(func.count(models.StockMovement.id)).filter(
        models.StockMovement.created_at >= day_start,
        models.StockMovement.created_at <= day_end,
        models.StockMovement.movement_type == "restock"
    ).scalar() or 0

    spoilage_count = db.query(func.count(models.StockMovement.id)).filter(
        models.StockMovement.created_at >= day_start,
        models.StockMovement.created_at <= day_end,
        models.StockMovement.movement_type.in_(["spoilage", "adjustment"])
    ).scalar() or 0


    orders = db.query(models.Order).filter(
        models.Order.created_at >= day_start,
        models.Order.created_at <= day_end
    ).order_by(models.Order.created_at.desc()).all()

    rider_stats = db.query(
        models.Order.assigned_rider_name,
        func.count(models.Order.id).label("total"),
        func.sum(case((models.Order.status == "delivered", 1), else_=0)).label("delivered"),
        func.sum(case((models.Order.status == "returned", 1), else_=0)).label("returned"),
        func.sum(case((models.Order.status == "delivered", models.Order.total_amount), else_=0.0)).label("order_amount"),
        func.sum(case((models.Order.status == "delivered", models.Order.amount_received), else_=0.0)).label("received"),
    ).filter(
        models.Order.assigned_rider_name.isnot(None),
        models.Order.assigned_rider_name != "",
        models.Order.created_at >= day_start,
        models.Order.created_at <= day_end,
    ).group_by(models.Order.assigned_rider_name).all()

    elements = []

    # Header
    elements.append(Paragraph("NAVAAL ORGANIC FOODS", title_style))
    elements.append(Paragraph(f"Daily Operations & Financial Performance Audit — {date_str}", subtitle_style))
    elements.append(Spacer(1, 6))

    # Meta Info Bar
    meta_data = [
        [
            Paragraph(f"<b>Report Window:</b> {period_bounds_str}", meta_style),
            Paragraph(f"<b>Generated At:</b> {datetime.now(PAKISTAN_TZ).strftime('%Y-%m-%d %H:%M PKT')}", meta_style),
            Paragraph("<b>Classification:</b> Confidential Audit", meta_style),
        ]
    ]
    t_meta = Table(meta_data, colWidths=[230, 155, 150])
    t_meta.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f0fdf4')),
        ('PADDING', (0,0), (-1,-1), 5),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#bbf7d0')),
    ]))
    elements.append(t_meta)
    elements.append(Spacer(1, 8))

    # System-Wide Cumulative Overview Bar
    system_cum_data = [
        [
            Paragraph(f"<b>System All-Time Orders:</b> {all_time_orders_count}", meta_style),
            Paragraph(f"<b>System Total Amount:</b> PKR {all_time_orders_amount:,.0f}", meta_style),
            Paragraph(f"<b>System Total Collected:</b> PKR {all_time_received_amount:,.0f}", meta_style),
        ]
    ]
    t_sys_cum = Table(system_cum_data, colWidths=[180, 180, 175])
    t_sys_cum.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
        ('PADDING', (0,0), (-1,-1), 5),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
    ]))
    elements.append(t_sys_cum)
    elements.append(Spacer(1, 8))

    # Management Remarks (Custom Notes)
    if custom_notes:
        notes_p = Paragraph(f"<b>Executive Remarks:</b> {custom_notes}", meta_style)
        t_notes = Table([[notes_p]], colWidths=[535])
        t_notes.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#fffbe6')),
            ('PADDING', (0,0), (-1,-1), 5),
            ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#ffe58f')),
        ]))
        elements.append(t_notes)
        elements.append(Spacer(1, 8))

    # KPI Summary Cards Table
    kpi_data = [
        [
            Paragraph("<b>Orders Placed Today</b>", meta_style), Paragraph(str(total_orders), table_cell_bold),
            Paragraph("<b>Today's Total Order Value</b>", meta_style), Paragraph(f"PKR {orders_today_amount:,.2f}", table_cell_bold)
        ],
        [
            Paragraph("<b>Delivered Revenue Today</b>", meta_style), Paragraph(f"PKR {revenue_today:,.2f}", table_cell_bold),
            Paragraph("<b>Payments Received Today</b>", meta_style), Paragraph(f"PKR {received_today:,.2f}", table_cell_bold)
        ],
        [
            Paragraph("<b>Restock Operations</b>", meta_style), Paragraph(str(restocks_count), table_cell_bold),
            Paragraph("<b>Spoilage / Adjustments</b>", meta_style), Paragraph(str(spoilage_count), table_cell_bold)
        ]
    ]
    t_kpi = Table(kpi_data, colWidths=[140, 127, 140, 128])
    t_kpi.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('PADDING', (0,0), (-1,-1), 5),
    ]))
    elements.append(Paragraph("Executive Summary & Core Metrics", section_heading))
    elements.append(t_kpi)
    elements.append(Spacer(1, 10))

    # Status Breakdown
    statuses = ["pending", "ready_to_ship", "out_for_delivery", "delivered", "cancelled"]
    status_rows = [[Paragraph("<b>Order Status</b>", table_header_style), Paragraph("<b>Total Count</b>", table_header_style)]]
    for s in statuses:
        cnt = db.query(func.count(models.Order.id)).filter(
            models.Order.status == s,
            models.Order.created_at >= day_start,
            models.Order.created_at <= day_end
        ).scalar() or 0
        status_rows.append([
            Paragraph(s.replace('_', ' ').title(), table_cell_style),
            Paragraph(str(cnt), table_cell_style)
        ])
    t_status = Table(status_rows, colWidths=[300, 235])
    t_status.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#047857')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('PADDING', (0,0), (-1,-1), 4),
    ]))
    elements.append(Paragraph("1. Order Pipeline Status Breakdown", section_heading))
    elements.append(t_status)
    elements.append(Spacer(1, 10))

    # Rider performance summary
    elements.append(Paragraph("2. Rider Delivery & Collection Summary", section_heading))
    rider_rows = [[
        Paragraph("<b>Rider</b>", table_header_style),
        Paragraph("<b>Orders</b>", table_header_style),
        Paragraph("<b>Delivered</b>", table_header_style),
        Paragraph("<b>Returned</b>", table_header_style),
        Paragraph("<b>Order Amount</b>", table_header_style),
        Paragraph("<b>Received</b>", table_header_style),
    ]]
    for r in rider_stats:
        rider_rows.append([
            Paragraph(r.assigned_rider_name or "Unassigned", table_cell_bold),
            Paragraph(str(r.total or 0), table_cell_style),
            Paragraph(str(r.delivered or 0), table_cell_style),
            Paragraph(str(r.returned or 0), table_cell_style),
            Paragraph(f"PKR {(r.order_amount or 0):,.0f}", table_cell_style),
            Paragraph(f"PKR {(r.received or 0):,.0f}", table_cell_style),
        ])
    if len(rider_rows) == 1:
        rider_rows.append([Paragraph("No rider activity recorded.", table_cell_style), "", "", "", "", ""])
    t_riders = Table(rider_rows, colWidths=[125, 55, 65, 55, 115, 120])
    t_riders.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#047857')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f8fafc')]),
        ('PADDING', (0,0), (-1,-1), 4),
    ]))
    elements.append(t_riders)
    elements.append(Spacer(1, 10))

    # Detailed Orders Log Table
    elements.append(Paragraph("3. Detailed Order Log for Today", section_heading))
    if not orders:
        elements.append(Paragraph("<i>No orders recorded on this date.</i>", meta_style))
    else:
        order_table_data = [
            [
                Paragraph("<b>Order #</b>", table_header_style),
                Paragraph("<b>Customer</b>", table_header_style),
                Paragraph("<b>City</b>", table_header_style),
                Paragraph("<b>Status</b>", table_header_style),
                Paragraph("<b>Amount (PKR)</b>", table_header_style),
            ]
        ]
        for o in orders[:50]:
            order_table_data.append([
                Paragraph(o.order_number or str(o.id), table_cell_bold),
                Paragraph(o.customer_name or "N/A", table_cell_style),
                Paragraph(o.city or "N/A", table_cell_style),
                Paragraph(o.status.replace('_', ' ').title(), table_cell_style),
                Paragraph(f"{o.total_amount:,.2f}", table_cell_style),
            ])
        t_orders = Table(order_table_data, colWidths=[100, 150, 95, 95, 95])
        t_orders.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#064e3b')),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f8fafc')]),
            ('PADDING', (0,0), (-1,-1), 4),
        ]))
        elements.append(t_orders)

    elements.append(Spacer(1, 10))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#cbd5e1')))
    elements.append(Spacer(1, 4))
    elements.append(Paragraph("<b>Smart OrderFlow OMS</b> — Official Enterprise Operations Report • PDF Document", meta_style))

    doc.build(elements)
    return buffer.getvalue()



def generate_daily_report_html(db: Session, target_date: datetime) -> str:
    """
    Generates a beautifully styled, high-impact HTML report containing
    operational, SLA, inventory, rider, and sales metrics.
    """
    day_start, day_end = _report_day_bounds(target_date)
    date_str = day_start.strftime("%A, %B %d, %Y")
    period_bounds_str = f"{day_start.strftime('%Y-%m-%d 00:00:00')} to {day_start.strftime('%Y-%m-%d 23:59:59')} PKT"

    # All-Time System Cumulative Totals
    all_time_orders_count = db.query(func.count(models.Order.id)).scalar() or 0
    all_time_orders_amount = db.query(func.sum(models.Order.total_amount)).scalar() or 0.0
    all_time_received_amount = db.query(func.sum(models.Order.amount_received)).scalar() or 0.0

    # 1. KPI Queries (Selected Daily Report Window)
    total_orders = db.query(func.count(models.Order.id)).filter(
        models.Order.created_at >= day_start,
        models.Order.created_at <= day_end
    ).scalar() or 0

    orders_today_amount = db.query(func.sum(models.Order.total_amount)).filter(
        models.Order.created_at >= day_start,
        models.Order.created_at <= day_end
    ).scalar() or 0.0

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

    received_today = db.query(func.sum(models.Order.amount_received)).filter(
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

    # 4. Source Breakdown (All Channels)
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
        func.sum(case((models.Order.status == "delivered", 1), else_=0)).label("delivered"),
        func.sum(case((models.Order.status == "out_for_delivery", 1), else_=0)).label("out_for_delivery"),
        func.sum(case((models.Order.status == "delivered", models.Order.total_amount), else_=0.0)).label("delivered_amount"),
        func.sum(case((models.Order.status == "delivered", models.Order.amount_received), else_=0.0)).label("amount_received"),
        func.sum(case((models.Order.status == "returned", 1), else_=0)).label("returned")
    ).filter(
        models.Order.assigned_rider_name.isnot(None),
        models.Order.assigned_rider_name != "",
        (models.Order.created_at >= day_start) | (models.Order.delivered_at >= day_start)
    ).group_by(models.Order.assigned_rider_name).all()

    # 6. Spoilage Logs Today
    spoilages = db.query(models.StockMovement).filter(
        models.StockMovement.created_at >= day_start,
        models.StockMovement.created_at <= day_end,
        models.StockMovement.movement_type.in_(["spoilage", "spoiled", "broken", "adjustment"]),
        models.StockMovement.quantity_change < 0
    ).all()

    # 7. Restock Logs Today
    restocks = db.query(models.StockMovement).filter(
        models.StockMovement.created_at >= day_start,
        models.StockMovement.created_at <= day_end,
        models.StockMovement.movement_type == "restock"
    ).all()

    # --- HTML Building ---
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
                <p style="margin: 15px 0 0 0; color: #ffffff; opacity: 0.9 font-size: 13px;"><b>Report Window:</b> {period_bounds_str}</p>
            </td>
        </tr>

        <!-- Main Content -->
        <tr>
            <td style="padding: 30px 40px;">
                <!-- All-Time System Cumulative Overview -->
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 18px; margin-bottom: 25px;">
                    <div style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">System-Wide All-Time Summary</div>
                    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="font-size: 13px;">
                        <tr>
                            <td width="33%"><b>All-Time Orders:</b> <span style="color: #0f172a; font-weight: 800;">{all_time_orders_count}</span></td>
                            <td width="33%"><b>All-Time Total Amount:</b> <span style="color: #047857; font-weight: 800;">PKR {all_time_orders_amount:,.0f}</span></td>
                            <td width="34%"><b>Total Payments Collected:</b> <span style="color: #b45309; font-weight: 800;">PKR {all_time_received_amount:,.0f}</span></td>
                        </tr>
                    </table>
                </div>

                <!-- Daily Operating Metrics Grid -->
                <h3 style="margin-top: 0; margin-bottom: 15px; color: #1b4332; font-size: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Daily Operating KPIs ({date_str})</h3>
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 25px;">
                    <tr>
                        <td width="19%" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 10px; text-align: center;">
                            <div style="font-size: 10px; color: #166534; text-transform: uppercase; font-weight: bold; margin-bottom: 3px;">Orders Today</div>
                            <div style="font-size: 20px; font-weight: 800; color: #14532d;">{total_orders}</div>
                        </td>
                        <td width="1%"></td>
                        <td width="20%" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 10px; text-align: center;">
                            <div style="font-size: 10px; color: #166534; text-transform: uppercase; font-weight: bold; margin-bottom: 3px;">Today's Order Value</div>
                            <div style="font-size: 16px; font-weight: 800; color: #14532d;">PKR {orders_today_amount:,.0f}</div>
                        </td>
                        <td width="1%"></td>
                        <td width="20%" style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 12px 10px; text-align: center;">
                            <div style="font-size: 10px; color: #065f46; text-transform: uppercase; font-weight: bold; margin-bottom: 3px;">Delivered Amount</div>
                            <div style="font-size: 16px; font-weight: 800; color: #064e3b;">PKR {revenue_today:,.0f}</div>
                        </td>
                        <td width="1%"></td>
                        <td width="19%" style="background-color: #fefce8; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 10px; text-align: center;">
                            <div style="font-size: 10px; color: #854d0e; text-transform: uppercase; font-weight: bold; margin-bottom: 3px;">Amount Received</div>
                            <div style="font-size: 16px; font-weight: 800; color: #713f12;">PKR {received_today:,.0f}</div>
                        </td>
                        <td width="1%"></td>
                        <td width="18%" style="background-color: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 12px 10px; text-align: center;">
                            <div style="font-size: 10px; color: #9f1239; text-transform: uppercase; font-weight: bold; margin-bottom: 3px;">SLA Breach</div>
                            <div style="font-size: 18px; font-weight: 800; color: #881337;">{sla_breach_rate}%</div>
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
        <th style="padding: 10px; text-align: center;">Returned</th>
        <th style="padding: 10px; text-align: right;">Order Amount</th>
        <th style="padding: 10px; text-align: right;">Amount Received</th>
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
        <td style="padding: 10px; text-align: center; color: #dc2626; font-weight: 600;">{r.returned or 0}</td>
        <td style="padding: 10px; text-align: right; font-weight: 800; color: #15803d;">PKR {r.delivered_amount or 0:,.0f}</td>
        <td style="padding: 10px; text-align: right; font-weight: 800; color: #15803d;">PKR {r.amount_received or 0:,.0f}</td>
                        <td style="padding: 10px; text-align: right; font-weight: bold; color: {success_color};">{success_pct}%</td>
                    </tr>
        """

    if not rider_stats:
        html += """
                    <tr>
                        <td colspan="8" style="padding: 20px; text-align: center; color: #94a3b8; font-style: italic;">No rider activities recorded for today.</td>
                    </tr>
        """

    html += f"""
                </table>

                <!-- Spoilage/Wastage Log Today -->
                <h3 style="margin-top: 10px; margin-bottom: 15px; color: #1b4332; font-size: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Wastage & Spoilage Recorded Today</h3>
                <table width="100%" style="border-collapse: collapse; font-size: 13px; margin-bottom: 25px;">
                    <tr style="background-color: #7f1d1d; color: #ffffff; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">
                        <th style="padding: 10px; text-align: left;">Product</th>
                        <th style="padding: 10px; text-align: center;">Type</th>
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
        loss_type = "BROKEN" if s_mov.movement_type == "broken" else "SPOILED"
        html += f"""
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 10px; text-align: left; font-weight: 600; color: #1e293b;">{p_name}</td>
                        <td style="padding: 10px; text-align: center; color: {'#b45309' if loss_type == 'BROKEN' else '#dc2626'}; font-weight: bold;">{loss_type}</td>
                        <td style="padding: 10px; text-align: center; color: #dc2626; font-weight: bold;">-{abs(s_mov.quantity_change)} {product.unit if product else "units"}</td>
                        <td style="padding: 10px; text-align: right; color: #b91c1c; font-weight: bold;">PKR {val_lost:,.0f}</td>
                        <td style="padding: 10px; text-align: left; padding-left: 20px; color: #64748b; font-style: italic;">{s_mov.note or '—'}</td>
                    </tr>
        """

    if not spoilages:
        html += """
                    <tr>
                        <td colspan="5" style="padding: 20px; text-align: center; color: #94a3b8; font-style: italic;">No stock wastage or spoilages logged today. ✓</td>
                    </tr>
        """
    else:
        html += f"""
                    <tr style="background-color: #fef2f2; font-weight: bold;">
                        <td colspan="3" style="padding: 10px; text-align: left; color: #991b1b;">Total Loss Valuation</td>
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
        time_str = _pakistan_time(o.created_at)
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


def send_daily_report_email(
    db: Session,
    date_str: Optional[str] = None,
    custom_recipient: Optional[str] = None,
    custom_notes: Optional[str] = None,
    include_pdf: bool = True
) -> bool:
    """
    Builds and sends the daily report email with PDF attachment to target recipient(s).
    """
    recipients = []
    if custom_recipient and custom_recipient.strip():
        recipients = [r.strip() for r in custom_recipient.split(",") if r.strip()]
    else:
        recipients = get_email_recipients(db, "daily_report")

    if not SMTP_HOST or not SMTP_PORT or not SMTP_USERNAME or not SMTP_PASSWORD or not SMTP_FROM_EMAIL:
        logger.warning(
            "SMTP configuration is incomplete. Skip sending daily report email. "
            "Required vars: SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL"
        )
        return False

    time_str = get_email_setting(db, "email.daily_report.time", os.getenv("REPORT_SEND_TIME", "10:15"))
    if time_str == "23:50" and not os.getenv("REPORT_SEND_TIME"):
        time_str = "10:15"
        try:
            row = db.query(models.Settings).filter(models.Settings.key == "email.daily_report.time").first()
            if row:
                row.value = "10:15"
                row.updated_at = datetime.utcnow()
                db.commit()
        except Exception as ex:
            logger.warning(f"Could not update legacy time setting: {ex}")

    try:
        if date_str:
            target_date = datetime.strptime(date_str, "%Y-%m-%d")
        else:
            target_date = datetime.now(PAKISTAN_TZ)
    except Exception as e:
        logger.error(f"Failed to parse report date '{date_str}': {e}. Defaulting to UTC now.")
        target_date = datetime.now(PAKISTAN_TZ)

    date_label = target_date.strftime("%Y-%m-%d")
    recipients_str = ", ".join(recipients)
    logger.info(f"Generating daily report email (PDF={include_pdf}) for {date_label} to [{recipients_str}]...")

    try:
        html_content = generate_daily_report_html(db, target_date)
    except Exception as e:
        logger.exception(f"Failed to generate daily report HTML: {e}")
        return False

    pdf_bytes = None
    if include_pdf:
        try:
            pdf_bytes = generate_daily_report_pdf(db, target_date, custom_notes=custom_notes)
        except Exception as e:
            logger.exception(f"Failed to generate PDF report attachment: {e}")

    # Setup MIME Mixed Message for HTML body + PDF attachment
    msg = MIMEMultipart("mixed")
    msg["Subject"] = f"Navaal Organic Foods - Daily Working & Operations Report [{date_label}]"
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = recipients_str

    # HTML Body Part
    body_part = MIMEMultipart("alternative")
    part_html = MIMEText(html_content, "html")
    body_part.attach(part_html)
    msg.attach(body_part)

    # PDF Attachment
    if pdf_bytes:
        pdf_attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
        pdf_attachment.add_header("Content-Disposition", "attachment", filename=f"Navaal_Operations_Report_{date_label}.pdf")
        msg.attach(pdf_attachment)

    # Send via SMTP
    try:
        logger.info(f"Connecting to SMTP server {SMTP_HOST}:{SMTP_PORT} using sender {SMTP_USERNAME}...")
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.ehlo()
        if SMTP_PORT == 587:
            server.starttls()
            server.ehlo()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM_EMAIL, recipients, msg.as_string())
        server.quit()
        logger.info(f"Daily report email with PDF attachment successfully sent to [{recipients_str}] for {date_label}!")
        return True
    except Exception as e:
        logger.exception(f"Failed to send report email to [{recipients_str}]: {e}")
        return False


def send_low_stock_email_alert(db: Session, product_name: str, available_qty: float, required_qty: float, unit: str = "units") -> bool:
    """
    Sends an immediate email notification when an order attempt fails due to low/insufficient stock.
    """
    if not is_email_automation_enabled(db, "low_stock"):
        return False
    recipients = get_email_recipients(db, "low_stock")

    if not SMTP_HOST or not SMTP_PORT or not SMTP_USERNAME or not SMTP_PASSWORD or not SMTP_FROM_EMAIL:
        return False

    recipients_str = ", ".join(recipients)
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"⚠️ INSUFFICIENT STOCK ALERT — {product_name}"
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = recipients_str
    msg.attach(MIMEText(
        f"<h2>Out of Stock / Insufficient Inventory Alert</h2>"
        f"<p><b>{product_name}</b>: available {available_qty} {unit}; required {required_qty} {unit}.</p>",
        "html",
    ))
    try:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.ehlo()
        if SMTP_PORT == 587:
            server.starttls()
            server.ehlo()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM_EMAIL, recipients, msg.as_string())
        server.quit()
        logger.info(f"Low stock email alert sent to [{recipients_str}] for {product_name}")
        return True
    except Exception as e:
        logger.exception(f"Failed to send low stock email alert: {e}")
        return False


def send_restock_email_alert(db: Session, product_name: str, added_qty: float, new_qty: float, unit: str = "units", added_by: str = "System") -> bool:
    """Notify the owner/management when inventory is received, not only when it is low."""
    if not is_email_automation_enabled(db, "restock"):
        return False
    recipients = get_email_recipients(db, "restock")
    if not SMTP_HOST or not SMTP_PORT or not SMTP_USERNAME or not SMTP_PASSWORD or not SMTP_FROM_EMAIL:
        return False
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"✅ INVENTORY RECEIVED — {product_name}"
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(
        f"<h2>Inventory received</h2><p><b>{product_name}</b>: +{added_qty} {unit}. "
        f"New available stock: <b>{new_qty} {unit}</b>.</p><p>Recorded by: {added_by}</p>", "html"
    ))
    try:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.ehlo()
        if SMTP_PORT == 587: server.starttls(); server.ehlo()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM_EMAIL, recipients, msg.as_string())
        server.quit()
        return True
    except Exception:
        logger.exception("Failed to send restock email alert")
        return False


def send_sla_email_alert(db: Session, subject: str, message: str) -> bool:
    """Email management when an order crosses an SLA delay threshold."""
    if not is_email_automation_enabled(db, "sla_alerts"):
        return False
    recipients = get_email_recipients(db, "sla_alerts")
    if not SMTP_HOST or not SMTP_PORT or not SMTP_USERNAME or not SMTP_PASSWORD or not SMTP_FROM_EMAIL:
        return False
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(f"<h2>{subject}</h2><p>{message}</p>", "html"))
    try:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.ehlo()
        if SMTP_PORT == 587:
            server.starttls()
            server.ehlo()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM_EMAIL, recipients, msg.as_string())
        server.quit()
        logger.info("SLA email alert sent for [%s]", subject)
        return True
    except Exception:
        logger.exception("Failed to send SLA email alert")
        return False

def send_daily_report_email_job():
    """
    Scheduler job wrapper that handles Session creation.
    """
    logger.info("Daily 10:15 AM report email job triggered by scheduler...")
    db = SessionLocal()
    try:
        # At 10:15 AM, report the completed previous Pakistan calendar day.
        report_date = datetime.now(PAKISTAN_TZ) - timedelta(days=1)
        send_daily_report_email(db, date_str=report_date.strftime("%Y-%m-%d"))
    finally:
        db.close()


def schedule_daily_report(scheduler: AsyncIOScheduler):
    """
    Parses configured send time and adds daily cron job to APScheduler.
    """
    db = SessionLocal()
    try:
        enabled = is_email_automation_enabled(db, "daily_report")
        time_str = get_email_setting(db, "email.daily_report.time", os.getenv("REPORT_SEND_TIME", "10:15"))
    finally:
        db.close()
    try:
        hour, minute = map(int, time_str.split(":"))
    except Exception:
        logger.error(f"Invalid REPORT_SEND_TIME format '{time_str}'. Expected HH:MM. Defaulting to 10:15.")
        hour, minute = 10, 15

    # Remove existing job if present to support live re-scheduling
    try:
        scheduler.remove_job("daily_email_report")
    except Exception:
        pass

    if not enabled:
        logger.info("Daily email report is disabled.")
        return

    logger.info(f"Scheduling daily email report job at {hour:02d}:{minute:02d} Pakistan time.")

    scheduler.add_job(
        send_daily_report_email_job,
        "cron",
        hour=hour,
        minute=minute,
        id="daily_email_report",
        replace_existing=True,
        timezone=PAKISTAN_TZ,
    )

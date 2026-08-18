"""
Invoice & Delivery Receipt Generation
- PDF invoice (A4, printable)
- Delivery receipt (compact, for customer signature)
- QR code generation per order
"""
import io
import qrcode
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph,
    Spacer, HRFlowable, Image as RLImage
)
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
from jose import jwt

from database import get_db
import models
from auth import get_current_user, SECRET_KEY, ALGORITHM

router = APIRouter(prefix="/api/invoices", tags=["invoices"])

# ── allow token via ?token=... for browser window.open() PDF downloads ────────
def get_user_via_token_or_header(
    token_param: Optional[str] = Query(None, alias="token"),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
    db: Session = Depends(get_db),
) -> models.User:
    raw_token = token_param
    if raw_token is None and credentials:
        raw_token = credentials.credentials
    if raw_token is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(raw_token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(models.User).filter(models.User.id == user_id, models.User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ─── Brand Colors ──────────────────────────────────────────────────────────────
BRAND_GREEN = colors.HexColor("#16a34a")
DARK_BG = colors.HexColor("#1a2b1a")
LIGHT_GREEN = colors.HexColor("#dcfce7")
GRAY_TEXT = colors.HexColor("#6b7280")
DARK_TEXT = colors.HexColor("#111827")

COMPANY = {
    "name": "Navaal Foods",
    "tagline": "Pure. Natural. Organic.",
    "address": "Karima view, Jamshed Quarters, Near Banori Town Masjid, Karachi, Sindh 75300, Pakistan",
    "phone": "+92 322 2416033",
    "email": "info@navaalfoods.com",
    "website": "www.navaalfoods.com",
}


def _fmt_ts(ts):
    if not ts:
        return "—"
    if isinstance(ts, str):
        ts = ts.rstrip("Z")
        ts = datetime.fromisoformat(ts)
    return ts.strftime("%d %b %Y, %I:%M %p")


def _duration_str(start, end):
    """Return human-readable duration like '1h 24m'."""
    if not start or not end:
        return None
    if isinstance(start, str):
        start = datetime.fromisoformat(start.rstrip("Z"))
    if isinstance(end, str):
        end = datetime.fromisoformat(end.rstrip("Z"))
    diff = int((end - start).total_seconds())
    if diff < 0:
        return None
    h, rem = divmod(diff, 3600)
    m = rem // 60
    if h > 0:
        return f"{h}h {m}m"
    return f"{m}m"


def _generate_qr_image(data: str, size_mm: int = 30):
    """Generate a QR code and return as ReportLab Image."""
    qr = qrcode.QRCode(version=1, box_size=6, border=2)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return RLImage(buf, width=size_mm * mm, height=size_mm * mm)


# ─── QR Code Endpoint ─────────────────────────────────────────────────────────

@router.get("/qr/{order_id}")
def get_order_qr(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_user_via_token_or_header),
):
    """Return a PNG QR code image for the order."""
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    qr_data = f"SOF:{order.order_number}:{order.id}"
    qr = qrcode.QRCode(version=1, box_size=10, border=4)
    qr.add_data(qr_data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return Response(content=buf.read(), media_type="image/png")


# ─── QR Scan Lookup ───────────────────────────────────────────────────────────

@router.get("/scan/{qr_data}")
def scan_order_qr(
    qr_data: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_user_via_token_or_header),
):
    """Look up an order by QR data string (SOF:ORDER_NUMBER:ID)."""
    try:
        parts = qr_data.split(":")
        order_number = parts[1] if len(parts) > 1 else qr_data
    except Exception:
        order_number = qr_data

    order = db.query(models.Order).filter(
        (models.Order.order_number == order_number) |
        (models.Order.order_number == qr_data)
    ).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    return {
        "id": order.id,
        "order_number": order.order_number,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "status": order.status,
        "city": order.city,
        "items": [
            {"product_name": i.product_name, "quantity": i.quantity, "unit_price": i.unit_price}
            for i in order.items
        ],
        "total_amount": order.total_amount,
    }


# ─── Gate Pass PDF Generator ──────────────────────────────────────────────────

@router.get("/gate-pass/pdf")
def download_gate_pass_pdf(
    rider_name: str,
    order_ids: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_user_via_token_or_header),
):
    """
    Generate printable Gate Pass PDF for a rider with all assigned orders and total COD cash calculation.
    """
    query = db.query(models.Order).filter(models.Order.assigned_rider_name == rider_name)
    if order_ids:
        ids_list = [int(x.strip()) for x in order_ids.split(",") if x.strip().isdigit()]
        if ids_list:
            query = query.filter(models.Order.id.in_(ids_list))
    else:
        query = query.filter(models.Order.status.in_(["ready_to_ship", "out_for_delivery"]))

    orders = query.all()
    if not orders:
        raise HTTPException(status_code=404, detail="No orders found for this rider")

    now = datetime.utcnow()
    gate_pass_no = orders[0].gate_pass_no or f"GP-{now.year}{now.month:02d}-{now.strftime('%H%M%S')}"

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=1.5 * cm,
        leftMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )

    styles = getSampleStyleSheet()
    story = []

    # Title Header
    story.append(Paragraph(
        f"<font size=22 color='#16a34a'><b>{COMPANY['name']}</b></font><br/>"
        f"<font size=16 color='#111827'><b>DISPATCH GATE PASS</b></font>",
        ParagraphStyle("gp_title", alignment=TA_CENTER, leading=22)
    ))
    story.append(Spacer(1, 0.3 * cm))
    story.append(HRFlowable(width="100%", thickness=2, color=BRAND_GREEN))
    story.append(Spacer(1, 0.4 * cm))

    # Details Block
    total_cod = sum(o.total_amount for o in orders if (o.payment_method or o.payment_status or "").lower() == "cod")
    info_text = (
        f"<b>Gate Pass #:</b> {gate_pass_no}<br/>"
        f"<b>Date & Time:</b> {_fmt_ts(now)}<br/>"
        f"<b>Rider Name:</b> {rider_name}<br/>"
        f"<b>Total Orders:</b> {len(orders)}<br/>"
        f"<b>Total COD to Collect:</b> PKR {total_cod:,.0f}"
    )
    story.append(Paragraph(info_text, ParagraphStyle("gp_info", fontSize=10, leading=16)))
    story.append(Spacer(1, 0.5 * cm))

    # Orders Table
    table_data = [["S.No", "Order #", "Customer Name", "Phone & Address", "Payment Method", "COD Amount"]]
    for i, o in enumerate(orders, 1):
        pm = (o.payment_method or o.payment_status or "COD").upper()
        cod_str = f"PKR {o.total_amount:,.0f}" if pm == "COD" else "PAID (0.0)"
        table_data.append([
            str(i),
            o.order_number or f"#{o.id}",
            o.customer_name or "Customer",
            f"{o.customer_phone or 'N/A'}\n{o.delivery_address or ''}",
            pm,
            cod_str,
        ])

    table = Table(table_data, colWidths=[1 * cm, 3 * cm, 4 * cm, 5 * cm, 2.5 * cm, 2.5 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#bbf7d0")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(table)
    story.append(Spacer(1, 0.6 * cm))

    # Total COD Summary Box
    tot_data = [["", "EXPECTED COD CASH BRING-BACK:", f"PKR {total_cod:,.0f}"]]
    tot_table = Table(tot_data, colWidths=[8 * cm, 6 * cm, 4 * cm])
    tot_table.setStyle(TableStyle([
        ("BACKGROUND", (1, 0), (-1, -1), BRAND_GREEN),
        ("TEXTCOLOR", (1, 0), (-1, -1), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tot_table)
    story.append(Spacer(1, 1.2 * cm))

    # Signatures
    sig_data = [
        ["________________________", "________________________", "________________________"],
        ["Dispatched By (Warehouse)", "Rider Signature", "Gate Security Stamp / Pass"]
    ]
    sig_table = Table(sig_data, colWidths=[6 * cm, 6 * cm, 6 * cm])
    sig_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTSIZE", (0, 1), (-1, 1), 9),
        ("TEXTCOLOR", (0, 1), (-1, 1), GRAY_TEXT),
    ]))
    story.append(sig_table)

    doc.build(story)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="GatePass_{gate_pass_no}.pdf"'},
    )


# ─── Full PDF Invoice ─────────────────────────────────────────────────────────

@router.get("/{order_id}/pdf")
def download_invoice(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_user_via_token_or_header),
):
    """Generate and return a full A4 PDF invoice."""
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=1.5 * cm,
        leftMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )

    styles = getSampleStyleSheet()
    story = []

    pay_status_str = (order.payment_status or "COD").upper()
    source_str = (order.source or "website").replace("_", " ").title()

    # ── Header ────────────────────────────────────────────────────────────────
    header_data = [
        [
            Paragraph(
                f"<font size=20 color='#16a34a'><b>{COMPANY['name']}</b></font><br/>"
                f"<font size=9 color='#6b7280'>{COMPANY['tagline']}</font>",
                styles["Normal"]
            ),
            Paragraph(
                f"<font size=24 color='#16a34a'><b>INVOICE</b></font><br/>"
                f"<font size=9 color='#6b7280'># {order.order_number or order.id}</font>",
                ParagraphStyle("right", alignment=TA_RIGHT, fontSize=9)
            ),
        ]
    ]
    header_table = Table(header_data, colWidths=[9 * cm, 9 * cm])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(header_table)
    story.append(HRFlowable(width="100%", thickness=2, color=BRAND_GREEN))
    story.append(Spacer(1, 0.4 * cm))

    # ── Company + Customer Info ────────────────────────────────────────────────
    info_data = [
        [
            Paragraph(
                f"<b>From:</b><br/>{COMPANY['name']}<br/>{COMPANY['address']}<br/>"
                f"Ph: {COMPANY['phone']}<br/>Email: {COMPANY['email']}",
                ParagraphStyle("left", fontSize=9, leading=14)
            ),
            Paragraph(
                f"<b>Bill To:</b><br/>{order.customer_name or 'Valued Customer'}<br/>"
                f"Ph: {order.customer_phone or '—'}<br/>"
                f"{order.delivery_address or '—'}<br/>{order.city or ''}",
                ParagraphStyle("left", fontSize=9, leading=14)
            ),
            Paragraph(
                f"<b>Date:</b><br/>{_fmt_ts(order.created_at)}<br/><br/>"
                f"<b>Payment:</b><br/>{pay_status_str}<br/><br/>"
                f"<b>Source:</b><br/>{source_str}",
                ParagraphStyle("left", fontSize=9, leading=14)
            ),
        ]
    ]
    info_table = Table(info_data, colWidths=[6 * cm, 6 * cm, 6 * cm])
    info_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f0fdf4")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#bbf7d0")),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#bbf7d0")),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 0.5 * cm))

    # ── Items Table ───────────────────────────────────────────────────────────
    story.append(Paragraph("<b>Order Items</b>", ParagraphStyle("heading", fontSize=11, textColor=BRAND_GREEN, spaceAfter=4)))

    items_data = [["#", "Product", "Qty", "Unit Price", "Total"]]
    for i, item in enumerate(order.items, 1):
        items_data.append([
            str(i),
            item.product_name,
            str(item.quantity),
            f"PKR {item.unit_price:,.0f}",
            f"PKR {item.total_price:,.0f}",
        ])

    items_table = Table(items_data, colWidths=[0.7 * cm, 9 * cm, 1.5 * cm, 3 * cm, 3.5 * cm])
    items_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f0fdf4")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1fae5")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 0.3 * cm))

    # ── Total ──────────────────────────────────────────────────────────────────
    total_data = [
        ["", "TOTAL AMOUNT:", f"PKR {order.total_amount:,.0f}"]
    ]
    total_table = Table(total_data, colWidths=[9 * cm, 5 * cm, 4 * cm])
    total_table.setStyle(TableStyle([
        ("BACKGROUND", (1, 0), (-1, -1), BRAND_GREEN),
        ("TEXTCOLOR", (1, 0), (-1, -1), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(total_table)
    story.append(Spacer(1, 0.5 * cm))

    # ── Delivery Time Chain ────────────────────────────────────────────────────
    if order.delivered_at:
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#d1fae5")))
        story.append(Spacer(1, 0.3 * cm))
        story.append(Paragraph("<b>Delivery Time Breakdown</b>",
                               ParagraphStyle("heading", fontSize=10, textColor=BRAND_GREEN, spaceAfter=4)))

        pack_time = _duration_str(order.created_at, order.rts_at)
        pickup_time = _duration_str(order.rts_at, order.pickup_at)
        delivery_time = _duration_str(order.pickup_at, order.delivered_at)
        total_time = _duration_str(order.created_at, order.delivered_at)

        time_data = [
            ["Stage", "From", "To", "Duration"],
            ["Order → Packed",
             _fmt_ts(order.created_at), _fmt_ts(order.rts_at), pack_time or "—"],
            ["Packed → Picked Up",
             _fmt_ts(order.rts_at), _fmt_ts(order.pickup_at), pickup_time or "—"],
            ["Picked Up → Delivered",
             _fmt_ts(order.pickup_at), _fmt_ts(order.delivered_at), delivery_time or "—"],
            ["TOTAL FULFILLMENT TIME", "", "", total_time or "—"],
        ]
        time_table = Table(time_data, colWidths=[4.5 * cm, 4.5 * cm, 4.5 * cm, 4.5 * cm])
        time_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#166534")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 4), (-1, 4), "Helvetica-Bold"),
            ("BACKGROUND", (0, 4), (-1, 4), LIGHT_GREEN),
            ("TEXTCOLOR", (0, 4), (-1, 4), colors.HexColor("#166534")),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#bbf7d0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, 3), [colors.white, colors.HexColor("#f0fdf4")]),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(time_table)

    # ── QR + Footer ────────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.5 * cm))
    qr_img = _generate_qr_image(f"SOF:{order.order_number}:{order.id}", size_mm=28)

    footer_data = [
        [
            qr_img,
            Paragraph(
                f"<font size=8 color='#6b7280'>Scan QR to verify this order in Smart OrderFlow</font><br/><br/>"
                f"<font size=7 color='#9ca3af'>{COMPANY['name']} | {COMPANY['address']} | {COMPANY['website']}</font><br/>"
                f"<font size=7 color='#9ca3af'>Thank you for choosing Navaal Organic Foods!</font>",
                ParagraphStyle("footer_text", fontSize=8, leading=12)
            ),
            Paragraph(
                f"<font size=8 color='#6b7280'><b>Rider:</b> {order.assigned_rider_name or '—'}</font><br/>"
                f"<font size=8 color='#6b7280'><b>Status:</b> {order.status.replace('_', ' ').upper()}</font>",
                ParagraphStyle("footer_right", fontSize=8, alignment=TA_RIGHT)
            ),
        ]
    ]
    footer_table = Table(footer_data, colWidths=[3 * cm, 10 * cm, 5 * cm])
    footer_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f0fdf4")),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#bbf7d0")),
    ]))
    story.append(footer_table)

    doc.build(story)
    buf.seek(0)

    filename = f"Navaal_Invoice_{order.order_number}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── Delivery Receipt (compact, for printing at dispatch) ─────────────────────

@router.get("/{order_id}/receipt")
def download_receipt(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_user_via_token_or_header),
):
    """Compact delivery receipt — rider carries this for customer signature."""
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Use 80mm thermal receipt width (226pt ≈ 8cm)
    PAGE_W = 8 * cm
    PAGE_H = 25 * cm  # auto-cut

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=(PAGE_W, PAGE_H),
        rightMargin=0.3 * cm,
        leftMargin=0.3 * cm,
        topMargin=0.4 * cm,
        bottomMargin=0.4 * cm,
    )

    small = ParagraphStyle("small", fontSize=7, leading=10)
    bold_small = ParagraphStyle("bold_small", fontSize=8, leading=11, fontName="Helvetica-Bold")
    center_small = ParagraphStyle("center_small", fontSize=7, leading=10, alignment=TA_CENTER)
    center_bold = ParagraphStyle("center_bold", fontSize=9, leading=12,
                                 fontName="Helvetica-Bold", alignment=TA_CENTER)

    story = []

    # Header
    story.append(Paragraph(COMPANY["name"], center_bold))
    story.append(Paragraph(COMPANY["tagline"], center_small))
    story.append(Paragraph(COMPANY["phone"], center_small))
    story.append(Spacer(1, 2 * mm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.black))
    story.append(Spacer(1, 2 * mm))

    # Order info
    story.append(Paragraph(f"<b>Order #:</b> {order.order_number}", bold_small))
    story.append(Paragraph(f"<b>Customer:</b> {order.customer_name}", small))
    story.append(Paragraph(f"<b>Phone:</b> {order.customer_phone or '—'}", small))
    story.append(Paragraph(f"<b>Address:</b> {order.delivery_address or '—'}", small))
    story.append(Paragraph(f"<b>Rider:</b> {order.assigned_rider_name or '—'}", small))
    story.append(Spacer(1, 2 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.gray, dashes=[2, 2]))
    story.append(Spacer(1, 2 * mm))

    # Items
    story.append(Paragraph("<b>Items:</b>", bold_small))
    for item in order.items:
        story.append(Paragraph(f"  {item.product_name}  x{item.quantity}  PKR {item.total_price:,.0f}", small))
    story.append(Spacer(1, 1 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.gray))
    story.append(Paragraph(f"<b>TOTAL: PKR {order.total_amount:,.0f}  ({order.payment_status.upper()})</b>", bold_small))
    story.append(Spacer(1, 2 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.gray, dashes=[2, 2]))
    story.append(Spacer(1, 2 * mm))

    # Time chain
    story.append(Paragraph("<b>Delivery Timeline:</b>", bold_small))
    story.append(Paragraph(f"Ordered:   {_fmt_ts(order.created_at)}", small))
    story.append(Paragraph(f"Packed:    {_fmt_ts(order.rts_at)}", small))
    story.append(Paragraph(f"Picked Up: {_fmt_ts(order.pickup_at)}", small))
    if order.delivered_at:
        story.append(Paragraph(f"Delivered: {_fmt_ts(order.delivered_at)}", small))
        total_t = _duration_str(order.created_at, order.delivered_at)
        if total_t:
            story.append(Paragraph(f"<b>Total Time: {total_t}</b>", bold_small))

    story.append(Spacer(1, 3 * mm))

    # QR code
    qr_img = _generate_qr_image(f"SOF:{order.order_number}:{order.id}", size_mm=22)
    story.append(qr_img)
    story.append(Spacer(1, 2 * mm))

    # Signature line
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.gray, dashes=[2, 2]))
    story.append(Spacer(1, 1 * mm))
    story.append(Paragraph("Customer Signature: ___________________", small))
    story.append(Spacer(1, 2 * mm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.black))
    story.append(Paragraph("Thank you for your order!", center_small))
    story.append(Paragraph(COMPANY["website"], center_small))

    doc.build(story)
    buf.seek(0)

    filename = f"Navaal_Receipt_{order.order_number}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


 
# ─── List All Invoices ────────────────────────────────────────────────────────


# ─── List All Invoices ────────────────────────────────────────────────────────

@router.get("/")
def list_invoices(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_user_via_token_or_header),
):
    """List all orders with invoice download links."""
    orders = db.query(models.Order).order_by(models.Order.id.desc()).limit(200).all()
    result = []
    for o in orders:
        total_time = _duration_str(o.created_at, o.delivered_at)
        result.append({
            "id": o.id,
            "order_number": o.order_number,
            "customer_name": o.customer_name,
            "customer_phone": o.customer_phone,
            "city": o.city,
            "status": o.status,
            "payment_status": o.payment_status,
            "total_amount": o.total_amount,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "delivered_at": o.delivered_at.isoformat() if o.delivered_at else None,
            "total_fulfillment_time": total_time,
            "assigned_rider_name": o.assigned_rider_name,
        })
    return result

"""
Customer Ledger Router
Tracks every debit (order placed) and credit (payment received / adjustment)
per customer phone number.  Works for B2C retail customers and B2B mart accounts.

Endpoints:
  GET  /api/ledger/{customer_phone}          - Full transaction list + running balance
  POST /api/ledger/entries                   - Manual adjustment (discount, opening balance, correction)
  GET  /api/ledger/{customer_phone}/pdf      - Printable A4 ledger statement (ReportLab)
"""
import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import func
from jose import jwt

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
)
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT

from database import get_db
import models
import schemas
from auth import get_current_user, SECRET_KEY, ALGORITHM

router = APIRouter(prefix="/api/ledger", tags=["ledger"])

# ── shared brand palette (mirrors invoices.py) ────────────────────────────────
BRAND_GREEN = colors.HexColor("#16a34a")
LIGHT_GREEN = colors.HexColor("#f0fdf4")
GRAY_TEXT   = colors.HexColor("#6b7280")
DARK_TEXT   = colors.HexColor("#111827")
RED_COLOR   = colors.HexColor("#dc2626")

COMPANY = {
    "name":    "Navaal Foods",
    "tagline": "Pure. Natural. Organic.",
    "address": "Karima view, Jamshed Quarters, Near Banori Town Masjid, Karachi, Sindh 75300, Pakistan",
    "phone":   "+92 322 2416033",
    "email":   "info@navaalfoods.com",
    "website": "www.navaalfoods.com",
}


# ── allow token via ?token=... for browser window.open() PDF downloads ─────────
def _get_user_via_token_or_header(
    token_param:  Optional[str]                             = Query(None, alias="token"),
    credentials:  Optional[HTTPAuthorizationCredentials]    = Depends(HTTPBearer(auto_error=False)),
    db:           Session                                   = Depends(get_db),
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
    user = db.query(models.User).filter(
        models.User.id == user_id, models.User.is_active == True
    ).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ── internal helper — post a single ledger row (called from orders.py) ─────────
def post_ledger_entry(
    db:           Session,
    phone:        str,
    channel:      str,
    entry_type:   str,   # "debit" | "credit"
    amount:       float,
    description:  str,
    order_id:     Optional[int] = None,
    created_by:   str = "system",
) -> models.LedgerEntry:
    """
    Internal helper — creates and flushes a LedgerEntry row.
    Call db.commit() in the caller after using this.
    """
    entry = models.LedgerEntry(
        customer_phone=phone,
        channel=channel,
        entry_type=entry_type,
        amount=abs(amount),
        related_order_id=order_id,
        description=description,
        created_by=created_by,
    )
    db.add(entry)
    return entry


# ─── GET /api/ledger/{customer_phone} ────────────────────────────────────────

@router.get("/{customer_phone}", response_model=schemas.LedgerStatement)
def get_ledger(
    customer_phone: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Return the full transaction history for a customer/mart plus the running balance.
    Balance > 0  means the customer still owes money.
    Balance < 0  means we owe the customer (overpaid / credit note).
    """
    entries = (
        db.query(models.LedgerEntry)
        .filter(models.LedgerEntry.customer_phone == customer_phone)
        .order_by(models.LedgerEntry.created_at.asc())
        .all()
    )

    total_debit  = sum(e.amount for e in entries if e.entry_type == "debit")
    total_credit = sum(e.amount for e in entries if e.entry_type == "credit")
    balance      = round(total_debit - total_credit, 2)

    # Derive channel from the most recent entry (or default b2c)
    channel = entries[-1].channel if entries else "b2c"

    return schemas.LedgerStatement(
        customer_phone=customer_phone,
        channel=channel,
        total_debit=round(total_debit, 2),
        total_credit=round(total_credit, 2),
        balance=balance,
        entries=[schemas.LedgerEntryOut.model_validate(e) for e in entries],
    )


# ─── POST /api/ledger/entries ─────────────────────────────────────────────────

@router.post("/entries", response_model=schemas.LedgerEntryOut)
def create_manual_entry(
    data: schemas.LedgerEntryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Manual ledger adjustment — use for:
      • Opening balances when onboarding an existing mart
      • Discounts / credit notes
      • Corrections
    Role: admin or manager only.
    """
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only admin/manager can post manual ledger entries")

    if data.entry_type not in ("debit", "credit"):
        raise HTTPException(status_code=400, detail="entry_type must be 'debit' or 'credit'")
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be positive")
    if data.channel not in ("b2c", "b2b"):
        raise HTTPException(status_code=400, detail="channel must be 'b2c' or 'b2b'")

    entry = post_ledger_entry(
        db=db,
        phone=data.customer_phone,
        channel=data.channel,
        entry_type=data.entry_type,
        amount=data.amount,
        description=data.description or "Manual adjustment",
        order_id=data.related_order_id,
        created_by=current_user.name,
    )
    db.commit()
    db.refresh(entry)
    return entry


# ─── GET /api/ledger/{customer_phone}/pdf ────────────────────────────────────

@router.get("/{customer_phone}/pdf")
def download_ledger_pdf(
    customer_phone: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_get_user_via_token_or_header),
):
    """
    Generate and stream a printable A4 ledger statement for the customer / mart.
    Shows date / description / debit / credit / running balance columns,
    with Navaal Foods letterhead consistent with the invoice style.
    """
    entries = (
        db.query(models.LedgerEntry)
        .filter(models.LedgerEntry.customer_phone == customer_phone)
        .order_by(models.LedgerEntry.created_at.asc())
        .all()
    )

    total_debit  = sum(e.amount for e in entries if e.entry_type == "debit")
    total_credit = sum(e.amount for e in entries if e.entry_type == "credit")
    balance      = round(total_debit - total_credit, 2)
    channel      = entries[-1].channel if entries else "b2c"

    # Try to find the customer name
    customer_name = customer_phone
    customer = db.query(models.Customer).filter(
        models.Customer.phone == customer_phone
    ).first()
    if customer:
        customer_name = customer.name

    now = datetime.utcnow()

    # ── Build PDF ─────────────────────────────────────────────────────────────
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=1.5 * cm,
        leftMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )
    story = []

    s_center = ParagraphStyle("c",  alignment=TA_CENTER)
    s_right  = ParagraphStyle("r",  alignment=TA_RIGHT,  fontSize=9)
    s_small  = ParagraphStyle("sm", fontSize=9,  leading=13)
    s_bold   = ParagraphStyle("bd", fontSize=10, fontName="Helvetica-Bold")

    # ── Letterhead ────────────────────────────────────────────────────────────
    header_data = [[
        Paragraph(
            f"<font size=20 color='#16a34a'><b>{COMPANY['name']}</b></font><br/>"
            f"<font size=9 color='#6b7280'>{COMPANY['tagline']}</font>",
            s_small,
        ),
        Paragraph(
            f"<font size=18 color='#16a34a'><b>ACCOUNT STATEMENT</b></font><br/>"
            f"<font size=9 color='#6b7280'>Channel: {channel.upper()}</font>",
            s_right,
        ),
    ]]
    ht = Table(header_data, colWidths=[9 * cm, 9 * cm])
    ht.setStyle(TableStyle([
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(ht)
    story.append(HRFlowable(width="100%", thickness=2, color=BRAND_GREEN))
    story.append(Spacer(1, 0.4 * cm))

    # ── Customer / Period Info ─────────────────────────────────────────────────
    info_data = [[
        Paragraph(
            f"<b>Account:</b> {customer_name}<br/>"
            f"<b>Phone:</b>   {customer_phone}<br/>"
            f"<b>Channel:</b> {channel.upper()}",
            s_small,
        ),
        Paragraph(
            f"<b>Statement Date:</b> {now.strftime('%d %b %Y')}<br/>"
            f"<b>Total Transactions:</b> {len(entries)}",
            ParagraphStyle("info_r", fontSize=9, leading=14, alignment=TA_RIGHT),
        ),
    ]]
    it = Table(info_data, colWidths=[9 * cm, 9 * cm])
    it.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), LIGHT_GREEN),
        ("BOX",           (0, 0), (-1, -1), 0.5, colors.HexColor("#bbf7d0")),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
    ]))
    story.append(it)
    story.append(Spacer(1, 0.5 * cm))

    # ── Transactions Table ─────────────────────────────────────────────────────
    story.append(Paragraph("<b>Transaction History</b>",
                           ParagraphStyle("h2", fontSize=11, textColor=BRAND_GREEN, spaceAfter=4)))

    col_w = [2.8 * cm, 6.5 * cm, 2.5 * cm, 2.5 * cm, 3.2 * cm]
    tbl_data = [["Date", "Description", "Debit (PKR)", "Credit (PKR)", "Balance (PKR)"]]

    running = 0.0
    for e in entries:
        if e.entry_type == "debit":
            running += e.amount
            debit_str  = f"{e.amount:,.0f}"
            credit_str = ""
        else:
            running -= e.amount
            debit_str  = ""
            credit_str = f"{e.amount:,.0f}"

        tbl_data.append([
            e.created_at.strftime("%d %b %Y") if e.created_at else "—",
            e.description or "—",
            debit_str,
            credit_str,
            f"{running:,.0f}",
        ])

    tx_table = Table(tbl_data, colWidths=col_w, repeatRows=1)
    tx_style = [
        # Header row
        ("BACKGROUND",    (0, 0), (-1, 0), BRAND_GREEN),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        # Body
        ("FONTSIZE",      (0, 0), (-1, -1), 8),
        ("GRID",          (0, 0), (-1, -1), 0.25, colors.HexColor("#d1fae5")),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, LIGHT_GREEN]),
        ("ALIGN",         (2, 0), (-1, -1), "RIGHT"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
    ]
    # Colour debit column red and credit column green in body rows
    for row_idx in range(1, len(tbl_data)):
        e = entries[row_idx - 1]
        if e.entry_type == "debit":
            tx_style.append(("TEXTCOLOR", (2, row_idx), (2, row_idx), RED_COLOR))
        else:
            tx_style.append(("TEXTCOLOR", (3, row_idx), (3, row_idx), BRAND_GREEN))
        # Balance red if positive (owes), green if zero/negative
        bal_color = RED_COLOR if running > 0 else BRAND_GREEN
        tx_style.append(("TEXTCOLOR", (4, row_idx), (4, row_idx), bal_color))

    tx_table.setStyle(TableStyle(tx_style))
    story.append(tx_table)
    story.append(Spacer(1, 0.5 * cm))

    # ── Summary Box ───────────────────────────────────────────────────────────
    bal_color_hex = "#dc2626" if balance > 0 else "#16a34a"
    bal_label     = "BALANCE DUE (Customer owes)" if balance > 0 else "CREDIT BALANCE (Overpaid)"
    summary_data = [
        ["Total Debits:",  f"PKR {total_debit:,.0f}"],
        ["Total Credits:", f"PKR {total_credit:,.0f}"],
        [f"{bal_label}:", f"PKR {abs(balance):,.0f}"],
    ]
    sum_table = Table(summary_data, colWidths=[8 * cm, 4 * cm], hAlign="RIGHT")
    sum_table.setStyle(TableStyle([
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("FONTNAME",      (0, 2), (-1, 2), "Helvetica-Bold"),
        ("BACKGROUND",    (0, 2), (-1, 2), colors.HexColor(bal_color_hex)),
        ("TEXTCOLOR",     (0, 2), (-1, 2), colors.white),
        ("ALIGN",         (1, 0), (-1, -1), "RIGHT"),
        ("GRID",          (0, 0), (-1, -1), 0.25, colors.HexColor("#d1fae5")),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
    ]))
    story.append(sum_table)
    story.append(Spacer(1, 1 * cm))

    # ── Footer ─────────────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#d1fae5")))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(
        f"<font size=7 color='#9ca3af'>{COMPANY['name']} | {COMPANY['address']} | "
        f"{COMPANY['phone']} | {COMPANY['website']}</font>",
        ParagraphStyle("footer", fontSize=7, alignment=TA_CENTER),
    ))

    doc.build(story)
    buf.seek(0)

    safe_phone = customer_phone.replace("+", "").replace(" ", "")
    filename   = f"Navaal_Ledger_{safe_phone}_{now.strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

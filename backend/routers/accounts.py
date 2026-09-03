"""
Professional Accounts Router
Manages B2B & B2C customer profiles, credit limits, standalone account invoices, 
payment recordings with details (cash/cheque/bank transfer/online), and ledger entries.
"""
from datetime import datetime
import io
import json
from typing import List, Optional
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

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

# ── Shared Brand Palette ──────────────────────────────────────────────────────
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

# ── Helper for Token Auth in window.open() ────────────────────────────────────
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


# ─── accounts summary ─────────────────────────────────────────────────────────
@router.get("/summary")
def get_accounts_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Get summary of receivables, active accounts, B2B vs B2C balances, and credit status.
    """
    # Active accounts count
    total_accounts = db.query(models.Customer).count()
    b2b_count = db.query(models.Customer).filter(models.Customer.account_type == "b2b").count()
    b2c_count = db.query(models.Customer).filter(models.Customer.account_type == "b2c").count()

    # Calculate net outstanding receivables (Debits - Credits)
    debits_sum = db.query(func.sum(models.LedgerEntry.amount)).filter(models.LedgerEntry.entry_type == "debit").scalar() or 0.0
    credits_sum = db.query(func.sum(models.LedgerEntry.amount)).filter(models.LedgerEntry.entry_type == "credit").scalar() or 0.0
    total_receivable = round(debits_sum - credits_sum, 2)

    # B2B vs B2C receivables
    # We can aggregate by joining with Customer
    b2b_receivable = round(
        (db.query(func.sum(models.LedgerEntry.amount))
         .join(models.Customer, models.Customer.phone == models.LedgerEntry.customer_phone)
         .filter(models.Customer.account_type == "b2b", models.LedgerEntry.entry_type == "debit").scalar() or 0.0) -
        (db.query(func.sum(models.LedgerEntry.amount))
         .join(models.Customer, models.Customer.phone == models.LedgerEntry.customer_phone)
         .filter(models.Customer.account_type == "b2b", models.LedgerEntry.entry_type == "credit").scalar() or 0.0),
        2
    )

    b2c_receivable = round(total_receivable - b2b_receivable, 2)

    # Overdue invoices
    overdue_invoices_count = db.query(models.AccountInvoice).filter(
        models.AccountInvoice.status.in_(["draft", "sent", "partial"]),
        models.AccountInvoice.due_date < datetime.utcnow()
    ).count()

    return {
        "total_accounts": total_accounts,
        "b2b_count": b2b_count,
        "b2c_count": b2c_count,
        "total_receivable": total_receivable,
        "b2b_receivable": b2b_receivable,
        "b2c_receivable": b2c_receivable,
        "overdue_invoices_count": overdue_invoices_count
    }


# ─── Accounts CRUD ────────────────────────────────────────────────────────────

@router.get("", response_model=List[schemas.CustomerOut])
def list_accounts(
    q: Optional[str] = Query(None, description="Search by name, phone, company, city"),
    account_type: Optional[str] = Query(None, description="b2b or b2c"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.Customer)
    if account_type:
        query = query.filter(models.Customer.account_type == account_type)
    if q:
        pattern = f"%{q}%"
        query = query.filter(
            (models.Customer.name.ilike(pattern)) |
            (models.Customer.phone.ilike(pattern)) |
            (models.Customer.company_name.ilike(pattern)) |
            (models.Customer.city.ilike(pattern))
        )
    return query.order_by(models.Customer.name.asc()).all()


@router.post("", response_model=schemas.CustomerOut)
def create_account(
    data: schemas.CustomerCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # Verify unique phone if provided
    if data.phone:
        existing = db.query(models.Customer).filter(models.Customer.phone == data.phone).first()
        if existing:
            raise HTTPException(status_code=400, detail="Account with this phone number already exists")

    # Set channel to b2b or b2c based on account_type
    account = models.Customer(**data.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)

    # Post opening balance if positive
    if data.opening_balance and data.opening_balance > 0:
        entry = models.LedgerEntry(
            customer_phone=account.phone or f"ACC-{account.id}",
            channel=data.account_type or "b2c",
            entry_type="debit",
            amount=data.opening_balance,
            description="Opening balance",
            created_by=current_user.name
        )
        db.add(entry)
        db.commit()

    return account


@router.put("/{customer_id}", response_model=schemas.CustomerOut)
def update_account(
    customer_id: int,
    data: schemas.CustomerCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    account = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Check phone uniqueness if phone is changing
    if data.phone and data.phone != account.phone:
        existing = db.query(models.Customer).filter(models.Customer.phone == data.phone).first()
        if existing:
            raise HTTPException(status_code=400, detail="Another account with this phone number exists")

    # If opening balance changed, we might want to update the opening balance ledger entry
    if data.opening_balance != account.opening_balance:
        # Find opening balance entry
        ob_entry = db.query(models.LedgerEntry).filter(
            models.LedgerEntry.customer_phone == account.phone,
            models.LedgerEntry.description == "Opening balance"
        ).first()
        if ob_entry:
            if data.opening_balance > 0:
                ob_entry.amount = data.opening_balance
            else:
                db.delete(ob_entry)
        elif data.opening_balance > 0:
            entry = models.LedgerEntry(
                customer_phone=data.phone or account.phone,
                channel=data.account_type or account.account_type,
                entry_type="debit",
                amount=data.opening_balance,
                description="Opening balance",
                created_by=current_user.name
            )
            db.add(entry)

    # Update fields
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(account, field, value)

    db.commit()
    db.refresh(account)
    return account


@router.delete("/{customer_id}")
def delete_account(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only admins/managers can delete accounts")
    account = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Delete related ledger entries matching customer_phone
    if account.phone:
        db.query(models.LedgerEntry).filter(models.LedgerEntry.customer_phone == account.phone).delete()

    db.delete(account)
    db.commit()
    return {"message": "Account and all associated ledger entries deleted successfully"}


# ─── General Payments & Ledger Posting ────────────────────────────────────────

@router.post("/payments", response_model=schemas.LedgerEntryOut)
def post_account_payment(
    data: schemas.LedgerEntryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Record a customer payment (credit) or charge (debit) with support for 
    payment details like payment_method, reference_no, and notes.
    """
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only admin/manager can post ledger entries")

    if data.entry_type not in ("debit", "credit"):
        raise HTTPException(status_code=400, detail="entry_type must be 'debit' or 'credit'")
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be positive")

    # Verify customer exists
    customer = db.query(models.Customer).filter(models.Customer.phone == data.customer_phone).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer/Account not found")

    entry = models.LedgerEntry(
        customer_phone=data.customer_phone,
        channel=customer.account_type or "b2c",
        entry_type=data.entry_type,
        amount=data.amount,
        related_order_id=data.related_order_id,
        account_invoice_id=data.account_invoice_id,
        description=data.description or ("Payment Received" if data.entry_type == "credit" else "Invoice Debit"),
        payment_method=data.payment_method,
        reference_no=data.reference_no,
        notes=data.notes,
        created_by=current_user.name,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    # If linked to an account invoice, let's update that invoice's paid/due amounts
    if data.account_invoice_id and data.entry_type == "credit":
        invoice = db.query(models.AccountInvoice).filter(models.AccountInvoice.id == data.account_invoice_id).first()
        if invoice:
            invoice.amount_paid = round(invoice.amount_paid + data.amount, 2)
            invoice.amount_due = round(max(0.0, invoice.total_amount - invoice.amount_paid), 2)
            if invoice.amount_due == 0:
                invoice.status = "paid"
            elif invoice.amount_paid > 0:
                invoice.status = "partial"
            db.commit()

    return entry


# ─── Account Invoices Endpoints ───────────────────────────────────────────────

@router.get("/invoices", response_model=List[schemas.AccountInvoiceOut])
def list_account_invoices(
    customer_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.AccountInvoice)
    if customer_id:
        query = query.filter(models.AccountInvoice.customer_id == customer_id)
    if status:
        query = query.filter(models.AccountInvoice.status == status)
    return query.order_by(models.AccountInvoice.id.desc()).all()


@router.post("/invoices", response_model=schemas.AccountInvoiceOut)
def create_account_invoice(
    data: schemas.AccountInvoiceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    customer = db.query(models.Customer).filter(models.Customer.id == data.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer/Account not found")

    # Generate professional invoice number
    now = datetime.utcnow()
    invoice_count = db.query(models.AccountInvoice).filter(
        models.AccountInvoice.created_at >= datetime(now.year, now.month, now.day)
    ).count()
    invoice_number = f"INV-{now.strftime('%Y%m%d')}-{invoice_count + 1:03d}"

    # Calculate amounts
    subtotal = sum(item.qty * item.unit_price for item in data.line_items)
    total_amount = round(subtotal + data.tax_amount - data.discount_amount, 2)

    # Convert line items to JSON
    line_items_list = [item.model_dump() for item in data.line_items]
    line_items_json = json.dumps(line_items_list)

    invoice = models.AccountInvoice(
        invoice_number=invoice_number,
        customer_id=data.customer_id,
        customer_phone=customer.phone,
        invoice_type=data.invoice_type,
        status="sent",  # starts in sent status
        due_date=data.due_date,
        subtotal=subtotal,
        tax_amount=data.tax_amount,
        discount_amount=data.discount_amount,
        total_amount=total_amount,
        amount_paid=0.0,
        amount_due=total_amount,
        line_items_json=line_items_json,
        notes=data.notes,
        payment_terms=data.payment_terms,
        created_by=current_user.name
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    # Post a DEBIT entry to the customer's ledger
    debit_entry = models.LedgerEntry(
        customer_phone=customer.phone or f"ACC-{customer.id}",
        channel=customer.account_type or "b2c",
        entry_type="debit",
        amount=total_amount,
        account_invoice_id=invoice.id,
        description=f"Invoice {invoice_number} created",
        created_by=current_user.name
    )
    db.add(debit_entry)
    db.commit()

    return invoice


@router.post("/invoices/{invoice_id}/pay", response_model=schemas.AccountInvoiceOut)
def pay_account_invoice(
    invoice_id: int,
    amount: float = Query(..., gt=0),
    payment_method: str = Query(..., description="cash | bank_transfer | cheque | online | other"),
    reference_no: Optional[str] = Query(None),
    notes: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    invoice = db.query(models.AccountInvoice).filter(models.AccountInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if invoice.status == "paid":
        raise HTTPException(status_code=400, detail="Invoice is already fully paid")

    customer = db.query(models.Customer).filter(models.Customer.id == invoice.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer/Account not found")

    # Record payment entry
    credit_entry = models.LedgerEntry(
        customer_phone=customer.phone or f"ACC-{customer.id}",
        channel=customer.account_type or "b2c",
        entry_type="credit",
        amount=amount,
        account_invoice_id=invoice.id,
        description=f"Payment for invoice {invoice.invoice_number}",
        payment_method=payment_method,
        reference_no=reference_no,
        notes=notes,
        created_by=current_user.name
    )
    db.add(credit_entry)

    # Update invoice paid/due amounts
    invoice.amount_paid = round(invoice.amount_paid + amount, 2)
    invoice.amount_due = round(max(0.0, invoice.total_amount - invoice.amount_paid), 2)
    if invoice.amount_due == 0:
        invoice.status = "paid"
    else:
        invoice.status = "partial"

    db.commit()
    db.refresh(invoice)
    return invoice


# ─── ReportLab Standalone Invoice PDF ──────────────────────────────────────────

@router.get("/invoices/{invoice_id}/pdf")
def download_account_invoice_pdf(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_get_user_via_token_or_header),
):
    """
    Generate and stream a printable A4 accounts invoice PDF.
    Similar layout to navaal-foods brand styling.
    """
    invoice = db.query(models.AccountInvoice).filter(models.AccountInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    customer = db.query(models.Customer).filter(models.Customer.id == invoice.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    line_items = []
    if invoice.line_items_json:
        try:
            line_items = json.loads(invoice.line_items_json)
        except Exception:
            pass

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

    s_right  = ParagraphStyle("r",  alignment=TA_RIGHT,  fontSize=9)
    s_small  = ParagraphStyle("sm", fontSize=9,  leading=13)
    s_bold   = ParagraphStyle("bd", fontSize=10, fontName="Helvetica-Bold")
    s_title  = ParagraphStyle("t", fontSize=24, leading=26, textColor=BRAND_GREEN, fontName="Helvetica-Bold")

    # ── Letterhead ────────────────────────────────────────────────────────────
    header_data = [[
        Paragraph(
            f"<font size=20 color='#16a34a'><b>{COMPANY['name']}</b></font><br/>"
            f"<font size=9 color='#6b7280'>{COMPANY['tagline']}</font>",
            s_small,
        ),
        Paragraph(
            f"<font size=24 color='#16a34a'><b>ACCOUNTS INVOICE</b></font><br/>"
            f"<font size=10 color='#6b7280'><b>No:</b> {invoice.invoice_number}</font>",
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

    # ── Account details block ─────────────────────────────────────────────────
    customer_info = (
        f"<b>Customer/Account:</b> {customer.name}<br/>"
        f"<b>Phone:</b> {customer.phone or '—'}<br/>"
        f"<b>Address:</b> {customer.delivery_address or '—'}<br/>"
        f"<b>City:</b> {customer.city or 'Karachi'}"
    )
    if customer.company_name:
        customer_info += f"<br/><b>Company:</b> {customer.company_name}"
    if customer.tax_id:
        customer_info += f"<br/><b>Tax/NTN ID:</b> {customer.tax_id}"

    due_date_str = invoice.due_date.strftime("%d %b %Y") if invoice.due_date else "Due on Receipt"
    invoice_info = (
        f"<b>Invoice Date:</b> {invoice.issue_date.strftime('%d %b %Y')}<br/>"
        f"<b>Due Date:</b> {due_date_str}<br/>"
        f"<b>Payment Terms:</b> {invoice.payment_terms.upper() if invoice.payment_terms else 'COD'}<br/>"
        f"<b>Invoice Type:</b> {invoice.invoice_type.upper()}<br/>"
        f"<b>Status:</b> <font color='{'#16a34a' if invoice.status == 'paid' else '#dc2626'}'><b>{invoice.status.upper()}</b></font>"
    )

    info_data = [[
        Paragraph(customer_info, s_small),
        Paragraph(invoice_info, ParagraphStyle("info_r", fontSize=9, leading=14, alignment=TA_RIGHT)),
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

    # ── Items Table ───────────────────────────────────────────────────────────
    story.append(Paragraph("<b>Billing Particulars</b>",
                           ParagraphStyle("h2", fontSize=11, textColor=BRAND_GREEN, spaceAfter=4)))

    col_w = [1.0 * cm, 8.5 * cm, 2.5 * cm, 2.5 * cm, 3.5 * cm]
    tbl_data = [["#", "Description", "Quantity", "Rate (PKR)", "Amount (PKR)"]]

    for idx, item in enumerate(line_items, 1):
        tbl_data.append([
            str(idx),
            item.get("description", "—"),
            f"{item.get('qty', 0):,g}",
            f"{item.get('unit_price', 0):,.2f}",
            f"{item.get('total', 0):,.2f}",
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
    tx_table.setStyle(TableStyle(tx_style))
    story.append(tx_table)
    story.append(Spacer(1, 0.5 * cm))

    # ── Summary Box ───────────────────────────────────────────────────────────
    summary_data = [
        ["Subtotal:", f"PKR {invoice.subtotal:,.2f}"],
        ["Tax Amount:", f"PKR {invoice.tax_amount:,.2f}"],
        ["Discount:", f"PKR {invoice.discount_amount:,.2f}"],
        ["TOTAL AMOUNT:", f"PKR {invoice.total_amount:,.2f}"],
        ["Amount Paid:", f"PKR {invoice.amount_paid:,.2f}"],
        ["Balance Due:", f"PKR {invoice.amount_due:,.2f}"],
    ]
    sum_table = Table(summary_data, colWidths=[12.5 * cm, 5.5 * cm])
    sum_table.setStyle(TableStyle([
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("FONTNAME",      (0, 3), (-1, 3), "Helvetica-Bold"),
        ("FONTNAME",      (0, 5), (-1, 5), "Helvetica-Bold"),
        ("BACKGROUND",    (0, 3), (-1, 3), colors.HexColor("#dcfce7")),
        ("BACKGROUND",    (0, 5), (-1, 5), colors.HexColor("#fee2e2") if invoice.amount_due > 0 else colors.HexColor("#dcfce7")),
        ("ALIGN",         (1, 0), (-1, -1), "RIGHT"),
        ("GRID",          (0, 0), (-1, -1), 0.25, colors.HexColor("#d1fae5")),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
    ]))
    story.append(sum_table)
    story.append(Spacer(1, 0.5 * cm))

    # ── Notes ─────────────────────────────────────────────────────────────────
    if invoice.notes:
        story.append(Paragraph(f"<b>Notes:</b> {invoice.notes}", ParagraphStyle("notes", fontSize=8, leading=12, textColor=GRAY_TEXT)))
        story.append(Spacer(1, 0.8 * cm))

    # ── Signatures ─────────────────────────────────────────────────────────────
    sig_data = [
        ["________________________", "________________________"],
        ["Prepared By", "Customer Acknowledgment"]
    ]
    sig_table = Table(sig_data, colWidths=[9 * cm, 9 * cm])
    sig_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTSIZE", (0, 1), (-1, 1), 9),
        ("TEXTCOLOR", (0, 1), (-1, 1), GRAY_TEXT),
    ]))
    story.append(sig_table)
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

    filename = f"Navaal_Invoice_{invoice.invoice_number}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

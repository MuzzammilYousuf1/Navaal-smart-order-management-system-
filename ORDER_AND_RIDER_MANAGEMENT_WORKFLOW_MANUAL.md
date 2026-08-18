# Navaal Organic Foods — Smart OrderFlow
## Professional Order & Rider Management System Manual

---

### Executive Overview
This document serves as the operational guide and system blueprint for the upgraded **Navaal Organic Foods Smart OrderFlow (SOF)**. The upgrades establish enterprise-grade order dispatching, automated stock reconciliation, rider-specific cash & gate pass management, thermal receipt compatibility, and an integrated team communication workspace.

---

### 1. Key Automated Workflows

#### A. Fast Packaging RTS ("Auto RTS All")
- **Purpose**: Rapidly transition freshly packed customer orders from `Pending` status to `Ready to Ship (RTS)`.
- **Trigger**: Click **"Auto RTS All"** on the Orders dashboard or trigger `POST /api/orders/bulk-rts`.
- **Automated Actions**:
  1. All pending orders are stamped with `rts_at` timestamps.
  2. The 45-minute SLA timer countdown initiates for pickup.
  3. Real-time WebSocket notifications alert warehouse managers.

#### B. Rider Gate Pass Generation & "Out For Delivery" Dispatch
- **Purpose**: Group orders per assigned rider, verify Cash on Delivery (COD) amounts, and issue official gate pass clearance slips.
- **Trigger**: Open **"Rider Gate Pass"** modal on Orders or Invoices page, select rider & orders, and click **"Generate Gate Pass & Set Out For Delivery"**.
- **Automated Actions**:
  1. Generates unique Gate Pass ID (e.g., `GP-202608-153042`).
  2. Updates all selected orders to `Out For Delivery` status.
  3. Prepares automatic notification logs for rider updates (WhatsApp/SMS dispatch queue).
  4. Generates a print-ready A4/Thermal PDF Gate Pass specifying:
     - Driver Name & Vehicle Number
     - Delivery Addresses & Phone Numbers
     - Item Particulars & Quantities
     - **Expected COD Cash Bring-Back Amount**
     - Verification Signature Blocks (Warehouse Manager, Rider, Security Gate Exit).

#### C. Automated Inventory Stock Reconciliation (Restocking)
- **Order Creation**: Stock is automatically deducted from base product inventories when orders are placed.
- **Order Delivery**: Cash collected is credited to accounting and order marked `Delivered`.
- **Order Return / Cancellation**: If an order status moves from `Out for Delivery` or `Pending` to `Returned` or `Cancelled`, the system **automatically credits the stock back** into main inventory with full audit logs (`StockMovement` table).

---

### 2. Upgraded Customer Invoices & Thermal Printer Support

- **Official Header**:
  - **Company**: Navaal Foods
  - **Address**: Karima view, Jamshed Quarters, Near Banori Town Masjid, Karachi, Sindh 75300, Pakistan
  - **Contact**: +92 322 2416033 | info@navaalfoods.com
- **Customer & Driver Details**:
  - Customer / Company Name (e.g., FRESH BASKET)
  - Branch & Delivery Address
  - Driver Name & Assigned Vehicle Number
  - Invoice No, Date, NTN/STRN
- **Print Modes**:
  1. **Standard A4 PDF Invoice**: Complete formal document with QR Code verification and itemized total.
  2. **80mm Thermal Receipt**: Fast compact thermal receipt suitable for POS printers (e.g., Xprinter, Epson, POS-80).

---

### 3. Centralized Task Management & Team Workspace Chat

- **Dual-Tab Workspace (`/tasks`)**:
  1. **Task Management & Stock Audits**: Assign duties with due dates, attach custom response form fields, and collect spoilage/damage inventory count reports.
  2. **Team Workspace Chat**: Real-time internal messaging system allowing warehouse staff, managers, admins, and riders to communicate, tag order numbers, assign work, and receive automated system alerts.

---

### 4. Technical Endpoint Summary

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/orders/bulk-rts` | `POST` | Converts pending orders into `ready_to_ship` in bulk |
| `/api/orders/riders/summary` | `GET` | Summarizes rider order counts, delivery stages, & COD cash totals |
| `/api/orders/gate-pass/dispatch` | `POST` | Generates Gate Pass, sets orders to `out_for_delivery`, logs notifications |
| `/api/invoices/gate-pass/pdf` | `GET` | Generates official PDF Gate Pass with security verification blocks |
| `/api/chat/messages` | `GET / POST` | Retrieves & broadcasts team workspace chat messages |

---

### 5. Verification & Testing Checklist

- [x] Create test order with COD payment mode.
- [x] Perform **Auto RTS All** and confirm SLA pickup timer starts.
- [x] Open **Rider Gate Pass Modal**, select assigned rider, and click **Generate Gate Pass**.
- [x] Verify order status transitions to `out_for_delivery` and Gate Pass PDF opens.
- [x] Complete order delivery with outcome `returned` and verify inventory stock auto-replenishes.
- [x] Send a test message in **Team Workspace Chat** tab to verify WebSocket broadcast.

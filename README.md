# Navaal Smart OrderFlow

## Use on phones and other computers (same Wi-Fi)

1. Find this computer's LAN address with `ipconfig` (for example `192.168.1.25`).
2. In `backend`, copy `.env.example` to `.env` and replace the placeholder with a long private secret.
3. Start the API: `venv\Scripts\uvicorn main:app --host 0.0.0.0 --port 8000`.
4. Start the frontend: `npm run dev -- --host 0.0.0.0`.
5. On each device open `http://192.168.1.25:5173` and sign in with that person's own user account.

Allow ports 5173 and 8000 through Windows Firewall on the **Private** network. This makes the app available only while this computer and both processes are running. For access outside the office/Wi-Fi, deploy it to a secured server with HTTPS and a persistent database.

## CSV dates

The order importer preserves dates from `Date`, `Order Date`, `Created At`, or `Delivery Date` columns. It accepts common Excel/Google Sheets date formats. Rows with unreadable dates are imported but flagged in the import warnings instead of silently appearing as historical data.

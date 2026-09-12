import axios from "axios";

// In development a phone/tablet opens the frontend using this computer's LAN
// address, not `localhost`.  Using the current hostname keeps API requests on
// the same machine.  VITE_API_URL remains available for a hosted deployment.
const isDev = typeof window !== "undefined" && window.location.port === "5173";
const configuredApiUrl = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

// The production site is served by Caddy, which proxies /api and /ws to the
// backend on the same hostname. Never let a copied development value such as
// http://localhost:8000 escape into the live browser build.
const pointsToLocalMachine = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(configuredApiUrl);
const productionApiUrl = configuredApiUrl && !pointsToLocalMachine ? configuredApiUrl : "";

export const API_BASE = import.meta.env.VITE_API_URL
  ? (isDev ? configuredApiUrl : productionApiUrl)
  : (isDev ? `${window.location.protocol}//${window.location.hostname}:8000` : "");

const getWsUrl = () => {
  if (productionApiUrl || (isDev && configuredApiUrl)) {
    const wsApiUrl = isDev ? configuredApiUrl : productionApiUrl;
    const isHttps = wsApiUrl.startsWith("https:");
    const host = wsApiUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `${isHttps ? "wss:" : "ws:"}//${host}/ws`;
  }
  if (typeof window !== "undefined") {
    const isHttps = window.location.protocol === "https:";
    const proto = isHttps ? "wss:" : "ws:";
    if (isDev) {
      return `${proto}//${window.location.hostname}:8000/ws`;
    }
    return `${proto}//${window.location.host}/ws`;
  }
  return "wss://orders.navaalfoods.com/ws";
};

export const WS_URL = getWsUrl();

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("sof_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 globally (except for the login request itself)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isLoginReq = err.config?.url?.includes("/api/auth/login");
    if (err.response?.status === 401 && !isLoginReq) {
      localStorage.removeItem("sof_token");
      localStorage.removeItem("sof_user");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export default api;

/**
 * Safely extracts a human-readable error message from backend HTTP responses or errors.
 */
export function getErrorMessage(err, fallback = "An error occurred") {
  if (!err) return fallback;
  const detail = err.response?.data?.detail;
  if (!detail) {
    if (err.message && typeof err.message === "string") return err.message;
    return fallback;
  }
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d.msg ? `${d.loc ? d.loc.filter(x => x !== "body").join(".") + ": " : ""}${d.msg}` : JSON.stringify(d)))
      .join("; ");
  }
  if (typeof detail === "object") {
    return JSON.stringify(detail);
  }
  return String(detail);
}

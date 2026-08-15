import axios from "axios";

// In development a phone/tablet opens the frontend using this computer's LAN
// address, not `localhost`.  Using the current hostname keeps API requests on
// the same machine.  VITE_API_URL remains available for a hosted deployment.
const browserApiBase = `${window.location.protocol}//${window.location.hostname}:8000`;
export const API_BASE = (import.meta.env.VITE_API_URL || browserApiBase).replace(/\/$/, "");
const wsProtocol = API_BASE.startsWith("https:") ? "wss:" : "ws:";
export const WS_URL = `${wsProtocol}//${API_BASE.replace(/^https?:\/\//, "")}/ws`;

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

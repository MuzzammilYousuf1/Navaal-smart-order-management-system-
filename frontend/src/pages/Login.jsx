import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Leaf, Eye, EyeOff, Lock, User } from "lucide-react";
import api from "../api/client";
import useAuth from "../store/useAuth";

export default function Login() {
  const [form, setForm] = useState({ username: "", password: "" });
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const doLogin = async (username, password) => {
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/api/auth/login", { 
        username: username ? username.trim() : "", 
        password 
      });
      login(data.access_token, data.user);
      navigate("/");
    } catch (err) {
      if (!err.response) {
        setError(`Unable to reach backend server. Ensure backend is running with --host 0.0.0.0`);
      } else {
        setError(err.response?.data?.detail || "Login failed. Check credentials.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    doLogin(form.username, form.password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-brand-900/20 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-600 shadow-2xl shadow-brand-900/60 mb-4">
            <Leaf className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Smart OrderFlow</h1>
          <p className="text-brand-500 text-sm mt-1">Navaal-Organic-Foods</p>
        </div>

        {/* Card */}
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-6">Sign in to continue</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-600" />
                <input
                  className="input pl-10"
                  placeholder="Enter username"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  required
                />
              </div>
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-600" />
                <input
                  className="input pl-10 pr-10"
                  type={showPwd ? "text" : "password"}
                  placeholder="Enter password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-600 hover:text-brand-400"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3 text-base">
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}

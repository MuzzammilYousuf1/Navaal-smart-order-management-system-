import { useEffect, useState, useRef } from "react";
import { Send, User, MessageSquare, Tag, CheckCircle2, Clock, Bot, RefreshCw } from "lucide-react";
import api from "../api/client";
import useAuth from "../store/useAuth";

export default function WorkspaceChat({ selectedTaskId = null, selectedOrderId = null }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const chatEndRef = useRef(null);

  const fetchMessages = async () => {
    try {
      const params = {};
      if (selectedTaskId) params.task_id = selectedTaskId;
      if (selectedOrderId) params.order_id = selectedOrderId;
      const { data } = await api.get("/api/chat/messages", { params });
      setMessages(data);
    } catch (err) {
      console.error("Failed to load chat messages", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 4000); // Polling backup
    return () => clearInterval(interval);
  }, [selectedTaskId, selectedOrderId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    setSending(true);
    try {
      const { data } = await api.post("/api/chat/messages", {
        message: newMessage.trim(),
        task_id: selectedTaskId || null,
        order_id: selectedOrderId || null,
      });
      setMessages((prev) => [...prev, data]);
      setNewMessage("");
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card flex flex-col h-[520px] p-0 bg-surface-900 border-surface-700 overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="px-4 py-3 bg-surface-850 border-b border-surface-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-brand-600/20 text-brand-400 border border-brand-500/30 flex items-center justify-center">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              Team Operations Chat Workspace
            </h3>
            <p className="text-[10px] text-brand-500">
              Assign work, discuss order fulfillment, update rider status
            </p>
          </div>
        </div>
        <button onClick={fetchMessages} className="text-brand-500 hover:text-white p-1">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Message Feed */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-surface-900">
        {loading ? (
          <p className="text-xs text-brand-600 text-center py-12 animate-pulse">Loading workspace chat...</p>
        ) : messages.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <Bot className="w-8 h-8 text-brand-700 mx-auto" />
            <p className="text-xs font-semibold text-brand-400">No messages in workspace chat yet</p>
            <p className="text-[11px] text-brand-600">Post a note, assign a task, or update the team!</p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = user?.name === m.sender_name;
            const isSys = m.is_system_msg;
            return (
              <div
                key={m.id}
                className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
              >
                <div className="flex items-center gap-1.5 mb-1 text-[10px] text-brand-500">
                  <span className="font-bold text-brand-300">{m.sender_name}</span>
                  <span className="uppercase text-[9px] px-1.5 py-0.2 bg-surface-800 rounded text-brand-400 border border-surface-700">
                    {m.sender_role || "Staff"}
                  </span>
                  <span>• {new Date(m.created_at + "Z").toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs whitespace-pre-wrap leading-relaxed border ${
                    isMe
                      ? "bg-brand-600 text-white border-brand-500 shadow-md shadow-brand-950/40 rounded-tr-none"
                      : isSys
                      ? "bg-amber-950/40 text-amber-200 border-amber-800/40 rounded-tl-none font-mono"
                      : "bg-surface-800 text-brand-200 border-surface-700 rounded-tl-none"
                  }`}
                >
                  {m.message}
                </div>
              </div>
            );
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input bar */}
      <form onSubmit={handleSend} className="p-3 bg-surface-850 border-t border-surface-700 flex gap-2">
        <input
          type="text"
          placeholder="Write a message, tag rider, or assign work..."
          className="input flex-1 text-xs"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
        />
        <button
          type="submit"
          disabled={sending || !newMessage.trim()}
          className="btn-primary text-xs px-4 py-2 flex items-center gap-1 shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send</span>
        </button>
      </form>
    </div>
  );
}

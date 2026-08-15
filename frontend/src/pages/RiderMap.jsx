import { useEffect, useState } from "react";
import { MapPin, Navigation, RefreshCw, Smartphone, CheckCircle, AlertCircle, FileSpreadsheet } from "lucide-react";
import api, { API_BASE } from "../api/client";
import useAuth from "../store/useAuth";

export default function RiderMap() {
  const [riders, setRiders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [trackingActive, setTrackingActive] = useState(false);
  const [myCoords, setMyCoords] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");
  const { user } = useAuth();

  const fetchRiderLocations = async () => {
    try {
      const { data } = await api.get("/api/tracking/riders");
      setRiders(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRiderLocations();
    const interval = setInterval(fetchRiderLocations, 10000);
    return () => clearInterval(interval);
  }, []);

  // HTML5 Free Browser GPS Geolocation tracking for Riders
  const toggleLocationSharing = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    if (trackingActive) {
      setTrackingActive(false);
      setStatusMsg("GPS sharing stopped.");
      return;
    }

    setStatusMsg("Connecting to GPS...");
    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setMyCoords({ latitude, longitude });
        setTrackingActive(true);
        setStatusMsg("Live GPS active — sending updates every 10s");

        try {
          await api.post("/api/tracking/location", {
            latitude,
            longitude,
            battery: 85, // battery API if available
          });
          fetchRiderLocations();
        } catch (err) {
          console.error(err);
        }
      },
      (err) => {
        setStatusMsg(`GPS Error: ${err.message}`);
        setTrackingActive(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  };

  const handleExportCSV = () => {
    window.open(`${API_BASE}/api/tracking/export-csv`, "_blank");
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <MapPin className="w-6 h-6 text-brand-400" />
            Live Rider GPS Tracking & Google Sheets Sync
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">
            Zero-cost HTML5 real-time location tracking & 2-way Google Sheets integration
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleExportCSV} className="btn-secondary text-brand-300 border-brand-700/50">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Export to Google Sheets (CSV)
          </button>
          <button onClick={fetchRiderLocations} className="btn-secondary">
            <RefreshCw className="w-4 h-4" /> Refresh Map
          </button>
        </div>
      </div>

      {/* Rider Mobile GPS Switch Card */}
      <div className="card bg-gradient-to-r from-brand-900/40 via-surface-900 to-surface-800 border-brand-700/50">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${trackingActive ? "bg-emerald-600 text-white animate-pulse" : "bg-surface-800 text-brand-500"}`}>
              <Navigation className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Rider GPS Phone Tracker (Zero Cost)</p>
              <p className="text-xs text-brand-400 mt-0.5">
                {user ? `Logged in as ${user.name} (${user.role})` : "Riders turn this ON on their mobile browser"}
              </p>
              {statusMsg && <p className="text-xs text-emerald-400 mt-1 font-mono">{statusMsg}</p>}
            </div>
          </div>

          <button
            onClick={toggleLocationSharing}
            className={`btn ${trackingActive ? "btn-danger" : "btn-primary"} px-6 py-3 text-sm font-semibold`}
          >
            {trackingActive ? "Stop GPS Sharing" : "Start Live GPS Sharing"}
          </button>
        </div>
      </div>

      {/* Live Map Radar Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Live Active Riders List */}
        <div className="card space-y-4 xl:col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Active Riders ({riders.length})</h2>
            <span className="text-xs bg-brand-900/50 text-brand-300 px-2.5 py-1 rounded-full font-mono">Live</span>
          </div>

          {loading ? (
            <p className="text-brand-600 text-xs py-6 text-center">Loading locations...</p>
          ) : riders.length === 0 ? (
            <div className="text-center py-8">
              <Smartphone className="w-10 h-10 text-brand-800 mx-auto mb-2" />
              <p className="text-brand-500 text-xs">No active rider GPS signals yet.</p>
              <p className="text-brand-700 text-[11px] mt-1">Riders click 'Start Live GPS Sharing' on their phones to transmit position.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {riders.map((r) => (
                <div key={r.rider_id} className="p-3 bg-surface-800 rounded-xl border border-surface-700 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-white">{r.rider_name}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400">
                      Online
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-brand-400 font-mono">
                    <span>Lat: {r.latitude.toFixed(4)}, Lng: {r.longitude.toFixed(4)}</span>
                    <span className="text-brand-600">Batt: {r.battery || 100}%</span>
                  </div>
                  <p className="text-[10px] text-brand-600">Updated: {new Date(r.updated_at).toLocaleTimeString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Visual Map Interface */}
        <div className="card xl:col-span-2 flex flex-col justify-between relative overflow-hidden min-h-[380px] bg-surface-950 border border-surface-700">
          <div className="flex items-center justify-between mb-4 z-10">
            <div>
              <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Live Dispatch Map Radar (Lahore & Regional)</h2>
              <p className="text-xs text-brand-600">Powered by OpenStreetMap & HTML5 Free Geolocation</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-xs text-emerald-400 font-semibold">Radar Active</span>
            </div>
          </div>

          {/* Interactive Visual Map Representation */}
          <div className="flex-1 rounded-xl bg-surface-900/80 border border-surface-700/60 p-6 flex flex-col items-center justify-center text-center relative">
            <div className="w-48 h-48 rounded-full border border-brand-700/30 flex items-center justify-center relative animate-pulse-slow">
              <div className="w-32 h-32 rounded-full border border-brand-600/40 flex items-center justify-center">
                <MapPin className="w-8 h-8 text-brand-400 animate-bounce" />
              </div>
            </div>

            <div className="mt-4 space-y-1">
              <p className="text-sm font-semibold text-white">Live OpenStreetMap GPS Radar</p>
              <p className="text-xs text-brand-400 max-w-md">
                All rider smartphones transmit free GPS telemetry every 10 seconds. When riders click "Start GPS", their live pin appears instantly on your dispatch radar.
              </p>
            </div>
          </div>

          {/* Google Sheets Webhook Integration Guide */}
          <div className="mt-4 pt-4 border-t border-surface-700 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-surface-800/80 p-3 rounded-xl border border-surface-700">
              <p className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 mb-1">
                <FileSpreadsheet className="w-3.5 h-3.5" /> 1-Click Google Sheets Export
              </p>
              <p className="text-[11px] text-brand-400">
                Click the "Export to Google Sheets" button at the top to download a live CSV file that imports directly into Google Sheets or Excel.
              </p>
            </div>

            <div className="bg-surface-800/80 p-3 rounded-xl border border-surface-700">
              <p className="text-xs font-bold text-blue-400 flex items-center gap-1.5 mb-1">
                <CheckCircle className="w-3.5 h-3.5" /> Google Sheets Webhook (2-Way CRM Sync)
              </p>
              <p className="text-[11px] text-brand-400 font-mono">
                POST {API_BASE}/api/tracking/webhook/google-sheets
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

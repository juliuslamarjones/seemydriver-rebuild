import { useState, useEffect } from "react";

export default function FleetDashboard() {
  const [fleetUnits, setFleetUnits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchFleetData() {
      try {
        const res = await fetch('/api/fleet/status');
        const data = await res.json();
        setFleetUnits(data.units || []);
      } catch (err) {
        console.error('Failed to load fleet status:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchFleetData();
    const interval = setInterval(fetchFleetData, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 font-sans p-6">
      <header className="max-w-6xl mx-auto flex items-center justify-between pb-6 border-b border-neutral-800 mb-8">
        <div>
          <h1 className="text-2xl font-black text-amber-400 tracking-wider uppercase">Fleet Operations Hub</h1>
          <p className="text-xs text-neutral-400">Isolated Multi-Unit Telemetry & Tracking</p>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-xs font-semibold text-emerald-400">
          Status: Secure & Isolated
        </div>
      </header>

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-neutral-900 border border-neutral-800 rounded-3xl p-6 min-h-[400px] flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-white mb-4">Live Fleet Map</h2>
            <div className="w-full h-72 bg-neutral-950 rounded-2xl border border-neutral-800 flex items-center justify-center text-neutral-500 text-sm">
              Map Container (Isolated Fleet View)
            </div>
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 flex flex-col">
          <h2 className="text-lg font-bold text-white mb-4">Active Units</h2>
          {loading ? (
            <p className="text-xs text-neutral-500">Loading fleet telemetry...</p>
          ) : fleetUnits.length === 0 ? (
            <p className="text-xs text-neutral-500">No active fleet units reporting.</p>
          ) : (
            <ul className="space-y-3 overflow-y-auto max-h-[320px]">
              {fleetUnits.map((unit) => (
                <li key={unit.id} className="bg-neutral-950 border border-neutral-800 p-3 rounded-xl flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-200">{unit.name}</span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">{unit.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

import React, { useState, useEffect } from 'react';

// --- Components ---

const Badge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    idle: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    busy: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    error: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  };
  const baseClass = "px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider";
  return (
    <span className={`${baseClass} ${colors[status.toLowerCase()] || colors.idle}`}>
      {status}
    </span>
  );
};

const AgentCard = ({ name, role, status, triggerAction }: any) => {
  const isBusy = status.toLowerCase() === 'busy' || status.toLowerCase() === 'active';
  
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 p-5 transition-all hover:border-indigo-500/50 hover:bg-slate-800/40 backdrop-blur-xl">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      
      <div className="relative z-10 flex flex-col h-full justify-between">
        <div>
          <div className="flex items-start justify-between mb-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center border border-slate-700 shadow-inner text-lg font-bold text-indigo-400">
              {name[0]}
            </div>
            <Badge status={status} />
          </div>
          
          <h3 className="text-sm font-bold text-slate-100 mb-0.5">{name}</h3>
          <p className="text-[10px] text-slate-500 font-mono uppercase tracking-tight mb-4">{role}</p>
        </div>

        <button 
          onClick={triggerAction}
          disabled={isBusy}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-slate-800/80 py-2 text-[10px] font-bold text-slate-300 uppercase tracking-widest transition-all hover:bg-indigo-600 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed group-hover:shadow-lg border border-slate-700/50"
        >
          {isBusy ? (
             <span className="flex items-center gap-2">
               <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
               Processing
             </span>
          ) : (
            <>
              <span>Signal</span>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

const RadarCard = ({ item }: any) => (
  <div className="p-3 mb-3 rounded-lg border border-slate-800 bg-slate-900/80 hover:border-slate-700 transition-all group">
    <h4 className="text-xs font-bold text-slate-200 mb-1 group-hover:text-indigo-400 transition-colors">{item.title}</h4>
    <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">{item.description}</p>
    <div className="mt-2 pt-2 border-t border-slate-800/50 flex justify-between items-center text-[8px] text-slate-600 font-mono uppercase tracking-tighter">
      <span>ID: {item.id.slice(0,8)}</span>
      <span>{new Date(item.updated_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
    </div>
  </div>
);

const ThoughtItem = ({ thought }: any) => {
  const agent = thought.data?.agent || 'System';
  return (
    <div className="flex items-start gap-3 p-3 border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors group">
      <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)] flex-shrink-0" />
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">{agent}</span>
          <span className="text-[8px] text-slate-700 font-mono">{new Date(thought.created_at).toLocaleTimeString()}</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed font-medium">"{thought.thought}"</p>
      </div>
    </div>
  );
};

// --- Main Dashboard ---

export default function Dashboard() {
  const [radar, setRadar] = useState<any[]>([]);
  const [stream, setStream] = useState<any[]>([]);
  
  const fetchData = async () => {
    const OPS_API_KEY = 'ops-loop-secret-token';
    try {
      const [resRadar, resStream] = await Promise.all([
        fetch('/api/ops/radar', { headers: { 'Authorization': `Bearer ${OPS_API_KEY}` } }),
        fetch('/api/ops/stream', { headers: { 'Authorization': `Bearer ${OPS_API_KEY}` } })
      ]);
      
      const [dataRadar, dataStream] = await Promise.all([resRadar.json(), resStream.json()]);
      
      if (dataRadar.ok) setRadar(dataRadar.radar);
      if (dataStream.ok) setStream(dataStream.stream);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const triggerAction = async (agent: string) => {
    const OPS_API_KEY = 'ops-loop-secret-token';
    try {
      const res = await fetch('/api/ops/heartbeat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPS_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      if(res.ok) console.log(`Heartbeat triggered by ${agent}`);
    } catch(e) { console.error(e); }
  };

  const stages = ['watching', 'validating', 'building', 'shipped'];

  return (
    <div className="min-h-screen bg-[#08090D] text-slate-300 selection:bg-indigo-500/30 font-sans tracking-tight">
      {/* Visual background elements */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/5 blur-[120px]" />
        <div className="absolute bottom-[-5%] right-[-5%] w-[40%] h-[40%] rounded-full bg-violet-600/5 blur-[100px]" />
        <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] rounded-full bg-emerald-600/5 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-[1800px] mx-auto p-6 md:p-10">
        {/* Header */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 mb-12 border-b border-slate-800/50 pb-10">
          <div className="flex items-center gap-6">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-700 flex items-center justify-center shadow-2xl shadow-indigo-500/30 text-white text-3xl font-black italic tracking-tighter border border-white/10">
              V
            </div>
            <div>
              <h1 className="text-3xl font-black text-white tracking-tighter flex items-center gap-3">
                VOXYZ <span className="text-slate-600 font-thin text-2xl">/</span> <span className="text-slate-400 font-medium text-xl uppercase tracking-[0.3em]">Control Plane</span>
              </h1>
              <p className="text-[10px] text-slate-500 font-mono mt-1 uppercase tracking-widest">Autonomous Multi-Agent Neural Network • Production v2.4</p>
            </div>
          </div>
          
          <div className="flex items-center gap-8 bg-slate-900/40 border border-slate-800/80 rounded-2xl px-8 py-3 backdrop-blur-md shadow-inner">
            <div className="flex items-center gap-4 border-r border-slate-800/80 pr-8">
              <div className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
              </div>
              <span className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em]">Live Link Active</span>
            </div>
            <div className="flex gap-6 text-[9px] font-mono text-slate-500 uppercase tracking-widest">
              <div className="flex flex-col">
                <span className="text-slate-700 mb-0.5">Latency</span>
                <span className="text-slate-300">24ms</span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-700 mb-0.5">Uptime</span>
                <span className="text-slate-300">99.9%</span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-700 mb-0.5">Clock</span>
                <span className="text-slate-300 font-bold">{new Date().toLocaleTimeString([], {hour12: false})}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
          
          {/* Main Workspace (Left) */}
          <div className="xl:col-span-9 space-y-12">
            
            {/* 01. Demand Radar */}
            <section>
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-sm font-black text-white flex items-center gap-3 font-mono uppercase tracking-[0.2em]">
                  <span className="text-indigo-500">01.</span> Demand Radar
                </h2>
                <div className="h-px flex-1 bg-gradient-to-r from-slate-800/50 to-transparent mx-8" />
                <div className="px-3 py-1 rounded bg-slate-900 border border-slate-800 text-[8px] font-mono text-slate-500 uppercase tracking-widest">
                  Auto-Sorting Enabled
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {stages.map(stage => (
                  <div key={stage} className="bg-slate-900/20 rounded-2xl border border-slate-800/40 p-5 min-h-[300px] backdrop-blur-sm flex flex-col shadow-lg">
                    <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] mb-6 pb-3 border-b border-slate-800/50 flex justify-between items-center">
                      {stage}
                      <span className="bg-indigo-500/10 px-2 py-0.5 rounded text-indigo-400 font-mono text-[10px]">
                        {radar.filter(i => i.stage === stage).length}
                      </span>
                    </h3>
                    <div className="flex-1 overflow-y-auto pr-1 scrollbar-hide">
                      {radar.filter(i => i.stage === stage).map(item => (
                        <RadarCard key={item.id} item={item} />
                      ))}
                      {radar.filter(i => i.stage === stage).length === 0 && (
                        <div className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-slate-800/20 rounded-xl text-slate-800">
                           <svg className="h-6 w-6 mb-2 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                           <span className="text-[8px] uppercase tracking-widest font-black opacity-40">No Signal</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 02. Neural Network Grid */}
            <section>
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-sm font-black text-white flex items-center gap-3 font-mono uppercase tracking-[0.2em]">
                  <span className="text-indigo-500">02.</span> Neural Network
                </h2>
                <div className="h-px flex-1 bg-gradient-to-r from-slate-800/50 to-transparent mx-8" />
                <div className="flex gap-3 text-[9px] font-black tracking-widest uppercase">
                   <span className="text-emerald-500">● Nominal</span>
                   <span className="text-slate-700">|</span>
                   <span className="text-indigo-400">8 Agents Synced</span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                <AgentCard name="Conductor" role="Orchestrator" status="Active" triggerAction={() => triggerAction('Conductor')} />
                <AgentCard name="Architect" role="Systems Design" status="Idle" triggerAction={() => triggerAction('Architect')} />
                <AgentCard name="Scout" role="Discovery" status="Idle" triggerAction={() => triggerAction('Scout')} />
                <AgentCard name="Sage" role="Strategy" status="Idle" triggerAction={() => triggerAction('Sage')} />
                <AgentCard name="Quill" role="Content" status="Idle" triggerAction={() => triggerAction('Quill')} />
                <AgentCard name="Xalt" role="Social" status="Idle" triggerAction={() => triggerAction('Xalt')} />
                <AgentCard name="Minion" role="Builder" status="Busy" triggerAction={() => triggerAction('Minion')} />
                <AgentCard name="Observer" role="Supervisor" status="Active" triggerAction={() => triggerAction('Observer')} />
              </div>
            </section>
          </div>

          {/* Right Sidebar (Consciousness) */}
          <div className="xl:col-span-3">
            <div className="sticky top-10 rounded-3xl border border-slate-800 bg-slate-900/30 backdrop-blur-3xl flex flex-col h-[calc(100vh-10rem)] shadow-2xl overflow-hidden border-indigo-500/10">
              <div className="p-6 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between">
                <h2 className="text-[10px] font-black text-white uppercase tracking-[0.3em] flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse shadow-[0_0_10px_rgba(99,102,241,0.8)]" />
                  Consciousness
                </h2>
                <div className="px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[8px] font-mono text-indigo-400 uppercase">
                  Streaming
                </div>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-hide py-2">
                {stream.length > 0 ? (
                  stream.map((thought) => (
                    <ThoughtItem key={thought.id} thought={thought} />
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-slate-800 space-y-6 px-10 text-center">
                    <div className="h-12 w-12 rounded-full border-2 border-slate-900 border-t-indigo-500 animate-spin" />
                    <p className="text-[9px] uppercase tracking-[0.2em] font-black leading-loose">Synchronizing neural pathways... Waiting for thought emission.</p>
                  </div>
                )}
              </div>
              <div className="p-6 bg-slate-950/80 border-t border-slate-800/80">
                <div className="flex items-center gap-3 mb-3">
                   <div className="h-1 w-1 rounded-full bg-slate-600" />
                   <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden">
                      <div className="h-full w-2/3 bg-indigo-500/50" />
                   </div>
                </div>
                <p className="text-[8px] text-slate-600 font-mono leading-relaxed uppercase tracking-tighter">
                  Log buffer: 20/20 items • Encryption: AES-256 • Protocol: VoxYZ-ACP
                </p>
              </div>
            </div>
          </div>

        </div>

        <footer className="mt-20 pt-10 border-t border-slate-800/40 flex flex-col md:flex-row justify-between items-center gap-6 text-slate-700 text-[10px] font-mono tracking-[0.3em] uppercase font-black">
          <div className="flex items-center gap-4">
             <span className="text-slate-800">System v2.4.0</span>
             <span className="h-1 w-1 rounded-full bg-slate-800" />
             <span className="text-slate-500">Node: Local-Alpha</span>
          </div>
          <div className="text-indigo-500/30 select-none tracking-[1em]">VOID_VOID_VOID</div>
          <div>VoxYZ Intelligence • 2026</div>
        </footer>
      </div>
    </div>
  );
}

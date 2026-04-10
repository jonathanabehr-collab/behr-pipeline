import { useState, useMemo, useEffect } from "react";

const SUPABASE_URL      = "https://fkrkdkizdgrwvmmnlacz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrcmtka2l6ZGdyd3ZtbW5sYWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzgzNjIsImV4cCI6MjA4NzI1NDM2Mn0.FR0WgL8SykRSgOY2Azk8hg8M5VaCAtvpIr74Uan4FW8";

const sb = (() => {
  const h = () => ({ "Content-Type":"application/json", apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${SUPABASE_ANON_KEY}` });
  const base = `${SUPABASE_URL}/rest/v1`;
  async function req(method, path, body, extra={}) {
    const res = await fetch(`${base}${path}`, { method, headers:{...h(),...extra}, body:body!=null?JSON.stringify(body):undefined });
    if (!res.ok) throw new Error(await res.text());
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }
  return {
    select: (table, q="")    => req("GET",    `/${table}?${q}`),
    insert: (table, row)     => req("POST",   `/${table}`, row, { Prefer:"return=representation" }),
    update: (table, id, row) => req("PATCH",  `/${table}?id=eq.${id}`, row),
    delete: (table, id)      => req("DELETE", `/${table}?id=eq.${id}`),
    realtime(onEvent) {
      const wsUrl = `${SUPABASE_URL.replace(/^https/,"wss").replace(/^http/,"ws")}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
      let ws, hb;
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          ws.send(JSON.stringify({ topic:"realtime:public", event:"phx_join", payload:{ config:{ postgres_changes:[{ event:"*", schema:"public" }] } }, ref:"1" }));
          hb = setInterval(() => ws.readyState===1 && ws.send(JSON.stringify({ topic:"phoenix", event:"heartbeat", payload:{}, ref:"hb" })), 25000);
        };
        ws.onmessage = (e) => { try { const m=JSON.parse(e.data); if(m.event==="postgres_changes") onEvent(m.payload?.data||{}); } catch{} };
        ws.onerror = () => {};
      } catch{}
      return () => { clearInterval(hb); ws?.close(); };
    },
  };
})();

// ── Milestones ────────────────────────────────────────────────────────────────
// dueDays: days BEFORE expiration the milestone is due (positive = before, negative = after)
// lateDays: becomes "late" if not done by this many days before expiration
const MILESTONES = [
  { id:"acr_sent",         label:"ACR Sent",                dueDays:120, lateDays:120, color:"#6366f1" },
  { id:"acr_complete",     label:"ACR Complete",            dueDays:90,  lateDays:90,  color:"#8b5cf6" },
  { id:"loss_run_request", label:"Loss Run Request Sent",   dueDays:90,  lateDays:85,  color:"#f59e0b" },
  { id:"loss_runs_received",label:"Loss Runs Received",     dueDays:74,  lateDays:74,  color:"#f97316" },
  { id:"submitted_market", label:"Submitted to Market",     dueDays:60,  lateDays:60,  color:"#10b981" },
  { id:"proposal_complete",label:"Proposal Complete",       dueDays:30,  lateDays:30,  color:"#3b82f6" },
  { id:"policy_bound",     label:"Policy Bound",            dueDays:0,   lateDays:0,   color:"#ef4444" },
  { id:"post_bind",        label:"Post-Bind Complete",      dueDays:-60, lateDays:-60, color:"#a855f7" },
];

const AGENTS           = ["JB","GM","TS","JG","Gerald"];
const ACCOUNT_MANAGERS = ["Gabriella","Mawi"];
const POLICY_TYPES     = ["New","Renewal"];

function getDaysOut(d) { return Math.ceil((new Date(d) - new Date()) / 86400000); }

function getHealth(a) {
  const d = getDaysOut(a.expirationDate);
  for (const m of MILESTONES) {
    if (a.milestones[m.id]) continue; // completed — skip
    // dueDays positive = before expiration, negative = after
    const daysUntilDue = d - m.dueDays; // if positive, still have time; if negative, overdue
    const isLate = d <= m.lateDays; // days out is at or below the late threshold
    if (m.dueDays < 0) {
      // Post-bind: due 60 days AFTER expiration (d is negative when past expiration)
      if (d < m.dueDays) return "red"; // more than 60 days past expiration
    } else {
      if (isLate) return "red";
    }
  }
  // Check if any upcoming milestone is within 10 days of being late
  for (const m of MILESTONES) {
    if (a.milestones[m.id]) continue;
    if (m.dueDays >= 0 && d <= m.lateDays + 10 && d > m.lateDays) return "yellow";
  }
  return "green";
}

function getHealthReason(a) {
  const d = getDaysOut(a.expirationDate);
  for (const m of MILESTONES) {
    if (a.milestones[m.id]) continue;
    if (m.dueDays < 0) {
      if (d < m.dueDays) return `${m.label} overdue — ${Math.abs(d)} days since expiration`;
    } else {
      if (d <= m.lateDays) return `${m.label} overdue — due by ${m.dueDays} days out (${d}d remaining)`;
    }
  }
  return null;
}

function getCurrentStage(a) {
  // Returns the last completed milestone, or the next due one
  let lastDone = null;
  for (const m of MILESTONES) {
    if (a.milestones[m.id]) lastDone = m;
  }
  if (!lastDone) return MILESTONES[0];
  const idx = MILESTONES.indexOf(lastDone);
  return MILESTONES[Math.min(idx + 1, MILESTONES.length - 1)];
}

function getProgress(a) {
  const done = MILESTONES.filter(m => a.milestones[m.id]).length;
  return { completed: done, total: MILESTONES.length };
}

function dbToAccount(r) {
  return {
    id:             r.id,
    name:           r.name,
    policyNumber:   r.policy_number   || "",
    expirationDate: r.expiration_date || "",
    premium:        Number(r.premium) || 0,
    lob:            r.lob             || "",
    masterCompany:  r.master_company  || "",
    agent:          r.agent           || "",
    accountManager: r.account_manager || "",
    policyType:     r.policy_type     || "Renewal",
    notes:          r.notes           || "",
    milestones:     typeof r.tasks === "string" ? JSON.parse(r.tasks) : (r.tasks || {}),
    renewalHistory: typeof r.renewal_history === "string" ? JSON.parse(r.renewal_history) : (r.renewal_history || []),
  };
}

function accountToDb(a) {
  return {
    name:            a.name,
    policy_number:   a.policyNumber,
    expiration_date: a.expirationDate,
    premium:         Number(a.premium) || 0,
    lob:             a.lob,
    master_company:  a.masterCompany,
    agent:           a.agent,
    account_manager: a.accountManager,
    policy_type:     a.policyType,
    notes:           a.notes || "",
    tasks:           JSON.stringify(a.milestones || {}),
    carriers:        JSON.stringify([]),
    renewal_history: JSON.stringify(a.renewalHistory || []),
  };
}

function dbToArchived(r) {
  return {
    id:             r.id,
    name:           r.name,
    lob:            r.lob || "",
    masterCompany:  r.master_company  || "",
    accountManager: r.account_manager || "",
    agent:          r.agent           || "",
    renewalHistory: typeof r.renewal_history === "string" ? JSON.parse(r.renewal_history) : (r.renewal_history || []),
  };
}

const SC = { red:"#ef4444", yellow:"#f59e0b", green:"#10b981" };
const SL = { red:"Behind",  yellow:"At Risk",  green:"On Track" };

const S = {
  app:     { minHeight:"100vh", background:"#0a0e1a", color:"#e2e8f0", fontFamily:"'IBM Plex Mono','Courier New',monospace", fontSize:"13px" },
  header:  { background:"#0f1629", borderBottom:"1px solid #1e2d4a", padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", height:"56px" },
  logo:    { color:"#60a5fa", fontWeight:700, fontSize:"15px", letterSpacing:"0.05em" },
  logoSub: { color:"#475569", fontSize:"11px", marginLeft:"8px" },
  navBtn:  a => ({ background:a?"#1e3a5f":"transparent", color:a?"#60a5fa":"#64748b", border:"none", padding:"6px 14px", borderRadius:"4px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit" }),
  addBtn:  (bg="#1e40af",fg="#bfdbfe") => ({ background:bg, color:fg, border:"none", padding:"6px 14px", borderRadius:"4px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit", marginLeft:"6px" }),
  main:    { padding:"20px 24px" },
  statCard: c => ({ background:"#0f1629", border:`1px solid ${c}22`, borderTop:`2px solid ${c}`, padding:"14px 16px", borderRadius:"6px", cursor:"pointer" }),
  sLabel:  { color:"#64748b", fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"6px" },
  sVal:    c => ({ color:c, fontSize:"22px", fontWeight:700 }),
  sSub:    { color:"#475569", fontSize:"10px", marginTop:"2px" },
  filters: { display:"flex", gap:"10px", marginBottom:"16px", alignItems:"center", flexWrap:"wrap" },
  fSel:    { background:"#0f1629", color:"#94a3b8", border:"1px solid #1e2d4a", padding:"6px 10px", borderRadius:"4px", fontSize:"12px", fontFamily:"inherit", cursor:"pointer" },
  searchI: { background:"#0f1629", color:"#e2e8f0", border:"1px solid #1e2d4a", padding:"6px 12px", borderRadius:"4px", fontSize:"12px", fontFamily:"inherit", width:"200px" },
  table:   { width:"100%", borderCollapse:"collapse" },
  th:      { background:"#0a0e1a", color:"#475569", fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase", padding:"8px 12px", textAlign:"left", borderBottom:"1px solid #1e2d4a", whiteSpace:"nowrap" },
  td:      { padding:"10px 12px", verticalAlign:"middle" },
  dot:     h => ({ width:"8px", height:"8px", borderRadius:"50%", background:SC[h], display:"inline-block", marginRight:"6px", boxShadow:`0 0 6px ${SC[h]}` }),
  pBar:    { background:"#1e2d4a", borderRadius:"2px", height:"4px", width:"80px", overflow:"hidden" },
  pFill:   (p,h) => ({ width:`${Math.max(0,Math.min(1,p))*100}%`, height:"100%", background:SC[h], borderRadius:"2px" }),
  wItem:   h => ({ background:"#0f1629", border:`1px solid ${h==="red"?"#ef444433":"#1e2d4a"}`, borderLeft:`3px solid ${SC[h]}`, borderRadius:"4px", padding:"12px 16px", display:"flex", alignItems:"center", gap:"16px", cursor:"pointer" }),
  dHead:   { background:"#0f1629", borderBottom:"1px solid #1e2d4a", padding:"16px 24px", display:"flex", alignItems:"center", gap:"16px", flexWrap:"wrap" },
  backBtn: { background:"transparent", color:"#60a5fa", border:"1px solid #1e3a5f", padding:"5px 12px", borderRadius:"4px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit" },
  dBody:   { display:"grid", gridTemplateColumns:"320px 1fr", minHeight:"calc(100vh - 112px)" },
  sidebar: { background:"#080c18", borderRight:"1px solid #1e2d4a", padding:"20px" },
  sdSec:   { marginBottom:"20px" },
  sdLabel: { color:"#475569", fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"8px" },
  sdBig:   { color:"#e2e8f0", fontSize:"14px", fontWeight:600 },
  content: { padding:"20px 24px" },
  tabs:    { display:"flex", gap:"4px", marginBottom:"20px", borderBottom:"1px solid #1e2d4a" },
  tab:     a => ({ background:"transparent", color:a?"#60a5fa":"#475569", border:"none", borderBottom:`2px solid ${a?"#60a5fa":"transparent"}`, padding:"8px 16px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit", marginBottom:"-1px" }),
  dGrid:   { display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" },
  dField:  { background:"#080c18", border:"1px solid #1e2d4a", borderRadius:"4px", padding:"12px 14px" },
  fLbl:    { color:"#475569", fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"4px" },
  fVal:    { color:"#e2e8f0", fontSize:"13px" },
  textarea:{ background:"#080c18", color:"#e2e8f0", border:"1px solid #1e2d4a", borderRadius:"4px", padding:"12px", width:"100%", fontFamily:"inherit", fontSize:"12px", resize:"vertical", minHeight:"120px", boxSizing:"border-box" },
  mBg:     { position:"fixed", inset:0, background:"#000000aa", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 },
  mBox:    { background:"#0f1629", border:"1px solid #1e3a5f", borderRadius:"8px", padding:"24px", width:"500px", maxHeight:"80vh", overflowY:"auto" },
  mTitle:  { color:"#60a5fa", fontSize:"14px", fontWeight:600, marginBottom:"20px", letterSpacing:"0.03em" },
  mRow:    { marginBottom:"14px" },
  mLabel:  { color:"#64748b", fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"5px", display:"block" },
  mInput:  { background:"#080c18", color:"#e2e8f0", border:"1px solid #1e2d4a", borderRadius:"4px", padding:"7px 10px", width:"100%", fontFamily:"inherit", fontSize:"12px", boxSizing:"border-box" },
  mSel:    { background:"#080c18", color:"#e2e8f0", border:"1px solid #1e2d4a", borderRadius:"4px", padding:"7px 10px", width:"100%", fontFamily:"inherit", fontSize:"12px", boxSizing:"border-box" },
  mActs:   { display:"flex", gap:"10px", justifyContent:"flex-end", marginTop:"20px" },
  cancelBtn:{ background:"transparent", color:"#64748b", border:"1px solid #1e2d4a", padding:"7px 16px", borderRadius:"4px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit" },
  saveBtn: { background:"#1e40af", color:"#bfdbfe", border:"none", padding:"7px 16px", borderRadius:"4px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit" },
  smBtn:   (bg,c,bc) => ({ background:bg, color:c, border:`1px solid ${bc}`, borderRadius:"3px", padding:"3px 8px", fontSize:"10px", cursor:"pointer", fontFamily:"inherit" }),
};

const STAGE_MAP = { "annual review":"annual_review","submission prep":"submission_prep","marketing":"marketing","proposal":"proposal","binding":"binding","post-bind":"post_bind","post bind":"post_bind" };

export default function RenewalPipeline() {
  const [accounts, setAccounts] = useState([]);
  const [archived, setArchived] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [dbErr,    setDbErr]    = useState(null);
  const [syncing,  setSyncing]  = useState({});
  const [view,     setView]     = useState("dashboard");
  const [selId,    setSelId]    = useState(null);
  const [tab,      setTab]      = useState("milestones");
  const [fAM,      setFAM]      = useState("All");
  const [fAgent,   setFAgent]   = useState("All");
  const [fHealth,  setFHealth]  = useState("All");
  const [search,   setSearch]   = useState("");
  const [showAdd,  setShowAdd]  = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showCO,   setShowCO]   = useState(false);
  const [coData,   setCoData]   = useState({ boundCarrier:"", boundPremium:"", notes:"" });
  const [newAcct,  setNewAcct]  = useState({ name:"", agent:"JB", accountManager:"Gabriella", policyType:"Renewal", lob:"", masterCompany:"", policyNumber:"", expirationDate:"", premium:"", notes:"" });
  const [archSearch, setArchSearch] = useState("");
  const [expArch,    setExpArch]    = useState(null);
  const [showImport,   setShowImport]   = useState(false);
  const [importRows,   setImportRows]   = useState([]);
  const [importErrors, setImportErrors] = useState([]);
  const [importFile,   setImportFile]   = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [accts, arch] = await Promise.all([
          sb.select("accounts", "order=created_at.asc"),
          sb.select("archived_accounts", "order=created_at.asc"),
        ]);
        setAccounts((accts||[]).map(dbToAccount));
        setArchived((arch||[]).map(dbToArchived));
      } catch(e) { setDbErr(String(e)); } finally { setLoading(false); }
    }
    load();
  }, []);

  useEffect(() => {
    const unsub = sb.realtime((change) => {
      const { eventType, table, new:nr, old:or } = change;
      if (table==="accounts") {
        if (eventType==="INSERT") setAccounts(p => p.find(x=>x.id===nr.id)?p:[...p,dbToAccount(nr)]);
        if (eventType==="UPDATE") setAccounts(p => p.map(x=>x.id===nr.id?dbToAccount(nr):x));
        if (eventType==="DELETE") setAccounts(p => p.filter(x=>x.id!==or.id));
      }
      if (table==="archived_accounts") {
        if (eventType==="INSERT") setArchived(p => p.find(x=>x.id===nr.id)?p:[...p,dbToArchived(nr)]);
        if (eventType==="UPDATE") setArchived(p => p.map(x=>x.id===nr.id?dbToArchived(nr):x));
      }
    });
    return unsub;
  }, []);

  function upd(id, fn) {
    let updated;
    setAccounts(prev => prev.map(a => { if(a.id!==id) return a; updated=fn(a); return updated; }));
    setTimeout(async () => {
      if (!updated) return;
      setSyncing(p=>({...p,[id]:true}));
      try { await sb.update("accounts", id, accountToDb(updated)); }
      catch(e) { console.error("Save failed:",e); }
      finally { setSyncing(p=>{const n={...p};delete n[id];return n;}); }
    }, 0);
  }

  const toggleMilestone = (id, mid) => upd(id, a => ({ ...a, milestones:{...a.milestones,[mid]:!a.milestones[mid]} }));
  const setNotesFor     = (id, n)   => upd(id, a => ({ ...a, notes:n }));

  async function addAccount() {
    try {
      const res = await sb.insert("accounts", accountToDb({ ...newAcct, premium:Number(newAcct.premium)||0, milestones:{}, renewalHistory:[] }));
      const inserted = Array.isArray(res)?res[0]:res;
      if (inserted) setAccounts(p=>[...p,dbToAccount(inserted)]);
    } catch(e) { alert("Error: "+e.message); }
    setShowAdd(false);
    setNewAcct({ name:"", agent:"JB", accountManager:"Gabriella", policyType:"Renewal", lob:"", masterCompany:"", policyNumber:"", expirationDate:"", premium:"", notes:"" });
  }

  async function deleteAccount(acctId) {
    try { await sb.delete("accounts", acctId); setAccounts(p=>p.filter(x=>x.id!==acctId)); }
    catch(e) { alert("Error: "+e.message); return; }
    setShowDelete(false); setView("dashboard"); setSelId(null);
  }

  async function closeOut(acctId) {
    const a = accounts.find(x=>x.id===acctId); if(!a) return;
    const entry = {
      year: new Date(a.expirationDate).getFullYear(),
      expirationDate: a.expirationDate,
      premium: Number(a.premium),
      boundCarrier: coData.boundCarrier || a.masterCompany,
      boundPremium: Number(coData.boundPremium) || Number(a.premium),
      notes: coData.notes,
      accountManager: a.accountManager,
      agent: a.agent,
      closedAt: new Date().toLocaleDateString(),
    };
    try {
      const existing = archived.find(x=>x.name===a.name);
      if (existing) {
        const updHist = [entry,...(existing.renewalHistory||[])];
        await sb.update("archived_accounts", existing.id, { renewal_history:JSON.stringify(updHist) });
        setArchived(p=>p.map(x=>x.id===existing.id?{...x,renewalHistory:updHist}:x));
      } else {
        const res = await sb.insert("archived_accounts", { name:a.name, lob:a.lob, master_company:a.masterCompany, account_manager:a.accountManager, agent:a.agent, renewal_history:JSON.stringify([entry]) });
        const inserted = Array.isArray(res)?res[0]:res;
        if (inserted) setArchived(p=>[...p,dbToArchived(inserted)]);
      }
      await sb.delete("accounts", acctId);
      setAccounts(p=>p.filter(x=>x.id!==acctId));
    } catch(e) { alert("Error archiving: "+e.message); return; }
    setShowCO(false); setCoData({boundCarrier:"",boundPremium:"",notes:""}); setView("dashboard"); setSelId(null);
  }

  function parseImportFile(file) {
    setImportFile(file.name);
    setImportRows([]); setImportErrors([]);
    function processFile() {
      const XLSX = window.XLSX;
      if (!XLSX) { setImportErrors([{row:0,name:"Error",msgs:["SheetJS failed to load. Refresh and try again."]}]); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), {type:"array", cellDates:true, dateNF:"yyyy-mm-dd"});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, {defval:"", raw:false});
          if (!rows.length) { setImportErrors([{row:0,name:"Error",msgs:["No rows found."]}]); return; }
          const parsed=[]; const errors=[];
          rows.forEach((row,ri) => {
            const n={};
            Object.keys(row).forEach(k => { n[k.trim().toLowerCase()] = String(row[k]||"").trim(); });
            const name=n["account name"]||"", pNum=n["policy number"]||"",
                  expRaw=n["expiration date"]||"", premRaw=n["annual premium"]||"",
                  lob=n["line of business"]||"", carrier=n["master company"]||"",
                  agent=n["assigned agent"]||"", am=n["account manager"]||"",
                  pt=n["policy type"]||"Renewal", notes=n["notes"]||"";
            const errs=[];
            if(!name)  errs.push("Account Name required");
            if(!agent) errs.push("Assigned Agent required");
            if(!am)    errs.push("Account Manager required");
            let expDate="";
            if(expRaw) { const d=new Date(expRaw); if(!isNaN(d.getTime())) expDate=d.toISOString().slice(0,10); else errs.push("Bad date format"); }
            else errs.push("Expiration Date required");
            const premium=Number(String(premRaw).replace(/[$,\s]/g,""))||0;
            if(errs.length) errors.push({row:ri+2,name:name||`Row ${ri+2}`,msgs:errs});
            parsed.push({_rowNum:ri+2,_valid:!errs.length,name,policyNumber:pNum,expirationDate:expDate,premium,lob,masterCompany:carrier,agent,accountManager:am,policyType:pt||"Renewal",notes});
          });
          setImportRows(parsed); setImportErrors(errors);
        } catch(err) { setImportErrors([{row:0,name:"Parse Error",msgs:[String(err)]}]); }
      };
      reader.onerror = () => setImportErrors([{row:0,name:"Error",msgs:["Could not read file."]}]);
      reader.readAsArrayBuffer(file);
    }
    if (window.XLSX) { processFile(); }
    else {
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload=processFile;
      s.onerror=()=>setImportErrors([{row:0,name:"Error",msgs:["Could not load SheetJS."]}]);
      document.head.appendChild(s);
    }
  }

  async function commitImport() {
    const valid = importRows.filter(r=>r._valid);
    try {
      for (const r of valid) {
        const res = await sb.insert("accounts", accountToDb({...r, milestones:{}, renewalHistory:[]}));
        const inserted = Array.isArray(res)?res[0]:res;
        if (inserted) setAccounts(p=>[...p,dbToAccount(inserted)]);
      }
    } catch(e) { alert("Import error: "+e.message); return; }
    setShowImport(false); setImportRows([]); setImportErrors([]); setImportFile(null);
  }

  const enriched = useMemo(() => accounts.map(a => ({
    ...a,
    daysOut:      getDaysOut(a.expirationDate),
    health:       getHealth(a),
    healthReason: getHealthReason(a),
    progress:     getProgress(a),
    currentStage: getCurrentStage(a),
  })), [accounts]);

  const acct = useMemo(() => selId ? enriched.find(a=>a.id===selId)||null : null, [enriched,selId]);

  const filtered = useMemo(() => enriched.filter(a => {
    if (fAM!=="All" && a.accountManager!==fAM) return false;
    if (fAgent!=="All" && a.agent!==fAgent) return false;
    if (fHealth!=="All" && a.health!==fHealth) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a,b) => a.daysOut - b.daysOut), [enriched,fAM,fAgent,fHealth,search]);

  const stats = useMemo(() => ({
    total:    enriched.length,
    red:      enriched.filter(a=>a.health==="red").length,
    yellow:   enriched.filter(a=>a.health==="yellow").length,
    green:    enriched.filter(a=>a.health==="green").length,
    tPrem:    enriched.reduce((s,a)=>s+Number(a.premium),0),
    rPrem:    enriched.filter(a=>a.health==="red").reduce((s,a)=>s+Number(a.premium),0),
  }), [enriched]);

  // Stage pipeline counts — group by current milestone
  const stageCounts = useMemo(() => MILESTONES.map(m => ({
    ...m,
    count:   enriched.filter(a=>a.currentStage.id===m.id).length,
    premium: enriched.filter(a=>a.currentStage.id===m.id).reduce((x,a)=>x+Number(a.premium),0),
  })), [enriched]);

  function openAccount(a) { setSelId(a.id); setTab("milestones"); setView("account"); }
  function clearFilters() { setFAM("All"); setFAgent("All"); setFHealth("All"); setSearch(""); }
  const hasF = fAM!=="All"||fAgent!=="All"||fHealth!=="All"||search;
  const allDone = acct && MILESTONES.every(m=>acct.milestones[m.id]);

  if (loading) return (
    <div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,minHeight:"100vh"}}>
      <div style={{color:"#60a5fa",fontSize:"24px"}}>◌</div>
      <div style={{color:"#475569"}}>Connecting to database…</div>
    </div>
  );

  if (dbErr) return (
    <div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}>
      <div style={{background:"#1a0a0a",border:"1px solid #ef444433",borderRadius:8,padding:32,maxWidth:480}}>
        <div style={{color:"#ef4444",fontSize:"14px",fontWeight:700,marginBottom:8}}>Database Connection Error</div>
        <div style={{color:"#94a3b8",fontSize:"11px",marginBottom:16}}>{dbErr}</div>
        <button style={S.saveBtn} onClick={()=>window.location.reload()}>↺ Retry</button>
      </div>
    </div>
  );

  // ── Account detail view ─────────────────────────────────────────────────────
  if (view==="account") {
    if (!acct) { setView("dashboard"); return null; }
    const isSaving = !!syncing[acct.id];
    return (
      <div style={S.app}>
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
        <div style={S.dHead}>
          <button style={S.backBtn} onClick={()=>setView("dashboard")}>← Back</button>
          <div>
            <div style={{color:"#e2e8f0",fontSize:16,fontWeight:700,display:"flex",alignItems:"center",gap:10}}>
              {acct.name}
              {isSaving && <span style={{color:"#475569",fontSize:10,fontWeight:400,border:"1px solid #1e2d4a",borderRadius:3,padding:"2px 8px"}}>saving…</span>}
            </div>
            <div style={{color:"#475569",fontSize:11}}>{acct.lob} · {acct.masterCompany} · {acct.policyNumber}</div>
          </div>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <span style={S.dot(acct.health)}/>
            <span style={{color:SC[acct.health],fontSize:12}}>{SL[acct.health]}</span>
            <span style={{color:"#475569"}}>·</span>
            <span style={{color:acct.daysOut<0?"#a855f7":acct.daysOut<30?"#ef4444":"#94a3b8",fontSize:12}}>
              {acct.daysOut<0?`${Math.abs(acct.daysOut)}d past expiration`:`${acct.daysOut}d out`}
            </span>
            <span style={{color:"#475569"}}>·</span>
            <span style={{color:"#60a5fa",fontSize:12}}>${Number(acct.premium).toLocaleString()}</span>
            {allDone && (
              <button style={{background:"#0f2a1a",color:"#10b981",border:"1px solid #10b98144",padding:"5px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}
                onClick={()=>{setCoData({boundCarrier:acct.masterCompany,boundPremium:acct.premium,notes:""});setShowCO(true);}}>✓ Archive This Renewal</button>
            )}
            <button style={{background:"#1a0a0a",color:"#ef4444",border:"1px solid #ef444433",padding:"5px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"inherit"}} onClick={()=>setShowDelete(true)}>🗑 Delete</button>
          </div>
        </div>

        <div style={S.dBody}>
          <div style={S.sidebar}>
            <div style={S.sdSec}>
              <div style={S.sdLabel}>Account Manager</div>
              <div style={S.sdBig}>{acct.accountManager}</div>
            </div>
            <div style={S.sdSec}>
              <div style={S.sdLabel}>Producer</div>
              <div style={S.sdBig}>{acct.agent}</div>
            </div>
            <div style={S.sdSec}>
              <div style={S.sdLabel}>Expiration Date</div>
              <div style={S.sdBig}>{new Date(acct.expirationDate).toLocaleDateString()}</div>
              <div style={{color:acct.daysOut<0?"#a855f7":acct.daysOut<30?"#ef4444":"#64748b",fontSize:11,marginTop:2}}>
                {acct.daysOut<0?`${Math.abs(acct.daysOut)} days past`:`${acct.daysOut} days remaining`}
              </div>
            </div>
            <div style={S.sdSec}>
              <div style={S.sdLabel}>Progress</div>
              <div style={{color:"#e2e8f0",fontSize:18,fontWeight:700}}>{acct.progress.completed}/{acct.progress.total}</div>
              <div style={{...S.pBar,width:"100%",marginTop:6}}>
                <div style={S.pFill(acct.progress.completed/acct.progress.total, acct.health)}/>
              </div>
            </div>
            <div style={S.sdSec}>
              <div style={S.sdLabel}>Current Stage</div>
              <div style={{color:acct.currentStage.color,fontSize:12,fontWeight:600}}>{acct.currentStage.label}</div>
            </div>
          </div>

          <div style={S.content}>
            <div style={S.tabs}>
              {["milestones","details","notes","history"].map(t=>(
                <button key={t} style={S.tab(tab===t)} onClick={()=>setTab(t)}>
                  {t.charAt(0).toUpperCase()+t.slice(1)}
                  {t==="history"&&(acct.renewalHistory||[]).length>0&&<span style={{color:"#6366f1",marginLeft:4}}>({acct.renewalHistory.length})</span>}
                </button>
              ))}
            </div>

            {tab==="milestones"&&(
              <div>
                <div style={{color:"#475569",fontSize:11,marginBottom:20}}>Click a milestone to mark it complete. Health updates automatically based on days remaining.</div>
                {MILESTONES.map((m,idx) => {
                  const done = !!acct.milestones[m.id];
                  const daysOut = acct.daysOut;
                  const isLate = !done && (m.dueDays>=0 ? daysOut<=m.lateDays : daysOut<m.dueDays);
                  const isUpcoming = !done && !isLate && m.dueDays>=0 && daysOut<=m.dueDays+14;
                  return (
                    <div key={m.id} onClick={()=>toggleMilestone(acct.id,m.id)} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",background:done?"#0a1a0a":isLate?"#1a0a0a":"#0f1629",border:`1px solid ${done?"#10b98133":isLate?"#ef444433":"#1e2d4a"}`,borderLeft:`3px solid ${done?"#10b981":isLate?"#ef4444":isUpcoming?m.color:"#1e2d4a"}`,borderRadius:4,marginBottom:8,cursor:"pointer",transition:"all 0.1s"}}>
                      <div style={{width:22,height:22,border:`2px solid ${done?"#10b981":isLate?"#ef4444":"#334155"}`,borderRadius:"50%",background:done?"#10b981":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        {done&&<span style={{color:"#0a0e1a",fontSize:12,fontWeight:700}}>✓</span>}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{color:done?"#64748b":isLate?"#ef4444":"#e2e8f0",fontWeight:600,fontSize:13,textDecoration:done?"line-through":"none"}}>{m.label}</div>
                        <div style={{color:"#475569",fontSize:10,marginTop:2}}>
                          {m.dueDays<0
                            ? `Due ${Math.abs(m.dueDays)} days after expiration`
                            : `Due by ${m.dueDays} days out`
                          }
                          {isLate && <span style={{color:"#ef4444",marginLeft:8,fontWeight:600}}>⚠ OVERDUE</span>}
                          {done && <span style={{color:"#10b981",marginLeft:8}}>✓ Complete</span>}
                        </div>
                      </div>
                      <div style={{flexShrink:0,textAlign:"right"}}>
                        <div style={{color:"#334155",fontSize:10}}>Step {idx+1} of {MILESTONES.length}</div>
                      </div>
                    </div>
                  );
                })}
                {allDone&&(
                  <div style={{background:"#0f2a1a",border:"1px solid #10b98144",borderRadius:4,padding:"14px 16px",marginTop:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{color:"#10b981",fontWeight:600}}>🎉 All milestones complete — ready to archive!</div>
                    <button style={{background:"#10b98122",color:"#10b981",border:"1px solid #10b98144",padding:"5px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}
                      onClick={()=>{setCoData({boundCarrier:acct.masterCompany,boundPremium:acct.premium,notes:""});setShowCO(true);}}>Archive →</button>
                  </div>
                )}
              </div>
            )}

            {tab==="details"&&(
              <div style={S.dGrid}>
                {[["Account Name",acct.name],["Account Manager",acct.accountManager],["Producer",acct.agent],["Policy Type",acct.policyType],["Line of Business",acct.lob],["Master Company",acct.masterCompany],["Policy Number",acct.policyNumber],["Expiration Date",new Date(acct.expirationDate).toLocaleDateString()],["Annual Premium",`$${Number(acct.premium).toLocaleString()}`]].map(([l,v])=>(
                  <div key={l} style={S.dField}><div style={S.fLbl}>{l}</div><div style={S.fVal}>{v}</div></div>
                ))}
              </div>
            )}

            {tab==="notes"&&(
              <div>
                <div style={{color:"#475569",fontSize:11,marginBottom:10}}>Internal notes — auto-saved</div>
                <textarea style={S.textarea} value={acct.notes||""} onChange={e=>setNotesFor(acct.id,e.target.value)} placeholder="Add notes…"/>
              </div>
            )}

            {tab==="history"&&(
              <div>
                {!(acct.renewalHistory||[]).length
                  ? <div style={{color:"#475569",fontSize:12,padding:"20px 0"}}>No prior renewal history yet.</div>
                  : acct.renewalHistory.map((entry,i)=>(
                      <div key={i} style={{background:"#080c18",border:"1px solid #1e2d4a",borderLeft:"3px solid #6366f1",borderRadius:4,padding:16,marginBottom:12}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                          <div style={{color:"#6366f1",fontSize:14,fontWeight:700}}>{entry.year} Renewal</div>
                          <div style={{display:"flex",gap:16,alignItems:"center"}}>
                            {entry.closedAt&&<span style={{color:"#334155",fontSize:10}}>Closed {entry.closedAt}</span>}
                            <span style={{color:"#10b981",fontSize:12,fontWeight:600}}>{entry.boundCarrier}</span>
                            <span style={{color:"#60a5fa",fontSize:13,fontWeight:700}}>${Number(entry.boundPremium).toLocaleString()}</span>
                            {entry.premium>0&&<span style={{color:entry.boundPremium>entry.premium?"#ef4444":"#10b981",fontSize:12}}>{entry.boundPremium>entry.premium?"+":""}{(((entry.boundPremium-entry.premium)/entry.premium)*100).toFixed(1)}%</span>}
                          </div>
                        </div>
                        {entry.notes&&<div style={{color:"#64748b",fontSize:11,fontStyle:"italic",padding:"6px 8px",background:"#0f1629",borderRadius:3}}>{entry.notes}</div>}
                      </div>
                    ))
                }
              </div>
            )}
          </div>
        </div>

        {showDelete&&(
          <div style={S.mBg} onClick={e=>e.target===e.currentTarget&&setShowDelete(false)}>
            <div style={{...S.mBox,width:380}}>
              <div style={{color:"#ef4444",fontSize:"14px",fontWeight:600,marginBottom:12}}>🗑 Delete Account?</div>
              <div style={{color:"#64748b",fontSize:"12px",marginBottom:20}}>Permanently delete <b style={{color:"#e2e8f0"}}>{acct.name}</b>? This cannot be undone.</div>
              <div style={S.mActs}>
                <button style={S.cancelBtn} onClick={()=>setShowDelete(false)}>Cancel</button>
                <button style={{...S.saveBtn,background:"#1a0a0a",color:"#ef4444",border:"1px solid #ef444433"}} onClick={()=>deleteAccount(acct.id)}>Delete Permanently</button>
              </div>
            </div>
          </div>
        )}

        {showCO&&(
          <div style={S.mBg} onClick={e=>e.target===e.currentTarget&&setShowCO(false)}>
            <div style={S.mBox}>
              <div style={S.mTitle}>ARCHIVE RENEWAL — {acct.name}</div>
              <div style={{color:"#475569",fontSize:11,marginBottom:16}}>Save a permanent record of this renewal before removing it from the active pipeline.</div>
              <div style={S.mRow}><label style={S.mLabel}>Bound Carrier</label><input style={S.mInput} value={coData.boundCarrier} onChange={e=>setCoData(p=>({...p,boundCarrier:e.target.value}))}/></div>
              <div style={S.mRow}><label style={S.mLabel}>Bound Premium</label><input type="number" style={S.mInput} value={coData.boundPremium} onChange={e=>setCoData(p=>({...p,boundPremium:e.target.value}))}/></div>
              <div style={S.mRow}><label style={S.mLabel}>Notes</label><textarea style={{...S.textarea,minHeight:80}} value={coData.notes} onChange={e=>setCoData(p=>({...p,notes:e.target.value}))}/></div>
              <div style={S.mActs}>
                <button style={S.cancelBtn} onClick={()=>setShowCO(false)}>Cancel</button>
                <button style={{...S.saveBtn,background:"#0f2a1a",color:"#10b981",border:"1px solid #10b98144"}} onClick={()=>closeOut(acct.id)} disabled={!coData.boundCarrier}>✓ Archive</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Dashboard / Worklist / Archive ──────────────────────────────────────────
  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <div style={S.header}>
        <div style={{display:"flex",alignItems:"baseline"}}>
          <span style={S.logo}>BEHR INSURANCE</span>
          <span style={S.logoSub}>/ RENEWAL PIPELINE</span>
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center"}}>
          {["dashboard","worklist","archive"].map(v=>(
            <button key={v} style={S.navBtn(view===v)} onClick={()=>setView(v)}>
              {v.charAt(0).toUpperCase()+v.slice(1)}
              {v==="archive"&&archived.length>0&&<span style={{color:"#6366f1",marginLeft:4}}>({archived.length})</span>}
            </button>
          ))}
          <button style={S.addBtn("#0f2a1a","#10b981")} onClick={()=>setShowImport(true)}>↑ Import Excel</button>
          <button style={S.addBtn()} onClick={()=>setShowAdd(true)}>+ Add Account</button>
        </div>
      </div>

      <div style={S.main}>
        {/* Stat cards */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"12px",marginBottom:"20px"}}>
          {[
            {label:"Total Pipeline",  val:stats.total,                          color:"#60a5fa",sub:"active accounts",      fn:()=>{clearFilters();setView("dashboard");}},
            {label:"Behind Schedule", val:stats.red,                            color:"#ef4444",sub:"need immediate action", fn:()=>{setFHealth("red");setView("dashboard");}},
            {label:"At Risk",         val:stats.yellow,                         color:"#f59e0b",sub:"action needed soon",    fn:()=>{setFHealth("yellow");setView("dashboard");}},
            {label:"On Track",        val:stats.green,                          color:"#10b981",sub:"progressing well",      fn:()=>{setFHealth("green");setView("dashboard");}},
            {label:"Premium at Risk", val:`$${(stats.rPrem/1000).toFixed(0)}k`, color:"#ef4444",sub:`of $${(stats.tPrem/1000).toFixed(0)}k total`, fn:()=>{setFHealth("red");setView("dashboard");}},
          ].map(({label,val,color,sub,fn})=>(
            <div key={label} style={S.statCard(color)} onClick={fn} onMouseEnter={e=>e.currentTarget.style.opacity="0.8"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
              <div style={S.sLabel}>{label}</div>
              <div style={S.sVal(color)}>{val}</div>
              <div style={S.sSub}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Stage pipeline bar */}
        {view==="dashboard"&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:6,marginBottom:20}}>
            {stageCounts.map(m=>(
              <div key={m.id} style={{background:"#0f1629",border:`1px solid ${m.color}33`,borderTop:`2px solid ${m.color}`,borderRadius:4,padding:"8px 10px",cursor:"pointer"}} onClick={()=>{}}>
                <div style={{color:m.color,fontSize:9,letterSpacing:"0.05em",textTransform:"uppercase",marginBottom:4,lineHeight:1.3}}>{m.label}</div>
                <div style={{color:"#e2e8f0",fontSize:18,fontWeight:700}}>{m.count}</div>
                <div style={{color:"#475569",fontSize:10}}>${(m.premium/1000).toFixed(0)}k</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        {view!=="archive"&&(
          <div style={S.filters}>
            <input style={S.searchI} placeholder="Search accounts…" value={search} onChange={e=>setSearch(e.target.value)}/>
            <div style={{display:"flex",alignItems:"center",gap:6,background:"#0f1629",border:"1px solid #1e3a5f",borderRadius:4,padding:"0 10px"}}>
              <span style={{color:"#60a5fa",fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase",whiteSpace:"nowrap"}}>Acct Mgr</span>
              <select style={{...S.fSel,border:"none",background:"transparent",paddingLeft:4}} value={fAM} onChange={e=>setFAM(e.target.value)}>
                <option>All</option>{ACCOUNT_MANAGERS.map(a=><option key={a}>{a}</option>)}
              </select>
            </div>
            <select style={S.fSel} value={fAgent} onChange={e=>setFAgent(e.target.value)}>
              <option value="All">All Producers</option>{AGENTS.map(a=><option key={a}>{a}</option>)}
            </select>
            <select style={S.fSel} value={fHealth} onChange={e=>setFHealth(e.target.value)}>
              <option>All</option>
              <option value="red">Behind</option>
              <option value="yellow">At Risk</option>
              <option value="green">On Track</option>
            </select>
            {hasF&&<button style={{...S.cancelBtn,fontSize:11}} onClick={clearFilters}>Clear filters</button>}
            <span style={{color:"#334155",fontSize:11,marginLeft:"auto"}}>{filtered.length} accounts</span>
          </div>
        )}

        {/* Dashboard table */}
        {view==="dashboard"&&(
          <table style={S.table}>
            <thead><tr>{["","Account","Acct Mgr","Producer","LOB","Carrier","Expiration","Days Out","Premium","Current Milestone","Progress","Status"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map(a=>(
                <tr key={a.id} style={{background:a.health==="red"?"#1a0a0a":"#0f1629",borderBottom:"1px solid #131c2e",cursor:"pointer"}}
                  onClick={()=>openAccount(a)}
                  onMouseEnter={e=>e.currentTarget.style.background=a.health==="red"?"#1f0a0a":"#141e32"}
                  onMouseLeave={e=>e.currentTarget.style.background=a.health==="red"?"#1a0a0a":"#0f1629"}>
                  <td style={S.td}><span style={S.dot(a.health)} title={a.healthReason||SL[a.health]}/></td>
                  <td style={{...S.td,color:"#e2e8f0",fontWeight:600}}>{a.name}{syncing[a.id]&&<span style={{color:"#475569",fontSize:9,marginLeft:6}}>saving</span>}</td>
                  <td style={{...S.td,color:"#60a5fa",fontWeight:600}}>{a.accountManager}</td>
                  <td style={{...S.td,color:"#94a3b8"}}>{a.agent}</td>
                  <td style={{...S.td,color:"#94a3b8"}}>{a.lob}</td>
                  <td style={{...S.td,color:"#64748b"}}>{a.masterCompany}</td>
                  <td style={{...S.td,color:"#94a3b8"}}>{new Date(a.expirationDate).toLocaleDateString()}</td>
                  <td style={{...S.td,color:a.daysOut<0?"#a855f7":a.daysOut<30?"#ef4444":a.daysOut<60?"#f59e0b":"#94a3b8",fontWeight:600}}>
                    {a.daysOut<0?`+${Math.abs(a.daysOut)}d`:`${a.daysOut}d`}
                  </td>
                  <td style={{...S.td,color:"#60a5fa"}}>${Number(a.premium).toLocaleString()}</td>
                  <td style={S.td}>
                    <span style={{background:`${a.currentStage.color}22`,color:a.currentStage.color,border:`1px solid ${a.currentStage.color}44`,padding:"2px 8px",borderRadius:10,fontSize:10,whiteSpace:"nowrap"}}>{a.currentStage.label}</span>
                  </td>
                  <td style={S.td}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <div style={S.pBar}><div style={S.pFill(a.progress.completed/a.progress.total,a.health)}/></div>
                      <span style={{color:"#475569",fontSize:10}}>{a.progress.completed}/{a.progress.total}</span>
                    </div>
                  </td>
                  <td style={{...S.td,color:SC[a.health],fontSize:11}}>{SL[a.health]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Worklist */}
        {view==="worklist"&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{color:"#475569",fontSize:11,marginBottom:8}}>Sorted by urgency — most critical first</div>
            {[...filtered].sort((a,b)=>{
              const o={red:0,yellow:1,green:2};
              return o[a.health]!==o[b.health]?o[a.health]-o[b.health]:a.daysOut-b.daysOut;
            }).map(a=>{
              const nextMilestone = MILESTONES.find(m=>!a.milestones[m.id]);
              return(
                <div key={a.id} style={{...S.wItem(a.health)}} onClick={()=>openAccount(a)}
                  onMouseEnter={e=>e.currentTarget.style.background="#141e32"}
                  onMouseLeave={e=>e.currentTarget.style.background="#0f1629"}>
                  <span style={S.dot(a.health)}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{color:"#e2e8f0",fontWeight:600,fontSize:13}}>{a.name}</span>
                    </div>
                    <div style={{color:"#475569",fontSize:11,marginTop:2}}>
                      {a.healthReason
                        ? <span style={{color:"#ef4444"}}>{a.healthReason}</span>
                        : nextMilestone
                          ? <span>Next: <span style={{color:"#94a3b8"}}>{nextMilestone.label}</span> <span style={{color:"#475569"}}>— due by {nextMilestone.dueDays} days out</span></span>
                          : <span style={{color:"#10b981"}}>All milestones complete — ready to archive</span>
                      }
                    </div>
                  </div>
                  <div style={{display:"flex",gap:16,alignItems:"center",flexShrink:0}}>
                    {[["Acct Mgr",a.accountManager,"#60a5fa"],["Producer",a.agent,"#94a3b8"]].map(([l,v,c])=>(
                      <div key={l} style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>{l}</div><div style={{color:c,fontSize:12,fontWeight:600}}>{v}</div></div>
                    ))}
                    <div style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>Days Out</div><div style={{color:a.daysOut<0?"#a855f7":a.daysOut<30?"#ef4444":"#94a3b8",fontSize:12,fontWeight:600}}>{a.daysOut<0?`+${Math.abs(a.daysOut)}d`:`${a.daysOut}d`}</div></div>
                    <div style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>Milestone</div><span style={{background:`${a.currentStage.color}22`,color:a.currentStage.color,border:`1px solid ${a.currentStage.color}44`,padding:"2px 8px",borderRadius:10,fontSize:10}}>{a.currentStage.label}</span></div>
                    <div style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>Progress</div><div style={{color:"#94a3b8",fontSize:12}}>{a.progress.completed}/{a.progress.total}</div></div>
                    <div style={{color:"#334155",fontSize:14}}>→</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Archive */}
        {view==="archive"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
              <input style={S.searchI} placeholder="Search archived accounts…" value={archSearch} onChange={e=>setArchSearch(e.target.value)}/>
              <span style={{color:"#334155",fontSize:11,marginLeft:"auto"}}>{archived.length} archived accounts</span>
            </div>
            {archived.length===0
              ? <div style={{color:"#334155",fontSize:13,padding:"40px 0",textAlign:"center"}}><div style={{fontSize:24,marginBottom:8}}>📁</div>No archived renewals yet.</div>
              : archived.filter(a=>!archSearch||a.name.toLowerCase().includes(archSearch.toLowerCase())).map(a=>(
                  <div key={a.id||a.name}>
                    <div style={{background:"#0f1629",border:"1px solid #1e2d4a",borderLeft:"3px solid #6366f1",borderRadius:expArch===a.id?"4px 4px 0 0":"4px",padding:"12px 16px",marginBottom:expArch===a.id?0:8,cursor:"pointer",display:"flex",alignItems:"center",gap:16}}
                      onClick={()=>setExpArch(expArch===a.id?null:a.id)}
                      onMouseEnter={e=>e.currentTarget.style.background="#141e32"}
                      onMouseLeave={e=>e.currentTarget.style.background="#0f1629"}>
                      <div style={{flex:1}}>
                        <div style={{color:"#e2e8f0",fontWeight:600,fontSize:13}}>{a.name}</div>
                        <div style={{color:"#475569",fontSize:11,marginTop:2}}>{a.lob} · {a.masterCompany} · {a.accountManager}</div>
                      </div>
                      <div style={{display:"flex",gap:16,alignItems:"center"}}>
                        <div style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>Renewals</div><div style={{color:"#6366f1",fontSize:13,fontWeight:600}}>{(a.renewalHistory||[]).length} yrs</div></div>
                        <div style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>Last Bound</div><div style={{color:"#10b981",fontSize:12}}>{a.renewalHistory?.[0]?.boundCarrier||"—"}</div></div>
                        <div style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>Last Premium</div><div style={{color:"#60a5fa",fontSize:12}}>${Number(a.renewalHistory?.[0]?.boundPremium||0).toLocaleString()}</div></div>
                        <div style={{color:expArch===a.id?"#60a5fa":"#334155",fontSize:14}}>{expArch===a.id?"▲":"▼"}</div>
                      </div>
                    </div>
                    {expArch===a.id&&(
                      <div style={{background:"#080c18",border:"1px solid #1e2d4a",borderTop:"none",borderRadius:"0 0 4px 4px",padding:16,marginBottom:8}}>
                        {(a.renewalHistory||[]).map((entry,i)=>(
                          <div key={i} style={{background:"#0f1629",border:"1px solid #1e2d4a",borderLeft:"3px solid #6366f1",borderRadius:4,padding:14,marginBottom:10}}>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                              <div style={{color:"#6366f1",fontWeight:700,fontSize:14}}>{entry.year} Renewal</div>
                              <div style={{display:"flex",gap:16,alignItems:"center"}}>
                                {entry.closedAt&&<span style={{color:"#334155",fontSize:10}}>Closed {entry.closedAt}</span>}
                                <span style={{color:"#10b981",fontSize:12,fontWeight:600}}>{entry.boundCarrier}</span>
                                <span style={{color:"#60a5fa",fontSize:13,fontWeight:700}}>${Number(entry.boundPremium).toLocaleString()}</span>
                                {entry.premium>0&&<span style={{color:entry.boundPremium>entry.premium?"#ef4444":"#10b981",fontSize:12}}>{entry.boundPremium>entry.premium?"+":""}{(((entry.boundPremium-entry.premium)/entry.premium)*100).toFixed(1)}%</span>}
                              </div>
                            </div>
                            {entry.notes&&<div style={{color:"#64748b",fontSize:11,fontStyle:"italic",padding:"6px 8px",background:"#080c18",borderRadius:3}}>{entry.notes}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
            }
          </div>
        )}
      </div>

      {/* Add Account modal */}
      {showAdd&&(
        <div style={S.mBg} onClick={e=>e.target===e.currentTarget&&setShowAdd(false)}>
          <div style={S.mBox}>
            <div style={S.mTitle}>ADD NEW RENEWAL ACCOUNT</div>
            {[["Account Name","name","text"],["Policy Number","policyNumber","text"],["Expiration Date","expirationDate","date"],["Annual Premium","premium","number"]].map(([l,k,t])=>(
              <div key={k} style={S.mRow}><label style={S.mLabel}>{l}</label><input type={t} style={S.mInput} value={newAcct[k]} onChange={e=>setNewAcct(p=>({...p,[k]:e.target.value}))}/></div>
            ))}
            <div style={S.mRow}><label style={S.mLabel}>Line of Business</label><input style={S.mInput} placeholder="e.g. General Liability, Workers Comp" value={newAcct.lob} onChange={e=>setNewAcct(p=>({...p,lob:e.target.value}))}/></div>
            <div style={S.mRow}><label style={S.mLabel}>Master Company</label><input style={S.mInput} placeholder="e.g. Travelers, Liberty Mutual" value={newAcct.masterCompany} onChange={e=>setNewAcct(p=>({...p,masterCompany:e.target.value}))}/></div>
            {[["Assigned Agent","agent",AGENTS],["Account Manager","accountManager",ACCOUNT_MANAGERS],["Policy Type","policyType",POLICY_TYPES]].map(([l,k,opts])=>(
              <div key={k} style={S.mRow}><label style={S.mLabel}>{l}</label>
                <select style={S.mSel} value={newAcct[k]} onChange={e=>setNewAcct(p=>({...p,[k]:e.target.value}))}>
                  {opts.map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <div style={S.mActs}>
              <button style={S.cancelBtn} onClick={()=>setShowAdd(false)}>Cancel</button>
              <button style={S.saveBtn} onClick={addAccount} disabled={!newAcct.name||!newAcct.expirationDate}>Save Account</button>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport&&(
        <div style={S.mBg} onClick={e=>e.target===e.currentTarget&&(setShowImport(false),setImportRows([]),setImportErrors([]),setImportFile(null))}>
          <div style={{...S.mBox,width:700,maxHeight:"85vh"}}>
            <div style={S.mTitle}>IMPORT ACCOUNTS FROM EXCEL</div>
            {importRows.length===0?(
              <div>
                <div style={{border:"2px dashed #1e3a5f",borderRadius:6,padding:32,textAlign:"center",marginBottom:16,cursor:"pointer"}}
                  onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="#60a5fa";}}
                  onDragLeave={e=>{e.currentTarget.style.borderColor="#1e3a5f";}}
                  onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="#1e3a5f";const f=e.dataTransfer.files[0];if(f)parseImportFile(f);}}
                  onClick={()=>document.getElementById("xlsxInput").click()}>
                  <div style={{fontSize:28,marginBottom:8}}>📊</div>
                  <div style={{color:"#60a5fa",fontSize:13,fontWeight:600,marginBottom:4}}>Drop your Excel file here or click to browse</div>
                  <div style={{color:"#475569",fontSize:11}}>Accepts .xlsx or .xls files</div>
                  <input id="xlsxInput" type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)parseImportFile(f);}}/>
                </div>
                <div style={{background:"#080c18",border:"1px solid #1e2d4a",borderRadius:4,padding:"12px 16px",fontSize:11,color:"#475569",lineHeight:1.7}}>
                  <div style={{color:"#60a5fa",fontWeight:600,marginBottom:6}}>Required columns:</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 16px"}}>
                    {["Account Name","Expiration Date","Assigned Agent","Account Manager","Policy Number","Annual Premium","Line of Business","Master Company","Policy Type"].map(c=><span key={c}>· {c}</span>)}
                  </div>
                </div>
              </div>
            ):(
              <div>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"10px 14px",background:"#080c18",border:"1px solid #1e2d4a",borderRadius:4}}>
                  <span style={{fontSize:18}}>📊</span>
                  <div style={{flex:1}}>
                    <div style={{color:"#e2e8f0",fontSize:12,fontWeight:600}}>{importFile}</div>
                    <div style={{color:"#475569",fontSize:11,marginTop:2}}>{importRows.filter(r=>r._valid).length} valid · <span style={{color:importErrors.length>0?"#ef4444":"#10b981"}}>{importErrors.length} error{importErrors.length!==1?"s":""}</span></div>
                  </div>
                  <button style={{...S.cancelBtn,fontSize:10,padding:"4px 10px"}} onClick={()=>{setImportRows([]);setImportErrors([]);setImportFile(null);}}>✕ Clear</button>
                </div>
                {importErrors.length>0&&(
                  <div style={{background:"#1a0a0a",border:"1px solid #ef444433",borderRadius:4,padding:"12px 14px",marginBottom:12,maxHeight:120,overflowY:"auto"}}>
                    <div style={{color:"#ef4444",fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase",fontWeight:600,marginBottom:8}}>⚠ Rows with errors (will be skipped)</div>
                    {importErrors.map((e,i)=>(
                      <div key={i} style={{marginBottom:4}}><span style={{color:"#f87171",fontSize:11,fontWeight:600}}>Row {e.row} {e.name?`— ${e.name}`:""}:</span><span style={{color:"#94a3b8",fontSize:11}}> {e.msgs.join(", ")}</span></div>
                    ))}
                  </div>
                )}
                <div style={{maxHeight:280,overflowY:"auto",border:"1px solid #1e2d4a",borderRadius:4,marginBottom:14}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead><tr>{["","Account","LOB","Carrier","Agent","AM","Expiration","Premium"].map(h=><th key={h} style={{background:"#0a0e1a",color:"#475569",padding:"7px 10px",textAlign:"left",borderBottom:"1px solid #1e2d4a",fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {importRows.map((r,i)=>(
                        <tr key={i} style={{background:r._valid?"#0f1629":"#1a0a0a",borderBottom:"1px solid #131c2e"}}>
                          <td style={{padding:"6px 10px"}}>{r._valid?<span style={{color:"#10b981"}}>✓</span>:<span style={{color:"#ef4444"}}>✕</span>}</td>
                          <td style={{padding:"6px 10px",color:r._valid?"#e2e8f0":"#64748b",fontWeight:600,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</td>
                          <td style={{padding:"6px 10px",color:"#94a3b8"}}>{r.lob}</td>
                          <td style={{padding:"6px 10px",color:"#64748b"}}>{r.masterCompany}</td>
                          <td style={{padding:"6px 10px",color:"#94a3b8"}}>{r.agent}</td>
                          <td style={{padding:"6px 10px",color:"#60a5fa"}}>{r.accountManager}</td>
                          <td style={{padding:"6px 10px",color:"#94a3b8",whiteSpace:"nowrap"}}>{r.expirationDate}</td>
                          <td style={{padding:"6px 10px",color:"#60a5fa"}}>${Number(r.premium).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div style={S.mActs}>
              <button style={S.cancelBtn} onClick={()=>{setShowImport(false);setImportRows([]);setImportErrors([]);setImportFile(null);}}>Cancel</button>
              {importRows.length>0&&(
                <button style={{...S.saveBtn,opacity:importRows.filter(r=>r._valid).length===0?0.4:1}} onClick={commitImport} disabled={importRows.filter(r=>r._valid).length===0}>
                  ✓ Import {importRows.filter(r=>r._valid).length} Account{importRows.filter(r=>r._valid).length!==1?"s":""}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

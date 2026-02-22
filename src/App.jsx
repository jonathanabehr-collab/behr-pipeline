import { useState, useMemo, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CONFIG — replace these two lines with your project values
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL      = "https://fkrkdkizdgrwvmmnlacz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrcmtka2l6ZGdyd3ZtbW5sYWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzgzNjIsImV4cCI6MjA4NzI1NDM2Mn0.FR0WgL8SykRSgOY2Azk8hg8M5VaCAtvpIr74Uan4FW8";

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight Supabase REST + Realtime client (no npm package needed)
// ─────────────────────────────────────────────────────────────────────────────
const sb = (() => {
  const h = () => ({ "Content-Type":"application/json", apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${SUPABASE_ANON_KEY}` });
  const base = `${SUPABASE_URL}/rest/v1`;

  async function req(method, path, body, extra = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...h(), ...extra },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await res.text());
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }

  return {
    select: (table, query="")  => req("GET",    `/${table}?${query}`),
    insert: (table, row)       => req("POST",   `/${table}`, row,  { Prefer:"return=representation" }),
    update: (table, id, row)   => req("PATCH",  `/${table}?id=eq.${id}`, row),
    delete: (table, id)        => req("DELETE", `/${table}?id=eq.${id}`),
    upsert: (table, row, key)  => req("POST",   `/${table}`, row,  { Prefer:`resolution=merge-duplicates,return=representation` }),

    // Realtime WebSocket channel
    realtime(onEvent) {
      if (SUPABASE_URL === "YOUR_SUPABASE_URL") return () => {};
      const wsUrl = `${SUPABASE_URL.replace(/^https/, "wss").replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
      let ws, heartbeat;
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          ws.send(JSON.stringify({
            topic: "realtime:public", event: "phx_join",
            payload: { config: { postgres_changes: [{ event:"*", schema:"public" }] } },
            ref: "1",
          }));
          heartbeat = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ topic:"phoenix", event:"heartbeat", payload:{}, ref:"hb" })), 25000);
        };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.event === "postgres_changes") onEvent(msg.payload?.data || {});
          } catch {}
        };
        ws.onerror = () => {};
      } catch {}
      return () => { clearInterval(heartbeat); ws?.close(); };
    },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// Domain constants
// ─────────────────────────────────────────────────────────────────────────────
const STAGES = [
  { id:"annual_review",   label:"Annual Review",   days:"120-150", color:"#6366f1" },
  { id:"submission_prep", label:"Submission Prep", days:"90-120",  color:"#f59e0b" },
  { id:"marketing",       label:"Marketing",       days:"~90",     color:"#10b981" },
  { id:"proposal",        label:"Proposal",        days:"60-90",   color:"#3b82f6" },
  { id:"binding",         label:"Binding",         days:"0-30",    color:"#ef4444" },
  { id:"post_bind",       label:"Post-Bind",       days:"after",   color:"#a855f7" },
];

const DEFAULT_TASKS = {
  annual_review: [
    { id:"acr_packet",        label:"Send ACR Packet to Agent" },
    { id:"acr_meeting_email", label:"Send ACR Meeting Email to Client" },
  ],
  submission_prep: [
    { id:"acr_meeting_set",       label:"ACR Meeting Date Set" },
    { id:"acr_received",          label:"Completed ACR Received from Agent" },
    { id:"supplemental_received", label:"Completed Supplemental Received from Agent" },
    { id:"loss_run_request",      label:"Submit Loss Run Request Letters to Prior Carriers" },
  ],
  marketing: [
    { id:"loss_runs_received",   label:"Loss Runs Received" },
    { id:"acord_apps",           label:"Update/Generate Acord Apps in Ezlynx" },
    { id:"marketing_plan",       label:"Create Marketing Plan with Agent" },
    { id:"expiring_policy_info", label:"Expiring Policy Information Gathered" },
  ],
  proposal: [
    { id:"proposal_created",       label:"Create Proposal from Marketing Results" },
    { id:"binding_requirements",   label:"Put Together Binding Requirements" },
    { id:"proposal_meeting_email", label:"Send Proposal Meeting Email to Insured" },
    { id:"proposal_to_agent",      label:"Proposal Sent to Agent" },
  ],
  binding: [
    { id:"coverage_bound",   label:"Coverage Bound" },
    { id:"binder_issued",    label:"Binder Issued to Client" },
    { id:"policy_checklist", label:"Policy Checklist Complete" },
  ],
  post_bind_wc: [
    { id:"pb_wc_signed_docs",         label:"Obtain Signed Docs (Acords, Officer Exclusion, Proposal)" },
    { id:"pb_wc_deposit_collected",   label:"Collect Deposit Payment" },
    { id:"pb_wc_bind_carrier",        label:"Bind Policy w/ Carrier" },
    { id:"pb_wc_officer_exclusion",   label:"Submit Officer Exclusion Form" },
    { id:"pb_wc_ezlynx_setup",        label:"Setup/Update Policy in EZLYNX" },
    { id:"pb_wc_loss_run_spreadsheet",label:"Update Policy Numbers on Client Loss Runs Spreadsheet" },
    { id:"pb_wc_save_signed_docs",    label:"Save Signed Docs to EZLYNX & DRIVE" },
    { id:"pb_wc_dais_tracking",       label:"DAIS Bind Tracking (AmTrust, Hartford, CNA, Travelers, Chubb, Nationwide) — NOT ICW" },
    { id:"pb_wc_deposit_to_carrier",  label:"Submit Deposit Payment to Carrier" },
    { id:"pb_wc_cslb",                label:"Contractors — Submit Updated Info to CSLB Online" },
    { id:"pb_wc_obtain_policy",       label:"Obtain Policy from Carrier" },
    { id:"pb_wc_blanket_waiver",      label:"Save Blanket Waiver End to EZLYNX and Add Form Number to Policy Endorsement Pin Note" },
    { id:"pb_wc_master_cert",         label:"Setup Master Certificate" },
    { id:"pb_wc_renewal_certs",       label:"Create Renewal Certs and Send to Insured" },
    { id:"pb_wc_zenjuries",           label:"Setup on Zenjuries (if proposed)" },
    { id:"pb_wc_welcome_packet",      label:"Send Welcome Packet" },
    { id:"pb_wc_coverage_comparison", label:"Update Insured's Coverage Comparison Chart (Accounts $70k+ total premium only)" },
  ],
  post_bind_pc: [
    { id:"pb_pc_docusign",            label:"Send Docusign to Insured" },
    { id:"pb_pc_payment_link",        label:"Send Payment Link to Insured" },
    { id:"pb_pc_signed_binding_docs", label:"Obtain Signed Binding Docs and Save to Drive in 'Signed Docs' Folder" },
    { id:"pb_pc_down_payment",        label:"Obtain Down Payment" },
    { id:"pb_pc_request_bind",        label:"Request Bind with Carriers" },
    { id:"pb_pc_notify_incumbent",    label:"Notify Incumbent Carrier of Cancellation (if changing carriers) once Bind Confirmation Received" },
    { id:"pb_pc_binders",             label:"Obtain Binders, Policy #s, and Invoices" },
    { id:"pb_pc_ezlynx_setup",        label:"Setup Policy in EZLYNX" },
    { id:"pb_pc_loss_run_spreadsheet",label:"Update Client's Policy Numbers on Loss Run Spreadsheet" },
    { id:"pb_pc_finance_contract",    label:"Submit Finance Contract to IPFS or First Insurance Funding (only if premium is financed)" },
    { id:"pb_pc_dais_tracking",       label:"Submit to DAIS for Bind Tracking (only if DAIS Carrier)" },
    { id:"pb_pc_obtain_policies",     label:"Obtain Copies of All Policies and Save to Drive & EZLYNX" },
    { id:"pb_pc_review_policies",     label:"Review Policies for Errors Against Proposal from Carriers and Proposal Presented to Client" },
    { id:"pb_pc_send_down_payment",   label:"Send Down Payment to Appropriate Carriers" },
    { id:"pb_pc_master_cert",         label:"Create Master Certificate" },
    { id:"pb_pc_pin_note",            label:"Create Pinned Note with Endorsement Form Numbers" },
    { id:"pb_pc_save_forms",          label:"Save Individual Forms to EZLYNX for Cert Purposes (AI, WVR, Primary, Per Project, Etc.)" },
    { id:"pb_pc_auto_id_cards",       label:"Send Insured AUTO ID CARDS" },
    { id:"pb_pc_certs",               label:"Create Certificates and/or Update Renewal Certificates and Send to Client" },
    { id:"pb_pc_welcome_email",       label:"Send Welcome Email with Copies of All Policies, Service Documents, Auto ID Cards, Etc." },
    { id:"pb_pc_coverage_comparison", label:"Update Client's Coverage Comparison Chart" },
  ],
};

const STAGE_TEMPLATE_KEYS = [
  { key:"annual_review",   label:"Annual Review",           color:"#6366f1" },
  { key:"submission_prep", label:"Submission Prep",         color:"#f59e0b" },
  { key:"marketing",       label:"Marketing",               color:"#10b981" },
  { key:"proposal",        label:"Proposal",                color:"#3b82f6" },
  { key:"binding",         label:"Binding",                 color:"#ef4444" },
  { key:"post_bind_wc",    label:"Post-Bind — Workers Comp",color:"#a855f7" },
  { key:"post_bind_pc",    label:"Post-Bind — P&C",         color:"#a855f7" },
];

const AGENTS            = ["JB","GM","TS","JG","Gerald"];
const ACCOUNT_MANAGERS  = ["Gabriella","Annie"];
const POLICY_TYPES      = ["New","Renewal"];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const isWC = (lob) => lob === "Workers Comp";
const postBindTpl = (lob, tpl) => isWC(lob) ? tpl.post_bind_wc : tpl.post_bind_pc;
const getStageTpl = (stage, lob, tpl) => stage === "post_bind" ? postBindTpl(lob, tpl) : (tpl[stage] || []);

function getDaysOut(d) { return Math.ceil((new Date(d) - new Date()) / 86400000); }
function expectedStage(d) {
  if (d > 120) return "annual_review";
  if (d > 90)  return "submission_prep";
  if (d > 60)  return "marketing";
  if (d > 30)  return "proposal";
  return "binding";
}
const stageIdx = (id) => STAGES.findIndex(s => s.id === id);

function getHealth(a, tpl) {
  if (a.stage === "post_bind") {
    const ts = postBindTpl(a.lob, tpl);
    const pct = ts.length ? ts.filter(t => a.tasks[t.id]).length / ts.length : 1;
    return pct === 1 ? "green" : pct >= 0.5 ? "yellow" : "red";
  }
  const d = getDaysOut(a.expirationDate);
  if (d <= 95 && !a.tasks["loss_run_request"]) return "red";
  const ei = stageIdx(expectedStage(d)), ci = stageIdx(a.stage);
  if (ci < ei) return "red";
  if (ci === ei) {
    const ts = tpl[a.stage] || [];
    if (ts.length && ts.filter(t => a.tasks[t.id]).length / ts.length < 0.5) return "yellow";
  }
  return "green";
}

function getHealthReason(a, tpl) {
  if (a.stage === "post_bind") {
    const rem = postBindTpl(a.lob, tpl).filter(t => !a.tasks[t.id]).length;
    return rem ? `${rem} post-bind task${rem > 1 ? "s" : ""} remaining` : null;
  }
  const d = getDaysOut(a.expirationDate);
  if (d <= 95 && !a.tasks["loss_run_request"])
    return `⚠ Loss Run Request overdue — must be sent by 95 days out (${d}d remaining)`;
  const ei = stageIdx(expectedStage(d)), ci = stageIdx(a.stage);
  if (ci < ei) return `Stage behind — should be in ${STAGES[ei]?.label} at ${d} days out`;
  return null;
}

function getProgress(a, tpl) {
  const ts = getStageTpl(a.stage, a.lob, tpl);
  const done = ts.filter(t => a.tasks[t.id]).length;
  const cDone  = a.stage === "marketing" ? (a.carriers||[]).filter(c => c.quoted).length : 0;
  const cTotal = a.stage === "marketing" ? (a.carriers||[]).length : 0;
  return { completed: done + cDone, total: ts.length + cTotal };
}

// DB row ↔ app object mappers
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
    stage:          r.stage           || "annual_review",
    notes:          r.notes           || "",
    tasks:          typeof r.tasks    === "string" ? JSON.parse(r.tasks)           : (r.tasks    || {}),
    carriers:       typeof r.carriers === "string" ? JSON.parse(r.carriers)        : (r.carriers || []),
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
    stage:           a.stage,
    notes:           a.notes || "",
    tasks:           JSON.stringify(a.tasks    || {}),
    carriers:        JSON.stringify(a.carriers || []),
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

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const SC = { red:"#ef4444", yellow:"#f59e0b", green:"#10b981" };
const SL = { red:"Behind",  yellow:"At Risk",  green:"On Track" };
const stageColor = Object.fromEntries(STAGES.map(s => [s.id, s.color]));

const S = {
  app:      { minHeight:"100vh", background:"#0a0e1a", color:"#e2e8f0", fontFamily:"'IBM Plex Mono','Courier New',monospace", fontSize:"13px" },
  header:   { background:"#0f1629", borderBottom:"1px solid #1e2d4a", padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", height:"56px" },
  logo:     { color:"#60a5fa", fontWeight:700, fontSize:"15px", letterSpacing:"0.05em" },
  logoSub:  { color:"#475569", fontSize:"11px", marginLeft:"8px" },
  navBtn:   a => ({ background:a?"#1e3a5f":"transparent", color:a?"#60a5fa":"#64748b", border:"none", padding:"6px 14px", borderRadius:"4px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit" }),
  addBtn:   (bg="#1e40af",fg="#bfdbfe") => ({ background:bg, color:fg, border:"none", padding:"6px 14px", borderRadius:"4px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit", marginLeft:"6px" }),
  main:     { padding:"20px 24px" },
  grid5:    { display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:"12px", marginBottom:"20px" },
  statCard: c => ({ background:"#0f1629", border:`1px solid ${c}22`, borderTop:`2px solid ${c}`, padding:"14px 16px", borderRadius:"6px", cursor:"pointer" }),
  sLabel:   { color:"#64748b", fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"6px" },
  sVal:     c => ({ color:c, fontSize:"22px", fontWeight:700 }),
  sSub:     { color:"#475569", fontSize:"10px", marginTop:"2px" },
  filters:  { display:"flex", gap:"10px", marginBottom:"16px", alignItems:"center", flexWrap:"wrap" },
  fSel:     { background:"#0f1629", color:"#94a3b8", border:"1px solid #1e2d4a", padding:"6px 10px", borderRadius:"4px", fontSize:"12px", fontFamily:"inherit", cursor:"pointer" },
  searchI:  { background:"#0f1629", color:"#e2e8f0", border:"1px solid #1e2d4a", padding:"6px 12px", borderRadius:"4px", fontSize:"12px", fontFamily:"inherit", width:"200px" },
  table:    { width:"100%", borderCollapse:"collapse" },
  th:       { background:"#0a0e1a", color:"#475569", fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase", padding:"8px 12px", textAlign:"left", borderBottom:"1px solid #1e2d4a", whiteSpace:"nowrap" },
  tr:       h => ({ background:h==="red"?"#1a0a0a":"#0f1629", borderBottom:"1px solid #131c2e", cursor:"pointer" }),
  td:       { padding:"10px 12px", verticalAlign:"middle" },
  dot:      h => ({ width:"8px", height:"8px", borderRadius:"50%", background:SC[h], display:"inline-block", marginRight:"6px", boxShadow:`0 0 6px ${SC[h]}` }),
  pill:     s => ({ background:`${stageColor[s]||"#475569"}22`, color:stageColor[s]||"#475569", border:`1px solid ${stageColor[s]||"#475569"}44`, padding:"2px 8px", borderRadius:"10px", fontSize:"10px", whiteSpace:"nowrap" }),
  pBar:     { background:"#1e2d4a", borderRadius:"2px", height:"4px", width:"80px", overflow:"hidden" },
  pFill:    (p,h) => ({ width:`${p*100}%`, height:"100%", background:SC[h], borderRadius:"2px" }),
  wItem:    h => ({ background:"#0f1629", border:`1px solid ${h==="red"?"#ef444433":"#1e2d4a"}`, borderLeft:`3px solid ${SC[h]}`, borderRadius:"4px", padding:"12px 16px", display:"flex", alignItems:"center", gap:"16px", cursor:"pointer" }),
  dHead:    { background:"#0f1629", borderBottom:"1px solid #1e2d4a", padding:"16px 24px", display:"flex", alignItems:"center", gap:"16px", flexWrap:"wrap" },
  backBtn:  { background:"transparent", color:"#60a5fa", border:"1px solid #1e3a5f", padding:"5px 12px", borderRadius:"4px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit" },
  dBody:    { display:"grid", gridTemplateColumns:"280px 1fr", minHeight:"calc(100vh - 112px)" },
  sidebar:  { background:"#080c18", borderRight:"1px solid #1e2d4a", padding:"20px" },
  sdSec:    { marginBottom:"20px" },
  sdLabel:  { color:"#475569", fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"8px" },
  sdBig:    { color:"#e2e8f0", fontSize:"14px", fontWeight:600 },
  stOpt:    (a,c) => ({ background:a?`${c}22`:"transparent", color:a?c:"#475569", border:`1px solid ${a?c+"44":"#1e2d4a"}`, padding:"6px 10px", borderRadius:"4px", cursor:"pointer", fontSize:"11px", fontFamily:"inherit", textAlign:"left", width:"100%", marginBottom:"4px" }),
  content:  { padding:"20px 24px" },
  tabs:     { display:"flex", gap:"4px", marginBottom:"20px", borderBottom:"1px solid #1e2d4a" },
  tab:      a => ({ background:"transparent", color:a?"#60a5fa":"#475569", border:"none", borderBottom:`2px solid ${a?"#60a5fa":"transparent"}`, padding:"8px 16px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit", marginBottom:"-1px" }),
  tRow:     d => ({ display:"flex", alignItems:"center", gap:"10px", padding:"10px 14px", background:d?"#0a1a0a":"#0f1629", border:`1px solid ${d?"#10b98122":"#1e2d4a"}`, borderRadius:"4px", marginBottom:"6px", cursor:"pointer" }),
  chk:      d => ({ width:"16px", height:"16px", border:`1px solid ${d?"#10b981":"#334155"}`, borderRadius:"3px", background:d?"#10b981":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }),
  tLabel:   d => ({ color:d?"#64748b":"#94a3b8", textDecoration:d?"line-through":"none", fontSize:"12px" }),
  dGrid:    { display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" },
  dField:   { background:"#080c18", border:"1px solid #1e2d4a", borderRadius:"4px", padding:"12px 14px" },
  fLbl:     { color:"#475569", fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"4px" },
  fVal:     { color:"#e2e8f0", fontSize:"13px" },
  textarea: { background:"#080c18", color:"#e2e8f0", border:"1px solid #1e2d4a", borderRadius:"4px", padding:"12px", width:"100%", fontFamily:"inherit", fontSize:"12px", resize:"vertical", minHeight:"120px", boxSizing:"border-box" },
  smBtn:    (bg,c,bc) => ({ background:bg, color:c, border:`1px solid ${bc}`, borderRadius:"3px", padding:"3px 8px", fontSize:"10px", cursor:"pointer", fontFamily:"inherit" }),
  mBg:      { position:"fixed", inset:0, background:"#000000aa", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 },
  mBox:     { background:"#0f1629", border:"1px solid #1e3a5f", borderRadius:"8px", padding:"24px", width:"500px", maxHeight:"80vh", overflowY:"auto" },
  mTitle:   { color:"#60a5fa", fontSize:"14px", fontWeight:600, marginBottom:"20px", letterSpacing:"0.03em" },
  mRow:     { marginBottom:"14px" },
  mLabel:   { color:"#64748b", fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"5px", display:"block" },
  mInput:   { background:"#080c18", color:"#e2e8f0", border:"1px solid #1e2d4a", borderRadius:"4px", padding:"7px 10px", width:"100%", fontFamily:"inherit", fontSize:"12px", boxSizing:"border-box" },
  mSel:     { background:"#080c18", color:"#e2e8f0", border:"1px solid #1e2d4a", borderRadius:"4px", padding:"7px 10px", width:"100%", fontFamily:"inherit", fontSize:"12px", boxSizing:"border-box" },
  mActs:    { display:"flex", gap:"10px", justifyContent:"flex-end", marginTop:"20px" },
  cancelBtn:{ background:"transparent", color:"#64748b", border:"1px solid #1e2d4a", padding:"7px 16px", borderRadius:"4px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit" },
  saveBtn:  { background:"#1e40af", color:"#bfdbfe", border:"none", padding:"7px 16px", borderRadius:"4px", cursor:"pointer", fontSize:"12px", fontFamily:"inherit" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Settings sub-component
// ─────────────────────────────────────────────────────────────────────────────
function SettingsView({ tpl, setTpl, defaultTasks, onSaveTpl }) {
  const [activeKey, setActiveKey] = useState(STAGE_TEMPLATE_KEYS[0].key);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const [newText, setNewText] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [saving, setSaving] = useState(false);

  const meta  = STAGE_TEMPLATE_KEYS.find(s => s.key === activeKey);
  const tasks = tpl[activeKey] || [];
  const changed = JSON.stringify(tpl[activeKey]) !== JSON.stringify(defaultTasks[activeKey]);

  function updTasks(newTasks) { setTpl(p => ({ ...p, [activeKey]: newTasks })); }
  function addTask() {
    if (!newText.trim()) return;
    updTasks([...tasks, { id: activeKey + "_" + Date.now(), label: newText.trim() }]);
    setNewText("");
  }
  function saveEdit(id) {
    if (!editText.trim()) return;
    updTasks(tasks.map(t => t.id === id ? { ...t, label: editText.trim() } : t));
    setEditId(null);
  }
  function deleteTask(id) { updTasks(tasks.filter(t => t.id !== id)); }
  function moveTask(from, to) {
    if (from === to) return;
    const n = [...tasks]; const [m] = n.splice(from, 1); n.splice(to, 0, m); updTasks(n);
  }
  function resetStage() { setTpl(p => ({ ...p, [activeKey]: defaultTasks[activeKey] })); setShowReset(false); }

  async function handleSave() {
    setSaving(true);
    try { await onSaveTpl(activeKey, tpl[activeKey]); } finally { setSaving(false); }
  }

  return (
    <div style={{ display:"grid", gridTemplateColumns:"240px 1fr", marginTop:"-20px", marginLeft:"-24px", marginRight:"-24px", minHeight:"calc(100vh - 56px - 40px)" }}>
      <div style={{ background:"#080c18", borderRight:"1px solid #1e2d4a", padding:"20px" }}>
        <div style={{ color:"#60a5fa", fontSize:"10px", letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:700, marginBottom:"12px" }}>Process Templates</div>
        <div style={{ color:"#475569", fontSize:"10px", marginBottom:"14px", lineHeight:"1.5" }}>Edit tasks for each stage. Save changes to sync to all users.</div>
        {STAGE_TEMPLATE_KEYS.map(s => {
          const isDiff = JSON.stringify(tpl[s.key]) !== JSON.stringify(defaultTasks[s.key]);
          return (
            <button key={s.key} style={S.stOpt(activeKey===s.key, s.color)} onClick={() => { setActiveKey(s.key); setEditId(null); setNewText(""); }}>
              <span style={{ flex:1, textAlign:"left" }}>{s.label}</span>
              {isDiff && <span style={{ width:6, height:6, borderRadius:"50%", background:s.color, display:"inline-block", marginRight:4 }}/>}
              <span style={{ color:"#334155", fontSize:"10px" }}>{(tpl[s.key]||[]).length}</span>
            </button>
          );
        })}
      </div>

      <div style={{ padding:"24px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"20px" }}>
          <div>
            <div style={{ color:meta.color, fontSize:"16px", fontWeight:700 }}>{meta.label}</div>
            <div style={{ color:"#475569", fontSize:"11px", marginTop:3 }}>{tasks.length} tasks · drag to reorder</div>
          </div>
          <div style={{ display:"flex", gap:"8px" }}>
            {changed && <button style={{ ...S.cancelBtn, color:"#f59e0b", borderColor:"#f59e0b44" }} onClick={() => setShowReset(true)}>↺ Reset</button>}
            <button style={{ ...S.saveBtn, opacity: saving ? 0.6 : 1 }} onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "💾 Save to Database"}
            </button>
          </div>
        </div>

        <div style={{ marginBottom:16 }}>
          {tasks.map((task, idx) => (
            <div key={task.id} draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={e => { e.preventDefault(); setDragOver(idx); }}
              onDrop={e => { e.preventDefault(); moveTask(dragIdx, idx); setDragOver(null); setDragIdx(null); }}
              onDragEnd={() => { setDragOver(null); setDragIdx(null); }}
              style={{ background: dragOver===idx?"#1a2a1a":"#0f1629", border:`1px solid ${dragOver===idx?"#10b98144":"#1e2d4a"}`, borderRadius:4, padding:"10px 14px", marginBottom:4, display:"flex", alignItems:"center", gap:12, cursor:"grab" }}>
              <span style={{ color:"#334155", flexShrink:0 }}>⠿</span>
              <span style={{ color:"#334155", fontSize:"10px", minWidth:20, textAlign:"right", flexShrink:0 }}>{idx+1}.</span>
              {editId === task.id
                ? <input autoFocus style={{ ...S.mInput, flex:1, padding:"4px 8px" }} value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => { if(e.key==="Enter") saveEdit(task.id); if(e.key==="Escape") setEditId(null); }}/>
                : <span style={{ color:"#94a3b8", fontSize:"12px", flex:1, lineHeight:1.4 }}>{task.label}</span>
              }
              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                {editId === task.id ? (
                  <>
                    <button style={S.smBtn("#1e40af","#bfdbfe","transparent")} onClick={() => saveEdit(task.id)}>Save</button>
                    <button style={S.smBtn("transparent","#64748b","#1e2d4a")} onClick={() => setEditId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button style={S.smBtn("transparent","#475569","#1e2d4a")} onClick={() => { setEditId(task.id); setEditText(task.label); }}>Edit</button>
                    <button style={S.smBtn("transparent","#475569","#1e2d4a")} onClick={() => moveTask(idx, Math.max(0,idx-1))} disabled={idx===0}>↑</button>
                    <button style={S.smBtn("transparent","#475569","#1e2d4a")} onClick={() => moveTask(idx, Math.min(tasks.length-1,idx+1))} disabled={idx===tasks.length-1}>↓</button>
                    <button style={S.smBtn("transparent","#ef4444","#ef444433")} onClick={() => deleteTask(task.id)}>✕</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display:"flex", gap:8, padding:14, background:"#080c18", border:"1px solid #1e2d4a", borderRadius:4 }}>
          <input style={{ ...S.mInput, flex:1 }} placeholder={`Add new task to ${meta.label}...`} value={newText}
            onChange={e => setNewText(e.target.value)} onKeyDown={e => e.key==="Enter" && addTask()}/>
          <button style={{ ...S.saveBtn, opacity: newText.trim() ? 1 : 0.4 }} onClick={addTask}>+ Add</button>
        </div>

        <div style={{ marginTop:16, padding:"10px 14px", background:"#080c18", border:"1px solid #1e2d4a", borderRadius:4, color:"#475569", fontSize:"11px", lineHeight:1.6 }}>
          <span style={{ color:"#60a5fa" }}>ℹ</span> Click <b style={{ color:"#e2e8f0" }}>Save to Database</b> after editing to sync changes to all users. Changes only affect new accounts or accounts that advance stages after saving.
        </div>
      </div>

      {showReset && (
        <div style={S.mBg}>
          <div style={{ ...S.mBox, width:380 }}>
            <div style={{ color:"#f59e0b", fontSize:"14px", fontWeight:600, marginBottom:12 }}>Reset to Default?</div>
            <div style={{ color:"#64748b", fontSize:"12px", marginBottom:20 }}>This restores the original task list for <b style={{ color:"#e2e8f0" }}>{meta.label}</b>. Custom tasks will be removed.</div>
            <div style={S.mActs}>
              <button style={S.cancelBtn} onClick={() => setShowReset(false)}>Cancel</button>
              <button style={{ ...S.saveBtn, background:"#2a1a00", color:"#f59e0b", border:"1px solid #f59e0b44" }} onClick={resetStage}>↺ Reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function RenewalPipeline() {

  // ── Data state ──────────────────────────────────────────────────────────────
  const [tpl,      setTpl]      = useState(DEFAULT_TASKS);
  const [accounts, setAccounts] = useState([]);
  const [archived, setArchived] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [dbErr,    setDbErr]    = useState(null);
  const [syncing,  setSyncing]  = useState({}); // { [id]: true } while saving

  // ── UI state ────────────────────────────────────────────────────────────────
  const [view,    setView]   = useState("dashboard");
  const [selId,   setSelId]  = useState(null);
  const [tab,     setTab]    = useState("tasks");
  const [fAM,     setFAM]    = useState("All");
  const [fAgent,  setFAgent] = useState("All");
  const [fStage,  setFStage] = useState("All");
  const [fHealth, setFHealth]= useState("All");
  const [search,  setSearch] = useState("");
  const [newCar,    setNewCar]   = useState("");
  const [editCId,   setEditCId]  = useState(null);
  const [editCName, setEditCName]= useState("");
  const [expCId,    setExpCId]   = useState(null);
  const [showAdd,   setShowAdd]  = useState(false);
  const [newAcct,   setNewAcct]  = useState({ name:"",agent:"JB",accountManager:"Gabriella",policyType:"Renewal",lob:"General Liability",masterCompany:"Travelers",policyNumber:"",expirationDate:"",premium:"",stage:"annual_review",notes:"" });
  const [showDelete, setShowDelete] = useState(false);
  const [showCO,    setShowCO]   = useState(false);
  const [coData,    setCoData]   = useState({ boundCarrier:"",boundPremium:"",notes:"" });
  const [showPB,    setShowPB]   = useState(false);
  const [pbData,    setPbData]   = useState({ boundCarrier:"",boundPremium:"" });
  const [archSearch,setArchSearch] = useState("");
  const [expArch,   setExpArch]    = useState(null);
  const [showImport,  setShowImport]   = useState(false);
  const [importRows,  setImportRows]   = useState([]);
  const [importErrors,setImportErrors] = useState([]);
  const [importFile,  setImportFile]   = useState(null);

  // ── Initial load from Supabase ──────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      if (SUPABASE_URL === "YOUR_SUPABASE_URL") {
        setDbErr("not_configured");
        setLoading(false);
        return;
      }
      try {
        const [accts, arch, tpls] = await Promise.all([
          sb.select("accounts", "order=created_at.asc"),
          sb.select("archived_accounts", "order=created_at.asc"),
          sb.select("task_templates"),
        ]);
        setAccounts((accts || []).map(dbToAccount));
        setArchived((arch  || []).map(dbToArchived));
        if (tpls && tpls.length) {
          const merged = { ...DEFAULT_TASKS };
          tpls.forEach(t => { merged[t.stage_key] = typeof t.tasks === "string" ? JSON.parse(t.tasks) : t.tasks; });
          setTpl(merged);
        }
      } catch(e) {
        setDbErr(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Realtime subscription ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = sb.realtime((change) => {
      const { eventType, table, new: nr, old: or } = change;
      if (table === "accounts") {
        if (eventType === "INSERT") setAccounts(p => p.find(x=>x.id===nr.id) ? p : [...p, dbToAccount(nr)]);
        if (eventType === "UPDATE") setAccounts(p => p.map(x => x.id===nr.id ? dbToAccount(nr) : x));
        if (eventType === "DELETE") setAccounts(p => p.filter(x => x.id !== or.id));
      }
      if (table === "archived_accounts") {
        if (eventType === "INSERT") setArchived(p => p.find(x=>x.id===nr.id) ? p : [...p, dbToArchived(nr)]);
        if (eventType === "UPDATE") setArchived(p => p.map(x => x.id===nr.id ? dbToArchived(nr) : x));
      }
      if (table === "task_templates" && nr) {
        setTpl(p => ({ ...p, [nr.stage_key]: typeof nr.tasks==="string"?JSON.parse(nr.tasks):nr.tasks }));
      }
    });
    return unsub;
  }, []);

  // ── Optimistic-update + async save ─────────────────────────────────────────
  function upd(id, fn) {
    let updated;
    setAccounts(prev => {
      const next = prev.map(a => { if (a.id !== id) return a; updated = fn(a); return updated; });
      return next;
    });
    // save after state is set
    setTimeout(async () => {
      if (!updated) return;
      setSyncing(p => ({ ...p, [id]: true }));
      try { await sb.update("accounts", id, accountToDb(updated)); }
      catch(e) { console.error("Save failed:", e); }
      finally { setSyncing(p => { const n={...p}; delete n[id]; return n; }); }
    }, 0);
  }

  const toggleTask    = (id,tid)  => upd(id, a => ({ ...a, tasks:{...a.tasks,[tid]:!a.tasks[tid]} }));
  const setStageFor   = (id,s)    => upd(id, a => ({ ...a, stage:s }));
  const setNotesFor   = (id,n)    => upd(id, a => ({ ...a, notes:n }));
  const toggleCarrier = (id,cid)  => upd(id, a => ({ ...a, carriers:(a.carriers||[]).map(c => {
    if (c.id!==cid) return c;
    const nx = !c.submitted?{submitted:true,quoted:false}:!c.quoted?{submitted:true,quoted:true}:{submitted:false,quoted:false};
    return {...c,...nx};
  })}));
  const addCarrier    = (id,name) => upd(id, a => ({ ...a, carriers:[...(a.carriers||[]),{id:"c_"+Date.now(),name,submitted:false,quoted:false,notes:""}] }));
  const editCarrier   = (id,cid,name) => upd(id, a => ({ ...a, carriers:(a.carriers||[]).map(c=>c.id===cid?{...c,name}:c) }));
  const removeCarrier = (id,cid)  => upd(id, a => ({ ...a, carriers:(a.carriers||[]).filter(c=>c.id!==cid) }));
  const setCarNote    = (id,cid,notes) => upd(id, a => ({ ...a, carriers:(a.carriers||[]).map(c=>c.id===cid?{...c,notes}:c) }));

  // ── Add account ─────────────────────────────────────────────────────────────
  async function addAccount() {
    const row = { ...accountToDb({ ...newAcct, premium:Number(newAcct.premium)||0, tasks:{}, carriers:[], renewalHistory:[] }) };
    try {
      const res = await sb.insert("accounts", row);
      const inserted = Array.isArray(res) ? res[0] : res;
      if (inserted) setAccounts(p => [...p, dbToAccount(inserted)]);
    } catch(e) { alert("Error adding account: " + e.message); }
    setShowAdd(false);
    setNewAcct({ name:"",agent:"JB",accountManager:"Gabriella",policyType:"Renewal",lob:"General Liability",masterCompany:"Travelers",policyNumber:"",expirationDate:"",premium:"",stage:"annual_review",notes:"" });
  }

  // ── Delete account ──────────────────────────────────────────────────────────
  async function deleteAccount(acctId) {
    try { await sb.delete("accounts", acctId); setAccounts(p => p.filter(x => x.id !== acctId)); }
    catch(e) { alert("Error deleting account: " + e.message); return; }
    setShowDelete(false); setView("dashboard"); setSelId(null);
  }

  // ── Move to Post-Bind ───────────────────────────────────────────────────────
  function moveToPostBind(acctId) {
    upd(acctId, a => ({
      ...a, stage:"post_bind",
      notes: a.notes + (a.notes?"\n":"") + `Bound with ${pbData.boundCarrier} at $${Number(pbData.boundPremium).toLocaleString()} — moved to Post-Bind ${new Date().toLocaleDateString()}`,
      masterCompany: pbData.boundCarrier || a.masterCompany,
      premium: Number(pbData.boundPremium) || Number(a.premium),
    }));
    setShowPB(false); setPbData({ boundCarrier:"", boundPremium:"" }); setTab("tasks");
  }

  // ── Close out & archive ─────────────────────────────────────────────────────
  async function closeOut(acctId) {
    const a = accounts.find(x => x.id === acctId); if (!a) return;
    const entry = {
      year: new Date(a.expirationDate).getFullYear(),
      expirationDate: a.expirationDate,
      premium: Number(a.premium),
      boundCarrier: coData.boundCarrier || a.masterCompany,
      boundPremium: Number(coData.boundPremium) || Number(a.premium),
      carriers: (a.carriers||[]).map(c=>({name:c.name,submitted:!!c.submitted,quoted:!!c.quoted,notes:c.notes||""})),
      notes: coData.notes,
      accountManager: a.accountManager,
      agent: a.agent,
      closedAt: new Date().toLocaleDateString(),
    };
    try {
      // Check if already archived
      const existing = archived.find(x => x.name === a.name);
      if (existing) {
        const updHist = [entry, ...(existing.renewalHistory||[])];
        await sb.update("archived_accounts", existing.id, { renewal_history: JSON.stringify(updHist) });
        setArchived(p => p.map(x => x.id===existing.id ? { ...x, renewalHistory:updHist } : x));
      } else {
        const res = await sb.insert("archived_accounts", {
          name: a.name, lob: a.lob, master_company: a.masterCompany,
          account_manager: a.accountManager, agent: a.agent,
          renewal_history: JSON.stringify([entry]),
        });
        const inserted = Array.isArray(res) ? res[0] : res;
        if (inserted) setArchived(p => [...p, dbToArchived(inserted)]);
      }
      await sb.delete("accounts", acctId);
      setAccounts(p => p.filter(x => x.id !== acctId));
    } catch(e) { alert("Error closing out account: " + e.message); return; }
    setShowCO(false); setCoData({boundCarrier:"",boundPremium:"",notes:""}); setView("dashboard"); setSelId(null);
  }

  // ── Save task template to DB ────────────────────────────────────────────────
  async function saveTplToDb(stageKey, tasks) {
    try {
      await sb.upsert("task_templates", { stage_key: stageKey, tasks: JSON.stringify(tasks) }, "stage_key");
    } catch(e) { alert("Error saving template: " + e.message); }
  }

  // ── Bulk import ─────────────────────────────────────────────────────────────
  const STAGE_MAP = { "annual review":"annual_review","submission prep":"submission_prep","marketing":"marketing","proposal":"proposal","binding":"binding","post-bind":"post_bind","post bind":"post_bind" };

  function parseImportFile(file) {
    setImportFile(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const XLSX = window.XLSX;
        if (!XLSX) { setImportErrors([{row:0,name:"Error",msgs:["SheetJS not loaded — please refresh"]}]); return; }
        const rows = XLSX.utils.sheet_to_json(XLSX.read(new Uint8Array(e.target.result),{type:"array",cellDates:true}).Sheets[XLSX.read(new Uint8Array(e.target.result),{type:"array"}).SheetNames[0]],{defval:""});
        const parsed=[]; const errors=[];
        rows.forEach((row,ri) => {
          const n={};
          Object.keys(row).forEach(k => { n[k.trim().toLowerCase()] = row[k]; });
          const name=String(n["account name"]||"").trim(), pNum=String(n["policy number"]||"").trim(),
                expRaw=n["expiration date"], premRaw=n["annual premium"],
                lob=String(n["line of business"]||"").trim(), carrier=String(n["master company"]||"").trim(),
                agent=String(n["assigned agent"]||"").trim(), am=String(n["account manager"]||"").trim(),
                pt=String(n["policy type"]||"Renewal").trim(),
                stageRaw=String(n["starting stage"]||"").trim().toLowerCase(),
                notes=String(n["notes"]||"").trim();
          const errs=[];
          if(!name) errs.push("Account Name required");
          if(!lob)  errs.push("Line of Business required");
          if(!carrier) errs.push("Master Company required");
          if(!agent)   errs.push("Assigned Agent required");
          if(!am)      errs.push("Account Manager required");
          let expDate="";
          if(expRaw instanceof Date) expDate=expRaw.toISOString().slice(0,10);
          else if(expRaw){ const d=new Date(expRaw); if(!isNaN(d)) expDate=d.toISOString().slice(0,10); else errs.push("Bad date format"); }
          else errs.push("Expiration Date required");
          const premium=Number(String(premRaw).replace(/[$,]/g,""))||0;
          if(!premRaw && premRaw!==0) errs.push("Annual Premium required");
          if(errs.length) errors.push({row:ri+2,name:name||`Row ${ri+2}`,msgs:errs});
          parsed.push({_rowNum:ri+2,_valid:!errs.length,name,policyNumber:pNum,expirationDate:expDate,premium,lob,masterCompany:carrier,agent,accountManager:am,policyType:pt||"Renewal",stage:STAGE_MAP[stageRaw]||"annual_review",notes});
        });
        setImportRows(parsed); setImportErrors(errors);
      } catch(err) { setImportErrors([{row:0,name:"File Error",msgs:[String(err)]}]); }
    };
    reader.readAsArrayBuffer(file);
  }

  async function commitImport() {
    const valid = importRows.filter(r => r._valid);
    try {
      for (const r of valid) {
        const res = await sb.insert("accounts", accountToDb({ ...r, tasks:{}, carriers:[], renewalHistory:[] }));
        const inserted = Array.isArray(res) ? res[0] : res;
        if (inserted) setAccounts(p => [...p, dbToAccount(inserted)]);
      }
    } catch(e) { alert("Import error: " + e.message); return; }
    setShowImport(false); setImportRows([]); setImportErrors([]); setImportFile(null);
  }

  // ── Derived state ───────────────────────────────────────────────────────────
  const enriched = useMemo(() => accounts.map(a => ({
    ...a,
    daysOut:      getDaysOut(a.expirationDate),
    health:       getHealth(a, tpl),
    healthReason: getHealthReason(a, tpl),
    progress:     getProgress(a, tpl),
  })), [accounts, tpl]);

  const acct = useMemo(() => selId ? enriched.find(a=>a.id===selId)||null : null, [enriched,selId]);

  const filtered = useMemo(() => enriched.filter(a => {
    if (fAM    !=="All" && a.accountManager!==fAM)    return false;
    if (fAgent !=="All" && a.agent         !==fAgent) return false;
    if (fStage !=="All" && a.stage         !==fStage) return false;
    if (fHealth!=="All" && a.health        !==fHealth)return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a,b) => {
    if (a.stage==="post_bind"&&b.stage!=="post_bind") return 1;
    if (a.stage!=="post_bind"&&b.stage==="post_bind") return -1;
    return a.daysOut - b.daysOut;
  }), [enriched,fAM,fAgent,fStage,fHealth,search]);

  const stats = useMemo(() => ({
    total:    enriched.length,
    red:      enriched.filter(a=>a.health==="red").length,
    yellow:   enriched.filter(a=>a.health==="yellow").length,
    postBind: enriched.filter(a=>a.stage==="post_bind").length,
    tPrem:    enriched.reduce((s,a)=>s+Number(a.premium),0),
    rPrem:    enriched.filter(a=>a.health==="red").reduce((s,a)=>s+Number(a.premium),0),
  }), [enriched]);

  const pipeCounts = useMemo(() => STAGES.map(s => ({
    ...s,
    count:   enriched.filter(a=>a.stage===s.id).length,
    premium: enriched.filter(a=>a.stage===s.id).reduce((x,a)=>x+Number(a.premium),0),
  })), [enriched]);

  function openAccount(a)  { setSelId(a.id); setTab("tasks"); setExpCId(null); setNewCar(""); setEditCId(null); setView("account"); }
  function clearFilters()  { setFAM("All"); setFAgent("All"); setFStage("All"); setFHealth("All"); setSearch(""); }
  const hasF = fAM!=="All"||fAgent!=="All"||fStage!=="All"||fHealth!=="All"||search;

  // ── Loading / error screens ─────────────────────────────────────────────────
  if (loading) return (
    <div style={{ ...S.app, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16, minHeight:"100vh" }}>
      <div style={{ color:"#60a5fa", fontSize:"24px" }}>◌</div>
      <div style={{ color:"#475569" }}>Connecting to database…</div>
    </div>
  );

  if (dbErr === "not_configured") return (
    <div style={{ ...S.app, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh" }}>
      <div style={{ background:"#0f1629", border:"1px solid #1e3a5f", borderRadius:8, padding:32, maxWidth:520 }}>
        <div style={{ color:"#f59e0b", fontSize:"16px", fontWeight:700, marginBottom:12 }}>⚙ Supabase Not Configured</div>
        <div style={{ color:"#64748b", fontSize:"12px", lineHeight:1.8 }}>
          Open <code style={{ color:"#60a5fa" }}>renewal-pipeline.jsx</code> and replace the two placeholders at the top of the file with your Supabase project values:<br/><br/>
          <code style={{ color:"#10b981", display:"block", background:"#080c18", padding:"10px 14px", borderRadius:4 }}>
            const SUPABASE_URL = "https://xxxx.supabase.co";<br/>
            const SUPABASE_ANON_KEY = "eyJhbGci...";
          </code>
          <br/>
          You can find both values in your Supabase project under <b style={{ color:"#e2e8f0" }}>Settings → API</b>.
          <br/><br/>
          See the <b style={{ color:"#e2e8f0" }}>SETUP.md</b> file for full instructions including the SQL to create your tables.
        </div>
      </div>
    </div>
  );

  if (dbErr) return (
    <div style={{ ...S.app, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh" }}>
      <div style={{ background:"#1a0a0a", border:"1px solid #ef444433", borderRadius:8, padding:32, maxWidth:480 }}>
        <div style={{ color:"#ef4444", fontSize:"14px", fontWeight:700, marginBottom:8 }}>Database Connection Error</div>
        <div style={{ color:"#94a3b8", fontSize:"11px", marginBottom:16 }}>{dbErr}</div>
        <button style={S.saveBtn} onClick={() => window.location.reload()}>↺ Retry</button>
      </div>
    </div>
  );

  // ── Account detail view ─────────────────────────────────────────────────────
  if (view === "account") {
    if (!acct) { setView("dashboard"); return null; }
    const tasks    = getStageTpl(acct.stage, acct.lob, tpl);
    const carriers = acct.carriers || [];
    const isPB     = acct.stage === "post_bind";
    const pbPct    = isPB && tasks.length ? Math.round(acct.progress.completed/tasks.length*100) : 0;
    const isSaving = !!syncing[acct.id];

    const carrierRow = (c) => {
      const st = c.quoted?"quoted":c.submitted?"submitted":"pending";
      const cs = {
        quoted:   {bg:"#0a1a0a",bdr:"#10b98133",pBg:"#10b98122",pC:"#10b981",pBdr:"#10b98155",lbl:"✓ Quoted"},
        submitted:{bg:"#0a0f1f",bdr:"#3b82f633",pBg:"#3b82f622",pC:"#3b82f6",pBdr:"#3b82f655",lbl:"→ Submitted"},
        pending:  {bg:"#0f1629",bdr:"#1e2d4a",  pBg:"#1e2d4a",  pC:"#475569",pBdr:"#334155",  lbl:"○ Pending"},
      }[st];
      return (
        <div key={c.id} style={{ marginBottom:6 }}>
          <div style={{ background:cs.bg, border:`1px solid ${cs.bdr}`, borderRadius:expCId===c.id?"4px 4px 0 0":"4px", padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
            <div onClick={() => toggleCarrier(acct.id,c.id)} style={{ background:cs.pBg,color:cs.pC,border:`1px solid ${cs.pBdr}`,borderRadius:10,padding:"2px 10px",fontSize:10,cursor:"pointer",minWidth:90,textAlign:"center",fontWeight:600 }}>{cs.lbl}</div>
            {editCId===c.id
              ? <input autoFocus style={{...S.mInput,flex:1,padding:"4px 8px"}} value={editCName} onChange={e=>setEditCName(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&editCName.trim()){editCarrier(acct.id,c.id,editCName.trim());setEditCId(null);}if(e.key==="Escape")setEditCId(null);}}
                  onClick={e=>e.stopPropagation()}/>
              : <span style={{color:c.quoted?"#64748b":"#94a3b8",textDecoration:c.quoted?"line-through":"none",flex:1,fontSize:12}}>{c.name}</span>
            }
            {c.notes&&<span style={{color:"#f59e0b",fontSize:10,background:"#f59e0b11",border:"1px solid #f59e0b33",borderRadius:3,padding:"1px 6px"}}>note</span>}
            <div style={{display:"flex",gap:6,marginLeft:"auto"}}>
              {editCId===c.id ? (
                <>
                  <button style={S.smBtn("#1e40af","#bfdbfe","transparent")} onClick={e=>{e.stopPropagation();if(editCName.trim()){editCarrier(acct.id,c.id,editCName.trim());setEditCId(null);}}}>Save</button>
                  <button style={S.smBtn("transparent","#64748b","#1e2d4a")} onClick={e=>{e.stopPropagation();setEditCId(null);}}>Cancel</button>
                </>
              ) : (
                <>
                  <button style={S.smBtn(expCId===c.id?"#0f2a1a":"transparent",expCId===c.id?"#10b981":"#475569",expCId===c.id?"#10b98133":"#1e2d4a")} onClick={e=>{e.stopPropagation();setExpCId(expCId===c.id?null:c.id);}}>{expCId===c.id?"▲":"▼"} Notes</button>
                  <button style={S.smBtn("transparent","#475569","#1e2d4a")} onClick={e=>{e.stopPropagation();setEditCId(c.id);setEditCName(c.name);}}>Edit</button>
                  <button style={S.smBtn("transparent","#ef4444","#ef444433")} onClick={e=>{e.stopPropagation();removeCarrier(acct.id,c.id);if(expCId===c.id)setExpCId(null);}}>✕</button>
                </>
              )}
            </div>
          </div>
          {expCId===c.id&&(
            <div style={{background:"#080c18",border:"1px solid #10b98133",borderTop:"none",borderRadius:"0 0 4px 4px",padding:"12px 14px"}}>
              <div style={{color:"#10b981",fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:8}}>Notes — {c.name}</div>
              <textarea style={{...S.textarea,minHeight:80,border:"1px solid #1e3a3a"}} value={c.notes||""} onChange={e=>setCarNote(acct.id,c.id,e.target.value)} placeholder="Underwriting notes, premium indication…"/>
            </div>
          )}
        </div>
      );
    };

    return (
      <div style={S.app}>
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
        <div style={S.dHead}>
          <button style={S.backBtn} onClick={() => setView("dashboard")}>← Back</button>
          <div>
            <div style={{color:"#e2e8f0",fontSize:16,fontWeight:700,display:"flex",alignItems:"center",gap:10}}>
              {acct.name}
              {isSaving && <span style={{color:"#475569",fontSize:10,fontWeight:400,border:"1px solid #1e2d4a",borderRadius:3,padding:"2px 8px"}}>saving…</span>}
            </div>
            <div style={{color:"#475569",fontSize:11}}>{acct.lob} · {acct.masterCompany} · {acct.policyNumber}</div>
          </div>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <span style={{...S.dot(acct.health)}}/>
            <span style={{color:SC[acct.health],fontSize:12}}>{SL[acct.health]}</span>
            <span style={{color:"#475569"}}>·</span>
            {isPB
              ? <span style={{color:"#a855f7",fontSize:12,fontWeight:600}}>Post-Bind: {pbPct}% complete</span>
              : <span style={{color:acct.daysOut<30?"#ef4444":"#94a3b8",fontSize:12}}>{acct.daysOut} days out</span>
            }
            <span style={{color:"#475569"}}>·</span>
            <span style={{color:"#60a5fa",fontSize:12}}>${Number(acct.premium).toLocaleString()}</span>
            {acct.stage==="binding" && (
              <button style={{background:"#1a0a2e",color:"#a855f7",border:"1px solid #a855f744",padding:"5px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}
                onClick={()=>{setPbData({boundCarrier:acct.masterCompany,boundPremium:acct.premium});setShowPB(true);}}>✓ Move to Post-Bind</button>
            )}
            {isPB && (
              <button style={{background:"#0f2a1a",color:"#10b981",border:"1px solid #10b98144",padding:"5px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}
                onClick={()=>{setCoData({boundCarrier:acct.masterCompany,boundPremium:acct.premium,notes:""});setShowCO(true);}}>✓ Close Out &amp; Archive</button>
            )}
            <button style={{background:"#1a0a0a",color:"#ef4444",border:"1px solid #ef444433",padding:"5px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"inherit"}} onClick={()=>setShowDelete(true)}>🗑 Delete</button>
          </div>
        </div>

        <div style={S.dBody}>
          <div style={S.sidebar}>
            <div style={S.sdSec}>
              <div style={S.sdLabel}>Current Stage</div>
              {STAGES.map(s=>(
                <button key={s.id} style={S.stOpt(acct.stage===s.id,s.color)} onClick={()=>setStageFor(acct.id,s.id)}>
                  {acct.stage===s.id?"▶ ":"  "}{s.label}
                  {s.id==="post_bind"&&<span style={{color:"#64748b",fontSize:9,marginLeft:4}}>{isWC(acct.lob)?"WC":"P&C"}</span>}
                </button>
              ))}
            </div>
            <div style={S.sdSec}>
              <div style={S.sdLabel}>Task Progress</div>
              <div style={{color:"#e2e8f0",fontSize:18,fontWeight:700}}>{acct.progress.completed}/{acct.progress.total}</div>
              <div style={{...S.pBar,width:"100%",marginTop:6}}><div style={S.pFill(acct.progress.total?acct.progress.completed/acct.progress.total:0,acct.health)}/></div>
            </div>
            <div style={S.sdSec}><div style={S.sdLabel}>Account Manager</div><div style={S.sdBig}>{acct.accountManager}</div></div>
            <div style={S.sdSec}><div style={S.sdLabel}>Producer</div><div style={S.sdBig}>{acct.agent}</div></div>
            <div style={S.sdSec}>
              <div style={S.sdLabel}>Expiration</div>
              <div style={S.sdBig}>{new Date(acct.expirationDate).toLocaleDateString()}</div>
              {!isPB&&<div style={{color:acct.daysOut<30?"#ef4444":"#64748b",fontSize:11,marginTop:2}}>{acct.daysOut} days remaining</div>}
            </div>
            {isPB&&<div style={S.sdSec}>
              <div style={S.sdLabel}>Post-Bind Type</div>
              <div style={{color:"#a855f7",fontSize:13,fontWeight:600}}>{isWC(acct.lob)?"Workers Comp":"P&C"}</div>
              <div style={{color:"#475569",fontSize:11,marginTop:2}}>{tasks.length-acct.progress.completed} tasks remaining</div>
            </div>}
          </div>

          <div style={S.content}>
            <div style={S.tabs}>
              {["tasks","details","notes","history"].map(t=>(
                <button key={t} style={S.tab(tab===t)} onClick={()=>setTab(t)}>
                  {t.charAt(0).toUpperCase()+t.slice(1)}
                  {t==="history"&&(acct.renewalHistory||[]).length>0&&<span style={{color:"#6366f1",marginLeft:4}}>({acct.renewalHistory.length})</span>}
                </button>
              ))}
            </div>

            {tab==="tasks"&&(
              <div>
                {isPB&&(
                  <div style={{background:"#1a0a2e",border:"1px solid #a855f744",borderLeft:"3px solid #a855f7",borderRadius:4,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div>
                      <div style={{color:"#a855f7",fontSize:11,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase"}}>Post-Bind Checklist — {isWC(acct.lob)?"Workers Comp":"P&C"}</div>
                      <div style={{color:"#64748b",fontSize:11,marginTop:3}}>{acct.progress.completed} of {tasks.length} tasks complete</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{color:"#a855f7",fontSize:22,fontWeight:700}}>{pbPct}%</div>
                      <div style={{...S.pBar,width:80,marginLeft:"auto",marginTop:4}}><div style={S.pFill(pbPct/100,acct.health)}/></div>
                    </div>
                  </div>
                )}
                {!isPB&&<div style={{color:"#475569",fontSize:11,marginBottom:14}}>Stage: <span style={{color:stageColor[acct.stage]}}>{STAGES.find(s=>s.id===acct.stage)?.label}</span></div>}
                {tasks.map(t=>{const done=acct.tasks[t.id];return(
                  <div key={t.id} style={S.tRow(done)} onClick={()=>toggleTask(acct.id,t.id)}>
                    <div style={S.chk(done)}>{done&&<span style={{color:"#0a0e1a",fontSize:10,fontWeight:700}}>✓</span>}</div>
                    <span style={S.tLabel(done)}>{t.label}</span>
                  </div>
                );})}
                {acct.stage==="marketing"&&(
                  <div style={{marginTop:20}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                      <div style={{color:"#10b981",fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:600}}>Carrier Marketing</div>
                      <div style={{display:"flex",gap:10}}>
                        <span style={{color:"#3b82f6",fontSize:10,background:"#3b82f611",border:"1px solid #3b82f633",borderRadius:3,padding:"1px 8px"}}>{carriers.filter(c=>c.submitted&&!c.quoted).length} submitted</span>
                        <span style={{color:"#10b981",fontSize:10,background:"#10b98111",border:"1px solid #10b98133",borderRadius:3,padding:"1px 8px"}}>{carriers.filter(c=>c.quoted).length} quoted</span>
                        <span style={{color:"#475569",fontSize:10}}>of {carriers.length}</span>
                      </div>
                    </div>
                    {carriers.map(c=>carrierRow(c))}
                    <div style={{display:"flex",gap:8,marginTop:8}}>
                      <input style={{...S.mInput,flex:1}} placeholder="Add carrier…" value={newCar} onChange={e=>setNewCar(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newCar.trim()){addCarrier(acct.id,newCar.trim());setNewCar("");}}}/>
                      <button style={{...S.saveBtn,opacity:newCar.trim()?1:0.4}} onClick={()=>{if(newCar.trim()){addCarrier(acct.id,newCar.trim());setNewCar("");}}}>+ Add</button>
                    </div>
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
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                          <div style={{color:"#6366f1",fontSize:14,fontWeight:700}}>{entry.year} Renewal</div>
                          <div style={{display:"flex",gap:16,alignItems:"center"}}>
                            {entry.closedAt&&<span style={{color:"#334155",fontSize:10}}>Closed {entry.closedAt}</span>}
                            <span style={{color:"#10b981",fontSize:12,fontWeight:600}}>Bound: {entry.boundCarrier}</span>
                            <span style={{color:"#60a5fa",fontSize:13,fontWeight:700}}>${Number(entry.boundPremium).toLocaleString()}</span>
                            {entry.premium>0&&<span style={{color:entry.boundPremium>entry.premium?"#ef4444":"#10b981",fontSize:12,fontWeight:600}}>{entry.boundPremium>entry.premium?"+":""}{(((entry.boundPremium-entry.premium)/entry.premium)*100).toFixed(1)}%</span>}
                          </div>
                        </div>
                        {(entry.carriers||[]).map((c,ci)=>{const co=c.quoted?"#10b981":c.submitted?"#3b82f6":"#334155";return(
                          <div key={ci} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"7px 10px",background:"#0f1629",borderRadius:3,marginBottom:4}}>
                            <span style={{color:co,fontSize:10,background:`${co}18`,border:`1px solid ${co}33`,borderRadius:8,padding:"1px 8px",minWidth:80,textAlign:"center"}}>{c.quoted?"Quoted":c.submitted?"Submitted":"Not Submitted"}</span>
                            <span style={{color:"#94a3b8",fontSize:12,flex:1}}>{c.name}</span>
                            {c.notes&&<span style={{color:"#64748b",fontSize:11,fontStyle:"italic"}}>{c.notes}</span>}
                          </div>
                        );})}
                        {entry.notes&&<div style={{background:"#0f1629",borderRadius:3,padding:"8px 10px",marginTop:8,color:"#64748b",fontSize:11,fontStyle:"italic"}}>{entry.notes}</div>}
                      </div>
                    ))
                }
              </div>
            )}
          </div>
        </div>

        {/* Delete modal */}
        {showDelete&&(
          <div style={S.mBg} onClick={e=>e.target===e.currentTarget&&setShowDelete(false)}>
            <div style={{...S.mBox,width:380}}>
              <div style={{color:"#ef4444",fontSize:"14px",fontWeight:600,marginBottom:12}}>🗑 Delete Account?</div>
              <div style={{color:"#64748b",fontSize:"12px",marginBottom:20}}>This will permanently delete <b style={{color:"#e2e8f0"}}>{acct.name}</b> and all its data. This cannot be undone.</div>
              <div style={S.mActs}>
                <button style={S.cancelBtn} onClick={()=>setShowDelete(false)}>Cancel</button>
                <button style={{...S.saveBtn,background:"#1a0a0a",color:"#ef4444",border:"1px solid #ef444433"}} onClick={()=>deleteAccount(acct.id)}>Delete Permanently</button>
              </div>
            </div>
          </div>
        )}

        {/* Post-Bind modal */}
        {showPB&&(
          <div style={S.mBg} onClick={e=>e.target===e.currentTarget&&setShowPB(false)}>
            <div style={S.mBox}>
              <div style={{...S.mTitle,color:"#a855f7"}}>MOVE TO POST-BIND — {acct.name}</div>
              <div style={{color:"#475569",fontSize:11,marginBottom:16}}>Confirm the bound carrier and final premium. This advances the account to the {isWC(acct.lob)?"Workers Comp":"P&C"} post-bind checklist ({postBindTpl(acct.lob,tpl).length} tasks).</div>
              <div style={S.mRow}><label style={S.mLabel}>Bound Carrier</label><input style={S.mInput} value={pbData.boundCarrier} onChange={e=>setPbData(p=>({...p,boundCarrier:e.target.value}))}/></div>
              <div style={S.mRow}><label style={S.mLabel}>Bound Premium</label><input type="number" style={S.mInput} value={pbData.boundPremium} onChange={e=>setPbData(p=>({...p,boundPremium:e.target.value}))}/></div>
              <div style={S.mActs}>
                <button style={S.cancelBtn} onClick={()=>setShowPB(false)}>Cancel</button>
                <button style={{...S.saveBtn,background:"#1a0a2e",color:"#a855f7",border:"1px solid #a855f744"}} onClick={()=>moveToPostBind(acct.id)} disabled={!pbData.boundCarrier}>◆ Start Post-Bind</button>
              </div>
            </div>
          </div>
        )}

        {/* Close Out modal */}
        {showCO&&(
          <div style={S.mBg} onClick={e=>e.target===e.currentTarget&&setShowCO(false)}>
            <div style={S.mBox}>
              <div style={S.mTitle}>CLOSE OUT &amp; ARCHIVE — {acct.name}</div>
              <div style={{color:"#475569",fontSize:11,marginBottom:16}}>This will archive the renewal and save a permanent record.</div>
              <div style={S.mRow}><label style={S.mLabel}>Bound Carrier</label><input style={S.mInput} value={coData.boundCarrier} onChange={e=>setCoData(p=>({...p,boundCarrier:e.target.value}))}/></div>
              <div style={S.mRow}><label style={S.mLabel}>Bound Premium</label><input type="number" style={S.mInput} value={coData.boundPremium} onChange={e=>setCoData(p=>({...p,boundPremium:e.target.value}))}/></div>
              <div style={S.mRow}><label style={S.mLabel}>Closing Notes</label><textarea style={{...S.textarea,minHeight:80}} value={coData.notes} onChange={e=>setCoData(p=>({...p,notes:e.target.value}))}/></div>
              <div style={S.mActs}>
                <button style={S.cancelBtn} onClick={()=>setShowCO(false)}>Cancel</button>
                <button style={{...S.saveBtn,background:"#0f2a1a",color:"#10b981",border:"1px solid #10b98144"}} onClick={()=>closeOut(acct.id)} disabled={!coData.boundCarrier}>✓ Archive This Renewal</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Dashboard / Worklist / Archive / Settings ───────────────────────────────
  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <div style={S.header}>
        <div style={{display:"flex",alignItems:"baseline"}}>
          <span style={S.logo}>BEHR INSURANCE</span>
          <span style={S.logoSub}>/ RENEWAL PIPELINE</span>
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center"}}>
          {["dashboard","worklist","archive","settings"].map(v=>(
            <button key={v} style={S.navBtn(view===v)} onClick={()=>setView(v)}>
              {v==="settings"?"⚙ Settings":v.charAt(0).toUpperCase()+v.slice(1)}
              {v==="archive"&&archived.length>0&&<span style={{color:"#6366f1",marginLeft:4}}>({archived.length})</span>}
            </button>
          ))}
          <button style={S.addBtn("#0f2a1a","#10b981")} onClick={()=>setShowImport(true)}>↑ Import Excel</button>
          <button style={S.addBtn()} onClick={()=>setShowAdd(true)}>+ Add Account</button>
        </div>
      </div>

      <div style={S.main}>
        {/* Settings */}
        {view==="settings"&&(
          <SettingsView tpl={tpl} setTpl={setTpl} defaultTasks={DEFAULT_TASKS} onSaveTpl={saveTplToDb}/>
        )}

        {view!=="settings"&&(
          <>
            {/* Stat cards */}
            <div style={S.grid5}>
              {[
                {label:"Total Pipeline",  val:stats.total,                               color:"#60a5fa",sub:"active accounts",      fn:()=>{clearFilters();setView("dashboard");}},
                {label:"Behind Schedule", val:stats.red,                                 color:"#ef4444",sub:"need immediate action", fn:()=>{setFHealth("red");setFStage("All");setView("dashboard");}},
                {label:"At Risk",         val:stats.yellow,                              color:"#f59e0b",sub:"action needed soon",    fn:()=>{setFHealth("yellow");setFStage("All");setView("dashboard");}},
                {label:"Post-Bind",       val:stats.postBind,                            color:"#a855f7",sub:"in post-bind process",  fn:()=>{setFStage("post_bind");setFHealth("All");setView("dashboard");}},
                {label:"Premium at Risk", val:`$${(stats.rPrem/1000).toFixed(0)}k`,      color:"#ef4444",sub:`of $${(stats.tPrem/1000).toFixed(0)}k total`, fn:()=>{setFHealth("red");setFStage("All");setView("dashboard");}},
              ].map(({label,val,color,sub,fn})=>(
                <div key={label} style={S.statCard(color)} onClick={fn}
                  onMouseEnter={e=>e.currentTarget.style.opacity="0.8"}
                  onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                  <div style={S.sLabel}>{label}</div>
                  <div style={S.sVal(color)}>{val}</div>
                  <div style={S.sSub}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Stage pipeline bar */}
            {view==="dashboard"&&(
              <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:20}}>
                {pipeCounts.map(s=>(
                  <div key={s.id} style={{background:"#0f1629",border:`1px solid ${s.color}33`,borderTop:`2px solid ${s.color}`,borderRadius:4,padding:"10px 12px",cursor:"pointer"}} onClick={()=>setFStage(s.id)}>
                    <div style={{color:s.color,fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:4}}>{s.label}</div>
                    <div style={{color:"#e2e8f0",fontSize:20,fontWeight:700}}>{s.count}</div>
                    <div style={{color:"#475569",fontSize:10}}>${(s.premium/1000).toFixed(0)}k</div>
                    {s.id==="post_bind"?<div style={{color:"#a855f7",fontSize:10}}>post-renewal</div>:<div style={{color:"#475569",fontSize:10}}>{s.days} days</div>}
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
                <select style={S.fSel} value={fStage} onChange={e=>setFStage(e.target.value)}>
                  <option>All</option>{STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
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
                <thead><tr>{["","Account","Acct Mgr","Producer","LOB","Carrier","Policy #","Expiration","Days Out","Premium","Stage","Progress","Status"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {filtered.map(a=>{
                    const isPB=a.stage==="post_bind";
                    const pbPct=isPB?Math.round(a.progress.completed/Math.max(a.progress.total,1)*100):null;
                    return(
                      <tr key={a.id} style={{...S.tr(a.health),...(isPB?{borderLeft:"2px solid #a855f7"}:{})}} onClick={()=>openAccount(a)}
                        onMouseEnter={e=>e.currentTarget.style.background=a.health==="red"?"#1f0a0a":"#141e32"}
                        onMouseLeave={e=>e.currentTarget.style.background=a.health==="red"?"#1a0a0a":"#0f1629"}>
                        <td style={S.td}><span style={S.dot(a.health)} title={a.healthReason||SL[a.health]}/></td>
                        <td style={{...S.td,color:"#e2e8f0",fontWeight:600}}>{a.name}{syncing[a.id]&&<span style={{color:"#475569",fontSize:9,marginLeft:6}}>saving</span>}</td>
                        <td style={{...S.td,color:"#60a5fa",fontWeight:600}}>{a.accountManager}</td>
                        <td style={{...S.td,color:"#94a3b8"}}>{a.agent}</td>
                        <td style={{...S.td,color:"#94a3b8"}}>{a.lob}</td>
                        <td style={{...S.td,color:"#64748b"}}>{a.masterCompany}</td>
                        <td style={{...S.td,color:"#64748b"}}>{a.policyNumber}</td>
                        <td style={{...S.td,color:"#94a3b8"}}>{new Date(a.expirationDate).toLocaleDateString()}</td>
                        <td style={{...S.td,color:isPB?"#a855f7":a.daysOut<30?"#ef4444":a.daysOut<60?"#f59e0b":"#94a3b8",fontWeight:600}}>{isPB?`${pbPct}%`:`${a.daysOut}d`}</td>
                        <td style={{...S.td,color:"#60a5fa"}}>${Number(a.premium).toLocaleString()}</td>
                        <td style={S.td}><span style={S.pill(a.stage)}>{STAGES.find(s=>s.id===a.stage)?.label}{isPB&&<span style={{color:"#64748b",fontSize:9,marginLeft:3}}>({isWC(a.lob)?"WC":"P&C"})</span>}</span></td>
                        <td style={S.td}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <div style={S.pBar}><div style={S.pFill(a.progress.total?a.progress.completed/a.progress.total:0,a.health)}/></div>
                            <span style={{color:"#475569",fontSize:10}}>{a.progress.completed}/{a.progress.total}</span>
                          </div>
                        </td>
                        <td style={{...S.td,color:SC[a.health],fontSize:11}}>{SL[a.health]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* Worklist */}
            {view==="worklist"&&(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{color:"#475569",fontSize:11,marginBottom:8}}>Sorted by urgency — most critical first</div>
                {[...filtered].sort((a,b)=>{
                  if(a.stage==="post_bind"&&b.stage!=="post_bind") return 1;
                  if(a.stage!=="post_bind"&&b.stage==="post_bind") return -1;
                  const o={red:0,yellow:1,green:2};
                  return o[a.health]!==o[b.health]?o[a.health]-o[b.health]:a.daysOut-b.daysOut;
                }).map(a=>{
                  const isPB=a.stage==="post_bind";
                  const nx = isPB
                    ? postBindTpl(a.lob,tpl).find(t=>!a.tasks[t.id])
                    : (tpl[a.stage]||[]).find(t=>!a.tasks[t.id]);
                  return(
                    <div key={a.id} style={{...S.wItem(a.health),...(isPB?{borderLeft:"3px solid #a855f7",borderColor:"#a855f733"}:{})}} onClick={()=>openAccount(a)}
                      onMouseEnter={e=>e.currentTarget.style.background="#141e32"}
                      onMouseLeave={e=>e.currentTarget.style.background="#0f1629"}>
                      <span style={S.dot(a.health)}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{color:"#e2e8f0",fontWeight:600,fontSize:13}}>{a.name}</span>
                          {isPB&&<span style={{color:"#a855f7",fontSize:10,background:"#a855f711",border:"1px solid #a855f733",borderRadius:3,padding:"1px 6px"}}>POST-BIND {isWC(a.lob)?"WC":"P&C"}</span>}
                        </div>
                        <div style={{color:"#475569",fontSize:11,marginTop:2}}>
                          {a.healthReason?<span style={{color:"#ef4444"}}>{a.healthReason}</span>
                            :nx?<span>Next: <span style={{color:"#94a3b8"}}>{nx.label}</span></span>
                            :<span style={{color:"#10b981"}}>All tasks complete{isPB?" — ready to archive":""}</span>}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:16,alignItems:"center",flexShrink:0}}>
                        {[["Acct Mgr",a.accountManager,"#60a5fa"],["Producer",a.agent,"#94a3b8"]].map(([l,v,c])=>(
                          <div key={l} style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>{l}</div><div style={{color:c,fontSize:12,fontWeight:600}}>{v}</div></div>
                        ))}
                        {!isPB&&<div style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>Days Out</div><div style={{color:a.daysOut<30?"#ef4444":"#94a3b8",fontSize:12,fontWeight:600}}>{a.daysOut}d</div></div>}
                        {isPB&&<div style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>Complete</div><div style={{color:"#a855f7",fontSize:12,fontWeight:600}}>{Math.round(a.progress.completed/Math.max(a.progress.total,1)*100)}%</div></div>}
                        <div style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>Stage</div><span style={S.pill(a.stage)}>{STAGES.find(s=>s.id===a.stage)?.label}</span></div>
                        <div style={{textAlign:"right"}}><div style={{color:"#64748b",fontSize:10}}>Tasks</div><div style={{color:"#94a3b8",fontSize:12}}>{a.progress.completed}/{a.progress.total}</div></div>
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
                                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                                  <div style={{color:"#6366f1",fontWeight:700,fontSize:14}}>{entry.year} Renewal</div>
                                  <div style={{display:"flex",gap:16,alignItems:"center"}}>
                                    {entry.closedAt&&<span style={{color:"#334155",fontSize:10}}>Closed {entry.closedAt}</span>}
                                    <span style={{color:"#10b981",fontSize:12,fontWeight:600}}>{entry.boundCarrier}</span>
                                    <span style={{color:"#60a5fa",fontSize:13,fontWeight:700}}>${Number(entry.boundPremium).toLocaleString()}</span>
                                    {entry.premium>0&&<span style={{color:entry.boundPremium>entry.premium?"#ef4444":"#10b981",fontSize:12}}>{entry.boundPremium>entry.premium?"+":""}{(((entry.boundPremium-entry.premium)/entry.premium)*100).toFixed(1)}%</span>}
                                  </div>
                                </div>
                                {(entry.carriers||[]).map((c,ci)=>{const co=c.quoted?"#10b981":c.submitted?"#3b82f6":"#334155";return(
                                  <div key={ci} style={{display:"flex",gap:10,padding:"5px 8px",background:"#080c18",borderRadius:3,marginBottom:3}}>
                                    <span style={{color:co,fontSize:10,background:`${co}18`,border:`1px solid ${co}33`,borderRadius:8,padding:"1px 8px",minWidth:80,textAlign:"center"}}>{c.quoted?"Quoted":c.submitted?"Submitted":"Not Submitted"}</span>
                                    <span style={{color:"#94a3b8",fontSize:12,flex:1}}>{c.name}</span>
                                    {c.notes&&<span style={{color:"#64748b",fontSize:11,fontStyle:"italic"}}>{c.notes}</span>}
                                  </div>
                                );})}
                                {entry.notes&&<div style={{color:"#64748b",fontSize:11,fontStyle:"italic",padding:"6px 8px",background:"#080c18",borderRadius:3,marginTop:6}}>{entry.notes}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                }
              </div>
            )}
          </>
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
            {[["Assigned Agent","agent",AGENTS],["Account Manager","accountManager",ACCOUNT_MANAGERS],["Policy Type","policyType",POLICY_TYPES],["Starting Stage","stage",STAGES.map(s=>s.id)]].map(([l,k,opts])=>(
              <div key={k} style={S.mRow}><label style={S.mLabel}>{l}</label>
                <select style={S.mSel} value={newAcct[k]} onChange={e=>setNewAcct(p=>({...p,[k]:e.target.value}))}>
                  {opts.map(o=><option key={o} value={o}>{k==="stage"?STAGES.find(s=>s.id===o)?.label:o}</option>)}
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
        <>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"/>
          <div style={S.mBg} onClick={e=>e.target===e.currentTarget&&(setShowImport(false),setImportRows([]),setImportErrors([]),setImportFile(null))}>
            <div style={{...S.mBox,width:700,maxHeight:"85vh"}}>
              <div style={S.mTitle}>IMPORT ACCOUNTS FROM EXCEL</div>
              {importRows.length===0 ? (
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
                      {["Account Name","Policy Number","Expiration Date (YYYY-MM-DD)","Annual Premium","Line of Business","Master Company","Assigned Agent","Account Manager","Policy Type"].map(c=><span key={c}>· {c}</span>)}
                    </div>
                    <div style={{color:"#334155",marginTop:8}}>Optional: Starting Stage, Notes</div>
                  </div>
                </div>
              ) : (
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
                      <thead><tr>{["","Account","LOB","Carrier","Agent","AM","Expiration","Premium","Stage"].map(h=><th key={h} style={{background:"#0a0e1a",color:"#475569",padding:"7px 10px",textAlign:"left",borderBottom:"1px solid #1e2d4a",fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
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
                            <td style={{padding:"6px 10px"}}><span style={{...S.pill(r.stage||"annual_review"),fontSize:9}}>{STAGES.find(s=>s.id===r.stage)?.label||"Annual Review"}</span></td>
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
        </>
      )}
    </div>
  );
}

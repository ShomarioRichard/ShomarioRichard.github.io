// CNC Remote Operator HMI (Trainer)
// - Checklist-gated inputs
// - Input validation + override key
// - Output validation + export JSON
// No external libraries; GitHub Pages-ready.

const clamp = (x,a,b) => Math.max(a, Math.min(b,x));
const rand = (a,b) => a + Math.random()*(b-a);
const nowTime = () => new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});

const SIM = {
  speed: 1,
  tickHz: 4,
  state: "IDLE", // IDLE, RUNNING, PAUSED, ALARM, OFFLINE
  estop: false,
};

const LIMITS = {
  feedMin: 0.60, feedMax: 1.15,
  spindleMin: 0.70, spindleMax: 1.10,
  offsetSoftLimitUm: 40,
  offsetHardLimitUm: 120, // absolute block even with override
};

const JOBS = {
  LATHE_SHAFT: {
    name: "LATHE • Shaft (4140)",
    ops: ["OP10 Face+Center", "OP20 Rough Turn", "OP30 Finish Turn", "OP40 Thread", "OP50 Probe"],
    program: `; SHAFT_4140 (Preview)
G21 G90 G40 G80
( OP10 FACE + CENTER )
T0101 M6
S1800 M3
G0 X50 Z2
G1 Z0 F0.2
...
( OP50 PROBE )
G65 P9832 (probe cycle)
M30`,
    cycleSec: 70,
    requiresProbe: true,
    requiresDryRun: true,
    requiredTools: ["T0101", "T0202", "T0404", "T0909"],
    outputsRequired: ["cycle_report","part_result","metrology","alarm_summary","operator_log"],
  },
  LATHE_BUSHING: {
    name: "LATHE • Bushing (6061)",
    ops: ["OP10 Face", "OP20 Bore", "OP30 Chamfer", "OP40 Probe"],
    program: `; BUSHING_6061 (Preview)
G21 G90
T0101 M6
S2400 M3
...
G65 P9832
M30`,
    cycleSec: 50,
    requiresProbe: true,
    requiresDryRun: false,
    requiredTools: ["T0101", "T0303", "T0909"],
    outputsRequired: ["cycle_report","part_result","metrology","alarm_summary","operator_log"],
  },
  VMC_BRACKET: {
    name: "VMC • Bracket (6061)",
    ops: ["OP10 Drill", "OP20 Pocket", "OP30 Contour", "OP40 Chamfer", "OP50 Probe"],
    program: `; BRACKET_6061 (Preview)
G17 G21 G90 G40 G80
T01 M6
S12000 M3
...
G65 P9810 (probe)
M30`,
    cycleSec: 110,
    requiresProbe: true,
    requiresDryRun: true,
    requiredTools: ["T01", "T02", "T03", "T05", "T90"],
    outputsRequired: ["cycle_report","part_result","metrology","alarm_summary","operator_log"],
  },
  FIVEAX_IMPELLER: {
    name: "5-AX • Impeller (Ti)",
    ops: ["OP10 Rough", "OP20 Semi", "OP30 5AX Finish", "OP40 Probe"],
    program: `; IMPELLER_TI (Preview)
G17 G21 G90
(5-axis moves omitted)
...
G65 P9810
M30`,
    cycleSec: 160,
    requiresProbe: true,
    requiresDryRun: true,
    requiredTools: ["T01", "T02", "T03", "T90"],
    outputsRequired: ["cycle_report","part_result","metrology","alarm_summary","operator_log"],
  },
};

let currentJobKey = "LATHE_SHAFT";
let currentJob = JOBS[currentJobKey];

const machine = {
  feedOv: 1.00,
  spindleOv: 1.00,
  offsetsUm: { x: 0, z: 0 },
  overrideArmed: false,

  // internal “truth”
  toolLife: 92,
  coolant: 88,
  chips: 18,
  driftUm: 0,
  probeBiasUm: 0,
  spindleLoad: 28,
  vibe: 0.22,

  // cycle
  opIndex: 0,
  remainingSec: 0,

  // production counters
  ok: 0,
  scrap: 0,
  hold: 0,

  // alarms
  alarms: [], // {id,title,severity,detail,acked,time,remoteFix}
  alarmSeq: 1,

  // telemetry history (sparklines)
  hist: { spindle: [], vibe: [] },

  // outputs accumulator
  outputs: {
    cycle_report: null,
    part_result: null,
    metrology: null,
    alarm_summary: null,
    operator_log: [],
  },
};

const checklistSpec = [
  { id:"MAT",  title:"Material verified", desc:"Material and batch match the work order." },
  { id:"FIX",  title:"Workholding verified", desc:"Fixture/collet/jaws correct; clamp method confirmed." },
  { id:"TOOLS",title:"Tooling verified", desc:"Tools loaded and match required tool list for this job." },
  { id:"PROBE",title:"Probe enabled", desc:"In-process probe enabled and calibrated for this job." },
  { id:"DRY",  title:"Dry run completed", desc:"Dry run completed (required for some jobs)." },
  { id:"SIGN", title:"Signed & accountable", desc:"Operator ID entered; responsibility accepted." },
];

const outputChecklistSpec = [
  { id:"cycle_report", title:"Cycle report", desc:"Cycle duration, overrides, offsets, job info." },
  { id:"part_result",  title:"Part result", desc:"Accept/Scrap/Hold decision with reason." },
  { id:"metrology",    title:"Metrology snapshot", desc:"Probe values + pass/fail flags." },
  { id:"alarm_summary",title:"Alarm summary", desc:"Alarms raised/acked and critical events." },
  { id:"operator_log", title:"Operator log", desc:"Action timeline (immutable audit trail)." },
];

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

const machineStatePill = $("machineStatePill");
const checklistPill = $("checklistPill");
const outputPill = $("outputPill");
const alarmPill = $("alarmPill");
const estopPill = $("estopPill");

const programText = $("programText");
const opName = $("opName");
const cycleTime = $("cycleTime");
const partCount = $("partCount");
const feedOv = $("feedOv");
const spinOv = $("spinOv");
const permSummary = $("permSummary");

const tSpindle = $("tSpindle");
const tVibe = $("tVibe");
const tDrift = $("tDrift");
const tTool = $("tTool");
const tCoolant = $("tCoolant");
const tChips = $("tChips");

const alarmList = $("alarmList");
const consoleEl = $("console");

const checklistGrid = $("checklistGrid");
const outputsChecklist = $("outputsChecklist");
const outputJson = $("outputJson");

const jobSelect = $("jobSelect");

const evMaterial = $("evMaterial");
const evWorkholding = $("evWorkholding");
const evToolsLoaded = $("evToolsLoaded");
const evProbeEnabled = $("evProbeEnabled");
const evDryRun = $("evDryRun");
const evOperatorId = $("evOperatorId");

const btnLoadJob = $("btnLoadJob");
const btnStart = $("btnStart");
const btnPause = $("btnPause");
const btnResume = $("btnResume");
const btnEstop = $("btnEstop");
const btnSimSpeed = $("btnSimSpeed");

const btnFeedDown = $("btnFeedDown");
const btnFeedUp = $("btnFeedUp");
const btnSpinDown = $("btnSpinDown");
const btnSpinUp = $("btnSpinUp");

const offX = $("offX");
const offZ = $("offZ");
const btnApplyOffsets = $("btnApplyOffsets");

const overrideKey = $("overrideKey");
const btnArmOverride = $("btnArmOverride");
const overridePill = $("overridePill");

const btnResetChecklist = $("btnResetChecklist");
const btnClearAlarms = $("btnClearAlarms");
const btnExport = $("btnExport");

const sparkSpindle = $("sparkSpindle");
const sparkVibe = $("sparkVibe");

// ---------- UI helpers ----------
function log(kind, msg){
  const line = document.createElement("div");
  line.className = "line";
  line.innerHTML = `<b>[${nowTime()}]</b> <span style="color:${kind==="ALARM"?"#fb7185":kind==="WARN"?"#fbbf24":"#cbd5e1"}">(${kind})</span> ${msg}`;
  consoleEl.prepend(line);
  machine.outputs.operator_log.push({ t: new Date().toISOString(), kind, msg });
  refreshOutputs(); // keep outputs in sync
}

function setPill(el, text, color){
  el.textContent = text;
  el.style.color = color || "var(--muted)";
  el.style.borderColor = "rgba(148,163,184,.25)";
}

function updateStatePills(){
  machineStatePill.textContent = `STATE: ${SIM.state}`;
  machineStatePill.style.color =
    SIM.state==="RUNNING" ? "var(--good)" :
    SIM.state==="ALARM" ? "var(--bad)" :
    SIM.state==="PAUSED" ? "var(--warn)" :
    SIM.state==="OFFLINE" ? "var(--bad)" :
    "var(--muted)";

  estopPill.textContent = `E-STOP: ${SIM.estop ? "ACTIVE" : "CLEAR"}`;
  estopPill.style.color = SIM.estop ? "var(--bad)" : "var(--good)";
}

// ---------- Checklist model ----------
function checklistStatus(){
  // Map evidence -> checklist items
  const mat = evMaterial.value === "YES";
  const fix = evWorkholding.value === "YES";
  const tools = evToolsLoaded.value === "YES";
  const probe = evProbeEnabled.value === "YES";
  const dry = (currentJob.requiresDryRun ? evDryRun.value === "YES" : true);
  const sign = (evOperatorId.value || "").trim().length >= 4;

  const items = {
    MAT: mat,
    FIX: fix,
    TOOLS: tools && toolsMatchJob(),
    PROBE: probe && currentJob.requiresProbe, // job requires probe in our presets
    DRY: dry,
    SIGN: sign,
  };

  // If job doesn't require probe, don't gate it; but our presets do require.
  if (!currentJob.requiresProbe) items.PROBE = true;

  const ok = Object.values(items).every(Boolean);
  return { ok, items };
}

function toolsMatchJob(){
  // In this trainer mock, "Tools Loaded" YES plus required tool list displayed
  // You could later expand to actual tool table matching.
  return true;
}

function renderChecklist(){
  const { ok, items } = checklistStatus();
  checklistPill.textContent = `CHECKLIST: ${ok ? "COMPLETE" : "INCOMPLETE"}`;
  checklistPill.style.color = ok ? "var(--good)" : "var(--warn)";

  checklistGrid.innerHTML = "";
  for (const c of checklistSpec){
    const done = !!items[c.id];
    const row = document.createElement("div");
    row.className = "chkItem";
    row.innerHTML = `
      <input type="checkbox" ${done?"checked":""} disabled />
      <div class="chkText">
        <div class="chkTitle">${c.title}</div>
        <div class="chkDesc">${c.desc}${c.id==="TOOLS" ? ` (Required: ${currentJob.requiredTools.join(", ")})` : ""}</div>
      </div>
      <div class="pill" style="color:${done?"var(--good)":"var(--muted)"}; border-color:${done?"rgba(45,212,191,.35)":"rgba(148,163,184,.25)"}">
        ${done ? "OK" : "PENDING"}
      </div>
    `;
    checklistGrid.appendChild(row);
  }

  // Permissions summary
  permSummary.textContent = ok
    ? "Cycle start enabled • Guardrails active • Overrides logged"
    : "Cycle start locked • Only safe-view allowed";

  // Gate start button
  btnStart.disabled = !ok || SIM.estop || (SIM.state !== "IDLE");
  btnStart.style.filter = btnStart.disabled ? "grayscale(0.5) brightness(0.8)" : "none";

  // Gate guardrail inputs
  const canAdjust = ok && !SIM.estop && (SIM.state==="IDLE" || SIM.state==="RUNNING" || SIM.state==="PAUSED");
  for (const b of [btnFeedDown, btnFeedUp, btnSpinDown, btnSpinUp, btnApplyOffsets]){
    b.disabled = !canAdjust;
    b.style.filter = b.disabled ? "grayscale(0.6) brightness(0.8)" : "none";
  }
}

// ---------- Outputs / validation ----------
function renderOutputsChecklist(){
  outputsChecklist.innerHTML = "";
  const out = machine.outputs;
  const required = new Set(currentJob.outputsRequired);

  for (const o of outputChecklistSpec){
    const isRequired = required.has(o.id);
    if (!isRequired) continue;

    const present = o.id === "operator_log"
      ? (out.operator_log && out.operator_log.length > 0)
      : (out[o.id] !== null);

    const row = document.createElement("div");
    row.className = "chkItem";
    row.innerHTML = `
      <input type="checkbox" ${present?"checked":""} disabled />
      <div class="chkText">
        <div class="chkTitle">${o.title}</div>
        <div class="chkDesc">${o.desc}</div>
      </div>
      <div class="pill" style="color:${present?"var(--good)":"var(--warn)"}; border-color:${present?"rgba(45,212,191,.35)":"rgba(251,191,36,.35)"}">
        ${present ? "READY" : "MISSING"}
      </div>
    `;
    outputsChecklist.appendChild(row);
  }

  const ready = areOutputsValid();
  outputPill.textContent = `OUTPUT: ${ready ? "READY" : "NOT READY"}`;
  outputPill.style.color = ready ? "var(--good)" : "var(--warn)";
}

function areOutputsValid(){
  const out = machine.outputs;
  const req = currentJob.outputsRequired;
  for (const k of req){
    if (k === "operator_log"){
      if (!out.operator_log || out.operator_log.length === 0) return false;
    } else {
      if (out[k] === null) return false;
    }
  }
  return true;
}

function refreshOutputs(){
  // Update alarm summary always
  machine.outputs.alarm_summary = {
    active: machine.alarms.filter(a => !a.acked).map(a => ({ id:a.id, title:a.title, severity:a.severity, time:a.time })),
    acked: machine.alarms.filter(a => a.acked).map(a => ({ id:a.id, title:a.title, severity:a.severity, time:a.time })),
  };

  outputJson.textContent = JSON.stringify({
    job: { key: currentJobKey, name: currentJob.name },
    checklist: {
      operator_id: (evOperatorId.value || "").trim(),
      material_verified: evMaterial.value,
      workholding_verified: evWorkholding.value,
      tools_loaded: evToolsLoaded.value,
      probe_enabled: evProbeEnabled.value,
      dry_run_completed: evDryRun.value,
      complete: checklistStatus().ok,
    },
    machine: {
      state: SIM.state,
      feed_override: machine.feedOv,
      spindle_override: machine.spindleOv,
      offsets_um: machine.offsetsUm,
      override_armed: machine.overrideArmed,
      estop: SIM.estop,
    },
    outputs: machine.outputs,
  }, null, 2);

  renderOutputsChecklist();
}

// ---------- Job loading ----------
function loadJob(key){
  currentJobKey = key;
  currentJob = JOBS[key];

  programText.textContent = currentJob.program;
  machine.opIndex = 0;
  machine.remainingSec = 0;

  opName.textContent = currentJob.ops[0] || "—";
  cycleTime.textContent = "—";

  // reset outputs for a new job
  machine.outputs.cycle_report = null;
  machine.outputs.part_result = null;
  machine.outputs.metrology = null;
  machine.outputs.alarm_summary = null;
  // keep operator log (audit continuity) or clear? for training, keep.
  log("INFO", `Loaded job: ${currentJob.name}`);
  renderChecklist();
  refreshOutputs();
}

// ---------- Alarms ----------
function pushAlarm({ title, severity="WARN", detail="", remoteFix=false }){
  const a = {
    id: `A${machine.alarmSeq++}`,
    title, severity, detail, remoteFix,
    acked: false,
    time: nowTime(),
  };
  machine.alarms.push(a);
  SIM.state = "ALARM";
  log("ALARM", `${title} (${severity})`);
  renderAlarms();
  refreshOutputs();
}

function ackAlarm(id){
  const a = machine.alarms.find(x => x.id === id);
  if (!a) return;
  a.acked = true;
  log("INFO", `Acknowledged alarm ${a.id}: ${a.title}`);
  // If no active alarms, return to PAUSED (safe) not RUNNING
  if (machine.alarms.filter(x => !x.acked).length === 0){
    SIM.state = "PAUSED";
  }
  renderAlarms();
  refreshOutputs();
}

function renderAlarms(){
  const active = machine.alarms.filter(a => !a.acked);
  alarmPill.textContent = `ALARMS: ${active.length}`;
  alarmPill.style.color = active.length ? "var(--bad)" : "var(--good)";

  alarmList.innerHTML = "";
  if (machine.alarms.length === 0){
    alarmList.innerHTML = `<div class="finePrint">No alarms.</div>`;
    return;
  }
  for (const a of machine.alarms.slice().reverse()){
    const sevColor = a.severity==="CRITICAL" ? "var(--bad)" : a.severity==="WARN" ? "var(--warn)" : "var(--muted)";
    const el = document.createElement("div");
    el.className = "alarm";
    el.innerHTML = `
      <div class="alTop">
        <div>
          <div class="alTitle">${a.title}</div>
          <div class="alMeta">${a.severity} • ${a.time} • ${a.acked ? "ACKED" : "ACTIVE"}</div>
          <div class="finePrint">${a.detail}</div>
        </div>
        <div class="pill" style="color:${sevColor}; border-color: rgba(148,163,184,.25)">${a.severity}</div>
      </div>
      <div class="alActions">
        ${a.acked ? "" : `<button class="btn ghost" data-ack="${a.id}">Acknowledge</button>`}
      </div>
    `;
    alarmList.appendChild(el);
  }
  alarmList.querySelectorAll("[data-ack]").forEach(btn=>{
    btn.addEventListener("click", (e)=> ackAlarm(e.target.getAttribute("data-ack")));
  });
}

// ---------- Input guardrails ----------
function requireChecklistOk(){
  const { ok } = checklistStatus();
  if (!ok){
    log("WARN", "Action blocked: checklist incomplete.");
    return false;
  }
  if (SIM.estop){
    log("WARN", "Action blocked: E-STOP is active.");
    return false;
  }
  return true;
}

function applyOverrideArming(){
  // Simple demo key: "SUP-OVR"
  const key = (overrideKey.value || "").trim();
  if (key === "SUP-OVR"){
    machine.overrideArmed = true;
    overridePill.textContent = "OVERRIDE: ON";
    overridePill.style.color = "var(--warn)";
    log("WARN", "Supervisor override armed. High-risk inputs may proceed (logged).");
  } else {
    machine.overrideArmed = false;
    overridePill.textContent = "OVERRIDE: OFF";
    overridePill.style.color = "var(--muted)";
    log("WARN", "Override key invalid. Override remains OFF.");
  }
  refreshOutputs();
}

// ---------- Cycle control ----------
function cycleStart(){
  if (!requireChecklistOk()) return;
  if (SIM.state !== "IDLE") { log("WARN", `Cannot start: state=${SIM.state}`); return; }
  SIM.state = "RUNNING";
  machine.opIndex = 0;
  machine.remainingSec = currentJob.cycleSec;
  opName.textContent = currentJob.ops[0] || "—";
  machine.outputs.cycle_report = null;
  machine.outputs.part_result = null;
  machine.outputs.metrology = null;
  log("INFO", "CYCLE START.");
  refreshOutputs();
}

function pause(){
  if (!requireChecklistOk()) return;
  if (SIM.state === "RUNNING"){
    SIM.state = "PAUSED";
    log("INFO", "Paused cycle.");
  } else {
    log("WARN", `Pause ignored: state=${SIM.state}`);
  }
  refreshOutputs();
}

function resume(){
  if (!requireChecklistOk()) return;
  if (SIM.state === "PAUSED"){
    // If there are active alarms, block resume
    if (machine.alarms.some(a => !a.acked)){
      log("WARN", "Resume blocked: active alarms present.");
      return;
    }
    SIM.state = "RUNNING";
    log("INFO", "Resumed cycle.");
  } else {
    log("WARN", `Resume ignored: state=${SIM.state}`);
  }
  refreshOutputs();
}

function estop(){
  SIM.estop = true;
  SIM.state = "OFFLINE";
  log("ALARM", "E-STOP activated. Machine OFFLINE until reset.");
  refreshOutputs();
}

function clearEstop(){
  SIM.estop = false;
  SIM.state = "IDLE";
  log("INFO", "E-STOP cleared. Machine returned to IDLE.");
  refreshOutputs();
}

// ---------- Telemetry + cycle simulation ----------
function pushHist(arr, v, maxN){ arr.push(v); if (arr.length > maxN) arr.shift(); }

function drawSpark(canvas, data, minY, maxY){
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = "rgba(11,15,20,.25)";
  ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = "rgba(148,163,184,.20)";
  ctx.strokeRect(0.5,0.5,w-1,h-1);

  if (!data || data.length < 2) return;
  ctx.beginPath();
  for (let i=0;i<data.length;i++){
    const x = (i/(data.length-1))*(w-10)+5;
    const yN = (data[i]-minY)/(maxY-minY);
    const y = h - (clamp(yN,0,1)*(h-10)+5);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.strokeStyle = "rgba(96,165,250,.85)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function updateTelemetry(dt){
  // Base dynamics
  const wear = 1 - machine.toolLife/100;
  const running = SIM.state === "RUNNING";

  // drift changes slowly
  machine.driftUm = clamp(machine.driftUm + rand(-0.08,0.10)*dt*(running?1.2:0.7), -18, 18);
  machine.probeBiasUm = clamp(machine.probeBiasUm + rand(-0.05,0.06)*dt*(running?1.2:0.8), -10, 10);

  // consumables
  if (running){
    machine.toolLife = = undefined;
  }

  if (running){
    machine.toolLife = clamp(machine.toolLife - dt*rand(0.01,0.03)*(currentJobKey.includes("FIVEAX")?1.4:1.0), 0, 100);
    machine.coolant = clamp(machine.coolant - dt*rand(0.004,0.010), 0, 100);
    machine.chips = clamp(machine.chips + dt*rand(0.05,0.15), 0, 100);
  } else if (SIM.state==="IDLE" || SIM.state==="PAUSED"){
    machine.chips = clamp(machine.chips + dt*rand(-0.04,0.04), 0, 100);
  }

  // derived telemetry
  const feed = machine.feedOv;
  const spin = machine.spindleOv;
  machine.spindleLoad = clamp(20 + (running?15:0) + wear*20 + machine.chips*0.12 + (feed-1)*10 + (spin-1)*8 + rand(-2,2), 5, 98);
  machine.vibe = clamp(0.18 + wear*0.25 + (feed-1)*0.12 + (machine.chips>70?0.18:0) + rand(-0.03,0.03), 0.03, 1.2);

  pushHist(machine.hist.spindle, machine.spindleLoad, 70);
  pushHist(machine.hist.vibe, machine.vibe, 70);

  // render numbers
  tSpindle.textContent = `${Math.round(machine.spindleLoad)}%`;
  tVibe.textContent = `${machine.vibe.toFixed(2)}`;
  tDrift.textContent = `${machine.driftUm.toFixed(1)} µm`;
  tTool.textContent = `${Math.round(machine.toolLife)}%`;
  tCoolant.textContent = `${Math.round(machine.coolant)}%`;
  tChips.textContent = `${Math.round(machine.chips)}%`;

  drawSpark(sparkSpindle, machine.hist.spindle, 0, 100);
  drawSpark(sparkVibe, machine.hist.vibe, 0, 1.2);
}

function maybeRaiseAlarms(dt){
  if (SIM.state !== "RUNNING") return;

  const wear = 1 - machine.toolLife/100;
  const chip = machine.chips/100;
  const coolantLow = machine.coolant < 18;
  const vibeHigh = machine.vibe > 0.75;
  const driftHigh = Math.abs(machine.probeBiasUm) > 6 || Math.abs(machine.driftUm) > 12;

  const base = 0.0020; // per second
  const p = clamp(base*(1+wear*1.7+chip*1.6+(coolantLow?2.0:0)+(vibeHigh?1.5:0)+(driftHigh?1.3:0)), 0, 0.03);

  if (Math.random() < p*dt){
    const r = Math.random();
    if (coolantLow && r < 0.25){
      pushAlarm({
        title:"Coolant Low",
        severity:"WARN",
        detail:"Coolant below threshold. Risk of thermal growth + tool wear. Requires on-site refill.",
      });
      return;
    }
    if (chip > 0.85 && r < 0.55){
      pushAlarm({
        title:"Chip Buildup High",
        severity:"WARN",
        detail:"Chip load trending high. Consider pause + on-site clearing to avoid jam.",
      });
      return;
    }
    if (vibeHigh && r < 0.80){
      pushAlarm({
        title:"Chatter / Vibration Spike",
        severity:"WARN",
        detail:"Vibration exceeded limit. Reduce feed override; inspect tool condition.",
      });
      return;
    }
    if (driftHigh){
      pushAlarm({
        title:"Probe Drift Suspected",
        severity:"WARN",
        detail:"Measurement bias trending. Recommend probing cycle and holding parts for verification.",
      });
      return;
    }
    // tool break
    pushAlarm({
      title:"Tool Wear Limit / Break Risk",
      severity: (Math.random() < (0.25+wear*0.5)) ? "CRITICAL" : "WARN",
      detail:"Tool wear near limit. If ignored, risk of break and hard stop.",
    });
  }
}

function updateCycle(dt){
  if (SIM.state !== "RUNNING") return;

  machine.remainingSec -= dt;
  const total = currentJob.cycleSec;
  const done = Math.max(0, total - machine.remainingSec);

  // update operation index based on progress
  const opIdx = Math.min(currentJob.ops.length-1, Math.floor((done/total)*currentJob.ops.length));
  machine.opIndex = opIdx;
  opName.textContent = currentJob.ops[opIdx] || "—";

  cycleTime.textContent = `${Math.ceil(machine.remainingSec)}s remaining`;

  if (machine.remainingSec <= 0){
    // Complete part and generate outputs
    SIM.state = "IDLE";
    cycleTime.textContent = "Cycle complete";

    // Determine part result (simplified)
    const wear = 1 - machine.toolLife/100;
    const driftRisk = (Math.abs(machine.driftUm)+Math.abs(machine.probeBiasUm))/25;
    const chipRisk = machine.chips/100;
    const vibeRisk = machine.vibe > 0.8 ? 1.0 : machine.vibe > 0.6 ? 0.5 : 0.0;
    const offsetRisk = (Math.abs(machine.offsetsUm.x)+Math.abs(machine.offsetsUm.z))/120;

    const pScrap = clamp(0.03 + 0.08*wear + 0.06*driftRisk + 0.05*chipRisk + 0.05*vibeRisk + 0.03*offsetRisk, 0.01, 0.35);
    const pHold = clamp(0.05 + 0.05*driftRisk + 0.03*vibeRisk, 0.03, 0.22);

    let result = "ACCEPT";
    if (Math.random() < pScrap) result = "SCRAP";
    else if (Math.random() < pHold) result = "HOLD";

    if (result==="ACCEPT") machine.ok++;
    if (result==="SCRAP") machine.scrap++;
    if (result==="HOLD") machine.hold++;

    partCount.textContent = `${machine.ok} OK / ${machine.scrap} Scrap / ${machine.hold} Hold`;

    // “Probe measurements” output
    const meas = {
      OD: 25.000 + (machine.driftUm+machine.probeBiasUm)/1e6 + rand(-6,6)/1e6,
      LEN: 80.000 + (machine.driftUm)/1e6 + rand(-8,8)/1e6,
    };
    const tol = { OD: 0.010, LEN: 0.020 }; // ±mm
    const flags = {
      OD: Math.abs(meas.OD-25.000) <= tol.OD,
      LEN: Math.abs(meas.LEN-80.000) <= tol.LEN,
    };

    machine.outputs.metrology = { measurements_mm: meas, within_tol: flags, tol_pm_mm: tol };

    machine.outputs.part_result = {
      decision: result,
      rationale: result==="ACCEPT" ? "in_process_ok" : result==="HOLD" ? "verification_recommended" : "out_of_tolerance_likely",
    };

    machine.outputs.cycle_report = {
      completed_at: new Date().toISOString(),
      job: { key: currentJobKey, name: currentJob.name },
      cycle_sec: currentJob.cycleSec,
      feed_override: machine.feedOv,
      spindle_override: machine.spindleOv,
      offsets_um: machine.offsetsUm,
      override_armed: machine.overrideArmed,
    };

    log("INFO", `Cycle complete. Part decision: ${result}.`);
    renderChecklist();
    refreshOutputs();
    updateStatePills();
  }
}

function renderTopStats(){
  feedOv.textContent = `${Math.round(machine.feedOv*100)}%`;
  spinOv.textContent = `${Math.round(machine.spindleOv*100)}%`;
  partCount.textContent = `${machine.ok} OK / ${machine.scrap} Scrap / ${machine.hold} Hold`;
  offX.value = machine.offsetsUm.x;
  offZ.value = machine.offsetsUm.z;
}

// ---------- Wire up events ----------
btnLoadJob.addEventListener("click", ()=> loadJob(jobSelect.value));

for (const el of [evMaterial, evWorkholding, evToolsLoaded, evProbeEnabled, evDryRun, evOperatorId]){
  el.addEventListener("input", ()=> { renderChecklist(); refreshOutputs(); });
}

btnResetChecklist.addEventListener("click", ()=>{
  evMaterial.value = "";
  evWorkholding.value = "";
  evToolsLoaded.value = "";
  evProbeEnabled.value = "";
  evDryRun.value = "";
  evOperatorId.value = "";
  log("INFO", "Checklist evidence reset.");
  renderChecklist();
  refreshOutputs();
});

btnStart.addEventListener("click", cycleStart);
btnPause.addEventListener("click", pause);
btnResume.addEventListener("click", resume);

btnEstop.addEventListener("click", ()=>{
  if (!SIM.estop) estop();
  else clearEstop();
  updateStatePills();
  renderChecklist();
  refreshOutputs();
});

btnSimSpeed.addEventListener("click", ()=>{
  SIM.speed = SIM.speed===1 ? 2 : SIM.speed===2 ? 4 : 1;
  btnSimSpeed.textContent = `SIM ${SIM.speed}×`;
  log("INFO", `Simulation speed set to ${SIM.speed}×.`);
});

btnFeedDown.addEventListener("click", ()=>{
  if (!requireChecklistOk()) return;
  machine.feedOv = clamp(machine.feedOv - 0.10, LIMITS.feedMin, LIMITS.feedMax);
  log("INFO", `Feed override set to ${Math.round(machine.feedOv*100)}%.`);
  renderTopStats(); refreshOutputs();
});
btnFeedUp.addEventListener("click", ()=>{
  if (!requireChecklistOk()) return;
  machine.feedOv = clamp(machine.feedOv + 0.05, LIMITS.feedMin, LIMITS.feedMax);
  log("INFO", `Feed override set to ${Math.round(machine.feedOv*100)}%.`);
  renderTopStats(); refreshOutputs();
});
btnSpinDown.addEventListener("click", ()=>{
  if (!requireChecklistOk()) return;
  machine.spindleOv = clamp(machine.spindleOv - 0.10, LIMITS.spindleMin, LIMITS.spindleMax);
  log("INFO", `Spindle override set to ${Math.round(machine.spindleOv*100)}%.`);
  renderTopStats(); refreshOutputs();
});
btnSpinUp.addEventListener("click", ()=>{
  if (!requireChecklistOk()) return;
  machine.spindleOv = clamp(machine.spindleOv + 0.05, LIMITS.spindleMin, LIMITS.spindleMax);
  log("INFO", `Spindle override set to ${Math.round(machine.spindleOv*100)}%.`);
  renderTopStats(); refreshOutputs();
});

btnArmOverride.addEventListener("click", applyOverrideArming);

btnApplyOffsets.addEventListener("click", ()=>{
  if (!requireChecklistOk()) return;

  const x = Math.round(Number(offX.value || 0));
  const z = Math.round(Number(offZ.value || 0));

  const mag = Math.max(Math.abs(x), Math.abs(z));

  if (mag > LIMITS.offsetHardLimitUm){
    log("WARN", `Offset blocked: exceeds HARD limit ±${LIMITS.offsetHardLimitUm} µm.`);
    offX.value = machine.offsetsUm.x; offZ.value = machine.offsetsUm.z;
    return;
  }

  if (mag > LIMITS.offsetSoftLimitUm && !machine.overrideArmed){
    log("WARN", `Offset blocked: exceeds SOFT limit ±${LIMITS.offsetSoftLimitUm} µm (requires Override Key).`);
    offX.value = machine.offsetsUm.x; offZ.value = machine.offsetsUm.z;
    return;
  }

  machine.offsetsUm.x = x;
  machine.offsetsUm.z = z;
  log(mag > LIMITS.offsetSoftLimitUm ? "WARN" : "INFO", `Offsets applied: X=${x} µm, Z=${z} µm.`);
  renderTopStats(); refreshOutputs();
});

btnClearAlarms.addEventListener("click", ()=>{
  machine.alarms = machine.alarms.filter(a => !a.acked);
  renderAlarms();
  refreshOutputs();
  log("INFO", "Cleared acknowledged alarms.");
});

btnExport.addEventListener("click", ()=>{
  // Only export when outputs are valid (or allow export with warning)
  const ready = areOutputsValid();
  if (!ready){
    log("WARN", "Export blocked: outputs are not complete yet (finish a cycle).");
    return;
  }
  const blob = new Blob([outputJson.textContent], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cnc_run_${currentJobKey}_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  log("INFO", "Exported run JSON.");
});

// ---------- Main loop ----------
let last = performance.now();
function frame(ts){
  const dt = ((ts - last)/1000) * SIM.speed;
  last = ts;

  // state gating
  updateStatePills();
  renderChecklist();

  // telemetry always updates (even idle)
  updateTelemetry(dt);

  // alarms + cycle progression
  maybeRaiseAlarms(dt);
  updateCycle(dt);

  // if alarm state, show actions are gated by resume rules
  renderAlarms();
  renderTopStats();

  requestAnimationFrame(frame);
}

// ---------- init ----------
function init(){
  log("INFO", "HMI initialized. Complete checklist to unlock Cycle Start.");
  loadJob(currentJobKey);
  renderChecklist();
  renderAlarms();
  refreshOutputs();
  updateStatePills();
  requestAnimationFrame(frame);
}

init();

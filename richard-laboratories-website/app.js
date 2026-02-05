// Remote Ops Console — single-file mock simulation.
// No libraries. Runs on GitHub Pages.

const STATUS = {
  RUNNING: "RUNNING",
  IDLE: "IDLE",
  ALARM: "ALARM",
  WAIT_MAT: "WAIT_MAT",
  OFFLINE: "OFFLINE",
};

const MACHINE_TYPES = [
  { type: "2-axis Lathe + Bar Feeder", key: "LATHE" },
  { type: "3-axis VMC + Pallet Changer", key: "VMC" },
  { type: "5-axis Mill", key: "FIVEAX" },
];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const nowTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

let simSpeed = 1;           // 1x, 2x, 4x
let nightShift = false;     // increases event rate

// ---- Simulation model ----
function createMachine(id, name, typeObj) {
  const base = {
    id,
    name,
    type: typeObj.type,
    typeKey: typeObj.key,
    status: STATUS.RUNNING,
    alarms: [],
    ok: 0,
    scrap: 0,
    downtimeSec: 0,
    feedOverride: 1.0,
    offsetsUm: { x: 0, z: 0 },

    // hidden-ish states
    toolLife: rand(55, 95),         // %
    coolant: rand(55, 95),          // %
    chipLoad: rand(10, 45),         // %
    thermalDriftUm: rand(-6, 6),    // µm
    probeBiasUm: rand(-2, 2),       // µm (drift)
    spindleHealth: rand(70, 98),    // %
    vibrationIndex: rand(0.15, 0.45),
    spindleLoad: rand(20, 55),

    job: makeJob(typeObj.key),
    telemetryHistory: {
      spindle: [],
      vibe: [],
    },
    metrology: makeMetrology(typeObj.key),
  };
  return base;
}

function makeJob(typeKey) {
  const jobs = {
    LATHE: [
      { name: "WO-1842 • Shaft (4140)", baseCycle: 48 },
      { name: "WO-1880 • Bushing (6061)", baseCycle: 32 },
      { name: "WO-1904 • Threaded Pin (17-4)", baseCycle: 58 },
    ],
    VMC: [
      { name: "WO-2091 • Bracket (6061)", baseCycle: 90 },
      { name: "WO-2116 • Housing (7075)", baseCycle: 140 },
      { name: "WO-2140 • Plate (1018)", baseCycle: 75 },
    ],
    FIVEAX: [
      { name: "WO-3007 • Impeller (Ti)", baseCycle: 220 },
      { name: "WO-3041 • Medical Implant (CoCr)", baseCycle: 180 },
      { name: "WO-3099 • Aerospace Lug (Inconel)", baseCycle: 260 },
    ]
  };
  const pick = jobs[typeKey][Math.floor(rand(0, jobs[typeKey].length))];
  return {
    name: pick.name,
    baseCycleSec: pick.baseCycle,
    remainingSec: pick.baseCycle * rand(0.4, 1.0),
    ops: makeOps(typeKey),
    tools: makeTools(typeKey),
  };
}

function makeOps(typeKey) {
  if (typeKey === "LATHE") return [
    "OP10: Face + Center Drill",
    "OP20: Rough Turn OD",
    "OP30: Finish Turn + Groove",
    "OP40: Thread",
    "OP50: Probe OD + Length",
  ].join("\n");
  if (typeKey === "VMC") return [
    "OP10: Spot/Drill Hole Pattern",
    "OP20: Rough Pocket",
    "OP30: Finish Contour",
    "OP40: Chamfer",
    "OP50: Probe Datum A/B + Hole Position",
  ].join("\n");
  return [
    "OP10: Rough Adaptive",
    "OP20: Semi-finish",
    "OP30: 5-axis Finish (ball endmill)",
    "OP40: Deburr/Blend",
    "OP50: Probe Critical Surfaces",
  ].join("\n");
}

function makeTools(typeKey) {
  if (typeKey === "LATHE") return [
    "T0101 CNMG Rough",
    "T0202 VNMG Finish",
    "T0303 Grooving",
    "T0404 Threading",
    "T0909 Probe",
  ].join("\n");
  if (typeKey === "VMC") return [
    "T01 10mm EM Rough",
    "T02 6mm EM Finish",
    "T03 Spot Drill",
    "T04 5mm Drill",
    "T05 Chamfer Mill",
    "T90 Probe",
  ].join("\n");
  return [
    "T01 12mm EM Rough",
    "T02 8mm Ball Finish",
    "T03 6mm Ball Finish",
    "T04 Deburr Tool",
    "T90 Probe",
  ].join("\n");
}

function makeMetrology(typeKey) {
  // All values in mm; tolerances in ±mm, but we display and compute um-ish drift effects.
  if (typeKey === "LATHE") return [
    { feature: "OD1", nominal: 25.000, tol: 0.010 },
    { feature: "LEN", nominal: 80.000, tol: 0.020 },
    { feature: "GROOVE_W", nominal: 3.000, tol: 0.015 },
    { feature: "THREAD_PD", nominal: 22.000, tol: 0.020 },
  ];
  if (typeKey === "VMC") return [
    { feature: "HOLE_POS", nominal: 0.000, tol: 0.050 }, // position error measure
    { feature: "POCKET_D", nominal: 12.000, tol: 0.030 },
    { feature: "THK", nominal: 8.000, tol: 0.020 },
    { feature: "FLAT", nominal: 0.000, tol: 0.020 }, // flatness error
  ];
  return [
    { feature: "SURF_A", nominal: 0.000, tol: 0.015 },  // profile error
    { feature: "BORE", nominal: 18.000, tol: 0.010 },
    { feature: "TRUE_POS", nominal: 0.000, tol: 0.020 },
    { feature: "RUNOUT", nominal: 0.000, tol: 0.010 },
  ];
}

// ---- UI State ----
let machines = [
  createMachine("M1", "M1 — Lathe Cell A", MACHINE_TYPES[0]),
  createMachine("M2", "M2 — VMC Cell B", MACHINE_TYPES[1]),
  createMachine("M3", "M3 — 5-Axis Cell C", MACHINE_TYPES[2]),
  createMachine("M4", "M4 — Lathe Cell D", MACHINE_TYPES[0]),
  createMachine("M5", "M5 — VMC Cell E", MACHINE_TYPES[1]),
];

let selectedId = null;

// ---- DOM ----
const fleetGrid = document.getElementById("fleetGrid");
const searchInput = document.getElementById("search");
const filterStatus = document.getElementById("filterStatus");

const detailTitle = document.getElementById("detailTitle");
const detailStatus = document.getElementById("detailStatus");

const kpiOee = document.getElementById("kpiOee");
const kpiScrap = document.getElementById("kpiScrap");
const kpiDown = document.getElementById("kpiDown");

const btnShift = document.getElementById("btnShift");
const btnSimSpeed = document.getElementById("btnSimSpeed");

const consoleBody = document.getElementById("consoleBody");
const btnClearConsole = document.getElementById("btnClearConsole");

// Detail metrics
const mSpindle = document.getElementById("mSpindle");
const mVibe = document.getElementById("mVibe");
const mDrift = document.getElementById("mDrift");
const mTool = document.getElementById("mTool");
const mCoolant = document.getElementById("mCoolant");
const mChips = document.getElementById("mChips");

const sparkSpindle = document.getElementById("sparkSpindle");
const sparkVibe = document.getElementById("sparkVibe");

const jobName = document.getElementById("jobName");
const jobRemain = document.getElementById("jobRemain");
const jobCounts = document.getElementById("jobCounts");
const jobFeed = document.getElementById("jobFeed");

const programOps = document.getElementById("programOps");
const toolTable = document.getElementById("toolTable");

const metrologyGrid = document.getElementById("metrologyGrid");
const alarmList = document.getElementById("alarmList");

// Actions
const btnPause = document.getElementById("btnPause");
const btnResume = document.getElementById("btnResume");
const btnFeedDown = document.getElementById("btnFeedDown");
const btnFeedUp = document.getElementById("btnFeedUp");
const btnProbe = document.getElementById("btnProbe");
const btnHold = document.getElementById("btnHold");
const btnCallTech = document.getElementById("btnCallTech");
const offX = document.getElementById("offX");
const offZ = document.getElementById("offZ");
const btnApplyOffsets = document.getElementById("btnApplyOffsets");

const tabs = document.getElementById("tabs");

// ---- Console ----
function logConsole(msg, kind="INFO") {
  const line = document.createElement("div");
  line.className = "consoleLine";
  line.innerHTML = `<b>[${nowTime()}]</b> <span style="color:${kind==="ALARM" ? "#fb7185" : kind==="WARN" ? "#fbbf24" : "#cbd5e1"}">(${kind})</span> ${msg}`;
  consoleBody.prepend(line);
}

// ---- Rendering ----
function statusBadge(status, alarmCount) {
  if (status === STATUS.RUNNING) return `<span class="badge good">RUN</span>`;
  if (status === STATUS.IDLE) return `<span class="badge">IDLE</span>`;
  if (status === STATUS.WAIT_MAT) return `<span class="badge warn">WAIT</span>`;
  if (status === STATUS.OFFLINE) return `<span class="badge bad">OFF</span>`;
  // ALARM
  return `<span class="badge bad">ALARM</span>${alarmCount ? `<span class="badge bad">${alarmCount}</span>` : ""}`;
}

function renderFleet() {
  const q = (searchInput.value || "").toLowerCase().trim();
  const filt = filterStatus.value;

  fleetGrid.innerHTML = "";
  const filtered = machines.filter(m => {
    const matchQ = !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.type.toLowerCase().includes(q);
    const matchS = (filt === "all") || (m.status === filt);
    return matchQ && matchS;
  });

  for (const m of filtered) {
    const card = document.createElement("div");
    card.className = "machineCard" + (m.id === selectedId ? " selected" : "");
    card.onclick = () => selectMachine(m.id);

    const oee = calcMachineOee(m);
    const tool = Math.round(m.toolLife);
    const prog = clamp(tool, 0, 100);

    card.innerHTML = `
      <div class="cardTop">
        <div>
          <div class="cardName">${m.id}</div>
          <div class="cardType">${m.type}</div>
        </div>
        <div class="badges">
          ${statusBadge(m.status, m.alarms.length)}
        </div>
      </div>

      <div class="cardBody">
        <div>
          <div class="smallStat">Job</div>
          <div class="smallValue">${m.job.name.split("•")[0].trim()}</div>
        </div>
        <div>
          <div class="smallStat">OEE</div>
          <div class="smallValue">${oee.toFixed(0)}%</div>
        </div>
        <div>
          <div class="smallStat">Tool Life</div>
          <div class="smallValue">${tool}%</div>
        </div>
        <div>
          <div class="smallStat">OK / Scrap</div>
          <div class="smallValue">${m.ok} / ${m.scrap}</div>
        </div>
      </div>

      <div class="progress"><div style="width:${prog}%;"></div></div>
    `;
    fleetGrid.appendChild(card);
  }

  renderKPIs();
}

function renderKPIs() {
  // fleet-level KPIs (mock)
  const totalParts = machines.reduce((s,m)=>s+m.ok+m.scrap, 0) || 1;
  const scrapRate = machines.reduce((s,m)=>s+m.scrap,0) / totalParts;
  const down = machines.reduce((s,m)=>s+m.downtimeSec,0);

  const fleetOee = machines.reduce((s,m)=>s+calcMachineOee(m),0) / machines.length;
  kpiOee.textContent = `${fleetOee.toFixed(0)}%`;
  kpiScrap.textContent = `${(scrapRate*100).toFixed(1)}%`;
  kpiDown.textContent = `${Math.round(down/60)} min`;
}

function setPillStatus(m) {
  detailStatus.textContent = m.status;
  detailStatus.style.color =
    m.status === STATUS.RUNNING ? "var(--good)" :
    m.status === STATUS.WAIT_MAT ? "var(--warn)" :
    m.status === STATUS.ALARM ? "var(--bad)" :
    "var(--muted)";
  detailStatus.style.borderColor =
    m.status === STATUS.RUNNING ? "rgba(45,212,191,.35)" :
    m.status === STATUS.WAIT_MAT ? "rgba(251,191,36,.35)" :
    m.status === STATUS.ALARM ? "rgba(251,113,133,.35)" :
    "rgba(148,163,184,.25)";
}

function renderDetail() {
  const m = machines.find(x => x.id === selectedId);
  if (!m) {
    detailTitle.textContent = "Select a machine";
    detailStatus.textContent = "—";
    return;
  }

  detailTitle.textContent = m.name;
  setPillStatus(m);

  // overview metrics
  mSpindle.textContent = `${Math.round(m.spindleLoad)}%`;
  mVibe.textContent = `${m.vibrationIndex.toFixed(2)}`;
  mDrift.textContent = `${m.thermalDriftUm.toFixed(1)} µm`;
  mTool.textContent = `${Math.round(m.toolLife)}%`;
  mCoolant.textContent = `${Math.round(m.coolant)}%`;
  mChips.textContent = `${Math.round(m.chipLoad)}%`;

  jobName.textContent = m.job.name;
  jobRemain.textContent = `${Math.ceil(m.job.remainingSec)} s`;
  jobCounts.textContent = `${m.ok} / ${m.scrap}`;
  jobFeed.textContent = `${Math.round(m.feedOverride*100)}%`;

  programOps.textContent = m.job.ops;
  toolTable.textContent = m.job.tools;

  offX.value = m.offsetsUm.x;
  offZ.value = m.offsetsUm.z;

  // metrology
  renderMetrology(m);

  // alarms
  renderAlarms(m);

  // sparklines
  drawSpark(sparkSpindle, m.telemetryHistory.spindle, 0, 100);
  drawSpark(sparkVibe, m.telemetryHistory.vibe, 0, 1.2);
}

function renderMetrology(m) {
  metrologyGrid.innerHTML = "";
  for (const f of m.metrology) {
    const measure = simulateMeasurement(m, f);
    const pass = Math.abs(measure - f.nominal) <= f.tol + 1e-9;

    const el = document.createElement("div");
    el.className = "mItem";
    el.innerHTML = `
      <div class="mTop">
        <div>
          <div class="mName">${f.feature}</div>
          <div class="mTol">Nom ${f.nominal.toFixed(3)} mm • ±${f.tol.toFixed(3)} mm</div>
        </div>
        <div class="badge ${pass ? "good" : "bad"}">${pass ? "PASS" : "FAIL"}</div>
      </div>
      <div class="mVal ${pass ? "pass" : "fail"}">${measure.toFixed(4)} mm</div>
    `;
    metrologyGrid.appendChild(el);
  }
}

function renderAlarms(m) {
  alarmList.innerHTML = "";
  if (m.alarms.length === 0) {
    alarmList.innerHTML = `<div class="finePrint">No active alarms.</div>`;
    return;
  }
  for (const a of m.alarms.slice().reverse()) {
    const wrap = document.createElement("div");
    wrap.className = "alarm";
    wrap.innerHTML = `
      <div class="alarmTop">
        <div>
          <div class="alarmTitle">${a.title}</div>
          <div class="alarmMeta">${a.severity} • ${a.source} • ${a.time}</div>
          <div class="finePrint">${a.detail}</div>
        </div>
        <div class="badge ${a.severity === "CRITICAL" ? "bad" : a.severity === "WARN" ? "warn" : ""}">
          ${a.severity}
        </div>
      </div>
      <div class="alarmActions">
        <button class="btn ghost" data-ack="${a.id}">Acknowledge</button>
        ${a.remoteFix ? `<button class="btn" data-fix="${a.id}">Apply Remote Fix</button>` : ""}
      </div>
    `;
    alarmList.appendChild(wrap);
  }

  alarmList.querySelectorAll("[data-ack]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-ack");
      acknowledgeAlarm(m, id);
    });
  });

  alarmList.querySelectorAll("[data-fix]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-fix");
      applyRemoteFix(m, id);
    });
  });
}

function selectMachine(id) {
  selectedId = id;
  renderFleet();
  renderDetail();
}

// ---- Tabs ----
tabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  const tab = btn.getAttribute("data-tab");
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".tabPanel").forEach(p => p.classList.remove("active"));
  document.getElementById(`tab-${tab}`).classList.add("active");
});

// ---- Actions ----
function requireSelected() {
  const m = machines.find(x => x.id === selectedId);
  if (!m) { logConsole("Select a machine first.", "WARN"); return null; }
  return m;
}

btnPause.addEventListener("click", () => {
  const m = requireSelected(); if (!m) return;
  if (m.status === STATUS.RUNNING) {
    m.status = STATUS.IDLE;
    logConsole(`${m.id}: Paused remotely.`, "INFO");
  } else {
    logConsole(`${m.id}: Cannot pause (status=${m.status}).`, "WARN");
  }
  renderFleet(); renderDetail();
});

btnResume.addEventListener("click", () => {
  const m = requireSelected(); if (!m) return;
  if (m.status === STATUS.IDLE || m.status === STATUS.WAIT_MAT) {
    m.status = STATUS.RUNNING;
    logConsole(`${m.id}: Resumed remotely.`, "INFO");
  } else {
    logConsole(`${m.id}: Cannot resume (status=${m.status}).`, "WARN");
  }
  renderFleet(); renderDetail();
});

btnFeedDown.addEventListener("click", () => {
  const m = requireSelected(); if (!m) return;
  m.feedOverride = clamp(m.feedOverride - 0.10, 0.60, 1.15);
  logConsole(`${m.id}: Feed override set to ${Math.round(m.feedOverride*100)}%.`, "INFO");
  renderDetail(); renderFleet();
});

btnFeedUp.addEventListener("click", () => {
  const m = requireSelected(); if (!m) return;
  m.feedOverride = clamp(m.feedOverride + 0.05, 0.60, 1.15);
  logConsole(`${m.id}: Feed override set to ${Math.round(m.feedOverride*100)}%.`, "INFO");
  renderDetail(); renderFleet();
});

btnProbe.addEventListener("click", () => {
  const m = requireSelected(); if (!m) return;
  // probing reduces uncertainty but can trigger a drift alarm if bias is high
  const oldBias = m.probeBiasUm;
  m.probeBiasUm = m.probeBiasUm * 0.6 + rand(-0.6, 0.6);
  logConsole(`${m.id}: Probe cycle complete (bias ${oldBias.toFixed(1)} → ${m.probeBiasUm.toFixed(1)} µm).`, "INFO");
  renderDetail();
});

btnHold.addEventListener("click", () => {
  const m = requireSelected(); if (!m) return;
  logConsole(`${m.id}: Routing next part(s) to HOLD for CMM verification.`, "WARN");
  // In mock: slightly reduce scrap risk for a while
  m._holdBonus = 20;
  renderDetail();
});

btnCallTech.addEventListener("click", () => {
  const m = requireSelected(); if (!m) return;
  const eta = Math.round(rand(6, 18));
  logConsole(`${m.id}: Technician dispatched. ETA ${eta} min.`, "WARN");
  // tech clears chip jams / recovers alarms (chance)
  m._techEta = eta * 60;
  m._techActive = true;
  renderDetail(); renderFleet();
});

btnApplyOffsets.addEventListener("click", () => {
  const m = requireSelected(); if (!m) return;
  const x = Number(offX.value || 0);
  const z = Number(offZ.value || 0);

  // Basic guard
  if (Math.abs(x) > 40 || Math.abs(z) > 40) {
    logConsole(`${m.id}: Offset request rejected (limit ±40 µm).`, "WARN");
    offX.value = m.offsetsUm.x; offZ.value = m.offsetsUm.z;
    return;
  }

  m.offsetsUm.x = Math.round(x);
  m.offsetsUm.z = Math.round(z);

  // Over-correction increases future scrap risk (stored as hidden penalty)
  const mag = Math.abs(m.offsetsUm.x) + Math.abs(m.offsetsUm.z);
  m._offsetRisk = clamp(mag / 80, 0, 1);

  logConsole(`${m.id}: Offsets applied (X=${m.offsetsUm.x} µm, Z=${m.offsetsUm.z} µm).`, "INFO");
  renderDetail();
});

// ---- Shift and speed ----
btnShift.addEventListener("click", () => {
  nightShift = !nightShift;
  btnShift.textContent = `Night Shift: ${nightShift ? "ON" : "OFF"}`;
  logConsole(`Shift mode set: ${nightShift ? "Night (higher event rate)" : "Day"}.`, "INFO");
});

btnSimSpeed.addEventListener("click", () => {
  simSpeed = simSpeed === 1 ? 2 : simSpeed === 2 ? 4 : 1;
  btnSimSpeed.textContent = `Sim: ${simSpeed}×`;
  logConsole(`Simulation speed set to ${simSpeed}×.`, "INFO");
});

// ---- Search/filter ----
searchInput.addEventListener("input", renderFleet);
filterStatus.addEventListener("change", renderFleet);

btnClearConsole.addEventListener("click", () => {
  consoleBody.innerHTML = "";
  logConsole("Console cleared.", "INFO");
});

// ---- Measurement model ----
function simulateMeasurement(m, feature) {
  // Convert microns to mm contribution
  const driftMm = (m.thermalDriftUm + m.probeBiasUm + 0.3 * (m.offsetsUm.x + m.offsetsUm.z)) / 1000.0 / 1000.0;
  const noiseMm = rand(-0.006, 0.006) / 1000.0; // ±6 µm noise in mm
  const wearMm = (1 - m.toolLife / 100) * rand(-8, 18) / 1000.0 / 1000.0; // wear -> bias

  // Some features are error-based around 0 (flatness, position, runout)
  const isErrorMetric = Math.abs(feature.nominal) < 1e-9;

  let val;
  if (isErrorMetric) {
    const base = clamp(rand(0, feature.tol * 0.6), 0, feature.tol * 1.5);
    const risk = (m._offsetRisk || 0) * feature.tol * 0.6;
    val = base + Math.abs(driftMm) * 25 + Math.abs(wearMm) * 20 + risk + Math.abs(noiseMm) * 10;
  } else {
    val = feature.nominal + driftMm + noiseMm + wearMm;
  }

  // Holding for CMM reduces scrap by catching drift early (mock)
  if (m._holdBonus && m._holdBonus > 0) {
    val += rand(-1, 1) / 1000.0 / 1000.0; // small correction
  }

  return val;
}

// ---- Alarm system ----
let alarmSeq = 1;

function pushAlarm(m, { title, severity="WARN", detail="", source="Machine", remoteFix=false }) {
  const id = `${m.id}-A${alarmSeq++}`;
  const alarm = { id, title, severity, detail, source, remoteFix, time: nowTime() };
  m.alarms.push(alarm);
  m.status = STATUS.ALARM;
  logConsole(`${m.id}: ${title}`, "ALARM");
}

function acknowledgeAlarm(m, id) {
  const idx = m.alarms.findIndex(a => a.id === id);
  if (idx >= 0) {
    const a = m.alarms[idx];
    m.alarms.splice(idx, 1);
    logConsole(`${m.id}: Acknowledged alarm (${a.title}).`, "INFO");
    if (m.alarms.length === 0) {
      // Not all alarms recover remotely; some stay down if “hard”
      if (m._hardStop) {
        m.status = STATUS.OFFLINE;
        logConsole(`${m.id}: Requires on-site recovery (hard stop).`, "WARN");
      } else {
        m.status = STATUS.IDLE;
      }
    }
  }
  renderFleet(); renderDetail();
}

function applyRemoteFix(m, id) {
  const a = m.alarms.find(x => x.id === id);
  if (!a) return;

  // Remote fixes: typically reduce feed, rerun probe, or minor offset adjustment
  if (a.title.includes("Chatter") || a.title.includes("Vibration")) {
    m.feedOverride = clamp(m.feedOverride - 0.10, 0.60, 1.15);
    m.vibrationIndex = clamp(m.vibrationIndex - 0.10, 0.05, 1.2);
    logConsole(`${m.id}: Remote fix applied (feed reduced).`, "INFO");
  } else if (a.title.includes("Probe drift")) {
    m.probeBiasUm *= 0.5;
    logConsole(`${m.id}: Remote fix applied (probe re-zero).`, "INFO");
  } else if (a.title.includes("Coolant")) {
    // can't refill remotely
    logConsole(`${m.id}: Remote fix unavailable (requires refill).`, "WARN");
    return;
  } else {
    logConsole(`${m.id}: Remote fix applied (generic).`, "INFO");
  }

  // Clear the alarm
  acknowledgeAlarm(m, id);
}

// ---- OEE (mock) ----
function calcMachineOee(m) {
  // Availability: penalize downtime and alarms/offline
  const avail =
    m.status === STATUS.OFFLINE ? 0.35 :
    m.status === STATUS.ALARM ? 0.55 :
    m.status === STATUS.WAIT_MAT ? 0.70 :
    m.status === STATUS.IDLE ? 0.80 : 0.92;

  // Performance: penalize low feed override
  const perf = clamp(m.feedOverride, 0.6, 1.15) / 1.0;

  // Quality: based on scrap ratio
  const total = m.ok + m.scrap;
  const qual = total < 5 ? 0.98 : clamp(1 - (m.scrap / total), 0.70, 0.999);

  return 100 * avail * perf * qual;
}

// ---- Drawing ----
function drawSpark(canvas, data, minY, maxY) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  // background
  ctx.fillStyle = "rgba(11,15,20,.25)";
  ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = "rgba(148,163,184,.20)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5,0.5,w-1,h-1);

  if (!data || data.length < 2) return;

  const n = data.length;
  ctx.beginPath();
  for (let i=0;i<n;i++){
    const x = (i/(n-1)) * (w-10) + 5;
    const yNorm = (data[i]-minY) / (maxY-minY);
    const y = h - (clamp(yNorm,0,1) * (h-10) + 5);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.strokeStyle = "rgba(96,165,250,.85)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ---- Tick loop ----
function tickMachine(m, dt) {
  const rateBoost = nightShift ? 1.35 : 1.0;

  // If offline: only tech can recover
  if (m.status === STATUS.OFFLINE) {
    m.downtimeSec += dt;
  }

  // Tech behavior
  if (m._techActive) {
    m._techEta -= dt;
    if (m._techEta <= 0) {
      m._techActive = false;
      m._hardStop = false;
      m.alarms = [];
      m.status = STATUS.IDLE;
      // physical fixes
      m.chipLoad = clamp(m.chipLoad - rand(20, 40), 0, 100);
      m.coolant = clamp(m.coolant + rand(10, 25), 0, 100);
      m.vibrationIndex = clamp(m.vibrationIndex - rand(0.05, 0.12), 0.05, 1.2);
      logConsole(`${m.id}: Technician cleared issues. Machine recovered to IDLE.`, "INFO");
    }
  }

  // Running behavior
  if (m.status === STATUS.RUNNING) {
    // job countdown (affected by feedOverride and simSpeed)
    const perf = m.feedOverride;
    m.job.remainingSec -= dt * perf;

    // wear/drift dynamics
    m.toolLife = clamp(m.toolLife - dt * rand(0.002, 0.008) * (m.typeKey === "FIVEAX" ? 1.6 : 1.0), 0, 100);
    m.coolant = clamp(m.coolant - dt * rand(0.001, 0.004), 0, 100);
    m.chipLoad = clamp(m.chipLoad + dt * rand(0.004, 0.018) * (m.typeKey === "LATHE" ? 1.25 : 1.0), 0, 100);

    // thermal drift slowly wanders
    m.thermalDriftUm = clamp(m.thermalDriftUm + rand(-0.12, 0.12) * (dt/1.0), -18, 18);
    // probe bias drifts slowly unless corrected
    m.probeBiasUm = clamp(m.probeBiasUm + rand(-0.05, 0.07) * (dt/1.0), -10, 10);

    // telemetry estimates
    const wearFactor = (1 - m.toolLife/100);
    m.spindleLoad = clamp(m.spindleLoad + rand(-1.8, 2.2) + wearFactor*rand(0.5,2.5) + m.chipLoad*0.01, 10, 98);
    m.vibrationIndex = clamp(m.vibrationIndex + rand(-0.05, 0.05) + wearFactor*0.10 + (m.feedOverride-1)*0.06, 0.03, 1.2);

    // history
    pushHist(m.telemetryHistory.spindle, m.spindleLoad, 60);
    pushHist(m.telemetryHistory.vibe, m.vibrationIndex, 60);

    // complete part
    if (m.job.remainingSec <= 0) {
      // decide scrap based on drift/wear/vibe + offsets risk
      const baseScrap = m.typeKey === "FIVEAX" ? 0.06 : m.typeKey === "VMC" ? 0.035 : 0.025;
      const driftRisk = (Math.abs(m.thermalDriftUm) + Math.abs(m.probeBiasUm)) / 25;
      const wearRisk = (1 - m.toolLife/100) * 1.1;
      const vibeRisk = (m.vibrationIndex > 0.75) ? 1.2 : (m.vibrationIndex > 0.55 ? 0.6 : 0.0);
      const offsetRisk = (m._offsetRisk || 0) * 0.9;
      const holdBonus = (m._holdBonus && m._holdBonus > 0) ? -0.6 : 0;

      const pScrap = clamp(baseScrap + 0.08*driftRisk + 0.10*wearRisk + 0.06*vibeRisk + 0.06*offsetRisk + 0.04*holdBonus, 0.01, 0.35);

      if (Math.random() < pScrap) {
        m.scrap += 1;
        logConsole(`${m.id}: Part SCRAPPED (probe flagged out-of-tolerance).`, "WARN");
      } else {
        m.ok += 1;
      }

      // consume hold bonus
      if (m._holdBonus && m._holdBonus > 0) m._holdBonus -= 1;

      // new cycle
      m.job = makeJob(m.typeKey);
    }

    // events (alarms)
    maybeTriggerEvents(m, dt, rateBoost);
  }

  // Idle / waiting material: time passes
  if (m.status === STATUS.IDLE || m.status === STATUS.WAIT_MAT) {
    // small drift continues
    m.thermalDriftUm = clamp(m.thermalDriftUm + rand(-0.08, 0.08) * (dt/1.0), -18, 18);
    m.probeBiasUm = clamp(m.probeBiasUm + rand(-0.03, 0.05) * (dt/1.0), -10, 10);
    pushHist(m.telemetryHistory.spindle, clamp(m.spindleLoad + rand(-1,1), 5, 35), 60);
    pushHist(m.telemetryHistory.vibe, clamp(m.vibrationIndex + rand(-0.02,0.02), 0.03, 0.6), 60);

    // sometimes needs material
    if (m.status === STATUS.IDLE && Math.random() < 0.002 * dt) {
      m.status = STATUS.WAIT_MAT;
      logConsole(`${m.id}: Waiting for material / pallet.`, "WARN");
    }
  }

  // Alarm status increases downtime
  if (m.status === STATUS.ALARM) {
    m.downtimeSec += dt;
    pushHist(m.telemetryHistory.spindle, clamp(m.spindleLoad + rand(-2,2), 0, 100), 60);
    pushHist(m.telemetryHistory.vibe, clamp(m.vibrationIndex + rand(-0.06,0.06), 0, 1.2), 60);
  }
}

function pushHist(arr, v, maxN) {
  arr.push(v);
  if (arr.length > maxN) arr.shift();
}

function maybeTriggerEvents(m, dt, rateBoost) {
  const base = 0.0012 * rateBoost; // baseline probability per second

  // Higher risk factors
  const wear = 1 - m.toolLife/100;
  const chip = m.chipLoad/100;
  const coolantLow = m.coolant < 18;
  const vibeHigh = m.vibrationIndex > 0.70;
  const driftHigh = Math.abs(m.probeBiasUm) > 6 || Math.abs(m.thermalDriftUm) > 12;

  const p = clamp(base * (1 + wear*1.8 + chip*1.4 + (vibeHigh?1.8:0) + (driftHigh?1.5:0) + (coolantLow?2.2:0)), 0, 0.02);
  if (Math.random() < p * dt) {
    // pick event type
    const roll = Math.random();
    if (coolantLow && roll < 0.25) {
      pushAlarm(m, {
        title: "Coolant Low",
        severity: "WARN",
        detail: "Coolant % below threshold. Risk of heat growth + tool wear. Refill on-site.",
        source: "Coolant System",
        remoteFix: false
      });
      return;
    }
    if (chip > 0.82 && roll < 0.55) {
      // sometimes hard stop
      const hard = Math.random() < 0.35;
      m._hardStop = hard;
      pushAlarm(m, {
        title: hard ? "Chip Auger Jam (HARD STOP)" : "Chip Buildup Detected",
        severity: hard ? "CRITICAL" : "WARN",
        detail: hard ? "Chip jam requires on-site clearing. Remote recovery blocked." : "Chip load high; consider feed reduction or schedule tech.",
        source: "Chip Management",
        remoteFix: !hard
      });
      return;
    }
    if (vibeHigh && roll < 0.80) {
      pushAlarm(m, {
        title: "Chatter / Vibration Spike",
        severity: "WARN",
        detail: "Vibration exceeded limit. Suggest feed reduction or tool change.",
        source: "Vibration Monitor",
        remoteFix: true
      });
      return;
    }
    if (driftHigh) {
      pushAlarm(m, {
        title: "Probe drift suspected",
        severity: "WARN",
        detail: "Measurement bias trending. Rerun probe cycle; consider holding parts for CMM.",
        source: "In-process Probe",
        remoteFix: true
      });
      return;
    }
    // Tool break event
    const hard = Math.random() < (0.25 + wear*0.5);
    m._hardStop = hard;
    pushAlarm(m, {
      title: hard ? "Tool Break Detected (HARD STOP)" : "Tool Wear Limit",
      severity: hard ? "CRITICAL" : "WARN",
      detail: hard ? "Spindle stopped. Tool fragment removal likely required on-site." : "Tool wear near limit. Schedule tool change soon.",
      source: "Tool Monitor",
      remoteFix: !hard
    });
  }
}

// ---- Main loop ----
let last = performance.now();
function loop(ts) {
  const dt = ((ts - last) / 1000) * simSpeed;
  last = ts;

  for (const m of machines) tickMachine(m, dt);

  // Auto transitions: WAIT_MAT can clear occasionally
  for (const m of machines) {
    if (m.status === STATUS.WAIT_MAT && Math.random() < 0.006 * dt) {
      m.status = STATUS.RUNNING;
      logConsole(`${m.id}: Material loaded (auto). Resuming RUN.`, "INFO");
    }
    // If alarm cleared and no hard stop, allow resume
    if (m.status === STATUS.IDLE && m.alarms.length === 0 && Math.random() < 0.001 * dt) {
      // gently return to running if idle
      m.status = STATUS.RUNNING;
    }
  }

  renderFleet();
  renderDetail();

  requestAnimationFrame(loop);
}

// ---- Initial render ----
function init() {
  logConsole("Remote Ops Console initialized.", "INFO");
  logConsole("Tip: Click a machine card to open the detail panel.", "INFO");
  renderFleet();
  // default select first
  selectMachine(machines[0].id);
  requestAnimationFrame(loop);
}

init();

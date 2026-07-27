/* ============================================================
   UniConnect CRM — Demo Seed Data & Persistence Layer
   All data lives in localStorage under key "uc_crm_db_v2".
   ============================================================ */

const DB_KEY = "uc_crm_db_v2";

const UNIVERSITIES = ["Cardiff Metropolitan", "London South Bank", "Coventry University", "University of Sunderland", "Northumbria University"];
const PROGRAMS = ["BSc Computing", "BA Business Management", "MSc Data Science", "MBA", "BSc Accounting & Finance", "BA Marketing"];
const DISTRICTS = ["Colombo", "Gampaha", "Kandy", "Galle", "Jaffna", "Kurunegala", "Other"];
const LEAD_SOURCES = ["Student", "Staff", "Digital", "Bulk Upload", "Exhibition", "Walk-in", "Agent Referral"];
const DIGITAL_SUBSOURCES = ["Facebook", "Google", "Instagram", "LinkedIn"];
const LOSS_REASONS = ["Financial constraints", "Went to competitor", "Visa rejected", "Not interested", "Unreachable", "Chose local university"];

// Tenants / domains (UC30) — "All" means a global (unpartitioned) user
const DOMAINS = ["Colombo Branch", "Kandy Branch", "Online Division"];

// UC36 — program handbook attachments used by the conversion-email automation
const PROGRAM_HANDBOOKS = {
  "BSc Computing": "handbook-bsc-computing-2026.pdf",
  "BA Business Management": "handbook-ba-business-mgmt-2026.pdf",
  "MSc Data Science": "handbook-msc-data-science-2026.pdf",
  "MBA": "handbook-mba-2026.pdf",
  "BSc Accounting & Finance": "handbook-bsc-accounting-finance-2026.pdf"
  // NOTE: "BA Marketing" intentionally has no handbook so UC36 - AF1 can be demonstrated
};

const STAGES = ["Open", "Qualified", "Converted", "Closed"];
const STAGE_COLORS = { Open: "#2563eb", Qualified: "#e0821e", Converted: "#1c8a4c", Closed: "#6b7684" };

// The four built-in stages carry business meaning that the engine depends on:
//   Open      → entry point for new leads; same-day contact SLA (UC33)
//   Qualified → counts toward qualified/inquiry conversion KPIs
//   Converted → fires the conversion automation and creates commission records
//   Closed    → terminal; drives loss-reason analysis (UC77)
// They can be renamed, recoloured and reordered, but not deleted.
// Admins may add any number of additional custom stages around them (UC64).
const SYSTEM_STAGES = ["Open", "Qualified", "Converted", "Closed"];
const DEFAULT_STAGE_COLOR = "#7c3aed";

function stageKeyFrom(label, existing) {
  let base = String(label).trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Stage";
  let key = base, n = 2;
  while (existing.includes(key)) key = base + "_" + n++;
  return key;
}

// Allowed forward transitions (M2 UC37/UC38/UC64)
const STAGE_TRANSITIONS = {
  Open: ["Qualified", "Closed"],
  Qualified: ["Converted", "Closed"], // reverting to Open blocked (UC37)
  Converted: ["Closed"],
  Closed: []
};

// Mandatory fields per stage (UC59). olResult/alResult are academic-results fields (UC55)
// that get skipped by isMandatoryMet() whenever the lead's "Results Pending" flag is set (UC56).
const STAGE_MANDATORY_FIELDS = {
  Open: ["name", "mobile"],
  Qualified: ["name", "mobile", "email", "program", "university", "olResult", "alResult"],
  Converted: ["name", "mobile", "email", "program", "university", "intakeId"],
  Closed: []
};

// Lead fields an admin may mark mandatory per stage (UC59)
const LEAD_FIELD_CATALOG = [
  { id: "name", label: "Full Name" },
  { id: "mobile", label: "Mobile" },
  { id: "email", label: "Email" },
  { id: "university", label: "University" },
  { id: "program", label: "Program" },
  { id: "district", label: "District" },
  { id: "intakeId", label: "Intake Cycle" },
  { id: "olResult", label: "O/L Result" },
  { id: "alResult", label: "A/L Result" },
  { id: "languageScore", label: "Language Score" },
  { id: "studentId", label: "Student ID" },
  { id: "staffName", label: "Staff Name" }
];

const CHECKLIST_TEMPLATE = [
  "Verify academic results",
  "Confirm contact number",
  "Confirm program interest",
  "Duplicate check passed",
  "Financial capability discussed"
];

const ROLES = ["Counsellor", "Manager", "Head of Marketing", "CEO", "Commission Admin", "Finance", "Admin", "Agent"];

/* ---------------- UC49 — configurable role visibility ---------------- */
const DASHBOARD_WIDGETS = [
  { id: "inquiries", label: "Total Inquiries" },
  { id: "qualified", label: "Qualified Leads" },
  { id: "convInquiry", label: "Inquiry → Lead %" },
  { id: "convEnrol", label: "Lead → Enrolment %" },
  { id: "pipeline", label: "Pipeline Summary" },
  { id: "followups", label: "Follow-Up Status" },
  { id: "activity", label: "Recent Activity" }
];
const REPORT_DEFS = [
  { id: "status", label: "Lead Status Distribution" },
  { id: "source", label: "Lead Source Performance" },
  { id: "university", label: "University-Wise" },
  { id: "funnel", label: "Full Funnel" },
  { id: "loss", label: "Loss Reasons" },
  { id: "program", label: "Program-Wise" },
  { id: "sla", label: "Follow-Up SLA" },
  { id: "counsellor", label: "Counsellor Performance" },
  { id: "agent", label: "Agent Performance" }
];

function defaultRolePermissions() {
  const allWidgets = DASHBOARD_WIDGETS.map(w => w.id);
  const allReports = REPORT_DEFS.map(r => r.id);
  const perms = {};
  ROLES.forEach(role => {
    perms[role] = {
      widgets: allWidgets.slice(),
      reports: allReports.slice(),
      viewAmounts: ["Head of Marketing", "CEO", "Admin", "Commission Admin", "Finance"].includes(role)
    };
  });
  // Sensible role-scoped defaults
  perms["Counsellor"].widgets = ["pipeline", "followups", "activity"];
  perms["Counsellor"].reports = ["status", "sla"];
  perms["Agent"].widgets = ["activity"];
  perms["Agent"].reports = ["agent"];
  perms["Finance"].reports = ["counsellor", "agent"];
  return perms;
}

function uid(prefix) { return prefix + "_" + Math.random().toString(36).slice(2, 9); }

function seedUsers() {
  // domain "All" = global visibility across tenants (UC30)
  return [
    { id: "u_ceo", name: "Ranil W.", role: "CEO", managerId: null, domain: "All" },
    { id: "u_hom", name: "Anjali Perera", role: "Head of Marketing", managerId: "u_ceo", domain: "All" },
    { id: "u_admin", name: "Sanu (Admin)", role: "Admin", managerId: null, domain: "All" },
    { id: "u_finance", name: "Kamal Silva", role: "Finance", managerId: "u_hom", domain: "All" },
    { id: "u_cadmin", name: "Nadeesha (Comm. Admin)", role: "Commission Admin", managerId: "u_hom", domain: "All" },
    { id: "u_mgr1", name: "Dilani Fernando", role: "Manager", managerId: "u_hom", domain: "Colombo Branch" },
    { id: "u_mgr2", name: "Suresh Kumar", role: "Manager", managerId: "u_hom", domain: "Kandy Branch" },
    { id: "u_c1", name: "Ishara Jayasuriya", role: "Counsellor", managerId: "u_mgr1", domain: "Colombo Branch" },
    { id: "u_c2", name: "Tharindu Silva", role: "Counsellor", managerId: "u_mgr1", domain: "Colombo Branch" },
    { id: "u_c3", name: "Nimasha Perera", role: "Counsellor", managerId: "u_mgr2", domain: "Kandy Branch" },
    { id: "u_agent1", name: "Global Edu Partners (Agent)", role: "Agent", managerId: "u_mgr2", domain: "Online Division" }
  ];
}

const FIRST_NAMES = ["Amal", "Nadeesha", "Kasun", "Chathumi", "Ruwan", "Ishara", "Dinesh", "Sanduni", "Malith", "Vindya", "Nuwan", "Piyumi", "Tharaka", "Hasini", "Kavindu", "Yasodha", "Chamara", "Dilki", "Sachini", "Lahiru"];
const LAST_NAMES = ["Perera", "Fernando", "Silva", "Jayasuriya", "Wickramasinghe", "Bandara", "Gunawardena", "Rathnayake", "Karunaratne", "Weerasinghe"];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randDateWithinDays(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
  return d.toISOString();
}
function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

function seedIntakes() {
  return [
    { id: "in_jan26", name: "January 2026 Intake", start: "2026-01-05", end: "2026-01-31", programs: PROGRAMS },
    { id: "in_may26", name: "May 2026 Intake", start: "2026-05-04", end: "2026-05-30", programs: PROGRAMS },
    { id: "in_sep26", name: "September 2026 Intake", start: "2026-09-01", end: "2026-09-28", programs: PROGRAMS }
  ];
}

function seedCommissionPlans() {
  return [
    { id: "cp1", university: "Cardiff Metropolitan", type: "Percentage", value: 12, min: null, max: null, from: "2026-01-01", to: "2026-12-31", status: "Active" },
    { id: "cp2", university: "London South Bank", type: "Fixed", value: 45000, from: "2026-01-01", to: "2026-12-31", status: "Active" },
    { id: "cp3", university: "Coventry University", type: "Slab", tiers: [{ from: 0, to: 10, rate: 0 }, { from: 11, to: 20, rate: 2 }, { from: 21, to: 999, rate: 5 }], from: "2026-01-01", to: "2026-12-31", status: "Active" },
    { id: "cp4", university: "All", type: "Referral-Student", value: 5000, from: "2026-01-01", to: "2026-12-31", status: "Active" },
    { id: "cp5", university: "All", type: "Referral-Staff", value: 7500, from: "2026-01-01", to: "2026-12-31", status: "Active" }
  ];
}

function makeChecklist(allDone) {
  const items = (DB && DB.checklistTemplate) ? DB.checklistTemplate : CHECKLIST_TEMPLATE;
  return items.map(label => ({ label, done: allDone === undefined ? Math.random() > 0.5 : !!allDone }));
}

// UC46 — realistic history of completed follow-ups, each with a due date and an
// actual completion date so on-time % is a genuine measurement.
function makeFollowUpLog(createdAt) {
  const log = [];
  const count = 2 + Math.floor(Math.random() * 5);
  let cursor = new Date(createdAt);
  for (let i = 0; i < count; i++) {
    cursor = new Date(cursor.getTime() + (2 + Math.floor(Math.random() * 6)) * 86400000);
    if (cursor > new Date()) break;
    const due = cursor.toISOString().slice(0, 10);
    const lateDays = Math.random() > 0.72 ? 1 + Math.floor(Math.random() * 4) : 0; // ~28% late
    const completed = new Date(cursor.getTime() + lateDays * 86400000).toISOString().slice(0, 10);
    log.push({ dueDate: due, completedAt: completed });
  }
  return log;
}

function seedLeads(users, intakes) {
  const counsellors = users.filter(u => u.role === "Counsellor");
  const leads = [];
  const total = 68;
  for (let i = 0; i < total; i++) {
    const first = rand(FIRST_NAMES), last = rand(LAST_NAMES);
    const source = rand(LEAD_SOURCES);
    const stageRoll = Math.random();
    let stage = "Open";
    if (stageRoll > 0.85) stage = "Closed";
    else if (stageRoll > 0.6) stage = "Converted";
    else if (stageRoll > 0.35) stage = "Qualified";

    const examType = Math.random() > 0.7 ? "London A/L" : "Local A/L";
    const resultsPending = Math.random() > 0.75;
    const isReferral = source === "Agent Referral" || Math.random() < 0.1;
    const created = randDateWithinDays(75);
    const owner = rand(counsellors);

    // UC31 — a real scheduled follow-up date: spread across overdue / today / upcoming
    const r = Math.random();
    const nextFollowUp = (stage === "Closed")
      ? ""
      : r < 0.3 ? isoDateOffset(-(1 + Math.floor(Math.random() * 9)))   // overdue
        : r < 0.45 ? todayISO()                                          // due today
          : isoDateOffset(1 + Math.floor(Math.random() * 10));           // upcoming

    // UC14/UC15 — real monetary figures evaluated against a configurable threshold
    const tuition = 850000;
    const amountPaid = Math.round(tuition * (0.05 + Math.random() * 0.6));
    const outstandingBalance = Math.random() > 0.75 ? Math.round(20000 + Math.random() * 90000) : 0;

    const lead = {
      id: uid("lead"),
      name: `${first} ${last}`,
      mobile: "07" + Math.floor(10000000 + Math.random() * 89999999),
      email: `${first}.${last}${i}@example.com`.toLowerCase(),
      leadSource: source,
      digitalSubSource: source === "Digital" ? rand(DIGITAL_SUBSOURCES) : null,
      studentId: source === "Student" ? "STU" + (1000 + i) : "",
      staffName: source === "Staff" ? rand(FIRST_NAMES) + " " + rand(LAST_NAMES) : "",
      university: stage === "Open" && Math.random() > 0.5 ? "" : rand(UNIVERSITIES),
      program: stage === "Open" && Math.random() > 0.5 ? "" : rand(PROGRAMS),
      district: rand(DISTRICTS),
      districtOther: "",
      examType,
      resultsPending,
      olResult: resultsPending ? "" : (Math.random() > 0.5 ? "6 Passes" : "8 Passes"),
      alResult: resultsPending ? "" : (Math.random() > 0.5 ? "2 Passes" : "3 Passes"),
      languageTest: rand(["IELTS", "TOEFL", "PTE", "None"]),
      languageScore: resultsPending ? "" : (5 + Math.random() * 3.5).toFixed(1),
      stage,
      deactivated: stage === "Closed" ? Math.random() > 0.4 : false,
      deactivationReason: "",
      lossReason: stage === "Closed" ? rand(LOSS_REASONS) : "",
      assignedTo: owner.id,
      intakeId: Math.random() > 0.3 ? rand(intakes).id : "",
      // UC30 — agent-sourced leads belong to the agent's tenant; otherwise follow the owning counsellor
      domain: source === "Agent Referral" ? "Online Division" : (owner.domain === "All" ? rand(DOMAINS) : owner.domain),
      isReferral,
      referralType: isReferral ? rand(["Staff", "Student"]) : "",
      agentId: source === "Agent Referral" ? "u_agent1" : "",
      checklist: makeChecklist(),
      commissionStatus: stage === "Converted" ? rand(["Pending", "Eligible", "Blocked", "Paid"]) : "Pending",
      tuitionFee: tuition,
      amountPaid,
      outstandingBalance,
      nextFollowUp,
      followUpLog: makeFollowUpLog(created),
      escalated: false,
      createdAt: created,
      activity: [
        { ts: created, user: "System", type: "Create", text: `Lead created via ${source}` }
      ]
    };
    leads.push(lead);
  }
  return leads;
}

function seedInquiries() {
  const inquiries = [];
  for (let i = 0; i < 40; i++) {
    const first = rand(FIRST_NAMES), last = rand(LAST_NAMES);
    inquiries.push({
      id: uid("inq"),
      name: `${first} ${last}`,
      mobile: "07" + Math.floor(10000000 + Math.random() * 89999999),
      email: `${first}.${last}${i}.inq@example.com`.toLowerCase(),
      program: rand(PROGRAMS),
      source: rand(["Exhibition", "Website", "Walk-in", "Referral"]),
      createdAt: randDateWithinDays(90),
      convertedToLead: Math.random() > 0.55
    });
  }
  return inquiries;
}

function seedAuditLog() {
  return [
    { ts: new Date().toISOString(), user: "System", action: "SEED", entity: "Database", details: "Demo data initialised" }
  ];
}

function seedTargets(users, intakes) {
  const counsellors = users.filter(u => u.role === "Counsellor");
  const targets = [];
  counsellors.forEach(c => {
    intakes.forEach(intake => {
      targets.push({ id: uid("tgt"), counsellorId: c.id, intakeId: intake.id, target: 5 + Math.floor(Math.random() * 8) });
    });
  });
  return targets;
}

function defaultDB() {
  const users = seedUsers();
  const intakes = seedIntakes();
  const leads = seedLeads(users, intakes);
  return {
    users,
    leads,
    inquiries: seedInquiries(),
    intakes,
    commissionPlans: seedCommissionPlans(),
    auditLog: seedAuditLog(),
    notifications: [], // UC32/33/34 — escalation notifications addressed to specific users
    stages: STAGES.slice(), // UC64 — ordered stage set; admins may add/remove/reorder
    statusLabels: STAGES.reduce((m, s) => (m[s] = s, m), {}), // UC64 — editable display labels per stage
    statusColors: Object.assign({}, STAGE_COLORS), // UC64 — editable colours per stage
    // Editable copy of stage transition rules (UC38/UC64) — starts from the defaults
    transitionRules: JSON.parse(JSON.stringify(STAGE_TRANSITIONS)),
    rolePermissions: defaultRolePermissions(), // UC49

    /* ---- Admin-configurable field/form model ---- */
    // UC58 / UC30 / UC25 — every dropdown in the lead form is admin-editable
    picklists: {
      universities: UNIVERSITIES.slice(),
      programs: PROGRAMS.slice(),
      districts: DISTRICTS.slice(),
      domains: DOMAINS.slice(),
      leadSources: LEAD_SOURCES.slice(),
      digitalSubSources: DIGITAL_SUBSOURCES.slice(),
      lossReasons: LOSS_REASONS.slice()
    },
    // UC59 — which fields are mandatory to ENTER each stage
    mandatoryFields: JSON.parse(JSON.stringify(STAGE_MANDATORY_FIELDS)),
    // UC54 — stage qualification checklist items
    checklistTemplate: CHECKLIST_TEMPLATE.slice(),
    // UC60 — configurable duplicate-matching rules
    duplicateRules: { matchMobile: true, matchEmail: true, matchName: false },
    // UC32 / UC33 — SLA + escalation timings
    slaRules: { firstContactDays: 1, followUpIntervalDays: 5, graceDays: 1 },

    currentUserId: "u_mgr1",
    counsellorTargets: seedTargets(users, intakes), // UC3
    reports: [], // generated commission reports (UC6-UC13)
    reportConfig: { // UC12
      columns: ["Student Name", "University", "Program", "Commission Amount", "Status"],
      recipients: ["finance@uniconnect.demo"]
    },
    commissionRules: { // UC14 / UC15
      paymentThreshold: 250000,      // student must have paid at least this much
      requireZeroOutstanding: true,  // referrals blocked while arrears exist
      expiryDays: 25                 // UC19
    },
    scheduledReportEnabled: true, // UC10
    segments: [], // UC28 saved custom segments
    deactivationMinDays: 3 // UC41 — leads must be at least N days old before deactivation, unless overridden
  };
}

let DB = null;

function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (raw) {
    try {
      DB = JSON.parse(raw);
      migrateDB();
      return DB;
    } catch (e) { /* fallthrough to reseed */ }
  }
  DB = defaultDB();
  saveDB();
  return DB;
}

// Fills in any new fields introduced after a user's demo DB was already saved to localStorage.
function migrateDB() {
  const fresh = defaultDB();
  Object.keys(fresh).forEach(key => {
    if (DB[key] === undefined) DB[key] = fresh[key];
  });
  DB.users.forEach(u => { if (u.domain === undefined) u.domain = "All"; });
  // Backfill any individually-missing picklist (e.g. a key added after the DB was saved)
  if (DB.picklists) Object.keys(fresh.picklists).forEach(k => {
    if (!Array.isArray(DB.picklists[k]) || !DB.picklists[k].length) DB.picklists[k] = fresh.picklists[k];
  });
  DB.leads.forEach(l => {
    if (l.escalated === undefined) l.escalated = false;
    if (l.districtOther === undefined) l.districtOther = "";
    if (l.nextFollowUp === undefined) l.nextFollowUp = l.stage === "Closed" ? "" : todayISO();
    if (l.followUpLog === undefined) l.followUpLog = [];
    if (l.tuitionFee === undefined) l.tuitionFee = 850000;
    if (l.amountPaid === undefined) l.amountPaid = 0;
    if (l.outstandingBalance === undefined) l.outstandingBalance = 0;
  });
  saveDB();
}

function saveDB() {
  localStorage.setItem(DB_KEY, JSON.stringify(DB));
}

function resetDB() {
  localStorage.removeItem(DB_KEY);
  loadDB();
}

function logAudit(action, entity, details, user) {
  DB.auditLog.unshift({
    ts: new Date().toISOString(),
    user: user || (getCurrentUser() ? getCurrentUser().name : "System"),
    action, entity, details
  });
  if (DB.auditLog.length > 500) DB.auditLog.length = 500;
}

function getCurrentUser() {
  return DB.users.find(u => u.id === DB.currentUserId);
}

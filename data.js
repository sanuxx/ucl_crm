/* ============================================================
   UniConnect CRM — Demo Seed Data & Persistence Layer
   All data lives in localStorage under key "uc_crm_db_v2".
   ============================================================ */

const DB_KEY = "uc_crm_db_v2";

const UNIVERSITIES = ["Cardiff Metropolitan", "London South Bank", "Coventry University", "University of Sunderland", "Northumbria University"];
const PROGRAMS = ["Foundation in Business & IT", "BSc Computing", "BA Business Management", "MSc Data Science", "MBA", "BSc Accounting & Finance", "BA Marketing"];
const DISTRICTS = ["Colombo", "Gampaha", "Kandy", "Galle", "Jaffna", "Kurunegala", "Other"];
// Country field — Sri Lanka is the default; district only applies while Sri Lanka is selected
const COUNTRIES = ["Sri Lanka", "India", "United Kingdom", "Australia", "Canada", "United States", "Other"];
// Program-Based Field Configuration — which academic fields the lead form shows is driven by
// each program's type, admin-editable under Admin → Fields & Picklists.
const PROGRAM_TYPES = ["Foundation", "Bachelor's", "Master's", "Other"];
function defaultProgramTypes() {
  return {
    "Foundation in Business & IT": "Foundation",
    "BSc Computing": "Bachelor's",
    "BA Business Management": "Bachelor's",
    "BSc Accounting & Finance": "Bachelor's",
    "BA Marketing": "Bachelor's",
    "MSc Data Science": "Master's",
    "MBA": "Master's"
  };
}

// Application Form — Educational Qualification section: which programs each university offers,
// admin-editable under Admin → Fields & Picklists → Programs by University.
function defaultProgramsByUniversity() {
  return {
    "Cardiff Metropolitan": ["Foundation in Business & IT", "BSc Computing", "MSc Data Science"],
    "London South Bank": ["BA Business Management", "MBA", "BSc Accounting & Finance"],
    "Coventry University": ["BSc Computing", "MSc Data Science", "BA Marketing"],
    "University of Sunderland": ["Foundation in Business & IT", "BA Business Management", "BSc Accounting & Finance"],
    "Northumbria University": ["MBA", "BA Marketing", "BSc Computing"]
  };
}
const LEAD_SOURCES = [
  "Facebook",
  "LinkedIn",
  "YouTube",
  "Instagram",
  "Website",
  "Student Referral",
  "Staff Referral",
  "Agent Referral",
  "Email Campaigns",
  "Database",
  "UCL Event",
  "University Partner Event",
  "Agent Partner Event",
  "School Event Sponsorship",
  "Corporate Event Sponsorship",
  "School Event General",
  "Corporate Event General",
  "Exhibition",
  "Radio",
  "Billboards",
  "Television",
  "Direct Call Counsellor",
  "UCL Alumni",
  "Online Websites",
  "Press Adverts",
  "Press Releases",
];
const DIGITAL_SUBSOURCES = ["Facebook", "Google", "Instagram", "LinkedIn"];
// Mode of Contact — how the lead reached out to the organisation (new lead field)
const MODES_OF_CONTACT = [
  "Walk In",
  "Digital Hotline",
  "General  Hotline",
  "Exhibition",
  "Web Chat - Edusite",
  "UCL Info Email",
  "Social Media Messaging",
  "Direct Call Counsellor",
];
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

// UCL detailed lead statuses — a finer-grained classification layered on top of the
// four system stages. "Not Qualified" statuses apply while a lead sits in Open/Closed;
// "Qualified" statuses apply while a lead sits in Qualified/Converted (see statusStageBucket()).
const DETAILED_STATUS_GROUPS = {
  "Not Qualified Lead": [
    "Programme Not Available", "No Entry Requirement", "Cannot Afford", "Scholarship Enquiry",
    "Unintentional Enquiry", "Ringing No Answer", "Ringing No Response"
  ],
  "Qualified Lead": [
    "Information Provided", "Prospective", "Appointment Scheduled", "Campus Visited",
    "Application Link Sent", "Application Received but Documents Pending", "Application Submitted",
    "Offer Received Conditional", "Offer Received Unconditional", "Registration Fee Paid",
    "Down Payment Fee Paid", "Next Intake", "Future Intake", "Joined Competitor",
    "Not Interested in UCL", "Change of Plans"
  ]
};

// Student Journey Report (sales head/counsellor) — a lead counts as "having submitted an
// application form" once its detailed status reaches one of these (or it has converted).
const POST_APPLICATION_STATUSES = [
  "Application Submitted", "Application Received but Documents Pending",
  "Offer Received Conditional", "Offer Received Unconditional",
  "Registration Fee Paid", "Down Payment Fee Paid"
];

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

/* ---- UC55 / UC57 — structured academic results ---- */
const OL_SUBJECTS = ["Mathematics", "Science", "English", "Sinhala", "History", "Religion", "ICT", "Commerce", "Art", "Geography"];
const AL_SUBJECTS = ["Combined Maths", "Physics", "Chemistry", "Biology", "Accounting", "Business Studies", "Economics", "ICT", "English Literature"];

// UC57 — the grading scale switches with the exam type
const GRADE_SCALES = {
  "O/L": ["A", "B", "C", "S", "W"],
  "Local A/L": ["A", "B", "C", "S", "F"],
  "London A/L": ["A*", "A", "B", "C", "D", "E", "U"]
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
  { id: "staffName", label: "Staff Name" },
  { id: "schoolOrCompany", label: "School / Company" },
  { id: "detailedStatus", label: "Detailed Status" },
  { id: "modeOfContact", label: "Mode of Contact" },
  { id: "country", label: "Country" },
  { id: "previousSchool", label: "Previous School (Foundation)" },
  { id: "bachelorsDegree", label: "Bachelor's Degree (Master's applicants)" },
  { id: "bachelorsUniversity", label: "Bachelor's University (Master's applicants)" }
];

// Application Form Management — status lifecycle for the student-facing application form
const APPLICATION_STATUSES = ["Not Sent", "Sent", "Submitted", "Reviewed"];
const OFFER_TYPES = ["Conditional", "Unconditional"];

function defaultApplicationForm() {
  return {
    status: "Not Sent", sentAt: "", submittedAt: "", reviewedAt: "", reviewedBy: "",
    // Academic Admin verification gate — locks the application once confirmed (UC: Application Verification)
    academicConfirmation: { status: "Not Confirmed", confirmedBy: "", confirmedAt: "" },
    // Offer Release & Student Registration Process
    offerRelease: { status: "Not Released", releasedBy: "", releasedAt: "" },
    discountApproval: { status: "Not Requested", requestedPercent: "", requestedAmount: "", note: "",
      requestedBy: "", requestedAt: "", decidedBy: "", decidedAt: "", decisionNote: "" },
    offerLetter: { status: "Not Issued", type: "", issuedAt: "" },
    paymentPlan: { status: "Not Sent", installments: [], sentAt: "" },
    paymentConfirmed: { status: "Not Confirmed", confirmedBy: "", confirmedAt: "" },
    pushedToAdmin: { status: "Not Pushed", pushedBy: "", pushedAt: "" },
    smsTransfer: { status: "Not Transferred", transferredBy: "", transferredAt: "" }
  };
}

const CHECKLIST_TEMPLATE = [
  "Verify academic results",
  "Confirm contact number",
  "Confirm program interest",
  "Duplicate check passed",
  "Financial capability discussed"
];

const ROLES = ["Counsellor", "Manager", "Head of Marketing", "CEO", "Commission Admin", "Finance", "Admin", "Agent", "Academic Admin"];

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
  { id: "journey", label: "Student Journey" },
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
  perms["Counsellor"].reports = ["status", "sla", "journey"];
  perms["Agent"].widgets = ["activity"];
  perms["Agent"].reports = ["agent"];
  perms["Finance"].reports = ["counsellor", "agent"];
  // Academic Admin gets a dedicated Application Verification workspace instead of the sales dashboard/reports
  perms["Academic Admin"].widgets = [];
  perms["Academic Admin"].reports = [];
  return perms;
}

function uid(prefix) { return prefix + "_" + Math.random().toString(36).slice(2, 9); }

function seedUsers() {
  // domain "All" = global visibility across tenants (UC30)
  return [
    { id: "u_ceo", name: "Ranil W.", role: "CEO", managerId: null, domain: "All" },
    { id: "u_hom", name: "Anjali Perera", role: "Head of Marketing", managerId: "u_ceo", domain: "All" },
    { id: "u_admin", name: "Dilmitha (Admin)", role: "Admin", managerId: null, domain: "All" },
    { id: "u_finance", name: "Kamal Silva", role: "Finance", managerId: "u_hom", domain: "All" },
    { id: "u_cadmin", name: "Nadeesha (Comm. Admin)", role: "Commission Admin", managerId: "u_hom", domain: "All" },
    { id: "u_mgr1", name: "Dilani Fernando", role: "Manager", managerId: "u_hom", domain: "Colombo Branch" },
    { id: "u_mgr2", name: "Suresh Kumar", role: "Manager", managerId: "u_hom", domain: "Kandy Branch" },
    { id: "u_c1", name: "Ishara Jayasuriya", role: "Counsellor", managerId: "u_mgr1", domain: "Colombo Branch" },
    { id: "u_c2", name: "Tharindu Silva", role: "Counsellor", managerId: "u_mgr1", domain: "Colombo Branch" },
    { id: "u_c3", name: "Nimasha Perera", role: "Counsellor", managerId: "u_mgr2", domain: "Kandy Branch" },
    { id: "u_agent1", name: "Global Edu Partners (Agent)", role: "Agent", managerId: "u_mgr2", domain: "Online Division" },
    { id: "u_acadmin", name: "Priyanka Rodrigo (Academic Admin)", role: "Academic Admin", managerId: "u_ceo", domain: "All" }
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
    { id: "in_sep26", name: "September 2026 Intake", start: "2026-09-01", end: "2026-09-28", programs: PROGRAMS },
    { id: "in_jan27", name: "January 2027 Intake", start: "2027-01-04", end: "2027-01-30", programs: PROGRAMS }
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

// Builds a random set of {subject, grade} rows for the seed data (UC55)
function makeGradeRows(subjectPool, scaleKey, count) {
  const scale = GRADE_SCALES[scaleKey];
  const pool = subjectPool.slice();
  const rows = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    rows.push({ subject: pool.splice(idx, 1)[0], grade: rand(scale) });
  }
  return rows;
}

// "3A 2B 1C" — a compact readable roll-up used in tables, exports and the
// mandatory-field check, always derived from the structured rows.
function summariseGrades(rows) {
  if (!rows || !rows.length) return "";
  const counts = {};
  rows.forEach(r => { if (r.grade) counts[r.grade] = (counts[r.grade] || 0) + 1; });
  const keys = Object.keys(counts);
  if (!keys.length) return "";
  return keys.map(g => counts[g] + g).join(" ");
}

// Synthetic-but-realistic "Stage Change" activity trail for a seeded lead — mirrors the entries
// attemptStageChange()/handleKanbanDrop() write during real use, so the Student Journey Report has
// genuine per-stage dates to show for demo data, not just leads touched during the live session.
function makeStageActivity(createdAt, currentStage) {
  const path = currentStage === "Qualified" ? ["Qualified"]
    : currentStage === "Converted" ? ["Qualified", "Converted"]
    : currentStage === "Closed" ? (Math.random() > 0.5 ? ["Closed"] : ["Qualified", "Closed"])
    : [];
  const events = [];
  let cursor = new Date(createdAt);
  let from = "Open";
  path.forEach(to => {
    cursor = new Date(Math.min(Date.now(), cursor.getTime() + (1 + Math.floor(Math.random() * 10)) * 86400000));
    events.push({ ts: cursor.toISOString(), user: "System", type: "Stage Change", text: `Moved from ${from} to ${to}` });
    from = to;
  });
  return events;
}

// Student Application Form Management — plausible seed status correlated with pipeline stage,
// so the demo shows something meaningful for each status without every lead starting blank.
function makeApplicationForm(stage) {
  const f = defaultApplicationForm();
  if (stage === "Open") return f;
  const roll = Math.random();
  if (stage === "Qualified") {
    f.status = roll < 0.4 ? "Not Sent" : roll < 0.75 ? "Sent" : "Submitted";
  } else if (stage === "Converted") {
    f.status = roll < 0.5 ? "Submitted" : "Reviewed";
  } else {
    f.status = roll < 0.5 ? "Not Sent" : "Sent";
  }
  if (f.status !== "Not Sent") f.sentAt = new Date().toISOString();
  if (f.status === "Submitted" || f.status === "Reviewed") f.submittedAt = new Date().toISOString();
  if (f.status === "Reviewed") { f.reviewedAt = new Date().toISOString(); f.reviewedBy = "System"; }

  // Offer Release & Student Registration Process — progresses probabilistically once Reviewed,
  // so the Academic Admin queue, Pending Offer dashboard and registration pipeline aren't empty on a fresh seed.
  if (f.status === "Reviewed" && Math.random() < 0.7) {
    f.academicConfirmation = { status: "Confirmed", confirmedBy: "Priyanka Rodrigo (Academic Admin)", confirmedAt: new Date().toISOString() };
    if (Math.random() < 0.7) {
      f.offerRelease = { status: "Released", releasedBy: "Priyanka Rodrigo (Academic Admin)", releasedAt: new Date().toISOString() };
      if (Math.random() < 0.5) {
        const approved = Math.random() < 0.7;
        f.discountApproval = {
          status: approved ? "Approved" : "Pending", requestedPercent: rand([5, 10, 15]), requestedAmount: "",
          note: "Requested at counsellor's discretion", requestedBy: "System", requestedAt: new Date().toISOString(),
          decidedBy: approved ? "Anjali Perera" : "", decidedAt: approved ? new Date().toISOString() : "", decisionNote: approved ? "Approved" : ""
        };
      }
      if (Math.random() < 0.6) {
        f.offerLetter = { status: "Issued", type: rand(OFFER_TYPES), issuedAt: new Date().toISOString() };
        if (Math.random() < 0.6) {
          f.paymentPlan = {
            status: "Sent", sentAt: new Date().toISOString(),
            installments: [
              { label: "Registration Fee", amount: 25000, dueDate: todayISO() },
              { label: "Installment 1", amount: 200000, dueDate: isoDateOffset(30) },
              { label: "Installment 2", amount: 200000, dueDate: isoDateOffset(90) }
            ]
          };
          if (Math.random() < 0.5) {
            f.paymentConfirmed = { status: "Confirmed", confirmedBy: "System", confirmedAt: new Date().toISOString() };
            if (Math.random() < 0.6) {
              f.pushedToAdmin = { status: "Pushed", pushedBy: "System", pushedAt: new Date().toISOString() };
              if (Math.random() < 0.5) {
                f.smsTransfer = { status: "Transferred", transferredBy: "Priyanka Rodrigo (Academic Admin)", transferredAt: new Date().toISOString() };
              }
            }
          }
        }
      }
    }
  }
  return f;
}

// Follow-Up Notes & Task Management — a couple of realistic per-stage notes/tasks so the new
// tab isn't empty on a fresh demo seed.
function makeStageTasks(stage, createdAt) {
  if (stage === "Open" || Math.random() > 0.55) return [];
  const notes = [
    "Called to confirm interest — asked to follow up next week.",
    "Sent programme brochure, awaiting response.",
    "Discussed tuition fees and payment options.",
    "Parent requested a campus visit slot.",
    "Confirmed documents are being prepared."
  ];
  const count = 1 + Math.floor(Math.random() * 2);
  const tasks = [];
  for (let i = 0; i < count; i++) {
    const due = Math.random() > 0.5 ? isoDateOffset(-(1 + Math.floor(Math.random() * 6))) + "T10:00" : isoDateOffset(1 + Math.floor(Math.random() * 7)) + "T14:00";
    tasks.push({ id: uid("task"), stage, note: rand(notes), dueAt: due, done: Math.random() > 0.6, createdAt: createdAt, createdBy: "System" });
  }
  return tasks;
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
    const program = stage === "Open" && Math.random() > 0.5 ? "" : rand(PROGRAMS);
    const progType = defaultProgramTypes()[program] || "Other";
    const country = Math.random() > 0.85 ? rand(COUNTRIES.filter(c => c !== "Sri Lanka")) : "Sri Lanka";
    // Pending-results leads have no grades on file yet (UC56)
    const olRows = resultsPending ? [] : makeGradeRows(OL_SUBJECTS, "O/L", 6 + Math.floor(Math.random() * 3));
    const alRows = resultsPending ? [] : makeGradeRows(AL_SUBJECTS, examType, 3);

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
      modeOfContact: rand(MODES_OF_CONTACT),
      digitalSubSource: source === "Digital" ? rand(DIGITAL_SUBSOURCES) : null,
      studentId: source === "Student" ? "STU" + (1000 + i) : "",
      staffName: source === "Staff" ? rand(FIRST_NAMES) + " " + rand(LAST_NAMES) : "",
      schoolOrCompany: source === "Staff" ? rand(["Acme Corp", "Colombo Tech Ltd", "Global Edu Partners"]) : (source === "Student" ? rand(["Royal College", "Ladies' College", "Trinity College"]) : ""),
      detailedStatus: stage === "Open" ? (Math.random() > 0.5 ? rand(DETAILED_STATUS_GROUPS["Not Qualified Lead"]) : "") : rand(DETAILED_STATUS_GROUPS["Qualified Lead"]),
      university: stage === "Open" && Math.random() > 0.5 ? "" : rand(UNIVERSITIES),
      program,
      country,
      district: country === "Sri Lanka" ? rand(DISTRICTS) : "",
      districtOther: "",
      // Program-Based Field Configuration — only the fields relevant to this program's type are seeded
      previousSchool: progType === "Foundation" ? rand(["Royal College", "Ladies' College", "Trinity College", "Ananda College"]) : "",
      priorQualificationType: progType === "Foundation" ? rand(["O/L", "A/L"]) : "",
      bachelorsDegree: progType === "Master's" ? rand(["BSc Computing", "BA Business Management", "BSc Accounting & Finance"]) : "",
      bachelorsUniversity: progType === "Master's" ? rand(UNIVERSITIES) : "",
      examType,
      resultsPending,
      olSubjects: olRows,
      alSubjects: alRows,
      olResult: summariseGrades(olRows), // derived roll-up of olSubjects
      alResult: summariseGrades(alRows), // derived roll-up of alSubjects
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
      applicationForm: makeApplicationForm(stage),
      websiteLead: false, // Website Leads — true only for leads submitted directly via the Apply Online form with no counsellor
      tasks: makeStageTasks(stage, created),
      createdAt: created,
      activity: [
        ...makeStageActivity(created, stage).reverse(),
        { ts: created, user: "System", type: "Create", text: `Lead created via ${source}` }
      ]
    };
    leads.push(lead);
  }
  return leads;
}

// Website Leads — a handful of leads submitted directly via Apply Online with no counsellor,
// so the Website Leads dashboard (Head of Marketing) isn't empty on a fresh seed.
function seedWebsiteLeads(intakes) {
  const leads = [];
  const count = 4;
  for (let i = 0; i < count; i++) {
    const first = rand(FIRST_NAMES), last = rand(LAST_NAMES);
    const university = rand(UNIVERSITIES);
    const programsHere = defaultProgramsByUniversity()[university] || PROGRAMS;
    const program = rand(programsHere);
    const progType = defaultProgramTypes()[program] || "Other";
    leads.push({
      id: uid("lead"), name: `${first} ${last}`,
      mobile: "07" + Math.floor(10000000 + Math.random() * 89999999),
      email: `${first}.${last}.web@example.com`.toLowerCase(),
      leadSource: "Website", modeOfContact: "Website Form", digitalSubSource: null,
      studentId: "", staffName: "", schoolOrCompany: "", detailedStatus: "",
      university, program, country: "Sri Lanka", district: rand(DISTRICTS), districtOther: "",
      previousSchool: progType === "Foundation" ? rand(["Royal College", "Ladies' College", "Trinity College"]) : "",
      priorQualificationType: progType === "Foundation" ? rand(["O/L", "A/L"]) : "",
      bachelorsDegree: progType === "Master's" ? rand(["BSc Computing", "BA Business Management"]) : "",
      bachelorsUniversity: progType === "Master's" ? rand(UNIVERSITIES) : "",
      examType: "Local A/L", resultsPending: true, olSubjects: [], alSubjects: [], olResult: "", alResult: "",
      languageTest: "None", languageScore: "",
      stage: "Open", deactivated: false, deactivationReason: "", lossReason: "",
      assignedTo: "", intakeId: rand(intakes).id,
      domain: rand(DOMAINS), isReferral: false, referralType: "", agentId: "",
      checklist: makeChecklist(false), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0,
      nextFollowUp: "", followUpLog: [], escalated: false,
      applicationForm: Object.assign(defaultApplicationForm(), { status: "Submitted", sentAt: new Date().toISOString(), submittedAt: new Date().toISOString() }),
      websiteLead: true, tasks: [],
      createdAt: randDateWithinDays(10),
      activity: [{ ts: new Date().toISOString(), user: "System", type: "Create", text: "Application submitted directly via website — no counsellor assigned" }]
    });
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

// Head of Marketing dashboards — target counts to compare against actuals (admin-editable)
function seedPipelineStageTargets() {
  return { Open: 90, Qualified: 55, Converted: 30, Closed: 20 };
}
function seedLeadSourceTargets() {
  return { Facebook: 20, "Student Referral": 15, Website: 20, Exhibition: 15, "Agent Referral": 12, Database: 10, "UCL Event": 8 };
}

function defaultDB() {
  const users = seedUsers();
  const intakes = seedIntakes();
  const leads = seedLeads(users, intakes).concat(seedWebsiteLeads(intakes));
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
      countries: COUNTRIES.slice(),
      domains: DOMAINS.slice(),
      leadSources: LEAD_SOURCES.slice(),
      modesOfContact: MODES_OF_CONTACT.slice(),
      digitalSubSources: DIGITAL_SUBSOURCES.slice(),
      lossReasons: LOSS_REASONS.slice(),
      olSubjects: OL_SUBJECTS.slice(),
      alSubjects: AL_SUBJECTS.slice(),
      detailedStatusesNotQualified: DETAILED_STATUS_GROUPS["Not Qualified Lead"].slice(),
      detailedStatusesQualified: DETAILED_STATUS_GROUPS["Qualified Lead"].slice()
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
    pipelineStageTargets: seedPipelineStageTargets(), // Head of Marketing — Pipeline Target vs Actual dashboard
    leadSourceTargets: seedLeadSourceTargets(), // Head of Marketing — Lead Source dashboard
    programTypes: defaultProgramTypes(), // Program-Based Field Configuration
    programsByUniversity: defaultProgramsByUniversity(), // Application Form — Educational Qualification cascade
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
  const adminUser = DB.users.find(u => u.id === "u_admin");
  if (adminUser && adminUser.name === "Sanu (Admin)") adminUser.name = "Dilmitha (Admin)";
  // Backfill any individually-missing picklist (e.g. a key added after the DB was saved)
  if (DB.picklists) Object.keys(fresh.picklists).forEach(k => {
    if (!Array.isArray(DB.picklists[k]) || !DB.picklists[k].length) DB.picklists[k] = fresh.picklists[k];
  });
  // Force-refresh Lead Source / Mode of Contact picklists to the current admin-defined lists
  // (these were expanded after many demo DBs were already saved to localStorage with the old, shorter lists)
  if (DB.picklists) {
    DB.picklists.leadSources = LEAD_SOURCES.slice();
    DB.picklists.modesOfContact = MODES_OF_CONTACT.slice();
  }
  DB.leads.forEach(l => {
    if (l.escalated === undefined) l.escalated = false;
    if (l.districtOther === undefined) l.districtOther = "";
    if (l.nextFollowUp === undefined) l.nextFollowUp = l.stage === "Closed" ? "" : todayISO();
    if (l.followUpLog === undefined) l.followUpLog = [];
    if (l.olSubjects === undefined) l.olSubjects = [];
    if (l.alSubjects === undefined) l.alSubjects = [];
    if (l.schoolOrCompany === undefined) l.schoolOrCompany = "";
    if (l.detailedStatus === undefined) l.detailedStatus = "";
    if (l.tuitionFee === undefined) l.tuitionFee = 850000;
    if (l.amountPaid === undefined) l.amountPaid = 0;
    if (l.outstandingBalance === undefined) l.outstandingBalance = 0;
    if (l.modeOfContact === undefined) l.modeOfContact = "";
    if (l.country === undefined) l.country = "Sri Lanka";
    if (l.previousSchool === undefined) l.previousSchool = "";
    if (l.priorQualificationType === undefined) l.priorQualificationType = "";
    if (l.bachelorsDegree === undefined) l.bachelorsDegree = "";
    if (l.bachelorsUniversity === undefined) l.bachelorsUniversity = "";
    if (l.applicationForm === undefined) l.applicationForm = defaultApplicationForm();
    // Offer Release & Student Registration Process — merge in any sub-objects added after this
    // lead's applicationForm was first saved, without disturbing values already recorded.
    const freshAF = defaultApplicationForm();
    Object.keys(freshAF).forEach(k => {
      if (typeof freshAF[k] === "object" && freshAF[k] !== null) {
        l.applicationForm[k] = Object.assign({}, freshAF[k], l.applicationForm[k] || {});
      } else if (l.applicationForm[k] === undefined) {
        l.applicationForm[k] = freshAF[k];
      }
    });
    if (l.tasks === undefined) l.tasks = [];
    if (l.websiteLead === undefined) l.websiteLead = false;
    // Remap old Lead Source / Mode of Contact values (pre-expansion picklists) to the current lists
    const LEAD_SOURCE_MIGRATION = {
      Student: "Student Referral",
      Staff: "Staff Referral",
      Digital: "Online Websites",
      "Bulk Upload": "Database",
      "Walk-in": "Direct Call Counsellor",
    };
    if (LEAD_SOURCE_MIGRATION[l.leadSource]) l.leadSource = LEAD_SOURCE_MIGRATION[l.leadSource];
    const MODE_OF_CONTACT_MIGRATION = {
      Email: "UCL Info Email",
      "Telephone Call": "Direct Call Counsellor",
      Hotline: "Digital Hotline",
      "General Line": "General  Hotline",
      "Walk-in": "Walk In",
      "Social Media": "Social Media Messaging",
      "Website Form": "Web Chat - Edusite",
    };
    if (MODE_OF_CONTACT_MIGRATION[l.modeOfContact]) l.modeOfContact = MODE_OF_CONTACT_MIGRATION[l.modeOfContact];
  });
  // Backfill the Academic Admin user + role permissions for demo DBs saved before this role existed
  if (DB.users && !DB.users.some(u => u.role === "Academic Admin")) {
    DB.users.push({ id: "u_acadmin", name: "Priyanka Rodrigo (Academic Admin)", role: "Academic Admin", managerId: "u_ceo", domain: "All" });
  }
  if (DB.rolePermissions && !DB.rolePermissions["Academic Admin"]) {
    DB.rolePermissions["Academic Admin"] = { widgets: [], reports: [], viewAmounts: false };
  }
  if (DB.programTypes) Object.keys(defaultProgramTypes()).forEach(p => {
    if (DB.programTypes[p] === undefined) DB.programTypes[p] = defaultProgramTypes()[p];
  });
  // Backfill the new "journey" report for any role permissions saved before it existed
  if (DB.rolePermissions) Object.keys(DB.rolePermissions).forEach(role => {
    const p = DB.rolePermissions[role];
    if (p && Array.isArray(p.reports) && !p.reports.includes("journey")) p.reports.push("journey");
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

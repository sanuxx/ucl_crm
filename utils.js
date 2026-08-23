/* ============================================================
   Utility helpers: toasts, modals, formatting, RBAC filtering
   ============================================================ */

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function daysAgo(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function money(n) {
  if (n === null || n === undefined) return "-";
  return "LKR " + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

/* ============================================================
   Icons
   Emoji rendered as UI chrome were the strongest "not enterprise software"
   signal in the app, and they rasterise differently on Windows vs macOS — so a
   demo looked different on every machine. These are 16px stroke glyphs matching
   the sidebar nav's existing style (currentColor, 1.6 stroke, round caps), so an
   icon always inherits the colour of the control it sits in.
   Usage: icon("download") — returns an inline <svg> string.
   ============================================================ */
const ICON_PATHS = {
  plus:        '<path d="M8 3.5v9M3.5 8h9"/>',
  download:    '<path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13h10"/>',
  upload:      '<path d="M8 13.5v-8M4.5 8.5 8 5l3.5 3.5M3 3h10"/>',
  document:    '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
  mail:        '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="m3 5 5 3.5L13 5"/>',
  check:       '<path d="m3.5 8.5 3 3 6-7"/>',
  checkCircle: '<circle cx="8" cy="8" r="6"/><path d="m5.5 8 1.8 1.8L10.5 6"/>',
  x:           '<path d="m4 4 8 8M12 4l-8 8"/>',
  lock:        '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  bell:        '<path d="M12 6a4 4 0 0 0-8 0c0 4.5-1.5 5.5-1.5 5.5h11S12 10.5 12 6"/><path d="M9.2 13.5a1.4 1.4 0 0 1-2.4 0"/>',
  card:        '<rect x="2" y="4" width="12" height="8" rx="1.5"/><path d="M2 7h12"/>',
  cap:         '<path d="M8 3 1.5 6 8 9l6.5-3z"/><path d="M4 7.5v3c0 1 1.8 1.8 4 1.8s4-.8 4-1.8v-3"/>',
  note:        '<path d="M3 3h10v7l-3 3H3z"/><path d="M13 10h-3v3"/>',
  target:      '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5"/>',
  globe:       '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5a9 9 0 0 1 0 11 9 9 0 0 1 0-11"/>',
  refresh:     '<path d="M13 8a5 5 0 1 1-1.6-3.6"/><path d="M13.5 2.5V6H10"/>',
  send:        '<path d="m13.5 2.5-11 4 4.2 1.8L8.5 12z"/>',
  users:       '<circle cx="6.5" cy="6" r="2.3"/><path d="M2.5 13c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6"/><path d="M11 4.2a2.3 2.3 0 0 1 0 4.2M12 13c0-1.6-.6-2.6-1.6-3.2"/>',
  clock:       '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.3"/>',
  warn:        '<path d="M8 2.8 14 13H2z"/><path d="M8 6.6v2.6M8 11h.01"/>',
  info:        '<circle cx="8" cy="8" r="5.5"/><path d="M8 7.3v3.4M8 5.3h.01"/>',
  save:        '<path d="M3 3h7l3 3v7H3z"/><path d="M5.5 3v3.5h5V3M5.5 13v-3.5h5V13"/>',
  phone:       '<rect x="4.5" y="2" width="7" height="12" rx="1.5"/><path d="M7 12h2"/>',
  search:      '<circle cx="7.2" cy="7.2" r="4.2"/><path d="m10.4 10.4 2.6 2.6"/>',
  user:        '<circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.5c0-2.5 2.2-4.2 5-4.2s5 1.7 5 4.2"/>',
  calendar:    '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>'
};
function icon(name, cls) {
  const d = ICON_PATHS[name];
  if (!d) return "";
  return `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${d}</svg>`;
}

const TOAST_MAX = 3;        // deep stacks blanket the corner and hide each other
const TOAST_LIFE_MS = 2600;

function dismissToast(el) {
  if (!el || el.classList.contains("leaving")) return;
  clearTimeout(el.__timer);
  el.classList.add("leaving");
  setTimeout(() => el.remove(), 200); // matches the .toast transition
}

function toast(msg, type) {
  const c = document.getElementById("toastContainer");
  if (!c) return;

  // Repeating the same message (e.g. hammering a blocked action) should reset the
  // existing toast rather than stack duplicates.
  const last = c.lastElementChild;
  if (last && !last.classList.contains("leaving") && last.dataset.msg === msg) {
    clearTimeout(last.__timer);
    last.__timer = setTimeout(() => dismissToast(last), TOAST_LIFE_MS);
    return;
  }

  while (c.children.length >= TOAST_MAX) c.firstElementChild.remove();

  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = msg;
  el.dataset.msg = msg;
  el.title = "Click to dismiss";
  el.onclick = () => dismissToast(el);
  c.appendChild(el);
  el.__timer = setTimeout(() => dismissToast(el), TOAST_LIFE_MS);
}

function openModal(html, opts) {
  opts = opts || {};
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-overlay" id="modalOverlay"><div class="modal" style="max-width:${opts.width || 760}px">${html}</div></div>`;
  document.getElementById("modalOverlay").addEventListener("mousedown", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
  // Esc closes; focus the first field so you can type straight away
  document.addEventListener("keydown", modalEscHandler);
  // Toasts live bottom-right — exactly where .modal-footer puts Save/Cancel. This
  // flag moves the toast stack to the top for as long as a modal is open, so it
  // can never sit over the buttons the user is trying to click.
  document.body.classList.add("modal-open");
  const firstInput = root.querySelector("input:not([type=checkbox]):not([type=file]), select, textarea");
  if (firstInput && !opts.noAutofocus) setTimeout(() => firstInput.focus(), 40);
}
function modalEscHandler(e) {
  if (e.key === "Escape") closeModal();
}

/* In-app replacement for native confirm()/prompt(), which render unstyled OS chrome
   mid-demo. Optionally collects a required reason, replacing prompt() outright.

   IMPORTANT: this writes into #modalRoot like every other modal, so it REPLACES any
   modal already on screen. Only call it when nothing else is open — when a modal is
   already up, render an inline .notice into that modal's body instead (see the
   duplicate-lead flow in saveLeadModal). */
function confirmModal(opts) {
  opts = opts || {};
  const needsReason = !!opts.requireReason;
  window.__confirmModalCb = opts.onConfirm;
  openModal(`
    <div class="modal-header"><h2>${esc(opts.title || "Please confirm")}</h2>
      <button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p>${esc(opts.message || "")}</p>
      ${needsReason ? `<div class="field"><label class="required">${esc(opts.reasonLabel || "Reason")}</label>
        <input id="confirmModalReason" placeholder="${esc(opts.placeholder || "")}" oninput="document.getElementById('confirmModalGo').disabled = !this.value.trim()"></div>` : ""}
    </div>
    <div class="modal-footer">
      <button class="btn secondary" onclick="closeModal()">${esc(opts.cancelLabel || "Cancel")}</button>
      <button class="btn ${opts.danger ? "danger" : ""}" id="confirmModalGo" ${needsReason ? "disabled" : ""}
        onclick="submitConfirmModal()">${esc(opts.confirmLabel || "Confirm")}</button>
    </div>
  `, { width: 520 });
}
function submitConfirmModal() {
  const input = document.getElementById("confirmModalReason");
  const reason = input ? input.value.trim() : "";
  if (input && !reason) return; // button is disabled anyway; belt and braces
  const cb = window.__confirmModalCb;
  window.__confirmModalCb = null;
  closeModal();
  if (cb) cb(reason);
}
function closeModal() {
  document.removeEventListener("keydown", modalEscHandler);
  document.body.classList.remove("modal-open");
  document.getElementById("modalRoot").innerHTML = "";
}

/* ---------------- RBAC: row-level security (M3) ---------------- */
function currentRole() {
  const u = getCurrentUser();
  return u ? u.role : "Counsellor";
}

function teamUserIds(managerId) {
  return DB.users.filter(u => u.managerId === managerId).map(u => u.id);
}

// UC30 — tenant/domain partitioning. Applied as a BASE filter before any role rule,
// so a Kandy Branch user can never see Colombo Branch data regardless of their role.
function tenantScoped(leads) {
  const user = getCurrentUser();
  if (!user || !user.domain || user.domain === "All") return leads;
  return leads.filter(l => l.domain === user.domain);
}

// Returns leads visible to the current user based on role (UC26, UC27, UC29, UC30)
function visibleLeads() {
  const user = getCurrentUser();
  if (!user) return DB.leads;
  const scoped = tenantScoped(DB.leads); // UC30 base partition
  switch (user.role) {
    case "Counsellor":
      return scoped.filter(l => l.assignedTo === user.id);
    case "Manager": {
      const team = teamUserIds(user.id);
      return scoped.filter(l => team.includes(l.assignedTo));
    }
    case "Agent":
      return scoped.filter(l => l.agentId === user.id);
    // Academic Admin — access only to applications relevant to verification (Student Application
    // Forms and Offer Letters), i.e. leads whose application form has actually been sent onward.
    case "Academic Admin":
      return scoped.filter(l => (l.applicationForm || {}).status !== "Not Sent");
    case "Head of Marketing":
    case "CEO":
    case "Admin":
    case "Commission Admin":
    case "Finance":
    default:
      return scoped; // full visibility (UC29), still tenant-scoped if the user has a domain
  }
}

/* ---------------- UC49 — role-configurable visibility ---------------- */
function rolePerms() {
  const p = (DB.rolePermissions || {})[currentRole()];
  return p || { widgets: [], reports: [], viewAmounts: false };
}
function canViewAmounts() {
  return !!rolePerms().viewAmounts;
}
function canViewWidget(id) {
  return (rolePerms().widgets || []).includes(id);
}
function canViewReport(id) {
  return (rolePerms().reports || []).includes(id);
}

function canTransferLeads() {
  return ["Manager", "Admin", "Head of Marketing", "CEO"].includes(currentRole());
}

function canBulkAction() {
  return ["Manager", "Admin", "Head of Marketing", "CEO"].includes(currentRole());
}

function userName(id) {
  const u = DB.users.find(x => x.id === id);
  return u ? u.name : "Unassigned";
}

/* ---------------- Configurable stage set (UC64) ---------------- */
function stages() {
  const s = DB && DB.stages;
  return (Array.isArray(s) && s.length) ? s : STAGES;
}
function isSystemStage(stage) {
  return SYSTEM_STAGES.includes(stage);
}
function leadsInStage(stage) {
  return DB.leads.filter(l => l.stage === stage).length;
}
function stageLabel(stage) {
  return (DB.statusLabels && DB.statusLabels[stage]) || stage;
}
function stageColor(stage) {
  return (DB.statusColors && DB.statusColors[stage]) || STAGE_COLORS[stage] || DEFAULT_STAGE_COLOR;
}
function stageBadge(stage) {
  const label = esc(stageLabel(stage));
  const custom = DB.statusColors && DB.statusColors[stage] && DB.statusColors[stage] !== STAGE_COLORS[stage] ? DB.statusColors[stage] : null;
  const style = custom ? ` style="background:${custom}22;color:${custom}"` : "";
  return `<span class="badge ${stage.toLowerCase()}"${style}>${label}</span>`;
}
function commissionBadge(status) {
  return `<span class="badge ${status.toLowerCase()}">${status}</span>`;
}
// Student Application Form Management — visibility of application status on the lead record
function applicationStatusBadge(applicationForm) {
  const af = applicationForm || defaultApplicationForm();
  const colorClass = { "Not Sent": "closed", "Sent": "pending", "Submitted": "qualified", "Reviewed": "converted" }[af.status] || "closed";
  return `<span class="badge ${colorClass}">Application: ${esc(af.status)}</span>`;
}

function addActivity(lead, type, text) {
  lead.activity = lead.activity || [];
  lead.activity.unshift({ ts: new Date().toISOString(), user: getCurrentUser() ? getCurrentUser().name : "System", type, text });
}

/* ---------------- Admin-configurable picklists (UC25 / UC30 / UC58) ---------------- */
const PICKLIST_FALLBACK = {
  universities: () => UNIVERSITIES, programs: () => PROGRAMS, districts: () => DISTRICTS,
  domains: () => DOMAINS, leadSources: () => LEAD_SOURCES,
  digitalSubSources: () => DIGITAL_SUBSOURCES, lossReasons: () => LOSS_REASONS,
  modesOfContact: () => MODES_OF_CONTACT, countries: () => COUNTRIES
};

/* ---------------- Program-Based Field Configuration ---------------- */
function programType(program) {
  return (DB.programTypes && DB.programTypes[program]) || "Other";
}

/* ---------------- Application Form — Educational Qualification cascade ---------------- */
function programsForUniversity(university) {
  const list = DB.programsByUniversity && DB.programsByUniversity[university];
  return (Array.isArray(list) && list.length) ? list : picklist('programs');
}

/* ---------------- Application Form — Intake Display (Current & Next Intake only) ---------------- */
function currentAndNextIntakes() {
  const today = todayStr();
  const sorted = (DB.intakes || []).slice().sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  if (!sorted.length) return [];
  let current = sorted.find(i => i.start <= today && today <= i.end);
  if (!current) current = sorted.find(i => i.end >= today) || sorted[sorted.length - 1];
  const idx = sorted.indexOf(current);
  const next = sorted[idx + 1] || null;
  return [current, next].filter(Boolean);
}

/* ---------------- Website Leads ---------------- */
function unassignedWebsiteLeads(leads) {
  return leads.filter(l => l.websiteLead && !l.assignedTo);
}

/* ---------------- Offer Release & Student Registration Process ---------------- */
function academicAdminUsers() { return DB.users.filter(u => u.role === "Academic Admin"); }
function headOfMarketingUsers() { return DB.users.filter(u => u.role === "Head of Marketing"); }
function notifyRole(role, leadId, reason, level) {
  DB.users.filter(u => u.role === role).forEach(u => notify(u.id, leadId, reason, level));
}
// Leads awaiting Academic Admin confirmation — Reviewed by the counsellor but not yet confirmed.
function pendingConfirmationLeads(leads) {
  return leads.filter(l => l.applicationForm && l.applicationForm.status === "Reviewed" && l.applicationForm.academicConfirmation.status !== "Confirmed");
}
// Leads pushed to Admin Staff for registration but not yet transferred to the SMS.
function pendingRegistrationLeads(leads) {
  return leads.filter(l => l.applicationForm && l.applicationForm.pushedToAdmin.status === "Pushed" && l.applicationForm.smsTransfer.status !== "Transferred");
}
// Pending Offer Dashboard (Counsellor) — offer released by Academic Admin but not yet sent to the student.
function pendingOfferLeads(leads) {
  return leads.filter(l => l.applicationForm && l.applicationForm.offerRelease.status === "Released" && l.applicationForm.offerLetter.status !== "Issued");
}
function picklist(key) {
  const v = DB && DB.picklists && DB.picklists[key];
  if (Array.isArray(v) && v.length) return v;
  const fb = PICKLIST_FALLBACK[key];
  return fb ? fb() : [];
}

/* ---------------- UC55 / UC57 — academic grade scales ---------------- */
// A/L rows are graded on the scale matching the lead's exam type (UC57).
function gradeScaleFor(kind, examType) {
  if (kind === "ol") return GRADE_SCALES["O/L"];
  return GRADE_SCALES[examType] || GRADE_SCALES["Local A/L"];
}

/* ---------------- Admin-configurable mandatory fields (UC59) ---------------- */
function mandatoryFieldsFor(stage) {
  const cfg = DB && DB.mandatoryFields;
  return (cfg && cfg[stage]) || STAGE_MANDATORY_FIELDS[stage] || [];
}
function fieldLabel(id) {
  const f = LEAD_FIELD_CATALOG.find(x => x.id === id);
  return f ? f.label : id;
}

/* ---------------- Admin-configurable SLA timings (UC32 / UC33) ---------------- */
function slaRules() {
  return Object.assign({ firstContactDays: 1, followUpIntervalDays: 5, graceDays: 1 }, DB.slaRules || {});
}

/* ---------------- Stage transition rules (editable via Admin — UC38/UC64) ---------------- */
function getTransitionRules() {
  return (DB && DB.transitionRules) ? DB.transitionRules : STAGE_TRANSITIONS;
}
function allowedNextStages(stage) {
  return getTransitionRules()[stage] || [];
}

/* ---------------- Scheduled follow-up tasks (UC31/UC42/UC65/UC86) ---------------- */
// Each lead carries a real scheduled due date (lead.nextFollowUp, YYYY-MM-DD).
// Completing a follow-up appends to lead.followUpLog and schedules the next one.
function todayStr() { return new Date().toISOString().slice(0, 10); }
function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
// Days until due: negative = overdue, 0 = due today, positive = upcoming
function followUpDaysUntilDue(lead) {
  if (!lead.nextFollowUp) return null;
  const due = new Date(lead.nextFollowUp + "T00:00:00").getTime();
  const today = new Date(todayStr() + "T00:00:00").getTime();
  return Math.round((due - today) / 86400000);
}
function followUpStatus(lead) {
  const d = followUpDaysUntilDue(lead);
  if (d === null) return "None";
  if (d < 0) return "Overdue";
  if (d === 0) return "Today";
  return "Upcoming";
}
// Marks the current scheduled follow-up complete (recording on-time vs late for UC46)
// and schedules the next one.
function completeFollowUp(lead, nextInDays) {
  const due = lead.nextFollowUp || todayStr();
  lead.followUpLog = lead.followUpLog || [];
  lead.followUpLog.push({ dueDate: due, completedAt: todayStr() });
  lead.nextFollowUp = addDaysStr(todayStr(), nextInDays === undefined ? 5 : nextInDays);
  return lead.nextFollowUp;
}

/* ---------------- Follow-Up Notes & Task Management (per pipeline stage) ---------------- */
// Minutes until a task's due date/time — negative = overdue, matching followUpDaysUntilDue()'s sign convention.
function taskMinutesUntilDue(task) {
  if (!task.dueAt) return null;
  return Math.round((new Date(task.dueAt).getTime() - Date.now()) / 60000);
}
function taskStatus(task) {
  if (task.done) return "Done";
  const m = taskMinutesUntilDue(task);
  if (m === null) return "None";
  if (m < 0) return "Overdue";
  if (m < 24 * 60) return "Due Soon";
  return "Upcoming";
}
function allOpenTasks(leads) {
  const rows = [];
  leads.forEach(l => (l.tasks || []).forEach(t => { if (!t.done) rows.push({ lead: l, task: t }); }));
  return rows;
}

/* ---------------- UC46 — genuine SLA measurement ---------------- */
// % of completed follow-up tasks that were completed on or before their due date.
function slaStatsFor(leads) {
  let total = 0, onTime = 0;
  leads.forEach(l => (l.followUpLog || []).forEach(t => {
    if (!t.completedAt) return;
    total++;
    if (t.completedAt <= t.dueDate) onTime++;
  }));
  return { total, onTime, pct: total ? Math.round((onTime / total) * 100) : 0 };
}

/* ---------------- Escalation helpers (UC32/UC33/UC34) ---------------- */
function isMissedFollowUpEscalation(lead) {
  // UC32 — a scheduled follow-up is past its due date beyond the configured grace period.
  if (lead.deactivated || lead.stage === "Closed" || lead.stage === "Converted") return false;
  const d = followUpDaysUntilDue(lead);
  return d !== null && d < -slaRules().graceDays;
}

function isNewLeadIgnored(lead) {
  // UC33 — brand-new lead (only the auto "Create" activity) untouched past the configured window.
  if (lead.deactivated || lead.stage !== "Open") return false;
  const onlyCreateEvent = (lead.activity || []).length <= 1;
  return onlyCreateEvent && daysAgo(lead.createdAt) >= slaRules().firstContactDays;
}

/* ---------------- Notifications (UC32/UC33/UC34) ---------------- */
function notify(toUserId, leadId, reason, level) {
  DB.notifications = DB.notifications || [];
  DB.notifications.unshift({
    id: uid("ntf"), ts: new Date().toISOString(),
    toUserId, leadId, reason, level: level || "Escalation", read: false
  });
  if (DB.notifications.length > 300) DB.notifications.length = 300;
}
function myNotifications() {
  const u = getCurrentUser();
  if (!u) return [];
  return (DB.notifications || []).filter(n => n.toUserId === u.id);
}
function unreadCount() {
  return myNotifications().filter(n => !n.read).length;
}

/* ---------------- UC36 — program handbook lookup ---------------- */
function handbookFor(program) {
  return PROGRAM_HANDBOOKS[program] || null;
}

/* ---------------- UC14 / UC15 — commission eligibility rules ---------------- */
function meetsPaymentThreshold(lead) {
  const rules = DB.commissionRules || {};
  return Number(lead.amountPaid || 0) >= Number(rules.paymentThreshold || 0);
}
function outstandingCleared(lead) {
  const rules = DB.commissionRules || {};
  if (!rules.requireZeroOutstanding) return true;
  return Number(lead.outstandingBalance || 0) === 0;
}

function escalationReason(lead) {
  if (isNewLeadIgnored(lead)) return "New lead ignored within same day (UC33)";
  if (isMissedFollowUpEscalation(lead)) return "Missed follow-up SLA breached (UC32)";
  return null;
}

/* ---------------- Commission targets (UC3) ---------------- */
function targetFor(counsellorId, intakeId) {
  return (DB.counsellorTargets || []).find(t => t.counsellorId === counsellorId && t.intakeId === intakeId);
}
function actualEnrolments(counsellorId, intakeId) {
  return DB.leads.filter(l => l.assignedTo === counsellorId && l.intakeId === intakeId && l.stage === "Converted" && !l.deactivated).length;
}

/* ---------------- Head of Marketing dashboards — Pipeline & Lead Source targets ---------------- */
function stageTarget(stage) {
  return (DB.pipelineStageTargets && DB.pipelineStageTargets[stage]) || 0;
}
function leadSourceTarget(source) {
  return (DB.leadSourceTargets && DB.leadSourceTargets[source]) || 0;
}

/* ---------------- Detailed lead statuses (UCL sub-statuses layered on the 4 system stages) ---------------- */
function detailedStatusOptions(bucket) {
  const key = bucket === "Not Qualified Lead" ? "detailedStatusesNotQualified" : "detailedStatusesQualified";
  const v = DB && DB.picklists && DB.picklists[key];
  if (Array.isArray(v) && v.length) return v;
  return DETAILED_STATUS_GROUPS[bucket];
}
// Which detailed-status group a stage naturally pairs with (Open/Closed → Not Qualified, Qualified/Converted → Qualified)
function statusBucketForStage(stage) {
  return (stage === "Qualified" || stage === "Converted") ? "Qualified Lead" : "Not Qualified Lead";
}

/* ---------------- Not-Qualified Leads tab ---------------- */
// A lead is "Not Qualified" once it carries one of the admin-configured Not-Qualified detailed statuses.
function isNotQualifiedLead(lead) {
  return !!lead.detailedStatus && detailedStatusOptions("Not Qualified Lead").includes(lead.detailedStatus);
}

/* ---------------- Student Journey Report (sales head/counsellor) ---------------- */
// A lead counts as having submitted an application once its detailed status reaches the
// application stage or later, or it has already been converted / onboarded.
function hasSubmittedApplication(lead) {
  return lead.stage === "Converted" || POST_APPLICATION_STATUSES.includes(lead.detailedStatus);
}
// Derives, from the lead's own activity log, the first date it reached each pipeline stage —
// a genuine journey trace rather than a guess, matching the "Stage Change" entries written by
// attemptStageChange()/handleKanbanDrop().
// The real SMS transfer date if the registration hand-off has completed, else the Converted-stage
// date as a fallback proxy for leads that predate the Offer Release & Registration Process.
function smsOnboardDate(lead, stageDates) {
  const sms = ((lead.applicationForm || {}).smsTransfer || {});
  if (sms.status === "Transferred") return sms.transferredAt;
  return lead.stage === "Converted" ? stageDates.Converted : null;
}
function stageReachedDates(lead) {
  const dates = { Open: lead.createdAt };
  const acts = (lead.activity || []).slice().reverse(); // oldest first
  acts.forEach(a => {
    if (a.type !== "Stage Change") return;
    const m = /to (.+)$/.exec(a.text || "");
    if (!m) return;
    const label = m[1].trim();
    const stageKey = stages().find(s => stageLabel(s) === label);
    if (stageKey && dates[stageKey] === undefined) dates[stageKey] = a.ts;
  });
  return dates;
}

/* ---------------- Programme-wise aggregation (Individual Counsellor / Manager dashboards) ---------------- */
function programWiseCounts(leads, filterFn) {
  const counts = {};
  picklist("programs").forEach(p => counts[p] = 0);
  leads.forEach(l => {
    if (!l.program) return;
    if (filterFn && !filterFn(l)) return;
    counts[l.program] = (counts[l.program] || 0) + 1;
  });
  return Object.keys(counts).map(p => ({ label: p, value: counts[p] })).filter(r => r.value > 0);
}
function detailedStatusCount(leads, statusLabel) {
  return leads.filter(l => l.detailedStatus === statusLabel && !l.deactivated).length;
}

function isMandatoryMet(lead, stage) {
  const fields = mandatoryFieldsFor(stage);
  const missing = [];
  fields.forEach(f => {
    // UC56 — pending-results flag relaxes the academic-result fields specifically
    if ((f === "olResult" || f === "alResult" || f === "languageScore") && lead.resultsPending) return;
    if (!lead[f] || String(lead[f]).trim() === "") missing.push(fieldLabel(f));
  });
  return { ok: missing.length === 0, missing };
}

/* Chart palette. Kept as literals (not read from :root via getComputedStyle) because
   utils.js is a plain script with no init hook — a literal has no load-order hazard.
   Values mirror the CSS tokens so charts and UI can't drift apart the way the previous
   scattered hex literals did (#e0821e vs --amber, #1c8a4c vs --green, ...). */
const CHART = {
  primary: "#2563eb",   // --blue-600
  muted:   "#94a3b8",   // target/comparison bars
  grid:    "#e2e6ec",
  ink:     "#16233a",   // --text
  good:    "#0f8a4c",   // --green
  warn:    "#b3730a",   // --amber
  bad:     "#c62b2b",   // --red
  series:  ["#2563eb", "#b3730a", "#0f8a4c", "#c62b2b", "#6d28d9", "#0ea5e9"]
};

/* Three (or two) big numbers in a row — the dashboard's most-repeated inline-styled
   block, previously hand-written with font-size:24px at each site. */
function statTriple(items) {
  return `<div class="stat-triple">${items.map(i => `
    <div><div class="st-value" style="color:${i.color}">${i.value}</div><div class="small-muted">${esc(i.label)}</div></div>
  `).join("")}</div>`;
}

function simpleBarChart(rows, opts) {
  // rows: [{label, value, color}]
  opts = opts || {};
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<div>${rows.map(r => `
    <div class="bar-row">
      <div class="label">${esc(r.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.value / max * 100).toFixed(1)}%;background:${r.color || CHART.primary}"></div></div>
      <div class="val">${r.value}</div>
    </div>`).join("")}</div>`;
}

function donutSVG(segments, size) {
  // segments: [{label, value, color}]
  size = size || 160;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - 10, c = size / 2;
  let angle = -90;
  const circ = 2 * Math.PI * r;
  let circles = "";
  segments.forEach(seg => {
    const frac = seg.value / total;
    const dash = frac * circ;
    circles += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="20"
      stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-((angle + 90) / 360) * circ}" transform="rotate(-90 ${c} ${c})"></circle>`;
    angle += frac * 360;
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${circles}
    <circle cx="${c}" cy="${c}" r="${r - 20}" fill="#fff"></circle>
    <text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="middle" font-size="16" font-weight="700" fill="${CHART.ink}">${total}</text>
  </svg>`;
}

/* ============================================================
   PDF export (UC45 - AF1, UC67 - AF1, UC82)
   Renders the given HTML into a print-optimised window and opens the
   browser's print dialog, where "Save as PDF" produces a vector PDF.
   No external library needed, works fully offline.
   ============================================================ */
const PRINT_STYLES = `
  @page { size: A4 landscape; margin: 14mm; }
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
       color:#16233a;font-size:11pt;line-height:1.45;margin:0;padding:0;}
  .doc-head{border-bottom:2px solid #2563eb;padding-bottom:12px;margin-bottom:18px;
            display:flex;justify-content:space-between;align-items:flex-end;gap:20px;}
  .doc-brand{font-size:13pt;font-weight:700;letter-spacing:-.02em;color:#12294a;}
  .doc-brand span{color:#2563eb;}
  .doc-title{font-size:19pt;font-weight:600;margin:6px 0 2px;letter-spacing:-.02em;}
  .doc-sub{font-size:9.5pt;color:#6b7889;}
  .doc-meta{font-size:9pt;color:#6b7889;text-align:right;white-space:nowrap;}
  table{width:100%;border-collapse:collapse;font-size:9.5pt;margin:10px 0 16px;}
  th,td{padding:7px 9px;border-bottom:1px solid #e6ecf5;text-align:left;vertical-align:middle;}
  th{background:#f2f6fd;color:#4a5768;font-size:8pt;text-transform:uppercase;letter-spacing:.5px;
     font-weight:700;border-bottom:1.5px solid #d6dfec;}
  tr{page-break-inside:avoid;}
  thead{display:table-header-group;}
  h3{font-size:12.5pt;margin:16px 0 8px;font-weight:600;}
  .card{border:1px solid #e6ecf5;border-radius:8px;padding:14px 16px;margin-bottom:14px;
        page-break-inside:avoid;}
  .bar-row{display:flex;align-items:center;gap:10px;margin-bottom:7px;font-size:9.5pt;}
  .bar-row .label{width:150px;flex:0 0 150px;color:#6b7889;}
  .bar-track{flex:1;background:#eef2f8;border-radius:20px;height:13px;overflow:hidden;}
  .bar-fill{height:100%;border-radius:20px;}
  .bar-row .val{width:44px;text-align:right;font-weight:700;}
  .badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:8pt;font-weight:700;
         border:1px solid #d6dfec;}
  .badge:before{display:none;}
  .pill,.btn,button,.toolbar,.chip-row,.tabs,.page-header .btn{display:none !important;}
  .small-muted{font-size:9pt;color:#6b7889;}
  .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:9pt;color:#6b7889;margin-top:8px;}
  .legend i{width:9px;height:9px;border-radius:3px;display:inline-block;margin-right:5px;}
  .legend span{display:inline-flex;align-items:center;}
  ul.timeline{list-style:none;padding:0;margin:0;border-left:2px solid #e6ecf5;}
  ul.timeline li{padding:6px 0 6px 14px;position:relative;font-size:9.5pt;page-break-inside:avoid;}
  .ts{color:#95a1b3;font-size:8.5pt;}
  .doc-foot{margin-top:18px;padding-top:10px;border-top:1px solid #e6ecf5;
            font-size:8pt;color:#95a1b3;display:flex;justify-content:space-between;}
  svg{max-width:100%;}
`;

function printToPDF(opts) {
  opts = opts || {};
  const title = opts.title || "Report";
  const subtitle = opts.subtitle || "";
  const orientation = opts.orientation === "portrait" ? "portrait" : "landscape";
  const user = getCurrentUser();
  const generated = new Date().toLocaleString();

  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${esc(title)}</title>
    <style>${PRINT_STYLES}
      @page { size: A4 ${orientation}; margin: 14mm; }
    </style></head><body>
    <div class="doc-head">
      <div>
        <div class="doc-brand">Uni<span>Connect</span> CRM</div>
        <div class="doc-title">${esc(title)}</div>
        ${subtitle ? `<div class="doc-sub">${esc(subtitle)}</div>` : ""}
      </div>
      <div class="doc-meta">
        Generated: ${esc(generated)}<br>
        By: ${esc(user ? user.name : "System")} (${esc(user ? user.role : "-")})<br>
        ${user && user.domain && user.domain !== "All" ? "Scope: " + esc(user.domain) : "Scope: All tenants"}
      </div>
    </div>
    ${opts.html || ""}
    <div class="doc-foot">
      <span>UniConnect CRM — Confidential</span>
      <span>${esc(generated)}</span>
    </div>
  </body></html>`;

  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) {
    toast("Pop-up blocked — allow pop-ups for this site to export PDFs.", "error");
    return false;
  }
  w.document.open();
  w.document.write(doc);
  w.document.close();
  // Give the new window a tick to lay out (and render SVGs) before printing
  const go = () => { try { w.focus(); w.print(); } catch (e) { /* user closed it */ } };
  if (w.document.readyState === "complete") setTimeout(go, 250);
  else w.onload = () => setTimeout(go, 250);
  return true;
}

/* Turns a [[headers],[row],[row]] matrix into a printable HTML table */
function rowsToTableHTML(rows) {
  if (!rows || !rows.length) return "<p>No data.</p>";
  const [head, ...body] = rows;
  return `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${body.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

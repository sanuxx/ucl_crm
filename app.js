/* ============================================================
   UniConnect CRM Demo — App Router & Views
   ============================================================ */

loadDB();

function defaultState() {
  return {
    leadTab: "Open",
    leadFilter: { search: "", university: "", program: "", source: "", digitalSub: "", domain: "", nonCollectible: false },
    pipelineFilter: { program: "" },
    reportsTab: "status",
    commissionTab: "plans"
  };
}

// Keys created lazily by individual views (always read as `state.x = state.x || default`),
// so deleting them on a role switch is safe and restores each view's own default.
const TRANSIENT_STATE_KEYS = ["fuFilter", "avTab", "adminTab", "reportsIntake",
  "targetIntake", "permRole", "auditFilter", "dashProgTab", "selectedLeadIds"];

// Wipes per-view filters/tabs when the acting user changes. Without this, a filter set
// as one role silently carries over and makes the next role look like it has no data.
// Mutates in place — renderLeads() captures `state.leadFilter` into its input handlers,
// so reassigning `state` would leave those writing to a detached object.
function resetViewState() {
  Object.assign(state, defaultState());
  TRANSIENT_STATE_KEYS.forEach(k => delete state[k]);
}

let state = defaultState();

/* ---------------- Top bar setup ---------------- */
function renderTopBar() {
  const roleSelect = document.getElementById("roleSelect");
  const userSelect = document.getElementById("userSelect");

  const roles = [...new Set(DB.users.map(u => u.role))];
  roleSelect.innerHTML = roles.map(r => `<option value="${r}">${r}</option>`).join("");
  roleSelect.value = getCurrentUser().role;

  function refreshUserSelect() {
    const role = roleSelect.value;
    const usersForRole = DB.users.filter(u => u.role === role);
    userSelect.innerHTML = usersForRole.map(u => `<option value="${u.id}">${u.name}</option>`).join("");
    if (usersForRole.find(u => u.id === DB.currentUserId)) {
      userSelect.value = DB.currentUserId;
    } else {
      userSelect.value = usersForRole[0].id;
      DB.currentUserId = usersForRole[0].id;
      saveDB();
    }
  }
  refreshUserSelect();

  function refreshAvatar() {
    const u = getCurrentUser();
    const initials = u.name.split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase();
    document.getElementById("avatarBtn").textContent = initials;
    document.getElementById("avatarBtn").title = `${u.name} — ${u.role}`;
  }
  refreshAvatar();

  // Switching the acting user re-scopes every list. Close any open modal (it holds a
  // lead the incoming role may not be allowed to see), clear per-view filters/tabs so
  // the new role doesn't inherit a filter that hides all their data, and bounce off the
  // current view if it isn't permitted — otherwise the router would paint a dead end.
  function switchActingUser(before) {
    closeModal();
    before();
    resetViewState();
    refreshAvatar(); saveDB(); renderSidebar(); renderNotificationBell();
    if (!canAccessView(currentView(), currentRole())) go("#/dashboard");
    else router();
  }
  roleSelect.onchange = () => switchActingUser(refreshUserSelect);
  userSelect.onchange = () => switchActingUser(() => { DB.currentUserId = userSelect.value; });

  document.getElementById("hamburger").onclick = () => {
    document.getElementById("sidebar").classList.toggle("collapsed");
  };
  document.getElementById("bellBtn").onclick = openNotificationsModal;
  renderNotificationBell();
}

/* ---------------- Notifications (UC32 / UC33 / UC34) ---------------- */
function renderNotificationBell() {
  const badge = document.getElementById("bellBadge");
  if (!badge) return;
  const n = unreadCount();
  badge.textContent = n > 99 ? "99+" : n;
  badge.hidden = n === 0;
}
function openNotificationsModal() {
  const items = myNotifications();
  openModal(`
    <div class="modal-header"><h2>Notifications <span class="pill">UC32 / UC33 / UC34</span></h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      ${items.length ? items.map(n => `
        <div class="notif-item ${n.read ? "" : "unread"}">
          ${n.read ? "" : '<div class="notif-dot"></div>'}
          <div style="flex:1">
            <div><b>${esc(n.level)}</b> — ${esc(n.reason)}</div>
            <div class="small-muted">${fmtDateTime(n.ts)}</div>
          </div>
          ${n.leadId ? `<button class="btn sm ghost" onclick="closeModal();openLeadModal('${n.leadId}')">Open Lead</button>` : ""}
        </div>`).join("")
      : `<div class="empty-state">No notifications for ${esc(getCurrentUser().name)}.<br><span class="small-muted">Escalate an overdue follow-up as a Counsellor's manager to see these appear.</span></div>`}
    </div>
    <div class="modal-footer">
      ${items.some(n => !n.read) ? `<button class="btn secondary" onclick="markNotificationsRead()">Mark all read</button>` : ""}
      <button class="btn" onclick="closeModal()">Close</button>
    </div>
  `, { width: 620 });
}
function markNotificationsRead() {
  const u = getCurrentUser();
  (DB.notifications || []).forEach(n => { if (n.toUserId === u.id) n.read = true; });
  saveDB();
  renderNotificationBell();
  openNotificationsModal();
}

/* ---------------- Sidebar ---------------- */
const NAV_PERMS = {
  "commission": ["Commission Admin", "Finance", "Manager", "Head of Marketing", "CEO", "Admin"],
  "reports": ["Manager", "Head of Marketing", "CEO", "Admin", "Commission Admin", "Counsellor"],
  "not-qualified": ["Counsellor", "Manager", "Head of Marketing", "CEO", "Admin"],
  "lead-source-dashboard": ["Head of Marketing", "CEO", "Admin"],
  "audit": ["Admin", "Head of Marketing", "CEO"],
  "admin": ["Admin"],
  "agent-portal": ["Agent", "Manager", "Admin"],
  "intakes": ["Admin", "Manager", "Head of Marketing", "CEO", "Counsellor"],
  "app-verification": ["Academic Admin", "Admin"],
  "website-leads": ["Head of Marketing", "CEO", "Admin"]
};
// Academic Admin — "access only to the Student Application Forms and Offer Letters relevant to
// the verification process" (not the full CRM), so their nav is a hard allow-list rather than
// the exclude-list NAV_PERMS uses for everyone else.
const ACADEMIC_ADMIN_VIEWS = ["dashboard", "app-verification"];

function renderSidebar() {
  const role = currentRole();
  document.querySelectorAll(".nav-item").forEach(item => {
    const view = item.dataset.view;
    if (role === "Academic Admin") { item.style.display = ACADEMIC_ADMIN_VIEWS.includes(view) ? "" : "none"; return; }
    const perm = NAV_PERMS[view];
    item.style.display = (!perm || perm.includes(role)) ? "" : "none";
  });
}

/* ---------------- Router ---------------- */
// Single source of truth for view access, shared by router() and the role switcher
// so a role change can redirect *before* rendering rather than painting a denial.
function canAccessView(view, role) {
  if (role === "Academic Admin") return ACADEMIC_ADMIN_VIEWS.includes(view);
  const perm = NAV_PERMS[view];
  return !perm || perm.includes(role);
}
function currentView() {
  return (location.hash.replace("#/", "") || "dashboard").split("?")[0];
}
// Navigates without double-rendering: assigning a new hash fires `hashchange`
// (which calls router()), but re-assigning the *same* hash fires nothing — so only
// then do we invoke router() directly.
function go(hash) {
  if (location.hash === hash) router();
  else location.hash = hash;
}

function router() {
  const hash = location.hash.replace("#/", "") || "dashboard";
  const view = hash.split("?")[0];
  document.querySelectorAll(".nav-item").forEach(i => i.classList.toggle("active", i.dataset.view === view));
  const content = document.getElementById("content");
  const renderers = {
    dashboard: renderDashboard,
    leads: renderLeads,
    "not-qualified": renderNotQualified,
    pipeline: renderPipeline,
    followups: renderFollowups,
    inquiries: renderInquiries,
    commission: renderCommission,
    reports: renderReports,
    "lead-source-dashboard": renderLeadSourceDashboard,
    intakes: renderIntakes,
    "agent-portal": renderAgentPortal,
    audit: renderAudit,
    admin: renderAdmin,
    "app-verification": renderAppVerification,
    "website-leads": renderWebsiteLeads,
    apply: renderApplyOnline
  };
  if (!canAccessView(view, currentRole())) {
    content.innerHTML = currentRole() === "Academic Admin"
      ? `<div class="empty-state">Academic Admin has access only to the Dashboard and Application Verification queue.</div>`
      : `<div class="empty-state">Your role (${esc(currentRole())}) does not have access to this section.</div>`;
    return;
  }
  (renderers[view] || renderDashboard)(content);
}
window.addEventListener("hashchange", router);

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard(root) {
  if (currentRole() === "Academic Admin") { renderAcademicAdminDashboard(root); return; }
  const leads = visibleLeads();
  const stageCounts = {};
  stages().forEach(s => stageCounts[s] = leads.filter(l => l.stage === s && !l.deactivated).length);
  const totalInquiries = DB.inquiries.length;
  const qualifiedLeads = leads.filter(l => l.stage === "Qualified" || l.stage === "Converted").length;
  const convToLeadPct = totalInquiries ? ((DB.inquiries.filter(i => i.convertedToLead).length / totalInquiries) * 100).toFixed(1) : 0;
  const leadToEnrolPct = leads.length ? ((stageCounts.Converted / leads.length) * 100).toFixed(1) : 0;

  const followUpLeads = leads.filter(l => !l.deactivated && l.stage !== "Closed" && l.nextFollowUp);
  const overdue = followUpLeads.filter(l => followUpStatus(l) === "Overdue").length;
  const today = followUpLeads.filter(l => followUpStatus(l) === "Today").length;
  const upcoming = followUpLeads.filter(l => followUpStatus(l) === "Upcoming").length;

  const stat = (id, label, value, delta) => canViewWidget(id)
    ? `<div class="stat-card"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${delta}</div></div>` : "";

  const statRow = [
    stat("inquiries", "Total Inquiries", totalInquiries, "UC83"),
    stat("qualified", "Qualified Leads", qualifiedLeads, "UC51 / UC83"),
    stat("convInquiry", "Inquiry → Lead %", convToLeadPct + "%", "UC52 / UC84"),
    stat("convEnrol", "Lead → Enrolment %", leadToEnrolPct + "%", "UC84")
  ].join("");

  // Hero progress pills — share of the visible pipeline sitting in each stage
  const activeLeads = leads.filter(l => !l.deactivated).length || 1;
  const pills = stages().map(s => {
    const pct = Math.round((stageCounts[s] / activeLeads) * 100);
    return `<div class="ppill" style="flex:${Math.max(1, pct)}">
      <div class="pp-label">${esc(stageLabel(s))}</div>
      <div class="pp-bar" style="background:${stageColor(s)}">${pct}%</div>
    </div>`;
  }).join("") + `<div class="ppill ghost" style="flex:1">
      <div class="pp-label">Deactivated</div>
      <div class="pp-bar">${leads.filter(l => l.deactivated).length}</div>
    </div>`;

  const firstName = (getCurrentUser().name || "").split(/\s+/)[0];
  // Section anchors are only offered for sections this role actually gets.
  const showsRoleStatus = ROLE_STATUS_DASHBOARD_ROLES.includes(currentRole());
  const isCounsellorView = currentRole() === "Counsellor";
  const showsPipelineTargets = ["Head of Marketing", "CEO", "Admin"].includes(currentRole());

  root.innerHTML = `
    <div class="hero">
      <div class="hero-left">
        <h1>Welcome back, <b>${esc(firstName)}</b></h1>
        <div class="sub">${esc(currentRole())}${getCurrentUser().domain && getCurrentUser().domain !== "All" ? " · " + esc(getCurrentUser().domain) : " · Global access"} — ${leads.length} lead(s) in your view</div>
        <div class="progress-pills">${pills}</div>
      </div>
      <div class="hero-stats">
        <div class="hstat"><div class="hs-value">${leads.filter(l => !l.deactivated).length}</div><div class="hs-label"><i>${icon("users")}</i>Active Leads</div></div>
        <div class="hstat"><div class="hs-value">${stageCounts.Converted}</div><div class="hs-label"><i>${icon("cap")}</i>Enrolments</div></div>
        <div class="hstat"><div class="hs-value">${overdue}</div><div class="hs-label"><i>${icon("clock")}</i>Overdue</div></div>
      </div>
    </div>

    <div class="dash-nav">
      <div class="chip-row" style="margin-bottom:0">
        <div class="chip" onclick="jumpToSection('sec-overview')">Overview</div>
        ${showsRoleStatus ? `<div class="chip" onclick="jumpToSection('sec-role')">${isCounsellorView ? "My Pipeline" : "Team Pipeline"}</div>` : ""}
        ${showsPipelineTargets ? `<div class="chip" onclick="jumpToSection('sec-targets')">Pipeline Targets</div>` : ""}
      </div>
      <button class="btn secondary sm" onclick="confirmResetDemoData()">${icon("refresh")} Reset Demo Data</button>
    </div>

    <div id="sec-overview"></div>
    ${statRow ? `<div class="widget-grid">${statRow}</div>` : ""}

    <div class="two-col">
      ${canViewWidget("pipeline") ? `<div class="card">
        <h3>Pipeline Summary by Stage <span class="pill">UC62 / UC85</span></h3>
        ${simpleBarChart(stages().map(s => ({ label: stageLabel(s), value: stageCounts[s], color: stageColor(s) })))}
      </div>` : ""}
      ${canViewWidget("followups") ? `<div class="card">
        <h3>Follow-Up Status <span class="pill">UC86</span></h3>
        ${statTriple([
          { label: "Overdue", value: overdue, color: "var(--red)" },
          { label: "Due Today", value: today, color: "var(--amber)" },
          { label: "Upcoming", value: upcoming, color: "var(--green)" }
        ])}
        <hr class="sep">
        <a href="#/followups" class="btn secondary sm">Open Follow-Up Tracker →</a>
      </div>` : ""}
    </div>

    ${canViewWidget("activity") ? `<div class="card">
      <h3>Recent Activity</h3>
      <ul class="timeline">
        ${leads.flatMap(l => (l.activity || []).slice(0, 1).map(a => ({ ...a, leadName: l.name })))
          .sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 8)
          .map(a => `<li><span class="ts">${fmtDateTime(a.ts)}</span> — <b>${esc(a.leadName)}</b>: ${esc(a.text)}</li>`).join("") || "<li>No recent activity</li>"}
      </ul>
    </div>` : ""}
    ${!statRow && !canViewWidget("pipeline") && !canViewWidget("followups") && !canViewWidget("activity")
      ? `<div class="empty-state">No dashboard widgets are enabled for the ${esc(currentRole())} role.</div>` : ""}

    ${renderRoleStatusDashboard(leads)}
    ${renderPipelineTargetDashboard(leads)}
  `;
}

// Head of Marketing dashboard — Target vs Actual across the defined pipeline stages.
function renderPipelineTargetDashboard(leads) {
  if (!["Head of Marketing", "CEO", "Admin"].includes(currentRole())) return "";
  const rows = stages().map(s => ({
    stage: s,
    target: stageTarget(s),
    actual: leads.filter(l => l.stage === s && !l.deactivated).length
  }));
  return `
    <h2 id="sec-targets" style="margin:26px 0 4px">Pipeline Target vs Actual<span class="pill">Head of Marketing</span></h2>
    <div class="card">
      <h3>Performance Across Pipeline Stages</h3>
      ${simpleBarChart(rows.flatMap(r => [
        { label: stageLabel(r.stage) + " (Target)", value: r.target, color: CHART.muted },
        { label: stageLabel(r.stage) + " (Actual)", value: r.actual, color: stageColor(r.stage) }
      ]))}
      <div class="table-wrap wide" style="margin-top:14px"><table><thead><tr><th>Stage</th><th>Target</th><th>Actual</th><th>Variance</th><th>% of Target</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${stageBadge(r.stage)}</td><td>${r.target}</td><td>${r.actual}</td>
        <td style="color:${r.actual - r.target >= 0 ? 'var(--green)' : 'var(--red)'}">${r.actual - r.target >= 0 ? "+" : ""}${r.actual - r.target}</td>
        <td>${r.target ? Math.round(r.actual / r.target * 100) : 0}%</td></tr>`).join("")}</tbody></table></div>
    </div>
  `;
}

// Scrolls rather than setting location.hash — an "#sec-…" hash would fire hashchange
// and send router() through a pointless full re-render of the page being scrolled.
function jumpToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function confirmResetDemoData() {
  confirmModal({
    title: "Reset demo data?",
    message: "This restores the seeded demo dataset. Every lead, note and application created during this session will be discarded.",
    confirmLabel: "Reset Demo Data",
    danger: true,
    onConfirm: () => {
      resetDB();          // also restores DB.currentUserId to the seeded default...
      resetViewState();
      renderTopBar();     // ...so the role/user selects must be redrawn to match,
      renderSidebar();    // and the nav re-filtered for whoever that now is.
      renderNotificationBell();
      go("#/dashboard");
      toast("Demo data reset to the seeded state.", "success");
    }
  });
}

// Academic Admin dashboard — pending application confirmations and pending registrations,
// with a follow-up reminder for anything sitting in the queue too long (Application Verification).
function renderAcademicAdminDashboard(root) {
  const leads = visibleLeads(); // already scoped to applications in flight for this role
  const pendingConfirm = pendingConfirmationLeads(leads).sort((a, b) => new Date(a.applicationForm.reviewedAt) - new Date(b.applicationForm.reviewedAt));
  const pendingReg = pendingRegistrationLeads(leads).sort((a, b) => new Date(a.applicationForm.pushedToAdmin.pushedAt) - new Date(b.applicationForm.pushedToAdmin.pushedAt));
  const CONFIRM_SLA_DAYS = 2;

  root.innerHTML = `
    <div class="hero">
      <div class="hero-left">
        <h1>Welcome back, <b>${esc((getCurrentUser().name || "").split(/\s+/)[0])}</b></h1>
        <div class="sub">Academic Admin — Application Verification workspace</div>
      </div>
      <div class="hero-stats">
        <div class="hstat"><div class="hs-value">${pendingConfirm.length}</div><div class="hs-label"><i>${icon("note")}</i>Pending Confirmations</div></div>
        <div class="hstat"><div class="hs-value">${pendingReg.length}</div><div class="hs-label"><i>${icon("cap")}</i>Pending Registrations</div></div>
      </div>
    </div>

    <div class="card" style="border-left:3px solid var(--amber);margin-top:18px">
      <h3>${icon("bell")} Pending Application Confirmations <span class="pill">follow-up reminder — ${CONFIRM_SLA_DAYS}d SLA</span></h3>
      ${pendingConfirm.length ? `
        <div class="table-wrap"><table><thead><tr><th>Student</th><th>Program</th><th>Reviewed</th><th>Waiting</th><th></th></tr></thead>
        <tbody>${pendingConfirm.map(l => {
          const days = daysAgo(l.applicationForm.reviewedAt);
          return `<tr>
            <td><b>${esc(l.name)}</b></td>
            <td>${esc(l.program) || "—"}</td>
            <td>${fmtDateTime(l.applicationForm.reviewedAt)}</td>
            <td>${days >= CONFIRM_SLA_DAYS ? `<span style="color:var(--red);font-weight:600">${days}d — Overdue</span>` : `${days}d`}</td>
            <td><button class="btn sm secondary" onclick="openLeadModal('${l.id}','application')">Review &amp; Confirm</button></td>
          </tr>`;
        }).join("")}</tbody></table></div>
      ` : `<div class="empty-state">No applications waiting on confirmation.</div>`}
    </div>

    <div class="card" style="margin-top:18px">
      <h3>Pending Registrations <span class="pill">pushed by counsellor, awaiting SMS transfer</span></h3>
      ${pendingReg.length ? `
        <div class="table-wrap"><table><thead><tr><th>Student</th><th>Program</th><th>Pushed</th><th></th></tr></thead>
        <tbody>${pendingReg.map(l => `<tr>
            <td><b>${esc(l.name)}</b></td>
            <td>${esc(l.program) || "—"}</td>
            <td>${fmtDateTime(l.applicationForm.pushedToAdmin.pushedAt)}</td>
            <td><button class="btn sm secondary" onclick="openLeadModal('${l.id}','application')">Open</button></td>
          </tr>`).join("")}</tbody></table></div>
      ` : `<div class="empty-state">No students waiting on registration transfer.</div>`}
    </div>
  `;
}

/* ============================================================
   APPLICATION VERIFICATION — Academic Admin's dedicated workspace
   ============================================================ */
function renderAppVerification(root) {
  const leads = visibleLeads();
  state.avTab = state.avTab || "pending";
  const tabs = [
    ["pending", "Pending Confirmation", pendingConfirmationLeads(leads)],
    ["confirmed", "Confirmed", leads.filter(l => l.applicationForm.academicConfirmation.status === "Confirmed")],
    ["registration", "Pending Registration", pendingRegistrationLeads(leads)]
  ];
  const active = tabs.find(t => t[0] === state.avTab) || tabs[0];
  const rows = active[2];

  root.innerHTML = `
    <div class="page-header"><div><h1>Application Verification</h1><div class="sub">Review submitted application forms and offer letters, confirm qualifications and documents (Academic Admin)</div></div></div>
    <div class="tabs">${tabs.map(([k, l, r]) => `<div class="tab ${state.avTab === k ? "active" : ""}" data-k="${k}">${l} <span class="count">${r.length}</span></div>`).join("")}</div>
    <div class="table-wrap card">
    <table><thead><tr><th>Student</th><th>Program</th><th>University</th><th>Application Status</th><th>Assigned Counsellor</th><th></th></tr></thead>
    <tbody>
      ${rows.map(l => `
        <tr>
          <td><b>${esc(l.name)}</b><div class="small-muted">${esc(l.mobile)}</div></td>
          <td>${esc(l.program) || "—"}</td>
          <td>${esc(l.university) || "—"}</td>
          <td>${applicationStatusBadge(l.applicationForm)}</td>
          <td>${esc(userName(l.assignedTo))}</td>
          <td><button class="btn sm secondary" onclick="openLeadModal('${l.id}','application')">Open</button></td>
        </tr>`).join("") || `<tr><td colspan="6" class="empty-state">Nothing here right now.</td></tr>`}
    </tbody></table>
    </div>
  `;
  document.querySelectorAll(".tabs .tab").forEach(t => t.onclick = () => { state.avTab = t.dataset.k; renderAppVerification(root); });
}

// Individual Counsellor Dashboard View (Counsellor role) / Manager Dashboard View (Manager and above) —
// same programme-wise + target-vs-actual breakdown, scoped by visibleLeads() per role (UC26/UC27/UC29).
// Counsellor-pipeline view. Roles with no counselling remit (Finance, Agent, Commission
// Admin) previously got all of this too — eight cards of programme breakdowns that mean
// nothing for their job. Gate it to the roles that actually own leads.
const ROLE_STATUS_DASHBOARD_ROLES = ["Counsellor", "Manager", "Head of Marketing", "CEO", "Admin"];

function renderRoleStatusDashboard(leads) {
  if (!ROLE_STATUS_DASHBOARD_ROLES.includes(currentRole())) return "";
  const isManagerUp = ["Manager", "Head of Marketing", "CEO", "Admin"].includes(currentRole());
  const suffix = isManagerUp ? " — All Counsellors" : "";
  const title = isManagerUp ? "Manager Dashboard View" : "Individual Counsellor Dashboard View";
  const progTab = state.dashProgTab = state.dashProgTab || "leads";

  const qualified = leads.filter(l => !l.deactivated && (l.stage === "Qualified" || l.stage === "Converted"));
  const enrolled = leads.filter(l => !l.deactivated && l.stage === "Converted");
  const offerCond = detailedStatusCount(leads, "Offer Received Conditional");
  const offerUncond = detailedStatusCount(leads, "Offer Received Unconditional");

  const counsellorIds = isManagerUp
    ? (currentRole() === "Manager" ? teamUserIds(getCurrentUser().id) : DB.users.filter(u => u.role === "Counsellor").map(u => u.id))
    : [getCurrentUser().id];
  const targets = (DB.counsellorTargets || []).filter(t => counsellorIds.includes(t.counsellorId));
  const targetRows = targets.map(t => ({
    label: `${userName(t.counsellorId)} — ${(DB.intakes.find(i => i.id === t.intakeId) || {}).name || t.intakeId}`,
    target: t.target,
    actual: actualEnrolments(t.counsellorId, t.intakeId)
  }));

  // Counsellor Application Dashboard — applications received (form Submitted/Reviewed), by intake
  const applicationsReceived = leads.filter(l => !l.deactivated && ["Submitted", "Reviewed"].includes((l.applicationForm || {}).status));
  const byIntake = DB.intakes.map(i => ({ label: i.name, value: applicationsReceived.filter(l => l.intakeId === i.id).length }))
    .concat([{ label: "No Intake Assigned", value: applicationsReceived.filter(l => !l.intakeId).length }])
    .filter(r => r.value > 0);

  // Pending Offer Dashboard — offers released by Academic Admin but not yet sent to the student
  const pendingOffers = pendingOfferLeads(leads.filter(l => !l.deactivated));

  // Programme-wise breakdowns share one card with a tab strip. As three separate cards
  // they pushed everything else below the fold for the same information.
  window.__progWiseData = {
    leads: programWiseCounts(leads.filter(l => !l.deactivated)),
    qualified: programWiseCounts(qualified),
    enrolled: programWiseCounts(enrolled)
  };

  return `
    <h2 id="sec-role" style="margin:26px 0 4px">${esc(title)}<span class="pill">${esc(currentRole())}</span></h2>
    <div class="two-col">
      <div class="card">
        <h3>Programme-Wise Breakdown${suffix}</h3>
        <div class="tabs" id="progWiseTabs">
          ${[["leads", "All Leads"], ["qualified", "Qualified"], ["enrolled", "Enrolled"]]
            .map(([k, label]) => `<div class="tab ${progTab === k ? "active" : ""}" data-k="${k}" onclick="setProgWiseTab('${k}')">${label}</div>`).join("")}
        </div>
        <div id="progWiseChart">${simpleBarChart(window.__progWiseData[progTab])}</div>
      </div>
      <div class="card">
        <h3>Offer Received${suffix}</h3>
        ${statTriple([
          { label: "Conditional", value: offerCond, color: "var(--amber)" },
          { label: "Unconditional", value: offerUncond, color: "var(--green)" }
        ])}
      </div>
      <div class="card">
        <h3>Applications Received${suffix} <span class="pill">Counsellor Application Dashboard</span></h3>
        ${byIntake.length ? simpleBarChart(byIntake) : `<p class="small-muted">No application forms submitted yet for the relevant intakes.</p>`}
        <p class="small-muted" style="margin-top:8px">Total: <b>${applicationsReceived.length}</b> application(s) received (status Submitted or Reviewed).</p>
      </div>
      <div class="card">
        <h3>Pending Offers${suffix} <span class="pill">Pending Offer Dashboard</span></h3>
        <p class="small-muted">Offers released by Academic Admin but not yet sent to the student — follow up on these.</p>
        ${pendingOffers.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Released</th><th></th></tr></thead>
          <tbody>${pendingOffers.slice(0, 8).map(l => `<tr>
            <td><b>${esc(l.name)}</b></td>
            <td>${fmtDateTime(l.applicationForm.offerRelease.releasedAt)}</td>
            <td><button class="btn sm ghost" onclick="openLeadModal('${l.id}','application')">Open</button></td>
          </tr>`).join("")}</tbody></table></div>
          ${pendingOffers.length > 8 ? `<p class="small-muted" style="margin-top:6px">+${pendingOffers.length - 8} more</p>` : ""}`
          : `<p class="small-muted">No pending offers right now.</p>`}
      </div>
      <div class="card">
        <h3>Target vs Actual${suffix} <span class="pill">UC3</span></h3>
        ${targetRows.length ? simpleBarChart(targetRows.flatMap(r => [
          { label: r.label + " (Target)", value: r.target, color: CHART.muted },
          { label: r.label + " (Actual)", value: r.actual, color: CHART.primary }
        ])) : `<p class="small-muted">No targets set.</p>`}
      </div>
    </div>
  `;
}

// Swaps the programme-wise chart in place — no full dashboard re-render.
function setProgWiseTab(k) {
  state.dashProgTab = k;
  document.querySelectorAll("#progWiseTabs .tab").forEach(t => t.classList.toggle("active", t.dataset.k === k));
  const el = document.getElementById("progWiseChart");
  if (el) el.innerHTML = simpleBarChart(window.__progWiseData[k]);
}

/* ============================================================
   LEADS (list + tabs + detail)
   ============================================================ */
function renderLeads(root) {
  let leads = visibleLeads();
  const f = state.leadFilter;

  const fullVisibility = ["Head of Marketing", "CEO", "Admin"].includes(currentRole());
  root.innerHTML = `
    <div class="page-header">
      <div><h1>Leads</h1><div class="sub">${leads.length} leads visible to you (${esc(currentRole())} view — row-level security applied)</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn secondary" onclick="openExhibitionModal()">${icon("phone")} Exhibition Quick Capture</button>
        <button class="btn secondary" onclick="openBulkUploadModal()">${icon("upload")} Bulk Upload</button>
        <button class="btn" onclick="openLeadModal()">+ New Lead</button>
      </div>
    </div>
    ${fullVisibility ? `<div class="notice info">${icon("globe")} Full, unrestricted lead visibility granted for strategic oversight — no row-level filtering applied to this role (UC29). Access is still logged in the Audit Log (UC80).</div>` : ""}

    <div class="toolbar">
      <input type="text" id="leadSearch" placeholder="Search name, mobile, email..." value="${esc(f.search)}">
      <select id="filterUniversity"><option value="">All Universities</option>${picklist('universities').map(u => `<option ${f.university === u ? "selected" : ""}>${u}</option>`).join("")}</select>
      <select id="filterProgram"><option value="">All Programs</option>${picklist('programs').map(p => `<option ${f.program === p ? "selected" : ""}>${p}</option>`).join("")}</select>
      <select id="filterSource"><option value="">All Sources</option>${picklist('leadSources').map(s => `<option ${f.source === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select id="filterDigitalSub" class="${f.source === "Digital" ? "" : "hidden"}" title="Digital lead sub-source (UC25)"><option value="">All Digital Sub-Sources — UC25</option>${picklist('digitalSubSources').map(s => `<option ${f.digitalSub === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select id="filterDomain"><option value="">All Domains / Branches</option>${picklist('domains').map(d => `<option ${f.domain === d ? "selected" : ""}>${d}</option>`).join("")}</select>
      <button class="btn secondary sm" onclick="openSaveSegmentModal()">${icon("save")} Save as Segment</button>
      ${canBulkAction() ? `<button class="btn secondary sm ${f.nonCollectible ? "danger" : ""}" id="nonCollectibleBtn" title="UC40">${icon("target")} Non-Collectible Candidates</button><button class="btn secondary sm" id="bulkAssignBtn">Bulk Assign</button><button class="btn secondary sm" id="bulkDeactivateBtn">Bulk Deactivate Non-Collectible</button><button class="btn secondary sm" id="bulkIntakeBtn">Bulk Assign Intake</button><span id="selCount" class="sel-count"></span>` : ""}
    </div>
    ${f.nonCollectible ? `<div class="notice">${icon("target")} Showing Non-Collectible Candidates — leads with no activity for 14+ days that are still Open/Qualified (UC40 pre-defined filter). Select rows and click "Bulk Deactivate" to clear them out.</div>` : ""}
    ${(DB.segments || []).length ? `<div class="chip-row">${DB.segments.map((s, idx) => `<div class="chip" onclick='applySegment(${idx})'>${esc(s.name)}</div>`).join("")}</div>` : ""}

    <div class="tabs" id="leadTabs">
      ${stages().concat(["Deactivated"]).map(s => {
        const count = s === "Deactivated" ? leads.filter(l => l.deactivated).length : leads.filter(l => l.stage === s && !l.deactivated).length;
        return `<div class="tab ${state.leadTab === s ? "active" : ""}" data-tab="${s}">${esc(stageLabel(s))} <span class="count">${count}</span></div>`;
      }).join("")}
    </div>

    <div id="leadTableWrap"></div>
  `;

  document.getElementById("leadSearch").oninput = e => { f.search = e.target.value; renderLeadTable(); };
  document.getElementById("filterUniversity").onchange = e => { f.university = e.target.value; renderLeadTable(); };
  document.getElementById("filterProgram").onchange = e => { f.program = e.target.value; renderLeadTable(); };
  document.getElementById("filterSource").onchange = e => { f.source = e.target.value; document.getElementById("filterDigitalSub").classList.toggle("hidden", f.source !== "Digital"); renderLeadTable(); };
  document.getElementById("filterDigitalSub").onchange = e => { f.digitalSub = e.target.value; renderLeadTable(); };
  document.getElementById("filterDomain").onchange = e => { f.domain = e.target.value; renderLeadTable(); };
  // Changing stage tab shows a different lead set — carrying a selection across would let
  // a bulk action hit rows the user can no longer see.
  document.querySelectorAll("#leadTabs .tab").forEach(t => t.onclick = () => { state.leadTab = t.dataset.tab; state.selectedLeadIds = []; renderLeads(root); });
  if (canBulkAction()) {
    document.getElementById("bulkAssignBtn").onclick = openBulkAssignModal;
    document.getElementById("bulkDeactivateBtn").onclick = openBulkDeactivateModal;
    document.getElementById("bulkIntakeBtn").onclick = openBulkIntakeModal;
    document.getElementById("nonCollectibleBtn").onclick = () => { f.nonCollectible = !f.nonCollectible; renderLeads(root); };
  }

  renderLeadTable();
}

function filteredLeadsForTab() {
  let leads = visibleLeads();
  const f = state.leadFilter;
  leads = leads.filter(l => {
    if (state.leadTab === "Deactivated") { if (!l.deactivated) return false; }
    else { if (l.stage !== state.leadTab || l.deactivated) return false; }
    if (f.search) {
      const s = f.search.toLowerCase();
      if (!(l.name.toLowerCase().includes(s) || l.mobile.includes(s) || l.email.toLowerCase().includes(s))) return false;
    }
    if (f.university && l.university !== f.university) return false;
    if (f.program && l.program !== f.program) return false;
    if (f.source && l.leadSource !== f.source) return false;
    if (f.digitalSub && l.digitalSubSource !== f.digitalSub) return false;
    if (f.domain && l.domain !== f.domain) return false;
    if (f.nonCollectible && !((followUpDaysUntilDue(l) !== null && followUpDaysUntilDue(l) < -14) && (l.stage === "Open" || l.stage === "Qualified"))) return false;
    return true;
  });
  return leads;
}

/* ============================================================
   NOT-QUALIFIED LEADS — leads that don't meet the required criteria.
   Separate tab from the main pipeline so they can be reviewed/managed on
   their own, with a stub to push a lead back into the qualified pipeline
   once that workflow is built out.
   ============================================================ */
function renderNotQualified(root) {
  const leads = visibleLeads().filter(isNotQualifiedLead);
  root.innerHTML = `
    <div class="page-header">
      <div><h1>Not-Qualified Leads</h1><div class="sub">${leads.length} lead(s) that don't currently meet the qualification criteria (${esc(currentRole())} view)</div></div>
    </div>
    <div class="notice info">${icon("info")} Leads land here automatically once their Detailed Status is set to one of the admin-configured "Not Qualified Lead" statuses. Use "Push to Qualified" to move a lead back into the active pipeline once it meets the criteria.</div>
    ${leads.length ? `
    <div class="table-wrap card">
    <table>
      <thead><tr><th>Name</th><th>Source</th><th>Mode of Contact</th><th>Reason (Detailed Status)</th><th>Assigned To</th><th>Created</th><th></th></tr></thead>
      <tbody>
        ${leads.map(l => `
          <tr>
            <td><a href="javascript:void(0)" onclick="openLeadModal('${l.id}')"><b>${esc(l.name)}</b></a><div class="small-muted">${esc(l.mobile)}</div></td>
            <td>${esc(l.leadSource)}${l.leadSource === "Student Referral" && l.studentId ? `<div class="small-muted">${esc(l.studentId)}</div>` : ""}${l.leadSource === "Staff Referral" && l.staffName ? `<div class="small-muted">${esc(l.staffName)}</div>` : ""}</td>
            <td>${esc(l.modeOfContact) || "<span class='small-muted'>—</span>"}</td>
            <td>${esc(l.detailedStatus) || "<span class='small-muted'>—</span>"}</td>
            <td>${esc(userName(l.assignedTo))}</td>
            <td>${fmtDate(l.createdAt)}</td>
            <td style="white-space:nowrap">
              <button class="btn ghost sm" onclick="openLeadModal('${l.id}')">Open</button>
              <button class="btn sm secondary" onclick="pushToQualified('${l.id}')" title="Coming soon">Push to Qualified</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>
    </div>` : `<div class="empty-state">No not-qualified leads in your view right now.</div>`}
  `;
}
// Stub for a future workflow — re-qualifying a lead and moving it back into the active
// pipeline is out of scope for this pass, so it's surfaced here as a clearly-labelled
// placeholder rather than silently doing nothing.
function pushToQualified(leadId) {
  toast("Push to Qualified is coming in a future release — this lead is not yet moved.", "warn");
}

/* ---------------- Saved segments (UC28) ---------------- */
function openSaveSegmentModal() {
  openModal(`
    <div class="modal-header"><h2>Save as Custom Segment (UC28)</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p class="small-muted">Saves the current filter combination (university, program, source, domain) for quick access.</p>
      <div class="field"><label class="required">Segment Name</label><input id="seg_name" placeholder="e.g. Cardiff Met — Computing leads"></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveSegment()">Save Segment</button></div>
  `);
}
function saveSegment() {
  const name = document.getElementById("seg_name").value.trim();
  if (!name) { toast("Segment name required.", "error"); return; }
  DB.segments = DB.segments || [];
  DB.segments.push({ name, tab: state.leadTab, filter: JSON.parse(JSON.stringify(state.leadFilter)) });
  logAudit("CREATE", "Segment", name);
  saveDB();
  closeModal();
  toast("Segment saved.", "success");
  renderLeads(document.getElementById("content"));
}
function applySegment(idx) {
  const seg = DB.segments[idx];
  if (!seg) return;
  state.leadTab = seg.tab;
  state.leadFilter = JSON.parse(JSON.stringify(seg.filter));
  renderLeads(document.getElementById("content"));
  toast(`Segment "${seg.name}" applied.`, "success");
}

/* ---------------- Bulk assign to intake (UC71) ---------------- */
function openBulkIntakeModal() {
  const ids = getSelectedLeadIds();
  if (!ids.length) { toast("Select at least one lead first.", "warn"); return; }
  openModal(`
    <div class="modal-header"><h2>Bulk Assign Intake (UC71)</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p class="small-muted">${ids.length} lead(s) selected.</p>
      <div class="field"><label>Intake Cycle</label><select id="bulkIntakeTarget">${DB.intakes.map(i => `<option value="${i.id}">${i.name}</option>`).join("")}</select></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="doBulkIntake(${JSON.stringify(ids)})">Assign</button></div>
  `);
}
function doBulkIntake(ids) {
  const intakeId = document.getElementById("bulkIntakeTarget").value;
  const intake = DB.intakes.find(i => i.id === intakeId);
  ids.forEach(id => {
    const lead = DB.leads.find(l => l.id === id);
    lead.intakeId = intakeId;
    addActivity(lead, "Update", `Assigned to intake: ${intake.name}`);
  });
  logAudit("ASSIGN_INTAKE", "Leads", `${ids.length} lead(s) → ${intake.name}`);
  saveDB();
  closeModal();
  toast(`${ids.length} lead(s) assigned to ${intake.name}.`, "success");
  renderLeads(document.getElementById("content"));
}

/* ---------------- Exhibition minimal-data capture (UC75) ---------------- */
function openExhibitionModal() {
  openModal(`
    <div class="modal-header"><h2>Exhibition Lead Entry (UC75)</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p class="small-muted">Minimal mobile-friendly form — only the essentials, for fast capture on the exhibition floor.</p>
      <div class="field"><label class="required">Name</label><input id="ex_name" autofocus></div>
      <div class="field"><label class="required">Mobile</label><input id="ex_mobile" type="tel"></div>
      <div class="field"><label>Email</label><input id="ex_email" type="email"></div>
      <div class="field"><label>Interested Program</label><select id="ex_program">${picklist('programs').map(p => `<option>${p}</option>`).join("")}</select></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveExhibitionLead()">Submit</button></div>
  `);
}
function saveExhibitionLead() {
  const name = document.getElementById("ex_name").value.trim();
  const mobile = document.getElementById("ex_mobile").value.trim();
  if (!name || !mobile) { toast("Name and mobile required.", "error"); return; }
  DB.leads.push({
    id: uid("lead"), name, mobile, email: document.getElementById("ex_email").value.trim(), leadSource: "Exhibition", modeOfContact: "",
    studentId: "", staffName: "", university: "", program: document.getElementById("ex_program").value, country: "Sri Lanka", district: "",
    districtOther: "", previousSchool: "", priorQualificationType: "", bachelorsDegree: "", bachelorsUniversity: "",
    examType: "Local A/L", resultsPending: true, olResult: "", alResult: "", languageTest: "None", languageScore: "",
    stage: "Open", deactivated: false, deactivationReason: "", lossReason: "", assignedTo: rand(DB.users.filter(u => u.role === "Counsellor").map(u => u.id)),
    intakeId: "", domain: rand(picklist('domains')), isReferral: false, referralType: "", agentId: "",
    checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
    applicationForm: defaultApplicationForm(), tasks: [],
    createdAt: new Date().toISOString(), activity: [{ ts: new Date().toISOString(), user: getCurrentUser().name, type: "Create", text: "Captured via Exhibition minimal-data form (UC75)" }]
  });
  logAudit("CREATE", "Lead", `Exhibition lead: ${name}`);
  saveDB();
  closeModal();
  toast("Lead captured — placed in Open stage for later enrichment.", "success");
  renderLeads(document.getElementById("content"));
}

function renderLeadTable() {
  const wrap = document.getElementById("leadTableWrap");
  if (!wrap) return;
  const leads = filteredLeadsForTab();
  if (!leads.length) {
    wrap.innerHTML = `<div class="empty-state">No leads in this stage yet.</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="table-wrap card">
    <table>
      <thead><tr>
        ${canBulkAction() ? "<th><input type='checkbox' id='selAll'></th>" : ""}
        <th>Name</th><th>Source</th><th>University / Program</th><th>Assigned To</th><th>Intake</th><th>Stage</th><th>Created</th><th></th>
      </tr></thead>
      <tbody>
        ${leads.map(l => `
          <tr>
            ${canBulkAction() ? `<td><input type="checkbox" class="rowSel" data-id="${l.id}" ${selectedLeadIds().includes(l.id) ? "checked" : ""} onchange="toggleLeadSelection('${l.id}',this.checked)"></td>` : ""}
            <td><a href="javascript:void(0)" onclick="openLeadModal('${l.id}')"><b>${esc(l.name)}</b></a><div class="small-muted">${esc(l.mobile)}</div></td>
            <td>${esc(l.leadSource)}${l.digitalSubSource ? " · " + esc(l.digitalSubSource) : ""}${l.leadSource === "Student Referral" && l.studentId ? `<div class="small-muted">${esc(l.studentId)}</div>` : ""}${l.leadSource === "Staff Referral" && l.staffName ? `<div class="small-muted">${esc(l.staffName)}</div>` : ""}</td>
            <td>${l.university || l.program
                ? esc(l.university || l.program) + (l.university && l.program ? `<div class="small-muted">${esc(l.program)}</div>` : "")
                : "<span class='small-muted'>—</span>"}</td>
            <td>${esc(userName(l.assignedTo))}</td>
            <td>${l.intakeId ? esc((DB.intakes.find(i => i.id === l.intakeId) || {}).name || "") : "<span class='small-muted'>—</span>"}</td>
            <td>${stageBadge(l.stage)}</td>
            <td>${fmtDate(l.createdAt)}</td>
            <td style="white-space:nowrap"><button class="btn ghost sm" onclick="openLeadModal('${l.id}')">Open</button>${l.deactivated ? ` <button class="btn sm secondary" onclick="reactivateLead('${l.id}')" title="UC39 - AF1">Reactivate</button>` : ""}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    </div>
  `;
  const selAll = document.getElementById("selAll");
  if (selAll) selAll.onchange = () => {
    document.querySelectorAll(".rowSel").forEach(c => {
      c.checked = selAll.checked;
      toggleLeadSelection(c.dataset.id, selAll.checked, true);
    });
    renderSelectionCount();
  };
  renderSelectionCount();
}

/* Bulk selection lives in state, not in the DOM. The lead search re-renders the table on
   every keystroke, which used to wipe an in-progress selection silently. */
function selectedLeadIds() {
  if (!Array.isArray(state.selectedLeadIds)) state.selectedLeadIds = [];
  return state.selectedLeadIds;
}
function toggleLeadSelection(id, on, skipRender) {
  const sel = selectedLeadIds();
  const i = sel.indexOf(id);
  if (on && i < 0) sel.push(id);
  if (!on && i >= 0) sel.splice(i, 1);
  if (!skipRender) renderSelectionCount();
}
function clearLeadSelection() {
  state.selectedLeadIds = [];
  document.querySelectorAll(".rowSel").forEach(c => { c.checked = false; });
  renderSelectionCount();
}
function renderSelectionCount() {
  const el = document.getElementById("selCount");
  if (!el) return;
  const n = selectedLeadIds().length;
  el.innerHTML = n
    ? `<b>${n}</b> selected <button class="btn sm ghost" onclick="clearLeadSelection()" title="Clear selection">${icon("x")}</button>`
    : `<span class="small-muted">None selected</span>`;
}

function reactivateLead(id) {
  const lead = DB.leads.find(l => l.id === id);
  lead.deactivated = false;
  addActivity(lead, "Reactivation", `Restored from deactivated (was: ${lead.deactivationReason || "no reason on file"}) — UC39 AF1`);
  lead.deactivationReason = "";
  logAudit("REACTIVATE", "Lead:" + id, "Lead restored to active pipeline");
  saveDB();
  toast("Lead reactivated.", "success");
  renderLeads(document.getElementById("content"));
}

function getSelectedLeadIds() {
  // Reads persisted selection state, so it survives search/filter re-renders. Scoped to
  // rows currently in view so a bulk action can't touch leads the filter excludes.
  const visible = new Set(filteredLeadsForTab().map(l => l.id));
  return selectedLeadIds().filter(id => visible.has(id));
}

function openBulkAssignModal() {
  const ids = getSelectedLeadIds();
  if (!ids.length) { toast("Select at least one lead first.", "warn"); return; }
  const counsellors = DB.users.filter(u => u.role === "Counsellor");
  openModal(`
    <div class="modal-header"><h2>Bulk Assign Leads (UC68)</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p class="small-muted">${ids.length} lead(s) selected.</p>
      <div class="field"><label>Assign To</label>
        <select id="bulkAssignTarget">
          <option value="__auto__">Auto-distribute (round robin)</option>
          ${counsellors.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="doBulkAssign(${JSON.stringify(ids)})">Assign</button></div>
  `);
}
function doBulkAssign(ids) {
  const target = document.getElementById("bulkAssignTarget").value;
  const counsellors = DB.users.filter(u => u.role === "Counsellor");
  ids.forEach((id, idx) => {
    const lead = DB.leads.find(l => l.id === id);
    const oldAssignee = userName(lead.assignedTo);
    const newAssignee = target === "__auto__" ? counsellors[idx % counsellors.length].id : target;
    lead.assignedTo = newAssignee;
    addActivity(lead, "Assignment", `Reassigned from ${oldAssignee} to ${userName(newAssignee)}`);
    logAudit("ASSIGN", "Lead:" + id, `${oldAssignee} → ${userName(newAssignee)} (UC81 before/after)`);
  });
  saveDB();
  closeModal();
  toast(`${ids.length} lead(s) assigned.`, "success");
  renderLeads(document.getElementById("content"));
}

function openBulkDeactivateModal() {
  const ids = getSelectedLeadIds();
  if (!ids.length) { toast("Select at least one lead first.", "warn"); return; }
  openModal(`
    <div class="modal-header"><h2>Bulk Deactivate (UC40)</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p>You are about to deactivate <b>${ids.length}</b> lead(s) as Non-Collectible. This cannot be easily undone from here.</p>
      <div class="field"><label class="required">Reason</label><input id="bulkDeactReason" type="text" placeholder="e.g. Unreachable for 30+ days" /></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn danger" onclick="doBulkDeactivate(${JSON.stringify(ids)})">Deactivate All</button></div>
  `);
}
function doBulkDeactivate(ids) {
  const reason = document.getElementById("bulkDeactReason").value.trim();
  if (!reason) { toast("Reason required (UC41).", "error"); return; }
  const minDays = DB.deactivationMinDays || 3;
  let blocked = 0;
  ids.forEach(id => {
    const lead = DB.leads.find(l => l.id === id);
    if (daysAgo(lead.createdAt) < minDays) { blocked++; return; } // UC41 — criteria enforced even in bulk action
    lead.deactivated = true;
    lead.deactivationReason = reason;
    addActivity(lead, "Deactivation", `Bulk deactivated: ${reason}`);
    logAudit("DEACTIVATE", "Lead:" + id, reason);
  });
  saveDB();
  closeModal();
  toast(`${ids.length - blocked} lead(s) deactivated.${blocked ? " " + blocked + " skipped — too new (UC41)." : ""}`, blocked ? "warn" : "success");
  renderLeads(document.getElementById("content"));
}

/* ---------------- Bulk upload (UC24 / UC53) ---------------- */
function openBulkUploadModal() {
  openModal(`
    <div class="modal-header"><h2>Bulk Upload Leads (UC24 / UC53)</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p class="small-muted">Upload a CSV with columns: <code>name,mobile,email,program,university</code>. Or click "Generate Sample" to simulate an import instantly for the demo.</p>
      <div class="field"><label>Import As</label>
        <select id="importType"><option value="Leads">Leads (auto-classify to Open stage)</option><option value="Inquiries">Inquiries</option></select>
      </div>
      <div class="field"><label>CSV File</label><input type="file" id="csvFile" accept=".csv"></div>
      <div id="uploadSummary"></div>
    </div>
    <div class="modal-footer">
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
      <button class="btn secondary" onclick="generateSampleImport()">Generate Sample (5 rows)</button>
      <button class="btn" onclick="processCsvUpload()">Import</button>
    </div>
  `);
}
function generateSampleImport() {
  const importType = document.getElementById("importType").value;
  let count = 0;
  for (let i = 0; i < 5; i++) {
    const first = rand(FIRST_NAMES), last = rand(LAST_NAMES);
    if (importType === "Leads") {
      const lead = {
        id: uid("lead"), name: `${first} ${last}`, mobile: "07" + Math.floor(10000000 + Math.random() * 89999999),
        email: `${first}.${last}@bulk.example.com`.toLowerCase(), leadSource: "Bulk Upload", modeOfContact: "", studentId: "", staffName: "",
        university: rand(picklist('universities')), program: rand(picklist('programs')), country: "Sri Lanka", district: rand(picklist('districts')),
        previousSchool: "", priorQualificationType: "", bachelorsDegree: "", bachelorsUniversity: "", examType: "Local A/L",
        resultsPending: true, olResult: "", alResult: "", languageTest: "None", languageScore: "",
        stage: "Open", deactivated: false, deactivationReason: "", lossReason: "", assignedTo: rand(DB.users.filter(u => u.role === "Counsellor").map(u => u.id)),
        intakeId: "", domain: rand(picklist('domains')), isReferral: false, referralType: "", agentId: "",
        checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
        applicationForm: defaultApplicationForm(), tasks: [],
        createdAt: new Date().toISOString(), activity: [{ ts: new Date().toISOString(), user: "System", type: "Create", text: "Bulk imported (UC24/UC53), auto-classified to Open" }]
      };
      DB.leads.push(lead);
    } else {
      DB.inquiries.push({ id: uid("inq"), name: `${first} ${last}`, mobile: "07" + Math.floor(10000000 + Math.random() * 89999999), email: `${first}.${last}@bulk.example.com`, program: rand(picklist('programs')), source: "Bulk Import", createdAt: new Date().toISOString(), convertedToLead: false });
    }
    count++;
  }
  logAudit("BULK_IMPORT", importType, `${count} rows imported`);
  saveDB();
  document.getElementById("uploadSummary").innerHTML = `<div class="notice success">${icon("checkCircle")} ${count} ${importType.toLowerCase()} imported successfully and placed in the follow-up workflow.</div>`;
  setTimeout(() => { closeModal(); router(); }, 900);
}
function processCsvUpload() {
  const file = document.getElementById("csvFile").files[0];
  const importType = document.getElementById("importType").value;
  if (!file) { toast("Choose a CSV file or use Generate Sample.", "warn"); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
    let success = 0, failed = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const row = {}; headers.forEach((h, idx) => row[h] = (cols[idx] || "").trim());
      if (!row.name || !row.mobile) { failed++; continue; }
      if (importType === "Leads") {
        DB.leads.push({
          id: uid("lead"), name: row.name, mobile: row.mobile, email: row.email || "", leadSource: "Bulk Upload", modeOfContact: "",
          studentId: "", staffName: "", university: row.university || "", program: row.program || "", country: "Sri Lanka", district: "Other",
          previousSchool: "", priorQualificationType: "", bachelorsDegree: "", bachelorsUniversity: "",
          examType: "Local A/L", resultsPending: true, olResult: "", alResult: "", languageTest: "None", languageScore: "",
          stage: "Open", deactivated: false, deactivationReason: "", lossReason: "", assignedTo: rand(DB.users.filter(u => u.role === "Counsellor").map(u => u.id)),
          intakeId: "", domain: rand(picklist('domains')), isReferral: false, referralType: "", agentId: "",
          checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
          applicationForm: defaultApplicationForm(), tasks: [],
          createdAt: new Date().toISOString(), activity: [{ ts: new Date().toISOString(), user: "System", type: "Create", text: "Bulk imported from CSV" }]
        });
      } else {
        DB.inquiries.push({ id: uid("inq"), name: row.name, mobile: row.mobile, email: row.email || "", program: row.program || "", source: "Bulk Import", createdAt: new Date().toISOString(), convertedToLead: false });
      }
      success++;
    }
    logAudit("BULK_IMPORT", importType, `${success} succeeded, ${failed} failed`);
    saveDB();
    document.getElementById("uploadSummary").innerHTML = `<div class="notice ${failed ? "error" : "success"}">Imported ${success} rows. ${failed} row(s) failed validation (UC24 - AF1).</div>`;
    setTimeout(() => { closeModal(); router(); }, 1100);
  };
  reader.readAsText(file);
}

/* ============================================================
   LEAD DETAIL / CREATE MODAL  (M1 dynamic fields + M2 stage logic)
   ============================================================ */
function openLeadModal(leadId, initialTab) {
  const isNew = !leadId;
  const lead = isNew ? null : DB.leads.find(l => l.id === leadId);
  window.__editingLead = isNew ? {
    id: null, name: "", mobile: "", email: "", leadSource: "Student Referral", modeOfContact: picklist('modesOfContact')[0] || "", digitalSubSource: "",
    studentId: "", staffName: "", university: "", program: "", country: "Sri Lanka", district: "", districtOther: "",
    previousSchool: "", priorQualificationType: "", bachelorsDegree: "", bachelorsUniversity: "",
    examType: "Local A/L", resultsPending: false, olResult: "", alResult: "", languageTest: "None", languageScore: "",
    stage: "Open", deactivated: false, deactivationReason: "", lossReason: "", assignedTo: DB.users.find(u => u.role === "Counsellor").id,
    intakeId: "", domain: picklist('domains')[0], isReferral: false, referralType: "", agentId: "",
    checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
    applicationForm: defaultApplicationForm(), tasks: [],
    createdAt: new Date().toISOString(), activity: []
  } : JSON.parse(JSON.stringify(lead));

  window.__leadModalTab = initialTab || "details";
  window.__gradeRowRerender = null; // reset any override left behind by the Apply Online page
  renderLeadModal();
}

// Switches tabs WITHOUT rebuilding the modal shell. Rebuilding (the old
// `renderLeadModal()` call) discarded every unsaved free-text edit, reset the body
// scroll and replayed the open animation on each click. Swapping only the tab body
// keeps typed input intact — syncFieldsFromDOM() guards each read with `if (get(id))`,
// so it safely captures whichever fields are currently mounted.
function switchLeadModalTab(k) {
  syncFieldsFromDOM();
  window.__leadModalTab = k;
  document.querySelectorAll(".detail-tabs .tab").forEach(t => t.classList.toggle("active", t.dataset.k === k));
  const body = document.querySelector(".modal-body");
  if (body) body.scrollTop = 0;
  renderLeadModalTab();
}

function renderLeadModal() {
  const L = window.__editingLead;
  const isNew = !L.id;
  const tab = window.__leadModalTab;

  const tabs = isNew ? [["details", "Details"]] : [["details", "Details"], ["academic", "Academic"], ["checklist", "Checklist"], ["notes", "Notes & Tasks"], ["application", "Application"], ["offerLetter", "Offer Letter"], ["paymentPlan", "Payment Plan"], ["timeline", "Timeline"]];

  openModal(`
    <div class="modal-header"><h2>${isNew ? "New Lead (UC21/UC22)" : esc(L.name)}</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      ${!isNew ? `<div style="margin-bottom:10px">${stageBadge(L.stage)} ${L.deactivated ? "<span class='badge deactivated'>Deactivated</span>" : ""} ${L.resultsPending ? "<span class='badge pending'>Pending Results</span>" : ""} ${applicationStatusBadge(L.applicationForm)}</div>` : ""}
      <div class="detail-tabs">${tabs.map(([k, label]) => `<div class="tab ${tab === k ? "active" : ""}" data-k="${k}" onclick="switchLeadModalTab('${k}')">${label}</div>`).join("")}</div>
      <div id="leadModalTabContent"></div>
    </div>
    <div class="modal-footer" id="leadModalFooter"></div>
  `, { width: 780, noAutofocus: true }); // re-renders on tab switch — don't steal focus each time

  renderLeadModalTab();
}

function renderLeadModalTab() {
  const L = window.__editingLead;
  const isNew = !L.id;
  const body = document.getElementById("leadModalTabContent");
  const footer = document.getElementById("leadModalFooter");
  const tab = window.__leadModalTab;

  if (tab === "details") {
    body.innerHTML = `
      <div class="grid-2">
        <div class="field"><label class="required">Full Name</label><input id="f_name" value="${esc(L.name)}"></div>
        <div class="field"><label class="required">Mobile</label><input id="f_mobile" value="${esc(L.mobile)}"></div>
        <div class="field"><label>Email</label><input id="f_email" value="${esc(L.email)}"></div>
        <div class="field"><label>Lead Source</label>
          <select id="f_source">${picklist('leadSources').map(s => `<option ${L.leadSource === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Mode of Contact</label>
          <select id="f_modeOfContact"><option value="">-- Select --</option>${picklist('modesOfContact').map(m => `<option ${L.modeOfContact === m ? "selected" : ""}>${m}</option>`).join("")}</select>
        </div>
        <div class="field ${L.leadSource === "Digital" ? "" : "hidden"}" id="wrap_digitalSub"><label>Digital Sub-Source</label>
          <select id="f_digitalSub">${picklist('digitalSubSources').map(s => `<option ${L.digitalSubSource === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>
        <div class="field ${L.leadSource === "Student Referral" ? "" : "hidden"}" id="wrap_studentId"><label class="required">Student ID <span class="pill">UC21 dynamic</span></label><input id="f_studentId" value="${esc(L.studentId)}"></div>
        <div class="field ${L.leadSource === "Staff Referral" ? "" : "hidden"}" id="wrap_staffName"><label class="required">Staff Name <span class="pill">UC22 dynamic</span></label><input id="f_staffName" value="${esc(L.staffName)}"></div>
        <div class="field"><label>School / Company</label><input id="f_schoolOrCompany" value="${esc(L.schoolOrCompany || "")}"></div>
        <div class="field"><label>University</label><select id="f_university"><option value="">-- Select --</option>${picklist('universities').map(u => `<option ${L.university === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
        <div class="field"><label>Program</label><select id="f_program"><option value="">-- Select --</option>${picklist('programs').map(p => `<option ${L.program === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
        <div class="field"><label>Country</label>
          <select id="f_country">${picklist('countries').map(c => `<option ${L.country === c ? "selected" : ""}>${c}</option>`).join("")}</select>
        </div>
        <div class="field ${L.country === "Sri Lanka" ? "" : "hidden"}" id="wrap_district"><label>District <span class="pill">UC58</span></label>
          <select id="f_district">${picklist('districts').map(d => `<option ${L.district === d ? "selected" : ""}>${d}</option>`).join("")}</select>
        </div>
        <div class="field ${L.country === "Sri Lanka" && L.district === "Other" ? "" : "hidden"}" id="wrap_districtOther"><label>Specify District <span class="pill">UC58 - AF1</span></label><input id="f_districtOther" value="${esc(L.districtOther || "")}" placeholder="Enter district manually"></div>
        <div class="field"><label>Intake Cycle</label><select id="f_intake"><option value="">-- None --</option>${DB.intakes.map(i => `<option value="${i.id}" ${L.intakeId === i.id ? "selected" : ""}>${i.name}</option>`).join("")}</select></div>
        <div class="field"><label>Assigned Counsellor</label>
          <select id="f_assigned" ${!canTransferLeads() && !isNew ? "disabled" : ""}>
            ${DB.users.filter(u => u.role === "Counsellor").map(u => `<option value="${u.id}" ${L.assignedTo === u.id ? "selected" : ""}>${u.name}</option>`).join("")}
          </select>
          ${!canTransferLeads() && !isNew ? '<div class="small-muted">' + icon("lock") + ' Only Managers can reassign leads (UC69)</div>' : ""}
        </div>
        <div class="field"><label>Domain / Branch <span class="pill">UC30</span></label><select id="f_domain">${picklist('domains').map(d => `<option ${L.domain === d ? "selected" : ""}>${d}</option>`).join("")}</select></div>
        <div class="field"><label>Detailed Status</label>
          <select id="f_detailedStatus">
            <option value="">-- None --</option>
            <optgroup label="Not Qualified Lead">${detailedStatusOptions("Not Qualified Lead").map(s => `<option ${L.detailedStatus === s ? "selected" : ""}>${s}</option>`).join("")}</optgroup>
            <optgroup label="Qualified Lead">${detailedStatusOptions("Qualified Lead").map(s => `<option ${L.detailedStatus === s ? "selected" : ""}>${s}</option>`).join("")}</optgroup>
          </select>
        </div>
      </div>
      <div class="checkbox-row"><input type="checkbox" id="f_isReferral" ${L.isReferral ? "checked" : ""}> <label style="margin:0">This is a Referral (Staff or Student)</label></div>
      <div class="field ${L.isReferral ? "" : "hidden"}" id="wrap_referralType"><label>Referral Type</label>
        <select id="f_referralType"><option value="Staff" ${L.referralType === "Staff" ? "selected" : ""}>Staff</option><option value="Student" ${L.referralType === "Student" ? "selected" : ""}>Student</option></select>
      </div>
      ${!isNew && L.stage === "Closed" ? `<div class="field"><label>Loss Reason <span class="pill">UC77</span></label><select id="f_lossReason"><option value="">--</option>${picklist('lossReasons').map(r => `<option ${L.lossReason === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>` : ""}
      <div id="leadValidationNotice"></div>
    `;
    document.getElementById("f_source").onchange = e => {
      L.leadSource = e.target.value; syncFieldsFromDOM();
      document.getElementById("wrap_digitalSub").classList.toggle("hidden", L.leadSource !== "Digital");
      document.getElementById("wrap_studentId").classList.toggle("hidden", L.leadSource !== "Student Referral");
      document.getElementById("wrap_staffName").classList.toggle("hidden", L.leadSource !== "Staff Referral");
    };
    document.getElementById("f_isReferral").onchange = e => {
      L.isReferral = e.target.checked;
      document.getElementById("wrap_referralType").classList.toggle("hidden", !L.isReferral);
    };
    document.getElementById("f_district").onchange = e => {
      L.district = e.target.value;
      document.getElementById("wrap_districtOther").classList.toggle("hidden", L.district !== "Other");
    };
    document.getElementById("f_country").onchange = e => {
      L.country = e.target.value;
      // Country field (new lead field) — district only applies while Sri Lanka is selected;
      // any other country leaves it blank rather than showing an irrelevant Sri Lankan list.
      if (L.country !== "Sri Lanka") { L.district = ""; L.districtOther = ""; }
      document.getElementById("wrap_district").classList.toggle("hidden", L.country !== "Sri Lanka");
      document.getElementById("wrap_districtOther").classList.toggle("hidden", !(L.country === "Sri Lanka" && L.district === "Other"));
    };
    document.getElementById("f_program").onchange = e => {
      L.program = e.target.value; // Program-Based Field Configuration — Academic tab depends on program type
    };
  }

  if (tab === "academic") {
    const pType = programType(L.program);
    // Program-Based Field Configuration — the fields shown here depend on the selected Program's
    // type (Admin → Fields & Picklists → Program Types), so only relevant academic info is captured.
    const langBlock = `
      <hr class="sep">
      <div class="grid-2">
        <div class="field"><label>Language Test</label><select id="f_langTest"><option ${L.languageTest === "IELTS" ? "selected" : ""}>IELTS</option><option ${L.languageTest === "TOEFL" ? "selected" : ""}>TOEFL</option><option ${L.languageTest === "PTE" ? "selected" : ""}>PTE</option><option ${L.languageTest === "None" ? "selected" : ""}>None</option></select></div>
        <div class="field"><label>Score</label><input id="f_langScore" value="${esc(L.languageScore)}" placeholder="e.g. 6.5"></div>
      </div>`;

    if (pType === "Master's") {
      body.innerHTML = `
        <p class="small-muted">Master's applicant — prior degree details replace O/L / A/L capture. <span class="pill">Program-Based Fields</span></p>
        <div class="grid-2">
          <div class="field"><label class="required">Bachelor's Degree</label><input id="f_bachelorsDegree" value="${esc(L.bachelorsDegree || "")}" placeholder="e.g. BSc Computing"></div>
          <div class="field"><label class="required">Bachelor's University</label>
            <select id="f_bachelorsUniversity"><option value="">-- Select --</option>${picklist('universities').map(u => `<option ${L.bachelorsUniversity === u ? "selected" : ""}>${u}</option>`).join("")}</select>
          </div>
        </div>
        ${langBlock}
      `;
    } else if (pType === "Foundation") {
      body.innerHTML = `
        <p class="small-muted">Foundation applicant — previous school and a single qualification (O/L or A/L) are captured. <span class="pill">Program-Based Fields</span></p>
        <div class="grid-2">
          <div class="field"><label class="required">Previous School</label><input id="f_previousSchool" value="${esc(L.previousSchool || "")}"></div>
          <div class="field"><label class="required">Qualification</label>
            <select id="f_priorQualificationType"><option value="">-- Select --</option><option ${L.priorQualificationType === "O/L" ? "selected" : ""}>O/L</option><option ${L.priorQualificationType === "A/L" ? "selected" : ""}>A/L</option></select>
          </div>
        </div>
        <div id="foundationGradeWrap">${L.priorQualificationType ? gradeTableHTML(L.priorQualificationType === "O/L" ? "ol" : "al", L) : "<p class='small-muted'>Select a qualification to record grades.</p>"}</div>
        ${langBlock}
      `;
      document.getElementById("f_priorQualificationType").onchange = e => { L.priorQualificationType = e.target.value; renderLeadModalTab(); };
    } else {
      body.innerHTML = `
        <p class="small-muted">Capture academic results (O/L, A/L, Language) with mandatory-field enforcement <span class="pill">UC55</span></p>
        <div class="checkbox-row"><input type="checkbox" id="f_pending" ${L.resultsPending ? "checked" : ""}><label style="margin:0">Results Pending <span class="pill">UC56</span></label></div>
        <p class="small-muted">When checked, mandatory validations for results are relaxed, but the lead cannot progress to Converted stage.</p>
        <div class="field"><label>Exam Type <span class="pill">UC57</span></label>
          <select id="f_examType"><option ${L.examType === "Local A/L" ? "selected" : ""}>Local A/L</option><option ${L.examType === "London A/L" ? "selected" : ""}>London A/L</option></select>
        </div>
        <div id="examTypeNotice"></div>
        ${gradeTableHTML("ol", L)}
        ${gradeTableHTML("al", L)}
        ${langBlock}
      `;
      document.getElementById("f_pending").onchange = e => { L.resultsPending = e.target.checked; renderLeadModalTab(); };
      document.getElementById("f_examType").onchange = e => {
        const newVal = e.target.value;
        // UC57 - AF1: A/L grades are scale-specific, so switching exam type invalidates them.
        // Warn inline (this is inside the lead modal — confirmModal would replace it) and
        // hold the select on its old value until the user commits.
        const hasAL = (L.alSubjects || []).some(r => r.grade);
        if (hasAL && newVal !== L.examType) {
          e.target.value = L.examType;
          const notice = document.getElementById("examTypeNotice");
          if (notice) notice.innerHTML = `
            <div class="notice">${icon("warn")} Switching to <b>${esc(newVal)}</b> clears the ${(L.alSubjects || []).length} recorded A/L grade(s) — the two exams use different grading scales (UC57 - AF1).
            <div style="margin-top:8px"><button class="btn sm danger" onclick="confirmExamTypeChange('${esc(newVal)}')">Clear grades &amp; switch</button>
            <button class="btn sm secondary" onclick="document.getElementById('examTypeNotice').innerHTML=''">Keep ${esc(L.examType)}</button></div></div>`;
          return;
        }
        L.examType = newVal;
        renderLeadModalTab();
      };
    }
    bindGradeRowHandlers();
  }

  if (tab === "checklist") {
    // UC54 - AF1: some items can be auto-verified by the system (e.g. the duplicate check already ran on save)
    const dupItem = L.checklist.find(i => i.label === "Duplicate check passed");
    if (dupItem && !dupItem.done) dupItem.done = !checkDuplicate(L);
    body.innerHTML = `
      <p class="small-muted">Lead Qualification Checklist (UC54) — all items must be checked before the lead can move forward.</p>
      ${L.checklist.map((item, idx) => `
        <div class="checklist-item"><input type="checkbox" data-idx="${idx}" class="chkItem" ${item.done ? "checked" : ""}> <label style="margin:0">${esc(item.label)}</label>${item.label === "Duplicate check passed" ? '<span class="pill">auto-verified — UC54 AF1</span>' : ""}</div>
      `).join("")}
    `;
    document.querySelectorAll(".chkItem").forEach(cb => cb.onchange = e => { L.checklist[e.target.dataset.idx].done = e.target.checked; });
  }

  if (tab === "notes") {
    L.tasks = L.tasks || [];
    const sorted = L.tasks.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    body.innerHTML = `
      <p class="small-muted">Notes, remarks and tasks for this lead, recorded per pipeline stage — with a follow-up date/time so they surface as reminders on the Follow-Ups page.</p>
      <div class="card" style="box-shadow:none;margin-bottom:16px">
        <h3 style="margin-bottom:8px">Log a Note / Task</h3>
        <div class="grid-2">
          <div class="field"><label>Stage</label><select id="tsk_stage">${stages().map(s => `<option value="${s}" ${s === L.stage ? "selected" : ""}>${esc(stageLabel(s))}</option>`).join("")}</select></div>
          <div class="field"><label>Follow-Up Date &amp; Time <span class="pill">optional — creates a reminder</span></label><input type="datetime-local" id="tsk_due"></div>
        </div>
        <div class="field"><label>Note / Task</label><textarea id="tsk_note" rows="2" placeholder="e.g. Called to confirm interest, follow up next week"></textarea></div>
        <button class="btn sm" onclick="addStageTask()">+ Add Note / Task</button>
      </div>
      ${sorted.length ? sorted.map(t => `
        <div class="checklist-item" style="align-items:flex-start">
          <input type="checkbox" class="taskDoneChk" data-id="${t.id}" ${t.done ? "checked" : ""}>
          <div style="flex:1">
            <div>${stageBadge(t.stage)} ${t.dueAt ? taskStatusPill(t) : ""} <span class="small-muted">${fmtDateTime(t.createdAt)} by ${esc(t.createdBy)}</span></div>
            <div style="margin-top:2px">${esc(t.note)}</div>
            ${t.dueAt ? `<div class="small-muted">Due: ${fmtDateTime(t.dueAt)}</div>` : ""}
          </div>
          <button class="btn sm ghost" onclick="removeStageTask('${t.id}')" title="Remove">${icon("x")}</button>
        </div>`).join("") : `<div class="empty-state">No notes or tasks recorded yet.</div>`}
    `;
    document.querySelectorAll(".taskDoneChk").forEach(cb => cb.onchange = e => {
      const t = L.tasks.find(x => x.id === e.target.dataset.id);
      if (t) t.done = e.target.checked;
      commitLeadEdit();
      renderLeadModalTab();
    });
  }

  if (tab === "application") {
    body.innerHTML = renderApplicationTabHTML(L);
    bindApplicationTabHandlers(L);
  }

  if (tab === "offerLetter") {
    body.innerHTML = renderOfferLetterTabHTML(L);
  }

  if (tab === "paymentPlan") {
    body.innerHTML = renderPaymentPlanTabHTML(L);
  }

  if (tab === "timeline") {
    body.innerHTML = `
      <p class="small-muted">Chronological, read-only interaction log — every call, email and status change is captured automatically (UC66) and viewable per lead (UC67).</p>
      <ul class="timeline">${(L.activity || []).map(a => `<li><span class="ts">${fmtDateTime(a.ts)}</span> — <b>${esc(a.type)}</b> by ${esc(a.user)}: ${esc(a.text)}</li>`).join("") || "<li>No history yet.</li>"}</ul>
      ${(L.activity || []).length ? `<div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn sm secondary" onclick="exportLeadTimeline()">${icon("download")} CSV</button>
        <button class="btn sm" onclick="exportLeadTimelinePDF()" title="UC67 - AF1">${icon("document")} Export PDF</button>
      </div>` : ""}
    `;
  }

  // Footer: stage transition buttons + save/delete
  const nextStages = allowedNextStages(L.stage);
  footer.innerHTML = `
    ${!isNew ? `<div style="margin-right:auto;display:flex;gap:6px;flex-wrap:wrap;">
        ${nextStages.map(s => `<button class="btn sm secondary" onclick="attemptStageChange('${s}')">Move to ${stageLabel(s)} →</button>`).join("")}
        ${!L.deactivated ? `<button class="btn sm danger" onclick="attemptDeactivate()">Deactivate</button>` : `<button class="btn sm secondary" onclick="reactivateLead('${L.id}');closeModal();" title="UC39 - AF1">Reactivate</button>`}
      </div>` : ""}
    <button class="btn secondary" onclick="closeModal()">Cancel</button>
    <button class="btn" onclick="saveLeadModal()">${isNew ? "Create Lead" : "Save Changes"}</button>
  `;
}

/* ============================================================
   Structured academic results — subject + grade rows (UC55 / UC57)
   ============================================================ */
function gradeRows(L, kind) {
  const key = kind === "ol" ? "olSubjects" : "alSubjects";
  if (!Array.isArray(L[key])) L[key] = [];
  return L[key];
}

function gradeTableHTML(kind, L) {
  const rows = gradeRows(L, kind);
  const isOl = kind === "ol";
  const scale = gradeScaleFor(kind, L.examType);
  const subjects = picklist(isOl ? "olSubjects" : "alSubjects");
  const title = isOl ? "O/L Results" : `A/L Results — ${esc(L.examType)}`;
  const req = L.resultsPending ? "" : "required";

  return `
    <div class="card" style="box-shadow:none;margin-bottom:16px">
      <h3 style="margin-bottom:8px"><span class="${req}">${title}</span>
        <span class="pill">${isOl ? "UC55" : "UC57 grading scale"}</span></h3>
      ${rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Subject</th><th style="width:130px">Grade</th><th style="width:60px"></th></tr></thead>
        <tbody>${rows.map((r, i) => `
          <tr>
            <td><input list="${kind}SubjectList" class="gradeSubject" data-kind="${kind}" data-idx="${i}" value="${esc(r.subject || "")}" placeholder="Subject name"></td>
            <td><select class="gradeValue" data-kind="${kind}" data-idx="${i}">
              <option value="">—</option>
              ${scale.map(g => `<option ${r.grade === g ? "selected" : ""}>${g}</option>`).join("")}
            </select></td>
            <td><button class="btn sm ghost" onclick="removeGradeRow('${kind}',${i})" title="Remove subject">${icon("x")}</button></td>
          </tr>`).join("")}</tbody>
      </table></div>` : `<p class="small-muted">No subjects recorded yet.</p>`}
      <datalist id="${kind}SubjectList">${subjects.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn sm secondary" onclick="addGradeRow('${kind}')">+ Add Subject</button>
        <span class="small-muted">Grades available: ${scale.join(" · ")}</span>
        ${rows.length ? `<span class="pill">Summary: ${esc(summariseGrades(rows)) || "—"}</span>` : ""}
      </div>
    </div>`;
}

// Keep edits in the in-memory lead as the user types, so switching tabs doesn't lose them
function bindGradeRowHandlers() {
  const L = window.__editingLead;
  document.querySelectorAll(".gradeSubject").forEach(el => el.oninput = e => {
    gradeRows(L, e.target.dataset.kind)[+e.target.dataset.idx].subject = e.target.value;
  });
  document.querySelectorAll(".gradeValue").forEach(el => el.onchange = e => {
    gradeRows(L, e.target.dataset.kind)[+e.target.dataset.idx].grade = e.target.value;
    renderLeadModalTab(); // refresh the summary pill
  });
}

// Commits an in-progress modal action (one that should persist immediately, like a stage change
// or a "Send" action) back into DB.leads — the same pattern attemptStageChange() uses.
function commitLeadEdit() {
  const L = window.__editingLead;
  if (!L.id) return;
  const existing = DB.leads.find(l => l.id === L.id);
  if (existing) Object.assign(existing, L);
  saveDB();
}

/* ============================================================
   Student Application Form Management
   Send / review-and-edit / offer letter / payment plan — simulated the same way the
   existing conversion email (UC35/UC36) is: logged + toasted, no real mail server.
   ============================================================ */
function sendApplicationForm() {
  const L = window.__editingLead;
  if (!L.email) { toast("Cannot send — no email address on file for this lead.", "error"); return; }
  L.applicationForm = L.applicationForm || defaultApplicationForm();
  L.applicationForm.status = "Sent";
  L.applicationForm.sentAt = new Date().toISOString();
  addActivity(L, "Automation", `Application form sent to ${L.email}`);
  commitLeadEdit();
  toast(`Application form sent to ${L.email}.`, "success");
  renderLeadModalTab();
}
function markApplicationSubmitted() {
  const L = window.__editingLead;
  L.applicationForm.status = "Submitted";
  L.applicationForm.submittedAt = new Date().toISOString();
  addActivity(L, "Update", "Application form received from student — pending counsellor review");
  notifySubmissionRecipient(L);
  commitLeadEdit();
  toast("Application marked as submitted.", "success");
  renderLeadModalTab();
}
// Application Submission Notification — the assigned counsellor is notified via the system (bell)
// and a simulated email the same way conversion emails are elsewhere in this demo. A website
// application with no counsellor yet routes to Head of Marketing instead (see Website Leads).
function notifySubmissionRecipient(lead) {
  if (lead.assignedTo) {
    notify(lead.assignedTo, lead.id, `Application submitted — ${lead.name}`, "Application Submitted");
    addActivity(lead, "Automation", `Counsellor ${userName(lead.assignedTo)} notified by system and email of the new submission`);
  } else {
    notifyRole("Head of Marketing", lead.id, `Website application submitted, no counsellor assigned — ${lead.name}`, "Website Lead");
    addActivity(lead, "Automation", "No counsellor assigned — Head of Marketing notified to review and assign (Website Leads)");
  }
}
function saveApplicationReview(markReviewed) {
  const L = window.__editingLead;
  if (L.applicationForm.academicConfirmation.status === "Confirmed") { toast("Locked — Academic Admin has already confirmed this application.", "error"); return; }
  L.name = document.getElementById("af_name").value.trim() || L.name;
  L.mobile = document.getElementById("af_mobile").value.trim() || L.mobile;
  L.email = document.getElementById("af_email").value.trim();
  L.program = document.getElementById("af_program").value;
  L.university = document.getElementById("af_university").value;
  if (markReviewed) {
    L.applicationForm.status = "Reviewed";
    L.applicationForm.reviewedAt = new Date().toISOString();
    L.applicationForm.reviewedBy = getCurrentUser().name;
    addActivity(L, "Update", `Application reviewed and verified by ${getCurrentUser().name}`);
    notifyRole("Academic Admin", L.id, `Application reviewed and awaiting confirmation — ${L.name}`, "Pending Confirmation");
  } else {
    addActivity(L, "Update", "Application corrections saved after review");
  }
  commitLeadEdit();
  toast(markReviewed ? "Application reviewed. Academic Admin notified for confirmation." : "Corrections saved.", "success");
  renderLeadModalTab();
}

/* ---------------- Academic Admin — Application Verification ---------------- */
function confirmApplicationByAdmin() {
  const L = window.__editingLead;
  L.applicationForm.academicConfirmation = { status: "Confirmed", confirmedBy: getCurrentUser().name, confirmedAt: new Date().toISOString() };
  addActivity(L, "Update", `Application and supporting documents confirmed by ${getCurrentUser().name} — now locked`);
  commitLeadEdit();
  toast("Application confirmed and locked.", "success");
  renderLeadModalTab();
}
function releaseOfferToCounsellor() {
  const L = window.__editingLead;
  L.applicationForm.offerRelease = { status: "Released", releasedBy: getCurrentUser().name, releasedAt: new Date().toISOString() };
  addActivity(L, "Update", `Offer released to counsellor ${userName(L.assignedTo)} by ${getCurrentUser().name}`);
  notify(L.assignedTo, L.id, `Offer released — ${L.name}`, "Offer Released");
  commitLeadEdit();
  toast("Offer released to counsellor.", "success");
  renderLeadModalTab();
}

/* ---------------- Head of Marketing discount approval ---------------- */
function requestDiscountApproval() {
  const L = window.__editingLead;
  const percent = document.getElementById("da_percent").value;
  const amount = document.getElementById("da_amount").value;
  const note = document.getElementById("da_note").value.trim();
  L.applicationForm.discountApproval = {
    status: "Pending", requestedPercent: percent, requestedAmount: amount, note,
    requestedBy: getCurrentUser().name, requestedAt: new Date().toISOString(), decidedBy: "", decidedAt: "", decisionNote: ""
  };
  addActivity(L, "Update", `Discount approval requested by ${getCurrentUser().name}${percent ? ` (${percent}%)` : ""}${amount ? ` (LKR ${amount})` : ""}${note ? " — " + note : ""}`);
  notifyRole("Head of Marketing", L.id, `Discount approval requested — ${L.name}`, "Pending Approval");
  commitLeadEdit();
  toast("Discount approval requested — Head of Marketing notified.", "success");
  renderLeadModalTab();
}
function decideDiscountApproval(approve) {
  const L = window.__editingLead;
  const note = document.getElementById("da_decisionNote") ? document.getElementById("da_decisionNote").value.trim() : "";
  L.applicationForm.discountApproval.status = approve ? "Approved" : "Rejected";
  L.applicationForm.discountApproval.decidedBy = getCurrentUser().name;
  L.applicationForm.discountApproval.decidedAt = new Date().toISOString();
  L.applicationForm.discountApproval.decisionNote = note;
  addActivity(L, "Update", `Discount request ${approve ? "approved" : "rejected"} by ${getCurrentUser().name}${note ? " — " + note : ""}`);
  notify(L.assignedTo, L.id, `Discount request ${approve ? "approved" : "rejected"} — ${L.name}`, approve ? "Approved" : "Rejected");
  commitLeadEdit();
  toast(`Discount request ${approve ? "approved" : "rejected"}.`, "success");
  renderLeadModalTab();
}

function issueOfferLetter() {
  const L = window.__editingLead;
  const type = document.getElementById("af_offerType").value;
  L.applicationForm.offerLetter = { status: "Issued", type, issuedAt: new Date().toISOString() };
  addActivity(L, "Automation", `${type} offer letter issued${L.email ? " and emailed to " + L.email : ""}`);
  commitLeadEdit();
  toast(`${type} offer letter issued.`, "success");
  renderLeadModalTab();
}
function addPaymentPlanRow() {
  document.getElementById("paymentPlanRows").insertAdjacentHTML("beforeend", `
    <div class="grid-2">
      <div class="field"><label>Installment</label><input class="pp_label" value="Installment"></div>
      <div class="field"><label>Amount (LKR)</label><input class="pp_amount" type="number" min="0" value="0"></div>
    </div>`);
}
function sendPaymentPlan() {
  const L = window.__editingLead;
  const labels = document.querySelectorAll(".pp_label");
  const amounts = document.querySelectorAll(".pp_amount");
  const installments = [];
  labels.forEach((el, i) => installments.push({ label: el.value.trim() || `Installment ${i + 1}`, amount: Number(amounts[i].value || 0), dueDate: isoDateOffset(i * 30) }));
  L.applicationForm.paymentPlan = { status: "Sent", installments, sentAt: new Date().toISOString() };
  addActivity(L, "Automation", `Payment plan (${installments.length} installment(s), total ${money(installments.reduce((s, r) => s + r.amount, 0))}) sent${L.email ? " to " + L.email : ""}`);
  commitLeadEdit();
  toast("Payment plan sent — student can now proceed with payment.", "success");
  renderLeadModalTab();
}

/* ---------------- Student payment confirmation & registration hand-off ---------------- */
function confirmPaymentReceived() {
  const L = window.__editingLead;
  L.applicationForm.paymentConfirmed = { status: "Confirmed", confirmedBy: getCurrentUser().name, confirmedAt: new Date().toISOString() };
  addActivity(L, "Update", `Payment confirmed by ${getCurrentUser().name}`);
  commitLeadEdit();
  toast("Payment confirmed.", "success");
  renderLeadModalTab();
}
function pushToAdminStaff() {
  const L = window.__editingLead;
  L.applicationForm.pushedToAdmin = { status: "Pushed", pushedBy: getCurrentUser().name, pushedAt: new Date().toISOString() };
  addActivity(L, "Update", `Pushed to Admin Staff for registration by ${getCurrentUser().name}`);
  notifyRole("Academic Admin", L.id, `Student pushed for registration — ${L.name}`, "Pending Registration");
  commitLeadEdit();
  toast("Pushed to Admin Staff for registration.", "success");
  renderLeadModalTab();
}
function transferToSMS() {
  const L = window.__editingLead;
  L.applicationForm.smsTransfer = { status: "Transferred", transferredBy: getCurrentUser().name, transferredAt: new Date().toISOString() };
  addActivity(L, "Automation", `Student transferred to the Student Management System by ${getCurrentUser().name}`);
  commitLeadEdit();
  toast("Student transferred to the Student Management System.", "success");
  renderLeadModalTab();
}

/* ---------------- Application tab: composed view of the whole offer/registration pipeline ---------------- */
function renderApplicationTabHTML(L) {
  L.applicationForm = L.applicationForm || defaultApplicationForm();
  const af = L.applicationForm;
  const role = currentRole();
  const locked = af.academicConfirmation.status === "Confirmed";

  const sections = [];

  sections.push(`
    <div class="card" style="box-shadow:none;margin-bottom:16px">
      <h3>Application Form ${applicationStatusBadge(af)}</h3>
      ${af.sentAt ? `<p class="small-muted">Sent ${fmtDateTime(af.sentAt)}${af.submittedAt ? " · Submitted " + fmtDateTime(af.submittedAt) : ""}${af.reviewedAt ? " · Reviewed " + fmtDateTime(af.reviewedAt) + " by " + esc(af.reviewedBy) : ""}</p>` : `<p class="small-muted">Not yet sent to the student.</p>`}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button class="btn sm ${af.status === "Not Sent" ? "" : "secondary"}" onclick="sendApplicationForm()">${af.status === "Not Sent" ? icon("mail") + " Send Application Form" : icon("mail") + " Resend Application Form"}</button>
        ${af.status === "Sent" ? `<button class="btn sm secondary" onclick="markApplicationSubmitted()">Mark as Submitted (received from student)</button>` : ""}
        <button class="btn sm secondary" onclick="closeModal();go('#/apply?lead=${L.id}')" title="Opens the UCL-themed application form the student fills in">${icon("note")} Open Application Form (UCL Theme)</button>
      </div>
    </div>`);

  if (af.status === "Submitted" || af.status === "Reviewed") {
    sections.push(`
      <div class="card" style="box-shadow:none;margin-bottom:16px">
        <h3>Review Submitted Application <span class="pill">verify accuracy</span></h3>
        ${locked ? `<div class="notice">${icon("lock")} Confirmed and locked by ${esc(af.academicConfirmation.confirmedBy)} on ${fmtDateTime(af.academicConfirmation.confirmedAt)} — no further edits.</div>` : `<p class="small-muted">Edit any field the student got wrong, then confirm the review. This mirrors the student's own submission back onto the lead record.</p>`}
        <div class="grid-2">
          <div class="field"><label>Full Name</label><input id="af_name" value="${esc(L.name)}" ${locked ? "disabled" : ""}></div>
          <div class="field"><label>Mobile</label><input id="af_mobile" value="${esc(L.mobile)}" ${locked ? "disabled" : ""}></div>
          <div class="field"><label>Email</label><input id="af_email" value="${esc(L.email)}" ${locked ? "disabled" : ""}></div>
          <div class="field"><label>Program</label><select id="af_program" ${locked ? "disabled" : ""}>${picklist('programs').map(p => `<option ${L.program === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
          <div class="field"><label>University</label><select id="af_university" ${locked ? "disabled" : ""}><option value="">-- Select --</option>${picklist('universities').map(u => `<option ${L.university === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
          <div class="field"><label>Academic Summary</label><input id="af_academic" value="${esc(programType(L.program) === "Master's" ? L.bachelorsDegree + (L.bachelorsUniversity ? " — " + L.bachelorsUniversity : "") : (L.olResult || L.alResult ? [L.olResult, L.alResult].filter(Boolean).join(" / ") : ""))}" placeholder="e.g. 3A 2B (O/L)" disabled></div>
        </div>
        ${!locked ? `<div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn sm" onclick="saveApplicationReview(${af.status !== "Reviewed"})">${af.status === "Reviewed" ? "Save Corrections" : icon("check") + " Confirm Reviewed"}</button>
        </div>` : ""}
      </div>`);
  }

  if (af.status === "Reviewed") {
    sections.push(`
      <div class="card" style="box-shadow:none;margin-bottom:16px">
        <h3>Academic Admin Verification ${locked ? `<span class="badge converted">Confirmed</span>` : `<span class="badge closed">Pending</span>`}</h3>
        ${locked
          ? `<p class="small-muted">Confirmed by ${esc(af.academicConfirmation.confirmedBy)} on ${fmtDateTime(af.academicConfirmation.confirmedAt)}. Qualifications and supporting documents verified.</p>`
          : role === "Academic Admin"
            ? `<p class="small-muted">Verify the submitted qualifications and supporting documents, then confirm to lock the application.</p><button class="btn sm" onclick="confirmApplicationByAdmin()">${icon("check")} Confirm Application</button>`
            : `<p class="small-muted">Awaiting confirmation from Academic Admin before the offer can be released.</p>`}
      </div>`);
  }

  if (locked) {
    sections.push(`
      <div class="card" style="box-shadow:none;margin-bottom:16px">
        <h3>Offer Release <span class="pill">Admin → Counsellor</span> ${af.offerRelease.status === "Released" ? `<span class="badge converted">Released</span>` : `<span class="badge closed">Not Released</span>`}</h3>
        ${af.offerRelease.status === "Released"
          ? `<p class="small-muted">Released by ${esc(af.offerRelease.releasedBy)} on ${fmtDateTime(af.offerRelease.releasedAt)}.</p>`
          : role === "Academic Admin"
            ? `<button class="btn sm" onclick="releaseOfferToCounsellor()">${icon("send")} Release Offer to Counsellor</button>`
            : `<p class="small-muted">Awaiting release from Academic Admin.</p>`}
      </div>`);
  }

  if (af.offerRelease.status === "Released") {
    const da = af.discountApproval;
    sections.push(`
      <div class="card" style="box-shadow:none;margin-bottom:16px">
        <h3>Discount / Special Terms Approval <span class="pill">Head of Marketing</span> <span class="badge ${da.status === "Approved" ? "converted" : da.status === "Rejected" ? "closed" : da.status === "Pending" ? "pending" : "closed"}">${esc(da.status)}</span></h3>
        ${da.status === "Not Requested" ? `
          ${["Counsellor", "Manager", "Admin"].includes(role) ? `
          <div class="grid-2">
            <div class="field"><label>Discount %</label><input id="da_percent" type="number" min="0" max="100" placeholder="e.g. 10"></div>
            <div class="field"><label>Or Fixed Amount (LKR)</label><input id="da_amount" type="number" min="0" placeholder="e.g. 25000"></div>
          </div>
          <div class="field"><label>Note</label><input id="da_note" placeholder="Reason / relevant detail for Head of Marketing"></div>
          <button class="btn sm secondary" onclick="requestDiscountApproval()">Request Approval</button>
          ` : `<p class="small-muted">No discount requested for this student.</p>`}
        ` : `
          <p class="small-muted">Requested by ${esc(da.requestedBy)} on ${fmtDateTime(da.requestedAt)}${da.requestedPercent ? ` — ${esc(da.requestedPercent)}%` : ""}${da.requestedAmount ? ` — LKR ${esc(da.requestedAmount)}` : ""}${da.note ? " — " + esc(da.note) : ""}</p>
          ${da.status === "Pending" && role === "Head of Marketing" ? `
            <div class="field"><label>Decision Note</label><input id="da_decisionNote" placeholder="optional"></div>
            <button class="btn sm" onclick="decideDiscountApproval(true)">${icon("check")} Approve</button> <button class="btn sm danger" onclick="decideDiscountApproval(false)">${icon("x")} Reject</button>
          ` : da.status !== "Pending" ? `<p class="small-muted">${esc(da.status)} by ${esc(da.decidedBy)} on ${fmtDateTime(da.decidedAt)}${da.decisionNote ? " — " + esc(da.decisionNote) : ""}</p>` : `<p class="small-muted">Awaiting Head of Marketing decision.</p>`}
        `}
      </div>

      <div class="card" style="box-shadow:none;margin-bottom:16px">
        <h3>Offer Letter ${af.offerLetter.status === "Issued" ? `<span class="badge converted">Issued — ${esc(af.offerLetter.type)}</span>` : `<span class="badge closed">Not Issued</span>`}</h3>
        ${af.offerLetter.status === "Issued" ? `<p class="small-muted">Issued ${fmtDateTime(af.offerLetter.issuedAt)}</p>` : `
          <div class="field" style="max-width:280px"><label>Offer Type</label><select id="af_offerType">${OFFER_TYPES.map(t => `<option>${t}</option>`).join("")}</select></div>
          <button class="btn sm" onclick="issueOfferLetter()">${icon("cap")} Issue Offer Letter</button>`}
      </div>

      <div class="card" style="box-shadow:none;margin-bottom:16px">
        <h3>Payment Plan / Financial Documents ${af.paymentPlan.status === "Sent" ? `<span class="badge converted">Sent</span>` : `<span class="badge closed">Not Sent</span>`}</h3>
        <div id="paymentPlanRows">
          ${(af.paymentPlan.installments.length ? af.paymentPlan.installments : [{ label: "Registration Fee", amount: 25000, dueDate: todayStr() }]).map((row, i) => `
            <div class="grid-2" data-row="${i}">
              <div class="field"><label>Installment</label><input class="pp_label" value="${esc(row.label)}"></div>
              <div class="field"><label>Amount (LKR)</label><input class="pp_amount" type="number" min="0" value="${row.amount}"></div>
            </div>`).join("")}
        </div>
        ${af.paymentPlan.status === "Sent" ? `<p class="small-muted">Sent ${fmtDateTime(af.paymentPlan.sentAt)}</p>` : `<button class="btn sm secondary" onclick="addPaymentPlanRow()">+ Add Installment</button> <button class="btn sm" onclick="sendPaymentPlan()">${icon("card")} Send Payment Plan</button>`}
      </div>`);
  }

  if (af.paymentPlan.status === "Sent") {
    const pc = af.paymentConfirmed, pa = af.pushedToAdmin, sms = af.smsTransfer;
    sections.push(`
      <div class="card" style="box-shadow:none;margin-bottom:16px">
        <h3>Student Payment &amp; Registration Hand-off</h3>
        <div class="checklist-item"><span class="badge ${pc.status === "Confirmed" ? "converted" : "closed"}">${pc.status === "Confirmed" ? icon("check") : ""}</span>
          <div style="flex:1">Payment Confirmed${pc.status === "Confirmed" ? ` — by ${esc(pc.confirmedBy)} on ${fmtDateTime(pc.confirmedAt)}` : ""}</div>
          ${pc.status !== "Confirmed" ? `<button class="btn sm secondary" onclick="confirmPaymentReceived()">Confirm Payment Received</button>` : ""}
        </div>
        <div class="checklist-item"><span class="badge ${pa.status === "Pushed" ? "converted" : "closed"}">${pa.status === "Pushed" ? icon("check") : ""}</span>
          <div style="flex:1">Pushed to Admin Staff${pa.status === "Pushed" ? ` — by ${esc(pa.pushedBy)} on ${fmtDateTime(pa.pushedAt)}` : ""}</div>
          ${pc.status === "Confirmed" && pa.status !== "Pushed" ? `<button class="btn sm secondary" onclick="pushToAdminStaff()">Push to Admin Staff →</button>` : ""}
        </div>
        <div class="checklist-item"><span class="badge ${sms.status === "Transferred" ? "converted" : "closed"}">${sms.status === "Transferred" ? icon("check") : ""}</span>
          <div style="flex:1">Transferred to Student Management System${sms.status === "Transferred" ? ` — by ${esc(sms.transferredBy)} on ${fmtDateTime(sms.transferredAt)}` : ""}</div>
          ${pa.status === "Pushed" && sms.status !== "Transferred" && ["Academic Admin", "Admin"].includes(role) ? `<button class="btn sm" onclick="transferToSMS()">${icon("cap")} Transfer to SMS</button>` : ""}
        </div>
      </div>`);
  }

  return `<p class="small-muted">Application form status is visible here on the lead record. Sending, review, offer release, discount approval, offer/payment-plan dispatch and registration hand-off are simulated the same way conversion emails are elsewhere in this demo — no real mail server (see README "Demo limitations").</p>` + sections.join("");
}
function bindApplicationTabHandlers(L) { /* all controls here use inline onclick — nothing to bind */ }

/* ---------------- Offer Letter tab: sent to the student by the counsellor once the application form is submitted ---------------- */
function renderOfferLetterTabHTML(L) {
  L.applicationForm = L.applicationForm || defaultApplicationForm();
  const af = L.applicationForm;
  const submitted = af.status === "Submitted" || af.status === "Reviewed";
  return `
    <p class="small-muted">Offer letter dispatch is simulated the same way conversion emails are elsewhere in this demo — no real mail server (see README "Demo limitations").</p>
    <div class="card" style="box-shadow:none;margin-bottom:16px">
      <h3>Offer Letter ${af.offerLetter.status === "Issued" ? `<span class="badge converted">Issued — ${esc(af.offerLetter.type)}</span>` : `<span class="badge closed">Not Issued</span>`}</h3>
      ${!submitted ? `<div class="notice">${icon("info")} The student hasn't submitted the Application Form yet — send it from the Application tab first.</div>` : ""}
      ${af.offerLetter.status === "Issued" ? `<p class="small-muted">Issued ${fmtDateTime(af.offerLetter.issuedAt)}${L.email ? " and emailed to " + esc(L.email) : ""}</p>` : `
        <div class="field" style="max-width:280px"><label>Offer Type</label><select id="af_offerType" ${submitted ? "" : "disabled"}>${OFFER_TYPES.map(t => `<option>${t}</option>`).join("")}</select></div>
        <button class="btn sm" ${submitted ? "" : "disabled"} onclick="issueOfferLetter()">${icon("cap")} Issue Offer Letter</button>`}
    </div>`;
}

/* ---------------- Payment Plan tab: sent to the student by the counsellor once the application form is submitted ---------------- */
function renderPaymentPlanTabHTML(L) {
  L.applicationForm = L.applicationForm || defaultApplicationForm();
  const af = L.applicationForm;
  const submitted = af.status === "Submitted" || af.status === "Reviewed";
  return `
    <p class="small-muted">Payment plan dispatch is simulated the same way conversion emails are elsewhere in this demo — no real mail server (see README "Demo limitations").</p>
    <div class="card" style="box-shadow:none;margin-bottom:16px">
      <h3>Payment Plan / Financial Documents ${af.paymentPlan.status === "Sent" ? `<span class="badge converted">Sent</span>` : `<span class="badge closed">Not Sent</span>`}</h3>
      ${!submitted ? `<div class="notice">${icon("info")} The student hasn't submitted the Application Form yet — send it from the Application tab first.</div>` : ""}
      <div id="paymentPlanRows">
        ${(af.paymentPlan.installments.length ? af.paymentPlan.installments : [{ label: "Registration Fee", amount: 25000, dueDate: todayStr() }]).map((row, i) => `
          <div class="grid-2" data-row="${i}">
            <div class="field"><label>Installment</label><input class="pp_label" value="${esc(row.label)}" ${submitted ? "" : "disabled"}></div>
            <div class="field"><label>Amount (LKR)</label><input class="pp_amount" type="number" min="0" value="${row.amount}" ${submitted ? "" : "disabled"}></div>
          </div>`).join("")}
      </div>
      ${af.paymentPlan.status === "Sent" ? `<p class="small-muted">Sent ${fmtDateTime(af.paymentPlan.sentAt)}</p>` : `<button class="btn sm secondary" ${submitted ? "" : "disabled"} onclick="addPaymentPlanRow()">+ Add Installment</button> <button class="btn sm" ${submitted ? "" : "disabled"} onclick="sendPaymentPlan()">${icon("card")} Send Payment Plan</button>`}
    </div>`;
}

/* ============================================================
   APPLY ONLINE — the student-facing Application Form (UCL theme)
   Reachable directly (no counsellor assignment implied) to simulate a visitor filling it in on
   the website, or opened pre-filled from an existing lead's Application tab. Reuses the same
   field ids, syncFieldsFromDOM() and grade-row helpers as the internal lead editor so the
   Educational Qualification section (University → Program → qualification) behaves identically.
   ============================================================ */
function renderApplyOnline(root) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const leadId = params.get("lead");
  const existing = leadId ? DB.leads.find(l => l.id === leadId) : null;

  window.__applyForm = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: null, name: "", mobile: "", email: "", leadSource: "Website", modeOfContact: "Website Form",
    digitalSubSource: "", studentId: "", staffName: "", schoolOrCompany: "", detailedStatus: "",
    university: "", program: "", country: "Sri Lanka", district: "", districtOther: "",
    previousSchool: "", priorQualificationType: "", bachelorsDegree: "", bachelorsUniversity: "",
    examType: "Local A/L", resultsPending: true, olSubjects: [], alSubjects: [], olResult: "", alResult: "",
    languageTest: "None", languageScore: "",
    stage: "Open", deactivated: false, deactivationReason: "", lossReason: "",
    assignedTo: "", intakeId: (currentAndNextIntakes()[0] || {}).id || "",
    domain: picklist('domains')[0], isReferral: false, referralType: "", agentId: "",
    checklist: makeChecklist(false), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0,
    nextFollowUp: "", followUpLog: [], escalated: false,
    applicationForm: defaultApplicationForm(), websiteLead: true, tasks: [],
    createdAt: new Date().toISOString(), activity: []
  };
  window.__editingLead = window.__applyForm; // reuse grade-row + syncFieldsFromDOM helpers
  window.__gradeRowRerender = () => renderApplyFormBody();
  renderApplyFormBody();
}

function applyQualificationFieldsHTML(L, pType) {
  if (pType === "Master's") {
    return `
      <div class="grid-2">
        <div class="field"><label class="required">Bachelor's Degree</label><input id="f_bachelorsDegree" value="${esc(L.bachelorsDegree || "")}" placeholder="e.g. BSc Computing"></div>
        <div class="field"><label class="required">Bachelor's University</label><select id="f_bachelorsUniversity"><option value="">-- Select --</option>${picklist('universities').map(u => `<option ${L.bachelorsUniversity === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
      </div>`;
  }
  if (pType === "Foundation") {
    return `
      <div class="grid-2">
        <div class="field"><label class="required">Previous School</label><input id="f_previousSchool" value="${esc(L.previousSchool || "")}"></div>
        <div class="field"><label class="required">Qualification</label><select id="f_priorQualificationType"><option value="">-- Select --</option><option ${L.priorQualificationType === "O/L" ? "selected" : ""}>O/L</option><option ${L.priorQualificationType === "A/L" ? "selected" : ""}>A/L</option></select></div>
      </div>
      <div id="foundationGradeWrap">${L.priorQualificationType ? gradeTableHTML(L.priorQualificationType === "O/L" ? "ol" : "al", L) : "<p class='small-muted'>Select a qualification above to record grades (optional).</p>"}</div>`;
  }
  return `
    <div class="field" style="max-width:280px"><label>Exam Type</label><select id="f_examType"><option ${L.examType === "Local A/L" ? "selected" : ""}>Local A/L</option><option ${L.examType === "London A/L" ? "selected" : ""}>London A/L</option></select></div>
    ${gradeTableHTML("ol", L)}
    ${gradeTableHTML("al", L)}`;
}

function renderApplyFormBody() {
  const root = document.getElementById("content");
  const L = window.__applyForm;
  const pType = programType(L.program);
  root.innerHTML = `
    <div class="ucl-theme">
      <div class="ucl-hero">
        <div class="ucl-brand">UniConnect CRM · UCL Application Portal</div>
        <h1>${L.id ? "Continue Your Application" : "New Student Application"}</h1>
        <p>${L.id ? "Review and complete your application details below." : "Apply directly online — no counsellor needed to get started."}</p>
      </div>
      <div class="ucl-body">
        <div class="ucl-card">
          <h3>${icon("user")} Personal Information</h3>
          <div class="grid-2">
            <div class="field"><label class="required">Full Name</label><input id="f_name" value="${esc(L.name)}"></div>
            <div class="field"><label class="required">Mobile</label><input id="f_mobile" value="${esc(L.mobile)}"></div>
            <div class="field"><label>Email</label><input id="f_email" value="${esc(L.email)}"></div>
            <div class="field"><label>Country</label><select id="f_country">${picklist('countries').map(c => `<option ${L.country === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
            <div class="field ${L.country === "Sri Lanka" ? "" : "hidden"}" id="wrap_district"><label>District</label><select id="f_district">${picklist('districts').map(d => `<option ${L.district === d ? "selected" : ""}>${d}</option>`).join("")}</select></div>
            <div class="field ${L.country === "Sri Lanka" && L.district === "Other" ? "" : "hidden"}" id="wrap_districtOther"><label>Specify District</label><input id="f_districtOther" value="${esc(L.districtOther || "")}"></div>
          </div>
        </div>

        <div class="ucl-card">
          <h3>${icon("cap")} Educational Qualification</h3>
          <p class="small-muted">Select a university to see the programs it offers.</p>
          <div class="grid-2">
            <div class="field"><label class="required">University</label><select id="f_university"><option value="">-- Select --</option>${picklist('universities').map(u => `<option ${L.university === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
            <div class="field"><label class="required">Program</label><select id="f_program" ${L.university ? "" : "disabled"}><option value="">${L.university ? "-- Select --" : "Select a university first"}</option>${(L.university ? programsForUniversity(L.university) : []).map(p => `<option ${L.program === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
          </div>
          ${L.program ? `<div class="notice info">Required qualification for this program: <b>${pType === "Foundation" ? "O/L or A/L" : pType === "Master's" ? "Bachelor's Degree" : "O/L and A/L"}</b></div>` : ""}
          ${L.program ? applyQualificationFieldsHTML(L, pType) : ""}
        </div>

        <div class="ucl-card">
          <h3>${icon("calendar")} Intake</h3>
          <div class="field"><label class="required">Intake Cycle <span class="ucl-badge-gold">Current &amp; Next Intake only</span></label>
            <select id="f_intake"><option value="">-- Select --</option>${currentAndNextIntakes().map(i => `<option value="${i.id}" ${L.intakeId === i.id ? "selected" : ""}>${i.name}</option>`).join("")}</select>
          </div>
        </div>

        <div style="text-align:right">
          <button class="btn" onclick="submitApplicationForm()">Submit Application →</button>
        </div>
      </div>
    </div>
  `;
  bindApplyFormHandlers();
}

function bindApplyFormHandlers() {
  const L = window.__applyForm;
  const get = id => document.getElementById(id);
  // Every handler syncs all fields from the DOM first, so cascading re-renders (e.g. picking a
  // University rebuilds the Program list) never drop text the applicant already typed elsewhere.
  if (get("f_country")) get("f_country").onchange = () => {
    syncFieldsFromDOM();
    if (L.country !== "Sri Lanka") { L.district = ""; L.districtOther = ""; }
    renderApplyFormBody();
  };
  if (get("f_district")) get("f_district").onchange = () => { syncFieldsFromDOM(); renderApplyFormBody(); };
  if (get("f_university")) get("f_university").onchange = () => { syncFieldsFromDOM(); L.program = ""; renderApplyFormBody(); };
  if (get("f_program")) get("f_program").onchange = () => { syncFieldsFromDOM(); renderApplyFormBody(); };
  if (get("f_priorQualificationType")) get("f_priorQualificationType").onchange = () => { syncFieldsFromDOM(); renderApplyFormBody(); };
  if (get("f_examType")) get("f_examType").onchange = () => { syncFieldsFromDOM(); L.alSubjects = []; L.alResult = ""; renderApplyFormBody(); };
  bindGradeRowHandlers();
}

function submitApplicationForm() {
  syncFieldsFromDOM();
  const L = window.__applyForm;
  if (!L.name || !L.mobile) { toast("Full name and mobile are required.", "error"); return; }
  if (!L.university || !L.program) { toast("Please select a university and program.", "error"); return; }
  if (!L.intakeId) { toast("Please select an intake.", "error"); return; }
  L.olResult = summariseGrades(L.olSubjects);
  L.alResult = summariseGrades(L.alSubjects);
  L.applicationForm = L.applicationForm || defaultApplicationForm();
  L.applicationForm.status = "Submitted";
  if (!L.applicationForm.sentAt) L.applicationForm.sentAt = new Date().toISOString();
  L.applicationForm.submittedAt = new Date().toISOString();

  if (L.id) {
    const existing = DB.leads.find(l => l.id === L.id);
    Object.assign(existing, L);
    addActivity(existing, "Update", "Application form submitted via Apply Online");
    notifySubmissionRecipient(existing);
    logAudit("UPDATE", "Lead:" + existing.id, "Application form submitted via Apply Online");
    saveDB();
    renderApplyThankYou(existing.id, !!existing.assignedTo);
  } else {
    L.id = uid("lead");
    L.createdAt = new Date().toISOString();
    L.checklist = makeChecklist(false);
    L.activity = [{ ts: new Date().toISOString(), user: "System", type: "Create", text: "Application submitted directly via website — no counsellor assigned" }];
    DB.leads.push(L);
    notifySubmissionRecipient(L);
    logAudit("CREATE", "Lead:" + L.id, "New website application submitted, unassigned (Website Lead)");
    saveDB();
    renderApplyThankYou(L.id, false);
  }
}

function renderApplyThankYou(leadId, hasCounsellor) {
  const root = document.getElementById("content");
  root.innerHTML = `
    <div class="ucl-theme">
      <div class="ucl-hero"><div class="ucl-brand">UniConnect CRM · UCL Application Portal</div><h1>Application Submitted</h1></div>
      <div class="ucl-body">
        <div class="ucl-card ucl-thankyou">
          <div class="icon">${icon("checkCircle")}</div>
          <h2>Thank you!</h2>
          <p class="small-muted">Your application has been received. ${hasCounsellor ? "Your counsellor" : "Our admissions team"} will be in touch shortly.</p>
          <div style="margin-top:20px;display:flex;gap:10px;justify-content:center">
            <button class="btn secondary" onclick="go('#/apply')">Submit Another Application</button>
            <button class="btn secondary" onclick="openLeadModal('${leadId}')" title="Internal — view this lead in the CRM">${icon("search")} View Lead (staff)</button>
          </div>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   WEBSITE LEADS — applications submitted directly through the website with no counsellor,
   routed to Head of Marketing for review and counsellor assignment.
   ============================================================ */
function renderWebsiteLeads(root) {
  const leads = visibleLeads().filter(l => l.websiteLead);
  const unassigned = leads.filter(l => !l.assignedTo);
  const assigned = leads.filter(l => l.assignedTo);
  root.innerHTML = `
    <div class="page-header"><div><h1>Website Leads</h1><div class="sub">Applications submitted directly through the website without a counsellor — Head of Marketing review &amp; assignment</div></div></div>
    <div class="notice info">${icon("globe")} These leads bypassed counsellor assignment entirely. Assign a counsellor below to bring each one into the normal pipeline.</div>

    <h3 style="margin:18px 0 8px">Awaiting Assignment <span class="pill">${unassigned.length}</span></h3>
    ${unassigned.length ? `
    <div class="table-wrap card">
    <table><thead><tr><th>Name</th><th>Program</th><th>University</th><th>Submitted</th><th>Assign Counsellor</th></tr></thead>
    <tbody>${unassigned.map(l => `
      <tr>
        <td><a href="javascript:void(0)" onclick="openLeadModal('${l.id}')"><b>${esc(l.name)}</b></a><div class="small-muted">${esc(l.mobile)}</div></td>
        <td>${esc(l.program) || "—"}</td>
        <td>${esc(l.university) || "—"}</td>
        <td>${fmtDateTime(l.applicationForm.submittedAt || l.createdAt)}</td>
        <td>
          <div style="display:flex;gap:8px;align-items:center;white-space:nowrap">
            <select class="wlCounsellorSel" data-id="${l.id}" style="width:180px"><option value="">-- Select --</option>${DB.users.filter(u => u.role === "Counsellor").map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select>
            <button class="btn sm" onclick="assignCounsellorToWebsiteLead('${l.id}')">Assign</button>
          </div>
        </td>
      </tr>`).join("")}</tbody></table>
    </div>` : `<div class="empty-state">No website leads awaiting assignment.</div>`}

    <h3 style="margin:24px 0 8px">Already Assigned <span class="pill">${assigned.length}</span></h3>
    ${assigned.length ? `
    <div class="table-wrap card">
    <table><thead><tr><th>Name</th><th>Program</th><th>Assigned Counsellor</th><th>Stage</th><th></th></tr></thead>
    <tbody>${assigned.map(l => `
      <tr>
        <td><b>${esc(l.name)}</b></td>
        <td>${esc(l.program) || "—"}</td>
        <td>${esc(userName(l.assignedTo))}</td>
        <td>${stageBadge(l.stage)}</td>
        <td><button class="btn sm ghost" onclick="openLeadModal('${l.id}')">Open</button></td>
      </tr>`).join("")}</tbody></table>
    </div>` : `<div class="empty-state">No assigned website leads yet.</div>`}
  `;
}
function assignCounsellorToWebsiteLead(leadId) {
  const sel = document.querySelector(`.wlCounsellorSel[data-id="${leadId}"]`);
  const counsellorId = sel ? sel.value : "";
  if (!counsellorId) { toast("Select a counsellor first.", "warn"); return; }
  const lead = DB.leads.find(l => l.id === leadId);
  lead.assignedTo = counsellorId;
  addActivity(lead, "Assignment", `Assigned to counsellor ${userName(counsellorId)} by ${getCurrentUser().name} (Website Leads)`);
  notify(counsellorId, lead.id, `New website application assigned to you — ${lead.name}`, "New Assignment");
  logAudit("ASSIGN", "Lead:" + lead.id, `Website lead assigned to ${userName(counsellorId)}`);
  saveDB();
  toast(`Assigned to ${userName(counsellorId)}.`, "success");
  renderWebsiteLeads(document.getElementById("content"));
}

/* ---------------- Follow-Up Notes & Task Management (per pipeline stage) ---------------- */
function taskStatusPill(task) {
  const s = taskStatus(task);
  const cls = s === "Overdue" ? "danger" : s === "Due Soon" ? "" : "secondary";
  const color = s === "Overdue" ? "var(--red)" : s === "Due Soon" ? "var(--amber)" : "var(--green)";
  return `<span class="small-muted" style="color:${color};font-weight:600">${s}</span>`;
}
function addStageTask() {
  const L = window.__editingLead;
  const note = document.getElementById("tsk_note").value.trim();
  if (!note) { toast("Enter a note before saving.", "error"); return; }
  const stage = document.getElementById("tsk_stage").value;
  const due = document.getElementById("tsk_due").value; // datetime-local, e.g. 2026-08-21T14:00
  L.tasks = L.tasks || [];
  L.tasks.push({ id: uid("task"), stage, note, dueAt: due || "", done: false, createdAt: new Date().toISOString(), createdBy: getCurrentUser().name });
  addActivity(L, "Note", `Note logged for ${stageLabel(stage)}${due ? ` — follow-up reminder set for ${fmtDateTime(due)}` : ""}`);
  commitLeadEdit();
  if (L.id) toast("Note saved.", "success"); // new leads: persists once "Create Lead" is clicked
  renderLeadModalTab();
}
function removeStageTask(id) {
  const L = window.__editingLead;
  L.tasks = (L.tasks || []).filter(t => t.id !== id);
  commitLeadEdit();
  renderLeadModalTab();
}

// Commits the exam-type switch the inline UC57 - AF1 notice warned about.
function confirmExamTypeChange(newVal) {
  const L = window.__editingLead;
  L.alSubjects = [];
  L.alResult = "";
  L.examType = newVal;
  renderLeadModalTab();
  toast(`Exam type set to ${newVal} — A/L grades cleared.`, "warn");
}

// Shared by the lead modal's Academic tab AND the Apply Online form (Educational Qualification) —
// window.__gradeRowRerender lets whichever page is currently editing window.__editingLead redraw
// itself; it defaults to the lead modal's own tab renderer.
function addGradeRow(kind) {
  syncFieldsFromDOM();
  gradeRows(window.__editingLead, kind).push({ subject: "", grade: "" });
  (window.__gradeRowRerender || renderLeadModalTab)();
}
function removeGradeRow(kind, idx) {
  syncFieldsFromDOM();
  gradeRows(window.__editingLead, kind).splice(idx, 1);
  (window.__gradeRowRerender || renderLeadModalTab)();
}

function syncFieldsFromDOM() {
  const L = window.__editingLead;
  const get = id => document.getElementById(id);
  if (get("f_name")) L.name = get("f_name").value;
  if (get("f_mobile")) L.mobile = get("f_mobile").value;
  if (get("f_email")) L.email = get("f_email").value;
  if (get("f_source")) L.leadSource = get("f_source").value;
  if (get("f_modeOfContact")) L.modeOfContact = get("f_modeOfContact").value;
  if (get("f_digitalSub")) L.digitalSubSource = get("f_digitalSub").value;
  if (get("f_studentId")) L.studentId = get("f_studentId").value;
  if (get("f_staffName")) L.staffName = get("f_staffName").value;
  if (get("f_schoolOrCompany")) L.schoolOrCompany = get("f_schoolOrCompany").value;
  if (get("f_detailedStatus")) L.detailedStatus = get("f_detailedStatus").value;
  if (get("f_university")) L.university = get("f_university").value;
  if (get("f_program")) L.program = get("f_program").value;
  if (get("f_country")) L.country = get("f_country").value;
  if (get("f_previousSchool")) L.previousSchool = get("f_previousSchool").value;
  if (get("f_priorQualificationType")) L.priorQualificationType = get("f_priorQualificationType").value;
  if (get("f_bachelorsDegree")) L.bachelorsDegree = get("f_bachelorsDegree").value;
  if (get("f_bachelorsUniversity")) L.bachelorsUniversity = get("f_bachelorsUniversity").value;
  if (get("f_district")) L.district = get("f_district").value;
  if (get("f_districtOther")) L.districtOther = get("f_districtOther").value;
  if (get("f_intake")) L.intakeId = get("f_intake").value;
  if (get("f_assigned") && !get("f_assigned").disabled) L.assignedTo = get("f_assigned").value;
  if (get("f_domain")) L.domain = get("f_domain").value;
  if (get("f_isReferral")) L.isReferral = get("f_isReferral").checked;
  if (get("f_referralType")) L.referralType = get("f_referralType").value;
  if (get("f_lossReason")) L.lossReason = get("f_lossReason").value;
  if (get("f_examType")) L.examType = get("f_examType").value;
  // Structured academic rows → read live inputs, then derive the roll-up summaries (UC55)
  document.querySelectorAll(".gradeSubject").forEach(el => {
    const r = gradeRows(L, el.dataset.kind)[+el.dataset.idx];
    if (r) r.subject = el.value;
  });
  document.querySelectorAll(".gradeValue").forEach(el => {
    const r = gradeRows(L, el.dataset.kind)[+el.dataset.idx];
    if (r) r.grade = el.value;
  });
  L.olResult = summariseGrades(L.olSubjects);
  L.alResult = summariseGrades(L.alSubjects);
  if (get("f_langTest")) L.languageTest = get("f_langTest").value;
  if (get("f_langScore")) L.languageScore = get("f_langScore").value;
  if (get("f_pending")) L.resultsPending = get("f_pending").checked;
}

function exportLeadTimeline() {
  const L = window.__editingLead;
  const rows = [["Timestamp", "Type", "User", "Details"], ...(L.activity || []).map(a => [fmtDateTime(a.ts), a.type, a.user, a.text])];
  downloadCSV(`timeline_${(L.name || "lead").replace(/\s+/g, "_")}.csv`, rows);
  logAudit("EXPORT", "Lead:" + L.id, "Timeline exported as CSV (UC67)");
}
// UC67 - AF1: "User can export the timeline as PDF for external review."
function exportLeadTimelinePDF() {
  const L = window.__editingLead;
  const summary = `<table>
    <tbody>
      <tr><th style="width:22%">Lead</th><td>${esc(L.name)}</td><th style="width:22%">Stage</th><td>${esc(stageLabel(L.stage))}</td></tr>
      <tr><th>Mobile</th><td>${esc(L.mobile)}</td><th>Email</th><td>${esc(L.email) || "—"}</td></tr>
      <tr><th>University</th><td>${esc(L.university) || "—"}</td><th>Program</th><td>${esc(L.program) || "—"}</td></tr>
      <tr><th>Source</th><td>${esc(L.leadSource)}${L.leadSource === "Student Referral" && L.studentId ? " — " + esc(L.studentId) : ""}${L.leadSource === "Staff Referral" && L.staffName ? " — " + esc(L.staffName) : ""}</td><th>Assigned To</th><td>${esc(userName(L.assignedTo))}</td></tr>
      <tr><th>Mode of Contact</th><td>${esc(L.modeOfContact) || "—"}</td><th></th><td></td></tr>
      <tr><th>Intake</th><td>${esc((DB.intakes.find(i => i.id === L.intakeId) || {}).name || "—")}</td><th>Created</th><td>${fmtDate(L.createdAt)}</td></tr>
    </tbody></table>`;
  const gradeSection = (label, rows) => (rows && rows.length)
    ? `<h3>${label}</h3>${rowsToTableHTML([["Subject", "Grade"], ...rows.map(r => [r.subject, r.grade])])}`
    : "";
  const academics = L.resultsPending
    ? `<h3>Academic Results</h3><p class="small-muted">⏳ Results Pending — mandatory validation relaxed (UC56).</p>`
    : gradeSection("O/L Results", L.olSubjects) + gradeSection(`A/L Results (${esc(L.examType)})`, L.alSubjects);

  const rows = [["Timestamp", "Type", "User", "Details"], ...(L.activity || []).map(a => [fmtDateTime(a.ts), a.type, a.user, a.text])];
  const html = `<h3>Lead Summary</h3>${summary}
    ${academics}
    <h3>Interaction Timeline (${(L.activity || []).length} entries)</h3>${rowsToTableHTML(rows)}`;
  if (printToPDF({ title: "Lead Timeline — " + L.name, subtitle: "Complete interaction history (UC66 / UC67)", html, orientation: "portrait" })) {
    logAudit("EXPORT_PDF", "Lead:" + L.id, "Timeline exported as PDF for external review (UC67 - AF1)");
    saveDB();
    toast("Opening print dialog — choose “Save as PDF”.", "success");
  }
}

// UC60 — matching rules are admin-configurable (Admin → Fields & Picklists)
function checkDuplicate(L) {
  const r = DB.duplicateRules || { matchMobile: true, matchEmail: true, matchName: false };
  const norm = s => String(s || "").trim().toLowerCase();
  return DB.leads.find(x => {
    if (x.id === L.id) return false;
    if (r.matchMobile && L.mobile && norm(x.mobile) === norm(L.mobile)) return true;
    if (r.matchEmail && L.email && norm(x.email) === norm(L.email)) return true;
    if (r.matchName && L.name && norm(x.name) === norm(L.name)) return true;
    return false;
  });
}

function saveLeadModal() {
  syncFieldsFromDOM();
  const L = window.__editingLead;
  if (!L.name || !L.mobile) { toast("Name and Mobile are required.", "error"); return; }
  if (L.leadSource === "Student Referral" && !L.studentId) { toast("Student ID is required when Lead Source = Student Referral (UC21 - AF2).", "error"); return; }
  if (L.leadSource === "Staff Referral" && !L.staffName) { toast("Staff Name is required when Lead Source = Staff Referral (UC22 - AF1).", "error"); return; }
  if (L.district === "Other" && !L.districtOther) { toast("Please specify the district (UC58 - AF1).", "error"); return; }

  const dup = checkDuplicate(L);
  if (dup && !L.__dupConfirmed) {
    document.getElementById("leadValidationNotice").innerHTML = `
      <div class="notice error">${icon("warn")} Possible duplicate lead detected (UC60): <b>${esc(dup.name)}</b> (${esc(dup.mobile)}).
      <div style="margin-top:8px"><button class="btn sm danger" onclick="window.__editingLead.__dupConfirmed=true;saveLeadModal();">Create Anyway</button>
      <button class="btn sm secondary" onclick="closeModal()">Abort</button></div></div>`;
    return;
  }

  // Transient UI flag — must not be persisted onto the record, or the lead carries it
  // forever and its duplicate check is permanently suppressed.
  delete L.__dupConfirmed;

  if (!L.id) {
    L.id = uid("lead");
    L.createdAt = new Date().toISOString();
    L.checklist = L.checklist || makeChecklist();
    L.commissionStatus = "Pending";
    L.activity = [{ ts: new Date().toISOString(), user: getCurrentUser().name, type: "Create", text: `Lead created via ${L.leadSource}` }];
    DB.leads.push(L);
    logAudit("CREATE", "Lead:" + L.id, "New lead created");
    toast("Lead created.", "success");
  } else {
    const existing = DB.leads.find(l => l.id === L.id);
    Object.assign(existing, L);
    addActivity(existing, "Update", "Lead details updated");
    logAudit("UPDATE", "Lead:" + L.id, "Lead details updated");
    toast("Lead updated.", "success");
  }
  saveDB();
  closeModal();
  router();
}

// The single stage-transition rulebook, shared by the lead modal's "Move to X" buttons
// and by Kanban drag-and-drop. Returns null when the move is allowed, otherwise the
// message to show. Previously the Kanban path re-implemented only three of these four
// gates and silently skipped the UC54 checklist rule the modal enforced.
// Check order is significant — it determines which message the user sees first.
function stageChangeBlockReason(lead, newStage) {
  if (!allowedNextStages(lead.stage).includes(newStage)) {
    return `Blocked: ${stageLabel(lead.stage)} → ${stageLabel(newStage)} is not a permitted transition (UC37/UC38).`;
  }
  const { ok, missing } = isMandatoryMet(lead, newStage);
  if (!ok) return `Blocked (UC59): missing ${missing.join(", ")}`;
  if (newStage === "Converted" && lead.resultsPending) {
    return "Blocked: results pending, cannot move to Converted (UC56).";
  }
  const incompleteChecklist = (lead.checklist || []).some(i => !i.done);
  if (lead.stage === "Open" && newStage === "Qualified" && incompleteChecklist) {
    return "Blocked (UC54): complete the qualification checklist first.";
  }
  return null;
}

function attemptStageChange(newStage) {
  syncFieldsFromDOM();
  const L = window.__editingLead;
  const blocked = stageChangeBlockReason(L, newStage);
  if (blocked) { toast(blocked, "error"); return; }
  const fromStage = L.stage;
  L.stage = newStage;
  addActivity(L, "Stage Change", `Moved from ${stageLabel(fromStage)} to ${stageLabel(newStage)}`);
  if (newStage === "Converted") {
    runConversionAutomation(L);
    L.commissionStatus = "Eligible";
  }
  const existing = DB.leads.find(l => l.id === L.id);
  if (existing) { Object.assign(existing, L); } else { DB.leads.push(L); }
  logAudit("STAGE_CHANGE", "Lead:" + L.id, `${fromStage} → ${newStage} (UC81 before/after)`);
  saveDB();
  toast(`Lead moved to ${stageLabel(newStage)}.`, "success");
  renderLeadModal();
}

/* UC35 — auto confirmation email on conversion; UC36 — auto-attach program handbook.
   AF1 (UC36): if no handbook exists for the program, send anyway and log a warning. */
function runConversionAutomation(lead) {
  if (!lead.email) {
    addActivity(lead, "Automation", "Warning: conversion email NOT sent — no email address on file (UC35 - AF1). Counsellor alerted to send manually.");
    toast("Conversion email failed: no email address on file (UC35 - AF1).", "warn");
    logAudit("EMAIL_FAILED", "Lead:" + lead.id, "No email address");
    return;
  }
  const handbook = handbookFor(lead.program);
  if (handbook) {
    addActivity(lead, "Automation", `Confirmation email sent to ${lead.email} (UC35) — attached "${handbook}" for ${lead.program} (UC36)`);
    toast(`Confirmation email sent to ${lead.email} with ${handbook} attached.`, "success");
    logAudit("EMAIL_SENT", "Lead:" + lead.id, `Conversion email + handbook ${handbook}`);
  } else {
    addActivity(lead, "Automation", `Confirmation email sent to ${lead.email} (UC35) — ${icon("warn")} no handbook on file for "${lead.program || "unset program"}", sent without attachment (UC36 - AF1)`);
    toast(`Email sent — no handbook found for ${lead.program || "this program"} (UC36 - AF1).`, "warn");
    logAudit("EMAIL_SENT", "Lead:" + lead.id, `Conversion email sent WITHOUT handbook (none configured for ${lead.program})`);
  }
}

function attemptDeactivate() {
  syncFieldsFromDOM(); // preserve in-progress edits across the modal swap
  const L = window.__editingLead;
  const minDays = DB.deactivationMinDays || 3;
  const canOverride = ["Manager", "Admin", "Head of Marketing", "CEO"].includes(currentRole());
  if (daysAgo(L.createdAt) < minDays && !canOverride) {
    toast(`Blocked (UC41): lead must be at least ${minDays} day(s) old before deactivation. Ask a Manager to override.`, "error");
    return;
  }
  renderDeactivateReasonModal();
}

// Replaces the lead modal in #modalRoot rather than stacking on top of it (openModal
// only supports one). window.__editingLead is untouched, so "Back" re-renders the lead
// modal with every in-progress edit intact.
function renderDeactivateReasonModal() {
  const L = window.__editingLead;
  const minDays = DB.deactivationMinDays || 3;
  const isOverride = daysAgo(L.createdAt) < minDays;
  openModal(`
    <div class="modal-header"><h2>Deactivate ${esc(L.name)}</h2>
      <button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      ${isOverride ? `<div class="notice">${icon("warn")} This lead is only ${daysAgo(L.createdAt)} day(s) old — below the ${minDays}-day minimum. Deactivating records a manager override (UC41 - AF1).</div>` : ""}
      <p class="small-muted">The lead moves to Closed and drops out of the active pipeline. Record why, for the audit log (UC39/UC41).</p>
      <div class="field"><label class="required">Deactivation reason</label>
        <input id="deact_reason" placeholder="e.g. Unreachable after 6 attempts"
          oninput="document.getElementById('deactGo').disabled = !this.value.trim()"></div>
    </div>
    <div class="modal-footer">
      <button class="btn secondary" onclick="renderLeadModal()">← Back</button>
      <button class="btn danger" id="deactGo" disabled onclick="confirmDeactivate()">Deactivate Lead</button>
    </div>
  `, { width: 560 });
}

function confirmDeactivate() {
  const L = window.__editingLead;
  const reason = document.getElementById("deact_reason").value.trim();
  if (!reason) return;
  const minDays = DB.deactivationMinDays || 3;
  if (daysAgo(L.createdAt) < minDays) {
    addActivity(L, "Override", `Manager override of deactivation criteria (UC41 AF1) — lead only ${daysAgo(L.createdAt)}d old`);
  }
  L.deactivated = true;
  L.deactivationReason = reason;
  L.stage = L.stage === "Converted" ? L.stage : "Closed";
  addActivity(L, "Deactivation", reason);
  const existing = DB.leads.find(l => l.id === L.id);
  Object.assign(existing, L);
  logAudit("DEACTIVATE", "Lead:" + L.id, reason);
  saveDB();
  toast("Lead deactivated.", "success");
  closeModal();
  router();
}

/* ============================================================
   PIPELINE (Kanban) — UC61
   ============================================================ */
function renderPipeline(root) {
  const leads = visibleLeads().filter(l => !l.deactivated);
  root.innerHTML = `
    <div class="page-header">
      <div><h1>Master Pipeline</h1><div class="sub">Visual Kanban — drag cards between stages (UC61)</div></div>
      <select id="pipelineProgramFilter" title="Program-wise pipeline summary (UC63)"><option value="">All Programs — UC63</option>${picklist('programs').map(p => `<option ${state.pipelineFilter.program === p ? "selected" : ""}>${p}</option>`).join("")}</select>
    </div>
    <div class="kanban" id="kanbanBoard"></div>
    <div class="legend">${stages().map(s => `<span><i style="background:${stageColor(s)}"></i>${esc(stageLabel(s))}</span>`).join("")}</div>
    <div class="card" style="margin-top:16px">
      <h3>Pipeline Summary Counts <span class="pill">UC62</span></h3>
      <div id="pipelineSummaryBars"></div>
    </div>
  `;
  document.getElementById("pipelineProgramFilter").onchange = e => { state.pipelineFilter.program = e.target.value; renderKanbanBoard(); renderPipelineSummaryBars(); };
  renderKanbanBoard();
  renderPipelineSummaryBars();
}
function renderPipelineSummaryBars() {
  const el = document.getElementById("pipelineSummaryBars");
  if (!el) return;
  let leads = visibleLeads().filter(l => !l.deactivated);
  if (state.pipelineFilter.program) leads = leads.filter(l => l.program === state.pipelineFilter.program);
  el.innerHTML = simpleBarChart(stages().map(s => ({ label: stageLabel(s), value: leads.filter(l => l.stage === s).length, color: stageColor(s) })));
}
function renderKanbanBoard() {
  const board = document.getElementById("kanbanBoard");
  let leads = visibleLeads().filter(l => !l.deactivated);
  if (state.pipelineFilter.program) leads = leads.filter(l => l.program === state.pipelineFilter.program);

  board.innerHTML = stages().map(stage => {
    const stageLeads = leads.filter(l => l.stage === stage);
    return `<div class="kanban-col" data-stage="${stage}" ondragover="kanbanDragOver(event,'${stage}')" ondragleave="kanbanDragLeave(event)" ondrop="handleKanbanDrop(event,'${stage}')">
      <h4>${esc(stageLabel(stage))} <span>${stageLeads.length}</span></h4>
      <div class="kanban-col-blocked-hint">Not a permitted move</div>
      ${stageLeads.map(l => `
        <div class="kanban-card" draggable="true" ondragstart="kanbanDragStart(event,'${l.id}')" ondragend="kanbanDragEnd()" onclick="openLeadModal('${l.id}')">
          <div class="name">${esc(l.name)}</div>
          <div class="meta">${esc(l.program) || "No program"} · ${esc(userName(l.assignedTo))}</div>
        </div>`).join("") || `<div class="small-muted" style="padding:10px 0">No leads</div>`}
    </div>`;
  }).join("");
}

/* Drag lifecycle. Two problems this solves:
   1. Flicker — dragleave used to fire whenever the pointer crossed onto a child card,
      so the drop highlight strobed while dragging across a valid column. Marking the
      board `.dragging` makes cards pointer-events:none, leaving the column as the only
      hit-test target.
   2. No pre-drop feedback — every column highlighted as droppable even when the move
      would be rejected. dataTransfer is unreadable during dragover, so the dragged id
      is stashed on window to evaluate the same rulebook the drop will apply. */
function kanbanDragStart(ev, leadId) {
  window.__kanbanDragId = leadId;
  ev.dataTransfer.setData("text/plain", leadId);
  ev.dataTransfer.effectAllowed = "move";
  const board = document.getElementById("kanbanBoard");
  if (board) board.classList.add("dragging");
  ev.currentTarget.classList.add("dragging-card");
}
function kanbanDragOver(ev, stage) {
  ev.preventDefault();
  const lead = visibleLeads().find(l => l.id === window.__kanbanDragId);
  const blocked = lead && lead.stage !== stage && stageChangeBlockReason(lead, stage);
  ev.dataTransfer.dropEffect = blocked ? "none" : "move";
  ev.currentTarget.classList.toggle("dragover", !blocked);
  ev.currentTarget.classList.toggle("dragover-blocked", !!blocked);
}
function kanbanDragLeave(ev) {
  ev.currentTarget.classList.remove("dragover", "dragover-blocked");
}
// Also runs on a cancelled drag (Esc / released outside a column), which previously
// left the last-hovered column stuck in its highlighted state.
function kanbanDragEnd() {
  window.__kanbanDragId = null;
  const board = document.getElementById("kanbanBoard");
  if (board) board.classList.remove("dragging");
  document.querySelectorAll(".kanban-card.dragging-card").forEach(c => c.classList.remove("dragging-card"));
  document.querySelectorAll(".kanban-col").forEach(c => c.classList.remove("dragover", "dragover-blocked"));
}
function handleKanbanDrop(ev, targetStage) {
  ev.preventDefault();
  kanbanDragEnd();
  const id = ev.dataTransfer.getData("text/plain");
  // visibleLeads(), not DB.leads — a lead outside this role's row-level scope must not
  // be movable even if its id somehow reaches the drop handler.
  const lead = visibleLeads().find(l => l.id === id);
  if (!lead) return;
  if (lead.stage === targetStage) return;
  const blocked = stageChangeBlockReason(lead, targetStage);
  if (blocked) { toast(blocked, "error"); return; }
  const fromStage = lead.stage;
  lead.stage = targetStage;
  addActivity(lead, "Stage Change", `Moved from ${stageLabel(fromStage)} to ${stageLabel(targetStage)} via Kanban drag-and-drop`);
  if (targetStage === "Converted") {
    lead.commissionStatus = "Eligible";
    runConversionAutomation(lead);
  }
  logAudit("STAGE_CHANGE", "Lead:" + lead.id, `${fromStage} → ${targetStage} (kanban, UC81 before/after)`);
  saveDB();
  toast(`Lead moved to ${stageLabel(targetStage)}.`, "success");
  renderKanbanBoard();
  renderPipelineSummaryBars();
}

/* ============================================================
   FOLLOW-UPS — UC31 / UC65 / UC42
   ============================================================ */
function renderFollowups(root) {
  const leads = visibleLeads().filter(l => !l.deactivated && l.stage !== "Closed" && l.nextFollowUp);
  const tasks = leads.map(l => ({
    lead: l, dueDays: followUpDaysUntilDue(l), status: followUpStatus(l)
  })).sort((a, b) => a.dueDays - b.dueDays);

  const escalations = leads.filter(l => escalationReason(l));

  // Follow-Up Notes & Task Management — per-stage tasks with a due date/time, surfaced here as reminders
  const openTasks = allOpenTasks(visibleLeads().filter(l => !l.deactivated)).filter(r => r.task.dueAt)
    .sort((a, b) => new Date(a.task.dueAt) - new Date(b.task.dueAt));

  root.innerHTML = `
    <div class="page-header"><div><h1>Follow-Up Tracker</h1><div class="sub">Centralised list of pending tasks (UC31/UC65)</div></div></div>

    <div class="card" style="border-left:3px solid var(--amber);">
      <h3>${icon("bell")} Stage Notes &amp; Task Reminders <span class="pill">per-stage notes/tasks</span></h3>
      ${openTasks.length ? `
        <div class="table-wrap wide"><table><thead><tr><th>Lead</th><th>Stage</th><th>Note / Task</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody>${openTasks.map(({ lead, task }) => `
          <tr>
            <td><b>${esc(lead.name)}</b></td>
            <td>${stageBadge(task.stage)}</td>
            <td>${esc(task.note)}</td>
            <td>${fmtDateTime(task.dueAt)}</td>
            <td>${taskStatusPill(task)}</td>
            <td><button class="btn sm ghost" onclick="openLeadModal('${lead.id}')">Open</button></td>
          </tr>`).join("")}</tbody></table></div>
      ` : `<div class="empty-state">No pending stage tasks with a reminder date.</div>`}
    </div>

    <div class="card" style="border-left:3px solid var(--red);">
      <h3>${icon("warn")} Escalations <span class="pill">UC32 / UC33 / UC34</span></h3>
      ${escalations.length ? `
        <div class="table-wrap wide"><table><thead><tr><th>Lead</th><th>Assigned To</th><th>Reason</th><th>Escalation Chain</th><th></th></tr></thead>
        <tbody>${escalations.map(l => {
          const owner = DB.users.find(u => u.id === l.assignedTo);
          const manager = owner ? DB.users.find(u => u.id === owner.managerId) : null;
          const hod = manager ? DB.users.find(u => u.id === manager.managerId) : null;
          return `<tr>
            <td><b>${esc(l.name)}</b></td>
            <td>${esc(userName(l.assignedTo))}</td>
            <td><span class="badge blocked">${esc(escalationReason(l))}</span></td>
            <td class="small-muted">${esc(manager ? manager.name : "—")}${l.escalated ? ` → <b>${esc(hod ? hod.name : "Head of Dept.")}</b>` : ""}</td>
            <td>${l.escalated
              ? `<span class="badge closed">Escalated to Head of Dept.</span>`
              : `<button class="btn sm danger" onclick="escalateLead('${l.id}')">Escalate Now</button>`}</td>
          </tr>`;
        }).join("")}</tbody></table></div>
      ` : `<div class="empty-state">No SLA breaches right now — everything is on track.</div>`}
    </div>

    <div class="chip-row">
      <div class="chip ${state.fuFilter === undefined || state.fuFilter === "all" ? "active" : ""}" onclick="state.fuFilter='all';renderFollowups(document.getElementById('content'))">All (${tasks.length})</div>
      <div class="chip ${state.fuFilter === "Overdue" ? "active" : ""}" onclick="state.fuFilter='Overdue';renderFollowups(document.getElementById('content'))">Overdue (${tasks.filter(t => t.status === "Overdue").length})</div>
      <div class="chip ${state.fuFilter === "Today" ? "active" : ""}" onclick="state.fuFilter='Today';renderFollowups(document.getElementById('content'))">Due Today (${tasks.filter(t => t.status === "Today").length})</div>
      <div class="chip ${state.fuFilter === "Upcoming" ? "active" : ""}" onclick="state.fuFilter='Upcoming';renderFollowups(document.getElementById('content'))">Upcoming (${tasks.filter(t => t.status === "Upcoming").length})</div>
    </div>
    <div class="table-wrap card">
    <table><thead><tr><th>Lead</th><th>Assigned To</th><th>Stage</th><th>Due Date</th><th>Status</th><th></th></tr></thead>
    <tbody>
      ${tasks.filter(t => !state.fuFilter || state.fuFilter === "all" || t.status === state.fuFilter).map(t => `
        <tr>
          <td><b>${esc(t.lead.name)}</b><div class="small-muted">${esc(t.lead.mobile)}</div></td>
          <td>${esc(userName(t.lead.assignedTo))}</td>
          <td>${stageBadge(t.lead.stage)}</td>
          <td>${fmtDate(t.lead.nextFollowUp)}<div class="small-muted">${t.dueDays < 0 ? Math.abs(t.dueDays) + "d overdue" : t.dueDays === 0 ? "due today" : "in " + t.dueDays + "d"}</div></td>
          <td><span class="badge ${t.status === "Overdue" ? "closed" : t.status === "Today" ? "qualified" : "open"}">${t.status}</span></td>
          <td style="white-space:nowrap"><button class="btn sm secondary" onclick="quickFollowUp('${t.lead.id}')">Complete</button> <button class="btn sm ghost" onclick="openRescheduleModal('${t.lead.id}')" title="UC31 - AF1">Reschedule</button></td>
        </tr>`).join("") || `<tr><td colspan="6" class="empty-state">No pending follow-ups.</td></tr>`}
    </tbody></table>
    </div>
  `;
}
function escalateLead(leadId) {
  const lead = DB.leads.find(l => l.id === leadId);
  const owner = DB.users.find(u => u.id === lead.assignedTo);
  const manager = owner ? DB.users.find(u => u.id === owner.managerId) : null;
  const hod = manager ? DB.users.find(u => u.id === manager.managerId) : null;
  lead.escalated = true;
  const reason = escalationReason(lead) || "SLA breach";
  // UC32/UC33 → notify the direct manager; UC34 → chain continues to Head of Dept.
  if (manager) notify(manager.id, lead.id, `${reason} — lead "${lead.name}" (owner: ${owner ? owner.name : "?"})`, "Escalation");
  if (hod) notify(hod.id, lead.id, `Unresolved escalation for "${lead.name}" — escalated past ${manager ? manager.name : "manager"} (UC34)`, "Escalation");
  addActivity(lead, "Escalation", `${reason} — notified ${manager ? manager.name : "manager"}${hod ? `, then escalated to ${hod.name} (Head of Dept., UC34)` : ""}`);
  logAudit("ESCALATE", "Lead:" + leadId, reason);
  saveDB();
  toast(`Escalated: ${manager ? manager.name : "Manager"} notified${hod ? ", chain continues to " + hod.name : ""}.`, "warn");
  renderNotificationBell();
  renderFollowups(document.getElementById("content"));
}
function quickFollowUp(leadId) {
  const lead = DB.leads.find(l => l.id === leadId);
  const wasDue = lead.nextFollowUp;
  const next = completeFollowUp(lead, slaRules().followUpIntervalDays);
  const onTime = todayStr() <= wasDue;
  addActivity(lead, "Follow-Up", `Follow-up completed (due ${wasDue}, ${onTime ? "on time" : "late"}) — next scheduled ${next} (UC31)`);
  logAudit("FOLLOWUP", "Lead:" + leadId, `Completed (due ${wasDue}, ${onTime ? "on time" : "LATE"}), next due ${next}`);
  saveDB();
  toast(`Follow-up completed${onTime ? "" : " (late)"}. Next due ${fmtDate(next)}.`, onTime ? "success" : "warn");
  renderFollowups(document.getElementById("content"));
}
function openRescheduleModal(leadId) {
  const lead = DB.leads.find(l => l.id === leadId);
  openModal(`
    <div class="modal-header"><h2>Reschedule Follow-Up <span class="pill">UC31 - AF1</span></h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p class="small-muted"><b>${esc(lead.name)}</b> — currently due ${fmtDate(lead.nextFollowUp)}.</p>
      <div class="field"><label>New Due Date</label><input type="date" id="fu_date" value="${lead.nextFollowUp}"></div>
      <div class="chip-row">
        <div class="chip" onclick="document.getElementById('fu_date').value='${addDaysStr(todayStr(), 0)}'">Today</div>
        <div class="chip" onclick="document.getElementById('fu_date').value='${addDaysStr(todayStr(), 1)}'">Tomorrow</div>
        <div class="chip" onclick="document.getElementById('fu_date').value='${addDaysStr(todayStr(), 3)}'">In 3 days</div>
        <div class="chip" onclick="document.getElementById('fu_date').value='${addDaysStr(todayStr(), 7)}'">Next week</div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveReschedule('${leadId}')">Reschedule</button></div>
  `);
}
function saveReschedule(leadId) {
  const lead = DB.leads.find(l => l.id === leadId);
  const val = document.getElementById("fu_date").value;
  if (!val) { toast("Pick a date.", "error"); return; }
  const old = lead.nextFollowUp;
  lead.nextFollowUp = val;
  addActivity(lead, "Follow-Up", `Rescheduled from ${old} to ${val} (UC31 - AF1)`);
  logAudit("RESCHEDULE", "Lead:" + leadId, `${old} → ${val}`);
  saveDB();
  closeModal();
  toast(`Follow-up rescheduled to ${fmtDate(val)}.`, "success");
  renderFollowups(document.getElementById("content"));
}

/* ============================================================
   INQUIRIES — UC50 / UC51
   ============================================================ */
function renderInquiries(root) {
  const inquiries = DB.inquiries;
  root.innerHTML = `
    <div class="page-header">
      <div><h1>Inquiries (Suspects)</h1><div class="sub">Pre-lead prospect history (UC50)</div></div>
      <button class="btn" onclick="openNewInquiryModal()">+ New Inquiry</button>
    </div>
    <div class="widget-grid">
      <div class="stat-card"><div class="label">Total Inquiries</div><div class="value">${inquiries.length}</div></div>
      <div class="stat-card"><div class="label">Converted to Lead</div><div class="value">${inquiries.filter(i => i.convertedToLead).length}</div></div>
      <div class="stat-card"><div class="label">Conversion Rate</div><div class="value">${inquiries.length ? ((inquiries.filter(i => i.convertedToLead).length / inquiries.length) * 100).toFixed(1) : 0}%</div></div>
    </div>
    <div class="table-wrap card">
    <table><thead><tr><th>Name</th><th>Contact</th><th>Program</th><th>Source</th><th>Date</th><th>Status</th><th></th></tr></thead>
    <tbody>${inquiries.map(i => `
      <tr>
        <td><b>${esc(i.name)}</b></td>
        <td>${esc(i.mobile)}<div class="small-muted">${esc(i.email)}</div></td>
        <td>${esc(i.program)}</td>
        <td>${esc(i.source)}</td>
        <td>${fmtDate(i.createdAt)}</td>
        <td>${i.convertedToLead ? "<span class='badge converted'>Converted</span>" : "<span class='badge open'>Inquiry</span>"}</td>
        <td>${!i.convertedToLead ? `<button class="btn sm secondary" onclick="convertInquiry('${i.id}')">Convert to Lead</button>` : ""}</td>
      </tr>`).join("")}</tbody></table>
    </div>
  `;
}
function openNewInquiryModal() {
  openModal(`
    <div class="modal-header"><h2>New Inquiry</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label class="required">Name</label><input id="inq_name"></div>
      <div class="field"><label class="required">Mobile</label><input id="inq_mobile"></div>
      <div class="field"><label>Email</label><input id="inq_email"></div>
      <div class="field"><label>Interested Program</label><select id="inq_program">${picklist('programs').map(p => `<option>${p}</option>`).join("")}</select></div>
      <div class="field"><label>Source</label><select id="inq_source"><option>Exhibition</option><option>Website</option><option>Walk-in</option><option>Referral</option></select></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveNewInquiry()">Save</button></div>
  `);
}
function saveNewInquiry() {
  const name = document.getElementById("inq_name").value.trim();
  const mobile = document.getElementById("inq_mobile").value.trim();
  if (!name || !mobile) { toast("Name and mobile required.", "error"); return; }
  DB.inquiries.push({
    id: uid("inq"), name, mobile, email: document.getElementById("inq_email").value.trim(),
    program: document.getElementById("inq_program").value, source: document.getElementById("inq_source").value,
    createdAt: new Date().toISOString(), convertedToLead: false
  });
  logAudit("CREATE", "Inquiry", `New inquiry: ${name}`);
  saveDB();
  closeModal();
  toast("Inquiry logged.", "success");
  renderInquiries(document.getElementById("content"));
}
function convertInquiry(id) {
  const inq = DB.inquiries.find(i => i.id === id);
  inq.convertedToLead = true;
  const lead = {
    id: uid("lead"), name: inq.name, mobile: inq.mobile, email: inq.email, leadSource: "Walk-in", modeOfContact: "", studentId: "", staffName: "",
    university: "", program: inq.program, country: "Sri Lanka", district: "Other", previousSchool: "", priorQualificationType: "", bachelorsDegree: "", bachelorsUniversity: "",
    examType: "Local A/L", resultsPending: true,
    olResult: "", alResult: "", languageTest: "None", languageScore: "", stage: "Open", deactivated: false,
    deactivationReason: "", lossReason: "", assignedTo: rand(DB.users.filter(u => u.role === "Counsellor").map(u => u.id)),
    intakeId: "", domain: rand(picklist('domains')), isReferral: false, referralType: "", agentId: "",
    checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
    applicationForm: defaultApplicationForm(), tasks: [],
    createdAt: new Date().toISOString(), activity: [{ ts: new Date().toISOString(), user: getCurrentUser().name, type: "Convert", text: "Converted from Inquiry" }]
  };
  DB.leads.push(lead);
  logAudit("CONVERT", "Inquiry:" + id, "Converted to lead");
  saveDB();
  toast("Inquiry converted to lead.", "success");
  renderInquiries(document.getElementById("content"));
}

/* ============================================================
   COMMISSION — M4
   ============================================================ */
function renderCommission(root) {
  const showAmounts = canViewAmounts();
  const tabs = [["plans", "Commission Plans"], ["eligibility", "Eligibility & Status"], ["targets", "Counsellor Targets"], ["reports", "Report Workflow"]];

  root.innerHTML = `
    <div class="page-header">
      <div><h1>Commission &amp; Payment Engine</h1><div class="sub">${showAmounts ? "Full financial view" : "Metrics-only view (amounts masked — UC20 / UC79)"}</div></div>
    </div>
    <div class="tabs">${tabs.map(([k, l]) => `<div class="tab ${state.commissionTab === k ? "active" : ""}" data-k="${k}">${l}</div>`).join("")}</div>
    <div id="commissionBody"></div>
  `;
  document.querySelectorAll(".tabs .tab").forEach(t => t.onclick = () => { state.commissionTab = t.dataset.k; renderCommission(root); });
  renderCommissionBody();
}

function renderCommissionBody() {
  const body = document.getElementById("commissionBody");
  if (!body) return;
  const tab = state.commissionTab;
  const showAmounts = canViewAmounts();
  const leads = DB.leads.filter(l => l.stage === "Converted" && !l.deactivated);

  if (tab === "plans") {
    const plans = DB.commissionPlans;
    body.innerHTML = `
      <div class="page-header" style="margin-bottom:12px">
        <div class="small-muted">Percentage, fixed-amount, tiered-slab and referral commission rules (UC1 / UC2 / UC4 / UC5)</div>
        ${["Commission Admin", "Admin"].includes(currentRole()) ? `<button class="btn sm" onclick="openCommissionPlanModal()">+ New Plan</button>` : ""}
      </div>
      <div class="card">
        <div class="table-wrap"><table><thead><tr><th>University</th><th>Type</th><th>Value</th><th>Effective</th><th>Status</th>${["Commission Admin", "Admin"].includes(currentRole()) ? "<th></th>" : ""}</tr></thead>
          <tbody>${plans.map(p => `<tr>
            <td>${esc(p.university)}</td><td>${esc(p.type)}</td><td>${planValueLabel(p)}</td>
            <td>${fmtDate(p.from)} - ${fmtDate(p.to)}</td>
            <td><span class="badge ${p.status === "Active" ? "eligible" : "closed"}">${esc(p.status)}</span></td>
            ${["Commission Admin", "Admin"].includes(currentRole()) ? `<td style="white-space:nowrap"><button class="btn sm ghost" onclick="openCommissionPlanModal('${p.id}')">Edit</button> ${p.status === "Active" ? `<button class="btn sm secondary" onclick="togglePlanStatus('${p.id}')">Deactivate</button>` : `<button class="btn sm secondary" onclick="togglePlanStatus('${p.id}')">Reactivate</button>`}</td>` : ""}
          </tr>`).join("")}</tbody>
        </table></div>
        <p class="small-muted" style="margin-top:10px">Plans are operational data — editing status takes effect immediately for new calculations (UC5), with full version history in the Audit Log.</p>
      </div>`;
  }

  if (tab === "eligibility") {
    body.innerHTML = `
      <div class="widget-grid">
        <div class="stat-card"><div class="label">Converted Leads</div><div class="value">${leads.length}</div></div>
        <div class="stat-card"><div class="label">Eligible</div><div class="value">${leads.filter(l => l.commissionStatus === "Eligible").length}</div></div>
        <div class="stat-card"><div class="label">Blocked / Expired</div><div class="value">${leads.filter(l => l.commissionStatus === "Blocked").length}</div></div>
        <div class="stat-card"><div class="label">Paid</div><div class="value">${leads.filter(l => l.commissionStatus === "Paid").length}</div></div>
      </div>
      <div class="page-header" style="margin-bottom:10px">
        <div class="small-muted">Threshold ≥ ${money(DB.commissionRules.paymentThreshold)} (UC14) · zero outstanding ${DB.commissionRules.requireZeroOutstanding ? "required" : "not required"} (UC15) · expiry ${DB.commissionRules.expiryDays}d (UC19) → lifecycle status (UC16)</div>
        ${["Commission Admin", "Admin"].includes(currentRole()) ? `<button class="btn sm secondary" onclick="runExpirationCheck()">Run Expiration Check</button> <button class="btn sm secondary" onclick="revalidateAllCommissions()">Re-validate All</button>` : ""}
      </div>
      <div class="card">
        <div class="table-wrap"><table><thead><tr><th>Student</th><th>University</th><th>Age</th>${showAmounts ? "<th>Paid</th><th>Outstanding</th>" : ""}<th>Threshold (UC14)</th><th>Arrears (UC15)</th><th>Status</th>${showAmounts ? "<th>Est. Commission</th>" : ""}<th></th></tr></thead>
        <tbody>${leads.map(l => `
          <tr>
            <td>${esc(l.name)}</td><td>${esc(l.university) || "-"}</td>
            <td>${daysAgo(l.createdAt)}d</td>
            ${showAmounts ? `<td>${money(l.amountPaid)}</td><td>${l.outstandingBalance ? `<span style="color:var(--red)">${money(l.outstandingBalance)}</span>` : money(0)}</td>` : ""}
            <td>${meetsPaymentThreshold(l) ? `<span style="color:var(--green)">${icon("check")}</span>` : `<span style="color:var(--red)">${icon("x")}</span>`}</td>
            <td>${outstandingCleared(l) ? `<span style="color:var(--green)">${icon("check")}</span>` : `<span style="color:var(--red)">${icon("x")}</span>`}</td>
            <td>${commissionBadge(l.commissionStatus)}</td>
            ${showAmounts ? `<td>${money(estimateCommission(l))}</td>` : ""}
            <td>${renderCommissionActionBtn(l)}</td>
          </tr>`).join("") || `<tr><td colspan="10" class="empty-state">No converted leads yet.</td></tr>`}
        </tbody></table></div>
      </div>`;
  }

  if (tab === "targets") {
    const intake = state.targetIntake || DB.intakes[DB.intakes.length - 1].id;
    const counsellors = DB.users.filter(u => u.role === "Counsellor");
    body.innerHTML = `
      <div class="toolbar">
        <label style="margin:0">Intake:&nbsp;</label>
        <select id="targetIntakeSelect">${DB.intakes.map(i => `<option value="${i.id}" ${intake === i.id ? "selected" : ""}>${i.name}</option>`).join("")}</select>
      </div>
      <div class="card">
        <h3>Counsellor Enrolment Targets <span class="pill">UC3</span></h3>
        <div class="table-wrap"><table><thead><tr><th>Counsellor</th><th>Target</th><th>Actual Enrolments</th><th>Progress</th>${["Manager", "Admin"].includes(currentRole()) ? "<th></th>" : ""}</tr></thead>
        <tbody>${counsellors.map(c => {
          const t = targetFor(c.id, intake);
          const actual = actualEnrolments(c.id, intake);
          const targetVal = t ? t.target : 0;
          const pct = targetVal ? Math.min(100, Math.round(actual / targetVal * 100)) : 0;
          return `<tr>
            <td>${esc(c.name)}</td><td>${targetVal || "<span class='small-muted'>Not set</span>"}</td><td>${actual}</td>
            <td style="min-width:160px"><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${pct >= 100 ? "var(--green)" : "var(--blue-600)"}"></div></div><span class="small-muted">${pct}%</span></td>
            ${["Manager", "Admin"].includes(currentRole()) ? `<td><button class="btn sm secondary" onclick="openSetTargetModal('${c.id}','${intake}')">Set Target</button></td>` : ""}
          </tr>`;
        }).join("")}</tbody></table></div>
      </div>`;
    document.getElementById("targetIntakeSelect").onchange = e => { state.targetIntake = e.target.value; renderCommissionBody(); };
  }

  if (tab === "reports") {
    const reports = DB.reports.slice().reverse();
    body.innerHTML = `
      <div class="page-header" style="margin-bottom:10px">
        <div class="small-muted">Validate → submit for Marketing review → Head of Marketing approval → auto-dispatch to Finance (UC6-UC13)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${["Commission Admin", "Admin"].includes(currentRole()) ? `<button class="btn secondary sm" onclick="generateEligibleListReport()">Generate Eligible List (UC44)</button>
          <button class="btn sm" onclick="openGenerateReportModal()">Generate &amp; Submit Report (UC13/UC6/UC7)</button>` : ""}
        </div>
      </div>
      ${reports.length ? reports.map(r => renderReportCard(r)).join("") : `<div class="empty-state">No commission reports generated yet.</div>`}
    `;
  }
}

function renderReportCard(r) {
  const statusColor = { Draft: "closed", "Marketing Review": "pending", Approved: "eligible", Dispatched: "paid", Rejected: "blocked" }[r.status] || "closed";
  const role = currentRole();
  return `<div class="card">
    <div class="flex-between">
      <div>
        <h3 style="margin-bottom:4px">Report #${r.id.slice(-5).toUpperCase()} <span class="badge ${statusColor}">${esc(r.status)}</span></h3>
        <div class="small-muted">Generated ${fmtDateTime(r.generatedAt)} · ${r.leadIds.length} validated record(s) · ${r.excludedCount} excluded (incomplete/blocked, UC17)</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${r.status === "Marketing Review" && ["Head of Marketing", "Admin"].includes(role) ? `<button class="btn sm success" onclick="approveReport('${r.id}')">Approve (UC8)</button><button class="btn sm danger" onclick="rejectReport('${r.id}')">Reject</button>` : ""}
        ${r.status === "Dispatched" && ["Finance", "Admin"].includes(role) ? `<button class="btn sm" onclick="processUnifiedPayment('${r.id}')">Process Unified Payment (UC18)</button>` : ""}
        <button class="btn sm secondary" onclick="exportReportCSV('${r.id}')">${icon("download")} CSV</button>
        <button class="btn sm secondary" onclick="exportCommissionReportPDF('${r.id}')">${icon("document")} PDF</button>
      </div>
    </div>
    ${r.comments ? `<div class="notice error" style="margin-top:10px">Reviewer comment: ${esc(r.comments)}</div>` : ""}
    ${r.status === "Dispatched" ? `<div class="notice info" style="margin-top:10px">Auto-dispatched to Finance (${esc((DB.reportConfig.recipients || []).join(", "))}) on ${fmtDateTime(r.dispatchedAt)} — UC11</div>` : ""}
    ${r.status === "Paid" ? `<div class="notice success" style="margin-top:10px">Unified payment processed — all records marked Paid (UC18).</div>` : ""}
  </div>`;
}

function openGenerateReportModal() {
  openModal(`
    <div class="modal-header"><h2>Generate Commission Report <span class="pill">UC13</span></h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p class="small-muted">Optional filters — leave blank to include all converted leads.</p>
      <div class="field"><label>Program</label><select id="genRep_program"><option value="">All Programs</option>${picklist('programs').map(p => `<option>${p}</option>`).join("")}</select></div>
      <div class="grid-2"><div class="field"><label>From Date</label><input id="genRep_from" type="date"></div><div class="field"><label>To Date</label><input id="genRep_to" type="date"></div></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="generateCommissionReport({program:document.getElementById('genRep_program').value, from:document.getElementById('genRep_from').value, to:document.getElementById('genRep_to').value})">Generate &amp; Submit</button></div>
  `);
}
function generateCommissionReport(filters) {
  filters = filters || {};
  closeModal();
  let pool = DB.leads.filter(l => l.stage === "Converted" && !l.deactivated);
  if (filters.program) pool = pool.filter(l => l.program === filters.program);
  if (filters.from) pool = pool.filter(l => l.createdAt.slice(0, 10) >= filters.from);
  if (filters.to) pool = pool.filter(l => l.createdAt.slice(0, 10) <= filters.to);
  const eligible = pool.filter(l => l.commissionStatus === "Eligible");
  const excluded = pool.filter(l => ["Pending", "Blocked"].includes(l.commissionStatus)).length;
  if (!eligible.length) { toast("Blocked (UC6): no fully validated records match these filters.", "error"); return; }
  const report = {
    id: uid("rep"), generatedAt: new Date().toISOString(), status: "Marketing Review",
    leadIds: eligible.map(l => l.id), excludedCount: excluded, comments: "", columns: DB.reportConfig.columns
  };
  DB.reports.push(report);
  logAudit("GENERATE_REPORT", "CommissionReport:" + report.id, `${eligible.length} records, ${excluded} excluded — submitted for Marketing review`);
  saveDB();
  toast(`Report generated with ${eligible.length} record(s) and submitted for Marketing Department review (UC7).`, "success");
  renderCommissionBody();
}
function approveReport(id) {
  const r = DB.reports.find(x => x.id === id);
  r.status = "Dispatched";
  r.approvedBy = getCurrentUser().name;
  r.dispatchedAt = new Date().toISOString();
  logAudit("APPROVE_REPORT", "CommissionReport:" + id, `Approved by ${r.approvedBy} (UC8), auto-dispatched to Finance (UC11)`);
  saveDB();
  toast("Report approved and auto-dispatched to Finance.", "success");
  renderCommissionBody();
}
function rejectReport(id) {
  confirmModal({
    title: "Send report back for correction",
    message: "The report returns to Draft so the figures can be corrected and resubmitted. Tell the preparer what needs changing (UC7 - AF1).",
    reasonLabel: "Rejection reason",
    placeholder: "e.g. Cardiff Met commission rate looks wrong",
    requireReason: true,
    confirmLabel: "Send Back",
    onConfirm: (comment) => {
      const r = DB.reports.find(x => x.id === id);
      r.status = "Draft";
      r.comments = comment;
      logAudit("REJECT_REPORT", "CommissionReport:" + id, comment);
      saveDB();
      toast("Report sent back for correction.", "warn");
      renderCommissionBody();
    }
  });
}
function processUnifiedPayment(id) {
  const r = DB.reports.find(x => x.id === id);
  r.leadIds.forEach(leadId => {
    const l = DB.leads.find(x => x.id === leadId);
    if (l) l.commissionStatus = "Paid";
  });
  r.status = "Paid";
  logAudit("PROCESS_PAYMENT", "CommissionReport:" + id, `Unified payment run for ${r.leadIds.length} payee(s) (UC18)`);
  saveDB();
  toast("Unified payment processed for all payees in this report.", "success");
  renderCommissionBody();
}
/* UC12 — resolves a configured column label to the matching value for a lead,
   so changing the column config actually changes the exported data, not just the header. */
const REPORT_COLUMN_RESOLVERS = {
  "student name": l => l.name,
  "name": l => l.name,
  "university": l => l.university,
  "program": l => l.program,
  "commission amount": l => canViewAmounts() ? estimateCommission(l) : "•••",
  "amount": l => canViewAmounts() ? estimateCommission(l) : "•••",
  "commission %": l => { const p = planFor(l); return p && p.type === "Percentage" ? p.value + "%" : "-"; },
  "status": l => l.commissionStatus,
  "email": l => l.email,
  "mobile": l => l.mobile,
  "intake": l => (DB.intakes.find(i => i.id === l.intakeId) || {}).name || "",
  "counsellor": l => userName(l.assignedTo),
  "amount paid": l => canViewAmounts() ? l.amountPaid : "•••",
  "outstanding": l => canViewAmounts() ? l.outstandingBalance : "•••"
};
function resolveReportCell(col, lead) {
  const fn = REPORT_COLUMN_RESOLVERS[String(col).trim().toLowerCase()];
  return fn ? fn(lead) : "";
}
function exportReportCSV(id) {
  const r = DB.reports.find(x => x.id === id);
  const cols = (r.columns && r.columns.length) ? r.columns : DB.reportConfig.columns;
  const rows = [cols];
  r.leadIds.forEach(leadId => {
    const l = DB.leads.find(x => x.id === leadId);
    if (!l) return;
    rows.push(cols.map(c => resolveReportCell(c, l)));
  });
  downloadCSV(`commission_report_${id}.csv`, rows);
  logAudit("EXPORT", "CommissionReport:" + id, `Exported CSV with columns: ${cols.join(" | ")}`);
}
function exportCommissionReportPDF(id) {
  const r = DB.reports.find(x => x.id === id);
  const cols = (r.columns && r.columns.length) ? r.columns : DB.reportConfig.columns;
  const rows = [cols];
  let total = 0;
  r.leadIds.forEach(leadId => {
    const l = DB.leads.find(x => x.id === leadId);
    if (!l) return;
    total += estimateCommission(l);
    rows.push(cols.map(c => resolveReportCell(c, l)));
  });
  const html = `
    <table><tbody>
      <tr><th style="width:24%">Report Reference</th><td>#${esc(r.id.slice(-5).toUpperCase())}</td>
          <th style="width:24%">Status</th><td>${esc(r.status)}</td></tr>
      <tr><th>Generated</th><td>${fmtDateTime(r.generatedAt)}</td>
          <th>Records Included</th><td>${r.leadIds.length}</td></tr>
      <tr><th>Excluded (UC17)</th><td>${r.excludedCount} incomplete / blocked</td>
          <th>Approved By</th><td>${esc(r.approvedBy || "— pending —")}</td></tr>
      ${canViewAmounts() ? `<tr><th>Total Commission</th><td colspan="3"><b>${money(total)}</b></td></tr>` : ""}
      <tr><th>Dispatch Recipients</th><td colspan="3">${esc((DB.reportConfig.recipients || []).join(", ") || "—")}</td></tr>
    </tbody></table>
    <h3>Commission Line Items</h3>
    ${rowsToTableHTML(rows)}
    ${!canViewAmounts() ? `<p class="small-muted">Monetary values are masked for your role (UC20 / UC79).</p>` : ""}
    <p class="small-muted">Approval chain: generated &rarr; Marketing Department review (UC7) &rarr; Head of Marketing approval (UC8) &rarr; auto-dispatch to Finance (UC11) &rarr; unified payment run (UC18).</p>`;
  if (printToPDF({ title: "Commission Report #" + r.id.slice(-5).toUpperCase(), subtitle: "Commission & Payment Engine — Module M4", html })) {
    logAudit("EXPORT_PDF", "CommissionReport:" + id, `Exported as PDF (${r.leadIds.length} records)`);
    saveDB();
    toast("Opening print dialog — choose “Save as PDF”.", "success");
  }
}

function generateEligibleListReport() {
  const eligible = DB.leads.filter(l => l.stage === "Converted" && !l.deactivated && l.commissionStatus === "Eligible");
  const rows = [["Student", "University", "Program", "Intake"], ...eligible.map(l => [l.name, l.university, l.program, (DB.intakes.find(i => i.id === l.intakeId) || {}).name || ""])];
  downloadCSV("commission_eligible_list.csv", rows);
  logAudit("EXPORT", "CommissionEligibleList", `${eligible.length} record(s) (UC44)`);
  toast(`Exported ${eligible.length} eligible record(s).`, "success");
}
function revalidateAllCommissions() {
  let eligible = 0, blocked = 0;
  DB.leads.filter(l => l.stage === "Converted" && !l.deactivated && l.commissionStatus !== "Paid").forEach(l => {
    if (meetsPaymentThreshold(l) && outstandingCleared(l)) { l.commissionStatus = "Eligible"; eligible++; }
    else { l.commissionStatus = "Blocked"; blocked++; }
  });
  logAudit("COMMISSION", "CommissionEngine", `Re-validated all: ${eligible} eligible, ${blocked} blocked (UC14/UC15)`);
  saveDB();
  toast(`Re-validated — ${eligible} eligible, ${blocked} blocked.`, "success");
  renderCommissionBody();
}
function runExpirationCheck() {
  const threshold = (DB.commissionRules && DB.commissionRules.expiryDays) || 25;
  let count = 0;
  DB.leads.forEach(l => {
    if (l.stage === "Converted" && !l.deactivated && l.commissionStatus === "Pending" && daysAgo(l.createdAt) > threshold) {
      l.commissionStatus = "Blocked";
      addActivity(l, "Commission", `Auto-blocked: incomplete record exceeded ${threshold}-day expiration timeline (UC19)`);
      count++;
    }
  });
  logAudit("EXPIRE_CHECK", "CommissionEngine", `${count} record(s) auto-blocked (UC19)`);
  saveDB();
  toast(count ? `${count} stale record(s) auto-blocked (UC19).` : "No records past the expiration timeline.", count ? "warn" : "success");
  renderCommissionBody();
}
function togglePlanStatus(id) {
  const p = DB.commissionPlans.find(x => x.id === id);
  p.status = p.status === "Active" ? "Inactive" : "Active";
  logAudit("UPDATE", "CommissionPlan:" + id, "Status → " + p.status + " (UC5)");
  saveDB();
  toast(`Plan marked ${p.status}.`, "success");
  renderCommissionBody();
}
function openSetTargetModal(counsellorId, intakeId) {
  const existing = targetFor(counsellorId, intakeId);
  openModal(`
    <div class="modal-header"><h2>Set Enrolment Target (UC3)</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p class="small-muted">${esc(userName(counsellorId))} — ${esc((DB.intakes.find(i => i.id === intakeId) || {}).name || "")}</p>
      <div class="field"><label>Target Enrolments</label><input id="tgt_value" type="number" min="0" value="${existing ? existing.target : 5}"></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveTarget('${counsellorId}','${intakeId}')">Save</button></div>
  `);
}
function saveTarget(counsellorId, intakeId) {
  const value = Number(document.getElementById("tgt_value").value || 0);
  let t = targetFor(counsellorId, intakeId);
  if (t) { t.target = value; } else { DB.counsellorTargets.push({ id: uid("tgt"), counsellorId, intakeId, target: value }); }
  logAudit("SET_TARGET", "Counsellor:" + counsellorId, `Target set to ${value} (UC3)`);
  saveDB();
  closeModal();
  toast("Target saved.", "success");
  renderCommissionBody();
}
function planValueLabel(p) {
  if (p.type === "Percentage") return p.value + "%";
  if (p.type === "Fixed" || p.type === "Referral-Student" || p.type === "Referral-Staff") return money(p.value);
  if (p.type === "Slab") return p.tiers.map(t => `${t.from}-${t.to}=${t.rate}%`).join(", ");
  return "-";
}
function planFor(lead) {
  if (lead.isReferral) {
    const refPlan = DB.commissionPlans.find(p => p.type === "Referral-" + lead.referralType && p.status === "Active");
    if (refPlan) return refPlan;
  }
  const nonReferral = p => !p.type.startsWith("Referral");
  return DB.commissionPlans.find(p => p.university === lead.university && nonReferral(p) && p.status === "Active")
    || DB.commissionPlans.find(p => p.university === "All" && nonReferral(p) && p.status === "Active")
    || null;
}
function estimateCommission(lead) {
  const baseTuition = lead.tuitionFee || 850000;
  const plan = planFor(lead);
  if (!plan) return 0;
  if (plan.type.startsWith("Referral")) return plan.value || 0;
  if (plan.type === "Percentage") return baseTuition * (plan.value / 100);
  if (plan.type === "Fixed") return plan.value;
  if (plan.type === "Slab") return baseTuition * (plan.tiers[1].rate / 100);
  return plan.value || 0;
}
function renderCommissionActionBtn(l) {
  if (!["Commission Admin", "Finance", "Admin"].includes(currentRole())) return "";
  if (l.commissionStatus === "Eligible") return `<button class="btn sm success" onclick="markPaid('${l.id}')">Mark Paid</button>`;
  if (l.commissionStatus === "Pending") return `<button class="btn sm secondary" onclick="validateCommission('${l.id}')">Validate</button>`;
  return "";
}
function validateCommission(id) {
  const l = DB.leads.find(x => x.id === id);
  const reasons = [];
  if (!meetsPaymentThreshold(l)) reasons.push(`paid ${money(l.amountPaid)} < threshold ${money(DB.commissionRules.paymentThreshold)} (UC14)`);
  if (!outstandingCleared(l)) reasons.push(`outstanding balance ${money(l.outstandingBalance)} not cleared (UC15)`);
  if (reasons.length) {
    l.commissionStatus = "Blocked";
    addActivity(l, "Commission", "Validation failed — " + reasons.join("; "));
    toast("Blocked: " + reasons.join("; "), "error");
  } else {
    l.commissionStatus = "Eligible";
    addActivity(l, "Commission", "Validation passed — record is Eligible (UC9)");
    toast("Validated — record is now Eligible (UC9).", "success");
  }
  logAudit("COMMISSION", "Lead:" + id, "Status → " + l.commissionStatus + (reasons.length ? " — " + reasons.join("; ") : ""));
  saveDB();
  renderCommission(document.getElementById("content"));
}
function markPaid(id) {
  const l = DB.leads.find(x => x.id === id);
  l.commissionStatus = "Paid";
  logAudit("COMMISSION", "Lead:" + id, "Status → Paid (unified payment run, UC18)");
  saveDB();
  toast("Marked as Paid.", "success");
  renderCommission(document.getElementById("content"));
}
function openCommissionPlanModal(planId) {
  const editing = planId ? DB.commissionPlans.find(p => p.id === planId) : null;
  window.__editingPlanId = editing ? editing.id : null;
  const p = editing || { university: picklist('universities')[0], type: "Percentage", value: "", from: "", to: "" };
  const isSlab = p.type === "Slab";
  openModal(`
    <div class="modal-header"><h2>${editing ? "Edit Commission Plan" : "New Commission Plan"} <span class="pill">UC1 / UC2 / UC4 / UC5</span></h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label>University</label><select id="cp_uni">${picklist('universities').map(u => `<option ${p.university === u ? "selected" : ""}>${u}</option>`).join("")}<option value="All" ${p.university === "All" ? "selected" : ""}>All (referral plans)</option></select></div>
      <div class="field"><label>Type</label>
        <select id="cp_type">
          <option value="Percentage" ${p.type === "Percentage" ? "selected" : ""}>Percentage</option>
          <option value="Fixed" ${p.type === "Fixed" ? "selected" : ""}>Fixed Amount</option>
          <option value="Slab" ${p.type === "Slab" ? "selected" : ""}>Slab / Tier (UC4)</option>
          <option value="Referral-Student" ${p.type === "Referral-Student" ? "selected" : ""}>Student Referral Commission (UC2)</option>
          <option value="Referral-Staff" ${p.type === "Referral-Staff" ? "selected" : ""}>Staff Referral Commission (UC2)</option>
        </select>
      </div>
      <div class="field ${isSlab ? "hidden" : ""}" id="cp_valueWrap"><label>Value</label><input id="cp_value" type="number" value="${editing && !isSlab ? p.value : ""}" placeholder="e.g. 10 (for %) or 40000 (fixed)"></div>
      <div class="field ${isSlab ? "" : "hidden"}" id="cp_slabWrap">
        <label>Slab Tiers (UC4)</label>
        <div class="grid-3" style="margin-bottom:6px">
          <input id="cp_slab1" placeholder="0-10 = 0%" value="${isSlab ? `${p.tiers[0].from}-${p.tiers[0].to}=${p.tiers[0].rate}` : "0-10=0"}">
          <input id="cp_slab2" placeholder="11-20 = 2%" value="${isSlab && p.tiers[1] ? `${p.tiers[1].from}-${p.tiers[1].to}=${p.tiers[1].rate}` : "11-20=2"}">
          <input id="cp_slab3" placeholder="21+ = 5%" value="${isSlab && p.tiers[2] ? `${p.tiers[2].from}-${p.tiers[2].to}=${p.tiers[2].rate}` : "21-999=5"}">
        </div>
        <p class="small-muted">Format: from-to=rate. System validates tiers are continuous with no gaps/overlaps.</p>
      </div>
      <div class="grid-2"><div class="field"><label>Effective From</label><input id="cp_from" type="date" value="${p.from || ""}"></div><div class="field"><label>Effective To</label><input id="cp_to" type="date" value="${p.to || ""}"></div></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveCommissionPlan()">${editing ? "Save Changes" : "Save Plan"}</button></div>
  `);
  document.getElementById("cp_type").onchange = e => {
    const isSlabNow = e.target.value === "Slab";
    document.getElementById("cp_slabWrap").classList.toggle("hidden", !isSlabNow);
    document.getElementById("cp_valueWrap").classList.toggle("hidden", isSlabNow);
  };
}
function parseSlabTiers() {
  const raw = [document.getElementById("cp_slab1").value, document.getElementById("cp_slab2").value, document.getElementById("cp_slab3").value];
  const tiers = raw.map(str => {
    const m = str.match(/^(\d+)-(\d+)=(\d+(\.\d+)?)$/);
    if (!m) return null;
    return { from: Number(m[1]), to: Number(m[2]), rate: Number(m[3]) };
  });
  if (tiers.some(t => !t)) return null;
  tiers.sort((a, b) => a.from - b.from);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].from !== tiers[i - 1].to + 1) return { error: true };
  }
  return tiers;
}
function saveCommissionPlan() {
  const uni = document.getElementById("cp_uni").value;
  const type = document.getElementById("cp_type").value;
  const editingId = window.__editingPlanId;
  const overlap = DB.commissionPlans.find(p => p.university === uni && p.type === type && p.status === "Active" && p.id !== editingId);
  if (overlap) { toast("Overlapping effective period detected for this university/type (UC1 - AF1).", "error"); return; }
  const values = {
    university: uni, type,
    from: document.getElementById("cp_from").value, to: document.getElementById("cp_to").value
  };
  if (type === "Slab") {
    const tiers = parseSlabTiers();
    if (!tiers || tiers.error) { toast("Slab tiers must be continuous with no gaps or overlaps (UC4 - AF1).", "error"); return; }
    values.tiers = tiers;
    delete values.value;
  } else {
    values.value = Number(document.getElementById("cp_value").value || 0);
    delete values.tiers;
  }
  if (editingId) {
    const existing = DB.commissionPlans.find(p => p.id === editingId);
    Object.assign(existing, values);
    logAudit("UPDATE", "CommissionPlan:" + editingId, `Plan updated for ${uni} (UC5 — operational data, version history in audit log)`);
    toast("Commission plan updated.", "success");
  } else {
    const plan = Object.assign({ id: uid("cp"), status: "Active" }, values);
    DB.commissionPlans.push(plan);
    logAudit("CREATE", "CommissionPlan", `New ${type} plan for ${uni}`);
    toast("Commission plan created.", "success");
  }
  window.__editingPlanId = null;
  saveDB();
  closeModal();
  renderCommission(document.getElementById("content"));
}

/* ============================================================
   REPORTS & ANALYTICS — M5
   ============================================================ */
function renderReports(root) {
  // UC49 — only reports permitted for this role are listed
  const tabs = REPORT_DEFS.filter(r => canViewReport(r.id)).map(r => [r.id, r.label]);
  if (!tabs.length) {
    root.innerHTML = `<div class="page-header"><div><h1>Reports & Analytics</h1></div></div>
      <div class="empty-state">No reports are enabled for the ${esc(currentRole())} role.</div>`;
    return;
  }
  if (!tabs.some(([k]) => k === state.reportsTab)) state.reportsTab = tabs[0][0];
  root.innerHTML = `
    <div class="page-header"><div><h1>Reports & Analytics</h1><div class="sub">Module M5 — ${tabs.length} report(s) visible to ${esc(currentRole())} (UC49)</div></div>
      <div style="display:flex;gap:8px;">
        <button class="btn secondary sm" onclick="exportCurrentReport()">${icon("download")} CSV</button>
        <button class="btn sm" onclick="exportCurrentReportPDF()" title="UC45 - AF1">${icon("document")} Export PDF</button>
      </div>
    </div>
    <div class="tabs">${tabs.map(([k, l]) => `<div class="tab ${state.reportsTab === k ? "active" : ""}" data-k="${k}">${l}</div>`).join("")}</div>
    <div id="reportBody"></div>
  `;
  document.querySelectorAll(".tabs .tab").forEach(t => t.onclick = () => { state.reportsTab = t.dataset.k; renderReports(root); });
  renderReportBody();
}
function renderReportBody() {
  const body = document.getElementById("reportBody");
  const leads = DB.leads;
  const tab = state.reportsTab;

  if (tab === "journey") {
    const journeyLeads = visibleLeads().filter(hasSubmittedApplication);
    const stageCols = stages();
    body.innerHTML = `
      <div class="card">
        <h3>Student Journey Report <span class="pill">sales head / counsellor</span></h3>
        <p class="small-muted">Students who have submitted an application form, traced through each configured pipeline stage up to onboarding into the Student Management System. Dates are the first time each lead's own activity log recorded that stage.</p>
        ${journeyLeads.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Student</th><th>Source</th><th>Current Status</th>${stageCols.map(s => `<th>${esc(stageLabel(s))}</th>`).join("")}<th>Onboarded to SMS</th></tr></thead>
          <tbody>${journeyLeads.map(l => {
            const d = stageReachedDates(l);
            return `<tr>
              <td><a href="javascript:void(0)" onclick="openLeadModal('${l.id}')"><b>${esc(l.name)}</b></a></td>
              <td>${esc(l.leadSource)}</td>
              <td>${esc(l.detailedStatus) || stageBadge(l.stage)}</td>
              ${stageCols.map(s => `<td>${d[s] ? fmtDate(d[s]) : "<span class='small-muted'>—</span>"}</td>`).join("")}
              <td>${smsOnboardDate(l, d) ? fmtDate(smsOnboardDate(l, d)) : "<span class='small-muted'>—</span>"}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>` : `<div class="empty-state">No leads in your view have submitted an application form yet.</div>`}
      </div>`;
  }
  if (tab === "status") {
    const counts = stages().map(s => ({ label: stageLabel(s), value: leads.filter(l => l.stage === s && !l.deactivated).length, color: stageColor(s) }));
    body.innerHTML = `<div class="card"><h3>Lead Status Distribution (UC45)</h3>${simpleBarChart(counts)}</div>`;
  }
  if (tab === "source") {
    const bySource = picklist('leadSources').map(s => {
      const l = leads.filter(x => x.leadSource === s);
      const conv = l.filter(x => x.stage === "Converted").length;
      return { label: s, value: l.length, conv, rate: l.length ? ((conv / l.length) * 100).toFixed(0) : 0 };
    });
    body.innerHTML = `<div class="card"><h3>Lead Source Performance (UC47)</h3>${simpleBarChart(bySource)}
      <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Source</th><th>Leads</th><th>Converted</th><th>Conversion %</th></tr></thead>
      <tbody>${bySource.map(s => `<tr><td>${s.label}</td><td>${s.value}</td><td>${s.conv}</td><td>${s.rate}%</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  if (tab === "university") {
    const byUni = picklist('universities').map(u => ({ label: u, value: leads.filter(l => l.university === u).length }));
    body.innerHTML = `<div class="card"><h3>University-Wise Lead Distribution (UC48)</h3>${simpleBarChart(byUni)}</div>`;
  }
  if (tab === "funnel") {
    const inquiries = DB.inquiries.length;
    const qualified = leads.filter(l => l.stage === "Qualified" || l.stage === "Converted").length;
    const enrolled = leads.filter(l => l.stage === "Converted").length;
    body.innerHTML = `<div class="card"><h3>Full Funnel Conversion (UC76)</h3>
      ${simpleBarChart([{ label: "Inquiries", value: inquiries, color: CHART.primary }, { label: "Qualified Leads", value: qualified, color: CHART.warn }, { label: "Enrolments", value: enrolled, color: CHART.good }])}
      <p class="small-muted">Inquiry → Lead: ${inquiries ? ((qualified / inquiries) * 100).toFixed(1) : 0}% &nbsp;|&nbsp; Lead → Enrolment: ${qualified ? ((enrolled / qualified) * 100).toFixed(1) : 0}%</p>
    </div>`;
  }
  if (tab === "loss") {
    const lost = leads.filter(l => l.stage === "Closed" && l.lossReason);
    const segs = picklist('lossReasons').map((r, idx) => ({ label: r, value: lost.filter(l => l.lossReason === r).length, color: CHART.series[idx % CHART.series.length] })).filter(s => s.value > 0);
    body.innerHTML = `<div class="card"><h3>Loss Reason Analysis (UC77)</h3>
      <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;">
        ${donutSVG(segs.length ? segs : [{ label: "None", value: 1, color: CHART.grid }], 180)}
        <div>${segs.map(s => `<div class="legend"><span><i style="background:${s.color}"></i>${s.label}: ${s.value}</span></div>`).join("") || "<span class='small-muted'>No lost leads recorded yet.</span>"}</div>
      </div></div>`;
  }
  if (tab === "program") {
    const byProg = picklist('programs').map(p => {
      const l = leads.filter(x => x.program === p);
      return { label: p, value: l.length, enrolled: l.filter(x => x.stage === "Converted").length };
    });
    body.innerHTML = `<div class="card"><h3>Program-Wise Performance (UC78)</h3>
    <div class="table-wrap"><table><thead><tr><th>Program</th><th>Leads</th><th>Enrolled</th><th>Conversion %</th></tr></thead>
    <tbody>${byProg.map(p => `<tr><td>${p.label}</td><td>${p.value}</td><td>${p.enrolled}</td><td>${p.value ? ((p.enrolled / p.value) * 100).toFixed(0) : 0}%</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  if (tab === "sla") {
    const counsellors = DB.users.filter(u => u.role === "Counsellor");
    const perCounsellor = counsellors.map(c => {
      const s = slaStatsFor(DB.leads.filter(l => l.assignedTo === c.id));
      return { name: c.name, ...s };
    });
    const overall = slaStatsFor(DB.leads);
    body.innerHTML = `<div class="card">
      <h3>Follow-Up SLA Compliance <span class="pill">UC46</span></h3>
      <p class="small-muted">% of completed follow-up tasks finished on or before their scheduled due date. Overall: <b>${overall.onTime} of ${overall.total} on time (${overall.pct}%)</b>.</p>
      ${simpleBarChart(perCounsellor.map(r => ({ label: r.name, value: r.pct, color: r.pct >= 80 ? CHART.good : r.pct >= 60 ? CHART.warn : CHART.bad })))}
      <div class="table-wrap wide" style="margin-top:14px"><table><thead><tr><th>Counsellor</th><th>Tasks Completed</th><th>On Time</th><th>Late</th><th>Compliance</th></tr></thead>
      <tbody>${perCounsellor.map(r => `<tr><td>${esc(r.name)}</td><td>${r.total}</td><td>${r.onTime}</td><td>${r.total - r.onTime}</td><td><b>${r.pct}%</b></td></tr>`).join("")}</tbody></table></div>
      <p class="small-muted" style="margin-top:10px">Drill-down: late tasks are recorded on each lead's Timeline tab (UC46 - AF1).</p>
    </div>`;
  }
  if (tab === "counsellor") {
    const intake = state.reportsIntake || DB.intakes[DB.intakes.length - 1].id;
    const counsellors = DB.users.filter(u => u.role === "Counsellor");
    body.innerHTML = `
      <div class="toolbar"><label style="margin:0">Intake:&nbsp;</label><select id="reportsIntakeSelect">${DB.intakes.map(i => `<option value="${i.id}" ${intake === i.id ? "selected" : ""}>${i.name}</option>`).join("")}</select></div>
      <div class="card"><h3>Counsellor Performance Dashboard (UC43)</h3>
      <div class="table-wrap wide"><table><thead><tr><th>Counsellor</th><th>Target</th><th>Actual</th><th>Conversion %</th><th>Commission Eligibility</th></tr></thead>
      <tbody>${counsellors.map(c => {
        const t = targetFor(c.id, intake);
        const actual = actualEnrolments(c.id, intake);
        const total = DB.leads.filter(l => l.assignedTo === c.id && l.intakeId === intake).length;
        const eligible = DB.leads.filter(l => l.assignedTo === c.id && l.intakeId === intake && l.commissionStatus === "Eligible").length;
        return `<tr><td>${esc(c.name)}</td><td>${t ? t.target : "-"}</td><td>${actual}</td><td>${total ? Math.round(actual / total * 100) : 0}%</td><td>${eligible} eligible</td></tr>`;
      }).join("")}</tbody></table></div></div>`;
    document.getElementById("reportsIntakeSelect").onchange = e => { state.reportsIntake = e.target.value; renderReportBody(); };
  }
  if (tab === "agent") {
    const agents = DB.users.filter(u => u.role === "Agent");
    body.innerHTML = `<div class="card"><h3>Agent-Generated Leads &amp; Performance (UC74)</h3>
    <div class="table-wrap wide"><table><thead><tr><th>Agent</th><th>Leads Submitted</th><th>Converted</th><th>Conversion %</th>${canViewAmounts() ? "<th>Commission Earned</th>" : ""}</tr></thead>
    <tbody>${agents.map(a => {
      const l = DB.leads.filter(x => x.agentId === a.id);
      const conv = l.filter(x => x.stage === "Converted").length;
      const paid = l.filter(x => x.commissionStatus === "Paid").reduce((s, x) => s + estimateCommission(x), 0);
      return `<tr><td>${esc(a.name)}</td><td>${l.length}</td><td>${conv}</td><td>${l.length ? Math.round(conv / l.length * 100) : 0}%</td>${canViewAmounts() ? `<td>${money(paid)}</td>` : ""}</tr>`;
    }).join("") || `<tr><td colspan="5" class="empty-state">No agents configured.</td></tr>`}</tbody></table></div></div>`;
  }
}
/* Builds the real tabular data behind whichever analytics report is open.
   Used by both the CSV and the PDF exporters (UC45 - AF1). */
function currentReportData() {
  const leads = DB.leads;
  const tab = state.reportsTab;
  const def = REPORT_DEFS.find(r => r.id === tab) || { label: tab };

  if (tab === "journey") {
    const stageCols = stages();
    const journeyLeads = visibleLeads().filter(hasSubmittedApplication);
    const header = ["Student", "Source", "Current Status", ...stageCols.map(stageLabel), "Onboarded to SMS"];
    return { title: def.label, rows: [header, ...journeyLeads.map(l => {
      const d = stageReachedDates(l);
      return [l.name, l.leadSource, l.detailedStatus || l.stage, ...stageCols.map(s => d[s] ? fmtDate(d[s]) : "—"),
        smsOnboardDate(l, d) ? fmtDate(smsOnboardDate(l, d)) : "—"];
    })] };
  }
  if (tab === "status") {
    return { title: def.label, rows: [["Stage", "Leads"], ...stages().map(s => [stageLabel(s), leads.filter(l => l.stage === s && !l.deactivated).length])] };
  }
  if (tab === "source") {
    return { title: def.label, rows: [["Source", "Leads", "Converted", "Conversion %"], ...picklist('leadSources').map(s => {
      const l = leads.filter(x => x.leadSource === s), c = l.filter(x => x.stage === "Converted").length;
      return [s, l.length, c, (l.length ? Math.round(c / l.length * 100) : 0) + "%"];
    })] };
  }
  if (tab === "university") {
    return { title: def.label, rows: [["University", "Leads", "Converted"], ...picklist('universities').map(u => {
      const l = leads.filter(x => x.university === u);
      return [u, l.length, l.filter(x => x.stage === "Converted").length];
    })] };
  }
  if (tab === "funnel") {
    const inq = DB.inquiries.length;
    const q = leads.filter(l => l.stage === "Qualified" || l.stage === "Converted").length;
    const e = leads.filter(l => l.stage === "Converted").length;
    return { title: def.label, rows: [["Stage", "Count", "Conversion from previous"],
      ["Inquiries", inq, "—"],
      ["Qualified Leads", q, (inq ? (q / inq * 100).toFixed(1) : 0) + "%"],
      ["Enrolments", e, (q ? (e / q * 100).toFixed(1) : 0) + "%"]] };
  }
  if (tab === "loss") {
    const lost = leads.filter(l => l.stage === "Closed" && l.lossReason);
    return { title: def.label, rows: [["Loss Reason", "Leads", "% of lost"], ...picklist('lossReasons').map(r => {
      const n = lost.filter(l => l.lossReason === r).length;
      return [r, n, (lost.length ? Math.round(n / lost.length * 100) : 0) + "%"];
    })] };
  }
  if (tab === "program") {
    return { title: def.label, rows: [["Program", "Leads", "Enrolled", "Conversion %"], ...picklist('programs').map(p => {
      const l = leads.filter(x => x.program === p), e = l.filter(x => x.stage === "Converted").length;
      return [p, l.length, e, (l.length ? Math.round(e / l.length * 100) : 0) + "%"];
    })] };
  }
  if (tab === "sla") {
    const rows = [["Counsellor", "Tasks Completed", "On Time", "Late", "Compliance %"]];
    DB.users.filter(u => u.role === "Counsellor").forEach(c => {
      const s = slaStatsFor(DB.leads.filter(l => l.assignedTo === c.id));
      rows.push([c.name, s.total, s.onTime, s.total - s.onTime, s.pct + "%"]);
    });
    return { title: def.label, rows };
  }
  if (tab === "counsellor") {
    const intake = state.reportsIntake || DB.intakes[DB.intakes.length - 1].id;
    const intakeName = (DB.intakes.find(i => i.id === intake) || {}).name || "";
    const rows = [["Counsellor", "Target", "Actual", "Conversion %", "Eligible Commissions"]];
    DB.users.filter(u => u.role === "Counsellor").forEach(c => {
      const t = targetFor(c.id, intake), actual = actualEnrolments(c.id, intake);
      const total = DB.leads.filter(l => l.assignedTo === c.id && l.intakeId === intake).length;
      const elig = DB.leads.filter(l => l.assignedTo === c.id && l.intakeId === intake && l.commissionStatus === "Eligible").length;
      rows.push([c.name, t ? t.target : "-", actual, (total ? Math.round(actual / total * 100) : 0) + "%", elig]);
    });
    return { title: def.label + " — " + intakeName, rows };
  }
  if (tab === "agent") {
    const rows = [["Agent", "Leads Submitted", "Converted", "Conversion %"].concat(canViewAmounts() ? ["Commission Earned"] : [])];
    DB.users.filter(u => u.role === "Agent").forEach(a => {
      const l = DB.leads.filter(x => x.agentId === a.id), c = l.filter(x => x.stage === "Converted").length;
      const paid = l.filter(x => x.commissionStatus === "Paid").reduce((s, x) => s + estimateCommission(x), 0);
      rows.push([a.name, l.length, c, (l.length ? Math.round(c / l.length * 100) : 0) + "%"].concat(canViewAmounts() ? [money(paid)] : []));
    });
    return { title: def.label, rows };
  }
  return { title: def.label, rows: [["No data"]] };
}

function exportCurrentReport() {
  const { title, rows } = currentReportData();
  downloadCSV(`report_${state.reportsTab}.csv`, rows);
  logAudit("EXPORT", "Report:" + state.reportsTab, `${title} exported as CSV (${rows.length - 1} rows)`);
  saveDB();
  toast("Report exported as CSV.", "success");
}

function exportCurrentReportPDF() {
  const { title, rows } = currentReportData();
  // Include the on-screen visual (bars / donut) plus the underlying data table
  const visual = document.getElementById("reportBody");
  const html = `${visual ? visual.innerHTML : ""}
    <h3>Report Data</h3>
    ${rowsToTableHTML(rows)}`;
  if (printToPDF({ title, subtitle: "Reports & Analytics — Module M5", html })) {
    logAudit("EXPORT_PDF", "Report:" + state.reportsTab, `${title} exported as PDF`);
    saveDB();
    toast("Opening print dialog — choose “Save as PDF”.", "success");
  }
}

/* ============================================================
   LEAD SOURCE DASHBOARD — Head of Marketing: source targets vs actual counts
   ============================================================ */
function leadSourceDashboardRows() {
  return picklist('leadSources').map(s => {
    const actual = DB.leads.filter(l => l.leadSource === s && !l.deactivated).length;
    const target = leadSourceTarget(s);
    return { source: s, target, actual };
  });
}
function renderLeadSourceDashboard(root) {
  const rows = leadSourceDashboardRows();
  root.innerHTML = `
    <div class="page-header">
      <div><h1>Lead Source Dashboard</h1><div class="sub">Target vs Actual lead counts by source — Head of Marketing</div></div>
      <div style="display:flex;gap:8px;">
        <button class="btn secondary sm" onclick="exportLeadSourceDashboardCSV()">${icon("download")} CSV</button>
        <button class="btn sm" onclick="exportLeadSourceDashboardPDF()">${icon("document")} Export PDF</button>
      </div>
    </div>
    <div class="card">
      <h3>Lead Source Performance</h3>
      ${simpleBarChart(rows.flatMap(r => [
        { label: r.source + " (Target)", value: r.target, color: CHART.muted },
        { label: r.source + " (Actual)", value: r.actual, color: CHART.primary }
      ]))}
      <div class="table-wrap wide" style="margin-top:14px"><table><thead><tr><th>Lead Source</th><th>Target</th><th>Actual</th><th>Variance</th><th>% of Target</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.source)}</td><td>${r.target}</td><td>${r.actual}</td>
        <td style="color:${r.actual - r.target >= 0 ? 'var(--green)' : 'var(--red)'}">${r.actual - r.target >= 0 ? "+" : ""}${r.actual - r.target}</td>
        <td>${r.target ? Math.round(r.actual / r.target * 100) : 0}%</td></tr>`).join("")}</tbody></table></div>
    </div>
  `;
}
function exportLeadSourceDashboardCSV() {
  const rows = [["Lead Source", "Target", "Actual", "Variance", "% of Target"], ...leadSourceDashboardRows().map(r =>
    [r.source, r.target, r.actual, r.actual - r.target, (r.target ? Math.round(r.actual / r.target * 100) : 0) + "%"])];
  downloadCSV("lead_source_dashboard.csv", rows);
  logAudit("EXPORT", "LeadSourceDashboard", `Exported as CSV (${rows.length - 1} rows)`);
  saveDB();
  toast("Dashboard exported as CSV.", "success");
}
function exportLeadSourceDashboardPDF() {
  const rows = [["Lead Source", "Target", "Actual", "Variance", "% of Target"], ...leadSourceDashboardRows().map(r =>
    [r.source, r.target, r.actual, r.actual - r.target, (r.target ? Math.round(r.actual / r.target * 100) : 0) + "%"])];
  const visual = document.getElementById("content");
  const html = `${visual ? visual.querySelector(".card").innerHTML : ""}<h3>Data</h3>${rowsToTableHTML(rows)}`;
  if (printToPDF({ title: "Lead Source Dashboard", subtitle: "Target vs Actual by lead source", html })) {
    logAudit("EXPORT_PDF", "LeadSourceDashboard", "Exported as PDF");
    saveDB();
    toast("Opening print dialog — choose “Save as PDF”.", "success");
  }
}

/* ============================================================
   INTAKE CYCLES — M6
   ============================================================ */
function renderIntakes(root) {
  const intakes = DB.intakes;
  root.innerHTML = `
    <div class="page-header"><div><h1>Intake / Cycle Management</h1><div class="sub">Create &amp; manage intake cycles (UC70) · assign leads to intakes (UC71) · track performance per intake (UC72)</div></div>
      ${["Admin", "Manager"].includes(currentRole()) ? `<button class="btn" onclick="openNewIntakeModal()">+ New Intake</button>` : ""}
    </div>
    <div class="grid-3">
      ${intakes.map(i => {
        const leads = DB.leads.filter(l => l.intakeId === i.id);
        const qualified = leads.filter(l => l.stage === "Qualified" || l.stage === "Converted").length;
        const enrolled = leads.filter(l => l.stage === "Converted").length;
        return `<div class="card">
          <h3>${esc(i.name)} <span class="pill">UC72</span></h3>
          <div class="small-muted">${fmtDate(i.start)} → ${fmtDate(i.end)}</div>
          <hr class="sep">
          <div class="bar-row"><div class="label">Assigned</div><div class="bar-track"><div class="bar-fill" style="width:100%"></div></div><div class="val">${leads.length}</div></div>
          <div class="bar-row"><div class="label">Qualified</div><div class="bar-track"><div class="bar-fill" style="width:${leads.length ? qualified / leads.length * 100 : 0}%;background:var(--amber)"></div></div><div class="val">${qualified}</div></div>
          <div class="bar-row"><div class="label">Enrolled</div><div class="bar-track"><div class="bar-fill" style="width:${leads.length ? enrolled / leads.length * 100 : 0}%;background:var(--green)"></div></div><div class="val">${enrolled}</div></div>
        </div>`;
      }).join("")}
    </div>
  `;
}
function openNewIntakeModal() {
  window.__intakeOverlapConfirmed = false;
  openModal(`
    <div class="modal-header"><h2>New Intake Cycle (UC70)</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label class="required">Name</label><input id="in_name" placeholder="e.g. January 2027 Intake"></div>
      <div class="grid-2"><div class="field"><label>Start Date</label><input id="in_start" type="date"></div><div class="field"><label>End Date</label><input id="in_end" type="date"></div></div>
      <div id="intakeValidationNotice"></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveNewIntake()">Save</button></div>
  `);
}
function saveNewIntake() {
  const name = document.getElementById("in_name").value.trim();
  if (!name) { toast("Name required.", "error"); return; }
  const start = document.getElementById("in_start").value;
  const end = document.getElementById("in_end").value;
  if (start && end) {
    const overlap = DB.intakes.find(i => i.start && i.end && start <= i.end && end >= i.start);
    // Inline warning rather than a native confirm() — this modal is already open, and
    // confirmModal() would replace it. Mirrors the duplicate-lead flow in saveLeadModal.
    if (overlap && !window.__intakeOverlapConfirmed) {
      document.getElementById("intakeValidationNotice").innerHTML = `
        <div class="notice">${icon("warn")} These dates overlap with <b>${esc(overlap.name)}</b>
        (${fmtDate(overlap.start)} → ${fmtDate(overlap.end)}) — UC70 - AF1.
        <div style="margin-top:8px"><button class="btn sm" onclick="window.__intakeOverlapConfirmed=true;saveNewIntake();">Create Anyway</button>
        <button class="btn sm secondary" onclick="closeModal()">Cancel</button></div></div>`;
      return;
    }
  }
  DB.intakes.push({ id: uid("in"), name, start, end, programs: picklist('programs') });
  logAudit("CREATE", "Intake", name);
  saveDB();
  closeModal();
  toast("Intake cycle created.", "success");
  renderIntakes(document.getElementById("content"));
}

/* ============================================================
   AGENT PORTAL — UC73 / UC74
   ============================================================ */
function renderAgentPortal(root) {
  const isAgent = currentRole() === "Agent";
  const agentId = isAgent ? getCurrentUser().id : "u_agent1";
  const leads = DB.leads.filter(l => l.agentId === agentId);
  root.innerHTML = `
    <div class="page-header"><div><h1>Agent Portal</h1><div class="sub">${isAgent ? "Your submitted leads only" : "Preview: External Partner Agent view"}</div></div>
      <button class="btn" onclick="openAgentSubmitModal('${agentId}')">+ Submit New Lead</button>
    </div>
    <div class="widget-grid">
      <div class="stat-card"><div class="label">Leads Submitted</div><div class="value">${leads.length}</div></div>
      <div class="stat-card"><div class="label">Converted</div><div class="value">${leads.filter(l => l.stage === "Converted").length}</div></div>
      <div class="stat-card"><div class="label">Conversion Rate</div><div class="value">${leads.length ? ((leads.filter(l => l.stage === "Converted").length / leads.length) * 100).toFixed(0) : 0}%</div></div>
    </div>
    <div class="table-wrap card"><table><thead><tr><th>Name</th><th>Program</th><th>Stage</th><th>Submitted</th></tr></thead>
    <tbody>${leads.map(l => `<tr><td>${esc(l.name)}</td><td>${esc(l.program) || "-"}</td><td>${stageBadge(l.stage)}</td><td>${fmtDate(l.createdAt)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty-state">No leads submitted yet.</td></tr>`}</tbody></table></div>
  `;
}
function openAgentSubmitModal(agentId) {
  openModal(`
    <div class="modal-header"><h2>Submit New Lead (UC73)</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label class="required">Name</label><input id="ag_name"></div>
      <div class="field"><label class="required">Mobile</label><input id="ag_mobile"></div>
      <div class="field"><label>Email</label><input id="ag_email"></div>
      <div class="field"><label>Program</label><select id="ag_program">${picklist('programs').map(p => `<option>${p}</option>`).join("")}</select></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveAgentLead('${agentId}')">Submit</button></div>
  `);
}
function saveAgentLead(agentId) {
  const name = document.getElementById("ag_name").value.trim();
  const mobile = document.getElementById("ag_mobile").value.trim();
  if (!name || !mobile) { toast("Name and mobile required.", "error"); return; }
  DB.leads.push({
    id: uid("lead"), name, mobile, email: document.getElementById("ag_email").value.trim(), leadSource: "Agent Referral", modeOfContact: "",
    studentId: "", staffName: "", university: "", program: document.getElementById("ag_program").value, country: "Sri Lanka", district: "Other",
    previousSchool: "", priorQualificationType: "", bachelorsDegree: "", bachelorsUniversity: "",
    examType: "Local A/L", resultsPending: true, olResult: "", alResult: "", languageTest: "None", languageScore: "",
    stage: "Open", deactivated: false, deactivationReason: "", lossReason: "", assignedTo: rand(DB.users.filter(u => u.role === "Counsellor").map(u => u.id)),
    intakeId: "", domain: rand(picklist('domains')), isReferral: true, referralType: "Student", agentId,
    checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
    applicationForm: defaultApplicationForm(), tasks: [],
    createdAt: new Date().toISOString(), activity: [{ ts: new Date().toISOString(), user: "Agent Portal", type: "Create", text: "Lead submitted via Agent Portal" }]
  });
  logAudit("CREATE", "Lead (Agent)", `Agent ${agentId} submitted ${name}`);
  saveDB();
  closeModal();
  toast("Lead submitted, tagged with your Agency ID.", "success");
  renderAgentPortal(document.getElementById("content"));
}

/* ============================================================
   AUDIT LOG — UC80-82
   ============================================================ */
function renderAudit(root) {
  state.auditFilter = state.auditFilter || { user: "", action: "", entity: "", from: "", to: "", text: "" };
  const users = [...new Set(DB.auditLog.map(a => a.user))].sort();
  const actions = [...new Set(DB.auditLog.map(a => a.action))].sort();
  const entityTypes = [...new Set(DB.auditLog.map(a => (a.entity || "").split(":")[0]))].filter(Boolean).sort();
  const f = state.auditFilter;

  root.innerHTML = `
    <div class="page-header"><div><h1>Audit Log</h1><div class="sub">Full CRUD audit trail — who, when, old/new values (UC80) · dedicated entries for status/assignment/transfer changes (UC81) · admin-facing filters &amp; export (UC82)</div></div>
      <div style="display:flex;gap:8px;">
        <button class="btn secondary sm" onclick="exportAudit()">${icon("download")} CSV</button>
        <button class="btn sm" onclick="exportAuditPDF()" title="UC82">${icon("document")} Export PDF</button>
      </div>
    </div>
    <div class="toolbar">
      <select id="auditUser"><option value="">All Users</option>${users.map(u => `<option ${f.user === u ? "selected" : ""}>${esc(u)}</option>`).join("")}</select>
      <select id="auditAction"><option value="">All Actions</option>${actions.map(a => `<option ${f.action === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
      <select id="auditEntity"><option value="">All Entity Types</option>${entityTypes.map(e => `<option ${f.entity === e ? "selected" : ""}>${esc(e)}</option>`).join("")}</select>
      <input type="date" id="auditFrom" value="${f.from}" title="From date">
      <input type="date" id="auditTo" value="${f.to}" title="To date">
      <input type="text" id="auditSearch" placeholder="Free-text search..." value="${esc(f.text)}">
      <button class="btn secondary sm" onclick="clearAuditFilters()">Clear Filters</button>
    </div>
    <div class="table-wrap card"><table><thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
    <tbody id="auditBody"></tbody></table></div>
  `;
  ["auditUser", "auditAction", "auditEntity", "auditFrom", "auditTo"].forEach(id => {
    document.getElementById(id).onchange = e => { f[id.replace("audit", "").toLowerCase()] = e.target.value; renderAuditBody(); };
  });
  document.getElementById("auditSearch").oninput = e => { f.text = e.target.value; renderAuditBody(); };
  renderAuditBody();
}
function clearAuditFilters() {
  state.auditFilter = { user: "", action: "", entity: "", from: "", to: "", text: "" };
  renderAudit(document.getElementById("content"));
}
function auditRowsFiltered() {
  const f = state.auditFilter || {};
  const text = (f.text || "").toLowerCase();
  return DB.auditLog.filter(a => {
    if (f.user && a.user !== f.user) return false;
    if (f.action && a.action !== f.action) return false;
    if (f.entity && (a.entity || "").split(":")[0] !== f.entity) return false;
    if (f.from && a.ts < f.from) return false;
    if (f.to && a.ts.slice(0, 10) > f.to) return false;
    if (text && !(a.user + a.action + a.entity + a.details).toLowerCase().includes(text)) return false;
    return true;
  });
}
function renderAuditBody() {
  const body = document.getElementById("auditBody");
  const rows = auditRowsFiltered();
  body.innerHTML = rows.slice(0, 200).map(a => `<tr><td>${fmtDateTime(a.ts)}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td><td>${esc(a.entity)}</td><td>${esc(a.details)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty-state">No matching entries.</td></tr>`;
}
function exportAudit() {
  const rows = [["Timestamp", "User", "Action", "Entity", "Details"], ...auditRowsFiltered().map(a => [a.ts, a.user, a.action, a.entity, a.details])];
  downloadCSV("audit_log.csv", rows);
  logAudit("EXPORT", "AuditLog", `${rows.length - 1} entries exported as CSV (UC82)`);
  saveDB();
}
function exportAuditPDF() {
  const filtered = auditRowsFiltered();
  const f = state.auditFilter || {};
  const applied = [
    f.user ? "User: " + f.user : "", f.action ? "Action: " + f.action : "",
    f.entity ? "Entity: " + f.entity : "", f.from ? "From: " + f.from : "",
    f.to ? "To: " + f.to : "", f.text ? 'Search: "' + f.text + '"' : ""
  ].filter(Boolean).join("  ·  ") || "No filters applied";
  const rows = [["Timestamp", "User", "Action", "Entity", "Details"],
    ...filtered.slice(0, 500).map(a => [fmtDateTime(a.ts), a.user, a.action, a.entity, a.details])];
  const html = `<p class="small-muted"><b>Filters:</b> ${esc(applied)} — ${filtered.length} matching entr${filtered.length === 1 ? "y" : "ies"}${filtered.length > 500 ? " (first 500 shown)" : ""}</p>
    ${rowsToTableHTML(rows)}`;
  if (printToPDF({ title: "Audit Log", subtitle: "Full CRUD & pipeline audit trail (UC80 / UC81 / UC82)", html })) {
    logAudit("EXPORT_PDF", "AuditLog", `${filtered.length} entries exported as PDF (UC82)`);
    saveDB();
    toast("Opening print dialog — choose “Save as PDF”.", "success");
  }
}

/* ============================================================
   ADMIN SETTINGS
   ============================================================ */
const ADMIN_TABS = [
  ["pipeline", "Pipeline & Stages"],
  ["fields", "Fields & Picklists"],
  ["roles", "Roles & Users"],
  ["automation", "Automation & SLA"],
  ["commission", "Commission Rules"]
];

function renderAdmin(root) {
  const isAdmin = currentRole() === "Admin";
  state.adminTab = state.adminTab || "pipeline";
  root.innerHTML = `
    <div class="page-header">
      <div><h1>Admin Settings</h1><div class="sub">Runtime configuration — no code changes required. ${isAdmin ? "" : icon("lock") + " Read-only for " + esc(currentRole()) + "."}</div></div>
      ${isAdmin ? `<button class="btn secondary sm" onclick="exportConfigJSON()">${icon("download")} Export Config</button>` : ""}
    </div>
    <div class="tabs">${ADMIN_TABS.map(([k, l]) => `<div class="tab ${state.adminTab === k ? "active" : ""}" data-k="${k}">${l}</div>`).join("")}</div>
    <div id="adminBody"></div>
  `;
  document.querySelectorAll(".tabs .tab").forEach(t => t.onclick = () => { state.adminTab = t.dataset.k; renderAdmin(root); });
  renderAdminBody();
}

function exportConfigJSON() {
  const cfg = {
    statusLabels: DB.statusLabels, statusColors: DB.statusColors, transitionRules: DB.transitionRules,
    mandatoryFields: DB.mandatoryFields, checklistTemplate: DB.checklistTemplate,
    picklists: DB.picklists, duplicateRules: DB.duplicateRules, slaRules: DB.slaRules,
    rolePermissions: DB.rolePermissions, commissionRules: DB.commissionRules,
    deactivationMinDays: DB.deactivationMinDays, reportConfig: DB.reportConfig,
    scheduledReportEnabled: DB.scheduledReportEnabled
  };
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "uniconnect-config.json";
  a.click();
  logAudit("EXPORT", "Configuration", "Full admin configuration exported as JSON");
  saveDB();
  toast("Configuration exported.", "success");
}

function renderAdminBody() {
  const body = document.getElementById("adminBody");
  if (!body) return;
  const isAdmin = currentRole() === "Admin";
  const tab = state.adminTab;
  const lock = isAdmin ? "" : "disabled";
  const lockNote = isAdmin ? "" : "<p class='small-muted' style='margin-top:8px'>" + icon("lock") + " Only Admins can edit this.</p>";

  if (tab === "pipeline") body.innerHTML = adminPipelineHTML(lock, lockNote, isAdmin);
  if (tab === "fields") body.innerHTML = adminFieldsHTML(lock, lockNote, isAdmin);
  if (tab === "roles") body.innerHTML = adminRolesHTML(lock, lockNote, isAdmin);
  if (tab === "automation") body.innerHTML = adminAutomationHTML(lock, lockNote, isAdmin);
  if (tab === "commission") body.innerHTML = adminCommissionHTML(lock, lockNote, isAdmin);

  const roleSel = document.getElementById("permRoleSelect");
  if (roleSel) {
    state.permRole = state.permRole || roleSel.value;
    roleSel.value = state.permRole;
    roleSel.onchange = e => { state.permRole = e.target.value; renderPermEditor(); };
    renderPermEditor();
  }
}

function adminPipelineHTML(lock, lockNote, isAdmin) {
  const list = stages();
  return `
    <div class="card">
      <h3>Pipeline Stages <span class="pill">UC64</span></h3>
      <p class="small-muted">Add your own stages, rename them, recolour them or change their order. The four built-in stages carry engine behaviour (Converted fires the conversion automation and commission records; Closed drives loss analysis), so they can be reordered and renamed but not removed.</p>
      <div class="table-wrap"><table><thead><tr><th style="width:70px">Order</th><th>Display Label</th><th style="width:90px">Colour</th><th style="width:90px">Leads</th><th>Type</th><th style="width:150px"></th></tr></thead>
      <tbody>${list.map((s, i) => `<tr>
        <td>
          <button class="btn sm ghost" onclick="moveStage('${s}',-1)" ${i === 0 || !isAdmin ? "disabled" : ""} title="Move up">▲</button>
          <button class="btn sm ghost" onclick="moveStage('${s}',1)" ${i === list.length - 1 || !isAdmin ? "disabled" : ""} title="Move down">▼</button>
        </td>
        <td><input type="text" class="stageLabelInput" data-stage="${s}" value="${esc(stageLabel(s))}" ${lock}></td>
        <td><input type="color" class="stageColorInput" data-stage="${s}" value="${stageColor(s)}" style="width:56px;padding:2px" ${lock}></td>
        <td>${leadsInStage(s)}</td>
        <td>${isSystemStage(s) ? '<span class="badge open">Built-in</span>' : '<span class="badge closed">Custom</span>'}</td>
        <td>${isSystemStage(s) || !isAdmin ? "" : `<button class="btn sm danger" onclick="deleteStage('${s}')">Delete</button>`}</td>
      </tr>`).join("")}</tbody></table></div>
      ${isAdmin ? `
        <div class="toolbar" style="margin-top:14px;margin-bottom:0">
          <input type="text" id="newStageName" placeholder="New stage name, e.g. Application Sent" style="min-width:280px">
          <input type="color" id="newStageColor" value="${DEFAULT_STAGE_COLOR}" style="width:56px;padding:2px">
          <button class="btn sm" onclick="addStage()">+ Add Stage</button>
          <button class="btn sm secondary" onclick="saveStageLabels()">Save Labels &amp; Colours</button>
          <button class="btn sm secondary" onclick="resetStages()">Reset Pipeline</button>
        </div>` : lockNote}
    </div>

    <div class="card">
      <h3>Stage Transition Rules <span class="pill">UC37 / UC38 / UC64</span></h3>
      <p class="small-muted">Tick which forward transitions are permitted from each stage. Unchecked = blocked in Pipeline, Kanban and the Lead form (like Qualified → Open, UC37).</p>
      <div class="table-wrap"><table><thead><tr><th>From \\ To</th>${stages().map(s => `<th>${s}</th>`).join("")}</tr></thead>
      <tbody>${stages().map(from => `<tr><td><b>${stageBadge(from)}</b></td>${stages().map(to => `
        <td style="text-align:center">${from === to ? "<span class='small-muted'>—</span>" : `<input type="checkbox" class="transitionChk" data-from="${from}" data-to="${to}" ${(DB.transitionRules[from] || []).includes(to) ? "checked" : ""} ${!["Admin"].includes(currentRole()) ? "disabled" : ""}>`}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${currentRole() === "Admin" ? `<button class="btn sm" style="margin-top:10px" onclick="saveTransitionRules()">Save Rules</button> <button class="btn sm secondary" onclick="resetTransitionRules()">Reset to Defaults</button>` : "<p class='small-muted' style='margin-top:8px'>" + icon("lock") + " Only Admins can edit these rules.</p>"}
    </div>

    <div class="card">
      <h3>Pipeline Stage Targets <span class="pill">Pipeline Target vs Actual Dashboard</span></h3>
      <p class="small-muted">Target lead counts per stage, compared against actuals on the Head of Marketing dashboard.</p>
      <div class="table-wrap"><table><thead><tr><th>Stage</th><th style="width:140px">Target</th></tr></thead>
      <tbody>${stages().map(s => `<tr><td>${stageBadge(s)}</td><td><input type="number" min="0" class="stageTargetInput" data-stage="${s}" value="${stageTarget(s)}" ${lock}></td></tr>`).join("")}</tbody></table></div>
      ${isAdmin ? `<button class="btn sm" style="margin-top:10px" onclick="savePipelineStageTargets()">Save Targets</button>` : lockNote}
    </div>

    <div class="card">
      <h3>Mandatory Fields per Stage <span class="pill">UC59</span></h3>
      <p class="small-muted">Tick the fields a lead must have filled <b>before it may enter</b> each stage. Enforced in the lead form and on Kanban drag-and-drop. Academic result fields are auto-relaxed when "Results Pending" is set (UC56).</p>
      <div class="table-wrap"><table><thead><tr><th>Field</th>${stages().map(s => `<th style="text-align:center">${esc(stageLabel(s))}</th>`).join("")}</tr></thead>
      <tbody>${LEAD_FIELD_CATALOG.map(f => `<tr><td>${esc(f.label)}</td>${stages().map(s => `
        <td style="text-align:center"><input type="checkbox" class="mandChk" data-stage="${s}" data-field="${f.id}" ${mandatoryFieldsFor(s).includes(f.id) ? "checked" : ""} ${lock}></td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${isAdmin ? `<button class="btn sm" style="margin-top:10px" onclick="saveMandatoryFields()">Save Mandatory Fields</button> <button class="btn sm secondary" onclick="resetMandatoryFields()">Reset to Defaults</button>` : lockNote}
    </div>

    <div class="card">
      <h3>Lead Qualification Checklist <span class="pill">UC54</span></h3>
      <p class="small-muted">Items a counsellor must tick before a lead can advance. Applies to newly created leads; existing leads keep the checklist they were created with.</p>
      <div id="checklistEditor">${(DB.checklistTemplate || []).map((item, i) => `
        <div class="checkbox-row" style="margin-bottom:8px">
          <input type="text" class="checklistItem" value="${esc(item)}" ${lock}>
          ${isAdmin ? `<button class="btn sm ghost" onclick="removeChecklistItem(${i})" title="Remove">${icon("x")}</button>` : ""}
        </div>`).join("")}</div>
      ${isAdmin ? `<button class="btn sm secondary" onclick="addChecklistItem()">+ Add Item</button> <button class="btn sm" onclick="saveChecklistTemplate()">Save Checklist</button>` : lockNote}
    </div>
  `;
}

function adminFieldsHTML(lock, lockNote, isAdmin) {
  const lists = [
    ["universities", "Universities", "UC28 / UC48"],
    ["programs", "Programs", "UC63 / UC78"],
    ["districts", "Districts", "UC58"],
    ["countries", "Countries", ""],
    ["domains", "Tenants / Domains", "UC30"],
    ["leadSources", "Lead Sources", "UC21 / UC22 / UC47"],
    ["modesOfContact", "Mode of Contact", ""],
    ["digitalSubSources", "Digital Sub-Sources", "UC25"],
    ["lossReasons", "Loss Reasons", "UC77"],
    ["olSubjects", "O/L Subjects", "UC55"],
    ["alSubjects", "A/L Subjects", "UC55"]
  ];
  return `
    <div class="card">
      <h3>Form Picklists <span class="pill">UC25 / UC30 / UC58</span></h3>
      <p class="small-muted">One value per line. These drive every dropdown in the lead form, filters and reports. Removing a value already in use won't alter existing leads — they keep their stored value.</p>
      <div class="grid-2">
        ${lists.map(([key, label, uc]) => `
          <div class="field">
            <label>${esc(label)} <span class="pill">${uc}</span></label>
            <textarea class="picklistBox" data-key="${key}" rows="${Math.max(4, picklist(key).length)}" ${lock}>${esc(picklist(key).join("\n"))}</textarea>
          </div>`).join("")}
      </div>
      ${isAdmin ? `<button class="btn sm" onclick="savePicklists()">Save Picklists</button> <button class="btn sm secondary" onclick="resetPicklists()">Reset to Defaults</button>` : lockNote}
    </div>

    <div class="card">
      <h3>Program Types <span class="pill">Program-Based Field Configuration</span></h3>
      <p class="small-muted">Which academic fields the lead form shows depends on a program's type: Foundation → previous school + O/L or A/L; Master's → Bachelor's degree + university; Bachelor's/Other → the standard O/L/A/L capture.</p>
      <div class="table-wrap"><table><thead><tr><th>Program</th><th style="width:180px">Type</th></tr></thead>
      <tbody>${picklist('programs').map(p => `<tr><td>${esc(p)}</td><td>
        <select class="programTypeSel" data-program="${esc(p)}" ${lock}>${PROGRAM_TYPES.map(t => `<option ${programType(p) === t ? "selected" : ""}>${t}</option>`).join("")}</select>
      </td></tr>`).join("")}</tbody></table></div>
      ${isAdmin ? `<button class="btn sm" style="margin-top:10px" onclick="saveProgramTypes()">Save Program Types</button>` : lockNote}
    </div>

    <div class="card">
      <h3>Programs by University <span class="pill">Application Form — Educational Qualification</span></h3>
      <p class="small-muted">Tick which programs each university offers. Drives the University → Program cascade on the Apply Online application form.</p>
      <div class="table-wrap"><table><thead><tr><th>University \\ Program</th>${picklist('programs').map(p => `<th>${esc(p)}</th>`).join("")}</tr></thead>
      <tbody>${picklist('universities').map(uni => `<tr><td><b>${esc(uni)}</b></td>${picklist('programs').map(p => `
        <td style="text-align:center"><input type="checkbox" class="uniProgChk" data-uni="${esc(uni)}" data-program="${esc(p)}" ${programsForUniversity(uni).includes(p) ? "checked" : ""} ${lock}></td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${isAdmin ? `<button class="btn sm" style="margin-top:10px" onclick="saveProgramsByUniversity()">Save Programs by University</button>` : lockNote}
    </div>

    <div class="card">
      <h3>Lead Source Targets <span class="pill">Lead Source Dashboard</span></h3>
      <p class="small-muted">Target lead counts per source, compared against actuals on the Head of Marketing's Lead Source Dashboard.</p>
      <div class="table-wrap"><table><thead><tr><th>Lead Source</th><th style="width:140px">Target</th></tr></thead>
      <tbody>${picklist('leadSources').map(s => `<tr><td>${esc(s)}</td><td><input type="number" min="0" class="sourceTargetInput" data-source="${esc(s)}" value="${leadSourceTarget(s)}" ${lock}></td></tr>`).join("")}</tbody></table></div>
      ${isAdmin ? `<button class="btn sm" style="margin-top:10px" onclick="saveLeadSourceTargets()">Save Targets</button>` : lockNote}
    </div>

    <div class="card">
      <h3>Duplicate Detection Rules <span class="pill">UC60</span></h3>
      <p class="small-muted">Which fields are compared against existing leads when saving. If any ticked rule matches, the user is warned and may "Create Anyway" or abort.</p>
      <div class="checkbox-row" style="margin-bottom:8px"><input type="checkbox" id="dupMobile" ${(DB.duplicateRules || {}).matchMobile ? "checked" : ""} ${lock}><label style="margin:0;text-transform:none">Match on <b>Mobile</b></label></div>
      <div class="checkbox-row" style="margin-bottom:8px"><input type="checkbox" id="dupEmail" ${(DB.duplicateRules || {}).matchEmail ? "checked" : ""} ${lock}><label style="margin:0;text-transform:none">Match on <b>Email</b></label></div>
      <div class="checkbox-row"><input type="checkbox" id="dupName" ${(DB.duplicateRules || {}).matchName ? "checked" : ""} ${lock}><label style="margin:0;text-transform:none">Match on <b>Full Name</b> (stricter — more false positives)</label></div>
      ${isAdmin ? `<button class="btn sm" style="margin-top:12px" onclick="saveDuplicateRules()">Save Rules</button>` : lockNote}
    </div>
  `;
}

function adminRolesHTML(lock, lockNote, isAdmin) {
  return `
    <div class="card">
      <h3>Role-Based Dashboard &amp; Report Visibility <span class="pill">UC49</span></h3>
      <p class="small-muted">Tick which dashboard widgets and reports each role can see, and whether they may view commission amounts. Changes apply immediately — switch role in the top bar to verify.</p>
      <div class="field" style="max-width:280px"><label>Configure Role</label>
        <select id="permRoleSelect">${ROLES.map(r => `<option ${state.permRole === r ? "selected" : ""}>${r}</option>`).join("")}</select>
      </div>
      <div id="permEditor"></div>
    </div>

    <div class="card">
      <h3>Users, Hierarchy &amp; Tenant Scope <span class="pill">UC26 / UC27 / UC30 / UC34</span></h3>
      <p class="small-muted">Tenant scope partitions data <b>before</b> any role rule — a "Kandy Branch" user cannot see Colombo data regardless of role. "All" = global. Reporting line drives the escalation chain (UC34).</p>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Reports To</th><th>Tenant / Domain</th></tr></thead>
      <tbody>${DB.users.map(u => `<tr>
        <td>${esc(u.name)}</td>
        <td><select class="userRoleSel" data-uid="${u.id}" ${lock}>${ROLES.map(r => `<option ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
        <td><select class="userMgrSel" data-uid="${u.id}" ${lock}>
          <option value="">— none —</option>
          ${DB.users.filter(m => m.id !== u.id).map(m => `<option value="${m.id}" ${u.managerId === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
        </select></td>
        <td><select class="userDomainSel" data-uid="${u.id}" ${lock}>
          <option value="All" ${u.domain === "All" ? "selected" : ""}>All (global)</option>
          ${picklist('domains').map(d => `<option ${u.domain === d ? "selected" : ""}>${d}</option>`).join("")}
        </select></td></tr>`).join("")}</tbody></table></div>
      ${isAdmin ? `<button class="btn sm" style="margin-top:12px" onclick="saveUsers()">Save Users</button>` : lockNote}
    </div>
  `;
}

function adminAutomationHTML(lock, lockNote, isAdmin) {
  const sla = slaRules();
  return `
    <div class="card">
      <h3>Follow-Up SLA &amp; Escalation <span class="pill">UC32 / UC33 / UC46</span></h3>
      <div class="grid-3">
        <div class="field"><label>First-contact window (days) — UC33</label><input type="number" min="0" id="slaFirst" value="${sla.firstContactDays}" ${lock}></div>
        <div class="field"><label>Default follow-up interval (days)</label><input type="number" min="1" id="slaInterval" value="${sla.followUpIntervalDays}" ${lock}></div>
        <div class="field"><label>Grace period before escalation (days) — UC32</label><input type="number" min="0" id="slaGrace" value="${sla.graceDays}" ${lock}></div>
      </div>
      <p class="small-muted">A new lead with no logged activity after the first-contact window is flagged (UC33). An overdue follow-up escalates once past its due date plus the grace period (UC32), then up the reporting line to the Head of Dept. (UC34).</p>
      ${isAdmin ? `<button class="btn sm" onclick="saveSlaRules()">Save SLA Rules</button>` : lockNote}
    </div>

    <div class="card">
      <h3>Deactivation Criteria <span class="pill">UC41</span></h3>
      <div class="field" style="max-width:320px"><label>Minimum lead age before deactivation (days)</label>
        <input type="number" id="deactMinDays" value="${DB.deactivationMinDays}" min="0" ${lock}>
      </div>
      ${isAdmin ? `<button class="btn sm" onclick="saveDeactivationCriteria()">Save</button>` : lockNote}
      <p class="small-muted" style="margin-top:8px">Managers and above can override this per lead (AF1). Bulk deactivation skips leads that fail the criterion.</p>
    </div>

    <div class="card">
      <h3>Report Schedule &amp; Recipients <span class="pill">UC10 / UC12</span></h3>
      <div class="checkbox-row"><input type="checkbox" id="schedReportChk" ${DB.scheduledReportEnabled ? "checked" : ""} ${lock}><label style="margin:0;text-transform:none">Auto-generate commission report weekly (Friday 18:00)</label></div>
      <div class="field" style="margin-top:12px"><label>Finance Recipients (comma separated)</label><input id="reportRecipients" value="${esc((DB.reportConfig.recipients || []).join(", "))}" ${lock}></div>
      <div class="field"><label>Report Columns (comma separated)</label><input id="reportColumns" value="${esc((DB.reportConfig.columns || []).join(", "))}" ${lock}></div>
      <p class="small-muted">Recognised columns: Student Name, University, Program, Commission Amount, Commission %, Status, Email, Mobile, Intake, Counsellor, Amount Paid, Outstanding.</p>
      ${isAdmin ? `<button class="btn sm" onclick="saveReportConfig()">Save Settings</button> <button class="btn sm secondary" onclick="runScheduledReportJob()" title="UC10">▶ Run Scheduled Job Now</button>` : lockNote}
    </div>
  `;
}

function adminCommissionHTML(lock, lockNote, isAdmin) {
  return `
    <div class="card">
      <h3>Commission Eligibility Rules <span class="pill">UC14 / UC15 / UC19</span></h3>
      <div class="grid-3">
        <div class="field"><label>Payment Threshold (UC14)</label><input type="number" id="ruleThreshold" value="${(DB.commissionRules || {}).paymentThreshold || 0}" ${lock}></div>
        <div class="field"><label>Expiry / Claw-back Days (UC19)</label><input type="number" id="ruleExpiry" value="${(DB.commissionRules || {}).expiryDays || 25}" ${lock}></div>
        <div class="field"><label>&nbsp;</label>
          <div class="checkbox-row"><input type="checkbox" id="ruleOutstanding" ${(DB.commissionRules || {}).requireZeroOutstanding ? "checked" : ""} ${lock}><label style="margin:0;text-transform:none">Require zero outstanding (UC15)</label></div>
        </div>
      </div>
      <p class="small-muted">A converted lead becomes <b>Eligible</b> only when it clears every ticked rule; otherwise it is <b>Blocked</b>. Use “Re-validate All” on the Commission page to re-apply after changing these.</p>
      ${isAdmin ? `<button class="btn sm" onclick="saveCommissionRules()">Save Rules</button>` : lockNote}
    </div>
  `;
}

function renderPermEditor() {
  const el = document.getElementById("permEditor");
  if (!el) return;
  const role = state.permRole;
  const isAdmin = currentRole() === "Admin";
  DB.rolePermissions = DB.rolePermissions || defaultRolePermissions();
  const p = DB.rolePermissions[role] || { widgets: [], reports: [], viewAmounts: false };
  el.innerHTML = `
    <div class="grid-2">
      <div>
        <label>Dashboard Widgets</label>
        ${DASHBOARD_WIDGETS.map(w => `<div class="checkbox-row" style="padding:4px 0"><input type="checkbox" class="permWidget" value="${w.id}" ${(p.widgets || []).includes(w.id) ? "checked" : ""} ${isAdmin ? "" : "disabled"}><label style="margin:0;text-transform:none">${esc(w.label)}</label></div>`).join("")}
      </div>
      <div>
        <label>Reports</label>
        ${REPORT_DEFS.map(r => `<div class="checkbox-row" style="padding:4px 0"><input type="checkbox" class="permReport" value="${r.id}" ${(p.reports || []).includes(r.id) ? "checked" : ""} ${isAdmin ? "" : "disabled"}><label style="margin:0;text-transform:none">${esc(r.label)}</label></div>`).join("")}
      </div>
    </div>
    <hr class="sep">
    <div class="checkbox-row"><input type="checkbox" id="permViewAmounts" ${p.viewAmounts ? "checked" : ""} ${isAdmin ? "" : "disabled"}><label style="margin:0;text-transform:none">May view commission <b>amounts</b> (unchecked = masked, UC20 / UC79)</label></div>
    ${isAdmin ? `<button class="btn sm" style="margin-top:12px" onclick="saveRolePermissions()">Save Permissions for ${esc(role)}</button>` : "<p class='small-muted' style='margin-top:8px'>" + icon("lock") + " Only Admins can edit role permissions.</p>"}
  `;
}
function saveRolePermissions() {
  const role = state.permRole;
  DB.rolePermissions[role] = {
    widgets: Array.from(document.querySelectorAll(".permWidget:checked")).map(c => c.value),
    reports: Array.from(document.querySelectorAll(".permReport:checked")).map(c => c.value),
    viewAmounts: document.getElementById("permViewAmounts").checked
  };
  logAudit("UPDATE", "RolePermissions:" + role, `widgets=${DB.rolePermissions[role].widgets.length}, reports=${DB.rolePermissions[role].reports.length}, viewAmounts=${DB.rolePermissions[role].viewAmounts} (UC49)`);
  saveDB();
  toast(`Permissions saved for ${role}.`, "success");
}
function saveUsers() {
  let changes = 0;
  document.querySelectorAll(".userDomainSel").forEach(sel => {
    const u = DB.users.find(x => x.id === sel.dataset.uid);
    if (u && u.domain !== sel.value) { logAudit("UPDATE", "User:" + u.id, `Tenant ${u.domain} → ${sel.value} (UC30)`); u.domain = sel.value; changes++; }
  });
  document.querySelectorAll(".userRoleSel").forEach(sel => {
    const u = DB.users.find(x => x.id === sel.dataset.uid);
    if (u && u.role !== sel.value) { logAudit("UPDATE", "User:" + u.id, `Role ${u.role} → ${sel.value}`); u.role = sel.value; changes++; }
  });
  document.querySelectorAll(".userMgrSel").forEach(sel => {
    const u = DB.users.find(x => x.id === sel.dataset.uid);
    const val = sel.value || null;
    if (u && u.managerId !== val) { logAudit("UPDATE", "User:" + u.id, `Reports-to ${userName(u.managerId)} → ${val ? userName(val) : "none"} (UC34)`); u.managerId = val; changes++; }
  });
  saveDB();
  toast(changes ? `${changes} user change(s) saved.` : "No changes.", "success");
  router();
}

/* ---- UC59: mandatory fields per stage ---- */
function saveMandatoryFields() {
  const rules = {};
  stages().forEach(s => rules[s] = []);
  document.querySelectorAll(".mandChk:checked").forEach(chk => rules[chk.dataset.stage].push(chk.dataset.field));
  DB.mandatoryFields = rules;
  logAudit("UPDATE", "MandatoryFields", stages().map(s => `${s}: ${rules[s].join("/") || "none"}`).join(" | "));
  saveDB();
  toast("Mandatory field rules saved (UC59).", "success");
}
function resetMandatoryFields() {
  DB.mandatoryFields = JSON.parse(JSON.stringify(STAGE_MANDATORY_FIELDS));
  logAudit("RESET", "MandatoryFields", "Reset to defaults");
  saveDB();
  toast("Mandatory fields reset.", "success");
  renderAdminBody();
}

/* ---- UC54: qualification checklist ---- */
function collectChecklistInputs() {
  return Array.from(document.querySelectorAll(".checklistItem")).map(i => i.value.trim()).filter(Boolean);
}
function addChecklistItem() {
  DB.checklistTemplate = collectChecklistInputs().concat("New checklist item");
  saveDB();
  renderAdminBody();
}
function removeChecklistItem(idx) {
  const items = collectChecklistInputs();
  items.splice(idx, 1);
  DB.checklistTemplate = items;
  saveDB();
  renderAdminBody();
}
function saveChecklistTemplate() {
  const items = collectChecklistInputs();
  if (!items.length) { toast("Keep at least one checklist item.", "error"); return; }
  DB.checklistTemplate = items;
  logAudit("UPDATE", "ChecklistTemplate", `${items.length} item(s): ${items.join(" / ")}`);
  saveDB();
  toast("Qualification checklist saved (UC54).", "success");
  renderAdminBody();
}

/* ---- UC25 / UC30 / UC58: picklists ---- */
function savePicklists() {
  DB.picklists = DB.picklists || {};
  let empties = [];
  document.querySelectorAll(".picklistBox").forEach(box => {
    const vals = box.value.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
    if (!vals.length) { empties.push(box.dataset.key); return; }
    DB.picklists[box.dataset.key] = vals;
  });
  logAudit("UPDATE", "Picklists", Object.keys(DB.picklists).map(k => `${k}:${DB.picklists[k].length}`).join(", "));
  saveDB();
  toast(empties.length ? `Saved — ${empties.join(", ")} left unchanged (cannot be empty).` : "Picklists saved.", empties.length ? "warn" : "success");
  renderAdminBody();
}
function resetPicklists() {
  DB.picklists = {
    universities: UNIVERSITIES.slice(), programs: PROGRAMS.slice(), districts: DISTRICTS.slice(),
    countries: COUNTRIES.slice(), domains: DOMAINS.slice(), leadSources: LEAD_SOURCES.slice(),
    modesOfContact: MODES_OF_CONTACT.slice(),
    digitalSubSources: DIGITAL_SUBSOURCES.slice(), lossReasons: LOSS_REASONS.slice(),
    olSubjects: OL_SUBJECTS.slice(), alSubjects: AL_SUBJECTS.slice()
  };
  logAudit("RESET", "Picklists", "Reset to defaults");
  saveDB();
  toast("Picklists reset to defaults.", "success");
  renderAdminBody();
}

/* ---- UC60: duplicate detection ---- */
function saveDuplicateRules() {
  DB.duplicateRules = {
    matchMobile: document.getElementById("dupMobile").checked,
    matchEmail: document.getElementById("dupEmail").checked,
    matchName: document.getElementById("dupName").checked
  };
  logAudit("UPDATE", "DuplicateRules", JSON.stringify(DB.duplicateRules));
  saveDB();
  toast("Duplicate detection rules saved (UC60).", "success");
}

/* ---- UC32 / UC33: SLA timings ---- */
function saveSlaRules() {
  DB.slaRules = {
    firstContactDays: Math.max(0, Number(document.getElementById("slaFirst").value || 1)),
    followUpIntervalDays: Math.max(1, Number(document.getElementById("slaInterval").value || 5)),
    graceDays: Math.max(0, Number(document.getElementById("slaGrace").value || 1))
  };
  logAudit("UPDATE", "SLARules", JSON.stringify(DB.slaRules));
  saveDB();
  toast("SLA & escalation rules saved.", "success");
}
function saveCommissionRules() {
  DB.commissionRules = DB.commissionRules || {};
  DB.commissionRules.paymentThreshold = Number(document.getElementById("ruleThreshold").value || 0);
  DB.commissionRules.expiryDays = Number(document.getElementById("ruleExpiry").value || 25);
  DB.commissionRules.requireZeroOutstanding = document.getElementById("ruleOutstanding").checked;
  logAudit("UPDATE", "CommissionRules", `threshold=${DB.commissionRules.paymentThreshold}, expiry=${DB.commissionRules.expiryDays}d, zeroOutstanding=${DB.commissionRules.requireZeroOutstanding}`);
  saveDB();
  toast("Commission eligibility rules saved. Use 'Re-validate All' to apply.", "success");
}
/* ---- UC64: pipeline stage management ---- */
function addStage() {
  const nameEl = document.getElementById("newStageName");
  const label = nameEl.value.trim();
  if (!label) { toast("Enter a stage name.", "error"); return; }
  const existing = stages();
  if (existing.some(s => stageLabel(s).toLowerCase() === label.toLowerCase())) {
    toast("A stage with that name already exists.", "error"); return;
  }
  const key = stageKeyFrom(label, existing);
  // Insert before the terminal "Closed" stage if it's last, otherwise append.
  const closedIdx = existing.indexOf("Closed");
  const insertAt = closedIdx === existing.length - 1 && closedIdx > 0 ? closedIdx : existing.length;

  DB.stages = existing.slice(0, insertAt).concat(key, existing.slice(insertAt));
  DB.statusLabels[key] = label;
  DB.statusColors[key] = document.getElementById("newStageColor").value || DEFAULT_STAGE_COLOR;
  DB.mandatoryFields[key] = []; // nothing mandatory until configured
  // Splice it into the flow: the new stage inherits the outbound moves of the stage
  // before it, and that stage now advances into the new one instead.
  const prev = DB.stages[DB.stages.indexOf(key) - 1];
  DB.transitionRules[key] = prev ? (DB.transitionRules[prev] || []).slice() : [];
  if (prev) DB.transitionRules[prev] = [key];
  logAudit("CREATE", "Stage:" + key, `Stage "${label}" added to pipeline (UC64)`);
  saveDB();
  nameEl.value = "";
  toast(`Stage "${label}" added before the terminal stage — use ▲▼ to reposition it.`, "success");
  renderAdminBody();
}

function deleteStage(key) {
  if (isSystemStage(key)) { toast("Built-in stages cannot be deleted.", "error"); return; }
  const inUse = leadsInStage(key);
  // UC64 - AF1: a status in use must have its leads reassigned first
  if (inUse) {
    toast(`Cannot delete — ${inUse} lead(s) are still in "${stageLabel(key)}". Move them first (UC64 - AF1).`, "error");
    return;
  }
  confirmModal({
    title: "Delete this stage?",
    message: `"${stageLabel(key)}" will be removed from the pipeline, along with its transition rules and mandatory-field settings. This cannot be undone.`,
    confirmLabel: "Delete Stage",
    danger: true,
    onConfirm: () => {
      DB.stages = stages().filter(s => s !== key);
      delete DB.statusLabels[key];
      delete DB.statusColors[key];
      delete DB.transitionRules[key];
      delete DB.mandatoryFields[key];
      // Drop any inbound transitions pointing at the removed stage
      Object.keys(DB.transitionRules).forEach(from => {
        DB.transitionRules[from] = (DB.transitionRules[from] || []).filter(t => t !== key);
      });
      logAudit("DELETE", "Stage:" + key, `Stage removed from pipeline (UC64)`);
      saveDB();
      toast("Stage deleted.", "success");
      renderAdminBody();
    }
  });
}

function moveStage(key, dir) {
  const list = stages().slice();
  const i = list.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  list[i] = list[j]; list[j] = key;
  DB.stages = list;
  logAudit("UPDATE", "Stage:" + key, `Reordered to position ${j + 1} (UC64)`);
  saveDB();
  renderAdminBody();
}

function saveStageLabels() {
  document.querySelectorAll(".stageLabelInput").forEach(inp => {
    DB.statusLabels[inp.dataset.stage] = inp.value.trim() || inp.dataset.stage;
  });
  document.querySelectorAll(".stageColorInput").forEach(inp => {
    DB.statusColors[inp.dataset.stage] = inp.value;
  });
  logAudit("UPDATE", "Stages", "Stage labels/colours updated (UC64)");
  saveDB();
  toast("Stage labels & colours saved.", "success");
  renderAdminBody();
}

function resetStages() {
  const custom = stages().filter(s => !isSystemStage(s));
  const blocked = custom.filter(s => leadsInStage(s) > 0);
  if (blocked.length) {
    toast(`Cannot reset — leads still sit in: ${blocked.map(stageLabel).join(", ")} (UC64 - AF1).`, "error");
    return;
  }
  confirmModal({
    title: "Reset the pipeline?",
    message: "The pipeline returns to the four built-in stages. Custom stages, their labels, colours, transition rules and mandatory-field settings will be removed.",
    confirmLabel: "Reset Pipeline",
    danger: true,
    onConfirm: () => {
      DB.stages = STAGES.slice();
      DB.statusLabels = STAGES.reduce((m, s) => (m[s] = s, m), {});
      DB.statusColors = Object.assign({}, STAGE_COLORS);
      DB.transitionRules = JSON.parse(JSON.stringify(STAGE_TRANSITIONS));
      DB.mandatoryFields = JSON.parse(JSON.stringify(STAGE_MANDATORY_FIELDS));
      logAudit("RESET", "Stages", "Pipeline reset to built-in stages");
      saveDB();
      toast("Pipeline reset to defaults.", "success");
      renderAdminBody();
    }
  });
}

function saveTransitionRules() {
  const rules = {};
  stages().forEach(s => rules[s] = []);
  document.querySelectorAll(".transitionChk").forEach(chk => {
    if (chk.checked) rules[chk.dataset.from].push(chk.dataset.to);
  });
  DB.transitionRules = rules;
  logAudit("UPDATE", "StageTransitionRules", JSON.stringify(rules));
  saveDB();
  toast("Stage transition rules updated (UC38).", "success");
  renderAdmin(document.getElementById("content"));
}
function resetTransitionRules() {
  DB.transitionRules = JSON.parse(JSON.stringify(STAGE_TRANSITIONS));
  logAudit("RESET", "StageTransitionRules", "Reset to defaults");
  saveDB();
  toast("Transition rules reset to defaults.", "success");
  renderAdmin(document.getElementById("content"));
}
function savePipelineStageTargets() {
  const targets = Object.assign({}, DB.pipelineStageTargets);
  document.querySelectorAll(".stageTargetInput").forEach(inp => {
    targets[inp.dataset.stage] = Math.max(0, Number(inp.value || 0));
  });
  DB.pipelineStageTargets = targets;
  logAudit("UPDATE", "PipelineStageTargets", JSON.stringify(targets));
  saveDB();
  toast("Pipeline stage targets saved.", "success");
}
function saveProgramTypes() {
  const types = Object.assign({}, DB.programTypes);
  document.querySelectorAll(".programTypeSel").forEach(sel => { types[sel.dataset.program] = sel.value; });
  DB.programTypes = types;
  logAudit("UPDATE", "ProgramTypes", JSON.stringify(types));
  saveDB();
  toast("Program types saved.", "success");
}
function saveProgramsByUniversity() {
  const map = {};
  picklist('universities').forEach(u => map[u] = []);
  document.querySelectorAll(".uniProgChk").forEach(chk => {
    if (chk.checked) (map[chk.dataset.uni] = map[chk.dataset.uni] || []).push(chk.dataset.program);
  });
  DB.programsByUniversity = map;
  logAudit("UPDATE", "ProgramsByUniversity", JSON.stringify(map));
  saveDB();
  toast("Programs by university saved.", "success");
}
function saveLeadSourceTargets() {
  const targets = Object.assign({}, DB.leadSourceTargets);
  document.querySelectorAll(".sourceTargetInput").forEach(inp => {
    targets[inp.dataset.source] = Math.max(0, Number(inp.value || 0));
  });
  DB.leadSourceTargets = targets;
  logAudit("UPDATE", "LeadSourceTargets", JSON.stringify(targets));
  saveDB();
  toast("Lead source targets saved.", "success");
}
function saveDeactivationCriteria() {
  DB.deactivationMinDays = Math.max(0, Number(document.getElementById("deactMinDays").value || 0));
  logAudit("UPDATE", "DeactivationCriteria", "Min days = " + DB.deactivationMinDays);
  saveDB();
  toast("Deactivation criteria saved.", "success");
}
function runScheduledReportJob() {
  if (!DB.scheduledReportEnabled) { toast("Scheduled report generation is disabled — enable it first.", "warn"); return; }
  generateCommissionReport({});
  logAudit("SCHEDULED_RUN", "CommissionEngine", "Weekly scheduled report job executed manually for demo (UC10)");
  toast("Scheduled weekly report job executed — see Commission → Report Workflow.", "success");
}
function saveReportConfig() {
  DB.scheduledReportEnabled = document.getElementById("schedReportChk").checked;
  DB.reportConfig.recipients = document.getElementById("reportRecipients").value.split(",").map(s => s.trim()).filter(Boolean);
  DB.reportConfig.columns = document.getElementById("reportColumns").value.split(",").map(s => s.trim()).filter(Boolean);
  logAudit("UPDATE", "ReportConfig", "Recipients/columns updated (UC12)");
  saveDB();
  toast("Report configuration saved.", "success");
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
  renderTopBar();
  renderSidebar();
  // Setting the hash fires `hashchange`, which calls router() on its own — calling it
  // again here would render the dashboard twice on every cold start.
  if (!location.hash) location.hash = "#/dashboard";
  else router();
}
init();

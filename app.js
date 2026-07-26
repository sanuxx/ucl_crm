/* ============================================================
   UniConnect CRM Demo — App Router & Views
   ============================================================ */

loadDB();

let state = {
  leadTab: "Open",
  leadFilter: { search: "", university: "", program: "", source: "", digitalSub: "", domain: "", nonCollectible: false },
  pipelineFilter: { program: "" },
  reportsTab: "status",
  commissionTab: "plans"
};

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

  roleSelect.onchange = () => { refreshUserSelect(); refreshAvatar(); saveDB(); renderSidebar(); renderNotificationBell(); router(); };
  userSelect.onchange = () => { DB.currentUserId = userSelect.value; refreshAvatar(); saveDB(); renderSidebar(); renderNotificationBell(); router(); };

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
  "audit": ["Admin", "Head of Marketing", "CEO"],
  "admin": ["Admin"],
  "agent-portal": ["Agent", "Manager", "Admin"],
  "intakes": ["Admin", "Manager", "Head of Marketing", "CEO", "Counsellor"]
};

function renderSidebar() {
  const role = currentRole();
  document.querySelectorAll(".nav-item").forEach(item => {
    const view = item.dataset.view;
    const perm = NAV_PERMS[view];
    item.style.display = (!perm || perm.includes(role)) ? "" : "none";
  });
}

/* ---------------- Router ---------------- */
function router() {
  const hash = location.hash.replace("#/", "") || "dashboard";
  const view = hash.split("?")[0];
  document.querySelectorAll(".nav-item").forEach(i => i.classList.toggle("active", i.dataset.view === view));
  const content = document.getElementById("content");
  const renderers = {
    dashboard: renderDashboard,
    leads: renderLeads,
    pipeline: renderPipeline,
    followups: renderFollowups,
    inquiries: renderInquiries,
    commission: renderCommission,
    reports: renderReports,
    intakes: renderIntakes,
    "agent-portal": renderAgentPortal,
    audit: renderAudit,
    admin: renderAdmin
  };
  const perm = NAV_PERMS[view];
  if (perm && !perm.includes(currentRole())) {
    content.innerHTML = `<div class="empty-state">🚫 Your role (${currentRole()}) does not have access to this section.</div>`;
    return;
  }
  (renderers[view] || renderDashboard)(content);
}
window.addEventListener("hashchange", router);

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard(root) {
  const leads = visibleLeads();
  const stageCounts = {};
  STAGES.forEach(s => stageCounts[s] = leads.filter(l => l.stage === s && !l.deactivated).length);
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
  const pills = STAGES.map(s => {
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

  root.innerHTML = `
    <div class="hero">
      <div class="hero-left">
        <h1>Welcome back, <b>${esc(firstName)}</b></h1>
        <div class="sub">${esc(currentRole())}${getCurrentUser().domain && getCurrentUser().domain !== "All" ? " · " + esc(getCurrentUser().domain) : " · Global access"} — ${leads.length} lead(s) in your view</div>
        <div class="progress-pills">${pills}</div>
      </div>
      <div class="hero-stats">
        <div class="hstat"><div class="hs-value">${leads.filter(l => !l.deactivated).length}</div><div class="hs-label"><i>👥</i>Active Leads</div></div>
        <div class="hstat"><div class="hs-value">${stageCounts.Converted}</div><div class="hs-label"><i>🎓</i>Enrolments</div></div>
        <div class="hstat"><div class="hs-value">${overdue}</div><div class="hs-label"><i>⏰</i>Overdue</div></div>
      </div>
    </div>

    <div class="page-header" style="margin-bottom:18px">
      <div></div>
      <button class="btn secondary sm" onclick="if(confirm('Reset all demo data?')){resetDB();router();}">↺ Reset Demo Data</button>
    </div>

    ${statRow ? `<div class="widget-grid">${statRow}</div>` : ""}

    <div class="two-col">
      ${canViewWidget("pipeline") ? `<div class="card">
        <h3>Pipeline Summary by Stage <span class="pill">UC62 / UC85</span></h3>
        ${simpleBarChart(STAGES.map(s => ({ label: stageLabel(s), value: stageCounts[s], color: stageColor(s) })))}
      </div>` : ""}
      ${canViewWidget("followups") ? `<div class="card">
        <h3>Follow-Up Status <span class="pill">UC86</span></h3>
        <div style="display:flex;gap:10px;text-align:center;">
          <div style="flex:1"><div style="font-size:24px;font-weight:700;color:var(--red)">${overdue}</div><div class="small-muted">Overdue</div></div>
          <div style="flex:1"><div style="font-size:24px;font-weight:700;color:var(--amber)">${today}</div><div class="small-muted">Due Today</div></div>
          <div style="flex:1"><div style="font-size:24px;font-weight:700;color:var(--green)">${upcoming}</div><div class="small-muted">Upcoming</div></div>
        </div>
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
      ? `<div class="empty-state">No dashboard widgets are enabled for the ${esc(currentRole())} role (UC49).</div>` : ""}
  `;
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
        <button class="btn secondary" onclick="openExhibitionModal()">📱 Exhibition Quick Capture</button>
        <button class="btn secondary" onclick="openBulkUploadModal()">⬆ Bulk Upload</button>
        <button class="btn" onclick="openLeadModal()">+ New Lead</button>
      </div>
    </div>
    ${fullVisibility ? `<div class="notice info">🌐 Full, unrestricted lead visibility granted for strategic oversight — no row-level filtering applied to this role (UC29). Access is still logged in the Audit Log (UC80).</div>` : ""}

    <div class="toolbar">
      <input type="text" id="leadSearch" placeholder="Search name, mobile, email..." value="${esc(f.search)}">
      <select id="filterUniversity"><option value="">All Universities</option>${UNIVERSITIES.map(u => `<option ${f.university === u ? "selected" : ""}>${u}</option>`).join("")}</select>
      <select id="filterProgram"><option value="">All Programs</option>${PROGRAMS.map(p => `<option ${f.program === p ? "selected" : ""}>${p}</option>`).join("")}</select>
      <select id="filterSource"><option value="">All Sources</option>${LEAD_SOURCES.map(s => `<option ${f.source === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select id="filterDigitalSub" class="${f.source === "Digital" ? "" : "hidden"}" title="Digital lead sub-source (UC25)"><option value="">All Digital Sub-Sources — UC25</option>${DIGITAL_SUBSOURCES.map(s => `<option ${f.digitalSub === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select id="filterDomain"><option value="">All Domains / Branches</option>${DOMAINS.map(d => `<option ${f.domain === d ? "selected" : ""}>${d}</option>`).join("")}</select>
      <button class="btn secondary sm" onclick="openSaveSegmentModal()">💾 Save as Segment</button>
      ${canBulkAction() ? `<button class="btn secondary sm ${f.nonCollectible ? "danger" : ""}" id="nonCollectibleBtn" title="UC40">🎯 Non-Collectible Candidates</button><button class="btn secondary sm" id="bulkAssignBtn">Bulk Assign</button><button class="btn secondary sm" id="bulkDeactivateBtn">Bulk Deactivate Non-Collectible</button><button class="btn secondary sm" id="bulkIntakeBtn">Bulk Assign Intake</button>` : ""}
    </div>
    ${f.nonCollectible ? `<div class="notice">🎯 Showing Non-Collectible Candidates — leads with no activity for 14+ days that are still Open/Qualified (UC40 pre-defined filter). Select rows and click "Bulk Deactivate" to clear them out.</div>` : ""}
    ${(DB.segments || []).length ? `<div class="chip-row">${DB.segments.map((s, idx) => `<div class="chip" onclick='applySegment(${idx})'>${esc(s.name)}</div>`).join("")}</div>` : ""}

    <div class="tabs" id="leadTabs">
      ${STAGES.concat(["Deactivated"]).map(s => {
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
  document.querySelectorAll("#leadTabs .tab").forEach(t => t.onclick = () => { state.leadTab = t.dataset.tab; renderLeads(root); });
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
      <div class="field"><label>Interested Program</label><select id="ex_program">${PROGRAMS.map(p => `<option>${p}</option>`).join("")}</select></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveExhibitionLead()">Submit</button></div>
  `);
}
function saveExhibitionLead() {
  const name = document.getElementById("ex_name").value.trim();
  const mobile = document.getElementById("ex_mobile").value.trim();
  if (!name || !mobile) { toast("Name and mobile required.", "error"); return; }
  DB.leads.push({
    id: uid("lead"), name, mobile, email: document.getElementById("ex_email").value.trim(), leadSource: "Exhibition",
    studentId: "", staffName: "", university: "", program: document.getElementById("ex_program").value, district: "",
    districtOther: "", examType: "Local A/L", resultsPending: true, olResult: "", alResult: "", languageTest: "None", languageScore: "",
    stage: "Open", deactivated: false, deactivationReason: "", lossReason: "", assignedTo: rand(DB.users.filter(u => u.role === "Counsellor").map(u => u.id)),
    intakeId: "", domain: rand(DOMAINS), isReferral: false, referralType: "", agentId: "",
    checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
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
    wrap.innerHTML = `<div class="empty-state">No leads in this stage. (UC23 - AF1)</div>`;
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
            ${canBulkAction() ? `<td><input type="checkbox" class="rowSel" data-id="${l.id}"></td>` : ""}
            <td><a href="javascript:void(0)" onclick="openLeadModal('${l.id}')"><b>${esc(l.name)}</b></a><div class="small-muted">${esc(l.mobile)}</div></td>
            <td>${esc(l.leadSource)}${l.digitalSubSource ? " · " + esc(l.digitalSubSource) : ""}</td>
            <td>${esc(l.university) || "<span class='small-muted'>—</span>"}<div class="small-muted">${esc(l.program) || ""}</div></td>
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
  if (selAll) selAll.onchange = () => document.querySelectorAll(".rowSel").forEach(c => c.checked = selAll.checked);
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
  return Array.from(document.querySelectorAll(".rowSel:checked")).map(c => c.dataset.id);
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
          <option value="__auto__">🔀 Auto-distribute (round robin)</option>
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
        email: `${first}.${last}@bulk.example.com`.toLowerCase(), leadSource: "Bulk Upload", studentId: "", staffName: "",
        university: rand(UNIVERSITIES), program: rand(PROGRAMS), district: rand(DISTRICTS), examType: "Local A/L",
        resultsPending: true, olResult: "", alResult: "", languageTest: "None", languageScore: "",
        stage: "Open", deactivated: false, deactivationReason: "", lossReason: "", assignedTo: rand(DB.users.filter(u => u.role === "Counsellor").map(u => u.id)),
        intakeId: "", domain: rand(DOMAINS), isReferral: false, referralType: "", agentId: "",
        checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
        createdAt: new Date().toISOString(), activity: [{ ts: new Date().toISOString(), user: "System", type: "Create", text: "Bulk imported (UC24/UC53), auto-classified to Open" }]
      };
      DB.leads.push(lead);
    } else {
      DB.inquiries.push({ id: uid("inq"), name: `${first} ${last}`, mobile: "07" + Math.floor(10000000 + Math.random() * 89999999), email: `${first}.${last}@bulk.example.com`, program: rand(PROGRAMS), source: "Bulk Import", createdAt: new Date().toISOString(), convertedToLead: false });
    }
    count++;
  }
  logAudit("BULK_IMPORT", importType, `${count} rows imported`);
  saveDB();
  document.getElementById("uploadSummary").innerHTML = `<div class="notice success">✅ ${count} ${importType.toLowerCase()} imported successfully and placed in the follow-up workflow.</div>`;
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
          id: uid("lead"), name: row.name, mobile: row.mobile, email: row.email || "", leadSource: "Bulk Upload",
          studentId: "", staffName: "", university: row.university || "", program: row.program || "", district: "Other",
          examType: "Local A/L", resultsPending: true, olResult: "", alResult: "", languageTest: "None", languageScore: "",
          stage: "Open", deactivated: false, deactivationReason: "", lossReason: "", assignedTo: rand(DB.users.filter(u => u.role === "Counsellor").map(u => u.id)),
          intakeId: "", domain: rand(DOMAINS), isReferral: false, referralType: "", agentId: "",
          checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
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
function openLeadModal(leadId) {
  const isNew = !leadId;
  const lead = isNew ? null : DB.leads.find(l => l.id === leadId);
  window.__editingLead = isNew ? {
    id: null, name: "", mobile: "", email: "", leadSource: "Student", digitalSubSource: "",
    studentId: "", staffName: "", university: "", program: "", district: "", districtOther: "",
    examType: "Local A/L", resultsPending: false, olResult: "", alResult: "", languageTest: "None", languageScore: "",
    stage: "Open", deactivated: false, deactivationReason: "", lossReason: "", assignedTo: DB.users.find(u => u.role === "Counsellor").id,
    intakeId: "", domain: DOMAINS[0], isReferral: false, referralType: "", agentId: "",
    checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
    createdAt: new Date().toISOString(), activity: []
  } : JSON.parse(JSON.stringify(lead));

  window.__leadModalTab = "details";
  renderLeadModal();
}

function renderLeadModal() {
  const L = window.__editingLead;
  const isNew = !L.id;
  const tab = window.__leadModalTab;

  const tabs = isNew ? [["details", "Details"]] : [["details", "Details"], ["academic", "Academic"], ["checklist", "Checklist"], ["timeline", "Timeline"]];

  openModal(`
    <div class="modal-header"><h2>${isNew ? "New Lead (UC21/UC22)" : esc(L.name)}</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      ${!isNew ? `<div style="margin-bottom:10px">${stageBadge(L.stage)} ${L.deactivated ? "<span class='badge deactivated'>Deactivated</span>" : ""} ${L.resultsPending ? "<span class='badge pending'>Pending Results</span>" : ""}</div>` : ""}
      <div class="detail-tabs">${tabs.map(([k, label]) => `<div class="tab ${tab === k ? "active" : ""}" onclick="window.__leadModalTab='${k}';renderLeadModal();">${label}</div>`).join("")}</div>
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
          <select id="f_source">${LEAD_SOURCES.map(s => `<option ${L.leadSource === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>
        <div class="field ${L.leadSource === "Digital" ? "" : "hidden"}" id="wrap_digitalSub"><label>Digital Sub-Source</label>
          <select id="f_digitalSub">${DIGITAL_SUBSOURCES.map(s => `<option ${L.digitalSubSource === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>
        <div class="field ${L.leadSource === "Student" ? "" : "hidden"}" id="wrap_studentId"><label class="required">Student ID <span class="pill">UC21 dynamic</span></label><input id="f_studentId" value="${esc(L.studentId)}"></div>
        <div class="field ${L.leadSource === "Staff" ? "" : "hidden"}" id="wrap_staffName"><label class="required">Staff Name <span class="pill">UC22 dynamic</span></label><input id="f_staffName" value="${esc(L.staffName)}"></div>
        <div class="field"><label>University</label><select id="f_university"><option value="">-- Select --</option>${UNIVERSITIES.map(u => `<option ${L.university === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
        <div class="field"><label>Program</label><select id="f_program"><option value="">-- Select --</option>${PROGRAMS.map(p => `<option ${L.program === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
        <div class="field"><label>District <span class="pill">UC58</span></label>
          <select id="f_district">${DISTRICTS.map(d => `<option ${L.district === d ? "selected" : ""}>${d}</option>`).join("")}</select>
        </div>
        <div class="field ${L.district === "Other" ? "" : "hidden"}" id="wrap_districtOther"><label>Specify District <span class="pill">UC58 - AF1</span></label><input id="f_districtOther" value="${esc(L.districtOther || "")}" placeholder="Enter district manually"></div>
        <div class="field"><label>Intake Cycle</label><select id="f_intake"><option value="">-- None --</option>${DB.intakes.map(i => `<option value="${i.id}" ${L.intakeId === i.id ? "selected" : ""}>${i.name}</option>`).join("")}</select></div>
        <div class="field"><label>Assigned Counsellor</label>
          <select id="f_assigned" ${!canTransferLeads() && !isNew ? "disabled" : ""}>
            ${DB.users.filter(u => u.role === "Counsellor").map(u => `<option value="${u.id}" ${L.assignedTo === u.id ? "selected" : ""}>${u.name}</option>`).join("")}
          </select>
          ${!canTransferLeads() && !isNew ? '<div class="small-muted">🔒 Only Managers can reassign leads (UC69)</div>' : ""}
        </div>
        <div class="field"><label>Domain / Branch <span class="pill">UC30</span></label><select id="f_domain">${DOMAINS.map(d => `<option ${L.domain === d ? "selected" : ""}>${d}</option>`).join("")}</select></div>
      </div>
      <div class="checkbox-row"><input type="checkbox" id="f_isReferral" ${L.isReferral ? "checked" : ""}> <label style="margin:0">This is a Referral (Staff or Student)</label></div>
      <div class="field ${L.isReferral ? "" : "hidden"}" id="wrap_referralType"><label>Referral Type</label>
        <select id="f_referralType"><option value="Staff" ${L.referralType === "Staff" ? "selected" : ""}>Staff</option><option value="Student" ${L.referralType === "Student" ? "selected" : ""}>Student</option></select>
      </div>
      ${!isNew && L.stage === "Closed" ? `<div class="field"><label>Loss Reason <span class="pill">UC77</span></label><select id="f_lossReason"><option value="">--</option>${LOSS_REASONS.map(r => `<option ${L.lossReason === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>` : ""}
      <div id="leadValidationNotice"></div>
    `;
    document.getElementById("f_source").onchange = e => {
      L.leadSource = e.target.value; syncFieldsFromDOM();
      document.getElementById("wrap_digitalSub").classList.toggle("hidden", L.leadSource !== "Digital");
      document.getElementById("wrap_studentId").classList.toggle("hidden", L.leadSource !== "Student");
      document.getElementById("wrap_staffName").classList.toggle("hidden", L.leadSource !== "Staff");
    };
    document.getElementById("f_isReferral").onchange = e => {
      L.isReferral = e.target.checked;
      document.getElementById("wrap_referralType").classList.toggle("hidden", !L.isReferral);
    };
    document.getElementById("f_district").onchange = e => {
      L.district = e.target.value;
      document.getElementById("wrap_districtOther").classList.toggle("hidden", L.district !== "Other");
    };
  }

  if (tab === "academic") {
    body.innerHTML = `
      <p class="small-muted">Capture academic results (O/L, A/L, Language) with mandatory-field enforcement <span class="pill">UC55</span></p>
      <div class="checkbox-row"><input type="checkbox" id="f_pending" ${L.resultsPending ? "checked" : ""}><label style="margin:0">Results Pending <span class="pill">UC56</span></label></div>
      <p class="small-muted">When checked, mandatory validations for results are relaxed, but the lead cannot progress to Converted stage.</p>
      <div class="field"><label>Exam Type <span class="pill">UC57</span></label>
        <select id="f_examType"><option ${L.examType === "Local A/L" ? "selected" : ""}>Local A/L</option><option ${L.examType === "London A/L" ? "selected" : ""}>London A/L</option></select>
      </div>
      <div class="grid-2">
        <div class="field"><label class="${L.resultsPending ? "" : "required"}">O/L Result</label><input id="f_ol" value="${esc(L.olResult)}" placeholder="e.g. 8 Passes"></div>
        <div class="field"><label class="${L.resultsPending ? "" : "required"}">A/L Result ${L.examType === "London A/L" ? "(London grading)" : "(Local grading)"}</label><input id="f_al" value="${esc(L.alResult)}" placeholder="e.g. 3 Passes"></div>
        <div class="field"><label>Language Test</label><select id="f_langTest"><option ${L.languageTest === "IELTS" ? "selected" : ""}>IELTS</option><option ${L.languageTest === "TOEFL" ? "selected" : ""}>TOEFL</option><option ${L.languageTest === "PTE" ? "selected" : ""}>PTE</option><option ${L.languageTest === "None" ? "selected" : ""}>None</option></select></div>
        <div class="field"><label>Score</label><input id="f_langScore" value="${esc(L.languageScore)}" placeholder="e.g. 6.5"></div>
      </div>
    `;
    document.getElementById("f_pending").onchange = e => { L.resultsPending = e.target.checked; renderLeadModalTab(); };
    document.getElementById("f_examType").onchange = e => {
      const newVal = e.target.value;
      if ((L.olResult || L.alResult) && newVal !== L.examType) {
        if (!confirm("Changing exam type will reset previously entered O/L and A/L results (UC57 - AF1). Continue?")) {
          e.target.value = L.examType;
          return;
        }
        L.olResult = ""; L.alResult = "";
      }
      L.examType = newVal;
      renderLeadModalTab();
    };
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

  if (tab === "timeline") {
    body.innerHTML = `
      <p class="small-muted">Chronological, read-only interaction log — every call, email and status change is captured automatically (UC66) and viewable per lead (UC67).</p>
      <ul class="timeline">${(L.activity || []).map(a => `<li><span class="ts">${fmtDateTime(a.ts)}</span> — <b>${esc(a.type)}</b> by ${esc(a.user)}: ${esc(a.text)}</li>`).join("") || "<li>No history yet.</li>"}</ul>
      ${(L.activity || []).length ? `<div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn sm secondary" onclick="exportLeadTimeline()">⬇ CSV</button>
        <button class="btn sm" onclick="exportLeadTimelinePDF()" title="UC67 - AF1">📄 Export PDF</button>
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

function syncFieldsFromDOM() {
  const L = window.__editingLead;
  const get = id => document.getElementById(id);
  if (get("f_name")) L.name = get("f_name").value;
  if (get("f_mobile")) L.mobile = get("f_mobile").value;
  if (get("f_email")) L.email = get("f_email").value;
  if (get("f_source")) L.leadSource = get("f_source").value;
  if (get("f_digitalSub")) L.digitalSubSource = get("f_digitalSub").value;
  if (get("f_studentId")) L.studentId = get("f_studentId").value;
  if (get("f_staffName")) L.staffName = get("f_staffName").value;
  if (get("f_university")) L.university = get("f_university").value;
  if (get("f_program")) L.program = get("f_program").value;
  if (get("f_district")) L.district = get("f_district").value;
  if (get("f_districtOther")) L.districtOther = get("f_districtOther").value;
  if (get("f_intake")) L.intakeId = get("f_intake").value;
  if (get("f_assigned") && !get("f_assigned").disabled) L.assignedTo = get("f_assigned").value;
  if (get("f_domain")) L.domain = get("f_domain").value;
  if (get("f_isReferral")) L.isReferral = get("f_isReferral").checked;
  if (get("f_referralType")) L.referralType = get("f_referralType").value;
  if (get("f_lossReason")) L.lossReason = get("f_lossReason").value;
  if (get("f_examType")) L.examType = get("f_examType").value;
  if (get("f_ol")) L.olResult = get("f_ol").value;
  if (get("f_al")) L.alResult = get("f_al").value;
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
      <tr><th>Source</th><td>${esc(L.leadSource)}</td><th>Assigned To</th><td>${esc(userName(L.assignedTo))}</td></tr>
      <tr><th>Intake</th><td>${esc((DB.intakes.find(i => i.id === L.intakeId) || {}).name || "—")}</td><th>Created</th><td>${fmtDate(L.createdAt)}</td></tr>
    </tbody></table>`;
  const rows = [["Timestamp", "Type", "User", "Details"], ...(L.activity || []).map(a => [fmtDateTime(a.ts), a.type, a.user, a.text])];
  const html = `<h3>Lead Summary</h3>${summary}
    <h3>Interaction Timeline (${(L.activity || []).length} entries)</h3>${rowsToTableHTML(rows)}`;
  if (printToPDF({ title: "Lead Timeline — " + L.name, subtitle: "Complete interaction history (UC66 / UC67)", html, orientation: "portrait" })) {
    logAudit("EXPORT_PDF", "Lead:" + L.id, "Timeline exported as PDF for external review (UC67 - AF1)");
    saveDB();
    toast("Opening print dialog — choose “Save as PDF”.", "success");
  }
}

function checkDuplicate(L) {
  return DB.leads.find(x => x.id !== L.id && (x.mobile === L.mobile || (L.email && x.email === L.email)));
}

function saveLeadModal() {
  syncFieldsFromDOM();
  const L = window.__editingLead;
  if (!L.name || !L.mobile) { toast("Name and Mobile are required.", "error"); return; }
  if (L.leadSource === "Student" && !L.studentId) { toast("Student ID is required when Lead Source = Student (UC21 - AF2).", "error"); return; }
  if (L.leadSource === "Staff" && !L.staffName) { toast("Staff Name is required when Lead Source = Staff (UC22 - AF1).", "error"); return; }
  if (L.district === "Other" && !L.districtOther) { toast("Please specify the district (UC58 - AF1).", "error"); return; }

  const dup = checkDuplicate(L);
  if (dup && !L.__dupConfirmed) {
    document.getElementById("leadValidationNotice").innerHTML = `
      <div class="notice error">⚠️ Possible duplicate lead detected (UC60): <b>${esc(dup.name)}</b> (${esc(dup.mobile)}).
      <div style="margin-top:8px"><button class="btn sm danger" onclick="window.__editingLead.__dupConfirmed=true;saveLeadModal();">Create Anyway</button>
      <button class="btn sm secondary" onclick="closeModal()">Abort</button></div></div>`;
    return;
  }

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

function attemptStageChange(newStage) {
  syncFieldsFromDOM();
  const L = window.__editingLead;
  if (!allowedNextStages(L.stage).includes(newStage)) {
    toast(`Blocked: ${L.stage} → ${newStage} is not a permitted transition (UC37/UC38).`, "error");
    return;
  }
  const { ok, missing } = isMandatoryMet(L, newStage);
  if (!ok) {
    toast(`Blocked (UC59): missing ${missing.join(", ")}`, "error");
    return;
  }
  if (newStage === "Converted" && L.resultsPending) {
    toast("Blocked: results pending, cannot move to Converted (UC56).", "error");
    return;
  }
  const incompleteChecklist = (L.checklist || []).some(i => !i.done);
  if (newStage !== "Closed" && L.stage === "Open" && newStage === "Qualified" && incompleteChecklist) {
    toast("Blocked (UC54): complete the qualification checklist first.", "error");
    return;
  }
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
    addActivity(lead, "Automation", "⚠ Conversion email NOT sent — no email address on file (UC35 - AF1). Counsellor alerted to send manually.");
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
    addActivity(lead, "Automation", `Confirmation email sent to ${lead.email} (UC35) — ⚠ no handbook on file for "${lead.program || "unset program"}", sent without attachment (UC36 - AF1)`);
    toast(`Email sent — no handbook found for ${lead.program || "this program"} (UC36 - AF1).`, "warn");
    logAudit("EMAIL_SENT", "Lead:" + lead.id, `Conversion email sent WITHOUT handbook (none configured for ${lead.program})`);
  }
}

function attemptDeactivate() {
  const L = window.__editingLead;
  const minDays = DB.deactivationMinDays || 3;
  const canOverride = ["Manager", "Admin", "Head of Marketing", "CEO"].includes(currentRole());
  if (daysAgo(L.createdAt) < minDays && !canOverride) {
    toast(`Blocked (UC41): lead must be at least ${minDays} day(s) old before deactivation. Ask a Manager to override.`, "error");
    return;
  }
  const reason = prompt("Deactivation reason (UC39/UC41):");
  if (!reason) { toast("Deactivation cancelled — reason required.", "warn"); return; }
  if (daysAgo(L.createdAt) < minDays && canOverride) {
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
      <select id="pipelineProgramFilter" title="Program-wise pipeline summary (UC63)"><option value="">All Programs — UC63</option>${PROGRAMS.map(p => `<option ${state.pipelineFilter.program === p ? "selected" : ""}>${p}</option>`).join("")}</select>
    </div>
    <div class="kanban" id="kanbanBoard"></div>
    <div class="legend">${STAGES.map(s => `<span><i style="background:${stageColor(s)}"></i>${esc(stageLabel(s))}</span>`).join("")}</div>
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
  el.innerHTML = simpleBarChart(STAGES.map(s => ({ label: stageLabel(s), value: leads.filter(l => l.stage === s).length, color: stageColor(s) })));
}
function renderKanbanBoard() {
  const board = document.getElementById("kanbanBoard");
  let leads = visibleLeads().filter(l => !l.deactivated);
  if (state.pipelineFilter.program) leads = leads.filter(l => l.program === state.pipelineFilter.program);

  board.innerHTML = STAGES.map(stage => {
    const stageLeads = leads.filter(l => l.stage === stage);
    return `<div class="kanban-col" data-stage="${stage}" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="handleKanbanDrop(event,'${stage}')">
      <h4>${esc(stageLabel(stage))} <span>${stageLeads.length}</span></h4>
      ${stageLeads.map(l => `
        <div class="kanban-card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${l.id}')" onclick="openLeadModal('${l.id}')">
          <div class="name">${esc(l.name)}</div>
          <div class="meta">${esc(l.program) || "No program"} · ${esc(userName(l.assignedTo))}</div>
        </div>`).join("") || `<div class="small-muted" style="padding:10px 0">No leads</div>`}
    </div>`;
  }).join("");
}
function handleKanbanDrop(ev, targetStage) {
  ev.preventDefault();
  ev.currentTarget.classList.remove("dragover");
  const id = ev.dataTransfer.getData("text/plain");
  const lead = DB.leads.find(l => l.id === id);
  if (!lead) return;
  if (lead.stage === targetStage) return;
  const allowed = allowedNextStages(lead.stage);
  if (!allowed.includes(targetStage)) {
    toast(`Blocked: ${lead.stage} → ${targetStage} is not a permitted transition (UC37/UC38).`, "error");
    return;
  }
  const { ok, missing } = isMandatoryMet(lead, targetStage);
  if (!ok) { toast(`Blocked (UC59): missing ${missing.join(", ")}`, "error"); return; }
  if (targetStage === "Converted" && lead.resultsPending) { toast("Blocked: results pending (UC56).", "error"); return; }
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

  root.innerHTML = `
    <div class="page-header"><div><h1>Follow-Up Tracker</h1><div class="sub">Centralised list of pending tasks (UC31/UC65)</div></div></div>

    <div class="card" style="border-left:3px solid var(--red);">
      <h3>⚠ Escalations <span class="pill">UC32 / UC33 / UC34</span></h3>
      ${escalations.length ? `
        <table><thead><tr><th>Lead</th><th>Assigned To</th><th>Reason</th><th>Escalation Chain</th><th></th></tr></thead>
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
        }).join("")}</tbody></table>
      ` : `<div class="empty-state">No SLA breaches right now — everything is on track. 🎉</div>`}
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
        </tr>`).join("") || `<tr><td colspan="6" class="empty-state">No pending follow-ups 🎉</td></tr>`}
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
  const next = completeFollowUp(lead, 5);
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
      <div class="field"><label>Interested Program</label><select id="inq_program">${PROGRAMS.map(p => `<option>${p}</option>`).join("")}</select></div>
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
    id: uid("lead"), name: inq.name, mobile: inq.mobile, email: inq.email, leadSource: "Walk-in", studentId: "", staffName: "",
    university: "", program: inq.program, district: "Other", examType: "Local A/L", resultsPending: true,
    olResult: "", alResult: "", languageTest: "None", languageScore: "", stage: "Open", deactivated: false,
    deactivationReason: "", lossReason: "", assignedTo: rand(DB.users.filter(u => u.role === "Counsellor").map(u => u.id)),
    intakeId: "", domain: rand(DOMAINS), isReferral: false, referralType: "", agentId: "",
    checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
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
            <td>${meetsPaymentThreshold(l) ? "✅" : "❌"}</td>
            <td>${outstandingCleared(l) ? "✅" : "❌"}</td>
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
        <button class="btn sm secondary" onclick="exportReportCSV('${r.id}')">⬇ CSV</button>
        <button class="btn sm secondary" onclick="exportCommissionReportPDF('${r.id}')">📄 PDF</button>
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
      <div class="field"><label>Program</label><select id="genRep_program"><option value="">All Programs</option>${PROGRAMS.map(p => `<option>${p}</option>`).join("")}</select></div>
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
  const comment = prompt("Rejection reason (required, UC7 - AF1):");
  if (!comment) { toast("Rejection cancelled — a comment is required.", "warn"); return; }
  const r = DB.reports.find(x => x.id === id);
  r.status = "Draft";
  r.comments = comment;
  logAudit("REJECT_REPORT", "CommissionReport:" + id, comment);
  saveDB();
  toast("Report sent back for correction.", "warn");
  renderCommissionBody();
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
  const p = editing || { university: UNIVERSITIES[0], type: "Percentage", value: "", from: "", to: "" };
  const isSlab = p.type === "Slab";
  openModal(`
    <div class="modal-header"><h2>${editing ? "Edit Commission Plan" : "New Commission Plan"} <span class="pill">UC1 / UC2 / UC4 / UC5</span></h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label>University</label><select id="cp_uni">${UNIVERSITIES.map(u => `<option ${p.university === u ? "selected" : ""}>${u}</option>`).join("")}<option value="All" ${p.university === "All" ? "selected" : ""}>All (referral plans)</option></select></div>
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
      <div class="empty-state">No reports are enabled for the ${esc(currentRole())} role (UC49).</div>`;
    return;
  }
  if (!tabs.some(([k]) => k === state.reportsTab)) state.reportsTab = tabs[0][0];
  root.innerHTML = `
    <div class="page-header"><div><h1>Reports & Analytics</h1><div class="sub">Module M5 — ${tabs.length} report(s) visible to ${esc(currentRole())} (UC49)</div></div>
      <div style="display:flex;gap:8px;">
        <button class="btn secondary sm" onclick="exportCurrentReport()">⬇ CSV</button>
        <button class="btn sm" onclick="exportCurrentReportPDF()" title="UC45 - AF1">📄 Export PDF</button>
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

  if (tab === "status") {
    const counts = STAGES.map(s => ({ label: stageLabel(s), value: leads.filter(l => l.stage === s && !l.deactivated).length, color: stageColor(s) }));
    body.innerHTML = `<div class="card"><h3>Lead Status Distribution (UC45)</h3>${simpleBarChart(counts)}</div>`;
  }
  if (tab === "source") {
    const bySource = LEAD_SOURCES.map(s => {
      const l = leads.filter(x => x.leadSource === s);
      const conv = l.filter(x => x.stage === "Converted").length;
      return { label: s, value: l.length, conv, rate: l.length ? ((conv / l.length) * 100).toFixed(0) : 0 };
    });
    body.innerHTML = `<div class="card"><h3>Lead Source Performance (UC47)</h3>${simpleBarChart(bySource)}
      <table style="margin-top:12px"><thead><tr><th>Source</th><th>Leads</th><th>Converted</th><th>Conversion %</th></tr></thead>
      <tbody>${bySource.map(s => `<tr><td>${s.label}</td><td>${s.value}</td><td>${s.conv}</td><td>${s.rate}%</td></tr>`).join("")}</tbody></table></div>`;
  }
  if (tab === "university") {
    const byUni = UNIVERSITIES.map(u => ({ label: u, value: leads.filter(l => l.university === u).length }));
    body.innerHTML = `<div class="card"><h3>University-Wise Lead Distribution (UC48)</h3>${simpleBarChart(byUni)}</div>`;
  }
  if (tab === "funnel") {
    const inquiries = DB.inquiries.length;
    const qualified = leads.filter(l => l.stage === "Qualified" || l.stage === "Converted").length;
    const enrolled = leads.filter(l => l.stage === "Converted").length;
    body.innerHTML = `<div class="card"><h3>Full Funnel Conversion (UC76)</h3>
      ${simpleBarChart([{ label: "Inquiries", value: inquiries, color: "#2563eb" }, { label: "Qualified Leads", value: qualified, color: "#e0821e" }, { label: "Enrolments", value: enrolled, color: "#1c8a4c" }])}
      <p class="small-muted">Inquiry → Lead: ${inquiries ? ((qualified / inquiries) * 100).toFixed(1) : 0}% &nbsp;|&nbsp; Lead → Enrolment: ${qualified ? ((enrolled / qualified) * 100).toFixed(1) : 0}%</p>
    </div>`;
  }
  if (tab === "loss") {
    const lost = leads.filter(l => l.stage === "Closed" && l.lossReason);
    const segs = LOSS_REASONS.map((r, idx) => ({ label: r, value: lost.filter(l => l.lossReason === r).length, color: ["#2563eb", "#e0821e", "#1c8a4c", "#d64545", "#7c3aed", "#c2185b"][idx % 6] })).filter(s => s.value > 0);
    body.innerHTML = `<div class="card"><h3>Loss Reason Analysis (UC77)</h3>
      <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;">
        ${donutSVG(segs.length ? segs : [{ label: "None", value: 1, color: "#e2e6ec" }], 180)}
        <div>${segs.map(s => `<div class="legend"><span><i style="background:${s.color}"></i>${s.label}: ${s.value}</span></div>`).join("") || "<span class='small-muted'>No lost leads recorded yet.</span>"}</div>
      </div></div>`;
  }
  if (tab === "program") {
    const byProg = PROGRAMS.map(p => {
      const l = leads.filter(x => x.program === p);
      return { label: p, value: l.length, enrolled: l.filter(x => x.stage === "Converted").length };
    });
    body.innerHTML = `<div class="card"><h3>Program-Wise Performance (UC78)</h3>
    <table><thead><tr><th>Program</th><th>Leads</th><th>Enrolled</th><th>Conversion %</th></tr></thead>
    <tbody>${byProg.map(p => `<tr><td>${p.label}</td><td>${p.value}</td><td>${p.enrolled}</td><td>${p.value ? ((p.enrolled / p.value) * 100).toFixed(0) : 0}%</td></tr>`).join("")}</tbody></table></div>`;
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
      ${simpleBarChart(perCounsellor.map(r => ({ label: r.name, value: r.pct, color: r.pct >= 80 ? "#0f8a4c" : r.pct >= 60 ? "#c2740a" : "#c62b2b" })))}
      <table style="margin-top:14px"><thead><tr><th>Counsellor</th><th>Tasks Completed</th><th>On Time</th><th>Late</th><th>Compliance</th></tr></thead>
      <tbody>${perCounsellor.map(r => `<tr><td>${esc(r.name)}</td><td>${r.total}</td><td>${r.onTime}</td><td>${r.total - r.onTime}</td><td><b>${r.pct}%</b></td></tr>`).join("")}</tbody></table>
      <p class="small-muted" style="margin-top:10px">Drill-down: late tasks are recorded on each lead's Timeline tab (UC46 - AF1).</p>
    </div>`;
  }
  if (tab === "counsellor") {
    const intake = state.reportsIntake || DB.intakes[DB.intakes.length - 1].id;
    const counsellors = DB.users.filter(u => u.role === "Counsellor");
    body.innerHTML = `
      <div class="toolbar"><label style="margin:0">Intake:&nbsp;</label><select id="reportsIntakeSelect">${DB.intakes.map(i => `<option value="${i.id}" ${intake === i.id ? "selected" : ""}>${i.name}</option>`).join("")}</select></div>
      <div class="card"><h3>Counsellor Performance Dashboard (UC43)</h3>
      <table><thead><tr><th>Counsellor</th><th>Target</th><th>Actual</th><th>Conversion %</th><th>Commission Eligibility</th></tr></thead>
      <tbody>${counsellors.map(c => {
        const t = targetFor(c.id, intake);
        const actual = actualEnrolments(c.id, intake);
        const total = DB.leads.filter(l => l.assignedTo === c.id && l.intakeId === intake).length;
        const eligible = DB.leads.filter(l => l.assignedTo === c.id && l.intakeId === intake && l.commissionStatus === "Eligible").length;
        return `<tr><td>${esc(c.name)}</td><td>${t ? t.target : "-"}</td><td>${actual}</td><td>${total ? Math.round(actual / total * 100) : 0}%</td><td>${eligible} eligible</td></tr>`;
      }).join("")}</tbody></table></div>`;
    document.getElementById("reportsIntakeSelect").onchange = e => { state.reportsIntake = e.target.value; renderReportBody(); };
  }
  if (tab === "agent") {
    const agents = DB.users.filter(u => u.role === "Agent");
    body.innerHTML = `<div class="card"><h3>Agent-Generated Leads &amp; Performance (UC74)</h3>
    <table><thead><tr><th>Agent</th><th>Leads Submitted</th><th>Converted</th><th>Conversion %</th>${canViewAmounts() ? "<th>Commission Earned</th>" : ""}</tr></thead>
    <tbody>${agents.map(a => {
      const l = DB.leads.filter(x => x.agentId === a.id);
      const conv = l.filter(x => x.stage === "Converted").length;
      const paid = l.filter(x => x.commissionStatus === "Paid").reduce((s, x) => s + estimateCommission(x), 0);
      return `<tr><td>${esc(a.name)}</td><td>${l.length}</td><td>${conv}</td><td>${l.length ? Math.round(conv / l.length * 100) : 0}%</td>${canViewAmounts() ? `<td>${money(paid)}</td>` : ""}</tr>`;
    }).join("") || `<tr><td colspan="5" class="empty-state">No agents configured.</td></tr>`}</tbody></table></div>`;
  }
}
/* Builds the real tabular data behind whichever analytics report is open.
   Used by both the CSV and the PDF exporters (UC45 - AF1). */
function currentReportData() {
  const leads = DB.leads;
  const tab = state.reportsTab;
  const def = REPORT_DEFS.find(r => r.id === tab) || { label: tab };

  if (tab === "status") {
    return { title: def.label, rows: [["Stage", "Leads"], ...STAGES.map(s => [stageLabel(s), leads.filter(l => l.stage === s && !l.deactivated).length])] };
  }
  if (tab === "source") {
    return { title: def.label, rows: [["Source", "Leads", "Converted", "Conversion %"], ...LEAD_SOURCES.map(s => {
      const l = leads.filter(x => x.leadSource === s), c = l.filter(x => x.stage === "Converted").length;
      return [s, l.length, c, (l.length ? Math.round(c / l.length * 100) : 0) + "%"];
    })] };
  }
  if (tab === "university") {
    return { title: def.label, rows: [["University", "Leads", "Converted"], ...UNIVERSITIES.map(u => {
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
    return { title: def.label, rows: [["Loss Reason", "Leads", "% of lost"], ...LOSS_REASONS.map(r => {
      const n = lost.filter(l => l.lossReason === r).length;
      return [r, n, (lost.length ? Math.round(n / lost.length * 100) : 0) + "%"];
    })] };
  }
  if (tab === "program") {
    return { title: def.label, rows: [["Program", "Leads", "Enrolled", "Conversion %"], ...PROGRAMS.map(p => {
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
  openModal(`
    <div class="modal-header"><h2>New Intake Cycle (UC70)</h2><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label class="required">Name</label><input id="in_name" placeholder="e.g. January 2027 Intake"></div>
      <div class="grid-2"><div class="field"><label>Start Date</label><input id="in_start" type="date"></div><div class="field"><label>End Date</label><input id="in_end" type="date"></div></div>
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
    if (overlap && !confirm(`Warning (UC70 - AF1): these dates overlap with "${overlap.name}" (${fmtDate(overlap.start)} → ${fmtDate(overlap.end)}). Create anyway?`)) {
      return;
    }
  }
  DB.intakes.push({ id: uid("in"), name, start, end, programs: PROGRAMS });
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
      <div class="field"><label>Program</label><select id="ag_program">${PROGRAMS.map(p => `<option>${p}</option>`).join("")}</select></div>
    </div>
    <div class="modal-footer"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveAgentLead('${agentId}')">Submit</button></div>
  `);
}
function saveAgentLead(agentId) {
  const name = document.getElementById("ag_name").value.trim();
  const mobile = document.getElementById("ag_mobile").value.trim();
  if (!name || !mobile) { toast("Name and mobile required.", "error"); return; }
  DB.leads.push({
    id: uid("lead"), name, mobile, email: document.getElementById("ag_email").value.trim(), leadSource: "Agent Referral",
    studentId: "", staffName: "", university: "", program: document.getElementById("ag_program").value, district: "Other",
    examType: "Local A/L", resultsPending: true, olResult: "", alResult: "", languageTest: "None", languageScore: "",
    stage: "Open", deactivated: false, deactivationReason: "", lossReason: "", assignedTo: rand(DB.users.filter(u => u.role === "Counsellor").map(u => u.id)),
    intakeId: "", domain: rand(DOMAINS), isReferral: true, referralType: "Student", agentId,
    checklist: makeChecklist(), commissionStatus: "Pending", tuitionFee: 850000, amountPaid: 0, outstandingBalance: 0, nextFollowUp: addDaysStr(todayStr(), 1), followUpLog: [], escalated: false,
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
        <button class="btn secondary sm" onclick="exportAudit()">⬇ CSV</button>
        <button class="btn sm" onclick="exportAuditPDF()" title="UC82">📄 Export PDF</button>
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
function renderAdmin(root) {
  root.innerHTML = `
    <div class="page-header"><div><h1>Admin Settings</h1><div class="sub">Configure roles, stages, statuses & mandatory fields</div></div></div>

    <div class="card">
      <h3>Status Labels &amp; Colours <span class="pill">UC64</span></h3>
      <p class="small-muted">Rename any stage's display label or recolour it — applied instantly across tabs, Kanban, dashboard widgets and reports.</p>
      <div class="table-wrap"><table><thead><tr><th>Internal Stage</th><th>Display Label</th><th>Colour</th></tr></thead>
      <tbody>${STAGES.map(s => `<tr>
        <td>${s}</td>
        <td><input type="text" class="statusLabelInput" data-stage="${s}" value="${esc(stageLabel(s))}" ${currentRole() === "Admin" ? "" : "disabled"}></td>
        <td><input type="color" class="statusColorInput" data-stage="${s}" value="${stageColor(s)}" style="width:56px;padding:2px" ${currentRole() === "Admin" ? "" : "disabled"}></td>
      </tr>`).join("")}</tbody></table></div>
      ${currentRole() === "Admin" ? `<button class="btn sm" style="margin-top:10px" onclick="saveStatusLabels()">Save Labels &amp; Colours</button> <button class="btn sm secondary" onclick="resetStatusLabels()">Reset to Defaults</button>` : "<p class='small-muted' style='margin-top:8px'>🔒 Only Admins can edit status labels/colours.</p>"}
    </div>

    <div class="card">
      <h3>Full Status Set &amp; Transition Rules <span class="pill">UC38 / UC64</span></h3>
      <p class="small-muted">Tick which forward transitions are permitted from each stage. Unchecked = blocked in Pipeline, Kanban and the Lead form (like Qualified → Open, UC37).</p>
      <div class="table-wrap"><table><thead><tr><th>From \\ To</th>${STAGES.map(s => `<th>${s}</th>`).join("")}</tr></thead>
      <tbody>${STAGES.map(from => `<tr><td><b>${stageBadge(from)}</b></td>${STAGES.map(to => `
        <td style="text-align:center">${from === to ? "<span class='small-muted'>—</span>" : `<input type="checkbox" class="transitionChk" data-from="${from}" data-to="${to}" ${(DB.transitionRules[from] || []).includes(to) ? "checked" : ""} ${!["Admin"].includes(currentRole()) ? "disabled" : ""}>`}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${currentRole() === "Admin" ? `<button class="btn sm" style="margin-top:10px" onclick="saveTransitionRules()">Save Rules</button> <button class="btn sm secondary" onclick="resetTransitionRules()">Reset to Defaults</button>` : "<p class='small-muted' style='margin-top:8px'>🔒 Only Admins can edit these rules.</p>"}
    </div>

    <div class="card">
      <h3>Mandatory Fields per Stage <span class="pill">UC59</span></h3>
      <table><thead><tr><th>Stage</th><th>Required Fields</th></tr></thead>
      <tbody>${STAGES.map(s => `<tr><td>${stageBadge(s)}</td><td>${(STAGE_MANDATORY_FIELDS[s] || []).join(", ") || "None"}</td></tr>`).join("")}</tbody></table>
    </div>

    <div class="card">
      <h3>Deactivation Criteria <span class="pill">UC41</span></h3>
      <div class="field" style="max-width:280px"><label>Minimum lead age before deactivation is allowed (days)</label>
        <input type="number" id="deactMinDays" value="${DB.deactivationMinDays}" min="0" ${currentRole() === "Admin" ? "" : "disabled"}>
      </div>
      ${currentRole() === "Admin" ? `<button class="btn sm" onclick="saveDeactivationCriteria()">Save</button>` : ""}
      <p class="small-muted" style="margin-top:8px">Managers and above can override this criterion per lead (AF1).</p>
    </div>

    <div class="card">
      <h3>Role-Based Dashboard &amp; Report Visibility <span class="pill">UC49</span></h3>
      <p class="small-muted">Tick which dashboard widgets and reports each role can see, and whether they may view commission amounts. Changes apply immediately — switch role in the top bar to verify.</p>
      <div class="field" style="max-width:280px"><label>Configure Role</label>
        <select id="permRoleSelect">${ROLES.map(r => `<option ${state.permRole === r ? "selected" : ""}>${r}</option>`).join("")}</select>
      </div>
      <div id="permEditor"></div>
    </div>

    <div class="card">
      <h3>Commission Eligibility Rules <span class="pill">UC14 / UC15 / UC19</span></h3>
      <div class="grid-3">
        <div class="field"><label>Payment Threshold (UC14)</label><input type="number" id="ruleThreshold" value="${(DB.commissionRules || {}).paymentThreshold || 0}" ${currentRole() === "Admin" ? "" : "disabled"}></div>
        <div class="field"><label>Expiry / Claw-back Days (UC19)</label><input type="number" id="ruleExpiry" value="${(DB.commissionRules || {}).expiryDays || 25}" ${currentRole() === "Admin" ? "" : "disabled"}></div>
        <div class="field"><label>&nbsp;</label>
          <div class="checkbox-row"><input type="checkbox" id="ruleOutstanding" ${(DB.commissionRules || {}).requireZeroOutstanding ? "checked" : ""} ${currentRole() === "Admin" ? "" : "disabled"}><label style="margin:0;text-transform:none">Require zero outstanding for referrals (UC15)</label></div>
        </div>
      </div>
      ${currentRole() === "Admin" ? `<button class="btn sm" onclick="saveCommissionRules()">Save Rules</button>` : ""}
    </div>

    <div class="card">
      <h3>Users, Hierarchy &amp; Tenant Scope <span class="pill">UC26 / UC27 / UC30 / UC34</span></h3>
      <p class="small-muted">Tenant scope partitions data before any role rule — a "Kandy Branch" user cannot see Colombo data regardless of role. "All" = global (unpartitioned).</p>
      <table><thead><tr><th>Name</th><th>Role</th><th>Reports To</th><th>Tenant / Domain (UC30)</th></tr></thead>
      <tbody>${DB.users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${u.managerId ? esc(userName(u.managerId)) : "-"}</td>
        <td><select class="userDomainSel" data-uid="${u.id}" ${currentRole() === "Admin" ? "" : "disabled"}>
          <option value="All" ${u.domain === "All" ? "selected" : ""}>All (global)</option>
          ${DOMAINS.map(d => `<option ${u.domain === d ? "selected" : ""}>${d}</option>`).join("")}
        </select></td></tr>`).join("")}</tbody></table>
      ${currentRole() === "Admin" ? `<button class="btn sm" style="margin-top:10px" onclick="saveUserDomains()">Save Tenant Scopes</button>` : ""}
    </div>

    <div class="card">
      <h3>Report Schedule &amp; Recipients <span class="pill">UC10 / UC12</span></h3>
      <div class="checkbox-row"><input type="checkbox" id="schedReportChk" ${DB.scheduledReportEnabled ? "checked" : ""} ${currentRole() === "Admin" ? "" : "disabled"}><label style="margin:0">Auto-generate commission report weekly (Friday 18:00)</label></div>
      <div class="field" style="margin-top:10px"><label>Finance Recipients (comma separated)</label><input id="reportRecipients" value="${esc((DB.reportConfig.recipients || []).join(", "))}" ${currentRole() === "Admin" ? "" : "disabled"}></div>
      <div class="field"><label>Report Columns (comma separated)</label><input id="reportColumns" value="${esc((DB.reportConfig.columns || []).join(", "))}" ${currentRole() === "Admin" ? "" : "disabled"}></div>
      ${currentRole() === "Admin" ? `<button class="btn sm" onclick="saveReportConfig()">Save Settings</button> <button class="btn sm secondary" onclick="runScheduledReportJob()" title="UC10">▶ Run Scheduled Job Now</button>` : ""}
    </div>
  `;

  const roleSel = document.getElementById("permRoleSelect");
  if (roleSel) {
    state.permRole = state.permRole || roleSel.value;
    roleSel.value = state.permRole;
    roleSel.onchange = e => { state.permRole = e.target.value; renderPermEditor(); };
    renderPermEditor();
  }
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
    ${isAdmin ? `<button class="btn sm" style="margin-top:12px" onclick="saveRolePermissions()">Save Permissions for ${esc(role)}</button>` : "<p class='small-muted' style='margin-top:8px'>🔒 Only Admins can edit role permissions.</p>"}
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
function saveUserDomains() {
  document.querySelectorAll(".userDomainSel").forEach(sel => {
    const u = DB.users.find(x => x.id === sel.dataset.uid);
    if (u && u.domain !== sel.value) {
      logAudit("UPDATE", "User:" + u.id, `Tenant scope ${u.domain} → ${sel.value} (UC30)`);
      u.domain = sel.value;
    }
  });
  saveDB();
  toast("Tenant scopes saved — switch user in the top bar to verify partitioning.", "success");
  router();
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
function saveStatusLabels() {
  DB.statusLabels = DB.statusLabels || {};
  DB.statusColors = DB.statusColors || {};
  document.querySelectorAll(".statusLabelInput").forEach(inp => {
    DB.statusLabels[inp.dataset.stage] = inp.value.trim() || inp.dataset.stage;
  });
  document.querySelectorAll(".statusColorInput").forEach(inp => {
    DB.statusColors[inp.dataset.stage] = inp.value;
  });
  logAudit("UPDATE", "StatusLabels", "Status labels/colours updated (UC64)");
  saveDB();
  toast("Status labels & colours updated.", "success");
  renderAdmin(document.getElementById("content"));
}
function resetStatusLabels() {
  DB.statusLabels = STAGES.reduce((m, s) => (m[s] = s, m), {});
  DB.statusColors = Object.assign({}, STAGE_COLORS);
  logAudit("RESET", "StatusLabels", "Reset to defaults");
  saveDB();
  toast("Status labels & colours reset.", "success");
  renderAdmin(document.getElementById("content"));
}
function saveTransitionRules() {
  const rules = {};
  STAGES.forEach(s => rules[s] = []);
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
  if (!location.hash) location.hash = "#/dashboard";
  router();
}
init();

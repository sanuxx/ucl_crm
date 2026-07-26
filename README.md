# UniConnect CRM — Interactive Demo

A functional single-page CRM demo for the education/student-recruitment sector, implementing **86 use cases across 6 modules**.

Built with **vanilla HTML, CSS and JavaScript** — no frameworks, no build step, no backend, no external dependencies. All state persists to `localStorage`.

## Live Demo

👉 **[sanuxx.github.io/uniconnect-crm](https://sanuxx.github.io/uniconnect-crm/)**

> Replace the URL above with your actual Pages URL after enabling it (see below).

## Running Locally

Because the app is entirely static, you can simply open `index.html` in a browser.

For the best experience (avoids any `file://` restrictions):

```bash
python3 -m http.server 8080
# then visit http://localhost:8080
```

## Try These First

The demo is seeded with ~68 leads, 40 inquiries, 3 intake cycles and 11 users.

| # | What to try | Why it's interesting |
| --- | --- | --- |
| 1 | Switch **Role** in the top bar (Counsellor → Manager → CEO) | Row-level security and tenant partitioning applied live — each role sees a different lead set |
| 2 | **Pipeline** → drag a card backwards from Qualified to Open | Blocked by the configurable stage-transition rules |
| 3 | **Leads** → open a lead → change Lead Source to *Student* / *Staff* | Dynamic conditional fields appear |
| 4 | **Follow-Ups** → Escalations panel → *Escalate Now* | Notification chain fires; check the 🔔 bell as that Manager |
| 5 | **Commission** → Report Workflow → generate, then approve as Head of Marketing | Full multi-step approval → auto-dispatch → payment run |
| 6 | **Reports** → any tab → *Export PDF* | Print-to-PDF with a proper document header |
| 7 | **Admin Settings** → Role Visibility / Status Labels | Reconfigure the app at runtime, changes apply immediately |

Use **↺ Reset Demo Data** on the Dashboard to restore the seeded state at any time.

## Modules

| Module | Scope | Features |
| --- | --- | --- |
| **M1** | Configurable Data Model & Forms | 9 |
| **M2** | Flexible Pipelines & Stages | 20 |
| **M3** | Role-Based Access & Organization | 15 |
| **M4** | Commission & Payment Engine | 23 |
| **M5** | Qualification Checklists & Analytics | 16 |
| **M6** | Intake / Cycle Management | 3 |
| | **Total** | **86** |

Each feature is tagged in the UI with its use-case reference (e.g. `UC61`) so it can be traced back to the specification during review.

## Project Structure

A flat structure — every file sits at the repository root.

```text
.
├── index.html    # App shell — the only page (SPA, hash-routed)
├── style.css     # "Aurora" design system — tokens + all components
├── data.js       # Seed data, schema, config constants, localStorage layer
├── utils.js      # RBAC, formatting, charts, PDF/CSV export, SLA helpers
├── app.js        # Hash router + every view/render function
├── .nojekyll     # Serve files verbatim (skip Jekyll processing)
└── README.md
```

Scripts load in dependency order — `data.js` → `utils.js` → `app.js` — so keep that order in `index.html` if you add more.

## Architecture Notes

- **State** — a single `DB` object persisted to `localStorage` under `uc_crm_db_v2`, with a migration step so older saved data gains new fields rather than breaking.
- **Routing** — a minimal hash router (`#/leads`, `#/pipeline`, …) mapping routes to render functions that replace the contents of `#content`.
- **Security model** — `visibleLeads()` applies tenant partitioning *first*, then role-based row-level filtering, so scope can never be widened by a role rule.
- **Validation gates** — stage transitions run through `attemptStageChange()` / `handleKanbanDrop()`, which check transition rules, per-stage mandatory fields, pending-results flags and the qualification checklist before mutating state.
- **PDF export** — renders a print-optimised document into a new window and invokes the browser's print dialog ("Save as PDF"), so no PDF library is required.

### Demo limitations

These are inherent to a static, backend-free demo rather than missing work:

- **Scheduled jobs** (weekly report generation, SLA sweeps) can't run unattended in a browser. They're exposed as manual trigger buttons — *Run Scheduled Job Now*, *Run Expiration Check* — clearly labelled as standing in for server-side cron jobs.
- **Emails** are simulated: the conversion automation resolves the correct program handbook and logs/toasts the dispatch rather than sending real mail.
- **Kanban drag-and-drop** uses the HTML5 Drag and Drop API, which mobile browsers do not support. Use a desktop browser for the pipeline board.

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Under *Source*, select **Deploy from a branch**, branch `main`, folder `/ (root)`.
4. Save. The site publishes at `https://<username>.github.io/<repo>/` within a minute or two.

No build step or workflow file is needed — the site is served exactly as committed.

## Note on Specifications

The source specification documents (`.pdf` / `.docx`) are marked *Confidential — Internal Use Only* and are therefore **excluded from version control** via `.gitignore`. They remain in your local working folder but are never committed. Do not add them to a public repository.

---

*Demo build — seeded with fictional data for demonstration purposes.*

# RPMS — Research Project Management System (Working Prototype)

A working front-end prototype of the **Research Project Management System** specified in the Team T081 SRS
(CS314 Software Development Laboratory, LNMIIT Jaipur). It implements the three detailed use cases from the
design documents — **UC-004 Submit Proposal, UC-005 Approve/Reject Proposal, UC-011 Submit Milestone
Completion** — plus role-based access for all six user classes, funding management, notifications, self-service
password reset, and an append-only audit log. The UI follows the Assignment 7 wireframes (navy header, cards,
status pills) with a few usability improvements.

## Run it

No build step and no backend needed — it is a static single-page app.

**Option A:** double-click `index.html` (works straight from disk).

**Option B (recommended):** serve it and open in a browser:

```bash
cd rpms-prototype
python -m http.server 8080
# then open http://localhost:8080
```

All data lives in your browser's `localStorage`. Use **“Reset demo data”** on the login page to reseed.

## Demo accounts

Password for **every** account: `demo123`

| Role                            | Email                          | Sees |
|---------------------------------|--------------------------------|------|
| Principal Investigator          | priya.sharma@lnmiit.ac.in      | PI Dashboard, proposals, milestones, alerts |
| Research Committee Approver     | rajesh.gupta@lnmiit.ac.in      | Review queue, proposal & milestone decisions |
| Research Coordinator            | kavita.rao@lnmiit.ac.in        | Funding utilization recording |
| Funding Agency Representative   | dst.rep@serb.gov.in            | Disbursements, sanction confirmation |
| System Administrator            | admin@lnmiit.ac.in             | Users & roles, audit log |
| Institutional Auditor           | auditor@lnmiit.ac.in           | Read-only audit trail |

The login page has one-click buttons that pre-fill each persona.

## Suggested demo walkthrough

0. **Registration:** click **“Create an account”** on the login page → register with any email not already
   in the demo list (e.g. `rakesh.verma@lnmiit.ac.in`) and a password (≥ 6 chars) → the account joins as a
   **Principal Investigator** and you are signed straight into the PI dashboard. Duplicate emails are
   rejected; admins receive a notification and a `USER_REGISTERED` audit entry is written. Seeded demo
   accounts keep working with `demo123`. **Roles are admin-assigned per FR-004/BR-019**: use Admin →
   Users → *Create User* (UC-002) to provision coordinators, approvers, funding-agency reps or auditors.
1. **UC-004 (PI):** sign in as Dr. Sharma → the draft *PROP-2026-042 “AI-based Crop Disease Detection”*
   is intentionally incomplete → **Submit** shows the M-07 “Missing fields” banner with inline field errors.
   Fill Methodology, Budget and the dates → **Submit Proposal** → confirmation page (status *Under Review*,
   timestamp, committee notified).
2. **UC-005 (Approver):** sign in as Prof. Gupta → the new proposal appears in the **Review Queue**.
   Try **Reject** with no comments → BR-006 blocks it. Reject with comments, or **Approve**:
   - checkbox *“Funding sanction confirmed”* **checked** → project created **Active** (BR-007);
   - left **unchecked** → project created **Pending Funding**; sign in as the Funding Agency rep and press
     **Confirm Funding Sanction** to activate it (UC-005 alt flow b).
3. **UC-011 (PI):** back as Dr. Sharma → milestone *M2 Prototype model* (Smart Grid Load Analytics, due in
   7 days) → **Submit completion** without evidence → FR-018 blocks it. Add evidence, submit → status
   *Submitted for Review*.
4. **UC-012 (Approver):** approve the milestone (→ *Completed*) or request revision (→ back to *In Progress*
   with comments, AC-20).
5. **Coordinator:** record fund utilization on Smart Grid Load Analytics (already at 85% — FR-025 budget
   alerts are visible on the cards and the PI dashboard).
6. **Admin:** change a role / deactivate an account (BR-019/020), then check the **Audit Log** — every major
   action (logins, submissions, decisions, funding entries) is recorded append-only (BR-023, NFR-024/025).
7. **Session expiry (NFR-008):** sessions expire after 30 minutes of inactivity; the login page shows the
   M-03 “session expired” message.
8. **Forgot password:** on the login page click **Forgot password?** → enter a demo email (e.g.
   `priya.sharma@lnmiit.ac.in`) → the prototype displays the simulated email containing a single-use reset
   link (30-minute expiry) → choose a new password (≥ 6 characters) → sign in with it. Unknown or
   deactivated accounts receive the same generic response, so account existence is not disclosed. Both
   steps are written to the Audit Log (`PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET`).

## Requirements coverage (highlights)

| Area | Where |
|------|-------|
| FR-001…FR-004 auth, RBAC, role change | `js/services.js` (`Auth`, `AdminService`), per-route role guards |
| Self-service password reset (FR-001/FR-002 pattern, NFR-005/024, BR-020) | `Auth.requestPasswordReset`, `Auth.checkResetToken`, `Auth.resetPassword`, forgot/reset views |
| FR-005…FR-012 proposal lifecycle incl. draft, withdraw | `ProposalService`, PI dashboard + editor |
| FR-013…FR-015 project listing/search/filter/details | *Projects* page, project detail |
| FR-016…FR-021 milestones & deliverables | `MilestoneService`, milestone views |
| FR-022…FR-025 funding allocation/utilization/alerts | `FundingService`, *Funding* page |
| FR-026…FR-028 documents + version tracking | evidence upload, project documents table |
| FR-029…FR-031 notifications | notification bell + page, generated by services |
| FR-032/033 dashboards & reports | role-specific dashboards, funding summaries |
| BR-001…BR-024 business rules | enforced inside services; rejected actions show the wireframe error messages (M-01…M-19) |
| NFR-004/005/006/008 auth & session | simulated JWT-style session, 30-min sliding expiry, generic login errors |
| NFR-024/025 auditability | append-only `auditLog`, no UI to edit it |

## Prototype limitations (by design)

- There is **no real server** — the browser store simulates the RPMS database; refresh-safe but local.
- Uploaded **file payloads are not persisted**; only metadata (name, size, version) is recorded.
- All demo accounts share the password `demo123`; passwords are **not cryptographically hashed** — registered
  accounts store a simulated digest only (NFR-005 is modelled, not implemented).
- **Self-registration always joins as Principal Investigator.** The SRS has no self-service registration —
  accounts are institutionally provisioned (Section 8) and roles are assigned only by administrators
  (FR-004, BR-019). The prototype keeps PI self-signup as a documented convenience; every other role is
  created by an admin via Users → Create User (UC-002).
- **Password reset email is simulated.** There is no mail server, so the *Forgot password* flow displays the
  one-time link on screen as a simulated email. Only a simulated digest of the token is stored; links expire
  after 30 minutes, work once, and are superseded by any newer request.
- Concurrent-edit conflicts (UC-005 alt flow c) are detected server-side in a real system; here the same
  state checks exist but concurrency is simulated single-user.

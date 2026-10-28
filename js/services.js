"use strict";
/* ==========================================================================
   RPMS prototype — application services (the "subsystems" from the SRS
   component-level design). Every operation enforces the business rules
   (BR-xxx) it realizes, and writes to the append-only audit log (BR-023,
   NFR-024/025) and the notification service (FR-029…FR-031).
   ========================================================================== */

function err(code, message, fields) {
  return { ok: false, code, message, fields };
}

function audit(actorId, action, target, remarks) {
  DB.auditLog.unshift({
    id: nextId("log"),
    actor: actorId,
    action,
    target,
    time: nowISO(),
    remarks,
  });
}
function notify(recipientId, type, message) {
  DB.notifications.unshift({
    id: nextId("notf"),
    recipient: recipientId,
    type,
    message,
    created: nowISO(),
    read: false,
  });
}

/* Simulated password digest (NFR-005): deterministic obfuscation — NOT real crypto, prototype only. */
function fakeHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return "sha-sim-" + h.toString(36) + "-" + s.length;
}

/* Cryptographically random, URL-safe reset token. The raw token is only ever
   placed in the simulated email; the store keeps its digest (NFR-005). */
function newResetToken() {
  try {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    let s = "";
    while (s.length < 48) s += Math.random().toString(36).slice(2);
    return s.slice(0, 48);
  }
}

const RESET_REQUEST_MESSAGE =
  "If an account exists for this email, a password reset link has been sent. The link expires in 30 minutes and can be used once.";

const VALID_ROLES = ["PI", "COORDINATOR", "APPROVER", "ADMIN", "FUNDING", "AUDITOR"];

/* ---------- UC-001 / FR-001…FR-004, NFR-008 — authentication ---------- */
const Auth = {
  login(email, password) {
    const user = DB.users.find(
      (u) =>
        u.email.toLowerCase() ===
        String(email || "")
          .trim()
          .toLowerCase(),
    );
    const passOk =
      user &&
      (user.passwordHash
        ? user.passwordHash === fakeHash(password) // self-registered account
        : password === DEMO_PASSWORD); // seeded demo account
    if (!user || !passOk)
      return err("UNAUTHORIZED", "Invalid email or password."); // FR-002: never reveal which field failed
    if (!user.active)
      return err(
        "FORBIDDEN",
        "Account deactivated. Contact the system administrator.",
      ); // BR-020
    const session = {
      token: "demo-" + Math.random().toString(36).slice(2),
      userId: user.id,
      issuedAt: nowISO(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    audit(user.id, "USER_LOGIN", user.id, "Signed in");
    saveDB();
    return { ok: true, user };
  },

  /* Self-registration (prototype): creates an active Principal Investigator account
     and signs the user in. Per the SRS (FR-004, BR-019, UC-002), roles other than PI
     are assigned only by the System Administrator. */
  register(data) {
    const name = String(data.name || "").trim();
    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    const dept = String(data.dept || "").trim();
    const password = String(data.password || "");
    if (!name) return err("UNPROCESSABLE", "Enter your full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return err("UNPROCESSABLE", "Enter a valid email address.");
    if (DB.users.some((u) => u.email.toLowerCase() === email))
      return err(
        "CONFLICT",
        "An account with this email already exists. Try signing in instead.",
      );
    if (password.length < 6)
      return err("UNPROCESSABLE", "Password must be at least 6 characters long.");
    const user = {
      id: nextId("usr"),
      name,
      email,
      role: "PI",
      dept: dept || "—",
      active: true,
      passwordHash: fakeHash(password),
      registeredOn: todayISO(),
    };
    DB.users.push(user);
    audit(user.id, "USER_REGISTERED", user.id, "Self-registered as Principal Investigator");
    usersByRole("ADMIN").forEach((a) =>
      notify(
        a.id,
        "system",
        `New user registered: ${user.name} (${email}) joined as Principal Investigator.`,
      ),
    ); // FR-031
    const session = {
      token: "demo-" + Math.random().toString(36).slice(2),
      userId: user.id,
      issuedAt: nowISO(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    saveDB();
    return { ok: true, user };
  },
  /* Returns a user, null, or {expired:true} when the session timed out. */
  current() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (!s) return null;
      if (Date.now() > s.expiresAt) {
        localStorage.removeItem(SESSION_KEY);
        return { expired: true };
      }
      s.expiresAt = Date.now() + SESSION_TTL_MS; // sliding expiry
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      return DB.users.find((u) => u.id === s.userId) || null;
    } catch (e) {
      return null;
    }
  },
  logout() {
    localStorage.removeItem(SESSION_KEY);
  },

  /* ---------- Self-service password reset (NFR-005, NFR-024, BR-020) ----------
     The SRS does not define a reset use case; this follows its security rules:
     the response never reveals whether an email is registered (same pattern as
     FR-002), links are single-use and expire, deactivated accounts are refused,
     and both request and completion are written to the append-only audit log. */
  requestPasswordReset(email) {
    const normalized = String(email || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
      return err("UNPROCESSABLE", "Enter a valid email address."); // NFR-010
    const user = DB.users.find((u) => u.email.toLowerCase() === normalized);
    // BR-020: deactivated users cannot reset, but we still return the same
    // generic response so the account status is not disclosed.
    if (!user || !user.active)
      return { ok: true, message: RESET_REQUEST_MESSAGE };

    // Supersede any outstanding links so only the newest one works.
    DB.passwordResets.forEach((r) => {
      if (r.userId === user.id && !r.usedAt) {
        r.usedAt = nowISO();
        r.revoked = true;
      }
    });
    const token = newResetToken();
    const expiresAt = Date.now() + PASSWORD_RESET_TTL_MS;
    DB.passwordResets.unshift({
      id: nextId("rst"),
      userId: user.id,
      tokenHash: fakeHash(token),
      requestedAt: nowISO(),
      expiresAt,
      usedAt: null,
      revoked: false,
    });
    audit(
      user.id,
      "PASSWORD_RESET_REQUESTED",
      user.id,
      "Single-use password reset link issued",
    ); // NFR-024
    saveDB();
    // demoToken is shown in the simulated email preview only — never in a real system.
    return {
      ok: true,
      message: RESET_REQUEST_MESSAGE,
      demoToken: token,
      expiresAt,
      user: { id: user.id, email: user.email },
    };
  },

  checkResetToken(token) {
    const reset = DB.passwordResets.find(
      (r) => r.tokenHash === fakeHash(String(token || "")) && !r.usedAt,
    );
    if (!reset)
      return err(
        "INVALID_TOKEN",
        "This password reset link is invalid or has already been used.",
      );
    if (Date.now() > reset.expiresAt)
      return err(
        "INVALID_TOKEN",
        "This password reset link has expired. Request a new one.",
      );
    const user = DB.users.find((u) => u.id === reset.userId);
    if (!user || !user.active)
      return err("INVALID_TOKEN", "This password reset link is no longer valid."); // BR-020
    return { ok: true, user, reset };
  },

  resetPassword(token, newPassword) {
    const password = String(newPassword || "");
    const checked = Auth.checkResetToken(token);
    if (!checked.ok) return checked; // expired/reused/unknown token
    if (password.length < 6)
      return err("UNPROCESSABLE", "Password must be at least 6 characters long.");
    const user = checked.user;
    user.passwordHash = fakeHash(password); // NFR-005
    checked.reset.usedAt = nowISO();
    // Revoke every other outstanding link for this account.
    DB.passwordResets.forEach((r) => {
      if (r.userId === user.id && !r.usedAt) {
        r.usedAt = nowISO();
        r.revoked = true;
      }
    });
    // Invalidate the affected user's existing session (if this browser holds it).
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (s && s.userId === user.id) localStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* ignore malformed session */
    }
    audit(
      user.id,
      "PASSWORD_RESET",
      user.id,
      "Password changed via self-service reset",
    ); // NFR-024
    saveDB();
    return { ok: true, user };
  },
};

/* ---------- Proposal Management (UC-003/004/005/006) ---------- */
const ProposalService = {
  validate(p) {
    // BR-002, BR-008, BR-009
    const labels = [
      ["title", "Project title"],
      ["abstract", "Abstract"],
      ["objectives", "Objectives"],
      ["methodology", "Methodology"],
      ["expectedOutcomes", "Expected outcomes"],
      ["budget", "Budget (INR)"],
      ["startDate", "Proposed start date"],
      ["endDate", "Expected end date"],
    ];
    const missing = labels
      .filter(([k]) => {
        const v = p[k];
        return (
          v === null ||
          v === undefined ||
          v === "" ||
          (typeof v === "number" && !(v > 0))
        );
      })
      .map(([, l]) => l);
    if (
      !missing.includes("Proposed start date") &&
      !missing.includes("Expected end date") &&
      p.endDate <= p.startDate
    ) {
      missing.push("Expected end date must be after the start date");
    }
    return { ok: missing.length === 0, missing };
  },

  saveDraft(data, caller, existingId) {
    // FR-005…FR-007, BR-001
    let p;
    if (existingId) {
      p = findProposal(existingId);
      if (!p) return err("NOT_FOUND", "Proposal not found.");
      if (p.pi !== caller.id)
        return err(
          "FORBIDDEN",
          "Access denied: only the owning PI can edit this draft.",
        );
      if (p.status !== "Draft")
        return err("CONFLICT", "Only drafts can be edited.");
    } else {
      p = {
        id: nextId("prop"),
        pi: caller.id,
        status: "Draft",
        submissionDate: null,
        version: 1,
        documents: [],
        review: null,
      };
      DB.proposals.push(p);
      audit(caller.id, "PROPOSAL_CREATED", p.id, "New proposal draft created");
    }
    Object.assign(p, data, { lastUpdated: nowISO() });
    if (p.budget === "") p.budget = null;
    saveDB();
    return { ok: true, id: p.id };
  },

  submit(id, caller) {
    // UC-004, FR-008
    const p = findProposal(id);
    if (!p) return err("NOT_FOUND", "Proposal not found.");
    if (p.pi !== caller.id)
      return err(
        "FORBIDDEN",
        "Access denied: only the owning PI can submit this draft.",
      ); // BR-001
    if (p.status !== "Draft")
      return err("CONFLICT", "Cannot submit: proposal is not in Draft status.");
    const v = this.validate(p);
    if (!v.ok)
      return err(
        "UNPROCESSABLE",
        "Submission rejected. Missing fields: " +
          v.missing.join(", ") +
          ". Proposal remains in Draft.",
        v.missing,
      ); // BR-002, NFR-010
    p.status = "Under Review";
    p.submissionDate = nowISO();
    p.lastUpdated = nowISO();
    audit(
      caller.id,
      "PROPOSAL_SUBMITTED",
      p.id,
      "Proposal submitted for committee review",
    );
    usersByRole("APPROVER").forEach((a) =>
      notify(
        a.id,
        "review",
        `New proposal ${p.id} (${p.title}) submitted for review.`,
      ),
    ); // UC-004 step 9
    saveDB();
    return { ok: true, proposal: p };
  },

  decide(id, approver, decision, comments, fundingConfirmed) {
    // UC-005, FR-009…FR-011
    if (approver.role !== "APPROVER")
      return err("FORBIDDEN", "Forbidden: your role cannot approve proposals."); // FR-004
    const p = findProposal(id);
    if (!p) return err("NOT_FOUND", "Proposal not found.");
    if (p.status !== "Under Review")
      return err(
        "CONFLICT",
        "This proposal is no longer Under Review. Refresh the queue.",
      );
    comments = (comments || "").trim();

    if (decision === "Rejected") {
      if (!comments)
        return err(
          "UNPROCESSABLE",
          "Reject blocked: comments are required when rejecting a proposal.",
        ); // BR-006
      p.status = "Rejected";
      p.review = {
        decision: "Rejected",
        reviewer: approver.id,
        reviewDate: nowISO(),
        comments,
      };
      audit(approver.id, "PROPOSAL_REJECTED", p.id, comments);
      notify(
        p.pi,
        "decision",
        `Proposal ${p.id} (${p.title}) was rejected. Reviewer comments: ${comments}`,
      ); // FR-029
      saveDB();
      return { ok: true, proposal: p };
    }

    if (decision === "Approved") {
      p.status = "Approved";
      p.review = {
        decision: "Approved",
        reviewer: approver.id,
        reviewDate: nowISO(),
        comments: comments || "—",
        fundingConfirmed: !!fundingConfirmed,
      };
      audit(
        approver.id,
        "PROPOSAL_APPROVED",
        p.id,
        fundingConfirmed
          ? "Approved; funding sanction confirmed"
          : "Approved; funding confirmation pending",
      );
      let project;
      if (fundingConfirmed) {
        project = createProject(p, "Active"); // FR-011, BR-007
        notify(
          p.pi,
          "decision",
          `Proposal ${p.id} (${p.title}) was approved. Project ${project.id} is now Active.`,
        ); // FR-029
      } else {
        // UC-005 alt flow b — deferred activation
        project = createProject(p, "Pending Funding");
        notify(
          p.pi,
          "decision",
          `Proposal ${p.id} (${p.title}) was approved. Project activation is deferred until the funding agency confirms the sanction.`,
        );
      }
      saveDB();
      return { ok: true, proposal: p, project, deferred: !fundingConfirmed };
    }
    return err("BAD_REQUEST", "Unknown decision.");
  },

  withdraw(id, caller) {
    // UC-006, FR-012
    const p = findProposal(id);
    if (!p) return err("NOT_FOUND", "Proposal not found.");
    if (p.pi !== caller.id)
      return err(
        "FORBIDDEN",
        "Access denied: only the owning PI can withdraw this proposal.",
      );
    if (p.status !== "Under Review")
      return err(
        "CONFLICT",
        "Only proposals that are Under Review can be withdrawn.",
      );
    p.status = "Draft";
    p.submissionDate = null;
    p.lastUpdated = nowISO();
    audit(
      caller.id,
      "PROPOSAL_WITHDRAWN",
      p.id,
      "Withdrawn by PI before decision",
    );
    saveDB();
    return { ok: true };
  },
};

/* ---------- Project & Milestone Tracking (UC-011/012) ---------- */
function createProject(p, status) {
  const proj = {
    id: nextId("prj"),
    proposalId: p.id,
    title: p.title,
    pi: p.pi,
    domain: p.domain,
    status,
    startDate: todayISO(),
    expectedEndDate: addMonthsISO(todayISO(), 12),
    actualEndDate: null,
    activationDate: todayISO(),
    funding: {
      source: p.fundingSource,
      sanctioned: p.budget || 0,
      received: 0,
      utilized: 0,
    },
    disbursements: [],
    utilizations: [],
  };
  DB.projects.push(proj);
  const names = (p.expectedMilestones || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  names.forEach((nm, i) => {
    const name = nm.replace(/^M\d+[:.\-\s]+/i, "") || nm; // strip a leading code so it isn't doubled
    DB.milestones.push({
      id: nextId("ms"),
      projectId: proj.id,
      code: "M" + (i + 1),
      name,
      description: "",
      targetDate: addMonthsISO(proj.startDate, 3 * (i + 1)),
      status: "Not Started",
      completionDate: null,
      remarks: "",
      deliverables: [],
    });
  });
  audit(
    p.pi,
    "PROJECT_CREATED",
    proj.id,
    status === "Active"
      ? "Project created from approved proposal"
      : "Project created; activation deferred until funding confirmation",
  );
  if (status === "Active")
    audit(p.pi, "PROJECT_ACTIVATED", proj.id, "Project is Active");
  return proj;
}

const MilestoneService = {
  displayStatus(m) {
    // FR-017 'Overdue'
    if (
      (m.status === "In Progress" || m.status === "Not Started") &&
      m.targetDate < todayISO()
    )
      return "Overdue";
    return m.status;
  },

  submitCompletion(id, caller, evidence, remarks) {
    // UC-011, FR-018
    const m = findMilestone(id);
    if (!m) return err("NOT_FOUND", "Milestone not found.");
    const proj = findProject(m.projectId);
    if (proj.pi !== caller.id)
      return err(
        "FORBIDDEN",
        "Access denied: only the project PI can submit this milestone.",
      ); // BR-016, BR-024
    if (proj.status !== "Active")
      return err("CONFLICT", "Blocked: project is On Hold or Completed.");
    if (m.status !== "In Progress")
      return err("CONFLICT", "Denied: milestone is not In Progress.");
    if (!evidence || !evidence.length)
      return err(
        "UNPROCESSABLE",
        "Submission rejected: upload at least one evidence document.",
      ); // FR-018, BR-013
    evidence.forEach((f) => {
      const prev = DB.documents.filter(
        (d) => d.projectId === proj.id && d.name === f.name,
      );
      DB.documents.push({
        id: nextId("doc"),
        projectId: proj.id,
        milestoneId: m.id,
        type: "Milestone Evidence",
        name: f.name,
        size: f.size,
        version: prev.length + 1, // FR-028 versioning
        uploadedBy: caller.id,
        uploadDate: todayISO(),
      });
    });
    m.status = "Submitted for Review";
    if (remarks) m.remarks = remarks;
    m.submittedAt = nowISO();
    audit(
      caller.id,
      "MILESTONE_SUBMITTED",
      m.id,
      `${m.code} ${m.name} submitted for completion review`,
    );
    usersByRole("APPROVER").forEach((a) =>
      notify(
        a.id,
        "review",
        `Milestone ${m.code} (${m.name}) of ${proj.title} submitted for completion review.`,
      ),
    ); // FR-030
    saveDB();
    return { ok: true };
  },

  decide(id, approver, decision, comments) {
    // UC-012, FR-019, AC-19/20
    if (approver.role !== "APPROVER")
      return err(
        "FORBIDDEN",
        "Forbidden: your role cannot review milestone completions.",
      );
    const m = findMilestone(id);
    if (!m) return err("NOT_FOUND", "Milestone not found.");
    const proj = findProject(m.projectId);
    if (m.status !== "Submitted for Review")
      return err(
        "CONFLICT",
        "This milestone is no longer Submitted for Review. Refresh the queue.",
      );
    comments = (comments || "").trim();

    if (decision === "Completed") {
      m.status = "Completed";
      m.completionDate = todayISO();
      if (comments) m.remarks = comments;
      m.deliverables.forEach((d) => {
        if (d.status !== "Submitted") {
          d.status = "Submitted";
          d.submissionDate = todayISO();
          d.submittedBy = proj.pi;
        }
      });
      audit(
        approver.id,
        "MILESTONE_COMPLETED",
        m.id,
        comments || "Milestone completion approved",
      );
      notify(
        proj.pi,
        "approval",
        `Milestone ${m.code} (${m.name}) of ${proj.title} was approved and marked Completed.`,
      );
    } else if (decision === "Revision Required") {
      if (!comments)
        return err(
          "UNPROCESSABLE",
          "Revision request blocked: comments are required.",
        ); // AC-20
      m.status = "In Progress";
      m.remarks = comments;
      audit(approver.id, "MILESTONE_REVISION_REQUESTED", m.id, comments);
      notify(
        proj.pi,
        "revision",
        `Revision requested for milestone ${m.code} (${m.name}) of ${proj.title}: ${comments}`,
      );
    } else {
      return err("BAD_REQUEST", "Unknown decision.");
    }
    saveDB();
    return { ok: true };
  },
};

/* ---------- Funding Management (UC-013/014/018, FR-022…FR-025) ---------- */
const FundingService = {
  utilizationPct(proj) {
    return proj.funding.sanctioned > 0
      ? Math.round((proj.funding.utilized / proj.funding.sanctioned) * 100)
      : 0;
  },

  recordUtilization(projectId, caller, e) {
    // UC-014, FR-023, AC-21…26
    if (caller.role !== "COORDINATOR")
      return err(
        "FORBIDDEN",
        "Only Research Coordinators can record fund utilization.",
      );
    const proj = findProject(projectId);
    if (!proj) return err("NOT_FOUND", "Project not found.");
    if (proj.funding.sanctioned <= 0)
      return err(
        "CONFLICT",
        "Project has no recorded funding allocation (AC-22).",
      );
    const amt = Number(e.amount);
    if (!e.category || !(amt > 0))
      return err(
        "UNPROCESSABLE",
        "Enter a category and an amount greater than zero (AC-23).",
      );
    proj.funding.utilized += amt;
    proj.utilizations.unshift({
      category: e.category,
      description: e.description || "",
      amount: amt,
      date: e.date || todayISO(),
      recordedBy: caller.id,
    });
    audit(
      caller.id,
      "FUNDING_UTILIZATION_RECORDED",
      proj.id,
      `${e.category}: ${fmtMoney(amt)}${e.description ? " — " + e.description : ""}`,
    );
    const pct = this.utilizationPct(proj);
    if (pct >= 80) {
      // FR-025 budget overrun alert
      const msg = `Warning: funding utilization for ${proj.title} (${proj.id}) has reached ${pct}% of the sanctioned budget.`;
      notify(proj.pi, "funding", msg);
      notify(caller.id, "funding", msg);
    }
    saveDB();
    return { ok: true, pct };
  },

  recordDisbursement(projectId, caller, e) {
    // FR-022 disbursement schedule
    if (caller.role !== "FUNDING")
      return err(
        "FORBIDDEN",
        "Only Funding Agency representatives can record disbursements.",
      );
    const proj = findProject(projectId);
    if (!proj) return err("NOT_FOUND", "Project not found.");
    const amt = Number(e.amount);
    if (!(amt > 0))
      return err("UNPROCESSABLE", "Enter an amount greater than zero.");
    proj.funding.received += amt;
    proj.disbursements.unshift({
      amount: amt,
      date: e.date || todayISO(),
      recordedBy: caller.id,
    });
    audit(
      caller.id,
      "FUNDING_DISBURSED",
      proj.id,
      `${fmtMoney(amt)} disbursed`,
    );
    notify(
      proj.pi,
      "funding",
      `${fmtMoney(amt)} was disbursed to ${proj.title} (${proj.id}) by the funding agency.`,
    );
    saveDB();
    return { ok: true };
  },

  confirmSanction(projectId, caller) {
    // UC-005 alt flow b, BR-007
    if (caller.role !== "FUNDING")
      return err(
        "FORBIDDEN",
        "Only Funding Agency representatives can confirm sanctions.",
      );
    const proj = findProject(projectId);
    if (!proj) return err("NOT_FOUND", "Project not found.");
    if (proj.status !== "Pending Funding")
      return err(
        "CONFLICT",
        "Funding already confirmed or project not awaiting sanction.",
      );
    proj.status = "Active";
    audit(
      caller.id,
      "FUNDING_SANCTION_CONFIRMED",
      proj.id,
      "External funding sanction confirmed",
    );
    audit(caller.id, "PROJECT_ACTIVATED", proj.id, "Project is Active");
    notify(
      proj.pi,
      "approval",
      `Funding for ${proj.title} (${proj.id}) was confirmed by the agency. The project is now Active.`,
    ); // FR-031
    saveDB();
    return { ok: true };
  },
};

/* ---------- Administration (UC-002, FR-004, BR-019/020) ---------- */
const AdminService = {
  createUser(actor, data) {
    // UC-002, FR-004, BR-019: only administrators may provision accounts with roles
    if (actor.role !== "ADMIN")
      return err(
        "FORBIDDEN",
        "Only administrators can create user accounts and assign roles.",
      );
    const name = String(data.name || "").trim();
    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    const dept = String(data.dept || "").trim();
    const role = data.role;
    const password = String(data.password || "");
    if (!name) return err("UNPROCESSABLE", "Enter the user's full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return err("UNPROCESSABLE", "Enter a valid email address.");
    if (DB.users.some((u) => u.email.toLowerCase() === email))
      return err("CONFLICT", "An account with this email already exists.");
    if (!VALID_ROLES.includes(role))
      return err("UNPROCESSABLE", "Choose a valid role.");
    if (password.length < 6)
      return err("UNPROCESSABLE", "Password must be at least 6 characters long.");
    const user = {
      id: nextId("usr"),
      name,
      email,
      role,
      dept: dept || "—",
      active: true,
      passwordHash: fakeHash(password),
      registeredOn: todayISO(),
    };
    DB.users.push(user);
    audit(actor.id, "USER_CREATED", user.id, `Account created with role ${role}`);
    notify(
      user.id,
      "system",
      `Welcome to RPMS! Your ${role} account was created by the system administrator.`,
    );
    saveDB();
    return { ok: true, user };
  },

  setRole(actor, userId, role) {
    if (actor.role !== "ADMIN")
      return err("FORBIDDEN", "Only administrators can change user roles."); // BR-019
    const u = DB.users.find((x) => x.id === userId);
    if (!u) return err("NOT_FOUND", "User not found.");
    u.role = role;
    audit(actor.id, "USER_ROLE_CHANGED", u.id, `Role set to ${role}`);
    saveDB();
    return { ok: true };
  },
  setActive(actor, userId, active) {
    if (actor.role !== "ADMIN")
      return err(
        "FORBIDDEN",
        "Only administrators can activate or deactivate accounts.",
      ); // BR-019
    const u = DB.users.find((x) => x.id === userId);
    if (!u) return err("NOT_FOUND", "User not found.");
    u.active = active;
    audit(
      actor.id,
      active ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      u.id,
      active
        ? "Account activated"
        : "Account deactivated; historical records retained (NFR-014)",
    );
    saveDB();
    return { ok: true };
  },
  markAllNotificationsRead(userId) {
    DB.notifications.forEach((n) => {
      if (n.recipient === userId) n.read = true;
    });
    saveDB();
  },
};

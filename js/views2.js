'use strict';
/* ==========================================================================
   RPMS prototype — views, part 2: review queue (UC-005), milestones (UC-011/012),
   funding, users, audit, notifications, projects
   ========================================================================== */

let pendingEvidence = [];   // in-memory evidence files for the current milestone form

function requireRole(u, roles, what){
  if(roles.includes(u.role)) return true;
  appEl().innerHTML = page('Forbidden', what||'', 
    alertBox('error',`Forbidden: your role (${ROLE_LABEL[u.role]}) cannot access this page (FR-004, NFR-006).`));
  return false;
}

/* ---------- Approver review queue (UC-005 start, wireframe 05) ---------- */
function viewReviewQueue(_, u){
  if(!requireRole(u,['APPROVER'],'Research Committee review queue')) return;
  const q = DB.proposals.filter(p=>p.status==='Under Review')
    .sort((a,b)=> (a.submissionDate||'') < (b.submissionDate||'') ? -1 : 1);
  const mq = DB.milestones.filter(m=>m.status==='Submitted for Review');
  appEl().innerHTML = page('Review Queue','Proposals and milestone completions awaiting decision', `
    <section class="card"><h2>Proposals Under Review</h2>
      ${q.length ? table(['Proposal ID','Title','PI','Submitted','Budget','Action'], q.map(p=>[
          p.id, `<a href="#/review/${p.id}">${esc(p.title)}</a>`, esc(userById(p.pi).name),
          fmtDate(p.submissionDate), fmtMoney(p.budget), `<a href="#/review/${p.id}">Open</a>`
        ])) : emptyState('No proposals are waiting for review. (M-18)')}
    </section>
    <section class="card"><h2>Milestone completions to verify</h2>
      ${mq.length ? table(['Milestone','Project','Target date','Action'], mq.map(m=>{
          const proj = findProject(m.projectId);
          return [`${m.code} ${esc(m.name)}`, `<a href="#/project/${proj.id}">${esc(proj.title)}</a>`,
                  fmtDate(m.targetDate), `<a href="#/milestone/${m.id}">Open</a>`];
        })) : emptyState('No milestone completions to verify.')}
    </section>`);
}

/* ---------- Review / Approve / Reject a proposal (UC-005 main, wireframe 06) ---------- */
function viewReviewProposal(id, u){
  if(!requireRole(u,['APPROVER'],'Proposal review')) return;
  const p = findProposal(id);
  if(!p){ appEl().innerHTML = page('Not found','', emptyState('Proposal not found.')); return; }
  const locked = p.status !== 'Under Review';
  appEl().innerHTML = page('Review Proposal '+p.id, `${pill(p.status)} · PI: ${esc(userById(p.pi).name)} · Submitted: ${fmtDateTime(p.submissionDate)}`, `
    <div id="review-msg">
      ${locked ? alertBox('error','This proposal is no longer Under Review. Refresh the review queue. (M-13)') : ''}
    </div>
    <section class="card"><h2>Proposal details (read-only)</h2>
      <div class="summary"><dl>
        <dt>Project title</dt><dd>${esc(p.title)}</dd>
        <dt>Funding source</dt><dd>${esc(p.fundingSource)}</dd>
        <dt>Budget (INR)</dt><dd>${fmtMoney(p.budget)}</dd>
        <dt>Proposed dates</dt><dd>${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}</dd>
      </dl></div>
      <h3>Abstract</h3><div class="ro">${esc(p.abstract)}</div>
      <h3>Objectives</h3><div class="ro">${esc(p.objectives)}</div>
      <h3>Methodology</h3><div class="ro">${esc(p.methodology)}</div>
      <h3>Expected outcomes</h3><div class="ro">${esc(p.expectedOutcomes)}</div>
      <h3>Expected milestones</h3><div class="ro">${esc(p.expectedMilestones)}</div>
      <h3>Supporting documents</h3>
      ${p.documents.length ? table(['Name','Type','Version','Size','Uploaded'], p.documents.map(d=>[
          esc(d.name), esc(d.type), 'v'+d.version, esc(d.size), fmtDate(d.uploadDate)])) : emptyState('None.')}
    </section>
    ${locked ? '' : `
    <section class="form-card">
      <div class="field">
        <label><input type="checkbox" id="rv-funding" style="width:auto;margin-right:8px">
        Funding sanction confirmed by the funding agency</label>
        <p class="quiet">Simulates the external funding-agency check (UC-005 step 5). If left unchecked, the project is
        created as “Pending Funding” and activation is deferred (BR-007, alt flow b).</p>
      </div>
      <div class="field"><label for="rv-comments">Review comments (required when rejecting)</label>
        <textarea id="rv-comments" placeholder="Enter comments for the Principal Investigator…"></textarea></div>
      <div class="row-actions">
        <button class="btn btn-success" id="rv-approve">Approve</button>
        <button class="btn btn-danger" id="rv-reject">Reject</button>
        <a class="btn btn-light" href="#/review">Back to queue</a>
      </div>
    </section>`}
  `);
  if(locked) return;
  const comments = () => document.getElementById('rv-comments').value;
  const showErr = res => {
    document.getElementById('review-msg').innerHTML = alertBox('error', esc(res.message));
    window.scrollTo({top:0, behavior:'smooth'});
  };
  document.getElementById('rv-approve').onclick = () => {
    const res = ProposalService.decide(p.id, u, 'Approved', comments(),
                                       document.getElementById('rv-funding').checked);
    if(!res.ok) return showErr(res);
    toast(res.deferred
      ? 'Proposal approved — project activation deferred until funding confirmation.'
      : 'Proposal approved. The project is now Active. (M-15)');
    location.hash = '#/review';
  };
  document.getElementById('rv-reject').onclick = () => {
    const res = ProposalService.decide(p.id, u, 'Rejected', comments());
    if(!res.ok) return showErr(res);
    toast('Proposal rejected. The PI has been notified.');
    location.hash = '#/review';
  };
}

/* ---------- Milestone detail: submit completion (PI) / verify (Approver) ---------- */
function viewMilestone(id, u){
  const m = findMilestone(id);
  if(!m){ appEl().innerHTML = page('Not found','', emptyState('Milestone not found.')); return; }
  const proj = findProject(m.projectId);
  const isOwner = proj.pi === u.id;
  if(!canViewProject(u, proj)){
    appEl().innerHTML = page('Forbidden','', alertBox('error','Access denied (BR-024).')); return;
  }
  const deliverables = table(['Deliverable','Due date','Status'], m.deliverables.map(d=>[
    esc(d.name), fmtDate(d.dueDate), pill(d.status)])) || emptyState('No deliverables recorded.');
  const evidence = DB.documents.filter(d=>d.projectId===proj.id && d.milestoneId===m.id);
  const evidenceTable = evidence.length ? table(['Evidence document','Version','Size','Uploaded'],
      evidence.map(d=>[esc(d.name),'v'+d.version,esc(d.size),fmtDate(d.uploadDate)]))
    : emptyState('No evidence documents uploaded yet.');

  appEl().innerHTML = page('Milestone '+m.code+' — '+m.name, '', `
    <div id="ms-msg"></div>
    <div class="summary"><dl>
      <dt>Milestone</dt><dd>${m.code} ${esc(m.name)}</dd>
      <dt>Project</dt><dd><a href="#/project/${proj.id}">${esc(proj.title)}</a> ${pill(proj.status)}</dd>
      <dt>Target date</dt><dd>${fmtDate(m.targetDate)}</dd>
      <dt>Current status</dt><dd>${pill(MilestoneService.displayStatus(m))}</dd>
      ${m.remarks?`<dt>Remarks</dt><dd>${esc(m.remarks)}</dd>`:''}
    </dl></div>
    <section class="card"><h2>Associated deliverables</h2>${deliverables}</section>
    <section class="card"><h2>Evidence documents</h2>${evidenceTable}</section>
    <div id="ms-form"></div>
  `);

  const formEl = document.getElementById('ms-form');
  if(u.role === 'APPROVER' && m.status === 'Submitted for Review'){
    formEl.innerHTML = `
      <section class="form-card">
        <p>Verify the completion evidence above, then approve the milestone or request a revision (UC-012, FR-019).</p>
        <div class="field"><label for="ms-comments">Comments (required when requesting revision)</label>
          <textarea id="ms-comments" placeholder="Comments for the PI…"></textarea></div>
        <div class="row-actions">
          <button class="btn btn-success" id="ms-approve">Approve Completion</button>
          <button class="btn btn-warn" id="ms-revision">Request Revision</button>
          <a class="btn btn-light" href="#/review">Back to queue</a>
        </div>
      </section>`;
    const showErr = res => {
      document.getElementById('ms-msg').innerHTML = alertBox('error', esc(res.message));
      window.scrollTo({top:0, behavior:'smooth'});
    };
    document.getElementById('ms-approve').onclick = () => {
      const res = MilestoneService.decide(m.id, u, 'Completed', document.getElementById('ms-comments').value);
      if(!res.ok) return showErr(res);
      toast('Milestone approved and marked Completed.');
      viewMilestone(m.id, u);
    };
    document.getElementById('ms-revision').onclick = () => {
      const res = MilestoneService.decide(m.id, u, 'Revision Required', document.getElementById('ms-comments').value);
      if(!res.ok) return showErr(res);
      toast('Revision requested — milestone returned to In Progress.');
      viewMilestone(m.id, u);
    };
  }
  else if(isOwner && m.status === 'In Progress' && proj.status === 'Active'){
    pendingEvidence = [];
    formEl.innerHTML = `
      <section class="form-card">
        <h2 style="margin-top:0">Submit Milestone for Completion Review (UC-011)</h2>
        <div class="field"><label>Evidence documents <span class="req">*</span> (at least one, FR-018 / BR-013)</label>
          <div class="upload-row">
            <input type="file" id="ev-file" multiple style="flex:1">
            <button class="btn btn-light" id="ev-add" type="button">Add evidence</button>
          </div>
          <div class="filelist" id="ev-list"></div>
        </div>
        <div class="field"><label for="ms-remarks">Remarks (optional)</label>
          <textarea id="ms-remarks" placeholder="Add remarks for the approver…"></textarea></div>
        <div class="row-actions">
          <button class="btn btn-primary" id="ms-submit">Submit for Review</button>
          <a class="btn btn-light" href="#/dashboard">Cancel</a>
        </div>
      </section>`;
    const renderChips = () => {
      document.getElementById('ev-list').innerHTML = pendingEvidence.map((f,i)=>
        `<div class="filechip"><span>${esc(f.name)} (${esc(f.size)}) — ready to upload</span>
         <button data-i="${i}" type="button">Remove</button></div>`).join('');
      document.querySelectorAll('#ev-list button').forEach(b => b.onclick = () => {
        pendingEvidence.splice(Number(b.dataset.i),1); renderChips();
      });
    };
    document.getElementById('ev-add').onclick = () => {
      const inp = document.getElementById('ev-file');
      [...inp.files].forEach(f => pendingEvidence.push({name:f.name, size:humanSize(f.size)}));
      inp.value = '';
      renderChips();
    };
    document.getElementById('ms-submit').onclick = () => {
      const res = MilestoneService.submitCompletion(m.id, u, pendingEvidence,
                                                    document.getElementById('ms-remarks').value);
      if(!res.ok){
        document.getElementById('ms-msg').innerHTML = alertBox('error', esc(res.message));
        window.scrollTo({top:0, behavior:'smooth'});
        return;
      }
      toast('Milestone submitted for completion review. Approvers have been notified.');
      location.hash = '#/dashboard';
    };
  }
  else{
    formEl.innerHTML = `<section class="card"><p class="quiet">Read-only view. Submission is available to the project PI
      while the milestone is In Progress and the project is Active.</p></section>`;
  }
}

/* ---------- Funding management (UC-013/014/018, FR-022…025) ---------- */
function viewFunding(_, u){
  if(!requireRole(u,['COORDINATOR','FUNDING','ADMIN','AUDITOR','PI'],'Funding management')) return;
  const projects = u.role === 'PI' ? DB.projects.filter(p=>p.pi===u.id) : DB.projects;
  let forms = '';
  if(u.role === 'COORDINATOR'){
    forms = `<section class="form-card"><h2 style="margin-top:0">Record Fund Utilization (UC-014, FR-023)</h2>
      <div class="grid2">
        <div class="field"><label for="ut-proj">Project</label><select id="ut-proj">
          ${projects.map(p=>`<option value="${p.id}">${p.id} — ${esc(p.title)}</option>`).join('')}</select></div>
        <div class="field"><label for="ut-cat">Category</label><select id="ut-cat">
          ${['Equipment','Consumables','Travel','Manpower','Other'].map(c=>`<option>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="ut-amt">Amount (INR) <span class="req">*</span></label>
          <input type="number" id="ut-amt" min="1" placeholder="e.g. 50000"></div>
        <div class="field"><label for="ut-date">Date</label><input type="date" id="ut-date" value="${todayISO()}"></div>
      </div>
      <div class="field"><label for="ut-desc">Description</label>
        <input type="text" id="ut-desc" placeholder="What was this spending for?"></div>
      <div class="row-actions"><button class="btn btn-primary" id="ut-save">Record Utilization</button></div>
    </section>`;
  }
  if(u.role === 'FUNDING'){
    forms = `<section class="form-card"><h2 style="margin-top:0">Record Disbursement (FR-022)</h2>
      <div class="grid2">
        <div class="field"><label for="db-proj">Project</label><select id="db-proj">
          ${projects.map(p=>`<option value="${p.id}">${p.id} — ${esc(p.title)}</option>`).join('')}</select></div>
        <div class="field"><label for="db-amt">Amount (INR) <span class="req">*</span></label>
          <input type="number" id="db-amt" min="1" placeholder="e.g. 600000"></div>
        <div class="field"><label for="db-date">Date</label><input type="date" id="db-date" value="${todayISO()}"></div>
      </div>
      <div class="row-actions"><button class="btn btn-primary" id="db-save">Record Disbursement</button></div>
    </section>`;
  }
  appEl().innerHTML = page('Funding Management',
    'Sanctioned budget, disbursements and utilization per project (FR-022…FR-025)', `
    ${forms}
    <div id="fund-cards">${projects.map(p => fundingCard(p, { extra: fundingCardExtra(p, u) })).join('') || emptyState('No projects with funding yet.')}</div>`);
  if(u.role === 'COORDINATOR'){
    document.getElementById('ut-save').onclick = () => {
      const res = FundingService.recordUtilization(document.getElementById('ut-proj').value, u, {
        amount: document.getElementById('ut-amt').value,
        category: document.getElementById('ut-cat').value,
        description: document.getElementById('ut-desc').value,
        date: document.getElementById('ut-date').value,
      });
      if(!res.ok) return toast(res.message,'error');
      toast(res.pct >= 80 ? `Utilization recorded — budget alert raised at ${res.pct}% (FR-025).` : 'Utilization entry recorded (AC-24).');
      viewFunding(null, u);
    };
  }
  if(u.role === 'FUNDING'){
    document.getElementById('db-save').onclick = () => {
      const res = FundingService.recordDisbursement(document.getElementById('db-proj').value, u, {
        amount: document.getElementById('db-amt').value, date: document.getElementById('db-date').value });
      if(!res.ok) return toast(res.message,'error');
      toast('Disbursement recorded.');
      viewFunding(null, u);
    };
    document.querySelectorAll('[data-confirm-sanction]').forEach(b => b.onclick = () => {
      const res = FundingService.confirmSanction(b.dataset.confirmSanction, u);
      if(!res.ok) return toast(res.message,'error');
      toast('Funding sanction confirmed — project activated (BR-007).');
      viewFunding(null, u);
    });
  }
}

function fundingCardExtra(proj, u){
  const rows = [];
  if(u.role !== 'PI'){
    if(proj.disbursements.length)
      rows.push('<h3>Disbursements</h3>' + table(['Date','Amount','Recorded by'], proj.disbursements.map(d=>[
        fmtDate(d.date), fmtMoney(d.amount), esc(userById(d.recordedBy).name)])));
    if(proj.utilizations.length)
      rows.push('<h3>Utilization entries</h3>' + table(['Date','Category','Description','Amount','Recorded by'],
        proj.utilizations.slice(0,6).map(x=>[
          fmtDate(x.date), esc(x.category), esc(x.description), fmtMoney(x.amount), esc(userById(x.recordedBy).name)])));
  }
  if(u.role === 'FUNDING' && proj.status === 'Pending Funding')
    rows.push('<div class="row-actions"><button class="btn btn-success" data-confirm-sanction="'+proj.id+'">Confirm Funding Sanction</button></div>');
  return rows.join('');
}

/* ---------- Users & roles (UC-002, FR-004, BR-019/020) ---------- */
function viewUsers(_, u){
  if(!requireRole(u,['ADMIN'],'User administration')) return;
  appEl().innerHTML = page('Manage Users & Roles','FR-004: only administrators may assign or modify roles (BR-019)', `
    <section class="form-card"><h2 style="margin-top:0">Create User (UC-002)</h2>
      <div class="grid2">
        <div class="field"><label for="nu-name">Full name <span class="req">*</span></label>
          <input type="text" id="nu-name" placeholder="e.g. Prof. N. Agarwal"></div>
        <div class="field"><label for="nu-dept">Department</label>
          <input type="text" id="nu-dept" placeholder="e.g. Research Committee"></div>
        <div class="field"><label for="nu-email">Email <span class="req">*</span></label>
          <input type="email" id="nu-email" placeholder="name@lnmiit.ac.in"></div>
        <div class="field"><label for="nu-role">Role <span class="req">*</span></label>
          <select id="nu-role">${Object.keys(ROLE_LABEL).map(r=>`<option value="${r}" ${r==='PI'?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}</select></div>
        <div class="field"><label for="nu-pass">Initial password <span class="req">*</span></label>
          <input type="password" id="nu-pass" placeholder="At least 6 characters"></div>
      </div>
      <div class="row-actions"><button class="btn btn-primary" id="nu-save">Create User</button></div>
      <p class="quiet">Provisioning other roles lives here because the SRS reserves role assignment for
      administrators (BR-019) — self-registration always joins as a Principal Investigator.</p>
    </section>
    <section class="card">
      ${table(['Name','Email','Department','Role','Status','Action'], DB.users.map(x=>[
        esc(x.name), esc(x.email), esc(x.dept),
        `<select data-user="${x.id}" class="role-sel">
           ${Object.keys(ROLE_LABEL).map(r=>`<option value="${r}" ${r===x.role?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}
         </select>`,
        x.active ? pill('Active') : pill('Rejected').replace('>Rejected<','>Deactivated<'),
        `<button class="btn btn-sm ${x.active?'btn-danger':''}" data-toggle="${x.id}">${x.active?'Deactivate':'Activate'}</button>`
      ]))}
      <p class="quiet">Deactivated users cannot log in (BR-020); their historical records are retained (NFR-014).</p>
    </section>`);
  document.getElementById('nu-save').onclick = () => {
    const val = id => document.getElementById(id).value;
    const res = AdminService.createUser(u, { name:val('nu-name'), email:val('nu-email'),
      dept:val('nu-dept'), role:val('nu-role'), password:val('nu-pass') });
    if(!res.ok){ toast(res.message,'error'); return; }
    toast('User created with role ' + val('nu-role') + '.');
    viewUsers(null, u);
  };
  document.querySelectorAll('.role-sel').forEach(sel => sel.onchange = () => {
    const res = AdminService.setRole(u, sel.dataset.user, sel.value);
    toast(res.ok ? 'Role updated (BR-019) and written to the audit log.' : res.message, res.ok?'success':'error');
    if(res.ok) viewUsers(null, u);
  });
  document.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => {
    const target = DB.users.find(x=>x.id===b.dataset.toggle);
    const res = AdminService.setActive(u, target.id, !target.active);
    toast(res.ok ? (target.active?'Account deactivated.':'Account activated.') : res.message, res.ok?'success':'error');
    if(res.ok) viewUsers(null, u);
  });
}

/* ---------- Audit log (UC-019, NFR-024/025) ---------- */
function viewAudit(_, u){
  if(!requireRole(u,['ADMIN','AUDITOR'],'Audit trail')) return;
  appEl().innerHTML = page('Audit Log','Append-only record of significant actions (NFR-024, NFR-025) — read-only', `
    <section class="card">
      ${table(['Time','Actor','Action','Target','Remarks'], DB.auditLog.map(a=>[
        fmtDateTime(a.time), esc(userById(a.actor).name), esc(a.action), esc(a.target), esc(a.remarks)]))}
    </section>`);
}

/* ---------- Notifications (FR-029…FR-031) ---------- */
function viewNotifications(_, u){
  const unread = unreadCount(u.id);
  appEl().innerHTML = page('Notifications', unread+' unread', `
    <section class="card">
      <div class="row-actions" style="margin-top:0">
        ${unread ? '<button class="btn btn-sm" id="ntf-read">Mark all as read</button>' : '<span class="quiet">All caught up.</span>'}
      </div>
      ${notifList(u.id, 100)}
    </section>`);
  const b = document.getElementById('ntf-read');
  if(b) b.onclick = () => { AdminService.markAllNotificationsRead(u.id); viewNotifications(null, u); };
}

/* ---------- Projects browse (UC-007/008, FR-013/014) ---------- */
const projFilter = { q:'', status:'', domain:'' };
function viewProjects(_, u){
  const domains = [...new Set(visibleProjects(u).map(p=>p.domain))];
  appEl().innerHTML = page('Projects','Browse, search and filter research projects (FR-013, FR-014)', `
    <section class="card">
      <div class="filters">
        <input id="pq" placeholder="Search title, PI or domain…" value="${esc(projFilter.q)}">
        <select id="ps"><option value="">All statuses</option>
          ${['Active','Pending Funding','On Hold','Completed'].map(s=>`<option ${projFilter.status===s?'selected':''}>${s}</option>`).join('')}</select>
        <select id="pd"><option value="">All domains</option>
          ${domains.map(d=>`<option ${projFilter.domain===d?'selected':''}>${esc(d)}</option>`).join('')}</select>
      </div>
      <div id="ptab">${projectsTable(u)}</div>
    </section>`);
  document.getElementById('pq').oninput = e => { projFilter.q = e.target.value; document.getElementById('ptab').innerHTML = projectsTable(u); };
  document.getElementById('ps').onchange = e => { projFilter.status = e.target.value; document.getElementById('ptab').innerHTML = projectsTable(u); };
  document.getElementById('pd').onchange = e => { projFilter.domain = e.target.value; document.getElementById('ptab').innerHTML = projectsTable(u); };
}
function projectsTable(u){
  const q = projFilter.q.toLowerCase();
  const rows = visibleProjects(u).filter(p =>
    (!projFilter.status || p.status === projFilter.status) &&
    (!projFilter.domain || p.domain === projFilter.domain) &&
    (!q || (p.title+' '+userById(p.pi).name+' '+p.domain+' '+p.id).toLowerCase().includes(q))
  );
  return rows.length ? table(['Project ID','Title','PI','Domain','Status','Start','Expected end','Action'],
      rows.map(p=>[p.id, `<a href="#/project/${p.id}">${esc(p.title)}</a>`, esc(userById(p.pi).name),
        esc(p.domain), pill(p.status), fmtDate(p.startDate), fmtDate(p.expectedEndDate),
        `<a href="#/project/${p.id}">View</a>`]))
    : emptyState('No projects match the current filters.');
}

/* ---------- Project detail (UC-008, FR-015) ---------- */
function viewProject(id, u){
  const proj = findProject(id);
  if(!proj){ appEl().innerHTML = page('Not found','', emptyState('Project not found.')); return; }
  if(!canViewProject(u, proj)){
    appEl().innerHTML = page('Forbidden','', alertBox('error',
      'Access denied: you can only view projects you own or are a member of (BR-024, NFR-007).'));
    return;
  }
  const canSeeFunding = u.role !== 'APPROVER' || proj.pi === u.id;   // NFR-023
  const ms = DB.milestones.filter(m=>m.projectId===proj.id);
  const docs = DB.documents.filter(d=>d.projectId===proj.id);
  appEl().innerHTML = page(proj.title, `${proj.id} · ${pill(proj.status)}`, `
    <div class="summary"><dl>
      <dt>Principal Investigator</dt><dd>${esc(userById(proj.pi).name)}</dd>
      <dt>Domain</dt><dd>${esc(proj.domain)}</dd>
      <dt>Timeline</dt><dd>${fmtDate(proj.startDate)} → ${fmtDate(proj.expectedEndDate)}</dd>
      <dt>Linked proposal</dt><dd><a href="#/proposal/${proj.proposalId}">${proj.proposalId}</a></dd>
    </dl></div>
    <section class="card"><h2>Funding</h2>
      ${canSeeFunding ? `
        <div class="fund-nums">
          <div class="fn"><b>${fmtMoney(proj.funding.sanctioned)}</b><span>Sanctioned</span></div>
          <div class="fn"><b>${fmtMoney(proj.funding.received)}</b><span>Disbursed</span></div>
          <div class="fn"><b>${fmtMoney(proj.funding.utilized)}</b><span>Utilized</span></div>
          <div class="fn"><b>${fmtMoney(proj.funding.sanctioned - proj.funding.utilized)}</b><span>Remaining</span></div>
        </div>
        ${utilizationBar(FundingService.utilizationPct(proj))}`
        : alertBox('info','Funding details are restricted for your role (NFR-023).')}
    </section>
    <section class="card"><h2>Milestones &amp; deliverables</h2>
      ${ms.length ? table(['Code','Milestone','Target date','Status','Action'], ms.map(m=>[
          m.code, `<a href="#/milestone/${m.id}">${esc(m.name)}</a>`, fmtDate(m.targetDate),
          pill(MilestoneService.displayStatus(m)),
          `<a href="#/milestone/${m.id}">Open</a>`])) : emptyState('No milestones defined yet.')}
    </section>
    <section class="card"><h2>Documents</h2>
      ${docs.length ? table(['Name','Type','Version','Size','Uploaded by','Uploaded'], docs.map(d=>[
          esc(d.name), esc(d.type), 'v'+d.version, esc(d.size), esc(userById(d.uploadedBy).name), fmtDate(d.uploadDate)]))
        : emptyState('No documents uploaded.')}
      <p class="quiet">Version history is maintained per document name (FR-028).</p>
    </section>
    <div class="row-actions"><a class="btn" href="#/projects">Back to Projects</a></div>`);
}

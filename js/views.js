'use strict';
/* ==========================================================================
   RPMS prototype — views, part 1: login, dashboard, proposal flows (UC-004)
   ========================================================================== */

let pendingEditorError = null;   // carries a failed-submit result into a re-rendered editor
let pendingLoginNotice = null;   // one-shot success message shown after a password reset
const FIELD_IDS = {
  'Project title':'f-title','Abstract':'f-abstract','Objectives':'f-objectives','Methodology':'f-methodology',
  'Expected outcomes':'f-outcomes','Budget (INR)':'f-budget','Proposed start date':'f-start','Expected end date':'f-end',
};

/* ---------- Login (UC-001) ---------- */
function viewLogin(opts){
  opts = opts || {};
  const cur = Auth.current();
  if(cur && !cur.expired){ location.hash = '#/dashboard'; return; }
  const expiredMsg = opts.expired ? alertBox('info','Your session has expired. Please sign in again. (M-03)') : '';
  const resetMsg = pendingLoginNotice ? alertBox('success', esc(pendingLoginNotice)) : '';
  pendingLoginNotice = null;
  appEl().innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <h1>Sign in</h1>
      <p class="sub">Sign in with institutional credentials</p>
      ${expiredMsg}
      ${resetMsg}
      <div id="login-msg"></div>
      <form id="login-form" autocomplete="off">
        <div class="field"><label for="l-email">Email</label>
          <input type="email" id="l-email" placeholder="name@lnmiit.ac.in" required></div>
        <div class="field">
          <div class="label-row"><label for="l-pass">Password</label>
            <a class="quiet-link" href="#/forgot-password">Forgot password?</a></div>
          <input type="password" id="l-pass" placeholder="••••••••" required></div>
        <button class="btn btn-primary btn-block" type="submit">Login</button>
      </form>
      <p class="demo-creds" style="margin-top:12px">New user? <a href="#/register">Create an account</a></p>
      <div class="demo-creds">Demo accounts (password <code>demo123</code>):
        <br>${[['PI','priya.sharma@lnmiit.ac.in'],['Approver','rajesh.gupta@lnmiit.ac.in'],
               ['Coordinator','kavita.rao@lnmiit.ac.in'],['Funding agency','dst.rep@serb.gov.in'],
               ['Admin','admin@lnmiit.ac.in'],['Auditor','auditor@lnmiit.ac.in']]
              .map(([l,e])=>`<button type="button" data-email="${e}">${l}</button>`).join('')}
      </div>
      <p class="demo-creds"><a href="#" id="reset-demo">Reset demo data</a></p>
    </div>
  </div>`;
  document.querySelectorAll('.demo-creds button[data-email]').forEach(b => {
    b.onclick = () => {
      document.getElementById('l-email').value = b.dataset.email;
      document.getElementById('l-pass').value = DEMO_PASSWORD;
    };
  });
  document.getElementById('reset-demo').onclick = e => { e.preventDefault(); resetDB(); };
  document.getElementById('login-form').onsubmit = ev => {
    ev.preventDefault();
    const res = Auth.login(document.getElementById('l-email').value, document.getElementById('l-pass').value);
    if(!res.ok){
      document.getElementById('login-msg').innerHTML = alertBox('error', esc(res.message));
    }else{
      toast('Welcome, ' + res.user.name);
      location.hash = '#/dashboard';
    }
  };
}

/* ---------- Forgot password (self-service reset, NFR-005/024, BR-020) ---------- */
function viewForgotPassword(){
  appEl().innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <h1>Forgot password</h1>
      <p class="sub">Enter the email address registered with RPMS. We will send a single-use reset link that expires in 30 minutes.</p>
      <div id="fp-msg"></div>
      <form id="fp-form" autocomplete="off" novalidate>
        <div class="field"><label for="fp-email">Email</label>
          <input type="email" id="fp-email" placeholder="name@lnmiit.ac.in" required></div>
        <button class="btn btn-primary btn-block" type="submit">Send reset link</button>
      </form>
      <p class="demo-creds"><a href="#/login">Back to sign in</a></p>
    </div>
  </div>`;
  document.getElementById('fp-form').onsubmit = ev => {
    ev.preventDefault();
    const msg = document.getElementById('fp-msg');
    const res = Auth.requestPasswordReset(document.getElementById('fp-email').value);
    if(!res.ok){ msg.innerHTML = alertBox('error', esc(res.message)); return; }
    let preview = '';
    if(res.demoToken){
      const link = '#/reset/' + encodeURIComponent(res.demoToken);
      preview = `
      <div class="mail-preview">
        <div class="mail-head"><b>Simulated email</b>
          <span class="quiet">no mail server is connected to this prototype</span></div>
        <p class="mail-meta"><b>To:</b> ${esc(res.user.email)}<br>
          <b>Subject:</b> Reset your RPMS password</p>
        <p>Use the link below to choose a new password. It is valid for 30 minutes and can be used once.</p>
        <p><a class="mail-link" href="${esc(link)}" id="fp-reset-link">${esc(link)}</a></p>
        <a class="btn btn-primary btn-sm" href="${esc(link)}">Open reset link</a>
        <p class="quiet">Prototype note: the email is displayed here because real delivery is out of scope. Only a digest of the token is stored (NFR-005).</p>
      </div>`;
    }
    msg.innerHTML = alertBox('success', esc(res.message)) + preview;
  };
}

function viewResetPassword(token){
  const check = Auth.checkResetToken(token);
  if(!check.ok){
    appEl().innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Reset link unavailable</h1>
        ${alertBox('error', esc(check.message))}
        <p class="demo-creds"><a href="#/forgot-password">Request a new link</a> · <a href="#/login">Back to sign in</a></p>
      </div>
    </div>`;
    return;
  }
  appEl().innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <h1>Choose a new password</h1>
      <p class="sub">Resetting the password for <b>${esc(check.user.email)}</b></p>
      <div id="rp-msg"></div>
      <form id="rp-form" autocomplete="off" novalidate>
        <div class="field"><label for="rp-pass">New password <span class="req">*</span></label>
          <input type="password" id="rp-pass" autocomplete="new-password" placeholder="At least 6 characters"></div>
        <div class="field"><label for="rp-pass2">Confirm new password <span class="req">*</span></label>
          <input type="password" id="rp-pass2" autocomplete="new-password"></div>
        <button class="btn btn-primary btn-block" type="submit">Reset password</button>
      </form>
      <p class="demo-creds"><a href="#/login">Back to sign in</a></p>
    </div>
  </div>`;
  document.getElementById('rp-form').onsubmit = ev => {
    ev.preventDefault();
    const msg = document.getElementById('rp-msg');
    const pw = document.getElementById('rp-pass').value;
    const pw2 = document.getElementById('rp-pass2').value;
    if(pw.length < 6){
      msg.innerHTML = alertBox('error','Password must be at least 6 characters long.');
      return;
    }
    if(pw !== pw2){
      msg.innerHTML = alertBox('error','Passwords do not match.');
      return;
    }
    const res = Auth.resetPassword(token, pw);
    if(!res.ok){ msg.innerHTML = alertBox('error', esc(res.message)); return; }
    pendingLoginNotice = 'Password reset successfully. Sign in with your new password.';
    toast('Password updated. Please sign in.');
    location.hash = '#/login';
  };
}

/* ---------- Dashboard (role-routed, FR-033) ---------- */
function viewDashboard(_, u){
  if(u.role === 'APPROVER'){ location.hash = '#/review'; return; }
  if(u.role === 'COORDINATOR' || u.role === 'FUNDING'){ location.hash = '#/funding'; return; }
  if(u.role === 'AUDITOR'){ location.hash = '#/audit'; return; }
  if(u.role === 'ADMIN'){ adminDashboard(u); return; }
  piDashboard(u);
}

function piDashboard(u){
  const mine = DB.proposals.filter(p=>p.pi===u.id);
  const drafts = mine.filter(p=>p.status==='Draft').length;
  const underReview = mine.filter(p=>p.status==='Under Review').length;
  const myProjects = DB.projects.filter(x=>x.pi===u.id);
  const ids = myProjects.map(x=>x.id);
  const activeMs = DB.milestones.filter(m=>ids.includes(m.projectId) && m.status!=='Completed');
  appEl().innerHTML = page('PI Dashboard','Welcome back, '+esc(u.name), `
    <div class="stats">
      ${statCard(drafts,'Drafts')}
      ${statCard(underReview,'Under Review')}
      ${statCard(activeMs.length,'Active milestones')}
    </div>
    <div class="row-actions"><a class="btn btn-primary" href="#/proposal/new">+ New Proposal</a></div>
    <section class="card"><h2>My Proposals</h2>
      ${mine.length ? table(['Title','Status','Last updated','Action'], mine.map(p=>[
          `<a href="#/proposal/${p.id}">${esc(p.title)}</a>`, pill(p.status), fmtDate(p.lastUpdated),
          p.status==='Draft' ? `<a href="#/proposal/${p.id}">Edit / Submit</a>` : `<a href="#/proposal/${p.id}">View</a>`
        ])) : emptyState('No proposals yet — click “+ New Proposal” to start one.')}
    </section>
    <section class="card"><h2>My Active Milestones</h2>
      ${activeMs.length ? table(['Milestone','Project','Target date','Status','Action'], activeMs.map(m=>{
          const proj = findProject(m.projectId);
          return [`${m.code} ${esc(m.name)}`,
                  `<a href="#/project/${proj.id}">${esc(proj.title)}</a>`,
                  fmtDate(m.targetDate), pill(MilestoneService.displayStatus(m)),
                  m.status==='In Progress' && proj.status==='Active'
                    ? `<a href="#/milestone/${m.id}">Submit completion</a>`
                    : `<a href="#/milestone/${m.id}">View</a>`];
        })) : emptyState('No open milestones.')}
    </section>
    ${alertsFor(u.id)}
    <section class="card"><h2>Notifications (${unreadCount(u.id)} unread)</h2>
      ${notifList(u.id, 4)}
      <a href="#/notifications" class="quiet">View all →</a>
    </section>`);
}

function adminDashboard(u){
  const underReview = DB.proposals.filter(p=>p.status==='Under Review').length;
  appEl().innerHTML = page('Admin Dashboard','System-wide summary (FR-033)', `
    <div class="stats">
      ${statCard(DB.users.length,'Users')}
      ${statCard(DB.projects.filter(p=>p.status==='Active').length,'Active projects')}
      ${statCard(underReview,'Proposals under review')}
      ${statCard(DB.auditLog.length,'Audit entries')}
    </div>
    <div class="row-actions">
      <a class="btn btn-primary" href="#/users">Manage Users &amp; Roles</a>
      <a class="btn" href="#/audit">Open Audit Log</a>
    </div>
    <section class="card"><h2>Recent Audit Activity</h2>
      ${table(['Time','Actor','Action','Target','Remarks'], DB.auditLog.slice(0,8).map(a=>[
        fmtDateTime(a.time), esc(userById(a.actor).name), esc(a.action),
        esc(a.target), esc(a.remarks)]))}
      <p class="quiet">Append-only trail (NFR-024, NFR-025).</p>
    </section>`);
}

/* ---------- Proposal editor (UC-003/UC-004) ---------- */
function field(id, label, val, type, req, placeholder){
  const control = type === 'textarea'
    ? `<textarea id="${id}" placeholder="${esc(placeholder||'')}">${esc(val||'')}</textarea>`
    : `<input type="${type||'text'}" id="${id}" value="${esc(val ?? '')}" placeholder="${esc(placeholder||'')}">`;
  return `<div class="field"><label for="${id}">${esc(label)}${req?' <span class="req">*</span>':''}</label>${control}</div>`;
}

function viewProposal(id, u){
  if(id === 'new'){ renderProposalEditor(u, null); return; }
  const p = findProposal(id);
  if(!p){ appEl().innerHTML = page('Not found','', emptyState('Proposal not found.')); return; }
  const isOwner = p.pi === u.id;
  if(!isOwner && !['APPROVER','ADMIN','AUDITOR','COORDINATOR'].includes(u.role)){
    appEl().innerHTML = page('Forbidden','', alertBox('error','Access denied: you can only view proposals you own (BR-024, NFR-007).'));
    return;
  }
  if(isOwner && p.status === 'Draft'){ renderProposalEditor(u, p, pendingEditorError); pendingEditorError = null; return; }
  renderProposalReadOnly(p, u, isOwner);
}

function renderProposalEditor(u, p, error){
  const isNew = !p;
  const d = p || { title:'', abstract:'', objectives:'', methodology:'', expectedOutcomes:'',
    budget:'', domain:'AI/ML', fundingSource:DB.fundingSources[0], startDate:'', endDate:'', expectedMilestones:'' };
  appEl().innerHTML = page(isNew ? 'New Proposal' : 'Proposal — Edit Draft and Submit',
    'UC-004: fields marked * are mandatory for submission (BR-002)', `
    <div class="form-card">
      <div class="row-actions" style="margin-top:0">
        ${p ? `<span>${pill(p.status)}</span><span class="quiet">Proposal ID: ${p.id}</span>` : '<span class="quiet">New draft — an ID is assigned on first save</span>'}
      </div>
      <div id="editor-msg">${error ? alertBox('error', esc(error.message)) : ''}</div>
      ${field('f-title','Project title',d.title,'text',true,'e.g. AI-based Crop Disease Detection')}
      ${field('f-abstract','Abstract',d.abstract,'textarea',true,'A deep learning approach to…')}
      ${field('f-objectives','Objectives',d.objectives,'textarea',true,'Develop CNN model for…')}
      ${field('f-methodology','Methodology',d.methodology,'textarea',true,'Transfer learning with…')}
      ${field('f-outcomes','Expected outcomes',d.expectedOutcomes,'textarea',true,'Automated detection…')}
      <div class="grid2">
        ${field('f-domain','Research domain',d.domain)}
        ${`<div class="field"><label for="f-source">Funding source</label>
            <select id="f-source">${DB.fundingSources.map(s=>`<option ${s===d.fundingSource?'selected':''}>${esc(s)}</option>`).join('')}</select></div>`}
        ${field('f-start','Proposed start date',d.startDate,'date',true)}
        ${field('f-end','Expected end date',d.endDate,'date',true)}
      </div>
      ${field('f-milestones','Expected milestones (comma-separated)',d.expectedMilestones,'text',false,'M1 Dataset, M2 Prototype model, M3 Field validation')}
      ${field('f-budget','Budget (INR)',d.budget ?? '','number',true,'e.g. 1500000')}
      ${`<div class="field"><label for="f-doc">Supporting document (optional)</label><input type="file" id="f-doc"></div>`}
      <div class="row-actions">
        <button class="btn" id="btn-draft">Save Draft</button>
        <button class="btn btn-primary" id="btn-submit">Submit Proposal</button>
        <a class="btn btn-light" href="#/dashboard">Cancel</a>
      </div>
    </div>`);
  markMissingFields(error);
  const collect = () => ({
    title:v('f-title'), abstract:v('f-abstract'), objectives:v('f-objectives'),
    methodology:v('f-methodology'), expectedOutcomes:v('f-outcomes'),
    budget:v('f-budget')===''?null:Number(v('f-budget')),
    domain:v('f-domain'), fundingSource:v('f-source'),
    startDate:v('f-start'), endDate:v('f-end'), expectedMilestones:v('f-milestones'),
  });
  function v(id){ return document.getElementById(id).value; }
  function showError(res){
    document.getElementById('editor-msg').innerHTML = alertBox('error', esc(res.message));
    markMissingFields(res);
    window.scrollTo({top:0, behavior:'smooth'});
  }
  function saveDraft(){
    const docInp = document.getElementById('f-doc');
    const res = ProposalService.saveDraft(collect(), u, p && p.id);
    if(!res.ok) return res;
    if(docInp.files.length){
      const f = docInp.files[0];
      const cur = findProposal(res.id);
      cur.documents.push({ id:nextId('doc'), type:'Proposal', name:f.name, size:humanSize(f.size),
        version: cur.documents.filter(x=>x.name===f.name).length+1, uploadedBy:u.id, uploadDate:todayISO() });
      saveDB();
    }
    return res;
  }
  document.getElementById('btn-draft').onclick = () => {
    const res = saveDraft();
    if(!res.ok) return showError(res);
    toast('Draft saved (FR-007).');
    location.hash = '#/dashboard';
  };
  document.getElementById('btn-submit').onclick = () => {
    const res = saveDraft();
    if(!res.ok) return showError(res);
    const s = ProposalService.submit(res.id, u);
    if(!s.ok){
      if(isNew){ pendingEditorError = s; location.hash = '#/proposal/' + res.id; }
      else showError(s);
      return;
    }
    location.hash = '#/confirm/' + res.id;
  };
}

function markMissingFields(error){
  if(!error || !error.fields) return;
  error.fields.forEach(label => {
    const id = FIELD_IDS[label];
    if(!id) return;
    const input = document.getElementById(id);
    if(input) input.insertAdjacentHTML('afterend','<div class="ferr">This field is required.</div>');
  });
}

/* ---------- Submission confirmation (UC-004 end, wireframe 04) ---------- */
function viewConfirm(id){
  const p = findProposal(id);
  if(!p || p.status !== 'Under Review'){ location.hash = '#/proposal/'+id; return; }
  appEl().innerHTML = page('Submission Confirmation','', `
    ${alertBox('success','Proposal submitted successfully. The Research Committee has been notified. (M-11)')}
    <div class="summary"><dl>
      <dt>Proposal ID</dt><dd>${p.id}</dd>
      <dt>Title</dt><dd>${esc(p.title)}</dd>
      <dt>Status</dt><dd>${pill(p.status)}</dd>
      <dt>Submitted on</dt><dd>${fmtDateTime(p.submissionDate)}</dd>
      <dt>Submitted by</dt><dd>${esc(userById(p.pi).name)}</dd>
    </dl></div>
    <div class="row-actions">
      <a class="btn btn-primary" href="#/dashboard">Back to Dashboard</a>
      <a class="btn" href="#/proposal/${p.id}">View Proposal</a>
    </div>`);
}

/* ---------- Proposal read-only view ---------- */
function renderProposalReadOnly(p, u, isOwner){
  const reviewer = p.review ? userById(p.review.reviewer) : null;
  appEl().innerHTML = page(p.title, `${p.id} · ${pill(p.status)}`, `
    ${p.review ? alertBox(p.review.decision==='Approved'?'success':(p.review.decision==='Rejected'?'error':'info'),
        `Review decision: <b>${p.review.decision}</b> by ${esc(reviewer.name)} on ${fmtDate(p.review.reviewDate)} — “${esc(p.review.comments)}”`) : ''}
    <div class="summary"><dl>
      <dt>Principal Investigator</dt><dd>${esc(userById(p.pi).name)}</dd>
      <dt>Research domain</dt><dd>${esc(p.domain||'—')}</dd>
      <dt>Funding source</dt><dd>${esc(p.fundingSource||'—')}</dd>
      <dt>Budget (INR)</dt><dd>${fmtMoney(p.budget)}</dd>
      <dt>Proposed dates</dt><dd>${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}</dd>
      <dt>Submitted</dt><dd>${p.submissionDate?fmtDateTime(p.submissionDate):'—'}</dd>
    </dl></div>
    <section class="card"><h2>Abstract</h2><div class="ro ${p.abstract?'':'empty-ro'}">${esc(p.abstract||'Not provided')}</div></section>
    <section class="card"><h2>Objectives</h2><div class="ro ${p.objectives?'':'empty-ro'}">${esc(p.objectives||'Not provided')}</div></section>
    <section class="card"><h2>Methodology</h2><div class="ro ${p.methodology?'':'empty-ro'}">${esc(p.methodology||'Not provided')}</div></section>
    <section class="card"><h2>Expected outcomes</h2><div class="ro ${p.expectedOutcomes?'':'empty-ro'}">${esc(p.expectedOutcomes||'Not provided')}</div></section>
    <section class="card"><h2>Expected milestones</h2><div class="ro ${p.expectedMilestones?'':'empty-ro'}">${esc(p.expectedMilestones||'Not defined')}</div></section>
    <section class="card"><h2>Supporting documents</h2>
      ${p.documents.length ? table(['Name','Type','Version','Size','Uploaded'], p.documents.map(d=>[
        esc(d.name), esc(d.type), 'v'+d.version, esc(d.size), fmtDate(d.uploadDate)]))
        : emptyState('No documents uploaded.')}
    </section>
    <div class="row-actions">
      ${isOwner && p.status==='Under Review' ? '<button class="btn btn-warn" id="btn-withdraw">Withdraw Proposal (FR-012)</button>' : ''}
      <a class="btn" href="#/dashboard">Back to Dashboard</a>
    </div>`);
  const w = document.getElementById('btn-withdraw');
  if(w) w.onclick = () => {
    const res = ProposalService.withdraw(p.id, u);
    if(res.ok){ toast('Proposal withdrawn. You can edit and resubmit it.'); viewProposal(p.id, u); }
    else toast(res.message, 'error');
  };
}

/* ---------- Registration (new users) ---------- */
function viewRegister(){
  const cur = Auth.current();
  if(cur && !cur.expired){ location.hash = '#/dashboard'; return; }
  appEl().innerHTML = `
  <div class="login-wrap" style="max-width:580px">
    <div class="login-card">
      <h1>Create your account</h1>
      <p class="sub">Register with your institutional email to start using RPMS</p>
      <div id="reg-msg"></div>
      <form id="reg-form" autocomplete="off" novalidate>
        <div class="grid2">
          <div class="field"><label for="r-name">Full name <span class="req">*</span></label>
            <input type="text" id="r-name" placeholder="e.g. Dr. Rakesh Verma"></div>
          <div class="field"><label for="r-dept">Department</label>
            <input type="text" id="r-dept" placeholder="e.g. CSE"></div>
        </div>
        <div class="field"><label for="r-email">Institutional email <span class="req">*</span></label>
          <input type="email" id="r-email" placeholder="name@lnmiit.ac.in"></div>
        <div class="field"><label>Role you will join as</label>
          <div class="ro">Principal Investigator (PI)</div>
          <p class="quiet">Per the SRS, roles are assigned only by the System Administrator (FR-004, BR-019, UC-002).
          New accounts join as Principal Investigators; coordinator, approver, funding-agency and auditor accounts
          are provisioned by an administrator from the Users page.</p>
        </div>
        <div class="grid2">
          <div class="field"><label for="r-pass">Password <span class="req">*</span></label>
            <input type="password" id="r-pass" placeholder="At least 6 characters"></div>
          <div class="field"><label for="r-pass2">Confirm password <span class="req">*</span></label>
            <input type="password" id="r-pass2"></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Create Account</button>
      </form>
      <p class="demo-creds">Already registered? <a href="#/login">Sign in</a></p>
    </div>
  </div>`;
  document.getElementById('reg-form').onsubmit = ev => {
    ev.preventDefault();
    const val = id => document.getElementById(id).value;
    const msg = document.getElementById('reg-msg');
    if(val('r-pass') !== val('r-pass2')){
      msg.innerHTML = alertBox('error','Passwords do not match.');
      return;
    }
    const res = Auth.register({ name:val('r-name'), email:val('r-email'), dept:val('r-dept'), password:val('r-pass') });
    if(!res.ok){
      msg.innerHTML = alertBox('error', esc(res.message));
      return;
    }
    toast('Account created. Welcome, ' + res.user.name + '!');
    location.hash = '#/dashboard';
  };
}

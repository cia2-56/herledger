/* HerLedger UI. All logic lives in engine.js; this file only renders and handles events. */
(function () {
  'use strict';
  const E = window.Engine;
  const KEY = 'herledger.v1';
  const STEPS = [['extraction', 'Extraction'], ['mapping', 'Security Mapping'], ['matching', 'Matching'], ['exceptions', 'Exceptions'], ['audit', 'Audit Trail'], ['dashboard', 'Dashboard']];
  const STATUSES = ['Open', 'In Review', 'Resolved', 'Waived'];
  const SOURCES = E.BROKER_NAMES.concat(['Bonanza']);

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => (typeof n === 'number' ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : esc(n));
  const money = (n) => (typeof n === 'number' ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : esc(n));

  const state = {
    inputs: clone(window.SAMPLE), files: {}, sampleSet: {}, run: null, exc: [], kpis: null,
    step: 'extraction', auditQuery: '', filter: { status: '', severity: '', broker: '' }, msg: '',
    runs: [], notifications: [], edits: {}, userAudit: [],
  };
  SOURCES.forEach((s) => { state.sampleSet[s] = true; });

  // ---------- persistence (browser only) ----------
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || '{}');
      ['runs', 'notifications', 'edits', 'userAudit'].forEach((k) => { if (s[k]) state[k] = s[k]; });
    } catch (e) { /* storage unavailable: carry on in memory */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ runs: state.runs, notifications: state.notifications, edits: state.edits, userAudit: state.userAudit })); } catch (e) { /* ignore */ }
  }

  // ---------- compute ----------
  function compute() {
    state.run = E.runPipeline(state.inputs, state.files);
    state.exc = state.run.exceptions.map((e) => Object.assign({}, e, state.edits[e.id] || {}));
    state.kpis = E.computeKpis(state.run.results, state.exc);
  }
  const usingSample = () => SOURCES.every((s) => state.sampleSet[s]);

  // ---------- small view helpers ----------
  const table = (heads, rows, opts) => {
    opts = opts || {};
    const numCols = opts.num || [];
    return '<div class="tablewrap"><table><thead><tr>' + heads.map((h, i) => '<th class="' + (numCols.includes(i) ? 'num ' : '') + ((opts.wrap || []).includes(i) ? 'wrap' : '') + '">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map((r) => '<tr>' + r.map((c, i) => '<td class="' + (numCols.includes(i) ? 'num ' : '') + ((opts.wrap || []).includes(i) ? 'wrap' : '') + '">' + c + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + heads.length + '" class="empty">' + esc(opts.empty || 'Nothing to show') + '</td></tr>') + '</tbody></table></div>';
  };
  const tile = (n, l, cls) => '<div class="tile ' + (cls || '') + '"><div class="n">' + esc(n) + '</div><div class="l">' + esc(l) + '</div></div>';
  const sev = (s) => '<span class="sev-' + esc(s) + '">' + esc(s) + '</span>';
  const bars = (entries, cls) => {
    const max = Math.max(1, ...entries.map((e) => e[1]));
    if (!entries.length) return '<div class="muted">No data yet.</div>';
    return '<div class="bars">' + entries.map((e) => '<div class="bar"><span>' + esc(e[0]) + '</span><div class="track"><div class="fill ' + esc(cls ? e[0] : '') + '" style="width:' + Math.round((e[1] / max) * 100) + '%"></div></div><b>' + esc(e[1]) + '</b></div>').join('') + '</div>';
  };
  const statusClass = (s) => 'status-' + s.replace(/\s.*/, '');

  // ---------- Reconciliation page ----------
  function viewReconcile() {
    const sample = usingSample();
    return '<div class="eyebrow">Fund Accounting - Trade Reconciliation</div><h1>The Reconciliation Ledger</h1>' +
      '<p class="lead">Broker confirms from Citigroup, CGSI-TH, UOB and DBS are standardized, security-mapped and matched against the Bonanza book of record, with exceptions, an audit trail and a live KPI dashboard.</p>' +
      '<div class="row"><span class="badge ' + (sample ? '' : 'ok') + '">' + (sample ? 'Using sample data' : 'Using your uploaded files (plus sample data where not replaced)') + '</span>' +
      '<button data-act="run">Run again</button><button class="secondary" data-act="record">Record reconciliation run</button><button class="secondary" data-act="reset">Reset to sample data</button></div>' +
      (state.msg ? '<div class="alert">' + esc(state.msg) + '</div>' : '') +
      '<div class="steps" role="tablist">' + STEPS.map((s, i) => '<button role="tab" aria-selected="' + (state.step === s[0]) + '" class="' + (state.step === s[0] ? 'active' : '') + '" data-act="step" data-step="' + s[0] + '"><b>0' + (i + 1) + '</b>' + s[1] + '</button>').join('') + '</div>' +
      ({ extraction: stepExtraction, mapping: stepMapping, matching: stepMatching, exceptions: stepExceptions, audit: stepAudit, dashboard: stepDashboard }[state.step])();
  }

  function stepExtraction() {
    const r = state.run;
    const cards = SOURCES.map((name) => {
      const rows = state.inputs[name] || [];
      const cfg = E.BROKERS[name];
      const sub = name === 'Bonanza' ? 'standard schema' : 'code ' + cfg.code + ' - fee lines: ' + cfg.fees.map((f) => f.component).join(', ');
      const csv = E.toCSV(rows);
      return '<div class="card"><h3>' + esc(name === 'Bonanza' ? 'Bonanza (book of record)' : name) + '</h3><div class="muted">' + rows.length + ' rows - ' + esc(sub) + '</div>' +
        '<div class="muted">Source: ' + esc(state.sampleSet[name] ? 'sample data' : state.files[name]) + '</div>' +
        '<div class="row"><label class="sr" for="f-' + esc(name) + '">Upload file for ' + esc(name) + '</label><input id="f-' + esc(name) + '" type="file" accept=".csv,.xlsx,.xls" data-broker="' + esc(name) + '">' +
        '<a class="btn secondary small" download="' + esc(name.toLowerCase()) + '_sample.csv" href="data:text/csv;charset=utf-8,' + encodeURIComponent(csv) + '">Sample CSV</a></div></div>';
    }).join('');
    const rej = r.rejects.length ? '<div class="alert bad"><b>' + r.rejects.length + ' row(s) rejected</b><br>' + r.rejects.map((x) => esc(x.source + ' row ' + x.row + (x.tradeId ? ' (' + x.tradeId + ')' : '') + ': ' + x.reason)).join('<br>') + '</div>' : '';
    const warn = r.warnings.length ? '<div class="alert"><b>' + r.warnings.length + ' warning(s)</b><br>' + r.warnings.map((x) => esc(x.source + ' row ' + x.row + ' (' + x.tradeId + '): ' + x.reason)).join('<br>') + '</div>' : '';
    return '<h2>Part 1 - Extraction Agent</h2><p class="lead">Each broker sends confirms in its own layout. Upload a CSV or Excel file per broker, or leave the sample data in place. Every row is renamed into the standard trade schema and every fee-like column the broker supplies is consolidated into one Adjusted Commission.</p>' +
      '<div class="formula">AdjustedCommission = Commission + SEC Fee + Clearing Fee + Other Fees + Any Additional Charges<br>only the components a broker actually provides are summed (see the Audit Trail for the breakdown per trade)</div>' +
      '<div class="grid">' + cards + '</div>' + rej + warn +
      '<h2>All broker trades - standardized</h2>' +
      table(E.STANDARD_COLUMNS, r.brokerTrades.map((t) => [esc(t.tradeId), esc(t.portfolio), esc(t.tradeDate), esc(t.settlementDate), esc(t.securityRaw), esc(t.type), num(t.qty), num(t.price), money(t.gross), money(t.adjComm), money(t.net), esc(t.ccy), esc(t.broker)]), { num: [6, 7, 8, 9, 10], empty: 'No broker trades loaded' });
  }

  function stepMapping() {
    const seen = {};
    const rows = [];
    state.run.brokerTrades.concat(state.run.bonanzaTrades).forEach((t) => {
      const k = t.source + '|' + t.broker + '|' + t.securityRaw;
      if (seen[k]) { seen[k].n++; return; }
      seen[k] = { t, n: 1 }; rows.push(seen[k]);
    });
    const unm = rows.filter((x) => x.t.unmapped).length;
    return '<h2>Part 2 - Security Mapping</h2><p class="lead">Brokers write the same security differently (AAPL.US, AAPL.O, "TSLA US Equity", ISIN codes). Each code is tidied and looked up in the security master. If there is no entry the trade goes to exceptions; a mapping is never guessed.</p>' +
      (unm ? '<div class="alert bad">' + unm + ' security code(s) are not in the security master and will be raised as exceptions.</div>' : '<div class="alert good">Every security code was mapped.</div>') +
      table(['Source', 'Broker', 'Code as received', 'Standard code', 'Trades', 'Status'], rows.map((x) => [esc(x.t.source), esc(x.t.broker), esc(x.t.securityRaw), esc(x.t.securityCode || '-'), x.n, x.t.unmapped ? '<span class="sev-High">Unmapped</span>' : '<span class="badge ok">Mapped</span>']), { num: [4] }) +
      '<h2>Security master</h2>' + table(['Standard code', 'Name', 'Aliases', 'ISIN'], E.SECURITY_MASTER.map((m) => [esc(m.standard), esc(m.name), esc(m.aliases.join(', ')), esc(m.isin)]));
  }

  function stepMatching() {
    const c = state.kpis.counts;
    const rows = state.run.results.map((r) => {
      const t = r.trade;
      const diffs = r.diffs.length ? r.diffs.map((d) => esc(E.FIELD_LABELS[d.field] + ': broker ' + d.broker + ' vs Bonanza ' + d.bonanza)).join('<br>') : esc(r.status === 'Matched' ? 'All fields agree within tolerance' : r.note || '-');
      return [esc(t.tradeId), esc(t.broker), esc(t.securityCode || t.securityRaw), esc(t.portfolio), '<span class="' + statusClass(r.status) + '">' + esc(r.status) + '</span>', diffs, esc(r.bonanza ? r.bonanza.tradeId : '-')];
    });
    const tol = state.run.tol;
    return '<h2>Part 3 - Matching</h2><p class="lead">Each broker trade is paired with a Bonanza record on portfolio, trade date, security, buy/sell and currency. Quantity, currency, portfolio and dates must agree exactly; price, commission and net amount may differ by the tolerance (price ' + tol.price + ', commission ' + tol.commission + ', net amount ' + tol.net + ').</p>' +
      '<div class="grid">' + tile(c.matched, 'Matched', 'ok') + tile(c.breaks, 'Breaks') + tile(c.missingInBonanza, 'Missing in Bonanza') + tile(c.missingAtBroker, 'Missing at broker') + tile(c.unmapped, 'Unmapped security') + tile(c.matchRate + '%', 'Match rate (broker trades)') + '</div>' +
      '<h2>Results</h2>' + table(['Trade', 'Broker', 'Security', 'Portfolio', 'Status', 'Differences', 'Bonanza ID'], rows, { wrap: [5] });
  }

  function excTable(list, linkOnly) {
    return table(['Case', 'Trade', 'Broker', 'Type', 'Severity', 'Detail', 'Suggested action', 'Owner', 'Status'], list.map((e) => [esc(e.id), esc(e.tradeId), esc(e.broker), esc(e.type), sev(e.severity), esc(e.detail), esc(e.suggested), esc(e.owner), esc(e.status)]), { wrap: [5, 6], empty: 'No exceptions. Everything matched.' });
  }
  function stepExceptions() {
    return '<h2>Part 4 - Exceptions</h2><p class="lead">Every trade that is not an exact match becomes an exception case with a type, severity, owner and suggested action. High: quantity break, missing trade, or net amount difference above ' + state.run.tol.highAmount + '. Medium: price, date or unmapped. Low: a difference within twice the tolerance.</p>' +
      '<div class="row"><a class="btn secondary" href="#/exceptions">Manage cases on the Exception Cases page</a></div>' + excTable(state.exc);
  }

  function stepAudit() {
    const q = state.auditQuery.trim().toLowerCase();
    const all = state.run.audit.concat(state.userAudit.map((u) => ({ tradeId: u.tradeId, step: 'UserAction', detail: u.detail + ' (' + new Date(u.at).toLocaleString() + ')' })));
    const rows = all.filter((a) => !q || a.tradeId.toLowerCase().includes(q) || a.step.toLowerCase().includes(q) || a.detail.toLowerCase().includes(q));
    const order = { Extraction: 0, Mapping: 1, Matching: 2, Exception: 3, UserAction: 4 };
    rows.sort((a, b) => a.tradeId.localeCompare(b.tradeId) || order[a.step] - order[b.step]);
    return '<h2>Part 5 - Audit Trail</h2><p class="lead">Every figure can be traced back to its source file and row, the fee lines that were added, the security mapping, the match result and any action a person took.</p>' +
      '<div class="row"><label for="aq">Search by trade ID, step or text</label><input id="aq" type="search" value="' + esc(state.auditQuery) + '" placeholder="e.g. CI001" data-act-input="audit"></div>' +
      '<p class="muted">' + rows.length + ' audit entries</p>' + table(['Trade', 'Step', 'What happened'], rows.slice(0, 400).map((a) => [esc(a.tradeId), esc(a.step), esc(a.detail)]), { wrap: [2] });
  }

  function stepDashboard() {
    const k = state.kpis, c = k.counts;
    const openHigh = k.bySeverity.High;
    const brokerRows = E.BROKER_NAMES.map((n) => { const b = k.byBroker[n]; return [esc(n), b.trades, b.matched, b.issues, b.trades ? Math.round((b.matched / b.trades) * 1000) / 10 + '%' : '-']; });
    const ccy = Object.entries(k.unreconciledByCurrency).map((e) => [esc(e[0]), money(e[1])]);
    return '<h2>Part 6 - Dashboard</h2><div class="grid">' + tile(c.brokerTrades, 'Broker trades') + tile(c.bonanzaTrades, 'Bonanza trades') + tile(c.matched, 'Matched', 'ok') + tile(c.matchRate + '%', 'Match rate') + tile(state.exc.filter((e) => ['Open', 'In Review'].includes(e.status)).length, 'Open exceptions', 'bad') + tile(openHigh, 'Open High severity', openHigh ? 'bad' : 'ok') + '</div>' +
      '<div class="alert ' + (c.brokerCheck ? 'good' : 'bad') + '">Check - broker side: matched ' + c.matched + ' + breaks ' + c.breaks + ' + missing in Bonanza ' + c.missingInBonanza + ' + unmapped ' + c.unmapped + ' = ' + (c.matched + c.breaks + c.missingInBonanza + c.unmapped) + ' of ' + c.brokerTrades + '. Bonanza side: matched ' + c.matched + ' + breaks ' + c.breaks + ' + missing at broker ' + c.missingAtBroker + ' = ' + (c.matched + c.breaks + c.missingAtBroker) + ' of ' + c.bonanzaTrades + '.</div>' +
      '<div class="two"><div class="card"><h3>Exceptions by type</h3>' + bars(Object.entries(k.byType)) + '</div><div class="card"><h3>Open exceptions by severity</h3>' + bars(['High', 'Medium', 'Low'].map((s) => [s, k.bySeverity[s]]), true) + '</div></div>' +
      '<h2>By broker</h2>' + table(['Broker', 'Trades', 'Matched', 'With issues', 'Match rate'], brokerRows, { num: [1, 2, 3, 4] }) +
      '<h2>Unreconciled amount by currency</h2><p class="muted">Net amount of open items (the net difference for breaks, the full net amount for missing and unmapped trades). Currencies are never added together.</p>' + table(['Currency', 'Amount'], ccy, { num: [1], empty: 'Nothing unreconciled' });
  }

  // ---------- other pages ----------
  function viewRuns() {
    return '<div class="eyebrow">History</div><h1>Reconciliation Runs</h1><p class="lead">Each recorded run keeps its counts and match rate. Record a run from the Reconciliation page.</p>' +
      '<div class="row"><button class="secondary small" data-act="clear-runs">Clear recorded runs</button></div>' +
      table(['Run', 'Recorded', 'Data', 'Broker trades', 'Matched', 'Breaks', 'Missing in Bonanza', 'Missing at broker', 'Unmapped', 'Match rate', 'Open exceptions'],
        state.runs.slice().reverse().map((r) => [esc(r.id), esc(new Date(r.at).toLocaleString()), esc(r.data), r.counts.brokerTrades, r.counts.matched, r.counts.breaks, r.counts.missingInBonanza, r.counts.missingAtBroker, r.counts.unmapped, r.matchRate + '%', r.openExceptions]),
        { num: [3, 4, 5, 6, 7, 8, 9, 10], empty: 'No runs recorded yet' });
  }

  function viewExceptions() {
    const f = state.filter;
    const list = state.exc.filter((e) => (!f.status || e.status === f.status) && (!f.severity || e.severity === f.severity) && (!f.broker || e.broker === f.broker));
    const opt = (arr, v) => '<option value="">All</option>' + arr.map((a) => '<option' + (a === v ? ' selected' : '') + '>' + esc(a) + '</option>').join('');
    const rows = list.map((e) => [
      esc(e.id), esc(e.tradeId), esc(e.broker), esc(e.type), sev(e.severity), esc(e.detail) + (e.note ? '<br><span class="muted">Reason: ' + esc(e.note) + '</span>' : ''), esc(e.suggested),
      '<input type="text" size="16" aria-label="Owner for ' + esc(e.id) + '" value="' + esc(e.owner) + '" data-edit="owner" data-id="' + esc(e.id) + '">',
      '<select aria-label="Status for ' + esc(e.id) + '" data-edit="status" data-id="' + esc(e.id) + '">' + STATUSES.map((s) => '<option' + (s === e.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>',
    ]);
    return '<div class="eyebrow">Exception management</div><h1>Exception Cases</h1><p class="lead">Assign an owner and move each case through Open, In Review, Resolved or Waived. Resolving or waiving needs a reason, and nothing is ever deleted: every change is added to the audit trail.</p>' +
      '<div class="row"><label>Status <select data-filter="status">' + opt(STATUSES, f.status) + '</select></label><label>Severity <select data-filter="severity">' + opt(['High', 'Medium', 'Low'], f.severity) + '</select></label><label>Broker <select data-filter="broker">' + opt(E.BROKER_NAMES, f.broker) + '</select></label></div>' +
      table(['Case', 'Trade', 'Broker', 'Type', 'Severity', 'Detail', 'Suggested action', 'Owner', 'Status'], rows, { wrap: [5, 6], empty: 'No cases match the filter' });
  }

  function viewAnalytics() {
    const k = state.kpis;
    const byBroker = E.BROKER_NAMES.concat(['Bonanza']).map((b) => [b, state.exc.filter((e) => e.broker === b).length]).filter((x) => x[1] > 0);
    const byStatus = STATUSES.map((s) => [s, state.exc.filter((e) => e.status === s).length]);
    const bySev = ['High', 'Medium', 'Low'].map((s) => [s, state.exc.filter((e) => e.severity === s).length]);
    const runs = state.runs.map((r) => [r.id + ' (' + new Date(r.at).toLocaleDateString() + ')', Math.round(r.matchRate)]);
    return '<div class="eyebrow">Insight</div><h1>Exception Analytics</h1><p class="lead">Where breaks come from, how serious they are and whether quality is improving from run to run.</p>' +
      '<div class="grid">' + tile(state.exc.length, 'Exceptions in current run') + tile(k.counts.matchRate + '%', 'Match rate, current run') + tile(state.runs.length, 'Runs recorded') + '</div><br>' +
      '<div class="two"><div class="card"><h3>By type</h3>' + bars(Object.entries(k.byType)) + '</div><div class="card"><h3>By severity</h3>' + bars(bySev, true) + '</div>' +
      '<div class="card"><h3>By broker</h3>' + bars(byBroker) + '</div><div class="card"><h3>By status</h3>' + bars(byStatus) + '</div></div>' +
      '<div class="card" style="margin-top:14px"><h3>Match rate by recorded run (%)</h3>' + bars(runs) + '</div>';
  }

  function viewNotifications() {
    const rows = state.notifications.slice().reverse().map((n) => [esc(new Date(n.at).toLocaleString()), esc(n.runId), esc(n.caseId), esc(n.to), esc(n.channel), esc(n.message), n.ack ? '<span class="badge ok">Acknowledged</span>' : '<button class="small secondary" data-act="ack" data-id="' + esc(n.id) + '">Acknowledge</button>']);
    return '<div class="eyebrow">Alerts</div><h1>Notifications</h1><p class="lead">When a run is recorded, the owner of each open High severity case is notified. In this demo the messages are simulated and shown here; in the Microsoft build they are sent through Teams or Outlook.</p>' +
      table(['Sent', 'Run', 'Case', 'To', 'Channel', 'Message', ''], rows, { wrap: [5], empty: 'No notifications yet. Record a run to create them.' });
  }

  // ---------- actions ----------
  function recordRun() {
    const k = state.kpis.counts;
    const id = 'RUN-' + String(state.runs.length + 1).padStart(4, '0');
    const at = new Date().toISOString();
    const open = state.exc.filter((e) => ['Open', 'In Review'].includes(e.status));
    state.runs.push({ id, at, data: usingSample() ? 'Sample data' : 'Uploaded files', counts: k, matchRate: k.matchRate, openExceptions: open.length });
    let n = 0;
    open.filter((e) => e.severity === 'High').forEach((e) => {
      state.notifications.push({ id: id + '-' + e.id, runId: id, caseId: e.id, to: e.owner, channel: 'Teams (simulated)', message: e.type + ' on ' + e.tradeId + ' (' + e.broker + '): ' + e.detail, at, ack: false });
      n++;
    });
    save();
    state.msg = 'Recorded ' + id + ' with ' + n + ' High severity notification(s). See Reconciliation Runs and Notifications.';
  }

  function setStatus(id, status) {
    const e = state.exc.find((x) => x.id === id);
    if (!e || e.status === status) return;
    let reason = '';
    if (status === 'Resolved' || status === 'Waived') {
      reason = (window.prompt('Reason for marking ' + id + ' as ' + status + ' (required):') || '').trim();
      if (!reason) { render(); return; }
    }
    state.edits[id] = Object.assign({}, state.edits[id], { status, note: reason || (state.edits[id] && state.edits[id].note) || '' });
    state.userAudit.push({ tradeId: e.tradeId, at: new Date().toISOString(), detail: id + ': status ' + e.status + ' -> ' + status + (reason ? '. Reason: ' + reason : '') });
    save(); compute(); render();
  }
  function setOwner(id, owner) {
    const e = state.exc.find((x) => x.id === id);
    owner = owner.trim();
    if (!e || !owner || owner === e.owner) return;
    state.edits[id] = Object.assign({}, state.edits[id], { owner });
    state.userAudit.push({ tradeId: e.tradeId, at: new Date().toISOString(), detail: id + ': owner ' + e.owner + ' -> ' + owner });
    save(); compute(); render();
  }

  async function handleFile(name, file) {
    try {
      let rows;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        if (!window.XLSX) throw new Error('Excel support could not be loaded (no internet?). Please save the file as CSV and upload that.');
        const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
        rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
      } else rows = E.parseCSV(await file.text());
      if (!rows.length) throw new Error('The file has no data rows.');
      state.inputs[name] = rows; state.files[name] = file.name; state.sampleSet[name] = false;
      state.msg = 'Loaded ' + rows.length + ' rows from ' + file.name + ' for ' + name + '.';
      compute();
    } catch (err) { state.msg = 'Could not read the file for ' + name + ': ' + err.message; }
    render();
  }

  // ---------- routing & render ----------
  const ROUTES = { reconcile: viewReconcile, runs: viewRuns, exceptions: viewExceptions, analytics: viewAnalytics, notifications: viewNotifications };
  const route = () => { const r = (location.hash.replace(/^#\//, '') || 'reconcile'); return ROUTES[r] ? r : 'reconcile'; };

  function render() {
    const r = route();
    document.querySelectorAll('#nav a').forEach((a) => { a.classList.toggle('active', a.dataset.route === r); if (a.dataset.route === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const pending = state.notifications.filter((n) => !n.ack).length;
    const pill = document.getElementById('notifCount');
    pill.hidden = !pending; pill.textContent = pending;
    const app = document.getElementById('app');
    const keep = document.activeElement && document.activeElement.id === 'aq' ? document.activeElement.selectionStart : null;
    app.innerHTML = ROUTES[r]();
    if (keep !== null) { const q = document.getElementById('aq'); if (q) { q.focus(); q.setSelectionRange(keep, keep); } }
  }

  const app = document.getElementById('app');
  app.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'step') state.step = b.dataset.step;
    else if (act === 'run') { compute(); state.msg = 'Re-ran standardisation, mapping and matching.'; }
    else if (act === 'record') recordRun();
    else if (act === 'reset') { state.inputs = clone(window.SAMPLE); state.files = {}; SOURCES.forEach((s) => { state.sampleSet[s] = true; }); state.edits = {}; state.userAudit = []; state.msg = 'Reset to sample data.'; save(); compute(); }
    else if (act === 'clear-runs') { state.runs = []; state.notifications = []; save(); }
    else if (act === 'ack') { const n = state.notifications.find((x) => x.id === b.dataset.id); if (n) n.ack = true; save(); }
    render();
  });
  app.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.matches('input[type=file][data-broker]') && t.files[0]) handleFile(t.dataset.broker, t.files[0]);
    else if (t.dataset.edit === 'status') setStatus(t.dataset.id, t.value);
    else if (t.dataset.edit === 'owner') setOwner(t.dataset.id, t.value);
    else if (t.dataset.filter) { state.filter[t.dataset.filter] = t.value; render(); }
  });
  app.addEventListener('input', (ev) => { if (ev.target.dataset.actInput === 'audit') { state.auditQuery = ev.target.value; render(); } });
  window.addEventListener('hashchange', () => { state.msg = ''; render(); });

  load(); compute(); render();
})();

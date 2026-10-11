/* HerLedger engine: pure functions (no DOM). Works in the browser and in Node. */
(function (root) {
  'use strict';

  // ---------- configuration ----------
  const TOL = { price: 0.01, commission: 1, net: 1, highAmount: 1000, grossCheck: 1 };
  const EPS = 1e-9;

  // How each broker's own layout maps onto the standard schema.
  const BROKERS = {
    Citigroup: {
      code: 'CI',
      cols: { id: 'Trade Ref', portfolio: 'Account', tradeDate: 'Trade Date', settleDate: 'Settle Date', security: 'Ticker', side: 'Buy/Sell', qty: 'Quantity', price: 'Price', gross: 'Gross Amount', ccy: 'Currency' },
      fees: [{ component: 'Commission', header: 'Commission' }, { component: 'SEC Fee', header: 'SEC Fee' }, { component: 'Other Fee', header: 'Other Fee' }],
    },
    'CGSI-TH': {
      code: 'CG',
      cols: { id: 'Confirm ID', portfolio: 'Client Acct', tradeDate: 'TD', settleDate: 'SD', security: 'Instrument', side: 'Direction', qty: 'Units', price: 'Exec Price', gross: 'Principal', ccy: 'Ccy' },
      fees: [{ component: 'Broker Fees', header: 'Broker Fees' }],
    },
    UOB: {
      code: 'UO',
      cols: { id: 'Deal No', portfolio: 'Portfolio Code', tradeDate: 'Trade Date', settleDate: 'Value Date', security: 'Security', side: 'B/S', qty: 'Qty', price: 'Price', gross: 'Consideration', ccy: 'Curr' },
      fees: [{ component: 'Brokerage', header: 'Brokerage' }, { component: 'Clearing Fee', header: 'Clearing Fee' }, { component: 'Tax', header: 'Tax' }],
    },
    DBS: {
      code: 'DB',
      cols: { id: 'Reference', portfolio: 'Account', tradeDate: 'Trade Dt', settleDate: 'Settlement Dt', security: 'Stock Code', side: 'Action', qty: 'Volume', price: 'Avg Price', gross: 'Gross Value', ccy: 'CCY' },
      fees: [{ component: 'Commission', header: 'Commission' }, { component: 'Additional Charges', header: 'Additional Charges' }],
    },
  };
  const BROKER_NAMES = Object.keys(BROKERS);

  const STANDARD_COLUMNS = ['TradeID', 'Portfolio', 'TradeDate', 'SettlementDate', 'SecurityCode', 'TransactionType', 'Quantity', 'Price', 'GrossAmount', 'AdjustedCommission', 'NetAmount', 'Currency', 'Broker'];

  // Security master: one standard code, many broker aliases.
  const SECURITY_MASTER = [
    { standard: 'AAPL.US', aliases: ['AAPL.O', 'AAPL'], isin: 'US0378331005', name: 'Apple Inc.' },
    { standard: 'MSFT.US', aliases: ['MSFT.O', 'MSFT'], isin: 'US5949181045', name: 'Microsoft Corp.' },
    { standard: 'GOOGL.US', aliases: ['GOOGL.O', 'GOOGL'], isin: 'US02079K3059', name: 'Alphabet Inc. Class A' },
    { standard: 'AMZN.US', aliases: ['AMZN.O', 'AMZN'], isin: 'US0231351067', name: 'Amazon.com Inc.' },
    { standard: 'TSLA.US', aliases: ['TSLA.O', 'TSLA'], isin: 'US88160R1014', name: 'Tesla Inc.' },
    { standard: 'NVDA.US', aliases: ['NVDA.O', 'NVDA'], isin: 'US67066G1040', name: 'NVIDIA Corp.' },
  ];

  const ACTIONS = {
    'Quantity Break': 'Confirm the executed quantity with the broker confirm and the order record; correct whichever side is wrong.',
    'Price Break': 'Compare the execution price on the broker confirm with the book; check for a rounding or allocation error.',
    'Commission Break': 'Check the broker fee schedule and whether any fee line was missed or double counted.',
    'Amount Break': 'Check gross and net amounts for a missing charge or tax.',
    'Date Break': 'Check the settlement convention and market holidays with the broker.',
    'Currency Mismatch': 'Confirm the trade currency with the broker and the portfolio setup.',
    'Unmapped Security': 'Add the security code to the security master (with its alias or ISIN), then re-run.',
    'Missing in Bonanza': 'Check whether the trade was booked late, booked to another portfolio, or not booked at all.',
    'Missing at Broker': 'Ask the broker for the confirm, or check whether the trade was cancelled or sent to another broker.',
  };

  const FIELD_LABELS = { quantity: 'Quantity', price: 'Price', commission: 'Adjusted commission', net: 'Net amount', settlementDate: 'Settlement date' };

  // ---------- small helpers ----------
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const isNum = (x) => typeof x === 'number' && isFinite(x);

  function parseNum(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[, ]/g, '').trim();
    if (s === '') return NaN;
    return Number(s);
  }

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = (n) => String(n).padStart(2, '0');
  function validIso(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  /** Accepts 2023-10-26, 26/10/2023, 26-Oct-2023, 20231026, and Excel serial numbers. */
  function parseDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const dt = new Date(Math.round((v - 25569) * 86400 * 1000));
      return validIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
    const s = String(v).trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return validIso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) return validIso(+m[3], +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/))) return MONTHS[m[2].toLowerCase()] ? validIso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) : null;
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return validIso(+m[1], +m[2], +m[3]);
    return null;
  }

  function normSide(v) {
    const s = String(v || '').trim().toUpperCase();
    if (['B', 'BUY', 'PURCHASE', 'P'].includes(s)) return 'BUY';
    if (['S', 'SELL', 'SALE'].includes(s)) return 'SELL';
    return null;
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some((c) => c.trim() !== '')) rows.push(row);
        row = [];
      } else cur += ch;
    }
    row.push(cur);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim());
    return rows.slice(1).map((r) => { const o = {}; head.forEach((h, i) => { o[h] = (r[i] === undefined ? '' : r[i]).trim(); }); return o; });
  }

  function toCSV(rows) {
    if (!rows.length) return '';
    const heads = Object.keys(rows[0]);
    const esc = (v) => { const s = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [heads.join(',')].concat(rows.map((r) => heads.map((h) => esc(r[h])).join(','))).join('\n');
  }

  const findHeader = (headers, label) => headers.find((h) => h.trim().toLowerCase() === label.toLowerCase());

  // ---------- step 1: extraction & standardisation ----------
  function standardizeBroker(brokerName, rows, fileName) {
    const cfg = BROKERS[brokerName];
    const out = { trades: [], rejects: [], warnings: [], audit: [] };
    if (!cfg) { out.rejects.push({ row: 0, tradeId: '', reason: 'Unknown broker ' + brokerName }); return out; }
    if (!rows.length) { out.rejects.push({ row: 0, tradeId: '', reason: 'File has no data rows' }); return out; }
    const headers = Object.keys(rows[0]);
    const col = {};
    const missing = [];
    Object.keys(cfg.cols).forEach((k) => { col[k] = findHeader(headers, cfg.cols[k]); if (!col[k]) missing.push(cfg.cols[k]); });
    if (missing.length) { out.rejects.push({ row: 0, tradeId: '', reason: 'Missing column(s): ' + missing.join(', ') }); return out; }
    // Only fee columns the broker actually supplies are summed.
    const feeCols = cfg.fees.map((f) => ({ component: f.component, header: findHeader(headers, f.header) })).filter((f) => f.header);

    rows.forEach((row, i) => {
      const rowNo = i + 2;
      const tradeId = String(row[col.id] || '').trim();
      const reasons = [];
      const tradeDate = parseDate(row[col.tradeDate]);
      const settlementDate = parseDate(row[col.settleDate]);
      const type = normSide(row[col.side]);
      const qty = parseNum(row[col.qty]);
      const price = parseNum(row[col.price]);
      const gross = parseNum(row[col.gross]);
      const ccy = String(row[col.ccy] || '').trim().toUpperCase();
      if (!tradeId) reasons.push('Missing trade ID');
      if (!tradeDate) reasons.push('Invalid trade date');
      if (!settlementDate) reasons.push('Invalid settlement date');
      if (!type) reasons.push('Buy/sell value not recognised');
      if (!isNum(qty) || qty <= 0) reasons.push('Invalid quantity');
      if (!isNum(price) || price <= 0) reasons.push('Invalid price');
      if (!isNum(gross)) reasons.push('Invalid gross amount');
      if (!/^[A-Z]{3}$/.test(ccy)) reasons.push('Currency must be a 3-letter code');
      const feeLines = [];
      feeCols.forEach((f) => {
        const raw = row[f.header];
        const amt = raw === '' || raw === undefined ? 0 : parseNum(raw);
        if (!isNum(amt)) reasons.push('Invalid fee value in ' + f.header);
        else feeLines.push({ component: f.component, column: f.header, amount: amt });
      });
      if (reasons.length) { out.rejects.push({ row: rowNo, tradeId, reason: reasons.join('; ') }); return; }

      const adj = r4(feeLines.reduce((a, f) => a + f.amount, 0));
      const net = r4(gross - adj);
      if (tradeId.slice(0, 2).toUpperCase() !== cfg.code) out.warnings.push({ row: rowNo, tradeId, reason: 'Trade ID prefix does not match broker code ' + cfg.code });
      if (Math.abs(gross - qty * price) > TOL.grossCheck + EPS) out.warnings.push({ row: rowNo, tradeId, reason: 'Gross amount differs from quantity x price by ' + r4(Math.abs(gross - qty * price)) });

      const trade = {
        tradeId, source: 'Broker', broker: brokerName, portfolio: String(row[col.portfolio]).trim(),
        tradeDate, settlementDate, securityRaw: String(row[col.security]).trim(), securityCode: null, unmapped: false,
        type, qty, price, gross, adjComm: adj, net, ccy, feeLines, sourceFile: fileName || brokerName, sourceRow: rowNo,
      };
      out.trades.push(trade);
      out.audit.push({ tradeId, step: 'Extraction', detail: 'From ' + trade.sourceFile + ' row ' + rowNo + '. Fee lines: ' + (feeLines.map((f) => f.component + ' ' + f.amount).join(' + ') || 'none') + ' = adjusted commission ' + adj + '. Net = gross ' + gross + ' - ' + adj + ' = ' + net + '.' });
    });
    return out;
  }

  function standardizeBonanza(rows, fileName) {
    const out = { trades: [], rejects: [], warnings: [], audit: [] };
    if (!rows.length) { out.rejects.push({ row: 0, tradeId: '', reason: 'File has no data rows' }); return out; }
    const headers = Object.keys(rows[0]);
    const col = {};
    const missing = [];
    STANDARD_COLUMNS.forEach((c) => { col[c] = findHeader(headers, c); if (!col[c]) missing.push(c); });
    if (missing.length) { out.rejects.push({ row: 0, tradeId: '', reason: 'Missing column(s): ' + missing.join(', ') }); return out; }
    rows.forEach((row, i) => {
      const rowNo = i + 2;
      const tradeId = String(row[col.TradeID] || '').trim();
      const reasons = [];
      const tradeDate = parseDate(row[col.TradeDate]);
      const settlementDate = parseDate(row[col.SettlementDate]);
      const type = normSide(row[col.TransactionType]);
      const qty = parseNum(row[col.Quantity]), price = parseNum(row[col.Price]), gross = parseNum(row[col.GrossAmount]);
      const adj = parseNum(row[col.AdjustedCommission]), net = parseNum(row[col.NetAmount]);
      const ccy = String(row[col.Currency] || '').trim().toUpperCase();
      if (!tradeId) reasons.push('Missing trade ID');
      if (!tradeDate) reasons.push('Invalid trade date');
      if (!settlementDate) reasons.push('Invalid settlement date');
      if (!type) reasons.push('Buy/sell value not recognised');
      [['quantity', qty], ['price', price], ['gross', gross], ['commission', adj], ['net', net]].forEach(([n, v]) => { if (!isNum(v)) reasons.push('Invalid ' + n); });
      if (!/^[A-Z]{3}$/.test(ccy)) reasons.push('Currency must be a 3-letter code');
      if (reasons.length) { out.rejects.push({ row: rowNo, tradeId, reason: reasons.join('; ') }); return; }
      const t = { tradeId, source: 'Bonanza', broker: String(row[col.Broker]).trim() || 'Bonanza', portfolio: String(row[col.Portfolio]).trim(), tradeDate, settlementDate, securityRaw: String(row[col.SecurityCode]).trim(), securityCode: null, unmapped: false, type, qty, price, gross, adjComm: adj, net, ccy, feeLines: [], sourceFile: fileName || 'Bonanza', sourceRow: rowNo };
      out.trades.push(t);
      out.audit.push({ tradeId, step: 'Extraction', detail: 'Bonanza record from ' + t.sourceFile + ' row ' + rowNo + ' (already in the standard schema).' });
    });
    return out;
  }

  // ---------- step 2: security mapping ----------
  function normaliseCode(code) {
    return String(code || '').trim().toUpperCase().replace(/\s+EQUITY$/, '').replace(/\s+/g, '.');
  }
  function buildAliasIndex(master) {
    const idx = {};
    master.forEach((m) => {
      idx[normaliseCode(m.standard)] = m.standard;
      m.aliases.forEach((a) => { idx[normaliseCode(a)] = m.standard; });
      if (m.isin) idx[normaliseCode(m.isin)] = m.standard;
    });
    return idx;
  }
  function mapSecurities(trades, master) {
    const idx = buildAliasIndex(master || SECURITY_MASTER);
    const audit = [];
    trades.forEach((t) => {
      const key = normaliseCode(t.securityRaw);
      const std = idx[key];
      if (std) { t.securityCode = std; t.unmapped = false; audit.push({ tradeId: t.tradeId, step: 'Mapping', detail: t.securityRaw + ' -> ' + std + (t.securityRaw === std ? ' (already standard)' : '') }); }
      else { t.securityCode = null; t.unmapped = true; audit.push({ tradeId: t.tradeId, step: 'Mapping', detail: t.securityRaw + ' has no entry in the security master, so it is sent to exceptions.' }); }
    });
    return audit;
  }

  // ---------- step 3: matching ----------
  const keyOf = (t) => [t.portfolio, t.tradeDate, t.securityCode, t.type, t.ccy].join('|');

  function diffTrades(b, z, tol) {
    const d = [];
    if (b.qty !== z.qty) d.push({ field: 'quantity', broker: b.qty, bonanza: z.qty, diff: r4(b.qty - z.qty) });
    if (Math.abs(b.price - z.price) > tol.price + EPS) d.push({ field: 'price', broker: b.price, bonanza: z.price, diff: r4(b.price - z.price) });
    if (Math.abs(b.adjComm - z.adjComm) > tol.commission + EPS) d.push({ field: 'commission', broker: b.adjComm, bonanza: z.adjComm, diff: r4(b.adjComm - z.adjComm) });
    if (Math.abs(b.net - z.net) > tol.net + EPS) d.push({ field: 'net', broker: b.net, bonanza: z.net, diff: r4(b.net - z.net) });
    if (b.settlementDate !== z.settlementDate) d.push({ field: 'settlementDate', broker: b.settlementDate, bonanza: z.settlementDate, diff: null });
    return d;
  }

  function matchTrades(brokerTrades, bonanzaTrades, tol) {
    const index = {};
    bonanzaTrades.filter((z) => !z.unmapped).forEach((z) => { (index[keyOf(z)] = index[keyOf(z)] || []).push(z); });
    const used = new Set();
    const results = [];
    brokerTrades.forEach((b) => {
      if (b.unmapped) { results.push({ trade: b, bonanza: null, status: 'Unmapped', diffs: [], note: '' }); return; }
      const cands = (index[keyOf(b)] || []).filter((z) => !used.has(z));
      if (!cands.length) { results.push({ trade: b, bonanza: null, status: 'Missing in Bonanza', diffs: [], note: '' }); return; }
      let best = null;
      cands.forEach((z) => { const d = diffTrades(b, z, tol); if (!best || d.length < best.d.length) best = { z, d }; });
      used.add(best.z);
      results.push({ trade: b, bonanza: best.z, status: best.d.length ? 'Break' : 'Matched', diffs: best.d, note: cands.length > 1 ? 'Several candidates; chose the one with fewest differences.' : '' });
    });
    bonanzaTrades.forEach((z) => {
      if (used.has(z)) return;
      if (z.unmapped) { results.push({ trade: z, bonanza: null, status: 'Unmapped', diffs: [], note: 'Bonanza security not in the security master.', orphan: true }); return; }
      results.push({ trade: z, bonanza: null, status: 'Missing at Broker', diffs: [], note: '', orphan: true });
    });
    return results;
  }

  // ---------- step 4: exceptions ----------
  function tolFor(field, tol) { return field === 'price' ? tol.price : field === 'commission' ? tol.commission : tol.net; }

  function classifyBreak(diffs, tol) {
    const has = (f) => diffs.find((d) => d.field === f);
    let type = 'Amount Break';
    if (has('quantity')) type = 'Quantity Break';
    else if (has('price')) type = 'Price Break';
    else if (has('commission')) type = 'Commission Break';
    else if (has('net')) type = 'Amount Break';
    else if (has('settlementDate')) type = 'Date Break';
    const netDiff = has('net') ? Math.abs(has('net').diff) : 0;
    let severity;
    if (has('quantity') || netDiff > tol.highAmount + EPS) severity = 'High';
    else if (diffs.every((d) => d.field !== 'settlementDate' && Math.abs(d.diff) <= 2 * tolFor(d.field, tol) + EPS)) severity = 'Low';
    else severity = 'Medium';
    return { type, severity };
  }

  const describeDiff = (d) => FIELD_LABELS[d.field] + ': Bonanza ' + d.bonanza + ' vs broker ' + d.broker;

  function buildExceptions(results, tol, owners) {
    const list = [];
    results.forEach((r) => {
      if (r.status === 'Matched') return;
      const t = r.trade;
      let type, severity, detail, exposure;
      if (r.status === 'Break') {
        const c = classifyBreak(r.diffs, tol);
        type = c.type; severity = c.severity;
        detail = r.diffs.map(describeDiff).join('; ');
        const nd = r.diffs.find((d) => d.field === 'net');
        exposure = nd ? Math.abs(nd.diff) : 0;
      } else if (r.status === 'Missing in Bonanza') { type = 'Missing in Bonanza'; severity = 'High'; detail = 'Broker trade has no matching Bonanza record.'; exposure = Math.abs(t.net); }
      else if (r.status === 'Missing at Broker') { type = 'Missing at Broker'; severity = 'High'; detail = 'Bonanza trade has no matching broker confirm.'; exposure = Math.abs(t.net); }
      else { type = 'Unmapped Security'; severity = 'Medium'; detail = 'Security code ' + t.securityRaw + ' is not in the security master.'; exposure = Math.abs(t.net); }
      list.push({
        id: 'EXC-' + t.tradeId, tradeId: t.tradeId, broker: t.broker, type, severity, status: 'Open',
        owner: (owners && owners[t.broker]) || t.broker + ' owner', detail, suggested: ACTIONS[type],
        ccy: t.ccy, exposure: r4(exposure), bonanzaId: r.bonanza ? r.bonanza.tradeId : '', security: t.securityCode || t.securityRaw,
      });
    });
    const rank = { High: 0, Medium: 1, Low: 2 };
    list.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
    return list;
  }

  // ---------- step 6: KPIs ----------
  function computeKpis(results, exceptions) {
    const c = { total: 0, matched: 0, breaks: 0, missingInBonanza: 0, missingAtBroker: 0, unmapped: 0 };
    results.forEach((r) => {
      if (r.status === 'Matched') c.matched++;
      else if (r.status === 'Break') c.breaks++;
      else if (r.status === 'Missing in Bonanza') c.missingInBonanza++;
      else if (r.status === 'Missing at Broker') c.missingAtBroker++;
      else if (r.status === 'Unmapped') c.unmapped++;
    });
    const brokerTrades = results.filter((r) => !r.orphan);
    const bonanzaSide = results.filter((r) => r.status === 'Matched' || r.status === 'Break' || r.orphan);
    c.brokerTrades = brokerTrades.length;
    c.bonanzaTrades = bonanzaSide.length;
    c.total = results.length;
    c.matchRate = c.brokerTrades ? Math.round((results.filter((r) => !r.orphan && r.status === 'Matched').length / c.brokerTrades) * 1000) / 10 : 0;
    c.brokerCheck = results.filter((r) => !r.orphan && r.status === 'Matched').length + c.breaks + c.missingInBonanza + results.filter((r) => !r.orphan && r.status === 'Unmapped').length === c.brokerTrades;
    const byBroker = {};
    BROKER_NAMES.forEach((n) => { byBroker[n] = { trades: 0, matched: 0, issues: 0 }; });
    results.filter((r) => !r.orphan).forEach((r) => { const b = byBroker[r.trade.broker]; if (b) { b.trades++; if (r.status === 'Matched') b.matched++; else b.issues++; } });
    const byType = {}, bySeverity = { High: 0, Medium: 0, Low: 0 }, openByCcy = {};
    exceptions.forEach((e) => {
      byType[e.type] = (byType[e.type] || 0) + 1;
      if (e.status === 'Open' || e.status === 'In Review') { bySeverity[e.severity]++; openByCcy[e.ccy] = r4((openByCcy[e.ccy] || 0) + e.exposure); }
    });
    return { counts: c, byBroker, byType, bySeverity, unreconciledByCurrency: openByCcy };
  }

  // ---------- full pipeline ----------
  /** inputs: { Citigroup: rows[], 'CGSI-TH': rows[], UOB: rows[], DBS: rows[], Bonanza: rows[] }, files: { name: fileName } */
  function runPipeline(inputs, files, options) {
    const tol = Object.assign({}, TOL, (options && options.tol) || {});
    const master = (options && options.master) || SECURITY_MASTER;
    const f = files || {};
    const brokerTrades = [], rejects = [], warnings = [], audit = [];
    BROKER_NAMES.forEach((name) => {
      const rows = inputs[name] || [];
      if (!rows.length) return;
      const r = standardizeBroker(name, rows, f[name]);
      brokerTrades.push(...r.trades);
      r.rejects.forEach((x) => rejects.push(Object.assign({ source: name }, x)));
      r.warnings.forEach((x) => warnings.push(Object.assign({ source: name }, x)));
      audit.push(...r.audit);
    });
    const bz = standardizeBonanza(inputs.Bonanza || [], f.Bonanza);
    bz.rejects.forEach((x) => rejects.push(Object.assign({ source: 'Bonanza' }, x)));
    audit.push(...bz.audit);
    audit.push(...mapSecurities(brokerTrades, master));
    audit.push(...mapSecurities(bz.trades, master));
    const results = matchTrades(brokerTrades, bz.trades, tol);
    results.forEach((r) => {
      const t = r.trade;
      const txt = r.status === 'Matched' ? 'Matched to Bonanza ' + r.bonanza.tradeId + (r.diffs.length ? '' : ' within tolerance') + '.' : r.status === 'Break' ? 'Break against Bonanza ' + r.bonanza.tradeId + ': ' + r.diffs.map(describeDiff).join('; ') : r.status;
      audit.push({ tradeId: t.tradeId, step: 'Matching', detail: txt + (r.note ? ' ' + r.note : '') });
    });
    const exceptions = buildExceptions(results, tol, options && options.owners);
    exceptions.forEach((e) => audit.push({ tradeId: e.tradeId, step: 'Exception', detail: e.id + ' raised: ' + e.type + ', severity ' + e.severity + '. Suggested action: ' + e.suggested }));
    return { tol, brokerTrades, bonanzaTrades: bz.trades, rejects, warnings, results, exceptions, audit, kpis: computeKpis(results, exceptions) };
  }

  const Engine = { TOL, BROKERS, BROKER_NAMES, STANDARD_COLUMNS, SECURITY_MASTER, ACTIONS, FIELD_LABELS, parseCSV, toCSV, parseDate, parseNum, normSide, normaliseCode, standardizeBroker, standardizeBonanza, mapSecurities, matchTrades, buildExceptions, computeKpis, runPipeline };
  if (typeof module === 'object' && module.exports) module.exports = Engine; else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);

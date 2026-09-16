/* Forecast — projects income, debt repayment and savings month by month.
 *
 * Source of truth is the committed JSON under data/. Everything the user
 * flips in the UI (currency, scenario sliders, per-row include/exclude) is a
 * session-only overlay — nothing is persisted, nothing is written back.
 *
 * All arithmetic happens in EUR. MKD is pegged (meta.fixedRates), so a MKD
 * loan amortises identically in either unit and we only convert for display.
 */
(function () {
  'use strict';

  var DATA_FILES = ['meta', 'income', 'loans', 'liabilities', 'budget', 'extras', 'calendar'];
  // Far enough to amortise anything realistic; the horizon slider only
  // controls how much of the run we render.
  var MAX_SIM = 720;
  var EPS = 0.005;

  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var COLOR_SAVINGS = '#2a78d6';
  var COLOR_DEBT = '#eb6834';

  var data = null;
  var view = 'overview';
  var currency = 'EUR';
  var model = null;
  var chartPoints = null;

  // Session-only overrides. `off` holds ids the user has excluded.
  var scenario = {
    rateKnob: null,
    dayAdjust: 0,
    extraToDebt: 0,
    horizon: 36,
    rollover: true,
    off: Object.create(null),
  };
  var defaults = null;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------------------------------------------------------- months */

  function ymToIndex(ym) {
    var p = String(ym).split('-');
    return (parseInt(p[0], 10) * 12) + (parseInt(p[1], 10) - 1);
  }

  function indexToYm(i) {
    var y = Math.floor(i / 12);
    var m = (i % 12) + 1;
    return y + '-' + (m < 10 ? '0' + m : String(m));
  }

  function ymLabel(ym, opts) {
    var p = String(ym).split('-');
    var name = MONTHS_SHORT[parseInt(p[1], 10) - 1];
    return (opts && opts.long) ? name + ' ' + p[0] : name + ' ’' + p[0].slice(2);
  }

  // Mon–Fri count in a calendar month. No holiday calendar — named days off
  // are supplied per month through data/calendar.json.
  function businessDays(ym) {
    var p = String(ym).split('-');
    var year = parseInt(p[0], 10);
    var month = parseInt(p[1], 10) - 1;
    var days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    var n = 0;
    for (var d = 1; d <= days; d++) {
      var wd = new Date(Date.UTC(year, month, d)).getUTCDay();
      if (wd !== 0 && wd !== 6) n++;
    }
    return n;
  }

  function currentYm() {
    var now = new Date();
    return indexToYm((now.getFullYear() * 12) + now.getMonth());
  }

  /* -------------------------------------------------------------- currency */

  function toEur(amount, cur) {
    if (!cur || cur === 'EUR') return amount;
    var rate = data.meta.fixedRates[cur];
    return rate ? amount / rate : amount;
  }

  function fromEur(eur, cur) {
    if (!cur || cur === 'EUR') return eur;
    var rate = data.meta.fixedRates[cur];
    return rate ? eur * rate : eur;
  }

  function group(n) {
    var neg = n < 0;
    var s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  }

  // Formats an EUR figure in whatever the header toggle is showing.
  function money(eur, opts) {
    var cur = (opts && opts.cur) || currency;
    var v = fromEur(eur, cur);
    var sign = (opts && opts.signed && v > 0) ? '+' : '';
    if (cur === 'EUR') return sign + (v < 0 ? '-€' + group(-v) : '€' + group(v));
    return sign + group(v) + ' ден';
  }

  // Native amount as written in the data file, for ledger rows. Keeps cents
  // when the source figure has them (instalments like €283.25).
  function nativeMoney(amount, cur) {
    var exact = Math.abs(amount % 1) > 0.004;
    var body = exact
      ? Math.abs(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      : group(Math.abs(amount));
    var sign = amount < 0 ? '-' : '';
    if (cur === 'MKD') return sign + body + ' ден';
    if (cur === 'USD') return sign + '$' + body;
    return sign + '€' + body;
  }

  // The day's gross, whether the source quotes an hourly or a daily figure.
  function dayAmount(w, knob) {
    var rate = knob == null ? rateKnobOf(w) : knob;
    return w.hourlyRate != null ? rate * (w.hoursPerDay || 8) : rate;
  }

  // The single number the rate slider drives — hourly where the data is
  // quoted hourly, otherwise the day rate.
  function rateKnobOf(w) {
    return w.hourlyRate != null ? w.hourlyRate : w.amount;
  }

  /* ----------------------------------------------------------------- model */

  function isOn(item) {
    return item.active !== false && !scenario.off[item.id];
  }

  function workdaysFor(ym) {
    var n = businessDays(ym);
    var adj = data.calendar && data.calendar.adjustments ? data.calendar.adjustments : [];
    for (var i = 0; i < adj.length; i++) {
      if (adj[i].month !== ym || !isOn(adj[i])) continue;
      if (typeof adj[i].set === 'number') n = adj[i].set;
      else if (typeof adj[i].days === 'number') n += adj[i].days;
    }
    n += scenario.dayAdjust;
    return Math.max(0, n);
  }

  // Does a recurring/one-off entry land in this month?
  function hits(item, ym) {
    var cadence = item.cadence || 'monthly';
    var idx = ymToIndex(ym);
    if (item.startMonth && idx < ymToIndex(item.startMonth)) return false;
    if (item.endMonth && idx > ymToIndex(item.endMonth)) return false;
    if (cadence === 'monthly') return true;
    if (!item.month) return cadence === 'monthly';
    if (cadence === 'once') return item.month === ym;
    if (cadence === 'yearly') {
      var anchor = ymToIndex(item.month);
      return idx >= anchor && ((idx - anchor) % 12 === 0);
    }
    return false;
  }

  // Loans and other liabilities amortise identically; only the label and
  // the list they came from differ.
  function collectDebts() {
    var out = [];
    function take(list, kind) {
      (list || []).forEach(function (d) {
        if (!isOn(d)) return;
        out.push({
          id: d.id,
          kind: kind,
          label: d.label,
          party: d.lender || d.creditor || '',
          currency: d.currency || 'EUR',
          annualRate: d.annualRate || 0,
          monthlyRate: (d.annualRate || 0) / 100 / 12,
          principalEur: toEur(d.principal, d.currency),
          basePayEur: toEur(d.monthlyPayment, d.currency),
          startIdx: ymToIndex(d.startMonth || data.startYm),
          priority: typeof d.priority === 'number' ? d.priority : 99,
          sample: !!d.sample,
        });
      });
    }
    take(data.loans.loans, 'loan');
    take(data.liabilities.liabilities, 'liability');
    return out;
  }

  function monthIncome(ym, workdays) {
    var w = data.income.workday;
    var perDay = dayAmount(w, scenario.rateKnob);
    var sum = isOn(w) ? toEur(perDay * workdays, w.currency) : 0;
    var breakdown = [];
    if (isOn(w)) {
      breakdown.push({
        label: w.label || 'Work day income',
        detail: workdays + ' × ' + nativeMoney(perDay, w.currency) +
          (w.currency === data.meta.baseCurrency
            ? '' : ' = ' + nativeMoney(perDay * workdays, w.currency)),
        eur: sum,
      });
    }
    (data.income.additional || []).forEach(function (it) {
      if (!isOn(it) || !hits(it, ym)) return;
      var eur = toEur(it.amount, it.currency);
      sum += eur;
      breakdown.push({ label: it.label, detail: '', eur: eur });
    });
    return { total: sum, breakdown: breakdown };
  }

  function monthFixed(ym) {
    var sum = 0;
    var breakdown = [];
    (data.budget.budget || []).forEach(function (it) {
      if (!isOn(it) || !hits(it, ym)) return;
      var eur = toEur(it.amount, it.currency);
      sum += eur;
      breakdown.push({ label: it.label, eur: eur });
    });
    return { total: sum, breakdown: breakdown };
  }

  function monthExtras(ym) {
    var sum = 0;
    var breakdown = [];
    (data.extras.extras || []).forEach(function (it) {
      if (!isOn(it) || it.month !== ym) return;
      var eur = toEur(it.amount, it.currency);
      sum += eur;
      breakdown.push({ label: it.label, eur: eur });
    });
    return { total: sum, breakdown: breakdown };
  }

  /* Runs the whole projection: debts amortise together so a cleared debt can
   * hand its instalment to the next one by priority (the "increase deposit"
   * rule), and each month's leftover becomes savings. */
  function build() {
    var startIdx = ymToIndex(data.startYm);
    var horizon = scenario.horizon;

    var debts = collectDebts().map(function (d) {
      d.balance = d.principalEur;
      d.paidOff = false;
      d.schedule = [];
      d.totalInterest = 0;
      d.payoffYm = null;
      d.stalled = false;
      return d;
    });

    var byPriority = debts.slice().sort(function (a, b) { return a.priority - b.priority; });
    var rows = [];
    var cumulative = data.meta.startingSavings || 0;
    var totals = { income: 0, fixed: 0, debt: 0, interest: 0, extras: 0, saved: 0 };

    for (var i = 0; i < MAX_SIM; i++) {
      var ym = indexToYm(startIdx + i);
      var idx = startIdx + i;
      var started = [];
      var k;

      // Freed instalments from cleared debts, plus any scenario top-up.
      var pool = scenario.extraToDebt;
      for (k = 0; k < debts.length; k++) {
        if (debts[k].paidOff && scenario.rollover && idx >= debts[k].startIdx) {
          pool += debts[k].basePayEur;
        }
        if (!debts[k].paidOff && idx >= debts[k].startIdx) started.push(debts[k]);
      }

      var debtPaid = 0;
      var interestPaid = 0;

      // 1. Every live debt takes its own instalment.
      for (k = 0; k < started.length; k++) {
        var d = started[k];
        var opening = d.balance;
        var interest = opening * d.monthlyRate;
        var pay = Math.min(d.basePayEur, opening + interest);
        d.balance = opening + interest - pay;
        d.totalInterest += interest;
        if (pay <= interest + EPS && d.balance >= opening - EPS) d.stalled = true;
        d.row = {
          ym: ym, opening: opening, interest: interest,
          payment: pay, principal: pay - interest, extra: 0,
        };
        debtPaid += pay;
        interestPaid += interest;
      }

      // 2. The pool cascades down the priority list.
      if (pool > EPS) {
        for (k = 0; k < byPriority.length; k++) {
          var t = byPriority[k];
          if (pool <= EPS) break;
          if (!t.row || t.balance <= EPS) continue;
          var extra = Math.min(pool, t.balance);
          t.balance -= extra;
          pool -= extra;
          t.row.payment += extra;
          t.row.principal += extra;
          t.row.extra = extra;
          debtPaid += extra;
        }
      }

      for (k = 0; k < started.length; k++) {
        var s = started[k];
        s.row.closing = s.balance;
        s.schedule.push(s.row);
        s.row = null;
        if (s.balance <= EPS) { s.balance = 0; s.paidOff = true; s.payoffYm = ym; }
      }

      if (i < horizon) {
        var workdays = workdaysFor(ym);
        var inc = monthIncome(ym, workdays);
        var fix = monthFixed(ym);
        var ext = monthExtras(ym);
        var net = inc.total - fix.total - debtPaid;
        var saved = net - ext.total;
        cumulative += saved;

        var outstanding = 0;
        for (k = 0; k < debts.length; k++) outstanding += debts[k].balance;

        rows.push({
          ym: ym, workdays: workdays,
          income: inc.total, incomeBreakdown: inc.breakdown,
          fixed: fix.total, fixedBreakdown: fix.breakdown,
          debt: debtPaid, interest: interestPaid,
          extras: ext.total, extrasBreakdown: ext.breakdown,
          net: net, saved: saved, cumulative: cumulative,
          outstanding: outstanding,
        });

        totals.income += inc.total;
        totals.fixed += fix.total;
        totals.debt += debtPaid;
        totals.interest += interestPaid;
        totals.extras += ext.total;
        totals.saved += saved;
      }

      // Snapshot where each balance lands at the end of the visible window —
      // running to payoff would leave every progress bar at 100%.
      if (i === horizon - 1) {
        for (k = 0; k < debts.length; k++) debts[k].balanceAtHorizon = debts[k].balance;
      }

      var allPaid = debts.every(function (x) { return x.paidOff || x.stalled; });
      if (i >= horizon - 1 && allPaid) break;
    }

    var openingDebt = debts.reduce(function (a, b) { return a + b.principalEur; }, 0);
    var lastPayoff = null;
    debts.forEach(function (x) {
      if (!x.payoffYm) return;
      if (!lastPayoff || ymToIndex(x.payoffYm) > ymToIndex(lastPayoff)) lastPayoff = x.payoffYm;
    });

    return {
      rows: rows,
      debts: debts,
      byPriority: byPriority,
      totals: totals,
      openingDebt: openingDebt,
      lastPayoff: lastPayoff,
      anyStalled: debts.some(function (x) { return x.stalled; }),
    };
  }

  /* -------------------------------------------------------------- overview */

  function renderOverview() {
    var rows = model.rows;
    var n = rows.length || 1;
    // The hero is THIS month, not an average — an average over the horizon
    // quietly drops the instalments of loans that clear early, which makes
    // the outgoings and the saving look nothing like the month you are in.
    var now = rows[0];
    var nowOut = now.fixed + now.debt + now.extras;
    var avgSaved = model.totals.saved / n;

    $('hero-saved').textContent = money(now.saved, { signed: true });
    $('hero-saved').className = 'hero-amount ' + (now.saved < 0 ? 'is-neg' : 'is-pos');
    $('hero-sub').textContent = ymLabel(now.ym, { long: true }) + ' · ' +
      now.workdays + ' work days · ' + incomeDerivation(now);
    $('hero-income').textContent = money(now.income);
    $('hero-out').textContent = money(nowOut);
    $('hero-rate').textContent = now.income > 0
      ? Math.round((now.saved / now.income) * 100) + '%' : '—';

    var last = rows[rows.length - 1];
    var cards = [
      {
        label: 'Loan payments',
        value: money(now.debt),
        note: 'Every month, ' + model.debts.length + ' ' +
          (model.debts.length === 1 ? 'debt' : 'debts'),
        tone: 'plain',
      },
      {
        label: 'Average saved',
        value: money(avgSaved, { signed: true }),
        note: 'Per month across ' + n + ' months',
        tone: avgSaved < 0 ? 'neg' : 'pos',
      },
      {
        label: 'Savings at ' + ymLabel(last.ym),
        value: money(last.cumulative),
        note: 'Starting from ' + money(data.meta.startingSavings || 0),
        tone: last.cumulative < 0 ? 'neg' : 'pos',
      },
      {
        label: 'Debt today',
        value: money(model.openingDebt),
        note: model.debts.length + ' ' + (model.debts.length === 1 ? 'debt' : 'debts') + ' tracked',
        tone: 'plain',
      },
      {
        label: 'Debt-free',
        value: model.lastPayoff ? ymLabel(model.lastPayoff, { long: true }) : '—',
        note: model.lastPayoff ? monthsAway(model.lastPayoff) : 'Not within the run',
        tone: 'plain',
      },
      {
        label: 'Interest paid',
        value: money(model.debts.reduce(function (a, b) { return a + b.totalInterest; }, 0)),
        note: 'Over the life of every debt',
        tone: 'plain',
      },
    ];
    $('stat-grid').innerHTML = cards.map(function (c) {
      return '<div class="stat">' +
        '<div class="stat-label">' + esc(c.label) + '</div>' +
        '<div class="stat-value is-' + c.tone + '">' + esc(c.value) + '</div>' +
        '<div class="stat-note">' + esc(c.note) + '</div>' +
        '</div>';
    }).join('');

    renderChart();
    renderPlan();
    renderNextMonths();
  }

  // Spells out how the work-day income became euros, so a wrong FX rate or
  // day count is visible on the face of the app rather than buried.
  function incomeDerivation(row) {
    var w = data.income.workday;
    if (!isOn(w)) return 'no work-day income';
    var cur = w.currency;
    var gross = dayAmount(w, scenario.rateKnob) * row.workdays;
    if (cur === data.meta.baseCurrency) return nativeMoney(gross, cur);
    return nativeMoney(gross, cur) + ' at ' + data.meta.fixedRates[cur] + ' ' +
      cur + ' per ' + data.meta.baseCurrency;
  }

  function monthsAway(ym) {
    var d = ymToIndex(ym) - ymToIndex(data.startYm);
    if (d <= 0) return 'This month';
    return d + ' ' + (d === 1 ? 'month' : 'months') + ' away';
  }

  function renderPlan() {
    var paid = model.byPriority.filter(function (d) { return d.payoffYm; });
    var note = $('plan-note');
    note.textContent = scenario.rollover ? 'Freed payments roll over' : 'Rollover off';

    if (!model.byPriority.length) {
      $('plan-list').innerHTML = '<li class="plan-empty">No debts yet.</li>';
      return;
    }

    $('plan-list').innerHTML = model.byPriority.map(function (d, i) {
      var cleared = d.payoffYm;
      var freed;
      if (d.stalled) freed = 'instalment below the monthly interest';
      else if (!cleared) freed = 'still running';
      else if (scenario.rollover) freed = 'frees ' + money(d.basePayEur) + '/mo for the next debt';
      else freed = money(d.basePayEur) + '/mo back to savings';
      return '<li class="plan-item">' +
        '<span class="plan-rank">' + (i + 1) + '</span>' +
        '<span class="plan-body">' +
          '<span class="plan-name">' + esc(d.label) + '</span>' +
          '<span class="plan-note">' + esc(freed) + '</span>' +
        '</span>' +
        '<span class="plan-when' + (cleared ? '' : ' is-open') + '">' +
          (cleared ? esc(ymLabel(cleared)) : '—') + '</span>' +
        '</li>';
    }).join('');
  }

  function renderNextMonths() {
    var slice = model.rows.slice(0, 3);
    $('next-months').innerHTML = slice.map(function (r) {
      return '<div class="mini-row">' +
        '<span class="mini-month">' + esc(ymLabel(r.ym, { long: true })) + '</span>' +
        '<span class="mini-bars">' +
          '<span class="mini-bar is-in" style="width:' + pctOf(r.income, slice) + '%"></span>' +
          '<span class="mini-bar is-out" style="width:' +
            pctOf(r.fixed + r.debt + r.extras, slice) + '%"></span>' +
        '</span>' +
        '<span class="mini-saved ' + (r.saved < 0 ? 'is-neg' : 'is-pos') + '">' +
          esc(money(r.saved, { signed: true })) + '</span>' +
        '</div>';
    }).join('');
  }

  function pctOf(v, slice) {
    var max = 1;
    slice.forEach(function (r) {
      max = Math.max(max, r.income, r.fixed + r.debt + r.extras);
    });
    return Math.max(2, Math.round((v / max) * 100));
  }

  /* ----------------------------------------------------------------- chart */

  function renderChart() {
    var wrap = $('chart-wrap');
    var tip = $('chart-tip');
    var rows = model.rows;
    var width = Math.max(260, wrap.clientWidth || 320);
    var height = 230;
    var pad = { top: 16, right: 14, bottom: 26, left: 52 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;

    $('chart-range').textContent = rows.length + ' months';

    var lo = 0;
    var hi = 0;
    rows.forEach(function (r) {
      lo = Math.min(lo, r.cumulative, r.outstanding);
      hi = Math.max(hi, r.cumulative, r.outstanding);
    });
    if (hi === lo) hi = lo + 1;
    var span = hi - lo;
    lo -= span * 0.06;
    hi += span * 0.06;

    function x(i) {
      return pad.left + (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
    }
    function y(v) {
      return pad.top + plotH - ((v - lo) / (hi - lo)) * plotH;
    }

    chartPoints = rows.map(function (r, i) {
      return { i: i, x: x(i), ySaved: y(r.cumulative), yDebt: y(r.outstanding), row: r };
    });

    function path(key) {
      return chartPoints.map(function (p, i) {
        return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p[key].toFixed(1);
      }).join(' ');
    }

    var ticks = niceTicks(lo, hi, 4);
    var gridSvg = ticks.map(function (t) {
      return '<line class="grid" x1="' + pad.left + '" x2="' + (width - pad.right) +
        '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/>' +
        '<text class="axis-y" x="' + (pad.left - 8) + '" y="' + (y(t) + 4).toFixed(1) + '">' +
        esc(shortMoney(t)) + '</text>';
    }).join('');

    var step = Math.max(1, Math.ceil(rows.length / 6));
    var xLabels = '';
    for (var i = 0; i < rows.length; i += step) {
      xLabels += '<text class="axis-x" x="' + x(i).toFixed(1) + '" y="' + (height - 8) + '">' +
        esc(ymLabel(rows[i].ym)) + '</text>';
    }

    var zeroLine = (lo < 0 && hi > 0)
      ? '<line class="zero" x1="' + pad.left + '" x2="' + (width - pad.right) +
        '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>'
      : '';

    var areaPath = path('ySaved') + ' L' + x(rows.length - 1).toFixed(1) + ' ' +
      y(Math.max(lo, 0)).toFixed(1) + ' L' + x(0).toFixed(1) + ' ' +
      y(Math.max(lo, 0)).toFixed(1) + ' Z';

    var lastP = chartPoints[chartPoints.length - 1];
    var svg =
      '<svg class="chart" width="' + width + '" height="' + height + '" ' +
        'viewBox="0 0 ' + width + ' ' + height + '" role="img" ' +
        'aria-label="Cumulative savings and outstanding debt by month">' +
        '<defs><linearGradient id="savedFill" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + COLOR_SAVINGS + '" stop-opacity="0.22"/>' +
          '<stop offset="100%" stop-color="' + COLOR_SAVINGS + '" stop-opacity="0.02"/>' +
        '</linearGradient></defs>' +
        gridSvg + zeroLine +
        '<path class="area" d="' + areaPath + '" fill="url(#savedFill)"/>' +
        '<path class="line" d="' + path('yDebt') + '" stroke="' + COLOR_DEBT + '"/>' +
        '<path class="line" d="' + path('ySaved') + '" stroke="' + COLOR_SAVINGS + '"/>' +
        '<circle class="end-dot" cx="' + lastP.x.toFixed(1) + '" cy="' + lastP.ySaved.toFixed(1) +
          '" r="4" fill="' + COLOR_SAVINGS + '"/>' +
        '<circle class="end-dot" cx="' + lastP.x.toFixed(1) + '" cy="' + lastP.yDebt.toFixed(1) +
          '" r="4" fill="' + COLOR_DEBT + '"/>' +
        '<g class="cross">' +
          '<line class="cross-line" y1="' + pad.top + '" y2="' + (pad.top + plotH) + '"/>' +
          '<circle class="cross-dot cross-saved" r="5" fill="' + COLOR_SAVINGS + '"/>' +
          '<circle class="cross-dot cross-debt" r="5" fill="' + COLOR_DEBT + '"/>' +
        '</g>' +
        xLabels +
      '</svg>';

    wrap.innerHTML = svg;
    wrap.appendChild(tip);

    $('chart-legend').innerHTML =
      '<span class="legend-item"><span class="legend-swatch" style="background:' +
        COLOR_SAVINGS + '"></span>Savings · ' + esc(money(lastP.row.cumulative)) + '</span>' +
      '<span class="legend-item"><span class="legend-swatch" style="background:' +
        COLOR_DEBT + '"></span>Debt left · ' + esc(money(lastP.row.outstanding)) + '</span>';

    bindChartHover(wrap, tip, width);
    renderChartTable();
  }

  function shortMoney(eur) {
    var v = fromEur(eur, currency);
    var abs = Math.abs(v);
    var sym = currency === 'EUR' ? '€' : '';
    var suffix = currency === 'EUR' ? '' : 'д';
    if (abs >= 1000000) return sym + (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M' + suffix;
    if (abs >= 1000) return sym + (v / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' + suffix;
    return sym + Math.round(v) + suffix;
  }

  function niceTicks(lo, hi, count) {
    var raw = (hi - lo) / count;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var stepMul = norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1;
    var step = stepMul * mag;
    var out = [];
    for (var t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t);
    return out;
  }

  function bindChartHover(wrap, tip, width) {
    var svg = wrap.querySelector('svg');
    var cross = svg.querySelector('.cross');
    var line = svg.querySelector('.cross-line');
    var dotS = svg.querySelector('.cross-saved');
    var dotD = svg.querySelector('.cross-debt');

    function move(ev) {
      var rect = svg.getBoundingClientRect();
      var px = ((ev.clientX - rect.left) / rect.width) * width;
      var best = chartPoints[0];
      for (var i = 1; i < chartPoints.length; i++) {
        if (Math.abs(chartPoints[i].x - px) < Math.abs(best.x - px)) best = chartPoints[i];
      }
      cross.classList.add('is-on');
      line.setAttribute('x1', best.x);
      line.setAttribute('x2', best.x);
      dotS.setAttribute('cx', best.x); dotS.setAttribute('cy', best.ySaved);
      dotD.setAttribute('cx', best.x); dotD.setAttribute('cy', best.yDebt);

      tip.hidden = false;
      tip.innerHTML =
        '<div class="tip-month">' + esc(ymLabel(best.row.ym, { long: true })) + '</div>' +
        '<div class="tip-row"><span class="legend-swatch" style="background:' + COLOR_SAVINGS +
          '"></span>Savings<b>' + esc(money(best.row.cumulative)) + '</b></div>' +
        '<div class="tip-row"><span class="legend-swatch" style="background:' + COLOR_DEBT +
          '"></span>Debt left<b>' + esc(money(best.row.outstanding)) + '</b></div>' +
        '<div class="tip-row is-quiet">Saved that month<b>' +
          esc(money(best.row.saved, { signed: true })) + '</b></div>';

      var ratio = best.x / width;
      var tipW = tip.offsetWidth || 150;
      var left = (ratio * wrap.clientWidth) - (tipW / 2);
      left = Math.max(4, Math.min(wrap.clientWidth - tipW - 4, left));
      tip.style.left = left + 'px';
    }

    function leave() {
      cross.classList.remove('is-on');
      tip.hidden = true;
    }

    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
    svg.addEventListener('pointercancel', leave);
  }

  function renderChartTable() {
    var head = '<tr><th>Month</th><th>Savings</th><th>Debt left</th><th>Saved</th></tr>';
    var body = model.rows.map(function (r) {
      return '<tr><td>' + esc(ymLabel(r.ym, { long: true })) + '</td>' +
        '<td>' + esc(money(r.cumulative)) + '</td>' +
        '<td>' + esc(money(r.outstanding)) + '</td>' +
        '<td>' + esc(money(r.saved, { signed: true })) + '</td></tr>';
    }).join('');
    $('chart-table').innerHTML = '<table class="data-table">' + head + body + '</table>';
  }

  /* ---------------------------------------------------------------- months */

  function renderMonths() {
    $('months-list').innerHTML = model.rows.map(function (r, i) {
      var tone = r.saved < 0 ? 'is-neg' : 'is-pos';
      return '<details class="mrow"' + (i === 0 ? ' open' : '') + '>' +
        '<summary class="mrow-head">' +
          '<span class="mrow-month">' + esc(ymLabel(r.ym, { long: true })) +
            '<span class="mrow-days">' + r.workdays + ' work days</span></span>' +
          '<span class="mrow-saved ' + tone + '">' + esc(money(r.saved, { signed: true })) + '</span>' +
        '</summary>' +
        '<div class="mrow-body">' +
          line('Income', r.income, 'in', r.incomeBreakdown) +
          line('Fixed budget', -r.fixed, 'out', r.fixedBreakdown) +
          line('Debt payments', -r.debt, 'out',
            r.interest > 0 ? [{ label: 'of which interest', eur: r.interest }] : []) +
          (r.extras > 0 ? line('Unplanned', -r.extras, 'out', r.extrasBreakdown) : '') +
          '<div class="mrow-total"><span>Saved this month</span><b class="' + tone + '">' +
            esc(money(r.saved, { signed: true })) + '</b></div>' +
          '<div class="mrow-total is-quiet"><span>Savings after</span><b>' +
            esc(money(r.cumulative)) + '</b></div>' +
        '</div>' +
      '</details>';
    }).join('');
  }

  function line(label, eur, dir, breakdown) {
    var sub = (breakdown || []).map(function (b) {
      return '<div class="mrow-sub"><span>' + esc(b.label) +
        (b.detail ? ' <i>' + esc(b.detail) + '</i>' : '') + '</span><span>' +
        esc(money(b.eur)) + '</span></div>';
    }).join('');
    return '<div class="mrow-line is-' + dir + '">' +
      '<span>' + esc(label) + '</span><b>' + esc(money(eur, { signed: true })) + '</b></div>' + sub;
  }

  /* ----------------------------------------------------------------- debts */

  function renderDebts() {
    var live = model.debts;
    var totalInterest = live.reduce(function (a, b) { return a + b.totalInterest; }, 0);
    var monthly = live.reduce(function (a, b) { return a + b.basePayEur; }, 0);

    $('debts-summary').innerHTML = '<div class="card summary-card">' +
      '<div class="sum-cell"><span>Owed now</span><b>' + esc(money(model.openingDebt)) + '</b></div>' +
      '<div class="sum-cell"><span>Per month</span><b>' + esc(money(monthly)) + '</b></div>' +
      '<div class="sum-cell"><span>Interest total</span><b>' + esc(money(totalInterest)) + '</b></div>' +
      '<div class="sum-cell"><span>Debt-free</span><b>' +
        (model.lastPayoff ? esc(ymLabel(model.lastPayoff)) : '—') + '</b></div>' +
      '</div>';

    if (!live.length) {
      $('debts-list').innerHTML = '<div class="empty-note">No debts in the data yet.</div>';
      return;
    }

    $('debts-list').innerHTML = model.byPriority.map(function (d) {
      var left = typeof d.balanceAtHorizon === 'number' ? d.balanceAtHorizon : d.balance;
      var pct = d.principalEur > 0
        ? Math.max(0, Math.min(100, ((d.principalEur - left) / d.principalEur) * 100)) : 100;
      var months = d.schedule.length;
      var horizonEnd = model.rows.length ? model.rows[model.rows.length - 1].ym : null;
      var rowsHtml = d.schedule.map(function (s, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(ymLabel(s.ym)) + '</td>' +
          '<td>' + esc(money(s.payment)) + '</td>' +
          '<td>' + esc(money(s.interest)) + '</td>' +
          '<td>' + esc(money(s.principal)) + '</td>' +
          '<td>' + esc(money(s.closing)) + '</td></tr>';
      }).join('');

      return '<div class="card debt-card">' +
        '<div class="debt-head">' +
          '<span class="debt-rank" title="Repayment priority">' + esc(String(d.priority)) + '</span>' +
          '<span class="debt-id">' +
            '<span class="debt-name">' + esc(d.label) + '</span>' +
            '<span class="debt-meta">' + esc(d.kind === 'loan' ? 'Loan' : 'Liability') +
              (d.party ? ' · ' + esc(d.party) : '') +
              ' · ' + (d.annualRate ? esc(d.annualRate + '% p.a.') : 'no interest') +
              (d.sample ? ' · sample' : '') +
            '</span>' +
          '</span>' +
          '<span class="debt-bal">' + esc(money(d.principalEur)) + '</span>' +
        '</div>' +
        '<div class="progress-cap"><span>' + Math.round(pct) + '% repaid by ' +
          (horizonEnd ? esc(ymLabel(horizonEnd)) : '—') + '</span><span>' +
          esc(money(left)) + ' left</span></div>' +
        '<div class="progress"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
        '<div class="debt-facts">' +
          '<span><i>Instalment</i>' + esc(money(d.basePayEur)) + '</span>' +
          '<span><i>Interest</i>' + esc(money(d.totalInterest)) + '</span>' +
          '<span><i>Cleared</i>' + (d.payoffYm ? esc(ymLabel(d.payoffYm)) : '—') + '</span>' +
          '<span><i>Months</i>' + (d.payoffYm ? months : '—') + '</span>' +
        '</div>' +
        (d.stalled ? '<div class="warn">The instalment is smaller than the monthly ' +
          'interest — this balance never clears.</div>' : '') +
        '<details class="sched"><summary>Payment schedule</summary>' +
          '<div class="table-scroll"><table class="data-table">' +
          '<tr><th>#</th><th>Month</th><th>Paid</th><th>Interest</th>' +
          '<th>Principal</th><th>Left</th></tr>' + rowsHtml + '</table></div>' +
        '</details>' +
      '</div>';
    }).join('');
  }

  /* ---------------------------------------------------------------- ledger */

  function ledgerSection(title, note, items, render) {
    if (!items.length) {
      return '<div class="card"><div class="card-head"><h2 class="card-title">' + esc(title) +
        '</h2></div><div class="empty-note">Nothing here yet.</div></div>';
    }
    return '<div class="card">' +
      '<div class="card-head"><h2 class="card-title">' + esc(title) + '</h2>' +
      '<span class="card-note">' + esc(note) + '</span></div>' +
      items.map(render).join('') +
      '</div>';
  }

  function ledgerRow(item, right, sub) {
    var off = !isOn(item);
    return '<div class="lrow' + (off ? ' is-off' : '') + '" data-toggle="' + esc(item.id) + '">' +
      '<span class="lcheck" aria-hidden="true"></span>' +
      '<span class="lbody"><span class="lname">' + esc(item.label) +
        (item.sample ? '<span class="tag">sample</span>' : '') + '</span>' +
        '<span class="lnote">' + esc(sub) + '</span></span>' +
      '<span class="lright">' + esc(right) + '</span>' +
      '</div>';
  }

  function renderLedger() {
    var w = data.income.workday;
    var cadenceNote = {
      monthly: 'every month', yearly: 'once a year', once: 'one-off',
    };

    var incomeHtml = ledgerSection('Income', 'Day rate and extras', [w].concat(
      data.income.additional || []
    ), function (it) {
      if (it === w) {
        var committed = rateKnobOf(w);
        var detail = w.hourlyRate != null
          ? nativeMoney(committed, w.currency) + ' / h × ' + (w.hoursPerDay || 8) + ' h'
          : (w.note || 'Per working day');
        return ledgerRow({ id: 'workday', label: w.label || 'Work day income', sample: w.sample },
          nativeMoney(dayAmount(w, null), w.currency) + ' / day', detail);
      }
      return ledgerRow(it, nativeMoney(it.amount, it.currency),
        (cadenceNote[it.cadence || 'monthly'] || '') +
        (it.month ? ' · from ' + ymLabel(it.month, { long: true }) : ''));
    });

    var budgetTotal = (data.budget.budget || []).reduce(function (a, b) {
      return a + (isOn(b) ? toEur(b.amount, b.currency) : 0);
    }, 0);
    var budgetHtml = ledgerSection('Fixed monthly budget', money(budgetTotal) + ' / month',
      data.budget.budget || [], function (it) {
        return ledgerRow(it, nativeMoney(it.amount, it.currency), it.note || 'every month');
      });

    var debtItems = (data.loans.loans || []).map(function (m) {
      return { item: m, kind: 'Loan' };
    }).concat((data.liabilities.liabilities || []).map(function (l) {
      return { item: l, kind: 'Liability' };
    })).sort(function (a, b) {
      return (a.item.priority || 99) - (b.item.priority || 99);
    });

    var debtHtml = ledgerSection('Loans and liabilities', 'By repayment priority',
      debtItems, function (d) {
        return ledgerRow(d.item, nativeMoney(d.item.monthlyPayment, d.item.currency) + ' / mo',
          'Priority ' + (d.item.priority || '—') + ' · ' + d.kind + ' · ' +
          nativeMoney(d.item.principal, d.item.currency) +
          (d.item.annualRate ? ' at ' + d.item.annualRate + '%' : ' at 0%'));
      });

    var extrasHtml = ledgerSection('Unplanned expenses', 'Drawn from savings',
      data.extras.extras || [], function (it) {
        return ledgerRow(it, nativeMoney(it.amount, it.currency),
          ymLabel(it.month, { long: true }) + (it.note ? ' · ' + it.note : ''));
      });

    var adjHtml = ledgerSection('Work day adjustments', 'Days off and extra days',
      (data.calendar && data.calendar.adjustments) || [], function (it, i) {
        var id = it.id || ('adj-' + it.month + '-' + i);
        it.id = id;
        var delta = typeof it.set === 'number'
          ? it.set + ' days' : (it.days > 0 ? '+' + it.days : it.days) + ' days';
        return ledgerRow({ id: id, label: ymLabel(it.month, { long: true }), sample: it.sample },
          delta, it.note || '');
      });

    $('ledger-list').innerHTML = incomeHtml + debtHtml + budgetHtml + extrasHtml + adjHtml;
  }

  /* ------------------------------------------------------------- scenario */

  function scenarioTouched() {
    return scenario.rateKnob !== defaults.rateKnob ||
      scenario.dayAdjust !== 0 ||
      scenario.extraToDebt !== 0 ||
      scenario.horizon !== defaults.horizon ||
      scenario.rollover !== defaults.rollover ||
      Object.keys(scenario.off).length > 0;
  }

  function syncScenarioUi() {
    var w = data.income.workday;
    var cur = w.currency;
    $('sc-rate').value = scenario.rateKnob;
    $('sc-rate-out').textContent = w.hourlyRate != null
      ? nativeMoney(scenario.rateKnob, cur) + ' / h · ' +
        nativeMoney(dayAmount(w, scenario.rateKnob), cur) + ' a day'
      : nativeMoney(scenario.rateKnob, cur) + ' / day';
    $('sc-days').value = scenario.dayAdjust;
    $('sc-days-out').textContent = scenario.dayAdjust === 0
      ? 'Actual (Mon–Fri)'
      : (scenario.dayAdjust > 0 ? '+' : '') + scenario.dayAdjust + ' days every month';
    $('sc-extra').value = scenario.extraToDebt;
    $('sc-extra-out').textContent = scenario.extraToDebt === 0
      ? 'Nothing extra' : money(scenario.extraToDebt, { cur: 'EUR' }) + ' / month';
    $('sc-horizon').value = scenario.horizon;
    $('sc-horizon-out').textContent = scenario.horizon + ' months';
    $('sc-rollover').checked = scenario.rollover;
    $('scenario-dot').hidden = !scenarioTouched();
  }

  function recompute() {
    model = build();
    if (view === 'overview') renderOverview();
    else if (view === 'months') renderMonths();
    else if (view === 'debts') renderDebts();
    else renderLedger();
    renderFoot();
    syncScenarioUi();
  }

  function renderFoot() {
    var samples = 0;
    [data.income.additional, data.loans.loans, data.liabilities.liabilities,
      data.budget.budget, data.extras.extras,
      (data.calendar && data.calendar.adjustments) || []].forEach(function (list) {
      (list || []).forEach(function (it) { if (it.sample) samples++; });
    });
    if (data.income.workday.sample) samples++;

    var rates = Object.keys(data.meta.fixedRates).map(function (c) {
      return data.meta.fixedRates[c] + ' ' + c;
    }).join(' · ');
    $('foot-meta').textContent = 'Fixed rates per EUR: ' + rates +
      ' · data edited through Claude Code sessions';

    var banner = $('banner');
    if (samples > 0) {
      banner.hidden = false;
      banner.textContent = samples + ' sample ' + (samples === 1 ? 'row is' : 'rows are') +
        ' still in place — tell Claude your real numbers and they get replaced.';
    } else {
      banner.hidden = true;
    }
  }

  function setView(next) {
    view = next;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('is-on', t.dataset.view === next);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
      v.classList.toggle('is-active', v.id === 'view-' + next);
    });
    $('main-content').scrollTop = 0;
    recompute();
  }

  function openSheet(open) {
    $('scenario-sheet').hidden = !open;
    $('sheet-backdrop').hidden = !open;
    document.body.classList.toggle('sheet-open', open);
  }

  function bind() {
    $('tabs').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.tab');
      if (btn) setView(btn.dataset.view);
    });

    $('cur-switch').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.cur-btn');
      if (!btn || btn.dataset.cur === currency) return;
      currency = btn.dataset.cur;
      Array.prototype.forEach.call(document.querySelectorAll('.cur-btn'), function (b) {
        var on = b.dataset.cur === currency;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      recompute();
    });

    $('ledger-list').addEventListener('click', function (ev) {
      var row = ev.target.closest('[data-toggle]');
      if (!row) return;
      var id = row.dataset.toggle;
      if (scenario.off[id]) delete scenario.off[id];
      else scenario.off[id] = true;
      recompute();
    });

    $('scenario-btn').addEventListener('click', function () { openSheet(true); });
    $('sheet-close').addEventListener('click', function () { openSheet(false); });
    $('sheet-backdrop').addEventListener('click', function () { openSheet(false); });

    $('sc-rate').addEventListener('input', function () {
      scenario.rateKnob = Number(this.value); recompute();
    });
    $('sc-days').addEventListener('input', function () {
      scenario.dayAdjust = Number(this.value); recompute();
    });
    $('sc-extra').addEventListener('input', function () {
      scenario.extraToDebt = Number(this.value); recompute();
    });
    $('sc-horizon').addEventListener('input', function () {
      scenario.horizon = Number(this.value); recompute();
    });
    $('sc-rollover').addEventListener('change', function () {
      scenario.rollover = this.checked; recompute();
    });
    $('sc-reset').addEventListener('click', function () {
      scenario.rateKnob = defaults.rateKnob;
      scenario.dayAdjust = 0;
      scenario.extraToDebt = 0;
      scenario.horizon = defaults.horizon;
      scenario.rollover = defaults.rollover;
      scenario.off = Object.create(null);
      recompute();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') openSheet(false);
    });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (view !== 'overview') return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderChart, 120);
    });
  }

  /* ------------------------------------------------------------------ boot */

  function fail(message) {
    var splash = $('app-loading');
    if (splash) splash.classList.add('hidden');
    $('main-content').innerHTML = '<div class="empty-note">' + esc(message) + '</div>';
  }

  function load() {
    return Promise.all(DATA_FILES.map(function (name) {
      return fetch('data/' + name + '.json', { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error(name + '.json → HTTP ' + res.status);
        return res.json();
      });
    })).then(function (parts) {
      var out = {};
      DATA_FILES.forEach(function (name, i) { out[name] = parts[i]; });
      return out;
    });
  }

  load().then(function (loaded) {
    data = loaded;
    data.startYm = (!data.meta.startMonth || data.meta.startMonth === 'auto')
      ? currentYm() : data.meta.startMonth;

    var w = data.income.workday;
    defaults = {
      rateKnob: rateKnobOf(w),
      horizon: data.meta.horizonMonths || 36,
      rollover: data.meta.rollover !== false,
    };
    scenario.rateKnob = defaults.rateKnob;
    scenario.horizon = defaults.horizon;
    scenario.rollover = defaults.rollover;

    // Slider spans zero to double the committed rate, in ~100 steps.
    var rateMax = Math.max(1, Math.ceil(defaults.rateKnob * 2));
    $('sc-rate').max = String(rateMax);
    $('sc-rate').step = rateMax <= 200 ? '1' : '5';
    $('sc-rate-label').textContent = w.hourlyRate != null ? 'Hourly rate' : 'Day rate';

    bind();
    renderLedger();
    recompute();

    var splash = $('app-loading');
    splash.classList.add('hidden');
    setTimeout(function () { splash.remove(); }, 420);
  }).catch(function (err) {
    fail('Could not load the forecast data. ' + err.message);
  });
}());

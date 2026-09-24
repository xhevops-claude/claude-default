/* Forecast — projects income, debt repayment and savings on a dated timeline.
 *
 * Source of truth is the committed JSON under data/. Everything the user
 * flips in the UI (currency, scenario sliders, per-row include/exclude) is a
 * session-only overlay — nothing is persisted, nothing is written back.
 *
 * This is a CASH model, not an accrual one: work done in a period shows up on
 * the day the money actually lands in Wise, which under net-20 is the month
 * after it was earned. So "income in October" is September's work.
 *
 * All arithmetic happens in EUR. MKD is pegged (meta.fixedRates), so a MKD
 * loan amortises identically in either unit and we only convert for display.
 */
(function () {
  'use strict';

  var DATA_FILES = ['meta', 'income', 'loans', 'liabilities', 'budget', 'extras',
    'calendar', 'investments'];
  // Far enough to amortise anything realistic; the horizon slider only
  // controls how much of the run we render.
  var MAX_MONTHS = 720;
  var EPS = 0.005;
  var DAY_MS = 86400000;

  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Fallbacks only — boot reads the real values off :root so the palette is
  // defined in one place (styles.css).
  var COLOR_SAVINGS = '#3987e5';
  var COLOR_DEBT = '#d95926';

  // Income first, then what it pays for — same-day ordering in the timeline.
  // One-based so the `|| LAST` fallback can't swallow a zero.
  var KIND_ORDER = { income: 1, loan: 2, budget: 3, extra: 4 };
  var KIND_LAST = 9;

  var data = null;
  var view = 'timeline';
  var currency = 'EUR';
  var model = null;
  var chartPoints = null;
  var today = null;

  // How far one tap of a −/+ arrow moves each field. Both are EUR so the arrows
  // shift the same real money whichever currency the header is showing.
  var BUDGET_STEP_EUR = 50;
  var PRICE_STEP_EUR = 50;

  /* Overrides on top of the committed data — never a write back to it. The
   * whole set, and the display currency, is kept in localStorage so a reload
   * (or the next visit) picks up where the last one left off; every change
   * passes through recompute(), which is where the save happens. Reset in the
   * scenario sheet puts everything back to the committed data. */
  var SCENARIO_STORE = 'forecast-scenario-v1';
  var LEGACY_OFF_STORE = 'forecast-ledger-off-v1';   // ticks only, pre-v1; migrated once

  /* Guest mode opens sample-data.json instead of the vault: invented numbers,
   * no passphrase, nothing cached. It is a tour of the app for someone without
   * the secret, and a fixed dataset to check a change against. Its overrides
   * live under their own key so they never bleed into the real ones. */
  var guest = false;
  var GUEST_STORE = 'forecast-scenario-guest-v1';
  function scenarioStore() { return guest ? GUEST_STORE : SCENARIO_STORE; }
  var scenario = {
    pricePerM2: null,       // EUR/m² the sale figures are struck at
    rateKnob: null,
    budgetOverride: null,   // EUR/month, null = whatever budget.json says
    cycleExtra: null,       // { start: ISO cycle start, eur } — this cycle only
    dayAdjust: 0,
    extraToDebt: 0,
    horizon: 36,
    rollover: false,
    off: Object.create(null),
    amounts: Object.create(null),   // id → native amount typed over a ledger row
    custom: [],                     // income and expenses added on the Ledger
  };
  var defaults = null;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ----------------------------------------------------------------- dates */

  function mkDate(y, m, day) { return new Date(Date.UTC(y, m, day)); }
  function addDays(dt, n) { return new Date(dt.getTime() + (n * DAY_MS)); }
  function isWeekend(dt) { var w = dt.getUTCDay(); return w === 0 || w === 6; }

  function workingOnOrAfter(dt) {
    var d = dt;
    while (isWeekend(d)) d = addDays(d, 1);
    return d;
  }

  function addWorkingDays(dt, n) {
    var d = dt;
    for (var i = 0; i < n; i++) {
      d = addDays(d, 1);
      while (isWeekend(d)) d = addDays(d, 1);
    }
    return d;
  }

  function weekdaysBetween(a, b) {
    var n = 0;
    var d = a;
    while (d.getTime() <= b.getTime()) {
      if (!isWeekend(d)) n++;
      d = addDays(d, 1);
    }
    return n;
  }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function ymOf(dt) { return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1); }

  function ymToIndex(ym) {
    var p = String(ym).split('-');
    return (parseInt(p[0], 10) * 12) + (parseInt(p[1], 10) - 1);
  }

  function ymLabel(ym, opts) {
    var p = String(ym).split('-');
    var name = MONTHS_SHORT[parseInt(p[1], 10) - 1];
    return (opts && opts.long) ? name + ' ' + p[0] : name + ' ’' + p[0].slice(2);
  }

  // "Tue 6 Oct" for the timeline; { full: true } adds the year.
  function dateLabel(dt, opts) {
    var s = DAYS_SHORT[dt.getUTCDay()] + ' ' + dt.getUTCDate() + ' ' +
      MONTHS_SHORT[dt.getUTCMonth()];
    return (opts && opts.full) ? s + ' ' + dt.getUTCFullYear() : s;
  }

  function todayUtc() {
    var n = new Date();
    return mkDate(n.getFullYear(), n.getMonth(), n.getDate());
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

  /* ---------------------------------------------------------- pay periods */

  function isOn(item) {
    return item.active !== false && !scenario.off[item.id];
  }

  // A ledger row's amount as the forecast should use it: what the user typed
  // over it on the Ledger view, else what the data file says. Only the
  // additional income, budget and unplanned-expense rows are editable there.
  function amountOf(item) {
    var o = scenario.amounts[item.id];
    return o != null ? o : item.amount;
  }

  function curSymbol(cur) {
    if (cur === 'MKD') return 'ден';
    if (cur === 'USD') return '$';
    return '€';
  }

  /* ------------------------------------------------------ your additions */

  /* Income and expenses the user adds on the Ledger, kept in the scenario
   * store rather than the data files. Each one becomes ordinary events in
   * build(): a calendar entry ("on a date", "every month") joins the
   * additional-income or unplanned-expense list for the walk, and a pay-linked
   * one ("with the next pay", "every pay") hangs off the pay arrivals the way
   * an instalment does, so it lands the day the money does.
   *
   *   { id, kind: 'income'|'expense', label, amount, currency,
   *     when: 'next-pay'|'every-pay'  + from: 'yyyy-mm-dd'   (pays on/after)
   *     when: 'date'|'monthly'        + date: 'yyyy-mm-dd'   (first occurrence) } */
  var WHEN = ['next-pay', 'date', 'every-pay', 'monthly'];

  function customId() {
    return 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function isoDate(s) {
    return mkDate(parseInt(s.slice(0, 4), 10), parseInt(s.slice(5, 7), 10) - 1,
      parseInt(s.slice(8, 10), 10));
  }

  function isoOf(dt) {
    return ymOf(dt) + '-' + pad2(dt.getUTCDate());
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // The calendar entries of one kind as items the existing loops understand.
  function customCalendarItems(kind) {
    return scenario.custom.filter(function (c) {
      return c.kind === kind && (c.when === 'date' || c.when === 'monthly');
    }).map(function (c) {
      var item = { id: c.id, label: c.label, amount: c.amount, currency: c.currency,
        day: parseInt(c.date.slice(8, 10), 10), note: 'added by you' };
      if (c.when === 'date') { item.cadence = 'once'; item.month = c.date.slice(0, 7); }
      else { item.cadence = 'monthly'; item.startMonth = c.date.slice(0, 7); }
      return item;
    });
  }

  function customWhenLabel(c) {
    if (c.when === 'next-pay') return 'once · with the next pay after ' + dateLabel(isoDate(c.from));
    if (c.when === 'every-pay') return 'every pay · from ' + dateLabel(isoDate(c.from));
    var d = isoDate(c.date);
    if (c.when === 'date') return 'once · ' + dateLabel(d, { full: true });
    return 'every month on the ' + ordinal(d.getUTCDate()) + ' · from ' +
      ymLabel(c.date.slice(0, 7), { long: true });
  }

  function payCycle() {
    return data.income.payCycle || {
      netDays: 20,
      transferWorkingDays: 1,
      periods: [{ id: 'monthly', label: 'month', fromDay: 1, toDay: 'end' }],
    };
  }

  // A month's work-day adjustment, apportioned to one half of the month. An
  // adjustment naming a `period` lands wholly there; one that names only the
  // month is split evenly, with any odd day going to the first period.
  function adjustmentDays(ym, periodId, index, count) {
    var list = (data.calendar && data.calendar.adjustments) || [];
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.month !== ym || !isOn(a)) continue;
      if (a.period) {
        if (a.period === periodId) total += a.days;
        continue;
      }
      var base = (a.days < 0 ? Math.ceil(a.days / count) : Math.floor(a.days / count));
      var rem = a.days - (base * count);
      total += base + (index === 0 ? rem : 0);
    }
    var knob = scenario.dayAdjust;
    if (knob) {
      var kBase = (knob < 0 ? Math.ceil(knob / count) : Math.floor(knob / count));
      total += kBase + (index === 0 ? knob - (kBase * count) : 0);
    }
    return total;
  }

  /* Every earning period of one calendar month, with the day the cash lands.
   * Net-20: the period closes, 20 days elapse, the first working day on or
   * after that is the Toptal payout, then one working day to reach Wise. */
  function periodsOf(y, m) {
    var anchor = mkDate(y, m, 1);
    var yy = anchor.getUTCFullYear();
    var mm = anchor.getUTCMonth();
    var cycle = payCycle();
    var defs = cycle.periods;
    var last = daysInMonth(yy, mm);
    var w = data.income.workday;
    var perDay = dayAmount(w, scenario.rateKnob);

    return defs.map(function (def, i) {
      var from = Math.min(def.fromDay, last);
      var to = def.toDay === 'end' ? last : Math.min(def.toDay, last);
      var start = mkDate(yy, mm, from);
      var end = mkDate(yy, mm, to);
      var ym = ymOf(start);
      var days = Math.max(0, weekdaysBetween(start, end) +
        adjustmentDays(ym, def.id, i, defs.length));
      var toptal = workingOnOrAfter(addDays(end, cycle.netDays || 0));
      var arrival = addWorkingDays(toptal, cycle.transferWorkingDays || 0);

      return {
        id: def.id,
        ym: ym,
        label: def.label || (from + '–' + to),
        rangeLabel: from + '–' + to + ' ' + MONTHS_SHORT[mm],
        start: start,
        end: end,
        days: days,
        perDay: perDay,
        grossEur: isOn(w) ? toEur(perDay * days, w.currency) : 0,
        toptal: toptal,
        arrival: arrival,
      };
    });
  }

  /* ----------------------------------------------------------------- debts */

  // Loans and other liabilities amortise identically; only the label and the
  // list they came from differ.
  function collectDebts() {
    var out = [];
    var firstPeriodId = payCycle().periods[0].id;

    function take(list, kind) {
      (list || []).forEach(function (d) {
        if (!isOn(d)) return;
        var cur = d.currency || 'EUR';
        // `payPeriod` is one period id, or several in preference order — the
        // instalment then comes off the earliest arriving pay that can cover
        // it, and off the last one regardless if none can.
        var installments = (d.installments && d.installments.length)
          ? d.installments.map(function (x) {
            var ids = x.payPeriod == null ? [firstPeriodId] : [].concat(x.payPeriod);
            return { periods: ids, native: x.amount, eur: toEur(x.amount, cur) };
          })
          : [{ periods: [firstPeriodId], native: d.monthlyPayment, eur: toEur(d.monthlyPayment, cur) }];
        var monthlyEur = installments.reduce(function (a, b) { return a + b.eur; }, 0);

        out.push({
          id: d.id,
          kind: kind,
          label: d.label,
          party: d.lender || d.creditor || '',
          currency: cur,
          annualRate: d.annualRate || 0,
          monthlyRate: (d.annualRate || 0) / 100 / 12,
          // A rate that changes partway — a promotional period, a reset —
          // is a list of {from, annualRate}; the month picks the last entry
          // that has already started.
          rateSchedule: (d.rateSchedule || []).map(function (r) {
            return {
              idx: ymToIndex(r.from),
              annualRate: r.annualRate || 0,
              monthlyRate: (r.annualRate || 0) / 100 / 12,
              note: r.note || '',
            };
          }).sort(function (a, b) { return a.idx - b.idx; }),
          principalEur: toEur(d.principal, cur),
          principalNative: d.principal,
          installments: installments,
          monthlyEur: monthlyEur,
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

  // The rate in force for a debt in a given month.
  function rateAt(d, idx) {
    var out = { annual: d.annualRate, monthly: d.monthlyRate };
    for (var i = 0; i < d.rateSchedule.length; i++) {
      if (d.rateSchedule[i].idx > idx) break;
      out = { annual: d.rateSchedule[i].annualRate, monthly: d.rateSchedule[i].monthlyRate };
    }
    return out;
  }

  /* ---------------------------------------------------------------- build */

  // Does a recurring/one-off extra-income entry land in this month?
  function hits(item, ym) {
    var cadence = item.cadence || 'monthly';
    var idx = ymToIndex(ym);
    if (item.startMonth && idx < ymToIndex(item.startMonth)) return false;
    if (item.endMonth && idx > ymToIndex(item.endMonth)) return false;
    if (cadence === 'monthly') return true;
    if (!item.month) return false;
    if (cadence === 'once') return item.month === ym;
    if (cadence === 'yearly') {
      var anchor = ymToIndex(item.month);
      return idx >= anchor && ((idx - anchor) % 12 === 0);
    }
    return false;
  }

  /* Walks the horizon month by month. Interest accrues at the top of each
   * month; every other movement is an event on a real date, applied in date
   * order so the running balance is what the account would actually show. */
  function build() {
    var horizon = scenario.horizon;
    var startY = parseInt(data.startYm.split('-')[0], 10);
    var startM = parseInt(data.startYm.split('-')[1], 10) - 1;

    var debts = collectDebts().map(function (d) {
      d.balance = d.principalEur;
      // `principal` is the balance where the projection opens, which may be a
      // couple of weeks back; this tracks it forward to today so the app can
      // report what is owed now rather than what was owed on the 1st.
      d.balanceToday = d.principalEur;
      d.paidOff = false;
      d.payoffDate = null;
      d.totalInterest = 0;
      d.stalled = false;
      d.months = [];
      d.rateNow = d.annualRate;
      return d;
    });
    var byPriority = debts.slice().sort(function (a, b) { return a.priority - b.priority; });

    var rows = [];
    var heldExpenses = [];    // unplanned expenses waiting for money to arrive
    var nextPaid = Object.create(null);   // "with the next pay" additions already placed

    /* The account opens at the start of the CURRENT pay cycle — the most
     * recent pay arrival on or before today, or the first of the start month
     * if none has landed yet. Everything before that has already happened and
     * is in `startingSavings`; the walk still runs it for the loan balances,
     * but nothing before the floor touches the cash. A one-off dated before
     * the floor is not history, though — it is money still to find, and rolls
     * forward to today. */
    var walkStart = mkDate(startY, startM, 1);
    var floor = walkStart;
    for (var fb = 0; fb <= 3; fb++) {
      periodsOf(startY, startM - fb).forEach(function (p) {
        var t = p.arrival.getTime();
        if (t <= today.getTime() && t > floor.getTime()) floor = p.arrival;
      });
    }
    var rollTo = today.getTime() > floor.getTime() ? today : floor;
    // The extra-expenses field on the cycle card belongs to the cycle it was
    // set in; once the next pay opens a new cycle it simply stops counting.
    var cycleExtraEur = cycleExtraFor(floor);
    var cumulative = data.meta.startingSavings || 0;
    var totals = { income: 0, loan: 0, interest: 0, budget: 0, extra: 0, saved: 0 };

    for (var i = 0; i < MAX_MONTHS; i++) {
      var monthDate = mkDate(startY, startM + i, 1);
      var ym = ymOf(monthDate);
      var idx = ymToIndex(ym);
      var k;

      // 1. Interest for the month, charged up front on the opening balance.
      var monthInterest = 0;
      for (k = 0; k < debts.length; k++) {
        var d = debts[k];
        d.monthRow = null;
        if (d.paidOff || idx < d.startIdx) continue;
        var opening = d.balance;
        var rate = rateAt(d, idx);
        var interest = opening * rate.monthly;
        if (monthDate.getTime() <= today.getTime()) d.rateNow = rate.annual;
        d.balance = opening + interest;
        d.totalInterest += interest;
        monthInterest += interest;
        if (monthDate.getTime() <= today.getTime()) d.balanceToday = d.balance;
        d.monthRow = {
          ym: ym, opening: opening, interest: interest,
          paid: 0, closing: opening + interest, payments: [],
        };
      }

      // 2. This month's events, on their real dates.
      var events = [];

      // The budget isn't charged on a fixed day — it takes whatever a pay has
      // left once that pay's instalments are met, so the draw events are added
      // after the pays below and their amounts settle during the walk.
      var budgetItems = (data.budget.budget || []).filter(function (it) {
        return isOn(it) && hits(it, ym);
      });
      var budgetTotal = scenario.budgetOverride != null
        ? scenario.budgetOverride
        : budgetItems.reduce(function (a, b) { return a + toEur(amountOf(b), b.currency); }, 0);
      var budgetLabel = budgetItems.length === 1 ? budgetItems[0].label : 'Monthly budget';

      // A committed extra names its month; an added one may repeat, so it
      // goes through the same cadence check as income.
      (data.extras.extras || []).concat(customCalendarItems('expense')).forEach(function (it) {
        if (!isOn(it) || !(it.cadence ? hits(it, ym) : it.month === ym)) return;
        var day = Math.min(it.day || 1, daysInMonth(monthDate.getUTCFullYear(),
          monthDate.getUTCMonth()));
        events.push({
          date: mkDate(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), day),
          kind: 'extra', label: it.label, detail: it.note || 'Unplanned',
          eur: -toEur(amountOf(it), it.currency),
          once: !it.cadence || it.cadence === 'once',
        });
      });

      if (cycleExtraEur > 0 && ym === ymOf(rollTo)) {
        events.push({
          date: rollTo, kind: 'extra', label: 'Extra expenses',
          detail: 'this cycle · set by you', eur: -cycleExtraEur, spentNow: true,
        });
      }

      (data.income.additional || []).concat(customCalendarItems('income')).forEach(function (it) {
        if (!isOn(it) || !hits(it, ym)) return;
        var day = Math.min(it.day || 1, daysInMonth(monthDate.getUTCFullYear(),
          monthDate.getUTCMonth()));
        events.push({
          date: mkDate(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), day),
          kind: 'income', label: it.label, detail: it.note || '',
          eur: toEur(amountOf(it), it.currency),
          once: it.cadence === 'once',
        });
      });

      // Pays land a month or so after the period closes, so look back a few
      // months and keep the ones whose money arrives inside this month.
      var arriving = [];
      for (var back = 0; back <= 3; back++) {
        var src = periodsOf(startY, startM + i - back);
        for (var pi = 0; pi < src.length; pi++) {
          if (ymOf(src[pi].arrival) === ym) arriving.push(src[pi]);
        }
      }
      arriving.sort(function (a, b) { return a.arrival - b.arrival; });

      arriving.forEach(function (per, payIdx) {
        events.push({
          date: per.arrival, kind: 'income', period: per,
          label: 'Pay · ' + per.rangeLabel,
          detail: per.days + ' days × ' + nativeMoney(per.perDay, data.income.workday.currency) +
            ' · Toptal ' + dateLabel(per.toptal) + ' → Wise ' + dateLabel(per.arrival),
          eur: per.grossEur,
        });
        // Additions hung off the pays: every pay from a date on, or only the
        // first one after it. Income joins the pay; an expense comes out of
        // it the same day, after the pay has landed.
        scenario.custom.forEach(function (c) {
          if (!isOn(c) || (c.when !== 'every-pay' && c.when !== 'next-pay')) return;
          if (per.arrival.getTime() < isoDate(c.from).getTime()) return;
          if (c.when === 'next-pay') {
            if (nextPaid[c.id]) return;
            nextPaid[c.id] = true;
          }
          var cEur = toEur(c.amount, c.currency);
          events.push({
            date: per.arrival, kind: c.kind === 'income' ? 'income' : 'extra', withPay: true,
            label: c.label, detail: 'with the ' + per.rangeLabel + ' pay · added by you',
            eur: c.kind === 'income' ? cEur : -cEur,
          });
        });
        // Instalments pinned to this one pay period. They go in before the
        // flexible ones so a flexible claim sees what is genuinely left.
        byPriority.forEach(function (t) {
          if (t.paidOff || idx < t.startIdx) return;
          t.installments.forEach(function (inst) {
            if (inst.periods.length !== 1 || inst.periods[0] !== per.id) return;
            events.push({
              date: per.arrival, kind: 'loan', debt: t, planned: inst.eur,
              label: t.label, detail: 'from ' + per.rangeLabel + ' pay', eur: 0,
            });
          });
        });
        if (scenario.extraToDebt > 0 && payIdx === 0) {
          events.push({
            date: per.arrival, kind: 'loan', debt: null, extraPool: scenario.extraToDebt,
            label: 'Extra to debt', detail: 'what-if top-up', eur: 0,
          });
        }
      });

      // A flexible instalment hangs one claim off every pay it may come from;
      // the walk settles it against the first that can afford it.
      byPriority.forEach(function (t) {
        if (t.paidOff || idx < t.startIdx) return;
        t.installments.forEach(function (inst) {
          if (inst.periods.length < 2) return;
          var cands = arriving.filter(function (per) {
            return inst.periods.indexOf(per.id) !== -1;
          });
          if (!cands.length) return;
          var claim = { settled: false };
          cands.forEach(function (per, ci) {
            events.push({
              date: per.arrival, kind: 'loan', debt: t, planned: inst.eur,
              claim: claim, lastChance: ci === cands.length - 1,
              label: t.label, detail: 'from ' + per.rangeLabel + ' pay', eur: 0,
            });
          });
        });
      });

      // One budget draw per pay, in pay order: the first takes what that pay
      // has left after its loans, and whatever it could not cover rolls to the
      // next pay. A month with no pay falls back to a fixed-day charge.
      if (budgetTotal > EPS) {
        var payEvents = events.filter(function (e) { return e.period; })
          .sort(function (a, b) { return a.date - b.date; });
        if (payEvents.length) {
          payEvents.forEach(function (pe, pIdx) {
            events.push({
              date: pe.date, kind: 'budget', budgetDraw: true,
              isLastPay: pIdx === payEvents.length - 1,
              label: budgetLabel, detail: 'what the ' + pe.period.rangeLabel +
                ' pay has left after loans',
              eur: 0,
            });
          });
        } else {
          var fallbackDay = Math.min((budgetItems[0] && budgetItems[0].chargeDay) || 1,
            daysInMonth(monthDate.getUTCFullYear(), monthDate.getUTCMonth()));
          events.push({
            date: mkDate(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), fallbackDay),
            kind: 'budget', label: budgetLabel, detail: 'no pay lands this month',
            eur: -budgetTotal,
          });
        }
      }

      // A one-off that was due before the cycle opened is still to be paid
      // (or received): it moves to today and says where it came from. Pays,
      // instalments, budget draws, a recurring item's earlier occurrence and
      // anything that rode on an earlier pay are history and stay put.
      events.forEach(function (e) {
        if (e.date.getTime() >= floor.getTime() || !e.once) return;
        e.detail = (e.detail ? e.detail + ' · ' : '') + 'was due ' + dateLabel(e.date);
        e.date = rollTo;
      });

      events.sort(function (a, b) {
        if (a.date.getTime() !== b.date.getTime()) return a.date - b.date;
        return (KIND_ORDER[a.kind] || KIND_LAST) - (KIND_ORDER[b.kind] || KIND_LAST);
      });

      // 3. Apply them in order, keeping a running account balance.
      var sums = { income: 0, loan: 0, budget: 0, extra: 0 };
      var payLeft = 0;          // what the pay being processed still holds
      var budgetLeft = budgetTotal;
      var applied = [];         // events that actually happened, in order

      // There is no overdraft: an unplanned expense cannot go out before the
      // money to cover it has landed. One that would push the balance under
      // zero waits in `heldExpenses` and is released once a pay has arrived
      // and that day's instalments and budget are done with — pay first, then
      // the expense. It carries across months for as long as it has to.
      function releaseHeld(atDate, force) {
        for (var q = 0; q < heldExpenses.length;) {
          var dv = heldExpenses[q];
          if (!force && cumulative + dv.eur < -EPS) { q++; continue; }
          heldExpenses.splice(q, 1);
          if (!dv.heldNote) {
            dv.detail = (dv.detail ? dv.detail + ' · ' : '') +
              'held from ' + dateLabel(dv.date) + ' until the money landed';
            dv.heldNote = true;
          }
          dv.date = atDate;
          cumulative += dv.eur;
          dv.balance = cumulative;
          sums.extra += -dv.eur;
          applied.push(dv);
        }
      }

      for (k = 0; k < events.length; k++) {
        // Everything on the previous date is settled, so anything waiting can
        // go out now — after that day's instalments and budget, never before.
        if (k > 0 && events[k].date.getTime() > events[k - 1].date.getTime()) {
          releaseHeld(events[k - 1].date, false);
        }
        var ev = events[k];

        if (ev.kind === 'income' && ev.period) payLeft = ev.eur;

        if (ev.kind === 'budget' && ev.budgetDraw) {
          // The last pay of the month clears the rest whether it can afford it
          // or not — the money still has to be spent.
          var draw = ev.isLastPay ? budgetLeft : Math.min(budgetLeft, Math.max(0, payLeft));
          if (draw <= EPS) continue;
          ev.eur = -draw;
          budgetLeft -= draw;
          payLeft -= draw;
        }

        if (ev.kind === 'loan' && ev.claim) {
          // Settled on an earlier pay, or this pay cannot cover it and another
          // one can — either way nothing happens here.
          if (ev.claim.settled) continue;
          var want = Math.min(ev.planned, ev.debt.balance);
          if (want <= EPS) { ev.claim.settled = true; continue; }
          if (payLeft < want - EPS && !ev.lastChance) continue;
          ev.claim.settled = true;
        }

        if (ev.kind === 'loan') {
          var pool = ev.extraPool || 0;
          if (ev.debt) {
            var target = ev.debt;
            var due = Math.min(ev.planned, target.balance);
            // A cleared loan's instalment is free money — it either rolls to
            // the next debt by priority, or falls through to savings.
            if (target.paidOff || target.balance <= EPS) {
              due = 0;
              if (scenario.rollover) pool += ev.planned;
            } else {
              target.balance -= due;
              if (ev.date.getTime() <= today.getTime()) target.balanceToday = target.balance;
              if (target.monthRow) {
                target.monthRow.paid += due;
                target.monthRow.closing = target.balance;
                target.monthRow.payments.push({ date: ev.date, eur: due });
              }
              if (ev.planned > due + EPS && scenario.rollover) pool += ev.planned - due;
              if (target.balance <= EPS) {
                target.balance = 0;
                target.paidOff = true;
                target.payoffDate = ev.date;
              }
            }
            ev.eur = -due;
          }

          // Cascade whatever is pooled down the priority list.
          if (pool > EPS) {
            var spent = 0;
            for (var q = 0; q < byPriority.length; q++) {
              var nx = byPriority[q];
              if (pool <= EPS) break;
              if (nx.paidOff || nx.balance <= EPS || idx < nx.startIdx) continue;
              var extra = Math.min(pool, nx.balance);
              nx.balance -= extra;
              if (ev.date.getTime() <= today.getTime()) nx.balanceToday = nx.balance;
              pool -= extra;
              spent += extra;
              if (nx.monthRow) {
                nx.monthRow.paid += extra;
                nx.monthRow.closing = nx.balance;
                nx.monthRow.payments.push({ date: ev.date, eur: extra, rolled: true });
              }
              if (nx.balance <= EPS) {
                nx.balance = 0;
                nx.paidOff = true;
                nx.payoffDate = ev.date;
              }
            }
            ev.eur -= spent;
            if (spent > 0 && !ev.debt) ev.detail = 'spread by priority';
          }
          if (ev.eur === 0 && !ev.debt) continue;
          if (ev.eur === 0 && ev.debt) { ev.detail = 'cleared — nothing due'; }
        }

        if (ev.kind === 'loan') payLeft += ev.eur;   // ev.eur is negative here

        // Before the cycle opened the money has already moved: the balances
        // above needed the event, the account does not.
        if (ev.date.getTime() < floor.getTime()) continue;

        // The cycle's own extra expenses are being spent now, so they show a
        // shortfall rather than wait for the next pay.
        if (ev.kind === 'extra' && !ev.spentNow && cumulative + ev.eur < -EPS) {
          heldExpenses.push(ev);
          continue;
        }

        cumulative += ev.eur;
        ev.balance = cumulative;
        applied.push(ev);
        if (ev.kind === 'income') sums.income += ev.eur;
        else if (ev.kind === 'loan') sums.loan += -ev.eur;
        else if (ev.kind === 'budget') sums.budget += -ev.eur;
        else sums.extra += -ev.eur;
      }

      if (events.length) releaseHeld(events[events.length - 1].date, false);

      // Nothing waits for ever. At the end of the visible window anything
      // still held goes out anyway, so the balance shows the shortfall rather
      // than quietly losing the expense.
      if (i === horizon - 1 && heldExpenses.length && events.length) {
        releaseHeld(events[events.length - 1].date, true);
      }

      for (k = 0; k < debts.length; k++) {
        if (!debts[k].monthRow) continue;
        var row = debts[k].monthRow;
        if (row.paid <= row.interest + EPS && row.closing >= row.opening - EPS) {
          debts[k].stalled = true;
        }
        debts[k].months.push(row);
        debts[k].monthRow = null;
      }

      if (i < horizon) {
        var outstanding = 0;
        for (k = 0; k < debts.length; k++) outstanding += debts[k].balance;
        var saved = sums.income - sums.loan - sums.budget - sums.extra;

        rows.push({
          ym: ym,
          events: applied,
          income: sums.income, loan: sums.loan, budget: sums.budget,
          extras: sums.extra, interest: monthInterest,
          saved: saved, cumulative: cumulative, outstanding: outstanding,
        });

        totals.income += sums.income;
        totals.loan += sums.loan;
        totals.budget += sums.budget;
        totals.extra += sums.extra;
        totals.interest += monthInterest;
        totals.saved += saved;
      }

      if (i === horizon - 1) {
        for (k = 0; k < debts.length; k++) debts[k].balanceAtHorizon = debts[k].balance;
      }

      var allPaid = debts.every(function (x) { return x.paidOff || x.stalled; });
      if (i >= horizon - 1 && allPaid) break;
    }

    var lastPayoff = null;
    debts.forEach(function (x) {
      if (!x.payoffDate) return;
      if (!lastPayoff || x.payoffDate > lastPayoff) lastPayoff = x.payoffDate;
    });

    // The current cycle, which the home view leads with: from the pay that
    // opened it (none if no pay has landed yet this month) up to the next
    // pay, exclusive. Its events are what the money in hand has to cover.
    var nextPay = null;
    var cyclePay = null;
    var cycleNext = null;
    var cycleEvents = [];
    rows.forEach(function (r) {
      r.events.forEach(function (e) {
        if (e.period) {
          if (!nextPay && e.date.getTime() >= today.getTime()) nextPay = e;
          if (e.date.getTime() === floor.getTime()) cyclePay = e;
          else if (!cycleNext && e.date.getTime() > floor.getTime()) cycleNext = e;
        }
      });
    });
    rows.forEach(function (r) {
      r.events.forEach(function (e) {
        var t = e.date.getTime();
        if (t >= floor.getTime() && (!cycleNext || t < cycleNext.date.getTime())) cycleEvents.push(e);
      });
    });

    return {
      cycle: { start: floor, pay: cyclePay, next: cycleNext, events: cycleEvents },
      rows: rows,
      debts: debts,
      byPriority: byPriority,
      totals: totals,
      openingDebt: debts.reduce(function (a, b) { return a + b.principalEur; }, 0),
      debtToday: debts.reduce(function (a, b) { return a + b.balanceToday; }, 0),
      monthlyDebt: debts.reduce(function (a, b) { return a + b.monthlyEur; }, 0),
      lastPayoff: lastPayoff,
      nextPay: nextPay,
    };
  }

  /* -------------------------------------------------------------- overview */

  function renderOverview() {
    var rows = model.rows;
    var n = rows.length || 1;
    // The hero is THIS month, not an average — an average over the horizon
    // quietly drops the instalments of loans that clear early.
    var now = rows[0];
    var nowOut = now.budget + now.loan + now.extras;
    var avgSaved = model.totals.saved / n;

    $('hero-saved').textContent = money(now.saved, { signed: true });
    $('hero-saved').className = 'hero-amount ' + (now.saved < 0 ? 'is-neg' : 'is-pos');
    $('hero-sub').textContent = ymLabel(now.ym, { long: true }) + ' · cash in and out · ' +
      payCountLabel(now);
    $('hero-income').textContent = money(now.income);
    $('hero-out').textContent = money(nowOut);
    $('hero-rate').textContent = now.income > 0
      ? Math.round((now.saved / now.income) * 100) + '%' : '—';

    var last = rows[rows.length - 1];
    var cards = [
      {
        label: 'Loan payments',
        value: money(model.monthlyDebt),
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
        value: money(model.debtToday),
        note: model.debts.length + ' ' + (model.debts.length === 1 ? 'debt' : 'debts') + ' tracked',
        tone: 'plain',
      },
      {
        label: 'Debt-free',
        value: model.lastPayoff ? dateLabel(model.lastPayoff, { full: true }) : '—',
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
    renderNextPays();
  }

  function payCountLabel(row) {
    var pays = row.events.filter(function (e) { return e.period; });
    if (!pays.length) return 'no pay lands this month';
    return pays.length + ' ' + (pays.length === 1 ? 'pay' : 'pays') + ' land';
  }

  function monthsAway(dt) {
    var d = Math.round((dt.getTime() - today.getTime()) / DAY_MS);
    if (d <= 0) return 'Already';
    if (d < 60) return d + ' days away';
    return Math.round(d / 30.44) + ' months away';
  }

  function renderPlan() {
    $('plan-note').textContent = scenario.rollover ? 'Freed payments roll over' : 'Rollover off';

    if (!model.byPriority.length) {
      $('plan-list').innerHTML = '<li class="plan-empty">No debts yet.</li>';
      return;
    }

    $('plan-list').innerHTML = model.byPriority.map(function (d, i) {
      var cleared = d.payoffDate;
      var note;
      if (d.stalled) note = 'instalment below the monthly interest';
      else if (!cleared) note = 'still running';
      else if (scenario.rollover) note = 'frees ' + money(d.monthlyEur) + '/mo for the next debt';
      else note = money(d.monthlyEur) + '/mo back to savings';

      return '<li class="plan-item">' +
        '<span class="plan-rank">' + (i + 1) + '</span>' +
        '<span class="plan-body">' +
          '<span class="plan-name">' + esc(d.label) + '</span>' +
          '<span class="plan-note">' + esc(note) + '</span>' +
        '</span>' +
        '<span class="plan-when' + (cleared ? '' : ' is-open') + '">' +
          (cleared ? esc(dateLabel(cleared, { full: true })) : '—') + '</span>' +
        '</li>';
    }).join('');
  }

  // The next few cash movements, whatever month they fall in.
  function renderNextPays() {
    var upcoming = [];
    for (var i = 0; i < model.rows.length && upcoming.length < 6; i++) {
      var evs = model.rows[i].events;
      for (var k = 0; k < evs.length && upcoming.length < 6; k++) {
        if (evs[k].date.getTime() >= today.getTime()) upcoming.push(evs[k]);
      }
    }
    if (!upcoming.length) {
      $('next-months').innerHTML = '<div class="empty-note">Nothing ahead in the window.</div>';
      return;
    }
    $('next-months').innerHTML = upcoming.map(function (e) {
      return '<div class="mini-row">' +
        '<span class="mini-month">' + esc(dateLabel(e.date)) + '</span>' +
        '<span class="mini-label">' + esc(e.label) + '</span>' +
        '<span class="mini-saved ' + (e.eur < 0 ? 'is-neg' : 'is-pos') + '">' +
          esc(money(e.eur, { signed: true })) + '</span>' +
        '</div>';
    }).join('');
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
    var head = '<tr><th>Month</th><th>In</th><th>Out</th><th>Saved</th><th>Savings</th></tr>';
    var body = model.rows.map(function (r) {
      return '<tr><td>' + esc(ymLabel(r.ym, { long: true })) + '</td>' +
        '<td>' + esc(money(r.income)) + '</td>' +
        '<td>' + esc(money(r.loan + r.budget + r.extras)) + '</td>' +
        '<td>' + esc(money(r.saved, { signed: true })) + '</td>' +
        '<td>' + esc(money(r.cumulative)) + '</td></tr>';
    }).join('');
    $('chart-table').innerHTML = '<table class="data-table">' + head + body + '</table>';
  }

  /* -------------------------------------------------------------- timeline */

  /* The timeline is the home view, so it leads with what is still ahead: the
   * next pay headlines it, and the list drops everything already behind you.
   * The floor is today rather than the pay date itself — an expense falling
   * between the two is still money you have to find, and hiding it would make
   * the running balance jump without explanation. The month it starts mid-way
   * through is totalled from what is left of it. */
  function renderTimeline() {
    // The list opens where the account does: at the pay that started the
    // current cycle, so the balance never jumps without a row explaining it.
    var from = model.cycle.start.getTime();
    renderNextPayCard();

    var blocks = [];
    model.rows.forEach(function (r) {
      var visible = r.events.filter(function (e) { return e.date.getTime() >= from; });
      if (!visible.length) return;
      // The month the cycle opens in is shown from the floor, not the 1st.
      var partial = r.ym === ymOf(model.cycle.start) && model.cycle.start.getUTCDate() > 1;
      var income = 0;
      var spent = 0;
      visible.forEach(function (e) {
        if (e.eur > 0) income += e.eur; else spent += -e.eur;
      });
      blocks.push({ row: r, visible: visible, partial: partial, income: income, spent: spent });
    });

    $('timeline-list').innerHTML = blocks.map(function (bl, i) {
      var r = bl.row;
      var saved = bl.income - bl.spent;
      var tone = saved < 0 ? 'is-neg' : 'is-pos';
      var evs = bl.visible.map(function (e) {
        var past = e.date.getTime() < today.getTime();
        return '<div class="tl-ev is-' + e.kind + (past ? ' is-past' : '') + '">' +
          '<span class="tl-date">' + esc(dateLabel(e.date)) + '</span>' +
          '<span class="tl-body">' +
            '<span class="tl-label">' + esc(e.label) + '</span>' +
            (e.detail ? '<span class="tl-detail">' + esc(e.detail) + '</span>' : '') +
          '</span>' +
          '<span class="tl-right">' +
            '<span class="tl-amt ' + (e.eur < 0 ? 'is-neg' : 'is-pos') + '">' +
              esc(money(e.eur, { signed: true })) + '</span>' +
            '<span class="tl-bal">' + esc(money(e.balance)) + '</span>' +
          '</span>' +
        '</div>';
      }).join('');

      return '<details class="mrow"' + (i < 2 ? ' open' : '') + '>' +
        '<summary class="mrow-head">' +
          '<span class="mrow-month">' +
            (bl.partial ? 'Rest of ' : '') + esc(ymLabel(r.ym, { long: true })) +
            '<span class="mrow-days">' + esc(money(bl.income)) + ' in · ' +
            esc(money(bl.spent)) + ' out</span></span>' +
          '<span class="mrow-right">' +
            '<span class="mrow-saved ' + tone + '">' + esc(money(saved, { signed: true })) + '</span>' +
            '<span class="mrow-cum">' + esc(money(r.cumulative)) + ' saved up</span>' +
          '</span>' +
        '</summary>' +
        '<div class="mrow-body">' + (evs || '<div class="empty-note">No movements.</div>') +
          '<div class="mrow-total"><span>Savings after</span><b>' +
            esc(money(r.cumulative)) + '</b></div>' +
        '</div>' +
      '</details>';
    }).join('');
  }

  /* The lead-in on the home view: THIS CYCLE, from the pay that opened it to
   * the next one, with the math written out — the pay, every other movement
   * in the window, and what is left at the end. The card's markup is static
   * so the budget field keeps focus across recomputes; only its contents are
   * refreshed. */
  function renderNextPayCard() {
    var card = $('next-pay');
    var cyc = model.cycle;
    var pay = cyc.pay;
    card.hidden = false;

    var lines = cyc.events.filter(function (e) { return e !== pay; });
    var left = cyc.events.reduce(function (a, e) { return a + e.eur; }, 0);
    var untilNext = cyc.next
      ? Math.round((cyc.next.date.getTime() - today.getTime()) / DAY_MS) : null;

    $('np-when').textContent = dateLabel(cyc.start, { full: true }) +
      (cyc.next ? ' → ' + dateLabel(cyc.next.date) : '') +
      (untilNext == null ? '' : untilNext <= 0 ? ' · next pay today'
        : ' · next pay in ' + untilNext + (untilNext === 1 ? ' day' : ' days'));
    $('np-saved').textContent = money(left, { signed: true });
    $('np-saved').classList.toggle('is-short', left < 0);
    $('np-sub').textContent = pay
      ? money(pay.eur) + ' in · ' + pay.period.days + ' days × ' +
        nativeMoney(pay.period.perDay, data.income.workday.currency) +
        ' · Toptal ' + dateLabel(pay.period.toptal) + ' → Wise ' + dateLabel(pay.date)
      : 'No pay has landed in this cycle yet' +
        (cyc.next ? ' — the next one is ' + dateLabel(cyc.next.date, { full: true }) : '') + '.';

    $('np-out').innerHTML =
      (pay ? '<span class="is-in"><i>' + esc(pay.label) + '</i>' +
        esc(money(pay.eur, { signed: true })) + '</span>' : '') +
      lines.map(function (e) {
        return '<span' + (e.eur > 0 ? ' class="is-in"' : '') + '><i>' + esc(e.label) +
          (e.date.getTime() !== cyc.start.getTime() ? ' <small>' + esc(dateLabel(e.date)) + '</small>' : '') +
          '</i>' + esc(money(e.eur, { signed: true })) + '</span>';
      }).join('') +
      '<span class="is-total"><i>Left at the end</i>' + esc(money(left, { signed: true })) + '</span>';

    syncBudgetField();
    syncExtraField();
  }

  // The budget field carries the display currency, so it is rewritten on a
  // currency switch — but never while the user is typing in it.
  function syncBudgetField() {
    var input = $('np-budget');
    if (document.activeElement === input) return;
    var eur = scenario.budgetOverride != null ? scenario.budgetOverride : defaults.budget;
    input.value = String(Math.round(fromEur(eur, currency)));
    input.step = String(currency === 'EUR' ? 10 : 500);
    $('np-cur').textContent = currency === 'EUR' ? '€' : 'ден';
    $('np-budget').setAttribute('aria-label',
      'Monthly budget allowance in ' + currency);
  }

  // The cycle's extra expenses: one amount, kept against the cycle's start so
  // it lapses by itself when the next pay lands.
  function cycleExtraFor(start) {
    var c = scenario.cycleExtra;
    return c && c.start === isoOf(start) ? c.eur : 0;
  }

  function setCycleExtra(eur) {
    scenario.cycleExtra = eur > 0 ? { start: isoOf(model.cycle.start), eur: eur } : null;
    recompute();
  }

  function syncExtraField() {
    var input = $('np-extra');
    if (document.activeElement === input) return;
    input.value = String(Math.round(fromEur(cycleExtraFor(model.cycle.start), currency)));
    input.step = String(currency === 'EUR' ? 10 : 500);
    $('np-extra-cur').textContent = currency === 'EUR' ? '€' : 'ден';
    input.setAttribute('aria-label', 'Extra expenses this cycle in ' + currency);
  }

  /* The stepper fields are plain text inputs with the numeric keypad rather
   * than type="number", which on iOS will not let the caret move inside the
   * digits. Anything that is not a digit is dropped as it is typed, and the
   * caret stays where the user put it. */
  function digitsOnly(input) {
    var v = input.value;
    var clean = v.replace(/\D+/g, '');
    if (clean === v) return;
    var caret = input.selectionStart == null ? clean.length
      : v.slice(0, input.selectionStart).replace(/\D+/g, '').length;
    input.value = clean;
    try { input.setSelectionRange(caret, caret); } catch (e) { /* not focused */ }
  }

  function nudgeExtra(dir) {
    setCycleExtra(Math.max(0, cycleExtraFor(model.cycle.start) + (dir * BUDGET_STEP_EUR)));
  }

  function nudgeBudget(dir) {
    var eur = scenario.budgetOverride != null ? scenario.budgetOverride : defaults.budget;
    scenario.budgetOverride = Math.max(0, eur + (dir * BUDGET_STEP_EUR));
    recompute();
  }

  /* ----------------------------------------------------------------- debts */

  function renderDebts() {
    var live = model.debts;
    var totalInterest = live.reduce(function (a, b) { return a + b.totalInterest; }, 0);

    $('debts-summary').innerHTML = '<div class="card summary-card">' +
      '<div class="sum-cell"><span>Owed now</span><b>' + esc(money(model.debtToday)) + '</b></div>' +
      '<div class="sum-cell"><span>Per month</span><b>' + esc(money(model.monthlyDebt)) + '</b></div>' +
      '<div class="sum-cell"><span>Interest total</span><b>' + esc(money(totalInterest)) + '</b></div>' +
      '<div class="sum-cell"><span>Debt-free</span><b>' +
        (model.lastPayoff ? esc(dateLabel(model.lastPayoff, { full: true })) : '—') + '</b></div>' +
      '</div>';

    if (!live.length) {
      $('debts-list').innerHTML = '<div class="empty-note">No debts in the data yet.</div>';
      return;
    }

    var horizonEnd = model.rows.length ? model.rows[model.rows.length - 1].ym : null;

    $('debts-list').innerHTML = model.byPriority.map(function (d) {
      var left = typeof d.balanceAtHorizon === 'number' ? d.balanceAtHorizon : d.balance;
      var pct = d.principalEur > 0
        ? Math.max(0, Math.min(100, ((d.principalEur - left) / d.principalEur) * 100)) : 100;

      var splits = d.installments.map(function (x) {
        return nativeMoney(x.native, d.currency) + ' from the ' +
          x.periods.map(periodLabel).join(' pay, else the ') + ' pay';
      }).join(' · ');

      var rowsHtml = d.months.map(function (s, i) {
        var dates = s.payments.map(function (p) { return dateLabel(p.date); }).join(', ');
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(ymLabel(s.ym)) + '</td>' +
          '<td>' + esc(dates || '—') + '</td>' +
          '<td>' + esc(money(s.paid)) + '</td>' +
          '<td>' + esc(money(s.interest)) + '</td>' +
          '<td>' + esc(money(s.paid - s.interest)) + '</td>' +
          '<td>' + esc(money(s.closing)) + '</td></tr>';
      }).join('');

      return '<div class="card debt-card">' +
        '<div class="debt-head">' +
          '<span class="debt-rank" title="Repayment priority">' + esc(String(d.priority)) + '</span>' +
          '<span class="debt-id">' +
            '<span class="debt-name">' + esc(d.label) + '</span>' +
            '<span class="debt-meta">' + esc(d.kind === 'loan' ? 'Loan' : 'Liability') +
              (d.party ? ' · ' + esc(d.party) : '') +
              ' · ' + (d.rateNow ? esc(d.rateNow + '% p.a.') : 'no interest') +
              (d.rateSchedule.length ? ' · ' + esc(rateScheduleLabel(d)) : '') +
              (d.sample ? ' · sample' : '') +
            '</span>' +
          '</span>' +
          '<span class="debt-bal">' + esc(money(d.balanceToday)) + '</span>' +
        '</div>' +
        '<div class="debt-splits">' + esc(splits) + '</div>' +
        '<div class="progress-cap"><span>' + Math.round(pct) + '% repaid by ' +
          (horizonEnd ? esc(ymLabel(horizonEnd)) : '—') + '</span><span>' +
          esc(money(left)) + ' left</span></div>' +
        '<div class="progress"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
        '<div class="debt-facts">' +
          '<span><i>Per month</i>' + esc(money(d.monthlyEur)) + '</span>' +
          '<span><i>Interest</i>' + esc(money(d.totalInterest)) + '</span>' +
          '<span><i>Cleared</i>' + (d.payoffDate ? esc(dateLabel(d.payoffDate, { full: true })) : '—') + '</span>' +
          '<span><i>Months</i>' + (d.payoffDate ? d.months.length : '—') + '</span>' +
        '</div>' +
        (d.stalled ? '<div class="warn">The instalments are smaller than the monthly ' +
          'interest — this balance never clears.</div>' : '') +
        '<details class="sched"><summary>Payment schedule</summary>' +
          '<div class="table-scroll"><table class="data-table">' +
          '<tr><th>#</th><th>Month</th><th>Paid on</th><th>Paid</th><th>Interest</th>' +
          '<th>Principal</th><th>Left</th></tr>' + rowsHtml + '</table></div>' +
        '</details>' +
      '</div>';
    }).join('');
  }

  // "then 7.5% from May 2027" — the next step in a debt's rate schedule.
  function rateScheduleLabel(d) {
    var nowIdx = ymToIndex(ymOf(today));
    for (var i = 0; i < d.rateSchedule.length; i++) {
      if (d.rateSchedule[i].idx > nowIdx) {
        return 'then ' + d.rateSchedule[i].annualRate + '% from ' +
          ymLabel(indexToYm(d.rateSchedule[i].idx), { long: true });
      }
    }
    return 'rate fixed from here';
  }

  function periodLabel(id) {
    var defs = payCycle().periods;
    for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i].label;
    return id;
  }

  /* ----------------------------------------------------------- investments */

  /* Each project pairs a cost basis with the loan that financed it. Anything
   * the loan side needs — what is still owed, what is left to pay — is read
   * off the same simulation the timeline runs on, so the two views can never
   * drift apart. */
  function investmentModel() {
    var pricePerM2 = scenario.pricePerM2 == null
      ? (data.investments.salePricePerM2 || 0) : scenario.pricePerM2;
    var cur = data.investments.currency || 'EUR';

    var projects = (data.investments.projects || []).map(function (pr) {
      var debt = null;
      for (var i = 0; i < model.debts.length; i++) {
        if (model.debts[i].id === pr.loanId) { debt = model.debts[i]; break; }
      }

      var costs = (pr.costs || []).filter(isOn).map(function (c) {
        return { label: c.label, eur: toEur(c.amount, c.currency || cur), instalments: isInstalmentCost(c) };
      });
      var cashIn = costs.reduce(function (a, b) { return a + b.eur; }, 0);
      // The instalment lines are the loan's history, not the down payment —
      // "Paid so far" sets interest against the two separately.
      var instalmentCosts = costs.reduce(function (a, b) { return a + (b.instalments ? b.eur : 0); }, 0);
      var downPayment = cashIn - instalmentCosts;

      var extras = (pr.saleExtras || []).filter(isOn).map(function (x) {
        return { label: x.label, eur: toEur(x.amount, x.currency || cur) };
      });
      var floorValue = toEur((pr.areaM2 || 0) * pricePerM2, cur);
      var saleValue = floorValue + extras.reduce(function (a, b) { return a + b.eur; }, 0);

      var owed = debt ? debt.balanceToday : 0;
      // Every instalment still ahead of us; the part of it that is not the
      // balance itself is interest yet to be paid. Instalments already made
      // this month are the start of "paid so far", below.
      var toPay = 0;
      var paidInSim = 0;
      if (debt) {
        debt.months.forEach(function (m) {
          m.payments.forEach(function (p) {
            if (p.date.getTime() > today.getTime()) toPay += p.eur;
            else paidInSim += p.eur;
          });
        });
      }

      var soFar = debt ? interestSoFar(pr.loanFacts, debt, owed, paidInSim, instalmentCosts) : null;

      return {
        id: pr.id,
        label: pr.label,
        kind: pr.kind || '',
        areaM2: pr.areaM2 || 0,
        facts: pr.loanFacts || null,
        debt: debt,
        costs: costs,
        cashIn: cashIn,
        downPayment: downPayment,
        extras: extras,
        pricePerM2: pricePerM2,
        floorValue: floorValue,
        saleValue: saleValue,
        owed: owed,
        toPay: toPay,
        interestLeft: Math.max(0, toPay - owed),
        soFar: soFar,
        equity: saleValue - owed,
        // Net profit: sell at the target, clear the loan off the proceeds, and
        // this is what is left over and above the cash already sunk in. It
        // settles the balance, not the whole remaining plan — the interest on
        // instalments you never make is not a cost of selling today.
        gain: saleValue - owed - cashIn,
        returnPct: cashIn > 0 ? (saleValue - owed - cashIn) / cashIn * 100 : null,
      };
    });

    var sum = function (key) {
      return projects.reduce(function (a, b) { return a + b[key]; }, 0);
    };
    var sumSoFar = function (key) {
      return projects.reduce(function (a, b) { return a + (b.soFar ? b.soFar[key] : 0); }, 0);
    };
    var cashIn = sum('cashIn');
    var gain = sum('gain');
    var withSoFar = projects.some(function (p) { return !!p.soFar; });
    return {
      pricePerM2: pricePerM2,
      projects: projects,
      cashIn: cashIn,
      saleValue: sum('saleValue'),
      owed: sum('owed'),
      toPay: sum('toPay'),
      equity: sum('equity'),
      gain: gain,
      returnPct: cashIn > 0 ? gain / cashIn * 100 : null,
      areaM2: sum('areaM2'),
      soFar: withSoFar ? {
        paid: sumSoFar('paid'),
        interest: sumSoFar('interest'),
        estimated: projects.some(function (p) { return p.soFar && p.soFar.estimated; }),
      } : null,
    };
  }

  /* What the loan has cost up to today. The bank's history is not in the data,
   * but two ends of it are: `loanFacts.originalPrincipal` (what was borrowed)
   * and the engine's balance today. Everything paid that did not reduce the
   * balance was interest — an identity, not a model:
   *
   *     interest so far = instalments paid so far − (borrowed − balance today)
   *
   * "Instalments paid so far" is the one thing that has to be counted:
   * `loanFacts.paidToDate` (native currency, from a statement) when the data
   * has it, otherwise one monthly instalment for every whole month between
   * disbursement and the forecast opening, plus whatever the simulation has
   * already paid this month. That estimate is flagged so the view can say so. */
  function interestSoFar(facts, debt, owed, paidInSim, instalmentCosts) {
    if (!facts || !(facts.originalPrincipal > 0)) return null;
    var cur = facts.currency || debt.currency;
    var borrowed = toEur(facts.originalPrincipal, cur);

    var paidBefore;
    var estimated = false;
    if (facts.paidToDate != null) {
      paidBefore = toEur(facts.paidToDate, cur);
    } else if (instalmentCosts > 0) {
      paidBefore = instalmentCosts;
    } else {
      var disbursed = ymLoose(facts.disbursedOn);
      if (!disbursed) return null;
      // First instalment falls the month after disbursement; the opening month
      // itself belongs to the simulation.
      var months = Math.max(0, ymToIndex(data.startYm) - ymToIndex(disbursed) - 1);
      paidBefore = months * debt.monthlyEur;
      estimated = true;
    }

    var paid = paidBefore + paidInSim;
    var principalRepaid = Math.max(0, borrowed - owed);
    var interest = Math.max(0, paid - principalRepaid);
    return {
      borrowed: borrowed,
      paid: paid,
      principalRepaid: principalRepaid,
      interest: interest,
      interestShare: paid > 0 ? interest / paid * 100 : null,
      estimated: estimated,
    };
  }

  // The month of a date written any of the ways the data has been written:
  // "2024-03-15", "2024-03", "15.03.2024", "15/03/2024", "21 May 2021",
  // "May 2021" → "2024-03" / "2021-05"; null when unreadable.
  function ymLoose(s) {
    if (!s) return null;
    var str = String(s).trim();
    var m = str.match(/^(\d{4})-(\d{2})/);
    if (m) return m[1] + '-' + m[2];
    m = str.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (m) return m[3] + '-' + pad2(parseInt(m[2], 10));
    m = str.match(/^(?:\d{1,2}\s+)?([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/);
    if (m) {
      var mi = MONTHS_SHORT.map(function (n) { return n.toLowerCase(); })
        .indexOf(m[1].toLowerCase());
      if (mi >= 0) return m[2] + '-' + pad2(mi + 1);
    }
    return null;
  }

  // A cost line that is really the instalments paid before the forecast
  // opened — "Instalments paid to Aug 2026" — carries the exact paid-so-far
  // figure. Flag it with kind: "instalments"; the label is the fallback.
  function isInstalmentCost(c) {
    return c.kind === 'instalments' || /instal/i.test(c.label || '');
  }

  // "+38%" alongside a profit figure; nothing when there is no cash basis.
  function returnTag(pct) {
    if (pct == null || !isFinite(pct)) return '';
    return '<span class="inv-pct">' + (pct > 0 ? '+' : '') +
      Math.round(pct) + '%</span>';
  }

  function renderInvestments() {
    var inv = investmentModel();
    syncPriceField(inv.pricePerM2);

    if (!inv.projects.length) {
      $('invest-summary').innerHTML = '';
      $('invest-list').innerHTML = '<div class="empty-note">No projects yet.</div>';
      return;
    }

    $('invest-summary').innerHTML = '<div class="card summary-card">' +
      '<div class="sum-cell"><span>Put in</span><b>' + esc(money(inv.cashIn)) + '</b></div>' +
      '<div class="sum-cell"><span>Still owed</span><b>' + esc(money(inv.owed)) + '</b></div>' +
      '<div class="sum-cell"><span>Worth at target</span><b>' + esc(money(inv.saleValue)) + '</b></div>' +
      '<div class="sum-cell"><span>Equity</span><b class="is-pos">' +
        esc(money(inv.equity)) + '</b></div>' +
      (inv.soFar ?
        '<div class="sum-cell"><span>Instalments so far' + (inv.soFar.estimated ? ' ≈' : '') +
          '</span><b>' + esc(money(inv.soFar.paid)) + '</b></div>' +
        '<div class="sum-cell"><span>Interest so far</span><b class="is-neg">' +
          esc(money(inv.soFar.interest)) + '</b></div>' : '') +
      '<div class="sum-net">' +
        '<span>Net profit if sold at target</span>' +
        '<b class="' + (inv.gain < 0 ? 'is-neg' : 'is-pos') + '">' +
          esc(money(inv.gain, { signed: true })) + returnTag(inv.returnPct) + '</b>' +
      '</div>' +
      '</div>';

    $('invest-list').innerHTML = inv.projects.map(function (p) {
      var costRows = p.costs.map(function (c) {
        return '<div class="inv-row"><span>' + esc(c.label) + '</span><b>' +
          esc(money(c.eur)) + '</b></div>';
      }).join('');
      var saleRows = '<div class="inv-row"><span>' + p.areaM2 + ' m² × ' +
          esc(money(p.pricePerM2)) + '</span><b>' + esc(money(p.floorValue)) + '</b></div>' +
        p.extras.map(function (x) {
          return '<div class="inv-row"><span>' + esc(x.label) + '</span><b>' +
            esc(money(x.eur)) + '</b></div>';
        }).join('');

      return '<div class="card inv-card">' +
        '<div class="debt-head">' +
          '<span class="debt-id">' +
            '<span class="debt-name">' + esc(p.label) + '</span>' +
            '<span class="debt-meta">' + esc(p.kind) + ' · ' + p.areaM2 + ' m²' +
              (p.debt ? ' · loan ' + esc(p.debt.label) : ' · no loan linked') + '</span>' +
          '</span>' +
          '<span class="debt-bal">' + esc(money(p.saleValue)) + '</span>' +
        '</div>' +

        (p.facts ? '<div class="inv-facts">Borrowed ' +
          esc(nativeMoney(p.facts.originalPrincipal, p.facts.currency)) +
          ' at ' + esc(String(p.facts.annualRate)) + '% · ' +
          esc(p.facts.disbursedOn) + ' → ' + esc(p.facts.termEnds) +
          (p.facts.note ? '<br>' + esc(p.facts.note) : '') + '</div>' : '') +

        '<div class="inv-block"><div class="inv-head">Put in so far</div>' +
          costRows +
          '<div class="inv-row is-total"><span>Total</span><b>' +
            esc(money(p.cashIn)) + '</b></div>' +
        '</div>' +

        '<div class="inv-block"><div class="inv-head">Owed on the loan</div>' +
          '<div class="inv-row"><span>Balance today</span><b>' + esc(money(p.owed)) + '</b></div>' +
          '<div class="inv-row"><span>Interest still to pay</span><b>' +
            esc(money(p.interestLeft)) + '</b></div>' +
          '<div class="inv-row is-total"><span>Left to pay in full</span><b>' +
            esc(money(p.toPay)) + '</b></div>' +
        '</div>' +

        (p.soFar ? '<div class="inv-block"><div class="inv-head">Paid so far</div>' +
          '<div class="inv-row"><span>Down payment and costs</span><b>' +
            esc(money(p.downPayment)) + '</b></div>' +
          '<div class="inv-row"><span>Instalments' +
            (p.facts && p.facts.disbursedOn ? ' since ' + esc(p.facts.disbursedOn) : '') +
            (p.soFar.estimated ? ' <em>≈ estimated</em>' : '') + '</span><b>' +
            esc(money(p.soFar.paid)) + '</b></div>' +
          '<div class="inv-row"><span>Of which came off the balance</span><b>' +
            esc(money(p.soFar.principalRepaid)) + '</b></div>' +
          '<div class="inv-row is-total is-net"><span>Interest paid</span><b class="is-neg">' +
            esc(money(p.soFar.interest)) + returnTag(p.soFar.interestShare) + '</b></div>' +
          '<div class="inv-row"><span>As a share of the down payment</span><b>' +
            (p.downPayment > 0 ? esc(Math.round(p.soFar.interest / p.downPayment * 100) + '%') : '—') +
            '</b></div>' +
        '</div>' : '') +

        '<div class="inv-block"><div class="inv-head">If sold at target</div>' +
          saleRows +
          '<div class="inv-row is-total"><span>Sale price</span><b>' +
            esc(money(p.saleValue)) + '</b></div>' +
          '<div class="inv-row"><span>Less the loan</span><b>' +
            esc(money(-p.owed, { signed: true })) + '</b></div>' +
          '<div class="inv-row is-total"><span>Cash out</span><b class="' +
            (p.equity < 0 ? 'is-neg' : 'is-pos') + '">' + esc(money(p.equity)) + '</b></div>' +
          '<div class="inv-row"><span>Less what you put in</span><b>' +
            esc(money(-p.cashIn, { signed: true })) + '</b></div>' +
          '<div class="inv-row is-total is-net"><span>Net profit</span><b class="' +
            (p.gain < 0 ? 'is-neg' : 'is-pos') + '">' +
            esc(money(p.gain, { signed: true })) + returnTag(p.returnPct) + '</b></div>' +
        '</div>' +
      '</div>';
    }).join('');

    $('invest-note').textContent = '"Put in" is the cash listed on each project — ' +
      'deposit, parking and the instalments paid up to the forecast. "Paid so far" ' +
      'reads interest off two known ends: what was borrowed and what is owed today — ' +
      'whatever was paid that did not come off the balance was interest. The ' +
      'instalment count is ≈ estimated as one a month since disbursement unless the ' +
      'loan facts carry a paidToDate figure from a statement. Net profit is ' +
      'the sale price less the loan balance and less that cash, i.e. selling at the ' +
      'target today and clearing the loan off the proceeds — the interest on ' +
      'instalments you never make is not counted against it, and neither is tax. ' +
      'What is left to pay is projected at today’s rate held flat, so it will not ' +
      'match the bank’s own plan, which carries its own assumptions about future rates.';
  }

  // Same treatment as the budget field: never rewritten mid-edit. The step is
  // held in EUR, so the arrows move the same real money in either currency.
  function syncPriceField(pricePerM2) {
    var input = $('inv-price');
    if (document.activeElement === input) return;
    input.value = String(Math.round(fromEur(pricePerM2, currency)));
    input.step = String(Math.round(fromEur(PRICE_STEP_EUR, currency)));
    $('inv-cur').textContent = (currency === 'EUR' ? '€' : 'ден') + ' / m²';
  }

  function nudgePrice(dir) {
    var eur = scenario.pricePerM2 == null
      ? (data.investments.salePricePerM2 || 0) : scenario.pricePerM2;
    scenario.pricePerM2 = Math.max(0, eur + (dir * PRICE_STEP_EUR));
    recompute();
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

  /* A row whose amount can be typed over — after a pay, say, when the real
   * figure is known. The committed figure stays in the note so the edit is
   * always visible, and ↺ puts it back. Typing must not toggle the row, so
   * the click handler skips anything inside .ledit. */
  function editableRow(item, sub) {
    var off = !isOn(item);
    var edited = scenario.amounts[item.id] != null;
    var cur = item.currency || 'EUR';
    return '<div class="lrow' + (off ? ' is-off' : '') + (edited ? ' is-edited' : '') +
        '" data-toggle="' + esc(item.id) + '">' +
      '<span class="lcheck" aria-hidden="true"></span>' +
      '<span class="lbody"><span class="lname">' + esc(item.label) +
        (item.sample ? '<span class="tag">sample</span>' : '') + '</span>' +
        '<span class="lnote">' + esc(sub) +
          (edited ? ' · was ' + esc(nativeMoney(item.amount, cur)) : '') + '</span></span>' +
      '<span class="lright ledit">' +
        (edited ? '<button class="lrevert" type="button" data-revert="' + esc(item.id) +
          '" aria-label="Back to the committed amount">↺</button>' : '') +
        '<input class="ledit-in" type="number" min="0" step="any" inputmode="decimal"' +
          ' data-amount="' + esc(item.id) + '" value="' + esc(String(amountOf(item))) +
          '" aria-label="' + esc(item.label) + ' amount in ' + esc(cur) + '">' +
        '<span class="ledit-cur">' + esc(curSymbol(cur)) + '</span>' +
      '</span>' +
      '</div>';
  }

  // The committed row behind an editable id, for telling an edit that merely
  // retypes the original from a real one.
  function editableItem(id) {
    var lists = [data.income.additional, data.budget.budget, data.extras.extras];
    for (var i = 0; i < lists.length; i++) {
      var list = lists[i] || [];
      for (var j = 0; j < list.length; j++) if (list[j].id === id) return list[j];
    }
    return null;
  }

  function customEntry(id) {
    for (var i = 0; i < scenario.custom.length; i++) {
      if (scenario.custom[i].id === id) return scenario.custom[i];
    }
    return null;
  }

  // A row the user added: its amount is the entry itself (no "was"), and ×
  // removes it. Toggling works like any other row, through scenario.off.
  function customRow(c) {
    var off = !isOn(c);
    var income = c.kind === 'income';
    return '<div class="lrow' + (off ? ' is-off' : '') + '" data-toggle="' + esc(c.id) + '">' +
      '<span class="lcheck" aria-hidden="true"></span>' +
      '<span class="lbody"><span class="lname">' + esc(c.label) +
        '<span class="tag ' + (income ? 'is-in' : 'is-out') + '">' + (income ? 'in' : 'out') + '</span></span>' +
        '<span class="lnote">' + esc(customWhenLabel(c)) + '</span></span>' +
      '<span class="lright ledit">' +
        '<input class="ledit-in" type="number" min="0" step="any" inputmode="decimal"' +
          ' data-custom-amount="' + esc(c.id) + '" value="' + esc(String(c.amount)) +
          '" aria-label="' + esc(c.label) + ' amount in ' + esc(c.currency) + '">' +
        '<span class="ledit-cur">' + esc(curSymbol(c.currency)) + '</span>' +
        '<button class="lremove" type="button" data-remove="' + esc(c.id) +
          '" aria-label="Remove ' + esc(c.label) + '">×</button>' +
      '</span>' +
      '</div>';
  }

  function renderLedger() {
    var w = data.income.workday;
    var cycle = payCycle();
    var cadenceNote = { monthly: 'every month', yearly: 'once a year', once: 'one-off' };

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
      return editableRow(it,
        (cadenceNote[it.cadence || 'monthly'] || '') +
        (it.month ? ' · from ' + ymLabel(it.month, { long: true }) : ''));
    });

    // The pay cycle is config, not a toggleable row — render it read-only.
    var next = periodsOf(today.getUTCFullYear(), today.getUTCMonth());
    var cycleHtml = '<div class="card"><div class="card-head">' +
      '<h2 class="card-title">Pay cycle</h2><span class="card-note">Net ' +
      esc(String(cycle.netDays)) + '</span></div>' +
      next.map(function (p) {
        return '<div class="lrow is-static">' +
          '<span class="lbody"><span class="lname">' + esc(p.rangeLabel) + '</span>' +
          '<span class="lnote">' + p.days + ' work days · Toptal ' + esc(dateLabel(p.toptal)) +
            ' → Wise ' + esc(dateLabel(p.arrival, { full: true })) + '</span></span>' +
          '<span class="lright">' + esc(money(p.grossEur)) + '</span></div>';
      }).join('') + '</div>';

    var debtItems = (data.loans.loans || []).map(function (m) {
      return { item: m, kind: 'Loan' };
    }).concat((data.liabilities.liabilities || []).map(function (l) {
      return { item: l, kind: 'Liability' };
    })).sort(function (a, b) {
      return (a.item.priority || 99) - (b.item.priority || 99);
    });

    var debtHtml = ledgerSection('Loans and liabilities', 'By repayment priority',
      debtItems, function (d) {
        var it = d.item;
        var cur = it.currency || 'EUR';
        var inst = (it.installments || []).map(function (x) {
          return nativeMoney(x.amount, cur) + ' (' +
            [].concat(x.payPeriod).map(periodLabel).join(' or ') + ')';
        }).join(' + ') || nativeMoney(it.monthlyPayment, cur);
        return ledgerRow(it, inst,
          'Priority ' + (it.priority || '—') + ' · ' + d.kind + ' · ' +
          nativeMoney(it.principal, cur) +
          (it.annualRate ? ' at ' + it.annualRate + '%' : ' at 0%'));
      });

    var budgetTotal = (data.budget.budget || []).reduce(function (a, b) {
      return a + (isOn(b) ? toEur(amountOf(b), b.currency) : 0);
    }, 0);
    var budgetHtml = ledgerSection('Fixed monthly budget', money(budgetTotal) + ' / month',
      data.budget.budget || [], function (it) {
        return editableRow(it,
          'taken from each pay after its loans' + (it.note ? ' · ' + it.note : ''));
      });

    var extrasHtml = ledgerSection('Unplanned expenses', 'Drawn from savings',
      data.extras.extras || [], function (it) {
        return editableRow(it,
          ymLabel(it.month, { long: true }) + (it.note ? ' · ' + it.note : ''));
      });

    var adjHtml = ledgerSection('Work day adjustments', 'Days off and extra days',
      (data.calendar && data.calendar.adjustments) || [], function (it, i) {
        var id = it.id || ('adj-' + it.month + '-' + i);
        it.id = id;
        return ledgerRow({ id: id, label: ymLabel(it.month, { long: true }), sample: it.sample },
          (it.days > 0 ? '+' : '') + it.days + ' days',
          (it.period ? periodLabel(it.period) + ' · ' : '') + (it.note || ''));
      });

    var customHtml = '<div class="card">' +
      '<div class="card-head"><h2 class="card-title">Your additions</h2>' +
      '<span class="card-note">' + (scenario.custom.length
        ? scenario.custom.length + ' kept in this browser' : 'Extra income you add') +
      '</span></div>' +
      (scenario.custom.length
        ? scenario.custom.map(customRow).join('')
        : '<div class="empty-note">Nothing added yet — use the button above.</div>') +
      '</div>';

    $('ledger-list').innerHTML = customHtml + incomeHtml + cycleHtml + debtHtml + budgetHtml +
      extrasHtml + adjHtml;
  }

  /* ----------------------------------------------------- remembered state */

  /* What is stored is the user's own overrides and nothing out of the vault:
   * the ids they ticked off, the figures they typed, the slider positions and
   * the currency. A slider the user never moved is stored as null rather than
   * as its current value, so when the committed data changes the untouched
   * knobs follow it instead of pinning the old default. Anything unreadable
   * falls back to the committed data rather than blocking the app. */
  function saveScenario() {
    var same = function (key) { return scenario[key] === defaults[key]; };
    writeStore(scenarioStore(), JSON.stringify({
      currency: currency,
      budgetOverride: scenario.budgetOverride,
      cycleExtra: scenario.cycleExtra,
      pricePerM2: scenario.pricePerM2,
      rateKnob: same('rateKnob') ? null : scenario.rateKnob,
      dayAdjust: scenario.dayAdjust,
      extraToDebt: scenario.extraToDebt,
      horizon: same('horizon') ? null : scenario.horizon,
      rollover: same('rollover') ? null : scenario.rollover,
      off: Object.keys(scenario.off),
      amounts: scenario.amounts,
      custom: scenario.custom,
    }));
  }

  function loadScenario() {
    var saved = null;
    try { saved = JSON.parse(readStore(scenarioStore()) || 'null'); } catch (e) { /* malformed */ }

    // The first version only remembered the ledger ticks, under its own key.
    if (!saved && !guest) {
      try {
        var ids = JSON.parse(readStore(LEGACY_OFF_STORE) || 'null');
        if (Array.isArray(ids)) saved = { off: ids };
      } catch (e) { /* malformed */ }
    }
    clearStore(LEGACY_OFF_STORE);
    if (!saved || typeof saved !== 'object') return;

    var num = function (v, lo, hi) {
      return (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi) ? v : null;
    };
    var v;
    if ((v = num(saved.budgetOverride, 0, Infinity)) != null) scenario.budgetOverride = v;
    if ((v = num(saved.pricePerM2, 0, Infinity)) != null) scenario.pricePerM2 = v;
    if (saved.cycleExtra && typeof saved.cycleExtra.start === 'string' &&
        (v = num(saved.cycleExtra.eur, 0, Infinity)) != null) {
      scenario.cycleExtra = { start: saved.cycleExtra.start, eur: v };
    }
    if ((v = num(saved.rateKnob, 0, Number($('sc-rate').max))) != null) scenario.rateKnob = v;
    if ((v = num(saved.dayAdjust, -6, 6)) != null) scenario.dayAdjust = v;
    if ((v = num(saved.extraToDebt, 0, 1000)) != null) scenario.extraToDebt = v;
    if ((v = num(saved.horizon, 6, 120)) != null) scenario.horizon = v;
    if (typeof saved.rollover === 'boolean') scenario.rollover = saved.rollover;
    if (Array.isArray(saved.off)) {
      saved.off.forEach(function (id) { if (typeof id === 'string') scenario.off[id] = true; });
    }
    if (saved.amounts && typeof saved.amounts === 'object') {
      Object.keys(saved.amounts).forEach(function (id) {
        var a = num(saved.amounts[id], 0, Infinity);
        if (a != null) scenario.amounts[id] = a;
      });
    }
    if (Array.isArray(saved.custom)) {
      var iso = /^\d{4}-\d{2}-\d{2}$/;
      saved.custom.forEach(function (c) {
        if (!c || typeof c.id !== 'string' || typeof c.label !== 'string') return;
        if (c.kind !== 'income' && c.kind !== 'expense') return;
        if (WHEN.indexOf(c.when) === -1) return;
        var a = num(c.amount, 0, Infinity);
        if (a == null) return;
        var payLinked = c.when === 'next-pay' || c.when === 'every-pay';
        if (payLinked ? !iso.test(c.from || '') : !iso.test(c.date || '')) return;
        scenario.custom.push({
          id: c.id, kind: c.kind, label: c.label.slice(0, 60), amount: a,
          currency: typeof c.currency === 'string' ? c.currency : 'EUR',
          when: c.when, from: payLinked ? c.from : undefined,
          date: payLinked ? undefined : c.date,
        });
      });
    }
    if (typeof saved.currency === 'string' &&
        document.querySelector('.cur-btn[data-cur="' + saved.currency + '"]')) {
      currency = saved.currency;
    }
  }

  /* Expenses used to be added on the Ledger too. They are the cycle card's
   * "Extra expenses" now, so any left in a saved scenario move there: the
   * one-offs due by the next pay are added to this cycle's figure, and the
   * rest (repeating or later ones) are dropped. Runs once, at boot. */
  function foldCustomExpenses() {
    var old = scenario.custom.filter(function (c) { return c.kind === 'expense'; });
    if (!old.length) return;
    scenario.custom = scenario.custom.filter(function (c) { return c.kind !== 'expense'; });
    var m = build();
    var by = m.cycle.next ? m.cycle.next.date.getTime() : Infinity;
    var eur = old.reduce(function (a, c) {
      if (!isOn(c)) return a;
      var due = c.when === 'next-pay' ||
        (c.when === 'date' && isoDate(c.date).getTime() < by);
      return due ? a + toEur(c.amount, c.currency) : a;
    }, 0);
    old.forEach(function (c) { delete scenario.off[c.id]; });
    if (eur > 0) {
      scenario.cycleExtra = { start: isoOf(m.cycle.start), eur: cycleExtraFor(m.cycle.start) + eur };
    }
  }

  function syncCurrencyButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('.cur-btn'), function (b) {
      var on = b.dataset.cur === currency;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ------------------------------------------------------------- scenario */

  function scenarioTouched() {
    return scenario.budgetOverride != null ||
      scenario.cycleExtra != null ||
      scenario.pricePerM2 != null ||
      scenario.rateKnob !== defaults.rateKnob ||
      scenario.dayAdjust !== 0 ||
      scenario.extraToDebt !== 0 ||
      scenario.horizon !== defaults.horizon ||
      scenario.rollover !== defaults.rollover ||
      Object.keys(scenario.off).length > 0 ||
      Object.keys(scenario.amounts).length > 0 ||
      scenario.custom.length > 0;
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
    else if (view === 'timeline') renderTimeline();
    else if (view === 'debts') renderDebts();
    else if (view === 'invest') renderInvestments();
    else renderLedger();
    renderFoot();
    syncScenarioUi();
    saveScenario();
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
      ' · cash basis, net ' + payCycle().netDays;

    var banner = $('banner');
    if (guest) {
      banner.hidden = false;
      banner.textContent = 'Guest mode — every number here is invented. ' +
        'Tap the lock to go back to the real thing.';
    } else if (samples > 0) {
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
      syncCurrencyButtons();
      recompute();
    });

    $('ledger-list').addEventListener('click', function (ev) {
      var remove = ev.target.closest('[data-remove]');
      if (remove) {
        var gone = customEntry(remove.dataset.remove);
        if (gone && window.confirm('Remove "' + gone.label + '" from the forecast?')) {
          scenario.custom = scenario.custom.filter(function (c) { return c !== gone; });
          delete scenario.off[gone.id];
          renderLedger();
          recompute();
        }
        return;
      }
      var revert = ev.target.closest('[data-revert]');
      if (revert) {
        delete scenario.amounts[revert.dataset.revert];
        renderLedger();
        recompute();
        return;
      }
      if (ev.target.closest('.ledit')) return;   // typing, not toggling
      var row = ev.target.closest('[data-toggle]');
      if (!row) return;
      var id = row.dataset.toggle;
      if (scenario.off[id]) delete scenario.off[id];
      else scenario.off[id] = true;
      renderLedger();
      recompute();
    });

    // While typing, the model and the store follow every keystroke but the
    // row is left alone so the field keeps focus; the ledger redraws once the
    // value is committed (blur or Enter), which also refreshes the section
    // totals.
    $('ledger-list').addEventListener('input', function (ev) {
      var inp = ev.target.closest('.ledit-in');
      if (!inp) return;
      var v = Number(inp.value);
      if (inp.value === '' || !isFinite(v) || v < 0) return;
      if (inp.dataset.customAmount) {
        var entry = customEntry(inp.dataset.customAmount);
        if (entry) { entry.amount = v; model = build(); saveScenario(); }
        return;
      }
      var id = inp.dataset.amount;
      var item = editableItem(id);
      if (item && v === item.amount) delete scenario.amounts[id];
      else scenario.amounts[id] = v;
      model = build();
      saveScenario();
    });
    $('ledger-list').addEventListener('change', function (ev) {
      if (!ev.target.closest('.ledit-in')) return;
      renderLedger();
      recompute();
    });

    $('lock-btn').addEventListener('click', lockApp);
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
    $('np-budget').addEventListener('input', function () {
      digitsOnly(this);
      var v = Number(this.value);
      if (this.value === '' || !isFinite(v) || v < 0) return;
      scenario.budgetOverride = toEur(v, currency);
      recompute();
    });
    $('np-budget').addEventListener('blur', syncBudgetField);
    $('np-extra').addEventListener('input', function () {
      digitsOnly(this);
      var v = Number(this.value);
      if (this.value === '' || !isFinite(v) || v < 0) return;
      setCycleExtra(toEur(v, currency));
    });
    $('np-extra').addEventListener('blur', syncExtraField);

    $('inv-price').addEventListener('input', function () {
      digitsOnly(this);
      var v = Number(this.value);
      if (this.value === '' || !isFinite(v) || v < 0) return;
      scenario.pricePerM2 = toEur(v, currency);
      recompute();
    });
    $('inv-price').addEventListener('blur', function () {
      syncPriceField(scenario.pricePerM2 == null
        ? (data.investments.salePricePerM2 || 0) : scenario.pricePerM2);
    });

    Array.prototype.forEach.call(document.querySelectorAll('.np-step'), function (btn) {
      btn.addEventListener('click', function () {
        var dir = Number(btn.dataset.step);
        if (btn.dataset.nudge === 'price') nudgePrice(dir);
        else if (btn.dataset.nudge === 'extra') nudgeExtra(dir);
        else nudgeBudget(dir);
      });
    });

    /* The add form lives in static markup above the ledger list, so a
     * re-render of the list never wipes what is being typed. */
    var addKind = 'income';   // expenses go on the cycle card, not here
    function showAddForm(open) {
      var form = $('custom-form');
      form.hidden = !open;
      $('custom-add').setAttribute('aria-expanded', open ? 'true' : 'false');
      $('custom-add').hidden = open;
      if (open) {
        $('add-date').value = isoOf(today);
        syncAddForm();
        setTimeout(function () { $('add-label').focus(); }, 40);
      }
    }
    function syncAddForm() {
      var when = $('add-when').value;
      var dated = when === 'date' || when === 'monthly';
      $('add-date-row').hidden = !dated;
      $('add-date-label').textContent = when === 'monthly' ? 'First on' : 'On';
      $('add-hint').textContent = {
        'next-pay': 'Lands the day the next pay does, once.',
        'date': 'Lands on that day, once.',
        'every-pay': 'With every pay from the next one on — until you remove it.',
        'monthly': 'First on the day you pick, then the same day every month.',
      }[when] || '';
    }
    $('custom-add').addEventListener('click', function () { showAddForm(true); });
    $('custom-cancel').addEventListener('click', function () { showAddForm(false); });
    $('add-when').addEventListener('change', syncAddForm);
    $('custom-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var label = $('add-label').value.trim();
      var amount = Number($('add-amount').value);
      var when = $('add-when').value;
      var dateStr = $('add-date').value;
      var problem = '';
      if (!label) problem = 'Give it a name.';
      else if (!(amount > 0)) problem = 'The amount has to be more than zero.';
      else if (WHEN.indexOf(when) === -1) problem = 'Pick when it happens.';
      else if ((when === 'date' || when === 'monthly') && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        problem = 'Pick a date.';
      }
      if (problem) { $('add-hint').textContent = problem; return; }
      var entry = { id: customId(), kind: addKind, label: label.slice(0, 60), amount: amount,
        currency: $('add-cur').value || 'EUR', when: when };
      if (when === 'next-pay' || when === 'every-pay') entry.from = isoOf(today);
      else entry.date = dateStr;
      scenario.custom.push(entry);
      $('add-label').value = '';
      $('add-amount').value = '';
      showAddForm(false);
      renderLedger();
      recompute();
    });

    $('sc-reset').addEventListener('click', function () {
      scenario.budgetOverride = null;
      scenario.cycleExtra = null;
      scenario.pricePerM2 = null;
      scenario.rateKnob = defaults.rateKnob;
      scenario.dayAdjust = 0;
      scenario.extraToDebt = 0;
      scenario.horizon = defaults.horizon;
      scenario.rollover = defaults.rollover;
      scenario.off = Object.create(null);
      scenario.amounts = Object.create(null);
      scenario.custom = [];
      renderLedger();
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

  /* ------------------------------------------------------------- the vault */

  /* The repo is public and the site is static, so anything the browser can
   * fetch anyone can fetch. The numbers therefore ship encrypted and are only
   * ever decrypted in the page. The derived key — not the passphrase — is
   * cached in localStorage so the passphrase is asked for once per device;
   * Lock throws that cache away immediately. */
  var KEY_STORE = 'forecast-key-v1';

  /* The secret is the passphrase and the PIN joined by a NUL, which neither
   * can contain — so the two halves can never run together ambiguously.
   * scripts/forecast-vault.mjs joins them exactly the same way; change one and
   * you must change the other or nothing opens. */
  function combineSecret(passphrase, pin) {
    return passphrase + '\u0000' + pin;
  }

  function b64ToBytes(s) {
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(bytes) {
    var s = '';
    var b = new Uint8Array(bytes);
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  function clearStore(key) {
    try { localStorage.removeItem(key); } catch (e) { /* private mode */ }
  }

  function fetchVault() {
    return fetch('data/vault.json', { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('vault.json → HTTP ' + res.status);
      return res.json();
    });
  }

  function deriveKey(vault, passphrase) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2',
      false, ['deriveKey']).then(function (material) {
      return crypto.subtle.deriveKey({
        name: 'PBKDF2',
        salt: b64ToBytes(vault.kdf.salt),
        iterations: vault.kdf.iterations,
        hash: vault.kdf.hash,
      }, material, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
    });
  }

  // v2 wraps a data key; v1 hung the content off the passphrase key itself.
  function contentKey(vault, kek) {
    if (!vault.wrappedKey) return Promise.resolve(kek);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(vault.wrappedKey.iv) },
      kek, b64ToBytes(vault.wrappedKey.ct)).then(function (raw) {
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    });
  }

  function openVault(vault, kek) {
    return contentKey(vault, kek).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(vault.iv) },
        key, b64ToBytes(vault.ct));
    }).then(function (plain) {
      return JSON.parse(new TextDecoder().decode(plain));
    });
  }

  function importCachedKey(raw) {
    return crypto.subtle.importKey('raw', b64ToBytes(raw), 'AES-GCM',
      true, ['decrypt']);
  }

  // Resolves with the decrypted bundle, asking for the passphrase only when
  // there is no working cached key.
  function unlockData(vault) {
    var cached = readStore(KEY_STORE);
    if (cached) {
      return importCachedKey(cached)
        .then(function (key) { return openVault(vault, key); })
        .catch(function () { clearStore(KEY_STORE); return promptUnlock(vault); });
    }
    return promptUnlock(vault);
  }

  function promptUnlock(vault) {
    return new Promise(function (resolve) {
      var splash = $('app-loading');
      if (splash) splash.classList.add('hidden');
      var gate = $('lock-screen');
      var input = $('lock-pass');
      var pinInput = $('lock-pin');
      var error = $('lock-error');
      gate.hidden = false;
      setTimeout(function () { input.focus(); }, 60);

      function attempt(ev) {
        ev.preventDefault();
        if (!input.value || !pinInput.value) {
          error.textContent = 'Both the passphrase and the PIN are needed.';
          return;
        }
        error.textContent = 'Unlocking…';
        deriveKey(vault, combineSecret(input.value, pinInput.value))
          .then(function (key) {
            return openVault(vault, key).then(function (bundle) {
              return crypto.subtle.exportKey('raw', key).then(function (raw) {
                writeStore(KEY_STORE, bytesToB64(raw));
                gate.hidden = true;
                input.value = '';
                pinInput.value = '';
                error.textContent = '';
                resolve(bundle);
              });
            });
          })
          .catch(function () {
            error.textContent = 'That passphrase did not open it.';
            input.select();
          });
      }

      $('lock-form').addEventListener('submit', attempt);

      $('lock-guest').addEventListener('click', function () {
        error.textContent = 'Loading the sample…';
        fetch('sample-data.json', { cache: 'no-store' })
          .then(function (res) {
            if (!res.ok) throw new Error('sample-data.json → HTTP ' + res.status);
            return res.json();
          })
          .then(function (bundle) {
            guest = true;
            $('lock-btn').setAttribute('aria-label', 'Leave guest mode');
            gate.hidden = true;
            error.textContent = '';
            resolve(bundle);
          })
          .catch(function (err) {
            error.textContent = 'Could not load the sample. ' + err.message;
          });
      });
    });
  }

  // In guest mode there is no key to forget; a reload is the way back to the
  // lock screen, and a real key cached on this device is left alone.
  function lockApp() {
    if (!guest) clearStore(KEY_STORE);
    location.reload();
  }

  /* Quit just leaves — the cached key and the remembered scenario stay, so the
   * next open lands straight back in the numbers. Forgetting is the lock
   * button's job. Inside the shell the parent closes the frame; standalone,
   * this is a plain link home. */
  function quitApp() {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) { /* no parent */ }
    } else {
      location.href = '../../';
    }
  }

  function load() {
    if (!window.crypto || !crypto.subtle) {
      return Promise.reject(new Error(
        'This browser has no Web Crypto, which the app needs to open the data. ' +
        'Note it is only available over https or on localhost.'));
    }
    return fetchVault().then(function (vault) {
      return unlockData(vault).then(function (bundle) {
        var out = {};
        DATA_FILES.forEach(function (name) { out[name] = bundle[name]; });
        return out;
      });
    });
  }

  // Both ways out are live before the data is — the lock screen has one too.
  $('quit-btn').addEventListener('click', quitApp);
  $('lock-quit').addEventListener('click', quitApp);

  load().then(function (loaded) {
    data = loaded;
    today = todayUtc();
    data.startYm = (!data.meta.startMonth || data.meta.startMonth === 'auto')
      ? ymOf(today) : data.meta.startMonth;

    var css = getComputedStyle(document.documentElement);
    COLOR_SAVINGS = (css.getPropertyValue('--viz-savings') || '').trim() || COLOR_SAVINGS;
    COLOR_DEBT = (css.getPropertyValue('--viz-debt') || '').trim() || COLOR_DEBT;

    var w = data.income.workday;
    defaults = {
      rateKnob: rateKnobOf(w),
      budget: (data.budget.budget || []).reduce(function (a, b) {
        return a + (b.active === false ? 0 : toEur(b.amount, b.currency));
      }, 0),
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

    // After the slider bounds, which the saved values are checked against.
    loadScenario();
    foldCustomExpenses();
    syncCurrencyButtons();

    bind();

    // The add form offers every currency the data quotes a rate for.
    var curs = ['EUR'].concat(Object.keys(data.meta.fixedRates || {}).filter(function (c) {
      return c !== 'EUR';
    }));
    $('add-cur').innerHTML = curs.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');

    renderLedger();
    recompute();

    var splash = $('app-loading');
    splash.classList.add('hidden');
    setTimeout(function () { splash.remove(); }, 420);
  }).catch(function (err) {
    fail('Could not load the forecast data. ' + err.message);
  });
}());

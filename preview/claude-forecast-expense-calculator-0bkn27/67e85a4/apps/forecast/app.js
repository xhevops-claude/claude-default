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

  var DATA_FILES = ['meta', 'income', 'loans', 'liabilities', 'budget', 'extras', 'calendar'];
  // Far enough to amortise anything realistic; the horizon slider only
  // controls how much of the run we render.
  var MAX_MONTHS = 720;
  var EPS = 0.005;
  var DAY_MS = 86400000;

  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  var COLOR_SAVINGS = '#2a78d6';
  var COLOR_DEBT = '#eb6834';

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

  // Session-only overrides. `off` holds ids the user has excluded.
  var scenario = {
    rateKnob: null,
    dayAdjust: 0,
    extraToDebt: 0,
    horizon: 36,
    rollover: false,
    off: Object.create(null),
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
        var installments = (d.installments && d.installments.length)
          ? d.installments.map(function (x) {
            return { periodId: x.payPeriod || firstPeriodId, native: x.amount, eur: toEur(x.amount, cur) };
          })
          : [{ periodId: firstPeriodId, native: d.monthlyPayment, eur: toEur(d.monthlyPayment, cur) }];
        var monthlyEur = installments.reduce(function (a, b) { return a + b.eur; }, 0);

        out.push({
          id: d.id,
          kind: kind,
          label: d.label,
          party: d.lender || d.creditor || '',
          currency: cur,
          annualRate: d.annualRate || 0,
          monthlyRate: (d.annualRate || 0) / 100 / 12,
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
      d.paidOff = false;
      d.payoffDate = null;
      d.totalInterest = 0;
      d.stalled = false;
      d.months = [];
      return d;
    });
    var byPriority = debts.slice().sort(function (a, b) { return a.priority - b.priority; });

    var rows = [];
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
        var interest = opening * d.monthlyRate;
        d.balance = opening + interest;
        d.totalInterest += interest;
        monthInterest += interest;
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
      var budgetTotal = budgetItems.reduce(function (a, b) {
        return a + toEur(b.amount, b.currency);
      }, 0);
      var budgetLabel = budgetItems.length === 1 ? budgetItems[0].label : 'Monthly budget';

      (data.extras.extras || []).forEach(function (it) {
        if (!isOn(it) || it.month !== ym) return;
        var day = Math.min(it.day || 1, daysInMonth(monthDate.getUTCFullYear(),
          monthDate.getUTCMonth()));
        events.push({
          date: mkDate(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), day),
          kind: 'extra', label: it.label, detail: it.note || 'Unplanned',
          eur: -toEur(it.amount, it.currency),
        });
      });

      (data.income.additional || []).forEach(function (it) {
        if (!isOn(it) || !hits(it, ym)) return;
        var day = Math.min(it.day || 1, daysInMonth(monthDate.getUTCFullYear(),
          monthDate.getUTCMonth()));
        events.push({
          date: mkDate(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), day),
          kind: 'income', label: it.label, detail: it.note || '',
          eur: toEur(it.amount, it.currency),
        });
      });

      // Pays land a month or so after the period closes, so look back a few
      // months and keep the ones whose money arrives inside this month.
      for (var back = 0; back <= 3; back++) {
        var src = periodsOf(startY, startM + i - back);
        for (var pi = 0; pi < src.length; pi++) {
          var per = src[pi];
          if (ymOf(per.arrival) !== ym) continue;
          events.push({
            date: per.arrival, kind: 'income', period: per,
            label: 'Pay · ' + per.rangeLabel,
            detail: per.days + ' days × ' + nativeMoney(per.perDay, data.income.workday.currency) +
              ' · Toptal ' + dateLabel(per.toptal) + ' → Wise ' + dateLabel(per.arrival),
            eur: per.grossEur,
          });
          // Every instalment tied to this pay period falls due when it lands.
          for (k = 0; k < byPriority.length; k++) {
            var t = byPriority[k];
            if (t.paidOff || idx < t.startIdx) continue;
            for (var ii = 0; ii < t.installments.length; ii++) {
              if (t.installments[ii].periodId !== per.id) continue;
              events.push({
                date: per.arrival, kind: 'loan', debt: t,
                planned: t.installments[ii].eur,
                label: t.label, detail: 'from ' + per.rangeLabel + ' pay', eur: 0,
              });
            }
          }
          if (scenario.extraToDebt > 0 && pi === 0) {
            events.push({
              date: per.arrival, kind: 'loan', debt: null, extraPool: scenario.extraToDebt,
              label: 'Extra to debt', detail: 'what-if top-up', eur: 0,
            });
          }
        }
      }

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
          var fallbackDay = Math.min(budgetItems[0].chargeDay || 1,
            daysInMonth(monthDate.getUTCFullYear(), monthDate.getUTCMonth()));
          events.push({
            date: mkDate(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), fallbackDay),
            kind: 'budget', label: budgetLabel, detail: 'no pay lands this month',
            eur: -budgetTotal,
          });
        }
      }

      events.sort(function (a, b) {
        if (a.date.getTime() !== b.date.getTime()) return a.date - b.date;
        return (KIND_ORDER[a.kind] || KIND_LAST) - (KIND_ORDER[b.kind] || KIND_LAST);
      });

      // 3. Apply them in order, keeping a running account balance.
      var sums = { income: 0, loan: 0, budget: 0, extra: 0 };
      var payLeft = 0;          // what the pay being processed still holds
      var budgetLeft = budgetTotal;

      for (k = 0; k < events.length; k++) {
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

        cumulative += ev.eur;
        ev.balance = cumulative;
        if (ev.kind === 'income') sums.income += ev.eur;
        else if (ev.kind === 'loan') sums.loan += -ev.eur;
        else if (ev.kind === 'budget') sums.budget += -ev.eur;
        else sums.extra += -ev.eur;
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
          events: events.filter(function (e) { return e.balance != null; }),
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

    // The pay the timeline opens on. The simulation still runs from the start
    // of the month so the bookkeeping behind it stays whole — this only marks
    // where the forward-looking view begins.
    var nextPay = null;
    for (var ri = 0; ri < rows.length && !nextPay; ri++) {
      for (var ei = 0; ei < rows[ri].events.length; ei++) {
        var e = rows[ri].events[ei];
        if (e.period && e.date.getTime() >= today.getTime()) { nextPay = e; break; }
      }
    }

    return {
      rows: rows,
      debts: debts,
      byPriority: byPriority,
      totals: totals,
      openingDebt: debts.reduce(function (a, b) { return a + b.principalEur; }, 0),
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
        value: money(model.openingDebt),
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

  /* The timeline is the home view, so it opens on the next pay rather than on
   * history — months already behind that point are dropped, and the month it
   * starts mid-way through is totalled from what is left of it. */
  function renderTimeline() {
    var from = model.nextPay ? model.nextPay.date.getTime() : today.getTime();
    renderNextPayCard(from);

    var blocks = [];
    model.rows.forEach(function (r) {
      var visible = r.events.filter(function (e) { return e.date.getTime() >= from; });
      if (!visible.length) return;
      var partial = visible.length < r.events.length;
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
          '<span class="mrow-saved ' + tone + '">' + esc(money(saved, { signed: true })) + '</span>' +
        '</summary>' +
        '<div class="mrow-body">' + (evs || '<div class="empty-note">No movements.</div>') +
          '<div class="mrow-total"><span>Savings after</span><b>' +
            esc(money(r.cumulative)) + '</b></div>' +
        '</div>' +
      '</details>';
    }).join('');
  }

  // The lead-in on the home view: when the next pay lands, how big it is, and
  // what comes straight back out of it.
  function renderNextPayCard(from) {
    var pay = model.nextPay;
    if (!pay) {
      $('next-pay').innerHTML = '';
      return;
    }
    var sameDay = [];
    model.rows.forEach(function (r) {
      r.events.forEach(function (e) {
        if (e !== pay && e.date.getTime() === pay.date.getTime() && e.eur < 0) sameDay.push(e);
      });
    });
    var takes = sameDay.reduce(function (a, b) { return a + -b.eur; }, 0);
    var days = Math.round((pay.date.getTime() - today.getTime()) / DAY_MS);

    $('next-pay').innerHTML = '<div class="nextpay">' +
      '<div class="nextpay-top">' +
        '<span class="nextpay-tag">Next payment</span>' +
        '<span class="nextpay-when">' + esc(dateLabel(pay.date, { full: true })) +
          ' · ' + (days <= 0 ? 'today' : 'in ' + days + (days === 1 ? ' day' : ' days')) +
        '</span>' +
      '</div>' +
      '<div class="nextpay-amount">' + esc(money(pay.eur, { signed: true })) + '</div>' +
      '<div class="nextpay-sub">' + esc(pay.label) + ' · Toptal ' +
        esc(dateLabel(pay.period.toptal)) + ' → Wise ' + esc(dateLabel(pay.date)) + '</div>' +
      (sameDay.length
        ? '<div class="nextpay-out">' + sameDay.map(function (e) {
          return '<span><i>' + esc(e.label) + '</i>' + esc(money(-e.eur)) + '</span>';
        }).join('') + '</div>' +
          '<div class="nextpay-left"><span>Left over</span><b>' +
            esc(money(pay.eur - takes)) + '</b></div>'
        : '') +
      '</div>';
  }

  /* ----------------------------------------------------------------- debts */

  function renderDebts() {
    var live = model.debts;
    var totalInterest = live.reduce(function (a, b) { return a + b.totalInterest; }, 0);

    $('debts-summary').innerHTML = '<div class="card summary-card">' +
      '<div class="sum-cell"><span>Owed now</span><b>' + esc(money(model.openingDebt)) + '</b></div>' +
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
        return nativeMoney(x.native, d.currency) + ' from the ' + periodLabel(x.periodId) + ' pay';
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
              ' · ' + (d.annualRate ? esc(d.annualRate + '% p.a.') : 'no interest') +
              (d.sample ? ' · sample' : '') +
            '</span>' +
          '</span>' +
          '<span class="debt-bal">' + esc(money(d.principalEur)) + '</span>' +
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

  function periodLabel(id) {
    var defs = payCycle().periods;
    for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i].label;
    return id;
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
      return ledgerRow(it, nativeMoney(it.amount, it.currency),
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
          return nativeMoney(x.amount, cur) + ' (' + periodLabel(x.payPeriod) + ')';
        }).join(' + ') || nativeMoney(it.monthlyPayment, cur);
        return ledgerRow(it, inst,
          'Priority ' + (it.priority || '—') + ' · ' + d.kind + ' · ' +
          nativeMoney(it.principal, cur) +
          (it.annualRate ? ' at ' + it.annualRate + '%' : ' at 0%'));
      });

    var budgetTotal = (data.budget.budget || []).reduce(function (a, b) {
      return a + (isOn(b) ? toEur(b.amount, b.currency) : 0);
    }, 0);
    var budgetHtml = ledgerSection('Fixed monthly budget', money(budgetTotal) + ' / month',
      data.budget.budget || [], function (it) {
        return ledgerRow(it, nativeMoney(it.amount, it.currency),
          'taken from each pay after its loans' + (it.note ? ' · ' + it.note : ''));
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
        return ledgerRow({ id: id, label: ymLabel(it.month, { long: true }), sample: it.sample },
          (it.days > 0 ? '+' : '') + it.days + ' days',
          (it.period ? periodLabel(it.period) + ' · ' : '') + (it.note || ''));
      });

    $('ledger-list').innerHTML = incomeHtml + cycleHtml + debtHtml + budgetHtml +
      extrasHtml + adjHtml;
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
    else if (view === 'timeline') renderTimeline();
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
      ' · cash basis, net ' + payCycle().netDays;

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
      renderLedger();
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
    today = todayUtc();
    data.startYm = (!data.meta.startMonth || data.meta.startMonth === 'auto')
      ? ymOf(today) : data.meta.startMonth;

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

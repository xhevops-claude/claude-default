(function () {
  'use strict';

  // The ledger is read-only in the browser: all writes happen through
  // Claude Code sessions that update data/expenses.json + files/ and push.
  const DATA_URL = 'data/expenses.json';
  const MIN_SPLASH_MS = 3000;
  const splashStart = performance.now();

  const $ = (id) => document.getElementById(id);

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---- State ----
  let data = null;
  let categoriesById = {};
  let reportType = 'daily';
  // Report cursor, always UTC. day drives daily/weekly; month/year the rest.
  const today = new Date();
  let cursor = {
    day: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())),
    month: today.getUTCMonth(), // 0-based
    year: today.getUTCFullYear(),
  };

  // ---- Currency ----
  // meta.fixedRates maps currency -> units per 1 EUR (MKD is pegged at 61.5).
  function toEUR(amount, currency) {
    if (currency === 'EUR') return amount;
    const rate = data.meta.fixedRates[currency];
    return rate ? amount / rate : null;
  }

  function fmtMoney(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: currency === 'MKD' ? 0 : 2,
        maximumFractionDigits: currency === 'MKD' ? 0 : 2,
      }).format(amount);
    } catch (_) {
      return amount.toLocaleString() + ' ' + currency;
    }
  }

  // Sums a list of expenses into { byCurrency: {EUR: n, ...}, eur: n|null }.
  // eur is the combined EUR equivalent, null if any currency has no rate.
  function sumUp(expenses) {
    const byCurrency = {};
    let eur = 0;
    let convertible = true;
    for (const e of expenses) {
      byCurrency[e.currency] = (byCurrency[e.currency] || 0) + e.amount;
      const v = toEUR(e.amount, e.currency);
      if (v === null) convertible = false;
      else eur += v;
    }
    return { byCurrency, eur: convertible ? eur : null };
  }

  function currencyOrder(byCurrency) {
    // EUR first, then the rest alphabetically — stable, predictable rows.
    return Object.keys(byCurrency).sort((a, b) => {
      if (a === 'EUR') return -1;
      if (b === 'EUR') return 1;
      return a.localeCompare(b);
    });
  }

  function totalsHtml(sums, big) {
    const rows = currencyOrder(sums.byCurrency).map((cur) => `
      <div class="total-row">
        <span class="cur cur-${escapeHTML(cur.toLowerCase())}">${escapeHTML(cur)}</span>
        <span class="amt">${escapeHTML(fmtMoney(sums.byCurrency[cur], cur))}</span>
      </div>
    `);
    if (!rows.length) return '<div class="empty">No expenses in this period.</div>';
    const multi = Object.keys(sums.byCurrency).length > 1;
    if (multi && sums.eur !== null) {
      rows.push(`
        <div class="total-row equiv">
          <span class="cur">combined ≈</span>
          <span class="amt">${escapeHTML(fmtMoney(sums.eur, 'EUR'))}</span>
        </div>
      `);
    }
    return `<div class="totals${big ? '' : ' totals-small'}">${rows.join('')}</div>`;
  }

  function sumsInlineHtml(sums) {
    const parts = currencyOrder(sums.byCurrency)
      .map((cur) => `<span class="sum">${escapeHTML(fmtMoney(sums.byCurrency[cur], cur))}</span>`);
    if (!parts.length) return '<span class="sum">—</span>';
    if (Object.keys(sums.byCurrency).length > 1 && sums.eur !== null) {
      parts.push(`<span class="sum-equiv">≈ ${escapeHTML(fmtMoney(sums.eur, 'EUR'))}</span>`);
    }
    return parts.join('');
  }

  // ---- Dates (stored ISO UTC, shown in the viewer's locale format) ----
  function dateOf(e) {
    return new Date(e.date + 'T00:00:00Z');
  }

  function fmtDate(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function fmtDayLong(d) {
    return d.toLocaleDateString(undefined, {
      timeZone: 'UTC', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function addDays(d, n) {
    const c = new Date(d);
    c.setUTCDate(c.getUTCDate() + n);
    return c;
  }

  // ISO-8601 week: Monday-first, week 1 holds the year's first Thursday.
  function isoWeekOf(d) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = (t.getUTCDay() + 6) % 7; // Mon = 0
    t.setUTCDate(t.getUTCDate() - day + 3); // shift to Thursday
    const year = t.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const week = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return { year, week };
  }

  function mondayOf(d) {
    const day = (d.getUTCDay() + 6) % 7;
    return addDays(d, -day);
  }

  function mondayOfIsoWeek(isoYear, week) {
    const jan4 = new Date(Date.UTC(isoYear, 0, 4));
    return addDays(mondayOf(jan4), (week - 1) * 7);
  }

  function weeksInIsoYear(y) {
    return isoWeekOf(new Date(Date.UTC(y, 11, 28))).week;
  }

  function monthName(year, month) {
    return new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
      timeZone: 'UTC', month: 'long', year: undefined,
    });
  }

  // ---- Expense rendering ----
  function fmtSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function expenseHtml(e) {
    const cat = categoriesById[e.category];
    const icon = cat ? cat.icon : '🧾';
    const catName = cat ? cat.name : e.category;

    let fields = '';
    if (cat && Array.isArray(cat.fields) && e.details) {
      const rows = cat.fields
        .filter((f) => e.details[f.key] !== undefined && e.details[f.key] !== '')
        .map((f) => `<dt>${escapeHTML(f.label)}</dt><dd>${escapeHTML(e.details[f.key])}</dd>`);
      if (rows.length) fields = `<dl class="exp-fields">${rows.join('')}</dl>`;
    }

    let files = '';
    if (Array.isArray(e.attachments) && e.attachments.length) {
      // Stored under a GUID; label + download name are the original
      // filename. Tapping the name previews, the arrow downloads.
      files = `<div class="exp-files">${e.attachments.map((a) => `
        <div class="exp-file-row">
          <a class="exp-file" href="${escapeHTML(a.file)}"
             data-name="${escapeHTML(a.originalName)}" data-mime="${escapeHTML(a.mime || '')}">
            <span aria-hidden="true">📎</span>
            <span class="fname">${escapeHTML(a.originalName)}</span>
            <span class="fsize">${escapeHTML(fmtSize(a.size))}</span>
          </a>
          <a class="exp-dl" href="${escapeHTML(a.file)}" download="${escapeHTML(a.originalName)}"
             aria-label="Download ${escapeHTML(a.originalName)}">⬇</a>
        </div>
      `).join('')}</div>`;
    }

    return `
      <div class="exp" data-id="${escapeHTML(e.id)}">
        <div class="exp-head">
          <span class="exp-icon" aria-hidden="true">${escapeHTML(icon)}</span>
          <div class="exp-main">
            <div class="exp-vendor">${escapeHTML(e.vendor)}</div>
            <div class="exp-sub">${escapeHTML(catName)}${e.description ? ' · ' + escapeHTML(e.description) : ''}</div>
          </div>
          <div class="exp-right">
            <div class="exp-amt">${escapeHTML(fmtMoney(e.amount, e.currency))}</div>
            <div class="exp-date">${escapeHTML(fmtDate(e.date))}</div>
          </div>
        </div>
        <div class="exp-detail">
          ${e.description ? `<p class="exp-desc">${escapeHTML(e.description)}</p>` : ''}
          ${fields}
          ${files}
        </div>
      </div>
    `;
  }

  function expenseListHtml(expenses) {
    if (!expenses.length) return '<div class="empty">No expenses in this period.</div>';
    return expenses.map(expenseHtml).join('');
  }

  // Newest first — the default everywhere outside reports.
  function newestFirst(expenses) {
    return expenses.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  // Oldest first — reports read chronologically.
  function oldestFirst(expenses) {
    return expenses.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // ---- Views ----
  function renderOverview() {
    $('grand-totals').innerHTML = totalsHtml(sumUp(data.expenses), true);

    const cats = data.categories.map((c) => {
      const items = data.expenses.filter((e) => e.category === c.id);
      return { cat: c, items };
    }).filter((x) => x.items.length);
    // Biggest category first, by EUR equivalent.
    cats.sort((a, b) => (sumUp(b.items).eur || 0) - (sumUp(a.items).eur || 0));

    $('category-breakdown').innerHTML = cats.length ? cats.map(({ cat, items }) => `
      <div class="cat-row">
        <span class="cat-icon" aria-hidden="true">${escapeHTML(cat.icon)}</span>
        <div>
          <div class="cat-name">${escapeHTML(cat.name)}</div>
          <div class="cat-count">${items.length} expense${items.length === 1 ? '' : 's'}</div>
        </div>
        <div class="cat-sums">${sumsInlineHtml(sumUp(items))}</div>
      </div>
    `).join('') : '<div class="empty">Nothing yet.</div>';

    $('recent-list').innerHTML = expenseListHtml(newestFirst(data.expenses).slice(0, 5));
  }

  function renderExpenses() {
    const list = newestFirst(data.expenses);
    $('expense-count').textContent = list.length + ' total';
    $('expense-list').innerHTML = expenseListHtml(list);
  }

  // ---- Reports ----
  function inRange(e, from, to) { // [from, to) as ISO date strings
    return e.date >= from && e.date < to;
  }

  function reportRange() {
    switch (reportType) {
      case 'daily': {
        const from = isoDate(cursor.day);
        return { from, to: isoDate(addDays(cursor.day, 1)), label: fmtDayLong(cursor.day) };
      }
      case 'weekly': {
        const mon = mondayOf(cursor.day);
        const { year, week } = isoWeekOf(mon);
        return {
          from: isoDate(mon),
          to: isoDate(addDays(mon, 7)),
          label: `W${week} ${year} · ${fmtDate(isoDate(mon))} – ${fmtDate(isoDate(addDays(mon, 6)))}`,
        };
      }
      case 'monthly': {
        const from = new Date(Date.UTC(cursor.year, cursor.month, 1));
        const to = new Date(Date.UTC(cursor.year, cursor.month + 1, 1));
        return { from: isoDate(from), to: isoDate(to), label: `${monthName(cursor.year, cursor.month)} ${cursor.year}` };
      }
      default: { // annual, year-months, year-weeks
        return {
          from: `${cursor.year}-01-01`,
          to: `${cursor.year + 1}-01-01`,
          label: String(cursor.year),
        };
      }
    }
  }

  function movePeriod(dir) {
    switch (reportType) {
      case 'daily': cursor.day = addDays(cursor.day, dir); break;
      case 'weekly': cursor.day = addDays(cursor.day, dir * 7); break;
      case 'monthly': {
        const m = cursor.month + dir;
        cursor.year += Math.floor(m / 12);
        cursor.month = ((m % 12) + 12) % 12;
        break;
      }
      default: cursor.year += dir;
    }
    renderReport();
  }

  function periodRowsHtml(rows) {
    // rows: { name, expenses, onclickAttr }
    return `<div class="period-rows">${rows.map((r) => {
      const has = r.expenses.length > 0;
      return `
        <button type="button" class="period-row${has ? '' : ' empty-period'}" ${has ? r.attr : 'disabled'}>
          <span class="p-name">${escapeHTML(r.name)}</span>
          <span class="p-count">${has ? r.expenses.length + ' exp.' : ''}</span>
          <span class="p-sums">${has ? sumsInlineHtml(sumUp(r.expenses)) : '<span class="sum">—</span>'}</span>
        </button>
      `;
    }).join('')}</div>`;
  }

  function renderReport() {
    const range = reportRange();
    $('period-label').textContent = range.label;

    const inPeriod = data.expenses.filter((e) => inRange(e, range.from, range.to));
    const body = $('report-body');
    const totals = `<div class="report-totals">${totalsHtml(sumUp(inPeriod))}</div>`;

    if (reportType === 'year-months') {
      // Reports read chronologically: January first.
      const rows = [];
      for (let m = 0; m < 12; m++) {
        const from = isoDate(new Date(Date.UTC(cursor.year, m, 1)));
        const to = isoDate(new Date(Date.UTC(cursor.year, m + 1, 1)));
        rows.push({
          name: monthName(cursor.year, m),
          expenses: inPeriod.filter((e) => inRange(e, from, to)),
          attr: `data-goto="monthly" data-year="${cursor.year}" data-month="${m}"`,
        });
      }
      body.innerHTML = totals + periodRowsHtml(rows);
      return;
    }

    if (reportType === 'year-weeks') {
      // ISO weeks: W1 can start in December, W52/53 can end in January —
      // bucket by each expense's ISO week-year, listed W1 first.
      const n = weeksInIsoYear(cursor.year);
      const byWeek = {};
      for (const e of data.expenses) {
        const { year, week } = isoWeekOf(dateOf(e));
        if (year === cursor.year) (byWeek[week] = byWeek[week] || []).push(e);
      }
      const rows = [];
      for (let w = 1; w <= n; w++) {
        const mon = mondayOfIsoWeek(cursor.year, w);
        rows.push({
          name: `W${w} · ${fmtDate(isoDate(mon))}`,
          expenses: byWeek[w] || [],
          attr: `data-goto="weekly" data-day="${isoDate(mon)}"`,
        });
      }
      body.innerHTML = totals + periodRowsHtml(rows);
      return;
    }

    // daily / weekly / monthly / annual: totals + chronological list.
    body.innerHTML = totals
      + (inPeriod.length ? '<div class="report-section-title">Expenses, oldest first</div>' : '')
      + `<div class="expense-list">${inPeriod.length ? expenseListHtml(oldestFirst(inPeriod)) : ''}</div>`;
  }

  // ---- Wiring ----
  function setView(view) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.toggle('active', v.id === 'view-' + view);
    });
  }

  $('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) setView(tab.dataset.view);
  });

  $('report-types').addEventListener('click', (e) => {
    const btn = e.target.closest('.rtype');
    if (!btn) return;
    reportType = btn.dataset.rtype;
    document.querySelectorAll('.rtype').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    renderReport();
  });

  $('period-prev').addEventListener('click', () => movePeriod(-1));
  $('period-next').addEventListener('click', () => movePeriod(1));

  // Drill-down from year÷months / year÷weeks rows into that period.
  $('report-body').addEventListener('click', (e) => {
    const row = e.target.closest('.period-row[data-goto]');
    if (!row) return;
    reportType = row.dataset.goto;
    if (row.dataset.day) cursor.day = new Date(row.dataset.day + 'T00:00:00Z');
    if (row.dataset.year) cursor.year = Number(row.dataset.year);
    if (row.dataset.month) cursor.month = Number(row.dataset.month);
    document.querySelectorAll('.rtype').forEach((b) => {
      b.classList.toggle('active', b.dataset.rtype === reportType);
    });
    renderReport();
  });

  // Expand / collapse expense rows (skip clicks on attachment links).
  document.addEventListener('click', (e) => {
    if (e.target.closest('.exp-file-row')) return;
    const head = e.target.closest('.exp-head');
    if (head) head.parentElement.classList.toggle('open');
  });

  // ---- Attachment preview lightbox ----
  const lightbox = $('lightbox');

  function previewKind(mime, file) {
    const m = (mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m === 'application/pdf') return 'pdf';
    const ext = (file.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].indexOf(ext) !== -1) return 'image';
    if (ext === 'pdf') return 'pdf';
    return null;
  }

  function openLightbox(file, name, mime) {
    const kind = previewKind(mime, file);
    const dl = $('lb-download');
    $('lb-name').textContent = name;
    dl.href = file;
    dl.setAttribute('download', name);
    if (kind === 'image') {
      $('lb-body').innerHTML = `<img src="${escapeHTML(file)}" alt="${escapeHTML(name)}">`;
    } else if (kind === 'pdf') {
      $('lb-body').innerHTML = `<iframe src="${escapeHTML(file)}" title="${escapeHTML(name)}"></iframe>`;
    } else {
      $('lb-body').innerHTML = '<div class="lb-fallback">No inline preview for this file type — use Download.</div>';
    }
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.hidden = true;
    $('lb-body').innerHTML = '';
    document.body.style.overflow = '';
  }

  document.addEventListener('click', (e) => {
    const open = e.target.closest('.exp-file');
    if (!open) return;
    e.preventDefault();
    openLightbox(open.getAttribute('href'), open.dataset.name, open.dataset.mime);
  });

  $('lb-close').addEventListener('click', closeLightbox);
  lightbox.querySelector('.lb-backdrop').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });

  $('quit').addEventListener('click', () => {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else {
      location.href = '../../';
    }
  });

  function hideSplash() {
    const wait = Math.max(0, MIN_SPLASH_MS - (performance.now() - splashStart));
    setTimeout(() => {
      const splash = $('app-loading');
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 500);
    }, wait);
  }

  async function load() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
      categoriesById = {};
      for (const c of data.categories) categoriesById[c.id] = c;

      $('project-name').textContent = data.meta.project || '';
      $('foot-note').textContent =
        `${data.expenses.length} expenses · updated via Claude Code sessions · MKD pegged at ${data.meta.fixedRates.MKD} per EUR`;

      renderOverview();
      renderExpenses();
      renderReport();
    } catch (err) {
      const banner = $('banner');
      banner.hidden = false;
      banner.textContent = 'Could not load the ledger (' + err.message + ').';
    }
    hideSplash();
  }

  load();
})();

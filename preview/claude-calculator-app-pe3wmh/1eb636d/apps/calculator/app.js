(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Immediate-execution calculator (the phone/desk kind, not an expression
  // parser): one pending operator at a time, `=` repeats the last operation,
  // and every completed calculation is pushed onto a persisted tape.
  // ---------------------------------------------------------------------------

  const MAX_DIGITS = 14;          // digits accepted while typing an entry
  const HISTORY_KEY = 'calc-tape';
  const HISTORY_MAX = 60;

  const OP_SIGN = { '+': '+', '-': '−', '*': '×', '/': '÷' };

  const els = {
    screen: document.querySelector('.screen'),
    expr: document.getElementById('expr'),
    value: document.getElementById('value'),
    keys: document.getElementById('keys'),
    clearKey: document.getElementById('clear-key'),
    tape: document.getElementById('tape'),
    tapeList: document.getElementById('tape-list'),
    tapeEmpty: document.getElementById('tape-empty'),
    tapeToggle: document.getElementById('tape-toggle'),
    tapeClose: document.getElementById('tape-close'),
    tapeClear: document.getElementById('tape-clear'),
    quit: document.getElementById('quit'),
  };

  // entry   — the digits currently being typed ('0' when fresh)
  // acc     — the left-hand value of a pending operation
  // op      — the pending operator, or null
  // fresh   — true when the next digit starts a new entry
  // repeat  — {op, operand} so a bare `=` can be pressed again
  // error   — a message string while the display is in the error state
  const st = {
    entry: '0',
    acc: null,
    op: null,
    fresh: true,
    repeat: null,
    error: null,
  };

  let history = loadHistory();

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  // Trim the binary noise off a computed value (0.1 + 0.2 → 0.3) without
  // touching exact integers, whose digits would be lost to rounding.
  function sanitize(n) {
    if (!isFinite(n) || Number.isInteger(n)) return n;
    return Number(n.toPrecision(13));
  }

  function format(n) {
    if (!isFinite(n)) return 'Infinity';
    if (Object.is(n, -0)) n = 0;

    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
      // Out of comfortable fixed range — fall back to exponent form.
      return n.toExponential(6).replace(/\.?0+e/, 'e').replace('-', '−');
    }

    const [int, frac] = String(sanitize(n)).split('.');
    const grouped = Number(int).toLocaleString('en-US', { maximumFractionDigits: 0 });
    return (frac ? grouped + '.' + frac : grouped).replace('-', '−');
  }

  // What the display shows: the raw entry while typing (so a trailing '.' or
  // '-0' survives), grouped for readability. Settled values — results, and
  // anything in exponent form — go through format() instead.
  function displayEntry() {
    if (st.fresh || st.entry.indexOf('e') !== -1) return format(entryValue());
    const neg = st.entry.startsWith('-');
    const body = neg ? st.entry.slice(1) : st.entry;
    const [int, frac] = body.split('.');
    const grouped = Number(int || '0').toLocaleString('en-US', { maximumFractionDigits: 0 });
    let out = grouped;
    if (body.indexOf('.') !== -1) out += '.' + (frac || '');
    return (neg ? '−' : '') + out;
  }

  function entryValue() {
    const n = parseFloat(st.entry);
    return isFinite(n) ? n : 0;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function render() {
    if (st.error) {
      els.screen.classList.add('error');
      els.value.textContent = st.error;
      els.expr.innerHTML = '&nbsp;';
    } else {
      els.screen.classList.remove('error');
      els.value.textContent = displayEntry();
      const parts = [];
      if (st.acc !== null && st.op) parts.push(format(st.acc), OP_SIGN[st.op]);
      els.expr.textContent = parts.length ? parts.join(' ') : ' ';
    }

    els.clearKey.textContent =
      (st.entry === '0' && st.fresh && st.acc === null && !st.error) ? 'AC' : 'C';

    els.keys.querySelectorAll('.key.op').forEach((k) => {
      k.classList.toggle('armed', st.op === k.dataset.key && st.fresh && !st.error);
    });

    fitValue();
  }

  // Shrink the readout until it fits rather than letting it clip.
  function fitValue() {
    const el = els.value;
    el.style.fontSize = '';
    if (st.error) return;
    const base = parseFloat(getComputedStyle(el).fontSize);
    let size = base;
    while (el.scrollWidth > el.clientWidth && size > 14) {
      size -= 2;
      el.style.fontSize = size + 'px';
    }
  }

  // ---------------------------------------------------------------------------
  // Engine
  // ---------------------------------------------------------------------------

  function compute(a, b, op) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? null : a / b;
      default: return b;
    }
  }

  function fail(msg) {
    st.error = msg;
    st.entry = '0';
    st.acc = null;
    st.op = null;
    st.fresh = true;
    st.repeat = null;
  }

  function clearError() {
    if (!st.error) return false;
    st.error = null;
    return true;
  }

  function inputDigit(d) {
    clearError();
    if (st.fresh) {
      st.entry = d === '.' ? '0.' : d;
      st.fresh = false;
      return;
    }
    if (d === '.') {
      if (st.entry.indexOf('.') === -1) st.entry += '.';
      return;
    }
    if (st.entry === '0') st.entry = d;
    else if (st.entry === '-0') st.entry = '-' + d;
    else if (st.entry.replace(/[-.]/g, '').length < MAX_DIGITS) st.entry += d;
  }

  function setOp(op) {
    if (clearError()) return;
    if (st.op !== null && !st.fresh) {
      const res = compute(st.acc, entryValue(), st.op);
      if (res === null) return fail('Cannot divide by zero');
      st.acc = sanitize(res);
      st.entry = String(st.acc);
    } else if (st.acc === null || !st.fresh) {
      st.acc = entryValue();
    }
    st.op = op;
    st.fresh = true;
    st.repeat = null;
  }

  function equals() {
    if (clearError()) return;

    let a, b, op;
    if (st.op !== null) {
      a = st.acc;
      b = entryValue();
      op = st.op;
      st.repeat = { op: op, operand: b };
    } else if (st.repeat) {
      a = entryValue();
      b = st.repeat.operand;
      op = st.repeat.op;
    } else {
      st.fresh = true;
      return;
    }

    const raw = compute(a, b, op);
    if (raw === null) return fail('Cannot divide by zero');
    const res = sanitize(raw);

    pushHistory(format(a) + ' ' + OP_SIGN[op] + ' ' + format(b), res);
    st.entry = String(res);
    st.acc = null;
    st.op = null;
    st.fresh = true;
  }

  function percent() {
    if (clearError()) return;
    const v = entryValue();
    // In an add/subtract context a percent reads against the running total;
    // otherwise it is just "divide by a hundred".
    const base = (st.op === '+' || st.op === '-') && st.acc !== null ? st.acc : 1;
    // Stays "typed" so a following operator still folds it into the pending
    // calculation (200 + 10% × 2 keeps the +20, rather than dropping it).
    st.entry = String(sanitize(base * v / 100));
    st.fresh = false;
  }

  function negate() {
    if (clearError()) return;
    if (st.entry.startsWith('-')) st.entry = st.entry.slice(1);
    else if (st.entry !== '0') st.entry = '-' + st.entry;
    else st.entry = '-0';
  }

  function backspace() {
    if (clearError()) return;
    if (st.fresh) return;
    st.entry = st.entry.slice(0, -1);
    if (st.entry === '' || st.entry === '-') {
      st.entry = '0';
      st.fresh = true;
    }
  }

  function clear() {
    // First press clears the entry; a second press (entry already blank, or
    // an error showing) wipes the pending operation too.
    const all = st.error !== null || (st.entry === '0' && st.fresh);
    clearError();
    st.entry = '0';
    st.fresh = true;
    if (all) {
      st.acc = null;
      st.op = null;
      st.repeat = null;
    }
  }

  // ---------------------------------------------------------------------------
  // History tape
  // ---------------------------------------------------------------------------

  function loadHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((e) => e && typeof e.expr === 'string') : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) {}
  }

  function pushHistory(expr, result) {
    history.unshift({ expr: expr, result: result });
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
    saveHistory();
    renderHistory();
  }

  function renderHistory() {
    els.tapeList.textContent = '';
    els.tapeEmpty.hidden = history.length > 0;

    history.forEach((entry) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tape-entry';

      const e = document.createElement('span');
      e.className = 't-expr';
      e.textContent = entry.expr + ' =';

      const r = document.createElement('span');
      r.className = 't-res';
      r.textContent = format(entry.result);

      btn.appendChild(e);
      btn.appendChild(r);
      // Tapping a line drops its result back into the display.
      btn.addEventListener('click', () => {
        st.error = null;
        st.entry = String(entry.result);
        st.fresh = true;
        render();
        toggleTape(false);
      });

      li.appendChild(btn);
      els.tapeList.appendChild(li);
    });
  }

  function toggleTape(show) {
    const open = show === undefined ? els.tape.hidden : show;
    els.tape.hidden = !open;
    els.tapeToggle.setAttribute('aria-expanded', String(open));
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  function press(key) {
    if (/^[0-9.]$/.test(key)) inputDigit(key);
    else if (key === '+' || key === '-' || key === '*' || key === '/') setOp(key);
    else if (key === '=') equals();
    else if (key === 'clear') clear();
    else if (key === 'back') backspace();
    else if (key === 'negate') negate();
    else if (key === 'percent') percent();
    else return;

    render();
    buzz();
  }

  function buzz() {
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
  }

  els.keys.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.key');
    if (btn) press(btn.dataset.key);
  });

  // Keyboard: mirror the tap on the matching key so typing feels physical.
  const KEYMAP = {
    Enter: '=', '=': '=', Escape: 'clear', Backspace: 'back',
    Delete: 'clear', '%': 'percent', n: 'negate', N: 'negate',
    x: '*', X: '*', ',': '.',
  };

  window.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const key = KEYMAP[ev.key] || ev.key;
    const known = /^[0-9.]$/.test(key) ||
      ['+', '-', '*', '/', '=', 'clear', 'back', 'negate', 'percent'].indexOf(key) !== -1;
    if (!known) return;

    ev.preventDefault();
    press(key);

    const btn = els.keys.querySelector('.key[data-key="' + key + '"]');
    if (btn) {
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 110);
    }
  });

  els.tapeToggle.addEventListener('click', () => toggleTape());
  els.tapeClose.addEventListener('click', () => toggleTape(false));
  els.tapeClear.addEventListener('click', () => {
    history = [];
    saveHistory();
    renderHistory();
  });

  window.addEventListener('resize', fitValue);

  function quit() {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) {}
    } else {
      location.href = '../../';
    }
  }
  els.quit.addEventListener('click', quit);

  // ---- boot ----
  renderHistory();
  render();

  (function hideLoading() {
    const loading = document.getElementById('app-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const elapsed = Date.now() - navStart;
    const remaining = Math.max(0, 3000 - elapsed); // mandatory ≥3s splash
    setTimeout(() => {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 500);
    }, remaining);
  })();
})();

(function () {
  const games = [
    {
      slug: 'snake',
      name: 'Snake',
      meta: 'Arcade',
      tagline: "Eat the dots. Don't bite yourself.",
      icon: '🐍',
      url: 'games/snake/',
    },
    {
      slug: 'tic-tac-toe',
      name: 'Tic-Tac-Toe',
      meta: 'Classic',
      tagline: 'Three in a row. Hot-seat for two.',
      icon: '#️⃣',
      url: 'games/tic-tac-toe/',
    },
    {
      slug: 'memory',
      name: 'Memory',
      meta: 'Coming soon',
      tagline: 'Flip cards. Match the pairs.',
      icon: '🎴',
      comingSoon: true,
    },
  ];

  const grid = document.getElementById('grid');
  const overlay = document.getElementById('game-overlay');
  const wrap = document.getElementById('frame-wrap');
  const frame = document.getElementById('game-frame');
  const skin = document.getElementById('frame-skin');
  const skinIcon = document.getElementById('skin-icon');
  const skinTitle = document.getElementById('skin-title');
  const skinTagline = document.getElementById('skin-tagline');
  const pageMeta = document.getElementById('page-meta');
  const footMeta = document.getElementById('foot-meta');

  // Match the CSS transitions on .frame-wrap.
  const ZOOM_MS = 550;
  // Card border-radius applied at the small end of the morph.
  const CARD_RADIUS = 0;

  let lastCard = null;
  let lastCardRect = null;
  let lastGame = null;

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function cardInner(g) {
    return `
      <div class="card-art">
        <span class="card-icon" aria-hidden="true">${escapeHTML(g.icon)}</span>
      </div>
      <div class="card-body">
        <h2 class="card-title">${escapeHTML(g.name)}</h2>
        <p class="card-meta">${escapeHTML(g.meta)}</p>
      </div>
    `;
  }

  function render() {
    grid.innerHTML = games.map((g) => {
      if (g.comingSoon) {
        return `
          <li class="card locked" data-tile="${escapeHTML(g.slug)}" data-locked="1">
            ${cardInner(g)}
          </li>
        `;
      }
      return `
        <li class="card" data-tile="${escapeHTML(g.slug)}" data-url="${escapeHTML(g.url)}">
          <a href="${escapeHTML(g.url)}">
            ${cardInner(g)}
          </a>
        </li>
      `;
    }).join('');

    const total = games.length;
    const playable = games.filter((g) => !g.comingSoon).length;
    if (pageMeta) pageMeta.textContent = `${playable} / ${total}`;
    if (footMeta) footMeta.textContent = `${total} games`;
  }

  function rectFromCard(card) {
    if (card) {
      const r = card.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    const w = Math.min(180, window.innerWidth - 32);
    const h = w * 1.3;
    return {
      left: (window.innerWidth - w) / 2,
      top: (window.innerHeight - h) / 2,
      width: w,
      height: h,
    };
  }

  function transformForRect(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return `translate(${rect.left}px, ${rect.top}px)`
         + ` scale(${rect.width / vw}, ${rect.height / vh})`;
  }

  function applySkinFromCard(card, game) {
    if (card) {
      const cs = getComputedStyle(card);
      const g1 = cs.getPropertyValue('--g1').trim();
      if (g1) skin.style.setProperty('--g1', g1);
    }
    skinIcon.textContent = game.icon;
    skinTitle.textContent = game.name;
    skinTagline.textContent = game.meta || '';
  }

  function nextFrame(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  function openGame(card, game) {
    if (overlay.dataset.state) return;

    const rect = rectFromCard(card);
    lastCard = card || null;
    lastCardRect = rect;
    lastGame = game;

    applySkinFromCard(card, game);

    overlay.hidden = false;
    overlay.dataset.state = 'open';

    wrap.style.transition = 'none';
    wrap.style.transformOrigin = '0 0';
    wrap.style.transform = transformForRect(rect);
    wrap.style.borderRadius = CARD_RADIUS + 'px';
    wrap.style.pointerEvents = 'none';

    skin.classList.add('visible');
    frame.classList.remove('visible');
    frame.src = game.url;

    void wrap.offsetWidth;

    nextFrame(() => {
      wrap.style.transition = '';
      wrap.style.transform = 'translate(0, 0) scale(1, 1)';
      wrap.style.borderRadius = '0';
      skin.classList.remove('visible');
      frame.classList.add('visible');
    });

    setTimeout(() => { wrap.style.pointerEvents = ''; }, ZOOM_MS + 40);

    try { history.pushState({ gameOpen: true }, '', '#' + game.url); } catch (_) {}
  }

  function closeGame() {
    if (overlay.dataset.state !== 'open') return;
    overlay.dataset.state = 'shrinking';

    let rect;
    if (lastCard && document.contains(lastCard)) {
      rect = rectFromCard(lastCard);
    } else if (lastCardRect) {
      rect = lastCardRect;
    } else {
      rect = rectFromCard(null);
    }
    lastCardRect = rect;

    if (lastGame) applySkinFromCard(lastCard, lastGame);

    wrap.style.pointerEvents = 'none';
    wrap.style.transition = 'none';
    wrap.style.transformOrigin = '0 0';
    void wrap.offsetWidth;

    nextFrame(() => {
      wrap.style.transition = '';
      wrap.style.transform = transformForRect(rect);
      wrap.style.borderRadius = CARD_RADIUS + 'px';
      skin.classList.add('visible');
      frame.classList.remove('visible');
    });

    setTimeout(finalizeClose, ZOOM_MS + 40);
  }

  function finalizeClose() {
    overlay.hidden = true;
    overlay.removeAttribute('data-state');
    frame.onload = null;
    frame.src = 'about:blank';
    frame.classList.remove('visible');
    skin.classList.remove('visible');
    wrap.style.transition = 'none';
    wrap.style.transform = '';
    wrap.style.transformOrigin = '';
    wrap.style.borderRadius = '';
    wrap.style.pointerEvents = '';
    lastCard = null;
    lastCardRect = null;
    lastGame = null;
  }

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;

    if (card.dataset.locked === '1') {
      e.preventDefault();
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      return;
    }

    const url = card.dataset.url;
    if (!url) return;
    const game = games.find((g) => g.url === url);
    if (!game) return;
    e.preventDefault();
    card.classList.add('tapped');
    setTimeout(() => { card.classList.remove('tapped'); }, 240);
    setTimeout(() => { openGame(card, game); }, 90);
  });

  window.addEventListener('popstate', () => {
    if (overlay.dataset.state === 'open') {
      closeGame();
      if (location.hash) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
  });

  // Allow embedded games to request close (their Quit button posts this).
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'close-game') {
      if (history.state && history.state.gameOpen) history.back();
      else closeGame();
    }
  });

  render();

  // ---- Section pager (Home / Apps / Tools / Games) ----
  // Native horizontal scroll-snap drives the swipe. The carousel loops
  // both ways: a clone of the last slide sits before the first, and a
  // clone of the first sits after the last; once a swipe settles on
  // either clone, scrollLeft jumps silently to its real twin so the
  // user can keep paging in either direction without ever hitting an
  // edge. The footer nav shows previous · current · next, with the
  // current section emphasized; tapping prev/next paginates by one.
  (function pager() {
    const pagerEl = document.getElementById('pager');
    const navEl = document.getElementById('pager-nav');
    if (!pagerEl || !navEl) return;

    const PAGE_KEY = 'arcade-section';
    const prevBtn = document.getElementById('nav-prev');
    const nextBtn = document.getElementById('nav-next');
    const currLbl = document.getElementById('nav-current');

    const pages = Array.from(pagerEl.querySelectorAll('.page'));
    const order = pages.map((p) => p.dataset.page);
    const labels = {
      home: 'Home', apps: 'Apps', tools: 'Tools', games: 'Games',
    };

    // Loop clones — last before first, first after last. Marked inert
    // so they stay out of the tab order and a11y tree.
    function makeClone(src, name) {
      const c = src.cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      c.setAttribute('inert', '');
      c.dataset.page = name;
      return c;
    }
    const headClone = makeClone(pages[pages.length - 1], 'loop-head'); // games' twin
    const tailClone = makeClone(pages[0], 'loop-tail');                // home's twin
    pagerEl.insertBefore(headClone, pages[0]);
    pagerEl.appendChild(tailClone);

    // Layout: [headClone, ...pages, tailClone]. Index in slides[] for a
    // real page name is order.indexOf(name) + 1.
    const slides = [headClone].concat(pages).concat([tailClone]);

    function realIndex(name) {
      const i = order.indexOf(name);
      return i === -1 ? order.indexOf('home') : i;
    }

    function scrollToReal(name, smooth) {
      const i = realIndex(name);
      const left = pages[i].offsetLeft;
      pagerEl.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
    }

    function neighbor(name, delta) {
      const i = realIndex(name);
      const n = order.length;
      return order[((i + delta) % n + n) % n];
    }

    function setActive(name) {
      currLbl.textContent = labels[name] || name;
      const prev = neighbor(name, -1);
      const next = neighbor(name, +1);
      prevBtn.textContent = labels[prev];
      nextBtn.textContent = labels[next];
      prevBtn.dataset.page = prev;
      nextBtn.dataset.page = next;
      try { localStorage.setItem(PAGE_KEY, name); } catch (_) {}
    }

    // Restore last section, fall back to Home.
    let initial = 'home';
    try {
      const saved = localStorage.getItem(PAGE_KEY);
      if (saved && order.indexOf(saved) !== -1) initial = saved;
    } catch (_) {}
    requestAnimationFrame(() => {
      scrollToReal(initial, false);
      setActive(initial);
    });

    // Map the closest slide index to a real section name, treating
    // clones as their twin so the nav reads correctly mid-swipe.
    function visibleName() {
      const x = pagerEl.scrollLeft;
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < slides.length; i++) {
        const d = Math.abs(slides[i].offsetLeft - x);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      if (best === 0) return order[order.length - 1];
      if (best === slides.length - 1) return order[0];
      return order[best - 1];
    }

    let scrollRaf = 0;
    pagerEl.addEventListener('scroll', () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        setActive(visibleName());
      });
    }, { passive: true });

    // After scroll-snap settles on a clone, swap to its real twin
    // without animation so the loop is seamless.
    function maybeWrap() {
      const x = pagerEl.scrollLeft;
      if (Math.abs(x - headClone.offsetLeft) < 2) {
        pagerEl.scrollLeft = pages[pages.length - 1].offsetLeft;
      } else if (Math.abs(x - tailClone.offsetLeft) < 2) {
        pagerEl.scrollLeft = pages[0].offsetLeft;
      }
    }
    if ('onscrollend' in window) {
      pagerEl.addEventListener('scrollend', maybeWrap);
    } else {
      let stopT = 0;
      pagerEl.addEventListener('scroll', () => {
        clearTimeout(stopT);
        stopT = setTimeout(maybeWrap, 140);
      }, { passive: true });
    }

    function paginate(delta) {
      const cur = visibleName();
      const target = neighbor(cur, delta);
      // Going from Home backwards or Games forwards crosses a clone;
      // for a smooth animation, scroll to the clone first, then let
      // maybeWrap settle us on the real twin.
      const curIdx = realIndex(cur);
      let leftTarget;
      if (delta < 0 && curIdx === 0) {
        leftTarget = headClone.offsetLeft;
      } else if (delta > 0 && curIdx === order.length - 1) {
        leftTarget = tailClone.offsetLeft;
      } else {
        leftTarget = pages[realIndex(target)].offsetLeft;
      }
      pagerEl.scrollTo({ left: leftTarget, behavior: 'smooth' });
    }

    prevBtn.addEventListener('click', () => paginate(-1));
    nextBtn.addEventListener('click', () => paginate(+1));

    // Re-snap on resize so the active slide stays aligned after layout
    // changes (orientation, window resize, etc.).
    let resizeRaf = 0;
    window.addEventListener('resize', () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        scrollToReal(visibleName(), false);
      });
    });
  })();

  // Deep link: opening /#games/<slug>/ goes straight into the game.
  (function deepLink() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (!hash) return;
    const game = games.find((g) => g.url === hash && !g.comingSoon);
    if (game) {
      history.replaceState(null, '', location.pathname + location.search);
      openGame(null, game);
    }
  })();
})();

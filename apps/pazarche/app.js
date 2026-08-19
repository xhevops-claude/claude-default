(function () {
  'use strict';

  // ---------------------------------------------------------------- consts

  const CATS = [
    { id: 'imoti', name: 'Имоти', emoji: '🏠', a: '#dbeafe', b: '#eef2ff' },
    { id: 'avto', name: 'Автомобили', emoji: '🚗', a: '#fee2e2', b: '#fff7ed' },
    { id: 'elektronika', name: 'Електроника', emoji: '📱', a: '#e0e7ff', b: '#f5f3ff' },
    { id: 'dom', name: 'Дом и градина', emoji: '🪴', a: '#dcfce7', b: '#f7fee7' },
    { id: 'rabota', name: 'Работа', emoji: '💼', a: '#fef3c7', b: '#fffbeb' },
    { id: 'uslugi', name: 'Услуги', emoji: '🔧', a: '#e2e8f0', b: '#f8fafc' },
    { id: 'turizam', name: 'Туризъм', emoji: '🏖️', a: '#cffafe', b: '#ecfeff' },
    { id: 'lyubimtsi', name: 'Домашни любимци', emoji: '🐶', a: '#ffe4e6', b: '#fff1f2' },
    { id: 'kursove', name: 'Курсове и обучения', emoji: '📚', a: '#ede9fe', b: '#faf5ff' },
    { id: 'stroitelstvo', name: 'Строителство', emoji: '🧱', a: '#ffedd5', b: '#fef9ee' },
    { id: 'selsko', name: 'Селско стопанство', emoji: '🚜', a: '#ecfccb', b: '#f7fee7' },
  ];
  const CAT_BY_ID = Object.fromEntries(CATS.map((c) => [c.id, c]));

  // Seeded demo listings. price: number in лв., null = по договаряне, 0 = безплатно.
  // ago: days since publication (kept relative so the board always looks alive).
  const SEED = [
    { id: 's01', cat: 'imoti', emoji: '🏢', title: 'Тристаен апартамент, кв. Лозенец, 92 м²', price: 289000, city: 'София', ago: 0.2, top: true, seller: 'Мария Илиева', phone: '088 811 4207', desc: 'Светъл тристаен апартамент на 4-ти етаж с две тераси и гледка към Витоша. Ново строителство, акт 16 от 2023 г. Паркомясто в подземен гараж по договаряне.' },
    { id: 's02', cat: 'imoti', emoji: '🏡', title: 'Къща с двор 850 м², с. Марково', price: 175000, city: 'Пловдив', ago: 2.4, seller: 'Георги Пеев', phone: '088 923 5518', desc: 'Двуетажна къща в полите на Родопите, 10 минути от Пловдив. РЗП 140 м², лятна кухня, овощна градина, кладенец. Възможност за замяна с апартамент + доплащане.' },
    { id: 's03', cat: 'imoti', emoji: '🛏️', title: 'Гарсониера под наем до Медицинския университет', price: 450, note: '/ месец', city: 'Варна', ago: 0.8, seller: 'Иван Тодоров', phone: '087 761 0934', desc: 'Обзаведена гарсониера, 35 м², след ремонт. Климатик, пералня, бърз интернет. Депозит един наем. Подходяща за студент или работещ. Без домашни любимци.' },
    { id: 's04', cat: 'avto', emoji: '🚗', title: 'VW Golf 7 1.6 TDI, 2016 г., 148 000 км', price: 21500, city: 'Русе', ago: 1.1, top: true, seller: 'Петър Ганчев', phone: '089 944 2371', desc: 'Голфът е от внос, първи собственик, с пълна сервизна история в оторизиран сервиз. Нови гуми, нов акумулатор. Малък данък, разход 4.5 л/100 км. Реални километри, проверка навсякъде.' },
    { id: 's05', cat: 'avto', emoji: '🚙', title: 'Dacia Duster 4x4 с газова уредба', price: 18900, city: 'Плевен', ago: 3.6, seller: 'Стоян Митев', phone: '088 837 6642', desc: 'Дъстер 1.6, бензин/газ, 2019 г., 96 000 км. Изключително икономичен — 9 лв./100 км на газ. Теглич, стелки, зимен пакет. Обслужен, сменени масла и филтри.' },
    { id: 's06', cat: 'avto', emoji: '🛞', title: 'Зимни гуми с джанти 16 цола, 5x112', price: 380, city: 'София', ago: 5.2, seller: 'Николай Драганов', phone: '087 702 8156', desc: 'Комплект 4 бр. зимни гуми Continental 205/55 R16 на стоманени джанти. Грайфер 6 мм, карани един сезон. Подходящи за VW, Audi, Skoda, Seat.' },
    { id: 's07', cat: 'elektronika', emoji: '📱', title: 'iPhone 14, 128 GB, с гаранция до 03.2027', price: 950, city: 'София', ago: 0.4, top: true, seller: 'Виктория Ставрева', phone: '088 855 9023', desc: 'Втора употреба, батерия 96%, без забележки по корпуса. Пълен комплект с кутия и неизползван кабел. Гаранция от български вносител. Възможен оглед в центъра.' },
    { id: 's08', cat: 'elektronika', emoji: '💻', title: 'Геймърски лаптоп Lenovo Legion, RTX 4060', price: 1850, city: 'Пловдив', ago: 1.9, seller: 'Мартин Кръстев', phone: '089 910 3387', desc: 'Ryzen 7 7840HS, 16 GB RAM, 1 TB SSD, 165 Hz екран. Купуван преди 8 месеца, ползван за учене и игри. Продавам заради преминаване към настолна конфигурация.' },
    { id: 's09', cat: 'elektronika', emoji: '🎮', title: 'PlayStation 5 Slim + 2 джойстика и 4 игри', price: 780, city: 'Бургас', ago: 4.1, seller: 'Александър Жеков', phone: '088 869 7714', desc: 'Дисково издание, перфектно състояние. Включени EA FC 25, God of War Ragnarök, Spider-Man 2 и Gran Turismo 7. Цената е крайна, без бартери.' },
    { id: 's10', cat: 'dom', emoji: '🛋️', title: 'Ъглов диван с функция сън и ракла', price: 620, city: 'Варна', ago: 2.7, seller: 'Елена Русева', phone: '087 733 4409', desc: 'Диван 260x160 см, дамаска в графитено сиво, изключително запазен. Механизъм тип „клик-клак“, голяма ракла за завивки. Продавам поради преместване в по-малко жилище.' },
    { id: 's11', cat: 'dom', emoji: '🌿', title: 'Косачка Husqvarna LC 140, като нова', price: 340, city: 'Добрич', ago: 6.3, seller: 'Димитър Караджов', phone: '088 802 6675', desc: 'Бензинова косачка, ползвана два сезона за малък двор. Редовно сменяно масло, остър нож, кош за трева. Пали от първи опит. Причина за продажба — преминах към робот.' },
    { id: 's12', cat: 'dom', emoji: '🪵', title: 'Подарявам дървени палети, 20 бр.', price: 0, city: 'София', ago: 0.6, seller: 'Красимир Начев', phone: '089 977 1258', desc: 'Здрави европалети от склад, подходящи за градински мебели или огрев. Взимане от кв. Илиянци, товаренето е от вас. Обявата е активна, докато не я сваля.' },
    { id: 's13', cat: 'rabota', emoji: '☕', title: 'Търсим барист/ка за кафене в центъра', price: 1600, note: '/ месец', city: 'Пловдив', ago: 1.4, seller: 'Кафе „Мелница“', phone: '088 891 5530', desc: 'Пълен работен ден, две смени, почивни дни по график. Опитът е предимство, но обучаваме. Заплата 1600 лв. + бакшиши + ваучери за храна. Изпратете ни съобщение или се обадете.' },
    { id: 's14', cat: 'rabota', emoji: '🚛', title: 'Шофьор кат. C+E, международни курсове', price: 4500, note: '/ месец', city: 'Русе', ago: 3.2, seller: '„Дунав Транс“ ЕООД', phone: '087 745 8821', desc: 'Курсове България–Германия–Бенелюкс, ново Volvo FH. Заплата + командировъчни, реално 4500 лв./месец. Изискваме ADR и карта за дигитален тахограф. Осигуровки на пълна сума.' },
    { id: 's15', cat: 'uslugi', emoji: '🔨', title: 'Ремонт на покриви и хидроизолация', price: null, city: 'Стара Загора', ago: 2.1, seller: 'Бригада „Зенит“', phone: '088 826 3390', desc: 'Претърсване на керемиди, нови обшивки, улуци и водосточни тръби. Оглед и оферта в рамките на деня, гаранция 5 години. Работим в цялата област.' },
    { id: 's16', cat: 'uslugi', emoji: '📐', title: 'Частни уроци по математика, 7–12 клас', price: 25, note: '/ час', city: 'София', ago: 0.9, seller: 'Радостина Милчева', phone: '089 902 7745', desc: 'Подготовка за НВО и ДЗИ, индивидуално или в малки групи до трима. Присъствено в Студентски град или онлайн. Първото занятие е безплатно, за да преценим нивото.' },
    { id: 's17', cat: 'turizam', emoji: '🏖️', title: 'Студио в Созопол, 50 м от плажа', price: 95, note: '/ нощувка', city: 'Созопол', ago: 0.3, top: true, seller: 'Яна Костова', phone: '088 848 1167', desc: 'Ново студио за до трима души в стария град, климатик, кухненски бокс, паркомясто. Свободни дати през септември. Минимален престой 3 нощувки, отстъпка за седмица.' },
    { id: 's18', cat: 'turizam', emoji: '🚐', title: 'Каравана Adria, напълно оборудвана', price: 12400, city: 'Варна', ago: 7.8, seller: 'Емил Апостолов', phone: '087 718 2296', desc: 'Каравана 2015 г. за 4 души — печка, хладилник, тоалетна, соларен панел и предпалатка. Готова за сезона, нови гуми и обслужени спирачки. Регистрирана, с валиден преглед.' },
    { id: 's19', cat: 'lyubimtsi', emoji: '🐱', title: 'Подарявам котенца на 2 месеца', price: 0, city: 'Велико Търново', ago: 0.5, seller: 'Десислава Ангелова', phone: '088 862 4013', desc: 'Три котенца — две шарени и едно черно, обезпаразитени и свикнали с тоалетна. Търсят отговорни стопани. Изпращам снимки и видео на желаещите.' },
    { id: 's20', cat: 'lyubimtsi', emoji: '🐕', title: 'Голдън ретривър с родословие, мъжко', price: 900, city: 'София', ago: 2.9, top: true, seller: 'Развъдник „Златен дол“', phone: '089 933 6608', desc: 'Кученце на 10 седмици с ваксинационен паспорт, чип и родословие от БРФК. Родителите са с изследвания за дисплазия. Договор за отглеждане и съдействие след покупката.' },
    { id: 's21', cat: 'kursove', emoji: '🗣️', title: 'Курс по английски A1–B2, малки групи', price: 320, city: 'Бургас', ago: 4.7, seller: 'Езиков център „Мост“', phone: '088 877 9034', desc: 'Нови групи от октомври, две занятия седмично по 90 минути. До 6 курсисти в група, сертификат при завършване. Цената е за модул от 48 учебни часа, учебниците са включени.' },
    { id: 's22', cat: 'kursove', emoji: '🎸', title: 'Уроци по китара за начинаещи', price: 30, note: '/ час', city: 'Пловдив', ago: 1.6, seller: 'Калоян Дечев', phone: '087 756 3312', desc: 'Акустична и електрическа китара, без нужда от нотна грамотност в началото. Студио в Кършияка или при вас. Първи урок — 50% отстъпка. Свободни часове вечер и събота.' },
    { id: 's23', cat: 'stroitelstvo', emoji: '🧱', title: 'Тухли Wienerberger, останали от строеж', price: 0.85, note: '/ бр.', city: 'Пазарджик', ago: 3.9, seller: 'Тодор Влахов', phone: '088 814 7726', desc: 'Около 1200 бр. тухли 25x12x6.5, изцяло запазени, на палети с фолио. При взимане на всичко — 0.75 лв./бр. Има възможност за организиран транспорт срещу доплащане.' },
    { id: 's24', cat: 'stroitelstvo', emoji: '🏗️', title: 'Фасадно скеле под наем, 200 м²', price: null, city: 'София', ago: 8.5, seller: '„Скеле БГ“ ООД', phone: '089 966 2280', desc: 'Сертифицирано рамково скеле с платформи и парапети. Монтаж и демонтаж от наш екип, цена според срока и обекта. Издаваме всички документи за строителен надзор.' },
    { id: 's25', cat: 'selsko', emoji: '🍅', title: 'Домати от собствена градина, розови', price: 3.5, note: '/ кг', city: 'Сандански', ago: 0.1, seller: 'Баба Величка', phone: '088 823 9951', desc: 'Истински розови домати без пръскане, брани сутринта. Всеки ден на пазара в Сандански или доставка до София в петък при поръчка над 10 кг.' },
    { id: 's26', cat: 'selsko', emoji: '🚜', title: 'Трактор Беларус 820, обслужен', price: 14200, city: 'Плевен', ago: 9.4, seller: 'Христо Върбанов', phone: '087 709 4468', desc: 'Трактор 2008 г. с 4800 моточаса, нов съединител и акумулатор. Върви с плуг и дискова брана. Регистриран в КТИ, готов за сезона. Оглед в село Победа.' },
  ];

  const LS_FAVS = 'pazarche-favs';
  const LS_MINE = 'pazarche-my-ads';

  // ---------------------------------------------------------------- state

  let query = '';
  let activeCat = 'all';
  let sortBy = 'new';
  let favsOnly = false;
  let favs = new Set(load(LS_FAVS, []));
  let mine = load(LS_MINE, []);
  let detailId = null;

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  // ---------------------------------------------------------------- utils

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function priceText(ad) {
    if (ad.price === null || ad.price === undefined) return 'По договаряне';
    if (ad.price === 0) return 'Безплатно';
    const n = ad.price.toLocaleString('bg-BG', { maximumFractionDigits: 2 });
    return `${n} лв.`;
  }

  function agoDays(ad) {
    if (typeof ad.ago === 'number') return ad.ago;
    return Math.max(0, (Date.now() - (ad.postedAt || Date.now())) / 86400000);
  }

  function agoText(ad) {
    const d = agoDays(ad);
    if (d < 1) return 'днес';
    if (d < 2) return 'вчера';
    return `преди ${Math.floor(d)} дни`;
  }

  function views(ad) {
    if (ad.mine === true) return Math.max(1, Math.floor(agoDays(ad) * 40) + 1);
    let h = 0;
    const s = String(ad.id);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return (h % 860) + 40;
  }

  function initials(name) {
    const parts = String(name).replace(/["„“]/g, '').trim().split(/\s+/);
    return parts.slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '?';
  }

  // ---------------------------------------------------------------- data

  function allAds() { return mine.concat(SEED); }

  function visibleAds() {
    const q = query.trim().toLowerCase();
    let ads = allAds().filter((ad) => {
      if (favsOnly && !favs.has(ad.id)) return false;
      if (activeCat !== 'all' && ad.cat !== activeCat) return false;
      if (!q) return true;
      return `${ad.title} ${ad.desc} ${ad.city}`.toLowerCase().includes(q);
    });
    if (sortBy === 'new') {
      ads.sort((a, b) => agoDays(a) - agoDays(b));
    } else {
      // Numeric prices sort by value (free counts as 0); "по договаряне" goes last.
      const val = (ad) => (typeof ad.price === 'number' ? ad.price : null);
      ads.sort((a, b) => {
        const va = val(a);
        const vb = val(b);
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return sortBy === 'cheap' ? va - vb : vb - va;
      });
    }
    return ads;
  }

  // --------------------------------------------------------------- render

  const grid = $('grid');
  const catsNav = $('cats');

  function renderCats() {
    const chips = [{ id: 'all', name: 'Всички', emoji: '✨' }].concat(CATS);
    catsNav.innerHTML = chips.map((c) => `
      <button type="button" class="cat-chip${c.id === activeCat ? ' active' : ''}" data-cat="${esc(c.id)}">
        <span aria-hidden="true">${esc(c.emoji)}</span>${esc(c.name)}
      </button>
    `).join('');
  }

  function adCard(ad) {
    const cat = CAT_BY_ID[ad.cat] || CATS[0];
    const isFav = favs.has(ad.id);
    const isMine = ad.mine === true;
    const note = ad.note ? ` <span class="price-note">${esc(ad.note)}</span>` : '';
    const badge = isMine
      ? '<span class="badge mine">Моя обява</span>'
      : (ad.top ? '<span class="badge top">Топ</span>' : '');
    return `
      <li class="ad" style="--art-a:${esc(cat.a)};--art-b:${esc(cat.b)}">
        <button type="button" class="ad-hit" data-open="${esc(ad.id)}">
          <span class="ad-art">
            ${badge}
            <span class="ad-emoji" aria-hidden="true">${esc(ad.emoji)}</span>
          </span>
          <span class="ad-body">
            <span class="ad-price">${esc(priceText(ad))}${note}</span>
            <span class="ad-title">${esc(ad.title)}</span>
            <span class="ad-meta">📍 ${esc(ad.city)} · ${esc(agoText(ad))}</span>
          </span>
        </button>
        <button type="button" class="fav-btn${isFav ? ' on' : ''}" data-fav="${esc(ad.id)}"
          aria-label="${isFav ? 'Премахни от любими' : 'Добави в любими'}"
          aria-pressed="${isFav}">${isFav ? '♥' : '♡'}</button>
      </li>
    `;
  }

  function plural(n) { return n === 1 ? 'обява' : 'обяви'; }

  function render() {
    const ads = visibleAds();
    grid.innerHTML = ads.map(adCard).join('');
    $('empty').hidden = ads.length > 0;
    $('result-count').textContent = `${ads.length} ${plural(ads.length)}`;
    const favBtn = $('favs-btn');
    favBtn.setAttribute('aria-pressed', String(favsOnly));
    const count = $('favs-count');
    count.hidden = favs.size === 0;
    count.textContent = String(favs.size);
  }

  // --------------------------------------------------------------- detail

  const detailModal = $('detail-modal');
  const postModal = $('post-modal');

  function findAd(id) { return allAds().find((a) => a.id === id) || null; }

  function openDetail(id) {
    const ad = findAd(id);
    if (!ad) return;
    detailId = id;
    const cat = CAT_BY_ID[ad.cat] || CATS[0];
    const art = $('detail-art');
    art.style.setProperty('--art-a', cat.a);
    art.style.setProperty('--art-b', cat.b);
    $('detail-emoji').textContent = ad.emoji;
    $('detail-title').textContent = ad.title;
    $('detail-price').textContent = priceText(ad) + (ad.note ? ` ${ad.note}` : '');
    $('detail-meta').textContent = `${cat.emoji} ${cat.name} · 📍 ${ad.city} · ${agoText(ad)} · ${views(ad)} прегледа`;
    $('detail-desc').textContent = ad.desc;
    $('seller-name').textContent = ad.seller;
    $('seller-avatar').textContent = initials(ad.seller);
    const phoneBtn = $('phone-btn');
    phoneBtn.textContent = '📞 Покажи телефон';
    phoneBtn.dataset.shown = '';
    $('detail-delete').hidden = ad.mine !== true;
    syncDetailFav();
    detailModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function syncDetailFav() {
    const btn = $('detail-fav');
    const on = detailId !== null && favs.has(detailId);
    btn.textContent = on ? '♥ В любими' : '♡ Запази в любими';
  }

  function closeModal(which) {
    (which === 'post' ? postModal : detailModal).hidden = true;
    if (which === 'detail') detailId = null;
    if (detailModal.hidden && postModal.hidden) document.body.style.overflow = '';
  }

  function toggleFav(id) {
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    save(LS_FAVS, [...favs]);
    syncDetailFav();
    render();
  }

  // ----------------------------------------------------------------- post

  function fillCatSelect() {
    $('f-cat').innerHTML = '<option value="" disabled selected>Избери категория…</option>' +
      CATS.map((c) => `<option value="${esc(c.id)}">${esc(c.emoji)} ${esc(c.name)}</option>`).join('');
  }

  function openPost() {
    $('post-form').reset();
    const err = $('form-error');
    err.hidden = true;
    postModal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('f-title').focus(), 50);
  }

  function submitPost(e) {
    e.preventDefault();
    const title = $('f-title').value.trim();
    const cat = $('f-cat').value;
    const city = $('f-city').value.trim();
    const priceRaw = $('f-price').value.trim();
    const phone = $('f-phone').value.trim();
    const desc = $('f-desc').value.trim();

    const problems = [];
    if (title.length < 4) problems.push('заглавие (поне 4 знака)');
    if (!cat) problems.push('категория');
    if (!city) problems.push('град');
    if (desc.length < 10) problems.push('описание (поне 10 знака)');
    let price = null;
    if (priceRaw !== '') {
      price = Number(priceRaw);
      if (!Number.isFinite(price) || price < 0) { problems.push('коректна цена'); price = null; }
    }
    const err = $('form-error');
    if (problems.length) {
      err.textContent = `Добави ${problems.join(', ')} и опитай пак.`;
      err.hidden = false;
      return;
    }

    const catDef = CAT_BY_ID[cat];
    const ad = {
      id: `m${Date.now().toString(36)}`,
      cat,
      emoji: catDef ? catDef.emoji : '📦',
      title,
      price,
      city,
      desc,
      seller: 'Ти',
      phone: phone || 'скрит',
      postedAt: Date.now(),
      mine: true,
    };
    mine = [ad].concat(mine);
    save(LS_MINE, mine);
    closeModal('post');
    activeCat = 'all';
    favsOnly = false;
    query = '';
    $('search').value = '';
    $('search-clear').hidden = true;
    sortBy = 'new';
    $('sort').value = 'new';
    renderCats();
    render();
    toast('Обявата е публикувана 🎉');
  }

  function deleteMine(id) {
    mine = mine.filter((a) => a.id !== id);
    save(LS_MINE, mine);
    if (favs.delete(id)) save(LS_FAVS, [...favs]);
    closeModal('detail');
    render();
    toast('Обявата е изтрита');
  }

  // ---------------------------------------------------------------- toast

  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // --------------------------------------------------------------- events

  catsNav.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    activeCat = chip.dataset.cat;
    renderCats();
    render();
  });

  grid.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { toggleFav(fav.dataset.fav); return; }
    const hit = e.target.closest('[data-open]');
    if (hit) openDetail(hit.dataset.open);
  });

  const searchInput = $('search');
  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    $('search-clear').hidden = query === '';
    render();
  });
  $('search-clear').addEventListener('click', () => {
    searchInput.value = '';
    query = '';
    $('search-clear').hidden = true;
    searchInput.focus();
    render();
  });

  $('sort').addEventListener('change', (e) => { sortBy = e.target.value; render(); });

  $('favs-btn').addEventListener('click', () => { favsOnly = !favsOnly; render(); });
  $('post-btn').addEventListener('click', openPost);
  $('post-form').addEventListener('submit', submitPost);

  $('detail-fav').addEventListener('click', () => { if (detailId) toggleFav(detailId); });
  $('detail-delete').addEventListener('click', () => { if (detailId) deleteMine(detailId); });
  $('phone-btn').addEventListener('click', () => {
    const ad = detailId ? findAd(detailId) : null;
    if (!ad) return;
    const btn = $('phone-btn');
    if (btn.dataset.shown) return;
    btn.textContent = `📞 ${ad.phone}`;
    btn.dataset.shown = '1';
  });

  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) closeModal(closer.dataset.close);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!postModal.hidden) closeModal('post');
    else if (!detailModal.hidden) closeModal('detail');
  });

  // Quit: embedded → ask the shell to close; standalone → back to the arcade.
  $('quit').addEventListener('click', () => {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) { /* ignore */ }
    } else {
      location.href = '../../';
    }
  });

  // ----------------------------------------------------------------- boot

  fillCatSelect();
  renderCats();
  render();

  (function hideLoading() {
    const loading = document.getElementById('app-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const remaining = Math.max(0, 3000 - (Date.now() - navStart));
    setTimeout(() => { loading.classList.add('hidden'); setTimeout(() => loading.remove(), 500); }, remaining);
  })();
})();

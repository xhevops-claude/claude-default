(function () {
  const input = document.getElementById('name-input');
  const greetBtn = document.getElementById('greet-btn');
  const themeBtn = document.getElementById('theme-btn');
  const greeting = document.getElementById('greeting');
  const subtitle = document.getElementById('subtitle');
  const timeEl = document.getElementById('time');

  const flavours = [
    'Hope your day is going well.',
    'Nice to meet you.',
    'Welcome aboard.',
    'Glad you stopped by.',
    'Sending good vibes your way.',
    'May your coffee be strong and your bugs be shallow.',
  ];

  const greetings = ['Hello', 'Hola', 'Bonjour', 'Hallo', 'Ciao', 'こんにちは', '안녕하세요', 'Olá'];

  function greet() {
    const name = input.value.trim();
    const hello = greetings[Math.floor(Math.random() * greetings.length)];
    if (name) {
      greeting.textContent = `${hello}, ${name}`;
      subtitle.textContent = flavours[Math.floor(Math.random() * flavours.length)];
    } else {
      greeting.textContent = `${hello}, World`;
      subtitle.textContent = 'A friendly hello from somewhere on the internet.';
    }
  }

  function updateTime() {
    const now = new Date();
    timeEl.textContent = now.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeBtn.textContent = theme === 'light' ? '🌙' : '☀️';
    try { localStorage.setItem('hello-theme', theme); } catch (_) {}
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    applyTheme(current === 'light' ? 'dark' : 'light');
  }

  let saved = null;
  try { saved = localStorage.getItem('hello-theme'); } catch (_) {}
  applyTheme(saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

  greetBtn.addEventListener('click', greet);
  themeBtn.addEventListener('click', toggleTheme);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') greet();
  });

  updateTime();
  setInterval(updateTime, 1000);
})();

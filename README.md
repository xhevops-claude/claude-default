# claude-default

A small static games arcade. Tap a tile, the card morphs into the game; tap home, the game morphs back into the card. Deployed to GitHub Pages.

**Live**: https://xhevops-claude.github.io/claude-default/

## Layout

```
.
├── index.html              Gallery (home page)
├── styles.css              Gallery layout + iframe morph
├── app.js                  Gallery logic — tile rendering, open/close animation
├── theme.js                Theme picker (gallery only)
├── themes.css              Theme variables (gallery only)
└── games/
    ├── snake/              Self-contained game
    │   ├── index.html
    │   ├── styles.css
    │   └── app.js
    └── tic-tac-toe/
        ├── index.html
        ├── styles.css
        └── app.js
```

Each game is fully self-contained: it links no shared CSS or JS and ships its own black palette. The gallery embeds it via an `<iframe>`. The theme picker on the home page only affects the home page.

## Adding a new game

1. Create `games/<slug>/` with its own `index.html`, `styles.css`, `app.js`.
2. Append an entry to the `games` array in `app.js`:
   ```js
   {
     slug: 'pong',
     name: 'Pong',
     tagline: 'Classic two-paddle volley.',
     icon: '🏓',
     url: 'games/pong/',
   }
   ```
3. (Optional) Mark it `comingSoon: true` and omit `url` to render the tile as a non-clickable "Coming soon" card.

The tile gets its colors from the active theme's accents (rotated per `nth-child`) — no per-game color config needed.

## Game loading screen

Each game's `index.html` includes a critical inline `<style>` block plus a `#game-loading` element so a black + logo + sliding bar paints on the very first frame, before any external stylesheet loads. The game's `app.js` removes it once the game is ready and at least 3 seconds have elapsed.

## Open / close animation

The iframe is wrapped in `#frame-wrap`. On open, the wrap is positioned at the tapped tile's bounding rect with `transform: translate(...) scale(...)` and `border-radius: 16px`, then transitioned to fullscreen. A `.frame-skin` layer carries the tile's gradient + icon + name + tagline so the wrap visually reads as the card at the small end. The skin and iframe crossfade in 220ms — faster than the wrap's 550ms size animation — so the user sees the card design morph into the game smoothly. Close runs the same animation in reverse.

## Deployment

GitHub Pages serves the repo root via a workflow at `.github/workflows/pages.yml`. Pushes to `main` redeploy automatically.

## Themes

`themes.css` defines variables per `[data-theme="..."]`:
- `dark` (default), `light`, `space`, `sunset`
- `mono`, `solarized`, `gameboy` (classic, gradient-free)

`theme.js` reads `localStorage.getItem('arcade-theme')` and wires the swatch buttons. The choice persists. Games never read this — they're standalone black.

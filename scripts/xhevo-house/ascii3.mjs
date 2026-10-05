/* the living room and kitchen in detail: 0.125 m per column across (z), 0.25 m per row down (x) */
const DZ = 0.125, DX = 0.25, Z1 = 7.0, X0 = 5.2, W = 57, H = 24;
const g = Array.from({ length: H }, () => Array(W).fill(' '));
const c = (z) => Math.round((Z1 - z) / DZ), r = (x) => Math.round((x - X0) / DX);
const put = (i, j, ch) => { if (i < 0 || i >= H || j < 0 || j >= W) return; const o = g[i][j]; g[i][j] = (o === ' ' || o === ch) ? ch : (o === '+' ? '+' : ((o === '-' && ch === '|') || (o === '|' && ch === '-')) ? '+' : ch); };
const box = (x0, x1, z0, z1) => { const [ra, rb, ca, cb] = [r(x0), r(x1), c(z1), c(z0)]; for (let j = ca; j <= cb; j++) { put(ra, j, '-'); put(rb, j, '-'); } for (let i = ra; i <= rb; i++) { put(i, ca, '|'); put(i, cb, '|'); } for (const [i, j] of [[ra, ca], [ra, cb], [rb, ca], [rb, cb]]) g[i][j] = '+'; };
const fillc = (x0, x1, z0, z1, ch) => { for (let i = r(x0); i <= r(x1); i++) for (let j = c(z1); j <= c(z0); j++) if (i >= 0 && i < H && j >= 0 && j < W) g[i][j] = ch; };
const label = (x, z, s) => { const i = r(x); let j = c(z) - Math.floor(s.length / 2); for (const ch of s) { if (j >= 0 && j < W && i >= 0 && i < H) g[i][j] = ch; j++; } };
const gapX = (z, x0, x1) => { for (let i = r(x0); i <= r(x1); i++) g[i][c(z)] = ' '; };
const gapZ = (x, z0, z1) => { for (let j = c(z1); j <= c(z0); j++) g[r(x)][j] = ' '; };

/* the shell: the hall's open edge and the bedroom wall at the top, the yard wall left, the north wall right, the glass at the bottom */
box(5.4, 11, 0.3, 7);
fillc(5.4, 5.4, 1.55, 2.65, ' '); label(5.4, 2.1, ' hall 1.20 ');
for (let j = c(6.7); j <= c(0.3); j++) g[r(10.7)][j] = '=';
gapZ(10.7, 5.5, 6.5); label(10.45, 6.0, 'balcony door');
for (let i = r(8.9); i <= r(10.3); i++) g[i][c(7)] = '=';            // south window 1.40
for (let i = r(6.6); i <= r(7.3); i++) g[i][c(7)] = '=';             // a new 0.70 window over the sink
gapX(7, 7.55, 8.35); label(7.95, 6.3, 'yard door');                   // yard door 0.90, swings out
/* the closed stair, the breast with the fire and the TV */
box(5.4, 9.28, 0.3, 1.5);
label(6.4, 0.9, 'closed'); label(6.65, 0.9, 'stair'); label(6.9, 0.9, 'down'); label(7.4, 0.9, 'lid'); label(7.65, 0.9, '2.90');
box(7.0, 9.2, 1.5, 2.0);
label(7.3, 1.75, 'TV'); label(7.55, 1.75, 'up'); fillc(7.8, 8.6, 1.6, 1.9, 'F'); label(8.85, 1.75, 'logs');
/* kitchen: the run along the bedroom wall, the return along the south wall */
box(5.4, 6.0, 2.7, 6.7); label(5.7, 4.7, 'fridge oven worktop hob worktop');
box(6.0, 7.4, 6.1, 6.7); label(6.4, 6.4, 'wdw'); label(6.9, 6.4, 'sink');
/* dining under the south window */
box(8.2, 9.6, 5.6, 6.4); label(8.6, 6.0, 'table'); label(8.9, 6.0, '140'); label(9.2, 6.0, 'x80');
box(8.1, 9.7, 6.4, 6.7);
for (const x of [8.35, 9.05]) box(x, x + 0.4, 5.15, 5.6);
label(9.95, 6.0, 'bench'); 
/* sofa, coffee table, the reading chair in the glass corner, shelves on the stair box's face */
box(7.1, 8.9, 4.1, 5.0); label(7.6, 4.55, 'sofa'); label(7.9, 4.55, '180'); label(8.2, 4.55, 'x90');
box(7.5, 8.4, 3.0, 3.5); label(7.95, 3.25, 'cof');
box(9.7, 10.4, 0.5, 1.2); label(10.05, 0.85, 'chair');
box(5.6, 6.9, 1.5, 1.75); label(6.25, 1.62, 'shelves');
label(9.9, 3.0, 'to the balcony'); label(10.3, 3.5, 'the glass, 6.40 wide');
console.log('      yard (S)                                  north');
g.forEach((row, i) => console.log((X0 + i * DX).toFixed(2).padStart(5, " ") + " " + ' ' + row.join('')));
console.log('      ^ the glass gable; the hill side (the hall and the bedroom wall) is the top line');

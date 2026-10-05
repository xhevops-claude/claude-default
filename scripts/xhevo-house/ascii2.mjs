/* pipes-and-dashes plan: boxes drawn as outlines, doors as gaps, labels inside.
   hill at the top, glass at the bottom, yard left, north right; 0.25 m per column, 0.5 m per row */
const DZ = 0.25, DX = 0.5, Z1 = 7.0, X0 = 2.0, W = 29, H = 19;
const g = Array.from({ length: H }, () => Array(W).fill(' '));
const c = (z) => Math.round((Z1 - z) / DZ), r = (x) => Math.round((x - X0) / DX);
const put = (i, j, ch) => { if (i < 0 || i >= H || j < 0 || j >= W) return; const o = g[i][j]; g[i][j] = (o === ' ' || o === ch) ? ch : (o === '+' ? '+' : ((o === '-' && ch === '|') || (o === '|' && ch === '-')) ? '+' : ch); };
const box = (x0, x1, z0, z1) => { const [ra, rb, ca, cb] = [r(x0), r(x1), c(z1), c(z0)]; for (let j = ca; j <= cb; j++) { put(ra, j, '-'); put(rb, j, '-'); } for (let i = ra; i <= rb; i++) { put(i, ca, '|'); put(i, cb, '|'); } for (const [i, j] of [[ra, ca], [ra, cb], [rb, ca], [rb, cb]]) g[i][j] = '+'; };
const gapZ = (x, z0, z1) => { for (let j = c(z1) + 1; j < c(z0); j++) g[r(x)][j] = ' '; };   // a door in a wall that runs across (along z)
const gapX = (z, x0, x1) => { for (let i = r(x0) + 1; i < r(x1); i++) g[i][c(z)] = ' '; };   // a door in a wall that runs along x
const label = (x, z, s) => { const i = r(x); let j = c(z) - Math.floor(s.length / 2); for (const ch of s) { if (j >= 0 && j < W && i >= 0 && i < H) g[i][j] = ch; j++; } };

box(2, 11, 0, 7);                 // the house
box(2.3, 4.4, 0.3, 1.4);          // stair up: winders and the north leg
box(4.4, 5.7, 0.3, 1.4);          // landing of the garage flight
box(5.7, 9.3, 0.3, 1.5);          // the closed garage stair
box(9.3, 10.7, 0.3, 1.5);         // the free corner at the glass
box(2.3, 3.9, 1.4, 2.0);          // store under the winders, and the hall's bay
box(2.3, 3.9, 2.0, 4.1);          // toilet, under the stair's west leg, 0.40 longer now
box(3.9, 5.4, 1.4, 4.1);          // hall, its east side now the kitchen wall, open 1.20 by the stair box
box(2.3, 5.4, 4.2, 6.7);          // bedroom 3.00 x 2.50 net
box(5.4, 6.0, 2.7, 6.7);          // kitchen counter, 4.00 along the wall that now runs on to the opening
box(7.0, 9.2, 1.5, 2.0);          // the breast
box(5.4, 10.7, 1.5, 6.7);         // living room, the kitchen strip inside it
gapZ(5.4, 1.5, 2.7);              // the 1.20 opening from the hall, beside the closed stair
for (let j = c(6.7); j <= c(0.3); j++) g[r(11)][j] = '=';   // the glass gable
for (let j = c(5.4); j <= c(4.0); j++) g[r(2)][j] = '=';    // (unused: north has no windows)
g[r(2)].fill('-', 0, W); g[r(2)][0] = '+'; g[r(2)][W - 1] = '+';
for (let j = c(5.4); j <= c(4.0); j++) g[r(11)][j] = '=';
gapX(4.15, 4.2, 5.3);             // bedroom door 0.90 from the hall
gapZ(3.85, 2.8, 3.6);             // toilet door from the hall
gapX(1.45, 3.4, 3.9);             // the hall's bay opens to the store hatch side
for (let i = r(7.5) + 1; i < r(8.4) + 1; i++) g[i][c(7.0)] = ' ';   // yard door in the south wall
for (let i = r(3.7) + 1; i < r(5.1) + 1; i++) g[i][c(7.0)] = '=';   // bedroom window 1.40
for (let i = r(8.9) + 1; i < r(10.3) + 1; i++) g[i][c(7.0)] = '=';  // south window
for (let j = c(6.5); j <= c(5.5); j++) g[r(11)][j] = ' ';           // balcony door in the glass
label(3.3, 0.85, 'UP'); label(5.0, 0.85, 'LAND'); label(7.5, 0.9, 'DOWN'); label(10.0, 0.9, 'free');
label(2.9, 1.7, 'st'); label(2.9, 3.0, 'WC'); label(3.4, 3.0, '3.2');
label(4.6, 2.7, 'HALL'); label(5.0, 2.7, '5.6');
label(3.6, 5.45, 'BEDROOM'); label(4.1, 5.45, '3.00x2.50'); label(4.6, 5.45, '7.5');
label(5.7, 4.7, 'kitchen 4.00'); label(8.1, 1.75, 'TV');
label(7.6, 4.3, 'LIVING'); label(8.1, 4.3, '5.00x5.20'); label(8.6, 4.3, '27.2'); label(9.1, 4.3, 'open to roof');
label(10.0, 4.3, 'sofa');
console.log('    yard (S)                 north');
g.forEach((row, i) => console.log(String(X0 + i * DX).padStart(4, ' ').padEnd(5, ' ') + row.join('')));
console.log('     ^ glass gable 6.40 wide, 3.61 at the walls, 5.85 at the apex');

/* ── first floor ── */
const g2 = Array.from({ length: H }, () => Array(W).fill(' '));
const put2 = (i, j, ch) => { if (i < 0 || i >= H || j < 0 || j >= W) return; const o = g2[i][j]; g2[i][j] = (o === ' ' || o === ch) ? ch : (o === '+' ? '+' : ((o === '-' && ch === '|') || (o === '|' && ch === '-')) ? '+' : ch); };
const box2 = (x0, x1, z0, z1) => { const [ra, rb, ca, cb] = [r(x0), r(x1), c(z1), c(z0)]; for (let j = ca; j <= cb; j++) { put2(ra, j, '-'); put2(rb, j, '-'); } for (let i = ra; i <= rb; i++) { put2(i, ca, '|'); put2(i, cb, '|'); } for (const [i, j] of [[ra, ca], [ra, cb], [rb, ca], [rb, cb]]) g2[i][j] = '+'; };
const label2 = (x, z, s) => { const i = r(x); let j = c(z) - Math.floor(s.length / 2); for (const ch of s) { if (j >= 0 && j < W && i >= 0 && i < H) g2[i][j] = ch; j++; } };
box2(2, 5.7, 0, 7);               // the first floor's outline (the back of the house)
box2(2.3, 3.3, 0.3, 3.73);        // stairwell
box2(3.4, 5.6, 0.3, 3.6);         // north bedroom
box2(2.3, 4.5, 3.73, 4.5);        // landing
box2(4.6, 5.6, 3.7, 4.5);         // cupboard
box2(2.3, 5.6, 4.6, 6.7);         // south bedroom
for (let i = r(3.6) + 1; i < r(3.7) + 1; i++) {}                     // (doors below)
g2[r(3.65)][c(4.3)] = ' '; g2[r(3.65)][c(3.9)] = ' '; g2[r(3.65)][c(3.5)] = ' ';   // north bedroom door 0.80 off the landing
g2[r(4.55)][c(4.3)] = ' '; g2[r(4.55)][c(3.9)] = ' '; g2[r(4.55)][c(3.5)] = ' ';   // south bedroom door
for (let j = c(3.2); j <= c(1.6); j++) g2[r(5.65)][j] = '=';          // north window onto the tall room
for (let j = c(5.8); j <= c(4.6); j++) g2[r(5.65)][j] = '=';          // south window onto the tall room
label2(2.8, 2.0, 'STAIR'); label2(4.3, 1.95, 'NORTH BED'); label2(4.8, 1.95, '2.20x3.30'); label2(5.3, 1.95, '7.3');
label2(4.1, 4.1, 'ld'); label2(4.1, 4.1, 'ld');
label2(3.3, 5.65, 'S BED'); label2(3.8, 5.65, '3.3x2.1'); label2(4.3, 5.65, '6.9'); label2(4.9, 5.65, 'roof wdw');
console.log('\n    yard (S)                 north');
g2.forEach((row, i) => { if (i <= r(5.7)) console.log(String(X0 + i * DX).padStart(4, ' ').padEnd(5, ' ') + row.join('')); });
console.log('     the living room is below here, open to the roof; the bedrooms\' windows (=) look into it and through the glass');

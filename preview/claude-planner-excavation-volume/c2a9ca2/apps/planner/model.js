/* Derivation: everything the scene implies but does not say, computed
   from the scene's data alone — the terrain profile and the road, the
   cut with its ramp, fillet and mouth, the driveway's stations, the
   levels and works as volumes, the framing box. No three.js here: this
   is the model the renderer draws and the analysis measures. */

export function deriveModel(PLAN) {
  const SLAB = PLAN.slab || 0.2;
  const WALL = PLAN.wall || 0.3;
  /* Everything that follows the ground across the front — slabs, walls,
     the ground grid over the driveway — is sampled at these intervals, so
     lines that should coincide do. */
  const STEP = 0.5;
  const TER = PLAN.terrain || null;
  /* With no house in the plan, the envelope is an empty box at the origin. */
  const e = PLAN.envelope || { x0: 0, y0: 0, x1: 0, y1: 0 };
  /* The house turned about its south-east corner — the corner the fillet
     hangs off — by `turn` degrees, clockwise seen from above. H() takes
     a point in the house's own frame (the envelope's axes) to the
     model's; everything else in the model lies on the frontage's axes. */
  const TURN = ((PLAN.turn || 0) * Math.PI) / 180;
  const PIVOT = [e.x1, e.y1];
  const H = (x, z) => {
    if (!TURN) return [x, z];
    const dx = x - PIVOT[0], dz = z - PIVOT[1];
    return [PIVOT[0] + dx * Math.cos(TURN) + dz * Math.sin(TURN), PIVOT[1] - dx * Math.sin(TURN) + dz * Math.cos(TURN)];
  };


  const FRONT = {
    axis: (TER?.front || '+Z').toUpperCase().includes('X') ? 'x' : 'z',
    sign: (TER?.front || '+Z').startsWith('-') ? -1 : 1,
  };

  /* The road's level across the front — the foot of the hill — from
     terrain.road, straight between its points and held beyond them. A
     profile level written as 'road' resolves to this at that position. */
  const ROAD = TER?.road ? TER.road.slice().sort((a, b) => a[0] - b[0]) : null;
  const ROAD_MIN = ROAD ? Math.min(...ROAD.map(([, y]) => y)) : (TER ? TER.profile[TER.profile.length - 1][1] : 0);
  function roadLevel(across) {
    if (!ROAD) return ROAD_MIN;
    if (across <= ROAD[0][0]) return ROAD[0][1];
    for (let i = 1; i < ROAD.length; i++) {
      const [a0, y0] = ROAD[i - 1], [a1, y1] = ROAD[i];
      if (across <= a1) return y0 + ((y1 - y0) * (across - a0)) / (a1 - a0);
    }
    return ROAD[ROAD.length - 1][1];
  }

  /* One solid per level, stacked without gaps: a level owns the slab
     under it, so its underside meets the top of the level below. A level
     with `extendFront` is pushed out of the downhill face by that much. */
  const VOLS = PLAN.levels.map((l) => {
    const out = l.extendFront || 0;
    const v = {
      id: l.id, name: l.name, group: l.group || 'house', house: true,
      x0: e.x0, x1: e.x1, z0: e.y0, z1: e.y1,
      y0: l.elevation - SLAB,
      y1: l.elevation + l.height,
    };
    if (out) {
      const lo = FRONT.axis === 'x' ? 'x0' : 'z0', hi = FRONT.axis === 'x' ? 'x1' : 'z1';
      if (FRONT.sign > 0) v[hi] += out; else v[lo] -= out;
    }
    return v;
  });

  for (const w of PLAN.works || []) VOLS.push({ ...w });

  /* The camera frames everything except volumes that ask to be left out
     of it — a road that runs off the edge of the site would otherwise
     shrink the house to a speck. */
  const FRAMED = VOLS.filter((v) => v.frame !== false);
  const span = (key, fn) => fn(...FRAMED.flatMap((v) => [v[key], v[`${key}End`] ?? v[key]]).filter((n) => typeof n === 'number'));
  const BOX = {
    x0: span('x0', Math.min), x1: span('x1', Math.max),
    z0: span('z0', Math.min), z1: span('z1', Math.max),
    y0: span('y0', Math.min), y1: span('y1', Math.max),
  };
  /* Volumes that ride the road or the ramp carry no number to span, so
     the road's low point stands in for their bottoms. The parcel and what
     already stands on it are the site, so they are framed too. */
  if (TER) BOX.y0 = Math.min(BOX.y0, ROAD_MIN);
  const OUTLINES = [PLAN.parcel, PLAN.existing, ...(PLAN.outlines || [])].filter(Boolean);
  /* Polygon prisms — a building's floors, a buildable area — are framed
     by their rings and their heights. */
  const PRISMS = [];
  for (const b of PLAN.buildings || []) for (const f of b.floors) PRISMS.push({ ring: f.ring, y0: f.elevation - SLAB, y1: f.elevation + f.height });
  for (const v of PLAN.envelopes || []) PRISMS.push({ ring: v.ring, y0: v.y0, y1: v.y1 });
  for (const p of PRISMS) for (const [x, z] of p.ring) {
    BOX.x0 = Math.min(BOX.x0, x); BOX.x1 = Math.max(BOX.x1, x);
    BOX.z0 = Math.min(BOX.z0, z); BOX.z1 = Math.max(BOX.z1, z);
    BOX.y0 = Math.min(BOX.y0, p.y0); BOX.y1 = Math.max(BOX.y1, p.y1);
  }
  for (const o of OUTLINES) for (const [x, y, z] of o.points) {
    BOX.x0 = Math.min(BOX.x0, x); BOX.x1 = Math.max(BOX.x1, x);
    BOX.z0 = Math.min(BOX.z0, z); BOX.z1 = Math.max(BOX.z1, z);
    BOX.y0 = Math.min(BOX.y0, y); BOX.y1 = Math.max(BOX.y1, y);
  }
  /* An empty plan still needs something to frame: a 10 m cube at the
     origin, so the camera and the gizmo have somewhere to be. */
  if (!Number.isFinite(BOX.x0)) Object.assign(BOX, { x0: -5, x1: 5, y0: -5, y1: 5, z0: -5, z1: 5 });
  BOX.cx = (BOX.x0 + BOX.x1) / 2;
  BOX.cy = (BOX.y0 + BOX.y1) / 2;
  BOX.cz = (BOX.z0 + BOX.z1) / 2;
  BOX.r = Math.hypot(BOX.x1 - BOX.x0, BOX.y1 - BOX.y0, BOX.z1 - BOX.z0) / 2;

  /* Ground level at a point. Level under the whole envelope, then from
     the downhill face it follows terrain.profile: straight runs between
     its points, and a vertical step where two points share a distance.
     At a step the lower side wins, so a sample on the line lands at the
     foot of the wall, not the top. Inside terrain.cut's band across the
     front, the cut's own profile is used instead — that is the driveway
     dug into the slope in front of the garage, and only there. */
  const FACE = !TER ? 0 : FRONT.axis === 'x'
    ? (FRONT.sign > 0 ? e.x1 : e.x0)
    : (FRONT.sign > 0 ? e.y1 : e.y0);
  const PROFILE = TER ? [[0, TER.backLevel], ...TER.profile] : [];
  const CUT = TER?.cut ? { ...TER.cut, profile: [[0, TER.backLevel], ...TER.cut.profile] } : null;
  /* The cut's near edge across the front, `d` metres out from the face:
     a number, or a line of [d, across] points — the boundary — straight
     between them and held beyond. */
  const cutFrom = (d) => (typeof CUT.from === 'number' ? CUT.from : sampleProfile(CUT.from, d, 0));

  function sampleProfile(prof, d, across) {
    const lv = (y) => (y === 'road' ? roadLevel(across) : y);
    let i = 0;
    while (i + 1 < prof.length && prof[i + 1][0] <= d) i++;
    const [d0, y0] = prof[i];
    if (i + 1 >= prof.length || d <= d0) return lv(y0);
    const [d1, y1] = prof[i + 1];
    return lv(y0) + ((lv(y1) - lv(y0)) * (d - d0)) / (d1 - d0);
  }

  /* The natural hill, `d` metres out from the face at `across`. */
  const natural = (d, across) => sampleProfile(PROFILE, d, across);

  /* Where the outer retaining wall stands: the cut profile's first
     vertical step beyond the ramp's uphill edge (the step at the door
     does not count). Beyond it the cut is the road, whatever the ramp
     is doing. */
  const WALL_D = (() => {
    if (!CUT) return Infinity;
    const dFrom = CUT.ramp?.dFrom ?? 0;
    const step = CUT.profile.find(([d], i) => i && d > dFrom && d === CUT.profile[i - 1][0]);
    return step ? step[0] : CUT.profile[CUT.profile.length - 1][0];
  })();

  /* Where the house ends across the front, on the ramp's side. In front
     of the house the apron's cut runs the full width whatever the ramp
     is doing; the hill only begins past this line. */
  const HOUSE_EDGE = FRONT.axis === 'x' ? e.y1 : e.x1;

  /* The quarter-round cut into the inside corner where the apron turns
     onto the ramp. The corner is where the ramp's uphill edge passes the
     house's corner; the circle's centre sits `r` in from it both ways,
     so the arc is tangent to the house's edge line and to the ramp's
     uphill edge. Everything here is in (along, across). */
  const FILLET = (() => {
    const f = CUT?.fillet, r = CUT?.ramp;
    if (!f || !r) return null;
    const dFrom = r.dFrom ?? 0;
    /* With the house turned, its south edge line leaves the corner at
       -TURN, so the circle tangent to it there and to the ramp's edge is
       smaller: r (1 + sin TURN) = dFrom. Its centre is r along the turned
       edge's normal from the corner, and the arc runs from the corner
       (at -TURN from the centre's north) round to the ramp's edge. */
    const rad = f.r ?? dFrom / (1 + Math.sin(TURN));
    const corner = { along: FACE + FRONT.sign * dFrom, across: Math.max(r.from, HOUSE_EDGE) };
    const centre = { along: corner.along - FRONT.sign * rad, across: corner.across + rad * Math.cos(TURN) };
    return { r: rad, corner, centre };
  })();

  /* Inside the rounded hill corner: the part of the fillet's circle that
     is still hill (its centre's side of the arc), within the cut. */
  function insideFillet(along, across) {
    if (!FILLET) return false;
    const { r, corner, centre } = FILLET;
    const da = (corner.along - along) * FRONT.sign;
    if (da < 0 || across > centre.across) return false;
    return Math.hypot(along - centre.along, across - centre.across) < r - 1e-9;
  }
  function inFillet(along, across) {
    if (!FILLET) return false;
    const { r, corner, centre } = FILLET;
    const da = (corner.along - along) * FRONT.sign;
    if (da < 0 || da > r || across < corner.across || across > centre.across) return false;
    return Math.hypot(along - centre.along, across - centre.across) >= r - 1e-9;
  }

  /* How far down the ramp a position across the front is, 0 at the top
     and 1 at the bottom — with the grade easing in and out over `ease`
     of the run at each end, so the floor curves into the flats rather
     than hinging. Between, the grade is constant and steeper by 1/(1-e)
     to make up the same drop. */
  function rampT(across) {
    const r = CUT.ramp;
    const t = Math.min(1, Math.max(0, (across - r.from) / (r.to - r.from)));
    const e = Math.min(0.5, Math.max(0, r.ease || 0));
    if (!e) return t;
    const s = 1 / (1 - e);
    if (t < e) return (s * t * t) / (2 * e);
    if (t > 1 - e) return 1 - (s * (1 - t) * (1 - t)) / (2 * e);
    return s * (e / 2 + (t - e));
  }

  /* The entrance, over the property's last `flare` metres: the hill is
     cut back along a quarter-ellipse centred on the outer wall line at
     the property's end, one semi-axis the ramp's width and the other
     `flare` back along the road. The arc leaves the ramp's uphill edge
     tangentially, so the wall beside it stays at full height for a
     while, then sweeps out to meet the road's edge. Everything between
     the arc and the outer wall line is the driveway's floor. In
     (d, across), where d is metres out from the house face. */
  const MOUTH = (() => {
    const m = CUT?.mouth, r = CUT?.ramp;
    if (!m || !r) return null;
    const dFrom = r.dFrom ?? 0;
    return { a: WALL_D - dFrom, b: m.flare, d0: WALL_D, dFrom, across0: CUT.to - m.flare };
  })();

  function inMouth(d, across) {
    if (!MOUTH) return false;
    const { a, b, d0, across0 } = MOUTH;
    const u = (across - across0) / b;
    if (u < 0 || u > 1 || d > d0) return false;
    const edge = d0 - a * Math.sqrt(Math.max(0, 1 - u * u));
    return d >= edge;
  }

  /* The driveway's surface at a position across the front: the apron's
     level up to ramp.from, the road's own surface from ramp.to on (the
     landing), and between them the eased grade from the one to the
     other. */
  function rampLevel(across) {
    const r = CUT.ramp;
    const base = sampleProfile(CUT.profile, r.dFrom ?? 0, across);
    if (across <= r.from) return base;
    if (across >= r.to) return roadLevel(across);
    return base - (base - roadLevel(r.to)) * rampT(across);
  }

  /* The driveway's outline, station by station across the front from the
     apron's edge to the property's end: `edge(c)` is the cut line — the
     fillet's arc, then the straight run `dFrom` out, then the mouth's arc
     — and `edge(c, off)` the same line `off` metres into the hill, which is
     where a wall's far face goes. The stations are every STEP plus every
     bend of both arcs, and everything that follows the driveway (its slab,
     the walls beside it, the ground grid) is built on exactly these, so
     their lines coincide. */
  const DRIVE = (() => {
    if (!CUT?.ramp) return null;
    const r = CUT.ramp, dFrom = r.dFrom ?? 0;
    const set = new Set();
    for (let a = r.from; a < CUT.to - 1e-6; a += STEP) set.add(+a.toFixed(6));
    set.add(CUT.to);
    set.add(r.to);
    if (FILLET) {
      set.add(FILLET.centre.across);
      for (let i = 0; i <= 12; i++) set.add(+(FILLET.centre.across - FILLET.r * Math.cos((i / 12) * (Math.PI / 2))).toFixed(6));
    }
    if (MOUTH) {
      set.add(MOUTH.across0);
      for (let i = 0; i <= 14; i++) set.add(+(MOUTH.across0 + MOUTH.b * Math.sin((i / 14) * (Math.PI / 2))).toFixed(6));
    }
    const stations = [...set].filter((c) => c >= r.from - 1e-9 && c <= CUT.to + 1e-9).sort((a, b) => a - b);
    /* The cut line's d at a station. */
    const edge = (c) => {
      if (FILLET && c < FILLET.centre.across) {
        const dc = dFrom - FILLET.r;
        return dc + Math.sqrt(Math.max(0, FILLET.r ** 2 - (c - FILLET.centre.across) ** 2));
      }
      if (MOUTH && c > MOUTH.across0) {
        const u = (c - MOUTH.across0) / MOUTH.b;
        return MOUTH.d0 - MOUTH.a * Math.sqrt(Math.max(0, 1 - u * u));
      }
      return dFrom;
    };
    /* The wall's far face for the cut point at a station: WALL into the
       hill along the line's normal — on an arc that is the same angle on
       the offset arc, so the point moves across as well as out, and the
       wall's top can be read at the ground it actually stands in. */
    const hill = (c) => {
      if (FILLET && c < FILLET.centre.across) {
        const { r: rad, centre } = FILLET;
        const dc = dFrom - rad;
        const cos = (centre.across - c) / rad, sin = (edge(c) - dc) / rad;
        return [dc + (rad - WALL) * sin, centre.across - (rad - WALL) * cos];
      }
      if (MOUTH && c > MOUTH.across0) {
        const { a, b, d0, across0 } = MOUTH;
        const sin = (c - across0) / b, cos = Math.sqrt(Math.max(0, 1 - sin * sin));
        return [d0 - (a + WALL) * cos, across0 + (b + WALL) * sin];
      }
      return [dFrom - WALL, c];
    };
    return { stations, edge, hill, outer: WALL_D, dFrom };
  })();

  function groundY(x, z) {
    if (!TER) return BOX.y0;
    const along = FRONT.axis === 'x' ? x : z;
    const across = FRONT.axis === 'x' ? z : x;
    const d = (along - FACE) * FRONT.sign;
    if (!CUT || across < cutFrom(d) || across > CUT.to) return natural(d, across);
    /* The turned house's east face runs west of the face line north of
       the corner; the cut's floor reaches it. */
    const dFace = faceD(across);
    if (d < dFace) return sampleProfile(CUT.profile, d, across);
    const base = sampleProfile(CUT.profile, Math.max(d, 0), across);
    if (!CUT.ramp) return base;
    const r = CUT.ramp;
    if (insideFillet(along, across)) return natural(d, across);
    if (across <= r.from || d >= WALL_D) return base;
    if (MOUTH && across >= MOUTH.across0) return inMouth(d, across) ? rampLevel(across) : natural(d, across);
    if (d < (r.dFrom ?? 0)) {
      if (across <= HOUSE_EDGE) return base;
      if (!inFillet(along, across)) return natural(d, across);
    }
    return rampLevel(across);
  }
  /* Where the house's east face stands, in d, at a position across the
     front: on the face line for a house that is not turned; for one that
     is, west of it by the turn north of the corner, and nowhere south of
     the corner (there the house's own south edge line takes over). */
  function faceD(across) {
    if (!TURN || across > HOUSE_EDGE) return 0;
    return -(HOUSE_EDGE - across) * Math.tan(TURN);
  }

  return { SLAB, WALL, STEP, TER, e, TURN, PIVOT, H, FRONT, ROAD, ROAD_MIN, roadLevel, VOLS, FRAMED, BOX, OUTLINES, PRISMS, FACE, PROFILE, CUT, cutFrom, sampleProfile, natural, WALL_D, HOUSE_EDGE, FILLET, insideFillet, inFillet, rampT, MOUTH, inMouth, rampLevel, DRIVE, groundY, faceD };
}

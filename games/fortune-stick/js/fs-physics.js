/*
 * fs-physics.js  —  NEW (Wan Wan redesign). Pure maths, no DOM, no drawing, no randomness of its own.
 * ------------------------------------------------------------------------------------------------
 * Replaces the hand-tuned "force field" stick loop of the original port (per-frame clamps of y / x /
 * angle, a special stick #0, a separate un-physical "drop stick") with ONE small rigid-body model:
 *
 *   - every stick is a rod (capsule) with mass ~ length * width and the matching moment of inertia,
 *     so different looking sticks differ ONLY by size (no hidden per-stick fudge factors);
 *   - Tube  : the sticks inside the cylinder are simulated in the cylinder's own (moving, rotating)
 *             frame. The frame's measured acceleration / angular acceleration are applied as the real
 *             fictitious forces (translation, Euler, centrifugal, Coriolis), so shaking up/down,
 *             sideways or tilting makes the sticks respond in the order the motion really happened;
 *   - contacts: stick<->wall, stick<->floor, stick<->rim (the point where the rod crosses the mouth
 *             plane) and stick<->stick (same depth layer only, see below) are solved with
 *             sequential impulses (restitution + Coulomb friction) + position projection. Contact
 *             impulses act off-centre, so a hit changes the rotation too;
 *   - free  : the stick that is shaken out leaves the Tube with its real position / angle / velocity
 *             (converted to world space by the caller) and is integrated with gravity, angular
 *             velocity and ground contacts at both ends until it really comes to rest. Its angle is
 *             never assigned, only integrated, so there is no flip at landing.
 *
 * Depth layers: the real bundle is 3-D, the view is a side view. Sticks get a depth layer (0 = back);
 * only sticks in the same layer collide with each other (sticks in different layers pass in front of /
 * behind each other, which is also how they are drawn).
 *
 * Units: px, frames of 1/60 s (dt = 1 means one 60 fps frame). Angle convention = canvas rotate():
 * a rod with angle a has axis u = (-sin a, cos a) pointing from its top end towards its bottom end.
 * Local (tube) frame: origin = centre of the cylinder mouth, x right, y down.
 */
(function (global) {
  'use strict';

  var CFG = {
    halfWidth: 40,        // inner half width of the cylinder (px)
    floorY: 174,          // inner floor, measured from the mouth plane (px)
    retainBottom: 62,     // a stick's lower end can never rise above this depth (the bundle holds it)
    pivotY: 210,          // rotation pivot of the cylinder (bottom centre), local y
    gravity: 0.9,         // px / frame^2 inside the cylinder
    transGain: 1.5,       // gain on the measured translational acceleration of the cylinder
    accelCap: 6,          // |acceleration| limit (px / frame^2) = 4 x gravity
    rotGain: 1,           // gain on the measured angular acceleration
    linDrag: 0.035,       // 1 / frame   (friction with the bundle)
    angDrag: 0.07,        // 1 / frame
    eWall: 0.22, eStick: 0.18, eRetain: 0.05,
    mu: 0.5,              // Coulomb friction between sticks / walls (wood on lacquer)
    layers: 7,
    iterations: 10,
    slop: 0.2, beta: 0.7, maxCorr: 8,
    restDrag: 0.6, restAngDrag: 0.6, restSpeed: 0.8,   // extra friction for sticks that are touching and slow
    liftMax: 64, liftK: 0.012, liftCap: 0.5   // progress feedback (see Tube.step)
  };

  // world (free stick) defaults
  var WORLD = { gravity: 0.38, linDrag: 0.0015, angDrag: 0.002, eGround: 0.3, muGround: 0.5, eSide: 0.4, iterations: 6 };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function makeBody(len, wid, layer) {
    var m = len * wid / 1000;
    return {
      x: 0, y: 0, a: 0, vx: 0, vy: 0, w: 0,
      hl: len / 2, hw: wid / 2, len: len, wid: wid,
      m: m, invM: 1 / m, I: m * (len * len + wid * wid) / 12, invI: 12 / (m * (len * len + wid * wid)),
      layer: layer | 0,
      touch: false,         // had a contact in the last sub step (used for rest friction)
      age: 0, tries: 0,
      ejecting: false,      // being shaken out: still inside / scraping the rim, no floor / retainer
      sprite: null, shade: '', seed: 0
    };
  }

  /* -------------------------------------------------------------------- contact solver (shared) */
  function Solver() { this.list = []; this.n = 0; this.maxPen = 0; this.impact = 0; }
  Solver.prototype.begin = function () { this.n = 0; };
  // A (body), B (body | null = static). (px,py) = contact point (world/local, same space as bodies),
  // (nx,ny) = unit normal pointing from A into B, pen > 0 means overlap, e = restitution, mu = friction
  Solver.prototype.add = function (A, B, px, py, nx, ny, pen, e, mu) {
    var c = this.list[this.n];
    if (!c) { c = this.list[this.n] = {}; }
    this.n++;
    c.A = A; c.B = B; c.nx = nx; c.ny = ny; c.pen = pen; c.e = e; c.mu = mu; c.jn = 0; c.jt = 0;
    A.touch = true; if (B) B.touch = true;
    c.rax = px - A.x; c.ray = py - A.y;
    var kn, kt, tx = -ny, ty = nx, ran, rat, rbn = 0, rbt = 0, invMb = 0, invIb = 0;
    ran = c.rax * ny - c.ray * nx;     // r x n
    rat = c.rax * ty - c.ray * tx;     // r x t
    kn = A.invM + ran * ran * A.invI;
    kt = A.invM + rat * rat * A.invI;
    if (B) {
      c.rbx = px - B.x; c.rby = py - B.y;
      rbn = c.rbx * ny - c.rby * nx;
      rbt = c.rbx * ty - c.rby * tx;
      kn += B.invM + rbn * rbn * B.invI;
      kt += B.invM + rbt * rbt * B.invI;
    } else { c.rbx = 0; c.rby = 0; }
    c.mn = 1 / kn; c.mt = 1 / kt;
    // restitution target from the approach speed BEFORE solving (only for real impacts)
    var vax = A.vx - A.w * c.ray, vay = A.vy + A.w * c.rax, vbx = 0, vby = 0;
    if (B) { vbx = B.vx - B.w * c.rby; vby = B.vy + B.w * c.rbx; }
    var vn = (vbx - vax) * nx + (vby - vay) * ny;
    c.bounce = vn < -0.6 ? e * vn : 0;
    if (vn < -0.15 && -vn > this.impact) this.impact = -vn;
    if (pen > this.maxPen) this.maxPen = pen;
    return c;
  };
  Solver.prototype.solveVelocity = function (iters) {
    var list = this.list, n = this.n, it, i, c, A, B, nx, ny, tx, ty, vax, vay, vbx, vby, rvx, rvy, vn, vt, j, nj, jt, lim;
    for (it = 0; it < iters; it++) {
      for (i = 0; i < n; i++) {
        c = list[i]; A = c.A; B = c.B; nx = c.nx; ny = c.ny; tx = -ny; ty = nx;
        // ---- normal
        vax = A.vx - A.w * c.ray; vay = A.vy + A.w * c.rax; vbx = 0; vby = 0;
        if (B) { vbx = B.vx - B.w * c.rby; vby = B.vy + B.w * c.rbx; }
        rvx = vbx - vax; rvy = vby - vay;
        vn = rvx * nx + rvy * ny;
        j = -(vn + c.bounce) * c.mn;
        nj = c.jn + j; if (nj < 0) nj = 0; j = nj - c.jn; c.jn = nj;
        if (j !== 0) {
          A.vx -= A.invM * j * nx; A.vy -= A.invM * j * ny; A.w -= A.invI * (c.rax * ny - c.ray * nx) * j;
          if (B) { B.vx += B.invM * j * nx; B.vy += B.invM * j * ny; B.w += B.invI * (c.rbx * ny - c.rby * nx) * j; }
        }
        // ---- friction
        vax = A.vx - A.w * c.ray; vay = A.vy + A.w * c.rax; vbx = 0; vby = 0;
        if (B) { vbx = B.vx - B.w * c.rby; vby = B.vy + B.w * c.rbx; }
        vt = (vbx - vax) * tx + (vby - vay) * ty;
        jt = -vt * c.mt; lim = c.mu * c.jn;
        nj = clamp(c.jt + jt, -lim, lim); jt = nj - c.jt; c.jt = nj;
        if (jt !== 0) {
          A.vx -= A.invM * jt * tx; A.vy -= A.invM * jt * ty; A.w -= A.invI * (c.rax * ty - c.ray * tx) * jt;
          if (B) { B.vx += B.invM * jt * tx; B.vy += B.invM * jt * ty; B.w += B.invI * (c.rbx * ty - c.rby * tx) * jt; }
        }
      }
    }
  };
  Solver.prototype.correctPositions = function (slop, beta, maxCorr) {
    var list = this.list, n = this.n, i, c, A, B, corr, d, nx, ny;
    for (i = 0; i < n; i++) {
      c = list[i]; corr = (c.pen - slop) * beta;
      if (corr <= 0) continue;
      if (corr > maxCorr) corr = maxCorr;
      A = c.A; B = c.B; nx = c.nx; ny = c.ny; d = corr * c.mn;
      A.x -= A.invM * d * nx; A.y -= A.invM * d * ny; A.a -= A.invI * (c.rax * ny - c.ray * nx) * d;
      if (B) { B.x += B.invM * d * nx; B.y += B.invM * d * ny; B.a += B.invI * (c.rbx * ny - c.rby * nx) * d; }
    }
  };

  /* ------------------------------------------------------------------ closest points of 2 rods */
  var _cp = { qax: 0, qay: 0, qbx: 0, qby: 0 };
  function closestPoints(A, B) {
    var uax = -Math.sin(A.a), uay = Math.cos(A.a), ubx = -Math.sin(B.a), uby = Math.cos(B.a);
    var rx = A.x - B.x, ry = A.y - B.y;
    var b = uax * ubx + uay * uby, c = uax * rx + uay * ry, f = ubx * rx + uby * ry;
    var denom = 1 - b * b, s, t, ha = A.hl, hb = B.hl;
    if (denom > 1e-4) {
      s = clamp((b * f - c) / denom, -ha, ha);
      t = f + s * b;
      if (t < -hb) { t = -hb; s = clamp(t * b - c, -ha, ha); } else if (t > hb) { t = hb; s = clamp(t * b - c, -ha, ha); }
    } else {
      // (anti)parallel: take the middle of the overlapping part, so a pressed pair gets a centred contact
      var lo = Math.max(-ha, -c - hb), hi = Math.min(ha, -c + hb);
      s = lo <= hi ? (lo + hi) / 2 : clamp(-c, -ha, ha);
      t = clamp(f + s * b, -hb, hb);
    }
    _cp.qax = A.x + uax * s; _cp.qay = A.y + uay * s;
    _cp.qbx = B.x + ubx * t; _cp.qby = B.y + uby * t;
    return _cp;
  }

  /* =========================================================================================== Tube */
  function Tube(options) {
    options = options || {};
    this.cfg = {};
    for (var k in CFG) this.cfg[k] = options[k] !== undefined ? options[k] : CFG[k];
    this.bodies = [];          // drawn in this order (sorted by depth layer, back first)
    this.lead = null;          // the stick that climbs with the shake progress
    this.solver = new Solver();
    this.impact = 0;           // strongest impact speed seen in the last step (drives the sound)
    this.maxPen = 0;
    this._ejected = null;
    this._pending = null;      // stick that left the bundle, waiting for the caller to take it
    this._missing = null;
    this._speed = 18;
    this.asleep = false;       // whole bundle at rest -> no simulation until the cylinder is moved again
    this._calm = 0;
  }

  // Create the bundle. makeStick() -> {len, wid, shade, seed, layerShade}; rnd() -> [0,1)
  Tube.prototype.populate = function (count, specFn, rnd) {
    var cfg = this.cfg, i, spec, b, layers = cfg.layers;
    var order = [];
    for (i = 0; i < count; i++) order.push(i % layers);
    // shuffle the layer assignment so neighbours in the array are not neighbours in depth
    for (i = order.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
    this.bodies = [];
    for (i = 0; i < count; i++) {
      spec = specFn(i);
      b = makeBody(spec.len, spec.wid, order[i]);
      b.shade = spec.shade; b.seed = spec.seed;
      this.bodies.push(b);
    }
    this.bodies.sort(function (p, q) { return p.layer - q.layer; });
    this._layout(rnd);
    this.pickLead(rnd);
    return this;
  };

  // stand every stick on the floor, spread inside its layer, with a small random lean
  Tube.prototype._layout = function (rnd) {
    var cfg = this.cfg, byLayer = [], i, b, L, n, k, span;
    for (i = 0; i < cfg.layers; i++) byLayer.push([]);
    for (i = 0; i < this.bodies.length; i++) byLayer[this.bodies[i].layer].push(this.bodies[i]);
    for (i = 0; i < byLayer.length; i++) {
      L = byLayer[i]; n = L.length;
      for (k = 0; k < n; k++) {
        b = L[k]; span = cfg.halfWidth - b.hw - 4;
        b.a = (rnd() - 0.5) * 0.08;
        b.vx = b.vy = b.w = 0; b.ejecting = false;
        // bottom end on the floor, centre of the rod follows from the lean
        var bx = n > 1 ? -span + 2 * span * (k + 0.15 + 0.7 * rnd()) / n : 0;
        b.x = bx - (-Math.sin(b.a)) * b.hl;           // centre = bottom end - u * hl
        b.y = cfg.floorY - Math.cos(b.a) * b.hl;
      }
    }
  };

  Tube.prototype.pickLead = function (rnd) {
    var n = this.bodies.length;
    this.lead = n ? this.bodies[Math.floor(rnd() * n)] : null;
    return this.lead;
  };

  // lowest point (largest y) / mouth crossing of a body, written into this._ends
  Tube.prototype.bottomY = function (b) { return b.y + Math.cos(b.a) * b.hl; };
  Tube.prototype.topY = function (b) { return b.y - Math.cos(b.a) * b.hl; };

  Tube.prototype._contacts = function (aliveCount, rnd) {
    var cfg = this.cfg, S = this.solver, bodies = this.bodies, n = bodies.length, i, j, b, o, d;
    var L = cfg.halfWidth;
    S.begin();
    for (i = 0; i < n; i++) {
      b = bodies[i];
      var ux = -Math.sin(b.a), uy = Math.cos(b.a);
      var tx = b.x - ux * b.hl, ty = b.y - uy * b.hl;      // top end
      var bx = b.x + ux * b.hl, by = b.y + uy * b.hl;      // bottom end
      if (by > 0) {
        // rim / wall point: where the rod crosses the mouth plane (or its top end if it is fully inside)
        var px, py;
        if (ty < 0) { var q = -ty / (by - ty); px = tx + (bx - tx) * q; py = 0; } else { px = tx; py = ty; }
        var lim = L - b.hw, mu = b.ejecting ? 0 : cfg.mu, ew = b.ejecting ? 0 : cfg.eWall;   // thrown stick slides on the wall
        if (px < -lim) S.add(b, null, px, py, -1, 0, -lim - px, ew, mu);
        else if (px > lim) S.add(b, null, px, py, 1, 0, px - lim, ew, mu);
        if (bx < -lim) S.add(b, null, bx, by, -1, 0, -lim - bx, ew, mu);
        else if (bx > lim) S.add(b, null, bx, by, 1, 0, bx - lim, ew, mu);
        if (by > cfg.floorY) S.add(b, null, bx, by, 0, 1, by - cfg.floorY, cfg.eWall, cfg.mu);   // never lost through the floor
        else if (!b.ejecting && by < cfg.retainBottom) S.add(b, null, bx, by, 0, -1, cfg.retainBottom - by, cfg.eRetain, 0);
      }
    }
    // stick <-> stick, same layer only (bodies are sorted by layer)
    for (i = 0; i < n; i++) {
      b = bodies[i];
      if (b.ejecting) continue;
      var ex = b.hl * Math.abs(Math.sin(b.a));
      for (j = i + 1; j < n; j++) {
        o = bodies[j];
        if (o.layer !== b.layer) break;
        if (o.ejecting) continue;
        d = b.hw + o.hw;
        if (Math.abs(b.x - o.x) > d + ex + o.hl * Math.abs(Math.sin(o.a))) continue;
        var cp = closestPoints(b, o);
        var dx = cp.qbx - cp.qax, dy = cp.qby - cp.qay, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= d) continue;
        var nx, ny;
        if (dist > 1e-5) { nx = dx / dist; ny = dy / dist; }
        else { var pxn = Math.cos(b.a), pyn = Math.sin(b.a); var sg = (o.x - b.x) * pxn + (o.y - b.y) * pyn >= 0 ? 1 : -1; nx = pxn * sg; ny = pyn * sg; }
        S.add(b, o, (cp.qax + cp.qbx) / 2, (cp.qay + cp.qby) / 2, nx, ny, d - dist, cfg.eStick, cfg.mu);
      }
    }
  };

  /*
   * drive = {
   *   ax, ay   acceleration of the cylinder pivot in the world (px / frame^2, y down)
   *   alpha    angular acceleration of the cylinder (rad / frame^2)      omega  its angular velocity (rad / frame)
   *   theta    cylinder angle (rad)
   *   jostle   0..1  how hard the cylinder is being worked (adds a small, unsynchronised per-stick jitter)
   *   progress 0..1  shake progress;  lift: true while the progress feedback may act
   * }
   * dt in 60 fps frames (caller clamps to <= 3). rnd() -> [0,1).
   */
  Tube.prototype.step = function (dt, drive, rnd) {
    var cfg = this.cfg, bodies = this.bodies, n = bodies.length, S = this.solver;
    if (!n) return;
    var still = Math.abs(drive.ax) < 0.02 && Math.abs(drive.ay) < 0.02 && Math.abs(drive.alpha) < 0.002 &&
      Math.abs(drive.omega) < 0.002 && !(drive.jostle > 0.03) && !(drive.lift && drive.progress > 0.02);
    if (this.asleep) {
      if (still && !this._pending) { this.impact = 0; this.maxPen = 0; return; }
      this.asleep = false; this._calm = 0;
    }
    var subs = clamp(Math.ceil(dt / 0.5), 1, 6), h = dt / subs;
    var sn = Math.sin(drive.theta), cs = Math.cos(drive.theta);
    var cap = cfg.accelCap;
    var wx = -clamp(drive.ax * cfg.transGain, -cap, cap), wy = cfg.gravity - clamp(drive.ay * cfg.transGain, -cap, cap);
    var lx = wx * cs + wy * sn, ly = -wx * sn + wy * cs;       // world acceleration expressed in the cylinder frame
    var alpha = drive.alpha * cfg.rotGain, om = drive.omega, om2 = om * om;
    var fl = Math.exp(-cfg.linDrag * h), fa = Math.exp(-cfg.angDrag * h);
    var jo = drive.jostle > 0.03 ? drive.jostle : 0;
    var lead = drive.lift && this.lead && !this.lead.ejecting ? this.lead : null;
    var liftTarget = cfg.floorY - cfg.liftMax * drive.progress;
    var s, i, b, rx, ry, bx, by, ax, ay, pass, dg = WORLD.gravity - cfg.gravity;
    this.impact = 0; this.maxPen = 0; S.impact = 0; S.maxPen = 0;
    var rl = Math.exp(-cfg.restDrag * h), ra = Math.exp(-cfg.restAngDrag * h);
    for (s = 0; s < subs; s++) {
      for (i = 0; i < n; i++) {
        b = bodies[i];
        rx = b.x; ry = b.y - cfg.pivotY;
        ax = lx + alpha * ry + om2 * rx + 2 * om * b.vy;
        ay = ly - alpha * rx + om2 * ry - 2 * om * b.vx;
        if (b.ejecting) {   // a stick that is being thrown out feels the lighter gravity of the open air
          ax += dg * sn; ay += dg * cs;
        }
        if (jo) {
          ax += (rnd() - 0.5) * 0.5 * jo;
          ay += (rnd() - 0.5) * 0.3 * jo;
          b.w += (rnd() - 0.5) * 0.004 * jo * h;
        }
        if (b === lead && drive.progress > 0.02) {
          bx = this.bottomY(b);
          var lf = clamp(cfg.liftK * (liftTarget - bx), -cfg.liftCap, 0);   // only ever pulls upwards
          ay += lf;
        }
        b.vx += ax * h; b.vy += ay * h; b.w -= alpha * h;     // a rotating frame also turns the rod's own angle
        if (!b.ejecting) { b.vx *= fl; b.vy *= fl; b.w *= fa; }
        // touching and slow -> settle (static friction with the bundle); fast or airborne sticks are untouched
        if (b.touch && b.vx * b.vx + b.vy * b.vy < cfg.restSpeed * cfg.restSpeed) { b.vx *= rl; b.vy *= rl; b.w *= ra; }
        b.x += b.vx * h; b.y += b.vy * h; b.a += b.w * h;
      }
      for (i = 0; i < n; i++) bodies[i].touch = false;
      for (pass = 0; pass < 3; pass++) {
        this._contacts(n, rnd);
        if (pass === 0) S.solveVelocity(cfg.iterations);
        S.correctPositions(cfg.slop, cfg.beta, cfg.maxCorr);
        if (S.maxPen > this.maxPen) this.maxPen = S.maxPen;
        if (S.impact > this.impact) this.impact = S.impact;
      }
    }
    // everything has been quiet for a while -> rest (frees the CPU while idle, and ends micro creeping)
    var fast = 0, i2;
    for (i2 = 0; i2 < n; i2++) {
      b = bodies[i2];
      var sp = Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.w) * b.hl * 0.5;
      if (sp > fast) fast = sp;
      if (b.ejecting) fast = 9;
    }
    if (still && fast < 0.2) {
      this._calm += dt;
      if (this._calm >= 40) { this.asleep = true; for (i2 = 0; i2 < n; i2++) { bodies[i2].vx = bodies[i2].vy = bodies[i2].w = 0; } }
    } else this._calm = 0;
    // a thrown stick that stalls before clearing the mouth gets thrown again (like one more jolt)
    for (i2 = 0; i2 < n; i2++) {
      b = bodies[i2];
      if (!b.ejecting) continue;
      b.age += dt;
      if (b.age > 22 && b.vy > -2 && this.bottomY(b) > -b.hw - 4 && b.tries < 5) {
        var kx = -Math.sin(b.a), ky = Math.cos(b.a);
        b.vx = -kx * this._speed; b.vy = -ky * this._speed; b.age = 0; b.tries++;
      }
    }
    // a stick that was shaken out has now fully left the mouth -> hand it over
    for (i = 0; i < n; i++) {
      b = bodies[i];
      if (b.ejecting && this.bottomY(b) < -b.hw - 4) {
        bodies.splice(i, 1);
        this._pending = b;
        this._missing = b;
        break;
      }
    }
  };

  // The caller launches this.lead (or the highest stick). Returns the body, or null.
  Tube.prototype.release = function (speed, rnd) {
    var b = this.lead && this.bodies.indexOf(this.lead) >= 0 ? this.lead : null;
    if (!b) {
      var top = 1e9, i;
      for (i = 0; i < this.bodies.length; i++) { var t = this.topY(this.bodies[i]); if (t < top) { top = t; b = this.bodies[i]; } }
    }
    if (!b) return null;
    b.ejecting = true; b.age = 0; b.tries = 0; this._speed = speed; this.asleep = false; this._calm = 0;
    // along the rod's axis towards its top end, like the last jolt of a real shake
    var ux = -Math.sin(b.a), uy = Math.cos(b.a);
    var sp = speed * (0.94 + 0.12 * rnd());
    b.vx += -ux * sp; b.vy += -uy * sp;
    b.w += (rnd() - 0.5) * 0.02;
    return b;
  };
  // last-resort safety net used by the engine: take the stick out of the bundle and hold it just above the mouth
  Tube.prototype.forceEject = function (b) {
    var i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
    this._missing = b; this._pending = null;
    b.x = 0; b.y = -b.hl - 24; b.a = 0; b.vx = 0; b.vy = -3; b.w = 0; b.ejecting = false;
  };
  // the body that cleared the mouth during the last step (once), else null
  Tube.prototype.takeEjected = function () { var b = this._pending; this._pending = null; return b; };

  // new round: calm everything, put a stick back where one is missing, choose a new lead
  Tube.prototype.reset = function (rnd) {
    var i, b, cfg = this.cfg;
    if (this._missing && this.bodies.indexOf(this._missing) < 0) {
      this.bodies.push(this._missing);
      this.bodies.sort(function (p, q) { return p.layer - q.layer; });
    }
    this._missing = null; this._pending = null; this.asleep = false; this._calm = 0;
    for (i = 0; i < this.bodies.length; i++) {
      b = this.bodies[i]; b.vx = b.vy = b.w = 0; b.ejecting = false;
    }
    // re-stand every stick (cheap, and removes any state left by an interrupted round)
    this._layout(rnd);
    this.pickLead(rnd);
  };

  /* ====================================================================================== free stick */
  // One stick in the open (world space). env = {groundY, minX, maxX, gravity?}. st = per-stick state.
  function createFreeState() {
    return { contacts: 0, landed: false, landedAt: 0, rest: false, restFrames: 0, t: 0, calm: 0 };
  }
  var _fs = new Solver();
  function stepFree(b, dt, env, st) {
    var g = env.gravity !== undefined ? env.gravity : WORLD.gravity;
    var subs = clamp(Math.ceil(dt / 0.5), 1, 6), h = dt / subs, s, pass;
    var fl = Math.exp(-WORLD.linDrag * h), fa = Math.exp(-WORLD.angDrag * h);
    // failsafe: if it keeps rattling for a long time after landing, bleed energy ever faster (never snap)
    var extra = 0;
    if (st.landed && st.t - st.landedAt > 150) extra = Math.min(0.5, (st.t - st.landedAt - 150) * 0.004);
    st.t += dt;
    st.contacts = 0;
    for (s = 0; s < subs; s++) {
      b.vy += g * h;
      b.vx *= fl; b.vy *= fl; b.w *= fa;
      if (extra) { var fx = Math.exp(-extra * h); b.vx *= fx; b.vy *= fx; b.w *= fx; }
      b.x += b.vx * h; b.y += b.vy * h; b.a += b.w * h;
      for (pass = 0; pass < 2; pass++) {
        _fs.begin(); _fs.impact = 0; _fs.maxPen = 0;
        var ux = -Math.sin(b.a), uy = Math.cos(b.a), ends = [-1, 1], e, ex, ey;
        for (e = 0; e < 2; e++) {
          ex = b.x + ux * b.hl * ends[e]; ey = b.y + uy * b.hl * ends[e];
          if (ey + b.hw > env.groundY) _fs.add(b, null, ex, ey + b.hw, 0, 1, ey + b.hw - env.groundY, WORLD.eGround, WORLD.muGround);
          if (ex - b.hw < env.minX) _fs.add(b, null, ex - b.hw, ey, -1, 0, env.minX - (ex - b.hw), WORLD.eSide, 0);
          else if (ex + b.hw > env.maxX) _fs.add(b, null, ex + b.hw, ey, 1, 0, ex + b.hw - env.maxX, WORLD.eSide, 0);
        }
        if (pass === 0) _fs.solveVelocity(WORLD.iterations);
        _fs.correctPositions(WORLD.slop || 0.1, 0.5, 4);
        if (_fs.n > 0 && pass === 0) st.contacts += _fs.n;
      }
    }
    if (st.contacts > 0 && !st.landed) { st.landed = true; st.landedAt = st.t; }
    // rest = lying on the ground (both ends touching), and quiet for a while
    var ux2 = -Math.sin(b.a), uy2 = Math.cos(b.a);
    var g1 = b.y - uy2 * b.hl + b.hw - env.groundY, g2 = b.y + uy2 * b.hl + b.hw - env.groundY;
    var flat = Math.abs(g1) < 1.5 && Math.abs(g2) < 1.5;
    var quiet = Math.sqrt(b.vx * b.vx + b.vy * b.vy) < 0.07 && Math.abs(b.w) < 0.004;
    if (st.landed && flat && quiet) st.restFrames += dt; else st.restFrames = 0;
    if (st.restFrames >= 10 && !st.rest) { st.rest = true; b.vx = b.vy = b.w = 0; }
    return st;
  }

  global.FSPhysics = {
    CFG: CFG, WORLD: WORLD,
    Tube: Tube, makeBody: makeBody, createFreeState: createFreeState, stepFree: stepFree,
    closestPoints: closestPoints
  };
})(typeof window !== 'undefined' ? window : globalThis);

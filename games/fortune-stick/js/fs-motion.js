/*
 * fs-motion.js  —  NEW FEATURE (NOT part of the original SpinAName source)
 * ------------------------------------------------------------------
 * The original site advertises "shake your phone" in its blog text but its code contains no
 * devicemotion handling at all (verified: no `devicemotion` / `DeviceMotion` / `deviceorientation`
 * string in any downloaded chunk). This module is therefore an extension written for this
 * standalone project. All thresholds below are design choices, not values from the source.
 *
 * Role: a pure INPUT SOURCE. It turns DeviceMotionEvent readings into a "virtual pointer
 * displacement" (px, py) and hands it to the host through onSignal(). The host (fortune-stick.js)
 * feeds that displacement into the very same routine a mouse/touch drag uses
 * (_applyShakeSignal), so the existing shake energy / progress / physics / release / random /
 * winner logic is reused unchanged. This file contains no physics.
 *
 * Pipeline:  raw event -> pick acceleration (linear, else gravity-removed) -> per-axis noise floor
 *            -> magnitude -> exponential smoothing (for OFF) ; ON = N consecutive instant samples >= threshold
 *            -> hysteresis (+ re-arm cooldown)
 *            -> arbitration (host.canAccept) -> screen-orientation rotation -> onSignal(px,py)
 *
 * Privacy: readings are used in memory only; nothing is stored, logged or sent anywhere.
 * Permission: DeviceMotionEvent.requestPermission() (iOS 13+/iPadOS) is only ever called from
 * enable()/requestPermission(), which the host calls from a click handler (user gesture).
 * Nothing is requested on load.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    noiseFloor: 0.6,       // m/s^2  per-axis readings below this are treated as 0 (sensor noise, tremor)
    smoothing: 0.35,       // EMA factor applied to the magnitude (higher = more reactive)
    onThreshold: 6,        // m/s^2  instant magnitude that must be reached (confirmSamples times in a row) to START a shake
    offThreshold: 2.5,     // m/s^2  smoothed magnitude below which the shake STOPS (hysteresis)
    confirmSamples: 2,     //        consecutive samples at/above onThreshold required (a single knock is not a shake)
    restartCooldown: 150,  // ms     after a stop, a new shake cannot start for this long (anti flapping)
    minInterval: 12,       // ms     events arriving faster than this are skipped (bounds work at ~80 Hz)
    gapReset: 500,         // ms     no events for this long (screen lock / pause) -> filters reset
    orientationSettle: 300,// ms     readings ignored right after the screen rotates
    pxPerMs2: 8,           // px     virtual displacement per m/s^2 handed to the shake engine
    maxPx: 160,            // px     clamp of the virtual displacement
    gravityAlpha: 0.8,     //        low-pass factor used to remove gravity when only accelerationIncludingGravity exists
    startTimeout: 2000     // ms     wait for the first usable reading after enabling, else "unavailable"
  };

  function now() { return global.performance && performance.now ? performance.now() : Date.now(); }

  function clamp(v, lim) { return v > lim ? lim : (v < -lim ? -lim : v); }

  // Device axes -> screen axes (x right, y down) for the four screen orientations.
  // Device frame: x = right edge, y = top edge of the natural portrait orientation.
  function rotate(ax, ay, angle) {
    switch (((angle % 360) + 360) % 360) {
      case 90: return { x: -ay, y: -ax };    // landscape, rotated counter-clockwise
      case 180: return { x: -ax, y: ay };    // upside-down portrait
      case 270: return { x: ay, y: ax };     // landscape, rotated clockwise
      default: return { x: ax, y: -ay };     // natural portrait (screen y points down)
    }
  }

  function screenAngle() {
    var s = global.screen;
    if (s && s.orientation && typeof s.orientation.angle === 'number') return s.orientation.angle;
    if (typeof global.orientation === 'number') return global.orientation;
    return 0;
  }

  /*
   * options: onSignal(px, py), onEnd(), onState(state, reason), canAccept(), + any DEFAULTS key
   * states : 'unsupported' | 'idle' | 'requesting' | 'enabled' | 'denied' | 'unavailable'
   */
  function Motion(options) {
    options = options || {};
    this.cfg = {};
    for (var k in DEFAULTS) this.cfg[k] = options[k] !== undefined ? options[k] : DEFAULTS[k];
    this.onSignal = options.onSignal || function () {};
    this.onEnd = options.onEnd || function () {};
    this.onState = options.onState || function () {};
    this.canAccept = options.canAccept || function () { return true; };

    this.state = this.isSupported() ? 'idle' : 'unsupported';
    this.reason = '';
    this.stats = { events: 0, processed: 0, applied: 0, ignored: 0, resets: 0 };
    this._pending = null;
    this._timer = 0;
    this._listening = false;
    this._resetFilter();
    this._ignoreUntil = 0;

    var self = this;
    this._onMotion = function (e) { self._handle(e); };
    this._onVisibility = function () { if (global.document && document.hidden) self._pause(); };
    this._onOrientation = function () { self._ignoreUntil = now() + self.cfg.orientationSettle; self._resetFilter(); };
  }

  Motion.rotate = rotate;
  Motion.DEFAULTS = DEFAULTS;

  Motion.prototype.isSupported = function () {
    return typeof global.DeviceMotionEvent !== 'undefined' && !!global.addEventListener;
  };
  Motion.prototype.needsPermission = function () {
    return this.isSupported() && typeof global.DeviceMotionEvent.requestPermission === 'function';
  };
  Motion.prototype.getState = function () { return this.state; };
  Motion.prototype.isEnabled = function () { return this.state === 'enabled'; };

  Motion.prototype._setState = function (s, reason) {
    if (this.state === s && (reason || '') === this.reason) return;
    this.state = s;
    this.reason = reason || '';
    try { this.onState(s, this.reason); } catch (e) { /* host errors must not break sensor handling */ }
  };

  // Must be called from a user gesture (click/tap) on browsers that gate motion behind a prompt.
  // Resolves 'granted' | 'denied' | 'unsupported'. Never rejects.
  Motion.prototype.requestPermission = function () {
    if (!this.isSupported()) return Promise.resolve('unsupported');
    if (!this.needsPermission()) return Promise.resolve('granted');
    try {
      // NOTE: invoked synchronously (before any await) so the user activation is still valid.
      return Promise.resolve(global.DeviceMotionEvent.requestPermission()).then(function (r) {
        return r === 'granted' ? 'granted' : 'denied';
      }, function () { return 'denied'; });
    } catch (e) {
      return Promise.resolve('denied');
    }
  };

  // Ask permission (if needed), start listening, and resolve with the final state once the first
  // usable reading arrived ('enabled') or it is clear it never will ('denied' / 'unavailable' / 'unsupported').
  Motion.prototype.enable = function () {
    var self = this;
    if (this.state === 'enabled') return Promise.resolve('enabled');
    if (this.state === 'requesting' && this._pending) return this._pending.promise;
    if (!this.isSupported()) { this._setState('unsupported'); return Promise.resolve('unsupported'); }

    this._setState('requesting');
    var pending = { promise: null, resolve: null };
    pending.promise = new Promise(function (res) { pending.resolve = res; });
    this._pending = pending;

    this.requestPermission().then(function (result) {
      if (self._pending !== pending) return;                    // disabled / destroyed meanwhile
      if (result !== 'granted') { self._finish(pending, 'denied', 'permission-' + result); return; }
      if (global.isSecureContext === false) { self._finish(pending, 'unavailable', 'insecure-context'); return; }
      self._listen();
      // enabled only when a real reading arrives (see _handle); otherwise give up after startTimeout
      self._timer = setTimeout(function () {
        if (self._pending === pending && self.state === 'requesting') self._finish(pending, 'unavailable', 'no-sensor-data');
      }, self.cfg.startTimeout);
    });
    return pending.promise;
  };

  Motion.prototype._finish = function (pending, state, reason) {
    clearTimeout(this._timer); this._timer = 0;
    if (state !== 'enabled') this._unlisten();
    this._pending = null;
    this._setState(state, reason);
    pending.resolve(state);
  };

  Motion.prototype.disable = function () {
    clearTimeout(this._timer); this._timer = 0;
    var p = this._pending; this._pending = null;
    this._unlisten();
    this._resetFilter();
    this.onEnd();
    this._setState(this.isSupported() ? 'idle' : 'unsupported');
    if (p) p.resolve(this.state);
  };

  Motion.prototype.destroy = function () { this.disable(); this.onSignal = this.onEnd = this.onState = function () {}; };

  Motion.prototype._listen = function () {
    if (this._listening) return;
    this._listening = true;
    global.addEventListener('devicemotion', this._onMotion, { passive: true });
    global.document && document.addEventListener('visibilitychange', this._onVisibility);
    global.addEventListener('orientationchange', this._onOrientation);
    if (global.screen && screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', this._onOrientation);
  };
  Motion.prototype._unlisten = function () {
    if (!this._listening) return;
    this._listening = false;
    global.removeEventListener('devicemotion', this._onMotion);
    global.document && document.removeEventListener('visibilitychange', this._onVisibility);
    global.removeEventListener('orientationchange', this._onOrientation);
    if (global.screen && screen.orientation && screen.orientation.removeEventListener) screen.orientation.removeEventListener('change', this._onOrientation);
  };

  Motion.prototype._resetFilter = function () {
    this._s = 0;             // smoothed magnitude
    this._active = false;    // hysteresis state
    this._cooldownUntil = 0;
    this._above = 0;         // consecutive samples above onThreshold
    this._gInit = false;     // gravity estimate
    this._gx = 0; this._gy = 0; this._gz = 0;
    this._lastEvt = 0;
    this._lastProc = 0;
  };

  // tab hidden / screen lock: drop the filter so a stale value can never fire on resume
  Motion.prototype._pause = function () {
    if (this._active) this.onEnd();
    this._resetFilter();
    this.stats.resets++;
  };

  // Hot path: runs for every devicemotion event (~60 Hz). No allocation except in the rare rotate() call.
  Motion.prototype._handle = function (e) {
    var t = now();
    this.stats.events++;
    // gap (screen locked, browser paused): restart the filter BEFORE using any stale state
    if (this.state === 'enabled' && this._lastEvt && t - this._lastEvt > this.cfg.gapReset) this._pause();
    var ax, ay, az;
    var a = e.acceleration;
    if (a && a.x != null && a.y != null) {
      ax = a.x; ay = a.y; az = a.z || 0;                      // linear acceleration (gravity already removed)
    } else {
      var g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;            // desktop browsers fire one all-null event
      var gz = g.z || 0;
      if (!this._gInit) { this._gx = g.x; this._gy = g.y; this._gz = gz; this._gInit = true; }
      var al = this.cfg.gravityAlpha;
      this._gx = al * this._gx + (1 - al) * g.x;
      this._gy = al * this._gy + (1 - al) * g.y;
      this._gz = al * this._gz + (1 - al) * gz;
      ax = g.x - this._gx; ay = g.y - this._gy; az = gz - this._gz;   // high-pass = gravity removed
    }

    // first usable reading -> sensor confirmed
    if (this.state === 'requesting' && this._pending) this._finish(this._pending, 'enabled', '');
    if (this.state !== 'enabled') return;

    this._lastEvt = t;
    if (t < this._ignoreUntil) return;
    if (t - this._lastProc < this.cfg.minInterval) return;     // throttle
    this._lastProc = t;
    this.stats.processed++;

    var nf = this.cfg.noiseFloor;                               // noise filter
    if (ax < nf && ax > -nf) ax = 0;
    if (ay < nf && ay > -nf) ay = 0;
    if (az < nf && az > -nf) az = 0;
    var mag = Math.sqrt(ax * ax + ay * ay + az * az);
    this._s += this.cfg.smoothing * (mag - this._s);            // smoothing

    if (!this._active) {                                        // debounce + hysteresis + cooldown
      // debounce on the INSTANT magnitude (not the smoothed one): a single knock, however hard, leaves
      // only one sample above the threshold, while a real shake keeps producing them
      this._above = mag >= this.cfg.onThreshold ? this._above + 1 : 0;
      if (this._above >= this.cfg.confirmSamples && t >= this._cooldownUntil) this._active = true;
    } else if (this._s < this.cfg.offThreshold) {
      this._above = 0;
      this._active = false;
      this._cooldownUntil = t + this.cfg.restartCooldown;
      this.onEnd();
      return;
    }
    if (!this._active) return;

    if (!this.canAccept()) { this.stats.ignored++; return; }    // arbitration (pointer input / state / entries)

    var r = rotate(ax, ay, screenAngle());
    this.stats.applied++;
    this.onSignal(clamp(r.x * this.cfg.pxPerMs2, this.cfg.maxPx), clamp(r.y * this.cfg.pxPerMs2, this.cfg.maxPx), this._s);
  };

  global.FSMotion = Motion;
})(window);

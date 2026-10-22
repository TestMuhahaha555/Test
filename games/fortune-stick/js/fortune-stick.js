/*
 * fortune-stick.js  —  standalone Fortune Stick (เซียมซี)
 * ==================================================================
 * SOURCE OF TRUTH: module 99637 ("default" export = the Fortune Stick React component)
 *                  inside chunk 0gdvtar4_ps8k.js of the original SpinAName fortune-stick page
 *
 * The component was a React function with refs + one requestAnimationFrame closure.
 * Here it is the same code with React state/refs turned into plain instance fields.
 * Every constant, formula and the ORDER of operations inside the render loop are kept.
 * Original single-letter refs are mapped like this (comments tagged `src:` show the original):
 *
 *   g/D  -> this.state            "shaking" | "dropping" | "zooming" | "revealed"
 *   _    -> this.progress         0..1 shake progress
 *   W    -> this.energy           0..1 shake energy
 *   $    -> this.lastMoveAt       last time the pointer moved > 3px
 *   L    -> this.dragging         pointer pressed on the cylinder area
 *   I    -> this.holding          hold-button pressed
 *   P    -> this.complete         progress reached 1 (drop is scheduled, 450 ms)
 *   A    -> this.dropTriggered    guard so the drop runs once
 *   q    -> this.cyl              cylinder offset/target {x,y,targetX,targetY,angle,targetAngle}
 *   K    -> this.prev             previous cylinder motion sample (for acceleration)
 *   X    -> this.camera           {scale,x,y,targetScale,targetX,targetY}
 *   H    -> this.dropStick        the stick that leaves the cylinder
 *   F    -> this.sticks           35 sticks inside the cylinder
 *   Y    -> this.stars            35 background stars (dark theme)
 *
 * Things that are NOT in the 3 source chunks and therefore re-implemented here (see README):
 *   - React/DOM shell (stage, canvas, hold button, hint pill) as plain DOM
 *   - framer-motion transitions of the hint pill / winner card (see fs-effects.js)
 * Input: the original used mouse + touch events; here Pointer Events drive the same handlers.
 *
 * EXTENSIONS (new, not in the original source):
 *   - fs-motion.js feeds phone shaking (DeviceMotion) into the SAME shake routine as a drag
 *     (_applyShakeSignal below). No new physics.
 *   - fs-confetti.js is the source-derived winner celebration (kept as its own presentation layer).
 */
(function (global) {
  'use strict';

  var Rnd = global.FSRandom;
  var FX = global.FSEffects;
  var Confetti = global.FSConfetti;
  var Motion = global.FSMotion;
  var Phys = global.FSPhysics;
  var Art = global.FSArt;
  var I18N = global.FS_I18N;
  var rand = Rnd.random;

  var SCRIPT_SRC = document.currentScript && document.currentScript.src;
  var DEFAULT_ASSET_BASE = SCRIPT_SRC ? new URL('../assets/', SCRIPT_SRC).href : './assets/';

  // src: module 79588  getCanvasDpr
  function getCanvasDpr() { return Math.min(global.devicePixelRatio || 1, 2); }

  function clamp(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

  /* ------------------------------------------------------------------ factories */
  // src: effect creating `F.current` (35 sticks). REDESIGN: sizes only (mass follows from them in fs-physics.js);
  // position / lean are set by the physics layout. len/wid ranges give a visible 30-55 px of stick above the mouth.
  function stickSpec() {
    return {
      len: 204 + 26 * rand(),
      wid: 8.5 + 2.5 * rand(),
      seed: rand() * Math.PI * 2,
      shade: 'hsl(' + (38 + 8 * rand()) + ', ' + (52 + 14 * rand()) + '%, ' + (55 + 13 * rand()) + '%)'
    };
  }

  // src: effect creating `Y.current` (35 stars)
  function createStars() {
    var arr = [];
    for (var i = 0; i < 35; i++) {
      arr.push({ x: rand(), y: rand(), r: 0.8 + 1.5 * rand(), alpha: 0.3 + 0.5 * rand() });
    }
    return arr;
  }

  function rr(ctx, x, y, w, h, r) {
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  /* ------------------------------------------------------------------ class */
  function FortuneStick(options) {
    if (!(this instanceof FortuneStick)) return new FortuneStick(options);
    options = options || {};
    this.opts = {
      container: options.container,
      lang: options.lang || 'th',
      theme: options.theme === 'dark' ? 'dark' : 'light',
      superEffects: options.superEffects !== false,
      sound: options.sound !== false,
      volume: options.volume !== undefined ? options.volume : 0.6,
      assetBase: options.assetBase || DEFAULT_ASSET_BASE,
      showHint: options.showHint !== false,
      showHoldButton: options.showHoldButton !== false,
      showModal: options.showModal !== false,
      respectReducedMotion: options.respectReducedMotion !== false,
      // NEW: mobile shake. `motion:false` removes the feature; `motionButton:false` hides the on-screen
      // button (use enableMotion() from your own gesture handler instead).
      motion: options.motion !== false,
      motionButton: options.motionButton !== false,
      motionOptions: options.motionOptions || {},
      // NEW: the original winner dialog uses backdrop-filter: blur(12px). On weak / software-rendered
      // GPUs that blur is re-computed every frame under the moving confetti and drags the frame rate
      // down. 'auto' (default) measures the frame rate right after the reveal and drops the blur
      // (darker flat backdrop instead) when it is below 40 fps; true = always blur (original), false = never.
      modalBlur: options.modalBlur === undefined ? 'auto' : options.modalBlur,
      // WAN WAN LOCAL CHANGE: false hides the winner dialog's "Remove Winner" button (the host owns the food list)
      showRemoveWinner: options.showRemoveWinner !== false
    };
    this._blurOff = false;
    this.entries = [];
    this.winners = [];
    this._listeners = {};
    this._inited = false;
    this._destroyed = false;
    this._initialNames = options.entries || options.names || [];
    ['onStateChange', 'onProgress', 'onDrop', 'onReveal', 'onWinner', 'onEntriesChange', 'onMotionState'].forEach(function (k) {
      if (typeof options[k] === 'function') this.on(k.slice(2).replace(/^./, function (c) { return c.toLowerCase(); }), options[k]);
    }, this);
    if (options.autoInit !== false) this.init();
  }

  /* ---------------------------------------------------------------- events */
  FortuneStick.prototype.on = function (name, fn) {
    (this._listeners[name] = this._listeners[name] || []).push(fn);
    return this;
  };
  FortuneStick.prototype.off = function (name, fn) {
    var l = this._listeners[name];
    if (!l) return this;
    this._listeners[name] = fn ? l.filter(function (f) { return f !== fn; }) : [];
    return this;
  };
  FortuneStick.prototype._emit = function (name, payload) {
    var l = this._listeners[name];
    if (!l) return;
    l.slice().forEach(function (fn) { try { fn(payload, this); } catch (e) { global.console && console.error(e); } }, this);
  };

  /* ------------------------------------------------------------------ init */
  FortuneStick.prototype.init = function () {
    if (this._inited || this._destroyed) return this;
    var c = this.opts.container;
    if (typeof c === 'string') c = document.querySelector(c);
    if (!c || !c.appendChild) throw new Error('FortuneStick: "container" element not found');
    this.container = c;
    this._inited = true;

    var now = performance.now();
    // --- state (src: useState/useRef initial values)
    this.state = 'shaking';
    this.progress = 0;
    this.energy = 0;
    this.lastMoveAt = now;
    this.lastFrameAt = now;
    this.dragging = false;
    this.holding = false;
    this.complete = false;
    this.dropTriggered = false;
    this.pointer = { x: 0, y: 0 };      // src: U
    this.dragOrigin = { x: 0, y: 0 };   // src: G
    this.camera = { scale: 1, x: 0, y: 0, targetScale: 1, targetX: 0, targetY: 0 };
    this.cyl = { x: 0, y: 0, targetX: 0, targetY: 0, angle: 0, targetAngle: 0 };
    this.prev = { x: 0, y: 0, a: 0, vx: 0, vy: 0, va: 0 };
    this.dropStick = null;
    this.winner = null;                 // {name, entryId, imageId, index}
    this.hintDismissed = false;         // src: N (never reset by the original either)
    this._lastSoundAt = 0;              // src: r (closure var of the render loop)
    this._lastVibrateAt = 0;            // src: a
    this._canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
    // browsers block vibrate() (and log a warning) until the page has had a user gesture
    this._mayVibrate = function () {
      return !navigator.userActivation || navigator.userActivation.hasBeenActive;
    };
    this._dropTimer = 0;
    this._rafId = 0;
    this._modal = null;
    this._confetti = null;
    this._activePointer = null;
    // NEW (mobile shake) bookkeeping
    this._motionDriving = false;   // motion is currently steering the cylinder
    this._mx = 0; this._my = 0;    // previous virtual pointer position of the motion input
    this._motionBlockUntil = 0;    // motion ignored until this time (after reset / drop)
    this._motionFailed = false;

    if (!Phys || !Art) throw new Error('FortuneStick: fs-physics.js and fs-art.js must be loaded first');
    this.tube = new Phys.Tube();
    this.tube.populate(35, stickSpec, rand);
    this.allSticks = this.tube.bodies.slice();   // every stick, also while one of them is outside the bundle
    this.sticks = this.tube.bodies;              // (kept name) sticks currently in the bundle
    this._drive = { ax: 0, ay: 0, alpha: 0, omega: 0, theta: 0, jostle: 0, progress: 0, lift: false };
    this._free = null; this._freeSprite = null; this._landAt = 0; this._failsafe = false;
    this._cyl = null; this._artKey = '';
    this._mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this._refreshPalette();
    this.stars = createStars();

    this.audio = new global.FSAudio({
      assetBase: this.opts.assetBase,
      muted: !this.opts.sound,
      sfxVolume: this.opts.volume
    });

    this.motion = null;
    if (this.opts.motion && Motion) {
      var mo = {};
      for (var mk in this.opts.motionOptions) mo[mk] = this.opts.motionOptions[mk];
      mo.onSignal = function (px, py) { self._motionSignal(px, py); };
      mo.onEnd = function () { self._motionEnd(); };
      mo.onState = function (st, reason) { self._onMotionState(st, reason); };
      mo.canAccept = function () { return self._motionCanAccept(); };
      this.motion = new Motion(mo);
    }

    this._buildDom();
    this._applyHostTokens();
    this.setNames(this._initialNames, true);

    var self = this;

    this._bindEvents();
    this._rafId = requestAnimationFrame(function () { self._frame(); });
    return this;
  };

  /* ------------------------------------------------------------------- DOM */
  FortuneStick.prototype._scopeClass = function () {
    return 'fs-scope ' + (this.opts.theme === 'dark' ? 'fs-dark' : 'fs-light') +
      (this.opts.superEffects ? ' fs-super' : '') +
      (this.opts.respectReducedMotion ? ' fs-reduce-motion' : '');
  };

  FortuneStick.prototype._t = function () { return I18N[this.opts.lang] || I18N.en; };

  FortuneStick.prototype._buildDom = function () {
    var t = this._t();
    var stage = document.createElement('div');
    stage.className = 'fs-stage ' + this._scopeClass();
    stage.innerHTML =
      '<canvas class="fs-canvas"></canvas>' +
      '<button type="button" class="fs-hold"><span class="fs-hold-fill"></span><span class="fs-hold-label"></span></button>' +
      '<button type="button" class="fs-motion" hidden></button>' +
      '<div class="fs-hint"><div class="fs-hint-pill"><span class="fs-hint-arrow">\u27F7</span><span class="fs-hint-text"></span></div></div>';
    this.container.appendChild(stage);
    this.stage = stage;
    this.canvas = stage.querySelector('.fs-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.holdBtn = stage.querySelector('.fs-hold');
    this.holdFill = stage.querySelector('.fs-hold-fill');
    this.holdLabel = stage.querySelector('.fs-hold-label');
    this.motionBtn = stage.querySelector('.fs-motion');
    this.hintEl = stage.querySelector('.fs-hint');
    this.hintText = stage.querySelector('.fs-hint-text');

    // overlay root for the modal / toast (fixed-position, independent of host transforms)
    var overlay = document.createElement('div');
    overlay.className = this._scopeClass();
    document.body.appendChild(overlay);
    this.overlayRoot = overlay;

    this.holdLabel.textContent = t.stick.holdButton;
    this.holdBtn.hidden = !this.opts.showHoldButton;
    this._syncUi();
  };

  // src: JSX conditions: button when state==="shaking"; hint when shaking && !N; disabled when no entries
  FortuneStick.prototype._syncUi = function () {
    var t = this._t();
    var shaking = this.state === 'shaking';
    this.holdBtn.hidden = !(shaking && this.opts.showHoldButton);
    this.holdBtn.disabled = this.entries.length === 0;
    this.holdBtn.classList.toggle('is-holding', !!this._holdingUi);
    this.holdLabel.textContent = this._holdingUi ? t.stick.shakingButton : t.stick.holdButton;
    this.holdFill.style.width = (100 * this.progress) + '%';
    this.holdBtn.classList.toggle('is-filled', this.progress > 0.45);
    this.hintEl.classList.toggle('is-visible', !!(this.opts.showHint && shaking && !this.hintDismissed));
    // hint text: default (hold/drag) | motion (phone shake armed) | fallback (motion refused / missing)
    var ms = this.motion ? this.motion.getState() : 'unsupported';
    this.hintText.textContent = ms === 'enabled' ? t.motion.hint : (this._motionFailed ? t.motion.fallback : t.stick.holdShake);
    // motion button: shown on touch devices (or browsers that need the permission prompt)
    var mb = this.motionBtn;
    if (mb) {
      var show = shaking && this._motionButtonAllowed();
      mb.hidden = !show;
      mb.classList.toggle('is-on', ms === 'enabled');
      mb.disabled = ms === 'requesting';
      mb.textContent = ms === 'enabled' ? t.motion.on : (ms === 'requesting' ? t.motion.requesting : t.motion.enable);
    }
  };

  // The button is only offered where it can plausibly help; desktop UI stays untouched.
  FortuneStick.prototype._motionButtonAllowed = function () {
    if (!this.motion || !this.opts.motionButton || !this.motion.isSupported()) return false;
    var st = this.motion.getState();
    if (st === 'denied' || st === 'unavailable' || st === 'unsupported') return false;
    var coarse = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
    return !!(coarse || this.motion.needsPermission());
  };

  FortuneStick.prototype._setHoldingUi = function (v) {   // src: S(...)
    this._holdingUi = v;
    this._syncUi();
  };

  FortuneStick.prototype._setProgressUi = function (t) {  // src: M(t)
    this.holdFill.style.width = (100 * t) + '%';
    this.holdBtn.classList.toggle('is-filled', t > 0.45);
    if (t > 0.05 && !this.hintDismissed) { this.hintDismissed = true; this._syncUi(); } // src: j>.05&&T(!0)
    this._emit('progress', t);
  };

  FortuneStick.prototype._setState = function (s) {       // src: x(...)
    if (this.state === s) return;
    this.state = s;
    this._syncUi();
    this._emit('stateChange', s);
  };

  /* ---------------------------------------------------------------- input */
  FortuneStick.prototype._bindEvents = function () {
    var self = this;
    var stage = this.stage, btn = this.holdBtn;

    this._h = {
      stageDown: function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (self._activePointer !== null) return;
        if (self.state !== 'shaking' || self.entries.length === 0) return;   // src: et
        self._activePointer = e.pointerId;
        self._dragStart(e.clientX, e.clientY);
      },
      stageMove: function (e) {
        if (self._activePointer !== e.pointerId) return;
        self._dragMove(e.clientX, e.clientY);                                // src: en
      },
      stageUp: function (e) {
        if (self._activePointer !== null && e.pointerId !== self._activePointer) return;
        self._activePointer = null;
        self._dragEnd();                                                     // src: er
      },
      stageLeave: function (e) {
        // src: onMouseLeave -> er (touch pointers keep an implicit capture, so only mouse leaves)
        if (e.pointerType !== 'mouse') return;
        self._activePointer = null;
        self._dragEnd();
      },
      btnDown: function (e) {
        e.stopPropagation();                                                 // src: Z (t.stopPropagation())
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        self._holdPress();
      },
      btnUp: function () { self._holdRelease(); },                           // src: ee
      winUp: function () { self._holdRelease(); self._activePointer = null; self._dragEnd(); },
      vis: function () { if (document.hidden) self._h.winUp(); else self.lastFrameAt = performance.now(); },
      ctx: function (e) { e.preventDefault(); }
    };

    stage.addEventListener('pointerdown', this._h.stageDown);
    stage.addEventListener('pointermove', this._h.stageMove);
    stage.addEventListener('pointerup', this._h.stageUp);
    stage.addEventListener('pointercancel', this._h.stageUp);
    stage.addEventListener('pointerleave', this._h.stageLeave);
    stage.addEventListener('contextmenu', this._h.ctx);
    // NEW: motion button (click = real user gesture, required for the iOS permission prompt)
    this._h.motionDown = function (e) { e.stopPropagation(); };
    this._h.motionClick = function () {
      if (!self.motion) return;
      if (self.motion.isEnabled()) self.disableMotion(); else self.enableMotion();
    };
    this.motionBtn.addEventListener('pointerdown', this._h.motionDown);
    this.motionBtn.addEventListener('click', this._h.motionClick);
    btn.addEventListener('pointerdown', this._h.btnDown);
    btn.addEventListener('pointerup', this._h.btnUp);
    btn.addEventListener('pointerleave', this._h.btnUp);
    btn.addEventListener('pointercancel', this._h.btnUp);
    // safety nets so no press can ever stay "stuck" (pointerup outside, alt-tab, tab hidden)
    global.addEventListener('pointerup', this._h.winUp);
    global.addEventListener('pointercancel', this._h.winUp);
    global.addEventListener('blur', this._h.winUp);
    document.addEventListener('visibilitychange', this._h.vis);
  };

  // src: et
  FortuneStick.prototype._dragStart = function (x, y) {
    this._motionDriving = false; this._mx = 0; this._my = 0;   // pointer input has priority over motion
    this.dragging = true;
    this.pointer = { x: x, y: y };
    this.dragOrigin = { x: x, y: y };
  };
  // src: en
  FortuneStick.prototype._dragMove = function (x, y) {
    if (!this.dragging || this.state !== 'shaking' || this.complete) return;
    var dx = x - this.pointer.x, dy = y - this.pointer.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var ox = x - this.dragOrigin.x, oy = y - this.dragOrigin.y;
    this._applyShakeSignal(dist, ox, oy, dx);
    this.pointer = { x: x, y: y };
  };
  // src: the body of `en` after the distance is known. Shared by the pointer drag (original) and the
  // phone-motion input (new) so both go through exactly the same shake energy / cylinder targets.
  //   dist = movement since the previous sample (px), ox/oy = displacement from the origin, dx = horizontal step
  FortuneStick.prototype._applyShakeSignal = function (dist, ox, oy, dx) {
    if (dist > 3) {
      this.lastMoveAt = performance.now();
      this.energy = Math.max(this.energy, Math.min(1, 0.08 * dist));
    }
    this.cyl.targetX = clamp(-100, 100, ox);
    this.cyl.targetY = clamp(-50, 50, oy);
    this.cyl.targetAngle = clamp(-0.2, 0.2, 0.02 * dx);
  };
  // src: er
  FortuneStick.prototype._dragEnd = function () {
    this.dragging = false;
    this.lastMoveAt = 0;
    this.cyl.targetX = 0;
    this.cyl.targetY = 0;
    this.cyl.targetAngle = 0;
  };
  // src: Z
  FortuneStick.prototype._holdPress = function () {
    if (this.state !== 'shaking' || this.complete || this.entries.length === 0) return;
    this._motionDriving = false; this._mx = 0; this._my = 0;
    this.holding = true;
    this._setHoldingUi(true);
  };
  // src: ee
  FortuneStick.prototype._holdRelease = function () {
    if (!this.holding && !this._holdingUi) return;
    this.holding = false;
    this._setHoldingUi(false);
  };

  /* ------------------------------------------------- mobile shake glue (NEW feature) */
  // Motion may steer the cylinder only while a pointer is not doing it, the round is still in the
  // shaking phase, there is somebody to pick and the short post-reset quiet period is over.
  FortuneStick.prototype._motionCanAccept = function () {
    return this.state === 'shaking' && !this.complete && this.entries.length > 0 &&
      !this.dragging && !this.holding && performance.now() >= this._motionBlockUntil;
  };
  // virtual pointer: the motion displacement plays the role of (pointer - dragOrigin)
  FortuneStick.prototype._motionSignal = function (px, py) {
    var dx = px - this._mx, dy = py - this._my;
    var dist = Math.sqrt(dx * dx + dy * dy);
    this._mx = px; this._my = py;
    this._motionDriving = true;
    this._applyShakeSignal(dist, px, py, dx);
  };
  // same as a pointer release (src: er) but only when motion was the one steering
  FortuneStick.prototype._motionEnd = function () {
    this._mx = 0; this._my = 0;
    if (this._motionDriving && !this.dragging && !this.holding) this._dragEnd();
    this._motionDriving = false;
  };
  FortuneStick.prototype._onMotionState = function (st, reason) {
    var t = this._t();
    this._motionFailed = st === 'denied' || st === 'unavailable';
    if (this._motionFailed && this.overlayRoot) {
      FX.showToast(this.overlayRoot, st === 'denied' ? t.motion.denied : t.motion.unavailable, { duration: 6000 }, '');
    }
    if (st !== 'enabled') this._motionEnd();
    this._syncUi();
    this._emit('motionState', { state: st, reason: reason });
  };

  /* ------------------------------------------------------------- the drop (src: J) */
  // REDESIGN: the stick that leaves is one of the 35 real sticks of the bundle (same body, same sprite).
  // tube.release() gives it an upward velocity along its own axis; it keeps scraping the rim until it has
  // cleared the mouth (_launch converts it to world space), then flies freely and lands by physics.
  FortuneStick.prototype._cancelDrop = function () {
    this.dropTriggered = false;
    this.complete = false;
    this.progress = 0;
    this._setProgressUi(0);
  };
  FortuneStick.prototype._drop = function () {
    if (this.dropTriggered || this._destroyed) return;
    this.dropTriggered = true;
    this._motionDriving = false; this._mx = 0; this._my = 0;
    this.dragging = false;
    this.cyl.targetX = 0; this.cyl.targetY = 0; this.cyl.targetAngle = 0;
    var picked = this.entries.length === 0 ? null : Rnd.pickWinnerEntry(this.entries);   // unchanged random pick
    if (!picked) { this._cancelDrop(); return; }   // original returns here and leaves `complete` set -> we also clear it
    var body = this.tube.release(this._reduced() ? 14 : 18, rand);
    if (!body) { this._cancelDrop(); return; }
    this.winner = { name: picked.name || '', imageId: picked.imageId, entryId: picked.entryId, index: picked.index };
    this.dropStick = body;
    this._free = null;
    this._dropAt = performance.now();
    this.audio.play('whoosh');
    if (this._canVibrate && this._mayVibrate()) { try { navigator.vibrate([40, 60, 80]); } catch (e) { /* ignore */ } }
    this._setState('dropping');
    this._emit('drop', { name: this.winner.name, entryId: this.winner.entryId, index: this.winner.index });
  };

  // cylinder-local body -> world space (position, angle and velocity incl. the cylinder's own motion)
  FortuneStick.prototype._launch = function (b, J, Z, th, cvx, cvy, om, c) {
    var cs = Math.cos(th), sn = Math.sin(th), rx = b.x, ry = b.y - 210;
    var wxr = rx * cs - ry * sn, wyr = rx * sn + ry * cs;
    var lvx = b.vx, lvy = b.vy;
    b.vx = cvx - om * wyr + lvx * cs - lvy * sn;
    b.vy = cvy + om * wxr + lvx * sn + lvy * cs;
    b.x = J + wxr; b.y = Z + wyr;
    b.a += th; b.w += om;
    b.ejecting = false;
    this._free = Phys.createFreeState();
    this._freeSprite = Art.stickSprite(b, this._pal, Math.min(5, c * 2.4), this.tube.cfg.layers);
    this._landAt = 0;
  };

  FortuneStick.prototype._reduced = function () {
    return !!(this.opts.respectReducedMotion && this._mq && this._mq.matches);
  };

  /* --------------------------------------------------------- artwork cache */
  FortuneStick.prototype._refreshPalette = function () {
    this._pal = Art.palette(this.opts.theme, this.opts.pattern);   // pattern: 'lattice' (default) | 'lotus' | 'cloud'
    this._applyHostTokens();
  };
  // modal / buttons follow the host site's tokens when the host defines them
  FortuneStick.prototype._applyHostTokens = function () {
    var pal = this._pal;
    if (!pal || !pal.hasHost) return;
    var C = Art.color, acc = C.parse(pal.accent), set = [
      ['--accent', pal.accent], ['--accent-rgb', acc.join(', ')], ['--accent-text', '#fff'],
      ['--bg-card', pal.card], ['--bg-input', pal.bg], ['--bg-secondary', pal.card], ['--bg-primary', pal.bg],
      ['--text-primary', pal.ink], ['--text-secondary', pal.ink], ['--border', pal.line],
      ['--fs-accent', pal.accent]
    ];
    [this.stage, this.overlayRoot].forEach(function (el) {
      if (!el) return;
      for (var i = 0; i < set.length; i++) el.style.setProperty(set[i][0], set[i][1]);
    });
  };
  FortuneStick.prototype._ensureArt = function (c) {
    var key = this._pal.key + '|' + c;
    if (this._artKey === key) return;
    this._artKey = key;
    var self = this, scale = Math.min(4, c * 1.5), layers = this.tube.cfg.layers;
    for (var i = 0; i < this.allSticks.length; i++) this.allSticks[i].sprite = Art.stickSprite(this.allSticks[i], this._pal, scale, layers);
    var cs = Math.min(4, c * 2);
    Art.buildCylinder(this._pal, cs, function (res) { if (res && self._artKey === key) self._cyl = res; });
  };

  FortuneStick.prototype._drawBody = function (n, b, sprite) {
    var pad = Art.PAD;
    n.save();
    n.translate(b.x, b.y);
    n.rotate(b.a);
    n.drawImage(sprite, -(b.wid / 2 + pad), -b.hl - pad, b.wid + 2 * pad, b.len + 2 * pad);
    n.restore();
  };

  /* --------------------------------------------------------- render loop (src: l) */
  FortuneStick.prototype._frame = function () {
    if (this._destroyed) return;
    var self = this;
    var canvas = this.canvas, n = this.ctx;
    var o = performance.now();
    var s = Math.min(50, o - this.lastFrameAt) / 16.666;   // frame delta in 60 fps units
    this.lastFrameAt = o;
    var c = getCanvasDpr();
    var m = canvas.clientWidth || 600;
    var h = canvas.clientHeight || 600;
    var bw = Math.floor(m * c), bh = Math.floor(h * c);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    this._ensureArt(c);
    var pal = this._pal;
    var reduced = this._reduced();
    // scene scale: the cylinder keeps its proportions on small hosts (the original drew it at a fixed size)
    var compact = h < 330;                                 // short stage (small phones): leave room for the buttons
    if (compact !== this._compact) { this._compact = compact; this.stage.classList.toggle('fs-compact', compact); }
    var sc = Math.min(clamp(compact ? 0.45 : 0.5, 1.15, h / 560), Math.max(0.5, m / 300));
    var M = m / sc, H = h / sc;                            // logical scene size
    n.save();
    n.scale(c, c);
    n.clearRect(0, 0, m, h);

    var p = this.state;

    if (this.opts.theme === 'dark') {
      var bg = n.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, pal.skyTop);
      bg.addColorStop(0.5, pal.skyMid);
      bg.addColorStop(1, pal.skyBot);
      n.fillStyle = bg;
      n.fillRect(0, 0, m, h);
      var tt = o / 1000;
      n.fillStyle = '#ffffff';
      var stars = this.stars;
      for (var si = 0; si < stars.length; si++) {
        var st = stars[si];
        var tw = reduced ? 0 : 0.25 * Math.sin(2 * tt + 12 * st.x);
        n.globalAlpha = Math.max(0.15, Math.min(1, st.alpha + tw));
        n.beginPath();
        n.arc(st.x * m, st.y * h, st.r, 0, 2 * Math.PI);
        n.fill();
      }
      n.globalAlpha = 1;
    }

    // ---- camera (src: X) in logical units
    var g = this.camera;
    if (p === 'shaking') {
      g.targetX = M / 2;
      g.targetY = H / 2;
      if (g.x === 0 && g.y === 0) { g.x = M / 2; g.y = H / 2; }
    }
    var ease = (reduced ? 0.2 : 0.08) * s;
    g.scale += (g.targetScale - g.scale) * ease;
    g.x += (g.targetX - g.x) * ease;
    g.y += (g.targetY - g.y) * ease;
    n.save();
    n.scale(sc, sc);
    n.translate(M / 2, H / 2);
    n.scale(g.scale, g.scale);
    n.translate(-g.x, -g.y);

    // ---- cylinder follows the pointer (src: q)
    var y = this.cyl;
    y.x += (y.targetX - y.x) * 0.16 * s;
    y.y += (y.targetY - y.y) * 0.16 * s;

    var v = performance.now() / 1000;
    var idle = p === 'shaking' && this.energy < 0.1 && this.progress < 0.1;   // src: w
    var b = v % 3.2;
    var k = idle && !reduced && b < 1.4 ? Math.sin(b / 1.4 * Math.PI * 3) * Math.sin(b / 1.4 * Math.PI) : 0;
    var j = 0.045 * k;                                                         // idle wobble angle
    var E = (p === 'shaking' ? Math.sin(60 * v) * this.energy * (reduced ? 1.4 : 9) : 0) + 3 * k; // vertical jitter
    var R = this.prev;
    var N = Math.max(s, 0.25);
    var T = (y.x - R.x) / N;
    var O = (y.y + E - R.y) / N;
    var L = (y.angle + j - R.a) / N;
    var A = clamp(-8, 8, (T - R.vx) / N);        // horizontal acceleration of the cylinder
    var U = clamp(-8, 8, (O - R.vy) / N);        // vertical acceleration
    var G = clamp(-0.06, 0.06, (L - R.va) / N);  // angular acceleration
    R.x = y.x; R.y = y.y + E; R.a = y.angle + j; R.vx = T; R.vy = O; R.va = L;

    var J = M / 2 + y.x;           // cylinder centre x
    var Z = (compact ? Math.min(0.74 * H, H - 118 / sc) : 0.74 * H) + y.y + E;    // cylinder bottom y
    var ee = Z - 210;              // cylinder mouth y
    var th = y.angle + j;

    // soft contact shadow under the cylinder
    n.fillStyle = pal.theme === 'dark' ? 'rgba(0,0,0,.35)' : Art.color.rgba(pal.inkRgb, 0.13);
    n.beginPath();
    n.ellipse(J, Z - 16, 50, 7, 0, 0, 2 * Math.PI);
    n.fill();

    n.save();
    n.translate(J, Z);
    n.rotate(th);
    n.translate(-J, -Z);

    // back layer: rim + dark inside (procedural stand-in only for the few ms while the SVG is decoding)
    var cyl = this._cyl;
    if (cyl) n.drawImage(cyl.back, J - 50, ee - 16, 100, 210);
    else {
      n.fillStyle = pal.interiorBot;
      n.beginPath(); n.ellipse(J, ee, 46, 12, 0, 0, 2 * Math.PI); n.fill();
    }

    // ---- shake energy + progress (src: block guarded by "shaking" && !P) — unchanged
    if (p === 'shaking' && !this.complete) {
      if (this.holding) { this.lastMoveAt = o; this.energy = Math.max(this.energy, 3); }
      else this.energy = Math.max(0, this.energy - 0.05 * s);
      var rate = (o - this.lastMoveAt < 350 && this.energy > 0.02) || this.holding
        ? 0.0015 + 0.002 * this.energy : -0.0035;
      var np = Math.max(0, Math.min(1, this.progress + rate * s));
      if (np !== this.progress) {
        var before = Math.round(100 * this.progress);
        this.progress = np;
        if (Math.round(100 * np) !== before) this._setProgressUi(np);
        if (np >= 1) {
          this.complete = true;
          this.holding = false;
          this._setHoldingUi(false);
          this._dropTimer = setTimeout(function () { self._dropTimer = 0; self._drop(); }, 450);
        }
      }
    }

    var en = p === 'shaking' ? Math.min(1, 0.35 * Math.abs(A) + 0.45 * Math.abs(U) + 0.4 * this.energy) : 0;
    if (this._canVibrate && en > 0.12 && o - this._lastVibrateAt > 140 && this._mayVibrate()) {
      try { navigator.vibrate(Math.round(8 + 28 * en)); } catch (e1) { /* ignore */ }
      this._lastVibrateAt = o;
    }

    // ---- sticks: one physics step in the cylinder's own frame (real fictitious forces from its motion)
    var drive = this._drive;
    drive.ax = A; drive.ay = U; drive.alpha = G; drive.omega = L; drive.theta = th;
    drive.jostle = en; drive.progress = this.progress; drive.lift = p === 'shaking' && !this.complete;
    var tube = this.tube;
    tube.step(s, drive, rand);
    // sound follows real impacts (replaces the original random per-stick coin flip)
    if (p === 'shaking' && tube.impact > 1.5 && this.energy > 0.05) {
      var nowMs = Date.now();
      if (nowMs - this._lastSoundAt > 180) {
        this.audio.play('shuffle', { volume: 0.12 + 0.2 * Math.min(1, tube.impact / 12) });
        this._lastSoundAt = nowMs;
      }
    }
    if (p === 'dropping' && this.dropStick && this.dropStick.ejecting && o - this._dropAt > 6000) {
      tube.forceEject(this.dropStick);          // safety net: never leave the round hanging
      this._failsafe = true;
    }
    var ej = tube.takeEjected() || (this.dropStick && this._failsafe && !this._free && !this.dropStick.ejecting && tube.bodies.indexOf(this.dropStick) < 0 ? this.dropStick : null);
    if (ej) this._launch(ej, J, Z, th, T, O, L, c);

    n.save();
    n.translate(J, ee);
    var bodies = tube.bodies, i;
    for (i = 0; i < bodies.length; i++) {
      if (bodies[i].sprite) this._drawBody(n, bodies[i], bodies[i].sprite);
    }
    n.restore();

    // front layer: near rim, body, bands, ornament
    if (cyl) n.drawImage(cyl.front, J - 50, ee - 16, 100, 210);
    else {
      n.fillStyle = pal.accent;
      n.fillRect(J - 46, ee + 8, 92, 180);
    }
    n.restore();   // end cylinder rotation

    // ---- the released stick: same body as in the bundle, now in the open
    var d = this.dropStick;
    if (d && !d.ejecting && this._free) {
      var fst = this._free, groundY = 0.85 * H;
      if (!fst.rest) {
        Phys.stepFree(d, s, { groundY: groundY, minX: -1e5, maxX: 1e5 }, fst);   // no side walls: the camera follows the stick
        if (!fst.rest && this._landAt && o - this._landAt > 6000) { d.vx = d.vy = d.w = 0; fst.rest = true; this._failsafe = true; }
      }
      if (p === 'dropping' && fst.landed) {      // first touch of the ground -> start the zoom (stick keeps settling)
        this._setState('zooming');
        this._landAt = o;
        g.targetScale = Math.min(2.4, M / (d.len + 70));
      }
      if (this.state === 'zooming' || this.state === 'revealed') { g.targetX = d.x; g.targetY = groundY; }
      // shadow on the ground, fading with height
      var hgt = Math.max(0, groundY - d.y);
      n.fillStyle = pal.theme === 'dark' ? 'rgba(0,0,0,.35)' : Art.color.rgba(pal.inkRgb, Math.max(0.04, 0.16 - hgt / 2500));
      n.beginPath();
      n.ellipse(d.x, groundY + 2, d.hl * (0.55 + 0.25 * Math.abs(Math.cos(d.a))) , 4 + 2 * Math.abs(Math.cos(d.a)), 0, 0, 2 * Math.PI);
      n.fill();
      this._drawBody(n, d, this._freeSprite || d.sprite);
    }

    n.restore();   // end camera
    n.restore();   // end dpr scale

    // reveal only when the camera has arrived AND the stick has really stopped
    if (this.state === 'zooming' && 0.05 > Math.abs(g.scale - g.targetScale) && this._free && this._free.rest) {
      this._setState('revealed');
      this._showReveal();
    }
    this._rafId = requestAnimationFrame(function () { self._frame(); });
  };

  /* ------------------------------------------------------------ winner reveal */
  FortuneStick.prototype._showReveal = function () {
    var w = this.winner;
    this._emit('reveal', { name: w.name, entryId: w.entryId, index: w.index });
    if (!this.opts.showModal) return;
    var self = this;
    var t = this._t();
    var reduced = this.opts.respectReducedMotion && global.matchMedia &&
      global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var name = w.name;
    var overlay = document.createElement('div');
    overlay.className = 'fs-modal-overlay';
    overlay.style.opacity = '0';
    var card = document.createElement('div');
    card.className = 'fs-modal-content';
    var celebr = document.createElement('div');
    celebr.className = 'fs-modal-celebration';
    var h2 = document.createElement('h2');
    h2.className = 'fs-modal-congrats';
    h2.textContent = t.modal.congrats;
    celebr.appendChild(h2);
    if (name) {
      var nm = document.createElement('div');
      nm.className = 'fs-modal-winner-name';
      nm.textContent = name;
      nm.style.fontSize = name.length > 20 ? '2.2rem' : name.length > 14 ? '3rem' : name.length > 10 ? '3.8rem' : '4.5rem';
      celebr.appendChild(nm);
    }
    var actions = document.createElement('div');
    actions.className = 'fs-winner-actions';
    var closed = false;

    function close(afterEntriesChange) {
      if (closed) return;
      closed = true;
      overlay.style.pointerEvents = 'none';
      if (self._confetti) { self._confetti.stop(); self._confetti = null; }
      self._modal = null;
      self._closeReveal();
      // exit animation (src exit: {scale .85, opacity 0, y 16}; overlay fades in .2 s)
      overlay.style.opacity = '0';
      FX.spring({
        from: { s: 1, y: 0 }, to: { s: 0.85, y: 16 },
        stiffness: self.opts.superEffects ? 500 : 380, damping: self.opts.superEffects ? 12 : 20,
        onUpdate: function (v) { card.style.transform = 'translateY(' + v.y + 'px) scale(' + v.s + ')'; }
      });
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 350);
      if (typeof afterEntriesChange === 'function') afterEntriesChange();
    }

    if (w.entryId && this.opts.showRemoveWinner) {
      // src: "Remove Winner" button (entryId known -> removes just that entry), then onClose, then Undo toast
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'fs-btn fs-winner-btn-remove';
      rm.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>';
      rm.appendChild(document.createTextNode(t.modal.removeWinner));
      rm.addEventListener('click', function () {
        if (closed) return;
        var before = self.entries.slice();
        self.entries = self.entries.filter(function (e) { return e.id !== w.entryId; });
        self._emit('entriesChange', self.getNames());
        close(function () {
          FX.showToast(self.overlayRoot, t.toast.winnerRemoved + ': ' + (name || ''), {
            onUndo: function () { self.entries = before; self._emit('entriesChange', self.getNames()); self._syncUi(); }
          }, t.common.undo);
        });
        self._syncUi();
      });
      actions.appendChild(rm);
    }
    var cb = document.createElement('button');
    cb.type = 'button';
    cb.id = 'close-winner-modal';
    cb.className = 'fs-btn fs-winner-btn-close';
    cb.textContent = t.common.close;
    cb.addEventListener('click', function () { close(); });
    actions.appendChild(cb);

    celebr.appendChild(actions);
    card.appendChild(celebr);
    overlay.appendChild(card);
    overlay.addEventListener('click', function () { close(); });
    card.addEventListener('click', function (ev) { ev.stopPropagation(); });
    this.overlayRoot.appendChild(overlay);
    this._modal = { close: close, overlay: overlay };
    if (this.opts.modalBlur === false || (this.opts.modalBlur === 'auto' && this._blurOff)) overlay.classList.add('fs-no-blur');
    else if (this.opts.modalBlur === 'auto') this._probeFrameRate(overlay, function () { return closed; });

    this.audio.play('/sfx/tada.mp3');   // src: E("/sfx/tada.mp3")
    if (this._confetti) { this._confetti.stop(); this._confetti = null; }   // never two celebrations
    if (!reduced && Confetti) this._confetti = Confetti.start(this.overlayRoot, function () { self._confetti = null; });

    // overlay fade .2s, card spring (src: initial {scale .2|.5, opacity 0, y 60|30}, spring)
    overlay.style.transition = 'opacity .2s';
    requestAnimationFrame(function () { overlay.style.opacity = '1'; });
    var sx = this.opts.superEffects;
    FX.spring({
      from: { s: sx ? 0.2 : 0.5, o: 0, y: sx ? 60 : 30 }, to: { s: 1, o: 1, y: 0 },
      stiffness: sx ? 500 : 380, damping: sx ? 12 : 20,
      onUpdate: function (v) { if (closed) return; card.style.transform = 'translateY(' + v.y + 'px) scale(' + v.s + ')'; card.style.opacity = String(Math.max(0, Math.min(1, v.o))); }
    });
    var nmEl = celebr.querySelector('.fs-modal-winner-name');
    if (nmEl) FX.spring({
      from: { s: 0.8, o: 0 }, to: { s: 1, o: 1 }, stiffness: 260, damping: 18, delay: 0.28,
      onUpdate: function (v) { nmEl.style.opacity = String(Math.max(0, Math.min(1, v.o))); nmEl.style.transform = 'scale(' + v.s + ')'; }
    });
    // congrats title: src initial {opacity 0, y 8} -> {1, 0}, delay .2 (framer default transition approximated)
    h2.style.opacity = '0'; h2.style.transform = 'translateY(8px)';
    setTimeout(function () { h2.style.transition = 'opacity .35s ease-out, transform .35s ease-out'; h2.style.opacity = '1'; h2.style.transform = 'none'; }, 200);
  };

  // NEW: frame-rate probe for the 'auto' modal blur (skips the first 400 ms: spring + fade-in; measures 700 ms;
  // ignores hidden tabs). The decision is sticky for the rest of the session to avoid flicker between rounds.
  FortuneStick.prototype._probeFrameRate = function (overlay, isClosed) {
    var self = this, t0 = 0, frames = 0;
    function tick(t) {
      if (isClosed() || self._destroyed) return;
      if (document.hidden) { t0 = 0; frames = 0; requestAnimationFrame(tick); return; }
      if (!t0) t0 = t;
      var el = t - t0;
      if (el >= 400) frames++;
      if (el < 1100) { requestAnimationFrame(tick); return; }
      var fps = frames / 0.7;
      if (fps < 40) { self._blurOff = true; overlay.classList.add('fs-no-blur'); self._emit('blurDisabled', { fps: Math.round(fps) }); }
    }
    requestAnimationFrame(tick);
  };

  // src: the `onClose` handler passed to the winner modal
  FortuneStick.prototype._closeReveal = function () {
    var w = this.winner;
    if (w !== null && w.name !== null) {
      var rec = { name: w.name, entryId: w.entryId, imageId: w.imageId, mode: 'stick', timestamp: Date.now() };
      this.winners.push(rec);
      this._emit('winner', rec);
    }
    this._resetRound();
  };

  FortuneStick.prototype._resetRound = function () {
    this._motionDriving = false; this._mx = 0; this._my = 0;
    this._motionBlockUntil = performance.now() + 400;   // NEW: ignore phone motion right after a round ends
    this.state = 'shaking';
    this.prev = { x: 0, y: 0, a: 0, vx: 0, vy: 0, va: 0 };
    this.lastMoveAt = performance.now();
    this.camera = { scale: 1, x: 0, y: 0, targetScale: 1, targetX: 0, targetY: 0 };
    this.dropStick = null;
    this._free = null; this._freeSprite = null; this._landAt = 0;
    this.tube.reset(rand);
    this.sticks = this.tube.bodies;
    this._refreshPalette();
    this.winner = null;
    this.progress = 0;
    this.energy = 0;
    this.dropTriggered = false;
    this.complete = false;
    this.holding = false;
    this._holdingUi = false;
    this._setProgressUi(0);
    this._syncUi();
    this._emit('stateChange', 'shaking');
  };

  /* ================================================================ PUBLIC API */

  // Replace the participant list. Accepts ["A","B"] or [{name, imageId?}].
  // Same-named entries keep their ids (src: reducer case "SET_NAMES").
  FortuneStick.prototype.setNames = function (list, silent) {
    var old = this.entries;
    var out = [];
    (list || []).forEach(function (item) {
      var name = typeof item === 'string' ? item : (item && item.name);
      var imageId = item && typeof item === 'object' ? item.imageId : undefined;
      name = name === undefined || name === null ? '' : String(name).trim();
      if (!name) return;   // empty names would give an invisible winner -> dropped
      var found = null;
      for (var i = 0; i < old.length; i++) if (old[i].name === name) { found = old[i]; break; }
      out.push(found || Rnd.makeEntry(name, imageId));
    });
    this.entries = out;
    if (this._inited) this._syncUi();
    if (!silent) this._emit('entriesChange', this.getNames());
    return this;
  };
  FortuneStick.prototype.getNames = function () { return this.entries.map(function (e) { return e.name; }); };

  // Press-and-hold the shake button programmatically (same as holding the on-screen button).
  FortuneStick.prototype.startShake = function () { this._holdPress(); return this; };
  FortuneStick.prototype.stopShake = function () { this._holdRelease(); return this; };

  // Release the stick immediately (runs the original drop routine without waiting for the progress bar).
  FortuneStick.prototype.drawNow = function () {
    if (this.state !== 'shaking' || this.entries.length === 0) return this;
    if (this._dropTimer) { clearTimeout(this._dropTimer); this._dropTimer = 0; }
    this.complete = true;
    this.holding = false;
    this._setHoldingUi(false);
    this._drop();
    return this;
  };

  // Last drawn winner of the current round ({name, entryId, index}) or null
  FortuneStick.prototype.getWinner = function () {
    return this.winner ? { name: this.winner.name, entryId: this.winner.entryId, index: this.winner.index } : null;
  };
  FortuneStick.prototype.getWinners = function () { return this.winners.slice(); };
  FortuneStick.prototype.getState = function () { return this.state; };

  // Close the winner presentation (same as pressing "Close") and start the next round.
  FortuneStick.prototype.closeReveal = function () {
    if (this._modal) { this._modal.close(); return this; }
    if (this.state === 'revealed') { this._closeReveal(); }
    return this;
  };

  // Hard reset to the idle "shaking" state without recording a winner.
  FortuneStick.prototype.reset = function () {
    if (!this._inited) return this;
    if (this._dropTimer) { clearTimeout(this._dropTimer); this._dropTimer = 0; }
    if (this._modal) { var mm = this._modal; this._modal = null; if (mm.overlay.parentNode) mm.overlay.parentNode.removeChild(mm.overlay); }
    if (this._confetti) { this._confetti.stop(); this._confetti = null; }
    this._dragEnd();
    this._activePointer = null;
    this._resetRound();
    return this;
  };

  // Re-measure the canvas now (the loop also does this every frame, so resizing is automatic).
  FortuneStick.prototype.resize = function () {
    if (!this._inited || !this.canvas) return this;
    var c = getCanvasDpr();
    var m = this.canvas.clientWidth || 600, h = this.canvas.clientHeight || 600;
    this.canvas.width = Math.floor(m * c);
    this.canvas.height = Math.floor(h * c);
    return this;
  };

  /* ---- NEW: mobile shake API --------------------------------------------------------------- */
  // Call from a user gesture (click/tap handler): iOS shows its permission prompt only then.
  // Resolves 'granted' | 'denied' | 'unsupported'.
  FortuneStick.prototype.requestMotionPermission = function () {
    return this.motion ? this.motion.requestPermission() : Promise.resolve('unsupported');
  };
  // Request permission if needed, then start listening. Resolves with the motion state:
  // 'enabled' | 'denied' | 'unavailable' | 'unsupported'. Never rejects. Call from a user gesture.
  FortuneStick.prototype.enableMotion = function () {
    return this.motion ? this.motion.enable() : Promise.resolve('unsupported');
  };
  FortuneStick.prototype.disableMotion = function () {
    if (this.motion) this.motion.disable();
    return this;
  };
  FortuneStick.prototype.isMotionSupported = function () { return !!(this.motion && this.motion.isSupported()); };
  FortuneStick.prototype.isMotionEnabled = function () { return !!(this.motion && this.motion.isEnabled()); };
  FortuneStick.prototype.getMotionState = function () { return this.motion ? this.motion.getState() : 'unsupported'; };

  FortuneStick.prototype.setTheme = function (theme) {
    this.opts.theme = theme === 'dark' ? 'dark' : 'light';
    var cls = this._scopeClass();
    this.stage.className = 'fs-stage ' + cls;
    this._compact = null;
    this.overlayRoot.className = cls;
    this._refreshPalette();
    return this;
  };
  FortuneStick.prototype.setLang = function (lang) {
    this.opts.lang = lang; this._syncUi(); return this;
  };
  FortuneStick.prototype.setSound = function (enabled, volume) {
    this.audio.setMuted(!enabled);
    if (volume !== undefined) this.audio.setVolume(volume);
    return this;
  };

  FortuneStick.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._rafId);
    if (this._dropTimer) clearTimeout(this._dropTimer);
    if (this._confetti) this._confetti.stop();
    global.removeEventListener('pointerup', this._h.winUp);
    global.removeEventListener('pointercancel', this._h.winUp);
    global.removeEventListener('blur', this._h.winUp);
    document.removeEventListener('visibilitychange', this._h.vis);
    if (this.motion) this.motion.destroy();
    if (this.audio) this.audio.destroy();
    if (this.stage && this.stage.parentNode) this.stage.parentNode.removeChild(this.stage);
    if (this.overlayRoot && this.overlayRoot.parentNode) this.overlayRoot.parentNode.removeChild(this.overlayRoot);
    this._listeners = {};
  };

  global.FortuneStick = FortuneStick;
})(window);

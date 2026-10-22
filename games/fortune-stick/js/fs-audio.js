/*
 * fs-audio.js
 * ------------------------------------------------------------------
 * SOURCE: module 53717 (AudioProvider / useAudio) in chunk 0-kw_sww1unm8.js
 *
 * Kept from the original:
 *   - Web Audio first (decoded AudioBuffer -> BufferSource -> GainNode),
 *     HTML5 <audio> as fallback when a buffer is not decoded yet
 *   - gain = (options.volume ?? 0.5) * masterSfxVolume   (master = 0.6)
 *   - options.pitch -> playbackRate
 *   - buffers are pre-fetched/decoded 3 s after load (requestIdleCallback
 *     when available)
 *   - AudioContext is resumed on the first click/mousedown/keydown/touchstart
 *   - if the context is suspended and the user has never interacted, the
 *     sound waits for resume() and plays only if the context is "running"
 *
 * Differences (required by the offline / file:// requirement):
 *   - on file:// fetch() is blocked by the browser, so the identical mp3
 *     bytes embedded in fs-audio-data.js are decoded instead
 *   - only the three sounds that Fortune Stick uses are registered
 *     (shuffle, whoosh, tada); background music is not used by this mode
 *   - the host site's localStorage persistence of volume/mute is dropped
 */
(function (global) {
  'use strict';

  var SOUND_FILES = {
    SHUFFLE: 'audio/shuffle.mp3',
    WHOOSH: 'audio/whoosh.mp3',
    TADA: 'audio/tada.mp3'
  };
  // original alias table: both "shuffle" and "/sfx/shuffle.mp3" resolve
  var ALIAS = {
    '/sfx/shuffle.mp3': 'SHUFFLE', shuffle: 'SHUFFLE',
    '/sfx/whoosh.mp3': 'WHOOSH', whoosh: 'WHOOSH',
    '/sfx/tada.mp3': 'TADA', tada: 'TADA'
  };

  function b64ToArrayBuffer(dataUri) {
    var b64 = dataUri.slice(dataUri.indexOf(',') + 1);
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function AudioEngine(opts) {
    opts = opts || {};
    this.assetBase = opts.assetBase;
    this.muted = !!opts.muted;
    this.sfxVolume = opts.sfxVolume !== undefined ? opts.sfxVolume : 0.6;
    this.ctx = null;
    this.buffers = new Map();
    this.userActivated = !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
    this._prefetchTimer = null;
    this._destroyed = false;
    this._onActivate = this._onActivate.bind(this);

    var self = this;
    ['click', 'mousedown', 'keydown', 'touchstart'].forEach(function (t) {
      global.addEventListener(t, self._onActivate, { capture: true, passive: true });
    });

    // The original created the AudioContext at mount time (Chrome then logs an autoplay warning).
    // Here it is created as soon as the browser allows it (first user gesture) - same audible result.
    this._prefetchStarted = false;
    this._timerDone = false;
    if (this.userActivated) this._ensureCtx();

    this._prefetchTimer = setTimeout(function () {
      self._timerDone = true;
      self._maybePrefetch();
    }, 3000);
  }

  AudioEngine.prototype._ensureCtx = function () {
    if (this.ctx || this._destroyed) return this.ctx;
    var Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) return null;           // browser without Web Audio -> HTML5 <audio> fallback only
    try {
      this.ctx = new Ctor();
      this.ctx.resume().catch(function () {});
    } catch (e) {
      this.ctx = null;
    }
    return this.ctx;
  };

  // pre-decode 3 s after load (requestIdleCallback when available), as in the original
  AudioEngine.prototype._maybePrefetch = function () {
    var self = this;
    if (this._prefetchStarted || !this._timerDone || !this.ctx || this._destroyed) return;
    this._prefetchStarted = true;
    if ('requestIdleCallback' in global) global.requestIdleCallback(function () { self._prefetchAll(); });
    else this._prefetchAll();
  };

  AudioEngine.prototype._onActivate = function () {
    this.userActivated = true;
    this._ensureCtx();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
    this._maybePrefetch();
  };

  AudioEngine.prototype._url = function (key) {
    return this.assetBase + SOUND_FILES[key];
  };

  AudioEngine.prototype._prefetchAll = function () {
    var self = this;
    if (!this.ctx) return;
    Object.keys(SOUND_FILES).forEach(function (key) { self._prefetchOne(key); });
  };

  AudioEngine.prototype._prefetchOne = function (key) {
    var self = this;
    var ctx = this.ctx;
    var embedded = global.FS_AUDIO_DATA && global.FS_AUDIO_DATA[key];
    var getBytes;
    if (global.location.protocol === 'file:') {
      // fetch() of file:// is blocked -> use the embedded copy (same bytes)
      getBytes = Promise.resolve(embedded ? b64ToArrayBuffer(embedded) : null);
    } else {
      getBytes = fetch(this._url(key)).then(function (r) {
        if (!r.ok) throw new Error('Network status ' + r.status);
        return r.arrayBuffer();
      }).catch(function () {
        return embedded ? b64ToArrayBuffer(embedded) : null;
      });
    }
    getBytes.then(function (ab) {
      if (!ab || self._destroyed) return;
      ctx.decodeAudioData(ab, function (buf) { self.buffers.set(key, buf); }, function () {});
    }).catch(function () {});
  };

  AudioEngine.prototype._getCtx = function () {
    if (!this.ctx && this.userActivated) this._ensureCtx();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  };

  // source: playSfx(name, {volume, pitch})
  AudioEngine.prototype.play = function (name, options) {
    if (this.muted || this._destroyed) return;
    var self = this;
    var key = ALIAS[name] || name;
    var vol = options && options.volume !== undefined ? options.volume : 0.5;

    function go() {
      var buf = self.buffers.get(key);
      if (buf) {
        try {
          var ctx = self._getCtx();
          if (ctx) {
            var src = ctx.createBufferSource();
            src.buffer = buf;
            var gain = ctx.createGain();
            gain.gain.value = vol * self.sfxVolume;
            if (options && options.pitch !== undefined) src.playbackRate.value = options.pitch;
            src.connect(gain);
            gain.connect(ctx.destination);
            src.start(0);
            return;
          }
        } catch (e) { /* fall through to HTML5 audio */ }
      }
      try {
        if (!SOUND_FILES[key]) return;
        var a = new Audio(self._url(key));
        a.volume = Math.max(0, Math.min(1, vol * self.sfxVolume));
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) { /* ignore */ }
    }

    if (!this.userActivated) {
      var ctx0 = this.ctx;   // no gesture yet -> nothing is created, nothing can be heard (HTML5 fallback is blocked too)
      if (ctx0 && ctx0.state === 'suspended') {
        ctx0.resume().then(function () { if (ctx0.state === 'running') go(); }).catch(function () {});
        return;
      }
    }
    go();
  };

  AudioEngine.prototype.setMuted = function (m) { this.muted = !!m; };
  AudioEngine.prototype.setVolume = function (v) {
    this.sfxVolume = Math.max(0, Math.min(1, v));
  };

  AudioEngine.prototype.destroy = function () {
    this._destroyed = true;
    clearTimeout(this._prefetchTimer);
    var self = this;
    ['click', 'mousedown', 'keydown', 'touchstart'].forEach(function (t) {
      global.removeEventListener(t, self._onActivate, { capture: true });
    });
    if (this.ctx && this.ctx.close) this.ctx.close().catch(function () {});
    this.ctx = null;
  };

  global.FSAudio = AudioEngine;
})(window);

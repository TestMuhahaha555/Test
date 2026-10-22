/*
 * fs-effects.js
 * ------------------------------------------------------------------
 * (Confetti moved to fs-confetti.js)
 * 2) spring()       - replaces the third-party framer-motion runtime (NOT in the 3 source files).
 *                     Closed-form damped spring, mass 1, initial velocity 0. The stiffness/damping/
 *                     delay/initial values passed in by fortune-stick.js are the ones written in the
 *                     original component; only framer-motion's internal solver is re-implemented.
 * 3) Toast          - SOURCE: ToastProvider in module 75045 (chunk 0-kw_sww1unm8.js): message +
 *                     Undo + close + 5000 ms progress bar. Stacking animation of several toasts
 *                     (framer layout animation) is simplified to a single toast.
 */
(function (global) {
  'use strict';
  /* ------------------------------------------------------------------ Spring */
  // value(t) for a spring going 0 -> 1 with v0 = 0; t in seconds.
  function springUnit(t, stiffness, damping) {
    var m = 1;
    var w0 = Math.sqrt(stiffness / m);
    var z = damping / (2 * Math.sqrt(stiffness * m));
    if (z < 1) {
      var wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t); // critically damped (z >= 1 approximation)
  }

  // spring({from:{}, to:{}, stiffness, damping, delay, onUpdate(values), onDone})
  function spring(o) {
    var keys = Object.keys(o.to);
    var from = o.from;
    var delay = (o.delay || 0) * 1000;
    var z = o.damping / (2 * Math.sqrt(o.stiffness));
    var w0 = Math.sqrt(o.stiffness);
    var duration = (z > 0 ? Math.log(1000) / (z * w0) : 2) * 1000;
    var start = null, raf = 0, cancelled = false;

    function apply(k) {
      var v = {};
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        v[key] = from[key] + (o.to[key] - from[key]) * k;
      }
      o.onUpdate(v);
    }
    apply(0);
    function tick(now) {
      if (cancelled) return;
      if (start === null) start = now;
      var el = now - start - delay;
      if (el < 0) { raf = requestAnimationFrame(tick); return; }
      if (el >= duration) { apply(1); if (o.onDone) o.onDone(); return; }
      apply(springUnit(el / 1000, o.stiffness, o.damping));
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return { cancel: function () { cancelled = true; cancelAnimationFrame(raf); } };
  }

  /* ------------------------------------------------------------------- Toast */
  // showToast(parent, message, {onUndo, duration}, undoLabel) -> {remove()}
  function showToast(parent, message, options, undoLabel) {
    options = options || {};
    var duration = options.duration || 5000;
    var host = parent.querySelector('.fs-toast-stack');
    if (!host) {
      host = document.createElement('div');
      host.className = 'fs-toast-stack';
      parent.appendChild(host);
    }
    var item = document.createElement('div');
    item.className = 'fs-toast-item';
    var content = document.createElement('div');
    content.className = 'toast-content';
    content.style.cssText = 'position:relative;overflow:hidden';
    var msg = document.createElement('span');
    msg.className = 'toast-message';
    msg.textContent = message;
    content.appendChild(msg);

    function remove() {
      item.classList.remove('is-in');
      setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 200);
    }
    if (options.onUndo) {
      var undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'toast-undo-btn';
      undo.textContent = undoLabel;
      undo.addEventListener('click', function () { options.onUndo(); remove(); });
      content.appendChild(undo);
    }
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close-btn';
    close.setAttribute('aria-label', 'close');
    close.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    close.addEventListener('click', remove);
    content.appendChild(close);
    var bar = document.createElement('div');
    bar.className = 'toast-progress-bar';
    bar.style.cssText = 'position:absolute;bottom:0;left:0;height:3px;background:var(--accent);width:100%;opacity:.8;transition:width ' + duration + 'ms linear';
    content.appendChild(bar);
    item.appendChild(content);
    host.appendChild(item);
    setTimeout(function () { item.classList.add('is-in'); bar.style.width = '0%'; }, 50);
    setTimeout(remove, duration + 100);
    return { remove: remove };
  }

  global.FSEffects = { spring: spring, showToast: showToast };
})(window);

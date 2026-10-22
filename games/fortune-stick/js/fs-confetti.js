/*
 * fs-confetti.js  —  winner celebration (presentation layer, no link to the physics)
 * ------------------------------------------------------------------
 * SOURCE-DERIVED: function `o` ("Confetti") of module 77582 in chunk 0gdvtar4_ps8k.js
 * (an identical copy lives in chunk 0dl57pz34s-sq.js; only minifier variable names differ).
 * The original has NO external confetti library (no "canvas-confetti"): it is a 150-line
 * hand written canvas particle system, and that is what is ported here.
 *
 * Kept 1:1 from the original (values AND order of operations):
 *   - canvas: position fixed, 0/0, 100vw x 100vh, pointer-events none, z-index 9999;
 *     bitmap size = window.innerWidth x window.innerHeight read once at start (no DPR scaling)
 *   - 12 colours, shape rect|circle (random()>.5), colour = COLORS[randomInt(12)]
 *   - rain(): 150 particles at start
 *       x = rand*innerWidth          y = -20 - 100*rand
 *       vx = (rand-.5)*8             vy = 3*rand + 2
 *       size = 8*rand + 4            rotation = 360*rand     rotationSpeed = (rand-.5)*10
 *   - burst(x,y): 60 particles, angle = 2*PI*i/60 + (rand-.5)*.5, speed = 12*rand + 4,
 *       size = 6*rand + 2, rotation = 360*rand, rotationSpeed = (rand-.5)*20
 *   - 3 bursts via setTimeout: 600 ms (.25w,.4h) / 1200 ms (.75w,.3h) / 1800 ms (.5w,.5h);
 *     the last one arms the "finished" check
 *   - per frame, per particle (iterating from last to first):
 *       x += vx; y += vy; vy += .12; vx *= .96; rotation += rotationSpeed;
 *       opacity -= (y > .8*height) ? .03 : .005; drawn only while opacity > 0
 *       rect: fillRect(-s/2, -s/4, s, s/2)   circle: arc(0,0,s/2)
 *   - the animation is frame based (no delta time), exactly like the original: speed follows
 *     the display refresh rate (a 120 Hz screen plays it twice as fast as 60 Hz)
 *   - finished when the last burst has been emitted AND no particle is visible -> onComplete,
 *     then the loop stops. Closing the winner dialog cancels frame + timers (original cleanup)
 *   - random source: the same FSRandom (crypto.getRandomValues) the original uses
 *
 * Added here (not in the original, behaviour-neutral):
 *   - only one celebration can exist at a time (starting a new one stops the previous one)
 *   - stop() is idempotent and drops the particle array; activeCount()/stats() for tests
 */
(function (global) {
  'use strict';
  var Rnd = global.FSRandom;

  var COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD',
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9', '#F8C471', '#82E0AA'];

  // src: d()
  function rain() {
    var a = [];
    for (var i = 0; i < 150; i++) {
      a.push({
        x: Rnd.random() * global.innerWidth,
        y: -20 - 100 * Rnd.random(),
        vx: (Rnd.random() - 0.5) * 8,
        vy: 3 * Rnd.random() + 2,
        size: 8 * Rnd.random() + 4,
        color: COLORS[Rnd.randomInt(COLORS.length)],
        rotation: 360 * Rnd.random(),
        rotationSpeed: (Rnd.random() - 0.5) * 10,
        opacity: 1,
        shape: Rnd.random() > 0.5 ? 'rect' : 'circle'
      });
    }
    return a;
  }

  // src: u(x, y)
  function burst(x, y) {
    var a = [];
    for (var i = 0; i < 60; i++) {
      var ang = 2 * Math.PI * i / 60 + (Rnd.random() - 0.5) * 0.5;
      var sp = 12 * Rnd.random() + 4;
      a.push({
        x: x, y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        size: 6 * Rnd.random() + 2,
        color: COLORS[Rnd.randomInt(COLORS.length)],
        rotation: 360 * Rnd.random(),
        rotationSpeed: (Rnd.random() - 0.5) * 20,
        opacity: 1,
        shape: Rnd.random() > 0.5 ? 'rect' : 'circle'
      });
    }
    return a;
  }

  var current = null;   // the one live celebration (if any)

  // start(parent, onComplete) -> { stop(), isActive(), stats() }
  function start(parent, onComplete) {
    if (current) current.stop();

    var canvas = document.createElement('canvas');
    canvas.className = 'fs-confetti';
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9999';
    var ctx = canvas.getContext('2d');
    if (!ctx) return { stop: function () {}, isActive: function () { return false; }, stats: function () { return { created: 0, alive: 0 }; } };
    parent.appendChild(canvas);
    canvas.width = global.innerWidth;
    canvas.height = global.innerHeight;

    var particles = rain();
    var created = particles.length;
    var stopped = false;
    var finalBurstDone = false;
    var raf = 0;
    var alive = particles.length;

    var t1 = setTimeout(function () {
      var b = burst(0.25 * global.innerWidth, 0.4 * global.innerHeight); created += b.length; particles.push.apply(particles, b);
    }, 600);
    var t2 = setTimeout(function () {
      var b = burst(0.75 * global.innerWidth, 0.3 * global.innerHeight); created += b.length; particles.push.apply(particles, b);
    }, 1200);
    var t3 = setTimeout(function () {
      var b = burst(0.5 * global.innerWidth, 0.5 * global.innerHeight); created += b.length; particles.push.apply(particles, b);
      finalBurstDone = true;
    }, 1800);

    function frame() {
      if (stopped) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var count = 0;
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        if (p.opacity <= 0) continue;
        count++;
        p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.vx *= 0.96;
        p.rotation += p.rotationSpeed;
        if (p.y > 0.8 * canvas.height) p.opacity -= 0.03; else p.opacity -= 0.005;
        if (p.opacity > 0) {
          ctx.save();
          ctx.globalAlpha = p.opacity;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation * Math.PI / 180);
          ctx.fillStyle = p.color;
          if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, 2 * Math.PI); ctx.fill(); }
          ctx.restore();
        }
      }
      alive = count;
      if (finalBurstDone && count === 0) {
        raf = 0;
        if (onComplete) onComplete();     // src: n?.()  (the host then unmounts the canvas)
        handle.stop();
      } else {
        raf = requestAnimationFrame(frame);
      }
    }
    raf = requestAnimationFrame(frame);

    var handle = {
      stop: function () {
        if (stopped) return;
        stopped = true;
        if (raf) cancelAnimationFrame(raf);
        clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        particles = [];
        alive = 0;
        if (current === handle) current = null;
      },
      isActive: function () { return !stopped; },
      stats: function () { return { created: created, alive: alive }; }
    };
    current = handle;
    return handle;
  }

  global.FSConfetti = {
    start: start,
    activeCount: function () { return current && current.isActive() ? 1 : 0; }
  };
})(window);

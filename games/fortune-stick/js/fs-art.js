/*
 * fs-art.js  —  NEW (Wan Wan redesign). Graphics only: no physics, no state.
 * ------------------------------------------------------------------------------------------------
 * Produces the artwork of the fortune-stick scene in the visual language of the Wan Wan site:
 * warm pastel palette, rounded shapes, a dark "ink" outline (~2 px), flat fills with soft gradients.
 *
 *  - palette(theme)  reads the site's own CSS variables (--th-acc, --ink, --card, --bg, --line, --sub)
 *                    from <html>, so every palette / light / dark mode of the site is followed. When the
 *                    variables do not exist (standalone use) sensible defaults are used.
 *  - cylinderSvg(layer, pal)  the cylinder as SVG text, split in two groups that are drawn on either
 *                    side of the sticks:   "back"  = open mouth, rim, dark inside
 *                                          "front" = near rim, body, bands, ornament, gloss
 *                    viewBox 0 0 100 210, mouth centre at (50,16): same footprint as the original image.
 *  - buildCylinder(pal, scale, cb)  rasterises both layers once into canvases (crisp at any DPR, cheap
 *                    to draw every frame). Theme colours are baked in here because an <img> SVG cannot
 *                    inherit CSS variables.
 *  - stickSprite(stick, pal, scale)  one canvas per stick (wood grain, red lacquer cap, incised marks).
 *
 * Geometry shared with fs-physics.js: inner half width 40, mouth plane y = 0 (= svg y 16), floor y = 174.
 */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- colour helpers */
  function parse(c) {
    if (!c) return null;
    c = String(c).trim();
    var m = /^#([0-9a-f]{3})$/i.exec(c);
    if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
    m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(c);
    if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
    return null;
  }
  function hex(rgb) {
    function h(v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }
    return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
  }
  function mix(a, b, t) {            // a, b: [r,g,b]; t = 0 -> a, 1 -> b
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  var WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  function rgba(rgb, a) { return 'rgba(' + Math.round(rgb[0]) + ',' + Math.round(rgb[1]) + ',' + Math.round(rgb[2]) + ',' + a + ')'; }

  /* ---------------------------------------------------------------- palette */
  function hostVar(name) {
    try {
      var cs = global.getComputedStyle(global.document.documentElement);
      return parse(cs.getPropertyValue(name));
    } catch (e) { return null; }
  }
  var PATTERNS = ['lattice', 'lotus', 'cloud'];
  function palette(theme, pattern) {
    var dark = theme === 'dark';
    var accent = hostVar('--th-acc') || hostVar('--mon-d') || [198, 91, 91];          // Wan Wan rose red
    var ink = hostVar('--ink') || (dark ? [241, 236, 227] : [43, 38, 32]);
    var card = hostVar('--card') || (dark ? [36, 32, 25] : [255, 255, 255]);
    var bg = hostVar('--bg') || (dark ? [27, 24, 21] : [250, 246, 240]);
    var line = hostVar('--line') || (dark ? [58, 52, 44] : [231, 222, 210]);
    var hasHost = !!(hostVar('--bg') && hostVar('--ink'));
    // the lacquer must stay readable on both themes: lift a very dark accent, calm a very light one
    var lum = (0.299 * accent[0] + 0.587 * accent[1] + 0.114 * accent[2]) / 255;
    if (lum < 0.3) accent = mix(accent, WHITE, 0.25);
    if (dark && lum > 0.72) accent = mix(accent, BLACK, 0.2);
    var outline = dark ? mix(accent, BLACK, 0.72) : (hasHost ? ink : [45, 52, 54]);
    var gold = [233, 185, 73];
    return {
      theme: dark ? 'dark' : 'light', hasHost: hasHost,
      accent: hex(accent),
      accentLight: hex(mix(accent, WHITE, 0.28)), accentDark: hex(mix(accent, BLACK, 0.26)), accentDeep: hex(mix(accent, BLACK, 0.5)),
      gold: hex(gold), goldLight: hex(mix(gold, WHITE, 0.45)), goldDark: hex(mix(gold, BLACK, 0.32)),
      outline: hex(outline), outlineRgb: outline,
      ink: hex(ink), inkRgb: ink, card: hex(card), bg: hex(bg), bgRgb: bg, line: hex(line),
      interiorTop: hex(mix(accent, BLACK, 0.62)), interiorBot: hex(mix(accent, BLACK, 0.86)),
      // dark-theme sky of the stage (gradient + stars drawn by the engine)
      skyTop: hex(mix(bg, BLACK, 0.5)), skyMid: hex(mix(bg, BLACK, 0.18)), skyBot: hex(mix(bg, accent, 0.12)),
      pattern: PATTERNS.indexOf(pattern) >= 0 ? pattern : 'lattice',
      key: [accent.join(), bg.join(), ink.join(), dark ? 'd' : 'l', PATTERNS.indexOf(pattern) >= 0 ? pattern : 'lattice'].join('|')
    };
  }

  /* ---------------------------------------------------------------- cylinder SVG */
  function cylinderSvg(layer, pal) {
    var o = pal.outline, W = 2.4;
    var defs =
      '<linearGradient id="fb" x1="0" x2="1" y1="0" y2="0">' +
        '<stop offset="0" stop-color="' + pal.accentDeep + '"/><stop offset=".12" stop-color="' + pal.accentDark + '"/>' +
        '<stop offset=".34" stop-color="' + pal.accentLight + '"/><stop offset=".55" stop-color="' + pal.accent + '"/>' +
        '<stop offset=".88" stop-color="' + pal.accentDark + '"/><stop offset="1" stop-color="' + pal.accentDeep + '"/></linearGradient>' +
      '<linearGradient id="fg" x1="0" x2="1" y1="0" y2="0">' +
        '<stop offset="0" stop-color="' + pal.goldDark + '"/><stop offset=".3" stop-color="' + pal.goldLight + '"/>' +
        '<stop offset=".62" stop-color="' + pal.gold + '"/><stop offset="1" stop-color="' + pal.goldDark + '"/></linearGradient>' +
      '<linearGradient id="fi" x1="0" x2="0" y1="0" y2="1">' +
        '<stop offset="0" stop-color="' + pal.interiorTop + '"/><stop offset="1" stop-color="' + pal.interiorBot + '"/></linearGradient>' +
      '<linearGradient id="fs" x1="0" x2="0" y1="0" y2="1">' +
        '<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>';
    var body;
    if (layer === 'back') {
      body =
        '<g id="fs-back">' +
          // rim (top face of the tube wall)
          '<ellipse cx="50" cy="16" rx="46" ry="12" fill="url(#fg)" stroke="' + o + '" stroke-width="' + W + '"/>' +
          // open mouth: the dark inside
          '<ellipse cx="50" cy="16.5" rx="41" ry="8.8" fill="url(#fi)" stroke="' + o + '" stroke-width="1.3"/>' +
          // light catching the far inner wall
          '<path d="M13 14.2 A37.5 6.2 0 0 1 87 14.2" fill="none" stroke="' + pal.accentLight + '" stroke-opacity=".28" stroke-width="1.6" stroke-linecap="round"/>' +
        '</g>';
    } else {
      body =
        '<g id="fs-front">' +
          // the opening shades whatever stands inside it
          '<ellipse cx="50" cy="16.5" rx="41" ry="8.8" fill="url(#fs)"/>' +
          // body
          '<path id="fs-body" d="M4 16 A46 12 0 0 0 96 16 L96 192 A46 12 0 0 1 4 192 Z" fill="url(#fb)" stroke="' + o + '" stroke-width="' + W + '" stroke-linejoin="round"/>' +
          // upper and lower gold bands
          '<path d="M4.6 16.8 A45.4 11.6 0 0 0 95.4 16.8 L95.4 31 A45.4 11.6 0 0 1 4.6 31 Z" fill="url(#fg)" stroke="' + o + '" stroke-width="1.5" stroke-linejoin="round"/>' +
          '<path d="M4.6 171 A45.4 11.6 0 0 0 95.4 171 L95.4 181 A45.4 11.6 0 0 1 4.6 181 Z" fill="url(#fg)" stroke="' + o + '" stroke-width="1.5" stroke-linejoin="round"/>' +
          // ornament (see PATTERNS) between two dotted rules that follow the curve of the tube
          dots(pal) + patternSvg(pal) +
          // gloss (left) and form shadow (right)
          '<path d="M13 40 L13 165" stroke="#fff" stroke-opacity=".28" stroke-width="3.2" stroke-linecap="round" fill="none"/>' +
          '<path d="M19 44 L19 150" stroke="#fff" stroke-opacity=".14" stroke-width="1.6" stroke-linecap="round" fill="none"/>' +
          '<path d="M89 38 L89 166" stroke="#000" stroke-opacity=".14" stroke-width="5" stroke-linecap="round" fill="none"/>' +
          // near lip of the rim, in front of the sticks
          '<path d="M4 16 A46 12 0 0 0 96 16 L91 16.5 A41 8.8 0 0 1 9 16.5 Z" fill="url(#fg)" stroke="' + o + '" stroke-width="1.6" stroke-linejoin="round"/>' +
          '<path d="M12 21.8 A38 6.4 0 0 0 88 21.8" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2" stroke-linecap="round"/>' +
        '</g>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 210" width="100" height="210"><defs>' + defs + '</defs>' + body + '</svg>';
  }
  function patternSvg(pal) {
    if (pal.pattern === 'lotus') return '<g transform="translate(50 104)" fill="none" stroke-linecap="round" stroke-linejoin="round">' + medallion(pal) + '</g>';
    if (pal.pattern === 'cloud') return '<g transform="translate(50 104)" fill="none" stroke-linecap="round" stroke-linejoin="round">' + cloudOrnament(pal.accentDeep, 3.9, 0.55) + cloudOrnament(pal.goldLight, 2.3, 1) + '</g>';
    return lattice(pal);
  }
  // Thai "prajam yam" lattice: staggered four-petal flowers joined by diagonal vines. The columns are spread
  // around the tube (x = sin, flower width = cos) so the pattern really wraps and squeezes towards the edges.
  function lattice(pal) {
    var ink = pal.accentDeep, rows = 5, R = Math.PI / 180, cx0 = 50, rx = 43, ry = 11.6, y0 = 48, step = 24, r, c, pts = [], out = '';
    for (r = 0; r < rows; r++) {
      var offs = r % 2 ? 15 : 0, row = [], deg;
      for (c = -3; c <= 3; c++) {
        deg = c * 30 + offs;
        if (Math.abs(deg) > 66) continue;
        row.push({ x: cx0 + rx * Math.sin(deg * R), y: y0 + r * step + ry * Math.cos(deg * R), k: Math.cos(deg * R), deg: deg });
      }
      pts.push(row);
    }
    // vines between neighbouring rows
    var vine = '';
    for (r = 0; r < rows - 1; r++) {
      pts[r].forEach(function (a) {
        pts[r + 1].forEach(function (b) {
          if (Math.abs(Math.abs(a.deg - b.deg) - 15) < 0.5) vine += 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ' L' + b.x.toFixed(1) + ' ' + b.y.toFixed(1);
        });
      });
    }
    out += '<path d="' + vine + '" fill="none" stroke="' + ink + '" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>';
    out += '<path d="' + vine + '" fill="none" stroke="' + pal.goldDark + '" stroke-opacity=".9" stroke-width="1.1" stroke-linecap="round"/>';
    var petal = 'M0 -7.5 Q2 -2 7.5 0 Q2 2 0 7.5 Q-2 2 -7.5 0 Q-2 -2 0 -7.5 Z';
    pts.forEach(function (row, ri) {
      row.forEach(function (a) {
        var sx = Math.max(0.3, a.k);
        out += '<g transform="translate(' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ') scale(' + sx.toFixed(2) + ' 1)">' +
          '<path d="' + petal + '" fill="' + (ri % 2 ? pal.gold : pal.goldLight) + '" stroke="' + ink + '" stroke-width="1.2" stroke-linejoin="round"/>' +
          '<circle r="1.9" fill="' + pal.goldDark + '"/></g>';
      });
    });
    return out;
  }
  function cloudOrnament(stroke, w, op) {
    var s = ' stroke="' + stroke + '" stroke-width="' + w + '" stroke-opacity="' + op + '"';
    return '' +
      '<path d="M-36 -22 C-33 -29 -27 -29 -23 -23 C-18 -30 -10 -30 -5 -23 C1 -30 9 -30 14 -23 C19 -29 26 -29 29 -23 C33 -28 36 -27 38 -22"' + s + '/>' +
      '<path d="M-23 -23 C-27 -29 -35 -27 -33 -19 C-31 -11 -21 -13 -25 -19 C-27 -23 -31 -21 -29 -17"' + s + '/>' +
      '<path d="M23 -23 C27 -29 35 -27 33 -19 C31 -11 21 -13 25 -19 C27 -23 31 -21 29 -17"' + s + '/>' +
      '<path d="M-37 -9 Q-18 -22 0 -9 Q18 4 37 -9"' + s + '/>' +
      '<path d="M-14 3 C-18 15 -3 19 0 11 C3 3 -8 1 -4 9 C-2 13 3 11 1 7"' + s + '/>' +
      '<path d="M-37 13 C-31 21 -25 21 -19 15 C-13 22 -7 22 -1 16 M11 16 C17 22 23 22 29 15 C35 21 40 20 43 14"' + s + '/>';
  }
  // two rows of small gold dots, bowl-shaped like the bands of the tube
  function dots(pal) {
    var st = ' fill="none" stroke="' + pal.goldLight + '" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="0.1 5.4"';
    return '<path d="M10 36 Q50 60 90 36"' + st + '/><path d="M10 165 Q50 188 90 165"' + st + '/>';
  }
  function medallion(pal) {
    var ink = pal.accentDeep, g = pal.gold, gl = pal.goldLight, gd = pal.goldDark, i, out = '';
    // soft dark disc behind, so the gold reads on any lacquer colour
    out += '<circle r="22" fill="' + pal.accentDeep + '" fill-opacity=".38"/>';
    // side scrolls and leaves (mirrored left/right; leaves also mirrored up/down)
    var scroll = 'M-21 0 C-27 -9 -39 -9 -41 -1 C-43 7 -33 10 -31 3 C-30 -1 -35 -2 -36 1';
    var leaf = 'M-24 -13 Q-31 -23 -41 -19 Q-35 -11 -24 -13 Z';
    [[1, 1], [-1, 1]].forEach(function (m) {
      var tf = ' transform="scale(' + (m[0] * 0.93) + ' 0.93)"';
      out += '<path d="' + scroll + '"' + tf + ' stroke="' + ink + '" stroke-opacity=".6" stroke-width="3.8"/>' +
             '<path d="' + scroll + '"' + tf + ' stroke="' + gl + '" stroke-width="2.2"/>';
    });
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function (m) {
      out += '<path d="' + leaf + '" transform="scale(' + (m[0] * 0.93) + ' ' + (m[1] * 0.93) + ')" fill="' + g + '" stroke="' + ink + '" stroke-width="1.3"/>';
    });
    // outer ring
    out += '<circle r="20" stroke="' + ink + '" stroke-opacity=".6" stroke-width="3.6"/><circle r="20" stroke="' + gl + '" stroke-width="2"/>';
    // eight petals
    for (i = 0; i < 8; i++) {
      out += '<ellipse cx="0" cy="-10.5" rx="4.1" ry="7.6" transform="rotate(' + (i * 45) + ')" fill="' + (i % 2 ? g : gl) + '" stroke="' + ink + '" stroke-width="1.2"/>';
    }
    // heart of the flower
    out += '<circle r="5.6" fill="' + gd + '" stroke="' + ink + '" stroke-width="1.2"/><circle r="2.3" fill="' + gl + '"/>';
    return out;
  }

  /* ---------------------------------------------------------------- rasterising */
  function makeCanvas(w, h) {
    var c = global.document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  // cb(result) is called once both layers are ready; result = {back, front, scale, key}. Never throws.
  function buildCylinder(pal, scale, cb) {
    var out = { back: null, front: null, scale: scale, key: pal.key }, pending = 2, failed = false;
    function done() { if (--pending === 0) cb(failed ? null : out); }
    ['back', 'front'].forEach(function (layer) {
      var svg = cylinderSvg(layer, pal), tried = 0;
      function load(src, revoke) {
        var img = new global.Image();
        img.onload = function () {
          try {
            var cv = makeCanvas(100 * scale, 210 * scale);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            out[layer] = cv;
          } catch (e) { failed = true; }
          if (revoke) { try { global.URL.revokeObjectURL(src); } catch (e2) { /* ignore */ } }
          done();
        };
        img.onerror = function () {
          if (revoke) { try { global.URL.revokeObjectURL(src); } catch (e3) { /* ignore */ } }
          if (tried++ === 0 && global.Blob && global.URL && global.URL.createObjectURL) {
            // some browsers refuse data: SVGs on a canvas: retry through a blob URL
            load(global.URL.createObjectURL(new global.Blob([svg], { type: 'image/svg+xml' })), true);
          } else { failed = true; try { console.warn('FortuneStick: cylinder art could not be decoded'); } catch (e4) { /* ignore */ } done(); }
        };
        img.src = src;
      }
      load('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), false);
    });
  }

  function rrPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  var PAD = 3;   // sprite margin (css px) so the outline is never cut
  // depth shading per layer (0 = back): sticks further back are slightly darker
  function layerDark(layer, layers) { return layers > 1 ? 0.26 * (1 - layer / (layers - 1)) : 0; }

  /* One stick: flat wooden slip, rounded top with a red lacquer cap, thin gold line, incised marks,
   * gently tapered lower end. Local frame of the sprite: x centre line, y = 0 at the TOP end. */
  function stickSprite(st, pal, scale, layers) {
    var w = st.wid, len = st.len, cv = makeCanvas((w + 2 * PAD) * scale, (len + 2 * PAD) * scale), x = cv.getContext('2d');
    x.scale(scale, scale); x.translate(w / 2 + PAD, PAD);
    var hw = w / 2, taper = 1.2, r = 2.6;
    function shape() {
      x.beginPath();
      x.moveTo(-hw + r, 0); x.lineTo(hw - r, 0); x.quadraticCurveTo(hw, 0, hw, r);
      x.lineTo(hw - taper, len - 3); x.quadraticCurveTo(hw - taper, len, hw - taper - 2, len);
      x.lineTo(-hw + taper + 2, len); x.quadraticCurveTo(-hw + taper, len, -hw + taper, len - 3);
      x.lineTo(-hw, r); x.quadraticCurveTo(-hw, 0, -hw + r, 0); x.closePath();
    }
    // wood
    var base = parse(st.shade) || [229, 192, 123];
    var g = x.createLinearGradient(-hw, 0, hw, 0);
    g.addColorStop(0, hex(mix(base, BLACK, 0.2))); g.addColorStop(0.3, hex(mix(base, WHITE, 0.16)));
    g.addColorStop(0.7, hex(base)); g.addColorStop(1, hex(mix(base, BLACK, 0.24)));
    shape(); x.fillStyle = g; x.fill();
    x.save(); shape(); x.clip();
    // grain: a few faint lines, wavy and different per stick
    x.strokeStyle = rgba(mix(base, BLACK, 0.55), 0.22); x.lineWidth = 0.6;
    var gn = 3, i, off, ph;
    for (i = 0; i < gn; i++) {
      off = -hw + (i + 0.7) * (w / (gn + 0.4)); ph = st.seed * 9 + i * 1.7;
      x.beginPath(); x.moveTo(off, 24);
      for (var yy = 24; yy <= len; yy += 12) x.lineTo(off + Math.sin(yy * 0.05 + ph) * 0.7, yy);
      x.stroke();
    }
    // red lacquer cap
    var capH = 20, cg = x.createLinearGradient(-hw, 0, hw, 0);
    cg.addColorStop(0, pal.accentDeep); cg.addColorStop(0.3, pal.accentLight); cg.addColorStop(0.65, pal.accent); cg.addColorStop(1, pal.accentDark);
    x.fillStyle = cg; x.fillRect(-hw - 1, 0, w + 2, capH);
    x.fillStyle = pal.gold; x.fillRect(-hw - 1, capH, w + 2, 1.5);
    // incised marks under the cap (like the numbers carved on real sticks)
    x.fillStyle = rgba(pal.outlineRgb, 0.78);
    var mk = 3.4;
    x.fillRect(-mk, capH + 6, mk * 2, 1.7); x.fillRect(-mk, capH + 10, mk * 0.85, 1.7); x.fillRect(mk * 0.15, capH + 10, mk * 0.85, 1.7); x.fillRect(-mk, capH + 14, mk * 2, 1.7);
    // depth: darker when further back
    var dk = layerDark(st.layer, layers);
    if (dk > 0) { x.fillStyle = 'rgba(30,15,5,' + dk.toFixed(3) + ')'; x.fillRect(-hw - 2, -1, w + 4, len + 2); }
    x.restore();
    // outline
    shape(); x.strokeStyle = rgba(pal.outlineRgb, 0.92); x.lineWidth = 1.25; x.lineJoin = 'round'; x.stroke();
    cv._pad = PAD; cv._w = w; cv._len = len;
    return cv;
  }

  global.FSArt = {
    PATTERNS: PATTERNS, palette: palette, cylinderSvg: cylinderSvg, buildCylinder: buildCylinder, stickSprite: stickSprite,
    layerDark: layerDark, color: { parse: parse, hex: hex, mix: mix, rgba: rgba }, PAD: PAD
  };
})(typeof window !== 'undefined' ? window : globalThis);

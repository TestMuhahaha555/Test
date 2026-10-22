/*
 * fs-random.js
 * ------------------------------------------------------------------
 * SOURCE: module 50621 in chunk 07ut_y.bxz3u..js (random / randomInt)
 *         module 54246 in chunk 15mzxjxw7n9~w.js  (pickWinnerEntry, makeEntry)
 *
 * Behaviour kept 1:1 with the original:
 *   - a 256-slot Uint32Array is refilled from crypto.getRandomValues
 *     whenever it is exhausted; each draw returns buf[i++] / 2^32
 *   - Math.random() is used ONLY when Web Crypto is unavailable
 *     (exactly as in the original)
 *   - winner = entries[ randomInt(entries.length) ]  (uniform index; no
 *     weighting, no de-duplication: two entries with the same name are two
 *     separate chances, because each entry has its own id)
 *
 * Not ported: the `forcedName` / lock-mode branch of pickWinnerEntry. It is
 * part of the host site's "lock mode" setting and is unrelated to Fortune
 * Stick (the stick component never passes it).
 */
(function (global) {
  'use strict';

  var buf = new Uint32Array(256);
  var idx = 256;

  function random() {
    var c = global.crypto;
    if (c && c.getRandomValues) {
      if (idx >= 256) {
        c.getRandomValues(buf);
        idx = 0;
      }
      return buf[idx++] / 0x100000000;
    }
    return Math.random();
  }

  function randomInt(n) {
    return Math.floor(random() * n);
  }

  var idCounter = 0;
  function makeId() {
    // Original: crypto.randomUUID(). Fallback only for contexts without it.
    var c = global.crypto;
    if (c && typeof c.randomUUID === 'function') {
      try { return c.randomUUID(); } catch (e) { /* fall through */ }
    }
    idCounter += 1;
    return 'fs-' + Date.now().toString(36) + '-' + idCounter;
  }

  // source: makeEntry(name, imageId) -> {id, name, imageId}
  function makeEntry(name, imageId) {
    return { id: makeId(), name: name, imageId: imageId };
  }

  // source: pickWinnerEntry(entries) (no forcedName) -> {index,name,imageId,entryId} | null
  function pickWinnerEntry(entries) {
    if (!entries || entries.length === 0) return null;
    var index = randomInt(entries.length);
    var e = entries[index];
    return { index: index, name: e.name, imageId: e.imageId, entryId: e.id };
  }

  global.FSRandom = {
    random: random,
    randomInt: randomInt,
    makeEntry: makeEntry,
    pickWinnerEntry: pickWinnerEntry
  };
})(window);

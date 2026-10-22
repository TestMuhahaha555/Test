/* v19 = v18 + ลายประจำยามบนกระบอก (ตัวเลือก pattern) · v18 = v17 + ลายกระบอกใหม่ (ต้องเปลี่ยนเลขแคชทุกครั้งที่แก้ไฟล์ .js/.css/.svg เพราะไฟล์เหล่านี้เป็น cache-first) · v17 = v16 + รีดีไซน์เซียมซี (fs-physics.js / fs-art.js ใหม่) · v16 = v15 (ไอคอน SVG sprite ทั้งหมด ไม่ใช้ภาพ) · v15 = v14 (ไอคอนภาพ + Popup แก้ตาราง + แก้/ส่งออกเพลง) · v14 = v13.1 (ย้ายการตั้งค่าไปหน้าเพิ่มเติม + แก้แถบเพลงย่อ) · v13 (รีดีไซน์ Cute Pastel + Bottom Navigation; โครงข้อมูลเดิม) — เปลี่ยนเลขเวอร์ชันทุกครั้งที่แก้ไฟล์ในแพ็กเกจ เพื่อให้เครื่องที่ติดตั้งไว้ได้ไฟล์ใหม่
   หมายเหตุ: Service Worker ไม่แตะ IndexedDB ("weekly-music" และ "weekly-notify") และไม่แคชไฟล์เพลง/เสียงแจ้งเตือน จึงไม่ทำให้ข้อมูลหาย */
const CACHE_NAME = "weekly-schedule-v19.1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  /* เซียมซีอาหาร (มินิเกม) — โหลดแบบ lazy ตอนเปิดเกม แต่ใส่แคชล่วงหน้าเพื่อให้เล่นออฟไลน์ได้ */
  "./games/fortune-stick/css/fortune-stick.css",
  "./games/fortune-stick/js/fs-random.js",
  "./games/fortune-stick/js/fs-i18n.js",
  "./games/fortune-stick/js/fs-audio.js",
  "./games/fortune-stick/js/fs-effects.js",
  "./games/fortune-stick/js/fs-confetti.js",
  "./games/fortune-stick/js/fs-motion.js",
  "./games/fortune-stick/js/fs-physics.js",
  "./games/fortune-stick/js/fs-art.js",
  "./games/fortune-stick/js/fortune-stick.js",
  "./games/fortune-stick/assets/svg/fortune-cylinder.svg",
  "./games/fortune-stick/assets/svg/fortune-cylinder-back.svg",
  "./games/fortune-stick/assets/audio/shuffle.mp3",
  "./games/fortune-stick/assets/audio/whoosh.mp3",
  "./games/fortune-stick/assets/audio/tada.mp3",
  "./games/fortune-stick/assets/fonts/outfit-variable-latin.woff2",
  "./games/fortune-stick/assets/fonts/prompt-400-latin.woff2",
  "./games/fortune-stick/assets/fonts/prompt-400-thai.woff2",
  "./games/fortune-stick/assets/fonts/prompt-600-latin.woff2",
  "./games/fortune-stick/assets/fonts/prompt-600-thai.woff2",
  "./games/fortune-stick/assets/fonts/prompt-700-latin.woff2",
  "./games/fortune-stick/assets/fonts/prompt-700-thai.woff2"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // หน้า HTML: ลองเอาจากเครือข่ายก่อน (ได้ index.html ใหม่เสมอเมื่อออนไลน์) แล้วค่อย fallback เป็นแคช (ออฟไลน์)
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then((m) => m || caches.match("./index.html"))
      )
    );
    return;
  }

  // ไฟล์อื่น (ไอคอน, manifest): cache-first
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});

/* แตะการแจ้งเตือน "ใกล้เปลี่ยนกิจกรรม" → เปิด/โฟกัสแอป (ไม่ต้องใช้เซิร์ฟเวอร์ ไม่มี push) */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      /* deep link: รับเฉพาะ ./index.html หรือ ./index.html#<route ที่รู้จัก>; อย่างอื่นตกไปหน้าแรก */
      const d = event.notification.data;
      const u = (d && typeof d.url === "string" && /^\.\/index\.html(#(home|schedule|food|games|music|summary|settings|more))?$/.test(d.url)) ? d.url : "./index.html";
      for (const c of list) {
        if ("focus" in c) { try { c.postMessage({ type: "lifeschedule-route", url: u }); } catch (e) {} return c.focus(); }
      }
      return self.clients.openWindow(u);
    })
  );
});

/* v10 — เปลี่ยนเลขเวอร์ชันทุกครั้งที่แก้ไฟล์ในแพ็กเกจ เพื่อให้เครื่องที่ติดตั้งไว้ได้ไฟล์ใหม่
   หมายเหตุ: Service Worker ไม่แตะ IndexedDB ("weekly-music" และ "weekly-notify") และไม่แคชไฟล์เพลง/เสียงแจ้งเตือน จึงไม่ทำให้ข้อมูลหาย */
const CACHE_NAME = "weekly-schedule-v10";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
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
      const u = (d && typeof d.url === "string" && /^\.\/index\.html(#(home|schedule|food|music|summary|settings))?$/.test(d.url)) ? d.url : "./index.html";
      for (const c of list) {
        if ("focus" in c) { try { c.postMessage({ type: "lifeschedule-route", url: u }); } catch (e) {} return c.focus(); }
      }
      return self.clients.openWindow(u);
    })
  );
});

/* SQL Cards service worker: offline cache + background reminders */
const VERSION = "sqlcards-v1.0.0";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./vendor/xlsx.full.min.js", "./fonts/Vazirmatn.woff2",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/badge-96.png",
  "./template/sql-cards-template.xlsx"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // the page itself: network first so updates arrive, cache when offline
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put("./index.html", copy));
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }
  // everything else: cache first
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});

/* ---- reminders ---- */
function idbGet(key) {
  return new Promise(resolve => {
    try {
      const r = indexedDB.open("sqlcards", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onerror = () => resolve(undefined);
      r.onsuccess = () => {
        try {
          const q = r.result.transaction("kv").objectStore("kv").get(key);
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => resolve(undefined);
        } catch (err) { resolve(undefined); }
      };
    } catch (err) { resolve(undefined); }
  });
}
function idbSet(key, value) {
  return new Promise(resolve => {
    try {
      const r = indexedDB.open("sqlcards", 1);
      r.onerror = () => resolve();
      r.onsuccess = () => {
        const tx = r.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put(value, key);
        tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
      };
    } catch (err) { resolve(); }
  });
}
const faNum = n => Number(n).toLocaleString("fa-IR");

async function maybeRemind() {
  const remind = await idbGet("remind");
  if (!remind || !remind.on || !remind.times || !remind.times.length) return;
  const now = new Date(), last = remind.last || 0;
  let due = false;
  for (const t of remind.times) {
    const [hh, mm] = t.split(":").map(Number);
    const at = new Date(now); at.setHours(hh, mm, 0, 0);
    if (at.getTime() <= now.getTime() && at.getTime() > last) { due = true; break; }
  }
  if (!due) return;
  const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  remind.last = now.getTime();
  await idbSet("remind", remind);
  if (open.some(c => c.visibilityState === "visible")) return;
  const status = (await idbGet("status")) || {};
  const again = Object.values(status).filter(v => v === "a").length;
  await self.registration.showNotification("وقت مرور فلش‌کارت‌هاست", {
    body: again ? `${faNum(again)} کارت برای مرور داری. چند دقیقه وقت بذار.` : "چند دقیقه کارت‌ها رو مرور کن.",
    icon: "icons/icon-192.png", badge: "icons/badge-96.png",
    tag: "sqlcards-remind", renotify: true, lang: "fa", dir: "rtl", data: { url: "./" }
  });
}

self.addEventListener("periodicsync", e => {
  if (e.tag === "sqlcards-remind") e.waitUntil(maybeRemind());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow(e.notification.data && e.notification.data.url || "./");
    })
  );
});


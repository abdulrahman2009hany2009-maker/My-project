/* Service worker: إشعارات الدفع (Android / iOS 16.4+ كتطبيق مثبّت) */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; }
  catch (_) { try { p = { data: { body: e.data.text() } }; } catch (__) {} }
  const d = p.data || p.notification || p || {};
  const title = d.title || "متتبع الصلاة";
  /* iOS يتطلب إظهار إشعار مع كل push */
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.tag || undefined,
    dir: "rtl",
    lang: "ar",
    data: { url: "/" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
      for (const c of cs) { if ("focus" in c) return c.focus(); }
      return self.clients.openWindow("/");
    })
  );
});

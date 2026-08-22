/* global self, URL */

self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return {};
    }
  })();
  const title =
    typeof payload.title === "string" ? payload.title : "UMF Support";
  const body = typeof payload.body === "string" ? payload.body : "";
  const url =
    typeof payload.url === "string" && payload.url.startsWith("/")
      ? payload.url
      : "/umf-support";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/brand/umf-support-mark.png",
      badge: "/brand/umf-support-mark.png",
      tag:
        typeof payload.event === "string"
          ? `umf-support-${payload.event}`
          : "umf-support",
      renotify: true,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url || "/umf-support";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const absoluteUrl = new URL(path, self.location.origin).href;
        const existing = clients.find((client) => client.url === absoluteUrl);
        if (existing) return existing.focus();
        return self.clients.openWindow(absoluteUrl);
      }),
  );
});

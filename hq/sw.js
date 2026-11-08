/* Agent HQ service worker: makes the app installable, shows push notifications,
   and lets you tap ✅ Approve right on the notification. */
const SHELL = "hq-v1";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });

// network first for the app itself (so updates arrive), cache as offline fallback
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});

function kvGet(key) {
  return new Promise(res => {
    const r = indexedDB.open("hq", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get(key); g.onsuccess = () => res(g.result); g.onerror = () => res(null); };
    r.onerror = () => res(null);
  });
}

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: "Agent HQ", body: e.data ? e.data.text() : "" }; }
  const opts = {
    body: d.body || "", tag: d.tag || undefined, renotify: true, icon: "icon-192.png", badge: "icon-192.png",
    data: { approval: d.approval || null, url: d.url || "./#chat" },
    actions: d.approval ? [{ action: "approve", title: "✅ Approve" }, { action: "open", title: "Open" }] : [],
    requireInteraction: !!d.approval,
  };
  e.waitUntil(self.registration.showNotification(d.title || "Agent HQ", opts).then(() =>
    self.clients.matchAll({ type: "window" }).then(cs => cs.forEach(c => c.postMessage("refresh")))));
});

async function approve(approvalId) {
  const cfg = await kvGet("cfg");
  if (!cfg || !cfg.token) throw new Error("Open the app once and save your token in Settings");
  const name = `${Date.now()}-n${Math.random().toString(36).slice(2, 6)}.json`;
  const body = JSON.stringify({ type: "approve", approval: approvalId, source: "notification" });
  const bytes = new TextEncoder().encode(body);
  let bin = ""; bytes.forEach(b => bin += String.fromCharCode(b));
  const r = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/commands/${name}`, {
    method: "PUT",
    headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ message: "command: approve", content: btoa(bin), branch: cfg.branch || "main" }),
  });
  if (!r.ok) throw new Error("GitHub " + r.status);
}

self.addEventListener("notificationclick", e => {
  const n = e.notification; n.close();
  if (e.action === "approve" && n.data.approval) {
    e.waitUntil(approve(n.data.approval)
      .then(() => self.registration.showNotification("✅ Approved", { body: "Your team will continue in about a minute.", icon: "icon-192.png", tag: n.data.approval }))
      .catch(err => self.registration.showNotification("Couldn't approve", { body: String(err.message || err), icon: "icon-192.png" })));
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ("focus" in c) { c.postMessage("refresh"); return c.focus(); } }
    return self.clients.openWindow(n.data.url || "./#chat");
  }));
});

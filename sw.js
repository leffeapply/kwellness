const CACHE_PREFIX = "promoms-care-";
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const LEGACY_CACHE_PREFIXES = [CACHE_PREFIX, "kwellness-"];
const APP_SHELL = ["./index.html", "./manifest.webmanifest", "./assets/promoms-logo.png"];
const STATIC_DESTINATIONS = new Set([
  "audio",
  "font",
  "image",
  "manifest",
  "script",
  "style",
  "video",
  "worker",
]);
const SENSITIVE_PATH_PATTERN = /(?:^|\/)(?:api|auth|oauth|callback|rest|graphql|storage|functions)(?:\/|$)/i;
const SENSITIVE_QUERY_KEYS = ["access_token", "refresh_token", "token", "code"];

function isSensitiveRequest(request, url) {
  return (
    request.headers.has("authorization") ||
    SENSITIVE_PATH_PATTERN.test(url.pathname) ||
    SENSITIVE_QUERY_KEYS.some((key) => url.searchParams.has(key))
  );
}

function isSameOriginStaticAsset(request, url) {
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    !isSensitiveRequest(request, url) &&
    STATIC_DESTINATIONS.has(request.destination)
  );
}

function isSafeNavigation(request, url) {
  return (
    request.mode === "navigate" &&
    url.origin === self.location.origin &&
    !isSensitiveRequest(request, url)
  );
}

function canStore(response) {
  const cacheControl = response.headers.get("cache-control") || "";
  return response.ok && response.type === "basic" && !/(?:no-store|private)/i.test(cacheControl);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((clients) =>
        Promise.all(
          clients.map((client) => {
            const url = new URL(client.url);
            if (url.origin !== self.location.origin || isSensitiveRequest(new Request(client.url), url)) return undefined;
            return client.navigate(client.url);
          }),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (isSafeNavigation(event.request, url)) {
    event.respondWith(fetch(event.request).catch(() => caches.match("./index.html")));
    return;
  }

  if (!isSameOriginStaticAsset(event.request, url)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (canStore(response)) {
          const responseToCache = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache)),
          );
        }
        return response;
      });
    }),
  );
});

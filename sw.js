// Deer Eyes offline helper: keeps the app and the maps you've viewed working without signal in the woods.
// Each copy of the app (each website folder) keeps its own saved pages, so two versions can live side by side.
const SCOPE = self.registration.scope;
const CACHE = 'deer-eyes-core-v4 ' + SCOPE;
const TILES = 'deer-eyes-tiles'; // map pictures are shared between copies
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const TILE_HOSTS = ['basemap.nationalmap.gov', 'tile.opentopomap.org', 'a.tile.opentopomap.org', 'b.tile.opentopomap.org', 'c.tile.opentopomap.org', 'tile.openstreetmap.org',
  'gisservices.its.ny.gov', 'gisservices.dec.ny.gov', 'mapsdep.nj.gov', 'elevation.nationalmap.gov', 'orthos.its.ny.gov', 'maps.nj.gov',
  'historical1.arcgis.com', 'fwspublicservices.wim.usgs.gov', 'imagery.geoplatform.gov'];

// Map pictures are saved only when the map server allows it (CORS). Pictures without that permission
// count as ~7 MB each against the phone's storage limit, so those are shown but not saved.
let puts = 0;
async function fetchTile(req, cache) {
  let res;
  try { res = await fetch(new Request(req.url, { mode: 'cors', credentials: 'omit' })); }
  catch (e) { return fetch(req); }
  if (res.ok) {
    cache.put(req.url, res.clone()).catch(() => {});
    if (++puts % 200 === 0) trimTiles(cache);
  }
  return res;
}
async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length > 6000) for (const k of keys.slice(0, keys.length - 5000)) await cache.delete(k);
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // only clean up this copy's own older saves; never touch another version's
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('deer-eyes-core') && k.endsWith(' ' + SCOPE) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('open-meteo.com')) return; // live weather always comes from the network
  // map pictures (base maps and property/public-land overlays): saved copy first, so maps work without signal
  if (TILE_HOSTS.includes(url.hostname) && (url.pathname.includes('/tile/') || url.pathname.endsWith('/export') || url.pathname.endsWith('/exportImage') || /\/\d+\/\d+\/\d+\.png$/.test(url.pathname))) {
    e.respondWith(caches.open(TILES).then(c => c.match(req.url).then(hit => hit || fetchTile(req, c))));
    return;
  }
  // property and land look-ups need live data
  if (TILE_HOSTS.includes(url.hostname) || url.hostname.endsWith('arcgis.com')) return;
  // the app page: try the network first so updates arrive, fall back to the saved copy offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // fonts: keep the first copy
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
    return;
  }
  // everything else on this site: answer from the saved copy, refresh it in the background
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});

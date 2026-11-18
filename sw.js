// =========================================================
// sw.js : 서비스 워커 (PWA 설치·오프라인 지원)
// ---------------------------------------------------------
// 앱 화면 파일을 저장해 두었다가, 인터넷이 끊겨도 화면이 열리게 합니다.
// '인터넷 먼저, 안 되면 저장본' 방식이라 코드를 고치면 바로 반영돼요.
// =========================================================

const CACHE = 'clothbg-v1';
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './ai.js',
  './compose.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// 설치될 때 앱 파일 저장
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

// 새 버전이 켜지면 옛날 저장본 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// 요청 처리: 내 사이트 파일만 관리하고, AI 모델 등 외부 파일은 브라우저에 맡김
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});

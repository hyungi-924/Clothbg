// =========================================================
// db.js : "내 배경" 사진을 저장하는 곳
// ---------------------------------------------------------
// IndexedDB는 브라우저에 들어 있는 무료 데이터베이스입니다.
// 서버나 PostgreSQL 없이도 이미지 파일을 이 기기 안에 저장할 수 있어요.
// 저장되는 데이터 모양:
//   { id, name(이름), category(카테고리), blob(이미지 파일), createdAt(저장 시각) }
// =========================================================

const DB_NAME = 'clothbg-db';
const STORE = 'backgrounds';

// 데이터베이스 열기 (처음 한 번은 저장 공간을 만듭니다)
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('category', 'category'); // 카테고리별로 찾기 쉽게
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 저장소에 작업을 하나 실행하고 결과를 돌려주는 도우미 함수
async function run(mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// 저장된 배경 전체 목록 (최근에 저장한 것이 앞으로)
export async function listBackgrounds() {
  const all = await run('readonly', (store) => store.getAll());
  return (all || []).sort((a, b) => b.createdAt - a.createdAt);
}

// 배경 하나 저장
export async function addBackground({ name, category, blob }) {
  const item = {
    id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    name,
    category,
    blob,
    createdAt: Date.now(),
  };
  await run('readwrite', (store) => store.put(item));
  return item;
}

// 배경 하나 삭제
export async function deleteBackground(id) {
  await run('readwrite', (store) => store.delete(id));
}

// =========================================================
// app.js : 앱의 두뇌
// ---------------------------------------------------------
// 1. 상태(state)    : 앱이 기억하는 모든 데이터
// 2. 네비게이션     : 주소 끝 #이름 으로 화면 전환
// 3. 화면 그리기    : 사진 / 배경 / 결과 / 내 배경
// 4. 사용자 동작    : 버튼 클릭, 파일 선택 처리
// 5. 합성 작업      : AI 배경 제거 → 합성 → 저장
// =========================================================

import { listBackgrounds, addBackground, deleteBackground } from './db.js';
import { removeBg } from './ai.js';
import { composeImage, canvasToBlob, resizeImage, RATIOS } from './compose.js';

/* ---------------------------------------------------------
   1. 상태(state)
   화면은 항상 이 state를 보고 그려집니다.
   state를 바꾼 뒤 render()를 부르면 화면이 새로 그려져요.
--------------------------------------------------------- */
const state = {
  photos: [],          // 불러온 옷 사진들 (아래 addPhotos 참고)
  backgrounds: [],     // 내 배경 목록 (IndexedDB에서 불러옴)
  selectedBg: { type: 'color', value: '#FFFFFF' }, // 선택한 배경
  ratio: '1:1',        // 출력 비율
  shadow: true,        // 그림자 넣기
  brighten: false,     // 밝기 보정 (옷 색 보호를 위해 기본 꺼짐)
  libraryFilter: '전체',
  processing: false,   // 합성 작업 중인지
};

// 기본 배경 색상
const PRESET_COLORS = [
  { value: '#FFFFFF', label: '흰색' },
  { value: '#F3F3F1', label: '연회색' },
  { value: '#EDE6DB', label: '베이지' },
  { value: '#E6ECF2', label: '연하늘' },
];
const CATEGORIES = ['스튜디오', '카페', '야외', '기타'];

const $view = document.getElementById('view');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

// 글자에 < > 같은 기호가 있어도 화면이 깨지지 않게 바꿔주는 함수
function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 짧은 알림 띄우기
let toastTimer;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// 배경 이미지 미리보기 주소를 한 번만 만들어 재사용
const bgUrls = new Map();
function bgUrl(bg) {
  if (!bgUrls.has(bg.id)) bgUrls.set(bg.id, URL.createObjectURL(bg.blob));
  return bgUrls.get(bg.id);
}

/* ---------------------------------------------------------
   2. 네비게이션
   #upload, #background, #result, #library 네 화면
--------------------------------------------------------- */
const ROUTES = {
  upload: renderUpload,
  background: renderBackground,
  result: renderResult,
  library: renderLibrary,
};

function currentRoute() {
  const name = location.hash.replace('#', '');
  return ROUTES[name] ? name : 'upload';
}

function go(route) {
  if (currentRoute() === route) render();
  else location.hash = route; // hashchange 이벤트가 render를 불러줌
}

function render() {
  const route = currentRoute();
  ROUTES[route]();
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const active = a.dataset.route === route;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
  $view.focus({ preventScroll: true });
});

/* ---------------------------------------------------------
   3. 화면 그리기
--------------------------------------------------------- */

// [화면 1] 사진 불러오기
function renderUpload() {
  const n = state.photos.length;
  $view.innerHTML = `
    <section>
      <h2>옷 사진 불러오기</h2>
      <p class="hint">소싱처에서 받은 상품 사진이나 직접 찍은 사진을 넣으세요. 여러 장을 한 번에 넣을 수 있어요.</p>
      <div class="pick-row">
        <label class="btn btn-ghost">카메라로 촬영
          <input type="file" accept="image/*" capture="environment" data-action="pick" hidden>
        </label>
        <label class="btn btn-ghost">앨범에서 선택
          <input type="file" accept="image/*" multiple data-action="pick" hidden>
        </label>
      </div>
      ${n ? `
        <ul class="grid">
          ${state.photos.map((p) => `
            <li class="thumb">
              <img src="${p.thumbUrl}" alt="${esc(p.name)}">
              <button class="thumb-remove" data-action="remove-photo" data-id="${p.id}" aria-label="${esc(p.name)} 빼기">×</button>
            </li>`).join('')}
        </ul>` : `<div class="empty">아직 사진이 없어요. 위 버튼으로 사진을 추가하세요.</div>`}
    </section>
    <div class="sticky-cta">
      <button class="btn btn-primary" data-action="go" data-to="background" ${n ? '' : 'disabled'}>배경 고르기 (${n}장)</button>
    </div>`;
}

// 비율 선택 버튼 (배경 화면, 결과 화면에서 같이 사용)
function ratioControl() {
  return `
    <div class="segmented" role="group" aria-label="출력 비율">
      ${Object.keys(RATIOS).map((r) => `
        <button class="${state.ratio === r ? 'on' : ''}" data-action="ratio" data-value="${r}" aria-pressed="${state.ratio === r}">${r}</button>`).join('')}
    </div>`;
}

// [화면 2] 배경 고르기
function renderBackground() {
  const sel = state.selectedBg;
  const isSel = (type, value) => sel.type === type && sel.value === value;
  const n = state.photos.length;

  $view.innerHTML = `
    <section>
      <h2>배경 고르기</h2>
      <p class="hint">옷은 그대로 두고 배경만 바꿔요.</p>

      <h3 class="sub">기본 색상</h3>
      <ul class="swatches">
        ${PRESET_COLORS.map((c) => `
          <li>
            <button class="swatch ${isSel('color', c.value) ? 'selected' : ''}" style="--sw:${c.value}"
              data-action="select-color" data-value="${c.value}" aria-pressed="${isSel('color', c.value)}">
              <span class="swatch-chip"></span>${c.label}
            </button>
          </li>`).join('')}
      </ul>

      <h3 class="sub">내 배경</h3>
      ${state.backgrounds.length ? `
        <ul class="grid">
          ${state.backgrounds.map((b) => `
            <li>
              <button class="bg-tile ${isSel('image', b.id) ? 'selected' : ''}" data-action="select-bg" data-id="${b.id}" aria-pressed="${isSel('image', b.id)}">
                <img src="${bgUrl(b)}" alt=""><span>${esc(b.name)}</span>
              </button>
            </li>`).join('')}
        </ul>`
        : `<div class="empty">저장된 배경이 없어요. <a href="#library">내 배경</a>에서 카페나 스튜디오 사진을 추가하세요.</div>`}

      <h3 class="sub">출력 설정</h3>
      ${ratioControl()}
      <label class="toggle">
        <input type="checkbox" data-action="toggle" data-key="shadow" ${state.shadow ? 'checked' : ''}>
        <span>자연스러운 그림자 넣기</span>
      </label>
      <label class="toggle">
        <input type="checkbox" data-action="toggle" data-key="brighten" ${state.brighten ? 'checked' : ''}>
        <span>어두운 사진 밝게 보정<small>옷 색이 조금 밝아질 수 있어 기본은 꺼져 있어요.</small></span>
      </label>
    </section>
    <div class="sticky-cta">
      <button class="btn btn-primary" data-action="start" ${n && !state.processing ? '' : 'disabled'}>
        ${state.processing ? '합성 중이에요' : n ? `배경 합성하기 (${n}장)` : '먼저 사진을 추가하세요'}
      </button>
    </div>`;
}

// 결과 카드의 상태 문구
function statusText(p) {
  const pct = Math.round((p.progress || 0) * 100);
  switch (p.status) {
    case 'wait': return '대기 중';
    case 'download': return `AI 준비 중 ${pct}% (처음 한 번만)`;
    case 'remove': return `배경 지우는 중 ${pct}%`;
    case 'compose': return '합성 중';
    case 'done': return '완료';
    case 'error': return `실패: ${p.error || '다시 시도하세요'}`;
    default: return '';
  }
}

function resultCard(p) {
  const ratioClass = state.ratio === '1:1' ? 'r11' : 'r34';
  return `
    <li class="result-card">
      <div class="preview ${ratioClass} ${p.resultUrl ? '' : 'checker'}">
        ${p.resultUrl
          ? `<img src="${p.resultUrl}" alt="${esc(p.name)} 합성 결과">`
          : `<img class="ghost" src="${p.thumbUrl}" alt="">`}
      </div>
      <div class="result-meta">
        <span class="status ${p.status === 'error' ? 'err' : ''}" data-status="${p.id}">${statusText(p)}</span>
        ${p.resultUrl ? `
          <div class="actions">
            <button class="btn btn-small" data-action="save" data-id="${p.id}">저장</button>
            ${canShareFiles() ? `<button class="btn btn-small btn-ghost" data-action="share" data-id="${p.id}">공유</button>` : ''}
          </div>` : ''}
      </div>
    </li>`;
}

// [화면 3] 결과 미리보기·다운로드
function renderResult() {
  const total = state.photos.length;
  if (!total) {
    $view.innerHTML = `
      <section>
        <h2>결과</h2>
        <div class="empty">합성할 사진이 없어요. <a href="#upload">사진 추가하기</a></div>
      </section>`;
    return;
  }
  const done = state.photos.filter((p) => p.resultUrl).length;
  $view.innerHTML = `
    <section>
      <div class="result-head">
        <h2>결과 미리보기</h2>
        <span class="count">${done}/${total}장 완료</span>
      </div>
      <p class="hint">${state.processing
        ? '처음에는 AI를 내려받느라 1~2분 걸릴 수 있어요. 화면을 켜 둔 채로 기다려 주세요.'
        : '비율을 바꾸면 바로 다시 만들어져요.'}</p>
      ${ratioControl()}
      <ul class="results">${state.photos.map(resultCard).join('')}</ul>
    </section>
    <div class="sticky-cta">
      <button class="btn btn-primary" data-action="save-all" ${done && !state.processing ? '' : 'disabled'}>전체 저장 (${done}장)</button>
    </div>`;
}

// [화면 4] 내 배경 관리
function renderLibrary() {
  const cats = ['전체', ...CATEGORIES];
  const list = state.libraryFilter === '전체'
    ? state.backgrounds
    : state.backgrounds.filter((b) => b.category === state.libraryFilter);

  $view.innerHTML = `
    <section>
      <h2>내 배경 관리</h2>
      <p class="hint">자주 쓰는 배경 사진을 저장해 두세요. 이 기기의 브라우저 안에 저장돼요.</p>

      <form class="add-bg" data-form="add-bg">
        <label class="field"><span>배경 이름</span>
          <input name="name" required maxlength="30" placeholder="예: 우드톤 카페 테이블">
        </label>
        <label class="field"><span>카테고리</span>
          <select name="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select>
        </label>
        <label class="field"><span>배경 사진</span>
          <input name="file" type="file" accept="image/*" required>
        </label>
        <button class="btn btn-primary" type="submit">배경 저장</button>
      </form>

      <div class="chips" role="group" aria-label="카테고리 필터">
        ${cats.map((c) => `<button class="chip ${state.libraryFilter === c ? 'on' : ''}" data-action="filter" data-value="${c}" aria-pressed="${state.libraryFilter === c}">${c}</button>`).join('')}
      </div>

      ${list.length ? `
        <ul class="grid">
          ${list.map((b) => `
            <li class="lib-item">
              <img src="${bgUrl(b)}" alt="">
              <div class="lib-meta"><strong>${esc(b.name)}</strong><span>${esc(b.category)}</span></div>
              <button class="btn btn-small btn-ghost danger" data-action="delete-bg" data-id="${b.id}">삭제</button>
            </li>`).join('')}
        </ul>`
        : `<div class="empty">이 카테고리에 저장된 배경이 없어요.</div>`}
    </section>`;
}

/* ---------------------------------------------------------
   4. 사용자 동작 처리
   화면 전체에 이벤트를 하나만 걸고, data-action 값으로 구분합니다.
--------------------------------------------------------- */

$view.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return; // 체크박스·파일 입력은 change에서 처리
  const { action, id, value } = el.dataset;

  switch (action) {
    case 'go':
      go(el.dataset.to);
      break;

    case 'remove-photo': {
      const p = state.photos.find((x) => x.id === id);
      if (p) {
        URL.revokeObjectURL(p.thumbUrl);
        if (p.resultUrl) URL.revokeObjectURL(p.resultUrl);
      }
      state.photos = state.photos.filter((x) => x.id !== id);
      render();
      break;
    }

    case 'select-color':
      state.selectedBg = { type: 'color', value };
      render();
      break;

    case 'select-bg':
      state.selectedBg = { type: 'image', value: id };
      render();
      break;

    case 'ratio':
      if (state.ratio === value) return;
      state.ratio = value;
      if (currentRoute() === 'result') await recomposeAll(); // 이미 만든 결과도 새 비율로
      else render();
      break;

    case 'start':
      startProcessing();
      break;

    case 'save': {
      const p = state.photos.find((x) => x.id === id);
      if (p?.resultBlob) downloadBlob(p.resultBlob, fileNameFor(p));
      break;
    }

    case 'share': {
      const p = state.photos.find((x) => x.id === id);
      if (p?.resultBlob) shareResults([p]);
      break;
    }

    case 'save-all':
      saveAll();
      break;

    case 'filter':
      state.libraryFilter = value;
      render();
      break;

    case 'delete-bg':
      if (!confirm('이 배경을 삭제할까요?')) return;
      await deleteBackground(id);
      if (bgUrls.has(id)) { URL.revokeObjectURL(bgUrls.get(id)); bgUrls.delete(id); }
      state.backgrounds = state.backgrounds.filter((b) => b.id !== id);
      if (state.selectedBg.type === 'image' && state.selectedBg.value === id) {
        state.selectedBg = { type: 'color', value: '#FFFFFF' };
      }
      render();
      toast('배경을 삭제했어요');
      break;
  }
});

$view.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'pick' && el.files?.length) {
    addPhotos(el.files);
    el.value = ''; // 같은 사진을 다시 고를 수 있게 초기화
  }
  if (el.dataset.action === 'toggle') {
    state[el.dataset.key] = el.checked;
  }
});

// 배경 저장 폼
$view.addEventListener('submit', async (e) => {
  if (e.target.dataset.form !== 'add-bg') return;
  e.preventDefault();
  const form = e.target;
  const file = form.file.files[0];
  const name = form.name.value.trim();
  if (!file || !name) return;
  try {
    const blob = await resizeImage(file, 2400); // 저장 공간 절약을 위해 적당히 줄여서 저장
    const item = await addBackground({ name, category: form.category.value, blob });
    state.backgrounds.unshift(item);
    render();
    toast('배경을 저장했어요');
  } catch (err) {
    console.error(err);
    toast('배경을 저장하지 못했어요. 다른 사진으로 해보세요.');
  }
});

// 사진 추가
async function addPhotos(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  for (const f of files) {
    const file = await resizeImage(f, 2000);
    state.photos.push({
      id: uid(),
      name: f.name || 'photo.jpg',
      file,                              // AI에 넣을 사진
      thumbUrl: URL.createObjectURL(file),
      cutoutBlob: null,                  // 배경 지운 결과 (한 번 만들면 재사용)
      resultBlob: null,                  // 최종 합성 이미지
      resultUrl: null,
      status: 'wait',
      progress: 0,
      error: '',
    });
  }
  render();
  toast(`${files.length}장을 추가했어요`);
}

/* ---------------------------------------------------------
   5. 합성 작업
--------------------------------------------------------- */

// 진행률만 바뀔 때는 화면 전체 대신 글자만 바꿔서 가볍게
function updateStatus(p) {
  const el = $view.querySelector(`[data-status="${p.id}"]`);
  if (el) el.textContent = statusText(p);
}

// 현재 선택된 배경을 합성용 형태로 바꾸기
function currentBackground() {
  if (state.selectedBg.type === 'image') {
    const bg = state.backgrounds.find((b) => b.id === state.selectedBg.value);
    if (bg) return { type: 'image', blob: bg.blob };
  }
  const value = state.selectedBg.type === 'color' ? state.selectedBg.value : '#FFFFFF';
  return { type: 'color', value };
}

// 사진 한 장의 최종 결과 만들기 (누끼는 이미 있다고 가정)
async function makeResult(p) {
  const canvas = await composeImage({
    cutoutBlob: p.cutoutBlob,
    background: currentBackground(),
    ratio: state.ratio,
    shadow: state.shadow,
    brighten: state.brighten,
  });
  const blob = await canvasToBlob(canvas);
  if (p.resultUrl) URL.revokeObjectURL(p.resultUrl);
  p.resultBlob = blob;
  p.resultUrl = URL.createObjectURL(blob);
}

// 여러 장을 한 장씩 차례로 처리 (휴대폰 메모리 보호)
async function startProcessing() {
  if (state.processing || !state.photos.length) return;
  state.processing = true;
  state.photos.forEach((p) => { p.status = 'wait'; p.progress = 0; });
  go('result');

  for (const p of state.photos) {
    try {
      // 배경 제거는 시간이 오래 걸리므로, 이미 한 사진은 다시 하지 않음
      if (!p.cutoutBlob) {
        p.status = 'remove';
        updateStatus(p);
        p.cutoutBlob = await removeBg(p.file, (phase, ratio) => {
          p.status = phase === 'download' ? 'download' : 'remove';
          p.progress = ratio;
          updateStatus(p);
        });
      }
      p.status = 'compose';
      updateStatus(p);
      await makeResult(p);
      p.status = 'done';
    } catch (err) {
      console.error(err);
      p.status = 'error';
      p.error = (err && err.message ? err.message : '').slice(0, 60);
    }
    if (currentRoute() === 'result') render();
  }

  state.processing = false;
  render();
  const failed = state.photos.filter((p) => p.status === 'error').length;
  toast(failed ? `${failed}장은 실패했어요. 다시 합성해 보세요.` : '합성이 끝났어요');
}

// 비율만 바꿨을 때: AI는 다시 돌리지 않고 합성만 새로
async function recomposeAll() {
  if (state.processing) { render(); return; }
  render();
  for (const p of state.photos) {
    if (!p.cutoutBlob) continue;
    await makeResult(p);
  }
  render();
}

/* ---------- 저장·공유 ---------- */

function fileNameFor(p) {
  const base = p.name.replace(/\.[^.]+$/, '');
  return `${base}_${state.ratio.replace(':', 'x')}.jpg`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// 아이폰처럼 '공유 → 이미지 저장'이 되는 기기인지 확인
function canShareFiles() {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'a.jpg', { type: 'image/jpeg' })] }));
  } catch {
    return false;
  }
}

async function shareResults(list) {
  const files = list.map((p) => new File([p.resultBlob], fileNameFor(p), { type: 'image/jpeg' }));
  try {
    await navigator.share({ files });
  } catch (err) {
    if (err.name !== 'AbortError') toast('공유하지 못했어요. 저장 버튼을 써 보세요.');
  }
}

async function saveAll() {
  const done = state.photos.filter((p) => p.resultBlob);
  if (!done.length) return;
  // 휴대폰: 공유 창에서 '이미지 n개 저장'으로 앨범에 한 번에 저장
  if (canShareFiles()) {
    shareResults(done);
    return;
  }
  // 컴퓨터: 파일을 차례로 다운로드
  for (const p of done) {
    downloadBlob(p.resultBlob, fileNameFor(p));
    await new Promise((r) => setTimeout(r, 400));
  }
}

/* ---------------------------------------------------------
   시작
--------------------------------------------------------- */
async function init() {
  try {
    state.backgrounds = await listBackgrounds();
  } catch (err) {
    console.error(err);
    toast('저장된 배경을 불러오지 못했어요');
  }
  render();
}

// 오프라인에서도 앱 화면이 열리도록 서비스 워커 등록 (PWA 필수)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
}

init();

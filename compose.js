// =========================================================
// compose.js : 배경 위에 옷을 올려 최종 사진 만들기
// ---------------------------------------------------------
// 브라우저의 캔버스(canvas) 기능으로 그림을 그리듯 합성합니다.
// 순서: ① 배경 깔기 → ② 옷 주변 투명 여백 잘라내기
//       → ③ 가운데 크기 맞춰 올리기 → ④ (선택) 그림자
// =========================================================

// 출력 크기 (쇼핑몰 상세페이지에 충분한 해상도)
export const RATIOS = {
  '1:1': { w: 1500, h: 1500 },
  '3:4': { w: 1500, h: 2000 },
};

// 파일(Blob)을 그림(Image)으로 읽기
export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했어요')); };
    img.src = url;
  });
}

// 캔버스를 파일(Blob)로 바꾸기
export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('이미지 저장에 실패했어요'))), type, quality);
  });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * 너무 큰 사진을 줄여서 처리 속도와 메모리 사용을 줄입니다.
 * (휴대폰 원본 사진은 4000px이 넘어 AI 처리 시 멈출 수 있어요)
 */
export async function resizeImage(file, maxSide = 2000) {
  const img = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1) return file; // 이미 충분히 작으면 원본 그대로

  const c = makeCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  // PNG는 투명도를 지키기 위해 PNG로, 나머지는 고화질 JPEG로
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return canvasToBlob(c, type, 0.95);
}

// 배경 사진을 빈틈없이 꽉 채우기 (넘치는 부분은 가운데 기준으로 잘림)
function drawCover(ctx, img, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

// 누끼 이미지에서 '옷이 있는 영역'만 찾아내기 (투명한 여백 제외)
function findContentBox(img) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  // 빠르게 찾기 위해 작은 크기로 줄여서 검사
  const s = Math.min(1, 400 / Math.max(W, H));
  const c = makeCanvas(W * s, H * s);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);

  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const alpha = data[(y * c.width + x) * 4 + 3];
      if (alpha > 12) { // 거의 투명한 점은 무시
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: W, h: H }; // 아무것도 못 찾으면 전체 사용

  // 원래 크기로 되돌리고, 잘림 방지용 여유 2px
  const x = Math.max(0, Math.floor(minX / s) - 2);
  const y = Math.max(0, Math.floor(minY / s) - 2);
  const w = Math.min(W - x, Math.ceil((maxX - minX + 1) / s) + 4);
  const h = Math.min(H - y, Math.ceil((maxY - minY + 1) / s) + 4);
  return { x, y, w, h };
}

// 옷 영역만 잘라낸 새 캔버스 만들기
function crop(img, box) {
  const c = makeCanvas(box.w, box.h);
  c.getContext('2d').drawImage(img, -box.x, -box.y);
  return c;
}

// (선택 옵션) 밝기 살짝 올리기: 어두운 사진용. 옷 색이 조금 밝아질 수 있어 기본은 꺼짐
function brighten(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue; // 투명한 곳은 건너뜀
    for (let k = 0; k < 3; k++) {
      d[i + k] = Math.min(255, d[i + k] * 1.06 + 3); // 약 6% 밝게
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * 최종 합성
 * @param {object} opt
 * @param {Blob} opt.cutoutBlob   배경이 지워진 옷 PNG
 * @param {{type:'color', value:string}|{type:'image', blob:Blob}} opt.background
 * @param {'1:1'|'3:4'} opt.ratio
 * @param {boolean} opt.shadow     그림자 넣기
 * @param {boolean} opt.brighten   밝기 보정
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function composeImage({ cutoutBlob, background, ratio, shadow, brighten: doBrighten }) {
  const { w, h } = RATIOS[ratio];
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  // ① 배경 깔기
  if (background.type === 'image') {
    drawCover(ctx, await loadImage(background.blob), w, h);
  } else {
    ctx.fillStyle = background.value;
    ctx.fillRect(0, 0, w, h);
  }

  // ② 옷만 남기고 여백 잘라내기
  const garmentImg = await loadImage(cutoutBlob);
  const box = findContentBox(garmentImg);
  const garment = crop(garmentImg, box);
  if (doBrighten) brighten(garment);

  // ③ 가로 80%, 세로 84% 안에 들어가도록 크기 맞추기 (최대 2배까지만 확대해 흐려짐 방지)
  const scale = Math.min((w * 0.8) / box.w, (h * 0.84) / box.h, 2);
  const dw = box.w * scale;
  const dh = box.h * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;

  // ④ 그림자: 옷 모양 그대로 은은하게 아래로 번지게
  if (shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
    ctx.shadowBlur = Math.round(w * 0.03);
    ctx.shadowOffsetY = Math.round(h * 0.012);
    ctx.drawImage(garment, dx, dy, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(garment, dx, dy, dw, dh);
  }

  return canvas;
}

// =========================================================
// ai.js : AI 배경 제거(누끼)
// ---------------------------------------------------------
// 무료 오픈소스 라이브러리 @imgly/background-removal 을 사용합니다.
// AI가 서버가 아니라 '내 휴대폰 브라우저 안'에서 돌아가므로
//   - API 비용 0원
//   - API 키가 필요 없어 노출될 걱정도 없음
//   - 사진이 외부 서버로 전송되지 않음
// 처음 한 번은 AI 모델 파일(수십 MB)을 내려받느라 시간이 걸리고,
// 그다음부터는 브라우저에 저장된 모델을 써서 빨라집니다.
//
// 중요: 이 AI는 '배경만 투명하게' 지웁니다. 옷 픽셀의 색은 건드리지 않아요.
// =========================================================

// 버전을 고정해 두면 라이브러리가 갑자기 바뀌어 고장 나는 일을 막을 수 있어요.
const LIB_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/+esm';

let libPromise = null;

// 라이브러리는 실제로 필요할 때 한 번만 불러옵니다 (첫 화면을 빠르게)
function loadLib() {
  if (!libPromise) {
    libPromise = import(LIB_URL).catch((err) => {
      libPromise = null; // 실패하면 다음에 다시 시도할 수 있게
      throw new Error('AI 엔진을 불러오지 못했어요. 인터넷 연결을 확인하세요.');
    });
  }
  return libPromise;
}

/**
 * 사진에서 배경을 지우고, 옷만 남은 투명 PNG를 돌려줍니다.
 * @param {Blob} imageBlob  원본 사진
 * @param {(phase: 'download'|'process', ratio: number) => void} onProgress  진행률 알림
 * @returns {Promise<Blob>} 배경이 투명해진 PNG
 */
export async function removeBg(imageBlob, onProgress) {
  const { removeBackground } = await loadLib();
  return removeBackground(imageBlob, {
    output: { format: 'image/png' },
    progress: (key, current, total) => {
      if (!onProgress || !total) return;
      // key가 'fetch'로 시작하면 모델 내려받는 중, 그 외는 계산 중
      const phase = String(key).startsWith('fetch') ? 'download' : 'process';
      onProgress(phase, Math.min(1, current / total));
    },
  });
}

/* ---------------------------------------------------------
   [나중에 유료 API로 바꾸고 싶다면]
   위 removeBg 함수 안쪽만 바꾸면 나머지 코드는 그대로 쓸 수 있어요.
   단, 유료 API 키는 절대 이 파일(브라우저 코드)에 넣으면 안 됩니다.
   누구나 볼 수 있기 때문이에요. 반드시 서버(예: Vercel 서버리스 함수)를
   하나 두고, 브라우저 → 내 서버 → 유료 API 순서로 요청하세요.
   자세한 내용은 README.md의 '유료 API로 확장하기'를 참고하세요.
--------------------------------------------------------- */

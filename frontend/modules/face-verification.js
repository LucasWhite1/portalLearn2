import { authorizedFetch } from './api.js';

const STEP_LABELS = {
  blink: 'Pisque devagar',
  turn_left: 'Vire o rosto para a esquerda',
  turn_right: 'Vire o rosto para a direita'
};

const FAILURE_GUIDANCE = {
  FACE_NOT_FOUND: 'Não encontrei seu rosto. Centralize-o no contorno e aproxime um pouco a câmera.',
  MULTIPLE_FACES: 'Há mais de um rosto na imagem. Faça a confirmação sem outra pessoa ao fundo.',
  INSUFFICIENT_VALID_FRAMES: 'Poucos quadros ficaram nítidos. Mantenha o rosto dentro do contorno durante toda a captura.',
  INSUFFICIENT_MOVEMENT: 'O movimento foi pequeno demais. Repita o gesto de forma um pouco mais marcada.',
  CHALLENGE_BLINK_NOT_CONFIRMED: 'A piscada não foi detectada. Pisque devagar e abra os olhos novamente.',
  CHALLENGE_TURN_LEFT_NOT_CONFIRMED: 'O giro para a esquerda não foi detectado. Vire o rosto, sem inclinar o celular.',
  CHALLENGE_TURN_RIGHT_NOT_CONFIRMED: 'O giro para a direita não foi detectado. Vire o rosto, sem inclinar o celular.',
  FACE_NOT_MATCHED: 'O rosto não corresponde ao cadastro facial desta conta.',
  INSUFFICIENT_MATCH_FRAMES: 'Não consegui comparar quadros suficientes. Mantenha o rosto centralizado durante toda a captura.',
  MODEL_VERSION_MISMATCH: 'O cadastro facial precisa ser atualizado antes desta confirmação.'
};

const getFailureGuidance = (failureCode) =>
  FAILURE_GUIDANCE[String(failureCode || '').toUpperCase()]
  || 'Não foi possível confirmar o gesto. Mantenha o rosto centralizado e siga a instrução exibida.';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (path, options = {}) => {
  const response = await authorizedFetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || 'Não foi possível concluir a verificação facial.');
    error.statusCode = response.status;
    error.code = payload?.code;
    error.payload = payload;
    throw error;
  }
  return payload;
};

const ensureFaceDialog = () => {
  let dialog = document.getElementById('faceVerificationDialog');
  if (dialog) return dialog;
  const style = document.createElement('style');
  style.textContent = `
    .face-verification-dialog{border:0;padding:0;background:transparent;max-width:min(94vw,620px);width:100%}
    .face-verification-dialog::backdrop{background:rgba(9,14,34,.72);backdrop-filter:blur(8px)}
    .face-verification-card{overflow:hidden;border:1px solid rgba(255,255,255,.42);border-radius:28px;background:#f8fbf7;box-shadow:0 30px 90px rgba(3,15,20,.34);color:#10201a}
    .face-verification-head{display:flex;justify-content:space-between;gap:18px;padding:24px 26px 18px;background:radial-gradient(circle at 92% 0,#80e6b1 0,transparent 42%),linear-gradient(135deg,#103d35,#176657);color:#fff}
    .face-verification-head h2{margin:0 0 6px;font:700 clamp(1.35rem,4vw,2rem) Georgia,serif}.face-verification-head p{margin:0;max-width:440px;color:#d8f5e8;line-height:1.45}
    .face-verification-close{align-self:flex-start;border:1px solid rgba(255,255,255,.36);border-radius:50%;width:38px;height:38px;background:rgba(255,255,255,.12);color:#fff;font-size:1.2rem;cursor:pointer}
    .face-verification-body{display:grid;gap:16px;padding:22px 26px 26px}
    .face-camera-shell{position:relative;overflow:hidden;aspect-ratio:4/3;border-radius:22px;background:#0c1714;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
    .face-camera-shell video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
    .face-camera-guide{position:absolute;inset:10% 23%;border:3px solid rgba(151,255,203,.9);border-radius:48% 48% 44% 44%;box-shadow:0 0 0 999px rgba(0,0,0,.2),0 0 34px rgba(71,255,164,.35);pointer-events:none}
    .face-verification-step{margin:0;padding:13px 16px;border-radius:14px;background:#e6f7ed;color:#145f42;font-weight:750;text-align:center}
    .face-verification-status{margin:0;color:#60756c;text-align:center;min-height:1.4em}
    .face-verification-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
    .face-verification-actions button{border:0;border-radius:999px;padding:12px 20px;font-weight:750;cursor:pointer}
    .face-cancel-btn{background:#e7ece9;color:#34483f}.face-start-btn{background:#1dbb72;color:#071c12;box-shadow:0 10px 24px rgba(29,187,114,.28)}
    .face-start-btn:disabled{opacity:.55;cursor:wait}
    @media(max-width:520px){.face-verification-head,.face-verification-body{padding-left:18px;padding-right:18px}.face-verification-card{border-radius:22px}.face-camera-guide{inset:9% 18%}}
  `;
  document.head.append(style);
  dialog = document.createElement('dialog');
  dialog.id = 'faceVerificationDialog';
  dialog.className = 'face-verification-dialog';
  dialog.innerHTML = `
    <div class="face-verification-card">
      <header class="face-verification-head">
        <div><h2>Confirmação facial</h2><p>Olhe para a câmera e siga os movimentos. Isso compara você ao cadastro inicial, não à sua identidade civil.</p></div>
        <button class="face-verification-close" type="button" aria-label="Fechar">×</button>
      </header>
      <div class="face-verification-body">
        <div class="face-camera-shell">
          <video autoplay muted playsinline></video>
          <div class="face-camera-guide" aria-hidden="true"></div>
        </div>
        <p class="face-verification-step">Prepare-se para a captura</p>
        <p class="face-verification-status">A câmera será usada somente durante esta confirmação.</p>
        <div class="face-verification-actions">
          <button class="face-cancel-btn" type="button">Cancelar</button>
          <button class="face-start-btn" type="button">Começar</button>
        </div>
      </div>
    </div>`;
  document.body.append(dialog);
  return dialog;
};

const cameraErrorMessage = (error) => {
  if (!window.isSecureContext) return 'A câmera exige HTTPS ou localhost.';
  if (error?.name === 'NotAllowedError') return 'Permissão da câmera negada. Libere o acesso nas configurações do navegador.';
  if (error?.name === 'NotFoundError') return 'Nenhuma câmera foi encontrada neste dispositivo.';
  if (error?.name === 'NotReadableError') return 'A câmera está sendo usada por outro aplicativo.';
  return error?.message || 'Não foi possível abrir a câmera.';
};

const canvasToBlob = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('Não foi possível capturar a imagem da câmera.'));
  }, 'image/jpeg', 0.72);
});

const collectFrames = async ({ video, canvas, session, stepElement, statusElement, signal }) => {
  const frames = [];
  const captureWindow = async (label, durationMs) => {
    stepElement.textContent = label;
    const startedAt = Date.now();
    while (Date.now() - startedAt < durationMs) {
      if (signal.aborted) throw new DOMException('Captura cancelada.', 'AbortError');
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const targetWidth = Math.min(640, video.videoWidth || 640);
        const ratio = (video.videoHeight || 480) / Math.max(video.videoWidth || 640, 1);
        canvas.width = targetWidth;
        canvas.height = Math.max(360, Math.round(targetWidth * ratio));
        canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(await canvasToBlob(canvas));
      }
      statusElement.textContent = `Capturando com segurança... ${frames.length} quadros`;
      await wait(240);
    }
  };
  await captureWindow('Olhe diretamente para a câmera', 1400);
  for (const step of session.challenge?.steps || []) {
    stepElement.textContent = 'Volte o rosto para o centro';
    statusElement.textContent = 'Prepare-se para o próximo movimento.';
    await wait(700);
    await captureWindow(STEP_LABELS[step] || 'Siga o movimento indicado', 2600);
  }
  return frames.slice(0, 36);
};

export const getFaceStatus = () => fetchJson('/api/student/face/status');

export const revokeFaceProfile = () => fetchJson('/api/student/face/profile', { method: 'DELETE' });

export const runFaceVerification = async ({
  mode = 'module',
  moduleId = '',
  purpose = 'entry',
  consentAccepted = false
} = {}) => {
  const sessionPath = mode === 'enrollment'
    ? '/api/student/face/enrollment/session'
    : `/api/student/modules/${encodeURIComponent(moduleId)}/face/session`;
  const verifyPath = mode === 'enrollment'
    ? '/api/student/face/enrollment/complete'
    : `/api/student/modules/${encodeURIComponent(moduleId)}/face/verify`;
  const session = await fetchJson(sessionPath, {
    method: 'POST',
    body: JSON.stringify(mode === 'enrollment' ? { consentAccepted } : { purpose })
  });
  const dialog = ensureFaceDialog();
  const video = dialog.querySelector('video');
  const startButton = dialog.querySelector('.face-start-btn');
  const cancelButton = dialog.querySelector('.face-cancel-btn');
  const closeButton = dialog.querySelector('.face-verification-close');
  const stepElement = dialog.querySelector('.face-verification-step');
  const statusElement = dialog.querySelector('.face-verification-status');
  const canvas = document.createElement('canvas');
  const controller = new AbortController();
  let stream = null;
  let settled = false;
  const cleanup = () => {
    controller.abort();
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    if (dialog.open) dialog.close();
  };
  return new Promise(async (resolve, reject) => {
    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const error = new Error('Verificação facial cancelada.');
      error.code = 'FACE_CAPTURE_CANCELED';
      reject(error);
    };
    cancelButton.onclick = cancel;
    closeButton.onclick = cancel;
    dialog.oncancel = (event) => {
      event.preventDefault();
      cancel();
    };
    try {
      dialog.showModal();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      statusElement.textContent = 'Posicione o rosto dentro do contorno e mantenha boa iluminação.';
    } catch (error) {
      settled = true;
      cleanup();
      reject(new Error(cameraErrorMessage(error)));
      return;
    }
    startButton.disabled = false;
    startButton.onclick = async () => {
      startButton.disabled = true;
      try {
        const frames = await collectFrames({
          video,
          canvas,
          session,
          stepElement,
          statusElement,
          signal: controller.signal
        });
        stepElement.textContent = 'Analisando a captura';
        statusElement.textContent = 'As imagens temporárias estão sendo processadas.';
        const body = new FormData();
        body.append('sessionId', session.id);
        body.append('consentAccepted', String(consentAccepted));
        frames.forEach((frame, index) => body.append('frames', frame, `frame-${index}.jpg`));
        const result = await fetchJson(verifyPath, { method: 'POST', body });
        settled = true;
        cleanup();
        resolve(result);
      } catch (error) {
        if (error.name === 'AbortError') return;
        if (error.payload && error.statusCode === 422) {
          const attempts = Number(error.payload?.attemptsRemaining);
          const guidance = getFailureGuidance(error.payload?.failureCode);
          statusElement.textContent = error.payload?.reviewRequired
            ? 'As tentativas terminaram. Uma revisão foi enviada ao professor.'
            : `${guidance} Restam ${attempts} tentativa(s).`;
          stepElement.textContent = error.payload?.reviewRequired
            ? 'Revisão humana solicitada'
            : 'Ajuste o gesto e tente novamente';
          startButton.disabled = Boolean(error.payload?.reviewRequired);
          startButton.textContent = 'Tentar novamente';
          if (error.payload?.reviewRequired) {
            settled = true;
            setTimeout(() => {
              cleanup();
              reject(error);
            }, 2200);
          }
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      }
    };
  });
};

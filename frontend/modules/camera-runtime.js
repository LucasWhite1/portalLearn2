export const createBuilderCameraModule = (deps) => {
  const {
    cameraRecordingMimeCandidates,
    creatorStudentStreams,
    connectToStudentPeerInCreator,
    getPreviewActiveSlide,
    getActiveSlide,
    isPreviewActive,
    getSelectedElementId,
    getCurrentStageEditor,
    renderSlide,
    commitHistoryState,
    scheduleHistoryCommit,
    scheduleBuilderAutosave,
    selectElement,
    updateCameraEditorVisibility,
    applyStageConstraints,
    normalizeVideoTriggerConfig,
    getUiRefs,
    alertUser = (message) => window.alert(message)
  } = deps;

  const builderCameraRuntime = new Map();

  const normalizeCameraElement = (element) => {
    if (!element || element.type !== 'camera') {
      return;
    }
    element.width = Math.max(220, Number(element.width) || 320);
    element.height = Math.max(160, Number(element.height) || 240);
    element.backgroundColor = 'transparent';
  };

  const getBuilderCameraContext = (element, slide, { preview = false } = {}) => ({
    elementId: element?.id || '',
    slideId: slide?.id || '',
    preview
  });

  const getBuilderCameraSessionKey = (context) =>
    `${context.preview ? 'preview' : 'editor'}::${context.slideId || 'slide'}::${context.elementId || 'element'}`;

  const createBuilderCameraSession = () => ({
    stream: null,
    captureVideo: null,
    recorder: null,
    recordedChunks: [],
    pendingStart: null,
    phase: 'idle',
    lastError: '',
    recordingCleanup: null,
    startToken: 0,
    hasAudio: false
  });

  const getBuilderCameraSession = (context) => {
    const key = getBuilderCameraSessionKey(context);
    if (!builderCameraRuntime.has(key)) {
      builderCameraRuntime.set(key, createBuilderCameraSession());
    }
    return builderCameraRuntime.get(key);
  };

  const isBuilderCameraSupported = () =>
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  const formatCameraAccessError = (error) => {
    const errorName = String(error?.name || '').trim();
    if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
      return 'O navegador ou o sistema ainda estao bloqueando a camera para este site. Verifique a permissao do endereco e a privacidade da camera no Windows.';
    }
    if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
      return 'A camera parece estar ocupada por outro programa ou bloqueada pelo sistema. Feche outros apps que usam webcam e tente novamente.';
    }
    if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
      return 'Nenhuma camera foi encontrada neste dispositivo.';
    }
    if (errorName === 'OverconstrainedError' || errorName === 'ConstraintNotSatisfiedError') {
      return 'A camera deste dispositivo nao aceitou a configuracao solicitada. Tente novamente.';
    }
    if (errorName === 'AbortError') {
      return 'O navegador interrompeu a inicializacao da camera. Tente novamente.';
    }
    const fallback = String(error?.message || '').trim();
    return fallback || 'Nao foi possivel acessar a webcam.';
  };

  const chooseCameraRecordingMimeType = () => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    return cameraRecordingMimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
  };

  const normalizeRecordedVideoMimeType = (mimeType = '') => {
    const baseType = String(mimeType || '').split(';')[0].trim().toLowerCase();
    return baseType.startsWith('video/') ? baseType : 'video/webm';
  };

  const streamHasAudioTrack = (stream) =>
    stream instanceof MediaStream &&
    typeof stream.getAudioTracks === 'function' &&
    stream.getAudioTracks().some((track) => track.readyState === 'live');

  const buildCameraRecorderStream = (captureStream, sourceStream) => {
    const videoStream = captureStream || sourceStream || null;
    if (!videoStream) {
      return null;
    }
    const videoTracks = typeof videoStream.getVideoTracks === 'function'
      ? videoStream.getVideoTracks().filter((track) => track.readyState === 'live')
      : [];
    const audioTracks = sourceStream && typeof sourceStream.getAudioTracks === 'function'
      ? sourceStream.getAudioTracks().filter((track) => track.readyState === 'live')
      : [];
    if (!videoTracks.length) {
      return sourceStream || captureStream || null;
    }
    if (!audioTracks.length) {
      return captureStream || sourceStream || null;
    }
    try {
      return new MediaStream([...videoTracks, ...audioTracks]);
    } catch (error) {
      console.warn('Nao foi possivel combinar audio e video da camera. A gravacao seguira sem audio.', error);
      return captureStream || sourceStream || null;
    }
  };

  const createCameraMediaRecorder = (primaryStream, fallbackStream) => {
    const attempts = [];
    if (primaryStream) attempts.push(primaryStream);
    if (fallbackStream && fallbackStream !== primaryStream) attempts.push(fallbackStream);
    let lastError = null;
    for (const stream of attempts) {
      try {
        const mimeType = chooseCameraRecordingMimeType();
        return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('A gravacao da camera nao esta disponivel agora.');
  };

  const readBlobAsDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('Nao foi possivel preparar a captura da camera.'));
      reader.readAsDataURL(blob);
    });

  const createCameraCaptureVideo = (stream) => {
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.play().catch(() => {});
    return video;
  };

  const waitForCameraVideoReady = (video) =>
    new Promise((resolve) => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
        return;
      }
      const finish = () => {
        video.removeEventListener('loadedmetadata', finish);
        video.removeEventListener('canplay', finish);
        resolve();
      };
      video.addEventListener('loadedmetadata', finish, { once: true });
      video.addEventListener('canplay', finish, { once: true });
    });

  const attachCameraStreamToVideo = (video, stream) => {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    video.play().catch(() => {});
  };

  const requestBuilderCameraRender = (context) => {
    const activeSlide = isPreviewActive() ? getPreviewActiveSlide() : getActiveSlide();
    if (!activeSlide || !context?.slideId || activeSlide.id !== context.slideId || isPreviewActive() !== Boolean(context.preview)) {
      return;
    }
    renderSlide();
    if (!context.preview) {
      const selectedElement = getActiveSlide()?.elements.find((child) => child.id === getSelectedElementId());
      if (selectedElement?.id === context.elementId && selectedElement.type === 'camera') {
        updateCameraEditorVisibility(selectedElement, { forceOpen: getCurrentStageEditor() === 'camera' });
      }
    }
  };

  const clearBuilderCameraSessionResources = (session) => {
    if (!session) {
      return;
    }
    session.startToken += 1;
    if (typeof session.recordingCleanup === 'function') {
      session.recordingCleanup();
      session.recordingCleanup = null;
    }
    if (session.recorder && session.recorder.state !== 'inactive') {
      try {
        session.recorder.ondataavailable = null;
        session.recorder.stop();
      } catch (error) {
        console.warn('Nao foi possivel interromper a gravacao da camera.', error);
      }
    }
    session.recorder = null;
    session.recordedChunks = [];
    if (session.captureVideo instanceof HTMLVideoElement) {
      session.captureVideo.pause();
      session.captureVideo.srcObject = null;
    }
    session.captureVideo = null;
    if (session.stream) {
      session.stream.getTracks().forEach((track) => track.stop());
    }
    session.stream = null;
    session.pendingStart = null;
    session.phase = 'idle';
    session.lastError = '';
    session.hasAudio = false;
  };

  const disposeBuilderCameraSession = (context) => {
    const key = getBuilderCameraSessionKey(context);
    const session = builderCameraRuntime.get(key);
    if (!session) {
      return;
    }
    clearBuilderCameraSessionResources(session);
    builderCameraRuntime.delete(key);
  };

  const syncVisibleBuilderCameraSessions = (visibleKeys = new Set()) => {
    builderCameraRuntime.forEach((session, key) => {
      if (!visibleKeys.has(key)) {
        clearBuilderCameraSessionResources(session);
        builderCameraRuntime.delete(key);
      }
    });
  };

  const requestBuilderCameraStream = async (context, { restart = false } = {}) => {
    const session = getBuilderCameraSession(context);
    if (!isBuilderCameraSupported()) {
      session.phase = 'error';
      session.lastError = 'A webcam nao esta disponivel neste navegador.';
      requestBuilderCameraRender(context);
      throw new Error(session.lastError);
    }
    if (restart) {
      clearBuilderCameraSessionResources(session);
    }
    if (session.stream && session.phase !== 'error') {
      return session.stream;
    }
    if (session.pendingStart) {
      return session.pendingStart;
    }
    session.phase = 'requesting';
    session.lastError = '';
    const startToken = session.startToken + 1;
    session.startToken = startToken;
    session.pendingStart = (async () => {
      const preferredAudioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };
      const constraintsList = [
        { video: { facingMode: 'user' }, audio: preferredAudioConstraints },
        { video: true, audio: preferredAudioConstraints },
        { video: { facingMode: 'user' }, audio: true },
        { video: true, audio: true },
        { video: { facingMode: 'user' }, audio: false },
        { video: true, audio: false }
      ];
      let stream = null;
      let lastError = null;
      for (const constraints of constraintsList) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!stream) {
        throw lastError || new Error('Nao foi possivel acessar a webcam.');
      }
      if (session.startToken !== startToken) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Sessao de camera encerrada.');
      }
      session.stream = stream;
      session.hasAudio = streamHasAudioTrack(stream);
      session.captureVideo = createCameraCaptureVideo(stream);
      await waitForCameraVideoReady(session.captureVideo);
      if (session.startToken !== startToken) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Sessao de camera encerrada.');
      }
      session.phase = 'ready';
      requestBuilderCameraRender(context);
      return stream;
    })()
      .catch((error) => {
        clearBuilderCameraSessionResources(session);
        session.phase = 'error';
        session.lastError = formatCameraAccessError(error);
        requestBuilderCameraRender(context);
        throw error;
      })
      .finally(() => {
        session.pendingStart = null;
      });
    return session.pendingStart;
  };

  const getCameraOutputSize = (element, scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1))) => {
    const width = Math.max(1, Math.round(Number(element?.width) || 320));
    const height = Math.max(1, Math.round(Number(element?.height) || 240));
    return {
      cssWidth: width,
      cssHeight: height,
      pixelWidth: Math.max(1, Math.round(width * scale)),
      pixelHeight: Math.max(1, Math.round(height * scale))
    };
  };

  const drawMirroredVideoCover = (context, video, width, height) => {
    const sourceWidth = Math.max(1, Number(video?.videoWidth) || width);
    const sourceHeight = Math.max(1, Number(video?.videoHeight) || height);
    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = width / height;
    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;
    if (sourceRatio > targetRatio) {
      sw = Math.round(sourceHeight * targetRatio);
      sx = Math.max(0, Math.round((sourceWidth - sw) / 2));
    } else if (sourceRatio < targetRatio) {
      sh = Math.round(sourceWidth / targetRatio);
      sy = Math.max(0, Math.round((sourceHeight - sh) / 2));
    }
    context.save();
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    context.restore();
  };

  const finalizeBuilderCameraAsImage = (element, context, dataUrl) => {
    element.type = 'image';
    element.src = dataUrl;
    element.objectFit = 'cover';
    element.backgroundColor = 'transparent';
    delete element.provider;
    delete element.embedSrc;
    delete element.videoTriggers;
    disposeBuilderCameraSession(context);
    if (context.preview) {
      renderSlide();
      return;
    }
    selectElement(element.id, { openEditor: true });
    commitHistoryState();
  };

  const finalizeBuilderCameraAsVideo = (element, context, dataUrl) => {
    element.type = 'video';
    element.src = dataUrl;
    element.backgroundColor = 'transparent';
    element.videoTriggers = Array.isArray(element.videoTriggers) ? element.videoTriggers : [];
    delete element.provider;
    delete element.embedSrc;
    normalizeVideoTriggerConfig(element);
    disposeBuilderCameraSession(context);
    if (context.preview) {
      renderSlide();
      return;
    }
    selectElement(element.id, { openEditor: true });
    commitHistoryState();
  };

  const captureBuilderCameraPhoto = async (element, context) => {
    normalizeCameraElement(element);
    await requestBuilderCameraStream(context);
    const session = getBuilderCameraSession(context);
    const video = session.captureVideo;
    if (!(video instanceof HTMLVideoElement)) {
      throw new Error('A camera ainda nao esta pronta para fotografar.');
    }
    await waitForCameraVideoReady(video);
    const size = getCameraOutputSize(element);
    const canvas = document.createElement('canvas');
    canvas.width = size.pixelWidth;
    canvas.height = size.pixelHeight;
    const context2d = canvas.getContext('2d');
    if (!context2d) {
      throw new Error('Nao foi possivel preparar a captura da camera.');
    }
    context2d.scale(size.pixelWidth / size.cssWidth, size.pixelHeight / size.cssHeight);
    drawMirroredVideoCover(context2d, video, size.cssWidth, size.cssHeight);
    finalizeBuilderCameraAsImage(element, context, canvas.toDataURL('image/png'));
  };

  const startBuilderCameraRecording = async (element, context) => {
    normalizeCameraElement(element);
    await requestBuilderCameraStream(context);
    const session = getBuilderCameraSession(context);
    if (session.recorder && session.recorder.state !== 'inactive') {
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      session.phase = 'error';
      session.lastError = 'Este navegador nao suporta gravacao de video.';
      requestBuilderCameraRender(context);
      throw new Error(session.lastError);
    }
    const sourceVideo = session.captureVideo;
    if (!(sourceVideo instanceof HTMLVideoElement)) {
      throw new Error('A camera ainda nao esta pronta para gravar.');
    }
    await waitForCameraVideoReady(sourceVideo);
    const size = getCameraOutputSize(element);
    const canvas = document.createElement('canvas');
    canvas.width = size.pixelWidth;
    canvas.height = size.pixelHeight;
    const context2d = canvas.getContext('2d');
    if (!context2d) {
      throw new Error('Nao foi possivel preparar a gravacao da camera.');
    }
    const captureStream = typeof canvas.captureStream === 'function' ? canvas.captureStream(30) : null;
    const recorderStream = buildCameraRecorderStream(captureStream, session.stream);
    if (!recorderStream) {
      throw new Error('A gravacao da camera nao esta disponivel agora.');
    }
    let frameId = null;
    const renderFrame = () => {
      context2d.setTransform(1, 0, 0, 1, 0, 0);
      context2d.clearRect(0, 0, canvas.width, canvas.height);
      context2d.scale(size.pixelWidth / size.cssWidth, size.pixelHeight / size.cssHeight);
      drawMirroredVideoCover(context2d, sourceVideo, size.cssWidth, size.cssHeight);
      frameId = requestAnimationFrame(renderFrame);
    };
    renderFrame();
    const recorder = createCameraMediaRecorder(recorderStream, captureStream || session.stream);
    session.recordedChunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        session.recordedChunks.push(event.data);
      }
    };
    recorder.start(200);
    session.recordingCleanup = () => {
      if (typeof frameId === 'number') {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      captureStream?.getTracks().forEach((track) => track.stop());
    };
    session.recorder = recorder;
    session.phase = 'recording';
    requestBuilderCameraRender(context);
  };

  const stopBuilderCameraRecording = async (element, context) => {
    const session = getBuilderCameraSession(context);
    if (!session.recorder || session.recorder.state === 'inactive') {
      return;
    }
    session.phase = 'processing';
    requestBuilderCameraRender(context);
    const recorder = session.recorder;
    const stopPromise = new Promise((resolve, reject) => {
      recorder.addEventListener('stop', resolve, { once: true });
      recorder.addEventListener('error', () => reject(new Error('Nao foi possivel finalizar a gravacao da camera.')), { once: true });
    });
    recorder.stop();
    await stopPromise;
    const blob = new Blob(session.recordedChunks, { type: normalizeRecordedVideoMimeType(recorder.mimeType) });
    session.recorder = null;
    session.recordedChunks = [];
    if (typeof session.recordingCleanup === 'function') {
      session.recordingCleanup();
      session.recordingCleanup = null;
    }
    if (!blob.size) {
      session.phase = 'error';
      session.lastError = 'A gravacao nao gerou um video valido.';
      requestBuilderCameraRender(context);
      throw new Error(session.lastError);
    }
    finalizeBuilderCameraAsVideo(element, context, await readBlobAsDataUrl(blob));
  };

  const getBuilderCameraStatusMessage = (session) => {
    if (!isBuilderCameraSupported()) {
      return 'Webcam indisponivel neste navegador.';
    }
    if (!session) {
      return 'Preparando camera...';
    }
    if (session.phase === 'recording') {
      return session.hasAudio
        ? 'Gravando em espelho. Clique em parar para gerar o video.'
        : 'Gravando em espelho sem audio. Clique em parar para gerar o video.';
    }
    if (session.phase === 'processing') {
      return 'Finalizando o video capturado...';
    }
    if (session.phase === 'requesting') {
      return 'Solicitando permissao para acessar a webcam e o microfone...';
    }
    if (session.phase === 'ready') {
      return session.hasAudio
        ? 'Espelho ativo. Tire uma foto ou grave um video.'
        : 'Espelho ativo. Microfone indisponivel; a gravacao saira sem audio.';
    }
    if (session.lastError) {
      return session.lastError;
    }
    return 'Ative a camera para transmitir a webcam no palco.';
  };

  const createBuilderCameraNode = (element, slide, { preview = false } = {}) => {
    normalizeCameraElement(element);
    const context = getBuilderCameraContext(element, slide, { preview });
    const session = getBuilderCameraSession(context);
    const studentPeerId = element.studentPeerId;
    const isStudentCamera = Boolean(studentPeerId);

    const node = document.createElement('div');
    node.className = 'builder-camera-element';

    const previewVideo = document.createElement('video');
    previewVideo.className = 'builder-camera-preview';
    previewVideo.setAttribute('aria-label', preview ? 'Visualizacao da camera na previa' : 'Visualizacao da camera no editor');
    previewVideo.autoplay = true;
    previewVideo.playsInline = true;
    node.appendChild(previewVideo);

    if (isStudentCamera) {
      const remoteStream = creatorStudentStreams.get(studentPeerId);
      if (remoteStream) {
        previewVideo.srcObject = remoteStream;
        previewVideo.muted = false;
      } else {
        connectToStudentPeerInCreator(studentPeerId);
      }
    } else if (session.stream) {
      attachCameraStreamToVideo(previewVideo, session.stream);
    }

    const overlay = document.createElement('div');
    overlay.className = 'builder-camera-overlay';

    const hasStream = isStudentCamera ? !!creatorStudentStreams.get(studentPeerId) : !!session.stream;
    const isErrorOrRequesting = !isStudentCamera && (session.phase === 'error' || session.phase === 'requesting');

    if (!hasStream || isErrorOrRequesting) {
      const emptyState = document.createElement('div');
      emptyState.className = 'builder-camera-empty';
      const title = document.createElement('strong');

      if (isStudentCamera) {
        title.textContent = `Câmera de ${element.studentName || 'Aluno'}`;
        const text = document.createElement('span');
        text.textContent = 'Conectando à transmissão do aluno...';
        emptyState.append(title, text);
      } else {
        title.textContent = session.phase === 'error' ? 'Camera indisponivel' : 'Camera pronta para espelhar';
        const text = document.createElement('span');
        text.textContent = getBuilderCameraStatusMessage(session);
        emptyState.append(title, text);
        if (session.phase !== 'requesting') {
          const overlayStartButton = document.createElement('button');
          overlayStartButton.type = 'button';
          overlayStartButton.className = 'builder-camera-btn is-secondary builder-camera-empty-action';
          overlayStartButton.textContent = session.phase === 'error' ? 'Tentar novamente' : 'Ativar camera';
          overlayStartButton.disabled = session.phase === 'processing';
          ['pointerdown', 'click'].forEach((eventName) => {
            overlayStartButton.addEventListener(eventName, (event) => {
              event.stopPropagation();
            });
          });
          overlayStartButton.addEventListener('click', () => {
            void requestBuilderCameraStream(context, { restart: true }).catch(() => {});
          });
          emptyState.appendChild(overlayStartButton);
        }
      }
      overlay.appendChild(emptyState);
    } else {
      overlay.style.display = 'none';
    }
    node.appendChild(overlay);

    const controls = document.createElement('div');
    controls.className = 'builder-camera-controls';
    ['pointerdown', 'click'].forEach((eventName) => {
      controls.addEventListener(eventName, (event) => {
        event.stopPropagation();
      });
    });

    const status = document.createElement('div');
    status.className = 'builder-camera-status';
    if (session.phase === 'error') {
      status.classList.add('is-error');
    } else if (session.phase === 'recording') {
      status.classList.add('is-recording');
    }
    status.textContent = getBuilderCameraStatusMessage(session);
    controls.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'builder-camera-actions';
    controls.appendChild(actions);

    if (isStudentCamera) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'builder-camera-btn is-danger';
      removeBtn.textContent = 'Encerrar transmissão';
      removeBtn.style.flex = '1';
      removeBtn.addEventListener('click', () => {
        const currentSlide = getActiveSlide();
        if (currentSlide) {
          currentSlide.elements = currentSlide.elements.filter((item) => item.id !== element.id);
          renderSlide();
          scheduleBuilderAutosave();
        }
      });
      actions.appendChild(removeBtn);
    } else {
      const startButton = document.createElement('button');
      startButton.type = 'button';
      startButton.className = 'builder-camera-btn is-secondary';
      startButton.textContent = session.stream ? 'Reconectar' : 'Ativar';
      startButton.disabled = session.phase === 'requesting' || session.phase === 'processing';
      startButton.addEventListener('click', () => {
        void requestBuilderCameraStream(context, { restart: true }).catch(() => {});
      });
      actions.appendChild(startButton);

      const photoButton = document.createElement('button');
      photoButton.type = 'button';
      photoButton.className = 'builder-camera-btn';
      photoButton.textContent = 'Foto';
      photoButton.disabled = !session.stream || session.phase === 'requesting' || session.phase === 'processing' || session.phase === 'recording';
      photoButton.addEventListener('click', () => {
        void captureBuilderCameraPhoto(element, context).catch((error) => {
          session.phase = 'error';
          session.lastError = error?.message || 'Nao foi possivel capturar a foto.';
          requestBuilderCameraRender(context);
        });
      });
      actions.appendChild(photoButton);

      const recordButton = document.createElement('button');
      recordButton.type = 'button';
      recordButton.className = 'builder-camera-btn';
      recordButton.textContent = 'Gravar';
      recordButton.disabled = !session.stream || session.phase === 'requesting' || session.phase === 'processing' || session.phase === 'recording';
      recordButton.addEventListener('click', () => {
        void startBuilderCameraRecording(element, context).catch((error) => {
          session.phase = 'error';
          session.lastError = error?.message || 'Nao foi possivel iniciar a gravacao.';
          requestBuilderCameraRender(context);
        });
      });
      actions.appendChild(recordButton);

      const stopButton = document.createElement('button');
      stopButton.type = 'button';
      stopButton.className = 'builder-camera-btn is-danger';
      stopButton.textContent = 'Parar';
      stopButton.disabled = session.phase !== 'recording';
      stopButton.addEventListener('click', () => {
        void stopBuilderCameraRecording(element, context).catch((error) => {
          session.phase = 'error';
          session.lastError = error?.message || 'Nao foi possivel finalizar a gravacao.';
          requestBuilderCameraRender(context);
        });
      });
      actions.appendChild(stopButton);
    }

    node.appendChild(controls);
    return node;
  };

  const syncCameraEditorControls = (element) => {
    const refs = getUiRefs();
    const isCamera = element?.type === 'camera';
    const activeSlide = getActiveSlide();
    const context = isCamera ? getBuilderCameraContext(element, activeSlide, { preview: false }) : null;
    const session = context ? getBuilderCameraSession(context) : null;
    if (isCamera) {
      normalizeCameraElement(element);
    }
    if (refs.cameraElementWidthInput) refs.cameraElementWidthInput.value = isCamera ? String(element.width || '') : '';
    if (refs.cameraElementHeightInput) refs.cameraElementHeightInput.value = isCamera ? String(element.height || '') : '';
    if (refs.cameraElementRotationInput) refs.cameraElementRotationInput.value = isCamera ? String(element.rotation || 0) : '0';
    if (refs.cameraEditorStatus) {
      refs.cameraEditorStatus.textContent = isCamera ? getBuilderCameraStatusMessage(session) : 'Selecione um elemento de câmera.';
    }
    if (refs.cameraEditorActivateBtn) {
      refs.cameraEditorActivateBtn.disabled = !isCamera || session?.phase === 'requesting' || session?.phase === 'processing';
      refs.cameraEditorActivateBtn.textContent = session?.stream ? 'Reconectar câmera' : 'Ativar câmera';
    }
    if (refs.cameraEditorPhotoBtn) {
      refs.cameraEditorPhotoBtn.disabled = !isCamera || !session?.stream || session?.phase === 'requesting' || session?.phase === 'processing' || session?.phase === 'recording';
    }
    if (refs.cameraEditorRecordBtn) {
      refs.cameraEditorRecordBtn.disabled = !isCamera || !session?.stream || session?.phase === 'requesting' || session?.phase === 'processing' || session?.phase === 'recording';
    }
    if (refs.cameraEditorStopBtn) {
      refs.cameraEditorStopBtn.disabled = !isCamera || session?.phase !== 'recording';
    }
    if (refs.cameraEditorTransmitBtn) {
      refs.cameraEditorTransmitBtn.disabled = !isCamera;
    }
  };

  const syncCameraEditor = () => {
    const slide = getActiveSlide();
    if (!slide || !getSelectedElementId()) {
      return;
    }
    const refs = getUiRefs();
    const element = slide.elements.find((child) => child.id === getSelectedElementId());
    if (!element || element.type !== 'camera') {
      return;
    }
    normalizeCameraElement(element);
    const widthValue = Number(refs.cameraElementWidthInput?.value);
    const heightValue = Number(refs.cameraElementHeightInput?.value);
    const rotationValue = Number(refs.cameraElementRotationInput?.value);
    if (!Number.isNaN(widthValue) && widthValue > 0) {
      element.width = Math.max(220, widthValue);
    }
    if (!Number.isNaN(heightValue) && heightValue > 0) {
      element.height = Math.max(160, heightValue);
    }
    if (!Number.isNaN(rotationValue)) {
      element.rotation = ((rotationValue % 360) + 360) % 360;
    }
    applyStageConstraints(element);
    updateCameraEditorVisibility(element, { forceOpen: true });
    renderSlide();
    scheduleHistoryCommit();
  };

  const activateSelectedCamera = async ({ restart = false } = {}) => {
    const slide = getActiveSlide();
    const element = slide?.elements.find((child) => child.id === getSelectedElementId());
    if (!element || element.type !== 'camera') {
      return;
    }
    try {
      await requestBuilderCameraStream(getBuilderCameraContext(element, slide, { preview: false }), { restart });
      updateCameraEditorVisibility(element, { forceOpen: true });
    } catch (error) {
      alertUser(error.message || 'Não foi possível ativar a câmera.');
    }
  };

  const captureSelectedCameraPhoto = async () => {
    const slide = getActiveSlide();
    const element = slide?.elements.find((child) => child.id === getSelectedElementId());
    if (!element || element.type !== 'camera') {
      return;
    }
    try {
      await captureBuilderCameraPhoto(element, getBuilderCameraContext(element, slide, { preview: false }));
    } catch (error) {
      alertUser(error.message || 'Não foi possível capturar a foto.');
    }
  };

  const recordSelectedCamera = async () => {
    const slide = getActiveSlide();
    const element = slide?.elements.find((child) => child.id === getSelectedElementId());
    if (!element || element.type !== 'camera') {
      return;
    }
    try {
      await startBuilderCameraRecording(element, getBuilderCameraContext(element, slide, { preview: false }));
      updateCameraEditorVisibility(element, { forceOpen: true });
    } catch (error) {
      alertUser(error.message || 'Não foi possível iniciar a gravação.');
    }
  };

  const stopSelectedCameraRecording = async () => {
    const slide = getActiveSlide();
    const element = slide?.elements.find((child) => child.id === getSelectedElementId());
    if (!element || element.type !== 'camera') {
      return;
    }
    try {
      await stopBuilderCameraRecording(element, getBuilderCameraContext(element, slide, { preview: false }));
    } catch (error) {
      alertUser(error.message || 'Não foi possível finalizar a gravação.');
    }
  };

  return {
    normalizeCameraElement,
    getBuilderCameraContext,
    getBuilderCameraSessionKey,
    getBuilderCameraSession,
    syncVisibleBuilderCameraSessions,
    getBuilderCameraStatusMessage,
    createBuilderCameraNode,
    syncCameraEditorControls,
    syncCameraEditor,
    activateSelectedCamera,
    captureSelectedCameraPhoto,
    recordSelectedCamera,
    stopSelectedCameraRecording
  };
};

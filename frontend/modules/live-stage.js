export const LIVE_STAGE_SYNC_DEBOUNCE_MS = 350;

export const createLiveStageShareState = () => ({
  active: false,
  shareId: '',
  url: '',
  manualPublish: false,
  publishedPayload: null,
  hasUnpublishedChanges: false,
  lastPublishedAt: 0,
  syncTimer: null,
  syncing: false,
  pending: false,
  lastFingerprint: '',
  lastSyncAt: 0,
  drawingStrokes: [],
  lastError: '',
  liveCameraPeerId: null,
  liveScreenPeerId: null,
  disconnectedStudentIds: [],
  disconnectedStudentNames: []
});

export const getLiveStageShareViewerUrl = (shareId) => {
  const url = new URL('module-viewer.html', window.location.href);
  url.searchParams.set('liveShareId', shareId);
  return url.toString();
};

export const createLiveStageShareController = ({
  state,
  authorizedFetch,
  buildPayload,
  isPreviewActive,
  syncUi,
  onStopRuntime,
  onCameraRequests,
  onDrawingStrokes,
  getUi
}) => {
  const notifyUi = () => {
    if (typeof syncUi === 'function') {
      syncUi();
    }
  };

  const stopShare = async ({ syncUiOnly = false } = {}) => {
    if (state.syncTimer) {
      clearTimeout(state.syncTimer);
      state.syncTimer = null;
    }
    const currentShareId = state.shareId;
    state.active = false;
    state.shareId = '';
    state.url = '';
    state.publishedPayload = null;
    state.hasUnpublishedChanges = false;
    state.lastPublishedAt = 0;
    state.syncing = false;
    state.pending = false;
    state.lastFingerprint = '';
    state.lastError = '';
    state.liveCameraPeerId = null;
    state.liveScreenPeerId = null;
    state.disconnectedStudentIds = [];
    state.disconnectedStudentNames = [];
    if (typeof onStopRuntime === 'function') {
      onStopRuntime();
    }
    notifyUi();
    if (syncUiOnly || !currentShareId) {
      return;
    }
    try {
      await authorizedFetch(`/api/admin/live-stage-shares/${encodeURIComponent(currentShareId)}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.warn('Não foi possível encerrar o palco ao vivo.', error);
    }
  };

  const scheduleSync = () => {
    if (!state.active || isPreviewActive()) {
      return;
    }
    if (state.manualPublish) {
      state.hasUnpublishedChanges = true;
      notifyUi();
      return;
    }
    if (state.syncTimer) {
      clearTimeout(state.syncTimer);
    }
    state.syncTimer = setTimeout(() => {
      state.syncTimer = null;
      void flushSync();
    }, LIVE_STAGE_SYNC_DEBOUNCE_MS);
  };

  const flushSync = async ({ forcePublish = false } = {}) => {
    if (!state.active || !state.shareId || isPreviewActive()) {
      return;
    }
    if (state.manualPublish && !forcePublish) {
      state.hasUnpublishedChanges = true;
      notifyUi();
      return;
    }
    if (state.syncing) {
      state.pending = true;
      return;
    }
    const payload = buildPayload();
    const fingerprint = JSON.stringify(payload);
    const now = Date.now();
    const timeSinceLastSync = now - (state.lastSyncAt || 0);

    if (fingerprint === state.lastFingerprint && timeSinceLastSync < 2000) {
      if (!state.syncTimer) {
        scheduleSync();
      }
      return;
    }

    state.syncing = true;
    state.lastError = '';
    notifyUi();
    try {
      const response = await authorizedFetch(`/api/admin/live-stage-shares/${encodeURIComponent(state.shareId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || 'Não foi possível atualizar o palco ao vivo.');
      }
      const responseBody = await response.json().catch(() => ({}));
      if (typeof onCameraRequests === 'function') {
        onCameraRequests(responseBody.cameraRequests || []);
      }
      if (typeof onDrawingStrokes === 'function') {
        onDrawingStrokes(responseBody.drawingStrokes || []);
      }
      state.lastSyncAt = Date.now();
      state.lastFingerprint = fingerprint;
      state.publishedPayload = JSON.parse(JSON.stringify(payload));
      state.hasUnpublishedChanges = false;
      state.lastPublishedAt = state.lastSyncAt;
    } catch (error) {
      state.lastError = error.message || 'Não foi possível atualizar o palco ao vivo.';
    } finally {
      state.syncing = false;
      notifyUi();
      if (state.active && !state.manualPublish) {
        scheduleSync();
      }
    }
  };

  const startShare = async () => {
    const payload = buildPayload();
    try {
      const response = await authorizedFetch('/api/admin/live-stage-shares', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const responseBody = await response.json().catch(() => null);
      if (!response.ok || !responseBody?.shareId) {
        throw new Error(responseBody?.message || 'Não foi possível iniciar o palco ao vivo.');
      }
      state.active = true;
      state.shareId = responseBody.shareId;
      state.url = getLiveStageShareViewerUrl(responseBody.shareId);
      state.lastFingerprint = JSON.stringify(payload);
      state.publishedPayload = JSON.parse(JSON.stringify(payload));
      state.hasUnpublishedChanges = false;
      state.lastPublishedAt = Date.now();
      state.lastError = '';
      notifyUi();
      if (!state.manualPublish) {
        scheduleSync();
      }
    } catch (error) {
      state.lastError = error.message || 'Não foi possível iniciar o palco ao vivo.';
      notifyUi();
      alert(state.lastError);
    }
  };

  const toggleShare = async () => {
    if (state.active) {
      await stopShare();
      return;
    }
    await startShare();
  };

  const copyLink = async () => {
    const ui = typeof getUi === 'function' ? getUi() || {} : {};
    if (!state.url) {
      notifyUi();
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(state.url);
      } else if (ui.linkInput) {
        ui.linkInput.focus({ preventScroll: true });
        ui.linkInput.select();
        document.execCommand('copy');
        ui.linkInput.setSelectionRange(0, 0);
      } else {
        throw new Error('Clipboard indisponível');
      }
      if (ui.status) {
        ui.status.textContent = 'Link do palco ao vivo copiado.';
      }
    } catch (error) {
      alert('Não foi possível copiar o link automaticamente.');
    }
  };

  const getDraftSnapshot = () => ({
    active: state.active,
    shareId: state.shareId,
    url: state.url,
    manualPublish: state.manualPublish,
    publishedPayload: state.publishedPayload,
    hasUnpublishedChanges: state.hasUnpublishedChanges,
    lastPublishedAt: state.lastPublishedAt
  });

  const restoreFromDraft = (draftLiveStageShare = null) => {
    if (!draftLiveStageShare) {
      return;
    }
    state.active = Boolean(draftLiveStageShare.active);
    state.shareId = draftLiveStageShare.shareId || '';
    state.url = draftLiveStageShare.url || '';
    state.manualPublish = Boolean(draftLiveStageShare.manualPublish);
    state.publishedPayload = draftLiveStageShare.publishedPayload || null;
    state.hasUnpublishedChanges = Boolean(draftLiveStageShare.hasUnpublishedChanges);
    state.lastPublishedAt = Number(draftLiveStageShare.lastPublishedAt) || 0;
    notifyUi();
    if (state.active && state.shareId && !state.manualPublish) {
      scheduleSync();
    }
  };

  const setManualPublish = (enabled) => {
    const nextValue = Boolean(enabled);
    if (state.manualPublish === nextValue) {
      return;
    }
    state.manualPublish = nextValue;
    if (state.active) {
      if (state.manualPublish) {
        state.publishedPayload = state.publishedPayload || buildPayload();
        state.hasUnpublishedChanges = false;
      } else {
        void flushSync({ forcePublish: true });
      }
    }
    notifyUi();
  };

  const publishNow = async () => {
    if (!state.active) {
      return;
    }
    await flushSync({ forcePublish: true });
  };

  return {
    state,
    stopShare,
    flushSync,
    scheduleSync,
    startShare,
    toggleShare,
    copyLink,
    setManualPublish,
    publishNow,
    getDraftSnapshot,
    restoreFromDraft
  };
};

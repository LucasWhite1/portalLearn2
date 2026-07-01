const crypto = require('crypto');

const LIVE_STAGE_SHARE_TTL_MS = 1000 * 60 * 60 * 4;
const LIVE_STAGE_CURSOR_TTL_MS = 1000 * 4;
const liveStageShares = new Map();

const createShareId = () => crypto.randomBytes(16).toString('hex');

const cleanupExpiredShares = () => {
  const now = Date.now();
  liveStageShares.forEach((share, shareId) => {
    if (!share || now - share.updatedAt > LIVE_STAGE_SHARE_TTL_MS) {
      liveStageShares.delete(shareId);
      return;
    }
    if (Array.isArray(share.cursorPositions)) {
      share.cursorPositions = share.cursorPositions.filter((cursor) => now - Number(cursor?.updatedAt || 0) <= LIVE_STAGE_CURSOR_TTL_MS);
    }
  });
};

const clonePayload = (payload = {}) => JSON.parse(JSON.stringify(payload));

const getShare = (shareId) => {
  cleanupExpiredShares();
  const share = liveStageShares.get(shareId);
  if (!share) {
    return null;
  }
  if (Date.now() - share.updatedAt > LIVE_STAGE_SHARE_TTL_MS) {
    liveStageShares.delete(shareId);
    return null;
  }
  return {
    ...share,
    payload: clonePayload(share.payload)
  };
};

const listShares = () => {
  cleanupExpiredShares();
  return Array.from(liveStageShares.values()).map((share) => ({
    ...share,
    payload: clonePayload(share.payload)
  }));
};

const createShare = ({ ownerUserId, ownerRole = null, payload }) => {
  cleanupExpiredShares();
  const shareId = createShareId();
  const now = Date.now();
  const entry = {
    shareId,
    ownerUserId,
    ownerRole,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    cameraRequests: [],
    rejectedCameraRequests: [],
    drawingStrokes: [],
    cursorPositions: [],
    payload: clonePayload(payload)
  };
  liveStageShares.set(shareId, entry);
  return getShare(shareId);
};

const updateShare = (shareId, ownerUserId, payload) => {
  cleanupExpiredShares();
  const current = liveStageShares.get(shareId);
  if (!current || current.ownerUserId !== ownerUserId) {
    return null;
  }
  const newPayloadStr = JSON.stringify(payload);
  const oldPayloadStr = JSON.stringify(current.payload);
  const revisionChanged = newPayloadStr !== oldPayloadStr;

  const next = {
    ...current,
    updatedAt: Date.now(),
    revision: revisionChanged ? current.revision + 1 : current.revision,
    payload: clonePayload(payload)
  };
  liveStageShares.set(shareId, next);
  return getShare(shareId);
};

const addCameraRequest = (shareId, request) => {
  cleanupExpiredShares();
  const current = liveStageShares.get(shareId);
  if (!current) return false;

  current.cameraRequests = current.cameraRequests.filter(r => r.peerId !== request.peerId && r.userId !== request.userId);
  current.rejectedCameraRequests = Array.isArray(current.rejectedCameraRequests)
    ? current.rejectedCameraRequests.filter((entry) => entry.peerId !== request.peerId && entry.userId !== request.userId)
    : [];
  current.cameraRequests.push({
    ...request,
    requestedAt: Date.now()
  });

  if (current.cameraRequests.length > 20) {
    current.cameraRequests.shift();
  }
  current.updatedAt = Date.now();
  current.revision += 1;
  return true;
};

const removeCameraRequest = (shareId, request = {}, { markRejected = false } = {}) => {
  cleanupExpiredShares();
  const current = liveStageShares.get(shareId);
  if (!current) return false;

  const userId = String(request?.userId || '').trim();
  const peerId = String(request?.peerId || '').trim();
  const fullName = String(request?.fullName || '').trim();
  if (!userId && !peerId) {
    return false;
  }

  const beforeCount = Array.isArray(current.cameraRequests) ? current.cameraRequests.length : 0;
  current.cameraRequests = Array.isArray(current.cameraRequests)
    ? current.cameraRequests.filter((entry) => {
        const sameUser = userId && String(entry?.userId || '').trim() === userId;
        const samePeer = peerId && String(entry?.peerId || '').trim() === peerId;
        return !(sameUser || samePeer);
      })
    : [];

  if (markRejected) {
    current.rejectedCameraRequests = Array.isArray(current.rejectedCameraRequests) ? current.rejectedCameraRequests : [];
    current.rejectedCameraRequests = current.rejectedCameraRequests.filter((entry) => {
      const sameUser = userId && String(entry?.userId || '').trim() === userId;
      const samePeer = peerId && String(entry?.peerId || '').trim() === peerId;
      return !(sameUser || samePeer);
    });
    current.rejectedCameraRequests.push({
      userId: userId || null,
      peerId: peerId || null,
      fullName: fullName || null,
      rejectedAt: Date.now()
    });
    if (current.rejectedCameraRequests.length > 50) {
      current.rejectedCameraRequests.shift();
    }
  }

  const changed = current.cameraRequests.length !== beforeCount || markRejected;
  if (changed) {
    current.updatedAt = Date.now();
    current.revision += 1;
  }
  return changed;
};

const getCameraRequestState = (shareId, request = {}) => {
  cleanupExpiredShares();
  const current = liveStageShares.get(shareId);
  if (!current) return null;

  const userId = String(request?.userId || '').trim();
  const peerId = String(request?.peerId || '').trim();
  const hasPending = Array.isArray(current.cameraRequests) && current.cameraRequests.some((entry) => {
    const sameUser = userId && String(entry?.userId || '').trim() === userId;
    const samePeer = peerId && String(entry?.peerId || '').trim() === peerId;
    return sameUser || samePeer;
  });
  if (hasPending) {
    return 'pending';
  }
  const hasRejected = Array.isArray(current.rejectedCameraRequests) && current.rejectedCameraRequests.some((entry) => {
    const sameUser = userId && String(entry?.userId || '').trim() === userId;
    const samePeer = peerId && String(entry?.peerId || '').trim() === peerId;
    return sameUser || samePeer;
  });
  return hasRejected ? 'rejected' : 'none';
};

const addDrawingStroke = (shareId, stroke) => {
  cleanupExpiredShares();
  const current = liveStageShares.get(shareId);
  if (!current) return false;

  current.drawingStrokes.push({
    ...stroke,
    timestamp: Date.now()
  });

  // Keep only the last 100 strokes to avoid bloat
  if (current.drawingStrokes.length > 100) {
    current.drawingStrokes.shift();
  }

  return true;
};

const updateCursorPosition = (shareId, cursor) => {
  cleanupExpiredShares();
  const current = liveStageShares.get(shareId);
  if (!current) return false;

  const now = Date.now();
  const userId = String(cursor?.userId || '').trim();
  const peerKey = String(cursor?.peerKey || '').trim();
  const role = String(cursor?.role || '').trim();
  const fullName = String(cursor?.fullName || '').trim();
  const x = Number(cursor?.x);
  const y = Number(cursor?.y);
  const active = cursor?.active !== false;

  current.cursorPositions = Array.isArray(current.cursorPositions) ? current.cursorPositions : [];
  current.cursorPositions = current.cursorPositions.filter((entry) => {
    const sameUser = userId && String(entry?.userId || '').trim() === userId;
    const samePeer = peerKey && String(entry?.peerKey || '').trim() === peerKey;
    return !(sameUser || samePeer) && now - Number(entry?.updatedAt || 0) <= LIVE_STAGE_CURSOR_TTL_MS;
  });

  if (!active) {
    return true;
  }

  current.cursorPositions.push({
    userId,
    peerKey,
    role,
    fullName,
    x: Number.isFinite(x) ? Math.min(Math.max(x, 0), 1) : 0,
    y: Number.isFinite(y) ? Math.min(Math.max(y, 0), 1) : 0,
    updatedAt: now
  });
  return true;
};

const listCursorPositions = (shareId) => {
  cleanupExpiredShares();
  const current = liveStageShares.get(shareId);
  if (!current) return null;
  return Array.isArray(current.cursorPositions) ? clonePayload(current.cursorPositions) : [];
};

const removeDrawingStroke = (shareId, strokeId) => {
  cleanupExpiredShares();
  const current = liveStageShares.get(shareId);
  if (!current) return false;
  const normalizedStrokeId = String(strokeId || '').trim();
  if (!normalizedStrokeId) {
    return false;
  }
  const beforeCount = current.drawingStrokes.length;
  current.drawingStrokes = current.drawingStrokes.filter((stroke) => String(stroke?.stroke?.id || stroke?.id || '').trim() !== normalizedStrokeId);
  return current.drawingStrokes.length !== beforeCount;
};

const clearDrawingStrokes = (shareId) => {
  cleanupExpiredShares();
  const current = liveStageShares.get(shareId);
  if (!current) return false;

  current.drawingStrokes = [];
  return true;
};

const clearDrawingStrokesByUser = (shareId, userId) => {
  cleanupExpiredShares();
  const current = liveStageShares.get(shareId);
  if (!current) return false;
  const normalizedUserId = String(userId || '').trim();
  current.drawingStrokes = current.drawingStrokes.filter(
    (stroke) => String(stroke?.userId || '').trim() !== normalizedUserId
  );
  return true;
};

const deleteShare = (shareId, ownerUserId) => {
  cleanupExpiredShares();
  const current = liveStageShares.get(shareId);
  if (!current || current.ownerUserId !== ownerUserId) {
    return false;
  }
  liveStageShares.delete(shareId);
  return true;
};

module.exports = {
  createShare,
  getShare,
  listShares,
  updateShare,
  addCameraRequest,
  removeCameraRequest,
  getCameraRequestState,
  addDrawingStroke,
  updateCursorPosition,
  listCursorPositions,
  removeDrawingStroke,
  clearDrawingStrokes,
  clearDrawingStrokesByUser,
  deleteShare
};

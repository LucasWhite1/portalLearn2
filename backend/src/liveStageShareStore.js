const crypto = require('crypto');

const LIVE_STAGE_SHARE_TTL_MS = 1000 * 60 * 60 * 4;
const liveStageShares = new Map();

const createShareId = () => crypto.randomBytes(16).toString('hex');

const cleanupExpiredShares = () => {
  const now = Date.now();
  liveStageShares.forEach((share, shareId) => {
    if (!share || now - share.updatedAt > LIVE_STAGE_SHARE_TTL_MS) {
      liveStageShares.delete(shareId);
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
    drawingStrokes: [],
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
  
  // Remove request from same peerId or same userId if already exists to avoid duplicates
  current.cameraRequests = current.cameraRequests.filter(r => r.peerId !== request.peerId && r.userId !== request.userId);
  current.cameraRequests.push({
    ...request,
    requestedAt: Date.now()
  });
  
  // Keep only the last 20 requests
  if (current.cameraRequests.length > 20) {
    current.cameraRequests.shift();
  }
  
  return true;
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
  addDrawingStroke,
  removeDrawingStroke,
  clearDrawingStrokes,
  deleteShare
};

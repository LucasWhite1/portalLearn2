const { randomBytes } = require('crypto');

const sessions = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 24; // 24h
const MAX_ACTIVE_SESSIONS = 50000;

function cleanupSessions() {
  const now = Date.now();
  for (const [token, data] of sessions.entries()) {
    if (now - Number(data?.createdAt || 0) > SESSION_TTL || sessions.size > MAX_ACTIVE_SESSIONS) {
      sessions.delete(token);
    }
  }
}

function createSession(user) {
  cleanupSessions();
  const token = randomBytes(24).toString('hex');
  sessions.set(token, { user, createdAt: Date.now() });
  return token;
}

function getSession(token) {
  const data = sessions.get(token);
  if (!data) return null;
  if (Date.now() - data.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  return data.user;
}

function invalidateSession(token) {
  sessions.delete(token);
}

function invalidateUserSessions(userId) {
  const normalizedUserId = String(userId || '');
  if (!normalizedUserId) return;
  for (const [token, data] of sessions.entries()) {
    if (String(data?.user?.id || '') === normalizedUserId) {
      sessions.delete(token);
    }
  }
}

module.exports = {
  createSession,
  getSession,
  invalidateSession,
  invalidateUserSessions
};

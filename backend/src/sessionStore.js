const { randomBytes } = require('crypto');

const sessions = new Map();
const SESSION_TTL = 1000 * 60 * 60; // 1h

function createSession(user) {
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

module.exports = {
  createSession,
  getSession,
  invalidateSession
};

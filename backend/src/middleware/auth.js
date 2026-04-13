const { getSession } = require('../sessionStore');
const { isSessionToken } = require('../security');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !isSessionToken(token)) {
    return res.status(401).json({ message: 'Sessão expirada ou não encontrada' });
  }
  const user = getSession(token);
  if (!user) {
    return res.status(401).json({ message: 'Sessão expirada ou não encontrada' });
  }
  req.user = user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ message: 'Permissão negada' });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireRole
};

const { getSession } = require('../sessionStore');
const { isSessionToken } = require('../security');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !isSessionToken(token)) {
    return res.status(401).json({ message: 'Sessao expirada ou nao encontrada' });
  }
  const user = getSession(token);
  if (!user) {
    return res.status(401).json({ message: 'Sessao expirada ou nao encontrada' });
  }
  req.user = user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    const allowedRoles = Array.isArray(role) ? role : [role];
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Permissao negada' });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireRole
};

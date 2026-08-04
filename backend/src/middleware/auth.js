const { getSession } = require('../sessionStore');
const { isSessionToken } = require('../security');
const db = require('../db');
const { ensurePlatformCreditTables } = require('../platformCredits');
const { ensureBillingAccessSchema, getBillingAccessState } = require('../billingAccess');

const isBillingRecoveryRequest = (req) => {
  const path = String(req.originalUrl || '').split('?')[0];
  return path === '/api/billing/subscription/status' || path === '/api/billing/renewal-checkout';
};

const enforceBillingAccess = (req, res, user) => {
  const access = getBillingAccessState(user);
  req.billingAccess = access;
  if (access.blocked && !isBillingRecoveryRequest(req)) {
    res.status(402).json({
      message: 'Sua assinatura venceu. Renove o plano para continuar usando o portal.',
      code: 'SUBSCRIPTION_EXPIRED',
      accessExpiresAt: access.expiration?.toISOString() || null
    });
    return false;
  }
  return true;
};

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, bearerToken] = authHeader.split(' ');
  const cookieHeader = String(req.headers.cookie || '');
  const cookieToken = cookieHeader
    .split(';')
    .map((entry) => entry.trim().split('='))
    .find(([name]) => name === 'criatyve_session')?.[1] || '';
  let decodedCookieToken = '';
  try {
    decodedCookieToken = decodeURIComponent(cookieToken);
  } catch (error) {
    decodedCookieToken = '';
  }
  const token = scheme === 'Bearer' && isSessionToken(bearerToken)
    ? bearerToken
    : decodedCookieToken;
  if (!isSessionToken(token)) {
    return res.status(401).json({ message: 'Sessao expirada ou nao encontrada' });
  }
  const isCookieAuthenticated = token === decodedCookieToken && token !== bearerToken;
  if (isCookieAuthenticated && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const requestOrigin = String(req.headers.origin || '');
    const allowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    try {
      const publicOrigin = new URL(String(process.env.PUBLIC_APP_URL || '')).origin;
      if (publicOrigin) allowedOrigins.push(publicOrigin);
    } catch (error) {
      // Local development can use same-site cookies without PUBLIC_APP_URL.
    }
    const isProduction = ['production', 'prod'].includes(String(process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase());
    if (requestOrigin && isProduction && !allowedOrigins.includes(requestOrigin)) {
      return res.status(403).json({ message: 'Origem da requisicao nao permitida.' });
    }
  }
  if (req.authenticatedSessionToken === token && req.user?.id) {
    return next();
  }
  const user = getSession(token);
  if (!user || !user.role) {
    return res.status(401).json({ message: 'Sessao expirada ou invalida. Por favor, faca login novamente.' });
  }
  if (Date.now() - Number(user.lastValidatedAt || 0) < 5000) {
    req.user = user;
    req.sessionToken = token;
    req.authenticatedSessionToken = token;
    if (!enforceBillingAccess(req, res, user)) return;
    return next();
  }
  try {
    await ensurePlatformCreditTables();
    await ensureBillingAccessSchema();
    const { rows } = await db.query(
      `SELECT id, role, full_name, email, class_name, owner_user_id, is_active,
              platform_credits, student_limit, storage_limit_bytes,
              billing_access_managed, subscription_access_expires_at,
              subscription_plan_code, subscription_billing_type,
              subscription_payment_status, subscription_last_event_type,
              subscription_payment_url
         FROM users
        WHERE id = $1`,
      [user.id]
    );
    const currentUser = rows[0];
    if (!currentUser || (currentUser.is_active === false && currentUser.role !== 'admin')) {
      return res.status(401).json({ message: 'Conta inativa ou sessao revogada.' });
    }
    if (currentUser.role === 'admin' && currentUser.is_active === false) {
      await db.query(
        `UPDATE users SET is_active = TRUE WHERE id = $1 AND role = 'admin'`,
        [currentUser.id]
      );
      currentUser.is_active = true;
    }
    Object.assign(user, {
      id: currentUser.id,
      role: currentUser.role,
      fullName: currentUser.full_name,
      email: currentUser.email,
      className: currentUser.class_name,
      ownerUserId: currentUser.owner_user_id || null,
      isActive: currentUser.is_active !== false,
      platformCredits: Number(currentUser.platform_credits || 0),
      studentLimit: Number.isFinite(Number(currentUser.student_limit)) ? Number(currentUser.student_limit) : null,
      storageLimitBytes: Number.isFinite(Number(currentUser.storage_limit_bytes)) ? Number(currentUser.storage_limit_bytes) : null,
      billing_access_managed: currentUser.billing_access_managed === true,
      subscription_access_expires_at: currentUser.subscription_access_expires_at || null,
      subscription_plan_code: currentUser.subscription_plan_code || null,
      subscription_billing_type: currentUser.subscription_billing_type || null,
      subscription_payment_status: currentUser.subscription_payment_status || null,
      subscription_last_event_type: currentUser.subscription_last_event_type || null,
      subscription_payment_url: currentUser.subscription_payment_url || null
    });
    user.lastValidatedAt = Date.now();
    req.user = user;
    req.sessionToken = token;
    req.authenticatedSessionToken = token;
    if (!enforceBillingAccess(req, res, user)) return;
    return next();
  } catch (error) {
    return next(error);
  }
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

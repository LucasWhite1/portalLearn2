const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_TOKEN_REGEX = /^[0-9a-f]{48}$/i;
const SAFE_COLOR_REGEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z0-9:_-]{1,120}$/;
const DEFAULT_TEXT_MAX = 2000;
const DEFAULT_URL_MAX = 2048;
const DEFAULT_DATA_URL_MAX = 45 * 1024 * 1024;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 250;
const MAX_OBJECT_KEYS = 200;

function stripControlChars(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function sanitizeText(value, maxLength = DEFAULT_TEXT_MAX, { trim = true } = {}) {
  const normalized = stripControlChars(value);
  const nextValue = trim ? normalized.trim() : normalized;
  return nextValue.slice(0, maxLength);
}

function sanitizeEmail(value) {
  return sanitizeText(value, 320).toLowerCase();
}

function sanitizePhone(value) {
  const normalized = sanitizeText(value, 40);
  const digits = normalized.replace(/[^0-9+()\-\s]/g, '');
  return digits || '';
}

function sanitizeSlug(value) {
  return sanitizeText(value, 160)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function isUuid(value) {
  return UUID_REGEX.test(String(value || ''));
}

function isSessionToken(value) {
  return SESSION_TOKEN_REGEX.test(String(value || ''));
}

function sanitizeIdentifier(value, fallback = '') {
  const normalized = sanitizeText(value, 120);
  return SAFE_IDENTIFIER_REGEX.test(normalized) ? normalized : fallback;
}

function sanitizeColor(value, fallback = '') {
  const normalized = sanitizeText(value, 16);
  return SAFE_COLOR_REGEX.test(normalized) ? normalized : fallback;
}

function sanitizeMediaUrl(value, { allowData = true } = {}) {
  const rawValue = stripControlChars(value);
  const normalized = rawValue.trim();
  if (!normalized) {
    return '';
  }
  if (allowData && normalized.startsWith('data:')) {
    if (normalized.length > DEFAULT_DATA_URL_MAX) {
      return '';
    }
    return /^data:(image|audio|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(normalized) ? normalized : '';
  }
  const limitedUrl = normalized.slice(0, DEFAULT_URL_MAX);
  try {
    const parsed = new URL(limitedUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString().slice(0, DEFAULT_URL_MAX);
  } catch (error) {
    return '';
  }
}

function sanitizePlainContent(value) {
  return sanitizeText(value, 8000, { trim: false });
}

function sanitizeBuilderData(builderData) {
  const sanitizeValue = (value, key = '', depth = 0) => {
    if (depth > MAX_DEPTH) {
      return null;
    }
    if (value == null) {
      return value;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      if (/^(src|url|embedSrc|backgroundImage|backgroundVideo)$/i.test(key)) {
        return sanitizeMediaUrl(value);
      }
      if (/color/i.test(key)) {
        return sanitizeColor(value, '');
      }
      if (/^(id|slideId|elementId|targetSlideId|targetElementId|runtimeSourceId|runtimeActionType|ruleGroup|provider|type|backgroundFillType|shape|animationType|textAlign|fontFamily|fontWeight|objectFit|detectorAcceptedDrag|videoTriggerAction)$/.test(key)) {
        return sanitizeText(value, 160);
      }
      if (/^(content|question|successMessage|errorMessage|actionLabel|label|title|description|backgroundImagePrompt|generationPrompt|text|replaceText)$/i.test(key)) {
        return sanitizePlainContent(value);
      }
      return sanitizeText(value, 512);
    }
    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY_ITEMS).map((entry) => sanitizeValue(entry, key, depth + 1)).filter((entry) => entry !== undefined);
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
      const sanitized = {};
      entries.forEach(([entryKey, entryValue]) => {
        sanitized[entryKey] = sanitizeValue(entryValue, entryKey, depth + 1);
      });
      return sanitized;
    }
    return null;
  };

  const sanitized = sanitizeValue(builderData, 'builderData', 0);
  return sanitized && typeof sanitized === 'object' ? sanitized : {};
}

function sanitizeNotificationMessage(value) {
  return sanitizeText(value, 1200, { trim: true });
}

function createRateLimiter({ windowMs, max, keyFn }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn(req);
    const bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ message: 'Muitas tentativas. Aguarde um pouco e tente novamente.' });
    }
    bucket.count += 1;
    next();
  };
}

module.exports = {
  sanitizeText,
  sanitizeEmail,
  sanitizePhone,
  sanitizeSlug,
  sanitizePlainContent,
  sanitizeMediaUrl,
  sanitizeBuilderData,
  sanitizeNotificationMessage,
  sanitizeIdentifier,
  sanitizeColor,
  createRateLimiter,
  isUuid,
  isSessionToken
};

const dns = require('node:dns').promises;
const net = require('node:net');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_TOKEN_REGEX = /^[0-9a-f]{48}$/i;
const SAFE_COLOR_REGEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z0-9:_-]{1,120}$/;
const DEFAULT_TEXT_MAX = 2000;
const DEFAULT_URL_MAX = 2048;
const DEFAULT_DATA_URL_MAX = 45 * 1024 * 1024;
const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 250;
const MAX_PEN_POINT_ITEMS = 6000;
const MAX_OBJECT_KEYS = 200;
const MAX_RATE_LIMIT_BUCKETS = 10000;
const REMOTE_FETCH_TIMEOUT_MS = 20000;
const REMOTE_FETCH_MAX_REDIRECTS = 3;

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
    if (/^data:(image|audio|video)\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[a-z0-9.+-]+)*;base64,[a-z0-9+/=\s]+$/i.test(normalized)) {
      return normalized;
    }
    if (/^data:image\/svg\+xml(?:;[a-z0-9.+-]+=[a-z0-9.+-]+)*(?:;utf8)?,[\w!$&'()*+,;=:@\/?%\-.~\s#]+$/i.test(normalized)) {
      return normalized;
    }
    return '';
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
  const isPenPointEntry = (entry) =>
    entry === null ||
    (typeof entry === 'object' &&
      entry !== null &&
      Number.isFinite(Number(entry.x)) &&
      Number.isFinite(Number(entry.y)));

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
      if (/^(src|url|embedSrc|backgroundImage|backgroundVideo|backgroundVideoEmbedSrc|textureImage|coverImage|thumbnail|compareImageReference|compareImageReferenceUrl)$/i.test(key)) {
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
      const maxItems =
        key === 'points' && value.every((entry) => isPenPointEntry(entry))
          ? MAX_PEN_POINT_ITEMS
          : MAX_ARRAY_ITEMS;
      return value.slice(0, maxItems).map((entry) => sanitizeValue(entry, key, depth + 1)).filter((entry) => entry !== undefined);
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

function getPasswordValidationError(value) {
  const password = String(value || '');
  if (password.length < 12) {
    return 'A senha precisa ter pelo menos 12 caracteres.';
  }
  if (password.length > 256) {
    return 'A senha excede o tamanho permitido.';
  }
  const normalized = password.toLowerCase();
  if (['123456789012', 'password1234', 'senha12345678', 'qwertyuiop12'].includes(normalized)) {
    return 'Escolha uma senha menos previsivel.';
  }
  return '';
}

function ipv4ToNumber(address) {
  return address
    .split('.')
    .map(Number)
    .reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
}

function isBlockedIpv4(address) {
  const value = ipv4ToNumber(address);
  const inRange = (base, bits) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToNumber(base) & mask);
  };
  return [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
  ].some(([base, bits]) => inRange(base, bits));
}

function mappedIpv6ToIpv4(address) {
  const normalized = String(address || '').toLowerCase();
  const dottedMatch = normalized.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedMatch && net.isIP(dottedMatch[1]) === 4) {
    return dottedMatch[1];
  }
  const mappedMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mappedMatch) {
    return '';
  }
  const high = Number.parseInt(mappedMatch[1], 16);
  const low = Number.parseInt(mappedMatch[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPrivateIpAddress(address) {
  const normalized = String(address || '').trim().toLowerCase().split('%')[0];
  const version = net.isIP(normalized);
  if (version === 4) {
    return isBlockedIpv4(normalized);
  }
  if (version !== 6) {
    return true;
  }
  const mappedIpv4 = mappedIpv6ToIpv4(normalized);
  if (mappedIpv4) {
    return isBlockedIpv4(mappedIpv4);
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    /^f[cd]/.test(normalized) ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:') ||
    normalized === '2001:db8::' ||
    normalized.startsWith('2002:')
  );
}

function isPrivateHostname(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  return (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.home')
  );
}

async function assertSafeRemoteUrl(value, options = {}) {
  const allowHttp = options.allowHttp === true;
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch (error) {
    throw new Error('URL remota invalida.');
  }
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error('A URL remota precisa usar HTTPS.');
  }
  if (parsed.username || parsed.password || isPrivateHostname(parsed.hostname)) {
    throw new Error('O destino remoto informado nao e permitido.');
  }
  const literalIpVersion = net.isIP(parsed.hostname);
  const addresses = literalIpVersion
    ? [{ address: parsed.hostname }]
    : await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIpAddress(entry.address))) {
    throw new Error('O destino remoto informado nao e permitido.');
  }
  return parsed;
}

async function safeFetch(value, init = {}, options = {}) {
  const allowHttp = options.allowHttp === true;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1000, Number(options.timeoutMs))
    : REMOTE_FETCH_TIMEOUT_MS;
  const maxRedirects = Number.isFinite(Number(options.maxRedirects))
    ? Math.max(0, Number(options.maxRedirects))
    : REMOTE_FETCH_MAX_REDIRECTS;
  const allowCrossOriginRedirects = options.allowCrossOriginRedirects === true;
  let requestUrl = await assertSafeRemoteUrl(value, { allowHttp });
  let requestInit = { ...init };

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const timeoutSignal = typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    const signal = requestInit.signal && timeoutSignal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([requestInit.signal, timeoutSignal])
      : requestInit.signal || timeoutSignal;
    const response = await fetch(requestUrl, {
      ...requestInit,
      redirect: 'manual',
      signal
    });
    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
    if (!isRedirect) {
      return response;
    }
    if (redirectCount >= maxRedirects) {
      await response.body?.cancel().catch(() => {});
      throw new Error('A URL remota excedeu o limite de redirecionamentos.');
    }
    const location = response.headers.get('location');
    if (!location) {
      return response;
    }
    await response.body?.cancel().catch(() => {});
    const nextUrl = await assertSafeRemoteUrl(new URL(location, requestUrl).toString(), { allowHttp });
    if (!allowCrossOriginRedirects && nextUrl.origin !== requestUrl.origin) {
      throw new Error('Redirecionamento para outro dominio nao permitido.');
    }
    requestUrl = nextUrl;
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && String(requestInit.method || 'GET').toUpperCase() === 'POST')) {
      const { body, ...withoutBody } = requestInit;
      requestInit = { ...withoutBody, method: 'GET' };
    }
  }
  throw new Error('Nao foi possivel acessar a URL remota.');
}

async function readResponseBuffer(response, maxBytes) {
  const limit = Math.max(1, Number(maxBytes) || 1);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > limit) {
    throw new Error('O arquivo remoto excede o tamanho permitido.');
  }
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limit) {
      throw new Error('O arquivo remoto excede o tamanho permitido.');
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new Error('O arquivo remoto excede o tamanho permitido.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function createRateLimiter({ windowMs, max, keyFn }) {
  const buckets = new Map();
  let requestCount = 0;
  return (req, res, next) => {
    const now = Date.now();
    requestCount += 1;
    if (requestCount % 250 === 0 || buckets.size > MAX_RATE_LIMIT_BUCKETS) {
      for (const [bucketKey, value] of buckets.entries()) {
        if (now > value.resetAt || buckets.size > MAX_RATE_LIMIT_BUCKETS) {
          buckets.delete(bucketKey);
        }
        if (buckets.size <= MAX_RATE_LIMIT_BUCKETS) break;
      }
    }
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
  getPasswordValidationError,
  sanitizeIdentifier,
  sanitizeColor,
  createRateLimiter,
  isUuid,
  isSessionToken,
  isPrivateIpAddress,
  assertSafeRemoteUrl,
  safeFetch,
  readResponseBuffer
};

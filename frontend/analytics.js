(function initializeCriatyveAnalytics(window, document) {
  'use strict';

  const CONSENT_KEY = 'criatyve-analytics-consent';
  const VISITOR_KEY = 'criatyve-analytics-visitor';
  const SESSION_KEY = 'criatyve-analytics-session';
  const QUEUE_KEY = 'criatyve-analytics-queue';
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const FLUSH_INTERVAL_MS = 5000;
  const MAX_QUEUE_SIZE = 100;
  const SCROLL_THRESHOLDS = [25, 50, 75, 90, 100];
  const SENSITIVE_TEXT = /\b(senha|password|cpf|cnpj|cart[aã]o|card|cvv|email|telefone|phone)\b/i;
  let started = false;
  let flushTimer = null;
  let pageStartedAt = Date.now();
  let maxScrollDepth = 0;
  let formStarted = new Set();
  const sentScrollDepths = new Set();

  const uuid = () => {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const random = Math.random() * 16 | 0;
      return (character === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
    });
  };

  const resolveApiOrigin = () => {
    const override = window.localStorage.getItem('criatyveApiOrigin');
    if (override) return override.replace(/\/+$/, '');
    const { protocol, hostname, port } = window.location;
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && port && port !== '4000') {
      return `${protocol}//${hostname}:4000`;
    }
    return window.location.origin.replace(/\/+$/, '');
  };

  const safeStorageGet = (storage, key) => {
    try {
      return storage.getItem(key);
    } catch (error) {
      return null;
    }
  };

  const safeStorageSet = (storage, key, value) => {
    try {
      storage.setItem(key, value);
    } catch (error) {
      // Analytics must never interrupt the page experience.
    }
  };

  const getVisitorId = () => {
    const current = safeStorageGet(window.localStorage, VISITOR_KEY);
    if (/^[0-9a-f-]{36}$/i.test(current || '')) return current;
    const next = uuid();
    safeStorageSet(window.localStorage, VISITOR_KEY, next);
    return next;
  };

  const getSession = () => {
    let current = null;
    try {
      current = JSON.parse(safeStorageGet(window.sessionStorage, SESSION_KEY) || 'null');
    } catch (error) {
      current = null;
    }
    const now = Date.now();
    if (!current?.id || now - Number(current.lastActiveAt || 0) > SESSION_TIMEOUT_MS) {
      const params = new URLSearchParams(window.location.search);
      current = {
        id: uuid(),
        startedAt: new Date(now).toISOString(),
        lastActiveAt: now,
        landingPath: getPagePath(),
        referrer: document.referrer || '',
        utmSource: params.get('utm_source') || '',
        utmMedium: params.get('utm_medium') || '',
        utmCampaign: params.get('utm_campaign') || '',
        utmContent: params.get('utm_content') || '',
        utmTerm: params.get('utm_term') || '',
        clickIdKind: params.has('fbclid') ? 'fbclid' : params.has('gclid') ? 'gclid' : params.has('ttclid') ? 'ttclid' : ''
      };
    }
    current.lastActiveAt = now;
    safeStorageSet(window.sessionStorage, SESSION_KEY, JSON.stringify(current));
    return current;
  };

  const getPagePath = () => {
    const params = new URLSearchParams();
    const source = new URLSearchParams(window.location.search);
    ['plan', 'demoTemplates', 'publicModuleId'].forEach((key) => {
      const value = source.get(key);
      if (value) params.set(key, value.slice(0, 160));
    });
    const query = params.toString();
    return `${window.location.pathname || '/'}${query ? `?${query}` : ''}`;
  };

  const readQueue = () => {
    try {
      const value = JSON.parse(safeStorageGet(window.sessionStorage, QUEUE_KEY) || '[]');
      return Array.isArray(value) ? value.slice(-MAX_QUEUE_SIZE) : [];
    } catch (error) {
      return [];
    }
  };

  const writeQueue = (queue) => safeStorageSet(
    window.sessionStorage,
    QUEUE_KEY,
    JSON.stringify(queue.slice(-MAX_QUEUE_SIZE))
  );

  const cleanText = (value, max = 140) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    return SENSITIVE_TEXT.test(text) ? '' : text;
  };

  const getTarget = (element) => {
    const interactive = element?.closest?.('a, button, [role="button"], input[type="submit"], input[type="button"]');
    if (!interactive) return null;
    return {
      tag: interactive.tagName.toLowerCase(),
      id: cleanText(interactive.id, 100),
      text: cleanText(interactive.getAttribute('aria-label') || interactive.textContent || interactive.value),
      href: interactive.href || ''
    };
  };

  const normalizeCustomName = (name) => {
    const normalized = String(name || '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    if (/purchase|paymentconfirmed|assinaturaativa/.test(normalized)) return 'purchase';
    if (/initiatecheckout|checkoutformsubmit|checkoutclick/.test(normalized)) return 'checkout_start';
    if (/lead|completeRegistration/i.test(normalized)) return 'lead';
    if (/contact|whatsapp/.test(normalized)) return 'contact';
    if (/videoimpression/.test(normalized)) return 'video_impression';
    if (/videostart/.test(normalized)) return 'video_start';
    if (/videoresume/.test(normalized)) return 'video_resume';
    if (/videopause/.test(normalized)) return 'video_pause';
    if (/videoseek/.test(normalized)) return 'video_seek';
    if (/videoprogress/.test(normalized)) return 'video_progress';
    if (/videocomplete/.test(normalized)) return 'video_complete';
    if (/videoexit/.test(normalized)) return 'video_exit';
    if (/videospeedchange/.test(normalized)) return 'video_speed_change';
    if (/videovolumechange/.test(normalized)) return 'video_volume_change';
    if (/videofullscreen/.test(normalized)) return 'video_fullscreen';
    if (/video|demo|slide|quiz|interaction/.test(normalized)) return 'demo_interaction';
    return 'custom';
  };

  const queueEvent = (name, details = {}) => {
    if (!started) return false;
    const session = getSession();
    const queue = readQueue();
    queue.push({
      id: uuid(),
      name,
      occurredAt: new Date().toISOString(),
      pagePath: getPagePath(),
      pageTitle: document.title.slice(0, 200),
      durationMs: Number.isFinite(details.durationMs) ? Math.max(0, Math.round(details.durationMs)) : undefined,
      scrollDepth: Number.isFinite(details.scrollDepth) ? Math.max(0, Math.min(100, Math.round(details.scrollDepth))) : undefined,
      target: details.target || undefined,
      metadata: details.metadata || undefined
    });
    session.lastActiveAt = Date.now();
    safeStorageSet(window.sessionStorage, SESSION_KEY, JSON.stringify(session));
    writeQueue(queue);
    if (queue.length >= 10 || ['purchase', 'checkout_start', 'form_submit'].includes(name)) flush();
    return true;
  };

  const getSessionPayload = () => {
    const session = getSession();
    return {
      visitorId: getVisitorId(),
      sessionId: session.id,
      session: {
        ...session,
        pagePath: getPagePath(),
        language: navigator.language || '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        screenWidth: window.screen?.width || 0,
        screenHeight: window.screen?.height || 0,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }
    };
  };

  const flush = async (useBeacon = false) => {
    const queue = readQueue();
    if (!queue.length || !started) return;
    const payload = { ...getSessionPayload(), events: queue.slice(0, 50) };
    const body = JSON.stringify(payload);
    writeQueue(queue.slice(50));
    try {
      if (useBeacon && navigator.sendBeacon) {
        const accepted = navigator.sendBeacon(
          `${resolveApiOrigin()}/api/analytics/collect`,
          new Blob([body], { type: 'application/json' })
        );
        if (!accepted) writeQueue([...payload.events, ...readQueue()]);
        return;
      }
      const response = await fetch(`${resolveApiOrigin()}/api/analytics/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'omit'
      });
      if (!response.ok) throw new Error(`Analytics HTTP ${response.status}`);
    } catch (error) {
      writeQueue([...payload.events, ...readQueue()]);
    }
  };

  const calculateScrollDepth = () => {
    const viewportBottom = window.scrollY + window.innerHeight;
    const documentHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    if (documentHeight <= window.innerHeight) return 100;
    return Math.max(0, Math.min(100, Math.round((viewportBottom / documentHeight) * 100)));
  };

  const handleScroll = () => {
    maxScrollDepth = Math.max(maxScrollDepth, calculateScrollDepth());
    SCROLL_THRESHOLDS.forEach((threshold) => {
      if (maxScrollDepth >= threshold && !sentScrollDepths.has(threshold)) {
        sentScrollDepths.add(threshold);
        queueEvent('scroll_depth', { scrollDepth: threshold });
      }
    });
  };

  const attachListeners = () => {
    document.addEventListener('click', (event) => {
      const target = getTarget(event.target);
      if (target) queueEvent('click', { target });
    }, { capture: true, passive: true });
    document.addEventListener('focusin', (event) => {
      const form = event.target?.closest?.('form');
      if (!form) return;
      const formKey = form.id || form.getAttribute('name') || 'form';
      if (formStarted.has(formKey)) return;
      formStarted.add(formKey);
      queueEvent('form_start', { metadata: { form_id: cleanText(formKey, 100) } });
    }, { capture: true });
    document.addEventListener('submit', (event) => {
      const form = event.target;
      queueEvent('form_submit', { metadata: { form_id: cleanText(form?.id || form?.getAttribute?.('name') || 'form', 100) } });
    }, { capture: true });
    document.addEventListener('play', (event) => {
      if (event.target?.tagName === 'VIDEO' && !event.target.closest?.('[data-analytics-video]')) {
        queueEvent('video_play', { metadata: { video_id: cleanText(event.target.id || event.target.currentSrc, 120) } });
      }
    }, { capture: true });
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('pagehide', () => {
      queueEvent('page_exit', {
        durationMs: Date.now() - pageStartedAt,
        scrollDepth: Math.max(maxScrollDepth, calculateScrollDepth())
      });
      flush(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        queueEvent('heartbeat', { durationMs: Date.now() - pageStartedAt, scrollDepth: maxScrollDepth });
        flush(true);
      }
    });
  };

  const start = () => {
    if (started) return;
    started = true;
    document.documentElement.dataset.criatyveFirstPartyAnalytics = 'ready';
    pageStartedAt = Date.now();
    getVisitorId();
    getSession();
    queueEvent('page_view');
    handleScroll();
    attachListeners();
    flushTimer = window.setInterval(() => {
      queueEvent('heartbeat', { durationMs: Date.now() - pageStartedAt, scrollDepth: maxScrollDepth });
      flush();
    }, 15000);
    window.setTimeout(flush, 350);
  };

  const setConsent = (value) => {
    safeStorageSet(window.localStorage, CONSENT_KEY, value);
    document.getElementById('criatyveAnalyticsConsent')?.remove();
    window.dispatchEvent(new CustomEvent('criatyve-analytics-consent', { detail: { value } }));
    if (value === 'granted') start();
  };

  const showConsent = () => {
    if (document.getElementById('criatyveAnalyticsConsent')) return;
    const banner = document.createElement('div');
    banner.id = 'criatyveAnalyticsConsent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Preferências de privacidade');
    banner.innerHTML = `
      <div class="criatyve-consent-copy">
        <strong>Privacidade e experiência</strong>
        <span>Usamos dados anônimos de navegação para entender o que funciona e melhorar o site. Não registramos o conteúdo digitado nos campos.</span>
      </div>
      <div class="criatyve-consent-actions">
        <button type="button" data-consent="denied">Não permitir</button>
        <button type="button" data-consent="granted">Permitir análise</button>
      </div>
    `;
    const style = document.createElement('style');
    style.textContent = `
      #criatyveAnalyticsConsent{position:fixed;z-index:2147483646;left:16px;right:16px;bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:18px;max-width:980px;margin:auto;padding:14px 16px;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:#171522;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.35);font:500 13px/1.45 Inter,system-ui,sans-serif}
      #criatyveAnalyticsConsent .criatyve-consent-copy{display:grid;gap:2px;max-width:650px}#criatyveAnalyticsConsent strong{font-size:14px}#criatyveAnalyticsConsent span{color:#d5d0e2}
      #criatyveAnalyticsConsent .criatyve-consent-actions{display:flex;gap:8px;flex:0 0 auto}#criatyveAnalyticsConsent button{min-height:38px;padding:0 14px;border:1px solid #716a82;border-radius:6px;background:transparent;color:#fff;font:700 12px Inter,system-ui,sans-serif;cursor:pointer}#criatyveAnalyticsConsent button[data-consent="granted"]{border-color:#8157ee;background:#8157ee}
      @media(max-width:680px){#criatyveAnalyticsConsent{align-items:stretch;flex-direction:column}#criatyveAnalyticsConsent .criatyve-consent-actions{display:grid;grid-template-columns:1fr 1fr}#criatyveAnalyticsConsent button{width:100%}}
    `;
    document.head.appendChild(style);
    document.body.appendChild(banner);
    banner.addEventListener('click', (event) => {
      const button = event.target.closest('[data-consent]');
      if (button) setConsent(button.dataset.consent);
    });
  };

  window.CriatyveAnalytics = Object.freeze({
    track(name, metadata = {}) {
      return queueEvent(normalizeCustomName(name), {
        metadata: { original_event: String(name || '').slice(0, 80), ...metadata }
      });
    },
    trackVideo(name, metadata = {}) {
      const eventName = normalizeCustomName(name);
      return queueEvent(eventName.startsWith('video_') ? eventName : 'video_progress', { metadata });
    },
    flush,
    getContext() {
      if (!started) return null;
      const session = getSession();
      return { visitorId: getVisitorId(), sessionId: session.id };
    },
    get consent() {
      return safeStorageGet(window.localStorage, CONSENT_KEY) || 'pending';
    }
  });

  const isLocalTestEnvironment = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  if (isLocalTestEnvironment) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
    return;
  }
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  const consent = safeStorageGet(window.localStorage, CONSENT_KEY);
  if (consent === 'granted') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  } else if (consent !== 'denied') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showConsent, { once: true });
    else showConsent();
  }
})(window, document);

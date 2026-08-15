(function initializeCriatyveMetaPixel(window, document) {
  'use strict';

  const PIXEL_ID = '1067171249057361';
  const sentOnceKeys = new Set();
  document.documentElement.dataset.criatyveAnalytics = 'ready';

  const sanitizeEventData = (data) => Object.fromEntries(
    Object.entries(data || {}).filter(([, value]) => (
      value !== undefined && value !== null && value !== ''
    ))
  );

  const getCampaignData = () => {
    const params = new URLSearchParams(window.location.search);
    return sanitizeEventData({
      page_path: window.location.pathname,
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_content: params.get('utm_content')
    });
  };

  if (!window.fbq) {
    const fbq = function fbq() {
      if (fbq.callMethod) {
        fbq.callMethod.apply(fbq, arguments);
      } else {
        fbq.queue.push(arguments);
      }
    };
    window.fbq = fbq;
    if (!window._fbq) window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(script, firstScript);
  }

  if (!window.__criatyveMetaPixelInitialized) {
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
    window.__criatyveMetaPixelInitialized = true;
  }

  const track = (eventName, data = {}, options = {}) => {
    const safeName = String(eventName || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 50);
    if (!safeName) return false;
    const onceKey = options.onceKey ? String(options.onceKey) : '';
    if (onceKey && sentOnceKeys.has(onceKey)) return false;
    if (onceKey) sentOnceKeys.add(onceKey);
    window.fbq('track', safeName, sanitizeEventData({ ...getCampaignData(), ...data }));
    return true;
  };

  const trackCustom = (eventName, data = {}, options = {}) => {
    const safeName = String(eventName || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 50);
    if (!safeName) return false;
    const onceKey = options.onceKey ? String(options.onceKey) : '';
    if (onceKey && sentOnceKeys.has(onceKey)) return false;
    if (onceKey) sentOnceKeys.add(onceKey);
    window.fbq('trackCustom', safeName, sanitizeEventData({ ...getCampaignData(), ...data }));
    return true;
  };

  window.CriatyveMeta = Object.freeze({
    pixelId: PIXEL_ID,
    track,
    trackCustom
  });
})(window, document);

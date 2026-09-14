const crypto = require('crypto');

const normalizeText = (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength);

const sha256 = (value) => crypto
  .createHash('sha256')
  .update(String(value || ''), 'utf8')
  .digest('hex');

const normalizePhone = (value) => {
  const digits = normalizeText(value, 40).replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
};

const normalizeAttribution = (source = {}) => {
  const fbclid = normalizeText(source.fbclid, 500);
  const startedAt = source.sessionStartedAt ? new Date(source.sessionStartedAt).getTime() : Date.now();
  const timestamp = Number.isFinite(startedAt) ? Math.floor(startedAt) : Date.now();
  return {
    fbp: normalizeText(source.fbp, 500),
    fbc: normalizeText(source.fbc, 500) || (fbclid ? `fb.1.${timestamp}.${fbclid}` : ''),
    clientIpAddress: normalizeText(source.clientIpAddress, 120),
    clientUserAgent: normalizeText(source.clientUserAgent, 1000),
    externalId: normalizeText(source.externalId || source.visitorId, 160),
    pageUrl: normalizeText(source.pageUrl, 450)
  };
};

const buildUserData = ({ customer = {}, payment = {}, subscription = {}, attribution = {} } = {}) => {
  const email = normalizeText(customer.email || payment.customerEmail || subscription.payer_email, 254).toLowerCase();
  const phone = normalizePhone(customer.mobilePhone || customer.phone || payment.mobilePhone || payment.phone || subscription.checkout_phone);
  const fullName = normalizeText(customer.name || payment.customerName || subscription.payer_name, 160).toLowerCase();
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const source = normalizeAttribution(attribution);
  const userData = {};
  if (email) userData.em = [sha256(email)];
  if (phone) userData.ph = [sha256(phone)];
  if (nameParts[0]) userData.fn = [sha256(nameParts[0])];
  if (nameParts.length > 1) userData.ln = [sha256(nameParts[nameParts.length - 1])];
  userData.country = [sha256('br')];
  if (source.externalId) userData.external_id = [sha256(source.externalId.toLowerCase())];
  if (source.fbp) userData.fbp = source.fbp;
  if (source.fbc) userData.fbc = source.fbc;
  if (source.clientIpAddress) userData.client_ip_address = source.clientIpAddress;
  if (source.clientUserAgent) userData.client_user_agent = source.clientUserAgent;
  return { userData, source };
};

const toEventTimestamp = (value) => {
  const parsed = value ? new Date(value) : null;
  const milliseconds = parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : Date.now();
  return Math.floor(milliseconds / 1000);
};

const getMetaConversionsConfig = () => {
  const pixelId = normalizeText(process.env.META_PIXEL_ID, 32).replace(/\D/g, '');
  const accessToken = normalizeText(
    process.env.META_CONVERSIONS_API_ACCESS_TOKEN || process.env.META_CAPI_ACCESS_TOKEN,
    500
  );
  const graphVersion = normalizeText(process.env.META_GRAPH_API_VERSION || 'v24.0', 20);
  const testEventCode = normalizeText(process.env.META_CAPI_TEST_EVENT_CODE, 120);

  return {
    configured: Boolean(pixelId && accessToken && /^v\d+\.\d+$/.test(graphVersion)),
    pixelId,
    accessToken,
    graphVersion,
    testEventCode
  };
};

const buildPurchaseEvent = ({ payment = {}, subscription = {}, customer = {}, attribution: directAttribution = {}, eventSourceUrl = '' } = {}) => {
  const paymentId = normalizeText(payment.id || subscription.provider_payment_id, 100);
  if (!paymentId) {
    throw new Error('Pagamento sem identificador para o evento Purchase da Meta.');
  }

  const attribution = subscription.attribution_data || subscription.attribution || directAttribution || {};
  const { userData, source } = buildUserData({ customer, payment, subscription, attribution });

  const planCode = normalizeText(subscription.plan_code || payment.externalReference || 'pro', 120);
  const planName = normalizeText(subscription.plan_label || planCode || 'Criatyve', 200);
  const amount = Number(payment.value ?? subscription.amount ?? 0);
  const safeAmount = Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;

  return {
    event_name: 'Purchase',
    event_time: toEventTimestamp(payment.confirmedDate || payment.paymentDate || payment.clientPaymentDate),
    event_id: `asaas-purchase-${paymentId}`,
    action_source: 'website',
    event_source_url: source.pageUrl || `${normalizeText(eventSourceUrl, 450).replace(/\/+$/, '') || 'https://criatyve.com'}/checkout.html`,
    user_data: userData,
    custom_data: {
      currency: 'BRL',
      value: safeAmount,
      order_id: paymentId,
      content_type: 'product',
      content_name: planName,
      content_ids: [planCode],
      contents: [{ id: planCode, quantity: 1, item_price: safeAmount }],
      num_items: 1,
      utm_source: normalizeText(attribution.utmSource, 120) || undefined,
      utm_medium: normalizeText(attribution.utmMedium, 120) || undefined,
      utm_campaign: normalizeText(attribution.utmCampaign, 180) || undefined,
      utm_content: normalizeText(attribution.utmContent, 180) || undefined
    }
  };
};

const buildCheckoutEvent = ({
  eventId,
  eventTime,
  customer = {},
  attribution = {},
  plan = {},
  eventSourceUrl = '',
  leadStatus = ''
} = {}) => {
  const safeEventId = normalizeText(eventId, 100);
  if (!safeEventId) throw new Error('Checkout sem event_id para deduplicacao na Meta.');
  const { userData, source } = buildUserData({ customer, attribution });
  const value = Number(plan.value || 0);
  return {
    event_name: 'CheckoutFormSubmit',
    event_time: toEventTimestamp(eventTime),
    event_id: safeEventId,
    action_source: 'website',
    event_source_url: source.pageUrl || `${normalizeText(eventSourceUrl, 450).replace(/\/+$/, '') || 'https://criatyve.com'}/checkout.html`,
    user_data: userData,
    custom_data: {
      currency: 'BRL',
      value: Number.isFinite(value) ? Math.round(value * 100) / 100 : 0,
      content_type: 'product',
      content_name: normalizeText(plan.name || 'Criatyve', 200),
      content_ids: [normalizeText(plan.id || 'pro', 120)],
      billing_type: normalizeText(plan.billingType, 30),
      lead_status: normalizeText(leadStatus, 30) || undefined,
      utm_source: normalizeText(attribution.utmSource, 120) || undefined,
      utm_medium: normalizeText(attribution.utmMedium, 120) || undefined,
      utm_campaign: normalizeText(attribution.utmCampaign, 180) || undefined,
      utm_content: normalizeText(attribution.utmContent, 180) || undefined
    }
  };
};

const sendMetaEvent = async (event, { fetchImpl = global.fetch } = {}) => {
  const config = getMetaConversionsConfig();
  if (!config.configured) return { skipped: true, reason: 'not-configured' };
  if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponivel para enviar evento para a Meta.');
  const body = { data: [event] };
  if (config.testEventCode) body.test_event_code = config.testEventCode;
  const timeoutSignal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(5000) : undefined;
  const response = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${config.pixelId}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.accessToken}`
    },
    body: JSON.stringify(body),
    signal: timeoutSignal
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = normalizeText(payload?.error?.message || payload?.message || 'A Meta recusou o evento.', 500);
    throw new Error(`Meta Conversions API: ${message}`);
  }
  return { sent: true, eventId: event.event_id, eventsReceived: Number(payload?.events_received || 0) };
};

const sendMetaPurchaseEvent = async (details, { fetchImpl = global.fetch } = {}) => {
  return sendMetaEvent(buildPurchaseEvent(details), { fetchImpl });
};

const sendMetaCheckoutEvent = async (details, options = {}) => sendMetaEvent(buildCheckoutEvent(details), options);

module.exports = {
  buildPurchaseEvent,
  buildCheckoutEvent,
  getMetaConversionsConfig,
  sendMetaCheckoutEvent,
  sendMetaPurchaseEvent
};

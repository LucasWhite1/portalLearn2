const crypto = require('crypto');

const normalizeText = (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength);

const sha256 = (value) => crypto
  .createHash('sha256')
  .update(String(value || ''), 'utf8')
  .digest('hex');

const normalizePhone = (value) => normalizeText(value, 40).replace(/\D/g, '');

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

const buildPurchaseEvent = ({ payment = {}, subscription = {}, customer = {}, eventSourceUrl = '' } = {}) => {
  const paymentId = normalizeText(payment.id || subscription.provider_payment_id, 100);
  if (!paymentId) {
    throw new Error('Pagamento sem identificador para o evento Purchase da Meta.');
  }

  const email = normalizeText(customer.email || payment.customerEmail || subscription.payer_email, 254).toLowerCase();
  const phone = normalizePhone(customer.mobilePhone || customer.phone || payment.mobilePhone || payment.phone);
  const userData = {};
  if (email) userData.em = [sha256(email)];
  if (phone) userData.ph = [sha256(phone)];

  const planCode = normalizeText(subscription.plan_code || payment.externalReference || 'pro', 120);
  const planName = normalizeText(subscription.plan_label || planCode || 'Criatyve', 200);
  const amount = Number(payment.value ?? subscription.amount ?? 0);
  const safeAmount = Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;

  return {
    event_name: 'Purchase',
    event_time: toEventTimestamp(payment.confirmedDate || payment.paymentDate || payment.clientPaymentDate),
    event_id: `asaas-purchase-${paymentId}`,
    action_source: 'website',
    event_source_url: `${normalizeText(eventSourceUrl, 450).replace(/\/+$/, '') || 'https://criatyve.com'}/checkout.html`,
    user_data: userData,
    custom_data: {
      currency: 'BRL',
      value: safeAmount,
      order_id: paymentId,
      content_type: 'product',
      content_name: planName,
      content_ids: [planCode],
      contents: [{ id: planCode, quantity: 1, item_price: safeAmount }],
      num_items: 1
    }
  };
};

const sendMetaPurchaseEvent = async (details, { fetchImpl = global.fetch } = {}) => {
  const config = getMetaConversionsConfig();
  if (!config.configured) {
    return { skipped: true, reason: 'not-configured' };
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch indisponivel para enviar o evento Purchase para a Meta.');
  }

  const event = buildPurchaseEvent(details);
  const body = { data: [event] };
  if (config.testEventCode) body.test_event_code = config.testEventCode;

  const response = await fetchImpl(
    `https://graph.facebook.com/${config.graphVersion}/${config.pixelId}/events`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = normalizeText(payload?.error?.message || payload?.message || 'A Meta recusou o evento Purchase.', 500);
    throw new Error(`Meta Conversions API: ${message}`);
  }

  return {
    sent: true,
    eventId: event.event_id,
    eventsReceived: Number(payload?.events_received || 0)
  };
};

module.exports = {
  buildPurchaseEvent,
  getMetaConversionsConfig,
  sendMetaPurchaseEvent
};

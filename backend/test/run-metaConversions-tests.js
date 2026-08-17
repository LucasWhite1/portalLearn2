const assert = require('assert');
const crypto = require('crypto');

process.env.META_PIXEL_ID = '1067171249057361';
process.env.META_CONVERSIONS_API_ACCESS_TOKEN = 'test-access-token';
process.env.META_GRAPH_API_VERSION = 'v24.0';
process.env.META_CAPI_TEST_EVENT_CODE = 'TEST123';

const { buildPurchaseEvent, sendMetaPurchaseEvent } = require('../src/metaConversions');

const hash = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const purchaseEvent = buildPurchaseEvent({
  payment: {
    id: 'pay_abc123',
    value: 117.30,
    confirmedDate: '2026-08-17T20:00:00.000Z'
  },
  subscription: { plan_code: 'pro', plan_label: 'Criatyve Pro' },
  customer: { email: 'Professor@Example.com ', mobilePhone: '+55 (71) 99999-0000' },
  eventSourceUrl: 'https://criatyve.com/'
});

assert.equal(purchaseEvent.event_name, 'Purchase');
assert.equal(purchaseEvent.event_id, 'asaas-purchase-pay_abc123');
assert.equal(purchaseEvent.event_source_url, 'https://criatyve.com/checkout.html');
assert.equal(purchaseEvent.custom_data.value, 117.3);
assert.deepEqual(purchaseEvent.custom_data.content_ids, ['pro']);
assert.equal(purchaseEvent.user_data.em[0], hash('professor@example.com'));
assert.equal(purchaseEvent.user_data.ph[0], hash('5571999990000'));

const sentRequests = [];
const run = async () => {
  const result = await sendMetaPurchaseEvent({
    payment: { id: 'pay_abc123', value: 97.90 },
    subscription: { plan_code: 'pro', plan_label: 'Criatyve Pro' },
    customer: { email: 'professor@example.com' },
    eventSourceUrl: 'https://criatyve.com'
  }, {
    fetchImpl: async (url, options) => {
      sentRequests.push({ url, options });
      return { ok: true, json: async () => ({ events_received: 1 }) };
    }
  });

  assert.equal(result.sent, true);
  assert.equal(result.eventsReceived, 1);
  assert.equal(sentRequests.length, 1);
  assert.equal(sentRequests[0].url, 'https://graph.facebook.com/v24.0/1067171249057361/events');
  const body = JSON.parse(sentRequests[0].options.body);
  assert.equal(body.test_event_code, 'TEST123');
  assert.equal(body.data[0].event_name, 'Purchase');
  assert.equal(body.data[0].custom_data.value, 97.9);

  console.log('Meta Conversions API tests passed.');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

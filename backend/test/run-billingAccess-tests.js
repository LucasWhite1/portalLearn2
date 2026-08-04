const assert = require('assert');
const {
  addCalendarMonth,
  calculateNextAccessExpiration,
  getBillingAccessState
} = require('../src/billingAccess');

const now = new Date('2028-01-15T12:00:00.000Z');

assert.strictEqual(
  addCalendarMonth(new Date('2028-01-31T12:00:00.000Z')).toISOString(),
  '2028-02-29T12:00:00.000Z'
);
assert.strictEqual(
  calculateNextAccessExpiration(new Date('2028-02-15T12:00:00.000Z'), now).toISOString(),
  '2028-03-15T12:00:00.000Z'
);
assert.strictEqual(
  calculateNextAccessExpiration(new Date('2028-01-01T12:00:00.000Z'), now).toISOString(),
  '2028-02-15T12:00:00.000Z'
);

const baseUser = {
  role: 'professor',
  billing_access_managed: true,
  subscription_access_expires_at: '2028-01-20T12:00:00.000Z',
  subscription_last_event_type: 'PAYMENT_CONFIRMED'
};
assert.strictEqual(getBillingAccessState(baseUser, now).state, 'due_soon');
assert.strictEqual(getBillingAccessState(baseUser, now).daysRemaining, 5);
assert.strictEqual(getBillingAccessState({
  ...baseUser,
  subscription_last_event_type: 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'
}, now).state, 'payment_failed');
assert.strictEqual(getBillingAccessState({
  ...baseUser,
  subscription_access_expires_at: '2028-01-14T12:00:00.000Z'
}, now).blocked, true);
assert.strictEqual(getBillingAccessState({ role: 'professor' }, now).managed, false);
assert.strictEqual(getBillingAccessState({ role: 'admin', billing_access_managed: true }, now).managed, false);

console.log('Billing access tests passed.');

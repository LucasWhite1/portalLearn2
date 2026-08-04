const assert = require('assert');
const { __test } = require('../src/studentPayments');

const plan = { status: 'ACTIVE', grace_days: 5, auto_block: true };

assert.equal(__test.getPeriodState(
  { status: 'PENDING', due_date: '2026-08-10' },
  plan,
  new Date('2026-08-04T12:00:00Z')
), 'pending');

assert.equal(__test.getPeriodState(
  { status: 'PENDING', due_date: '2026-08-10' },
  plan,
  new Date('2026-08-08T12:00:00Z')
), 'due_soon');

assert.equal(__test.getPeriodState(
  { status: 'PENDING', due_date: '2026-08-10' },
  plan,
  new Date('2026-08-12T12:00:00Z')
), 'overdue');

assert.equal(__test.getPeriodState(
  { status: 'PENDING', due_date: '2026-08-10' },
  plan,
  new Date('2026-08-16T12:00:00Z')
), 'blocked');

assert.equal(__test.shouldBlockStudentPayment(
  { status: 'PENDING', due_date: '2026-08-10' },
  plan,
  new Date('2026-08-16T12:00:00Z')
), true);

assert.equal(__test.shouldBlockStudentPayment(
  { status: 'PAID', due_date: '2026-08-10' },
  plan,
  new Date('2026-08-20T12:00:00Z')
), false);

assert.equal(__test.getPeriodState(
  { status: 'FAILED', due_date: '2026-08-10' },
  plan,
  new Date('2026-08-12T12:00:00Z')
), 'failed');

assert.equal(__test.getPeriodState(
  { status: 'FAILED', due_date: '2026-08-10' },
  plan,
  new Date('2026-08-16T12:00:00Z')
), 'blocked');

assert.equal(__test.shouldBlockStudentPayment(
  { status: 'REFUNDED', due_date: '2026-08-10' },
  plan,
  new Date('2026-08-12T12:00:00Z')
), true);

assert.equal(__test.shouldBlockStudentPayment(
  { status: 'PENDING', due_date: '2026-08-10' },
  { ...plan, auto_block: false },
  new Date('2026-08-20T12:00:00Z')
), false);

assert.equal(__test.dateOnly(__test.dueDateForMonth(31, new Date('2026-02-03T00:00:00Z'))), '2026-02-28');

const webhook = __test.buildSubaccountWebhook(
  '4cfadf8c-7770-4f13-8db5-c4b8c1ef84f8',
  'professor@example.com',
  'token-seguro'
);
assert.equal(webhook.authToken, 'token-seguro');
assert(webhook.events.includes('PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'));
assert(webhook.events.includes('ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED'));

assert.deepEqual(__test.summarizeStudentPayments([
  {
    accountActive: true,
    plan: { status: 'ACTIVE', amount: 120 },
    payment: { state: 'paid', amount: 120, blocked: false }
  },
  {
    accountActive: false,
    plan: { status: 'ACTIVE', amount: 80 },
    payment: { state: 'blocked', amount: 80, blocked: true }
  },
  { accountActive: true, plan: null, payment: null }
]), {
  totalStudents: 3,
  activeStudents: 2,
  configured: 2,
  monthlyExpected: 200,
  received: 120,
  pending: 0,
  overdue: 1,
  blocked: 1
});

console.log('Student payment tests passed.');

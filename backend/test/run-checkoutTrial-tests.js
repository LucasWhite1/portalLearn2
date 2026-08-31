const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const billingRouter = require('../src/routes/billing');
const {
  buildTrialAccessWindow,
  describeBillingAccess,
  getPlanConfig,
  getRenewalPlanConfig,
  resolveCheckoutPaymentMode,
  shouldActivateAccountForEvent
} = billingRouter.__test;

const unlimited = getPlanConfig('pro-unlimited');
assert.equal(unlimited.trialDays, 20);
assert.deepEqual(unlimited.billingTypes, ['PIX', 'CREDIT_CARD']);

const today = new Date();
const firstDueDate = new Date(`${unlimited.nextDueDate()}T12:00:00`);
const calendarDayDifference = Math.round((firstDueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
assert.ok(calendarDayDifference >= 19 && calendarDayDifference <= 20);

const pixCheckoutMode = resolveCheckoutPaymentMode(unlimited, 'PIX');
assert.deepEqual(pixCheckoutMode.billingTypes, ['PIX']);
assert.deepEqual(pixCheckoutMode.chargeTypes, ['DETACHED']);
assert.equal(pixCheckoutMode.subscription, null);

const cardCheckoutMode = resolveCheckoutPaymentMode(unlimited, 'CREDIT_CARD');
assert.deepEqual(cardCheckoutMode.billingTypes, ['CREDIT_CARD']);
assert.deepEqual(cardCheckoutMode.chargeTypes, ['RECURRENT']);
assert.equal(cardCheckoutMode.subscription.nextDueDate, unlimited.nextDueDate());

assert.equal(shouldActivateAccountForEvent('PAYMENT_CREATED', 'pro-unlimited'), false);
assert.equal(shouldActivateAccountForEvent('PAYMENT_CREATED', 'pro-unlimited', {
  billingType: 'PIX',
  subscription: null
}), false);
assert.equal(shouldActivateAccountForEvent('PAYMENT_CREATED', 'pro-unlimited', {
  billingType: 'CREDIT_CARD',
  subscription: 'sub_trial_123'
}), true);
assert.equal(shouldActivateAccountForEvent('PAYMENT_CREATED', 'pro'), false);
assert.equal(shouldActivateAccountForEvent('PAYMENT_CONFIRMED', 'pro-unlimited'), true);

const trialStart = new Date('2026-08-28T15:00:00.000Z');
const trialWindow = buildTrialAccessWindow({
  id: 42,
  provider_subscription_id: 'sub_trial_123'
}, unlimited, trialStart);
assert.equal(trialWindow.providerPaymentId, 'trial:sub_trial_123');
assert.equal(trialWindow.accessStart.toISOString(), trialStart.toISOString());
assert.equal(trialWindow.accessExpires.toISOString(), '2026-09-17T15:00:00.000Z');
assert.equal(trialWindow.eventType, 'TRIAL_STARTED');
assert.equal(trialWindow.paymentStatus, 'TRIALING');

const renewalPlan = getRenewalPlanConfig(unlimited);
assert.equal(renewalPlan.trialDays, 0);
const renewalMode = resolveCheckoutPaymentMode(renewalPlan, 'PIX');
assert.deepEqual(renewalMode.billingTypes, ['PIX']);
assert.deepEqual(renewalMode.chargeTypes, ['DETACHED']);
assert.equal(renewalMode.subscription, null);
assert.equal(describeBillingAccess(
  { state: 'active' },
  { subscription_billing_type: 'CREDIT_CARD' },
  { provider_subscription_id: 'sub_123', billing_status: 'CANCELED' }
).automaticRenewal, false);
assert.ok(billingRouter.stack.some((layer) => layer.route?.path === '/subscription/cancel'));

const frontendRoot = path.resolve(__dirname, '../../frontend');
const checkoutHtml = fs.readFileSync(path.join(frontendRoot, 'checkout.html'), 'utf8');
const landingHtml = fs.readFileSync(path.join(frontendRoot, 'aulas-interativas-ia.html'), 'utf8');
const termsHtml = fs.readFileSync(path.join(frontendRoot, 'terms.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(frontendRoot, 'admin.html'), 'utf8');
const frontendScript = fs.readFileSync(path.join(frontendRoot, 'script.js'), 'utf8');
assert.match(checkoutHtml, /R\$0 <small>agora<\/small>/);
assert.match(checkoutHtml, /primeira cobrança de R\$97,90 será feita somente 20 dias depois/i);
assert.match(checkoutHtml, /No Pix,.*será cobrado agora/i);
assert.match(landingHtml, /No Pix, você paga R\$97,90 agora/i);
assert.match(termsHtml, /primeira mensalidade não é cobrada no dia da contratação/i);
assert.match(termsHtml, /No Pix, o valor da primeira mensalidade é pago no momento da contratação/i);
assert.doesNotMatch(landingHtml, /Você paga agora e pode testar tudo/i);
assert.match(adminHtml, /id="subscriptionCancel"/);
assert.match(frontendScript, /\/api\/billing\/subscription\/cancel/);

console.log('Checkout trial tests passed.');

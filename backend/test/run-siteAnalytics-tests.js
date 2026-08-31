const assert = require('assert');
const {
  cleanPagePath,
  normalizeEvent,
  parseClient
} = require('../src/siteAnalytics');

const chromeDesktop = parseClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36');
assert.deepStrictEqual(chromeDesktop, {
  browser: 'Chrome',
  operatingSystem: 'Windows',
  deviceType: 'desktop'
});

const safariMobile = parseClient('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
assert.deepStrictEqual(safariMobile, {
  browser: 'Safari',
  operatingSystem: 'iOS',
  deviceType: 'mobile'
});

assert.strictEqual(
  cleanPagePath('/checkout.html?plan=pro-unlimited&utm_source=meta&email=private@example.com'),
  '/checkout.html?plan=pro-unlimited'
);
assert.strictEqual(cleanPagePath('not a url'), '/not%20a%20url');

const event = normalizeEvent({
  id: '643f8a30-c3f0-4fc0-9f68-d7decd8eaabc',
  name: 'click',
  pagePath: '/create-account.html?utm_campaign=test&plan=pro',
  target: {
    tag: 'button',
    id: 'viewExamples',
    text: 'Ver exemplos feitos',
    href: 'https://criatyve.com/aulas-interativas-ia.html?email=secret@example.com'
  },
  metadata: { location: 'hero', nested: { ignored: true } }
}, 'e0bb6db0-091c-4c47-b878-001fbed91ca8', '60921ae5-2b5e-4577-afb3-d5f45197cb7c');

assert.strictEqual(event.name, 'click');
assert.strictEqual(event.pagePath, '/create-account.html?plan=pro');
assert.strictEqual(event.elementText, 'Ver exemplos feitos');
assert.strictEqual(event.metadata.location, 'hero');
assert.strictEqual(typeof event.metadata.nested, 'string');

const unknown = normalizeEvent({
  id: '643f8a30-c3f0-4fc0-9f68-d7decd8eaabd',
  name: 'arbitrary-secret-event',
  pagePath: '/'
}, 'e0bb6db0-091c-4c47-b878-001fbed91ca8', '60921ae5-2b5e-4577-afb3-d5f45197cb7c');
assert.strictEqual(unknown.name, 'custom');

console.log('Site analytics tests passed.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(testDir, '..');
const readFrontendFile = (fileName) => fs.readFileSync(path.join(frontendDir, fileName), 'utf8');

const pixelSource = readFrontendFile('meta-pixel.js');
const createAccountSource = readFrontendFile('create-account.html');
const moduleViewerHtmlSource = readFrontendFile('module-viewer.html');
const moduleViewerSource = readFrontendFile('module-viewer.js');
const backendAppSource = fs.readFileSync(path.resolve(frontendDir, '../backend/src/app.js'), 'utf8');

const insertedScripts = [];
const windowObject = {
  location: {
    pathname: '/frontend/create-account.html',
    search: '?utm_source=meta&utm_campaign=lancamento'
  }
};
const documentObject = {
  documentElement: { dataset: {} },
  createElement: () => ({}),
  getElementsByTagName: () => [{
    parentNode: {
      insertBefore: (node) => insertedScripts.push(node)
    }
  }]
};
const context = vm.createContext({
  window: windowObject,
  document: documentObject,
  URLSearchParams,
  Object,
  String
});

vm.runInContext(pixelSource, context, { filename: 'meta-pixel.js' });

assert.equal(insertedScripts.length, 1, 'deve carregar o script oficial do Meta Pixel uma vez');
assert.equal(documentObject.documentElement.dataset.criatyveAnalytics, 'ready');
assert.equal(insertedScripts[0].src, 'https://connect.facebook.net/en_US/fbevents.js');
assert.equal(windowObject.CriatyveMeta.pixelId, '1067171249057361');

const initialCalls = Array.from(windowObject.fbq.queue, (call) => Array.from(call));
assert.deepEqual(initialCalls[0], ['init', '1067171249057361']);
assert.deepEqual(initialCalls[1], ['track', 'PageView']);

windowObject.CriatyveMeta.trackCustom('DemoInteraction', { interaction_type: 'stage_pointer' }, {
  onceKey: 'first-demo-interaction'
});
windowObject.CriatyveMeta.trackCustom('DemoInteraction', { interaction_type: 'stage_pointer' }, {
  onceKey: 'first-demo-interaction'
});

const interactionCalls = Array.from(windowObject.fbq.queue, (call) => Array.from(call))
  .filter((call) => call[0] === 'trackCustom' && call[1] === 'DemoInteraction');
assert.equal(interactionCalls.length, 1, 'onceKey deve impedir duplicacao do primeiro evento');
assert.equal(interactionCalls[0][2].utm_source, 'meta');
assert.equal(interactionCalls[0][2].utm_campaign, 'lancamento');

assert.match(createAccountSource, /meta-pixel\.js/);
assert.match(createAccountSource, /ViewExamplesClick/);
assert.match(createAccountSource, /InitiateCheckout/);
assert.match(createAccountSource, /student_count/);
assert.match(createAccountSource, /\['utm_source', 'utm_medium', 'utm_campaign'/);
assert.doesNotMatch(createAccountSource, /track\(['"]Purchase['"]/);

assert.match(moduleViewerHtmlSource, /meta-pixel\.js/);
assert.match(moduleViewerSource, /DemoGalleryView/);
assert.match(moduleViewerSource, /DemoInteraction/);
assert.match(moduleViewerSource, /DemoTemplateSelect/);
assert.match(moduleViewerSource, /DemoSlideNavigation/);
assert.match(moduleViewerSource, /DemoStageInteraction/);

assert.match(backendAppSource, /script-src[^;]+https:\/\/connect\.facebook\.net/);
assert.match(backendAppSource, /connect-src[^;]+https:\/\/connect\.facebook\.net/);
assert.match(backendAppSource, /connect-src[^;]+https:\/\/www\.facebook\.com/);

console.log('Meta Pixel tracking tests passed.');

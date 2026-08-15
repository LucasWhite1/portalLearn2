import assert from 'node:assert/strict';
import { getTriggerTargetAllowedTypes } from '../modules/trigger-target-types.mjs';

for (const actionType of ['showElement', 'hideElement', 'moveElement']) {
  assert.equal(
    getTriggerTargetAllowedTypes(actionType).includes('pen'),
    true,
    `pen deve aparecer como alvo de ${actionType}`
  );
}

assert.deepEqual(getTriggerTargetAllowedTypes('playAudio'), ['audio']);
assert.deepEqual(getTriggerTargetAllowedTypes('playVideo'), ['video']);
assert.deepEqual(getTriggerTargetAllowedTypes('replaceText', {
  replaceableTextTypes: new Set(['text', 'block'])
}), ['text', 'block']);

console.log('trigger target type tests: ok');

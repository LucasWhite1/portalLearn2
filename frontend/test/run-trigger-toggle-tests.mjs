import assert from 'node:assert/strict';
import { getSlideTriggerTargets, toggleSlideTrigger } from '../modules/trigger-toggle.mjs';

const slide = {
  elements: [
    {
      id: 'button-1',
      interactionTriggers: [
        { id: 'source-trigger', enabled: true },
        { id: 'target-trigger', enabled: true }
      ]
    },
    {
      id: 'video-1',
      videoTriggers: [{ id: 'video-trigger', enabled: false }]
    }
  ]
};

assert.deepEqual(
  getSlideTriggerTargets(slide, { excludeTriggerId: 'source-trigger' }).map((item) => item.triggerId),
  ['target-trigger', 'video-trigger']
);
assert.equal(toggleSlideTrigger(slide, 'target-trigger')?.enabled, false);
assert.equal(toggleSlideTrigger(slide, 'target-trigger')?.enabled, true);
assert.equal(toggleSlideTrigger(slide, 'video-trigger')?.enabled, true);
assert.equal(toggleSlideTrigger(slide, 'missing-trigger'), null);
assert.equal(toggleSlideTrigger(slide, ''), null);

console.log('trigger toggle tests: ok');

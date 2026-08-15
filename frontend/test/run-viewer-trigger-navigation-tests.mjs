import assert from 'node:assert/strict';
import { resolveTriggeredSlideNavigation } from '../modules/viewer-trigger-navigation.mjs';

const slides = Array.from({ length: 8 }, (_, index) => ({ id: `slide-${index + 1}` }));

assert.deepEqual(
  resolveTriggeredSlideNavigation({ slides, targetSlideId: 'slide-7', currentIndex: 1 }),
  { targetIndex: 6, bypassSequentialRestriction: true },
  'an authored trigger can jump over intermediate slides'
);

assert.deepEqual(
  resolveTriggeredSlideNavigation({ slides, targetSlideId: 'slide-2', currentIndex: 6 }),
  { targetIndex: 1, bypassSequentialRestriction: true },
  'an authored trigger can navigate back to an earlier chapter'
);

assert.equal(
  resolveTriggeredSlideNavigation({ slides, targetSlideId: 'missing-slide', currentIndex: 0 }),
  null,
  'an invalid destination must not change the current slide'
);

assert.deepEqual(
  resolveTriggeredSlideNavigation({ slides, targetSlideId: 'slide-1', currentIndex: 0 }),
  { targetIndex: 0, bypassSequentialRestriction: true },
  'a trigger can rerender the current slide as before'
);

console.log('viewer trigger navigation tests: ok');

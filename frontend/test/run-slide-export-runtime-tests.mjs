import assert from 'node:assert/strict';
import {
  SLIDE_EXPORT_BACKGROUND_MEDIA_ID,
  estimateSlideExportDuration,
  findSlideExportCompatibilityIssue,
  formatSlideExportDuration,
  getSlideExportAnimationProgress
} from '../modules/slide-export-runtime.mjs';

const test = (name, callback) => {
  callback();
  console.log(`ok - ${name}`);
};

test('keeps the configured minimum for a static slide', () => {
  assert.equal(estimateSlideExportDuration({ elements: [] }, [], 3), 3);
});

test('extends a slide until finite autoplay media ends', () => {
  const slide = { elements: [{ id: 'video-1', type: 'video' }] };
  const media = [{ id: 'video-1', autoplay: true, hidden: false, loop: false, duration: 12.5 }];
  assert.equal(estimateSlideExportDuration(slide, media, 3), 12.5);
});

test('does not make loop media infinite', () => {
  const slide = { elements: [{ id: 'audio-1', type: 'audio' }] };
  const media = [{ id: 'audio-1', autoplay: true, hidden: false, loop: true, duration: 90 }];
  assert.equal(estimateSlideExportDuration(slide, media, 3), 3);
});

test('waits for a timed trigger and the media started by it', () => {
  const slide = {
    elements: [{
      id: 'timer',
      type: 'timedTrigger',
      interactionTriggers: [{
        time: 5,
        actionConfig: { type: 'playVideo', targetElementId: 'video-2' }
      }]
    }]
  };
  const media = [{ id: 'video-2', autoplay: false, hidden: false, loop: false, duration: 8 }];
  assert.equal(estimateSlideExportDuration(slide, media, 3), 13);
});

test('includes animation delay and duration', () => {
  const slide = {
    elements: [{
      id: 'title',
      type: 'text',
      animationType: 'fade-in',
      animationDelay: 4,
      animationDuration: 3
    }]
  };
  assert.equal(estimateSlideExportDuration(slide, [], 3), 7);
});

test('keeps enough time to answer a visible quiz', () => {
  assert.equal(estimateSlideExportDuration({ elements: [{ id: 'quiz', type: 'quiz' }] }, [], 1), 2.9);
});

test('uses a finite background video duration', () => {
  const media = [{ id: SLIDE_EXPORT_BACKGROUND_MEDIA_ID, autoplay: true, hidden: false, loop: false, duration: 15 }];
  assert.equal(estimateSlideExportDuration({ elements: [] }, media, 3), 15);
});

test('calculates loop and non-loop animation progress', () => {
  assert.equal(getSlideExportAnimationProgress({ animationDelay: 1, animationDuration: 2 }, 0, 0.5), 0);
  assert.equal(getSlideExportAnimationProgress({ animationDelay: 1, animationDuration: 2 }, 0, 2), 0.5);
  assert.equal(getSlideExportAnimationProgress({ animationDelay: 0, animationDuration: 2, animationLoop: true }, 0, 5), 0.5);
});

test('blocks embedded video and identifies its slide', () => {
  const issue = findSlideExportCompatibilityIssue([
    { elements: [] },
    { elements: [{ type: 'video', provider: 'youtube', embedSrc: 'https://example.test/embed/1' }] }
  ]);
  assert.deepEqual(issue, { slideIndex: 1, kind: 'embedded-video' });
});

test('formats long progress durations', () => {
  assert.equal(formatSlideExportDuration(125), '2min 05s');
});

console.log('slide export runtime tests: ok');

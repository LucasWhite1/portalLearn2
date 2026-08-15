import assert from 'node:assert/strict';
import { calculateViewerStageLayout } from '../modules/viewer-stage-layout.mjs';

const fullscreen = calculateViewerStageLayout({
  stageWidth: 1280,
  stageHeight: 720,
  shellWidth: 1920,
  shellHeight: 1080,
  paddingLeft: 8,
  paddingRight: 8,
  paddingTop: 8,
  paddingBottom: 8,
  verticalGap: 8,
  fullscreen: true
});
assert.equal(fullscreen.width, 1877);
assert.equal(fullscreen.height, 1056);
assert.equal(fullscreen.scale, 1877 / 1280);

const repeatedFullscreen = calculateViewerStageLayout({
  stageWidth: 1280,
  stageHeight: 720,
  shellWidth: 1920,
  shellHeight: 1080,
  paddingLeft: 8,
  paddingRight: 8,
  paddingTop: 8,
  paddingBottom: 8,
  verticalGap: 8,
  fullscreen: true
});
assert.deepEqual(repeatedFullscreen, fullscreen);

const portrait = calculateViewerStageLayout({
  stageWidth: 1280,
  stageHeight: 720,
  shellWidth: 390,
  shellHeight: 844,
  paddingLeft: 12,
  paddingRight: 12,
  paddingTop: 12,
  paddingBottom: 12,
  headerHeight: 50,
  promptHeight: 70,
  verticalGap: 24,
  fullscreen: true
});
assert.equal(portrait.width, 366);
assert.equal(portrait.height, 205);
assert.ok(portrait.width <= 366 && portrait.height <= 676);

const constrainedHeight = calculateViewerStageLayout({
  stageWidth: 1280,
  stageHeight: 720,
  shellWidth: 1400,
  shellHeight: 600,
  paddingLeft: 16,
  paddingRight: 16,
  paddingTop: 16,
  paddingBottom: 16,
  fullscreen: true
});
assert.equal(constrainedHeight.height, 568);
assert.equal(constrainedHeight.width, 1009);

const regularPage = calculateViewerStageLayout({
  stageWidth: 1280,
  stageHeight: 720,
  shellWidth: 1200,
  shellHeight: 180,
  paddingLeft: 24,
  paddingRight: 24,
  paddingTop: 20,
  paddingBottom: 32,
  headerHeight: 90,
  verticalGap: 36,
  fullscreen: false,
  windowHeight: 900,
  pageReservedHeight: 260
});
assert.equal(regularPage.width, 1137);
assert.equal(regularPage.height, 640);

console.log('viewer stage layout tests: ok');

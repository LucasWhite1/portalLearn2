import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeThreeDAttachment, normalizeThreeDScene } from '../modules/three-d-normalize.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(testDir, '..');
const [viewerSource, viewerHtml, salesSource, salesHtml, analyticsSource] = await Promise.all([
  readFile(path.join(frontendDir, 'module-viewer.js'), 'utf8'),
  readFile(path.join(frontendDir, 'module-viewer.html'), 'utf8'),
  readFile(path.join(frontendDir, 'aulas-interativas-ia.js'), 'utf8'),
  readFile(path.join(frontendDir, 'aulas-interativas-ia.html'), 'utf8'),
  readFile(path.join(frontendDir, 'analytics.js'), 'utf8')
]);

assert.match(viewerSource, /viewerState\.isDemo = demoTemplateKeys\.length > 0/);
assert.match(
  viewerSource,
  /} else if \(isDemoMode\(\)\) \{[\s\S]*?} else \{\s+const token = getToken\(\);\s+const role = localStorage\.getItem\(USER_ROLE_KEY\);/,
  'demo mode must be handled before the authenticated viewer fallback'
);
assert.doesNotMatch(viewerSource.slice(0, 500), /three-d-stage\.js/);
assert.match(viewerSource, /import\('\.\/modules\/three-d-stage\.js'\)/);
assert.match(salesSource, /endsWith\('\/login\.html'\)/);
assert.match(salesHtml, /loading="eager" fetchpriority="high"/);
assert.doesNotMatch(analyticsSource, /&&\s*document\.hasFocus\(\)/);
assert.match(analyticsSource, /'video_impression', 'video_start', 'video_pause', 'video_complete', 'video_exit'/);
assert.match(salesSource, /intersectionRatio >= \.15/);

const build = salesSource.match(/DEMO_VIEWER_BUILD = '([^']+)'/)?.[1];
assert.ok(build);
assert.match(salesHtml, new RegExp(`demoBuild=${build}`));
assert.match(viewerHtml, new RegExp(`module-viewer\\.js\\?v=public-demo-${build}`));

assert.deepEqual(normalizeThreeDScene({ enabled: true, zoom: 99 }).zoom, 2.5);
assert.deepEqual(normalizeThreeDAttachment({ enabled: true, fallback2d: { x: 4, y: 8 } }).fallback2d, { x: 4, y: 8 });

console.log('public demo tests: ok');

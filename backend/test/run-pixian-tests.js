const assert = require('node:assert/strict');

const { removeBackgroundFromImageSource, __test } = require('../src/pixian');

const SAMPLE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn6lS4AAAAASUVORK5CYII=';

const tests = [
  {
    name: 'detect data urls correctly',
    run() {
      assert.equal(__test.isDataUrl(SAMPLE_DATA_URL), true);
      assert.equal(__test.isDataUrl('https://example.com/image.png'), false);
    }
  },
  {
    name: 'parse data url into mime type and buffer',
    run() {
      const parsed = __test.parseDataUrl(SAMPLE_DATA_URL);
      assert.equal(parsed.mimeType, 'image/png');
      assert.equal(parsed.filename, 'upload.png');
      assert.equal(parsed.buffer.length > 0, true);
    }
  },
  {
    name: 'send image to pixian with basic auth and return data url',
    async run() {
      process.env.PIXIAN_USERNAME = 'demo-user';
      process.env.PIXIAN_PASSWORD = 'demo-pass';
      process.env.PIXIAN_TEST_MODE = 'true';
      let capturedRequest = null;
      const responseBytes = Buffer.from('png-result');
      const result = await removeBackgroundFromImageSource(SAMPLE_DATA_URL, {
        fetchImpl: async (url, options) => {
          capturedRequest = { url, options };
          return {
            ok: true,
            headers: {
              get(name) {
                return name.toLowerCase() === 'content-type' ? 'image/png' : null;
              }
            },
            async arrayBuffer() {
              return responseBytes;
            }
          };
        }
      });
      assert.equal(String(capturedRequest.url), 'https://api.pixian.ai/api/v2/remove-background?test=true');
      assert.equal(
        capturedRequest.options.headers.Authorization,
        `Basic ${Buffer.from('demo-user:demo-pass').toString('base64')}`
      );
      assert.equal(String(result.dataUrl).startsWith('data:image/png;base64,'), true);
    }
  }
];

(async () => {
  let passed = 0;
  for (const testCase of tests) {
    await testCase.run();
    console.log(`ok - ${testCase.name}`);
    passed += 1;
  }
  console.log(`\n${passed}/${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

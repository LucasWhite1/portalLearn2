const assert = require('assert');
const {
  sanitizeMediaUrl,
  sanitizeBuilderData,
  sanitizeNotificationMessage,
  sanitizeSlug,
  isSessionToken
} = require('../src/security');

const tests = [
  {
    name: 'reject javascript urls',
    run() {
      assert.strictEqual(sanitizeMediaUrl('javascript:alert(1)'), '');
    }
  },
  {
    name: 'allow https urls',
    run() {
      assert.strictEqual(sanitizeMediaUrl('https://example.com/file.mp3'), 'https://example.com/file.mp3');
    }
  },
  {
    name: 'preserve long image data urls',
    run() {
      const payload = 'a'.repeat(6000);
      const dataUrl = `data:image/png;base64,${payload}`;
      assert.strictEqual(sanitizeMediaUrl(dataUrl), dataUrl);
    }
  },
  {
    name: 'sanitize builder data string payloads',
    run() {
      const result = sanitizeBuilderData({
        slides: [
          {
            title: '  Meu slide  ',
            elements: [
              {
                type: 'text',
                content: '<img src=x onerror=alert(1)>Teste',
                src: 'javascript:alert(1)'
              }
            ]
          }
        ]
      });
      assert.ok(Array.isArray(result.slides));
      assert.strictEqual(result.slides[0].elements[0].src, '');
      assert.ok(String(result.slides[0].elements[0].content).includes('onerror'));
    }
  },
  {
    name: 'keep long embedded image sources inside builder data',
    run() {
      const payload = 'b'.repeat(7000);
      const dataUrl = `data:image/png;base64,${payload}`;
      const result = sanitizeBuilderData({
        slides: [
          {
            title: 'Slide com imagem local',
            elements: [
              {
                type: 'image',
                src: dataUrl
              }
            ]
          }
        ]
      });
      assert.strictEqual(result.slides[0].elements[0].src, dataUrl);
    }
  },
  {
    name: 'keep long texture images and background embeds inside builder data',
    run() {
      const texturePayload = 'c'.repeat(7000);
      const textureDataUrl = `data:image/png;base64,${texturePayload}`;
      const embedUrl = 'https://www.youtube.com/embed/abc123?autoplay=1&mute=1';
      const result = sanitizeBuilderData({
        slides: [
          {
            backgroundVideo: 'https://www.youtube.com/watch?v=abc123',
            backgroundVideoEmbedSrc: embedUrl,
            elements: [
              {
                type: 'block',
                textureImage: textureDataUrl
              }
            ]
          }
        ]
      });
      assert.strictEqual(result.slides[0].backgroundVideoEmbedSrc, embedUrl);
      assert.strictEqual(result.slides[0].elements[0].textureImage, textureDataUrl);
    }
  },
  {
    name: 'sanitize slug format',
    run() {
      assert.strictEqual(sanitizeSlug('Curso Segurança!! 2026'), 'curso-seguranca-2026');
    }
  },
  {
    name: 'reject invalid session token format',
    run() {
      assert.strictEqual(isSessionToken('bad-token'), false);
    }
  },
  {
    name: 'limit notification message size',
    run() {
      const message = sanitizeNotificationMessage('a'.repeat(2000));
      assert.ok(message.length <= 1200);
    }
  }
];

let passed = 0;
tests.forEach((test) => {
  test.run();
  passed += 1;
});

console.log(`Security tests passed: ${passed}/${tests.length}`);

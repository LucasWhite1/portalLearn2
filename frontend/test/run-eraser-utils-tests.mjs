import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../eraser-utils.js', import.meta.url), 'utf8');
const compiledSource = `${source.replace(/export const /g, 'const ')}\nreturn { erasePixelsFromImageData, calculateCoverDrawMetrics };`;
const { erasePixelsFromImageData, calculateCoverDrawMetrics } = new Function(compiledSource)();

const createImageDataLike = (width, height, fill) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const pixel = fill(x, y);
      data[offset] = pixel.r;
      data[offset + 1] = pixel.g;
      data[offset + 2] = pixel.b;
      data[offset + 3] = pixel.a;
    }
  }
  return { width, height, data };
};

const alphaAt = (imageDataLike, x, y) => imageDataLike.data[(y * imageDataLike.width + x) * 4 + 3];

const tests = [
  {
    name: 'erase fully transparentates masked pixels',
    run() {
      const source = createImageDataLike(3, 3, () => ({ r: 200, g: 100, b: 50, a: 255 }));
      const mask = createImageDataLike(3, 3, (x, y) => ({
        r: 0,
        g: 0,
        b: 0,
        a: x === 1 && y === 1 ? 255 : 0
      }));
      const result = erasePixelsFromImageData(source, mask);
      assert.equal(alphaAt(result, 1, 1), 0);
      assert.equal(alphaAt(result, 0, 0), 255);
    }
  },
  {
    name: 'erase partially reduces alpha on feathered mask',
    run() {
      const source = createImageDataLike(1, 1, () => ({ r: 200, g: 100, b: 50, a: 255 }));
      const mask = createImageDataLike(1, 1, () => ({ r: 0, g: 0, b: 0, a: 128 }));
      const result = erasePixelsFromImageData(source, mask);
      assert.ok(alphaAt(result, 0, 0) >= 126 && alphaAt(result, 0, 0) <= 128);
    }
  },
  {
    name: 'throws on size mismatch',
    run() {
      const source = createImageDataLike(2, 2, () => ({ r: 0, g: 0, b: 0, a: 255 }));
      const mask = createImageDataLike(1, 1, () => ({ r: 0, g: 0, b: 0, a: 255 }));
      assert.throws(() => erasePixelsFromImageData(source, mask), /mesmo tamanho/i);
    }
  },
  {
    name: 'calculate cover metrics without stretching aspect ratio',
    run() {
      const metrics = calculateCoverDrawMetrics({
        sourceWidth: 2000,
        sourceHeight: 1000,
        containerWidth: 400,
        containerHeight: 400
      });
      assert.equal(metrics.outputWidth, 1000);
      assert.equal(metrics.outputHeight, 1000);
      assert.equal(Math.round(metrics.drawWidth), 2000);
      assert.equal(Math.round(metrics.drawHeight), 1000);
      assert.equal(Math.round(metrics.dx), -500);
      assert.equal(Math.round(metrics.dy), 0);
    }
  }
];

let passed = 0;
for (const testCase of tests) {
  testCase.run();
  console.log(`ok - ${testCase.name}`);
  passed += 1;
}

console.log(`\n${passed}/${tests.length} tests passed`);

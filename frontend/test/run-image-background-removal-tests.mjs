import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../image-background-removal.js', import.meta.url), 'utf8');
const compiledSource = `${source.replace(/export const /g, 'const ')}\nreturn { removeBackgroundFromPixelData, __test };`;
const runtime = new Function(compiledSource)();
const removeBackgroundFromPixelData = runtime.removeBackgroundFromPixelData;
const helpers = runtime.__test;

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

const alphaAt = (imageDataLike, x, y) => imageDataLike[(y * 7 + x) * 4 + 3];

const tests = [
  {
    name: 'remove white border background and preserve colored center',
    run() {
      const image = createImageDataLike(7, 7, (x, y) => {
        const isCenter = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        return isCenter
          ? { r: 220, g: 40, b: 50, a: 255 }
          : { r: 255, g: 255, b: 255, a: 255 };
      });
      const result = removeBackgroundFromPixelData(image, { threshold: 32 });
      assert.equal(alphaAt(result, 0, 0), 0);
      assert.equal(alphaAt(result, 6, 6), 0);
      assert.equal(alphaAt(result, 3, 3), 255);
    }
  },
  {
    name: 'handle slightly tinted background from edges',
    run() {
      const image = createImageDataLike(7, 7, (x, y) => {
        const isCenter = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        return isCenter
          ? { r: 20, g: 90, b: 180, a: 255 }
          : { r: 242, g: 244, b: 248, a: 255 };
      });
      const result = removeBackgroundFromPixelData(image, { threshold: 28 });
      assert.equal(alphaAt(result, 0, 3), 0);
      assert.equal(alphaAt(result, 3, 3), 255);
    }
  },
  {
    name: 'remove explicit AI mask color instead of inferring from edges',
    run() {
      const image = createImageDataLike(7, 7, (x, y) => {
        const isCenter = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        return isCenter
          ? { r: 0, g: 180, b: 0, a: 255 }
          : { r: 255, g: 0, b: 255, a: 255 };
      });
      const result = removeBackgroundFromPixelData(image, { threshold: 24, maskColor: '#FF00FF' });
      assert.equal(alphaAt(result, 0, 0), 0);
      assert.equal(alphaAt(result, 3, 3), 255);
    }
  },
  {
    name: 'fallback to dominant edge color when AI reports wrong mask color',
    run() {
      const image = createImageDataLike(7, 7, (x, y) => {
        const isCenter = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        return isCenter
          ? { r: 40, g: 120, b: 210, a: 255 }
          : { r: 255, g: 0, b: 255, a: 255 };
      });
      const result = removeBackgroundFromPixelData(image, { threshold: 36, maskColor: '#00FF00' });
      assert.equal(alphaAt(result, 0, 0), 0);
      assert.equal(alphaAt(result, 6, 6), 0);
      assert.equal(alphaAt(result, 3, 3), 255);
    }
  },
  {
    name: 'remove varied green mask shades painted by the AI',
    run() {
      const image = createImageDataLike(7, 7, (x, y) => {
        const isCenter = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        if (isCenter) {
          return { r: 210, g: 80, b: 50, a: 255 };
        }
        const greenVariants = [
          { r: 0, g: 255, b: 0, a: 255 },
          { r: 20, g: 220, b: 20, a: 255 },
          { r: 40, g: 190, b: 40, a: 255 }
        ];
        return greenVariants[(x + y) % greenVariants.length];
      });
      const result = removeBackgroundFromPixelData(image, { threshold: 80, maskColor: '#00FF00' });
      assert.equal(alphaAt(result, 0, 0), 0);
      assert.equal(alphaAt(result, 6, 0), 0);
      assert.equal(alphaAt(result, 0, 6), 0);
      assert.equal(alphaAt(result, 3, 3), 255);
    }
  },
  {
    name: 'remove mask color islands that are not connected to the image border',
    run() {
      const image = createImageDataLike(7, 7, (x, y) => {
        const isCenter = x === 3 && y === 3;
        const isInnerMaskRing = x >= 2 && x <= 4 && y >= 2 && y <= 4 && !isCenter;
        if (isCenter) {
          return { r: 215, g: 120, b: 60, a: 255 };
        }
        if (isInnerMaskRing) {
          return { r: 0, g: 255, b: 0, a: 255 };
        }
        return { r: 30, g: 30, b: 180, a: 255 };
      });
      const result = removeBackgroundFromPixelData(image, { threshold: 70, maskColor: '#00FF00' });
      assert.equal(alphaAt(result, 2, 2), 0);
      assert.equal(alphaAt(result, 4, 4), 0);
      assert.equal(alphaAt(result, 3, 3), 255);
    }
  },
  {
    name: 'remove shadow halo around subject when AI paints it with mask color',
    run() {
      const image = createImageDataLike(7, 7, (x, y) => {
        const isSubject = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        const isHalo =
          x >= 1 && x <= 5 && y >= 1 && y <= 5 && !isSubject;
        if (isSubject) {
          return { r: 180, g: 60, b: 45, a: 255 };
        }
        if (isHalo) {
          return { r: 15, g: 215, b: 15, a: 255 };
        }
        return { r: 0, g: 255, b: 0, a: 255 };
      });
      const result = removeBackgroundFromPixelData(image, { threshold: 84, maskColor: '#00FF00' });
      assert.equal(alphaAt(result, 1, 3), 0);
      assert.equal(alphaAt(result, 3, 1), 0);
      assert.equal(alphaAt(result, 3, 3), 255);
    }
  },
  {
    name: 'keep subject details when they are somewhat close to the mask color',
    run() {
      const image = createImageDataLike(7, 7, (x, y) => {
        const isSubject = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        if (isSubject) {
          return { r: 90, g: 175, b: 90, a: 255 };
        }
        return { r: 0, g: 255, b: 0, a: 255 };
      });
      const result = removeBackgroundFromPixelData(image, {
        threshold: 60,
        edgeFeather: 16,
        maskColor: '#00FF00'
      });
      assert.equal(alphaAt(result, 0, 0), 0);
      assert.equal(alphaAt(result, 3, 3), 255);
    }
  },
  {
    name: 'normalize mask color hex helper',
    run() {
      assert.equal(helpers.normalizeHexColor('00ff00'), '#00FF00');
      assert.deepEqual(helpers.hexToRgb('#FF00FF'), { r: 255, g: 0, b: 255, a: 255 });
      const dominant = helpers.findDominantEdgeColor([
        { r: 255, g: 0, b: 255, a: 255 },
        { r: 250, g: 10, b: 250, a: 255 },
        { r: 10, g: 200, b: 10, a: 255 }
      ], { r: 0, g: 255, b: 0, a: 255 });
      assert.ok(dominant.g >= 150);
      assert.equal(helpers.countMaskedPixels(new Uint8Array([0, 1, 0, 1, 1])), 3);
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

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getPixelOffset = (width, x, y) => (y * width + x) * 4;

const readPixel = (data, width, x, y) => {
  const offset = getPixelOffset(width, x, y);
  return {
    r: data[offset] || 0,
    g: data[offset + 1] || 0,
    b: data[offset + 2] || 0,
    a: data[offset + 3] || 0
  };
};

const colorDistance = (left, right) =>
  Math.sqrt(
    (left.r - right.r) ** 2 +
      (left.g - right.g) ** 2 +
      (left.b - right.b) ** 2
  );

const averageColor = (samples) => {
  if (!samples.length) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }
  const total = samples.reduce(
    (accumulator, sample) => ({
      r: accumulator.r + sample.r,
      g: accumulator.g + sample.g,
      b: accumulator.b + sample.b,
      a: accumulator.a + sample.a
    }),
    { r: 0, g: 0, b: 0, a: 0 }
  );
  return {
    r: total.r / samples.length,
    g: total.g / samples.length,
    b: total.b / samples.length,
    a: total.a / samples.length
  };
};

const normalizeHexColor = (value) => {
  const match = String(value || '').trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : '';
};

const hexToRgb = (value) => {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return null;
  }
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
    a: 255
  };
};

const collectEdgeSamples = (pixels, width, height) => {
  const samples = [];
  const xCandidates = [0, Math.max(0, width - 1), Math.floor(width / 2)];
  const yCandidates = [0, Math.max(0, height - 1), Math.floor(height / 2)];

  xCandidates.forEach((x) => {
    yCandidates.forEach((y) => {
      const pixel = readPixel(pixels, width, x, y);
      if (pixel.a > 0) {
        samples.push(pixel);
      }
    });
  });

  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 8))) {
    const topPixel = readPixel(pixels, width, x, 0);
    const bottomPixel = readPixel(pixels, width, x, Math.max(0, height - 1));
    if (topPixel.a > 0) samples.push(topPixel);
    if (bottomPixel.a > 0) samples.push(bottomPixel);
  }

  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 8))) {
    const leftPixel = readPixel(pixels, width, 0, y);
    const rightPixel = readPixel(pixels, width, Math.max(0, width - 1), y);
    if (leftPixel.a > 0) samples.push(leftPixel);
    if (rightPixel.a > 0) samples.push(rightPixel);
  }

  return samples;
};

const buildBucketKey = (pixel, bucketSize = 32) =>
  [
    Math.round((pixel.r || 0) / bucketSize),
    Math.round((pixel.g || 0) / bucketSize),
    Math.round((pixel.b || 0) / bucketSize)
  ].join(':');

const findDominantEdgeColor = (samples, preferredColor = null) => {
  if (!samples.length) {
    return preferredColor || { r: 255, g: 255, b: 255, a: 255 };
  }

  const groups = new Map();
  samples.forEach((sample) => {
    const key = buildBucketKey(sample);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(sample);
  });

  const rankedGroups = Array.from(groups.values()).sort((left, right) => right.length - left.length);
  if (!preferredColor) {
    return averageColor(rankedGroups[0] || samples);
  }

  const rankedCandidates = rankedGroups
    .map((group) => ({
      group,
      average: averageColor(group),
      distance: colorDistance(averageColor(group), preferredColor)
    }))
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      return right.group.length - left.group.length;
    });

  const closestCandidate = rankedCandidates[0];
  if (closestCandidate && closestCandidate.distance <= 140) {
    return closestCandidate.average;
  }
  return averageColor(rankedGroups[0] || samples);
};

const createEdgeConnectedBackgroundMask = (pixels, width, height, referenceColor, threshold) => {
  const visited = new Uint8Array(width * height);
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (visited[index]) return;
    visited[index] = 1;
    queue.push({ x, y });
  };

  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }

  const mask = new Uint8Array(width * height);
  while (queue.length) {
    const current = queue.shift();
    const pixel = readPixel(pixels, width, current.x, current.y);
    const index = current.y * width + current.x;
    const distance = colorDistance(pixel, referenceColor);
    if (pixel.a === 0 || distance <= threshold) {
      mask[index] = 1;
      push(current.x + 1, current.y);
      push(current.x - 1, current.y);
      push(current.x, current.y + 1);
      push(current.x, current.y - 1);
    }
  }
  return mask;
};

const createGlobalColorMask = (pixels, width, height, referenceColor, threshold) => {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const pixel = readPixel(pixels, width, x, y);
      const distance = colorDistance(pixel, referenceColor);
      if (pixel.a === 0 || distance <= threshold) {
        mask[index] = 1;
      }
    }
  }
  return mask;
};

const createBackgroundMask = (pixels, width, height, referenceColor, threshold, options = {}) => {
  if (options.useGlobalMask) {
    return createGlobalColorMask(pixels, width, height, referenceColor, threshold);
  }
  return createEdgeConnectedBackgroundMask(pixels, width, height, referenceColor, threshold);
};

const countMaskedPixels = (mask) => {
  let total = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      total += 1;
    }
  }
  return total;
};

const getNeighborIndexes = (width, height, x, y) =>
  [
    [x - 1, y - 1],
    [x, y - 1],
    [x + 1, y - 1],
    [x - 1, y],
    [x + 1, y],
    [x - 1, y + 1],
    [x, y + 1],
    [x + 1, y + 1]
  ]
    .filter(([nextX, nextY]) => nextX >= 0 && nextY >= 0 && nextX < width && nextY < height)
    .map(([nextX, nextY]) => nextY * width + nextX);

const softenMaskEdges = (pixels, width, height, mask, referenceColor, threshold, options = {}) => {
  const nextPixels = new Uint8ClampedArray(pixels);
  const edgeFeather = clamp(Number(options.edgeFeather) || 32, 8, 48);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      if (mask[index]) {
        nextPixels[offset + 3] = 0;
        continue;
      }
      const pixel = readPixel(pixels, width, x, y);
      const distance = colorDistance(pixel, referenceColor);
      const edgeThreshold = threshold + edgeFeather;
      if (distance > edgeThreshold) {
        continue;
      }
      const neighborIndexes = getNeighborIndexes(width, height, x, y);
      const touchesMask = neighborIndexes.some((candidate) => mask[candidate]);
      if (!touchesMask) {
        continue;
      }
      const ratio = clamp((distance - threshold) / Math.max(1, edgeThreshold - threshold), 0, 1);
      const alpha = Math.round(255 * ratio);
      nextPixels[offset + 3] = alpha;
      if (alpha <= 0 || alpha >= 255) {
        continue;
      }
      const alphaRatio = alpha / 255;
      nextPixels[offset] = clamp(
        Math.round((pixel.r - referenceColor.r * (1 - alphaRatio)) / Math.max(alphaRatio, 0.001)),
        0,
        255
      );
      nextPixels[offset + 1] = clamp(
        Math.round((pixel.g - referenceColor.g * (1 - alphaRatio)) / Math.max(alphaRatio, 0.001)),
        0,
        255
      );
      nextPixels[offset + 2] = clamp(
        Math.round((pixel.b - referenceColor.b * (1 - alphaRatio)) / Math.max(alphaRatio, 0.001)),
        0,
        255
      );
    }
  }
  return nextPixels;
};

export const removeBackgroundFromPixelData = (imageDataLike, options = {}) => {
  const { width, height, data } = imageDataLike || {};
  if (!width || !height || !data) {
    throw new Error('Imagem inválida para remover o fundo.');
  }
  const threshold = clamp(Number(options.threshold) || 42, 8, 120);
  const edgeSamples = collectEdgeSamples(data, width, height);
  const preferredColor = hexToRgb(options.maskColor);
  const dominantEdgeColor = findDominantEdgeColor(edgeSamples, preferredColor);
  let referenceColor = dominantEdgeColor;
  let mask = createBackgroundMask(data, width, height, referenceColor, threshold, {
    useGlobalMask: false
  });

  if (preferredColor) {
    const preferredMask = createGlobalColorMask(data, width, height, preferredColor, threshold);
    if (countMaskedPixels(preferredMask) > 0) {
      referenceColor = preferredColor;
      mask = preferredMask;
    } else {
      referenceColor = dominantEdgeColor;
      mask = createGlobalColorMask(data, width, height, dominantEdgeColor, threshold);
    }
  }

  return softenMaskEdges(data, width, height, mask, referenceColor, threshold, {
    edgeFeather: options.edgeFeather
  });
};

const loadImage = (sourceUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível carregar a imagem no editor.'));
    image.src = sourceUrl;
  });

export const removeBackgroundFromImageSourceLocally = async (sourceUrl, options = {}) => {
  const image = await loadImage(sourceUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('O navegador não conseguiu preparar a remoção de fundo.');
  }

  try {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const processedData = removeBackgroundFromPixelData(imageData, options);
    const nextImageData = new ImageData(processedData, canvas.width, canvas.height);
    context.putImageData(nextImageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (error) {
    if (/tainted|cross-origin/i.test(String(error?.message || ''))) {
      throw new Error('Essa imagem não permite edição local por CORS. Use uma imagem local ou hospedada com acesso liberado.');
    }
    throw error;
  }
};

export const removeMaskColorFromImageSource = async (sourceUrl, options = {}) =>
  removeBackgroundFromImageSourceLocally(sourceUrl, {
    threshold: options.threshold || 60,
    edgeFeather: options.edgeFeather || 16,
    maskColor: options.maskColor || ''
  });

export const __test = {
  averageColor,
  findDominantEdgeColor,
  collectEdgeSamples,
  colorDistance,
  createEdgeConnectedBackgroundMask,
  createGlobalColorMask,
  createBackgroundMask,
  countMaskedPixels,
  getNeighborIndexes,
  softenMaskEdges,
  hexToRgb,
  normalizeHexColor
};

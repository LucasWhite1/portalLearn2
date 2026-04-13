const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const calculateCoverDrawMetrics = ({
  sourceWidth,
  sourceHeight,
  containerWidth,
  containerHeight,
  maxScale = 4
}) => {
  if (!sourceWidth || !sourceHeight || !containerWidth || !containerHeight) {
    throw new Error('Dimensões inválidas para calcular o enquadramento da imagem.');
  }
  const widthScale = sourceWidth / containerWidth;
  const heightScale = sourceHeight / containerHeight;
  const exportScale = clamp(Math.min(widthScale, heightScale), 1, maxScale);
  const outputWidth = Math.max(1, Math.round(containerWidth * exportScale));
  const outputHeight = Math.max(1, Math.round(containerHeight * exportScale));
  const scale = Math.max(outputWidth / sourceWidth, outputHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const dx = (outputWidth - drawWidth) / 2;
  const dy = (outputHeight - drawHeight) / 2;
  return {
    outputWidth,
    outputHeight,
    dx,
    dy,
    drawWidth,
    drawHeight
  };
};

export const erasePixelsFromImageData = (sourceImageData, maskImageData) => {
  if (!sourceImageData?.data || !maskImageData?.data) {
    throw new Error('Dados inválidos para aplicar a borracha.');
  }
  if (sourceImageData.width !== maskImageData.width || sourceImageData.height !== maskImageData.height) {
    throw new Error('A máscara da borracha precisa ter o mesmo tamanho da imagem.');
  }
  const nextPixels = new Uint8ClampedArray(sourceImageData.data);
  const maskPixels = maskImageData.data;
  for (let offset = 0; offset < nextPixels.length; offset += 4) {
    const alpha = maskPixels[offset + 3] || 0;
    if (!alpha) {
      continue;
    }
    const keepRatio = 1 - alpha / 255;
    nextPixels[offset + 3] = Math.round((nextPixels[offset + 3] || 0) * keepRatio);
  }
  return {
    width: sourceImageData.width,
    height: sourceImageData.height,
    data: nextPixels
  };
};

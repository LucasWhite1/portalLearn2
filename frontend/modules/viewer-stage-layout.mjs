const finitePositive = (value, fallback = 1) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const finiteNonNegative = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export const calculateViewerStageLayout = (options = {}) => {
  const stageWidth = finitePositive(options.stageWidth, 1280);
  const stageHeight = finitePositive(options.stageHeight, 720);
  const shellWidth = finitePositive(options.shellWidth, stageWidth);
  const shellHeight = finitePositive(options.shellHeight, stageHeight);
  const horizontalPadding = finiteNonNegative(options.paddingLeft) + finiteNonNegative(options.paddingRight);
  const verticalPadding = finiteNonNegative(options.paddingTop) + finiteNonNegative(options.paddingBottom);
  const reservedHeight =
    finiteNonNegative(options.headerHeight)
    + finiteNonNegative(options.promptHeight)
    + finiteNonNegative(options.verticalGap);
  const availableWidth = Math.max(1, shellWidth - horizontalPadding);
  const shellAvailableHeight = Math.max(1, shellHeight - verticalPadding - reservedHeight);
  const viewportAvailableHeight = options.fullscreen
    ? shellAvailableHeight
    : Math.max(1, finitePositive(options.windowHeight, shellHeight) - finiteNonNegative(options.pageReservedHeight || 260));
  // Fora da tela cheia, a altura do shell depende do próprio palco. Usá-la
  // como limite criaria um ciclo de medição que encolhe ou oscila o canvas.
  const availableHeight = options.fullscreen ? shellAvailableHeight : viewportAvailableHeight;
  const rawScale = Math.max(0.0001, Math.min(availableWidth / stageWidth, availableHeight / stageHeight));
  const width = Math.max(1, Math.floor(stageWidth * rawScale));
  const height = Math.max(1, Math.floor(stageHeight * rawScale));

  return {
    width,
    height,
    scale: Math.min(width / stageWidth, height / stageHeight)
  };
};

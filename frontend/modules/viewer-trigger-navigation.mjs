export const resolveTriggeredSlideNavigation = ({ slides, targetSlideId, currentIndex }) => {
  if (!Array.isArray(slides) || !targetSlideId) {
    return null;
  }

  const targetIndex = slides.findIndex((slide) => slide?.id === targetSlideId);
  if (targetIndex < 0) {
    return null;
  }

  return {
    targetIndex,
    bypassSequentialRestriction: true
  };
};

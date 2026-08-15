export const getTriggerTargetAllowedTypes = (
  actionType = 'none',
  { replaceableTextTypes = [], animatableElementTypes = [] } = {}
) => {
  if (['playVideo', 'pauseVideo', 'seekVideo'].includes(actionType)) return ['video'];
  if (actionType === 'playAudio') return ['audio'];
  if (['showElement', 'hideElement'].includes(actionType)) {
    return ['text', 'block', 'image', 'audio', 'video', 'quiz', 'floatingButton', 'input',
      'detector', 'animatedArrow', 'camera', 'key', 'pen'];
  }
  if (actionType === 'moveElement') return ['text', 'block', 'image', 'input', 'camera', 'pen'];
  if (actionType === 'replaceText') return Array.from(replaceableTextTypes);
  if (actionType === 'playAnimation') return Array.from(animatableElementTypes);
  return [];
};

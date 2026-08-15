const getElementTriggerCollections = (element) => [
  Array.isArray(element?.interactionTriggers) ? element.interactionTriggers : [],
  Array.isArray(element?.videoTriggers) ? element.videoTriggers : []
];

export const getSlideTriggerTargets = (slide, options = {}) => {
  const excludedTriggerId = String(options.excludeTriggerId || '').trim();
  return (slide?.elements || []).flatMap((element) =>
    getElementTriggerCollections(element).flatMap((triggers) =>
      triggers
        .filter((trigger) => trigger?.id && trigger.id !== excludedTriggerId)
        .map((trigger) => ({
          element,
          trigger,
          triggerId: trigger.id
        }))
    )
  );
};

export const toggleSlideTrigger = (slide, triggerId) => {
  const normalizedId = String(triggerId || '').trim();
  if (!normalizedId) {
    return null;
  }
  const target = getSlideTriggerTargets(slide).find((item) => item.triggerId === normalizedId);
  if (!target) {
    return null;
  }
  target.trigger.enabled = target.trigger.enabled === false;
  return {
    enabled: target.trigger.enabled,
    element: target.element,
    trigger: target.trigger
  };
};

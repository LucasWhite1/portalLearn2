export const SLIDE_EXPORT_QUIZ_DELAY = 2;
export const SLIDE_EXPORT_QUIZ_FEEDBACK_DURATION = 0.9;
export const SLIDE_EXPORT_BACKGROUND_MEDIA_ID = '__slide_background_video__';

export const formatSlideExportDuration = (seconds = 0) => {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return minutes ? `${minutes}min ${String(remainder).padStart(2, '0')}s` : `${remainder}s`;
};

export const interpolateSlideExportNumber = (start, end, progress) =>
  (Number(start) || 0) + ((Number(end) || 0) - (Number(start) || 0)) * progress;

export const getSlideExportAnimationProgress = (element, startedAt, elapsedSeconds) => {
  const delay = Math.max(0, Number(element?.animationDelay) || 0);
  const duration = Math.max(0.2, Number(element?.animationDuration) || 1.2);
  const localElapsed = elapsedSeconds - startedAt - delay;
  if (localElapsed <= 0) return 0;
  if (element?.animationLoop) return (localElapsed % duration) / duration;
  return Math.min(1, Math.max(0, localElapsed / duration));
};

const getSlideExportActionTail = (config = {}) => {
  const type = String(config?.type || 'none');
  if (type === 'moveElement') return Math.max(0.2, Number(config.moveDuration) || 0.8);
  if (type === 'addQuiz') return SLIDE_EXPORT_QUIZ_DELAY + SLIDE_EXPORT_QUIZ_FEEDBACK_DURATION;
  if (type === 'playAnimation') return 1.2;
  return 0.35;
};

export const estimateSlideExportDuration = (slide, mediaEntries, minimumSeconds) => {
  let duration = Math.max(1, Number(minimumSeconds) || 3);
  const mediaById = new Map((mediaEntries || []).map((entry) => [entry.id, entry]));
  (slide?.elements || []).forEach((element) => {
    const animationType = String(element?.animationType || 'none');
    if (animationType !== 'none' && !element.animationLoop) {
      duration = Math.max(
        duration,
        Math.max(0, Number(element.animationDelay) || 0) + Math.max(0.2, Number(element.animationDuration) || 1.2)
      );
    }
    if (element?.type === 'quiz' && !element.initiallyHidden) {
      duration = Math.max(duration, SLIDE_EXPORT_QUIZ_DELAY + SLIDE_EXPORT_QUIZ_FEEDBACK_DURATION);
    }
    const mediaEntry = mediaById.get(element?.id);
    if (mediaEntry?.autoplay && !mediaEntry.hidden && !mediaEntry.loop && mediaEntry.duration > 0) {
      duration = Math.max(duration, mediaEntry.duration);
    }
    if (element?.type === 'timedTrigger') {
      (element.interactionTriggers || []).forEach((trigger) => {
        if (trigger?.enabled === false || (trigger.actionConfig?.type || 'none') === 'none') return;
        const triggerAt = Math.max(0, Number(trigger.time) || 0);
        duration = Math.max(duration, triggerAt + getSlideExportActionTail(trigger.actionConfig));
        const targetMedia = mediaById.get(trigger.actionConfig?.targetElementId);
        if (targetMedia && ['showElement', 'playAudio', 'playVideo'].includes(trigger.actionConfig?.type) && !targetMedia.loop) {
          duration = Math.max(duration, triggerAt + targetMedia.duration);
        }
      });
    }
    if (element?.type === 'video') {
      (element.videoTriggers || []).forEach((trigger) => {
        if (trigger?.enabled === false || (trigger.actionConfig?.type || 'none') === 'none') return;
        const triggerAt = Math.max(0, Number(trigger.time) || 0);
        duration = Math.max(duration, triggerAt + getSlideExportActionTail(trigger.actionConfig));
        const targetMedia = mediaById.get(trigger.actionConfig?.targetElementId);
        if (targetMedia && ['showElement', 'playAudio', 'playVideo'].includes(trigger.actionConfig?.type) && !targetMedia.loop) {
          duration = Math.max(duration, triggerAt + targetMedia.duration);
        }
      });
    }
  });
  const background = mediaById.get(SLIDE_EXPORT_BACKGROUND_MEDIA_ID);
  if (background && !background.loop && background.duration > 0) {
    duration = Math.max(duration, background.duration);
  }
  return Math.max(1, duration);
};

const isEmbeddedVideo = (value) => {
  const provider = String(value?.provider || value?.backgroundVideoProvider || '').toLowerCase();
  return provider === 'youtube'
    || provider === 'iframe'
    || Boolean(value?.embedSrc)
    || Boolean(value?.backgroundVideoEmbedSrc);
};

export const findSlideExportCompatibilityIssue = (slides = []) => {
  for (let slideIndex = 0; slideIndex < slides.length; slideIndex += 1) {
    const slide = slides[slideIndex];
    if (slide?.backgroundVideo && isEmbeddedVideo(slide)) {
      return { slideIndex, kind: 'embedded-background-video' };
    }
    if ((slide?.elements || []).some((element) => element?.type === 'video' && isEmbeddedVideo(element))) {
      return { slideIndex, kind: 'embedded-video' };
    }
  }
  return null;
};

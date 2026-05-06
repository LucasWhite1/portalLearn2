export const normalizeCaptionEntries = (entries = []) =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      start: Math.max(0, Number(entry?.start) || 0),
      end: Math.max(0, Number(entry?.end) || 0),
      text: typeof entry?.text === 'string' ? entry.text.trim() : ''
    }))
    .filter((entry) => entry.text && entry.end > entry.start);

export const normalizeCaptionStyle = (style = {}, type = 'video', defaults) => {
  const position = ['top', 'center', 'bottom'].includes(String(style?.position || ''))
    ? String(style.position)
    : defaults.position;
  const stageX = Number(style?.stageX);
  const stageY = Number(style?.stageY);
  return {
    position,
    fontSize: Math.max(12, Number(style?.fontSize) || defaults.fontSize),
    textColor: typeof style?.textColor === 'string' && style.textColor ? style.textColor : defaults.textColor,
    backgroundColor:
      typeof style?.backgroundColor === 'string' && style.backgroundColor ? style.backgroundColor : defaults.backgroundColor,
    accentColor: typeof style?.accentColor === 'string' && style.accentColor ? style.accentColor : defaults.accentColor,
    uppercase: Boolean(style?.uppercase),
    width: style?.width !== undefined && style?.width !== '' && style?.width !== null ? Math.max(40, Number(style.width) || 40) : null,
    freePosition: Boolean(style?.freePosition),
    stageX: Number.isFinite(stageX) ? stageX : null,
    stageY: Number.isFinite(stageY) ? stageY : null
  };
};

export const normalizeMediaCaptionConfig = (element, type = 'video', defaults) => {
  if (!element || !['audio', 'video'].includes(element.type)) {
    return;
  }
  element.captions = normalizeCaptionEntries(element.captions);
  element.captionsEnabled = typeof element.captionsEnabled === 'boolean' ? element.captionsEnabled : false;
  element.captionStyle = normalizeCaptionStyle(element.captionStyle, type, defaults);
  element.transcriptText = typeof element.transcriptText === 'string' ? element.transcriptText : '';
  element.captionsGeneratedAt = typeof element.captionsGeneratedAt === 'string' ? element.captionsGeneratedAt : '';
};

export const normalizeAudioElement = (element, normalizeMediaCaptionConfigFn) => {
  if (!element || element.type !== 'audio') {
    return;
  }
  normalizeMediaCaptionConfigFn(element, 'audio');
  element.audioVisible = typeof element.audioVisible === 'boolean' ? element.audioVisible : true;
  element.audioLoop = Boolean(element.audioLoop);
  element.width = Math.max(180, Number(element.width) || 260);
  element.height = Math.max(54, Number(element.height) || 70);
};

export const normalizeInputCompareValue = (value = '', caseSensitive = false) => {
  const base = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return caseSensitive ? base : base.toLowerCase();
};

export const normalizeInputElement = (element) => {
  if (!element || element.type !== 'input') {
    return;
  }
  element.placeholder = typeof element.placeholder === 'string' && element.placeholder ? element.placeholder : 'Digite sua resposta';
  element.submitLabel = typeof element.submitLabel === 'string' && element.submitLabel ? element.submitLabel : 'Enviar resposta';
  element.compareText = typeof element.compareText === 'string' ? element.compareText : '';
  element.compareCaseSensitive = Boolean(element.compareCaseSensitive);
  element.compareImageEnabled = Boolean(element.compareImageEnabled);
  element.compareImageReference = typeof element.compareImageReference === 'string' ? element.compareImageReference : '';
  element.successMessage = typeof element.successMessage === 'string' && element.successMessage ? element.successMessage : 'Resposta enviada com sucesso.';
  element.errorMessage = typeof element.errorMessage === 'string' && element.errorMessage ? element.errorMessage : 'A palavra não confere. Tente novamente.';
  element.allowImage = typeof element.allowImage === 'boolean' ? element.allowImage : true;
  if (element.compareImageEnabled) {
    element.allowImage = true;
  }
  element.allowAudio = Boolean(element.allowAudio);
  element.backgroundColor = typeof element.backgroundColor === 'string' ? element.backgroundColor : '#ffffff';
  element.labelColor = typeof element.labelColor === 'string' ? element.labelColor : '#9ca3af';
  element.inputTextColor = typeof element.inputTextColor === 'string' ? element.inputTextColor : '#0f142c';
  element.submitButtonColor = typeof element.submitButtonColor === 'string' ? element.submitButtonColor : '#6d63ff';
  element.submitButtonTextColor = typeof element.submitButtonTextColor === 'string' ? element.submitButtonTextColor : '#ffffff';
  const defaultHeight = element.compareImageEnabled && element.compareImageReference ? 190 : 88;
  const minHeight = element.compareImageEnabled && element.compareImageReference ? 150 : 76;
  const rawWidth = Number(element.width);
  element.width = (!Number.isNaN(rawWidth) && rawWidth > 0) ? rawWidth : 360;
  const rawHeight = Number(element.height);
  element.height = (!Number.isNaN(rawHeight) && rawHeight > 0) ? rawHeight : defaultHeight;
};

export const normalizeElementAnimation = (element, ANIMATABLE_ELEMENT_TYPES, ANIMATION_PRESETS, MOTION_ANIMATION_TYPE, MIN_ELEMENT_SIZE, DEFAULT_MOTION_FRAME, clamp) => {
  if (!element || !ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    return;
  }
  const animationType = String(element.animationType || 'none').trim();
  element.animationType = ANIMATION_PRESETS.has(animationType) ? animationType : 'none';
  const duration = Number(element.animationDuration);
  const delay = Number(element.animationDelay);
  element.animationDuration = Number.isFinite(duration) ? clamp(duration, 0.2, 20) : 1.2;
  element.animationDelay = Number.isFinite(delay) ? clamp(delay, 0, 20) : 0;
  element.animationLoop = Boolean(element.animationLoop);
  if (element.animationType === MOTION_ANIMATION_TYPE) {
    const frames = Array.isArray(element.motionFrames) ? element.motionFrames : [];
    element.motionFrames = frames
      .map((frame) => ({
        x: Number.isFinite(Number(frame?.x)) ? Number(frame.x) : Number(element.x) || 0,
        y: Number.isFinite(Number(frame?.y)) ? Number(frame.y) : Number(element.y) || 0,
        width: Math.max(MIN_ELEMENT_SIZE, Number(frame?.width) || Number(element.width) || MIN_ELEMENT_SIZE),
        height: Math.max(MIN_ELEMENT_SIZE, Number(frame?.height) || Number(element.height) || MIN_ELEMENT_SIZE),
        rotation: Number.isFinite(Number(frame?.rotation)) ? ((Number(frame.rotation) % 360) + 360) % 360 : Number(element.rotation) || 0,
        opacity: Number.isFinite(Number(frame?.opacity)) ? clamp(Number(frame.opacity), 0, 1) : DEFAULT_MOTION_FRAME.opacity
      }))
      .filter((frame) => Number.isFinite(frame.x) && Number.isFinite(frame.y));
  } else if (Array.isArray(element.motionFrames) && !element.motionFrames.length) {
    delete element.motionFrames;
  }
};

export const normalizeTemplateStageSize = (stageSize, DEFAULT_STAGE_SIZE) => {
  const width = Number(stageSize?.width);
  const height = Number(stageSize?.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  return { ...DEFAULT_STAGE_SIZE };
};

export const normalizeTemplateModuleSettings = (moduleSettings) => ({
  lockNextModuleUntilCompleted: Boolean(moduleSettings?.lockNextModuleUntilCompleted),
  requireQuizCompletion: Boolean(moduleSettings?.requireQuizCompletion),
  isPublic: Boolean(moduleSettings?.isPublic),
  coverImage: typeof moduleSettings?.coverImage === 'string' ? moduleSettings.coverImage : '',
  allowStudentPen: moduleSettings?.allowStudentPen === true || moduleSettings?.allowStudentPen === 'true'
});
export const normalizeQuizElement = (element) => {
  if (!element || element.type !== 'quiz') {
    return;
  }
  element.question = typeof element.question === 'string' && element.question ? element.question : 'Qual é a resposta correta?';
  element.options = Array.isArray(element.options) && element.options.length ? element.options : ['Opção 1', 'Opção 2'];
  element.correctOption = Number.isFinite(Number(element.correctOption)) ? Number(element.correctOption) : 0;
  element.successMessage = typeof element.successMessage === 'string' && element.successMessage ? element.successMessage : 'Parabéns! Você acertou.';
  element.errorMessage = typeof element.errorMessage === 'string' && element.errorMessage ? element.errorMessage : 'Ops! Tente novamente.';
  element.actionLabel = typeof element.actionLabel === 'string' && element.actionLabel ? element.actionLabel : 'Validar resposta';
  element.quizBackgroundColor = typeof element.quizBackgroundColor === 'string' ? element.quizBackgroundColor : '#f4f6ff';
  element.quizQuestionColor = typeof element.quizQuestionColor === 'string' ? element.quizQuestionColor : '#0f142c';
  element.quizOptionBackgroundColor = typeof element.quizOptionBackgroundColor === 'string' ? element.quizOptionBackgroundColor : '#ffffff';
  element.quizOptionTextColor = typeof element.quizOptionTextColor === 'string' ? element.quizOptionTextColor : '#0f142c';
  element.quizButtonBackgroundColor = typeof element.quizButtonBackgroundColor === 'string' ? element.quizButtonBackgroundColor : '#6d63ff';
  element.quizPoints = Math.max(0, Number(element.quizPoints) || 10);
  element.lockOnWrong = Boolean(element.lockOnWrong);
  element.playSourceVideoOnValidate = Boolean(element.playSourceVideoOnValidate);
  element.sourceVideoElementId = typeof element.sourceVideoElementId === 'string' ? element.sourceVideoElementId : '';
};

export const normalizeFloatingActionConfig = (element) => {
  if (!element) return;
  element.interactionTriggers = Array.isArray(element.interactionTriggers) ? element.interactionTriggers : [];
  if (element.type === 'floatingButton' && !element.interactionTriggers.length) {
    element.interactionTriggers.push({
      id: `trigger-${Math.random().toString(36).slice(2, 6)}`,
      type: 'click',
      actionConfig: { type: 'nextSlide' }
    });
  } else if (element.type === 'detector' && !element.interactionTriggers.length) {
    element.interactionTriggers.push({
      id: `trigger-${Math.random().toString(36).slice(2, 6)}`,
      type: 'detectorMatch',
      actionConfig: { type: 'nextSlide' }
    });
  } else if (element.type === 'timedTrigger' && !element.interactionTriggers.length) {
    element.interactionTriggers.push({
      id: `trigger-${Math.random().toString(36).slice(2, 6)}`,
      type: 'timeElapsed',
      time: 5,
      actionConfig: { type: 'nextSlide' }
    });
  }
  element.interactionTriggers.forEach((trigger) => {
    if (!trigger.actionConfig) trigger.actionConfig = { type: 'nextSlide' };
    const config = trigger.actionConfig;
    config.type = config.type || 'nextSlide';
    if (config.type === 'goToSlide') config.targetSlideId = config.targetSlideId || '';
    if (['showElement', 'hideElement', 'playVideo', 'pauseVideo', 'seekVideo'].includes(config.type)) {
      config.targetElementId = config.targetElementId || '';
    }
  });
};

export const normalizeVideoTriggerConfig = (element) => {
  if (!element || element.type !== 'video') return;
  element.videoTriggers = Array.isArray(element.videoTriggers) ? element.videoTriggers : [];
  element.videoTriggers.forEach((trigger) => {
    if (!trigger.id) trigger.id = `vtrigger-${Math.random().toString(36).slice(2, 6)}`;
    trigger.time = Math.max(0, Number(trigger.time) || 0);
    if (!trigger.actionConfig) trigger.actionConfig = { type: 'none' };
  });
};

export const normalizeSlideBackgroundFill = (slide = {}) => {
  const fillType = slide.backgroundFillType === 'gradient' ? 'gradient' : 'solid';
  const solidColor = typeof slide.backgroundColor === 'string' && slide.backgroundColor.trim() ? slide.backgroundColor.trim() : '#fdfbff';
  const gradientStart =
    typeof slide.backgroundGradientStart === 'string' && slide.backgroundGradientStart.trim()
      ? slide.backgroundGradientStart.trim()
      : '#fdfbff';
  const gradientEnd =
    typeof slide.backgroundGradientEnd === 'string' && slide.backgroundGradientEnd.trim()
      ? slide.backgroundGradientEnd.trim()
      : '#dfe7ff';
  slide.backgroundFillType = fillType;
  slide.backgroundColor = solidColor;
  slide.backgroundGradientStart = gradientStart;
  slide.backgroundGradientEnd = gradientEnd;
  return slide;
};

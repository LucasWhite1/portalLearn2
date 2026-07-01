import { 
  escapeHtml, escapeAttribute, renderPlainTextHtml 
} from './utils.js';
import { 
  normalizeSlideBackgroundFill, normalizeAudioElement, normalizeQuizElement,
  normalizeInputElement, normalizeFloatingActionConfig, normalizeVideoTriggerConfig
} from './normalize.js';
import { 
  DEFAULT_INSERT_TEXT_STYLE, IMAGE_FALLBACK_SRC, ANIMATION_PRESETS,
  REPLACE_TEXT_MODE, REPLACE_COUNTER_MODE, DETECTOR_ACCEPT_ANY,
  ANIMATABLE_ELEMENT_TYPES
} from './constants.js';

/**
 * UI Renderer Module
 * Handles rendering of slides and elements.
 */

export const getTextDecorationFlags = (source = {}, fallback = DEFAULT_INSERT_TEXT_STYLE) => {
  const legacyBlock =
    typeof source?.hasTextBlock === 'boolean' ? source.hasTextBlock : Boolean(fallback?.hasTextBlock);
  return {
    hasTextBackground:
      typeof source?.hasTextBackground === 'boolean'
        ? source.hasTextBackground
        : typeof source?.hasTextBlock === 'boolean'
          ? source.hasTextBlock
          : Boolean(fallback?.hasTextBackground),
    hasTextBorder:
      typeof source?.hasTextBorder === 'boolean'
        ? source.hasTextBorder
        : typeof source?.hasTextBlock === 'boolean'
          ? source.hasTextBlock
          : Boolean(fallback?.hasTextBorder),
    legacyBlock
  };
};

export const toCssUrl = (url) => {
  if (!url || typeof url !== 'string') return 'none';
  if (url.startsWith('url(')) return url;
  return `url("${url}")`;
};

export const getTextureBackgroundSize = (fit) => {
  switch (fit) {
    case 'cover': return 'cover';
    case 'contain': return 'contain';
    case 'stretch': return '100% 100%';
    case 'repeat': return 'auto';
    default: return 'cover';
  }
};

export const getBlockTextureFit = (element) => {
  if (!element) return 'cover';
  return element.textureFit || 'cover';
};

export const normalizeBlockTexture = (element) => {
  if (!element || element.type !== 'block') return;
  if (!element.textureImage) {
    element.textureImage = null;
    element.textureFit = 'cover';
  }
};

export const buildBackgroundStyle = (element) => {
  if (!element) return '';
  if (element.useGradient && element.gradientStart && element.gradientEnd) {
    return `linear-gradient(135deg, ${element.gradientStart}, ${element.gradientEnd})`;
  }
  return element.backgroundColor || element.solidColor || '';
};

export const applyElementBackground = (node, element) => {
  if (!node || !element) return;
  
  const backgroundValue = buildBackgroundStyle(element);
  
  // Reset previous styles
  node.style.background = '';
  node.style.backgroundImage = '';
  node.style.backgroundSize = '';
  node.style.backgroundPosition = '';
  node.style.backgroundRepeat = '';
  node.style.backgroundColor = '';

  if (element.type === 'block') {
    normalizeBlockTexture(element);
    if (element.textureImage) {
      const textureSize = getTextureBackgroundSize(getBlockTextureFit(element));
      if (element.useGradient && element.gradientStart && element.gradientEnd) {
        node.style.backgroundImage = `${toCssUrl(element.textureImage)}, ${backgroundValue}`;
        node.style.backgroundColor = 'transparent';
      } else {
        node.style.backgroundImage = toCssUrl(element.textureImage);
        node.style.backgroundColor = backgroundValue;
      }
      node.style.backgroundSize = `${textureSize}${element.useGradient ? ', cover' : ''}`;
      node.style.backgroundPosition = `center center${element.useGradient ? ', center center' : ''}`;
      node.style.backgroundRepeat = `no-repeat${element.useGradient ? ', no-repeat' : ''}`;
      return;
    }
  }

  if (!backgroundValue) return;
  
  if (element.useGradient || String(backgroundValue).startsWith('linear-gradient')) {
    node.style.background = backgroundValue;
    node.style.backgroundColor = '';
    return;
  }
  
  node.style.background = backgroundValue;
};

export const applyShapeStyles = (node, shape) => {
  if (!node) return;
  switch (shape) {
    case 'circle':
      node.style.borderRadius = '50%';
      node.style.clipPath = 'none';
      break;
    case 'triangle':
      node.style.borderRadius = '0';
      node.style.clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)';
      break;
    case 'arrow':
      node.style.borderRadius = '0';
      node.style.clipPath = 'polygon(0 50%, 58% 0, 58% 37%, 100% 37%, 100% 63%, 58% 63%, 58% 100%)';
      break;
    case 'diamond':
      node.style.borderRadius = '0';
      node.style.clipPath = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
      break;
    default:
      node.style.clipPath = 'none';
      node.style.borderRadius = '1rem';
  }
};

export const getElementMediaObjectFit = (element) => {
  if (!element) return 'contain';
  return element.objectFit || 'contain';
};

export const stopRecordedMotionAnimation = (node) => {
  if (node?._motionAnimation?.cancel) {
    node._motionAnimation.cancel();
  }
  if (node) {
    node._motionAnimation = null;
  }
};

export const getElementBaseOpacity = (element) => {
  if (!element) return 1;
  return typeof element.opacity === 'number' ? element.opacity : 1;
};

export const applyElementAnimationStyles = (node, element, options = {}) => {
  if (!node || !element) {
    return;
  }
  stopRecordedMotionAnimation(node);
  const rotation = Number(element.rotation) || 0;
  node.style.setProperty('--element-rotation', `${rotation}deg`);
  node.style.setProperty('--element-translate-x', '0px');
  node.style.setProperty('--element-translate-y', '0px');
  node.style.setProperty('--element-scale', '1');
  node.style.transformOrigin = 'center';
  node.classList.remove(
    'element-animation-fade-in',
    'element-animation-fade-out',
    'element-animation-slide-left',
    'element-animation-slide-right',
    'element-animation-rotate-in',
    'element-animation-pulse',
    'element-animation-float',
    'element-animation-zoom-in'
  );
  node.style.opacity = String(getElementBaseOpacity(element));

  if (!ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    node.style.animation = '';
    node.style.transform = rotation ? `rotate(${rotation}deg)` : '';
    return;
  }

  const animationType = element.animationType || 'none';
  if (animationType === 'none') {
    node.style.animation = '';
    node.style.transform = rotation ? `rotate(${rotation}deg)` : '';
    return;
  }

  if (animationType === 'motion-recording') {
    node.style.animation = '';
    const isPreview = options.previewActive;
    if (node.dataset.elementId && !isPreview) {
      node.style.opacity = String(getElementBaseOpacity(element));
      node.style.transform = rotation ? `rotate(${rotation}deg)` : '';
      return;
    }
    const keyframes = options.buildRecordedMotionKeyframes?.(element) || [];
    const renderState = options.getElementRenderState?.(element) || {};
    node.style.left = `${renderState.x}px`;
    node.style.top = `${renderState.y}px`;
    node.style.width = `${renderState.width}px`;
    node.style.height = `${renderState.height}px`;
    node.style.opacity = String(renderState.opacity ?? 1);
    node.style.transform = `rotate(${renderState.rotation || 0}deg)`;
    if (keyframes.length >= 2 && typeof node.animate === 'function') {
      node._motionAnimation = node.animate(keyframes, {
        duration: Math.max(200, (element.animationDuration || 1.2) * 1000),
        delay: Math.max(0, (element.animationDelay || 0) * 1000),
        iterations: element.animationLoop ? Infinity : 1,
        easing: 'linear',
        fill: 'both'
      });
      if (typeof options.preservedElapsedSeconds === 'number') {
        const totalDurationMs = Math.max(200, (element.animationDuration || 1.2) * 1000) + Math.max(0, (element.animationDelay || 0) * 1000);
        const currentTimeMs = options.preservedElapsedSeconds * 1000;
        node._motionAnimation.currentTime = element.animationLoop
          ? currentTimeMs
          : Math.min(Math.max(currentTimeMs, 0), totalDurationMs);
      }
    }
    return;
  }

  node.classList.add(`element-animation-${animationType}`);
  node.style.animationDuration = `${element.animationDuration || 1.2}s`;
  const animationDelay =
    typeof options.preservedElapsedSeconds === 'number'
      ? (element.animationDelay || 0) - options.preservedElapsedSeconds
      : element.animationDelay || 0;
  node.style.animationDelay = `${animationDelay}s`;
  node.style.animationIterationCount = element.animationLoop ? 'infinite' : '1';
  node.style.animationFillMode = 'both';
  node.style.animationTimingFunction =
    animationType === 'pulse' || animationType === 'float' ? 'ease-in-out' : 'cubic-bezier(0.22, 1, 0.36, 1)';
  node.style.transform =
    'translate3d(var(--element-translate-x), var(--element-translate-y), 0) scale(var(--element-scale)) rotate(var(--element-rotation))';
};

export const getSlideDisplayTitle = (slide, index, allSlides) => {
  if (slide.title && slide.title !== `Slide ${String(index + 1).padStart(2, '0')}`) {
    return slide.title;
  }
  return `Slide ${String(index + 1).padStart(2, '0')}`;
};

export const renderSlideChip = (slide, index, activeSlideId, allSlides) => {
  const title = getSlideDisplayTitle(slide, index, allSlides);
  const isActive = slide.id === activeSlideId;
  return `<button type="button" class="slide-chip ${isActive ? 'active' : ''}" data-slide-id="${slide.id}">${escapeHtml(title)}</button>`;
};

export const getSlideBackgroundStyles = (slide = {}) => {
  const normalized = normalizeSlideBackgroundFill(slide);
  const backgroundImage = normalized.backgroundImage ? `url('${normalized.backgroundImage}')` : '';
  const backgroundGradient =
    normalized.backgroundFillType === 'gradient'
      ? `linear-gradient(135deg, ${normalized.backgroundGradientStart}, ${normalized.backgroundGradientEnd})`
      : '';
  return {
    backgroundImage: backgroundImage || backgroundGradient,
    backgroundColor: normalized.backgroundColor || '#fdfbff'
  };
};

export const buildViewerBackgroundEmbedUrl = (embedSrc = '', options = {}) => {
  if (!embedSrc) return '';
  const separator = embedSrc.includes('?') ? '&' : '?';
  const controls = options.controls === false ? 0 : 1;
  const autoplay = options.autoplay ? 1 : 0;
  const mute = options.muted ? 1 : 0;
  return `${embedSrc}${separator}autoplay=${autoplay}&mute=${mute}&controls=${controls}&playsinline=1&rel=0&modestbranding=1`;
};

export const renderStageBackgroundMedia = (stageNode, slide, options = {}) => {
  if (!stageNode) return;
  stageNode.querySelectorAll('.stage-background-media').forEach((node) => node.remove());
  if (!slide?.backgroundVideo) {
    return;
  }
  let mediaNode;
  const interactive = Boolean(options.interactive);
  if (slide.backgroundVideoProvider === 'youtube' && slide.backgroundVideoEmbedSrc) {
    mediaNode = document.createElement('iframe');
    mediaNode.src = buildViewerBackgroundEmbedUrl(slide.backgroundVideoEmbedSrc, {
      controls: interactive,
      autoplay: false,
      muted: false
    });
    mediaNode.title = 'Vídeo de fundo';
    mediaNode.sandbox = 'allow-scripts allow-same-origin allow-presentation';
    mediaNode.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    mediaNode.referrerPolicy = 'strict-origin-when-cross-origin';
  } else {
    mediaNode = document.createElement('video');
    mediaNode.src = slide.backgroundVideo;
    mediaNode.autoplay = false;
    mediaNode.muted = false;
    mediaNode.loop = false;
    mediaNode.playsInline = true;
    mediaNode.controls = interactive;
  }
  mediaNode.className = 'stage-background-media';
  mediaNode.classList.toggle('interactive', interactive);
  mediaNode.style.pointerEvents = interactive ? 'auto' : 'none';
  mediaNode.setAttribute('aria-hidden', 'true');
  stageNode.insertBefore(mediaNode, stageNode.firstChild);
};

export const setStageBackground = (stageNode, slide, previewActive) => {
  if (!stageNode) return;
  const backgroundStyles = getSlideBackgroundStyles(slide);
  renderStageBackgroundMedia(stageNode, slide, { interactive: previewActive });
  stageNode.style.backgroundImage = backgroundStyles.backgroundImage;
  stageNode.style.backgroundSize = backgroundStyles.backgroundImage ? 'cover' : '';
  stageNode.style.backgroundPosition = backgroundStyles.backgroundImage ? 'center' : '';
  stageNode.style.backgroundColor = backgroundStyles.backgroundColor;
};
export const wrapMediaNodeWithCaptions = (mediaNode, element) => {
  const shell = document.createElement('div');
  shell.className = 'builder-media-shell';
  if (element?.type === 'audio' && !element.audioVisible && !element.captionsEnabled) {
    shell.style.display = 'none';
  }
  shell.appendChild(mediaNode);
  return shell;
};

export const applyPreviewAudioPresentation = (node, element, { authoring = false } = {}) => {
  normalizeAudioElement(element, (el) => { /* dummy for module compatibility if needed */ });
  if (!(node instanceof HTMLAudioElement)) {
    return;
  }
  node.loop = Boolean(element.audioLoop);
  node.preload = 'auto';
  if (authoring) {
    node.controls = true;
    node.style.display = '';
    node.style.opacity = element.audioVisible ? '1' : '0.62';
    node.style.outline = element.audioVisible ? '' : '1px dashed rgba(255, 123, 83, 0.7)';
    return;
  }
  node.controls = Boolean(element.audioVisible);
  node.style.display = element.audioVisible ? '' : 'none';
  node.style.opacity = '';
  node.style.outline = '';
};

export const createQuizNode = (element, callbacks = {}) => {
  normalizeQuizElement(element);
  const node = document.createElement('div');
  node.className = 'builder-quiz-element';
  node.style.background = element.quizBackgroundColor;
  node.style.backgroundColor = element.quizBackgroundColor;
  node.innerHTML = `
    <p class="builder-quiz-question">${renderPlainTextHtml(element.question)}</p>
    <div class="builder-quiz-options">
      ${element.options
      .map(
        (option, index) => `
            <label class="builder-quiz-option">
              <input type="radio" name="quiz-${element.id}" value="${index}" />
              <span>${renderPlainTextHtml(option)}</span>
            </label>`
      )
      .join('')}
    </div>
    <button type="button" class="secondary-btn builder-quiz-action">${escapeHtml(element.actionLabel)}</button>
    <div class="builder-quiz-feedback" aria-live="polite"></div>
  `;
  const actionBtn = node.querySelector('.builder-quiz-action');
  const feedbackNode = node.querySelector('.builder-quiz-feedback');
  node.querySelector('.builder-quiz-question')?.style.setProperty('color', element.quizQuestionColor);
  node.querySelectorAll('.builder-quiz-option').forEach((optionNode) => {
    optionNode.style.background = element.quizOptionBackgroundColor;
    optionNode.style.backgroundColor = element.quizOptionBackgroundColor;
    optionNode.style.color = element.quizOptionTextColor;
  });
  if (actionBtn) {
    actionBtn.style.background = element.quizButtonBackgroundColor;
    actionBtn.style.backgroundColor = element.quizButtonBackgroundColor;
    actionBtn.style.color = '#ffffff';
  }
  actionBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    const selected = node.querySelector(`input[name="quiz-${element.id}"]:checked`);
    if (!selected) {
      if (feedbackNode) {
        feedbackNode.textContent = 'Selecione uma resposta.';
        feedbackNode.className = 'builder-quiz-feedback error';
      }
      return;
    }
    const isCorrect = Number(selected.value) === Number(element.correctOption);
    if (feedbackNode) {
      feedbackNode.textContent = isCorrect ? element.successMessage : element.errorMessage;
      feedbackNode.className = `builder-quiz-feedback ${isCorrect ? 'success' : 'error'}`;
    }
    if (isCorrect) {
      callbacks.onCorrect?.();
    } else {
      callbacks.onWrong?.();
    }
    if (callbacks.preview && element.playSourceVideoOnValidate && element.sourceVideoElementId) {
      callbacks.onPlaySourceVideo?.(element.sourceVideoElementId);
    }
  });
  return node;
};

export const createInputElementNode = (element, { runActions = null, preview = false, callbacks = {} } = {}) => {
  normalizeInputElement(element);
  normalizeFloatingActionConfig(element);
  const hasCompareText = Boolean(String(element.compareText || '').trim());
  const showTextField = !element.compareImageEnabled || hasCompareText;
  const referencePreview = element.compareImageEnabled && element.compareImageReference
    ? `<div class="builder-input-reference">
        <span class="builder-input-reference-label">Referencia visual</span>
        <img src="${escapeAttribute(element.compareImageReference)}" alt="Imagem de referencia" class="builder-input-reference-image" />
      </div>`
    : '';
  const inputBgColor = element.backgroundColor || '#ffffff';
  const inputTextColor = element.inputTextColor || '#0f142c';
  const placeholderColor = element.labelColor || '#9ca3af';
  const buttonBgColor = element.submitButtonColor || '#6d63ff';
  const buttonTextColor = element.submitButtonTextColor || '#ffffff';
  const textFieldMarkup = showTextField
    ? `<textarea class="builder-input-text" style="background-color: ${inputBgColor}; color: ${inputTextColor}; --placeholder-color: ${placeholderColor};" placeholder="${escapeHtml(element.placeholder || 'Digite sua resposta')}"></textarea>`
    : `<div class="builder-input-text builder-input-text-passive" style="background-color: ${inputBgColor}; color: ${inputTextColor};">Envie uma imagem para validar</div>`;
  const node = document.createElement('div');
  node.className = 'builder-input-element';
  node.innerHTML = `
    ${referencePreview}
    <div class="builder-input-composer">
      <div class="builder-input-composer-main">
        ${textFieldMarkup}
      </div>
      <div class="builder-input-composer-actions">
        <button type="button" class="secondary-btn builder-input-upload builder-input-upload-icon builder-input-image-btn ${element.allowImage ? '' : 'hidden'}" aria-label="Anexar imagem" title="Anexar imagem">+</button>
        <button type="button" class="secondary-btn builder-input-upload builder-input-upload-icon builder-input-audio-btn ${element.allowAudio ? '' : 'hidden'}" aria-label="Anexar audio" title="Anexar audio">Mic</button>
        <button type="button" class="primary-btn builder-input-submit" style="background-color: ${buttonBgColor}; color: ${buttonTextColor};" aria-label="${escapeAttribute(element.submitLabel || 'Enviar resposta')}" title="${escapeAttribute(element.submitLabel || 'Enviar resposta')}">
          <span class="builder-input-submit-icon" aria-hidden="true">➤</span>
        </button>
      </div>
    </div>
    <input class="builder-input-image-file hidden" type="file" accept="image/*" />
    <input class="builder-input-audio-file hidden" type="file" accept="audio/*" />
    <div class="builder-input-preview hidden"></div>
    <div class="builder-input-feedback" aria-live="polite"></div>
  `;
  const textArea = node.querySelector('.builder-input-text');
  const imageBtn = node.querySelector('.builder-input-image-btn');
  const audioBtn = node.querySelector('.builder-input-audio-btn');
  const imageInput = node.querySelector('.builder-input-image-file');
  const audioInput = node.querySelector('.builder-input-audio-file');
  const previewNode = node.querySelector('.builder-input-preview');
  const feedbackNode = node.querySelector('.builder-input-feedback');
  const submitBtn = node.querySelector('.builder-input-submit');
  const state = {
    image: '',
    audio: ''
  };
  const setFileInputValue = (control, value = '') => {
    if (control instanceof HTMLInputElement) {
      control.value = value;
    }
  };
  const refreshPreview = () => {
    if (!previewNode) return;
    const parts = [];
    if (state.image) {
      parts.push(`<img src="${state.image}" alt="Imagem anexada" class="builder-input-preview-image" />`);
    }
    if (state.audio) {
      parts.push(`<audio controls src="${state.audio}" class="builder-input-preview-audio"></audio>`);
    }
    previewNode.innerHTML = parts.join('');
    previewNode.classList.toggle('hidden', parts.length === 0);
  };
  imageBtn?.addEventListener('click', () => {
    if (!preview) return;
    setFileInputValue(imageInput);
    imageInput?.click();
  });
  audioBtn?.addEventListener('click', () => {
    if (!preview) return;
    setFileInputValue(audioInput);
    audioInput?.click();
  });
  imageInput?.addEventListener('change', async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    state.image = await callbacks.readLocalFileAsDataUrl?.(file).catch(() => '');
    setFileInputValue(imageInput);
    refreshPreview();
  });
  audioInput?.addEventListener('change', async () => {
    const file = audioInput.files?.[0];
    if (!file) return;
    state.audio = await callbacks.readLocalFileAsDataUrl?.(file).catch(() => '');
    setFileInputValue(audioInput);
    refreshPreview();
  });
  if (!preview) {
    [textArea, imageBtn, audioBtn, submitBtn].forEach(el => {
      if (el) {
        if (el instanceof HTMLTextAreaElement) el.readOnly = true;
        el.tabIndex = -1;
        if (el.tagName === 'BUTTON') el.type = 'button';
      }
    });
    setFileInputValue(imageInput);
    setFileInputValue(audioInput);
  }
  submitBtn?.addEventListener('click', async () => {
    if (!preview) return;
    const submittedText = textArea instanceof HTMLTextAreaElement ? textArea.value : '';
    const matched = callbacks.validateInput?.(element, submittedText);
    const finishSubmit = (isMatched, message) => {
      if (feedbackNode) {
        feedbackNode.textContent = message;
        feedbackNode.className = `builder-input-feedback ${isMatched ? 'success' : 'error'}`;
      }
      if (isMatched) {
        callbacks.onCorrect?.();
        if (typeof runActions === 'function') {
          runActions({ text: submittedText, image: state.image, audio: state.audio, matched: true });
        }
      } else {
        callbacks.onWrong?.();
      }
    };
    if (element.compareImageEnabled) {
      if (!state.image) return finishSubmit(false, 'Anexe uma imagem para testar a comparacao visual.');
      if (!element.compareImageReference) return finishSubmit(false, 'Defina uma imagem de referencia para validar a comparacao visual.');
      if (submitBtn instanceof HTMLButtonElement) {
        submitBtn.disabled = true;
        const originalLabel = submitBtn.textContent;
        submitBtn.textContent = 'Comparando...';
        try {
          const result = await callbacks.compareImages?.(element.compareImageReference, state.image);
          finishSubmit(result.matched, result.matched ? element.successMessage : result.reason || element.errorMessage);
        } catch (error) {
          finishSubmit(false, error.message || 'Nao foi possivel validar a imagem.');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
        }
      }
      return;
    }
    finishSubmit(matched, matched ? element.successMessage : element.errorMessage);
  });
};

export const getCaptionStageSize = (stageNode) => {
  if (!stageNode) return { width: 800, height: 600 };
  return {
    width: stageNode.offsetWidth || 800,
    height: stageNode.offsetHeight || 600
  };
};

export const applyCaptionOverlayState = (overlayNode, element, currentTime, options = {}) => {
  if (!overlayNode || !element) return;
  const style = element.captionStyle || {};
  const active = (element.captions || []).find((c) => currentTime >= c.start && currentTime <= c.end);
  const showIdle = Boolean(options.keepVisibleWhenIdle);
  
  if (!active && !showIdle) {
    overlayNode.classList.add('is-hidden');
    overlayNode.style.display = 'none';
    return;
  }

  overlayNode.classList.remove('is-hidden');
  overlayNode.style.display = 'flex';
  overlayNode.style.fontSize = `${style.fontSize || 18}px`;
  overlayNode.style.color = style.textColor || '#ffffff';
  overlayNode.style.backgroundColor = style.backgroundColor || 'rgba(0, 0, 0, 0.6)';
  overlayNode.style.textTransform = style.uppercase ? 'uppercase' : 'none';
  overlayNode.style.fontWeight = '500';
  overlayNode.style.borderRadius = '0.5rem';
  overlayNode.style.padding = '0.5rem 1rem';
  overlayNode.style.maxWidth = style.width ? `${style.width}px` : '80%';
  
  if (active) {
    overlayNode.textContent = active.text;
    overlayNode.style.opacity = '1';
  } else {
    overlayNode.textContent = '[Legendas ativas]';
    overlayNode.style.opacity = '0.5';
  }
};

export const getCaptionOverlayPosition = (element, overlayNode, stageNode) => {
  const stage = getCaptionStageSize(stageNode);
  const style = element.captionStyle || {};
  const overlayWidth = overlayNode.offsetWidth || 100;
  const overlayHeight = overlayNode.offsetHeight || 40;
  const stageMaxX = Math.max(0, stage.width - overlayWidth);
  const stageMaxY = Math.max(0, stage.height - overlayHeight);

  if (style.freePosition && Number.isFinite(style.stageX) && Number.isFinite(style.stageY)) {
    return {
      x: Math.min(Math.max(0, style.stageX), stageMaxX),
      y: Math.min(Math.max(0, style.stageY), stageMaxY)
    };
  }

  const elementX = Number(element.x) || 0;
  const elementY = Number(element.y) || 0;
  const elementWidth = Number(element.width) || 200;
  const elementHeight = Number(element.height) || 150;
  
  const centeredX = elementX + (elementWidth - overlayWidth) / 2;
  let defaultY = elementY + elementHeight - overlayHeight - 14;
  
  if (style.position === 'top') {
    defaultY = elementY + 14;
  } else if (style.position === 'center') {
    defaultY = elementY + (elementHeight - overlayHeight) / 2;
  }

  return {
    x: Math.min(Math.max(0, centeredX), stageMaxX),
    y: Math.min(Math.max(0, defaultY), stageMaxY)
  };
};

export const positionCaptionOverlayNode = (overlayNode, element, stageNode) => {
  if (!overlayNode || !element) return;
  const pos = getCaptionOverlayPosition(element, overlayNode, stageNode);
  overlayNode.style.left = `${pos.x}px`;
  overlayNode.style.top = `${pos.y}px`;
};

export const createMediaCaptionOverlayNode = (element, mediaNode, options = {}) => {
  if (!element || !element.captionsEnabled) return null;
  const {
    stageNode = document.body,
    interactive = false,
    keepVisibleWhenIdle = false,
    onCommit = null,
    onSelect = null,
    getPointerPosition = null, // Callback for coordinate mapping
    updateInspector = null
  } = options;

  const node = document.createElement('div');
  node.className = `builder-media-caption is-hidden${interactive ? ' is-interactive' : ''}`;
  node.dataset.captionForElementId = element.id;

  const syncOverlay = () => {
    const currentTime = mediaNode && !mediaNode.paused ? mediaNode.currentTime : -1;
    applyCaptionOverlayState(node, element, currentTime, { keepVisibleWhenIdle });
    positionCaptionOverlayNode(node, element, stageNode);
  };

  if (mediaNode) {
    mediaNode.addEventListener('timeupdate', syncOverlay);
    mediaNode.addEventListener('seeking', syncOverlay);
    mediaNode.addEventListener('seeked', syncOverlay);
    mediaNode.addEventListener('pause', syncOverlay);
    mediaNode.addEventListener('play', syncOverlay);
    mediaNode.addEventListener('loadedmetadata', syncOverlay);
  }

  if (interactive && getPointerPosition) {
    let offsetX = 0, offsetY = 0, dragStarted = false;
    const onMove = (e) => {
      e.preventDefault();
      const pointer = getPointerPosition(e);
      const stage = getCaptionStageSize(stageNode);
      const nextX = Math.min(Math.max(0, pointer.x - offsetX), stage.width - node.offsetWidth);
      const nextY = Math.min(Math.max(0, pointer.y - offsetY), stage.height - node.offsetHeight);
      dragStarted = true;
      element.captionStyle = {
        ...element.captionStyle,
        freePosition: true,
        stageX: nextX,
        stageY: nextY
      };
      node.style.left = `${nextX}px`;
      node.style.top = `${nextY}px`;
      updateInspector?.(element);
    };
    const onEnd = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      if (dragStarted) onCommit?.();
      dragStarted = false;
    };
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const pointer = getPointerPosition(e);
      const current = getCaptionOverlayPosition(element, node, stageNode);
      offsetX = pointer.x - current.x;
      offsetY = pointer.y - current.y;
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onEnd);
    });
    node.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      onSelect?.();
    });
  }

  syncOverlay();
  return node;
};

export const getPreviewMediaNode = (node) => {
  if (!node) return null;
  if (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) return node;
  return node.querySelector('video, audio');
};

export const expandElementToRenderedContent = (element, node) => {
  if (!element || !node || element.type !== 'text') return;
  // Measure content if dimensions are missing
  if (!element.width || !element.height) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      element.width = element.width || Math.ceil(rect.width);
      element.height = element.height || Math.ceil(rect.height);
    }
  }
};

export const attachPreviewVideoTimedTrigger = (videoNode, element, options = {}) => {
  const { previewState, callbacks = {} } = options;
  if (!(videoNode instanceof HTMLVideoElement) || element.provider === 'youtube' || !previewState) {
    return;
  }
  const slideId = options.slideId;
  const elementId = element.id;
  if (!slideId || !elementId) return;

  const triggers = (element.videoTriggers || []).filter(
    (trigger) => trigger?.enabled !== false && (trigger.actionConfig?.type || 'none') !== 'none' && Number(trigger.time) > 0
  );
  if (!triggers.length) return;

  const stateKey = `${slideId}::${elementId}`;
  const firedIds = new Set(previewState.timedVideoTriggers?.get(stateKey) || []);
  if (previewState.timedVideoTriggers) {
    previewState.timedVideoTriggers.set(stateKey, firedIds);
  }

  const resetIfNeeded = () => {
    const currentTime = Number(videoNode.currentTime) || 0;
    triggers.forEach((trigger) => {
      if (currentTime < Math.max(0, Number(trigger.time) || 0)) {
        firedIds.delete(trigger.id);
      }
    });
    previewState.timedVideoTriggers?.set(stateKey, new Set(firedIds));
  };

  videoNode.addEventListener('seeking', resetIfNeeded);
  videoNode.addEventListener('timeupdate', () => {
    const currentTime = Number(videoNode.currentTime) || 0;
    let shouldRerender = false;
    triggers.forEach((trigger) => {
      if (firedIds.has(trigger.id) || currentTime < Math.max(0, Number(trigger.time) || 0)) {
        return;
      }
      firedIds.add(trigger.id);
      previewState.timedVideoTriggers?.set(stateKey, new Set(firedIds));
      
      const actionConfig = {
        ...(trigger.actionConfig || {}),
        targetElementId: callbacks.resolveVideoTriggerActionTargetElementId?.(element, trigger)
      };
      
      const didExecute = callbacks.executePreviewActionConfig?.(element, actionConfig);
      if (didExecute && !['playAudio', 'playVideo', 'pauseVideo', 'seekVideo', 'moveElement', 'playAnimation'].includes(actionConfig.type || 'none')) {
        shouldRerender = true;
      }
    });
    if (shouldRerender) callbacks.renderSlide?.();
  });

  videoNode.addEventListener('ended', () => {
    firedIds.clear();
    previewState.timedVideoTriggers?.delete(stateKey);
  });
};

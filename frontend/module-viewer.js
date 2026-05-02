const resolveApiBase = () => {
  if (window.__API_BASE__) {
    return window.__API_BASE__;
  }
  if (window.location.protocol === 'file:') {
    return 'http://localhost:4000';
  }
  if (['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port !== '4000') {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return window.location.origin;
};

const API_BASE = resolveApiBase();
const STORAGE_KEY = 'curso-platform-token';
const USER_ROLE_KEY = 'curso-platform-role';
const DEFAULT_STAGE_SIZE = { width: 1280, height: 720 };
const MIN_SLIDE_VIEW_SECONDS = 3;
const MIN_VIDEO_COMPLETION_RATIO = 0.9;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const IMAGE_FALLBACK_SRC =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="180" viewBox="0 0 280 180">
      <rect width="280" height="180" rx="18" fill="#f4f6ff"/>
      <rect x="20" y="20" width="240" height="140" rx="14" fill="#e2e7ff" stroke="#c7d0ff"/>
      <circle cx="90" cy="78" r="18" fill="#aebcff"/>
      <path d="M45 140l55-45 32 26 38-34 65 53H45z" fill="#8ea0ff"/>
      <text x="140" y="158" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#4b568f">Imagem indisponivel</text>
    </svg>`
  );

const getToken = () => localStorage.getItem(STORAGE_KEY);

const authorizedFetch = async (path, options = {}) => {
  const token = getToken();
  if (!token) {
    throw new Error('Sem token válido');
  }
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_ROLE_KEY);
    window.location.href = 'login.html';
    throw new Error('Sessão expirada');
  }
  return response;
};

const fetchPublicModule = async (moduleId) => {
  const response = await fetch(`${API_BASE}/api/student/public/modules/${encodeURIComponent(moduleId)}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || 'Nao foi possivel carregar o modulo publico.');
  }
  return payload;
};

const fetchAdminReplay = async (userId, courseId) => {
  const response = await authorizedFetch(`/api/admin/reports/${encodeURIComponent(userId)}/${encodeURIComponent(courseId)}/replay`);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || 'Nao foi possivel carregar o replay do aluno.');
  }
  return payload;
};

const handleLogout = async () => {
  try {
    await authorizedFetch('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    console.warn('Logout falhou', error);
  } finally {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_ROLE_KEY);
    window.location.href = 'login.html';
  }
};

const viewerState = {
  moduleId: null,
  courseId: null,
  slideIndex: 0,
  isPublic: false,
  isReplay: false,
  replayUserId: null,
  replayEventIndex: -1
};

const params = new URLSearchParams(window.location.search);
viewerState.isPublic = Boolean(params.get('publicModuleId'));
viewerState.isReplay = params.get('adminReplay') === '1';
viewerState.moduleId = params.get('moduleId') || params.get('publicModuleId');
viewerState.courseId = params.get('courseId');
viewerState.replayUserId = params.get('userId');

const getVisibleCourseModules = (courses) => {
  if (!Array.isArray(courses)) {
    return [];
  }
  const selectedCourses = viewerState.courseId
    ? courses.filter((course) => course.id === viewerState.courseId)
    : courses;
  return selectedCourses.flatMap((course) =>
    (course.modules || []).map((module) => ({
      ...module,
      courseId: course.id,
      courseTitle: course.title,
      courseProgress: course.progress || {}
    }))
  );
};

let moduleStage;
let moduleStageShell;
let moduleStageHint;
let viewerTitle;
let viewerSubtitle;
let prevBtn;
let nextBtn;
let viewerFullscreenBtn;
let orientationPrompt;
let moduleList;
let moduleSelection;
let viewerBackLink;
let viewerLogoutBtn;
let replayStatusCard;
let replayStatusGrid;
let replayTimelineCard;
let replayTimelineList;
let viewerModules = [];
let moduleStageDimensions = null;
let replayPayload = null;
let replayEvents = [];
const QUIZ_ATTEMPTS_STORAGE_KEY = 'curso-platform-quiz-attempts';
const BUTTON_RULES_STORAGE_KEY = 'curso-platform-button-rules';
const viewerQuizAttempts = new Map();
const viewerButtonRuleState = new Map();
const viewerTriggeredDetectors = new Set();
const viewerReplaceCounters = new Map();
const viewerHiddenElements = new Map();
const viewerAnimationState = new Map();
const viewerTimedSlideTriggers = new Map();
const viewerTimedVideoTriggers = new Map();
const viewerMediaState = new Map();
let lastRenderedViewerSlideKey = null;
let activeTimedViewerSlideKey = null;
let timedViewerSlideTriggerTimers = [];
let currentViewerSlideStartedAt = 0;
let lastLoggedViewerSlideKey = null;
let lastSavedVideoPosition = 0;
let lastTrackedVideoPosition = 0;
let currentSlideEnteredAt = 0;
let currentSlideProgressTimer = null;
let activeBackgroundMediaNode = null;

const isReplayMode = () => viewerState.isReplay;

const formatReplayDate = (value) => {
  if (!value) return 'Sem data';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};
const ANIMATABLE_ELEMENT_TYPES = new Set(['text', 'block', 'floatingButton', 'image']);
const MOTION_ANIMATION_TYPE = 'motion-recording';
const ANIMATION_PRESETS = new Set(['none', 'fade-in', 'fade-out', 'slide-left', 'slide-right', 'rotate-in', 'pulse', 'float', 'zoom-in', MOTION_ANIMATION_TYPE]);
const STUDENT_DRAGGABLE_TYPES = new Set(['text', 'block', 'image']);
const REPLACEABLE_TEXT_TYPES = new Set(['text', 'block', 'floatingButton']);
const DETECTOR_ACCEPT_ANY = 'any';
const DETECTOR_ACCEPT_TYPE_PREFIX = 'type:';
const DETECTOR_ACCEPT_ELEMENT_PREFIX = 'element:';
const REPLACE_TEXT_MODE = 'replace';
const REPLACE_COUNTER_MODE = 'counter';
const DEFAULT_INSERT_TEXT_STYLE = {
  fontSize: 20,
  fontFamily: 'Inter, sans-serif',
  fontWeight: '500',
  textColor: '#0f142c',
  backgroundColor: '#ffffff',
  textAlign: 'left',
  hasTextBackground: true,
  hasTextBorder: true,
  hasTextBlock: true
};

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttribute = (value = '') => escapeHtml(value);

const renderPlainTextHtml = (value = '') =>
  escapeHtml(String(value || ''))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '<br>');

const normalizeStringList = (value = []) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      if (typeof item === 'string') {
        return item.trim();
      }
      if (item && typeof item === 'object') {
        const candidates = [item.text, item.label, item.content, item.value, item.option];
        const match = candidates.find((entry) => typeof entry === 'string' && entry.trim());
        if (match) {
          return match.trim();
        }
      }
      return String(item ?? `Opcao ${index + 1}`).trim();
    })
    .filter(Boolean);
};

const getMeaningfulQuizOptionsSource = (primaryConfig = {}, fallbackConfig = {}) => {
  const primaryOptions = Array.isArray(primaryConfig?.quizOptions)
    ? primaryConfig.quizOptions
    : (Array.isArray(primaryConfig?.options) ? primaryConfig.options : []);
  const fallbackOptions = Array.isArray(fallbackConfig?.quizOptions)
    ? fallbackConfig.quizOptions
    : (Array.isArray(fallbackConfig?.options) ? fallbackConfig.options : []);
  const primaryLooksCorrupted =
    Array.isArray(primaryOptions) &&
    primaryOptions.length > 0 &&
    primaryOptions.every((item) => item == null);
  if (primaryLooksCorrupted || (!primaryOptions.length && fallbackOptions.length)) {
    return fallbackOptions;
  }
  return primaryOptions;
};

const truncateChatPreview = (value = '', max = 160) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
};

const formatChatReplyAuthor = (message) => {
  if (!message) return 'Mensagem';
  return message.reply_to_role === 'admin' || message.reply_to_role === 'professor'
    ? `${message.reply_to_full_name || 'Professor'} (Professor)`
    : (message.reply_to_full_name || 'Aluno');
};

const buildReplyQuoteMarkup = (message) => {
  if (!message?.reply_to_message) {
    return '';
  }
  return `
    <div class="chat-reply-quote">
      <strong>${escapeHtml(formatChatReplyAuthor(message))}</strong>
      <p>${escapeHtml(truncateChatPreview(message.reply_to_message, 160))}</p>
    </div>
  `;
};

const formatProgressEventType = (type = '') => {
  const labels = {
    slide_view: 'Entrou no slide',
    quiz_answer: 'Respondeu quiz',
    drag_end: 'Arrastou elemento',
    text_input: 'Preencheu campo',
    drawing: 'Rabiscou no quadro'
  };
  return labels[type] || type || 'Evento';
};

const getBlockTextureFit = (element) => {
  const value = String(element?.textureFit || '').trim();
  if (['fill', 'contain', 'cover'].includes(value)) {
    return value;
  }
  return 'cover';
};

const getTextureBackgroundSize = (fit = 'cover') => {
  if (fit === 'contain') {
    return 'contain';
  }
  if (fit === 'fill') {
    return '100% 100%';
  }
  return 'cover';
};

const toCssUrl = (value = '') => `url("${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;

const normalizeBlockTexture = (element) => {
  if (!element || element.type !== 'block') {
    return;
  }
  element.textureImage = typeof element.textureImage === 'string' ? element.textureImage : '';
  element.textureFit = getBlockTextureFit(element);
};

const getAnimationStateKey = (slideKey, elementId) => `${slideKey || 'slide'}::${elementId || 'element'}`;

const getViewerAnimationElapsed = (slide, element) => {
  if (!slide || !element?.id || !ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    return null;
  }
  normalizeElementAnimation(element);
  if ((element.animationType || 'none') === 'none') {
    viewerAnimationState.delete(getAnimationStateKey(getStableSlideKey(slide, viewerState.slideIndex), element.id));
    return null;
  }
  const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
  const key = getAnimationStateKey(slideKey, element.id);
  const existing = viewerAnimationState.get(key);
  const now = performance.now();
  if (!existing || existing.animationType !== element.animationType) {
    viewerAnimationState.set(key, { startedAt: now, animationType: element.animationType });
    return 0;
  }
  return Math.max(0, (now - existing.startedAt) / 1000);
};

const resetViewerAnimationStateForElement = (slide, elementId) => {
  if (!slide || !elementId) {
    return;
  }
  viewerAnimationState.delete(getAnimationStateKey(getStableSlideKey(slide, viewerState.slideIndex), elementId));
};

const createDefaultCaptionStyle = (type = 'video') => ({
  position: 'bottom',
  fontSize: type === 'video' ? 28 : 20,
  textColor: '#ffffff',
  backgroundColor: '#0f172acc',
  accentColor: type === 'video' ? '#facc15' : '#38bdf8',
  uppercase: false
});

const normalizeCaptionEntries = (entries = []) =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      start: Math.max(0, Number(entry?.start) || 0),
      end: Math.max(0, Number(entry?.end) || 0),
      text: typeof entry?.text === 'string' ? entry.text.trim() : ''
    }))
    .filter((entry) => entry.text && entry.end > entry.start);

const normalizeCaptionStyle = (style = {}, type = 'video') => {
  const defaults = createDefaultCaptionStyle(type);
  const stageX = Number(style?.stageX);
  const stageY = Number(style?.stageY);
  return {
    position: ['top', 'center', 'bottom'].includes(String(style?.position || '')) ? String(style.position) : defaults.position,
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

const normalizeMediaCaptionConfig = (element, type = 'video') => {
  if (!element || !['audio', 'video'].includes(element.type)) {
    return;
  }
  element.captions = normalizeCaptionEntries(element.captions);
  element.captionsEnabled = typeof element.captionsEnabled === 'boolean' ? element.captionsEnabled : false;
  element.captionStyle = normalizeCaptionStyle(element.captionStyle, type);
  element.transcriptText = typeof element.transcriptText === 'string' ? element.transcriptText : '';
};

const getCaptionSegmentAtTime = (element, currentTime) => {
  if (currentTime < 0) return null;
  const safeTime = Math.max(0, Number(currentTime) || 0);
  return (element?.captions || []).find((entry) => safeTime >= entry.start && safeTime <= entry.end) || null;
};

const applyCaptionOverlayState = (overlayNode, element, currentTime) => {
  if (!overlayNode || !element?.captionsEnabled || !(element.captions || []).length) {
    if (overlayNode) {
      overlayNode.textContent = '';
      overlayNode.classList.add('is-hidden');
    }
    return;
  }
  const segment = getCaptionSegmentAtTime(element, currentTime);
  if (!segment) {
    overlayNode.textContent = '';
    overlayNode.classList.add('is-hidden');
    return;
  }
  const style = normalizeCaptionStyle(element.captionStyle, element.type);
  overlayNode.textContent = style.uppercase ? segment.text.toUpperCase() : segment.text;
  overlayNode.dataset.position = style.position;
  overlayNode.style.setProperty('--caption-font-size', `${style.fontSize}px`);
  overlayNode.style.setProperty('--caption-color', style.textColor);
  overlayNode.style.setProperty('--caption-bg', style.backgroundColor);
  overlayNode.style.setProperty('--caption-accent', style.accentColor);
  if (style.width) {
    overlayNode.style.setProperty('--caption-width', style.width + 'px');
  } else {
    overlayNode.style.removeProperty('--caption-width');
  }
  overlayNode.classList.toggle('is-uppercase', Boolean(style.uppercase));
  overlayNode.classList.remove('is-hidden');
};

const getCaptionStageSize = (stageNode) => ({
  width: Number(stageNode?.clientWidth) || Number(stageNode?.offsetWidth) || 0,
  height: Number(stageNode?.clientHeight) || Number(stageNode?.offsetHeight) || 0
});

const getCaptionOverlayPosition = (element, overlayNode, stageNode) => {
  const stage = getCaptionStageSize(stageNode);
  const style = normalizeCaptionStyle(element.captionStyle, element.type);
  const overlayWidth = Math.max(40, overlayNode.offsetWidth || style.width || Math.min(Number(element.width) || 260, stage.width));
  const overlayHeight = Math.max(24, overlayNode.offsetHeight || Math.round(style.fontSize * 2.2));
  const stageMaxX = Math.max(0, stage.width - overlayWidth);
  const stageMaxY = Math.max(0, stage.height - overlayHeight);
  if (style.freePosition && Number.isFinite(style.stageX) && Number.isFinite(style.stageY)) {
    return {
      x: clamp(style.stageX, 0, stageMaxX),
      y: clamp(style.stageY, 0, stageMaxY)
    };
  }
  const elementX = Number(element.x) || 0;
  const elementY = Number(element.y) || 0;
  const elementWidth = Math.max(overlayWidth, Number(element.width) || overlayWidth);
  const elementHeight = Math.max(overlayHeight, Number(element.height) || overlayHeight);
  const centeredX = elementX + Math.max(0, (elementWidth - overlayWidth) / 2);
  let defaultY = elementY + Math.max(0, elementHeight - overlayHeight - 14);
  if (style.position === 'top') {
    defaultY = elementY + 14;
  } else if (style.position === 'center') {
    defaultY = elementY + Math.max(0, (elementHeight - overlayHeight) / 2);
  }
  return {
    x: clamp(centeredX, 0, stageMaxX),
    y: clamp(defaultY, 0, stageMaxY)
  };
};

const positionCaptionOverlayNode = (overlayNode, element, stageNode) => {
  if (!overlayNode || !element || !stageNode) {
    return;
  }
  const position = getCaptionOverlayPosition(element, overlayNode, stageNode);
  overlayNode.style.left = `${position.x}px`;
  overlayNode.style.top = `${position.y}px`;
};

const createMediaCaptionOverlayNode = (element, mediaNode, stageNode) => {
  if (!element || !(element.captions || []).length || !stageNode) {
    return null;
  }
  const overlayNode = document.createElement('div');
  overlayNode.className = 'builder-media-caption is-hidden';
  overlayNode.dataset.captionForElementId = element.id;
  const syncOverlay = () => {
    applyCaptionOverlayState(overlayNode, element, mediaNode && !mediaNode.paused ? mediaNode.currentTime : -1);
    positionCaptionOverlayNode(overlayNode, element, stageNode);
  };
  if (mediaNode) {
    mediaNode.addEventListener('timeupdate', syncOverlay);
    mediaNode.addEventListener('seeking', syncOverlay);
    mediaNode.addEventListener('seeked', syncOverlay);
    mediaNode.addEventListener('pause', syncOverlay);
    mediaNode.addEventListener('play', syncOverlay);
    mediaNode.addEventListener('ended', () => {
      applyCaptionOverlayState(overlayNode, element, -1);
      positionCaptionOverlayNode(overlayNode, element, stageNode);
    });
    mediaNode.addEventListener('loadedmetadata', syncOverlay);
  }
  requestAnimationFrame(syncOverlay);
  return overlayNode;
};

const wrapMediaNodeWithCaptions = (mediaNode, element) => {
  const shell = document.createElement('div');
  shell.className = 'builder-media-shell';
  if (element?.type === 'audio' && !element.audioVisible && !element.captionsEnabled) {
    shell.style.display = 'none';
  }
  shell.appendChild(mediaNode);
  return shell;
};

const normalizeAudioElement = (element) => {
  if (!element || element.type !== 'audio') {
    return;
  }
  normalizeMediaCaptionConfig(element, 'audio');
  element.audioVisible = typeof element.audioVisible === 'boolean' ? element.audioVisible : true;
  element.audioLoop = Boolean(element.audioLoop);
  element.width = Math.max(180, Number(element.width) || 260);
  element.height = Math.max(54, Number(element.height) || 70);
};

const normalizeInputCompareValue = (value = '', caseSensitive = false) => {
  const base = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return caseSensitive ? base : base.toLowerCase();
};

const normalizeInputElement = (element) => {
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
  const defaultHeight = element.compareImageEnabled && element.compareImageReference ? 190 : 88;
  const minHeight = element.compareImageEnabled && element.compareImageReference ? 150 : 76;
  element.width = Math.max(260, Number(element.width) || 360);
  element.height = Math.max(minHeight, Number(element.height) || defaultHeight);
};

const normalizeSlideBackgroundFill = (slide = {}) => {
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

const getSlideBackgroundStyles = (slide = {}) => {
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

const getTextDecorationFlags = (source = {}, fallback = DEFAULT_INSERT_TEXT_STYLE) => {
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

const buildAutoplayBackgroundEmbedUrl = (embedSrc = '') => {
  if (!embedSrc) return '';
  const separator = embedSrc.includes('?') ? '&' : '?';
  const videoId = embedSrc.split('/embed/')[1]?.split(/[?&]/)[0] || '';
  const playlistParam = videoId ? `&playlist=${videoId}` : '';
  return `${embedSrc}${separator}autoplay=1&mute=1&controls=0&disablekb=1&fs=0&loop=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1${playlistParam}`;
};

const renderViewerBackgroundMedia = (stageNode, slide) => {
  if (!stageNode) return;
  if (activeBackgroundMediaNode?.tagName === 'VIDEO') {
    activeBackgroundMediaNode.pause();
  }
  activeBackgroundMediaNode = null;
  stageNode.querySelectorAll('.stage-background-media').forEach((node) => node.remove());
  if (!slide?.backgroundVideo) {
    return;
  }
  let mediaNode;
  if (slide.backgroundVideoProvider === 'youtube' && slide.backgroundVideoEmbedSrc) {
    mediaNode = document.createElement('iframe');
    mediaNode.src = buildAutoplayBackgroundEmbedUrl(slide.backgroundVideoEmbedSrc);
    mediaNode.title = 'Vídeo de fundo';
    mediaNode.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    mediaNode.referrerPolicy = 'strict-origin-when-cross-origin';
  } else {
    mediaNode = document.createElement('video');
    mediaNode.src = slide.backgroundVideo;
    mediaNode.autoplay = true;
    mediaNode.muted = true;
    mediaNode.loop = true;
    mediaNode.playsInline = true;
    mediaNode.controls = false;
    mediaNode.preload = 'metadata';
    mediaNode.controlsList = 'nodownload noplaybackrate nofullscreen';
    mediaNode.disablePictureInPicture = true;
  }
  mediaNode.className = 'stage-background-media';
  mediaNode.setAttribute('aria-hidden', 'true');
  stageNode.insertBefore(mediaNode, stageNode.firstChild);
  activeBackgroundMediaNode = mediaNode;
  if (mediaNode.tagName === 'VIDEO') {
    mediaNode.play().catch(() => { });
  }
};

const normalizeRuntimeActionConfig = (config = {}) => ({
  ...config,
  url: typeof config.url === 'string' ? config.url : '',
  text: typeof config.text === 'string' && config.text ? config.text : 'Novo texto',
  replaceMode:
    config.replaceMode === REPLACE_COUNTER_MODE || config.replaceMode === REPLACE_TEXT_MODE ? config.replaceMode : REPLACE_TEXT_MODE,
  replaceText: typeof config.replaceText === 'string' ? config.replaceText : '',
  replaceCounterStart: Number.isFinite(Number(config.replaceCounterStart)) ? Number(config.replaceCounterStart) : 1,
  replaceCounterStep: Number.isFinite(Number(config.replaceCounterStep)) ? Number(config.replaceCounterStep) : 1,
  textColor: typeof config.textColor === 'string' && config.textColor ? config.textColor : DEFAULT_INSERT_TEXT_STYLE.textColor,
  backgroundColor:
    typeof config.backgroundColor === 'string' && config.backgroundColor ? config.backgroundColor : DEFAULT_INSERT_TEXT_STYLE.backgroundColor,
  textAlign: typeof config.textAlign === 'string' && config.textAlign ? config.textAlign : DEFAULT_INSERT_TEXT_STYLE.textAlign,
  fontFamily: typeof config.fontFamily === 'string' && config.fontFamily ? config.fontFamily : DEFAULT_INSERT_TEXT_STYLE.fontFamily,
  fontWeight: typeof config.fontWeight === 'string' && config.fontWeight ? config.fontWeight : DEFAULT_INSERT_TEXT_STYLE.fontWeight,
  fontSize: Number.isFinite(Number(config.fontSize)) ? Number(config.fontSize) : DEFAULT_INSERT_TEXT_STYLE.fontSize,
  videoTime: Number.isFinite(Number(config.videoTime)) ? Number(config.videoTime) : 0,
  audioVisible: typeof config.audioVisible === 'boolean' ? config.audioVisible : true,
  audioLoop: Boolean(config.audioLoop),
  quizQuestion:
    typeof config.quizQuestion === 'string' && config.quizQuestion
      ? config.quizQuestion
      : (typeof config.question === 'string' && config.question ? config.question : 'Nova pergunta'),
  quizOptions: (() => {
    const sourceOptions =
      Array.isArray(config.quizOptions) && config.quizOptions.length
        ? config.quizOptions
        : (Array.isArray(config.options) ? config.options : []);
    const normalizedOptions = normalizeStringList(sourceOptions);
    return normalizedOptions.length ? normalizedOptions : ['Opcao 1', 'Opcao 2', 'Opcao 3'];
  })(),
  quizCorrectOption: (() => {
    const rawValue = Number.isFinite(Number(config.quizCorrectOption)) ? Number(config.quizCorrectOption) : (Number(config.correctOption) || 0);
    const sourceOptions =
      Array.isArray(config.quizOptions) && config.quizOptions.length
        ? config.quizOptions
        : (Array.isArray(config.options) ? config.options : []);
    const normalizedOptions = normalizeStringList(sourceOptions);
    const optionCount = normalizedOptions.length || 3;
    return Math.min(Math.max(rawValue, 0), optionCount - 1);
  })(),
  successMessage: typeof config.successMessage === 'string' && config.successMessage ? config.successMessage : 'Resposta correta!',
  errorMessage: typeof config.errorMessage === 'string' && config.errorMessage ? config.errorMessage : 'Resposta incorreta. Tente novamente.',
  actionLabel: typeof config.actionLabel === 'string' && config.actionLabel ? config.actionLabel : 'Validar resposta',
  quizBackgroundColor: typeof config.quizBackgroundColor === 'string' && config.quizBackgroundColor ? config.quizBackgroundColor : '#ffffff',
  quizQuestionColor: typeof config.quizQuestionColor === 'string' && config.quizQuestionColor ? config.quizQuestionColor : '#171934',
  quizOptionBackgroundColor:
    typeof config.quizOptionBackgroundColor === 'string' && config.quizOptionBackgroundColor ? config.quizOptionBackgroundColor : '#f4f6ff',
  quizOptionTextColor: typeof config.quizOptionTextColor === 'string' && config.quizOptionTextColor ? config.quizOptionTextColor : '#25284c',
  quizButtonBackgroundColor:
    typeof config.quizButtonBackgroundColor === 'string' && config.quizButtonBackgroundColor ? config.quizButtonBackgroundColor : '#6d63ff',
  points: Math.max(1, Number(config.points) || 1),
  lockOnWrong: Boolean(config.lockOnWrong),
  ...(() => {
    const flags = getTextDecorationFlags(config, DEFAULT_INSERT_TEXT_STYLE);
    return {
      hasTextBackground: flags.hasTextBackground,
      hasTextBorder: flags.hasTextBorder,
      hasTextBlock: flags.legacyBlock
    };
  })()
});

const createDefaultActionConfig = () => ({
  type: 'none',
  targetSlideId: '',
  targetElementId: '',
  ruleGroup: '',
  requireAllButtonsInGroup: false,
  text: 'Novo texto',
  url: '',
  textColor: DEFAULT_INSERT_TEXT_STYLE.textColor,
  backgroundColor: DEFAULT_INSERT_TEXT_STYLE.backgroundColor,
  textAlign: DEFAULT_INSERT_TEXT_STYLE.textAlign,
  fontFamily: DEFAULT_INSERT_TEXT_STYLE.fontFamily,
  fontWeight: DEFAULT_INSERT_TEXT_STYLE.fontWeight,
  fontSize: DEFAULT_INSERT_TEXT_STYLE.fontSize,
  hasTextBackground: DEFAULT_INSERT_TEXT_STYLE.hasTextBackground,
  hasTextBorder: DEFAULT_INSERT_TEXT_STYLE.hasTextBorder,
  hasTextBlock: DEFAULT_INSERT_TEXT_STYLE.hasTextBlock,
  insertX: 120,
  insertY: 120,
  insertWidth: 280,
  insertHeight: 180,
  moveByX: 160,
  moveByY: 0,
  moveDuration: 0.8,
  videoTime: 0,
  replaceMode: REPLACE_TEXT_MODE,
  replaceText: '',
  replaceCounterStart: 1,
  replaceCounterStep: 1,
  detectorAcceptedDrag: DETECTOR_ACCEPT_ANY,
  detectorMinMatchCount: 1,
  detectorTriggerOnce: false,
  quizQuestion: 'Nova pergunta',
  quizOptions: ['Opcao 1', 'Opcao 2', 'Opcao 3'],
  quizCorrectOption: 0,
  successMessage: 'Resposta correta!',
  errorMessage: 'Resposta incorreta. Tente novamente.',
  actionLabel: 'Validar resposta',
  quizBackgroundColor: '#ffffff',
  quizQuestionColor: '#171934',
  quizOptionBackgroundColor: '#f4f6ff',
  quizOptionTextColor: '#25284c',
  quizButtonBackgroundColor: '#6d63ff',
  points: 1,
  lockOnWrong: false,
  audioVisible: true,
  audioLoop: false
});

const normalizeInteractionTriggers = (element) => {
  if (!element || !['floatingButton', 'detector', 'timedTrigger'].includes(element.type)) {
    return [];
  }
  const sourceTriggers = Array.isArray(element.interactionTriggers) ? element.interactionTriggers : [];
  const legacyConfig = element.actionConfig && typeof element.actionConfig === 'object' ? element.actionConfig : {};
  element.interactionTriggers = (sourceTriggers.length ? sourceTriggers : [{ actionConfig: legacyConfig }]).map((trigger, index) => ({
    id: typeof trigger?.id === 'string' && trigger.id.trim() ? trigger.id.trim() : `${element.id || element.type}-trigger-${index + 1}`,
    name:
      typeof trigger?.name === 'string' && trigger.name.trim()
        ? trigger.name.trim()
        : `${element.type === 'detector' ? 'Gatilho' : element.type === 'timedTrigger' ? 'Tempo' : 'Acao'} ${index + 1}`,
    enabled: typeof trigger?.enabled === 'boolean' ? trigger.enabled : true,
    time: Math.max(0, Number(trigger?.time ?? trigger?.triggerTime) || 0),
    actionConfig: normalizeRuntimeActionConfig((() => {
      const rawConfig = trigger?.actionConfig && typeof trigger.actionConfig === 'object' ? trigger.actionConfig : trigger || {};
      const preferredQuizOptions = getMeaningfulQuizOptionsSource(rawConfig, index === 0 ? legacyConfig : {});
      return {
        ...rawConfig,
        ...(preferredQuizOptions.length ? { quizOptions: preferredQuizOptions, options: preferredQuizOptions } : {})
      };
    })())
  }));
  element.actionConfig = element.interactionTriggers[0]?.actionConfig || normalizeRuntimeActionConfig(createDefaultActionConfig());
  return element.interactionTriggers;
};

const normalizeVideoTriggers = (element) => {
  if (!element || element.type !== 'video') {
    return [];
  }
  normalizeMediaCaptionConfig(element, 'video');
  element.width = Math.max(220, Number(element.width) || 320);
  element.height = Math.max(140, Number(element.height) || 190);
  const sourceTriggers = Array.isArray(element.videoTriggers)
    ? element.videoTriggers
    : [
      {
        time: element.videoTriggerTime,
        actionConfig: {
          type: element.videoTriggerAction,
          targetElementId: element.videoTriggerTargetElementId,
          videoTime: element.videoTriggerSeekTime
        }
      }
    ];
  element.videoTriggers = sourceTriggers.map((trigger, index) => ({
    id: typeof trigger?.id === 'string' && trigger.id.trim() ? trigger.id.trim() : `${element.id || 'video'}-trigger-${index + 1}`,
    name: typeof trigger?.name === 'string' && trigger.name.trim() ? trigger.name.trim() : `Tempo ${index + 1}`,
    enabled: typeof trigger?.enabled === 'boolean' ? trigger.enabled : true,
    time: Math.max(0, Number(trigger?.time ?? trigger?.videoTriggerTime) || 0),
    actionConfig: normalizeRuntimeActionConfig((() => {
      const rawConfig = trigger?.actionConfig && typeof trigger.actionConfig === 'object'
        ? trigger.actionConfig
        : {
          type: trigger?.action ?? trigger?.videoTriggerAction ?? 'none',
          targetElementId: trigger?.targetElementId ?? trigger?.videoTriggerTargetElementId ?? '',
          videoTime: trigger?.seekTime ?? trigger?.videoTriggerSeekTime ?? 0,
          question: trigger?.question,
          options: trigger?.options,
          correctOption: trigger?.correctOption,
          quizQuestion: trigger?.quizQuestion,
          quizOptions: trigger?.quizOptions,
          quizCorrectOption: trigger?.quizCorrectOption
        };
      const fallbackConfig = index === 0 && element.actionConfig && typeof element.actionConfig === 'object' ? element.actionConfig : {};
      const preferredQuizOptions = getMeaningfulQuizOptionsSource(rawConfig, fallbackConfig);
      return {
        ...rawConfig,
        ...(preferredQuizOptions.length ? { quizOptions: preferredQuizOptions, options: preferredQuizOptions } : {})
      };
    })())
  }));
  element.videoTriggerTime = element.videoTriggers[0]?.time || 0;
  element.videoTriggerAction = element.videoTriggers[0]?.actionConfig?.type || 'none';
  element.videoTriggerSeekTime = element.videoTriggers[0]?.actionConfig?.videoTime || 0;
  element.videoTriggerTargetElementId = element.videoTriggers[0]?.actionConfig?.targetElementId || '';
  return element.videoTriggers;
};

const resolveVideoTriggerActionTargetElementId = (element, trigger) => {
  const actionType = trigger?.actionConfig?.type || 'none';
  const configuredTargetId = trigger?.actionConfig?.targetElementId || '';
  if (configuredTargetId) {
    return configuredTargetId;
  }
  if (['pauseVideo', 'playVideo', 'seekVideo'].includes(actionType)) {
    return element?.id || '';
  }
  return '';
};

const getElementBaseOpacity = (element) => {
  const value = Number(element?.opacity);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;
};

let lastExternalRedirect = {
  url: '',
  at: 0
};
let externalRedirectInFlight = false;

const openExternalRedirect = (value) => {
  const nextValue = String(value || '').trim();
  if (!nextValue) {
    return false;
  }
  try {
    const parsed = new URL(nextValue, window.location.href);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    const targetUrl = parsed.toString();
    const now = Date.now();
    if (externalRedirectInFlight) {
      return true;
    }
    if (lastExternalRedirect.url === targetUrl && now - lastExternalRedirect.at < 2500) {
      return true;
    }
    lastExternalRedirect = { url: targetUrl, at: now };
    externalRedirectInFlight = true;
    window.location.assign(targetUrl);
    window.setTimeout(() => {
      externalRedirectInFlight = false;
    }, 3000);
    return true;
  } catch (error) {
    return false;
  }
};

const VIDEO_TRIGGER_ACTIONS = new Set([
  'none',
  'nextSlide',
  'jumpSlide',
  'redirect',
  'playAudio',
  'pauseVideo',
  'playVideo',
  'seekVideo',
  'showElement',
  'hideElement',
  'playAnimation'
]);

const normalizeVideoTriggerConfig = (element) => {
  if (!element || element.type !== 'video') {
    return;
  }
  normalizeVideoTriggers(element);
  element.videoTriggerAction = VIDEO_TRIGGER_ACTIONS.has(String(element.videoTriggerAction || 'none'))
    ? String(element.videoTriggerAction || 'none')
    : 'none';
};

const createAttemptSlug = (value = '') =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const getStableSlideKey = (slide, slideIndex = viewerState.slideIndex) => slide?.id || `slide-${slideIndex}`;

const getStableQuizKey = (quiz, quizIndex = 0) => quiz?.id || `quiz-${quizIndex}-${createAttemptSlug(quiz?.question || '')}`;

const getQuizAttemptKey = (moduleId, slideKey, quizKey) => `${moduleId || 'module'}::${slideKey || 'slide'}::${quizKey || 'quiz'}`;

const loadPersistedQuizAttempts = () => {
  try {
    const raw = sessionStorage.getItem(QUIZ_ATTEMPTS_STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return;
    entries.forEach((entry) => {
      if (Array.isArray(entry) && entry.length === 2) {
        viewerQuizAttempts.set(entry[0], entry[1]);
      }
    });
  } catch (error) {
    console.warn('Não foi possível restaurar as tentativas de quiz.', error);
  }
};

const persistQuizAttempts = () => {
  try {
    sessionStorage.setItem(QUIZ_ATTEMPTS_STORAGE_KEY, JSON.stringify(Array.from(viewerQuizAttempts.entries())));
  } catch (error) {
    console.warn('Não foi possível salvar as tentativas de quiz.', error);
  }
};

const loadPersistedButtonRules = () => {
  try {
    const raw = sessionStorage.getItem(BUTTON_RULES_STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return;
    entries.forEach((entry) => {
      if (Array.isArray(entry) && entry.length === 2) {
        viewerButtonRuleState.set(entry[0], entry[1]);
      }
    });
  } catch (error) {
    console.warn('Não foi possível restaurar as regras de botões.', error);
  }
};

const persistButtonRules = () => {
  try {
    sessionStorage.setItem(BUTTON_RULES_STORAGE_KEY, JSON.stringify(Array.from(viewerButtonRuleState.entries())));
  } catch (error) {
    console.warn('Não foi possível salvar as regras de botões.', error);
  }
};

const getCurrentSlide = () => {
  const module = getCurrentModule();
  const slides = module?.builder_data?.slides || [];
  return slides[viewerState.slideIndex] || null;
};

const getQuizAttemptState = (moduleId, slideKey, quizKey) =>
  viewerQuizAttempts.get(getQuizAttemptKey(moduleId, slideKey, quizKey)) || null;

const getViewerHiddenElementsKey = (slide, slideIndex = viewerState.slideIndex) => getStableSlideKey(slide, slideIndex);
const isViewerElementHidden = (slide, elementId) => (viewerHiddenElements.get(getViewerHiddenElementsKey(slide)) || new Set()).has(elementId);
const setViewerElementHidden = (slide, elementId, hidden) => {
  if (!slide || !elementId) {
    return false;
  }
  const key = getViewerHiddenElementsKey(slide);
  const hiddenIds = new Set(viewerHiddenElements.get(key) || []);
  if (hidden) {
    hiddenIds.add(elementId);
  } else {
    hiddenIds.delete(elementId);
  }
  viewerHiddenElements.set(key, hiddenIds);
  return true;
};

/** Alinha o viewer ao criador: elementos com "Começar escondido" ficam fora do DOM até uma ação showElement. */
const hydrateViewerInitiallyHiddenFromModule = (module) => {
  viewerHiddenElements.clear();
  const slides = module?.builder_data?.slides || [];
  slides.forEach((slide, slideIndex) => {
    const slideKey = getStableSlideKey(slide, slideIndex);
    const hiddenIds = new Set();
    (slide.elements || []).forEach((element) => {
      if (element?.id && element.initiallyHidden) {
        hiddenIds.add(element.id);
      }
    });
    if (hiddenIds.size > 0) {
      viewerHiddenElements.set(slideKey, hiddenIds);
    }
  });
};

const setQuizAttemptState = (moduleId, slideKey, quizKey, value) => {
  viewerQuizAttempts.set(getQuizAttemptKey(moduleId, slideKey, quizKey), value);
  persistQuizAttempts();
};

const hydrateQuizAttemptsFromCourses = (courses = []) => {
  courses.forEach((course) => {
    const attempts = course?.progress?.quiz_attempts;
    if (!attempts || typeof attempts !== 'object') {
      return;
    }
    Object.entries(attempts).forEach(([attemptKey, attemptValue]) => {
      if (attemptKey && attemptValue && typeof attemptValue === 'object') {
        viewerQuizAttempts.set(attemptKey, attemptValue);
      }
    });
  });
  persistQuizAttempts();
};

const getModuleQuizMetrics = (module) => {
  const slides = module?.builder_data?.slides || [];
  let totalPoints = 0;
  let earnedPoints = 0;
  let answeredCount = 0;
  let totalQuizzes = 0;

  slides.forEach((slide) => {
    const slideKey = getStableSlideKey(slide, slides.indexOf(slide));
    (slide.elements || [])
      .filter((element) => element.type === 'quiz')
      .forEach((quiz, quizIndex) => {
        normalizeQuizElement(quiz);
        totalQuizzes += 1;
        totalPoints += Math.max(1, Number(quiz.points) || 1);
        const attempt = getQuizAttemptState(module?.id, slideKey, getStableQuizKey(quiz, quizIndex));
        if (attempt?.answered) {
          answeredCount += 1;
        }
        if (attempt?.isCorrect) {
          earnedPoints += Math.max(1, Number(quiz.points) || 1);
        }
      });
  });

  return {
    totalPoints,
    earnedPoints,
    answeredCount,
    totalQuizzes,
    gradePercent: totalPoints > 0 ? Number(((earnedPoints / totalPoints) * 100).toFixed(2)) : 0
  };
};

const sortModulesForPhase = (modules = []) =>
  modules.slice().sort((a, b) => {
    const positionDiff = (a.position ?? 0) - (b.position ?? 0);
    if (positionDiff !== 0) return positionDiff;
    const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return dateA - dateB;
  });

const getCourseProgressState = (module) =>
  (module?.courseProgress && typeof module.courseProgress === 'object' ? module.courseProgress : {}) || {};

const syncCourseProgressState = (courseId, patch = {}) => {
  viewerModules.forEach((module) => {
    if (module.courseId !== courseId) {
      return;
    }
    module.courseProgress = {
      ...(module.courseProgress && typeof module.courseProgress === 'object' ? module.courseProgress : {}),
      ...patch
    };
  });
};

const getModuleProgressEntry = (module) => {
  const progressMap = getCourseProgressState(module).interactive_progress;
  if (!progressMap || typeof progressMap !== 'object' || !module?.id) {
    return null;
  }
  const entry = progressMap[module.id];
  return entry && typeof entry === 'object' ? entry : null;
};

const isModuleCompleted = (module) => {
  const entry = getModuleProgressEntry(module);
  if (!entry) {
    return false;
  }
  const totalSlides = Number(entry.totalSlides) || 0;
  const completedCount = Array.isArray(entry.completedSlides) ? entry.completedSlides.length : 0;
  return totalSlides > 0 && completedCount >= totalSlides;
};

const shouldLockNextModule = (module) => Boolean(module?.builder_data?.moduleSettings?.lockNextModuleUntilCompleted);

const getUnlockedModuleIds = (modules = viewerModules) => {
  if (isReplayMode()) {
    return new Set((modules || []).map((module) => module.id));
  }
  const sortedModules = sortModulesForPhase(modules);
  const unlockedIds = new Set();
  sortedModules.forEach((module, index) => {
    if (index === 0) {
      unlockedIds.add(module.id);
      return;
    }
    const previousModule = sortedModules[index - 1];
    if (!previousModule || !shouldLockNextModule(previousModule) || isModuleCompleted(previousModule)) {
      unlockedIds.add(module.id);
    }
  });
  return unlockedIds;
};

const getRecommendedModule = (modules = viewerModules) => {
  const sortedModules = sortModulesForPhase(modules);
  const unlockedIds = getUnlockedModuleIds(sortedModules);
  const firstIncompleteUnlocked = sortedModules.find((module) => unlockedIds.has(module.id) && !isModuleCompleted(module));
  return firstIncompleteUnlocked || sortedModules.find((module) => unlockedIds.has(module.id)) || sortedModules[0] || null;
};

const getLockedModuleReason = (targetModule, modules = viewerModules) => {
  const sortedModules = sortModulesForPhase(modules);
  const targetIndex = sortedModules.findIndex((module) => module.id === targetModule?.id);
  if (targetIndex <= 0) {
    return 'Este módulo já está disponível.';
  }
  const previousModule = sortedModules[targetIndex - 1];
  if (!previousModule || !shouldLockNextModule(previousModule)) {
    return 'Este módulo já está disponível.';
  }
  const previousProgress = getModuleProgressEntry(previousModule);
  const totalSlides = Number(previousProgress?.totalSlides) || ((previousModule.builder_data?.slides || []).length || 0);
  const completedSlides = Array.isArray(previousProgress?.completedSlides) ? previousProgress.completedSlides.length : 0;
  const remainingSlides = Math.max(0, totalSlides - completedSlides);
  if (remainingSlides > 0) {
    return `Para liberar "${targetModule.title}", conclua antes o módulo "${previousModule.title}". Ainda faltam ${remainingSlides} slide(s).`;
  }
  return `Para liberar "${targetModule.title}", conclua antes o módulo "${previousModule.title}".`;
};

const getReplayEventTarget = (event) => {
  if (!event || typeof event !== 'object') {
    return null;
  }
  const targetModule =
    viewerModules.find((module) => module.id === event.moduleId) ||
    viewerModules.find((module) => module.title === event.moduleTitle) ||
    null;
  if (!targetModule) {
    return null;
  }
  const slides = targetModule.builder_data?.slides || [];
  const slideIndex = slides.findIndex((slide, index) => getStableSlideKey(slide, index) === event.slideId);
  return {
    module: targetModule,
    slideIndex: slideIndex >= 0 ? slideIndex : 0
  };
};

const jumpToReplayEvent = (index) => {
  if (!isReplayMode()) {
    return;
  }
  const event = replayEvents[index];
  const target = getReplayEventTarget(event);
  if (!target) {
    return;
  }
  viewerState.replayEventIndex = index;
  viewerState.moduleId = target.module.id;
  viewerState.courseId = target.module.courseId;
  viewerState.slideIndex = target.slideIndex;
  renderModuleList();
  loadModule(viewerModules);
};

const renderReplayHeader = () => {
  if (!isReplayMode() || !moduleSelection || !replayStatusCard || !replayStatusGrid || !replayTimelineCard || !replayTimelineList) {
    return;
  }
  moduleSelection.classList.add('replay-mode');
  replayStatusCard.hidden = false;
  replayTimelineCard.hidden = false;
  const course = replayPayload?.course || {};
  const student = replayPayload?.student || {};
  replayStatusGrid.innerHTML = `
    <div>
      <strong>${escapeHtml(student.fullName || 'Aluno')}</strong>
      <span>${escapeHtml(student.email || 'Sem email')}</span>
    </div>
    <div>
      <strong>${escapeHtml(course.title || 'Curso')}</strong>
      <span>${escapeHtml(course.currentModule || 'Sem módulo atual informado')}</span>
    </div>
    <div>
      <strong>${escapeHtml(course.progress?.interactive_step || '0')}</strong>
      <span>Progresso interativo salvo</span>
    </div>
    <div>
      <strong>${formatReplayDate(course.updatedAt)}</strong>
      <span>Última atualização registrada</span>
    </div>
  `;
  if (!replayEvents.length) {
    replayTimelineList.innerHTML = '<p class="muted">Nenhum passo visual foi salvo ainda para este aluno.</p>';
    return;
  }
  replayTimelineList.innerHTML = replayEvents
    .map(
      (event, index) => `
        <button type="button" class="replay-timeline-item ${viewerState.replayEventIndex === index ? 'active' : ''}" data-replay-index="${index}">
          <strong>${escapeHtml(formatProgressEventType(event.type))}</strong>
          <span>${escapeHtml(event.summary || event.slideTitle || 'Evento sem resumo')}</span>
          <small>${escapeHtml(event.moduleTitle || 'Módulo')} • ${escapeHtml(event.slideTitle || event.slideId || 'Slide')} • ${escapeHtml(formatReplayDate(event.createdAt))}</small>
        </button>
      `
    )
    .join('');
  replayTimelineList.querySelectorAll('[data-replay-index]').forEach((button) =>
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-replay-index'));
      if (Number.isFinite(index)) {
        jumpToReplayEvent(index);
      }
    })
  );
};

const renderReplayEventOverlay = () => {
  if (!isReplayMode() || !moduleStage) {
    return;
  }
  const wrapper = ensureStageContentWrapper();
  if (!wrapper) {
    return;
  }
  wrapper.querySelector('.replay-overlay')?.remove();
  const event = replayEvents[viewerState.replayEventIndex];
  if (!event) {
    return;
  }
  const target = getReplayEventTarget(event);
  const currentModule = getCurrentModule();
  if (!target || target.module.id !== currentModule?.id || target.slideIndex !== viewerState.slideIndex) {
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'replay-overlay';
  const hasCoords = Number.isFinite(Number(event.details?.x)) && Number.isFinite(Number(event.details?.y));
  if (event.elementId && typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    const targetNode = wrapper.querySelector(`[data-element-id="${CSS.escape(String(event.elementId))}"]`);
    if (targetNode instanceof HTMLElement) {
      const box = document.createElement('div');
      box.className = 'replay-overlay-target';
      box.style.left = `${targetNode.offsetLeft - 6}px`;
      box.style.top = `${targetNode.offsetTop - 6}px`;
      box.style.width = `${targetNode.offsetWidth + 12}px`;
      box.style.height = `${targetNode.offsetHeight + 12}px`;
      overlay.appendChild(box);
    }
  }
  if (hasCoords) {
    const point = document.createElement('div');
    point.className = 'replay-overlay-point';
    point.style.left = `${Number(event.details.x)}px`;
    point.style.top = `${Number(event.details.y)}px`;
    overlay.appendChild(point);
  }
  const callout = document.createElement('div');
  callout.className = 'replay-overlay-callout';
  callout.style.left = `${Math.min(Math.max(Number(event.details?.x) || 24, 24), (moduleStageDimensions?.width || DEFAULT_STAGE_SIZE.width) - 330)}px`;
  callout.style.top = `${Math.min(Math.max((Number(event.details?.y) || 24) + 24, 24), (moduleStageDimensions?.height || DEFAULT_STAGE_SIZE.height) - 120)}px`;
  callout.innerHTML = `
    <strong style="display:block; margin-bottom:0.25rem;">${escapeHtml(formatProgressEventType(event.type))}</strong>
    <span>${escapeHtml(event.summary || 'Sem resumo')}</span>
  `;
  overlay.appendChild(callout);
  wrapper.appendChild(overlay);
};

const getSlideProgressKey = (moduleId, slideKey) => getQuizAttemptKey(moduleId, slideKey, '__slide__');
const getButtonRuleKey = (moduleId, slideKey, ruleGroup) => `${moduleId || 'module'}::${slideKey || 'slide'}::rule::${ruleGroup || 'group'}`;
const getInputResponseKey = (moduleId, slideKey, elementId) => `${moduleId || 'module'}::${slideKey || 'slide'}::${elementId || 'input'}`;

const getSlideProgressState = (moduleId, slideKey) =>
  viewerQuizAttempts.get(getSlideProgressKey(moduleId, slideKey)) || null;

const setSlideProgressState = (moduleId, slideKey, value) => {
  viewerQuizAttempts.set(getSlideProgressKey(moduleId, slideKey), value);
  persistQuizAttempts();
};

const getButtonRuleState = (moduleId, slideKey, ruleGroup) =>
  viewerButtonRuleState.get(getButtonRuleKey(moduleId, slideKey, ruleGroup)) || null;

const setButtonRuleState = (moduleId, slideKey, ruleGroup, value) => {
  viewerButtonRuleState.set(getButtonRuleKey(moduleId, slideKey, ruleGroup), value);
  persistButtonRules();
};

const getInputResponseState = (moduleId, slideKey, elementId, module = getCurrentModule()) => {
  const progress = getCourseProgressState(module);
  const responseMap = progress.input_responses && typeof progress.input_responses === 'object' ? progress.input_responses : {};
  const key = getInputResponseKey(moduleId, slideKey, elementId);
  const entry = responseMap[key];
  return entry && typeof entry === 'object' ? entry : null;
};

const syncViewerFloatingRuleButtonState = (module, slide, elementId) => {
  if (!slide || !elementId) {
    return;
  }
  const element = slide.elements?.find((item) => item?.id === elementId && item.type === 'floatingButton');
  const node = findStageNodeByElementId(elementId);
  if (!element || !node) {
    return;
  }
  const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
  normalizeInteractionTriggers(element);
  const isCompleted = (element.interactionTriggers || []).some((trigger) => {
    const config = normalizeFloatingRuleConfig(trigger?.actionConfig || {});
    const ruleState =
      config.requireAllButtonsInGroup && config.ruleGroup
        ? getButtonRuleState(module?.id, slideKey, config.ruleGroup)
        : null;
    const clickedIds = new Set(Array.isArray(ruleState?.clickedButtonIds) ? ruleState.clickedButtonIds : []);
    return clickedIds.has(elementId);
  });
  node.classList.toggle('floating-button-completed', isCompleted);
};

const getSlideProgressSnapshot = (module, slide, slideIndex = viewerState.slideIndex) => {
  const slideKey = getStableSlideKey(slide, slideIndex);
  const persistedModuleEntry = getModuleProgressEntry(module);
  const persistedStats =
    persistedModuleEntry?.slideStats && typeof persistedModuleEntry.slideStats === 'object'
      ? persistedModuleEntry.slideStats[slideKey]
      : null;
  const localState = getSlideProgressState(module?.id, slideKey);
  return {
    viewed: Boolean(localState?.viewed || persistedStats?.viewed),
    completed: Boolean(localState?.completed || persistedStats?.completed),
    viewedSeconds: Math.max(Number(localState?.viewedSeconds) || 0, Number(persistedStats?.viewedSeconds) || 0),
    updatedAt: localState?.updatedAt || persistedStats?.updatedAt || null
  };
};

const hasAnsweredRequiredQuizzes = (module, slide, slideIndex = viewerState.slideIndex) => {
  if (!slide?.requireQuizCompletion) {
    return true;
  }
  const quizzes = (slide.elements || []).filter((element) => element.type === 'quiz');
  if (!quizzes.length) {
    return true;
  }
  const slideKey = getStableSlideKey(slide, slideIndex);
  return quizzes.every((quiz, quizIndex) => {
    const attempt = getQuizAttemptState(module?.id, slideKey, getStableQuizKey(quiz, quizIndex));
    return Boolean(attempt?.answered);
  });
};

const hasCompletedNativeVideos = (module, slide, slideIndex = viewerState.slideIndex) => {
  const videos = (slide?.elements || []).filter((element) => element.type === 'video' && element.provider !== 'youtube');
  if (!videos.length) {
    return true;
  }
  const slideKey = getStableSlideKey(slide, slideIndex);
  const videoProgressMap = getCourseProgressState(module).video_progress || {};
  return videos.every((video) => {
    const progressKey = `${module?.id || 'module'}::${slideKey}::${video?.id || 'video'}`;
    const entry = videoProgressMap[progressKey];
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    const durationSeconds = Math.max(Number(entry.durationSeconds) || 0, 0);
    const watchedSeconds = Math.max(Number(entry.watchedSeconds) || 0, 0);
    if (Boolean(entry.completed)) {
      return true;
    }
    return durationSeconds > 0 && watchedSeconds >= durationSeconds * MIN_VIDEO_COMPLETION_RATIO;
  });
};

const isSlideCompletedByRules = (module, slide, slideIndex = viewerState.slideIndex, viewedSeconds = 0) => {
  if (!slide) {
    return false;
  }
  if (viewedSeconds < MIN_SLIDE_VIEW_SECONDS) {
    return false;
  }
  if (!hasAnsweredRequiredQuizzes(module, slide, slideIndex)) {
    return false;
  }
  if (!hasCompletedNativeVideos(module, slide, slideIndex)) {
    return false;
  }
  return true;
};

const normalizeFloatingRuleConfig = (config = {}) => ({
  ...config,
  ruleGroup: typeof config.ruleGroup === 'string' ? config.ruleGroup.trim() : '',
  requireAllButtonsInGroup: Boolean(config.requireAllButtonsInGroup)
});

const normalizeDetectorAcceptedDragValue = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return DETECTOR_ACCEPT_ANY;
  }
  const normalized = value.trim();
  if (normalized === DETECTOR_ACCEPT_ANY) {
    return normalized;
  }
  if (normalized.startsWith(DETECTOR_ACCEPT_TYPE_PREFIX) || normalized.startsWith(DETECTOR_ACCEPT_ELEMENT_PREFIX)) {
    return normalized;
  }
  return DETECTOR_ACCEPT_ANY;
};

const normalizeDetectorConfig = (config = {}) => ({
  ...config,
  detectorAcceptedDrag: normalizeDetectorAcceptedDragValue(config.detectorAcceptedDrag),
  detectorMinMatchCount: Math.max(1, Number(config.detectorMinMatchCount) || 1),
  detectorTriggerOnce: Boolean(config.detectorTriggerOnce)
});

const doesElementMatchDetectorRule = (element, acceptedDrag = DETECTOR_ACCEPT_ANY) => {
  if (!element || !canStudentDragElement(element)) {
    return false;
  }
  const normalizedRule = normalizeDetectorAcceptedDragValue(acceptedDrag);
  if (normalizedRule === DETECTOR_ACCEPT_ANY) {
    return true;
  }
  if (normalizedRule.startsWith(DETECTOR_ACCEPT_TYPE_PREFIX)) {
    return element.type === normalizedRule.slice(DETECTOR_ACCEPT_TYPE_PREFIX.length);
  }
  if (normalizedRule.startsWith(DETECTOR_ACCEPT_ELEMENT_PREFIX)) {
    return element.id === normalizedRule.slice(DETECTOR_ACCEPT_ELEMENT_PREFIX.length);
  }
  return true;
};

const getDetectorTriggerStateKey = (moduleId, slideKey, detectorId) =>
  `${moduleId || 'module'}::${slideKey || 'slide'}::${detectorId || 'detector'}`;

const getDetectorMatchingElements = (detector, slide) => {
  if (!detector || !slide) {
    return [];
  }
  normalizeInteractionTriggers(detector);
  const detectorBox = getElementRuntimeBox(detector);
  const config = normalizeDetectorConfig(detector.interactionTriggers[0]?.actionConfig || detector.actionConfig || {});
  return (slide.elements || []).filter((item) => {
    if (!item || item.id === detector.id || !doesElementMatchDetectorRule(item, config.detectorAcceptedDrag)) {
      return false;
    }
    return boxesOverlap(detectorBox, getElementRuntimeBox(item));
  });
};

const evaluateDetectorActivation = (detector, draggedElement, slide, moduleId, slideKey) => {
  if (!detector || !draggedElement || !slide) {
    return { ready: false, reason: 'invalid' };
  }
  normalizeInteractionTriggers(detector);
  const config = normalizeDetectorConfig(detector.interactionTriggers[0]?.actionConfig || detector.actionConfig || {});
  if (!doesElementMatchDetectorRule(draggedElement, config.detectorAcceptedDrag)) {
    return { ready: false, reason: 'mismatch' };
  }
  const stateKey = getDetectorTriggerStateKey(moduleId, slideKey, detector.id);
  if (config.detectorTriggerOnce && viewerTriggeredDetectors.has(stateKey)) {
    return { ready: false, reason: 'already-triggered' };
  }
  const matchingElements = getDetectorMatchingElements(detector, slide);
  if (matchingElements.length < config.detectorMinMatchCount) {
    return { ready: false, reason: 'missing-elements', matchingCount: matchingElements.length };
  }
  return { ready: true, stateKey, config };
};

const getReplaceTextMode = (value) => (value === REPLACE_COUNTER_MODE ? REPLACE_COUNTER_MODE : REPLACE_TEXT_MODE);

const setElementTextualContent = (element, value) => {
  if (!element || !REPLACEABLE_TEXT_TYPES.has(element.type)) {
    return false;
  }
  if (element.type === 'floatingButton') {
    element.label = value;
  } else {
    element.content = value;
  }
  return true;
};

const getViewerReplaceCounterKey = (moduleId, slideKey, sourceId, targetId) =>
  `${moduleId || 'module'}::${slideKey || 'slide'}::${sourceId || 'source'}::${targetId || 'target'}`;

const executeReplaceTextAction = (sourceElement, safeConfig, currentSlide, moduleId, slideKey) => {
  const target = currentSlide?.elements?.find((item) => item?.id === safeConfig.targetElementId);
  if (!target || !REPLACEABLE_TEXT_TYPES.has(target.type)) {
    return false;
  }
  const mode = getReplaceTextMode(safeConfig.replaceMode);
  if (mode === REPLACE_COUNTER_MODE) {
    const counterKey = getViewerReplaceCounterKey(moduleId, slideKey, sourceElement?.id, target.id);
    const currentValue = viewerReplaceCounters.has(counterKey)
      ? viewerReplaceCounters.get(counterKey)
      : Number(safeConfig.replaceCounterStart) || 1;
    setElementTextualContent(target, `${safeConfig.replaceText || ''}${currentValue}`);
    viewerReplaceCounters.set(counterKey, currentValue + (Number(safeConfig.replaceCounterStep) || 1));
    return true;
  }
  return setElementTextualContent(target, safeConfig.replaceText || '');
};

const normalizeElementAnimation = (element) => {
  if (!element || !ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    return;
  }
  const animationType = String(element.animationType || 'none').trim();
  element.animationType = ANIMATION_PRESETS.has(animationType) ? animationType : 'none';
  const duration = Number(element.animationDuration);
  const delay = Number(element.animationDelay);
  element.animationDuration = Number.isFinite(duration) ? Math.min(Math.max(duration, 0.2), 20) : 1.2;
  element.animationDelay = Number.isFinite(delay) ? Math.min(Math.max(delay, 0), 20) : 0;
  element.animationLoop = Boolean(element.animationLoop);
  if (element.animationType === MOTION_ANIMATION_TYPE) {
    const frames = Array.isArray(element.motionFrames) ? element.motionFrames : [];
    element.motionFrames = frames
      .map((frame) => ({
        x: Number.isFinite(Number(frame?.x)) ? Number(frame.x) : Number(element.x) || 0,
        y: Number.isFinite(Number(frame?.y)) ? Number(frame.y) : Number(element.y) || 0,
        width: Math.max(40, Number(frame?.width) || Number(element.width) || 40),
        height: Math.max(40, Number(frame?.height) || Number(element.height) || 40),
        rotation: Number.isFinite(Number(frame?.rotation)) ? ((Number(frame.rotation) % 360) + 360) % 360 : Number(element.rotation) || 0,
        opacity: Number.isFinite(Number(frame?.opacity)) ? Math.min(Math.max(Number(frame.opacity), 0), 1) : 1
      }))
      .filter((frame) => Number.isFinite(frame.x) && Number.isFinite(frame.y));
  }
};

const getElementRenderState = (element) => {
  normalizeElementAnimation(element);
  if (element?.animationType === MOTION_ANIMATION_TYPE && Array.isArray(element.motionFrames) && element.motionFrames.length) {
    return element.motionFrames[0];
  }
  return {
    x: Number(element?.x) || 0,
    y: Number(element?.y) || 0,
    width: Number(element?.width) || 0,
    height: Number(element?.height) || 0,
    rotation: Number(element?.rotation) || 0,
    opacity: getElementBaseOpacity(element)
  };
};

const buildRecordedMotionKeyframes = (element) => {
  normalizeElementAnimation(element);
  if (element?.animationType !== MOTION_ANIMATION_TYPE || !Array.isArray(element.motionFrames) || element.motionFrames.length < 2) {
    return [];
  }
  return element.motionFrames.map((frame, index, frames) => ({
    left: `${frame.x}px`,
    top: `${frame.y}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    opacity: frame.opacity,
    transform: `rotate(${frame.rotation}deg)`,
    offset: frames.length <= 1 ? 1 : index / (frames.length - 1)
  }));
};

const stopRecordedMotionAnimation = (node) => {
  if (node?._motionAnimation?.cancel) {
    node._motionAnimation.cancel();
  }
  if (node) {
    node._motionAnimation = null;
  }
};

const registerFloatingRuleClick = (module, slide, element, trigger) => {
  const config = normalizeFloatingRuleConfig(trigger?.actionConfig || {});
  if (!module?.id || !slide || !element?.id || !config.requireAllButtonsInGroup) {
    return { ready: true, remaining: 0 };
  }
  if (!config.ruleGroup) {
    return { ready: false, remaining: 1, invalid: true };
  }
  const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
  const requiredButtons = (slide.elements || []).filter((item) => {
    if (item?.type !== 'floatingButton' || !item?.id) {
      return false;
    }
    normalizeInteractionTriggers(item);
    return (item.interactionTriggers || []).some((candidateTrigger) => {
      const itemConfig = normalizeFloatingRuleConfig(candidateTrigger?.actionConfig || {});
      return itemConfig.requireAllButtonsInGroup && itemConfig.ruleGroup === config.ruleGroup;
    });
  });
  if (requiredButtons.length < 2) {
    return { ready: false, remaining: 1, invalid: true };
  }
  const previousState = getButtonRuleState(module.id, slideKey, config.ruleGroup);
  const clickedIds = new Set(Array.isArray(previousState?.clickedButtonIds) ? previousState.clickedButtonIds : []);
  clickedIds.add(element.id);
  setButtonRuleState(module.id, slideKey, config.ruleGroup, {
    clickedButtonIds: Array.from(clickedIds),
    updatedAt: new Date().toISOString()
  });
  const remaining = Math.max(0, requiredButtons.length - clickedIds.size);
  return {
    ready: remaining === 0,
    remaining,
    total: requiredButtons.length
  };
};

const getModuleInteractiveProgress = (module) => {
  const slides = module?.builder_data?.slides || [];
  const viewedSlides = [];
  const completedSlides = [];
  const slideStats = {};
  slides.forEach((slide, index) => {
    const slideKey = getStableSlideKey(slide, index);
    const slideState = getSlideProgressSnapshot(module, slide, index);
    slideStats[slideKey] = {
      viewed: Boolean(slideState.viewed),
      completed: Boolean(slideState.completed),
      viewedSeconds: Number((Number(slideState.viewedSeconds) || 0).toFixed(2)),
      updatedAt: slideState.updatedAt || null
    };
    if (slideState.viewed || slideState.viewedSeconds > 0) {
      viewedSlides.push(slideKey);
    }
    if (slideState.completed) {
      completedSlides.push(slideKey);
    }
  });
  return {
    moduleId: module?.id || '',
    totalSlides: slides.length,
    viewedSlides,
    completedSlides,
    slideStats,
    isCompleted: slides.length > 0 && completedSlides.length >= slides.length,
    lastSlideId: getStableSlideKey(getCurrentSlide(), viewerState.slideIndex)
  };
};

const persistCurrentSlideProgress = async ({ completed = false, force = false } = {}) => {
  const module = getCurrentModule();
  const slide = getCurrentSlide();
  if (!module?.id || !slide) {
    return;
  }
  if (isReplayMode()) {
    return;
  }
  const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
  const previous = getSlideProgressSnapshot(module, slide, viewerState.slideIndex);
  const liveViewedSeconds = currentSlideEnteredAt
    ? Math.max(0, (Date.now() - currentSlideEnteredAt) / 1000)
    : 0;
  const viewedSeconds = Math.max(previous.viewedSeconds || 0, liveViewedSeconds);
  const nextState = {
    viewed: Boolean(previous.viewed || viewedSeconds > 0),
    completed: Boolean(previous.completed || completed || isSlideCompletedByRules(module, slide, viewerState.slideIndex, viewedSeconds)),
    viewedSeconds: Number(viewedSeconds.toFixed(2)),
    updatedAt: new Date().toISOString()
  };
  const changed =
    nextState.viewed !== Boolean(previous.viewed) ||
    nextState.completed !== Boolean(previous.completed) ||
    Math.abs(nextState.viewedSeconds - (Number(previous.viewedSeconds) || 0)) >= 0.25;
  if (!changed && !force) {
    return;
  }
  setSlideProgressState(module.id, slideKey, nextState);
  if (viewerState.isPublic || isReplayMode() || !module.courseId) {
    return;
  }
  const interactiveProgress = getModuleInteractiveProgress(module);
  const metrics = getModuleQuizMetrics(module);
  try {
    const response = await authorizedFetch('/api/student/progress', {
      method: 'POST',
      body: JSON.stringify({
        courseId: module.courseId,
        type: 'interactive',
        currentModule: module.title,
        grade: metrics.gradePercent,
        interactiveProgress
      })
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result?.interactiveProgress) {
      syncCourseProgressState(module.courseId, {
        interactive_progress: result.interactiveProgress,
        interactive_step: result.interactiveStep || getCourseProgressState(module).interactive_step
      });
    }
  } catch (error) {
    console.error('Não foi possível salvar o progresso interativo do slide.', error);
  }
};

const clearCurrentSlideProgressTimer = () => {
  if (currentSlideProgressTimer) {
    window.clearTimeout(currentSlideProgressTimer);
    currentSlideProgressTimer = null;
  }
};

const scheduleCurrentSlideProgressTimer = () => {
  clearCurrentSlideProgressTimer();
  currentSlideProgressTimer = window.setTimeout(async () => {
    await persistCurrentSlideProgress({ force: true });
    updateNavigationState();
  }, MIN_SLIDE_VIEW_SECONDS * 1000 + 120);
};

const persistModuleQuizMetrics = async () => {
  const module = getCurrentModule();
  if (viewerState.isPublic || isReplayMode() || !module?.courseId) return;
  const metrics = getModuleQuizMetrics(module);
  try {
    await authorizedFetch('/api/student/progress', {
      method: 'POST',
      body: JSON.stringify({
        courseId: module.courseId,
        type: 'interactive',
        value: `${viewerState.slideIndex + 1}`,
        currentModule: module.title,
        grade: metrics.gradePercent
      })
    });
  } catch (error) {
    console.error('Não foi possível salvar a nota do quiz.', error);
  }
};

const persistVideoProgress = async (position, { force = false, videoProgress = null } = {}) => {
  const module = getCurrentModule();
  const safePosition = Math.max(0, Number(position) || 0);
  if (!module?.id) {
    return;
  }
  if (viewerState.isPublic || isReplayMode()) {
    lastSavedVideoPosition = safePosition;
    return;
  }
  if (!module?.courseId) {
    return;
  }
  if (!force && safePosition <= lastSavedVideoPosition + 4) {
    return;
  }
  try {
    await authorizedFetch('/api/student/progress', {
      method: 'POST',
      body: JSON.stringify({
        courseId: module.courseId,
        type: 'video',
        value: safePosition,
        currentModule: module.title,
        videoProgress
      })
    });
    lastSavedVideoPosition = safePosition;
    const nextVideoProgressMap =
      videoProgress?.key
        ? {
          ...((getCourseProgressState(module).video_progress && typeof getCourseProgressState(module).video_progress === 'object')
            ? getCourseProgressState(module).video_progress
            : {}),
          [videoProgress.key]: {
            ...(((getCourseProgressState(module).video_progress || {})[videoProgress.key] &&
              typeof (getCourseProgressState(module).video_progress || {})[videoProgress.key] === 'object')
              ? (getCourseProgressState(module).video_progress || {})[videoProgress.key]
              : {}),
            watchedSeconds: Math.max(
              Number(((getCourseProgressState(module).video_progress || {})[videoProgress.key] || {}).watchedSeconds) || 0,
              Number(videoProgress.watchedSeconds) || 0
            ),
            durationSeconds: Math.max(
              Number(((getCourseProgressState(module).video_progress || {})[videoProgress.key] || {}).durationSeconds) || 0,
              Number(videoProgress.durationSeconds) || 0
            ),
            completed: Boolean(
              ((getCourseProgressState(module).video_progress || {})[videoProgress.key] || {}).completed || videoProgress.completed
            ),
            moduleId: videoProgress.moduleId || null,
            slideId: videoProgress.slideId || null,
            elementId: videoProgress.elementId || null,
            updatedAt: new Date().toISOString()
          }
        }
        : getCourseProgressState(module).video_progress;
    syncCourseProgressState(module.courseId, {
      video_position: safePosition,
      video_progress: nextVideoProgressMap
    });
  } catch (error) {
    console.error('Não foi possível salvar o progresso do vídeo.', error);
  }
};

const getVideoElementProgressId = (slide, element) => {
  const explicitId = typeof element?.id === 'string' ? element.id.trim() : '';
  if (explicitId) {
    return explicitId;
  }
  const elements = Array.isArray(slide?.elements) ? slide.elements : [];
  const fallbackIndex = elements.indexOf(element);
  if (fallbackIndex >= 0) {
    return `video-index-${fallbackIndex}`;
  }
  return 'video-index-unknown';
};

const getVideoProgressKey = (module, slide, element) =>
  `${module?.id || 'module'}::${getStableSlideKey(slide, viewerState.slideIndex)}::${getVideoElementProgressId(slide, element)}`;

const getSavedVideoPositionForElement = (module, slide, element) => {
  const progress = getCourseProgressState(module);
  const progressMap = progress?.video_progress && typeof progress.video_progress === 'object' ? progress.video_progress : {};
  const key = getVideoProgressKey(module, slide, element);
  const entry = progressMap[key];
  if (!entry || typeof entry !== 'object') {
    return 0;
  }
  return Math.max(0, Number(entry.watchedSeconds) || 0);
};

const attachVideoProgressTracking = (videoNode, element, slide) => {
  if (!(videoNode instanceof HTMLVideoElement)) {
    return;
  }
  const module = getCurrentModule();
  const savedPosition = getSavedVideoPositionForElement(module, slide, element);
  videoNode.addEventListener('loadedmetadata', () => {
    const duration = Math.max(0, Number(videoNode.duration) || 0);
    if (duration > 0 && savedPosition > 0 && savedPosition < duration) {
      videoNode.currentTime = savedPosition;
      lastTrackedVideoPosition = savedPosition;
      lastSavedVideoPosition = savedPosition;
    }
  });
  videoNode.addEventListener('timeupdate', () => {
    const currentTime = Math.max(0, Number(videoNode.currentTime) || 0);
    lastTrackedVideoPosition = currentTime;
    if (currentTime >= lastSavedVideoPosition + 5) {
      persistVideoProgress(currentTime, { videoProgress: buildVideoProgressPayload(element, slide, videoNode) });
    }
  });
  videoNode.addEventListener('pause', () => {
    persistVideoProgress(videoNode.currentTime, {
      force: true,
      videoProgress: buildVideoProgressPayload(element, slide, videoNode)
    });
    persistCurrentSlideProgress({ force: true });
  });
  videoNode.addEventListener('ended', () => {
    persistVideoProgress(videoNode.duration || videoNode.currentTime, {
      force: true,
      videoProgress: buildVideoProgressPayload(element, slide, videoNode)
    });
    persistCurrentSlideProgress({ completed: true, force: true });
    updateNavigationState();
  });
};

const buildVideoProgressPayload = (element, slide, videoNode) => {
  const module = getCurrentModule();
  return {
    key: getVideoProgressKey(module, slide, element),
    moduleId: module?.id || '',
    slideId: getStableSlideKey(slide, viewerState.slideIndex),
    elementId: getVideoElementProgressId(slide, element),
    watchedSeconds: Math.max(0, Number(videoNode?.currentTime) || 0),
    durationSeconds: Math.max(0, Number(videoNode?.duration) || 0),
    completed: Boolean(videoNode?.ended || ((Number(videoNode?.duration) || 0) > 0 && (Number(videoNode?.currentTime) || 0) >= (Number(videoNode?.duration) || 0) * 0.9))
  };
};

const persistQuizAttemptToBackend = async ({ module, slideKey, quizKey, attempt }) => {
  if (viewerState.isPublic || isReplayMode() || !module?.courseId || !quizKey || !slideKey || !attempt) {
    return;
  }
  try {
    const response = await authorizedFetch('/api/student/progress', {
      method: 'POST',
      body: JSON.stringify({
        courseId: module.courseId,
        type: 'interactive',
        value: `${viewerState.slideIndex + 1}`,
        currentModule: module.title,
        grade: getModuleQuizMetrics(module).gradePercent,
        interactiveProgress: getModuleInteractiveProgress(module),
        quizAttempt: {
          key: getQuizAttemptKey(module.id, slideKey, quizKey),
          answered: Boolean(attempt.answered),
          selectedIndex: attempt.selectedIndex,
          isCorrect: Boolean(attempt.isCorrect)
        }
      })
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result?.quizAttempts && typeof result.quizAttempts === 'object') {
      Object.entries(result.quizAttempts).forEach(([attemptKey, attemptValue]) => {
        if (attemptKey && attemptValue && typeof attemptValue === 'object') {
          viewerQuizAttempts.set(attemptKey, attemptValue);
        }
      });
      persistQuizAttempts();
    }
    if (response.ok && result?.interactiveProgress) {
      syncCourseProgressState(module.courseId, {
        interactive_progress: result.interactiveProgress,
        interactive_step: result.interactiveStep || getCourseProgressState(module).interactive_step
      });
    }
  } catch (error) {
    console.error('Não foi possível persistir a tentativa do quiz.', error);
  }
};

const persistInputResponseToBackend = async ({ module, slide, element, response, matched }) => {
  if (viewerState.isPublic || isReplayMode() || !module?.courseId || !element?.id || !slide || !response) {
    return { ok: false };
  }
  const inputKey = getInputResponseKey(module.id, getStableSlideKey(slide, viewerState.slideIndex), element.id);
  const payload = {
    key: inputKey,
    moduleId: module.id,
    moduleTitle: module.title,
    slideId: getStableSlideKey(slide, viewerState.slideIndex),
    slideTitle: slide?.title || '',
    elementId: element.id,
    elementType: 'input',
    text: response.text || '',
    image: response.image || '',
    audio: response.audio || '',
    matched
  };
  try {
    const progressResponse = await authorizedFetch('/api/student/progress', {
      method: 'POST',
      body: JSON.stringify({
        courseId: module.courseId,
        type: 'interactive',
        currentModule: module.title,
        grade: getModuleQuizMetrics(module).gradePercent,
        interactiveProgress: getModuleInteractiveProgress(module),
        inputResponse: payload,
        progressEvent: {
          type: 'text_input',
          slideId: payload.slideId,
          slideTitle: payload.slideTitle,
          elementId: element.id,
          elementType: 'input',
          summary: matched
            ? `Enviou uma resposta válida em "${slide?.title || payload.slideId}".`
            : `Enviou uma resposta que ainda não corresponde ao esperado em "${slide?.title || payload.slideId}".`,
          details: {
            submittedText: response.text || '',
            matched,
            hasImage: Boolean(response.image),
            hasAudio: Boolean(response.audio)
          }
        }
      })
    });
    const result = await progressResponse.json().catch(() => null);
    if (progressResponse.ok) {
      syncCourseProgressState(module.courseId, {
        interactive_progress: result?.interactiveProgress || getCourseProgressState(module).interactive_progress,
        interactive_step: result?.interactiveStep || getCourseProgressState(module).interactive_step,
        input_responses: result?.inputResponses || getCourseProgressState(module).input_responses
      });
      return { ok: true, result };
    }
  } catch (error) {
    console.error('Não foi possível salvar a resposta do input.', error);
  }
  return { ok: false };
};

const readLocalFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Nao foi possivel ler o arquivo selecionado.'));
    reader.readAsDataURL(file);
  });

const compareInputImageWithReference = async ({ referenceImage, submittedImage }) => {
  const response = await authorizedFetch('/api/student/input/compare-image', {
    method: 'POST',
    body: JSON.stringify({
      referenceImage,
      submittedImage
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || 'Nao foi possivel comparar as imagens.');
  }
  return {
    matched: Boolean(payload?.matched),
    confidence: Math.max(0, Math.min(1, Number(payload?.confidence) || 0)),
    reason: String(payload?.reason || '').trim()
  };
};

const createInputElementNode = (element, slide, { runActions = null } = {}) => {
  normalizeInputElement(element);
  normalizeInteractionTriggers(element);
  const hasCompareText = Boolean(String(element.compareText || '').trim());
  const showTextField = !element.compareImageEnabled || hasCompareText;
  const referencePreview = element.compareImageEnabled && element.compareImageReference
    ? `<div class="builder-input-reference">
        <span class="builder-input-reference-label">Referencia visual</span>
        <img src="${escapeAttribute(element.compareImageReference)}" alt="Imagem de referencia" class="builder-input-reference-image" />
      </div>`
    : '';
  const textFieldMarkup = showTextField
    ? `<textarea class="builder-input-text" placeholder="${escapeHtml(element.placeholder || 'Digite sua resposta')}"></textarea>`
    : `<div class="builder-input-text builder-input-text-passive">Envie uma imagem para validar</div>`;
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
        <button type="button" class="primary-btn builder-input-submit" aria-label="${escapeAttribute(element.submitLabel || 'Enviar resposta')}" title="${escapeAttribute(element.submitLabel || 'Enviar resposta')}">
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
    if (!previewNode) {
      return;
    }
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
    setFileInputValue(imageInput);
    imageInput?.click();
  });
  audioBtn?.addEventListener('click', () => {
    setFileInputValue(audioInput);
    audioInput?.click();
  });
  imageInput?.addEventListener('change', async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    state.image = await readLocalFileAsDataUrl(file).catch(() => '');
    setFileInputValue(imageInput);
    refreshPreview();
  });
  audioInput?.addEventListener('change', async () => {
    const file = audioInput.files?.[0];
    if (!file) return;
    state.audio = await readLocalFileAsDataUrl(file).catch(() => '');
    setFileInputValue(audioInput);
    refreshPreview();
  });
  submitBtn?.addEventListener('click', async () => {
    if (showTextField && (!(textArea instanceof HTMLTextAreaElement) || !(submitBtn instanceof HTMLButtonElement))) {
      return;
    }
    const submittedText = textArea instanceof HTMLTextAreaElement ? textArea.value : '';
    const expected = normalizeInputCompareValue(element.compareText || '', Boolean(element.compareCaseSensitive));
    const received = normalizeInputCompareValue(submittedText, Boolean(element.compareCaseSensitive));
    const textMatched = !expected || received === expected;
    let imageMatched = true;
    let imageCompareReason = '';
    let imageCompareConfidence = 0;

    if (element.compareImageEnabled) {
      if (!state.image) {
        feedbackNode.textContent = 'Anexe uma imagem para validar sua resposta.';
        feedbackNode.className = 'builder-input-feedback error';
        playWrongAnswerSound();
        await persistInputResponseToBackend({
          module: getCurrentModule(),
          slide,
          element,
          response: {
            text: submittedText,
            image: '',
            audio: state.audio,
            textMatched,
            imageMatched: false
          },
          matched: false
        });
        return;
      }
      if (!element.compareImageReference || viewerState.isPublic || isReplayMode()) {
        imageMatched = false;
        imageCompareReason = 'A comparacao visual nao esta disponivel neste modo.';
      } else if (textMatched) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Comparando...';
        try {
          const compareResult = await compareInputImageWithReference({
            referenceImage: element.compareImageReference,
            submittedImage: state.image
          });
          imageMatched = Boolean(compareResult.matched);
          imageCompareReason = compareResult.reason || '';
          imageCompareConfidence = compareResult.confidence || 0;
        } catch (error) {
          feedbackNode.textContent = error.message || 'Nao foi possivel validar a imagem.';
          feedbackNode.className = 'builder-input-feedback error';
          submitBtn.disabled = false;
          submitBtn.textContent = element.submitLabel || 'Enviar resposta';
          return;
        }
        submitBtn.disabled = false;
        submitBtn.textContent = element.submitLabel || 'Enviar resposta';
      }
    }

    const matched = textMatched && imageMatched;
    if (feedbackNode) {
      feedbackNode.textContent = matched
        ? element.successMessage
        : imageCompareReason || element.errorMessage;
      feedbackNode.className = `builder-input-feedback ${matched ? 'success' : 'error'}`;
    }
    await persistInputResponseToBackend({
      module: getCurrentModule(),
      slide,
      element,
      response: {
        text: submittedText,
        image: state.image,
        audio: state.audio,
        textMatched,
        imageMatched,
        imageCompareReason,
        imageCompareConfidence
      },
      matched
    });
    if (matched && typeof runActions === 'function') {
      runActions({
        text: submittedText,
        image: state.image,
        audio: state.audio,
        matched,
        textMatched,
        imageMatched,
        imageCompareReason,
        imageCompareConfidence
      });
      playCorrectAnswerSound();
    } else {
      playWrongAnswerSound();
    }
  });
  return node;
};

const persistProgressEventToBackend = async (event) => {
  const module = getCurrentModule();
  if (viewerState.isPublic || isReplayMode() || !module?.courseId || !event || typeof event !== 'object') {
    return;
  }
  try {
    await authorizedFetch('/api/student/progress', {
      method: 'POST',
      body: JSON.stringify({
        courseId: module.courseId,
        type: 'interactive',
        currentModule: module.title,
        grade: getModuleQuizMetrics(module).gradePercent,
        interactiveProgress: getModuleInteractiveProgress(module),
        progressEvent: {
          ...event,
          moduleId: module.id,
          moduleTitle: module.title
        }
      })
    });
  } catch (error) {
    console.error('Não foi possível salvar o evento detalhado do aluno.', error);
  }
};

const legacyCanAdvanceFromCurrentSlide = (targetIndex) => {
  const module = getCurrentModule();
  const slides = module?.builder_data?.slides || [];
  const currentSlide = slides[viewerState.slideIndex];
  if (!module || !currentSlide || targetIndex <= viewerState.slideIndex) {
    return true;
  }
  if (targetIndex > viewerState.slideIndex + 1) {
    alert('Avance um slide por vez para liberar a próxima etapa.');
    return false;
  }
  const currentProgress = getSlideProgressSnapshot(module, currentSlide, viewerState.slideIndex);
  const liveViewedSeconds = currentSlideEnteredAt
    ? Math.max(Number(currentProgress.viewedSeconds) || 0, (Date.now() - currentSlideEnteredAt) / 1000)
    : Number(currentProgress.viewedSeconds) || 0;
  if (liveViewedSeconds < MIN_SLIDE_VIEW_SECONDS) {
    alert(`Permaneça pelo menos ${MIN_SLIDE_VIEW_SECONDS} segundos neste slide antes de avançar.`);
    return false;
  }
  if (!hasAnsweredRequiredQuizzes(module, currentSlide, viewerState.slideIndex)) {
    alert('Conclua o quiz deste slide antes de avançar.');
    return false;
  }
  if (!hasCompletedNativeVideos(module, currentSlide, viewerState.slideIndex)) {
    alert('Assista o vídeo deste slide até quase o final antes de avançar.');
    return false;
  }
  return true;
  if (!currentSlide.requireQuizCompletion) {
    return true;
  }
  const quizzes = (currentSlide.elements || []).filter((element) => element.type === 'quiz');
  if (!quizzes.length) {
    return true;
  }
  const pendingQuiz = quizzes.find((quiz) => {
    const quizIndex = quizzes.indexOf(quiz);
    const attempt = getQuizAttemptState(
      module.id,
      getStableSlideKey(currentSlide, viewerState.slideIndex),
      getStableQuizKey(quiz, quizIndex)
    );
    return !attempt?.answered;
  });
  if (!pendingQuiz) {
    return true;
  }
  alert('Conclua o quiz deste slide antes de avançar.');
  return false;
};

const canAdvanceFromCurrentSlide = (targetIndex) => {
  if (isReplayMode()) {
    return true;
  }
  const module = getCurrentModule();
  const slides = module?.builder_data?.slides || [];
  const currentSlide = slides[viewerState.slideIndex];
  if (!module || !currentSlide || targetIndex <= viewerState.slideIndex) {
    return true;
  }
  if (targetIndex > viewerState.slideIndex + 1) {
    alert('Avance um slide por vez para liberar a próxima etapa.');
    return false;
  }
  const currentProgress = getSlideProgressSnapshot(module, currentSlide, viewerState.slideIndex);
  const liveViewedSeconds = currentSlideEnteredAt
    ? Math.max(Number(currentProgress.viewedSeconds) || 0, (Date.now() - currentSlideEnteredAt) / 1000)
    : Number(currentProgress.viewedSeconds) || 0;
  if (liveViewedSeconds < MIN_SLIDE_VIEW_SECONDS) {
    alert(`Permaneça pelo menos ${MIN_SLIDE_VIEW_SECONDS} segundos neste slide antes de avançar.`);
    return false;
  }
  if (!hasAnsweredRequiredQuizzes(module, currentSlide, viewerState.slideIndex)) {
    alert('Conclua o quiz deste slide antes de avançar.');
    return false;
  }
  if (!hasCompletedNativeVideos(module, currentSlide, viewerState.slideIndex)) {
    alert('Assista o vídeo deste slide até quase o final antes de avançar.');
    return false;
  }
  return true;
};

const fitStageToViewport = (size) => {
  if (!moduleStage) return;
  const safeSize = size?.width && size?.height ? size : DEFAULT_STAGE_SIZE;
  const stageShell = moduleStage.closest('.stage-shell');
  const stageHeader = stageShell?.querySelector('.stage-header');
  const shellWidth = stageShell?.clientWidth || moduleStage.parentElement?.clientWidth || safeSize.width;
  const shellHeight = stageShell?.clientHeight || window.innerHeight;
  const isFullscreen = document.fullscreenElement === stageShell;
  const headerHeight = stageHeader?.offsetHeight || 0;
  const horizontalPadding = isFullscreen ? 16 : 0;
  const verticalGap = isFullscreen ? 16 : 36;
  const availableWidth = Math.max(320, shellWidth - horizontalPadding);
  const viewportLimit = Math.max(
    320,
    isFullscreen
      ? shellHeight - headerHeight - verticalGap
      : Math.min(shellHeight - headerHeight - 24, window.innerHeight - 260)
  );
  const aspectRatio = safeSize.width / safeSize.height;

  let nextWidth = availableWidth;
  let nextHeight = nextWidth / aspectRatio;

  if (nextHeight > viewportLimit) {
    nextHeight = viewportLimit;
    nextWidth = nextHeight * aspectRatio;
  }

  moduleStage.style.width = `${Math.min(nextWidth, availableWidth)}px`;
  moduleStage.style.height = `${nextHeight}px`;
  moduleStage.style.maxWidth = '100%';
  moduleStage.style.minHeight = '0';
  moduleStage.style.maxHeight = 'none';
  moduleStage.style.margin = '0 auto';
};

const disableNavigation = () => {
  prevBtn.disabled = true;
  nextBtn.disabled = true;
};

const updateNavigationState = () => {
  const module = getCurrentModule();
  const slides = module?.builder_data?.slides || [];
  if (!slides.length) {
    disableNavigation();
    return;
  }
  prevBtn.disabled = viewerState.slideIndex <= 0;
  nextBtn.disabled = viewerState.slideIndex >= slides.length - 1;
};

const getStageSize = () => {
  if (moduleStageDimensions?.width && moduleStageDimensions?.height) {
    return moduleStageDimensions;
  }
  return { ...DEFAULT_STAGE_SIZE };
};

const ensureStageContentWrapper = () => {
  if (!moduleStage) return null;
  let wrapper = moduleStage.querySelector('.stage-content-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'stage-content-wrapper';
    moduleStage.insertBefore(wrapper, moduleStageHint);
  }
  return wrapper;
};

const updateStageScale = () => {
  const wrapper = ensureStageContentWrapper();
  if (!wrapper || !moduleStage) return;
  const size = getStageSize();
  fitStageToViewport(size);
  wrapper.style.width = `${size.width}px`;
  wrapper.style.height = `${size.height}px`;
  const availableWidth = moduleStage.clientWidth || size.width;
  const availableHeight = moduleStage.clientHeight || size.height;
  const widthScale = size.width ? availableWidth / size.width : 1;
  const heightScale = size.height ? availableHeight / size.height : 1;
  const scale = Math.min(widthScale, heightScale);
  wrapper.style.transform = `scale(${scale})`;
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  moduleStage.style.setProperty('--module-stage-aspect', `${size.width} / ${size.height}`);
};

const buildBackgroundStyle = (element) => {
  if (element.useGradient && element.gradientStart && element.gradientEnd) {
    return `linear-gradient(135deg, ${element.gradientStart}, ${element.gradientEnd})`;
  }
  return element.solidColor || element.backgroundColor || '#f4f6ff';
};

const applyElementBackground = (node, element) => {
  const backgroundValue = buildBackgroundStyle(element);
  if (!backgroundValue) return;
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
      if (element.useGradient && String(backgroundValue).startsWith('linear-gradient')) {
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
  if (element.useGradient || String(backgroundValue).startsWith('linear-gradient')) {
    node.style.background = backgroundValue;
    node.style.backgroundColor = '';
    return;
  }
  node.style.background = backgroundValue;
  node.style.backgroundColor = backgroundValue;
};

const normalizeQuizElement = (element) => {
  if (!element || element.type !== 'quiz') {
    return;
  }
  element.question = element.question || 'Nova pergunta';
  const normalizedOptions = normalizeStringList(
    Array.isArray(element.options) && element.options.length
      ? element.options
      : (Array.isArray(element.quizOptions) ? element.quizOptions : [])
  );
  // Only set defaults if element has no options at all (new quiz)
  // Preserve existing options even if they become empty after normalization
  if (!Array.isArray(element.options) || !element.options.length) {
    element.options = normalizedOptions.length ? normalizedOptions : ['Opcao 1', 'Opcao 2', 'Opcao 3'];
  } else {
    element.options = normalizedOptions;
  }
  element.correctOption = Math.min(Math.max(Number(element.correctOption) || 0, 0), element.options.length - 1);
  element.successMessage = element.successMessage || 'Resposta correta!';
  element.errorMessage = element.errorMessage || 'Resposta incorreta. Tente novamente.';
  element.actionLabel = element.actionLabel || 'Validar resposta';
  element.quizBackgroundColor = element.quizBackgroundColor || '#ffffff';
  element.quizQuestionColor = element.quizQuestionColor || '#171934';
  element.quizOptionBackgroundColor = element.quizOptionBackgroundColor || '#f4f6ff';
  element.quizOptionTextColor = element.quizOptionTextColor || '#25284c';
  element.quizButtonBackgroundColor = element.quizButtonBackgroundColor || '#6d63ff';
  element.points = Math.max(1, Number(element.points) || 1);
  element.lockOnWrong = Boolean(element.lockOnWrong);
};

const createQuizNode = (element, slide) => {
  normalizeQuizElement(element);
  const module = getCurrentModule();
  const currentSlide = slide || getCurrentSlide();
  const quizIndex = (currentSlide?.elements || []).filter((item) => item.type === 'quiz').findIndex((item) => item === element);
  const slideKey = getStableSlideKey(currentSlide, viewerState.slideIndex);
  const quizKey = getStableQuizKey(element, Math.max(0, quizIndex));
  const attempt = getQuizAttemptState(module?.id, slideKey, quizKey);
  const node = document.createElement('div');
  node.className = 'builder-quiz-element';
  node.style.backgroundColor = element.quizBackgroundColor;
  node.innerHTML = `
    <p class="builder-quiz-question">${renderPlainTextHtml(element.question)}</p>
    <p class="builder-quiz-meta">Vale ${element.points} ponto${element.points === 1 ? '' : 's'}</p>
    <div class="builder-quiz-options">
      ${element.options
      .map(
        (option, index) => `
            <label class="builder-quiz-option">
              <input type="radio" name="quiz-viewer-${element.id}" value="${index}" />
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
  const radioInputs = Array.from(node.querySelectorAll(`input[name="quiz-viewer-${element.id}"]`));
  const applyLockedState = (locked, selectedIndex) => {
    radioInputs.forEach((input) => {
      input.disabled = locked;
      if (Number.isFinite(Number(selectedIndex))) {
        input.checked = Number(input.value) === Number(selectedIndex);
      }
    });
    node.classList.toggle('quiz-locked', Boolean(locked));
    if (actionBtn) {
      actionBtn.disabled = Boolean(locked);
    }
  };
  node.querySelector('.builder-quiz-question')?.style.setProperty('color', element.quizQuestionColor);
  node.querySelectorAll('.builder-quiz-option').forEach((optionNode) => {
    optionNode.style.backgroundColor = element.quizOptionBackgroundColor;
    optionNode.style.color = element.quizOptionTextColor;
  });
  if (attempt && Number.isFinite(Number(attempt.selectedIndex))) {
    const selectedInput = node.querySelector(`input[name="quiz-viewer-${element.id}"][value="${attempt.selectedIndex}"]`);
    if (selectedInput) {
      selectedInput.checked = true;
    }
  }
  if (actionBtn) {
    actionBtn.style.backgroundColor = element.quizButtonBackgroundColor;
    actionBtn.style.color = '#ffffff';
  }
  if (attempt?.answered) {
    feedbackNode.textContent = attempt.isCorrect ? element.successMessage : element.errorMessage;
    feedbackNode.className = `builder-quiz-feedback ${attempt.isCorrect ? 'success' : 'error'}`;
  }
  const shouldLock = Boolean(attempt?.answered && (attempt.isCorrect || (attempt.isCorrect === false && element.lockOnWrong)));
  if (shouldLock) {
    applyLockedState(true, attempt?.selectedIndex);
  }
  radioInputs.forEach((input) =>
    input.addEventListener('change', () => {
      const lockedAttempt = getQuizAttemptState(module?.id, slideKey, quizKey);
      const latestShouldLock = Boolean(
        lockedAttempt?.answered && (lockedAttempt.isCorrect || (lockedAttempt.isCorrect === false && element.lockOnWrong))
      );
      if (latestShouldLock) {
        applyLockedState(true, lockedAttempt?.selectedIndex);
      }
    })
  );
  node.querySelectorAll('.builder-quiz-option').forEach((optionNode) =>
    optionNode.addEventListener('click', (event) => {
      const lockedAttempt = getQuizAttemptState(module?.id, slideKey, quizKey);
      const latestShouldLock = Boolean(
        lockedAttempt?.answered && (lockedAttempt.isCorrect || (lockedAttempt.isCorrect === false && element.lockOnWrong))
      );
      if (latestShouldLock) {
        event.preventDefault();
        event.stopPropagation();
        applyLockedState(true, lockedAttempt?.selectedIndex);
      }
    })
  );
  actionBtn?.addEventListener('click', () => {
    const selected = node.querySelector(`input[name="quiz-viewer-${element.id}"]:checked`);
    if (!selected) {
      feedbackNode.textContent = 'Selecione uma resposta.';
      feedbackNode.className = 'builder-quiz-feedback error';
      return;
    }
    const isCorrect = Number(selected.value) === Number(element.correctOption);
    const nextAttempt = {
      answered: true,
      selectedIndex: Number(selected.value),
      isCorrect
    };
    setQuizAttemptState(module?.id, slideKey, quizKey, nextAttempt);
    feedbackNode.textContent = isCorrect ? element.successMessage : element.errorMessage;
    feedbackNode.className = `builder-quiz-feedback ${isCorrect ? 'success' : 'error'}`;
    if (isCorrect) {
      playCorrectAnswerSound();
    } else {
      playWrongAnswerSound();
    }
    if (isCorrect || element.lockOnWrong) {
      applyLockedState(true, nextAttempt.selectedIndex);
    }
    persistQuizAttemptToBackend({ module, slideKey, quizKey, attempt: nextAttempt });
    persistProgressEventToBackend({
      type: 'quiz_answer',
      slideId: slideKey,
      slideTitle: currentSlide?.title || '',
      elementId: element.id,
      elementType: 'quiz',
      summary: `${isCorrect ? 'Acertou' : 'Errou'} o quiz "${element.question || 'Pergunta'}".`,
      details: {
        quizQuestion: element.question || '',
        selectedOptionText: element.options?.[Number(selected.value)] || '',
        selectedIndex: Number(selected.value),
        correctOptionText: element.options?.[Number(element.correctOption)] || '',
        isCorrect,
        lockOnWrong: Boolean(element.lockOnWrong)
      }
    });
    persistModuleQuizMetrics();
    persistCurrentSlideProgress({ force: true });
    updateNavigationState();
  });
  return node;
};

const playCorrectAnswerSound = () => {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const audioContext = new AudioCtx();
  const notes = [
    { frequency: 523.25, duration: 0.12 },
    { frequency: 659.25, duration: 0.12 },
    { frequency: 783.99, duration: 0.18 }
  ];
  let startTime = audioContext.currentTime;
  notes.forEach((note) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note.frequency, startTime);
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.12, startTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + note.duration);
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + note.duration);
    startTime += note.duration * 0.9;
  });
};

const playWrongAnswerSound = () => {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const audioContext = new AudioCtx();
  const notes = [
    { frequency: 392.0, duration: 0.14 },
    { frequency: 329.63, duration: 0.16 }
  ];
  let startTime = audioContext.currentTime;
  notes.forEach((note) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(note.frequency, startTime);
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.1, startTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + note.duration);
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + note.duration);
    startTime += note.duration * 0.95;
  });
};

const getCurrentModule = () => viewerModules.find((mod) => mod.id === viewerState.moduleId);

const getYouTubeEmbedUrl = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    let videoId = '';
    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (host.includes('youtube.com')) {
      if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v') || '';
      } else if (url.pathname.startsWith('/shorts/')) {
        videoId = url.pathname.split('/')[2] || '';
      } else if (url.pathname.startsWith('/embed/')) {
        videoId = url.pathname.split('/')[2] || '';
      }
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
  } catch (error) {
    return null;
  }
};

const createRuntimeElement = (type, source, slide) => {
  const maxLayer = Math.max(0, ...(slide.elements || []).map((element) => Number(element.zIndex) || 0));
  const base = {
    id: `runtime-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    x: Math.max(0, Number(source.insertX) || 120),
    y: Math.max(0, Number(source.insertY) || 120),
    zIndex: maxLayer + 1,
    isRuntimeGenerated: true,
    runtimeSourceId: source.runtimeSourceId || '',
    runtimeActionType: source.runtimeActionType || ''
  };
  if (type === 'text') {
    return {
      ...base,
      content: source.text || 'Novo texto',
      width: Math.max(240, Number(source.insertWidth) || 320),
      height: Math.max(100, Number(source.insertHeight) || 140),
      fontSize: Math.max(10, Number(source.fontSize) || DEFAULT_INSERT_TEXT_STYLE.fontSize),
      fontFamily: source.fontFamily || DEFAULT_INSERT_TEXT_STYLE.fontFamily,
      fontWeight: source.fontWeight || DEFAULT_INSERT_TEXT_STYLE.fontWeight,
      textColor: source.textColor || DEFAULT_INSERT_TEXT_STYLE.textColor,
      backgroundColor: source.backgroundColor || DEFAULT_INSERT_TEXT_STYLE.backgroundColor,
      textAlign: source.textAlign || DEFAULT_INSERT_TEXT_STYLE.textAlign,
      ...(() => {
        const flags = getTextDecorationFlags(source, DEFAULT_INSERT_TEXT_STYLE);
        return {
          hasTextBackground: flags.hasTextBackground,
          hasTextBorder: flags.hasTextBorder,
          hasTextBlock: flags.legacyBlock
        };
      })()
    };
  }
  if (type === 'image') {
    return { ...base, src: source.url || '', width: Math.max(40, Number(source.insertWidth) || 280), height: Math.max(40, Number(source.insertHeight) || 180) };
  }
  if (type === 'audio') {
    return {
      ...base,
      src: source.url || '',
      width: Math.max(180, Number(source.insertWidth) || 260),
      height: Math.max(54, Number(source.insertHeight) || 70),
      audioVisible: typeof source.audioVisible === 'boolean' ? source.audioVisible : true,
      audioLoop: Boolean(source.audioLoop)
    };
  }
  if (type === 'video') {
    const embedSrc = getYouTubeEmbedUrl(source.url || '');
    return {
      ...base,
      src: source.url || '',
      width: Math.max(40, Number(source.insertWidth) || 320),
      height: Math.max(40, Number(source.insertHeight) || 190),
      ...(embedSrc ? { provider: 'youtube', embedSrc } : {})
    };
  }
  return {
    ...base,
    question: source.quizQuestion || source.question || 'Nova pergunta',
    options:
      Array.isArray(source.quizOptions) && source.quizOptions.length
        ? source.quizOptions
        : (Array.isArray(source.options) && source.options.length ? source.options : ['Opção 1', 'Opção 2']),
    correctOption: Math.max(0, Number.isFinite(Number(source.quizCorrectOption)) ? Number(source.quizCorrectOption) : (Number(source.correctOption) || 0)),
    successMessage: source.successMessage || 'Resposta correta!',
    errorMessage: source.errorMessage || 'Resposta incorreta. Tente novamente.',
    actionLabel: source.actionLabel || 'Validar resposta',
    quizBackgroundColor: source.quizBackgroundColor || '#ffffff',
    quizQuestionColor: source.quizQuestionColor || '#171934',
    quizOptionBackgroundColor: source.quizOptionBackgroundColor || '#f4f6ff',
    quizOptionTextColor: source.quizOptionTextColor || '#25284c',
    quizButtonBackgroundColor: source.quizButtonBackgroundColor || '#6d63ff',
    points: Math.max(1, Number(source.points) || 1),
    lockOnWrong: Boolean(source.lockOnWrong),
    width: Math.max(40, Number(source.insertWidth) || 420),
    height: Math.max(40, Number(source.insertHeight) || 280)
  };
};

const canStudentDragElement = (element) => STUDENT_DRAGGABLE_TYPES.has(element?.type) && Boolean(element?.studentCanDrag);

const getElementRuntimeBox = (element) => {
  const renderState = getElementRenderState(element);
  return {
    left: Number(renderState.x) || 0,
    top: Number(renderState.y) || 0,
    width: Math.max(40, Number(renderState.width) || 40),
    height: Math.max(40, Number(renderState.height) || 40)
  };
};

const boxesOverlap = (first, second) =>
  first.left < second.left + second.width &&
  first.left + first.width > second.left &&
  first.top < second.top + second.height &&
  first.top + first.height > second.top;

const findStageNodeByElementId = (elementId) => moduleStage?.querySelector(`[data-element-id="${elementId}"]`) || null;
const getStageMediaNode = (node) => {
  if (!node) return null;
  if (node instanceof HTMLAudioElement || node instanceof HTMLVideoElement) {
    return node;
  }
  return node.querySelector?.('audio, video') || null;
};

const getViewerMediaStateKey = (slideId = '', elementId = '') => `${slideId}::${elementId}`;
const getViewerTimedVideoTriggerKey = (slideId = '', elementId = '') => `${slideId}::${elementId}`;

const snapshotViewerMediaState = (slide) => {
  if (!slide?.id || !moduleStage) {
    return;
  }
  moduleStage.querySelectorAll('[data-element-id]').forEach((node) => {
    const elementId = node.getAttribute('data-element-id') || '';
    if (!elementId) {
      return;
    }
    const mediaNode = getStageMediaNode(node);
    if (mediaNode instanceof HTMLVideoElement || mediaNode instanceof HTMLAudioElement) {
      viewerMediaState.set(getViewerMediaStateKey(slide.id, elementId), {
        currentTime: Math.max(0, Number(mediaNode.currentTime) || 0),
        paused: mediaNode.paused
      });
    }
  });
};

const restoreViewerMediaState = (slide, element, node) => {
  if (!slide?.id || !element?.id) {
    return;
  }
  const mediaNode = getStageMediaNode(node);
  if (!(mediaNode instanceof HTMLVideoElement) && !(mediaNode instanceof HTMLAudioElement)) {
    return;
  }
  const state = viewerMediaState.get(getViewerMediaStateKey(slide.id, element.id));
  if (!state) {
    return;
  }
  const applyState = () => {
    if (Number.isFinite(state.currentTime) && state.currentTime > 0) {
      try {
        mediaNode.currentTime = state.currentTime;
      } catch (error) { }
    }
    if (state.paused === false) {
      mediaNode.play().catch(() => { });
    }
  };
  if (mediaNode.readyState >= 1) {
    applyState();
  } else {
    mediaNode.addEventListener('loadedmetadata', applyState, { once: true });
  }
};

const syncViewerElementVisibilityInDom = (slide, targetElementId, hidden) => {
  if (!slide || !targetElementId) {
    return false;
  }
  const wrapper = ensureStageContentWrapper();
  if (!wrapper) {
    return false;
  }
  const element = slide.elements?.find((item) => item?.id === targetElementId);
  if (!element) {
    return false;
  }
  const existingNode = findStageNodeByElementId(targetElementId);
  const existingOverlay = wrapper.querySelector(`[data-caption-for-element-id="${CSS.escape(String(targetElementId))}"]`);
  if (hidden) {
    existingNode?.remove();
    existingOverlay?.remove();
    return true;
  }
  if (existingNode) {
    return true;
  }
  const node = createRendererNode(element, slide);
  if (!(node instanceof Element)) {
    return false;
  }
  const orderedElements = (slide.elements || [])
    .slice()
    .sort((first, second) => (Number(first.zIndex) || 0) - (Number(second.zIndex) || 0));
  const nextVisibleSibling = orderedElements
    .slice(orderedElements.findIndex((item) => item?.id === targetElementId) + 1)
    .find((item) => item?.id && !isViewerElementHidden(slide, item.id) && findStageNodeByElementId(item.id));
  const firstCaptionOverlay = wrapper.querySelector('[data-caption-for-element-id]');
  const insertionPoint = nextVisibleSibling
    ? findStageNodeByElementId(nextVisibleSibling.id)
    : firstCaptionOverlay;
  if (insertionPoint) {
    wrapper.insertBefore(node, insertionPoint);
  } else {
    wrapper.appendChild(node);
  }
  if (['audio', 'video'].includes(element.type)) {
    const mediaNode = node.querySelector?.('audio, video') || (node.matches?.('audio,video') ? node : null);
    const overlayNode = createMediaCaptionOverlayNode(element, mediaNode, wrapper);
    if (overlayNode) {
      overlayNode.style.zIndex = String((Number(element.zIndex) || 0) + 1);
      wrapper.appendChild(overlayNode);
      positionCaptionOverlayNode(overlayNode, element, wrapper);
      requestAnimationFrame(() => positionCaptionOverlayNode(overlayNode, element, wrapper));
    }
  }
  return true;
};

const applyViewerAudioPresentation = (node, element) => {
  normalizeAudioElement(element);
  if (!(node instanceof HTMLAudioElement)) {
    return;
  }
  node.loop = Boolean(element.audioLoop);
  node.preload = 'metadata';
  node.autoplay = false;
  node.controls = Boolean(element.audioVisible);
  node.style.display = element.audioVisible ? '' : 'none';
};

const controlViewerAudioElement = (slide, targetElementId) => {
  if (!slide || !targetElementId) {
    return false;
  }
  const target = slide.elements?.find((item) => item?.id === targetElementId && item.type === 'audio');
  if (!target) {
    return false;
  }
  const node = getStageMediaNode(findStageNodeByElementId(targetElementId));
  if (!(node instanceof HTMLAudioElement)) {
    return false;
  }
  node.currentTime = 0;
  node.play().catch(() => { });
  return true;
};

const controlViewerVideoElement = (slide, targetElementId, actionType, timeSeconds = 0) => {
  if (!slide || !targetElementId) {
    return false;
  }
  const target = slide.elements?.find((item) => item?.id === targetElementId && item.type === 'video');
  if (!target || target.provider === 'youtube') {
    return false;
  }
  const node = getStageMediaNode(findStageNodeByElementId(targetElementId));
  if (!(node instanceof HTMLVideoElement)) {
    return false;
  }
  const nextTime = Math.max(0, Number(timeSeconds) || 0);
  switch (actionType) {
    case 'playVideo':
      node.play().catch(() => { });
      return true;
    case 'pauseVideo':
      node.pause();
      return true;
    case 'seekVideo':
      node.currentTime = nextTime;
      node.play().catch(() => { });
      return true;
    default:
      return false;
  }
};

const attachTimedVideoTrigger = (videoNode, element) => {
  normalizeVideoTriggerConfig(element);
  if (!(videoNode instanceof HTMLVideoElement) || element.provider === 'youtube') {
    return;
  }
  const slide = getCurrentSlide();
  if (!slide?.id || !element?.id) {
    return;
  }
  const triggers = (element.videoTriggers || []).filter(
    (trigger) => trigger?.enabled !== false && (trigger.actionConfig?.type || 'none') !== 'none' && Number(trigger.time) > 0
  );
  if (!triggers.length) {
    return;
  }
  const stateKey = getViewerTimedVideoTriggerKey(slide.id, element.id);
  const firedIds = new Set(viewerTimedVideoTriggers.get(stateKey) || []);
  viewerTimedVideoTriggers.set(stateKey, firedIds);
  const resetIfNeeded = () => {
    const currentTime = Number(videoNode.currentTime) || 0;
    triggers.forEach((trigger) => {
      if (currentTime < Math.max(0, Number(trigger.time) || 0)) {
        firedIds.delete(trigger.id);
      }
    });
    viewerTimedVideoTriggers.set(stateKey, new Set(firedIds));
  };
  videoNode.addEventListener('seeking', resetIfNeeded);
  videoNode.addEventListener('timeupdate', () => {
    const currentTime = Number(videoNode.currentTime) || 0;
    triggers.forEach((trigger) => {
      if (firedIds.has(trigger.id) || currentTime < Math.max(0, Number(trigger.time) || 0)) {
        return;
      }
      firedIds.add(trigger.id);
      viewerTimedVideoTriggers.set(stateKey, new Set(firedIds));
      const actionConfig = {
        ...(trigger.actionConfig || {}),
        targetElementId: resolveVideoTriggerActionTargetElementId(element, trigger)
      };
      executeActionConfig(element, actionConfig, getCurrentSlide(), getCurrentModule(), getCurrentModule()?.builder_data?.slides || []);
    });
  });
  videoNode.addEventListener('ended', () => {
    firedIds.clear();
    viewerTimedVideoTriggers.delete(stateKey);
  });
};

const clearTimedViewerSlideTriggerTimers = () => {
  timedViewerSlideTriggerTimers.forEach((timerId) => window.clearTimeout(timerId));
  timedViewerSlideTriggerTimers = [];
};

const getTimedViewerSlideTriggerKey = (slideId, triggerId) => `${slideId || 'slide'}::${triggerId || 'trigger'}`;

const shouldRerenderViewerAfterTimedAction = (actionType = 'none') =>
  !['playAudio', 'playVideo', 'pauseVideo', 'seekVideo', 'moveElement', 'playAnimation'].includes(actionType);

const scheduleTimedViewerSlideTriggers = (slide) => {
  if (!slide?.id) {
    clearTimedViewerSlideTriggerTimers();
    activeTimedViewerSlideKey = null;
    currentViewerSlideStartedAt = 0;
    return;
  }
  const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
  if (activeTimedViewerSlideKey !== slideKey) {
    clearTimedViewerSlideTriggerTimers();
    activeTimedViewerSlideKey = slideKey;
    currentViewerSlideStartedAt = Date.now();
  } else if (timedViewerSlideTriggerTimers.length) {
    return;
  }
  const elapsedMs = Math.max(0, Date.now() - (currentViewerSlideStartedAt || Date.now()));
  const triggers = (slide.elements || [])
    .filter((element) => element?.type === 'timedTrigger')
    .flatMap((element) => {
      normalizeInteractionTriggers(element);
      return (element.interactionTriggers || [])
        .filter((trigger) => trigger?.enabled !== false && (trigger.actionConfig?.type || 'none') !== 'none')
        .map((trigger) => ({ element, trigger }));
    });
  triggers.forEach(({ element, trigger }) => {
    const triggerKey = getTimedViewerSlideTriggerKey(slideKey, trigger.id);
    if (viewerTimedSlideTriggers.get(triggerKey) === true) {
      return;
    }
    const delay = Math.max(0, Math.round(Math.max(0, Number(trigger.time) || 0) * 1000 - elapsedMs));
    const timerId = window.setTimeout(() => {
      timedViewerSlideTriggerTimers = timedViewerSlideTriggerTimers.filter((item) => item !== timerId);
      const activeSlide = getCurrentSlide();
      const activeSlideKey = getStableSlideKey(activeSlide, viewerState.slideIndex);
      if (!activeSlide || activeSlideKey !== slideKey) {
        return;
      }
      if (viewerTimedSlideTriggers.get(triggerKey) === true) {
        return;
      }
      viewerTimedSlideTriggers.set(triggerKey, true);
      const didExecute = executeActionConfig(
        element,
        trigger.actionConfig || {},
        activeSlide,
        getCurrentModule(),
        getCurrentModule()?.builder_data?.slides || []
      );
      if (!didExecute) {
        return;
      }
      if (getStableSlideKey(getCurrentSlide(), viewerState.slideIndex) !== slideKey || shouldRerenderViewerAfterTimedAction(trigger.actionConfig?.type || 'none')) {
        renderSlide(getCurrentSlide());
      }
    }, delay);
    timedViewerSlideTriggerTimers.push(timerId);
  });
};

const moveSlideElementBy = (slide, elementId, deltaX, deltaY, durationSeconds = 0.8, options = {}) => {
  const target = slide?.elements?.find((item) => item?.id === elementId);
  if (!slide || !target) {
    return false;
  }
  const currentState = getElementRenderState(target);
  const stage = moduleStageDimensions || DEFAULT_STAGE_SIZE;
  const nextX = Math.min(Math.max(currentState.x + deltaX, 0), Math.max(0, stage.width - currentState.width));
  const nextY = Math.min(Math.max(currentState.y + deltaY, 0), Math.max(0, stage.height - currentState.height));
  target.x = nextX;
  target.y = nextY;
  const node = findStageNodeByElementId(target.id);
  if (node && typeof node.animate === 'function') {
    node.animate(
      [
        { left: `${currentState.x}px`, top: `${currentState.y}px` },
        { left: `${nextX}px`, top: `${nextY}px` }
      ],
      { duration: Math.max(100, durationSeconds * 1000), easing: 'ease-in-out', fill: 'forwards' }
    );
    window.setTimeout(() => {
      triggerDetectorsForElement(target, slide, getCurrentModule(), getCurrentModule()?.builder_data?.slides || [], {
        excludeDetectorId: options.excludeDetectorId || ''
      });
    }, Math.max(120, durationSeconds * 1000) + 20);
    return true;
  }
  triggerDetectorsForElement(target, slide, getCurrentModule(), getCurrentModule()?.builder_data?.slides || [], {
    excludeDetectorId: options.excludeDetectorId || ''
  });
  return true;
};

const replaySlideElementAnimation = (slide, elementId) => {
  const target = slide?.elements?.find((item) => item?.id === elementId);
  if (!slide || !target || !ANIMATABLE_ELEMENT_TYPES.has(target.type) || (target.animationType || 'none') === 'none') {
    return false;
  }
  resetViewerAnimationStateForElement(slide, target.id);
  renderSlide(slide);
  return true;
};

const executeActionConfig = (sourceElement, config, currentSlide, module, slides) => {
  const safeConfig = normalizeRuntimeActionConfig(config || {});
  const slideKey = getStableSlideKey(currentSlide, viewerState.slideIndex);
  const moduleId = module?.id || getCurrentModule()?.id || '';
  switch (safeConfig.type) {
    case 'nextSlide':
      changeSlide(1, { ignoreRestrictions: true });
      return true;
    case 'jumpSlide': {
      const nextIndex = slides.findIndex((slide) => slide.id === safeConfig.targetSlideId);
      if (nextIndex >= 0) {
        const isImmediateNext = nextIndex === viewerState.slideIndex + 1;
        if (!isImmediateNext && !canAdvanceFromCurrentSlide(nextIndex)) {
          return false;
        }
        persistCurrentSlideProgress({ force: true });
        viewerState.slideIndex = nextIndex;
        renderSlide(slides[viewerState.slideIndex]);
        return true;
      }
      return false;
    }
    case 'redirect':
      return openExternalRedirect(safeConfig.url);
    case 'moveElement':
      return moveSlideElementBy(
        currentSlide,
        safeConfig.targetElementId,
        Number(safeConfig.moveByX) || 0,
        Number(safeConfig.moveByY) || 0,
        Number(safeConfig.moveDuration) || 0.8,
        { excludeDetectorId: sourceElement?.type === 'detector' ? sourceElement.id : '' }
      );
    case 'playAnimation':
      return replaySlideElementAnimation(currentSlide, safeConfig.targetElementId);
    case 'playAudio':
      return controlViewerAudioElement(currentSlide, safeConfig.targetElementId);
    case 'playVideo':
    case 'pauseVideo':
    case 'seekVideo':
      return controlViewerVideoElement(currentSlide, safeConfig.targetElementId, safeConfig.type, safeConfig.videoTime);
    case 'showElement':
      if (setViewerElementHidden(currentSlide, safeConfig.targetElementId, false)) {
        syncViewerElementVisibilityInDom(currentSlide, safeConfig.targetElementId, false);
        return true;
      }
      return false;
    case 'hideElement':
      if (setViewerElementHidden(currentSlide, safeConfig.targetElementId, true)) {
        syncViewerElementVisibilityInDom(currentSlide, safeConfig.targetElementId, true);
        return true;
      }
      return false;
    case 'replaceText': {
      const replaced = executeReplaceTextAction(sourceElement, safeConfig, currentSlide, moduleId, slideKey);
      if (replaced) {
        renderSlide(currentSlide);
      }
      return replaced;
    }
    case 'addText':
    case 'addAudio':
    case 'addImage':
    case 'addVideo':
    case 'addQuiz': {
      const elementTypeMap = {
        addText: 'text',
        addAudio: 'audio',
        addImage: 'image',
        addVideo: 'video',
        addQuiz: 'quiz'
      };
      currentSlide.elements = currentSlide.elements || [];
      const runtimeSourceId = sourceElement.id;
      const runtimeActionType = config.type;
      const hasExistingRuntimeElement = currentSlide.elements.some(
        (item) => item?.isRuntimeGenerated && item.runtimeSourceId === runtimeSourceId && item.runtimeActionType === runtimeActionType
      );
      if (hasExistingRuntimeElement) {
        currentSlide.elements = currentSlide.elements.filter(
          (item) => !(item?.isRuntimeGenerated && item.runtimeSourceId === runtimeSourceId && item.runtimeActionType === runtimeActionType)
        );
      } else {
        currentSlide.elements.push(
          createRuntimeElement(elementTypeMap[safeConfig.type], { ...safeConfig, runtimeSourceId, runtimeActionType }, currentSlide)
        );
      }
      renderSlide(currentSlide);
      return true;
    }
    default:
      return false;
  }
};

const triggerDetectorsForElement = (draggedElement, currentSlide, module, slides, options = {}) => {
  if (!draggedElement || !currentSlide) {
    return false;
  }
  const draggedBox = getElementRuntimeBox(draggedElement);
  let triggered = false;
  const slideKey = getStableSlideKey(currentSlide, viewerState.slideIndex);
  const moduleId = module?.id || getCurrentModule()?.id || '';
  (currentSlide.elements || [])
    .filter((item) => item?.type === 'detector' && item.id !== draggedElement.id && item.id !== options.excludeDetectorId)
    .forEach((detector) => {
      if (!boxesOverlap(draggedBox, getElementRuntimeBox(detector))) {
        return;
      }
      const activation = evaluateDetectorActivation(detector, draggedElement, currentSlide, moduleId, slideKey);
      if (!activation.ready) {
        return;
      }
      normalizeInteractionTriggers(detector);
      (detector.interactionTriggers || []).forEach((triggerConfig) => {
        if (triggerConfig?.enabled === false) {
          return;
        }
        const didTrigger = executeActionConfig(detector, triggerConfig.actionConfig || {}, currentSlide, module, slides);
        triggered = didTrigger || triggered;
        if (didTrigger && triggerConfig.actionConfig?.detectorTriggerOnce) {
          viewerTriggeredDetectors.add(activation.stateKey);
        }
      });
    });
  return triggered;
};

const enableViewerStudentDrag = (node, element, slide) => {
  if (!node || !canStudentDragElement(element) || !moduleStage) {
    return;
  }
  let pointerId;
  let offsetX = 0;
  let offsetY = 0;
  let startX = 0;
  let startY = 0;
  let moved = false;
  const updatePosition = () => {
    const stage = moduleStageDimensions || DEFAULT_STAGE_SIZE;
    const box = getElementRuntimeBox(element);
    element.x = Math.min(Math.max(Number(element.x) || 0, 0), Math.max(0, stage.width - box.width));
    element.y = Math.min(Math.max(Number(element.y) || 0, 0), Math.max(0, stage.height - box.height));
    node.style.left = `${element.x}px`;
    node.style.top = `${element.y}px`;
  };
  const onMove = (event) => {
    element.x = event.clientX - offsetX;
    element.y = event.clientY - offsetY;
    moved = true;
    updatePosition();
  };
  const stop = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', stop);
    if (pointerId !== undefined) {
      node.releasePointerCapture?.(pointerId);
      pointerId = undefined;
    }
    const triggered = triggerDetectorsForElement(element, slide, getCurrentModule(), getCurrentModule()?.builder_data?.slides || []);
    const didChangePosition = Math.abs((Number(element.x) || 0) - startX) > 1 || Math.abs((Number(element.y) || 0) - startY) > 1;
    if (moved && didChangePosition) {
      persistProgressEventToBackend({
        type: 'drag_end',
        slideId: getStableSlideKey(slide, viewerState.slideIndex),
        slideTitle: slide?.title || '',
        elementId: element.id,
        elementType: element.type,
        summary: triggered
          ? `Arrastou ${element.type} e acionou o alvo correto.`
          : `Arrastou ${element.type} para uma nova posição.`,
        details: {
          x: Number(element.x) || 0,
          y: Number(element.y) || 0,
          triggeredDetector: triggered
        }
      });
    }
  };
  node.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const currentState = getElementRenderState(element);
    startX = currentState.x;
    startY = currentState.y;
    moved = false;
    pointerId = event.pointerId;
    offsetX = event.clientX - currentState.x;
    offsetY = event.clientY - currentState.y;
    node.setPointerCapture?.(pointerId);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', stop);
  });
};

const executeFloatingButtonAction = (element) => {
  const config = element.actionConfig || {};
  const module = getCurrentModule();
  const slides = module?.builder_data?.slides || [];
  if (!slides.length) return;
  const currentSlide = slides[viewerState.slideIndex];
  const ruleState = registerFloatingRuleClick(module, currentSlide, element);
  syncViewerFloatingRuleButtonState(module, currentSlide, element.id);
  if (!ruleState.ready) {
    if (ruleState.invalid) {
      alert('Essa regra precisa de um nome de grupo e de pelo menos 2 botões no mesmo slide para funcionar.');
    } else {
      alert(`Faltam ${ruleState.remaining} botão(ões) desta regra para liberar a ação.`);
    }
    return;
  }
  executeActionConfig(element, config, currentSlide, module, slides);
};

const executeFloatingButtonTriggers = (element) => {
  const module = getCurrentModule();
  const slides = module?.builder_data?.slides || [];
  if (!slides.length) return;
  const currentSlide = slides[viewerState.slideIndex];
  normalizeInteractionTriggers(element);
  let executedCount = 0;
  let blockedRuleState = null;
  (element.interactionTriggers || []).forEach((trigger) => {
    if (trigger?.enabled === false) {
      return;
    }
    const ruleState = registerFloatingRuleClick(module, currentSlide, element, trigger);
    if (!ruleState.ready) {
      blockedRuleState = blockedRuleState || ruleState;
      return;
    }
    if (executeActionConfig(element, trigger.actionConfig || {}, currentSlide, module, slides)) {
      executedCount += 1;
    }
  });
  syncViewerFloatingRuleButtonState(module, currentSlide, element.id);
  if (!executedCount && blockedRuleState) {
    if (blockedRuleState.invalid) {
      alert('Essa regra precisa de um nome de grupo e de pelo menos 2 botões no mesmo slide para funcionar.');
    } else {
      alert(`Faltam ${blockedRuleState.remaining} botão(ões) desta regra para liberar a ação.`);
    }
  }
};

const applyShapeStyles = (node, shape) => {
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
    default:
      node.style.clipPath = 'none';
      node.style.borderRadius = '1rem';
      break;
  }
};

const applyElementAnimationStyles = (node, element, options = {}) => {
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

  normalizeElementAnimation(element);
  if ((element.animationType || 'none') === 'none') {
    node.style.animation = '';
    node.style.transform = rotation ? `rotate(${rotation}deg)` : '';
    return;
  }

  if (element.animationType === MOTION_ANIMATION_TYPE) {
    node.style.animation = '';
    const renderState = getElementRenderState(element);
    node.style.left = `${renderState.x}px`;
    node.style.top = `${renderState.y}px`;
    node.style.width = `${renderState.width}px`;
    node.style.height = `${renderState.height}px`;
    node.style.opacity = String(renderState.opacity ?? 1);
    node.style.transform = `rotate(${renderState.rotation || 0}deg)`;
    const keyframes = buildRecordedMotionKeyframes(element);
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

  node.classList.add(`element-animation-${element.animationType}`);
  node.style.animationDuration = `${element.animationDuration || 1.2}s`;
  const animationDelay =
    typeof options.preservedElapsedSeconds === 'number'
      ? (element.animationDelay || 0) - options.preservedElapsedSeconds
      : element.animationDelay || 0;
  node.style.animationDelay = `${animationDelay}s`;
  node.style.animationIterationCount = element.animationLoop ? 'infinite' : '1';
  node.style.animationFillMode = 'both';
  node.style.animationTimingFunction =
    element.animationType === 'pulse' || element.animationType === 'float' ? 'ease-in-out' : 'cubic-bezier(0.22, 1, 0.36, 1)';
  node.style.transform =
    'translate3d(var(--element-translate-x), var(--element-translate-y), 0) scale(var(--element-scale)) rotate(var(--element-rotation))';
};

const applyModuleStageDimensions = (size) => {
  if (!moduleStage) return;
  moduleStage.style.boxSizing = 'border-box';
  const ratio =
    size && size.width > 0 && size.height > 0
      ? `${size.width} / ${size.height}`
      : '16 / 9';
  moduleStage.style.setProperty('--module-stage-aspect', ratio);
  moduleStage.style.aspectRatio = ratio;
  updateStageScale();
};

const clearStage = (message) => {
  if (!moduleStage) return;
  viewerTimedVideoTriggers.clear();
  viewerMediaState.clear();
  clearTimedViewerSlideTriggerTimers();
  activeTimedViewerSlideKey = null;
  currentViewerSlideStartedAt = 0;
  lastLoggedViewerSlideKey = null;
  Array.from(moduleStage.children).forEach((child) => {
    if (child.id !== 'moduleStageHint') {
      child.remove();
    }
  });
  moduleStage.style.backgroundImage = '';
  moduleStage.style.backgroundColor = '#fdfbff';
  if (viewerTitle) viewerTitle.textContent = 'Módulo não encontrado';
  if (viewerSubtitle) viewerSubtitle.textContent = message;
  if (moduleStageHint) {
    moduleStageHint.textContent = message;
    moduleStageHint.style.display = 'block';
  }
  moduleStageDimensions = null;
  applyModuleStageDimensions(null);
  const wrapper = moduleStage.querySelector('.stage-content-wrapper');
  if (wrapper) {
    wrapper.innerHTML = '';
    wrapper.style.transform = '';
  }
};

const loadModule = (modules) => {
  const unlockedModuleIds = getUnlockedModuleIds(modules);
  let module = modules.find((mod) => mod.id === viewerState.moduleId);
  if (!module && viewerState.courseId) {
    module = getRecommendedModule(modules.filter((mod) => mod.courseId === viewerState.courseId));
    if (module) {
      viewerState.moduleId = module.id;
    }
  }
  if (module && !unlockedModuleIds.has(module.id)) {
    module = getRecommendedModule(modules.filter((mod) => mod.courseId === module.courseId));
    if (module) {
      viewerState.moduleId = module.id;
    }
  }
  if (!module) {
    viewerHiddenElements.clear();
    viewerTimedVideoTriggers.clear();
    viewerMediaState.clear();
    clearStage('Você não tem acesso a este módulo.');
    disableNavigation();
    return;
  }
  viewerState.courseId = module.courseId;
  lastSavedVideoPosition = Math.max(Number(module.courseProgress?.video_position) || 0, 0);
  lastTrackedVideoPosition = lastSavedVideoPosition;
  if (viewerTitle) viewerTitle.textContent = module.title;
  if (viewerSubtitle) {
    viewerSubtitle.textContent = viewerState.isPublic
      ? `${module.courseTitle || 'Conteudo publico'} • acesso publico`
      : isReplayMode()
        ? `${module.courseTitle} • replay visual do aluno`
        : module.courseTitle;
  }
  const slides = module.builder_data?.slides || [];
  const stageSize = module.builder_data?.stageSize || null;
  moduleStageDimensions = stageSize ? { ...stageSize } : null;
  applyModuleStageDimensions(moduleStageDimensions);
  if (!slides.length) {
    viewerHiddenElements.clear();
    viewerTimedVideoTriggers.clear();
    viewerMediaState.clear();
    clearStage('Este módulo ainda não possui slides.');
    disableNavigation();
    return;
  }
  hydrateViewerInitiallyHiddenFromModule(module);
  viewerState.slideIndex = Math.min(Math.max(viewerState.slideIndex, 0), slides.length - 1);
  renderSlide(slides[viewerState.slideIndex]);
  if (moduleStageHint) {
    moduleStageHint.style.display = 'none';
  }
  if (isReplayMode()) {
    renderReplayHeader();
  }
  updateNavigationState();
};

const renderSlide = (slide) => {
  if (!moduleStage) return;
  clearCurrentSlideProgressTimer();
  const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
  if (activeTimedViewerSlideKey !== slideKey) {
    clearTimedViewerSlideTriggerTimers();
    currentViewerSlideStartedAt = Date.now();
  }
  currentSlideEnteredAt = Date.now();
  const wrapper = ensureStageContentWrapper();
  if (!wrapper) return;
  if (lastRenderedViewerSlideKey !== slideKey) {
    viewerAnimationState.clear();
    lastRenderedViewerSlideKey = slideKey;
  }
  snapshotViewerMediaState(slide);
  wrapper.innerHTML = '';
  const backgroundStyles = getSlideBackgroundStyles(slide);
  renderViewerBackgroundMedia(moduleStage, slide);
  moduleStage.style.backgroundImage = backgroundStyles.backgroundImage;
  moduleStage.style.backgroundSize = backgroundStyles.backgroundImage ? 'cover' : '';
  moduleStage.style.backgroundPosition = backgroundStyles.backgroundImage ? 'center' : '';
  moduleStage.style.backgroundColor = backgroundStyles.backgroundColor;
  const deferredCaptionOverlays = [];
  (slide.elements || [])
    .slice()
    .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0))
    .forEach((element) => {
      const node = createRendererNode(element, slide);
      wrapper.appendChild(node);
      if (['audio', 'video'].includes(element.type)) {
        const mediaNode = node instanceof Element ? node.querySelector?.('audio, video') || (node.matches?.('audio,video') ? node : null) : null;
        const overlayNode = createMediaCaptionOverlayNode(element, mediaNode, wrapper);
        if (overlayNode) {
          deferredCaptionOverlays.push({
            element,
            overlayNode,
            zIndex: Number(element.zIndex) || 0
          });
        }
      }
    });
  deferredCaptionOverlays
    .sort((a, b) => a.zIndex - b.zIndex)
    .forEach(({ element, overlayNode, zIndex }) => {
      overlayNode.style.zIndex = String(zIndex + 1);
      wrapper.appendChild(overlayNode);
      positionCaptionOverlayNode(overlayNode, element, wrapper);
    });
  if (deferredCaptionOverlays.length) {
    requestAnimationFrame(() => {
      deferredCaptionOverlays.forEach(({ element, overlayNode }) => positionCaptionOverlayNode(overlayNode, element, wrapper));
    });
  }
  updateStageScale();
  if (isReplayMode()) {
    renderReplayEventOverlay();
  }
  const module = getCurrentModule();
  const currentSnapshot = getSlideProgressSnapshot(module, slide, viewerState.slideIndex);
  const slideCompleted = Boolean(
    currentSnapshot.completed || isSlideCompletedByRules(module, slide, viewerState.slideIndex, currentSnapshot.viewedSeconds)
  );
  persistCurrentSlideProgress({ completed: slideCompleted, force: true });
  scheduleCurrentSlideProgressTimer();
  scheduleTimedViewerSlideTriggers(slide);
  if (lastLoggedViewerSlideKey !== slideKey) {
    lastLoggedViewerSlideKey = slideKey;
    persistProgressEventToBackend({
      type: 'slide_view',
      slideId: slideKey,
      slideTitle: slide?.title || '',
      summary: `Entrou no slide "${slide?.title || slideKey}".`,
      details: {
        viewedSeconds: 0
      }
    });
  }
  updateNavigationState();
};

const createRendererNode = (element, slide) => {
  const renderState = getElementRenderState(element);
  const preservedElapsedSeconds = getViewerAnimationElapsed(slide, element);
  let node;
  if (isViewerElementHidden(slide, element?.id)) {
    return document.createComment(`hidden-${element?.id || 'element'}`);
  }
  switch (element.type) {
    case 'text':
      node = document.createElement('div');
      node.className = 'builder-text-element';
      node.innerHTML = renderPlainTextHtml(element.content || '');
      {
        const textFlags = getTextDecorationFlags(element, { hasTextBackground: false, hasTextBorder: false, hasTextBlock: false });
        node.classList.toggle('builder-text-background', Boolean(textFlags.hasTextBackground));
        node.classList.toggle('builder-text-border', Boolean(textFlags.hasTextBorder));
      }
      node.style.background = 'transparent';
      break;
    case 'block':
      node = document.createElement('div');
      node.className = 'builder-block-element';
      node.innerHTML = renderPlainTextHtml(element.content || '');
      applyElementBackground(node, element);
      applyShapeStyles(node, element.shape || 'rectangle');
      break;
    case 'image':
      node = document.createElement('img');
      node.className = 'builder-media-element';
      node.src = element.src || '';
      node.alt = 'Imagem interativa';
      node.style.background = 'transparent';
      node.style.objectFit = ['fill', 'contain', 'cover'].includes(String(element.objectFit || ''))
        ? String(element.objectFit)
        : 'cover';
      node.addEventListener('error', () => {
        if (node.dataset.fallbackApplied === 'true') {
          return;
        }
        node.dataset.fallbackApplied = 'true';
        node.src = IMAGE_FALLBACK_SRC;
      });
      break;
    case 'audio':
      {
        const mediaNode = document.createElement('audio');
        mediaNode.className = 'builder-media-element';
        mediaNode.src = element.src || '';
        applyViewerAudioPresentation(mediaNode, element);
        node = wrapMediaNodeWithCaptions(mediaNode, element);
        restoreViewerMediaState(slide, element, node);
      }
      break;
    case 'video':
      if (element.provider === 'youtube' && element.embedSrc) {
        node = document.createElement('div');
        node.className = 'builder-media-embed';
        const frame = document.createElement('iframe');
        frame.className = 'builder-media-element';
        frame.src = element.embedSrc;
        frame.title = 'Vídeo do YouTube';
        frame.allow =
          'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        frame.allowFullscreen = true;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        node.appendChild(frame);
      } else {
        const mediaNode = document.createElement('video');
        mediaNode.className = 'builder-media-element';
        mediaNode.controls = true;
        mediaNode.src = element.src || '';
        attachVideoProgressTracking(mediaNode, element, slide);
        attachTimedVideoTrigger(mediaNode, element);
        node = wrapMediaNodeWithCaptions(mediaNode, element);
        restoreViewerMediaState(slide, element, node);
      }
      break;
    case 'quiz':
      node = createQuizNode(element, slide);
      node.style.background = element.quizBackgroundColor;
      node.style.backgroundColor = element.quizBackgroundColor;
      break;
    case 'input':
      node = createInputElementNode(element, slide, {
        runActions: () => {
          const module = getCurrentModule();
          const slides = module?.builder_data?.slides || [];
          let executedCount = 0;
          normalizeInteractionTriggers(element);
          (element.interactionTriggers || []).forEach((trigger) => {
            if (trigger?.enabled === false) {
              return;
            }
            if (executeActionConfig(element, trigger.actionConfig || {}, slide, module, slides)) {
              executedCount += 1;
            }
          });
          if (executedCount && getCurrentSlide()?.id === slide?.id) {
            renderSlide(getCurrentSlide());
          }
        }
      });
      break;
    case 'floatingButton':
      node = document.createElement('button');
      node.className = 'floating-button-element';
      node.textContent = element.label || 'Ação';
      applyElementBackground(node, element);
      applyShapeStyles(node, element.shape || 'rectangle');
      {
        const module = getCurrentModule();
        const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
        normalizeInteractionTriggers(element);
        const isCompleted = (element.interactionTriggers || []).some((trigger) => {
          const config = normalizeFloatingRuleConfig(trigger?.actionConfig || {});
          const ruleState =
            config.requireAllButtonsInGroup && config.ruleGroup
              ? getButtonRuleState(module?.id, slideKey, config.ruleGroup)
              : null;
          const clickedIds = new Set(Array.isArray(ruleState?.clickedButtonIds) ? ruleState.clickedButtonIds : []);
          return clickedIds.has(element.id);
        });
        if (isCompleted) {
          node.classList.add('floating-button-completed');
        }
      }
      node.addEventListener('click', () => executeFloatingButtonTriggers(element));
      break;
    case 'detector':
      node = document.createElement('div');
      node.className = 'detector-element detector-element-viewer';
      node.setAttribute('aria-hidden', 'true');
      break;
    case 'timedTrigger':
      node = document.createElement('div');
      node.className = 'time-trigger-element time-trigger-element-viewer';
      node.setAttribute('aria-hidden', 'true');
      break;
    case 'animatedArrow':
      node = document.createElement('div');
      node.className = 'animated-arrow-element';
      node.style.setProperty('--arrow-head-color', element.textColor || '#1f1d2a');
      node.innerHTML = `<span>${element.label || '➜'}</span>`;
      applyElementBackground(node, element);
      break;
    default:
      node = document.createElement('div');
      node.textContent = element.content || 'Elemento';
  }
  node.dataset.elementId = element.id;
  node.style.position = 'absolute';
  node.style.left = `${renderState.x}px`;
  node.style.top = `${renderState.y}px`;
  node.style.zIndex = String(element.zIndex ?? 0);
  if (renderState.width) {
    node.style.width = `${renderState.width}px`;
  }
  if (renderState.height) {
    node.style.height = `${renderState.height}px`;
  }
  if (element.textColor) {
    node.style.color = element.textColor;
  }
  if (element.fontSize) {
    node.style.fontSize = `${element.fontSize}px`;
  }
  if (element.fontFamily) {
    node.style.fontFamily = element.fontFamily;
  }
  if (element.fontWeight) {
    node.style.fontWeight = element.fontWeight;
  }
  if (!['block', 'floatingButton', 'image'].includes(element.type) && element.backgroundColor) {
    if (element.type === 'text') {
      if (getTextDecorationFlags(element, { hasTextBackground: false, hasTextBorder: false, hasTextBlock: false }).hasTextBackground) {
        node.style.background = element.backgroundColor;
        node.style.backgroundColor = element.backgroundColor;
      }
    } else if (element.type !== 'quiz') {
      node.style.backgroundColor = element.backgroundColor;
    }
  }
  applyElementAnimationStyles(node, element, { preservedElapsedSeconds });
  enableViewerStudentDrag(node, element, slide);
  return node;
};

const changeSlide = (direction, options = {}) => {
  const module = viewerModules.find((mod) => mod.id === viewerState.moduleId);
  if (!module) return;
  const slides = module.builder_data?.slides || [];
  if (!slides.length) return;
  const ignoreRestrictions = Boolean(options.ignoreRestrictions);
  if (lastTrackedVideoPosition > 0) {
    persistVideoProgress(lastTrackedVideoPosition, { force: true });
  }
  persistCurrentSlideProgress({ force: true });
  let nextIndex = viewerState.slideIndex + direction;
  if (nextIndex < 0 || nextIndex >= slides.length) {
    updateNavigationState();
    return;
  }
  if (!ignoreRestrictions && direction > 0 && !canAdvanceFromCurrentSlide(nextIndex)) {
    updateNavigationState();
    return;
  }
  viewerState.slideIndex = nextIndex;
  renderSlide(slides[viewerState.slideIndex]);
};

const syncFullscreenButtonState = () => {
  if (!viewerFullscreenBtn) return;
  viewerFullscreenBtn.textContent = document.fullscreenElement === moduleStageShell ? 'Sair da tela cheia' : 'Tela cheia';
};

const toggleStageFullscreen = async () => {
  if (!moduleStageShell) return;
  try {
    if (document.fullscreenElement === moduleStageShell) {
      if (screen.orientation?.unlock) {
        screen.orientation.unlock();
      }
      await document.exitFullscreen();
    } else {
      await moduleStageShell.requestFullscreen();
      if (screen.orientation?.lock) {
        await screen.orientation.lock('landscape').catch(() => { });
      }
    }
  } catch (error) {
    console.warn('Não foi possível alternar a tela cheia do palco.', error);
  }
};

const isMobilePortraitViewport = () => window.innerWidth <= 900 && window.innerHeight > window.innerWidth;

const updateOrientationPrompt = () => {
  if (!moduleStageShell || !orientationPrompt) return;
  const showPrompt = isMobilePortraitViewport();
  moduleStageShell.classList.toggle('mobile-portrait-layout', showPrompt);
  orientationPrompt.classList.toggle('hidden', !showPrompt);
};

const renderModuleList = () => {
  if (!moduleList) return;
  if (viewerState.isPublic) {
    moduleList.innerHTML = '';
    return;
  }
  if (!viewerModules.length) {
    moduleList.innerHTML = '<p class="muted" style="margin:0;">Nenhum módulo disponível.</p>';
    return;
  }
  const unlockedModuleIds = getUnlockedModuleIds(viewerModules);
  moduleList.innerHTML = viewerModules
    .map(
      (module) => `
      <button type="button" class="module-selection-item ${viewerState.moduleId === module.id ? 'active' : ''} ${unlockedModuleIds.has(module.id) ? '' : 'locked'
        }" data-module-id="${module.id}" data-locked="${unlockedModuleIds.has(module.id) ? 'false' : 'true'}">
        <strong>${module.title}</strong>
        <small class="muted" style="font-size:0.75rem;">${module.courseTitle}${unlockedModuleIds.has(module.id) ? '' : ' • Fase bloqueada'}</small>
      </button>`
    )
    .join('');
  moduleList.querySelectorAll('button[data-module-id]').forEach((button) =>
    button.addEventListener('click', () => {
      const moduleId = button.dataset.moduleId;
      if (!moduleId || moduleId === viewerState.moduleId) return;
      const targetModule = viewerModules.find((module) => module.id === moduleId);
      if (button.dataset.locked === 'true') {
        alert(getLockedModuleReason(targetModule, viewerModules));
        return;
      }
      if (lastTrackedVideoPosition > 0) {
        persistVideoProgress(lastTrackedVideoPosition, { force: true });
      }
      persistCurrentSlideProgress({ force: true });
      viewerState.moduleId = moduleId;
      viewerState.slideIndex = 0;
      loadModule(viewerModules);
      renderModuleList();
    })
  );
  if (isReplayMode()) {
    renderReplayHeader();
  }
};

const initModuleViewerPage = async () => {
  loadPersistedQuizAttempts();
  loadPersistedButtonRules();
  moduleStage = document.getElementById('moduleStage');
  moduleStageShell = document.getElementById('moduleStageShell');
  moduleStageHint = document.getElementById('moduleStageHint');
  viewerTitle = document.getElementById('viewerTitle');
  viewerSubtitle = document.getElementById('viewerSubtitle');
  prevBtn = document.getElementById('viewerPrevBtn');
  nextBtn = document.getElementById('viewerNextBtn');
  viewerFullscreenBtn = document.getElementById('viewerFullscreenBtn');
  orientationPrompt = document.getElementById('orientationPrompt');
  moduleList = document.getElementById('moduleList');
  moduleSelection = document.getElementById('moduleSelection');
  viewerBackLink = document.getElementById('viewerBackLink');
  viewerLogoutBtn = document.getElementById('viewerLogoutBtn');
  replayStatusCard = document.getElementById('replayStatusCard');
  replayStatusGrid = document.getElementById('replayStatusGrid');
  replayTimelineCard = document.getElementById('replayTimelineCard');
  replayTimelineList = document.getElementById('replayTimelineList');
  document.querySelectorAll('.logout-btn').forEach((btn) => btn.addEventListener('click', handleLogout));
  prevBtn?.addEventListener('click', () => changeSlide(-1));
  nextBtn?.addEventListener('click', () => changeSlide(1));
  viewerFullscreenBtn?.addEventListener('click', toggleStageFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreenButtonState);
  syncFullscreenButtonState();
  updateOrientationPrompt();
  window.addEventListener('resize', () => {
    updateOrientationPrompt();
    updateStageScale();
  });
  window.addEventListener('beforeunload', () => {
    if (lastTrackedVideoPosition > 0) {
      persistVideoProgress(lastTrackedVideoPosition, { force: true });
    }
    persistCurrentSlideProgress({ force: true });
    clearCurrentSlideProgressTimer();
    clearTimedViewerSlideTriggerTimers();
  });

  if (viewerState.isPublic) {
    if (moduleSelection) {
      moduleSelection.style.display = 'none';
    }
    if (viewerLogoutBtn) {
      viewerLogoutBtn.style.display = 'none';
    }
    if (viewerBackLink) {
      viewerBackLink.textContent = 'Voltar';
      viewerBackLink.href = '#';
      viewerBackLink.addEventListener('click', (event) => {
        event.preventDefault();
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = 'login.html';
        }
      });
    }
  } else if (isReplayMode()) {
    if (viewerBackLink) {
      viewerBackLink.textContent = 'Voltar ao admin';
      viewerBackLink.href = 'admin.html';
    }
  } else {
    const token = getToken();
    const role = localStorage.getItem(USER_ROLE_KEY);
    if (!token || (role && role !== 'student' && role !== 'admin' && role !== 'professor')) {
      window.location.href = 'login.html';
      return;
    }
  }
  if (!viewerState.moduleId && !viewerState.courseId) {
    clearStage('Informe o módulo que deseja visualizar (use o portal).');
    disableNavigation();
    return;
  }
  try {
    if (viewerState.isPublic) {
      const publicModule = await fetchPublicModule(viewerState.moduleId);
      viewerModules = [publicModule];
      viewerState.moduleId = publicModule.id;
      viewerState.courseId = publicModule.courseId;
    } else if (isReplayMode()) {
      if (!viewerState.replayUserId || !viewerState.courseId) {
        throw new Error('Informe userId e courseId para abrir o replay.');
      }
      replayPayload = await fetchAdminReplay(viewerState.replayUserId, viewerState.courseId);
      replayEvents = Array.isArray(replayPayload?.events) ? replayPayload.events : [];
      viewerModules = sortModulesForPhase(
        (Array.isArray(replayPayload?.modules) ? replayPayload.modules : []).map((module) => ({
          ...module,
          courseId: replayPayload.course?.id || viewerState.courseId,
          courseTitle: replayPayload.course?.title || 'Curso',
          courseProgress: replayPayload.course?.progress || {}
        }))
      );
      hydrateQuizAttemptsFromCourses([
        {
          id: replayPayload.course?.id || viewerState.courseId,
          title: replayPayload.course?.title || 'Curso',
          progress: replayPayload.course?.progress || {},
          modules: Array.isArray(replayPayload?.modules) ? replayPayload.modules : []
        }
      ]);
      if (!viewerState.moduleId && replayEvents.length) {
        const initialEventIndex = replayEvents.length - 1;
        viewerState.replayEventIndex = initialEventIndex;
        const firstEventTarget = getReplayEventTarget(replayEvents[initialEventIndex]);
        if (firstEventTarget?.module?.id) {
          viewerState.moduleId = firstEventTarget.module.id;
          viewerState.slideIndex = firstEventTarget.slideIndex;
        }
      }
      if (!viewerState.moduleId && viewerModules.length) {
        viewerState.moduleId = viewerModules[0].id;
      }
    } else {
      const response = await authorizedFetch('/api/student/courses');
      const courses = await response.json();
      hydrateQuizAttemptsFromCourses(courses);
      const modules = getVisibleCourseModules(courses);
      const sortedModules = sortModulesForPhase(modules);
      viewerModules = sortedModules;
      if (!viewerState.moduleId && viewerModules.length) {
        viewerState.moduleId = getRecommendedModule(viewerModules)?.id || viewerModules[0].id;
      }
    }
    renderModuleList();
    loadModule(viewerModules);
  } catch (error) {
    console.error('Erro ao carregar módulos', error);
    const extra = error?.message ? ` ${error.message}` : '';
    clearStage(`Não foi possível carregar os módulos.${extra}`);
    disableNavigation();
  }
};

document.addEventListener('DOMContentLoaded', initModuleViewerPage);

// ── Chat do Curso (module-viewer) ──────────────────────────────
let viewerChatPollTimer = null;
let viewerLastMessageCount = 0;
let viewerChatOpen = false;

const closeCourseChat = () => {
  document.getElementById('chatModal')?.classList.add('hidden');
  if (viewerChatPollTimer) { clearInterval(viewerChatPollTimer); viewerChatPollTimer = null; }
  viewerChatOpen = false;
  viewerLastMessageCount = 0;
};

const renderViewerChatMessages = (messages) => {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const sessionUser = JSON.parse(localStorage.getItem('curso-platform-user') || '{}');

  if (!messages.length) {
    container.innerHTML = '<p style="margin:0;color:#8b92b1;text-align:center;">Nenhuma mensagem ainda. Seja o primeiro!</p>';
    return;
  }

  const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;

  container.innerHTML = messages.map((msg) => {
    const isAdmin = msg.role === 'admin' || msg.role === 'professor';
    const safeMessage = escapeHtml(msg.message);
    const safeName = escapeHtml(msg.full_name);
    const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const isMine = !isAdmin && msg.full_name === sessionUser.fullName;
    const bubbleClass = isAdmin ? 'admin-msg' : (isMine ? 'mine' : 'theirs');
    const label = isAdmin ? `👨‍🏫 ${safeName} (Professor)` : safeName;
    return `
      <div class="chat-bubble ${bubbleClass}">
        ${buildReplyQuoteMarkup(msg)}
        ${!isMine ? `<strong style="font-size:0.78rem;display:block;margin-bottom:0.2rem;">${label}</strong>` : ''}
        ${safeMessage}
        <span class="chat-bubble-meta">${time}</span>
      </div>`;
  }).join('');

  if (isNearBottom || messages.length !== viewerLastMessageCount) {
    container.scrollTop = container.scrollHeight;
  }
  viewerLastMessageCount = messages.length;
};

const fetchViewerChatMessages = async (courseId) => {
  try {
    const response = await authorizedFetch(`/api/chat/${encodeURIComponent(courseId)}`);
    if (!response.ok) return;
    const messages = await response.json();
    renderViewerChatMessages(messages);
  } catch (e) { /* silencioso */ }
};

const openViewerChat = async () => {
  const courseId = viewerState.courseId;
  if (!courseId) { alert('Nenhum curso carregado para abrir o chat.'); return; }

  const modal = document.getElementById('chatModal');
  const title = document.getElementById('chatModalTitle');
  const messages = document.getElementById('chatMessages');
  if (!modal) return;

  const courseName = viewerModules.find((m) => m.courseId === courseId)?.courseTitle || 'Curso';
  title.textContent = `💬 ${escapeHtml(courseName)}`;
  messages.innerHTML = '<p style="margin:0;color:#8b92b1;text-align:center;">Carregando mensagens...</p>';
  modal.classList.remove('hidden');
  viewerChatOpen = true;

  await fetchViewerChatMessages(courseId);

  if (viewerChatPollTimer) clearInterval(viewerChatPollTimer);
  viewerChatPollTimer = setInterval(() => {
    if (viewerChatOpen) fetchViewerChatMessages(courseId);
  }, 5000);

  document.getElementById('chatInput')?.focus();
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('viewerChatBtn')?.addEventListener('click', openViewerChat);
  document.getElementById('chatModalClose')?.addEventListener('click', closeCourseChat);
  document.getElementById('chatModalBackdrop')?.addEventListener('click', closeCourseChat);

  document.getElementById('chatForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const courseId = viewerState.courseId;
    if (!courseId) return;

    const input = document.getElementById('chatInput');
    const message = input.value.slice(0, 1000).trim();
    if (!message) return;

    const btn = document.getElementById('chatSendBtn');
    btn.disabled = true;
    try {
      const response = await authorizedFetch(`/api/chat/${encodeURIComponent(courseId)}`, {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        alert(data?.message || 'Não foi possível enviar a mensagem.');
        return;
      }
      input.value = '';
      await fetchViewerChatMessages(courseId);
    } catch (e) {
      alert('Erro ao enviar mensagem. Tente novamente.');
    } finally {
      btn.disabled = false;
      input.focus();
    }
  });
});

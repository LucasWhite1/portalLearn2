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
const backgroundRemovalModulePromise = import('./image-background-removal.js');
const eraserUtilsPromise = import('./eraser-utils.js');

const STORAGE_KEY = 'curso-platform-token';
const USER_ROLE_KEY = 'curso-platform-role';
const AI_PROPOSAL_HISTORY_KEY = 'curso-platform-ai-proposal-history';

const DEFAULT_STAGE_SIZE = { width: 1280, height: 720 };

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

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const MIN_ELEMENT_SIZE = 40;
const BUILDER_PANEL_COLLAPSE_BREAKPOINT = 1480;
const BUILDER_PANEL_STAGE_GAP = 24;
const BUILDER_PANEL_COLLAPSED_WIDTH = 64;

const builderState = {
  slides: [],
  activeSlideId: null,
  stageSize: { width: 0, height: 0 },
  moduleSettings: {
    lockNextModuleUntilCompleted: false,
    isPublic: false
  }
};

let slideList;
let slideCanvas;
let slideCanvasViewport;
let builderMain;
let builderPanel;
let builderPanelToggleBtn;
let slideName;
let previewStageBtn;
let moduleCourseSelect;
let moduleTitleInput;
let moduleDescriptionInput;
let moduleLockNextToggle;
let modulePublicToggle;
let modulePublicLinkInput;
let copyPublicModuleLinkBtn;
let openPublicModuleLinkBtn;
let modulePublicLinkStatus;
let saveModuleBtn;
let exportTemplateBtn;
let importTemplateBtn;
let templateImportInput;
let templateStoreCard;
let templateStoreList;
let templateStoreSearchInput;
let refreshTemplateStoreBtn;
let templateStoreStatus;
let courseModuleList;
let courseModuleCard;
let builderCourses = [];
let slideBgInput;
let slideBgUploadBtn;
let slideBgStatus;
let backgroundEditorCard;
let backgroundMediaTypeSelect;
let backgroundMediaUrlInput;
let backgroundMediaLocalBtn;
let backgroundMediaApplyBtn;
let backgroundMediaClearBtn;
let backgroundMediaEditorStatus;
let backgroundSolidColorInput;
let backgroundGradientStartInput;
let backgroundGradientEndInput;
let stageBgColorInput;
let slideRequireQuizToggle;
let selectedElementId = null;
let lastPublicModuleLink = null;
let selectedElementTypeLabel;
let elementWidthInput;
let elementHeightInput;
let elementRotationInput;
let elementLayerInput;
let elementTextColorInput;
let elementFontSizeInput;
let elementFontFamilySelect;
let elementFontWeightSelect;
let elementBgColorInput;
let elementStudentDragToggle;
let removeImageBackgroundBtn;
let elementAnimationTypeSelect;
let elementAnimationDurationInput;
let elementAnimationDelayInput;
let elementAnimationLoopToggle;
let handleLayer = null;
let elementShapeSelect;
let elementGradientToggle;
let elementSolidColorInput;
let elementGradientStartInput;
let elementGradientEndInput;
let elementTextBackgroundToggle;
let elementTextBorderToggle;
let centerTextStageBtn;
let centerTextBlockBtn;
let gradientFields = [];
let resetEditorBtn;
let localImageInput;
let localAudioInput;
let localVideoInput;
let removeSelectedElementBtn;
let undoActionBtn;
let copyActionBtn;
let pasteActionBtn;
let redoActionBtn;
let keyboardMoveStepInput;
let stageEditorEmpty;
let textEditorCard;
let blockEditorCard;
let imageEditorCard;
let quizEditorCard;
let animationEditorCard;
let audioEditorCard;
let textElementContentInput;
let textElementWidthInput;
let textElementHeightInput;
let textElementTextColorInput;
let textElementFontSizeInput;
let textElementFontFamilySelect;
let textElementFontWeightSelect;
let textElementTextAlignSelect;
let textElementBgColorInput;
let textElementBackgroundToggle;
let textElementBorderToggle;
let textElementCenterStageBtn;
let textElementCenterBlockBtn;
let blockElementContentInput;
let blockElementWidthInput;
let blockElementHeightInput;
let blockElementRotationInput;
let blockElementLayerInput;
let blockElementShapeSelect;
let blockElementGradientToggle;
let blockElementSolidColorInput;
let blockElementGradientStartInput;
let blockElementGradientEndInput;
let blockElementTextColorInput;
let blockElementFontSizeInput;
let blockElementFontFamilySelect;
let blockElementFontWeightSelect;
let blockElementTextureFitSelect;
let blockAttachTextureBtn;
let blockClearTextureBtn;
let imageElementWidthInput;
let imageElementHeightInput;
let imageElementRotationInput;
let imageElementObjectFitSelect;
let imageElementStudentDragToggle;
let imageReplaceSourceBtn;
let quizQuestionInput;
let quizOptionsInput;
let quizCorrectAnswerSelect;
let quizSuccessMessageInput;
let quizErrorMessageInput;
let quizActionLabelInput;
let quizBackgroundColorInput;
let quizQuestionColorInput;
let quizOptionBackgroundColorInput;
let quizOptionTextColorInput;
let quizButtonBackgroundColorInput;
let quizPointsInput;
let quizLockOnWrongToggle;
let floatingButtonEditorCard;
let floatingEditorBadge;
let floatingEditorTitle;
let floatingActionTypeSelect;
let floatingTargetSlideSelect;
let floatingTargetElementSelect;
let floatingPickTargetElementBtn;
let floatingRequireAllToggle;
let floatingRuleGroupInput;
let floatingActionTextLabel;
let floatingDetectorAcceptedSelect;
let floatingDetectorMinCountInput;
let floatingDetectorTriggerOnceToggle;
let floatingActionTextInput;
let floatingReplaceModeSelect;
let floatingReplaceCounterStartInput;
let floatingReplaceCounterStepInput;
let floatingActionUrlInput;
let floatingAudioVisibleToggle;
let floatingAudioLoopToggle;
let floatingTextColorInput;
let floatingTextBgColorInput;
let floatingTextFontSizeInput;
let floatingTextFontFamilySelect;
let floatingTextFontWeightSelect;
let floatingTextAlignSelect;
let floatingTextBackgroundToggle;
let floatingTextBorderToggle;
let floatingInsertXInput;
let floatingInsertYInput;
let floatingInsertWidthInput;
let floatingInsertHeightInput;
let floatingMoveXInput;
let floatingMoveYInput;
let floatingMoveDurationInput;
let floatingVideoTimeInput;
let floatingPickPlacementBtn;
let floatingPlacementHint;
let floatingQuizQuestionInput;
let floatingQuizOptionsInput;
let floatingQuizCorrectSelect;
let floatingQuizSuccessInput;
let floatingQuizErrorInput;
let floatingQuizActionLabelInput;
let floatingQuizBackgroundColorInput;
let floatingQuizQuestionColorInput;
let floatingQuizOptionBackgroundColorInput;
let floatingQuizOptionTextColorInput;
let floatingQuizButtonBackgroundColorInput;
let floatingQuizPointsInput;
let floatingQuizLockOnWrongToggle;
let videoEditorCard;
let videoTriggerTimeInput;
let videoTriggerActionSelect;
let videoTriggerSeekTimeInput;
let videoTriggerTargetElementSelect;
let audioElementWidthInput;
let audioElementHeightInput;
let audioElementRotationInput;
let audioElementVisibleToggle;
let audioElementLoopToggle;
let audioReplaceSourceBtn;
let eraserEditorCard;
let eraserModeSelect;
let eraserShapeSelect;
let eraserSizeInput;
let eraserSizeNumberInput;
let eraserClosePathBtn;
let eraserClearBtn;
let eraserApplyBtn;
let addMotionFrameBtn;
let updateMotionFrameBtn;
let removeMotionFrameBtn;
let clearMotionFramesBtn;
let elementMotionFrameList;
let layerBringForwardBtn;
let layerSendBackwardBtn;
let layerBringToFrontBtn;
let layerSendToBackBtn;
let aiAssistantStatus;
let aiAssistantPromptInput;
let aiAssistantFeedback;
let aiAssistantGenerateBtn;
let aiAssistantApplyBtn;
let aiAssistantDiscardBtn;
let aiAssistantActions;
let aiAssistantDebugOutput;
let aiProposalHistoryList;
let aiAssistantUseReferenceBtn;
let aiAssistantAttachImageBtn;
let aiAssistantClearImageBtn;
let aiAssistantAttachmentPreview;
let aiAssistantImageInput;
let aiReferenceCard;
let stageEditorDock;
let lastStageEditorOpenedAt = 0;
let isRemovingImageBackground = false;
let removingBackgroundElementId = null;
const STAGE_EDITOR_DEFAULT_POSITIONS = {
  text: { x: 24, y: 108 },
  block: { x: 360, y: 116 },
  image: { x: 332, y: 124 },
  audio: { x: 336, y: 138 },
  quiz: { x: 32, y: 118 },
  floating: { x: 56, y: 132 },
  video: { x: 88, y: 142 },
  background: { x: 112, y: 136 },
  eraser: { x: 68, y: 146 },
  animation: { x: 80, y: 146 }
};
const stageEditorPositions = JSON.parse(JSON.stringify(STAGE_EDITOR_DEFAULT_POSITIONS));
let availableCourseModules = {};
let templateStoreCatalog = [];
let editingModuleId = null;
let editingCourseId = null;
let editingModuleCourseId = null;
let isPickingFloatingInsertPosition = false;
let isPickingFloatingTargetElement = false;
let currentStageEditor = 'none';

const FLOATING_INSERT_ACTIONS = ['addText', 'addImage', 'addVideo', 'addQuiz'];
const STUDENT_DRAGGABLE_TYPES = new Set(['text', 'block', 'image']);
const REPLACEABLE_TEXT_TYPES = new Set(['text', 'block', 'floatingButton']);
const DETECTOR_ACCEPT_ANY = 'any';
const DETECTOR_ACCEPT_TYPE_PREFIX = 'type:';
const DETECTOR_ACCEPT_ELEMENT_PREFIX = 'element:';
const REPLACE_TEXT_MODE = 'replace';
const REPLACE_COUNTER_MODE = 'counter';

const historyState = {
  past: [],
  future: [],
  suppressCommit: false,
  debounceTimer: null
};

const aiAssistantState = {
  settings: null,
  pendingActions: [],
  loading: false,
  loadingInterval: null,
  loadingMessage: 'Gerando proposta da IA',
  isStreaming: false,
  stopRequested: false,
  stepIndex: 0,
  feedbackEntries: [],
  recentActions: [],
  attachments: [],
  proposalHistory: [],
  lastPrompt: '',
  debugInfo: null
};

const previewState = {
  active: false,
  slides: [],
  activeSlideId: null,
  clickedRuleButtons: new Map(),
  triggeredDetectors: new Set(),
  replaceCounters: new Map(),
  hiddenElements: new Map()
};
const previewAnimationState = new Map();
let lastPreviewAnimationSlideId = null;

const clipboardState = {
  element: null
};

const DEFAULT_KEYBOARD_MOVE_STEP = 10;
const MOTION_ANIMATION_TYPE = 'motion-recording';
const DEFAULT_MOTION_FRAME = Object.freeze({ opacity: 1 });
let selectedMotionFrameIndex = -1;

const ERASER_SUPPORTED_TYPES = new Set(['image', 'block']);
const ERASER_BRUSH_SHAPES = new Set(['circle', 'square', 'diamond']);
const eraserState = {
  active: false,
  loading: false,
  elementId: null,
  sourceType: null,
  baseCanvas: null,
  maskCanvas: null,
  overlay: null,
  displayCanvas: null,
  drawing: false,
  lastPoint: null,
  lassoPoints: [],
  hoverPoint: null
};

const AI_REFERENCE_PROMPT =
  'Use a imagem de referência como inspiração e crie um slide com layout profissional: alinhe os blocos em grade, mantenha espaçamentos consistentes, deixe o título bem hierarquizado, alinhe os textos com margens internas equilibradas, use uma imagem ilustrativa por URL e adicione um botão interativo elegante. Quando fizer sentido, configure blocos com shape e gradiente, e use animacao em image ou block com fade, pulse, float, zoom ou motion-recording com quadros para criar movimentacao guiada.';

const TEMPLATE_FILE_VERSION = 1;
const TEMPLATE_KIND = 'curso-slide-template';

const createId = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 6)}-${Date.now()}`;

const getPreviewActiveSlide = () => previewState.slides.find((slide) => slide.id === previewState.activeSlideId) || null;

const normalizeAudioElement = (element) => {
  if (!element || element.type !== 'audio') {
    return;
  }
  element.audioVisible = typeof element.audioVisible === 'boolean' ? element.audioVisible : true;
  element.audioLoop = Boolean(element.audioLoop);
  element.width = Math.max(180, Number(element.width) || 260);
  element.height = Math.max(54, Number(element.height) || 70);
};

const createSlug = (value = '') =>
  value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderPlainTextHtml = (value = '') =>
  escapeHtml(String(value || ''))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '<br>');

const truncateText = (value = '', maxLength = 120) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));
const ANIMATABLE_ELEMENT_TYPES = new Set(['text', 'block', 'floatingButton', 'image']);
const ANIMATION_PRESETS = new Set(['none', 'fade-in', 'fade-out', 'slide-left', 'slide-right', 'rotate-in', 'pulse', 'float', 'zoom-in', MOTION_ANIMATION_TYPE]);

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

const getElementMediaObjectFit = (element) => {
  const value = String(element?.objectFit || '').trim();
  if (['fill', 'contain', 'cover'].includes(value)) {
    return value;
  }
  return 'cover';
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

const getAnimationStateKey = (slideId, elementId) => `${slideId || 'slide'}::${elementId || 'element'}`;

const getPreviewAnimationElapsed = (slide, element) => {
  if (!previewState.active || !slide?.id || !element?.id || !ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    return null;
  }
  normalizeElementAnimation(element);
  if ((element.animationType || 'none') === 'none') {
    previewAnimationState.delete(getAnimationStateKey(slide.id, element.id));
    return null;
  }
  const key = getAnimationStateKey(slide.id, element.id);
  const existing = previewAnimationState.get(key);
  const now = performance.now();
  if (!existing || existing.animationType !== element.animationType) {
    previewAnimationState.set(key, { startedAt: now, animationType: element.animationType });
    return 0;
  }
  return Math.max(0, (now - existing.startedAt) / 1000);
};

const resetPreviewAnimationStateForElement = (slideId, elementId) => {
  if (!slideId || !elementId) {
    return;
  }
  previewAnimationState.delete(getAnimationStateKey(slideId, elementId));
};

const applyElementBackground = (node, element) => {
  if (!node || !element) {
    return;
  }
  const backgroundValue = buildBackgroundStyle(element);
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
  node.style.backgroundColor = backgroundValue;
};

const getStageDimensions = () => {
  return normalizeTemplateStageSize(builderState.stageSize);
};

const getStageScale = () => {
  const scale = Number(slideCanvas?.dataset?.stageScale);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
};

const getStagePointerPosition = (event) => {
  const rect = slideCanvas?.getBoundingClientRect?.();
  const scale = getStageScale();
  if (!rect) {
    return { x: 0, y: 0 };
  }
  return {
    x: (event.clientX - rect.left) / scale,
    y: (event.clientY - rect.top) / scale
  };
};

const syncStageViewport = () => {
  if (!slideCanvas) {
    return;
  }
  const stageSize = getStageDimensions();
  const viewportWidth =
    slideCanvasViewport?.clientWidth
    || slideCanvasViewport?.getBoundingClientRect?.().width
    || stageSize.width;
  const scale = clamp(viewportWidth / Math.max(stageSize.width, 1), 0.1, 1);
  slideCanvas.style.width = `${stageSize.width}px`;
  slideCanvas.style.height = `${stageSize.height}px`;
  slideCanvas.style.transform = `scale(${scale})`;
  slideCanvas.dataset.stageScale = String(scale);
  if (slideCanvasViewport) {
    slideCanvasViewport.style.height = `${Math.max(220, Math.round(stageSize.height * scale))}px`;
  }
};

const setBuilderPanelCollapsed = (collapsed) => {
  if (!builderPanel || !builderMain) {
    return;
  }
  builderPanel.classList.toggle('is-collapsed', collapsed);
  builderMain.classList.toggle('builder-main-panel-collapsed', collapsed);
  if (builderPanelToggleBtn) {
    builderPanelToggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    builderPanelToggleBtn.title = collapsed ? 'Abrir menu lateral' : 'Fechar menu lateral';
  }
  syncBuilderPanelStageOffset();
};

const syncBuilderPanelStageOffset = () => {
  if (!builderPanel || !builderMain) {
    return;
  }
  const isCollapsed = builderPanel.classList.contains('is-collapsed');
  const panelWidth = isCollapsed
    ? BUILDER_PANEL_COLLAPSED_WIDTH
    : Math.round(builderPanel.getBoundingClientRect().width || builderPanel.offsetWidth || 0);
  const stageOffset = Math.max(0, panelWidth + BUILDER_PANEL_STAGE_GAP);
  builderMain.style.setProperty('--builder-panel-stage-offset', `${stageOffset}px`);
};

const syncBuilderPanelLayout = () => {
  if (!builderPanel) {
    return;
  }
  const preference = builderPanel.dataset.panelPreference || '';
  const collapsedByDefault = window.innerWidth < BUILDER_PANEL_COLLAPSE_BREAKPOINT;
  const shouldCollapse =
    preference === 'collapsed'
      ? true
      : preference === 'open'
        ? false
        : collapsedByDefault;
  setBuilderPanelCollapsed(shouldCollapse);
};

const toggleBuilderPanel = () => {
  if (!builderPanel) {
    return;
  }
  const nextCollapsed = !builderPanel.classList.contains('is-collapsed');
  builderPanel.dataset.panelPreference = nextCollapsed ? 'collapsed' : 'open';
  setBuilderPanelCollapsed(nextCollapsed);
  syncStageViewport();
  hydrateTemplateStorePreviews();
};

const normalizeElementAnimation = (element) => {
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

const supportsRecordedMotion = (element) => ['image', 'block', 'text', 'floatingButton'].includes(element?.type);

const getMotionFrameSnapshot = (element) => ({
  x: Number(element?.x) || 0,
  y: Number(element?.y) || 0,
  width: Math.max(MIN_ELEMENT_SIZE, Number(element?.width) || MIN_ELEMENT_SIZE),
  height: Math.max(MIN_ELEMENT_SIZE, Number(element?.height) || MIN_ELEMENT_SIZE),
  rotation: ((Number(element?.rotation) || 0) % 360 + 360) % 360,
  opacity: DEFAULT_MOTION_FRAME.opacity
});

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
    opacity: DEFAULT_MOTION_FRAME.opacity
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

  if (!ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    node.style.animation = '';
    node.style.transform = rotation ? `rotate(${rotation}deg)` : '';
    return;
  }

  normalizeElementAnimation(element);
  const animationType = element.animationType || 'none';
  if (animationType === 'none') {
    node.style.animation = '';
    node.style.transform = rotation ? `rotate(${rotation}deg)` : '';
    return;
  }

  if (animationType === MOTION_ANIMATION_TYPE) {
    node.style.animation = '';
    if (node.dataset.elementId && !previewState.active) {
      node.style.transform = rotation ? `rotate(${rotation}deg)` : '';
      return;
    }
    const keyframes = buildRecordedMotionKeyframes(element);
    const renderState = getElementRenderState(element);
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

const readFileAsText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
    reader.readAsText(file);
  });

const buildTemplateFileName = (title = '') => {
  const slug = createSlug(title) || 'template-slide';
  return `${slug}.json`;
};

const normalizeTemplateStageSize = (stageSize) => {
  const width = Number(stageSize?.width);
  const height = Number(stageSize?.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  return { ...DEFAULT_STAGE_SIZE };
};

const normalizeTemplateModuleSettings = (moduleSettings) => ({
  lockNextModuleUntilCompleted: Boolean(moduleSettings?.lockNextModuleUntilCompleted),
  isPublic: Boolean(moduleSettings?.isPublic)
});

const getPublicModuleViewerUrl = (moduleId) => {
  const url = new URL('module-viewer.html', window.location.href);
  url.searchParams.set('publicModuleId', moduleId);
  return url.toString();
};

const openPublicModuleViewer = (moduleId) => {
  if (!moduleId) {
    return;
  }
  const url = getPublicModuleViewerUrl(moduleId);
  const popup = window.open(url, '_blank', 'noopener');
  if (!popup) {
    window.location.href = url;
  }
};

const setPublicModuleLinkState = ({ moduleId = '', title = '' } = {}) => {
  if (!moduleId) {
    lastPublicModuleLink = null;
  } else {
    lastPublicModuleLink = {
      moduleId,
      title: String(title || '').trim() || 'Modulo publico',
      url: getPublicModuleViewerUrl(moduleId)
    };
  }
};

const syncPublicModuleLinkUi = () => {
  if (!modulePublicLinkInput || !copyPublicModuleLinkBtn || !openPublicModuleLinkBtn || !modulePublicLinkStatus) {
    return;
  }
  const hasLink = Boolean(lastPublicModuleLink?.url);
  modulePublicLinkInput.value = hasLink ? lastPublicModuleLink.url : '';
  copyPublicModuleLinkBtn.disabled = !hasLink;
  openPublicModuleLinkBtn.disabled = !hasLink;
  if (hasLink) {
    modulePublicLinkStatus.textContent = `Link público pronto para compartilhar${lastPublicModuleLink.title ? `: ${lastPublicModuleLink.title}.` : '.'}`;
    return;
  }
  modulePublicLinkStatus.textContent = builderState.moduleSettings?.isPublic
    ? 'Salve este módulo para gerar o link público.'
    : 'Ative a opção de link público e salve o módulo para gerar um link compartilhável.';
};

const copyPublicModuleLink = async () => {
  const url = lastPublicModuleLink?.url;
  if (!url) {
    syncPublicModuleLinkUi();
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else if (modulePublicLinkInput) {
      modulePublicLinkInput.focus();
      modulePublicLinkInput.select();
      document.execCommand('copy');
      modulePublicLinkInput.setSelectionRange(0, 0);
    } else {
      throw new Error('Clipboard indisponível');
    }
    modulePublicLinkStatus.textContent = 'Link público copiado.';
  } catch (error) {
    alert('Não foi possível copiar o link automaticamente.');
  }
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

const normalizeTemplateSlides = (slides) => {
  if (!Array.isArray(slides) || !slides.length) {
    throw new Error('O template precisa conter ao menos um slide.');
  }
  const nextSlides = deepClone(slides);
  const slideIdMap = new Map();
  const usedSlideIds = new Set();

  nextSlides.forEach((slide, slideIndex) => {
    const originalId = typeof slide?.id === 'string' ? slide.id.trim() : '';
    let nextId = originalId || createId('slide');
    while (usedSlideIds.has(nextId)) {
      nextId = `${originalId || `slide-${slideIndex + 1}`}-${Math.random().toString(36).slice(2, 5)}`;
    }
    usedSlideIds.add(nextId);
    if (originalId && originalId !== nextId) {
      slideIdMap.set(originalId, nextId);
    }
    slide.id = nextId;
    slide.title = String(slide.title || `Slide ${slideIndex + 1}`).trim() || `Slide ${slideIndex + 1}`;
    normalizeSlideBackgroundFill(slide);
    slide.elements = Array.isArray(slide.elements) ? slide.elements : [];

    const usedElementIds = new Set();
    slide.elements = slide.elements
      .filter((element) => element && typeof element === 'object' && element.type)
      .map((element, elementIndex) => {
        const originalElementId = typeof element.id === 'string' ? element.id.trim() : '';
        let nextElementId = originalElementId || createId('element');
        while (usedElementIds.has(nextElementId)) {
          nextElementId = `${originalElementId || `${element.type}-${elementIndex + 1}`}-${Math.random().toString(36).slice(2, 5)}`;
        }
        usedElementIds.add(nextElementId);
        return {
          ...element,
          id: nextElementId
        };
      });
  });

  nextSlides.forEach((slide) => {
    slide.elements.forEach((element) => {
      if (element?.actionConfig?.targetSlideId && slideIdMap.has(element.actionConfig.targetSlideId)) {
        element.actionConfig.targetSlideId = slideIdMap.get(element.actionConfig.targetSlideId);
      }
    });
  });

  return nextSlides;
};

const buildTemplatePayload = () => {
  updateBuilderStageSize();
  return {
    kind: TEMPLATE_KIND,
    version: TEMPLATE_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    source: 'interactive-creator',
    template: {
      title: moduleTitleInput?.value?.trim() || 'Template sem título',
      description: moduleDescriptionInput?.value?.trim() || '',
      builderData: {
        slides: deepClone(builderState.slides),
        stageSize:
          builderState.stageSize.width > 0 && builderState.stageSize.height > 0
            ? deepClone(builderState.stageSize)
            : { ...DEFAULT_STAGE_SIZE },
        moduleSettings: deepClone(builderState.moduleSettings || {})
      }
    }
  };
};

const parseTemplatePayload = (payload) => {
  const templateSource =
    payload?.kind === TEMPLATE_KIND
      ? payload.template
      : payload?.template && (payload.template.builderData || payload.template.builder_data)
        ? payload.template
        : payload?.builderData || payload?.builder_data
          ? payload
          : payload;
  const builderData = templateSource?.builderData || templateSource?.builder_data || templateSource;
  const normalizedSlides = normalizeTemplateSlides(builderData?.slides);
  return {
    title: String(templateSource?.title || '').trim(),
    description: String(templateSource?.description || '').trim(),
    builderData: {
      slides: normalizedSlides,
      stageSize: normalizeTemplateStageSize(builderData?.stageSize),
      moduleSettings: normalizeTemplateModuleSettings(builderData?.moduleSettings)
    }
  };
};

const parseImportedTemplate = (rawText) => {
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch (error) {
    throw new Error('O arquivo selecionado não contém um JSON válido.');
  }
  return parseTemplatePayload(payload);
};

const applyImportedTemplate = (templatePayload) => {
  const slides = deepClone(templatePayload.builderData.slides);
  builderState.slides = slides;
  builderState.activeSlideId = slides[0]?.id || null;
  builderState.stageSize = normalizeTemplateStageSize(templatePayload.builderData.stageSize);
  builderState.moduleSettings = normalizeTemplateModuleSettings(templatePayload.builderData.moduleSettings);
  setPublicModuleLinkState({});
  selectedElementId = null;

  if (moduleTitleInput && templatePayload.title) {
    moduleTitleInput.value = templatePayload.title;
  }
  if (moduleDescriptionInput) {
    moduleDescriptionInput.value = templatePayload.description || moduleDescriptionInput.value || '';
  }
  if (moduleLockNextToggle) {
    moduleLockNextToggle.checked = Boolean(builderState.moduleSettings.lockNextModuleUntilCompleted);
  }
  if (modulePublicToggle) {
    modulePublicToggle.checked = Boolean(builderState.moduleSettings.isPublic);
  }
  syncPublicModuleLinkUi();

  renderSlideList();
  renderSlide();
  updateElementInspector(null);
  resetHistoryState();
};

const buildTemplateStorePreviewNode = (template, previewWidth = 220) => {
  const previewRoot = document.createElement('div');
  previewRoot.className = 'template-store-preview';
  const previewStage = document.createElement('div');
  previewStage.className = 'template-store-preview-stage';
  previewRoot.appendChild(previewStage);

  const slide = template?.previewSlide;
  if (!slide || typeof slide !== 'object') {
    const emptyLabel = document.createElement('div');
    emptyLabel.className = 'canvas-hint';
    emptyLabel.textContent = 'Sem prévia';
    previewRoot.appendChild(emptyLabel);
    return previewRoot;
  }

  const stageSize =
    template?.stageSize && Number(template.stageSize.width) > 0 && Number(template.stageSize.height) > 0
      ? template.stageSize
      : DEFAULT_STAGE_SIZE;
  const backgroundStyles = getSlideBackgroundStyles(slide);
  previewRoot.style.backgroundImage = backgroundStyles.backgroundImage;
  previewRoot.style.backgroundSize = backgroundStyles.backgroundImage ? 'cover' : '';
  previewRoot.style.backgroundPosition = backgroundStyles.backgroundImage ? 'center' : '';
  previewRoot.style.backgroundColor = backgroundStyles.backgroundColor;

  previewStage.style.width = `${stageSize.width}px`;
  previewStage.style.height = `${stageSize.height}px`;
  previewStage.style.transform = `translateX(-50%) scale(${Math.max(0.05, previewWidth / stageSize.width)})`;

  (slide.elements || [])
    .slice()
    .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0))
    .slice(0, 12)
    .forEach((element) => {
      if (!element || ['audio', 'video', 'quiz', 'detector'].includes(element.type)) {
        return;
      }
      const node = createPreviewElementNode(
        {
          ...element,
          animationType: 'none'
        },
        slide
      );
      previewStage.appendChild(node);
    });

  return previewRoot;
};

const hydrateTemplateStorePreviews = () => {
  templateStoreList?.querySelectorAll('[data-template-preview-key]').forEach((previewHost) => {
    const template = templateStoreCatalog.find((entry) => entry.key === previewHost.dataset.templatePreviewKey);
    if (!template) {
      return;
    }
    previewHost.innerHTML = '';
    const previewWidth = Math.max(180, previewHost.clientWidth || previewHost.getBoundingClientRect().width || 220);
    previewHost.appendChild(buildTemplateStorePreviewNode(template, previewWidth));
  });
};

const renderTemplateStoreList = () => {
  if (!templateStoreList) {
    return;
  }
  const query = String(templateStoreSearchInput?.value || '').trim().toLowerCase();
  const filteredTemplates = templateStoreCatalog.filter((template) => {
    if (!query) {
      return true;
    }
    return [
      template.title,
      template.description,
      template.category,
      template.badge,
      template.summary
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  if (!filteredTemplates.length) {
    templateStoreList.innerHTML = `<p class="muted" style="margin:0;">${
      query ? 'Nenhum template encontrado para esta busca.' : 'Nenhum template publicado na loja ainda.'
    }</p>`;
    return;
  }

  templateStoreList.innerHTML = filteredTemplates
    .map((template) => {
      const accentStyle = template.accentColor ? ` style="border-left:4px solid ${escapeHtml(template.accentColor)};"` : '';
      const meta = [
        template.category ? `<span class="template-store-chip">${escapeHtml(template.category)}</span>` : '',
        template.slideCount ? `<span class="template-store-chip">${template.slideCount} slide(s)</span>` : '',
        template.badge ? `<span class="template-store-chip">${escapeHtml(template.badge)}</span>` : ''
      ]
        .filter(Boolean)
        .join('');
      return `
        <article class="module-list-item template-store-card"${accentStyle}>
          <div data-template-preview-key="${escapeHtml(template.key)}"></div>
          <h4>${escapeHtml(template.title)}</h4>
          <p>${escapeHtml(template.description || 'Template pronto para reutilizar no editor.')}</p>
          ${template.summary ? `<p class="template-store-summary">${escapeHtml(template.summary)}</p>` : ''}
          ${meta ? `<div class="template-store-meta">${meta}</div>` : ''}
          <div class="template-store-actions">
            <button type="button" class="secondary-btn template-store-apply-btn" data-template-key="${escapeHtml(template.key)}">Usar template</button>
          </div>
        </article>
      `;
    })
    .join('');
  hydrateTemplateStorePreviews();
};

const loadTemplateStore = async () => {
  if (!templateStoreList || !templateStoreStatus) {
    return;
  }
  templateStoreStatus.textContent = 'Carregando catálogo da loja...';
  templateStoreList.innerHTML = '<p class="muted" style="margin:0;">Carregando templates da loja...</p>';
  try {
    const response = await authorizedFetch('/api/admin/template-store');
    if (!response.ok) {
      throw new Error('Erro ao carregar a loja de templates.');
    }
    const payload = await response.json();
    templateStoreCatalog = Array.isArray(payload?.templates) ? payload.templates : [];
    templateStoreStatus.textContent = templateStoreCatalog.length
      ? `${templateStoreCatalog.length} template(s) publicados na pasta ${payload?.folder || 'template-store'}.`
      : `Nenhum template encontrado na pasta ${payload?.folder || 'template-store'}.`;
    renderTemplateStoreList();
  } catch (error) {
    templateStoreCatalog = [];
    templateStoreStatus.textContent = error.message || 'Não foi possível carregar a loja de templates.';
    templateStoreList.innerHTML = '<p class="muted" style="margin:0; color:#ff6b6b;">Não foi possível carregar a loja de templates.</p>';
  }
};

const applyTemplateFromStore = async (templateKey) => {
  if (!templateKey) {
    return;
  }
  try {
    const response = await authorizedFetch(`/api/admin/template-store/${encodeURIComponent(templateKey)}`);
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.message || 'Não foi possível abrir o template da loja.');
    }
    const payload = await response.json();
    const templatePayload = parseTemplatePayload(payload?.payload || payload);
    const shouldReplaceCurrentLayout =
      !builderState.slides.length
      || (builderState.slides.length === 1 && !getActiveSlide()?.elements?.length)
      || confirm(`Aplicar "${templatePayload.title || 'este template'}" vai substituir o layout atual no editor. Deseja continuar?`);
    if (!shouldReplaceCurrentLayout) {
      return;
    }
    applyImportedTemplate(templatePayload);
    templateStoreStatus.textContent = `Template aplicado: ${templatePayload.title || 'Sem título'}.`;
  } catch (error) {
    alert(error.message || 'Não foi possível aplicar o template da loja.');
  }
};

const exportCurrentTemplate = () => {
  if (!builderState.slides.length) {
    alert('Adicione ao menos um slide antes de exportar um template.');
    return;
  }
  const payload = buildTemplatePayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = buildTemplateFileName(payload.template.title);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
  alert('Template exportado com sucesso.');
};

const importTemplateFromFile = async (file) => {
  if (!file) {
    return;
  }
  const rawText = await readFileAsText(file);
  const templatePayload = parseImportedTemplate(rawText);
  const shouldReplace = !builderState.slides.length
    || confirm('Importar o template vai substituir o layout atual no editor. Deseja continuar?');
  if (!shouldReplace) {
    return;
  }
  resetEditingState();
  applyImportedTemplate(templatePayload);
  pushAiAssistantFeedback('Template importado', 'O layout do arquivo foi carregado no editor e está pronto para ajustes.', 'success');
};

const updateBuilderStageSize = () => {
  builderState.stageSize = normalizeTemplateStageSize(builderState.stageSize);
  syncStageViewport();
};

const ensureActiveSlideBounds = () => {
  getActiveSlide()?.elements.forEach((element) => applyStageConstraints(element));
};

const applyStageConstraints = (element) => {
  if (!slideCanvas || !element) {
    return;
  }
  const { width: stageWidth, height: stageHeight } = getStageDimensions();
  if (stageWidth <= 0 || stageHeight <= 0) {
    return;
  }
  const targetWidth = Number(element.width) || 0;
  const targetHeight = Number(element.height) || 0;
  if (targetWidth > 0) {
    element.width = Math.min(targetWidth, stageWidth);
  }
  if (targetHeight > 0) {
    element.height = Math.min(targetHeight, stageHeight);
  }
  const maxX = Math.max(0, stageWidth - (element.width || 0));
  const maxY = Math.max(0, stageHeight - (element.height || 0));
  element.x = clamp(element.x ?? 0, 0, maxX);
  element.y = clamp(element.y ?? 0, 0, maxY);
};

const buildBackgroundStyle = (element) => {
  if (element.useGradient && element.gradientStart && element.gradientEnd) {
    return `linear-gradient(135deg, ${element.gradientStart}, ${element.gradientEnd})`;
  }
  return element.solidColor || element.backgroundColor || '#f4f6ff';
};

const getDefaultElementSize = (type) => {
  switch (type) {
    case 'block':
      return { width: 260, height: 150 };
    case 'image':
      return { width: 280, height: 180 };
    case 'audio':
      return { width: 260, height: 70 };
    case 'video':
      return { width: 320, height: 190 };
    case 'quiz':
      return { width: 420, height: 300 };
    case 'floatingButton':
      return { width: 170, height: 60 };
    case 'text':
      return { width: 260, height: 120 };
    default:
      return { width: 240, height: 140 };
  }
};

const ensureElementHasUsableSize = (element) => {
  if (!element) return;
  const fallback = getDefaultElementSize(element.type);
  const width = Number(element.width);
  const height = Number(element.height);
  if (!Number.isFinite(width) || width <= 0) {
    element.width = fallback.width;
  }
  if (!Number.isFinite(height) || height <= 0) {
    element.height = fallback.height;
  }
};

const getElementLayerBounds = (slide) => {
  const layers = (slide?.elements || []).map((element) => Number(element.zIndex) || 0);
  return {
    min: layers.length ? Math.min(...layers) : 0,
    max: layers.length ? Math.max(...layers) : 0
  };
};

const getElementBox = (element) => ({
  left: Number(element?.x) || 0,
  top: Number(element?.y) || 0,
  width: Math.max(MIN_ELEMENT_SIZE, Number(element?.width) || MIN_ELEMENT_SIZE),
  height: Math.max(MIN_ELEMENT_SIZE, Number(element?.height) || MIN_ELEMENT_SIZE)
});

const findContainingBlockForText = (textElement, slide = getActiveSlide()) => {
  if (!textElement || textElement.type !== 'text' || !slide?.elements?.length) {
    return null;
  }
  const textBox = getElementBox(textElement);
  const textCenterX = textBox.left + textBox.width / 2;
  const textCenterY = textBox.top + textBox.height / 2;
  const matchingBlocks = slide.elements
    .filter((element) => element.type === 'block' && element.id !== textElement.id)
    .map((block) => ({ block, box: getElementBox(block) }))
    .filter(({ box }) => textCenterX >= box.left && textCenterX <= box.left + box.width && textCenterY >= box.top && textCenterY <= box.top + box.height)
    .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height);
  return matchingBlocks[0]?.block || null;
};

const getStageRelativeElementBox = (element) => {
  const node = slideCanvas?.querySelector(`[data-element-id="${element?.id || ''}"]`);
  const canvasRect = slideCanvas?.getBoundingClientRect();
  const nodeRect = node?.getBoundingClientRect?.();
  if (node && canvasRect && nodeRect) {
    const scale = getStageScale();
    return {
      left: (nodeRect.left - canvasRect.left) / scale,
      top: (nodeRect.top - canvasRect.top) / scale,
      width: nodeRect.width / scale,
      height: nodeRect.height / scale
    };
  }
  return getElementBox(element);
};

const updateTextAlignmentControls = (element) => {
  const isText = element?.type === 'text';
  document.getElementById('textAlignToolsField')?.classList.toggle('hidden', !isText);
  if (centerTextStageBtn) {
    centerTextStageBtn.disabled = !isText;
  }
  if (centerTextBlockBtn) {
    centerTextBlockBtn.disabled = !isText || !findContainingBlockForText(element);
  }
};

const updateRemoveBackgroundButtonState = () => {
  if (!removeImageBackgroundBtn) return;
  removeImageBackgroundBtn.disabled = isRemovingImageBackground;
  removeImageBackgroundBtn.textContent = isRemovingImageBackground ? 'Removendo fundo...' : 'Remover fundo';
};

const toggleCollapsibleCard = (card, forceExpanded = null) => {
  if (!card) return;
  const shouldExpand = forceExpanded == null ? card.classList.contains('collapsed') : Boolean(forceExpanded);
  card.classList.toggle('collapsed', !shouldExpand);
  card.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
};

const getStageEditorCard = (editorType) => {
  switch (editorType) {
    case 'text':
      return textEditorCard;
    case 'block':
      return blockEditorCard;
    case 'image':
      return imageEditorCard;
    case 'audio':
      return audioEditorCard;
    case 'quiz':
      return quizEditorCard;
    case 'floating':
      return floatingButtonEditorCard;
    case 'video':
      return videoEditorCard;
    case 'background':
      return backgroundEditorCard;
    case 'eraser':
      return eraserEditorCard;
    case 'animation':
      return animationEditorCard;
    default:
      return null;
  }
};

const positionStageEditorCard = (editorType) => {
  const card = getStageEditorCard(editorType);
  if (!card || card.classList.contains('hidden')) {
    return;
  }
  const fallback = STAGE_EDITOR_DEFAULT_POSITIONS[editorType] || { x: 24, y: 108 };
  const nextPosition = stageEditorPositions[editorType] || fallback;
  const width = Math.min(card.offsetWidth || 720, window.innerWidth - 24);
  const height = Math.min(card.offsetHeight || 420, window.innerHeight - 24);
  const clampedX = clamp(nextPosition.x, 12, Math.max(12, window.innerWidth - width - 12));
  const clampedY = clamp(nextPosition.y, 12, Math.max(12, window.innerHeight - height - 12));
  stageEditorPositions[editorType] = { x: clampedX, y: clampedY };
  card.style.left = `${clampedX}px`;
  card.style.top = `${clampedY}px`;
};

const enableStageEditorDragging = (card) => {
  if (!card) return;
  const editorType = card.dataset.stageEditor;
  const handle = card.querySelector('.drag-handle, .quiz-editor-head');
  if (!editorType || !handle) return;
  let dragState = null;
  const onPointerMove = (event) => {
    if (!dragState) return;
    stageEditorPositions[editorType] = {
      x: event.clientX - dragState.offsetX,
      y: event.clientY - dragState.offsetY
    };
    positionStageEditorCard(editorType);
  };
  const stopDrag = () => {
    if (!dragState) return;
    card.classList.remove('is-dragging');
    dragState = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', stopDrag);
  };
  handle.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('button, input, textarea, select, label')) {
      return;
    }
    const rect = card.getBoundingClientRect();
    dragState = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    card.classList.add('is-dragging');
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', stopDrag);
  });
};

const getNextLayerIndex = (slide) => getElementLayerBounds(slide).max + 1;

const createDefaultQuizOptions = () => ['Opção 1', 'Opção 2', 'Opção 3'];
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

const normalizeRuntimeActionConfig = (config = {}) => ({
  ...config,
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
  ...(() => {
    const flags = getTextDecorationFlags(config, DEFAULT_INSERT_TEXT_STYLE);
    return {
      hasTextBackground: flags.hasTextBackground,
      hasTextBorder: flags.hasTextBorder,
      hasTextBlock: flags.legacyBlock
    };
  })()
});

const getQuizMinimumHeight = (options = []) => {
  const count = Math.max(3, Array.isArray(options) ? options.length : 0);
  return 300 + Math.max(0, count - 3) * 50;
};

const normalizeQuizElement = (element) => {
  if (!element || element.type !== 'quiz') {
    return;
  }
  element.question = element.question || 'Nova pergunta';
  element.options = Array.isArray(element.options) && element.options.length ? element.options : createDefaultQuizOptions();
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
  element.width = Math.max(420, Number(element.width) || 420);
  element.height = Math.max(getQuizMinimumHeight(element.options), Number(element.height) || 0);
};

const normalizeFloatingActionConfig = (element) => {
  if (!element || !['floatingButton', 'detector'].includes(element.type)) {
    return;
  }
  const config = element.actionConfig || {};
  const textFlags = getTextDecorationFlags(config, DEFAULT_INSERT_TEXT_STYLE);
  config.type = config.type || 'none';
  config.targetSlideId = config.targetSlideId || '';
  config.targetElementId = config.targetElementId || '';
  config.ruleGroup = config.ruleGroup || '';
  config.requireAllButtonsInGroup = Boolean(config.requireAllButtonsInGroup);
  config.text = config.text || 'Novo texto';
  config.url = config.url || '';
  config.audioVisible = typeof config.audioVisible === 'boolean' ? config.audioVisible : true;
  config.audioLoop = Boolean(config.audioLoop);
  config.textColor = config.textColor || DEFAULT_INSERT_TEXT_STYLE.textColor;
  config.backgroundColor = config.backgroundColor || DEFAULT_INSERT_TEXT_STYLE.backgroundColor;
  config.textAlign = config.textAlign || DEFAULT_INSERT_TEXT_STYLE.textAlign;
  config.fontFamily = config.fontFamily || DEFAULT_INSERT_TEXT_STYLE.fontFamily;
  config.fontWeight = config.fontWeight || DEFAULT_INSERT_TEXT_STYLE.fontWeight;
  config.fontSize = Number.isFinite(Number(config.fontSize)) ? Number(config.fontSize) : DEFAULT_INSERT_TEXT_STYLE.fontSize;
  config.hasTextBackground = textFlags.hasTextBackground;
  config.hasTextBorder = textFlags.hasTextBorder;
  config.hasTextBlock = textFlags.legacyBlock;
  config.insertX = Number.isFinite(Number(config.insertX)) ? Number(config.insertX) : 120;
  config.insertY = Number.isFinite(Number(config.insertY)) ? Number(config.insertY) : 120;
  config.insertWidth = Number.isFinite(Number(config.insertWidth)) ? Number(config.insertWidth) : 280;
  config.insertHeight = Number.isFinite(Number(config.insertHeight)) ? Number(config.insertHeight) : 180;
  config.moveByX = Number.isFinite(Number(config.moveByX)) ? Number(config.moveByX) : 160;
  config.moveByY = Number.isFinite(Number(config.moveByY)) ? Number(config.moveByY) : 0;
  config.moveDuration = Number.isFinite(Number(config.moveDuration)) ? Number(config.moveDuration) : 0.8;
  config.videoTime = Number.isFinite(Number(config.videoTime)) ? Number(config.videoTime) : 0;
  config.replaceMode = getReplaceTextMode(config.replaceMode);
  config.replaceText = typeof config.replaceText === 'string' ? config.replaceText : '';
  config.replaceCounterStart = Number.isFinite(Number(config.replaceCounterStart)) ? Number(config.replaceCounterStart) : 1;
  config.replaceCounterStep = Number.isFinite(Number(config.replaceCounterStep)) ? Number(config.replaceCounterStep) : 1;
  config.quizQuestion = config.quizQuestion || 'Nova pergunta';
  config.quizOptions = Array.isArray(config.quizOptions) && config.quizOptions.length ? config.quizOptions : createDefaultQuizOptions();
  config.quizCorrectOption = Math.min(Math.max(Number(config.quizCorrectOption) || 0, 0), config.quizOptions.length - 1);
  config.successMessage = config.successMessage || 'Resposta correta!';
  config.errorMessage = config.errorMessage || 'Resposta incorreta. Tente novamente.';
  config.actionLabel = config.actionLabel || 'Validar resposta';
  config.quizBackgroundColor = config.quizBackgroundColor || '#ffffff';
  config.quizQuestionColor = config.quizQuestionColor || '#171934';
  config.quizOptionBackgroundColor = config.quizOptionBackgroundColor || '#f4f6ff';
  config.quizOptionTextColor = config.quizOptionTextColor || '#25284c';
  config.quizButtonBackgroundColor = config.quizButtonBackgroundColor || '#6d63ff';
  config.points = Math.max(1, Number(config.points) || 1);
  config.lockOnWrong = Boolean(config.lockOnWrong);
  config.detectorAcceptedDrag = normalizeDetectorAcceptedDragValue(config.detectorAcceptedDrag);
  config.detectorMinMatchCount = Math.max(1, Number(config.detectorMinMatchCount) || 1);
  config.detectorTriggerOnce = Boolean(config.detectorTriggerOnce);
  element.actionConfig = config;
};

const VIDEO_TRIGGER_ACTIONS = new Set(['none', 'pauseVideo', 'playVideo', 'seekVideo']);
const VIDEO_TRIGGER_TARGET_ACTIONS = new Set(['playAudio', 'showElement', 'hideElement']);

const normalizeVideoTriggerConfig = (element) => {
  if (!element || element.type !== 'video') {
    return;
  }
  element.videoTriggerTime = Number.isFinite(Number(element.videoTriggerTime)) ? Number(element.videoTriggerTime) : 0;
  element.videoTriggerAction = VIDEO_TRIGGER_ACTIONS.has(String(element.videoTriggerAction || 'none'))
    ? String(element.videoTriggerAction || 'none')
    : 'none';
  element.videoTriggerSeekTime = Number.isFinite(Number(element.videoTriggerSeekTime)) ? Number(element.videoTriggerSeekTime) : 0;
  element.videoTriggerTargetElementId = typeof element.videoTriggerTargetElementId === 'string' ? element.videoTriggerTargetElementId : '';
};

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

const isSpecificDetectorElementRule = (value) =>
  normalizeDetectorAcceptedDragValue(value).startsWith(DETECTOR_ACCEPT_ELEMENT_PREFIX);

const canDetectorTrackElement = (element) => {
  if (!element || element.type === 'detector') {
    return false;
  }
  return ['text', 'block', 'image', 'audio', 'video', 'quiz', 'floatingButton'].includes(element.type);
};

const doesElementMatchDetectorRule = (element, acceptedDrag = DETECTOR_ACCEPT_ANY) => {
  if (!canDetectorTrackElement(element)) {
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

const getPreviewDetectorStateKey = (slideId, detectorId) => `${slideId || 'slide'}::${detectorId || 'detector'}`;
const getPreviewHiddenElementsKey = (slideId) => slideId || 'slide';

const getPreviewHiddenElementIds = (slideId) => previewState.hiddenElements.get(getPreviewHiddenElementsKey(slideId)) || new Set();

const setPreviewElementHidden = (slideId, elementId, hidden) => {
  if (!slideId || !elementId) {
    return false;
  }
  const key = getPreviewHiddenElementsKey(slideId);
  const hiddenIds = new Set(previewState.hiddenElements.get(key) || []);
  if (hidden) {
    hiddenIds.add(elementId);
  } else {
    hiddenIds.delete(elementId);
  }
  previewState.hiddenElements.set(key, hiddenIds);
  return true;
};

const isPreviewElementHidden = (slideId, elementId) => getPreviewHiddenElementIds(slideId).has(elementId);

const getDetectorMatchingElements = (detector, slide) => {
  if (!detector || !slide) {
    return [];
  }
  normalizeFloatingActionConfig(detector);
  const detectorBox = getElementRuntimeBox(detector);
  return (slide.elements || []).filter((item) => {
    if (!item || item.id === detector.id || !doesElementMatchDetectorRule(item, detector.actionConfig?.detectorAcceptedDrag)) {
      return false;
    }
    return boxesOverlap(detectorBox, getElementRuntimeBox(item));
  });
};

const evaluatePreviewDetectorActivation = (detector, draggedElement, slide) => {
  if (!detector || !draggedElement || !slide) {
    return { ready: false, reason: 'invalid' };
  }
  normalizeFloatingActionConfig(detector);
  const config = detector.actionConfig || {};
  if (!doesElementMatchDetectorRule(draggedElement, config.detectorAcceptedDrag)) {
    return { ready: false, reason: 'mismatch' };
  }
  const stateKey = getPreviewDetectorStateKey(slide.id, detector.id);
  if (config.detectorTriggerOnce && previewState.triggeredDetectors.has(stateKey)) {
    return { ready: false, reason: 'already-triggered' };
  }
  const matchingElements = getDetectorMatchingElements(detector, slide);
  if (matchingElements.length < config.detectorMinMatchCount) {
    return { ready: false, reason: 'missing-elements', matchingCount: matchingElements.length };
  }
  return { ready: true, stateKey };
};

const markPreviewDetectorTriggered = (slide, detector) => {
  if (!slide || !detector) {
    return;
  }
  previewState.triggeredDetectors.add(getPreviewDetectorStateKey(slide.id, detector.id));
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

const getPreviewReplaceCounterKey = (slideId, sourceId, targetId) =>
  `${slideId || 'slide'}::${sourceId || 'source'}::${targetId || 'target'}`;

const executePreviewReplaceTextAction = (sourceElement, safeConfig, slide) => {
  if (!slide) {
    return false;
  }
  const target = slide.elements?.find((item) => item?.id === safeConfig.targetElementId);
  if (!target || !REPLACEABLE_TEXT_TYPES.has(target.type)) {
    return false;
  }
  const mode = getReplaceTextMode(safeConfig.replaceMode);
  if (mode === REPLACE_COUNTER_MODE) {
    const counterKey = getPreviewReplaceCounterKey(slide.id, sourceElement?.id, target.id);
    const currentValue = previewState.replaceCounters.has(counterKey)
      ? previewState.replaceCounters.get(counterKey)
      : Number(safeConfig.replaceCounterStart) || 1;
    setElementTextualContent(target, `${safeConfig.replaceText || ''}${currentValue}`);
    previewState.replaceCounters.set(counterKey, currentValue + (Number(safeConfig.replaceCounterStep) || 1));
    return true;
  }
  return setElementTextualContent(target, safeConfig.replaceText || '');
};

const getPreviewRuleStateKey = (slideId, ruleGroup) => `${slideId || 'slide'}::${ruleGroup || 'group'}`;

const registerPreviewFloatingRuleClick = (slide, element) => {
  const config = element?.actionConfig || {};
  if (!slide || !element?.id || !config.requireAllButtonsInGroup) {
    return { ready: true, remaining: 0 };
  }
  const ruleGroup = String(config.ruleGroup || '').trim();
  if (!ruleGroup) {
    return { ready: false, remaining: 1, invalid: true };
  }
  const requiredButtons = (slide.elements || []).filter((item) => {
    if (item?.type !== 'floatingButton' || !item?.id) return false;
    normalizeFloatingActionConfig(item);
    return item.actionConfig.requireAllButtonsInGroup && String(item.actionConfig.ruleGroup || '').trim() === ruleGroup;
  });
  if (requiredButtons.length < 2) {
    return { ready: false, remaining: 1, invalid: true };
  }
  const stateKey = getPreviewRuleStateKey(slide.id, ruleGroup);
  const clickedIds = new Set(previewState.clickedRuleButtons.get(stateKey) || []);
  clickedIds.add(element.id);
  previewState.clickedRuleButtons.set(stateKey, clickedIds);
  const remaining = Math.max(0, requiredButtons.length - clickedIds.size);
  return { ready: remaining === 0, remaining, total: requiredButtons.length };
};

const syncPreviewFloatingRuleButtonState = (slide, elementId) => {
  if (!slide || !elementId) {
    return;
  }
  const element = slide.elements?.find((item) => item?.id === elementId && item.type === 'floatingButton');
  const node = findPreviewNodeByElementId(elementId);
  if (!element || !node) {
    return;
  }
  const config = element.actionConfig || {};
  const ruleGroup = String(config.ruleGroup || '').trim();
  const stateKey = getPreviewRuleStateKey(slide.id, ruleGroup);
  const clickedIds = previewState.clickedRuleButtons.get(stateKey) || new Set();
  node.classList.toggle('floating-button-completed', clickedIds.has(elementId));
};

const getSelectedActionTriggerElement = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  return ['floatingButton', 'detector'].includes(element?.type) ? element : null;
};

const getFloatingInsertPreviewRect = (config) => {
  const { width: stageWidth, height: stageHeight } = getStageDimensions();
  const width = Math.max(40, Number(config?.insertWidth) || 280);
  const height = Math.max(40, Number(config?.insertHeight) || 180);
  const maxX = Math.max(0, stageWidth - width);
  const maxY = Math.max(0, stageHeight - height);
  return {
    width,
    height,
    x: clamp(Math.max(0, Number(config?.insertX) || 120), 0, maxX),
    y: clamp(Math.max(0, Number(config?.insertY) || 120), 0, maxY)
  };
};

const getFloatingTargetCandidateIds = (actionType = 'none', sourceElement = null) => {
  const slide = getActiveSlide();
  const allowedTypes = ['playVideo', 'pauseVideo', 'seekVideo'].includes(actionType)
    ? ['video']
    : actionType === 'playAudio'
      ? ['audio']
      : ['showElement', 'hideElement'].includes(actionType)
        ? ['text', 'block', 'image', 'audio', 'video', 'quiz', 'floatingButton', 'detector', 'animatedArrow']
    : actionType === 'moveElement'
      ? ['text', 'block', 'image']
      : actionType === 'replaceText'
        ? Array.from(REPLACEABLE_TEXT_TYPES)
        : actionType === 'playAnimation'
          ? Array.from(ANIMATABLE_ELEMENT_TYPES)
          : [];
  return new Set(
    (slide?.elements || [])
      .filter((item) => {
        if (!item?.id || !allowedTypes.includes(item.type) || item.id === sourceElement?.id) {
          return false;
        }
        if (allowedTypes.includes('video') && item.type === 'video' && item.provider === 'youtube') {
          return false;
        }
        return true;
      })
      .map((item) => item.id)
  );
};

const updateFloatingPlacementControls = (element) => {
  const isFloatingButton = element?.type === 'floatingButton';
  const actionType = element?.actionConfig?.type || 'none';
  const supportsPlacement = isFloatingButton && FLOATING_INSERT_ACTIONS.includes(actionType);
  const supportsTargetPicking = ['moveElement', 'playAnimation', 'replaceText', 'playAudio', 'playVideo', 'pauseVideo', 'seekVideo', 'showElement', 'hideElement'].includes(actionType);
  document.getElementById('floatingPlacementToolsField')?.classList.toggle('hidden', !supportsPlacement);
  if (floatingPickPlacementBtn) {
    floatingPickPlacementBtn.textContent = isPickingFloatingInsertPosition && supportsPlacement ? 'Clique no palco...' : 'Marcar no palco';
    floatingPickPlacementBtn.classList.toggle('active', isPickingFloatingInsertPosition && supportsPlacement);
  }
  if (floatingPickTargetElementBtn) {
    floatingPickTargetElementBtn.textContent =
      isPickingFloatingTargetElement && supportsTargetPicking ? 'Clique no elemento...' : 'Selecionar no palco';
    floatingPickTargetElementBtn.classList.toggle('active', isPickingFloatingTargetElement && supportsTargetPicking);
    floatingPickTargetElementBtn.disabled = !supportsTargetPicking;
  }
  if (floatingPlacementHint) {
    floatingPlacementHint.textContent = supportsPlacement
      ? isPickingFloatingInsertPosition
        ? 'Clique no palco para definir a posição do item.'
        : 'A prévia mostra onde o item vai aparecer.'
      : 'Escolha uma ação que adicione item para marcar a posição.';
  }
};

const centerSelectedText = (mode = 'stage') => {
  const slide = getActiveSlide();
  const element = slide?.elements.find((child) => child.id === selectedElementId);
  if (!slide || !element || element.type !== 'text') {
    return;
  }
  const textBox = getStageRelativeElementBox(element);
  let targetBox;
  if (mode === 'block') {
    const block = findContainingBlockForText(element, slide);
    if (!block) {
      alert('Posicione o texto dentro de um bloco para centralizar em relação a ele.');
      updateTextAlignmentControls(element);
      return;
    }
    targetBox = getStageRelativeElementBox(block);
  } else {
    const stage = getStageDimensions();
    targetBox = { left: 0, top: 0, width: stage.width, height: stage.height };
  }
  element.x = Math.round(targetBox.left + (targetBox.width - textBox.width) / 2);
  element.y = Math.round(targetBox.top + (targetBox.height - textBox.height) / 2);
  applyStageConstraints(element);
  updateElementInspector(element);
  renderSlide();
  commitHistoryState();
};

const updateFloatingPlacementPreview = () => {
  if (!slideCanvas) return;
  slideCanvas.querySelectorAll('.floating-placement-preview').forEach((node) => node.remove());
  slideCanvas.querySelectorAll('.floating-target-candidate').forEach((node) => node.classList.remove('floating-target-candidate'));
  const element = getSelectedActionTriggerElement();
  if (!element) {
    isPickingFloatingInsertPosition = false;
    isPickingFloatingTargetElement = false;
    updateFloatingPlacementControls(null);
    return;
  }
  normalizeFloatingActionConfig(element);
  const actionType = element.actionConfig?.type || 'none';
  if (!FLOATING_INSERT_ACTIONS.includes(actionType)) {
    isPickingFloatingInsertPosition = false;
  }
  if (!['moveElement', 'playAnimation', 'replaceText'].includes(actionType)) {
    isPickingFloatingTargetElement = false;
  }
  if (FLOATING_INSERT_ACTIONS.includes(actionType)) {
    const preview = document.createElement('div');
    const rect = getFloatingInsertPreviewRect(element.actionConfig);
    preview.className = `floating-placement-preview${isPickingFloatingInsertPosition ? ' picking' : ''}`;
    preview.dataset.label = `Prévia ${rect.width}x${rect.height}`;
    preview.style.left = `${rect.x}px`;
    preview.style.top = `${rect.y}px`;
    preview.style.width = `${rect.width}px`;
    preview.style.height = `${rect.height}px`;
    slideCanvas.appendChild(preview);
  }
  const candidateIds = getFloatingTargetCandidateIds(actionType, element);
  slideCanvas.querySelectorAll('[data-element-id]').forEach((node) => {
    const targetId = node.getAttribute('data-element-id') || '';
    node.classList.toggle('floating-target-candidate', isPickingFloatingTargetElement && candidateIds.has(targetId));
  });
  updateFloatingPlacementControls(element);
};

const createPreviewRuntimeElement = (type, source, slide) => {
  const maxLayer = Math.max(0, ...(slide.elements || []).map((element) => Number(element.zIndex) || 0));
  const base = {
    id: `preview-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    return { ...base, src: source.url || '', width: Math.max(40, Number(source.insertWidth) || 320), height: Math.max(40, Number(source.insertHeight) || 190) };
  }
  return {
    ...base,
    question: source.quizQuestion || 'Nova pergunta',
    options: Array.isArray(source.quizOptions) && source.quizOptions.length ? source.quizOptions : createDefaultQuizOptions(),
    correctOption: Math.max(0, Number(source.quizCorrectOption) || 0),
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

const isTypingTarget = (target) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  Boolean(target?.isContentEditable);

const getElementRuntimeBox = (element) => {
  const renderState = getElementRenderState(element);
  return {
    left: Number(renderState.x) || 0,
    top: Number(renderState.y) || 0,
    width: Math.max(MIN_ELEMENT_SIZE, Number(renderState.width) || MIN_ELEMENT_SIZE),
    height: Math.max(MIN_ELEMENT_SIZE, Number(renderState.height) || MIN_ELEMENT_SIZE)
  };
};

const boxesOverlap = (first, second) =>
  first.left < second.left + second.width &&
  first.left + first.width > second.left &&
  first.top < second.top + second.height &&
  first.top + first.height > second.top;

const findPreviewNodeByElementId = (elementId) => slideCanvas?.querySelector(`[data-element-id="${elementId}"]`) || null;

const applyPreviewAudioPresentation = (node, element, { authoring = false } = {}) => {
  normalizeAudioElement(element);
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

const controlPreviewAudioElement = (slide, targetElementId) => {
  if (!slide || !targetElementId) {
    return false;
  }
  const target = slide.elements?.find((item) => item?.id === targetElementId && item.type === 'audio');
  if (!target) {
    return false;
  }
  const node = findPreviewNodeByElementId(targetElementId);
  if (!(node instanceof HTMLAudioElement)) {
    return false;
  }
  node.currentTime = 0;
  node.play().catch(() => {});
  return true;
};

const setPreviewElementVisibilityFromAction = (slide, targetElementId, hidden) => {
  if (!slide || !targetElementId || !slide.elements?.some((item) => item?.id === targetElementId)) {
    return false;
  }
  return setPreviewElementHidden(slide.id, targetElementId, hidden);
};

const controlPreviewVideoElement = (slide, targetElementId, actionType, timeSeconds = 0) => {
  if (!slide || !targetElementId) {
    return false;
  }
  const target = slide.elements?.find((item) => item?.id === targetElementId && item.type === 'video');
  if (!target || target.provider === 'youtube') {
    return false;
  }
  const node = findPreviewNodeByElementId(targetElementId);
  if (!(node instanceof HTMLVideoElement)) {
    return false;
  }
  const nextTime = Math.max(0, Number(timeSeconds) || 0);
  switch (actionType) {
    case 'playVideo':
      node.play().catch(() => {});
      return true;
    case 'pauseVideo':
      node.pause();
      return true;
    case 'seekVideo':
      node.currentTime = nextTime;
      node.play().catch(() => {});
      return true;
    default:
      return false;
  }
};

const attachPreviewVideoTimedTrigger = (videoNode, element) => {
  normalizeVideoTriggerConfig(element);
  if (!(videoNode instanceof HTMLVideoElement) || element.provider === 'youtube') {
    return;
  }
  const triggerTime = Math.max(0, Number(element.videoTriggerTime) || 0);
  if ((element.videoTriggerAction || 'none') === 'none' || triggerTime <= 0) {
    return;
  }
  let fired = false;
  const resetIfNeeded = () => {
    if ((videoNode.currentTime || 0) < triggerTime) {
      fired = false;
    }
  };
  videoNode.addEventListener('seeking', resetIfNeeded);
  videoNode.addEventListener('timeupdate', () => {
    if (fired || (videoNode.currentTime || 0) < triggerTime) {
      return;
    }
    fired = true;
    const action = element.videoTriggerAction || 'none';
    if (action === 'pauseVideo') {
      videoNode.pause();
      return;
    }
    if (action === 'playAudio') {
      controlPreviewAudioElement(getPreviewActiveSlide(), element.videoTriggerTargetElementId || '');
      return;
    }
    if (action === 'playVideo') {
      videoNode.play().catch(() => {});
      return;
    }
    if (action === 'seekVideo') {
      videoNode.currentTime = Math.max(0, Number(element.videoTriggerSeekTime) || 0);
      videoNode.play().catch(() => {});
      return;
    }
    if (action === 'showElement') {
      setPreviewElementVisibilityFromAction(getPreviewActiveSlide(), element.videoTriggerTargetElementId || '', false);
      renderSlide();
      return;
    }
    if (action === 'hideElement') {
      setPreviewElementVisibilityFromAction(getPreviewActiveSlide(), element.videoTriggerTargetElementId || '', true);
      renderSlide();
    }
  });
  videoNode.addEventListener('ended', () => {
    fired = false;
  });
};

const animatePreviewElementMove = (slide, element, deltaX, deltaY, durationSeconds = 0.8, options = {}) => {
  if (!slide || !element) {
    return false;
  }
  const currentState = getElementRenderState(element);
  const stage = getStageDimensions();
  const nextX = clamp(currentState.x + deltaX, 0, Math.max(0, stage.width - currentState.width));
  const nextY = clamp(currentState.y + deltaY, 0, Math.max(0, stage.height - currentState.height));
  element.x = nextX;
  element.y = nextY;
  const node = findPreviewNodeByElementId(element.id);
  if (node && typeof node.animate === 'function') {
    node.animate(
      [
        { left: `${currentState.x}px`, top: `${currentState.y}px` },
        { left: `${nextX}px`, top: `${nextY}px` }
      ],
      { duration: Math.max(100, durationSeconds * 1000), easing: 'ease-in-out', fill: 'forwards' }
    );
    window.setTimeout(() => {
      const triggered = triggerPreviewDetectorsForElement(element, slide, {
        excludeDetectorId: options.excludeDetectorId || ''
      });
    }, Math.max(120, durationSeconds * 1000) + 20);
    return true;
  }
  const triggered = triggerPreviewDetectorsForElement(element, slide, {
    excludeDetectorId: options.excludeDetectorId || ''
  });
  return true;
};

const replayPreviewElementAnimation = (slide, targetElementId) => {
  if (!slide || !targetElementId) {
    return false;
  }
  const target = slide.elements?.find((item) => item?.id === targetElementId);
  if (!target || !ANIMATABLE_ELEMENT_TYPES.has(target.type) || (target.animationType || 'none') === 'none') {
    return false;
  }
  resetPreviewAnimationStateForElement(slide.id, target.id);
  renderSlide();
  return true;
};

const executePreviewActionConfig = (element, config, slide) => {
  const safeConfig = normalizeRuntimeActionConfig(config || {});
  switch (safeConfig.type) {
    case 'nextSlide': {
      const currentIndex = previewState.slides.findIndex((entry) => entry.id === slide.id);
      const nextSlide = previewState.slides[currentIndex + 1];
      if (nextSlide) {
        previewState.activeSlideId = nextSlide.id;
      }
      return true;
    }
    case 'jumpSlide':
      if (safeConfig.targetSlideId && previewState.slides.some((entry) => entry.id === safeConfig.targetSlideId)) {
        previewState.activeSlideId = safeConfig.targetSlideId;
        return true;
      }
      return false;
    case 'moveElement': {
      const target = slide.elements?.find((item) => item?.id === safeConfig.targetElementId);
      return animatePreviewElementMove(
        slide,
        target,
        Number(safeConfig.moveByX) || 0,
        Number(safeConfig.moveByY) || 0,
        Number(safeConfig.moveDuration) || 0.8,
        { excludeDetectorId: element?.type === 'detector' ? element.id : '' }
      );
    }
    case 'playAnimation':
      return replayPreviewElementAnimation(slide, safeConfig.targetElementId);
    case 'playAudio':
      return controlPreviewAudioElement(slide, safeConfig.targetElementId);
    case 'playVideo':
    case 'pauseVideo':
    case 'seekVideo':
      return controlPreviewVideoElement(slide, safeConfig.targetElementId, safeConfig.type, safeConfig.videoTime);
    case 'showElement':
      return setPreviewElementVisibilityFromAction(slide, safeConfig.targetElementId, false);
    case 'hideElement':
      return setPreviewElementVisibilityFromAction(slide, safeConfig.targetElementId, true);
    case 'replaceText':
      return executePreviewReplaceTextAction(element, safeConfig, slide);
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
      slide.elements = slide.elements || [];
      const runtimeSourceId = element.id;
      const runtimeActionType = config.type;
      const hasExistingRuntimeElement = slide.elements.some(
        (item) => item?.isRuntimeGenerated && item.runtimeSourceId === runtimeSourceId && item.runtimeActionType === runtimeActionType
      );
      if (hasExistingRuntimeElement) {
        slide.elements = slide.elements.filter(
          (item) => !(item?.isRuntimeGenerated && item.runtimeSourceId === runtimeSourceId && item.runtimeActionType === runtimeActionType)
        );
      } else {
        slide.elements.push(
          createPreviewRuntimeElement(elementTypeMap[safeConfig.type], { ...safeConfig, runtimeSourceId, runtimeActionType }, slide)
        );
      }
      return true;
    }
    default:
      return false;
  }
};

const triggerPreviewDetectorsForElement = (draggedElement, slide, options = {}) => {
  if (!slide || !draggedElement) {
    return false;
  }
  const draggedBox = getElementRuntimeBox(draggedElement);
  let activated = false;
  (slide.elements || [])
    .filter((item) => item?.type === 'detector' && item.id !== draggedElement.id && item.id !== options.excludeDetectorId)
    .forEach((detector) => {
      if (!boxesOverlap(draggedBox, getElementRuntimeBox(detector))) {
        return;
      }
      const activation = evaluatePreviewDetectorActivation(detector, draggedElement, slide);
      if (!activation.ready) {
        return;
      }
      const didTrigger = executePreviewActionConfig(detector, detector.actionConfig || {}, slide);
      activated = didTrigger || activated;
      if (didTrigger && detector.actionConfig?.detectorTriggerOnce) {
        markPreviewDetectorTriggered(slide, detector);
      }
    });
  if (activated) {
    renderSlide();
  }
  return activated;
};

const enablePreviewStudentDrag = (node, element, slide) => {
  if (!node || !canStudentDragElement(element) || !slideCanvas || previewState.active !== true) {
    return;
  }
  let pointerId;
  let offsetX = 0;
  let offsetY = 0;
  const updatePosition = () => {
    const stage = getStageDimensions();
    const box = getElementRuntimeBox(element);
    element.x = clamp(Number(element.x) || 0, 0, Math.max(0, stage.width - box.width));
    element.y = clamp(Number(element.y) || 0, 0, Math.max(0, stage.height - box.height));
    node.style.left = `${element.x}px`;
    node.style.top = `${element.y}px`;
  };
  const onMove = (event) => {
    event.preventDefault();
    const pointer = getStagePointerPosition(event);
    element.x = pointer.x - offsetX;
    element.y = pointer.y - offsetY;
    updatePosition();
  };
  const stop = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', stop);
    document.removeEventListener('pointercancel', stop);
    if (pointerId !== undefined) {
      node.releasePointerCapture?.(pointerId);
      pointerId = undefined;
    }
    triggerPreviewDetectorsForElement(element, slide);
  };
  node.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    pointerId = event.pointerId;
    const currentState = getElementRenderState(element);
    const pointer = getStagePointerPosition(event);
    offsetX = pointer.x - currentState.x;
    offsetY = pointer.y - currentState.y;
    node.setPointerCapture?.(pointerId);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
  });
};

const executePreviewFloatingButtonAction = (element) => {
  const slide = getPreviewActiveSlide();
  if (!slide || !element) return;
  normalizeFloatingActionConfig(element);
  const ruleState = registerPreviewFloatingRuleClick(slide, element);
  syncPreviewFloatingRuleButtonState(slide, element.id);
  if (!ruleState.ready) {
    if (ruleState.invalid) {
      alert('Essa regra precisa de um nome de grupo e de pelo menos 2 botões no mesmo slide.');
    } else {
      alert(`Faltam ${ruleState.remaining} botão(ões) desta regra para liberar a ação.`);
    }
    return;
  }
  executePreviewActionConfig(element, element.actionConfig || {}, slide);
  if (!['moveElement', 'playAnimation', 'playAudio', 'playVideo', 'pauseVideo', 'seekVideo'].includes(element.actionConfig?.type || 'none')) {
    renderSlide();
  }
};

const updateHistoryButtons = () => {
  if (undoActionBtn) {
    undoActionBtn.disabled = historyState.past.length <= 1;
  }
  if (copyActionBtn) {
    copyActionBtn.disabled = !selectedElementId || previewState.active;
  }
  if (pasteActionBtn) {
    pasteActionBtn.disabled = !clipboardState.element || previewState.active;
  }
  if (redoActionBtn) {
    redoActionBtn.disabled = historyState.future.length === 0;
  }
};

const getKeyboardMoveStep = () => {
  const rawValue = Number(keyboardMoveStepInput?.value);
  const nextValue = Number.isFinite(rawValue) ? Math.round(rawValue) : DEFAULT_KEYBOARD_MOVE_STEP;
  return clamp(nextValue || DEFAULT_KEYBOARD_MOVE_STEP, 1, 500);
};

const syncKeyboardMoveStepInput = () => {
  if (!keyboardMoveStepInput) {
    return DEFAULT_KEYBOARD_MOVE_STEP;
  }
  const nextValue = getKeyboardMoveStep();
  keyboardMoveStepInput.value = String(nextValue);
  return nextValue;
};

const createEditorSnapshot = () =>
  JSON.stringify({
    slides: builderState.slides,
    activeSlideId: builderState.activeSlideId,
    selectedElementId,
    moduleTitle: moduleTitleInput?.value || '',
    moduleDescription: moduleDescriptionInput?.value || '',
    selectedCourseId: moduleCourseSelect?.value || ''
  });

const applyEditorSnapshot = (snapshot) => {
  const state = JSON.parse(snapshot);
  historyState.suppressCommit = true;
  builderState.slides = Array.isArray(state.slides) ? state.slides : [];
  builderState.activeSlideId = state.activeSlideId || builderState.slides[0]?.id || null;
  selectedElementId = state.selectedElementId || null;
  if (moduleTitleInput) {
    moduleTitleInput.value = state.moduleTitle || '';
  }
  if (moduleDescriptionInput) {
    moduleDescriptionInput.value = state.moduleDescription || '';
  }
  if (moduleCourseSelect && state.selectedCourseId) {
    moduleCourseSelect.value = state.selectedCourseId;
  }
  renderSlideList();
  renderSlide();
  const selectedElement = getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null;
  updateElementInspector(selectedElement);
  historyState.suppressCommit = false;
};

const commitHistoryState = () => {
  if (historyState.suppressCommit) {
    return;
  }
  const snapshot = createEditorSnapshot();
  if (historyState.past[historyState.past.length - 1] === snapshot) {
    updateHistoryButtons();
    return;
  }
  historyState.past.push(snapshot);
  historyState.future = [];
  updateHistoryButtons();
};

const scheduleHistoryCommit = () => {
  if (historyState.suppressCommit) {
    return;
  }
  clearTimeout(historyState.debounceTimer);
  historyState.debounceTimer = setTimeout(() => {
    commitHistoryState();
  }, 220);
};

const undoLastAction = () => {
  if (historyState.past.length <= 1) {
    return;
  }
  clearTimeout(historyState.debounceTimer);
  const currentSnapshot = historyState.past.pop();
  historyState.future.push(currentSnapshot);
  const previousSnapshot = historyState.past[historyState.past.length - 1];
  if (previousSnapshot) {
    applyEditorSnapshot(previousSnapshot);
  }
  updateHistoryButtons();
};

const redoLastAction = () => {
  if (!historyState.future.length) {
    return;
  }
  clearTimeout(historyState.debounceTimer);
  const nextSnapshot = historyState.future.pop();
  historyState.past.push(nextSnapshot);
  applyEditorSnapshot(nextSnapshot);
  updateHistoryButtons();
};

const resetHistoryState = () => {
  clearTimeout(historyState.debounceTimer);
  historyState.past = [createEditorSnapshot()];
  historyState.future = [];
  updateHistoryButtons();
};

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

const chooseMediaSource = (label) => {
  const choice = prompt(
    `Como você quer adicionar ${label}?\n1 - Arquivo do computador\n2 - URL`,
    '1'
  );
  if (choice === null) return null;
  const normalized = choice.trim().toLowerCase();
  if (normalized === '1' || normalized === 'arquivo' || normalized === 'computador') {
    return 'local';
  }
  if (normalized === '2' || normalized === 'url' || normalized === 'link') {
    return 'url';
  }
  alert('Escolha 1 para arquivo do computador ou 2 para URL.');
  return null;
};

const updateBackgroundMediaEditorFields = () => {
  const mode = backgroundMediaTypeSelect?.value || 'image-url';
  document.getElementById('backgroundSolidColorField')?.classList.toggle('hidden', mode !== 'color-solid');
  document.getElementById('backgroundGradientStartField')?.classList.toggle('hidden', mode !== 'color-gradient');
  document.getElementById('backgroundGradientEndField')?.classList.toggle('hidden', mode !== 'color-gradient');
  document.getElementById('backgroundMediaUrlField')?.classList.toggle('hidden', !['image-url', 'video-url'].includes(mode));
  document.getElementById('backgroundMediaLocalField')?.classList.toggle('hidden', !['image-local', 'video-local'].includes(mode));
  if (!backgroundMediaEditorStatus) return;
  if (mode === 'color-solid') {
    backgroundMediaEditorStatus.textContent = 'Escolha uma cor sólida para o fundo do slide.';
    return;
  }
  if (mode === 'color-gradient') {
    backgroundMediaEditorStatus.textContent = 'Escolha duas cores para montar um fundo em gradiente.';
    return;
  }
  if (mode === 'video-url' || mode === 'video-local') {
    backgroundMediaEditorStatus.textContent = 'O vídeo de fundo será exibido sem controles avançados para o aluno.';
    return;
  }
  backgroundMediaEditorStatus.textContent = 'Escolha uma imagem por URL ou carregue um arquivo do computador.';
};

const clearSlideBackgroundMedia = (slide) => {
  if (!slide) return;
  slide.backgroundImage = null;
  slide.backgroundVideo = null;
  slide.backgroundVideoProvider = null;
  slide.backgroundVideoEmbedSrc = null;
};

const buildViewerBackgroundEmbedUrl = (embedSrc = '', options = {}) => {
  if (!embedSrc) return '';
  const separator = embedSrc.includes('?') ? '&' : '?';
  const controls = options.controls === false ? 0 : 1;
  const autoplay = options.autoplay ? 1 : 0;
  const mute = options.muted ? 1 : 0;
  return `${embedSrc}${separator}autoplay=${autoplay}&mute=${mute}&controls=${controls}&playsinline=1&rel=0&modestbranding=1`;
};

const renderStageBackgroundMedia = (stageNode, slide, options = {}) => {
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

const readLocalFile = (input, acceptedPrefix) =>
  new Promise((resolve, reject) => {
    if (!input) {
      reject(new Error('Entrada de arquivo indisponível.'));
      return;
    }
    input.value = '';
    const handleChange = () => {
      input.removeEventListener('change', handleChange);
      const [file] = input.files || [];
      if (!file) {
        resolve(null);
        return;
      }
      if (!file.type.startsWith(`${acceptedPrefix}/`)) {
        reject(new Error(`Selecione um arquivo de ${acceptedPrefix} válido.`));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => reject(new Error(`Não foi possível carregar o ${acceptedPrefix} escolhido.`));
      reader.readAsDataURL(file);
    };
    input.addEventListener('change', handleChange, { once: true });
    input.click();
  });

const syncElementBackgroundState = (element) => {
  if (!element) return;
  if (!['block', 'floatingButton'].includes(element.type)) {
    return;
  }
  if (element.useGradient) {
    element.gradientStart = element.gradientStart || '#ffef5c';
    element.gradientEnd = element.gradientEnd || '#ff9d5c';
    element.backgroundColor = `linear-gradient(135deg, ${element.gradientStart}, ${element.gradientEnd})`;
    element.solidColor = element.gradientStart;
    return;
  }
  const solidValue = element.backgroundColor || element.solidColor || '#f4f6ff';
  element.solidColor = solidValue;
  element.backgroundColor = solidValue;
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

const updateGradientFieldsVisibility = () => {
  if (!elementGradientToggle || !gradientFields.length) return;
  gradientFields.forEach((field) => field.classList.toggle('hidden', !elementGradientToggle.checked));
};

const populateQuizAnswerOptions = (options = [], selectedIndex = 0) => {
  if (!quizCorrectAnswerSelect) return;
  quizCorrectAnswerSelect.innerHTML = options
    .map((option, index) => `<option value="${index}">${option || `Alternativa ${index + 1}`}</option>`)
    .join('');
  quizCorrectAnswerSelect.value = String(Math.min(Math.max(selectedIndex, 0), Math.max(options.length - 1, 0)));
};

const syncTextEditorControls = (element, options = {}) => {
  const isText = element?.type === 'text';
  const textFlags = getTextDecorationFlags(element, { hasTextBackground: false, hasTextBorder: false, hasTextBlock: false });
  if (textElementContentInput && !options.preserveContent) textElementContentInput.value = isText ? element.content || '' : '';
  if (textElementWidthInput) textElementWidthInput.value = isText ? String(element.width || '') : '';
  if (textElementHeightInput) textElementHeightInput.value = isText ? String(element.height || '') : '';
  if (textElementTextColorInput) textElementTextColorInput.value = isText ? element.textColor || '#0f142c' : '#0f142c';
  if (textElementFontSizeInput) textElementFontSizeInput.value = isText ? String(element.fontSize || 24) : '24';
  if (textElementFontFamilySelect) textElementFontFamilySelect.value = isText ? element.fontFamily || 'Inter, sans-serif' : 'Inter, sans-serif';
  if (textElementFontWeightSelect) textElementFontWeightSelect.value = isText ? element.fontWeight || '400' : '400';
  if (textElementTextAlignSelect) textElementTextAlignSelect.value = isText ? element.textAlign || 'left' : 'left';
  if (textElementBgColorInput) textElementBgColorInput.value = isText ? element.backgroundColor || '#ffffff' : '#ffffff';
  if (textElementBackgroundToggle) textElementBackgroundToggle.checked = isText ? Boolean(textFlags.hasTextBackground) : false;
  if (textElementBorderToggle) textElementBorderToggle.checked = isText ? Boolean(textFlags.hasTextBorder) : false;
  if (textElementCenterStageBtn) textElementCenterStageBtn.disabled = !isText;
  if (textElementCenterBlockBtn) textElementCenterBlockBtn.disabled = !isText || !findContainingBlockForText(element);
};

const updateBlockGradientFieldsVisibility = () => {
  const useGradient = Boolean(blockElementGradientToggle?.checked);
  document.getElementById('blockElementSolidColorField')?.classList.toggle('hidden', useGradient);
  document.getElementById('blockElementGradientStartField')?.classList.toggle('hidden', !useGradient);
  document.getElementById('blockElementGradientEndField')?.classList.toggle('hidden', !useGradient);
};

const syncBlockEditorControls = (element) => {
  const isBlock = element?.type === 'block';
  if (isBlock) {
    normalizeBlockTexture(element);
  }
  if (blockElementContentInput) blockElementContentInput.value = isBlock ? element.content || '' : '';
  if (blockElementWidthInput) blockElementWidthInput.value = isBlock ? String(element.width || '') : '';
  if (blockElementHeightInput) blockElementHeightInput.value = isBlock ? String(element.height || '') : '';
  if (blockElementRotationInput) blockElementRotationInput.value = isBlock ? String(element.rotation || 0) : '0';
  if (blockElementLayerInput) blockElementLayerInput.value = isBlock ? String(element.zIndex ?? 0) : '0';
  if (blockElementShapeSelect) blockElementShapeSelect.value = isBlock ? element.shape || 'rectangle' : 'rectangle';
  if (blockElementGradientToggle) blockElementGradientToggle.checked = isBlock ? Boolean(element.useGradient) : false;
  if (blockElementSolidColorInput) {
    blockElementSolidColorInput.value = isBlock ? element.solidColor || element.backgroundColor || '#f4f6ff' : '#f4f6ff';
  }
  if (blockElementGradientStartInput) blockElementGradientStartInput.value = isBlock ? element.gradientStart || '#ffd54f' : '#ffd54f';
  if (blockElementGradientEndInput) blockElementGradientEndInput.value = isBlock ? element.gradientEnd || '#ffb74d' : '#ffb74d';
  if (blockElementTextColorInput) blockElementTextColorInput.value = isBlock ? element.textColor || '#0f142c' : '#0f142c';
  if (blockElementFontSizeInput) blockElementFontSizeInput.value = isBlock ? String(element.fontSize || 18) : '18';
  if (blockElementFontFamilySelect) blockElementFontFamilySelect.value = isBlock ? element.fontFamily || 'Inter, sans-serif' : 'Inter, sans-serif';
  if (blockElementFontWeightSelect) blockElementFontWeightSelect.value = isBlock ? element.fontWeight || '500' : '500';
  if (blockElementTextureFitSelect) blockElementTextureFitSelect.value = isBlock ? getBlockTextureFit(element) : 'cover';
  if (blockClearTextureBtn) blockClearTextureBtn.disabled = !isBlock || !element.textureImage;
  updateBlockGradientFieldsVisibility();
};

const syncImageEditorControls = (element) => {
  const isImage = element?.type === 'image';
  if (imageElementWidthInput) imageElementWidthInput.value = isImage ? String(element.width || '') : '';
  if (imageElementHeightInput) imageElementHeightInput.value = isImage ? String(element.height || '') : '';
  if (imageElementRotationInput) imageElementRotationInput.value = isImage ? String(element.rotation || 0) : '0';
  if (imageElementObjectFitSelect) imageElementObjectFitSelect.value = isImage ? getElementMediaObjectFit(element) : 'cover';
  if (imageElementStudentDragToggle) imageElementStudentDragToggle.checked = isImage ? Boolean(element.studentCanDrag) : false;
};

const syncAudioEditorControls = (element) => {
  const isAudio = element?.type === 'audio';
  if (audioElementWidthInput) audioElementWidthInput.value = isAudio ? String(element.width || '') : '';
  if (audioElementHeightInput) audioElementHeightInput.value = isAudio ? String(element.height || '') : '';
  if (audioElementRotationInput) audioElementRotationInput.value = isAudio ? String(element.rotation || 0) : '0';
  if (audioElementVisibleToggle) audioElementVisibleToggle.checked = isAudio ? Boolean(element.audioVisible) : true;
  if (audioElementLoopToggle) audioElementLoopToggle.checked = isAudio ? Boolean(element.audioLoop) : false;
};

const updateStageEditorState = () => {
  const hasText = textEditorCard && !textEditorCard.classList.contains('hidden');
  const hasBlock = blockEditorCard && !blockEditorCard.classList.contains('hidden');
  const hasImage = imageEditorCard && !imageEditorCard.classList.contains('hidden');
  const hasAudio = audioEditorCard && !audioEditorCard.classList.contains('hidden');
  const hasQuiz = quizEditorCard && !quizEditorCard.classList.contains('hidden');
  const hasFloating = floatingButtonEditorCard && !floatingButtonEditorCard.classList.contains('hidden');
  const hasVideo = videoEditorCard && !videoEditorCard.classList.contains('hidden');
  const hasBackground = backgroundEditorCard && !backgroundEditorCard.classList.contains('hidden');
  const hasEraser = eraserEditorCard && !eraserEditorCard.classList.contains('hidden');
  const hasAnimation = animationEditorCard && !animationEditorCard.classList.contains('hidden');
  const hasAnyEditor = hasText || hasBlock || hasImage || hasAudio || hasQuiz || hasFloating || hasVideo || hasBackground || hasEraser || hasAnimation;
  if (stageEditorDock) {
    stageEditorDock.classList.toggle('hidden', !hasAnyEditor);
  }
  if (stageEditorEmpty) {
    stageEditorEmpty.classList.add('hidden');
  }
};

const closeStageEditors = () => {
  currentStageEditor = 'none';
  textEditorCard?.classList.add('hidden');
  blockEditorCard?.classList.add('hidden');
  imageEditorCard?.classList.add('hidden');
  audioEditorCard?.classList.add('hidden');
  quizEditorCard?.classList.add('hidden');
  floatingButtonEditorCard?.classList.add('hidden');
  videoEditorCard?.classList.add('hidden');
  backgroundEditorCard?.classList.add('hidden');
  eraserEditorCard?.classList.add('hidden');
  animationEditorCard?.classList.add('hidden');
  closeEraserSession({ keepEditor: true });
  isPickingFloatingInsertPosition = false;
  updateFloatingPlacementControls(null);
  updateStageEditorState();
};

const updateVideoEditorVisibility = (element, options = {}) => {
  if (!videoEditorCard) return;
  const isVideo = element?.type === 'video';
  const shouldStayOpen = options.forceOpen || currentStageEditor === 'video';
  if (!shouldStayOpen || !isVideo) {
    if (currentStageEditor === 'video' && !options.forceOpen) {
      currentStageEditor = 'none';
    }
    videoEditorCard.classList.add('hidden');
    updateStageEditorState();
    return;
  }
  currentStageEditor = 'video';
  lastStageEditorOpenedAt = Date.now();
  normalizeVideoTriggerConfig(element);
  videoEditorCard.classList.remove('hidden');
  if (videoTriggerTimeInput) {
    videoTriggerTimeInput.value = String(element.videoTriggerTime || 0);
  }
  if (videoTriggerActionSelect) {
    videoTriggerActionSelect.value = element.videoTriggerAction || 'none';
  }
  if (videoTriggerTargetElementSelect) {
    const allowedTypes = (element.videoTriggerAction || 'none') === 'playAudio'
      ? ['audio']
      : ['showElement', 'hideElement'].includes(element.videoTriggerAction || 'none')
        ? ['text', 'block', 'image', 'audio', 'video', 'quiz', 'floatingButton', 'detector', 'animatedArrow']
        : [];
    const optionsMarkup = (getActiveSlide()?.elements || [])
      .filter((item) => item?.id && allowedTypes.includes(item.type) && item.id !== element.id)
      .map((item) => `<option value="${item.id}">${escapeHtml(getFloatingTargetElementLabel(item))}</option>`)
      .join('');
    videoTriggerTargetElementSelect.innerHTML = optionsMarkup || '<option value="">Nenhum elemento compatível</option>';
    const nextValue = element.videoTriggerTargetElementId || '';
    videoTriggerTargetElementSelect.value =
      nextValue && videoTriggerTargetElementSelect.querySelector(`option[value="${nextValue}"]`) ? nextValue : '';
  }
  if (videoTriggerSeekTimeInput) {
    videoTriggerSeekTimeInput.value = String(element.videoTriggerSeekTime || 0);
  }
  document.getElementById('videoTriggerSeekTimeField')?.classList.toggle('hidden', (element.videoTriggerAction || 'none') !== 'seekVideo');
  document.getElementById('videoTriggerTargetElementField')?.classList.toggle('hidden', !VIDEO_TRIGGER_TARGET_ACTIONS.has(element.videoTriggerAction || 'none'));
  requestAnimationFrame(() => positionStageEditorCard('video'));
  updateStageEditorState();
};

const syncVideoEditor = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'video') {
    return;
  }
  normalizeVideoTriggerConfig(element);
  element.videoTriggerTime = Math.max(0, Number(videoTriggerTimeInput?.value) || 0);
  element.videoTriggerAction = VIDEO_TRIGGER_ACTIONS.has(String(videoTriggerActionSelect?.value || 'none'))
    ? String(videoTriggerActionSelect?.value || 'none')
    : 'none';
  element.videoTriggerSeekTime = Math.max(0, Number(videoTriggerSeekTimeInput?.value) || 0);
  element.videoTriggerTargetElementId = videoTriggerTargetElementSelect?.value || '';
  document.getElementById('videoTriggerSeekTimeField')?.classList.toggle('hidden', element.videoTriggerAction !== 'seekVideo');
  document.getElementById('videoTriggerTargetElementField')?.classList.toggle('hidden', !VIDEO_TRIGGER_TARGET_ACTIONS.has(element.videoTriggerAction));
  renderSlide();
  scheduleHistoryCommit();
};

const updateTextEditorVisibility = (element, options = {}) => {
  if (!textEditorCard) return;
  const isText = element?.type === 'text';
  const shouldStayOpen = options.forceOpen || currentStageEditor === 'text';
  if (!shouldStayOpen || !isText) {
    if (currentStageEditor === 'text' && !options.forceOpen) {
      currentStageEditor = 'none';
    }
    textEditorCard.classList.add('hidden');
    syncTextEditorControls(null);
    updateStageEditorState();
    return;
  }
  currentStageEditor = 'text';
  lastStageEditorOpenedAt = Date.now();
  textEditorCard.classList.remove('hidden');
  syncTextEditorControls(element);
  requestAnimationFrame(() => positionStageEditorCard('text'));
  updateStageEditorState();
};

const updateBlockEditorVisibility = (element, options = {}) => {
  if (!blockEditorCard) return;
  const isBlock = element?.type === 'block';
  const shouldStayOpen = options.forceOpen || currentStageEditor === 'block';
  if (!shouldStayOpen || !isBlock) {
    if (currentStageEditor === 'block' && !options.forceOpen) {
      currentStageEditor = 'none';
    }
    blockEditorCard.classList.add('hidden');
    updateStageEditorState();
    return;
  }
  currentStageEditor = 'block';
  lastStageEditorOpenedAt = Date.now();
  blockEditorCard.classList.remove('hidden');
  syncBlockEditorControls(element);
  requestAnimationFrame(() => positionStageEditorCard('block'));
  updateStageEditorState();
};

const updateImageEditorVisibility = (element, options = {}) => {
  if (!imageEditorCard) return;
  const isImage = element?.type === 'image';
  const shouldStayOpen = options.forceOpen || currentStageEditor === 'image';
  if (!shouldStayOpen || !isImage) {
    if (currentStageEditor === 'image' && !options.forceOpen) {
      currentStageEditor = 'none';
    }
    imageEditorCard.classList.add('hidden');
    syncImageEditorControls(null);
    updateStageEditorState();
    return;
  }
  currentStageEditor = 'image';
  lastStageEditorOpenedAt = Date.now();
  imageEditorCard.classList.remove('hidden');
  syncImageEditorControls(element);
  requestAnimationFrame(() => positionStageEditorCard('image'));
  updateStageEditorState();
};

const updateAudioEditorVisibility = (element, options = {}) => {
  if (!audioEditorCard) return;
  const isAudio = element?.type === 'audio';
  const shouldStayOpen = options.forceOpen || currentStageEditor === 'audio';
  if (!shouldStayOpen || !isAudio) {
    if (currentStageEditor === 'audio' && !options.forceOpen) {
      currentStageEditor = 'none';
    }
    audioEditorCard.classList.add('hidden');
    syncAudioEditorControls(null);
    updateStageEditorState();
    return;
  }
  currentStageEditor = 'audio';
  lastStageEditorOpenedAt = Date.now();
  normalizeAudioElement(element);
  audioEditorCard.classList.remove('hidden');
  syncAudioEditorControls(element);
  requestAnimationFrame(() => positionStageEditorCard('audio'));
  updateStageEditorState();
};

const updateAnimationEditorVisibility = (element, options = {}) => {
  if (!animationEditorCard) return;
  const shouldStayOpen = options.forceOpen || currentStageEditor === 'animation';
  const canAnimate = ANIMATABLE_ELEMENT_TYPES.has(element?.type);
  if (!shouldStayOpen || !canAnimate) {
    if (currentStageEditor === 'animation' && !options.forceOpen) {
      currentStageEditor = 'none';
    }
    animationEditorCard.classList.add('hidden');
    updateStageEditorState();
    return;
  }
  currentStageEditor = 'animation';
  lastStageEditorOpenedAt = Date.now();
  normalizeElementAnimation(element);
  animationEditorCard.classList.remove('hidden');
  if (elementAnimationTypeSelect) {
    elementAnimationTypeSelect.value = element.animationType || 'none';
  }
  if (elementAnimationDurationInput) {
    elementAnimationDurationInput.value = String(element.animationDuration || 1.2);
  }
  if (elementAnimationDelayInput) {
    elementAnimationDelayInput.value = String(element.animationDelay || 0);
  }
  if (elementAnimationLoopToggle) {
    elementAnimationLoopToggle.checked = Boolean(element.animationLoop);
  }
  updateMotionFrameEditorState(element);
  requestAnimationFrame(() => positionStageEditorCard('animation'));
  updateStageEditorState();
};

const renderMotionFrameList = (element) => {
  if (!elementMotionFrameList) return;
  const frames = Array.isArray(element?.motionFrames) ? element.motionFrames : [];
  if (!frames.length) {
    elementMotionFrameList.innerHTML = '<p class="muted" style="margin:0;">Nenhum quadro gravado ainda.</p>';
    return;
  }
  elementMotionFrameList.innerHTML = frames
    .map((frame, index) => {
      const label = `Q${index + 1} · X:${Math.round(frame.x)} Y:${Math.round(frame.y)} · ${Math.round(frame.width)}x${Math.round(frame.height)}`;
      return `<button type="button" class="motion-frame-chip${index === selectedMotionFrameIndex ? ' active' : ''}" data-motion-frame-index="${index}">${escapeHtml(label)}</button>`;
    })
    .join('');
};

const updateMotionFrameEditorState = (element) => {
  const isMotionMode = (elementAnimationTypeSelect?.value || 'none') === MOTION_ANIMATION_TYPE;
  const supportsMotion = supportsRecordedMotion(element);
  const showTools = Boolean(isMotionMode && supportsMotion);
  document.getElementById('elementMotionFrameTools')?.classList.toggle('hidden', !showTools);
  if (!showTools) {
    selectedMotionFrameIndex = -1;
    renderMotionFrameList(null);
    return;
  }
  normalizeElementAnimation(element);
  const frames = Array.isArray(element.motionFrames) ? element.motionFrames : [];
  if (selectedMotionFrameIndex >= frames.length) {
    selectedMotionFrameIndex = frames.length - 1;
  }
  if (selectedMotionFrameIndex < 0 && frames.length) {
    selectedMotionFrameIndex = frames.length - 1;
  }
  if (addMotionFrameBtn) addMotionFrameBtn.disabled = false;
  if (updateMotionFrameBtn) updateMotionFrameBtn.disabled = selectedMotionFrameIndex < 0;
  if (removeMotionFrameBtn) removeMotionFrameBtn.disabled = selectedMotionFrameIndex < 0;
  if (clearMotionFramesBtn) clearMotionFramesBtn.disabled = !frames.length;
  renderMotionFrameList(element);
};

const canUseEraserOnElement = (element) => ERASER_SUPPORTED_TYPES.has(element?.type);

const syncEraserEditorControls = () => {
  if (eraserModeSelect) {
    eraserModeSelect.value = eraserModeSelect.value || 'brush';
  }
  if (eraserShapeSelect && !ERASER_BRUSH_SHAPES.has(eraserShapeSelect.value)) {
    eraserShapeSelect.value = 'circle';
  }
  if (eraserSizeInput) {
    eraserSizeInput.value = eraserSizeInput.value || '42';
  }
  if (eraserSizeNumberInput) {
    eraserSizeNumberInput.value = eraserSizeNumberInput.value || eraserSizeInput?.value || '42';
  }
  if (eraserClosePathBtn) {
    eraserClosePathBtn.disabled = (eraserModeSelect?.value || 'brush') !== 'lasso' || eraserState.lassoPoints.length < 3;
  }
};

const destroyEraserOverlay = () => {
  if (eraserState.overlay) {
    eraserState.overlay.remove();
  }
  eraserState.overlay = null;
  eraserState.displayCanvas = null;
};

const resetEraserDraftState = () => {
  eraserState.drawing = false;
  eraserState.lastPoint = null;
  eraserState.lassoPoints = [];
  eraserState.hoverPoint = null;
};

const closeEraserSession = ({ keepEditor = false } = {}) => {
  destroyEraserOverlay();
  eraserState.active = false;
  eraserState.loading = false;
  eraserState.elementId = null;
  eraserState.sourceType = null;
  eraserState.baseCanvas = null;
  eraserState.maskCanvas = null;
  resetEraserDraftState();
  if (!keepEditor) {
    eraserEditorCard?.classList.add('hidden');
    if (currentStageEditor === 'eraser') {
      currentStageEditor = 'none';
    }
  }
  syncEraserEditorControls();
  updateStageEditorState();
};

const updateEraserEditorVisibility = (element, options = {}) => {
  if (!eraserEditorCard) return;
  const supported = canUseEraserOnElement(element);
  const shouldStayOpen = options.forceOpen || currentStageEditor === 'eraser';
  if (!shouldStayOpen || !supported) {
    if (currentStageEditor === 'eraser' && !options.forceOpen) {
      currentStageEditor = 'none';
    }
    eraserEditorCard.classList.add('hidden');
    if (eraserState.active && (!element || eraserState.elementId !== element.id)) {
      closeEraserSession({ keepEditor: true });
    }
    updateStageEditorState();
    return;
  }
  currentStageEditor = 'eraser';
  lastStageEditorOpenedAt = Date.now();
  eraserEditorCard.classList.remove('hidden');
  syncEraserEditorControls();
  requestAnimationFrame(() => positionStageEditorCard('eraser'));
  updateStageEditorState();
};

const getEraserTargetElement = () => getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null;

const getStageNodeByElementId = (elementId) =>
  slideCanvas?.querySelector(`[data-element-id="${String(elementId || '').replace(/"/g, '\\"')}"]`) || null;

const cloneNodeWithInlineStyles = (node) => {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent || '');
  }
  if (!(node instanceof Element)) {
    return document.createTextNode('');
  }
  const clone = node.cloneNode(false);
  const computedStyle = window.getComputedStyle(node);
  const styleText = Array.from(computedStyle)
    .map((property) => `${property}:${computedStyle.getPropertyValue(property)};`)
    .join('');
  clone.setAttribute('style', styleText);
  clone.removeAttribute('id');
  Array.from(node.childNodes).forEach((childNode) => {
    clone.appendChild(cloneNodeWithInlineStyles(childNode));
  });
  return clone;
};

const cloneCanvas = (sourceCanvas) => {
  const clone = document.createElement('canvas');
  clone.width = sourceCanvas.width;
  clone.height = sourceCanvas.height;
  const context = clone.getContext('2d');
  if (context) {
    context.drawImage(sourceCanvas, 0, 0);
  }
  return clone;
};

const drawRoundedRectPath = (context, x, y, width, height, radius) => {
  const normalizedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + normalizedRadius, y);
  context.lineTo(x + width - normalizedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + normalizedRadius);
  context.lineTo(x + width, y + height - normalizedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - normalizedRadius, y + height);
  context.lineTo(x + normalizedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - normalizedRadius);
  context.lineTo(x, y + normalizedRadius);
  context.quadraticCurveTo(x, y, x + normalizedRadius, y);
  context.closePath();
};

const buildBlockCanvasPath = (context, shape, width, height) => {
  context.beginPath();
  switch (shape) {
    case 'circle': {
      context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      break;
    }
    case 'triangle': {
      context.moveTo(width / 2, 0);
      context.lineTo(0, height);
      context.lineTo(width, height);
      context.closePath();
      break;
    }
    case 'arrow': {
      context.moveTo(0, height / 2);
      context.lineTo(width * 0.58, 0);
      context.lineTo(width * 0.58, height * 0.37);
      context.lineTo(width, height * 0.37);
      context.lineTo(width, height * 0.63);
      context.lineTo(width * 0.58, height * 0.63);
      context.lineTo(width * 0.58, height);
      context.closePath();
      break;
    }
    default:
      drawRoundedRectPath(context, 0, 0, width, height, 16);
      break;
  }
};

const stripHtml = (value = '') => String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();

const renderBlockElementToCanvas = (element, width, height, scale = 2) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('O navegador não conseguiu preparar a borracha.');
  }
  context.scale(scale, scale);
  context.clearRect(0, 0, width, height);
  context.save();
  buildBlockCanvasPath(context, element.shape || 'rectangle', width, height);
  context.clip();
  if (element.useGradient && element.gradientStart && element.gradientEnd) {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, element.gradientStart);
    gradient.addColorStop(1, element.gradientEnd);
    context.fillStyle = gradient;
  } else {
    context.fillStyle = element.solidColor || element.backgroundColor || '#f4f6ff';
  }
  context.fillRect(0, 0, width, height);
  context.restore();

  const text = stripHtml(element.content || '');
  if (text) {
    context.save();
    context.fillStyle = element.textColor || '#0f142c';
    context.textBaseline = 'top';
    context.font = `${element.fontWeight || '500'} ${Math.max(14, Number(element.fontSize) || 18)}px sans-serif`;
    const lineHeight = Math.max(18, (Number(element.fontSize) || 18) * 1.35);
    const maxWidth = Math.max(20, width - 32);
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let currentLine = '';
    words.forEach((word) => {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth || !currentLine) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    });
    if (currentLine) {
      lines.push(currentLine);
    }
    const maxLines = Math.max(1, Math.floor((height - 32) / lineHeight));
    lines.slice(0, maxLines).forEach((line, index) => {
      context.fillText(line, 16, 16 + index * lineHeight, maxWidth);
    });
    context.restore();
  }
  return canvas;
};

const loadImageElement = (sourceUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível preparar o elemento para a borracha.'));
    image.src = sourceUrl;
  });

const rasterizeStageNodeToCanvas = async (node, width, height) => {
  const rasterScale = Math.max(1, Math.min(3, window.devicePixelRatio || 1.5));
  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.margin = '0';
  wrapper.style.padding = '0';
  wrapper.style.overflow = 'hidden';
  wrapper.style.position = 'relative';
  const clone = cloneNodeWithInlineStyles(node);
  if (clone instanceof HTMLElement) {
    clone.style.position = 'relative';
    clone.style.left = '0';
    clone.style.top = '0';
    clone.style.margin = '0';
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;
    clone.style.transform = 'none';
  }
  wrapper.appendChild(clone);
  const markup = new XMLSerializer().serializeToString(wrapper);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width * rasterScale}" height="${height * rasterScale}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">${markup}</foreignObject>
    </svg>
  `;
  const image = await loadImageElement(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * rasterScale));
  canvas.height = Math.max(1, Math.round(height * rasterScale));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('O navegador não conseguiu preparar a borracha.');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const buildEraserSourceCanvas = async (element) => {
  const stageNode = getStageNodeByElementId(element.id);
  const width = Math.max(MIN_ELEMENT_SIZE, Math.round(Number(element.width) || stageNode?.clientWidth || 0));
  const height = Math.max(MIN_ELEMENT_SIZE, Math.round(Number(element.height) || stageNode?.clientHeight || 0));
  if (element.type === 'image') {
    const { calculateCoverDrawMetrics } = await eraserUtilsPromise;
    const image = await loadImageElement(element.src || IMAGE_FALLBACK_SRC);
    const metrics = calculateCoverDrawMetrics({
      sourceWidth: image.naturalWidth || image.width,
      sourceHeight: image.naturalHeight || image.height,
      containerWidth: width,
      containerHeight: height
    });
    const canvas = document.createElement('canvas');
    canvas.width = metrics.outputWidth;
    canvas.height = metrics.outputHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('O navegador não conseguiu preparar a borracha.');
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, metrics.dx, metrics.dy, metrics.drawWidth, metrics.drawHeight);
    return canvas;
  }
  if (element.type === 'block') {
    return renderBlockElementToCanvas(element, width, height, Math.max(1, Math.min(3, window.devicePixelRatio || 2)));
  }
  if (stageNode) {
    return rasterizeStageNodeToCanvas(stageNode, width, height);
  }
  const fallbackCanvas = document.createElement('canvas');
  const fallbackScale = Math.max(1, Math.min(3, window.devicePixelRatio || 1.5));
  fallbackCanvas.width = Math.max(1, Math.round(width * fallbackScale));
  fallbackCanvas.height = Math.max(1, Math.round(height * fallbackScale));
  const fallbackContext = fallbackCanvas.getContext('2d');
  if (!fallbackContext) {
    throw new Error('O navegador não conseguiu preparar a borracha.');
  }
  fallbackContext.scale(fallbackScale, fallbackScale);
  fallbackContext.fillStyle = element.backgroundColor || element.solidColor || '#f4f6ff';
  fallbackContext.fillRect(0, 0, width, height);
  fallbackContext.fillStyle = element.textColor || '#1b1c2b';
  fallbackContext.font = `${element.fontWeight || '500'} ${Math.max(16, Number(element.fontSize) || 18)}px sans-serif`;
  fallbackContext.fillText(String(element.content || '').replace(/<[^>]+>/g, ''), 16, Math.min(height - 16, 32));
  return fallbackCanvas;
};

const getEraserSize = () => clamp(Number(eraserSizeInput?.value || eraserSizeNumberInput?.value || 42), 8, 180);

const getCanvasPointFromEvent = (canvas, event) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * canvas.width,
    y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * canvas.height
  };
};

const drawBrushStamp = (context, x, y, size, shape) => {
  context.save();
  context.fillStyle = '#000';
  if (shape === 'square') {
    context.fillRect(x - size / 2, y - size / 2, size, size);
  } else if (shape === 'diamond') {
    context.translate(x, y);
    context.rotate(Math.PI / 4);
    context.fillRect(-size / 2, -size / 2, size, size);
  } else {
    context.beginPath();
    context.arc(x, y, size / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
};

const stampBrushSegment = (fromPoint, toPoint) => {
  if (!eraserState.maskCanvas) {
    return;
  }
  const context = eraserState.maskCanvas.getContext('2d');
  if (!context) {
    return;
  }
  const size = getEraserSize();
  const shape = ERASER_BRUSH_SHAPES.has(eraserShapeSelect?.value) ? eraserShapeSelect.value : 'circle';
  const distance = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(4, size / 5)));
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const x = fromPoint.x + (toPoint.x - fromPoint.x) * ratio;
    const y = fromPoint.y + (toPoint.y - fromPoint.y) * ratio;
    drawBrushStamp(context, x, y, size, shape);
  }
};

const finalizeLassoErase = () => {
  if (!eraserState.maskCanvas || eraserState.lassoPoints.length < 3) {
    return;
  }
  const context = eraserState.maskCanvas.getContext('2d');
  if (!context) {
    return;
  }
  context.save();
  context.fillStyle = '#000';
  context.beginPath();
  eraserState.lassoPoints.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  context.closePath();
  context.fill();
  context.restore();
  eraserState.lassoPoints = [];
  eraserState.hoverPoint = null;
  syncEraserEditorControls();
};

const renderEraserPreview = () => {
  const canvas = eraserState.displayCanvas;
  if (!canvas || !eraserState.baseCanvas || !eraserState.maskCanvas) {
    return;
  }
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.fillStyle = '#eef1fb';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const checkerSize = 24;
  for (let y = 0; y < canvas.height; y += checkerSize) {
    for (let x = 0; x < canvas.width; x += checkerSize) {
      if (((x / checkerSize) + (y / checkerSize)) % 2 === 0) {
        context.fillStyle = 'rgba(255, 255, 255, 0.92)';
      } else {
        context.fillStyle = 'rgba(226, 231, 245, 0.92)';
      }
      context.fillRect(x, y, checkerSize, checkerSize);
    }
  }
  context.restore();
  context.drawImage(eraserState.baseCanvas, 0, 0);
  context.save();
  context.globalCompositeOperation = 'destination-out';
  context.drawImage(eraserState.maskCanvas, 0, 0);
  context.restore();
  context.save();
  context.globalAlpha = 0.22;
  context.drawImage(eraserState.maskCanvas, 0, 0);
  context.globalCompositeOperation = 'source-atop';
  context.fillStyle = '#ff4d6d';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
  if ((eraserModeSelect?.value || 'brush') === 'lasso' && eraserState.lassoPoints.length) {
    context.save();
    context.setLineDash([8, 6]);
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(109, 99, 255, 0.95)';
    context.fillStyle = 'rgba(109, 99, 255, 0.14)';
    context.beginPath();
    eraserState.lassoPoints.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    if (eraserState.hoverPoint) {
      context.lineTo(eraserState.hoverPoint.x, eraserState.hoverPoint.y);
    }
    context.stroke();
    context.restore();
  }
};

const handleEraserPointerMove = (canvas, event) => {
  const mode = eraserModeSelect?.value || 'brush';
  const point = getCanvasPointFromEvent(canvas, event);
  eraserState.hoverPoint = point;
  if (mode === 'brush' && eraserState.drawing) {
    stampBrushSegment(eraserState.lastPoint || point, point);
    eraserState.lastPoint = point;
  }
  renderEraserPreview();
};

const attachEraserOverlayEvents = (canvas) => {
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const point = getCanvasPointFromEvent(canvas, event);
    if ((eraserModeSelect?.value || 'brush') === 'lasso') {
      eraserState.lassoPoints.push(point);
      eraserState.hoverPoint = point;
      if (event.detail >= 2 && eraserState.lassoPoints.length >= 3) {
        finalizeLassoErase();
      }
      syncEraserEditorControls();
      renderEraserPreview();
      return;
    }
    eraserState.drawing = true;
    eraserState.lastPoint = point;
    stampBrushSegment(point, point);
    renderEraserPreview();
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => handleEraserPointerMove(canvas, event));
  const stopBrush = (event) => {
    if (eraserState.drawing) {
      eraserState.drawing = false;
      eraserState.lastPoint = null;
      canvas.releasePointerCapture?.(event.pointerId);
    }
  };
  canvas.addEventListener('pointerup', stopBrush);
  canvas.addEventListener('pointercancel', stopBrush);
  canvas.addEventListener('pointerleave', () => {
    if ((eraserModeSelect?.value || 'brush') === 'lasso') {
      eraserState.hoverPoint = null;
      renderEraserPreview();
    }
  });
};

const renderEraserOverlay = () => {
  if (!eraserState.active || !slideCanvas || previewState.active) {
    destroyEraserOverlay();
    return;
  }
  const element = getEraserTargetElement();
  if (!element || eraserState.elementId !== element.id || !eraserState.baseCanvas) {
    destroyEraserOverlay();
    return;
  }
  destroyEraserOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'eraser-stage-overlay';
  overlay.dataset.mode = eraserModeSelect?.value || 'brush';
  overlay.style.left = `${element.x || 0}px`;
  overlay.style.top = `${element.y || 0}px`;
  overlay.style.width = `${Math.max(MIN_ELEMENT_SIZE, Number(element.width) || eraserState.baseCanvas.width)}px`;
  overlay.style.height = `${Math.max(MIN_ELEMENT_SIZE, Number(element.height) || eraserState.baseCanvas.height)}px`;
  overlay.style.zIndex = String((Number(element.zIndex) || 0) + 1000);
  overlay.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  overlay.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  const canvas = document.createElement('canvas');
  canvas.className = 'eraser-overlay-canvas';
  canvas.width = eraserState.baseCanvas.width;
  canvas.height = eraserState.baseCanvas.height;
  overlay.appendChild(canvas);
  slideCanvas.appendChild(overlay);
  eraserState.overlay = overlay;
  eraserState.displayCanvas = canvas;
  attachEraserOverlayEvents(canvas);
  renderEraserPreview();
};

const clearEraserMask = () => {
  if (!eraserState.maskCanvas) return;
  const context = eraserState.maskCanvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, eraserState.maskCanvas.width, eraserState.maskCanvas.height);
  resetEraserDraftState();
  syncEraserEditorControls();
  renderEraserPreview();
};

const applyEraserChanges = async () => {
  const element = getEraserTargetElement();
  if (!element || !eraserState.baseCanvas || !eraserState.maskCanvas) {
    return;
  }
  if ((eraserModeSelect?.value || 'brush') === 'lasso' && eraserState.lassoPoints.length >= 3) {
    finalizeLassoErase();
  }
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = eraserState.baseCanvas.width;
  resultCanvas.height = eraserState.baseCanvas.height;
  const context = resultCanvas.getContext('2d');
  if (!context) {
    return;
  }
  context.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  context.drawImage(eraserState.baseCanvas, 0, 0);
  const baseContext = eraserState.baseCanvas.getContext('2d', { willReadFrequently: true });
  const maskContext = eraserState.maskCanvas.getContext('2d', { willReadFrequently: true });
  if (baseContext && maskContext) {
    const { erasePixelsFromImageData } = await eraserUtilsPromise;
    const sourceImageData = baseContext.getImageData(0, 0, resultCanvas.width, resultCanvas.height);
    const maskImageData = maskContext.getImageData(0, 0, resultCanvas.width, resultCanvas.height);
    const processedImageData = erasePixelsFromImageData(sourceImageData, maskImageData);
    context.putImageData(new ImageData(processedImageData.data, processedImageData.width, processedImageData.height), 0, 0);
  } else {
    context.globalCompositeOperation = 'destination-out';
    context.drawImage(eraserState.maskCanvas, 0, 0);
    context.globalCompositeOperation = 'source-over';
  }
  const dataUrl = resultCanvas.toDataURL('image/png');
  element.type = 'image';
  element.src = dataUrl;
  element.objectFit = eraserState.sourceType === 'block' ? 'fill' : getElementMediaObjectFit(element);
  element.backgroundColor = 'transparent';
  delete element.provider;
  delete element.embedSrc;
  closeEraserSession();
  updateElementInspector(element);
  renderSlide();
  commitHistoryState();
};

const openEraserEditorForElement = async (element) => {
  if (!canUseEraserOnElement(element)) {
    alert('Selecione uma imagem ou bloco para usar a borracha.');
    return;
  }
  updateEraserEditorVisibility(element, { forceOpen: true });
  if (eraserState.active && eraserState.elementId === element.id) {
    renderEraserOverlay();
    return;
  }
  eraserState.loading = true;
  try {
    const baseCanvas = await buildEraserSourceCanvas(element);
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = baseCanvas.width;
    maskCanvas.height = baseCanvas.height;
    closeEraserSession({ keepEditor: true });
    eraserState.active = true;
    eraserState.elementId = element.id;
    eraserState.sourceType = element.type;
    eraserState.baseCanvas = baseCanvas;
    eraserState.maskCanvas = maskCanvas;
    resetEraserDraftState();
    syncEraserEditorControls();
    renderEraserOverlay();
  } catch (error) {
    closeEraserSession({ keepEditor: true });
    alert(error.message || 'Não foi possível preparar a borracha para esse elemento.');
  } finally {
    eraserState.loading = false;
  }
};

const updateQuizEditorVisibility = (element) => {
  if (!quizEditorCard) return;
  const isQuiz = element?.type === 'quiz';
  if (isQuiz) {
    currentStageEditor = 'quiz';
    lastStageEditorOpenedAt = Date.now();
  } else if (currentStageEditor === 'quiz') {
    currentStageEditor = 'none';
  }
  quizEditorCard.classList.toggle('hidden', !(isQuiz && currentStageEditor === 'quiz'));
  if (!isQuiz) {
    if (quizQuestionInput) quizQuestionInput.value = '';
    if (quizOptionsInput) quizOptionsInput.value = '';
    if (quizSuccessMessageInput) quizSuccessMessageInput.value = '';
    if (quizErrorMessageInput) quizErrorMessageInput.value = '';
    if (quizActionLabelInput) quizActionLabelInput.value = '';
    if (quizBackgroundColorInput) quizBackgroundColorInput.value = '#ffffff';
    if (quizQuestionColorInput) quizQuestionColorInput.value = '#171934';
    if (quizOptionBackgroundColorInput) quizOptionBackgroundColorInput.value = '#f4f6ff';
    if (quizOptionTextColorInput) quizOptionTextColorInput.value = '#25284c';
    if (quizButtonBackgroundColorInput) quizButtonBackgroundColorInput.value = '#6d63ff';
    if (quizPointsInput) quizPointsInput.value = '1';
    if (quizLockOnWrongToggle) quizLockOnWrongToggle.checked = false;
    if (quizCorrectAnswerSelect) quizCorrectAnswerSelect.innerHTML = '';
    updateStageEditorState();
    return;
  }
  normalizeQuizElement(element);
  if (quizQuestionInput) quizQuestionInput.value = element.question;
  if (quizOptionsInput) quizOptionsInput.value = element.options.join('\n');
  if (quizSuccessMessageInput) quizSuccessMessageInput.value = element.successMessage;
  if (quizErrorMessageInput) quizErrorMessageInput.value = element.errorMessage;
  if (quizActionLabelInput) quizActionLabelInput.value = element.actionLabel;
  if (quizBackgroundColorInput) quizBackgroundColorInput.value = element.quizBackgroundColor;
  if (quizQuestionColorInput) quizQuestionColorInput.value = element.quizQuestionColor;
  if (quizOptionBackgroundColorInput) quizOptionBackgroundColorInput.value = element.quizOptionBackgroundColor;
  if (quizOptionTextColorInput) quizOptionTextColorInput.value = element.quizOptionTextColor;
  if (quizButtonBackgroundColorInput) quizButtonBackgroundColorInput.value = element.quizButtonBackgroundColor;
  if (quizPointsInput) quizPointsInput.value = String(element.points || 1);
  if (quizLockOnWrongToggle) quizLockOnWrongToggle.checked = Boolean(element.lockOnWrong);
  populateQuizAnswerOptions(element.options, element.correctOption);
  requestAnimationFrame(() => positionStageEditorCard('quiz'));
  updateStageEditorState();
};

const populateFloatingTargetSlides = (selectedId = '') => {
  if (!floatingTargetSlideSelect) return;
  floatingTargetSlideSelect.innerHTML = builderState.slides
    .map((slide) => `<option value="${slide.id}">${slide.title}</option>`)
    .join('');
  if (selectedId) {
    floatingTargetSlideSelect.value = selectedId;
  }
};

const getFloatingTargetElementLabel = (element) => {
  if (!element) return 'Elemento';
  const typeLabels = {
    text: 'Texto',
    block: 'Bloco',
    image: 'Imagem',
    floatingButton: 'Botão',
    detector: 'Detector',
    quiz: 'Quiz',
    video: 'Vídeo',
    audio: 'Áudio'
  };
  const typeLabel = typeLabels[element.type] || 'Elemento';
  const contentPreview =
    element.type === 'floatingButton'
      ? String(element.label || '').trim()
      : ['text', 'block'].includes(element.type)
        ? stripHtml(element.content || '')
        : '';
  const preview = contentPreview ? contentPreview.replace(/\s+/g, ' ').trim().slice(0, 36) : '';
  return preview ? `${typeLabel}: ${preview}` : `${typeLabel} (${element.id.slice(-6)})`;
};

const populateFloatingTargetElements = (selectedId = '', actionType = 'none', sourceElement = null) => {
  if (!floatingTargetElementSelect) return;
  const slide = getActiveSlide();
  const allowedTypes = ['playVideo', 'pauseVideo', 'seekVideo'].includes(actionType)
    ? ['video']
    : actionType === 'playAudio'
      ? ['audio']
      : ['showElement', 'hideElement'].includes(actionType)
        ? ['text', 'block', 'image', 'audio', 'video', 'quiz', 'floatingButton', 'detector', 'animatedArrow']
    : actionType === 'moveElement'
      ? ['text', 'block', 'image']
      : actionType === 'replaceText'
        ? Array.from(REPLACEABLE_TEXT_TYPES)
        : actionType === 'playAnimation'
          ? Array.from(ANIMATABLE_ELEMENT_TYPES)
          : [];
  const options = (slide?.elements || [])
    .filter((item) => {
      if (!item?.id || !allowedTypes.includes(item.type) || item.id === sourceElement?.id) {
        return false;
      }
      if (allowedTypes.includes('video') && item.type === 'video' && item.provider === 'youtube') {
        return false;
      }
      return true;
    })
    .map((item) => `<option value="${item.id}">${escapeHtml(getFloatingTargetElementLabel(item))}</option>`)
    .join('');
  floatingTargetElementSelect.innerHTML = options || '<option value="">Nenhum elemento compatível</option>';
  floatingTargetElementSelect.value = selectedId && floatingTargetElementSelect.querySelector(`option[value="${selectedId}"]`) ? selectedId : '';
};

const populateDetectorAcceptedElements = (selectedValue = DETECTOR_ACCEPT_ANY) => {
  if (!floatingDetectorAcceptedSelect) return;
  const slide = getActiveSlide();
  const draggableOptions = (slide?.elements || [])
    .filter((item) => item?.id && STUDENT_DRAGGABLE_TYPES.has(item.type))
    .map(
      (item) =>
        `<option value="${DETECTOR_ACCEPT_ELEMENT_PREFIX}${item.id}">${escapeHtml(getFloatingTargetElementLabel(item))}</option>`
    )
    .join('');
  floatingDetectorAcceptedSelect.innerHTML = [
    `<option value="${DETECTOR_ACCEPT_ANY}">Qualquer elemento arrastável</option>`,
    `<option value="${DETECTOR_ACCEPT_TYPE_PREFIX}text">Qualquer texto arrastável</option>`,
    `<option value="${DETECTOR_ACCEPT_TYPE_PREFIX}block">Qualquer bloco arrastável</option>`,
    `<option value="${DETECTOR_ACCEPT_TYPE_PREFIX}image">Qualquer imagem arrastável</option>`,
    draggableOptions
  ].join('');
  const normalizedValue = normalizeDetectorAcceptedDragValue(selectedValue);
  floatingDetectorAcceptedSelect.value = floatingDetectorAcceptedSelect.querySelector(`option[value="${normalizedValue}"]`)
    ? normalizedValue
    : DETECTOR_ACCEPT_ANY;
};

const populateFloatingQuizCorrectOptions = (options = [], selectedIndex = 0) => {
  if (!floatingQuizCorrectSelect) return;
  floatingQuizCorrectSelect.innerHTML = options
    .map((option, index) => `<option value="${index}">${option || `Alternativa ${index + 1}`}</option>`)
    .join('');
  floatingQuizCorrectSelect.value = String(Math.min(Math.max(selectedIndex, 0), Math.max(options.length - 1, 0)));
};

const updateFloatingButtonEditorVisibility = (element) => {
  if (!floatingButtonEditorCard) return;
  const isActionTrigger = ['floatingButton', 'detector'].includes(element?.type);
  if (isActionTrigger) {
    currentStageEditor = 'floating';
    lastStageEditorOpenedAt = Date.now();
  } else if (currentStageEditor === 'floating') {
    currentStageEditor = 'none';
  }
  floatingButtonEditorCard.classList.toggle('hidden', !(isActionTrigger && currentStageEditor === 'floating'));
  if (!isActionTrigger) {
    isPickingFloatingInsertPosition = false;
    isPickingFloatingTargetElement = false;
    updateFloatingPlacementControls(null);
    updateStageEditorState();
    return;
  }
  normalizeFloatingActionConfig(element);
  const config = element.actionConfig;
  if (floatingEditorBadge) {
    floatingEditorBadge.textContent = element.type === 'detector' ? 'Detector' : 'Botão flutuante';
  }
  if (floatingEditorTitle) {
    floatingEditorTitle.textContent = element.type === 'detector' ? 'Configure o gatilho invisível' : 'Configure o clique';
  }
  floatingActionTypeSelect.value = config.type;
  populateFloatingTargetSlides(config.targetSlideId);
  populateFloatingTargetElements(config.targetElementId, config.type, element);
  if (floatingRequireAllToggle) {
    floatingRequireAllToggle.checked = Boolean(config.requireAllButtonsInGroup);
  }
  if (floatingRuleGroupInput) {
    floatingRuleGroupInput.value = config.ruleGroup || '';
  }
  if (element.type === 'detector') {
    populateDetectorAcceptedElements(config.detectorAcceptedDrag);
  }
  if (floatingDetectorMinCountInput) {
    floatingDetectorMinCountInput.disabled = element.type === 'detector' && isSpecificDetectorElementRule(config.detectorAcceptedDrag);
  }
  if (floatingDetectorMinCountInput) {
    floatingDetectorMinCountInput.value = String(config.detectorMinMatchCount || 1);
  }
  if (floatingDetectorTriggerOnceToggle) {
    floatingDetectorTriggerOnceToggle.checked = Boolean(config.detectorTriggerOnce);
  }
  if (floatingActionTextLabel) {
    floatingActionTextLabel.textContent = config.type === 'replaceText' ? 'Novo conteúdo ou prefixo' : 'Texto a inserir';
  }
  if (floatingActionTextInput) {
    floatingActionTextInput.placeholder =
      config.type === 'replaceText' ? 'Ex: Pontos: ' : 'Ex: Bem-vindo à próxima etapa';
    floatingActionTextInput.value = config.type === 'replaceText' ? config.replaceText || '' : config.text;
  }
  if (floatingReplaceModeSelect) {
    floatingReplaceModeSelect.value = getReplaceTextMode(config.replaceMode);
  }
  if (floatingReplaceCounterStartInput) {
    floatingReplaceCounterStartInput.value = String(config.replaceCounterStart ?? 1);
  }
  if (floatingReplaceCounterStepInput) {
    floatingReplaceCounterStepInput.value = String(config.replaceCounterStep ?? 1);
  }
  floatingActionUrlInput.value = config.url;
  if (floatingAudioVisibleToggle) floatingAudioVisibleToggle.checked = Boolean(config.audioVisible);
  if (floatingAudioLoopToggle) floatingAudioLoopToggle.checked = Boolean(config.audioLoop);
  if (floatingTextColorInput) floatingTextColorInput.value = config.textColor || DEFAULT_INSERT_TEXT_STYLE.textColor;
  if (floatingTextBgColorInput) floatingTextBgColorInput.value = config.backgroundColor || DEFAULT_INSERT_TEXT_STYLE.backgroundColor;
  if (floatingTextFontSizeInput) floatingTextFontSizeInput.value = String(config.fontSize || DEFAULT_INSERT_TEXT_STYLE.fontSize);
  if (floatingTextFontFamilySelect) floatingTextFontFamilySelect.value = config.fontFamily || DEFAULT_INSERT_TEXT_STYLE.fontFamily;
  if (floatingTextFontWeightSelect) floatingTextFontWeightSelect.value = config.fontWeight || DEFAULT_INSERT_TEXT_STYLE.fontWeight;
  if (floatingTextAlignSelect) floatingTextAlignSelect.value = config.textAlign || DEFAULT_INSERT_TEXT_STYLE.textAlign;
  if (floatingTextBackgroundToggle) floatingTextBackgroundToggle.checked = Boolean(config.hasTextBackground);
  if (floatingTextBorderToggle) floatingTextBorderToggle.checked = Boolean(config.hasTextBorder);
  floatingInsertXInput.value = String(config.insertX);
  floatingInsertYInput.value = String(config.insertY);
  floatingInsertWidthInput.value = String(config.insertWidth);
  floatingInsertHeightInput.value = String(config.insertHeight);
  if (floatingMoveXInput) floatingMoveXInput.value = String(config.moveByX);
  if (floatingMoveYInput) floatingMoveYInput.value = String(config.moveByY);
  if (floatingMoveDurationInput) floatingMoveDurationInput.value = String(config.moveDuration);
  if (floatingVideoTimeInput) floatingVideoTimeInput.value = String(config.videoTime || 0);
  floatingQuizQuestionInput.value = config.quizQuestion;
  floatingQuizOptionsInput.value = config.quizOptions.join('\n');
  if (floatingQuizSuccessInput) floatingQuizSuccessInput.value = config.successMessage;
  if (floatingQuizErrorInput) floatingQuizErrorInput.value = config.errorMessage;
  if (floatingQuizActionLabelInput) floatingQuizActionLabelInput.value = config.actionLabel;
  if (floatingQuizBackgroundColorInput) floatingQuizBackgroundColorInput.value = config.quizBackgroundColor;
  if (floatingQuizQuestionColorInput) floatingQuizQuestionColorInput.value = config.quizQuestionColor;
  if (floatingQuizOptionBackgroundColorInput) floatingQuizOptionBackgroundColorInput.value = config.quizOptionBackgroundColor;
  if (floatingQuizOptionTextColorInput) floatingQuizOptionTextColorInput.value = config.quizOptionTextColor;
  if (floatingQuizButtonBackgroundColorInput) floatingQuizButtonBackgroundColorInput.value = config.quizButtonBackgroundColor;
  if (floatingQuizPointsInput) floatingQuizPointsInput.value = String(config.points || 1);
  if (floatingQuizLockOnWrongToggle) floatingQuizLockOnWrongToggle.checked = Boolean(config.lockOnWrong);
  populateFloatingQuizCorrectOptions(config.quizOptions, config.quizCorrectOption);
  const actionType = config.type;
  document.getElementById('floatingTargetSlideField')?.classList.toggle('hidden', actionType !== 'jumpSlide');
  document.getElementById('floatingTargetElementField')?.classList.toggle('hidden', !['moveElement', 'playAnimation', 'replaceText', 'playAudio', 'playVideo', 'pauseVideo', 'seekVideo', 'showElement', 'hideElement'].includes(actionType));
  document.getElementById('floatingRuleGroupField')?.classList.toggle('hidden', element.type === 'detector' || !config.requireAllButtonsInGroup);
  document.getElementById('floatingDetectorAcceptedField')?.classList.toggle('hidden', element.type !== 'detector');
  document.getElementById('floatingDetectorMinCountField')?.classList.toggle('hidden', element.type !== 'detector');
  document.getElementById('floatingDetectorTriggerOnceField')?.classList.toggle('hidden', element.type !== 'detector');
  document.getElementById('floatingActionTextField')?.classList.toggle('hidden', !['addText', 'replaceText'].includes(actionType));
  document.getElementById('floatingReplaceModeField')?.classList.toggle('hidden', actionType !== 'replaceText');
  const replaceCounterMode = actionType === 'replaceText' && getReplaceTextMode(config.replaceMode) === REPLACE_COUNTER_MODE;
  document.getElementById('floatingReplaceCounterStartField')?.classList.toggle('hidden', !replaceCounterMode);
  document.getElementById('floatingReplaceCounterStepField')?.classList.toggle('hidden', !replaceCounterMode);
  document.getElementById('floatingTextFontSizeField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('floatingTextFontFamilyField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('floatingTextFontWeightField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('floatingTextAlignField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('floatingTextColorField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('floatingTextBgColorField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('floatingTextBackgroundToggleField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('floatingTextBorderToggleField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('floatingActionUrlField')?.classList.toggle('hidden', !['addImage', 'addAudio', 'addVideo'].includes(actionType));
  document.getElementById('floatingAudioVisibleField')?.classList.toggle('hidden', actionType !== 'addAudio');
  document.getElementById('floatingAudioLoopField')?.classList.toggle('hidden', actionType !== 'addAudio');
  const insertMode = ['addText', 'addImage', 'addAudio', 'addVideo', 'addQuiz'].includes(actionType);
  document.getElementById('floatingInsertXField')?.classList.toggle('hidden', !insertMode);
  document.getElementById('floatingInsertYField')?.classList.toggle('hidden', !insertMode);
  document.getElementById('floatingInsertWidthField')?.classList.toggle('hidden', !insertMode);
  document.getElementById('floatingInsertHeightField')?.classList.toggle('hidden', !insertMode);
  document.getElementById('floatingMoveXField')?.classList.toggle('hidden', actionType !== 'moveElement');
  document.getElementById('floatingMoveYField')?.classList.toggle('hidden', actionType !== 'moveElement');
  document.getElementById('floatingMoveDurationField')?.classList.toggle('hidden', actionType !== 'moveElement');
  document.getElementById('floatingVideoTimeField')?.classList.toggle('hidden', actionType !== 'seekVideo');
  const quizMode = actionType === 'addQuiz';
  document.getElementById('floatingQuizQuestionField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizOptionsField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizCorrectField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizSuccessField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizErrorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizActionLabelField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizBackgroundColorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizQuestionColorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizOptionBackgroundColorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizOptionTextColorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizButtonBackgroundColorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizPointsField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('floatingQuizLockOnWrongField')?.classList.toggle('hidden', !quizMode);
  if (floatingRequireAllToggle) {
    floatingRequireAllToggle.disabled = element.type === 'detector';
  }
  if (!insertMode) {
    isPickingFloatingInsertPosition = false;
  }
  if (!['moveElement', 'playAnimation', 'replaceText', 'playAudio', 'playVideo', 'pauseVideo', 'seekVideo', 'showElement', 'hideElement'].includes(actionType)) {
    isPickingFloatingTargetElement = false;
  }
  updateFloatingPlacementControls(element);
  requestAnimationFrame(() => positionStageEditorCard('floating'));
  updateStageEditorState();
};

const syncFloatingButtonEditor = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || !['floatingButton', 'detector'].includes(element.type)) {
    return;
  }
  normalizeFloatingActionConfig(element);
  const config = element.actionConfig;
  config.type = floatingActionTypeSelect?.value || 'none';
  config.targetSlideId = floatingTargetSlideSelect?.value || '';
  config.targetElementId = floatingTargetElementSelect?.value || '';
  config.requireAllButtonsInGroup = element.type === 'detector' ? false : Boolean(floatingRequireAllToggle?.checked);
  config.ruleGroup = config.requireAllButtonsInGroup ? (floatingRuleGroupInput?.value?.trim() || '') : '';
  config.detectorAcceptedDrag =
    element.type === 'detector'
      ? normalizeDetectorAcceptedDragValue(floatingDetectorAcceptedSelect?.value)
      : DETECTOR_ACCEPT_ANY;
  const forceSingleDetectorMatch = isSpecificDetectorElementRule(config.detectorAcceptedDrag);
  config.detectorMinMatchCount =
    element.type === 'detector' ? (forceSingleDetectorMatch ? 1 : Math.max(1, Number(floatingDetectorMinCountInput?.value) || 1)) : 1;
  config.detectorTriggerOnce = element.type === 'detector' ? Boolean(floatingDetectorTriggerOnceToggle?.checked) : false;
  if (element.type === 'detector' && floatingDetectorMinCountInput) {
    floatingDetectorMinCountInput.value = String(config.detectorMinMatchCount);
    floatingDetectorMinCountInput.disabled = forceSingleDetectorMatch;
  }
  const actionTextValue = floatingActionTextInput?.value ?? '';
  config.text = config.type === 'addText' ? (actionTextValue.length ? actionTextValue : 'Novo texto') : (config.text || 'Novo texto');
  config.replaceText = config.type === 'replaceText' ? actionTextValue : (config.replaceText || '');
  config.replaceMode = config.type === 'replaceText' ? getReplaceTextMode(floatingReplaceModeSelect?.value) : REPLACE_TEXT_MODE;
  config.replaceCounterStart =
    config.type === 'replaceText' ? (Number.isFinite(Number(floatingReplaceCounterStartInput?.value)) ? Number(floatingReplaceCounterStartInput.value) : 1) : 1;
  config.replaceCounterStep =
    config.type === 'replaceText' ? (Number.isFinite(Number(floatingReplaceCounterStepInput?.value)) ? Number(floatingReplaceCounterStepInput.value) : 1) : 1;
  config.url = floatingActionUrlInput?.value?.trim() || '';
  config.audioVisible = Boolean(floatingAudioVisibleToggle?.checked);
  config.audioLoop = Boolean(floatingAudioLoopToggle?.checked);
  config.textColor = floatingTextColorInput?.value || DEFAULT_INSERT_TEXT_STYLE.textColor;
  config.backgroundColor = floatingTextBgColorInput?.value || DEFAULT_INSERT_TEXT_STYLE.backgroundColor;
  config.textAlign = floatingTextAlignSelect?.value || DEFAULT_INSERT_TEXT_STYLE.textAlign;
  config.fontFamily = floatingTextFontFamilySelect?.value || DEFAULT_INSERT_TEXT_STYLE.fontFamily;
  config.fontWeight = floatingTextFontWeightSelect?.value || DEFAULT_INSERT_TEXT_STYLE.fontWeight;
  config.fontSize = Math.max(10, Number(floatingTextFontSizeInput?.value) || DEFAULT_INSERT_TEXT_STYLE.fontSize);
  config.hasTextBackground = Boolean(floatingTextBackgroundToggle?.checked);
  config.hasTextBorder = Boolean(floatingTextBorderToggle?.checked);
  config.hasTextBlock = false;
  config.insertX = Math.max(0, Number(floatingInsertXInput?.value) || 120);
  config.insertY = Math.max(0, Number(floatingInsertYInput?.value) || 120);
  config.insertWidth = Math.max(40, Number(floatingInsertWidthInput?.value) || 280);
  config.insertHeight = Math.max(40, Number(floatingInsertHeightInput?.value) || 180);
  config.moveByX = Number.isFinite(Number(floatingMoveXInput?.value)) ? Number(floatingMoveXInput.value) : 160;
  config.moveByY = Number.isFinite(Number(floatingMoveYInput?.value)) ? Number(floatingMoveYInput.value) : 0;
  config.moveDuration = Math.max(0.1, Number(floatingMoveDurationInput?.value) || 0.8);
  config.videoTime = Math.max(0, Number(floatingVideoTimeInput?.value) || 0);
  const floatingQuizQuestionValue = floatingQuizQuestionInput?.value ?? '';
  config.quizQuestion = floatingQuizQuestionValue.length ? floatingQuizQuestionValue : 'Nova pergunta';
  config.quizOptions = (floatingQuizOptionsInput?.value || '')
    .split('\n')
    .map((option) => option.trim())
    .filter(Boolean);
  if (!config.quizOptions.length) {
    config.quizOptions = createDefaultQuizOptions();
  }
  const correctIndex = Number(floatingQuizCorrectSelect?.value);
  config.quizCorrectOption = Number.isNaN(correctIndex)
    ? 0
    : Math.min(Math.max(correctIndex, 0), config.quizOptions.length - 1);
  const floatingQuizSuccessValue = floatingQuizSuccessInput?.value ?? '';
  const floatingQuizErrorValue = floatingQuizErrorInput?.value ?? '';
  const floatingQuizActionLabelValue = floatingQuizActionLabelInput?.value ?? '';
  config.successMessage = floatingQuizSuccessValue.length ? floatingQuizSuccessValue : 'Resposta correta!';
  config.errorMessage = floatingQuizErrorValue.length ? floatingQuizErrorValue : 'Resposta incorreta. Tente novamente.';
  config.actionLabel = floatingQuizActionLabelValue.length ? floatingQuizActionLabelValue : 'Validar resposta';
  config.quizBackgroundColor = floatingQuizBackgroundColorInput?.value || '#ffffff';
  config.quizQuestionColor = floatingQuizQuestionColorInput?.value || '#171934';
  config.quizOptionBackgroundColor = floatingQuizOptionBackgroundColorInput?.value || '#f4f6ff';
  config.quizOptionTextColor = floatingQuizOptionTextColorInput?.value || '#25284c';
  config.quizButtonBackgroundColor = floatingQuizButtonBackgroundColorInput?.value || '#6d63ff';
  config.points = Math.max(1, Number(floatingQuizPointsInput?.value) || 1);
  config.lockOnWrong = Boolean(floatingQuizLockOnWrongToggle?.checked);
  updateFloatingButtonEditorVisibility(element);
  updateFloatingPlacementPreview();
  scheduleHistoryCommit();
};

const toggleFloatingPlacementPicker = () => {
  const element = getSelectedActionTriggerElement();
  if (!element) {
    isPickingFloatingInsertPosition = false;
    updateFloatingPlacementControls(null);
    return;
  }
  normalizeFloatingActionConfig(element);
  if (!FLOATING_INSERT_ACTIONS.includes(element.actionConfig?.type || 'none')) {
    isPickingFloatingInsertPosition = false;
    updateFloatingPlacementControls(element);
    return;
  }
  isPickingFloatingInsertPosition = !isPickingFloatingInsertPosition;
  updateFloatingPlacementPreview();
};

const toggleFloatingTargetElementPicker = () => {
  const element = getSelectedActionTriggerElement();
  if (!element) {
    isPickingFloatingTargetElement = false;
    updateFloatingPlacementPreview();
    return;
  }
  normalizeFloatingActionConfig(element);
  if (!['moveElement', 'playAnimation', 'replaceText'].includes(element.actionConfig?.type || 'none')) {
    isPickingFloatingTargetElement = false;
    updateFloatingPlacementPreview();
    return;
  }
  isPickingFloatingTargetElement = !isPickingFloatingTargetElement;
  updateFloatingPlacementPreview();
};

const handleFloatingPlacementPick = (event) => {
  const element = getSelectedActionTriggerElement();
  if (!slideCanvas || !element || !isPickingFloatingInsertPosition) {
    return false;
  }
  normalizeFloatingActionConfig(element);
  if (!FLOATING_INSERT_ACTIONS.includes(element.actionConfig?.type || 'none')) {
    isPickingFloatingInsertPosition = false;
    updateFloatingPlacementPreview();
    return false;
  }
  const stage = getStageDimensions();
  const pointer = getStagePointerPosition(event);
  const previewRect = getFloatingInsertPreviewRect(element.actionConfig);
  const x = clamp(pointer.x, 0, Math.max(0, stage.width - previewRect.width));
  const y = clamp(pointer.y, 0, Math.max(0, stage.height - previewRect.height));
  element.actionConfig.insertX = Math.round(x);
  element.actionConfig.insertY = Math.round(y);
  if (floatingInsertXInput) {
    floatingInsertXInput.value = String(element.actionConfig.insertX);
  }
  if (floatingInsertYInput) {
    floatingInsertYInput.value = String(element.actionConfig.insertY);
  }
  isPickingFloatingInsertPosition = false;
  updateFloatingPlacementPreview();
  scheduleHistoryCommit();
  return true;
};

const syncBlockEditor = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'block') {
    return;
  }
  element.content = blockElementContentInput?.value || element.content || '';
  const width = Number(blockElementWidthInput?.value);
  const height = Number(blockElementHeightInput?.value);
  const rotation = Number(blockElementRotationInput?.value);
  const layer = Number(blockElementLayerInput?.value);
  if (!Number.isNaN(width) && width > 0) {
    element.width = Math.max(MIN_ELEMENT_SIZE, width);
  }
  if (!Number.isNaN(height) && height > 0) {
    element.height = Math.max(MIN_ELEMENT_SIZE, height);
  }
  if (!Number.isNaN(rotation)) {
    element.rotation = ((rotation % 360) + 360) % 360;
  }
  if (!Number.isNaN(layer)) {
    element.zIndex = Math.max(0, Math.round(layer));
  }
  element.shape = blockElementShapeSelect?.value || element.shape || 'rectangle';
  element.useGradient = Boolean(blockElementGradientToggle?.checked);
  if (element.useGradient) {
    element.gradientStart = blockElementGradientStartInput?.value || element.gradientStart || '#ffd54f';
    element.gradientEnd = blockElementGradientEndInput?.value || element.gradientEnd || '#ffb74d';
  } else {
    element.solidColor = blockElementSolidColorInput?.value || element.solidColor || '#f4f6ff';
  }
  element.backgroundColor = element.useGradient
    ? blockElementGradientEndInput?.value || element.gradientEnd || element.backgroundColor
    : blockElementSolidColorInput?.value || element.solidColor || element.backgroundColor;
  element.textColor = blockElementTextColorInput?.value || element.textColor || '#0f142c';
  const fontSize = Number(blockElementFontSizeInput?.value);
  if (!Number.isNaN(fontSize) && fontSize > 0) {
    element.fontSize = fontSize;
  }
  element.fontFamily = blockElementFontFamilySelect?.value || element.fontFamily || 'Inter, sans-serif';
  element.fontWeight = blockElementFontWeightSelect?.value || element.fontWeight || '500';
  element.textureFit = blockElementTextureFitSelect?.value || getBlockTextureFit(element);
  normalizeBlockTexture(element);
  syncElementBackgroundState(element);
  applyStageConstraints(element);
  updateBlockGradientFieldsVisibility();
  renderSlide();
  scheduleHistoryCommit();
};

const applyMotionFrameSnapshotToElement = (element, frame) => {
  if (!element || !frame) {
    return;
  }
  element.x = Number(frame.x) || 0;
  element.y = Number(frame.y) || 0;
  element.width = Math.max(MIN_ELEMENT_SIZE, Number(frame.width) || Number(element.width) || MIN_ELEMENT_SIZE);
  element.height = Math.max(MIN_ELEMENT_SIZE, Number(frame.height) || Number(element.height) || MIN_ELEMENT_SIZE);
  element.rotation = ((Number(frame.rotation) || 0) % 360 + 360) % 360;
  applyStageConstraints(element);
};

const addCurrentMotionFrame = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || !supportsRecordedMotion(element)) {
    return;
  }
  normalizeElementAnimation(element);
  element.animationType = MOTION_ANIMATION_TYPE;
  element.motionFrames = Array.isArray(element.motionFrames) ? element.motionFrames : [];
  element.motionFrames.push(getMotionFrameSnapshot(element));
  selectedMotionFrameIndex = element.motionFrames.length - 1;
  updateAnimationEditorVisibility(element, { forceOpen: true });
  renderSlide();
  scheduleHistoryCommit();
};

const updateSelectedMotionFrame = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || !supportsRecordedMotion(element) || selectedMotionFrameIndex < 0) {
    return;
  }
  normalizeElementAnimation(element);
  if (!Array.isArray(element.motionFrames) || !element.motionFrames[selectedMotionFrameIndex]) {
    return;
  }
  element.motionFrames[selectedMotionFrameIndex] = getMotionFrameSnapshot(element);
  updateAnimationEditorVisibility(element, { forceOpen: true });
  renderSlide();
  scheduleHistoryCommit();
};

const removeSelectedMotionFrame = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || !Array.isArray(element.motionFrames) || selectedMotionFrameIndex < 0) {
    return;
  }
  element.motionFrames.splice(selectedMotionFrameIndex, 1);
  selectedMotionFrameIndex = Math.min(selectedMotionFrameIndex, element.motionFrames.length - 1);
  updateAnimationEditorVisibility(element, { forceOpen: true });
  renderSlide();
  scheduleHistoryCommit();
};

const clearAllMotionFrames = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element) {
    return;
  }
  element.motionFrames = [];
  selectedMotionFrameIndex = -1;
  updateAnimationEditorVisibility(element, { forceOpen: true });
  renderSlide();
  scheduleHistoryCommit();
};

const selectMotionFrameForEditing = (index) => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || !Array.isArray(element.motionFrames) || !element.motionFrames[index]) {
    return;
  }
  selectedMotionFrameIndex = index;
  applyMotionFrameSnapshotToElement(element, element.motionFrames[index]);
  updateElementInspector(element);
  updateAnimationEditorVisibility(element, { forceOpen: true });
  renderSlide();
};

const updateSmartSidebarVisibility = (element) => {
  const type = element?.type || '';
  const toggle = (id, visible) => document.getElementById(id)?.classList.toggle('hidden', !visible);
  const hasElement = Boolean(type);
  const showSharedLayout = hasElement && !['block', 'image', 'audio'].includes(type);
  ['sharedLayoutField', 'sharedHeightField', 'sharedRotationField', 'sharedLayerField'].forEach((id) =>
    toggle(id, showSharedLayout)
  );
  toggle('sharedLayerToolbar', hasElement);
  const supportsTypography = ['text', 'floatingButton', 'quiz'].includes(type);
  ['sharedTextColorField', 'sharedFontSizeField', 'sharedFontFamilyField', 'sharedFontWeightField'].forEach((id) =>
    toggle(id, supportsTypography)
  );
  toggle('sharedBackgroundField', ['text', 'floatingButton'].includes(type));
  toggle('sharedStudentDragField', ['text', 'block'].includes(type));
  toggle('textBackgroundField', type === 'text');
  toggle('textBorderField', type === 'text');
  toggle('textAlignToolsField', type === 'text');
  const supportsBlockStyles = ['floatingButton'].includes(type);
  toggle('blockShapeField', ['floatingButton'].includes(type));
  toggle('gradientToggleField', supportsBlockStyles);
  toggle('solidColorField', supportsBlockStyles);
  toggle('gradientStartField', supportsBlockStyles && Boolean(element?.useGradient));
  toggle('gradientEndField', supportsBlockStyles && Boolean(element?.useGradient));
  updateTextAlignmentControls(element);
  updateRemoveBackgroundButtonState();
};

const getAiActionSummary = (action) => {
  const parts = [];
  if (action.type) {
    parts.push(action.type);
  }
  if (action.slide?.title) {
    parts.push(`slide "${action.slide.title}"`);
  }
  if (action.element?.type) {
    parts.push(`elemento ${action.element.type}`);
  }
  if (action.elementId) {
    parts.push(`id ${action.elementId}`);
  }
  return parts.join(' • ');
};

const renderAiAssistantActions = () => {
  if (!aiAssistantActions) return;
  if (!aiAssistantState.pendingActions.length) {
    aiAssistantActions.innerHTML = '<p class="muted" style="margin:0;">Nenhuma proposta carregada.</p>';
    if (aiAssistantApplyBtn) aiAssistantApplyBtn.disabled = true;
    if (aiAssistantDiscardBtn) aiAssistantDiscardBtn.disabled = true;
    return;
  }
  aiAssistantActions.innerHTML = aiAssistantState.pendingActions
    .map(
      (action, index) => `
      <div class="ai-action-item">
        <strong>${index + 1}. ${escapeHtml(getAiActionSummary(action) || 'Ação proposta')}</strong>
        <small>${escapeHtml(action.reason || 'Sem observação adicional.')}</small>
      </div>`
    )
    .join('');
  if (aiAssistantApplyBtn) aiAssistantApplyBtn.disabled = false;
  if (aiAssistantDiscardBtn) aiAssistantDiscardBtn.disabled = false;
  updateAiAssistantStatus(`Há ${aiAssistantState.pendingActions.length} alterações pendentes para aplicar ou descartar.`, 'success');
};

const updateAiAssistantStatus = (message, tone = 'muted') => {
  if (!aiAssistantStatus) return;
  aiAssistantStatus.textContent = message;
  aiAssistantStatus.style.color =
    tone === 'error' ? '#d13c55' : tone === 'success' ? '#0d8a49' : '#6b6f8a';
};

const renderAiAssistantFeedback = () => {
  if (!aiAssistantFeedback) return;
  if (!aiAssistantState.feedbackEntries.length) {
    aiAssistantFeedback.innerHTML = '<p class="muted" style="margin:0;">O andamento da IA vai aparecer aqui.</p>';
    return;
  }
  aiAssistantFeedback.innerHTML = aiAssistantState.feedbackEntries
    .map(
      (entry) => `
      <div class="ai-feedback-entry ${escapeHtml(entry.tone || 'muted')}">
        <strong>${escapeHtml(entry.title || 'IA')}</strong>
        <small>${escapeHtml(entry.message || '')}</small>
      </div>`
    )
    .join('');
  aiAssistantFeedback.scrollTop = aiAssistantFeedback.scrollHeight;
};

const pushAiAssistantFeedback = (title, message, tone = 'muted') => {
  aiAssistantState.feedbackEntries.push({
    title,
    message,
    tone
  });
  if (aiAssistantState.feedbackEntries.length > 30) {
    aiAssistantState.feedbackEntries.shift();
  }
  renderAiAssistantFeedback();
};

const getAiAssistantAttachmentsPayload = () =>
  aiAssistantState.attachments.map((attachment) => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    data: attachment.data
  }));

const renderAiAssistantAttachmentPreview = () => {
  if (!aiAssistantAttachmentPreview) return;
  const [attachment] = aiAssistantState.attachments;
  if (!attachment) {
    aiAssistantAttachmentPreview.innerHTML = '<p class="muted" style="margin:0;">Nenhuma imagem anexada.</p>';
    if (aiAssistantClearImageBtn) {
      aiAssistantClearImageBtn.disabled = true;
    }
    return;
  }
  aiAssistantAttachmentPreview.innerHTML = `
    <div class="ai-attachment-card">
      <strong>${escapeHtml(attachment.name || 'Imagem anexada')}</strong>
      <small>${escapeHtml(attachment.mimeType || 'image/*')}</small>
      <img src="${attachment.previewUrl}" alt="${escapeHtml(attachment.name || 'Imagem anexada')}" />
    </div>
  `;
  if (aiAssistantClearImageBtn) {
    aiAssistantClearImageBtn.disabled = false;
  }
};

const attachImageToAiAssistant = async () => {
  const dataUrl = await readLocalFile(aiAssistantImageInput, 'image');
  if (!dataUrl) {
    return;
  }
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) {
    throw new Error('Não foi possível ler a imagem anexada.');
  }
  const [file] = aiAssistantImageInput?.files || [];
  aiAssistantState.attachments = [
    {
      name: file?.name || 'imagem-anexada',
      mimeType: match[1],
      data: match[2],
      previewUrl: dataUrl
    }
  ];
  renderAiAssistantAttachmentPreview();
  pushAiAssistantFeedback('Imagem anexada', 'A próxima solicitação vai enviar a imagem para leitura da IA e para a Nano Banana usar como referência.', 'success');
};

const clearAiAssistantAttachments = () => {
  aiAssistantState.attachments = [];
  if (aiAssistantImageInput) {
    aiAssistantImageInput.value = '';
  }
  renderAiAssistantAttachmentPreview();
};

const removeBackgroundFromSelectedImage = async () => {
  const slide = getActiveSlide();
  const element = slide?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'image' || !element.src) {
    alert('Selecione uma imagem para remover o fundo.');
    return;
  }
  isRemovingImageBackground = true;
  removingBackgroundElementId = element.id;
  updateRemoveBackgroundButtonState();
  renderSlide();
  try {
    const response = await authorizedFetch('/api/admin/images/remove-background', {
      method: 'POST',
      body: JSON.stringify({ src: element.src })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Não foi possível remover o fundo da imagem.');
    }
    const { removeMaskColorFromImageSource } = await backgroundRemovalModulePromise;
    element.src = await removeMaskColorFromImageSource(payload?.dataUrl || element.src, {
      maskColor: payload?.maskColor || ''
    });
    renderSlide();
    commitHistoryState();
  } catch (error) {
    alert(error.message || 'Não foi possível remover o fundo da imagem.');
  } finally {
    isRemovingImageBackground = false;
    removingBackgroundElementId = null;
    updateRemoveBackgroundButtonState();
    renderSlide();
  }
};

const toggleAiReferenceCard = (forceExpanded = null) => {
  toggleCollapsibleCard(aiReferenceCard, forceExpanded);
};

const toggleCourseModuleCard = (forceExpanded = null) => {
  toggleCollapsibleCard(courseModuleCard, forceExpanded);
};


const rememberAiAction = (action) => {
  if (!action || typeof action !== 'object') {
    return;
  }
  aiAssistantState.recentActions.push(JSON.parse(JSON.stringify(action)));
  if (aiAssistantState.recentActions.length > 10) {
    aiAssistantState.recentActions.shift();
  }
};

const saveAiProposalHistory = () => {
  try {
    localStorage.setItem(AI_PROPOSAL_HISTORY_KEY, JSON.stringify(aiAssistantState.proposalHistory));
  } catch (error) {
    console.warn('Não foi possível salvar o histórico de propostas da IA.', error);
  }
};

const loadAiProposalHistory = () => {
  try {
    const raw = localStorage.getItem(AI_PROPOSAL_HISTORY_KEY);
    const parsed = JSON.parse(raw || '[]');
    aiAssistantState.proposalHistory = Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry === 'object' && Array.isArray(entry.actions))
      : [];
  } catch (error) {
    aiAssistantState.proposalHistory = [];
  }
};

const rememberAiProposal = (prompt, actions) => {
  const normalizedPrompt = String(prompt || '').trim();
  if (!normalizedPrompt || !Array.isArray(actions) || !actions.length) {
    return;
  }
  aiAssistantState.proposalHistory.unshift({
    id: createId('ai-proposal'),
    prompt: normalizedPrompt,
    createdAt: new Date().toISOString(),
    actions: JSON.parse(JSON.stringify(actions))
  });
  aiAssistantState.proposalHistory = aiAssistantState.proposalHistory.slice(0, 20);
  saveAiProposalHistory();
  renderAiProposalHistory();
};

const deleteAiProposalHistoryEntry = (entryId) => {
  const normalizedId = String(entryId || '').trim();
  if (!normalizedId) {
    return false;
  }
  const nextHistory = aiAssistantState.proposalHistory.filter((entry) => entry?.id !== normalizedId);
  if (nextHistory.length === aiAssistantState.proposalHistory.length) {
    return false;
  }
  aiAssistantState.proposalHistory = nextHistory;
  saveAiProposalHistory();
  renderAiProposalHistory();
  return true;
};

const getAiProposalHistoryLabel = (entry) => {
  const dateLabel = entry?.createdAt
    ? new Date(entry.createdAt).toLocaleString('pt-BR')
    : 'Agora';
  const actionCount = Array.isArray(entry?.actions) ? entry.actions.length : 0;
  return `${dateLabel} • ${actionCount} ação(ões)`;
};

const renderAiProposalHistory = () => {
  if (!aiProposalHistoryList) return;
  if (!aiAssistantState.proposalHistory.length) {
    aiProposalHistoryList.innerHTML = '<p class="muted" style="margin:0;">As propostas geradas pela IA vão aparecer aqui.</p>';
    return;
  }
  aiProposalHistoryList.innerHTML = aiAssistantState.proposalHistory
    .map(
      (entry) => `
        <div class="ai-proposal-history-item">
          <strong>${escapeHtml(truncateText(entry.prompt || 'Sem prompt', 140))}</strong>
          <small>${escapeHtml(getAiProposalHistoryLabel(entry))}</small>
          <div class="ai-proposal-history-actions">
            <button class="secondary-btn small" type="button" data-ai-history-action="load" data-ai-history-id="${escapeHtml(entry.id)}">Carregar proposta</button>
            <button class="secondary-btn small" type="button" data-ai-history-action="reuse-prompt" data-ai-history-id="${escapeHtml(entry.id)}">Usar prompt</button>
            <button class="secondary-btn small" type="button" data-ai-history-action="apply" data-ai-history-id="${escapeHtml(entry.id)}">Aplicar de novo</button>
            <button class="secondary-btn small danger-btn" type="button" data-ai-history-action="delete" data-ai-history-id="${escapeHtml(entry.id)}">Excluir</button>
          </div>
        </div>`
    )
    .join('');
};

const renderAiAssistantDebug = () => {
  if (!aiAssistantDebugOutput) return;
  if (!aiAssistantState.debugInfo) {
    aiAssistantDebugOutput.textContent = 'Nenhum debug disponível ainda.';
    return;
  }
  aiAssistantDebugOutput.textContent = JSON.stringify(aiAssistantState.debugInfo, null, 2);
};

const startAiAssistantLoading = (message = 'Gerando proposta da IA') => {
  aiAssistantState.loading = true;
  aiAssistantState.loadingMessage = message;
  if (aiAssistantGenerateBtn) {
    aiAssistantGenerateBtn.disabled = true;
    aiAssistantGenerateBtn.textContent = 'Gerando...';
    aiAssistantGenerateBtn.classList.add('is-loading');
  }
  let dots = 0;
  clearInterval(aiAssistantState.loadingInterval);
  updateAiAssistantStatus(`${message}.`);
  aiAssistantState.loadingInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    updateAiAssistantStatus(`${message}${'.'.repeat(Math.max(1, dots))}`);
  }, 450);
};

const stopAiAssistantLoading = () => {
  aiAssistantState.loading = false;
  aiAssistantState.isStreaming = false;
  clearInterval(aiAssistantState.loadingInterval);
  aiAssistantState.loadingInterval = null;
  if (aiAssistantGenerateBtn) {
    aiAssistantGenerateBtn.disabled = false;
    aiAssistantGenerateBtn.textContent = 'Gerar proposta';
    aiAssistantGenerateBtn.classList.remove('is-loading');
  }
};

const clearAiAssistantProposal = () => {
  aiAssistantState.pendingActions = [];
  aiAssistantState.stepIndex = 0;
  aiAssistantState.feedbackEntries = [];
  aiAssistantState.recentActions = [];
  aiAssistantState.debugInfo = null;
  renderAiAssistantActions();
  renderAiAssistantFeedback();
  renderAiAssistantDebug();
};

const requestAiBulkProposal = async (request) => {
  clearAiAssistantProposal();
  aiAssistantState.stopRequested = false;
  aiAssistantState.lastPrompt = request;
  updateBuilderStageSize();
  pushAiAssistantFeedback(
    'IA pensando',
    aiAssistantState.attachments.length
      ? 'Montando a proposta com leitura da imagem anexada e geração visual quando necessário.'
      : 'Montando uma proposta completa em uma única requisição.'
  );
  const response = await authorizedFetch('/api/admin/ai/slide-actions', {
    method: 'POST',
    body: JSON.stringify({
      request,
      slides: builderState.slides,
      activeSlideId: builderState.activeSlideId,
      stageSize: builderState.stageSize.width && builderState.stageSize.height ? builderState.stageSize : DEFAULT_STAGE_SIZE,
      attachments: getAiAssistantAttachmentsPayload()
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.message || 'A IA não conseguiu gerar a proposta.');
  }
  const actions = Array.isArray(result?.actions) ? result.actions : [];
  aiAssistantState.debugInfo = {
    request,
    returnedActionCount: actions.length,
    actions,
    providerLabel: result?.providerLabel || '',
    requireConfirmation: result?.requireConfirmation !== false,
    response: result
  };
  renderAiAssistantDebug();
  if (!actions.length) {
    pushAiAssistantFeedback('Sem alterações', 'A IA não encontrou mudanças válidas para aplicar.', 'muted');
    updateAiAssistantStatus('A IA não retornou alterações válidas.');
    return;
  }
  aiAssistantState.pendingActions = actions;
  rememberAiProposal(request, actions);
  renderAiAssistantActions();
  pushAiAssistantFeedback('Proposta pronta', `${actions.length} alterações foram preparadas usando as ferramentas do editor.`, 'success');
  updateAiAssistantStatus(
    result?.requireConfirmation === false
      ? 'Proposta pronta. Aplicando automaticamente...'
      : `Proposta pronta com ${actions.length} alterações. Revise e clique em aplicar.`
  );
  if (result?.requireConfirmation === false) {
    applyPendingAiActions();
  }
};

const loadAiAssistantSettings = async () => {
  try {
    const response = await authorizedFetch('/api/admin/ai-settings');
    if (!response.ok) {
      throw new Error('Não foi possível carregar a integração de IA.');
    }
    aiAssistantState.settings = await response.json();
    if (aiAssistantState.settings?.connected && aiAssistantState.settings?.isEnabled) {
      const imageProvider = aiAssistantState.settings?.imageProvider;
      updateAiAssistantStatus(
        imageProvider?.connected && imageProvider?.isEnabled
          ? `${aiAssistantState.settings.providerLabel} (${aiAssistantState.settings.model}) + ${imageProvider.providerLabel} (${imageProvider.model}) conectados.`
          : `${aiAssistantState.settings.providerLabel} conectado em ${aiAssistantState.settings.model}.`
      );
    } else {
      updateAiAssistantStatus('Configure a integração de IA no painel admin antes de usar o assistente.');
    }
  } catch (error) {
    aiAssistantState.settings = null;
    updateAiAssistantStatus(error.message || 'Não foi possível carregar a integração de IA.', 'error');
  }
};

const addSlide = (title) => {
  const nextTitle = title || `Slide ${builderState.slides.length + 1}`;
  const newSlide = { id: createId('slide'), title: nextTitle, elements: [] };
  builderState.slides.push(newSlide);
  setActiveSlide(newSlide.id);
  commitHistoryState();
};

const insertSlideAfter = (slide, afterSlideId) => {
  if (!afterSlideId) {
    builderState.slides.push(slide);
    return;
  }
  const targetIndex = builderState.slides.findIndex((entry) => entry.id === afterSlideId);
  if (targetIndex === -1) {
    builderState.slides.push(slide);
    return;
  }
  builderState.slides.splice(targetIndex + 1, 0, slide);
};

const setActiveSlide = (slideId) => {
  if (!slideId) return;
  builderState.activeSlideId = slideId;
  renderSlideList();
  renderSlide();
};

const getActiveSlide = () => builderState.slides.find((slide) => slide.id === builderState.activeSlideId);

const renderSlideList = () => {
  if (!slideList) return;
  slideList.innerHTML = builderState.slides
    .map(
      (slide) => `<button type="button" class="slide-chip ${slide.id === builderState.activeSlideId ? 'active' : ''}" data-slide-id="${slide.id}">${slide.title}</button>`
    )
    .join('');
};

const renderSlide = () => {
  if (!slideCanvas) return;
  const slide = previewState.active ? getPreviewActiveSlide() : getActiveSlide();
  if (!slide) {
    slideCanvas.innerHTML = '';
    return;
  }
  if (previewState.active) {
    if (lastPreviewAnimationSlideId !== slide.id) {
      previewAnimationState.clear();
      lastPreviewAnimationSlideId = slide.id;
    }
  } else {
    previewAnimationState.clear();
    lastPreviewAnimationSlideId = null;
  }
  if (!previewState.active && selectedElementId && !slide.elements.some((child) => child.id === selectedElementId)) {
    selectedElementId = null;
    updateElementInspector(null);
  }
  if (slideName) {
    slideName.textContent = previewState.active ? `${slide.title} • Prévia do aluno` : slide.title;
  }
  if (previewStageBtn) {
    previewStageBtn.textContent = previewState.active ? 'Sair da prévia' : 'Prévia do aluno';
    previewStageBtn.classList.toggle('active', previewState.active);
  }
  slideCanvas.innerHTML = '';
  setStageBackground(slide);
  if (!previewState.active) {
    syncBackgroundInputs(slide);
  }
  if (!slide.elements.length) {
    const hint = document.createElement('p');
    hint.className = 'canvas-hint';
    hint.textContent = previewState.active
      ? 'Nenhum elemento neste slide da prévia.'
      : 'Arraste elementos aqui ou clique em um botão do painel para começar.';
    slideCanvas.appendChild(hint);
    clearHandleLayer();
    destroyEraserOverlay();
    updateBuilderStageSize();
    return;
  }
  slide.elements
    .slice()
    .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0))
    .forEach((element) => {
      const node = previewState.active ? createPreviewElementNode(element, slide) : renderElementNode(element);
      slideCanvas.appendChild(node);
    });
  if (!previewState.active) {
    renderHandles();
    updateFloatingPlacementPreview();
    renderEraserOverlay();
  } else {
    clearHandleLayer();
    destroyEraserOverlay();
  }
  updateBuilderStageSize();
};

const clearHandleLayer = () => {
  if (handleLayer) {
    handleLayer.remove();
    handleLayer = null;
  }
};

const toggleStudentPreview = () => {
  if (previewState.active) {
    previewState.active = false;
    previewState.slides = [];
    previewState.activeSlideId = null;
    previewState.clickedRuleButtons = new Map();
    previewState.triggeredDetectors = new Set();
    previewState.replaceCounters = new Map();
    previewState.hiddenElements = new Map();
    previewAnimationState.clear();
    lastPreviewAnimationSlideId = null;
    renderSlide();
    return;
  }
  previewState.active = true;
  previewState.slides = JSON.parse(JSON.stringify(builderState.slides || []));
  previewState.activeSlideId = builderState.activeSlideId || previewState.slides[0]?.id || null;
  previewState.clickedRuleButtons = new Map();
  previewState.triggeredDetectors = new Set();
  previewState.replaceCounters = new Map();
  previewState.hiddenElements = new Map();
  previewAnimationState.clear();
  lastPreviewAnimationSlideId = null;
  renderSlide();
};

const startResize = (direction, element, event) => {
  event.preventDefault();
  event.stopPropagation();
  const startPointer = getStagePointerPosition(event);
  const startWidth = Number(element.width) || MIN_ELEMENT_SIZE;
  const startHeight = Number(element.height) || MIN_ELEMENT_SIZE;
  const startLeft = element.x || 0;
  const startTop = element.y || 0;
  const moveHandler = (moveEvent) => {
    const movePointer = getStagePointerPosition(moveEvent);
    let deltaX = movePointer.x - startPointer.x;
    let deltaY = movePointer.y - startPointer.y;
    let newWidth = startWidth;
    let newHeight = startHeight;
    let newLeft = startLeft;
    let newTop = startTop;
    if (direction.includes('e')) {
      newWidth = startWidth + deltaX;
    }
    if (direction.includes('s')) {
      newHeight = startHeight + deltaY;
    }
    if (direction.includes('w')) {
      newWidth = startWidth - deltaX;
      newLeft = startLeft + deltaX;
    }
    if (direction.includes('n')) {
      newHeight = startHeight - deltaY;
      newTop = startTop + deltaY;
    }
    element.width = Math.max(MIN_ELEMENT_SIZE, newWidth);
    element.height = Math.max(MIN_ELEMENT_SIZE, newHeight);
    element.x = newLeft;
    element.y = newTop;
    applyStageConstraints(element);
    updateElementInspector(element);
    renderSlide();
  };
  const endHandler = () => {
    document.removeEventListener('pointermove', moveHandler);
    document.removeEventListener('pointerup', endHandler);
    commitHistoryState();
  };
  document.addEventListener('pointermove', moveHandler);
  document.addEventListener('pointerup', endHandler);
};

const startRotate = (element, event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!slideCanvas) return;
  const stageRect = slideCanvas.getBoundingClientRect();
  const scale = getStageScale();
  const width = Number(element.width) || MIN_ELEMENT_SIZE;
  const height = Number(element.height) || MIN_ELEMENT_SIZE;
  const centerX = stageRect.left + ((element.x || 0) + width / 2) * scale;
  const centerY = stageRect.top + ((element.y || 0) + height / 2) * scale;
  const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
  const baseRotation = Number(element.rotation) || 0;
  const moveHandler = (moveEvent) => {
    const currentAngle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX);
    const delta = currentAngle - startAngle;
    const degrees = ((baseRotation + (delta * 180) / Math.PI) % 360 + 360) % 360;
    element.rotation = degrees;
    updateElementInspector(element);
    renderSlide();
  };
  const endHandler = () => {
    document.removeEventListener('pointermove', moveHandler);
    document.removeEventListener('pointerup', endHandler);
    commitHistoryState();
  };
  document.addEventListener('pointermove', moveHandler);
  document.addEventListener('pointerup', endHandler);
};

const renderHandles = () => {
  clearHandleLayer();
  if (!slideCanvas || !selectedElementId) {
    return;
  }
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element) {
    return;
  }
  const left = element.x || 0;
  const top = element.y || 0;
  const width = Number(element.width) || MIN_ELEMENT_SIZE;
  const height = Number(element.height) || MIN_ELEMENT_SIZE;
  handleLayer = document.createElement('div');
  handleLayer.className = 'element-handle-layer';
  const corners = ['nw', 'ne', 'sw', 'se'];
  corners.forEach((direction) => {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.dataset.direction = direction;
    const offsetX = direction.includes('e') ? width : 0;
    const offsetY = direction.includes('s') ? height : 0;
    handle.style.left = `${left + offsetX - 6}px`;
    handle.style.top = `${top + offsetY - 6}px`;
    handle.addEventListener('pointerdown', (event) => startResize(direction, element, event));
    handleLayer.appendChild(handle);
  });
  const rotateHandle = document.createElement('div');
  rotateHandle.className = 'resize-handle rotate';
  rotateHandle.style.left = `${left + width / 2 - 6}px`;
  rotateHandle.style.top = `${top - 24}px`;
  rotateHandle.addEventListener('pointerdown', (event) => startRotate(element, event));
  handleLayer.appendChild(rotateHandle);
  slideCanvas.appendChild(handleLayer);
};

function setStageBackground(slide) {
  if (!slideCanvas) return;
  const backgroundStyles = getSlideBackgroundStyles(slide);
  renderStageBackgroundMedia(slideCanvas, slide, { interactive: previewState.active });
  slideCanvas.style.backgroundImage = backgroundStyles.backgroundImage;
  slideCanvas.style.backgroundSize = backgroundStyles.backgroundImage ? 'cover' : '';
  slideCanvas.style.backgroundPosition = backgroundStyles.backgroundImage ? 'center' : '';
  slideCanvas.style.backgroundColor = backgroundStyles.backgroundColor;
}

function syncBackgroundInputs(slide) {
  if (!slide) return;
  normalizeSlideBackgroundFill(slide);
  if (slideBgInput) {
    const backgroundImage = slide.backgroundImage || '';
    slideBgInput.value = backgroundImage.startsWith('data:image/') ? '' : backgroundImage;
  }
  if (slideBgStatus) {
    const backgroundImage = slide.backgroundImage || '';
    const backgroundVideo = slide.backgroundVideo || '';
    slideBgStatus.textContent = backgroundVideo
      ? backgroundVideo.startsWith('data:video/')
        ? 'Vídeo local em tela cheia configurado no palco.'
        : 'Vídeo de fundo configurado por URL.'
      : backgroundImage
        ? backgroundImage.startsWith('data:image/')
          ? 'Imagem local carregada para este slide.'
          : 'Imagem de fundo definida por URL.'
        : slide.backgroundFillType === 'gradient'
          ? 'Gradiente configurado para o fundo do slide.'
          : 'Cor sólida configurada para o fundo do slide.'
  }
  if (slideRequireQuizToggle) {
    slideRequireQuizToggle.checked = Boolean(slide.requireQuizCompletion);
  }
}

const updateBackgroundMediaEditorVisibility = (forceOpen = false) => {
  if (!backgroundEditorCard) return;
  const slide = getActiveSlide();
  const shouldStayOpen = forceOpen || currentStageEditor === 'background';
  if (!shouldStayOpen || !slide) {
    if (currentStageEditor === 'background' && !forceOpen) {
      currentStageEditor = 'none';
    }
    backgroundEditorCard.classList.add('hidden');
    updateStageEditorState();
    return;
  }
  currentStageEditor = 'background';
  lastStageEditorOpenedAt = Date.now();
  backgroundEditorCard.classList.remove('hidden');
  normalizeSlideBackgroundFill(slide);
  if (backgroundMediaTypeSelect) {
    backgroundMediaTypeSelect.value = slide.backgroundVideo
      ? slide.backgroundVideoProvider === 'youtube'
        ? 'video-url'
        : (String(slide.backgroundVideo || '').startsWith('data:video/') ? 'video-local' : 'video-url')
      : slide.backgroundImage
        ? (String(slide.backgroundImage || '').startsWith('data:image/') ? 'image-local' : 'image-url')
        : slide.backgroundFillType === 'gradient'
          ? 'color-gradient'
          : 'color-solid';
  }
  if (backgroundMediaUrlInput) {
    backgroundMediaUrlInput.value = slide.backgroundVideo || slide.backgroundImage || '';
  }
  if (backgroundSolidColorInput) {
    backgroundSolidColorInput.value = slide.backgroundColor || '#fdfbff';
  }
  if (backgroundGradientStartInput) {
    backgroundGradientStartInput.value = slide.backgroundGradientStart || '#fdfbff';
  }
  if (backgroundGradientEndInput) {
    backgroundGradientEndInput.value = slide.backgroundGradientEnd || '#dfe7ff';
  }
  if (backgroundMediaEditorStatus) {
    backgroundMediaEditorStatus.textContent = slide.backgroundVideo
      ? 'Vídeo de fundo configurado. O aluno verá o vídeo sem barra de tempo, configurações ou outros controles avançados.'
      : slide.backgroundImage
        ? 'Imagem de fundo configurada para este slide.'
        : slide.backgroundFillType === 'gradient'
          ? 'Gradiente de fundo configurado para este slide.'
          : 'Cor sólida configurada para este slide.';
  }
  updateBackgroundMediaEditorFields();
  requestAnimationFrame(() => positionStageEditorCard('background'));
  updateStageEditorState();
};

const applyBackgroundMediaFromEditor = async (modeOverride = '') => {
  const slide = getActiveSlide();
  const mode = modeOverride || backgroundMediaTypeSelect?.value || 'image-url';
  if (!slide) return;
  try {
    if (mode === 'color-solid') {
      clearSlideBackgroundMedia(slide);
      slide.backgroundFillType = 'solid';
      slide.backgroundColor = backgroundSolidColorInput?.value || '#fdfbff';
    } else if (mode === 'color-gradient') {
      clearSlideBackgroundMedia(slide);
      slide.backgroundFillType = 'gradient';
      slide.backgroundGradientStart = backgroundGradientStartInput?.value || '#fdfbff';
      slide.backgroundGradientEnd = backgroundGradientEndInput?.value || '#dfe7ff';
      slide.backgroundColor = slide.backgroundGradientStart;
    } else if (mode === 'image-url') {
      const src = backgroundMediaUrlInput?.value?.trim();
      if (!src) {
        alert('Informe a URL da imagem.');
        return;
      }
      clearSlideBackgroundMedia(slide);
      slide.backgroundImage = src;
    } else if (mode === 'video-url') {
      const src = backgroundMediaUrlInput?.value?.trim();
      if (!src) {
        alert('Informe a URL do vídeo.');
        return;
      }
      clearSlideBackgroundMedia(slide);
      slide.backgroundVideo = src;
      slide.backgroundVideoEmbedSrc = getYouTubeEmbedUrl(src);
      slide.backgroundVideoProvider = slide.backgroundVideoEmbedSrc ? 'youtube' : 'file';
    } else if (mode === 'image-local') {
      const src = await readLocalFile(localImageInput, 'image');
      if (!src) return;
      clearSlideBackgroundMedia(slide);
      slide.backgroundImage = src;
    } else if (mode === 'video-local') {
      const src = await readLocalFile(localVideoInput, 'video');
      if (!src) return;
      clearSlideBackgroundMedia(slide);
      slide.backgroundVideo = src;
      slide.backgroundVideoProvider = 'file';
    }
    normalizeSlideBackgroundFill(slide);
    renderSlide();
    syncBackgroundInputs(slide);
    updateBackgroundMediaEditorVisibility(true);
    scheduleHistoryCommit();
  } catch (error) {
    alert(error.message || 'Não foi possível configurar a mídia de fundo.');
  }
};

const clearBackgroundMediaFromEditor = () => {
  const slide = getActiveSlide();
  if (!slide) return;
  clearSlideBackgroundMedia(slide);
  renderSlide();
  syncBackgroundInputs(slide);
  updateBackgroundMediaEditorVisibility(true);
  scheduleHistoryCommit();
};

function updateSlideBehavior() {
  const slide = getActiveSlide();
  if (!slide) return;
  slide.requireQuizCompletion = Boolean(slideRequireQuizToggle?.checked);
  commitHistoryState();
}

function updateModuleBehavior() {
  builderState.moduleSettings = {
    ...(builderState.moduleSettings || {}),
    lockNextModuleUntilCompleted: Boolean(moduleLockNextToggle?.checked),
    isPublic: Boolean(modulePublicToggle?.checked)
  };
  syncPublicModuleLinkUi();
  commitHistoryState();
}

const resetBuilder = () => {
  builderState.slides = [];
  builderState.activeSlideId = null;
  builderState.moduleSettings = {
    lockNextModuleUntilCompleted: false,
    isPublic: false
  };
  if (moduleLockNextToggle) {
    moduleLockNextToggle.checked = false;
  }
  if (modulePublicToggle) {
    modulePublicToggle.checked = false;
  }
  syncPublicModuleLinkUi();
  addSlide('Slide 01');
  clearHandleLayer();
};

const renderCourseSelect = () => {
  if (!moduleCourseSelect) return;
  if (!builderCourses.length) {
    moduleCourseSelect.innerHTML = '<option value="">Nenhum curso disponível</option>';
    moduleCourseSelect.disabled = true;
    return;
  }
  moduleCourseSelect.disabled = false;
  moduleCourseSelect.innerHTML = builderCourses
    .map((course) => `<option value="${course.id}">${course.title}</option>`)
    .join('');
};

const showCourseModules = (modules, courseId) => {
  if (!courseModuleList) return;
  if (!modules?.length) {
    courseModuleList.innerHTML = '<p class="muted" style="margin:0;">Nenhum módulo criado para este curso.</p>';
    return;
  }
  courseModuleList.innerHTML = modules
    .map(
      (module) => {
        const isPublicModule = Boolean(module.builder_data?.moduleSettings?.isPublic);
        return `
      <div class="module-list-item" data-course-id="${courseId}" data-module-id="${module.id}">
        <h4>${module.title}</h4>
        <p>${module.description || module.slug}</p>
        ${isPublicModule ? '<small class="muted">Link público liberado para este módulo.</small>' : ''}
        <div class="actions">
          ${
            isPublicModule
              ? `<button type="button" class="secondary-btn small module-public-btn" data-module-id="${module.id}">
            Abrir público
          </button>`
              : ''
          }
          <button type="button" class="secondary-btn small module-edit-btn" data-module-id="${module.id}" data-module-course="${courseId}">
            Editar
          </button>
          <button type="button" class="secondary-btn small module-delete-btn danger" data-module-id="${module.id}" data-module-course="${courseId}">
            Excluir
          </button>
        </div>
      </div>`;
      }
    )
    .join('');
};

const updateSaveButtonLabel = () => {
  if (!saveModuleBtn) return;
  saveModuleBtn.textContent = editingModuleId ? 'Atualizar módulo' : 'Salvar módulo e associar ao curso';
};

const resetEditingState = () => {
  editingModuleId = null;
  editingCourseId = null;
  editingModuleCourseId = null;
  if (moduleTitleInput) {
    moduleTitleInput.value = '';
  }
  if (moduleDescriptionInput) {
    moduleDescriptionInput.value = '';
  }
  if (elementGradientToggle) {
    elementGradientToggle.checked = false;
    updateGradientFieldsVisibility();
  }
  updateSaveButtonLabel();
  if (moduleCourseSelect) {
    moduleCourseSelect.disabled = false;
  }
  syncPublicModuleLinkUi();
};

const startEditingModule = (courseId, moduleId) => {
  const modules = availableCourseModules[courseId] || [];
  const module = modules.find((entry) => entry.id === moduleId);
  if (!module) return;
  editingModuleId = module.id;
  editingCourseId = courseId;
  editingModuleCourseId = courseId;
  if (moduleCourseSelect) {
    moduleCourseSelect.disabled = true;
  }
  moduleCourseSelect.value = courseId;
  moduleTitleInput.value = module.title;
  moduleDescriptionInput.value = module.description || '';
  builderState.slides = JSON.parse(JSON.stringify(module.builder_data?.slides || []));
  builderState.stageSize = module.builder_data?.stageSize || builderState.stageSize;
  builderState.moduleSettings = {
    lockNextModuleUntilCompleted: Boolean(module.builder_data?.moduleSettings?.lockNextModuleUntilCompleted),
    isPublic: Boolean(module.builder_data?.moduleSettings?.isPublic)
  };
  if (moduleLockNextToggle) {
    moduleLockNextToggle.checked = Boolean(builderState.moduleSettings.lockNextModuleUntilCompleted);
  }
  if (modulePublicToggle) {
    modulePublicToggle.checked = Boolean(builderState.moduleSettings.isPublic);
  }
  setPublicModuleLinkState(
    builderState.moduleSettings.isPublic
      ? { moduleId: module.id, title: module.title }
      : {}
  );
  syncPublicModuleLinkUi();
  builderState.activeSlideId = null;
  if (builderState.slides.length) {
    setActiveSlide(builderState.slides[0].id);
  } else {
    resetBuilder();
  }
  updateSaveButtonLabel();
  resetHistoryState();
};

const deleteModule = async (courseId, moduleId) => {
  if (!courseId || !moduleId) return;
  if (!confirm('Excluir este módulo remove permanente do curso. Deseja continuar?')) {
    return;
  }
  try {
    await authorizedFetch(`/api/admin/courses/${courseId}/modules/${moduleId}`, {
      method: 'DELETE'
    });
    availableCourseModules[courseId] = (availableCourseModules[courseId] || []).filter((entry) => entry.id !== moduleId);
    if (editingModuleId === moduleId) {
      resetEditingState();
      resetBuilder();
      resetHistoryState();
    }
    await loadCourseModules(courseId);
  } catch (error) {
    alert(error.message || 'Não foi possível excluir o módulo.');
  }
};

const loadCourseModules = async (courseId) => {
  if (!courseId) {
    if (courseModuleList) {
      courseModuleList.innerHTML = '<p class="muted" style="margin:0;">Selecione um curso para ver os módulos.</p>';
    }
    return;
  }
  try {
    const response = await authorizedFetch(`/api/admin/courses/${courseId}/modules`);
    if (!response.ok) {
      throw new Error('Erro ao carregar os módulos.');
    }
    const modules = await response.json();
    const sortedModules = modules
      .slice()
      .sort((a, b) => {
        const positionDiff = (a.position ?? 0) - (b.position ?? 0);
        if (positionDiff !== 0) return positionDiff;
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateA - dateB;
      });
    availableCourseModules[courseId] = sortedModules;
    showCourseModules(sortedModules, courseId);
  } catch (error) {
    if (courseModuleList) {
      courseModuleList.innerHTML = '<p class="muted" style="margin:0; color:#ff6b6b;">Não foi possível carregar os módulos.</p>';
    }
  }
};

const loadBuilderCourses = async () => {
  if (!moduleCourseSelect) return;
  try {
    const response = await authorizedFetch('/api/admin/courses');
    if (!response.ok) {
      throw new Error('Erro ao carregar cursos.');
    }
    builderCourses = await response.json();
    renderCourseSelect();
    if (builderCourses.length) {
      const selectedCourseId = moduleCourseSelect.value || builderCourses[0].id;
      moduleCourseSelect.value = selectedCourseId;
      loadCourseModules(selectedCourseId);
      return;
    }
    if (courseModuleList) {
      courseModuleList.innerHTML = '<p class="muted" style="margin:0;">Crie um curso para associar módulos.</p>';
    }
  } catch (error) {
    moduleCourseSelect.innerHTML = '<option value="">Erro ao carregar cursos</option>';
    if (courseModuleList) {
      courseModuleList.innerHTML = '<p class="muted" style="margin:0; color:#ff6b6b;">Não foi possível carregar os cursos.</p>';
    }
  }
};

function updateSlideBackground() {
  const slide = getActiveSlide();
  if (!slide) return;
  normalizeSlideBackgroundFill(slide);
  if (slideBgInput) {
    const nextValue = slideBgInput.value.trim();
    if (nextValue || !(slide.backgroundImage || '').startsWith('data:image/')) {
      slide.backgroundImage = nextValue || null;
    }
  }
  renderSlide();
  scheduleHistoryCommit();
}

const chooseSlideBackgroundMedia = async () => {
  updateBackgroundMediaEditorVisibility(true);
};

function updateElementInspector(element) {
  if (
    !selectedElementTypeLabel ||
    !elementWidthInput ||
    !elementHeightInput ||
    !elementRotationInput ||
    !elementLayerInput ||
    !elementTextColorInput ||
    !elementFontSizeInput ||
    !elementFontFamilySelect ||
    !elementFontWeightSelect ||
    !elementBgColorInput
  ) {
    return;
  }
  if (!element) {
    selectedElementTypeLabel.textContent = 'nenhum';
    elementWidthInput.value = '';
    elementHeightInput.value = '';
    elementRotationInput.value = '0';
    elementLayerInput.value = '0';
    if (elementShapeSelect) {
      elementShapeSelect.value = 'rectangle';
    }
    if (elementAnimationTypeSelect) {
      elementAnimationTypeSelect.value = 'none';
    }
    if (elementAnimationDurationInput) {
      elementAnimationDurationInput.value = '1.2';
    }
    if (elementAnimationDelayInput) {
      elementAnimationDelayInput.value = '0';
    }
    if (elementAnimationLoopToggle) {
      elementAnimationLoopToggle.checked = false;
    }
    if (elementGradientToggle) {
      elementGradientToggle.checked = false;
    }
    if (elementSolidColorInput) {
      elementSolidColorInput.value = '#ffffff';
    }
    if (elementGradientStartInput) {
      elementGradientStartInput.value = '#ffef5c';
    }
    if (elementGradientEndInput) {
      elementGradientEndInput.value = '#ff9d5c';
    }
    if (elementTextBorderToggle) {
      elementTextBorderToggle.checked = false;
    }
    if (elementTextBackgroundToggle) {
      elementTextBackgroundToggle.checked = false;
    }
    updateGradientFieldsVisibility();
    elementTextColorInput.value = '#0f142c';
    elementFontSizeInput.value = '24';
    elementFontFamilySelect.value = 'Inter, sans-serif';
    elementFontWeightSelect.value = '400';
    elementBgColorInput.value = '#ffffff';
    if (elementStudentDragToggle) {
      elementStudentDragToggle.checked = false;
    }
    updateTextEditorVisibility(null);
    updateBlockEditorVisibility(null);
    updateImageEditorVisibility(null);
    updateAudioEditorVisibility(null);
    updateQuizEditorVisibility(null);
    updateFloatingButtonEditorVisibility(null);
    updateVideoEditorVisibility(null);
    updateEraserEditorVisibility(null);
    updateAnimationEditorVisibility(null);
    updateSmartSidebarVisibility(null);
    if (removeSelectedElementBtn) {
      removeSelectedElementBtn.disabled = true;
    }
    selectedMotionFrameIndex = -1;
    updateHistoryButtons();
    return;
  }
  selectedElementTypeLabel.textContent = element.type;
  elementWidthInput.value = element.width || '';
  elementHeightInput.value = element.height || '';
  elementRotationInput.value = element.rotation != null ? element.rotation : '';
  elementLayerInput.value = element.zIndex != null ? element.zIndex : 0;
  if (elementShapeSelect) {
    elementShapeSelect.value = element.shape || 'rectangle';
  }
  if (ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    normalizeElementAnimation(element);
  }
  if (elementAnimationTypeSelect) {
    elementAnimationTypeSelect.value = ANIMATABLE_ELEMENT_TYPES.has(element.type) ? element.animationType || 'none' : 'none';
  }
  if (elementAnimationDurationInput) {
    elementAnimationDurationInput.value = String(ANIMATABLE_ELEMENT_TYPES.has(element.type) ? element.animationDuration || 1.2 : 1.2);
  }
  if (elementAnimationDelayInput) {
    elementAnimationDelayInput.value = String(ANIMATABLE_ELEMENT_TYPES.has(element.type) ? element.animationDelay || 0 : 0);
  }
  if (elementAnimationLoopToggle) {
    elementAnimationLoopToggle.checked = ANIMATABLE_ELEMENT_TYPES.has(element.type) ? Boolean(element.animationLoop) : false;
  }
  if (elementGradientToggle) {
    elementGradientToggle.checked = Boolean(element.useGradient);
  }
  if (elementSolidColorInput) {
    elementSolidColorInput.value = element.solidColor || element.backgroundColor || '#ffffff';
  }
  if (elementGradientStartInput) {
    elementGradientStartInput.value = element.gradientStart || '#ffef5c';
  }
  if (elementGradientEndInput) {
    elementGradientEndInput.value = element.gradientEnd || '#ff9d5c';
  }
  if (elementTextBorderToggle) {
    elementTextBorderToggle.checked = Boolean(getTextDecorationFlags(element, { hasTextBackground: false, hasTextBorder: false, hasTextBlock: false }).hasTextBorder);
  }
  if (elementTextBackgroundToggle) {
    elementTextBackgroundToggle.checked = Boolean(getTextDecorationFlags(element, { hasTextBackground: false, hasTextBorder: false, hasTextBlock: false }).hasTextBackground);
  }
  updateGradientFieldsVisibility();
  elementTextColorInput.value = element.textColor || '#0f142c';
  elementFontSizeInput.value = element.fontSize || '';
  elementFontFamilySelect.value = element.fontFamily || 'Inter, sans-serif';
  elementFontWeightSelect.value = element.fontWeight || '400';
  elementBgColorInput.value = element.backgroundColor || '#ffffff';
  if (elementStudentDragToggle) {
    elementStudentDragToggle.checked = Boolean(element.studentCanDrag);
  }
  updateTextEditorVisibility(element);
  updateBlockEditorVisibility(element);
  updateImageEditorVisibility(element);
  updateAudioEditorVisibility(element);
  updateQuizEditorVisibility(element);
  updateFloatingButtonEditorVisibility(element);
  updateVideoEditorVisibility(element);
  updateEraserEditorVisibility(element);
  updateAnimationEditorVisibility(element);
  updateSmartSidebarVisibility(element);
  if (removeSelectedElementBtn) {
    removeSelectedElementBtn.disabled = false;
  }
  selectedMotionFrameIndex = Array.isArray(element.motionFrames) ? Math.min(selectedMotionFrameIndex, element.motionFrames.length - 1) : -1;
  updateHistoryButtons();
}

function selectElement(elementId) {
  selectedElementId = elementId;
  const element = getActiveSlide()?.elements.find((child) => child.id === elementId);
  if (element?.type === 'text') {
    currentStageEditor = 'text';
  } else if (element?.type === 'block') {
    currentStageEditor = 'block';
  } else if (element?.type === 'image') {
    currentStageEditor = 'image';
  } else if (element?.type === 'audio') {
    currentStageEditor = 'audio';
  } else if (element?.type === 'video') {
    currentStageEditor = 'video';
  } else if (currentStageEditor === 'text') {
    currentStageEditor = 'none';
  } else if (currentStageEditor === 'block') {
    currentStageEditor = 'none';
  } else if (currentStageEditor === 'image') {
    currentStageEditor = 'none';
  } else if (currentStageEditor === 'audio') {
    currentStageEditor = 'none';
  } else if (currentStageEditor === 'video') {
    currentStageEditor = 'none';
  }
  updateElementInspector(element || null);
  renderSlide();
}

const removeSelectedElement = () => {
  const slide = getActiveSlide();
  if (!slide || !selectedElementId) {
    alert('Selecione um elemento antes de remover.');
    return;
  }
  slide.elements = slide.elements.filter((child) => child.id !== selectedElementId);
  selectedElementId = null;
  updateElementInspector(null);
  renderSlide();
  commitHistoryState();
};

const updateSelectedElementLayer = (mode) => {
  const slide = getActiveSlide();
  if (!slide || !selectedElementId) {
    return;
  }
  const element = slide.elements.find((child) => child.id === selectedElementId);
  if (!element) {
    return;
  }
  const bounds = getElementLayerBounds(slide);
  const currentLayer = Number(element.zIndex) || 0;
  switch (mode) {
    case 'forward':
      element.zIndex = currentLayer + 1;
      break;
    case 'backward':
      element.zIndex = Math.max(bounds.min - 1, currentLayer - 1);
      break;
    case 'front':
      element.zIndex = bounds.max + 1;
      break;
    case 'back':
      element.zIndex = bounds.min - 1;
      break;
    default:
      return;
  }
  updateElementInspector(element);
  renderSlide();
  commitHistoryState();
};

const syncImageEditor = () => {
  const slide = getActiveSlide();
  if (!slide || !selectedElementId) {
    return;
  }
  const element = slide.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'image') {
    return;
  }
  const widthValue = Number(imageElementWidthInput?.value);
  const heightValue = Number(imageElementHeightInput?.value);
  const rotationValue = Number(imageElementRotationInput?.value);
  if (!Number.isNaN(widthValue) && widthValue > 0) {
    element.width = widthValue;
  }
  if (!Number.isNaN(heightValue) && heightValue > 0) {
    element.height = heightValue;
  }
  if (!Number.isNaN(rotationValue)) {
    element.rotation = ((rotationValue % 360) + 360) % 360;
  }
  element.objectFit = imageElementObjectFitSelect?.value || getElementMediaObjectFit(element);
  element.studentCanDrag = Boolean(imageElementStudentDragToggle?.checked);
  applyStageConstraints(element);
  updateImageEditorVisibility(element, { forceOpen: true });
  renderSlide();
  scheduleHistoryCommit();
};

const replaceSelectedImageSource = async () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'image') {
    return;
  }
  const nextConfig = await chooseMediaConfig('image');
  if (!nextConfig) {
    return;
  }
  element.src = nextConfig.src;
  renderSlide();
  commitHistoryState();
};

const replaceSelectedBlockTexture = async () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'block') {
    return;
  }
  const nextConfig = await chooseMediaConfig('image');
  if (!nextConfig) {
    return;
  }
  element.textureImage = nextConfig.src || '';
  normalizeBlockTexture(element);
  syncBlockEditorControls(element);
  renderSlide();
  commitHistoryState();
};

const clearSelectedBlockTexture = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'block' || !element.textureImage) {
    return;
  }
  element.textureImage = '';
  normalizeBlockTexture(element);
  syncBlockEditorControls(element);
  renderSlide();
  commitHistoryState();
};

const syncAudioEditor = () => {
  const slide = getActiveSlide();
  if (!slide || !selectedElementId) {
    return;
  }
  const element = slide.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'audio') {
    return;
  }
  normalizeAudioElement(element);
  const widthValue = Number(audioElementWidthInput?.value);
  const heightValue = Number(audioElementHeightInput?.value);
  const rotationValue = Number(audioElementRotationInput?.value);
  if (!Number.isNaN(widthValue) && widthValue > 0) {
    element.width = widthValue;
  }
  if (!Number.isNaN(heightValue) && heightValue > 0) {
    element.height = heightValue;
  }
  if (!Number.isNaN(rotationValue)) {
    element.rotation = ((rotationValue % 360) + 360) % 360;
  }
  element.audioVisible = Boolean(audioElementVisibleToggle?.checked);
  element.audioLoop = Boolean(audioElementLoopToggle?.checked);
  applyStageConstraints(element);
  updateAudioEditorVisibility(element, { forceOpen: true });
  renderSlide();
  scheduleHistoryCommit();
};

const replaceSelectedAudioSource = async () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'audio') {
    return;
  }
  const nextConfig = await chooseMediaConfig('audio');
  if (!nextConfig) {
    return;
  }
  element.src = nextConfig.src;
  normalizeAudioElement(element);
  renderSlide();
  commitHistoryState();
};

function applyElementStyles() {
  const slide = getActiveSlide();
  if (!slide || !selectedElementId) {
    return;
  }
  const element = slide.elements.find((child) => child.id === selectedElementId);
  if (!element) return;
  const isBlockEditor = element.type === 'block' && blockEditorCard && !blockEditorCard.classList.contains('hidden');
  const widthSource = isBlockEditor ? blockElementWidthInput : elementWidthInput;
  const heightSource = isBlockEditor ? blockElementHeightInput : elementHeightInput;
  const rotationSource = isBlockEditor ? blockElementRotationInput : elementRotationInput;
  const layerSource = isBlockEditor ? blockElementLayerInput : elementLayerInput;
  const shapeSource = isBlockEditor ? blockElementShapeSelect : elementShapeSelect;
  const gradientToggleSource = isBlockEditor ? blockElementGradientToggle : elementGradientToggle;
  const gradientStartSource = isBlockEditor ? blockElementGradientStartInput : elementGradientStartInput;
  const gradientEndSource = isBlockEditor ? blockElementGradientEndInput : elementGradientEndInput;
  const solidColorSource = isBlockEditor ? blockElementSolidColorInput : elementSolidColorInput;
  const backgroundSource = isBlockEditor ? blockElementSolidColorInput : elementBgColorInput;
  const textColorSource = isBlockEditor ? blockElementTextColorInput : elementTextColorInput;
  const fontSizeSource = isBlockEditor ? blockElementFontSizeInput : elementFontSizeInput;
  const fontFamilySource = isBlockEditor ? blockElementFontFamilySelect : elementFontFamilySelect;
  const fontWeightSource = isBlockEditor ? blockElementFontWeightSelect : elementFontWeightSelect;
  const widthValue = Number(widthSource?.value);
  const heightValue = Number(heightSource?.value);
  if (!Number.isNaN(widthValue) && widthValue > 0) {
    element.width = widthValue;
  }
  if (!Number.isNaN(heightValue) && heightValue > 0) {
    element.height = heightValue;
  }
  if (rotationSource) {
    const rotationValue = Number(rotationSource.value);
    if (!Number.isNaN(rotationValue)) {
      element.rotation = ((rotationValue % 360) + 360) % 360;
    }
  }
  if (layerSource) {
    const layerValue = Number(layerSource.value);
    if (!Number.isNaN(layerValue)) {
      element.zIndex = Math.max(0, Math.round(layerValue));
    }
  }
  if (shapeSource && ['block', 'floatingButton'].includes(element.type) && String(shapeSource.value || '').trim()) {
    element.shape = shapeSource.value || 'rectangle';
  }
  if (gradientToggleSource) {
    if (!isBlockEditor || element.type !== 'block') {
      element.useGradient = Boolean(gradientToggleSource.checked);
      if (element.useGradient) {
        element.gradientStart = gradientStartSource?.value || element.gradientStart;
        element.gradientEnd = gradientEndSource?.value || element.gradientEnd;
      } else {
        element.solidColor = solidColorSource?.value || backgroundSource?.value || element.solidColor;
      }
    }
  }
  if (ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    element.animationType = elementAnimationTypeSelect?.value || 'none';
    element.animationDuration = Number(elementAnimationDurationInput?.value) || 1.2;
    element.animationDelay = Number(elementAnimationDelayInput?.value) || 0;
    element.animationLoop = Boolean(elementAnimationLoopToggle?.checked);
    normalizeElementAnimation(element);
  }
  if (element.type === 'text') {
    element.hasTextBorder = Boolean(elementTextBorderToggle?.checked);
    element.hasTextBackground = Boolean(elementTextBackgroundToggle?.checked);
    element.hasTextBlock = false;
    element.textAlign = textElementTextAlignSelect?.value || element.textAlign || 'left';
  }
  if (!isBlockEditor || element.type !== 'block') {
    element.textColor = textColorSource?.value || element.textColor;
    const fontSizeValue = Number(fontSizeSource?.value);
    if (!Number.isNaN(fontSizeValue) && fontSizeValue > 0) {
      element.fontSize = fontSizeValue;
    }
    element.fontFamily = fontFamilySource?.value || element.fontFamily;
    element.fontWeight = fontWeightSource?.value || element.fontWeight;
  }
  if (['text', 'block', 'floatingButton'].includes(element.type)) {
    if (!isBlockEditor || element.type !== 'block') {
      element.backgroundColor = backgroundSource?.value || element.backgroundColor;
    }
  } else if (element.type === 'image' && String(element.backgroundColor || '').toLowerCase() !== 'transparent') {
    element.backgroundColor = 'transparent';
  }
  if (elementStudentDragToggle && STUDENT_DRAGGABLE_TYPES.has(element.type)) {
    element.studentCanDrag = Boolean(elementStudentDragToggle.checked);
  }
  syncElementBackgroundState(element);
  if (element.type === 'quiz') {
    normalizeQuizElement(element);
  }
  applyStageConstraints(element);
  if (element.type === 'text') {
    syncTextEditorControls(element, { preserveContent: true });
  } else if (element.type === 'block') {
    syncBlockEditorControls(element);
  }
  updateMotionFrameEditorState(element);
  updateSmartSidebarVisibility(element);
  renderSlide();
  scheduleHistoryCommit();
}

const saveModule = async () => {
  if (!moduleCourseSelect) return;
  const courseId = moduleCourseSelect.value;
  const title = moduleTitleInput?.value?.trim();
  if (!courseId || !title) {
    alert('Selecione um curso e informe um título para salvar o módulo.');
    return;
  }
  const slidesCopy = JSON.parse(JSON.stringify(builderState.slides));
  if (!slidesCopy.length) {
    alert('Adicione ao menos um slide antes de salvar o módulo.');
    return;
  }
  const targetCourseId = editingModuleId
    ? editingModuleCourseId || editingCourseId || courseId
    : courseId;
  if (!targetCourseId) {
    alert('Não foi possível determinar o curso alvo.');
    return;
  }
  updateBuilderStageSize();
  const currentStageSize =
    builderState.stageSize.width > 0 && builderState.stageSize.height > 0
      ? builderState.stageSize
      : { ...DEFAULT_STAGE_SIZE };
  const isUpdate = Boolean(editingModuleId);
  const endpoint = isUpdate
    ? `/api/admin/courses/${targetCourseId}/modules/${editingModuleId}`
    : `/api/admin/courses/${targetCourseId}/modules`;
  try {
    const response = await authorizedFetch(endpoint, {
      method: isUpdate ? 'PUT' : 'POST',
      body: JSON.stringify({
        title,
        description: moduleDescriptionInput?.value?.trim() || null,
        slug: createSlug(title),
        builderData: {
          slides: slidesCopy,
          stageSize: currentStageSize,
          moduleSettings: {
            lockNextModuleUntilCompleted: Boolean(builderState.moduleSettings?.lockNextModuleUntilCompleted),
            isPublic: Boolean(builderState.moduleSettings?.isPublic)
          }
        }
      })
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.message || 'Erro ao salvar o módulo.');
    }
    const moduleIsPublic = Boolean(builderState.moduleSettings?.isPublic);
    const responseBody = !isUpdate ? await response.json().catch(() => null) : null;
    const savedModuleId = isUpdate ? editingModuleId : responseBody?.id;
    setPublicModuleLinkState(
      moduleIsPublic && savedModuleId
        ? { moduleId: savedModuleId, title }
        : {}
    );
    syncPublicModuleLinkUi();
    alert(
      isUpdate
        ? `Módulo atualizado com sucesso.${moduleIsPublic ? ' O link público continua disponível na lista de módulos.' : ''}`
        : `Módulo salvo com sucesso.${moduleIsPublic ? ' O link público já está disponível na lista de módulos.' : ''}`
    );
    resetBuilder();
    resetEditingState();
    resetHistoryState();
    loadCourseModules(targetCourseId);
  } catch (error) {
    alert(error.message || 'Não foi possível salvar o módulo.');
  }
};

const addElementToSlide = (config) => {
  const slide = getActiveSlide();
  if (!slide) return;
  const element = {
    id: createId('element'),
    type: config.type,
    x: config.x || 50,
    y: config.y || 60,
    width: config.width,
    height: config.height,
    rotation: 0,
    zIndex: config.zIndex ?? getNextLayerIndex(slide),
    ...config
  };
  if (!element.textColor) {
    element.textColor = element.type === 'floatingButton' ? '#ffffff' : '#0f142c';
  }
  if (element.type === 'block' && !element.backgroundColor) {
    element.backgroundColor = '#f4f6ff';
    element.solidColor = '#f4f6ff';
  }
  if (element.type === 'floatingButton' && !element.backgroundColor) {
    element.backgroundColor = '#6d63ff';
    element.solidColor = '#6d63ff';
  }
  if (element.type === 'detector') {
    normalizeFloatingActionConfig(element);
    element.backgroundColor = 'transparent';
  }
  if (['block', 'floatingButton'].includes(element.type) && !element.shape) {
    element.shape = 'rectangle';
  }
  if (element.type === 'quiz') {
    normalizeQuizElement(element);
  }
  if (element.type === 'floatingButton') {
    normalizeFloatingActionConfig(element);
  }
  if (ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    normalizeElementAnimation(element);
  }
  if (element.type === 'block') {
    normalizeBlockTexture(element);
  }
  syncElementBackgroundState(element);
  ensureElementHasUsableSize(element);
  slide.elements.push(element);
  applyStageConstraints(element);
  selectElement(element.id);
  renderSlide();
  commitHistoryState();
};

const addElementToSpecificSlide = (slideId, config) => {
  const slide = builderState.slides.find((entry) => entry.id === slideId);
  if (!slide) {
    throw new Error(`Slide alvo não encontrado: ${slideId}`);
  }
  const element = {
    id: config.id || createId('element'),
    type: config.type,
    x: config.x || 50,
    y: config.y || 60,
    width: config.width,
    height: config.height,
    rotation: Number.isFinite(Number(config.rotation)) ? Number(config.rotation) : 0,
    zIndex: config.zIndex ?? getNextLayerIndex(slide),
    ...config
  };
  if (!element.textColor) {
    element.textColor = element.type === 'floatingButton' ? '#ffffff' : '#0f142c';
  }
  if (element.type === 'block' && !element.backgroundColor) {
    element.backgroundColor = '#f4f6ff';
    element.solidColor = '#f4f6ff';
  }
  if (element.type === 'floatingButton' && !element.backgroundColor) {
    element.backgroundColor = '#6d63ff';
    element.solidColor = '#6d63ff';
  }
  if (element.type === 'detector') {
    normalizeFloatingActionConfig(element);
    element.backgroundColor = 'transparent';
  }
  if (element.type === 'quiz') {
    normalizeQuizElement(element);
  }
  if (element.type === 'floatingButton') {
    normalizeFloatingActionConfig(element);
  }
  if (ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    normalizeElementAnimation(element);
  }
  syncElementBackgroundState(element);
  ensureElementHasUsableSize(element);
  applyStageConstraints(element);
  slide.elements.push(element);
  return element;
};

const copySelectedElementToClipboard = () => {
  const slide = getActiveSlide();
  const element = slide?.elements.find((child) => child.id === selectedElementId);
  if (!element) {
    updateHistoryButtons();
    return false;
  }
  clipboardState.element = deepClone(element);
  updateHistoryButtons();
  return true;
};

const pasteClipboardElement = () => {
  const slide = getActiveSlide();
  if (!slide || !clipboardState.element) {
    updateHistoryButtons();
    return false;
  }
  const source = deepClone(clipboardState.element);
  const pastedElement = addElementToSpecificSlide(slide.id, {
    ...source,
    id: createId('element'),
    x: (Number(source.x) || 0) + 24,
    y: (Number(source.y) || 0) + 24,
    zIndex: getNextLayerIndex(slide)
  });
  selectElement(pastedElement.id);
  renderSlide();
  commitHistoryState();
  updateHistoryButtons();
  return true;
};

const moveSelectedElementByKeyboard = (deltaX, deltaY) => {
  if (previewState.active || !selectedElementId) {
    return false;
  }
  const slide = getActiveSlide();
  const element = slide?.elements.find((child) => child.id === selectedElementId);
  if (!element) {
    return false;
  }
  const step = syncKeyboardMoveStepInput();
  const previousX = Number(element.x) || 0;
  const previousY = Number(element.y) || 0;
  element.x = previousX + deltaX * step;
  element.y = previousY + deltaY * step;
  applyStageConstraints(element);
  if (element.x === previousX && element.y === previousY) {
    return false;
  }
  renderSlide();
  updateElementInspector(element);
  scheduleHistoryCommit();
  return true;
};

const updateElementFromPatch = (element, patch) => {
  Object.assign(element, patch);
  if (['block', 'floatingButton'].includes(element.type)) {
    if (patch.backgroundColor && !patch.solidColor && !patch.useGradient) {
      element.solidColor = patch.backgroundColor;
    }
    if (patch.solidColor && !patch.backgroundColor && !patch.useGradient) {
      element.backgroundColor = patch.solidColor;
    }
    if (patch.useGradient && patch.gradientStart && !patch.gradientEnd) {
      element.gradientEnd = patch.gradientStart;
    }
    if (patch.useGradient && patch.gradientEnd && !patch.gradientStart) {
      element.gradientStart = patch.gradientEnd;
    }
  }
  if (element.type === 'quiz') {
    normalizeQuizElement(element);
  }
  if (element.type === 'floatingButton') {
    normalizeFloatingActionConfig(element);
  }
  if (ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    normalizeElementAnimation(element);
  }
  if (element.type === 'block') {
    normalizeBlockTexture(element);
  }
  if (element.type === 'text') {
    element.hasTextBlock = Boolean(element.hasTextBackground || element.hasTextBorder || element.hasTextBlock);
  }
  syncElementBackgroundState(element);
  ensureElementHasUsableSize(element);
  applyStageConstraints(element);
};

const getFallbackAiSlideTarget = (requestedSlideId) => {
  const existingSlides = builderState.slides || [];
  if (!existingSlides.length) {
    return null;
  }
  const directMatch = existingSlides.find((entry) => entry.id === requestedSlideId);
  if (directMatch) {
    return directMatch;
  }
  if (existingSlides.length === 1) {
    return existingSlides[0];
  }
  const activeSlide = existingSlides.find((entry) => entry.id === builderState.activeSlideId);
  return activeSlide || existingSlides[0];
};

const inferElementTypeFromAiId = (elementId = '') => {
  const value = String(elementId || '').toLowerCase();
  if (value.includes('bloco') || value.includes('block')) return 'block';
  if (value.includes('texto') || value.includes('text')) return 'text';
  if (value.includes('title') || value.includes('titulo') || value.includes('subtitle') || value.includes('subtitulo')) return 'text';
  if (value.includes('botao') || value.includes('botão') || value.includes('button')) return 'floatingButton';
  if (value.includes('quiz')) return 'quiz';
  if (value.includes('imagem') || value.includes('image')) return 'image';
  if (value.includes('video')) return 'video';
  if (value.includes('audio')) return 'audio';
  return '';
};

const inferElementTypeFromAiPatch = (patch = {}, fallbackId = '') => {
  if (patch?.type) {
    return patch.type;
  }
  const inferredFromId = inferElementTypeFromAiId(patch?.id || fallbackId);
  if (inferredFromId) {
    return inferredFromId;
  }
  if (Array.isArray(patch?.options) || typeof patch?.question === 'string') {
    return 'quiz';
  }
  if (typeof patch?.src === 'string' && patch.src) {
    if (typeof patch?.provider === 'string' || typeof patch?.embedSrc === 'string') {
      return 'video';
    }
    return 'image';
  }
  if (typeof patch?.label === 'string' && patch.label) {
    return 'floatingButton';
  }
  if (typeof patch?.content === 'string' && patch.content) {
    return 'text';
  }
  return '';
};

const getFallbackAiElementTarget = (slide, action) => {
  if (!slide?.elements?.length) {
    return null;
  }
  const exact = slide.elements.find((entry) => entry.id === action.elementId);
  if (exact) {
    return exact;
  }
  const inferredType = action.element?.type || inferElementTypeFromAiId(action.elementId);
  const sameType = inferredType ? slide.elements.filter((entry) => entry.type === inferredType) : [];
  if (sameType.length === 1) {
    return sameType[0];
  }
  if (slide.elements.length === 1) {
    return slide.elements[0];
  }
  return null;
};

const applyAiActions = (actions) => {
  if (!Array.isArray(actions) || !actions.length) {
    return { appliedCount: 0, warnings: [] };
  }
  let nextSelectedElementId = selectedElementId;
  let nextActiveSlideId = builderState.activeSlideId;
  const applyWarnings = [];
  let appliedCount = 0;
  const slideAliasMap = new Map();
  const elementAliasMap = new Map();
  const resolveSlideAlias = (slideId = '') => slideAliasMap.get(slideId) || slideId;
  const resolveElementAlias = (elementId = '') => elementAliasMap.get(elementId) || elementId;

  actions.forEach((action, index) => {
    if (action.slideId) {
      action.slideId = resolveSlideAlias(action.slideId);
    }
    if (action.afterSlideId) {
      action.afterSlideId = resolveSlideAlias(action.afterSlideId);
    }
    if (action.elementId) {
      action.elementId = resolveElementAlias(action.elementId);
    }
    if (action.element?.actionConfig?.targetSlideId) {
      action.element.actionConfig.targetSlideId = resolveSlideAlias(action.element.actionConfig.targetSlideId);
    }
    if (action.element?.actionConfig?.targetElementId) {
      action.element.actionConfig.targetElementId = resolveElementAlias(action.element.actionConfig.targetElementId);
    }
    switch (action.type) {
      case 'add_slide': {
        const originalSlideId = action.slide?.id || '';
        const slide = {
          id: originalSlideId || createId('slide'),
          title: action.slide?.title || `Slide ${builderState.slides.length + 1}`,
          elements: [],
          backgroundImage: action.slide?.backgroundImage || null,
          backgroundColor: action.slide?.backgroundColor || '#fdfbff'
        };
        insertSlideAfter(slide, action.afterSlideId);
        if (originalSlideId) {
          slideAliasMap.set(originalSlideId, slide.id);
        }
        if (action.setActive !== false) {
          nextActiveSlideId = slide.id;
        }
        appliedCount += 1;
        break;
      }
      case 'update_slide': {
        const slide = getFallbackAiSlideTarget(action.slideId);
        if (!slide || !action.slide) {
          applyWarnings.push(`Ação ${index + 1}: não encontrei o slide para update_slide (${action.slideId || 'sem slideId'}).`);
          break;
        }
        const slidePatch = { ...action.slide };
        delete slidePatch.id;
        Object.assign(slide, slidePatch);
        if (action.setActive !== false) {
          nextActiveSlideId = slide.id;
        }
        appliedCount += 1;
        break;
      }
      case 'delete_slide': {
        if (builderState.slides.length <= 1) break;
        const index = builderState.slides.findIndex((entry) => entry.id === action.slideId);
        if (index === -1) break;
        builderState.slides.splice(index, 1);
        if (nextActiveSlideId === action.slideId) {
          nextActiveSlideId = builderState.slides[index]?.id || builderState.slides[index - 1]?.id || builderState.slides[0]?.id || null;
        }
        break;
      }
      case 'add_element': {
        const originalElementId = action.element?.id || action.elementId || '';
        const inferredType = inferElementTypeFromAiPatch(action.element, originalElementId);
        if (action.element && !action.element.type && inferredType) {
          action.element.type = inferredType;
        }
        if (!action.element?.type) {
          applyWarnings.push(`Ação ${index + 1}: add_element sem tipo de elemento.`);
          break;
        }
        const targetSlide = getFallbackAiSlideTarget(action.slideId);
        if (!targetSlide) {
          applyWarnings.push(`Ação ${index + 1}: não encontrei o slide para add_element (${action.slideId || 'sem slideId'}).`);
          break;
        }
        const created = addElementToSpecificSlide(targetSlide.id, action.element);
        action.slideId = targetSlide.id;
        action.elementId = created.id;
        if (originalElementId) {
          elementAliasMap.set(originalElementId, created.id);
        }
        action.element = {
          ...action.element,
          id: created.id,
          width: created.width,
          height: created.height,
          backgroundColor: created.backgroundColor,
          solidColor: created.solidColor,
          useGradient: created.useGradient,
          gradientStart: created.gradientStart,
          gradientEnd: created.gradientEnd
        };
        if (action.setActive !== false) {
          nextActiveSlideId = targetSlide.id;
          nextSelectedElementId = created.id;
        }
        appliedCount += 1;
        break;
      }
      case 'update_element': {
        const slide = getFallbackAiSlideTarget(action.slideId);
        const element = getFallbackAiElementTarget(slide, action);
        if (!element || !action.element) {
          applyWarnings.push(`Ação ${index + 1}: não encontrei o elemento para update_element (${action.elementId || 'sem elementId'}).`);
          break;
        }
        action.slideId = slide.id;
        action.elementId = element.id;
        updateElementFromPatch(element, action.element);
        action.element = {
          ...action.element,
          id: element.id,
          width: element.width,
          height: element.height,
          backgroundColor: element.backgroundColor,
          solidColor: element.solidColor,
          useGradient: element.useGradient,
          gradientStart: element.gradientStart,
          gradientEnd: element.gradientEnd
        };
        if (action.setActive !== false) {
          nextActiveSlideId = slide.id;
          nextSelectedElementId = element.id;
        }
        appliedCount += 1;
        break;
      }
      case 'delete_element': {
        const slide = getFallbackAiSlideTarget(action.slideId);
        if (!slide?.elements?.length) {
          applyWarnings.push(`Ação ${index + 1}: não encontrei o slide/elementos para delete_element (${action.slideId || 'sem slideId'}).`);
          break;
        }
        const targetElement = getFallbackAiElementTarget(slide, action);
        if (!targetElement) {
          applyWarnings.push(`Ação ${index + 1}: não encontrei o elemento para delete_element (${action.elementId || 'sem elementId'}).`);
          break;
        }
        slide.elements = slide.elements.filter((entry) => entry.id !== targetElement.id);
        if (nextSelectedElementId === targetElement.id) {
          nextSelectedElementId = null;
        }
        appliedCount += 1;
        break;
      }
      case 'select_element': {
        nextActiveSlideId = action.slideId || nextActiveSlideId;
        nextSelectedElementId = action.elementId || null;
        appliedCount += 1;
        break;
      }
      default:
        break;
    }
  });

  builderState.activeSlideId = nextActiveSlideId || builderState.slides[0]?.id || null;
  selectedElementId = nextSelectedElementId;
  renderSlideList();
  renderSlide();
  updateElementInspector(getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null);
  commitHistoryState();
  return { appliedCount, warnings: applyWarnings };
};

const requestAiSlideActions = async () => {
  const request = aiAssistantPromptInput?.value?.trim();
  if (!request) {
    alert('Descreva o que a IA deve fazer no criador.');
    return;
  }
  if (!aiAssistantState.settings?.connected || !aiAssistantState.settings?.isEnabled) {
    alert('Configure a integração de IA no painel admin antes de usar o assistente.');
    return;
  }
  if (aiAssistantState.pendingActions.length) {
    const shouldReplace = confirm('Já existe uma proposta pendente. Deseja apagar as ações atuais e gerar uma nova proposta?');
    if (!shouldReplace) {
      updateAiAssistantStatus('A proposta pendente foi mantida. Aplique ou descarte antes de gerar outra.', 'muted');
      return;
    }
  }
  startAiAssistantLoading('Gerando proposta completa');
  try {
    await requestAiBulkProposal(request);
  } catch (error) {
    pushAiAssistantFeedback('Erro da IA', error.message || 'Falha ao gerar a proposta.', 'error');
    updateAiAssistantStatus(error.message || 'Não foi possível gerar a proposta.', 'error');
  } finally {
    stopAiAssistantLoading();
  }
};

const applyPendingAiActions = () => {
  if (!aiAssistantState.pendingActions.length) {
    updateAiAssistantStatus('Nenhuma proposta pendente para aplicar.');
    return;
  }
  const actionsToApply = aiAssistantState.pendingActions.map((action) => JSON.parse(JSON.stringify(action)));
  try {
    const applyResult = applyAiActions(actionsToApply);
    actionsToApply.forEach((action) => rememberAiAction(action));
    if (applyResult.warnings.length) {
      pushAiAssistantFeedback(
        'Proposta aplicada com alertas',
        `${applyResult.appliedCount} alterações foram aplicadas. Alertas:\n${applyResult.warnings.join('\n')}`,
        'error'
      );
      updateAiAssistantStatus(`${applyResult.appliedCount} alterações aplicadas com alertas.`, 'error');
      alert(applyResult.warnings.join('\n'));
    } else {
      pushAiAssistantFeedback('Proposta aplicada', `${applyResult.appliedCount} alterações foram aplicadas ao editor.`, 'success');
      updateAiAssistantStatus(`${applyResult.appliedCount} alterações aplicadas com sucesso.`, 'success');
    }
    aiAssistantState.pendingActions = [];
    renderAiAssistantActions();
  } catch (error) {
    pushAiAssistantFeedback('Falha ao aplicar', error.message || 'A proposta não pôde ser aplicada no editor.', 'error');
    updateAiAssistantStatus(error.message || 'A proposta não pôde ser aplicada.', 'error');
    alert(error.message || 'A proposta não pôde ser aplicada no editor.');
  }
};

const addLocalImageToSlide = (src) => {
  if (!src) return;
  addElementToSlide({
    type: 'image',
    src,
    width: 280,
    height: 180
  });
};

const buildVideoElementConfig = (src, width = 320, height = 190) => {
  const embedSrc = getYouTubeEmbedUrl(src);
  return {
    type: 'video',
    src,
    width,
    height,
    ...(embedSrc ? { provider: 'youtube', embedSrc } : {})
  };
};

const chooseMediaConfig = async (type) => {
  const source = chooseMediaSource(
    type === 'image' ? 'a imagem' : type === 'audio' ? 'o áudio' : 'o vídeo'
  );
  if (!source) return null;
  if (source === 'local') {
    try {
      if (type === 'image') {
        const src = await readLocalFile(localImageInput, 'image');
        return src ? { type: 'image', src, width: 280, height: 180 } : null;
      }
      if (type === 'audio') {
        const src = await readLocalFile(localAudioInput, 'audio');
        return src ? { type: 'audio', src, width: 260, height: 70 } : null;
      }
      const src = await readLocalFile(localVideoInput, 'video');
      return src ? buildVideoElementConfig(src) : null;
    } catch (error) {
      alert(error.message || 'Não foi possível carregar o arquivo escolhido.');
      return null;
    }
  }
  if (type === 'image') {
    const imageUrl = promptValue(
      'Cole a URL da imagem',
      'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=640&q=80'
    );
    return imageUrl ? { type: 'image', src: imageUrl, width: 280, height: 180 } : null;
  }
  if (type === 'audio') {
    const audioUrl = promptValue(
      'Cole a URL do áudio',
      'https://cdn.pixabay.com/download/audio/2021/11/16/audio_e8ccb2ec5b.mp3?filename=calm-ambient-111408.mp3'
    );
    return audioUrl ? { type: 'audio', src: audioUrl, width: 260, height: 70 } : null;
  }
  const videoUrl = promptValue(
    'Cole a URL do vídeo ou do YouTube',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
  return videoUrl ? buildVideoElementConfig(videoUrl) : null;
};

const handleElementCreation = async (type) => {
  if (type === 'eraser') {
    const selectedElement = getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null;
    if (!selectedElement || !canUseEraserOnElement(selectedElement)) {
      alert('Selecione uma imagem ou bloco antes de usar a borracha.');
      return;
    }
    await openEraserEditorForElement(selectedElement);
    return;
  }
  if (type === 'animation') {
    const selectedElement = getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null;
    if (!selectedElement || !ANIMATABLE_ELEMENT_TYPES.has(selectedElement.type)) {
      alert('Selecione um texto, bloco, botão flutuante ou imagem para aplicar uma animação.');
      return;
    }
    normalizeElementAnimation(selectedElement);
    selectedElement.animationType = selectedElement.animationType !== 'none' ? selectedElement.animationType : 'fade-in';
    selectedMotionFrameIndex = Array.isArray(selectedElement.motionFrames) ? selectedElement.motionFrames.length - 1 : -1;
    updateElementInspector(selectedElement);
    updateAnimationEditorVisibility(selectedElement, { forceOpen: true });
    renderSlide();
    scheduleHistoryCommit();
    return;
  }
  let config = { type };
  switch (type) {
    case 'text': {
      currentStageEditor = 'text';
      config.content = 'Bem-vindo à aula';
      config.width = 260;
      config.height = 120;
      config.hasTextBackground = false;
      config.hasTextBorder = false;
      config.hasTextBlock = false;
      config.fontSize = 24;
      config.fontFamily = 'Inter, sans-serif';
      config.fontWeight = '400';
      config.textAlign = 'left';
      break;
    }
    case 'block': {
      currentStageEditor = 'block';
      config.content = 'Novo bloco';
      config.x = 180;
      config.y = 180;
      config.width = 260;
      config.height = 150;
      config.shape = 'rectangle';
      config.useGradient = false;
      config.solidColor = '#f4f6ff';
      config.gradientStart = '#ffd54f';
      config.gradientEnd = '#ffb74d';
      config.textureImage = '';
      config.textureFit = 'cover';
      config.fontSize = 18;
      config.fontFamily = 'Inter, sans-serif';
      config.fontWeight = '500';
      break;
    }
    case 'image':
    case 'audio':
    case 'video':
      config = await chooseMediaConfig(type);
      if (!config) return;
      break;
    case 'quiz': {
      config.question = 'Qual alternativa está correta?';
      config.options = createDefaultQuizOptions();
      config.correctOption = 0;
      config.successMessage = 'Resposta correta!';
      config.errorMessage = 'Resposta incorreta. Tente novamente.';
      config.actionLabel = 'Validar resposta';
      config.quizBackgroundColor = '#ffffff';
      config.quizQuestionColor = '#171934';
      config.quizOptionBackgroundColor = '#f4f6ff';
      config.quizOptionTextColor = '#25284c';
      config.quizButtonBackgroundColor = '#6d63ff';
      config.points = 1;
      config.lockOnWrong = false;
      config.width = 420;
      config.height = 280;
      config.fontSize = 18;
      config.fontFamily = 'Inter, sans-serif';
      config.fontWeight = '500';
      config.backgroundColor = '#ffffff';
      break;
    }
    case 'floatingButton': {
      const label = promptValue('Texto do botão flutuante', 'Explorar agora');
      if (label === null) return;
      config.label = label;
      config.shape = 'rectangle';
      config.width = 170;
      config.height = 60;
      config.fontSize = 18;
      config.fontFamily = 'Inter, sans-serif';
      config.fontWeight = '700';
      config.actionConfig = {
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
        quizQuestion: 'Nova pergunta',
        quizOptions: createDefaultQuizOptions(),
        quizCorrectOption: 0
      };
      break;
    }
    case 'detector': {
      config.width = 180;
      config.height = 120;
      config.x = 240;
      config.y = 220;
      config.actionConfig = {
        type: 'none',
        targetSlideId: '',
        targetElementId: '',
        text: 'Novo texto',
        url: '',
        insertX: 120,
        insertY: 120,
        insertWidth: 280,
        insertHeight: 180,
        moveByX: 160,
        moveByY: 0,
        moveDuration: 0.8,
        videoTime: 0,
        quizQuestion: 'Nova pergunta',
        quizOptions: createDefaultQuizOptions(),
        quizCorrectOption: 0,
        requireAllButtonsInGroup: false,
        ruleGroup: ''
      };
      break;
    }
    default:
      return;
  }
  addElementToSlide(config);
};

const promptValue = (message, defaultValue = '') => {
  const response = prompt(message, defaultValue);
  if (response === null) {
    return null;
  }
  return response.trim() || defaultValue;
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

const createQuizNode = (element) => {
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
      feedbackNode.textContent = 'Selecione uma resposta.';
      feedbackNode.className = 'builder-quiz-feedback error';
      return;
    }
    const isCorrect = Number(selected.value) === Number(element.correctOption);
    feedbackNode.textContent = isCorrect ? element.successMessage : element.errorMessage;
    feedbackNode.className = `builder-quiz-feedback ${isCorrect ? 'success' : 'error'}`;
    if (isCorrect) {
      playCorrectAnswerSound();
    } else {
      playWrongAnswerSound();
    }
  });
  return node;
};

const createPreviewElementNode = (element, slide) => {
  const renderState = getElementRenderState(element);
  const preservedElapsedSeconds = getPreviewAnimationElapsed(slide, element);
  let node;
  if (isPreviewElementHidden(slide?.id, element?.id)) {
    return document.createComment(`hidden-${element?.id || 'element'}`);
  }
  switch (element.type) {
    case 'text':
      node = document.createElement('div');
      node.className = 'builder-text-element';
      node.innerHTML = renderPlainTextHtml(element.content || '');
      node.style.textAlign = element.textAlign || 'left';
      {
        const textFlags = getTextDecorationFlags(element, { hasTextBackground: false, hasTextBorder: false, hasTextBlock: false });
        node.classList.toggle('builder-text-background', Boolean(textFlags.hasTextBackground));
        node.classList.toggle('builder-text-border', Boolean(textFlags.hasTextBorder));
        if (textFlags.hasTextBackground && element.backgroundColor) {
          node.style.background = element.backgroundColor;
          node.style.backgroundColor = element.backgroundColor;
        } else {
          node.style.background = 'transparent';
          node.style.backgroundColor = 'transparent';
        }
      }
      break;
    case 'block':
      node = document.createElement('div');
      node.className = 'builder-block-element';
      node.innerHTML = renderPlainTextHtml(element.content || '');
      applyElementBackground(node, element);
      node.style.borderColor = 'transparent';
      applyShapeStyles(node, element.shape || 'rectangle');
      break;
    case 'image':
      node = document.createElement('img');
      node.className = 'builder-media-element';
      node.src = element.src || '';
      node.alt = 'Imagem interativa';
      node.style.background = 'transparent';
      node.style.boxShadow = 'none';
      node.style.objectFit = getElementMediaObjectFit(element);
      node.classList.toggle('is-background-removal-loading', removingBackgroundElementId === element.id);
      node.addEventListener('error', () => {
        if (node.dataset.fallbackApplied === 'true') return;
        node.dataset.fallbackApplied = 'true';
        node.src = IMAGE_FALLBACK_SRC;
      });
      break;
    case 'audio':
      node = document.createElement('audio');
      node.className = 'builder-media-element';
      node.src = element.src || '';
      applyPreviewAudioPresentation(node, element);
      break;
    case 'video':
      node = document.createElement('video');
      node.className = 'builder-media-element';
      node.controls = true;
      node.src = element.src || '';
      attachPreviewVideoTimedTrigger(node, element);
      break;
    case 'quiz':
      node = createQuizNode(element);
      node.style.background = element.quizBackgroundColor;
      node.style.backgroundColor = element.quizBackgroundColor;
      break;
    case 'floatingButton':
      node = document.createElement('button');
      node.className = 'floating-button-element';
      node.textContent = element.label || 'Ação';
      applyElementBackground(node, element);
      applyShapeStyles(node, element.shape || 'rectangle');
      {
        const config = element.actionConfig || {};
        const ruleGroup = String(config.ruleGroup || '').trim();
        const stateKey = getPreviewRuleStateKey(slide.id, ruleGroup);
        const clickedIds = previewState.clickedRuleButtons.get(stateKey) || new Set();
        if (clickedIds.has(element.id)) {
          node.classList.add('floating-button-completed');
        }
      }
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        executePreviewFloatingButtonAction(element);
      });
      break;
    case 'detector':
      node = document.createElement('div');
      node.className = 'detector-element detector-element-preview';
      node.setAttribute('aria-hidden', 'true');
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
  if (renderState.width) node.style.width = `${renderState.width}px`;
  if (renderState.height) node.style.height = `${renderState.height}px`;
  if (element.textColor) node.style.color = element.textColor;
  if (element.fontSize) node.style.fontSize = `${element.fontSize}px`;
  if (element.fontFamily) node.style.fontFamily = element.fontFamily;
  if (element.fontWeight) node.style.fontWeight = element.fontWeight;
  applyElementAnimationStyles(node, element, { preservedElapsedSeconds });
  enablePreviewStudentDrag(node, element, slide);
  return node;
};

const renderElementNode = (element) => {
  let node;
  switch (element.type) {
    case 'text':
      node = document.createElement('div');
      node.className = 'builder-text-element';
      node.innerHTML = renderPlainTextHtml(element.content || '');
      node.style.textAlign = element.textAlign || 'left';
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
      node.style.borderColor = 'transparent';
      applyShapeStyles(node, element.shape || 'rectangle');
      break;
    case 'image':
      node = document.createElement('img');
      node.className = 'builder-media-element';
      node.src = element.src || '';
      node.alt = 'Imagem da aula interativa';
      node.style.background = 'transparent';
      node.style.boxShadow = 'none';
      node.style.objectFit = getElementMediaObjectFit(element);
      node.classList.toggle('is-background-removal-loading', removingBackgroundElementId === element.id);
      node.addEventListener('error', () => {
        if (node.dataset.fallbackApplied === 'true') {
          return;
        }
        node.dataset.fallbackApplied = 'true';
        node.src = IMAGE_FALLBACK_SRC;
      });
      break;
    case 'audio':
      node = document.createElement('audio');
      node.className = 'builder-media-element';
      node.src = element.src || '';
      applyPreviewAudioPresentation(node, element, { authoring: true });
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
        node = document.createElement('video');
        node.className = 'builder-media-element';
        node.controls = true;
        node.src = element.src || '';
        attachPreviewVideoTimedTrigger(node, element);
      }
      break;
    case 'quiz':
      node = createQuizNode(element);
      node.style.background = element.quizBackgroundColor;
      node.style.backgroundColor = element.quizBackgroundColor;
      break;
    case 'floatingButton':
      node = document.createElement('button');
      node.className = 'floating-button-element';
      node.textContent = element.label || 'Ação';
      applyElementBackground(node, element);
      applyShapeStyles(node, element.shape || 'rectangle');
      break;
    case 'detector':
      node = document.createElement('div');
      node.className = 'detector-element';
      node.textContent = 'Detector';
      break;
    default:
      node = document.createElement('div');
      node.textContent = element.content || 'Elemento';
  }
  node.dataset.elementId = element.id;
  node.classList.toggle('eraser-source-hidden', eraserState.active && eraserState.elementId === element.id);
  node.style.position = 'absolute';
  node.style.left = `${element.x}px`;
  node.style.top = `${element.y}px`;
  node.style.zIndex = String(element.zIndex ?? 0);
  if (element.width) {
    node.style.width = typeof element.width === 'number' ? `${element.width}px` : element.width;
  }
  if (element.height) {
    node.style.height = typeof element.height === 'number' ? `${element.height}px` : element.height;
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
  if (element.backgroundColor) {
    if (['floatingButton', 'block'].includes(element.type)) {
      applyElementBackground(node, element);
    } else if (element.type === 'text') {
      if (getTextDecorationFlags(element, { hasTextBackground: false, hasTextBorder: false, hasTextBlock: false }).hasTextBackground) {
        node.style.background = element.backgroundColor;
        node.style.backgroundColor = element.backgroundColor;
      }
    } else if (!['block', 'image', 'quiz'].includes(element.type)) {
      node.style.backgroundColor = element.backgroundColor;
    }
  }
  applyElementAnimationStyles(node, element);
  node.style.cursor = 'grab';
  node.style.touchAction = 'none';
  node.style.userSelect = 'none';
  enableDrag(node, element);
  node.classList.toggle('element-active', selectedElementId === element.id);
  node.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isPickingFloatingTargetElement) {
      const triggerElement = getSelectedActionTriggerElement();
      const candidateIds = getFloatingTargetCandidateIds(triggerElement?.actionConfig?.type || 'none', triggerElement);
      if (candidateIds.has(element.id)) {
        if (floatingTargetElementSelect) {
          floatingTargetElementSelect.value = element.id;
        }
        isPickingFloatingTargetElement = false;
        syncFloatingButtonEditor();
      }
      return;
    }
    selectElement(element.id);
  });
  node.addEventListener('dblclick', () => handleElementEdit(element));
  return node;
};

const handleElementEdit = async (element) => {
  switch (element.type) {
    case 'text':
      currentStageEditor = 'text';
      updateTextEditorVisibility(element, { forceOpen: true });
      return;
    case 'block': {
      currentStageEditor = 'block';
      updateBlockEditorVisibility(element, { forceOpen: true });
      requestAnimationFrame(() => {
        blockElementContentInput?.focus();
        blockElementContentInput?.select?.();
      });
      return;
    }
    case 'image':
    case 'audio':
    case 'video': {
      if (element.type === 'image') {
        currentStageEditor = 'image';
        updateImageEditorVisibility(element, { forceOpen: true });
        return;
      }
      if (element.type === 'audio') {
        currentStageEditor = 'audio';
        updateAudioEditorVisibility(element, { forceOpen: true });
        return;
      }
      if (element.type === 'video') {
        currentStageEditor = 'video';
        updateVideoEditorVisibility(element, { forceOpen: true });
        return;
      }
      const nextConfig = await chooseMediaConfig(element.type);
      if (!nextConfig) return;
      element.src = nextConfig.src;
      break;
    }
    case 'floatingButton': {
      const edited = promptValue('Atualize o texto do elemento', element.label);
      if (edited === null) return;
      element.label = edited;
      break;
    }
    case 'detector':
      currentStageEditor = 'floating';
      updateFloatingButtonEditorVisibility(element);
      return;
    case 'quiz':
      updateQuizEditorVisibility(element);
      return;
    default:
      return;
  }
  renderSlide();
  commitHistoryState();
};

const enableDrag = (node, element) => {
  let offsetX = 0;
  let offsetY = 0;
  let pointerId;
  const updateNodePosition = () => {
    applyStageConstraints(element);
    node.style.left = `${element.x}px`;
    node.style.top = `${element.y}px`;
  };
  const startDrag = (event) => {
    event.preventDefault();
    pointerId = event.pointerId;
    const pointer = getStagePointerPosition(event);
    offsetX = pointer.x - (element.x || 0);
    offsetY = pointer.y - (element.y || 0);
    node.setPointerCapture(pointerId);
    node.style.cursor = 'grabbing';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  };
  const onMove = (event) => {
    event.preventDefault();
    const pointer = getStagePointerPosition(event);
    element.x = pointer.x - offsetX;
    element.y = pointer.y - offsetY;
    updateElementInspector(element);
    updateNodePosition();
  };
  const endDrag = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    if (pointerId !== undefined) {
      node.releasePointerCapture(pointerId);
      pointerId = undefined;
    }
    node.style.cursor = 'grab';
    commitHistoryState();
  };
  node.addEventListener('pointerdown', startDrag);
};

const clearCurrentSlide = () => {
  const slide = getActiveSlide();
  if (!slide) return;
  const hasContentToClear =
    Boolean(slide.elements?.length) ||
    Boolean(slide.backgroundImage) ||
    Boolean(slide.backgroundVideo) ||
    Boolean(slide.requireQuizCompletion) ||
    slide.backgroundFillType === 'gradient' ||
    (slide.backgroundColor && String(slide.backgroundColor).trim().toLowerCase() !== '#fdfbff');
  if (!hasContentToClear) return;
  if (!confirm('Limpar este slide remove todos os elementos. Deseja continuar?')) {
    return;
  }
  slide.elements = [];
  clearSlideBackgroundMedia(slide);
  slide.backgroundFillType = 'solid';
  slide.backgroundColor = '#fdfbff';
  slide.backgroundGradientStart = '#fdfbff';
  slide.backgroundGradientEnd = '#dfe7ff';
  slide.requireQuizCompletion = false;
  selectedElementId = null;
  aiAssistantState.pendingActions = [];
  aiAssistantState.debugInfo = null;
  updateElementInspector(null);
  renderAiAssistantActions();
  renderAiAssistantDebug();
  renderSlide();
  commitHistoryState();
};

const removeCurrentSlide = () => {
  if (builderState.slides.length <= 1) {
    alert('Deixe pelo menos um slide para continuar.');
    return;
  }
  const index = builderState.slides.findIndex((slide) => slide.id === builderState.activeSlideId);
  if (index === -1) return;
  builderState.slides.splice(index, 1);
  const nextSlide = builderState.slides[index] || builderState.slides[index - 1];
  if (nextSlide) {
    setActiveSlide(nextSlide.id);
  }
  commitHistoryState();
};

document.addEventListener('DOMContentLoaded', () => {
  const token = getToken();
  const role = localStorage.getItem(USER_ROLE_KEY);
  if (!token || role !== 'admin') {
    window.location.href = 'login.html';
    return;
  }
  slideList = document.getElementById('slideList');
  builderMain = document.querySelector('.builder-main');
  builderPanel = document.getElementById('builderPanel');
  builderPanelToggleBtn = document.getElementById('builderPanelToggleBtn');
  slideCanvas = document.getElementById('slideCanvas');
  slideCanvasViewport = document.getElementById('slideCanvasViewport');
  slideName = document.getElementById('slideName');
  previewStageBtn = document.getElementById('previewStageBtn');
  moduleCourseSelect = document.getElementById('moduleCourseSelect');
  moduleTitleInput = document.getElementById('moduleTitleInput');
  moduleDescriptionInput = document.getElementById('moduleDescriptionInput');
  moduleLockNextToggle = document.getElementById('moduleLockNextToggle');
  modulePublicToggle = document.getElementById('modulePublicToggle');
  modulePublicLinkInput = document.getElementById('modulePublicLinkInput');
  copyPublicModuleLinkBtn = document.getElementById('copyPublicModuleLinkBtn');
  openPublicModuleLinkBtn = document.getElementById('openPublicModuleLinkBtn');
  modulePublicLinkStatus = document.getElementById('modulePublicLinkStatus');
  saveModuleBtn = document.getElementById('saveModuleBtn');
  exportTemplateBtn = document.getElementById('exportTemplateBtn');
  importTemplateBtn = document.getElementById('importTemplateBtn');
  templateImportInput = document.getElementById('templateImportInput');
  templateStoreCard = document.getElementById('templateStoreCard');
  templateStoreList = document.getElementById('templateStoreList');
  templateStoreSearchInput = document.getElementById('templateStoreSearchInput');
  refreshTemplateStoreBtn = document.getElementById('refreshTemplateStoreBtn');
  templateStoreStatus = document.getElementById('templateStoreStatus');
  courseModuleList = document.getElementById('courseModuleList');
  courseModuleCard = document.getElementById('courseModuleCard');
  slideBgInput = document.getElementById('slideBgInput');
  slideBgUploadBtn = document.getElementById('slideBgUploadBtn');
  slideBgStatus = document.getElementById('slideBgStatus');
  stageBgColorInput = document.getElementById('stageBgColorInput');
  slideRequireQuizToggle = document.getElementById('slideRequireQuizToggle');
  selectedElementTypeLabel = document.getElementById('selectedElementType');
  elementWidthInput = document.getElementById('elementWidthInput');
  elementHeightInput = document.getElementById('elementHeightInput');
  elementRotationInput = document.getElementById('elementRotationInput');
  elementLayerInput = document.getElementById('elementLayerInput');
  elementTextColorInput = document.getElementById('elementTextColorInput');
  elementFontSizeInput = document.getElementById('elementFontSizeInput');
  elementFontFamilySelect = document.getElementById('elementFontFamilySelect');
  elementFontWeightSelect = document.getElementById('elementFontWeightSelect');
  elementBgColorInput = document.getElementById('elementBgColorInput');
  elementStudentDragToggle = document.getElementById('elementStudentDragToggle');
  removeImageBackgroundBtn = document.getElementById('removeImageBackgroundBtn');
  elementAnimationTypeSelect = document.getElementById('elementAnimationTypeSelect');
  elementAnimationDurationInput = document.getElementById('elementAnimationDurationInput');
  elementAnimationDelayInput = document.getElementById('elementAnimationDelayInput');
  elementAnimationLoopToggle = document.getElementById('elementAnimationLoopToggle');
  elementShapeSelect = document.getElementById('elementShapeSelect');
  elementGradientToggle = document.getElementById('elementGradientToggle');
  elementSolidColorInput = document.getElementById('elementSolidColorInput');
  elementGradientStartInput = document.getElementById('elementGradientStartInput');
  elementGradientEndInput = document.getElementById('elementGradientEndInput');
  elementTextBackgroundToggle = document.getElementById('elementTextBackgroundToggle');
  elementTextBorderToggle = document.getElementById('elementTextBorderToggle');
  centerTextStageBtn = document.getElementById('centerTextStageBtn');
  centerTextBlockBtn = document.getElementById('centerTextBlockBtn');
  gradientFields = Array.from(document.querySelectorAll('.gradient-colors'));
  resetEditorBtn = document.getElementById('resetEditorBtn');
  localImageInput = document.getElementById('localImageInput');
  localAudioInput = document.getElementById('localAudioInput');
  localVideoInput = document.getElementById('localVideoInput');
  removeSelectedElementBtn = document.getElementById('removeSelectedElementBtn');
  undoActionBtn = document.getElementById('undoActionBtn');
  copyActionBtn = document.getElementById('copyActionBtn');
  pasteActionBtn = document.getElementById('pasteActionBtn');
  redoActionBtn = document.getElementById('redoActionBtn');
  keyboardMoveStepInput = document.getElementById('keyboardMoveStepInput');
  stageEditorDock = document.getElementById('stageEditorDock');
  stageEditorEmpty = document.getElementById('stageEditorEmpty');
  textEditorCard = document.getElementById('textEditorCard');
  blockEditorCard = document.getElementById('blockEditorCard');
  imageEditorCard = document.getElementById('imageEditorCard');
  quizEditorCard = document.getElementById('quizEditorCard');
  audioEditorCard = document.getElementById('audioEditorCard');
  backgroundEditorCard = document.getElementById('backgroundEditorCard');
  videoEditorCard = document.getElementById('videoEditorCard');
  backgroundMediaTypeSelect = document.getElementById('backgroundMediaTypeSelect');
  backgroundSolidColorInput = document.getElementById('backgroundSolidColorInput');
  backgroundGradientStartInput = document.getElementById('backgroundGradientStartInput');
  backgroundGradientEndInput = document.getElementById('backgroundGradientEndInput');
  backgroundMediaUrlInput = document.getElementById('backgroundMediaUrlInput');
  backgroundMediaLocalBtn = document.getElementById('backgroundMediaLocalBtn');
  backgroundMediaApplyBtn = document.getElementById('backgroundMediaApplyBtn');
  backgroundMediaClearBtn = document.getElementById('backgroundMediaClearBtn');
  backgroundMediaEditorStatus = document.getElementById('backgroundMediaEditorStatus');
  animationEditorCard = document.getElementById('animationEditorCard');
  textElementContentInput = document.getElementById('textElementContentInput');
  textElementWidthInput = document.getElementById('textElementWidthInput');
  textElementHeightInput = document.getElementById('textElementHeightInput');
  textElementTextColorInput = document.getElementById('textElementTextColorInput');
  textElementFontSizeInput = document.getElementById('textElementFontSizeInput');
  textElementFontFamilySelect = document.getElementById('textElementFontFamilySelect');
  textElementFontWeightSelect = document.getElementById('textElementFontWeightSelect');
  textElementTextAlignSelect = document.getElementById('textElementTextAlignSelect');
  textElementBgColorInput = document.getElementById('textElementBgColorInput');
  textElementBackgroundToggle = document.getElementById('textElementBackgroundToggle');
  textElementBorderToggle = document.getElementById('textElementBorderToggle');
  textElementCenterStageBtn = document.getElementById('textElementCenterStageBtn');
  textElementCenterBlockBtn = document.getElementById('textElementCenterBlockBtn');
  blockElementContentInput = document.getElementById('blockElementContentInput');
  blockElementWidthInput = document.getElementById('blockElementWidthInput');
  blockElementHeightInput = document.getElementById('blockElementHeightInput');
  blockElementRotationInput = document.getElementById('blockElementRotationInput');
  blockElementLayerInput = document.getElementById('blockElementLayerInput');
  blockElementShapeSelect = document.getElementById('blockElementShapeSelect');
  blockElementGradientToggle = document.getElementById('blockElementGradientToggle');
  blockElementSolidColorInput = document.getElementById('blockElementSolidColorInput');
  blockElementGradientStartInput = document.getElementById('blockElementGradientStartInput');
  blockElementGradientEndInput = document.getElementById('blockElementGradientEndInput');
  blockElementTextColorInput = document.getElementById('blockElementTextColorInput');
  blockElementFontSizeInput = document.getElementById('blockElementFontSizeInput');
  blockElementFontFamilySelect = document.getElementById('blockElementFontFamilySelect');
  blockElementFontWeightSelect = document.getElementById('blockElementFontWeightSelect');
  blockElementTextureFitSelect = document.getElementById('blockElementTextureFitSelect');
  blockAttachTextureBtn = document.getElementById('blockAttachTextureBtn');
  blockClearTextureBtn = document.getElementById('blockClearTextureBtn');
  imageElementWidthInput = document.getElementById('imageElementWidthInput');
  imageElementHeightInput = document.getElementById('imageElementHeightInput');
  imageElementRotationInput = document.getElementById('imageElementRotationInput');
  imageElementObjectFitSelect = document.getElementById('imageElementObjectFitSelect');
  imageElementStudentDragToggle = document.getElementById('imageElementStudentDragToggle');
  imageReplaceSourceBtn = document.getElementById('imageReplaceSourceBtn');
  quizQuestionInput = document.getElementById('quizQuestionInput');
  quizOptionsInput = document.getElementById('quizOptionsInput');
  quizCorrectAnswerSelect = document.getElementById('quizCorrectAnswerSelect');
  quizSuccessMessageInput = document.getElementById('quizSuccessMessageInput');
  quizErrorMessageInput = document.getElementById('quizErrorMessageInput');
  quizActionLabelInput = document.getElementById('quizActionLabelInput');
  quizBackgroundColorInput = document.getElementById('quizBackgroundColorInput');
  quizQuestionColorInput = document.getElementById('quizQuestionColorInput');
  quizOptionBackgroundColorInput = document.getElementById('quizOptionBackgroundColorInput');
  quizOptionTextColorInput = document.getElementById('quizOptionTextColorInput');
  quizButtonBackgroundColorInput = document.getElementById('quizButtonBackgroundColorInput');
  quizPointsInput = document.getElementById('quizPointsInput');
  quizLockOnWrongToggle = document.getElementById('quizLockOnWrongToggle');
  floatingButtonEditorCard = document.getElementById('floatingButtonEditorCard');
  floatingEditorBadge = document.getElementById('floatingEditorBadge');
  floatingEditorTitle = document.getElementById('floatingEditorTitle');
  eraserEditorCard = document.getElementById('eraserEditorCard');
  eraserModeSelect = document.getElementById('eraserModeSelect');
  eraserShapeSelect = document.getElementById('eraserShapeSelect');
  eraserSizeInput = document.getElementById('eraserSizeInput');
  eraserSizeNumberInput = document.getElementById('eraserSizeNumberInput');
  eraserClosePathBtn = document.getElementById('eraserClosePathBtn');
  eraserClearBtn = document.getElementById('eraserClearBtn');
  eraserApplyBtn = document.getElementById('eraserApplyBtn');
  addMotionFrameBtn = document.getElementById('addMotionFrameBtn');
  updateMotionFrameBtn = document.getElementById('updateMotionFrameBtn');
  removeMotionFrameBtn = document.getElementById('removeMotionFrameBtn');
  clearMotionFramesBtn = document.getElementById('clearMotionFramesBtn');
  elementMotionFrameList = document.getElementById('elementMotionFrameList');
  floatingActionTypeSelect = document.getElementById('floatingActionTypeSelect');
  floatingTargetSlideSelect = document.getElementById('floatingTargetSlideSelect');
  floatingTargetElementSelect = document.getElementById('floatingTargetElementSelect');
  floatingPickTargetElementBtn = document.getElementById('floatingPickTargetElementBtn');
  floatingRequireAllToggle = document.getElementById('floatingRequireAllToggle');
  floatingRuleGroupInput = document.getElementById('floatingRuleGroupInput');
  floatingActionTextLabel = document.getElementById('floatingActionTextLabel');
  floatingDetectorAcceptedSelect = document.getElementById('floatingDetectorAcceptedSelect');
  floatingDetectorMinCountInput = document.getElementById('floatingDetectorMinCountInput');
  floatingDetectorTriggerOnceToggle = document.getElementById('floatingDetectorTriggerOnceToggle');
  floatingActionTextInput = document.getElementById('floatingActionTextInput');
  floatingReplaceModeSelect = document.getElementById('floatingReplaceModeSelect');
  floatingReplaceCounterStartInput = document.getElementById('floatingReplaceCounterStartInput');
  floatingReplaceCounterStepInput = document.getElementById('floatingReplaceCounterStepInput');
  floatingActionUrlInput = document.getElementById('floatingActionUrlInput');
  floatingAudioVisibleToggle = document.getElementById('floatingAudioVisibleToggle');
  floatingAudioLoopToggle = document.getElementById('floatingAudioLoopToggle');
  floatingTextColorInput = document.getElementById('floatingTextColorInput');
  floatingTextBgColorInput = document.getElementById('floatingTextBgColorInput');
  floatingTextFontSizeInput = document.getElementById('floatingTextFontSizeInput');
  floatingTextFontFamilySelect = document.getElementById('floatingTextFontFamilySelect');
  floatingTextFontWeightSelect = document.getElementById('floatingTextFontWeightSelect');
  floatingTextAlignSelect = document.getElementById('floatingTextAlignSelect');
  floatingTextBackgroundToggle = document.getElementById('floatingTextBackgroundToggle');
  floatingTextBorderToggle = document.getElementById('floatingTextBorderToggle');
  floatingInsertXInput = document.getElementById('floatingInsertXInput');
  floatingInsertYInput = document.getElementById('floatingInsertYInput');
  floatingInsertWidthInput = document.getElementById('floatingInsertWidthInput');
  floatingInsertHeightInput = document.getElementById('floatingInsertHeightInput');
  floatingMoveXInput = document.getElementById('floatingMoveXInput');
  floatingMoveYInput = document.getElementById('floatingMoveYInput');
  floatingMoveDurationInput = document.getElementById('floatingMoveDurationInput');
  floatingVideoTimeInput = document.getElementById('floatingVideoTimeInput');
  floatingPickPlacementBtn = document.getElementById('floatingPickPlacementBtn');
  floatingPlacementHint = document.getElementById('floatingPlacementHint');
  floatingQuizQuestionInput = document.getElementById('floatingQuizQuestionInput');
  floatingQuizOptionsInput = document.getElementById('floatingQuizOptionsInput');
  floatingQuizCorrectSelect = document.getElementById('floatingQuizCorrectSelect');
  floatingQuizSuccessInput = document.getElementById('floatingQuizSuccessInput');
  floatingQuizErrorInput = document.getElementById('floatingQuizErrorInput');
  floatingQuizActionLabelInput = document.getElementById('floatingQuizActionLabelInput');
  floatingQuizBackgroundColorInput = document.getElementById('floatingQuizBackgroundColorInput');
  floatingQuizQuestionColorInput = document.getElementById('floatingQuizQuestionColorInput');
  floatingQuizOptionBackgroundColorInput = document.getElementById('floatingQuizOptionBackgroundColorInput');
  floatingQuizOptionTextColorInput = document.getElementById('floatingQuizOptionTextColorInput');
  floatingQuizButtonBackgroundColorInput = document.getElementById('floatingQuizButtonBackgroundColorInput');
  floatingQuizPointsInput = document.getElementById('floatingQuizPointsInput');
  floatingQuizLockOnWrongToggle = document.getElementById('floatingQuizLockOnWrongToggle');
  videoTriggerTimeInput = document.getElementById('videoTriggerTimeInput');
  videoTriggerActionSelect = document.getElementById('videoTriggerActionSelect');
  videoTriggerSeekTimeInput = document.getElementById('videoTriggerSeekTimeInput');
  videoTriggerTargetElementSelect = document.getElementById('videoTriggerTargetElementSelect');
  audioElementWidthInput = document.getElementById('audioElementWidthInput');
  audioElementHeightInput = document.getElementById('audioElementHeightInput');
  audioElementRotationInput = document.getElementById('audioElementRotationInput');
  audioElementVisibleToggle = document.getElementById('audioElementVisibleToggle');
  audioElementLoopToggle = document.getElementById('audioElementLoopToggle');
  audioReplaceSourceBtn = document.getElementById('audioReplaceSourceBtn');
  layerBringForwardBtn = document.getElementById('layerBringForwardBtn');
  layerSendBackwardBtn = document.getElementById('layerSendBackwardBtn');
  layerBringToFrontBtn = document.getElementById('layerBringToFrontBtn');
  layerSendToBackBtn = document.getElementById('layerSendToBackBtn');
  aiAssistantStatus = document.getElementById('aiAssistantStatus');
  aiAssistantPromptInput = document.getElementById('aiAssistantPrompt');
  aiAssistantFeedback = document.getElementById('aiAssistantFeedback');
  aiAssistantGenerateBtn = document.getElementById('aiAssistantGenerateBtn');
  aiAssistantApplyBtn = document.getElementById('aiAssistantApplyBtn');
  aiAssistantDiscardBtn = document.getElementById('aiAssistantDiscardBtn');
  aiAssistantActions = document.getElementById('aiAssistantActions');
  aiAssistantDebugOutput = document.getElementById('aiAssistantDebugOutput');
  aiProposalHistoryList = document.getElementById('aiProposalHistoryList');
  aiAssistantUseReferenceBtn = document.getElementById('aiAssistantUseReferenceBtn');
  aiAssistantAttachImageBtn = document.getElementById('aiAssistantAttachImageBtn');
  aiAssistantClearImageBtn = document.getElementById('aiAssistantClearImageBtn');
  aiAssistantAttachmentPreview = document.getElementById('aiAssistantAttachmentPreview');
  aiAssistantImageInput = document.getElementById('aiAssistantImageInput');
  aiReferenceCard = document.getElementById('aiReferenceCard');
  [textEditorCard, blockEditorCard, imageEditorCard, quizEditorCard, audioEditorCard, floatingButtonEditorCard, videoEditorCard, backgroundEditorCard, eraserEditorCard, animationEditorCard].forEach(enableStageEditorDragging);
  document.querySelectorAll('.logout-btn').forEach((button) => button.addEventListener('click', handleLogout));
  builderPanelToggleBtn?.addEventListener('click', toggleBuilderPanel);
  document.getElementById('addSlideBtn').addEventListener('click', () => addSlide(`Slide ${builderState.slides.length + 1}`));
  document.getElementById('removeSlideBtn').addEventListener('click', removeCurrentSlide);
  document.getElementById('clearStageBtn').addEventListener('click', clearCurrentSlide);
  previewStageBtn?.addEventListener('click', toggleStudentPreview);
  slideList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-slide-id]');
    if (!button) return;
    setActiveSlide(button.dataset.slideId);
  });
  slideList.addEventListener('dblclick', (event) => {
    const button = event.target.closest('button[data-slide-id]');
    if (!button) return;
    const targetSlide = builderState.slides.find((slide) => slide.id === button.dataset.slideId);
    if (!targetSlide) return;
    const nextTitle = prompt('Digite o novo nome do slide', targetSlide.title);
    if (nextTitle === null) return;
    targetSlide.title = nextTitle.trim() || targetSlide.title;
    renderSlideList();
    renderSlide();
    commitHistoryState();
  });
  document.querySelector('.stage-toolbar-menu-main').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-element]');
    if (!button) return;
    handleElementCreation(button.dataset.element);
  });
  courseModuleCard?.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('#courseModuleList')) {
      return;
    }
    toggleCourseModuleCard();
  });
  courseModuleCard?.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target)) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleCourseModuleCard();
    }
  });
  templateStoreList?.addEventListener('click', (event) => {
    const applyButton = event.target.closest('.template-store-apply-btn');
    if (applyButton) {
      applyTemplateFromStore(applyButton.dataset.templateKey);
    }
  });
  courseModuleList?.addEventListener('click', (event) => {
    const publicButton = event.target.closest('.module-public-btn');
    if (publicButton) {
      openPublicModuleViewer(publicButton.dataset.moduleId);
      return;
    }
    const button = event.target.closest('.module-edit-btn');
    if (button) {
      startEditingModule(button.dataset.moduleCourse, button.dataset.moduleId);
      return;
    }
    const deleteButton = event.target.closest('.module-delete-btn');
    if (deleteButton) {
      deleteModule(deleteButton.dataset.moduleCourse, deleteButton.dataset.moduleId);
    }
  });
  moduleCourseSelect?.addEventListener('change', (event) => {
    resetEditingState();
    resetBuilder();
    loadCourseModules(event.target.value);
    resetHistoryState();
  });
  saveModuleBtn?.addEventListener('click', saveModule);
  copyPublicModuleLinkBtn?.addEventListener('click', copyPublicModuleLink);
  openPublicModuleLinkBtn?.addEventListener('click', () => {
    if (lastPublicModuleLink?.moduleId) {
      openPublicModuleViewer(lastPublicModuleLink.moduleId);
    }
  });
  exportTemplateBtn?.addEventListener('click', exportCurrentTemplate);
  importTemplateBtn?.addEventListener('click', () => templateImportInput?.click());
  refreshTemplateStoreBtn?.addEventListener('click', () => loadTemplateStore());
  templateStoreSearchInput?.addEventListener('input', renderTemplateStoreList);
  templateImportInput?.addEventListener('change', async (event) => {
    const [file] = Array.from(event.target.files || []);
    try {
      await importTemplateFromFile(file);
    } catch (error) {
      alert(error.message || 'Não foi possível importar o template.');
    } finally {
      event.target.value = '';
    }
  });
  moduleTitleInput?.addEventListener('input', scheduleHistoryCommit);
  moduleDescriptionInput?.addEventListener('input', scheduleHistoryCommit);
  moduleLockNextToggle?.addEventListener('change', updateModuleBehavior);
  modulePublicToggle?.addEventListener('change', updateModuleBehavior);
  syncPublicModuleLinkUi();
  slideBgInput?.addEventListener('input', updateSlideBackground);
  slideBgUploadBtn?.addEventListener('click', chooseSlideBackgroundMedia);
  backgroundMediaTypeSelect?.addEventListener('change', () => updateBackgroundMediaEditorFields());
  backgroundMediaLocalBtn?.addEventListener('click', () => applyBackgroundMediaFromEditor(backgroundMediaTypeSelect?.value || 'image-local'));
  backgroundMediaApplyBtn?.addEventListener('click', () => applyBackgroundMediaFromEditor());
  backgroundMediaClearBtn?.addEventListener('click', clearBackgroundMediaFromEditor);
  backgroundSolidColorInput?.addEventListener('input', () => {
    if ((backgroundMediaTypeSelect?.value || '') === 'color-solid') {
      applyBackgroundMediaFromEditor('color-solid');
    }
  });
  backgroundGradientStartInput?.addEventListener('input', () => {
    if ((backgroundMediaTypeSelect?.value || '') === 'color-gradient') {
      applyBackgroundMediaFromEditor('color-gradient');
    }
  });
  backgroundGradientEndInput?.addEventListener('input', () => {
    if ((backgroundMediaTypeSelect?.value || '') === 'color-gradient') {
      applyBackgroundMediaFromEditor('color-gradient');
    }
  });
  slideName?.addEventListener('click', () => {
    if (previewState.active) return;
    const slide = getActiveSlide();
    if (!slide) return;
    const nextTitle = prompt('Digite o novo nome do slide', slide.title);
    if (nextTitle === null) return;
    slide.title = nextTitle.trim() || slide.title;
    renderSlideList();
    renderSlide();
    commitHistoryState();
  });
  slideRequireQuizToggle?.addEventListener('change', updateSlideBehavior);
  elementAnimationTypeSelect?.addEventListener('change', applyElementStyles);
  elementAnimationDurationInput?.addEventListener('input', applyElementStyles);
  elementAnimationDelayInput?.addEventListener('input', applyElementStyles);
  elementAnimationLoopToggle?.addEventListener('change', applyElementStyles);
  elementGradientToggle?.addEventListener('change', updateGradientFieldsVisibility);
  removeSelectedElementBtn?.addEventListener('click', removeSelectedElement);
  undoActionBtn?.addEventListener('click', undoLastAction);
  copyActionBtn?.addEventListener('click', copySelectedElementToClipboard);
  pasteActionBtn?.addEventListener('click', pasteClipboardElement);
  redoActionBtn?.addEventListener('click', redoLastAction);
  keyboardMoveStepInput?.addEventListener('input', syncKeyboardMoveStepInput);
  addMotionFrameBtn?.addEventListener('click', addCurrentMotionFrame);
  updateMotionFrameBtn?.addEventListener('click', updateSelectedMotionFrame);
  removeMotionFrameBtn?.addEventListener('click', removeSelectedMotionFrame);
  clearMotionFramesBtn?.addEventListener('click', clearAllMotionFrames);
  elementMotionFrameList?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest('[data-motion-frame-index]');
    if (!button) {
      return;
    }
    selectMotionFrameForEditing(Number(button.dataset.motionFrameIndex));
  });
  layerBringForwardBtn?.addEventListener('click', () => updateSelectedElementLayer('forward'));
  layerSendBackwardBtn?.addEventListener('click', () => updateSelectedElementLayer('backward'));
  layerBringToFrontBtn?.addEventListener('click', () => updateSelectedElementLayer('front'));
  layerSendToBackBtn?.addEventListener('click', () => updateSelectedElementLayer('back'));
  removeImageBackgroundBtn?.addEventListener('click', removeBackgroundFromSelectedImage);
  imageReplaceSourceBtn?.addEventListener('click', replaceSelectedImageSource);
  blockAttachTextureBtn?.addEventListener('click', replaceSelectedBlockTexture);
  blockClearTextureBtn?.addEventListener('click', clearSelectedBlockTexture);
  audioReplaceSourceBtn?.addEventListener('click', replaceSelectedAudioSource);
  centerTextStageBtn?.addEventListener('click', () => centerSelectedText('stage'));
  centerTextBlockBtn?.addEventListener('click', () => centerSelectedText('block'));
  const syncTextEditor = () => {
    const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
    if (!element || element.type !== 'text') {
      return;
    }
    element.content = textElementContentInput?.value ?? element.content;
    if (elementWidthInput && textElementWidthInput) elementWidthInput.value = textElementWidthInput.value;
    if (elementHeightInput && textElementHeightInput) elementHeightInput.value = textElementHeightInput.value;
    if (elementTextColorInput && textElementTextColorInput) elementTextColorInput.value = textElementTextColorInput.value;
    if (elementFontSizeInput && textElementFontSizeInput) elementFontSizeInput.value = textElementFontSizeInput.value;
    if (elementFontFamilySelect && textElementFontFamilySelect) elementFontFamilySelect.value = textElementFontFamilySelect.value;
    if (elementFontWeightSelect && textElementFontWeightSelect) elementFontWeightSelect.value = textElementFontWeightSelect.value;
    element.textAlign = textElementTextAlignSelect?.value || element.textAlign || 'left';
    if (elementBgColorInput && textElementBgColorInput) elementBgColorInput.value = textElementBgColorInput.value;
    if (elementTextBackgroundToggle && textElementBackgroundToggle) elementTextBackgroundToggle.checked = textElementBackgroundToggle.checked;
    if (elementTextBorderToggle && textElementBorderToggle) elementTextBorderToggle.checked = textElementBorderToggle.checked;
    applyElementStyles();
    syncTextEditorControls(element, { preserveContent: true });
  };
  [
    textElementContentInput,
    textElementWidthInput,
    textElementHeightInput,
    textElementTextColorInput,
    textElementFontSizeInput,
    textElementFontFamilySelect,
    textElementFontWeightSelect,
    textElementTextAlignSelect,
    textElementBgColorInput
  ].forEach((field) => field?.addEventListener('input', syncTextEditor));
  [textElementBackgroundToggle, textElementBorderToggle].forEach((field) => field?.addEventListener('change', syncTextEditor));
  [
    blockElementContentInput,
    blockElementWidthInput,
    blockElementHeightInput,
    blockElementRotationInput,
    blockElementLayerInput,
    blockElementShapeSelect,
    blockElementGradientToggle,
    blockElementSolidColorInput,
    blockElementGradientStartInput,
    blockElementGradientEndInput,
    blockElementTextColorInput,
    blockElementFontSizeInput,
    blockElementFontFamilySelect,
    blockElementFontWeightSelect,
    blockElementTextureFitSelect
  ].forEach((field) => {
    field?.addEventListener('input', syncBlockEditor);
    field?.addEventListener('change', syncBlockEditor);
  });
  textElementCenterStageBtn?.addEventListener('click', () => {
    centerSelectedText('stage');
    const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
    syncTextEditorControls(element || null);
  });
  textElementCenterBlockBtn?.addEventListener('click', () => {
    centerSelectedText('block');
    const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
    syncTextEditorControls(element || null);
  });
  resetEditorBtn?.addEventListener('click', () => {
    resetBuilder();
    resetEditingState();
    resetHistoryState();
  });
  aiAssistantGenerateBtn?.addEventListener('click', requestAiSlideActions);
  aiAssistantApplyBtn?.addEventListener('click', applyPendingAiActions);
  aiAssistantDiscardBtn?.addEventListener('click', () => {
    aiAssistantState.stopRequested = true;
    clearAiAssistantProposal();
    updateAiAssistantStatus('Geração interrompida e proposta descartada.');
  });
  aiAssistantAttachImageBtn?.addEventListener('click', async () => {
    try {
      await attachImageToAiAssistant();
    } catch (error) {
      alert(error.message || 'Não foi possível anexar a imagem.');
    }
  });
  aiAssistantClearImageBtn?.addEventListener('click', clearAiAssistantAttachments);
  aiReferenceCard?.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('#aiAssistantUseReferenceBtn')) {
      return;
    }
    toggleAiReferenceCard();
  });
  aiReferenceCard?.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target)) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleAiReferenceCard();
    }
  });
  document.querySelectorAll('.stage-editor-close').forEach((button) =>
    button.addEventListener('click', closeStageEditors)
  );
  aiAssistantUseReferenceBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!aiAssistantPromptInput) return;
    aiAssistantPromptInput.value = AI_REFERENCE_PROMPT;
    aiAssistantPromptInput.focus();
    pushAiAssistantFeedback('Referência carregada', 'O pedido de exemplo foi preenchido para você ajustar como quiser.', 'success');
  });
  aiProposalHistoryList?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest('button[data-ai-history-id]');
    if (!button) {
      return;
    }
    const entry = aiAssistantState.proposalHistory.find((item) => item.id === button.dataset.aiHistoryId);
    const historyAction = button.dataset.aiHistoryAction || '';
    if (historyAction === 'delete') {
      const wasDeleted = deleteAiProposalHistoryEntry(button.dataset.aiHistoryId);
      if (wasDeleted) {
        updateAiAssistantStatus('Proposta removida do histórico.', 'success');
      }
      return;
    }
    if (!entry) {
      return;
    }
    if (historyAction === 'reuse-prompt') {
      if (aiAssistantPromptInput) {
        aiAssistantPromptInput.value = entry.prompt || '';
        aiAssistantPromptInput.focus();
      }
      updateAiAssistantStatus('Prompt carregado novamente no assistente.', 'success');
      return;
    }
    if (historyAction === 'load') {
      aiAssistantState.pendingActions = Array.isArray(entry.actions)
        ? entry.actions.map((action) => JSON.parse(JSON.stringify(action)))
        : [];
      aiAssistantState.lastPrompt = entry.prompt || '';
      aiAssistantState.debugInfo = {
        request: entry.prompt || '',
        returnedActionCount: aiAssistantState.pendingActions.length,
        actions: aiAssistantState.pendingActions,
        source: 'history-load'
      };
      renderAiAssistantActions();
      renderAiAssistantDebug();
      updateAiAssistantStatus(`Proposta carregada do histórico com ${aiAssistantState.pendingActions.length} alterações.`, 'success');
      return;
    }
    if (historyAction === 'apply') {
      aiAssistantState.pendingActions = Array.isArray(entry.actions)
        ? entry.actions.map((action) => JSON.parse(JSON.stringify(action)))
        : [];
      aiAssistantState.lastPrompt = entry.prompt || '';
      aiAssistantState.debugInfo = {
        request: entry.prompt || '',
        returnedActionCount: aiAssistantState.pendingActions.length,
        actions: aiAssistantState.pendingActions,
        source: 'history-apply'
      };
      renderAiAssistantActions();
      renderAiAssistantDebug();
      applyPendingAiActions();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (currentStageEditor === 'none') {
      return;
    }
    if (Date.now() - lastStageEditorOpenedAt < 80) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (eraserState.active && currentStageEditor === 'eraser') {
      if (target.closest('#slideCanvas') || target.closest('.eraser-stage-overlay') || target.closest('[data-element-id]')) {
        return;
      }
    }
    if (target.closest('.quiz-editor-card')) {
      return;
    }
    if (target.closest('.eraser-stage-overlay')) {
      return;
    }
    if (currentStageEditor === 'eraser' && target.closest('#slideCanvas')) {
      return;
    }
    if (isPickingFloatingInsertPosition && target.closest('#slideCanvas')) {
      return;
    }
    if (isPickingFloatingTargetElement && target.closest('#slideCanvas')) {
      return;
    }
    if (target.closest('[data-element-id]')) {
      return;
    }
    if (target.closest('.stage-toolbar-menu')) {
      return;
    }
    closeStageEditors();
  });
  window.addEventListener('resize', () => {
    ['text', 'block', 'image', 'audio', 'quiz', 'floating', 'video', 'background', 'eraser', 'animation'].forEach(positionStageEditorCard);
    renderEraserOverlay();
  });
  const syncQuizEditor = () => {
    const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
    if (!element || element.type !== 'quiz') {
      return;
    }
    const options = (quizOptionsInput?.value || '')
      .split('\n')
      .map((option) => option.trim())
      .filter(Boolean);
    const quizQuestionValue = quizQuestionInput?.value ?? '';
    element.question = quizQuestionValue.length ? quizQuestionValue : element.question;
    element.options = options.length ? options : createDefaultQuizOptions();
    const quizSuccessValue = quizSuccessMessageInput?.value ?? '';
    const quizErrorValue = quizErrorMessageInput?.value ?? '';
    const quizActionLabelValue = quizActionLabelInput?.value ?? '';
    element.successMessage = quizSuccessValue.length ? quizSuccessValue : 'Resposta correta!';
    element.errorMessage = quizErrorValue.length ? quizErrorValue : 'Resposta incorreta. Tente novamente.';
    element.actionLabel = quizActionLabelValue.length ? quizActionLabelValue : 'Validar resposta';
    element.quizBackgroundColor = quizBackgroundColorInput?.value || '#ffffff';
    element.quizQuestionColor = quizQuestionColorInput?.value || '#171934';
    element.quizOptionBackgroundColor = quizOptionBackgroundColorInput?.value || '#f4f6ff';
    element.quizOptionTextColor = quizOptionTextColorInput?.value || '#25284c';
    element.quizButtonBackgroundColor = quizButtonBackgroundColorInput?.value || '#6d63ff';
    element.points = Math.max(1, Number(quizPointsInput?.value) || 1);
    element.lockOnWrong = Boolean(quizLockOnWrongToggle?.checked);
    const nextCorrectIndex = Number(quizCorrectAnswerSelect?.value);
    element.correctOption = Number.isNaN(nextCorrectIndex)
      ? 0
      : Math.min(Math.max(nextCorrectIndex, 0), element.options.length - 1);
    populateQuizAnswerOptions(element.options, element.correctOption);
    renderSlide();
    scheduleHistoryCommit();
  };
  [quizQuestionInput, quizOptionsInput, quizSuccessMessageInput, quizErrorMessageInput, quizActionLabelInput, quizBackgroundColorInput, quizQuestionColorInput, quizOptionBackgroundColorInput, quizOptionTextColorInput, quizButtonBackgroundColorInput, quizPointsInput, quizLockOnWrongToggle].forEach((control) => {
    control?.addEventListener('input', syncQuizEditor);
    control?.addEventListener('change', syncQuizEditor);
  });
  quizCorrectAnswerSelect?.addEventListener('change', syncQuizEditor);
  const syncEraserSizeInputs = (source = 'range') => {
    const nextValue = clamp(
      Number(source === 'range' ? eraserSizeInput?.value : eraserSizeNumberInput?.value) || 42,
      8,
      180
    );
    if (eraserSizeInput) eraserSizeInput.value = String(nextValue);
    if (eraserSizeNumberInput) eraserSizeNumberInput.value = String(nextValue);
  };
  eraserModeSelect?.addEventListener('change', () => {
    resetEraserDraftState();
    syncEraserEditorControls();
    renderEraserOverlay();
  });
  eraserShapeSelect?.addEventListener('change', renderEraserPreview);
  eraserSizeInput?.addEventListener('input', () => {
    syncEraserSizeInputs('range');
    renderEraserPreview();
  });
  eraserSizeNumberInput?.addEventListener('input', () => {
    syncEraserSizeInputs('number');
    renderEraserPreview();
  });
  eraserClosePathBtn?.addEventListener('click', () => {
    finalizeLassoErase();
    renderEraserPreview();
  });
  eraserClearBtn?.addEventListener('click', clearEraserMask);
  eraserApplyBtn?.addEventListener('click', applyEraserChanges);
  [
    floatingActionTypeSelect,
    floatingTargetSlideSelect,
    floatingTargetElementSelect,
    floatingRequireAllToggle,
    floatingRuleGroupInput,
    floatingDetectorAcceptedSelect,
    floatingDetectorMinCountInput,
    floatingDetectorTriggerOnceToggle,
    floatingActionTextInput,
    floatingReplaceModeSelect,
    floatingReplaceCounterStartInput,
    floatingReplaceCounterStepInput,
    floatingActionUrlInput,
    floatingAudioVisibleToggle,
    floatingAudioLoopToggle,
    floatingTextColorInput,
    floatingTextBgColorInput,
    floatingTextFontSizeInput,
    floatingTextFontFamilySelect,
    floatingTextFontWeightSelect,
    floatingTextAlignSelect,
    floatingTextBackgroundToggle,
    floatingTextBorderToggle,
    floatingInsertXInput,
    floatingInsertYInput,
    floatingInsertWidthInput,
    floatingInsertHeightInput,
    floatingMoveXInput,
    floatingMoveYInput,
    floatingMoveDurationInput,
    floatingVideoTimeInput,
    floatingQuizQuestionInput,
    floatingQuizOptionsInput,
    floatingQuizCorrectSelect,
    floatingQuizSuccessInput,
    floatingQuizErrorInput,
    floatingQuizActionLabelInput,
    floatingQuizBackgroundColorInput,
    floatingQuizQuestionColorInput,
    floatingQuizOptionBackgroundColorInput,
    floatingQuizOptionTextColorInput,
    floatingQuizButtonBackgroundColorInput,
    floatingQuizPointsInput,
    floatingQuizLockOnWrongToggle
  ].forEach((control) => {
    control?.addEventListener('input', syncFloatingButtonEditor);
    control?.addEventListener('change', syncFloatingButtonEditor);
  });
  [videoTriggerTimeInput, videoTriggerActionSelect, videoTriggerSeekTimeInput].forEach((control) => {
    control?.addEventListener('input', syncVideoEditor);
    control?.addEventListener('change', syncVideoEditor);
  });
  [videoTriggerTargetElementSelect].forEach((control) => {
    control?.addEventListener('change', syncVideoEditor);
  });
  [imageElementWidthInput, imageElementHeightInput, imageElementRotationInput, imageElementObjectFitSelect, imageElementStudentDragToggle].forEach((control) => {
    control?.addEventListener('input', syncImageEditor);
    control?.addEventListener('change', syncImageEditor);
  });
  [audioElementWidthInput, audioElementHeightInput, audioElementRotationInput, audioElementVisibleToggle, audioElementLoopToggle].forEach((control) => {
    control?.addEventListener('input', syncAudioEditor);
    control?.addEventListener('change', syncAudioEditor);
  });
  floatingPickPlacementBtn?.addEventListener('click', toggleFloatingPlacementPicker);
  floatingPickTargetElementBtn?.addEventListener('click', toggleFloatingTargetElementPicker);
  slideCanvas?.addEventListener('click', (event) => {
    if (previewState.active) {
      return;
    }
    if (handleFloatingPlacementPick(event)) {
      return;
    }
    selectElement(null);
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const isTypingField = isTypingTarget(target);
    if (isTypingField) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        redoLastAction();
      } else {
        undoLastAction();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      if (!selectedElementId || previewState.active) {
        return;
      }
      event.preventDefault();
      copySelectedElementToClipboard();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      if (previewState.active) {
        return;
      }
      event.preventDefault();
      pasteClipboardElement();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedElementId) {
      event.preventDefault();
      removeSelectedElement();
      return;
    }
    if (selectedElementId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const movementMap = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0]
      };
      const [deltaX, deltaY] = movementMap[event.key];
      event.preventDefault();
      moveSelectedElementByKeyboard(deltaX, deltaY);
      return;
    }
    if (event.key === 'Escape' && (isPickingFloatingInsertPosition || isPickingFloatingTargetElement)) {
      event.preventDefault();
      isPickingFloatingInsertPosition = false;
      isPickingFloatingTargetElement = false;
      updateFloatingPlacementPreview();
    }
  });
  syncKeyboardMoveStepInput();
  [
    elementWidthInput,
    elementHeightInput,
    elementRotationInput,
    elementLayerInput,
    elementTextColorInput,
    elementFontSizeInput,
    elementFontFamilySelect,
    elementFontWeightSelect,
    elementBgColorInput,
    elementStudentDragToggle,
    elementShapeSelect,
    elementGradientToggle,
    elementSolidColorInput,
    elementGradientStartInput,
    elementGradientEndInput,
    elementTextBackgroundToggle,
    elementTextBorderToggle
  ].forEach((control) => {
    control?.addEventListener('input', applyElementStyles);
    control?.addEventListener('change', applyElementStyles);
  });
  addSlide('Slide 01');
  updateSaveButtonLabel();
  syncBuilderPanelLayout();
  updateGradientFieldsVisibility();
  updateBlockGradientFieldsVisibility();
  updateElementInspector(null);
  updateStageEditorState();
  resetHistoryState();
  renderAiAssistantAttachmentPreview();
  loadAiProposalHistory();
  loadBuilderCourses();
  loadTemplateStore();
  loadAiAssistantSettings();
  renderAiAssistantActions();
  renderAiAssistantFeedback();
  renderAiAssistantDebug();
  renderAiProposalHistory();
  window.addEventListener('resize', () => {
    ensureActiveSlideBounds();
    syncBuilderPanelLayout();
    renderSlide();
    hydrateTemplateStorePreviews();
  });
});

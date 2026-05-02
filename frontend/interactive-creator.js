import {
  API_BASE,
  STORAGE_KEY,
  USER_ROLE_KEY,
  AI_PROPOSAL_HISTORY_KEY,
  BUILDER_DRAFT_STORAGE_KEY,
  DEFAULT_STAGE_SIZE,
  getToken
} from './modules/constants.js';
import { authorizedFetch, handleLogout } from './modules/api.js';
import {
  normalizeTemplateStageSize as normalizeTemplateStageSizeModule,
  normalizeTemplateModuleSettings as normalizeTemplateModuleSettingsModule,
  normalizeSlideBackgroundFill as normalizeSlideBackgroundFillModule
} from './modules/normalize.js';
import {
  deepClone,
  escapeHtml,
  escapeAttribute,
  truncateText,
  createSlug,
  isTypingTarget,
  renderPlainTextHtml,
  getYouTubeEmbedUrl
} from './modules/utils.js';

const backgroundRemovalModulePromise = import('./image-background-removal.js');
const eraserUtilsPromise = import('./eraser-utils.js');

const normalizeTemplateStageSize = (stageSize) =>
  normalizeTemplateStageSizeModule(stageSize, DEFAULT_STAGE_SIZE);
const normalizeTemplateModuleSettings = (moduleSettings) =>
  normalizeTemplateModuleSettingsModule(moduleSettings);
const normalizeSlideBackgroundFill = (slide = {}) =>
  normalizeSlideBackgroundFillModule(slide);
const getCurrentUserData = () => {
  try {
    return JSON.parse(localStorage.getItem('curso-platform-user') || '{}');
  } catch (error) {
    return {};
  }
};
const saveCurrentUserData = (nextData) => {
  localStorage.setItem('curso-platform-user', JSON.stringify({
    ...getCurrentUserData(),
    ...nextData
  }));
};
const formatCreditNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return numeric.toLocaleString('pt-BR', {
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2
  });
};
const formatStorageAmount = (bytes) => {
  const numeric = Number(bytes);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0 MB';
  if (numeric >= 1024 * 1024 * 1024) {
    return `${(numeric / (1024 * 1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB`;
  }
  return `${(numeric / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB`;
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
    isPublic: false,
    coverImage: ''
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
let moduleCoverModeSelect;
let moduleCoverUrlInput;
let applyModuleCoverBtn;
let clearModuleCoverBtn;
let moduleCoverPreview;
let moduleCoverPreviewTitle;
let moduleCoverPreviewMeta;
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
let backgroundBatchToggle;
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
let draggingSlideId = null;
let slideDropTargetId = null;
let slideDropPlacement = 'after';
let suppressSlideChipClick = false;
let selectedElementTypeLabel;
let elementWidthInput;
let elementHeightInput;
let elementRotationInput;
let elementLayerInput;
let elementOpacityInput;
let elementOpacityValue;
let elementTextColorInput;
let elementFontSizeInput;
let elementFontFamilySelect;
let elementFontWeightSelect;
let elementBgColorInput;
let elementStudentDragToggle;
let elementInitiallyHiddenToggle;
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
let imageSourceModeSelect;
let imageSourceUrlInput;
let imageApplySourceBtn;
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
let floatingButtonLabelInput;
let floatingInputPlaceholderInput;
let floatingInputSubmitLabelInput;
let floatingInputCompareTextInput;
let floatingInputCompareCaseToggle;
let floatingInputCompareImageToggle;
let floatingInputCompareImageUrlInput;
let floatingInputCompareImageFileInput;
let floatingInputCompareImageClearBtn;
let floatingInputCompareImagePreview;
let floatingInputSuccessInput;
let floatingInputErrorInput;
let floatingInputAllowImageToggle;
let floatingInputAllowAudioToggle;
let floatingInputBackgroundColorInput;
let floatingInputLabelColorInput;
let floatingInputTextColorInput;
let floatingInputButtonBackgroundColorInput;
let floatingInputButtonTextColorInput;
let floatingTriggerTimeInput;
let floatingTriggerList;
let floatingAddTriggerBtn;
let floatingDuplicateTriggerBtn;
let floatingRemoveTriggerBtn;
let floatingActionTypeLabel;
let floatingActionTypeSelect;
let floatingTargetSlideSelect;
let floatingTargetElementSelect;
let floatingPickTargetElementBtn;
let builderProfessorCreditsStatus;
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
let videoTriggerList;
let videoAddTriggerBtn;
let videoDuplicateTriggerBtn;
let videoRemoveTriggerBtn;
let videoTriggerTimeInput;
let videoTriggerActionSelect;
let videoTriggerSeekTimeInput;
let videoTriggerTargetElementSelect;
let videoTriggerTargetSlideSelect;
let videoTriggerUrlInput;
let videoTriggerActionTextLabel;
let videoTriggerActionTextInput;
let videoTriggerReplaceModeSelect;
let videoTriggerReplaceCounterStartInput;
let videoTriggerReplaceCounterStepInput;
let videoTriggerAudioVisibleToggle;
let videoTriggerAudioLoopToggle;
let videoTriggerTextColorInput;
let videoTriggerTextBgColorInput;
let videoTriggerTextFontSizeInput;
let videoTriggerTextFontFamilySelect;
let videoTriggerTextFontWeightSelect;
let videoTriggerTextAlignSelect;
let videoTriggerTextBackgroundToggle;
let videoTriggerTextBorderToggle;
let videoTriggerInsertXInput;
let videoTriggerInsertYInput;
let videoTriggerInsertWidthInput;
let videoTriggerInsertHeightInput;
let videoPickPlacementBtn;
let videoPlacementHint;
let videoTriggerMoveXInput;
let videoTriggerMoveYInput;
let videoTriggerMoveDurationInput;
let videoTriggerQuizQuestionInput;
let videoTriggerQuizOptionsInput;
let videoTriggerQuizCorrectSelect;
let videoTriggerQuizSuccessInput;
let videoTriggerQuizErrorInput;
let videoTriggerQuizActionLabelInput;
let videoTriggerQuizBackgroundColorInput;
let videoTriggerQuizQuestionColorInput;
let videoTriggerQuizOptionBackgroundColorInput;
let videoTriggerQuizOptionTextColorInput;
let videoTriggerQuizButtonBackgroundColorInput;
let videoTriggerQuizPointsInput;
let videoTriggerQuizLockOnWrongToggle;
let videoTriggerQuizPlaySourceVideoToggle;
let videoCaptionEnabledToggle;
let videoCaptionPositionSelect;
let videoCaptionWidthInput;
let videoCaptionFontSizeInput;
let videoCaptionTextColorInput;
let videoCaptionBackgroundColorInput;
let videoCaptionAccentColorInput;
let videoCaptionUppercaseToggle;
let videoCaptionSegmentList;
let videoCaptionSegmentEmpty;
let videoCaptionSegmentStartInput;
let videoCaptionSegmentEndInput;
let videoCaptionSegmentTextInput;
let videoCaptionSegmentAddBtn;
let videoCaptionSegmentRemoveBtn;
let videoGenerateCaptionsBtn;
let videoExtractAudioBtn;
let videoSourceModeSelect;
let videoSourceUrlInput;
let videoApplySourceBtn;
let audioElementWidthInput;
let audioElementHeightInput;
let audioElementRotationInput;
let audioElementVisibleToggle;
let audioElementLoopToggle;
let audioCaptionEnabledToggle;
let audioCaptionPositionSelect;
let audioCaptionWidthInput;
let audioCaptionFontSizeInput;
let audioCaptionTextColorInput;
let audioCaptionBackgroundColorInput;
let audioCaptionAccentColorInput;
let audioCaptionUppercaseToggle;
let audioCaptionSegmentList;
let audioCaptionSegmentEmpty;
let audioCaptionSegmentStartInput;
let audioCaptionSegmentEndInput;
let audioCaptionSegmentTextInput;
let audioCaptionSegmentAddBtn;
let audioCaptionSegmentRemoveBtn;
let audioGenerateCaptionsBtn;
let audioReplaceSourceBtn;
let audioSourceModeSelect;
let audioSourceUrlInput;
let audioApplySourceBtn;
let eraserEditorCard;
let eraserModeSelect;
let eraserShapeSelect;
let eraserSizeInput;
let eraserSizeNumberInput;
let eraserClosePathBtn;
let eraserClearBtn;
let eraserApplyBtn;
let penEditorCard;
let penColorInput;
let penSizeInput;
let penSizeNumberInput;
let penStartDrawingBtn;
let penClearPreviewBtn;
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
  pen: { x: 92, y: 152 },
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
let activeElementMenuTriggerId = null;
let elementMenuHideTimer = null;
let selectedFloatingTriggerId = null;
let selectedVideoTriggerId = null;
let selectedVideoCaptionSegmentIndex = 0;
let selectedAudioCaptionSegmentIndex = 0;

const FLOATING_INSERT_ACTIONS = ['addText', 'addImage', 'addAudio', 'addVideo', 'addQuiz'];
const MAX_ELEMENT_TRIGGER_COUNT = 40;
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

const autosaveState = {
  localTimer: null,
  remoteTimer: null
};
let draftRestoreCompleted = false;

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
  generatedActions: [],
  attachments: [],
  proposalHistory: [],
  lastPrompt: '',
  debugInfo: null,
  executionPlan: null
};

const previewState = {
  active: false,
  slides: [],
  activeSlideId: null,
  slideEnteredAt: 0,
  activeTimedSlideId: null,
  timedSlideTriggerTimers: [],
  timedSlideTriggers: new Map(),
  clickedRuleButtons: new Map(),
  triggeredDetectors: new Set(),
  replaceCounters: new Map(),
  hiddenElements: new Map(),
  mediaState: new Map(),
  timedVideoTriggers: new Map()
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

const ERASER_SUPPORTED_TYPES = new Set(['image', 'block', 'pen']);
const ERASER_BRUSH_SHAPES = new Set(['circle', 'square', 'diamond']);
const PEN_MIN_BRUSH_SIZE = 2;
const PEN_MAX_BRUSH_SIZE = 48;
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
const penState = {
  active: false,
  drawing: false,
  overlay: null,
  canvas: null,
  points: [],
  hoverPoint: null
};

const AI_REFERENCE_PROMPT =
  'Use a imagem de referência como inspiração e crie um slide com layout profissional: alinhe os blocos em grade, mantenha espaçamentos consistentes, deixe o título bem hierarquizado, alinhe os textos com margens internas equilibradas, use uma imagem ilustrativa por URL e adicione um botão interativo elegante. Quando fizer sentido, configure blocos com shape e gradiente, e use animacao em image ou block com fade, pulse, float, zoom ou motion-recording com quadros para criar movimentacao guiada.';

const TEMPLATE_FILE_VERSION = 1;
const TEMPLATE_KIND = 'curso-slide-template';

const createId = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 6)}-${Date.now()}`;

const getPreviewActiveSlide = () => previewState.slides.find((slide) => slide.id === previewState.activeSlideId) || null;

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

const normalizeMediaCaptionConfig = (element, type = 'video') => {
  if (!element || !['audio', 'video'].includes(element.type)) {
    return;
  }
  element.captions = normalizeCaptionEntries(element.captions);
  element.captionsEnabled = typeof element.captionsEnabled === 'boolean' ? element.captionsEnabled : false;
  element.captionStyle = normalizeCaptionStyle(element.captionStyle, type);
  element.transcriptText = typeof element.transcriptText === 'string' ? element.transcriptText : '';
  element.captionsGeneratedAt = typeof element.captionsGeneratedAt === 'string' ? element.captionsGeneratedAt : '';
};

const sortCaptionEntries = (entries = []) =>
  normalizeCaptionEntries(entries).sort((a, b) => {
    const startDiff = (Number(a?.start) || 0) - (Number(b?.start) || 0);
    if (Math.abs(startDiff) > 0.0001) return startDiff;
    return (Number(a?.end) || 0) - (Number(b?.end) || 0);
  });

const getCaptionSegmentEditorState = (type) =>
  type === 'video'
    ? {
      listNode: videoCaptionSegmentList,
      emptyNode: videoCaptionSegmentEmpty,
      startInput: videoCaptionSegmentStartInput,
      endInput: videoCaptionSegmentEndInput,
      textInput: videoCaptionSegmentTextInput,
      removeBtn: videoCaptionSegmentRemoveBtn,
      getIndex: () => selectedVideoCaptionSegmentIndex,
      setIndex: (value) => {
        selectedVideoCaptionSegmentIndex = value;
      }
    }
    : {
      listNode: audioCaptionSegmentList,
      emptyNode: audioCaptionSegmentEmpty,
      startInput: audioCaptionSegmentStartInput,
      endInput: audioCaptionSegmentEndInput,
      textInput: audioCaptionSegmentTextInput,
      removeBtn: audioCaptionSegmentRemoveBtn,
      getIndex: () => selectedAudioCaptionSegmentIndex,
      setIndex: (value) => {
        selectedAudioCaptionSegmentIndex = value;
      }
    };

const getValidCaptionSegmentIndex = (type, element) => {
  const state = getCaptionSegmentEditorState(type);
  const total = Array.isArray(element?.captions) ? element.captions.length : 0;
  if (!total) {
    state.setIndex(0);
    return -1;
  }
  const nextIndex = clamp(Number(state.getIndex()) || 0, 0, total - 1);
  state.setIndex(nextIndex);
  return nextIndex;
};

const renderCaptionSegmentEditor = (type, element) => {
  const state = getCaptionSegmentEditorState(type);
  if (!state.listNode || !state.startInput || !state.endInput || !state.textInput || !state.emptyNode) {
    return;
  }
  const entries = Array.isArray(element?.captions) ? element.captions : [];
  const selectedIndex = getValidCaptionSegmentIndex(type, element);
  state.listNode.innerHTML = entries
    .map((entry, index) => {
      const isActive = index === selectedIndex;
      const title = truncateText(entry.text || '', 54) || `Trecho ${index + 1}`;
      return `
        <button type="button" class="trigger-chip${isActive ? ' active' : ''}" data-caption-segment-type="${type}" data-caption-segment-index="${index}">
          <span>
            <span class="trigger-chip-title">${escapeHtml(title)}</span>
            <small class="trigger-chip-meta">${escapeHtml(`${Number(entry.start || 0).toFixed(1)}s ate ${Number(entry.end || 0).toFixed(1)}s`)}</small>
          </span>
        </button>
      `;
    })
    .join('');
  state.emptyNode.classList.toggle('hidden', entries.length > 0);
  state.removeBtn && (state.removeBtn.disabled = entries.length === 0 || selectedIndex < 0);
  const selectedEntry = selectedIndex >= 0 ? entries[selectedIndex] : null;
  state.startInput.disabled = !selectedEntry;
  state.endInput.disabled = !selectedEntry;
  state.textInput.disabled = !selectedEntry;
  state.startInput.value = selectedEntry ? String(Number(selectedEntry.start || 0).toFixed(1)) : '0';
  state.endInput.value = selectedEntry ? String(Number(selectedEntry.end || 0).toFixed(1)) : '1';
  syncTextInputValue(state.textInput, selectedEntry?.text || '');
};

const applyCaptionSegmentFieldChanges = (type) => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === type);
  if (!element) {
    return;
  }
  normalizeMediaCaptionConfig(element, type);
  const state = getCaptionSegmentEditorState(type);
  const selectedIndex = getValidCaptionSegmentIndex(type, element);
  if (selectedIndex < 0 || !element.captions[selectedIndex]) {
    return;
  }
  const entry = element.captions[selectedIndex];
  const nextStart = Math.max(0, Number(state.startInput?.value) || 0);
  const rawEnd = Math.max(0, Number(state.endInput?.value) || 0);
  const nextEnd = Math.max(nextStart + 0.1, rawEnd);
  const nextText = String(state.textInput?.value || '').trim();
  entry.start = nextStart;
  entry.end = nextEnd;
  entry.text = nextText || entry.text || `Trecho ${selectedIndex + 1}`;
  element.captions = sortCaptionEntries(element.captions);
  const resortedIndex = element.captions.findIndex((item) =>
    item.text === entry.text && Math.abs(item.start - nextStart) < 0.0001 && Math.abs(item.end - nextEnd) < 0.0001
  );
  state.setIndex(resortedIndex >= 0 ? resortedIndex : 0);
  renderCaptionSegmentEditor(type, element);
  renderSlide();
  scheduleHistoryCommit();
};

const applyCaptionSegmentTextDraft = (type) => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === type);
  if (!element) {
    return;
  }
  const state = getCaptionSegmentEditorState(type);
  const selectedIndex = getValidCaptionSegmentIndex(type, element);
  if (selectedIndex < 0 || !element.captions[selectedIndex]) {
    return;
  }
  element.captions[selectedIndex].text = String(state.textInput?.value || '');
  renderSlide();
  scheduleHistoryCommit();
};

const addCaptionSegment = (type) => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === type);
  if (!element) {
    return;
  }
  normalizeMediaCaptionConfig(element, type);
  const entries = Array.isArray(element.captions) ? element.captions : [];
  const lastEntry = entries[entries.length - 1] || null;
  const nextStart = lastEntry ? Number(lastEntry.end || 0) + 0.1 : 0;
  const nextEntry = {
    start: Number(nextStart.toFixed(1)),
    end: Number((nextStart + 1.5).toFixed(1)),
    text: `Novo trecho ${entries.length + 1}`
  };
  element.captions = sortCaptionEntries([...entries, nextEntry]);
  const state = getCaptionSegmentEditorState(type);
  state.setIndex(element.captions.findIndex((entry) => entry.text === nextEntry.text && entry.start === nextEntry.start));
  element.captionsEnabled = true;
  renderCaptionSegmentEditor(type, element);
  updateElementInspector(element);
  renderSlide();
  commitHistoryState();
};

const removeCaptionSegment = (type) => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === type);
  if (!element) {
    return;
  }
  const state = getCaptionSegmentEditorState(type);
  const selectedIndex = getValidCaptionSegmentIndex(type, element);
  if (selectedIndex < 0) {
    return;
  }
  element.captions.splice(selectedIndex, 1);
  element.captions = sortCaptionEntries(element.captions);
  if (!element.captions.length) {
    element.captionsEnabled = false;
  }
  state.setIndex(Math.max(0, selectedIndex - 1));
  renderCaptionSegmentEditor(type, element);
  updateElementInspector(element);
  renderSlide();
  commitHistoryState();
};

const getMediaCaptionSegmentAtTime = (element, currentTime) => {
  if (currentTime < 0) return null;
  const safeTime = Math.max(0, Number(currentTime) || 0);
  return (element?.captions || []).find((entry) => safeTime >= entry.start && safeTime <= entry.end) || null;
};

const applyCaptionOverlayState = (overlayNode, element, currentTime, options = {}) => {
  if (!overlayNode || !element?.captionsEnabled || !(element.captions || []).length) {
    if (overlayNode) {
      overlayNode.textContent = '';
      overlayNode.classList.add('is-hidden');
    }
    return;
  }
  const activeSegment = getMediaCaptionSegmentAtTime(element, currentTime);
  if (!activeSegment) {
    if (options.keepVisibleWhenIdle) {
      const fallbackSegment = element.captions.find((entry) => entry?.text) || null;
      if (fallbackSegment) {
        const fallbackStyle = normalizeCaptionStyle(element.captionStyle, element.type);
        overlayNode.textContent = fallbackStyle.uppercase ? fallbackSegment.text.toUpperCase() : fallbackSegment.text;
        overlayNode.dataset.position = fallbackStyle.position;
        overlayNode.style.setProperty('--caption-font-size', `${fallbackStyle.fontSize}px`);
        overlayNode.style.setProperty('--caption-color', fallbackStyle.textColor);
        overlayNode.style.setProperty('--caption-bg', fallbackStyle.backgroundColor);
        overlayNode.style.setProperty('--caption-accent', fallbackStyle.accentColor);
        if (fallbackStyle.width) {
          overlayNode.style.setProperty('--caption-width', fallbackStyle.width + 'px');
        } else {
          overlayNode.style.removeProperty('--caption-width');
        }
        overlayNode.classList.toggle('is-uppercase', Boolean(fallbackStyle.uppercase));
        overlayNode.classList.add('is-placeholder');
        overlayNode.classList.remove('is-hidden');
        return;
      }
    }
    overlayNode.textContent = '';
    overlayNode.classList.add('is-hidden');
    return;
  }
  const style = normalizeCaptionStyle(element.captionStyle, element.type);
  overlayNode.textContent = style.uppercase ? activeSegment.text.toUpperCase() : activeSegment.text;
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
  overlayNode.classList.remove('is-placeholder');
  overlayNode.classList.remove('is-hidden');
};

const getPreviewMediaNode = (node) => {
  if (!node) return null;
  if (node instanceof HTMLAudioElement || node instanceof HTMLVideoElement) {
    return node;
  }
  return node.querySelector?.('audio, video') || null;
};

const getCaptionStageSize = (stageNode = slideCanvas) => {
  if (stageNode instanceof HTMLElement) {
    const width = Number(stageNode.clientWidth) || Number(stageNode.offsetWidth) || 0;
    const height = Number(stageNode.clientHeight) || Number(stageNode.offsetHeight) || 0;
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  return getStageDimensions();
};

const getCaptionOverlayPosition = (element, overlayNode, stageNode = slideCanvas) => {
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

const positionCaptionOverlayNode = (overlayNode, element, stageNode = slideCanvas) => {
  if (!overlayNode || !element) {
    return;
  }
  const position = getCaptionOverlayPosition(element, overlayNode, stageNode);
  overlayNode.style.left = `${position.x}px`;
  overlayNode.style.top = `${position.y}px`;
};

const createMediaCaptionOverlayNode = (element, mediaNode, options = {}) => {
  if (!element || !(element.captions || []).length) {
    return null;
  }
  const {
    stageNode = slideCanvas,
    interactive = false,
    keepVisibleWhenIdle = false,
    onCommit = null,
    onSelect = null
  } = options;
  const overlayNode = document.createElement('div');
  overlayNode.className = `builder-media-caption is-hidden${interactive ? ' is-interactive' : ''}`;
  overlayNode.dataset.captionForElementId = element.id;
  const syncOverlay = () => {
    const currentTime = mediaNode && !mediaNode.paused ? mediaNode.currentTime : -1;
    applyCaptionOverlayState(overlayNode, element, currentTime, { keepVisibleWhenIdle });
    positionCaptionOverlayNode(overlayNode, element, stageNode);
  };
  if (mediaNode) {
    mediaNode.addEventListener('timeupdate', syncOverlay);
    mediaNode.addEventListener('seeking', syncOverlay);
    mediaNode.addEventListener('seeked', syncOverlay);
    mediaNode.addEventListener('pause', syncOverlay);
    mediaNode.addEventListener('play', syncOverlay);
    mediaNode.addEventListener('ended', () => {
      applyCaptionOverlayState(overlayNode, element, -1, { keepVisibleWhenIdle });
      positionCaptionOverlayNode(overlayNode, element, stageNode);
    });
    mediaNode.addEventListener('loadedmetadata', syncOverlay);
  }
  syncOverlay();
  requestAnimationFrame(syncOverlay);
  if (interactive) {
    let pointerId;
    let offsetX = 0;
    let offsetY = 0;
    let dragStarted = false;
    const endDrag = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', endDrag);
      document.removeEventListener('pointercancel', endDrag);
      if (pointerId !== undefined) {
        overlayNode.releasePointerCapture(pointerId);
        pointerId = undefined;
      }
      overlayNode.classList.remove('is-dragging');
      overlayNode.style.cursor = 'grab';
      if (dragStarted && typeof onCommit === 'function') {
        onCommit();
      }
      dragStarted = false;
    };
    const onMove = (event) => {
      event.preventDefault();
      const pointer = getStagePointerPosition(event);
      const stage = getCaptionStageSize(stageNode);
      const overlayWidth = overlayNode.offsetWidth || 0;
      const overlayHeight = overlayNode.offsetHeight || 0;
      const nextX = clamp(pointer.x - offsetX, 0, Math.max(0, stage.width - overlayWidth));
      const nextY = clamp(pointer.y - offsetY, 0, Math.max(0, stage.height - overlayHeight));
      dragStarted = true;
      element.captionStyle = normalizeCaptionStyle({
        ...element.captionStyle,
        freePosition: true,
        stageX: nextX,
        stageY: nextY
      }, element.type);
      overlayNode.style.left = `${nextX}px`;
      overlayNode.style.top = `${nextY}px`;
      updateElementInspector(element);
    };
    overlayNode.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pointer = getStagePointerPosition(event);
      const currentPosition = getCaptionOverlayPosition(element, overlayNode, stageNode);
      offsetX = pointer.x - currentPosition.x;
      offsetY = pointer.y - currentPosition.y;
      dragStarted = false;
      pointerId = event.pointerId;
      overlayNode.setPointerCapture(pointerId);
      overlayNode.classList.add('is-dragging');
      overlayNode.style.cursor = 'grabbing';
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', endDrag);
      document.addEventListener('pointercancel', endDrag);
    });
    overlayNode.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onSelect === 'function') {
        onSelect();
      }
    });
  }
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
  opacity: getElementBaseOpacity(element)
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
  const animationType = element.animationType || 'none';
  if (animationType === 'none') {
    node.style.animation = '';
    node.style.transform = rotation ? `rotate(${rotation}deg)` : '';
    return;
  }

  if (animationType === MOTION_ANIMATION_TYPE) {
    node.style.animation = '';
    if (node.dataset.elementId && !previewState.active) {
      node.style.opacity = String(getElementBaseOpacity(element));
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
      modulePublicLinkInput.focus({ preventScroll: true });
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

const getModuleCoverValue = () => String(builderState.moduleSettings?.coverImage || '').trim();

const syncModuleCoverPreview = () => {
  const coverImage = getModuleCoverValue();
  const title = moduleTitleInput?.value?.trim() || 'Sem capa';
  if (moduleCoverPreview) {
    moduleCoverPreview.style.backgroundImage = coverImage
      ? `linear-gradient(155deg, rgba(16, 20, 52, 0.18), rgba(16, 20, 52, 0.02)), url("${coverImage}")`
      : '';
  }
  if (moduleCoverPreviewTitle) {
    moduleCoverPreviewTitle.textContent = coverImage ? title : 'Sem capa';
  }
  if (moduleCoverPreviewMeta) {
    moduleCoverPreviewMeta.textContent = coverImage
      ? 'Preview que o aluno verá ao navegar pelos módulos do curso.'
      : 'Adicione uma imagem para destacar este módulo no portal do aluno.';
  }
  if (clearModuleCoverBtn) {
    clearModuleCoverBtn.disabled = !coverImage;
  }
};

const updateModuleCoverModeUi = () => {
  document.getElementById('moduleCoverUrlField')?.classList.toggle('hidden', (moduleCoverModeSelect?.value || 'local') !== 'url');
};

const applyModuleCover = async (preferredMode = '') => {
  const mode = preferredMode || moduleCoverModeSelect?.value || 'local';
  let nextCover = '';
  if (mode === 'url') {
    nextCover = moduleCoverUrlInput?.value?.trim() || '';
    if (!nextCover) {
      alert('Informe a URL da capa.');
      return;
    }
  } else {
    try {
      nextCover = await readLocalFile(localImageInput, 'image');
      if (!nextCover) {
        return;
      }
    } catch (error) {
      alert(error.message || 'Não foi possível carregar a capa escolhida.');
      return;
    }
  }
  builderState.moduleSettings = {
    ...(builderState.moduleSettings || {}),
    coverImage: nextCover
  };
  if (moduleCoverUrlInput && mode === 'url') {
    moduleCoverUrlInput.value = nextCover;
  }
  syncModuleCoverPreview();
  commitHistoryState();
};

const clearModuleCover = () => {
  builderState.moduleSettings = {
    ...(builderState.moduleSettings || {}),
    coverImage: ''
  };
  if (moduleCoverUrlInput) {
    moduleCoverUrlInput.value = '';
  }
  syncModuleCoverPreview();
  commitHistoryState();
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
      if (Array.isArray(element?.interactionTriggers)) {
        element.interactionTriggers.forEach((trigger) => {
          if (trigger?.actionConfig?.targetSlideId && slideIdMap.has(trigger.actionConfig.targetSlideId)) {
            trigger.actionConfig.targetSlideId = slideIdMap.get(trigger.actionConfig.targetSlideId);
          }
        });
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
  if (moduleCoverUrlInput) {
    moduleCoverUrlInput.value = builderState.moduleSettings.coverImage || '';
  }
  syncPublicModuleLinkUi();
  syncModuleCoverPreview();

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
    templateStoreList.innerHTML = `<p class="muted" style="margin:0;">${query ? 'Nenhum template encontrado para esta busca.' : 'Nenhum template publicado na loja ainda.'
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
    case 'pen':
      return { width: 220, height: 120 };
    case 'audio':
      return { width: 260, height: 70 };
    case 'video':
      return { width: 320, height: 190 };
    case 'quiz':
      return { width: 420, height: 300 };
    case 'input':
      return { width: 420, height: 260 };
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

const escapeAttributeSelectorValue = (value) => {
  const normalized = String(value || '');
  if (typeof window !== 'undefined' && window.CSS?.escape) {
    return window.CSS.escape(normalized);
  }
  return normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};

const getElementBaseOpacity = (element) => {
  const value = Number(element?.opacity);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
};

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
  const node = slideCanvas?.querySelector(`[data-element-id="${escapeAttributeSelectorValue(element?.id || '')}"]`);
  const canvasRect = slideCanvas?.getBoundingClientRect();
  const nodeRect = node?.getBoundingClientRect?.();
  if (node && canvasRect && nodeRect) {
    const scale = getStageScale();
    const measuredWidth = Math.max(nodeRect.width, node.scrollWidth || 0, node.offsetWidth || 0);
    const measuredHeight = Math.max(nodeRect.height, node.scrollHeight || 0, node.offsetHeight || 0);
    return {
      left: (nodeRect.left - canvasRect.left) / scale,
      top: (nodeRect.top - canvasRect.top) / scale,
      width: measuredWidth / scale,
      height: measuredHeight / scale
    };
  }
  return getElementBox(element);
};

const getStageRelativeCaptionBox = (element) => {
  const node = slideCanvas?.querySelector(`[data-caption-for-element-id="${escapeAttributeSelectorValue(element?.id || '')}"]`);
  const canvasRect = slideCanvas?.getBoundingClientRect();
  const nodeRect = node?.getBoundingClientRect?.();
  if (node && canvasRect && nodeRect) {
    const scale = getStageScale();
    const measuredWidth = Math.max(nodeRect.width, node.scrollWidth || 0, node.offsetWidth || 0);
    const measuredHeight = Math.max(nodeRect.height, node.scrollHeight || 0, node.offsetHeight || 0);
    return {
      left: (nodeRect.left - canvasRect.left) / scale,
      top: (nodeRect.top - canvasRect.top) / scale,
      width: measuredWidth / scale,
      height: measuredHeight / scale
    };
  }
  return null;
};

const expandElementToRenderedContent = (element, node) => {
  if (!element || !node || !['text', 'block', 'floatingButton'].includes(element.type)) {
    return false;
  }
  const innerNode = node.querySelector('.builder-block-element, .floating-button-element, .builder-text-element') || node;
  const measuredWidth = Math.ceil(Math.max(innerNode.scrollWidth || 0, innerNode.offsetWidth || 0));
  const measuredHeight = Math.ceil(Math.max(innerNode.scrollHeight || 0, innerNode.offsetHeight || 0));
  const nextWidth = Math.max(MIN_ELEMENT_SIZE, measuredWidth);
  const nextHeight = Math.max(MIN_ELEMENT_SIZE, measuredHeight);
  let changed = false;
  if (nextWidth > (Number(element.width) || 0) + 1) {
    element.width = nextWidth;
    node.style.width = `${nextWidth}px`;
    changed = true;
  }
  if (nextHeight > (Number(element.height) || 0) + 1) {
    element.height = nextHeight;
    node.style.height = `${nextHeight}px`;
    changed = true;
  }
  return changed;
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
    case 'pen':
      return penEditorCard;
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
  quizOptions: createDefaultQuizOptions(),
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
  playSourceVideoOnValidate: false,
  audioVisible: true,
  audioLoop: false
});

const createInteractionTrigger = (elementType = 'floatingButton', source = {}) => {
  const config = {
    ...createDefaultActionConfig(),
    ...(source.actionConfig && typeof source.actionConfig === 'object' ? source.actionConfig : source)
  };
  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : createId(elementType === 'detector' ? 'detector-trigger' : 'trigger'),
    name:
      typeof source.name === 'string' && source.name.trim()
        ? source.name.trim()
        : elementType === 'detector'
          ? 'Gatilho'
          : elementType === 'timedTrigger'
            ? 'Tempo'
            : 'Ação',
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
    time: Math.max(0, Number(source.time ?? source.triggerTime) || 0),
    actionConfig: normalizeRuntimeActionConfig(config)
  };
};

const createVideoTrigger = (source = {}) => {
  const actionConfig = normalizeRuntimeActionConfig({
    ...createDefaultActionConfig(),
    ...(source.actionConfig && typeof source.actionConfig === 'object'
      ? source.actionConfig
      : {
        type: source.action || source.videoTriggerAction || 'none',
        targetElementId: source.targetElementId || source.videoTriggerTargetElementId || '',
        videoTime: source.seekTime ?? source.videoTriggerSeekTime ?? 0
      })
  });
  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : createId('video-trigger'),
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : 'Tempo',
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
    time: Math.max(0, Number(source.time ?? source.videoTriggerTime) || 0),
    actionConfig
  };
};

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
  const rawQuizWidth = Number(element.width);
  element.width = (!Number.isNaN(rawQuizWidth) && rawQuizWidth > 0) ? rawQuizWidth : 420;
  element.height = Math.max(getQuizMinimumHeight(element.options), Number(element.height) || 0);
};

const normalizeFloatingActionConfig = (element) => {
  if (!element || !['floatingButton', 'detector', 'timedTrigger', 'input'].includes(element.type)) {
    return;
  }
  const legacyConfig = element.actionConfig && typeof element.actionConfig === 'object' ? element.actionConfig : {};
  const sourceTriggers = Array.isArray(element.interactionTriggers) ? element.interactionTriggers : [];
  const normalizedTriggers = (sourceTriggers.length ? sourceTriggers : [{ actionConfig: legacyConfig }])
    .slice(0, MAX_ELEMENT_TRIGGER_COUNT)
    .map((trigger, index) => {
      const normalized = createInteractionTrigger(element.type, trigger);
      const config = normalized.actionConfig || {};
      normalized.time = Math.max(0, Number(normalized.time) || 0);
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
      normalized.name =
        normalized.name || `${element.type === 'detector' ? 'Gatilho' : element.type === 'timedTrigger' ? 'Tempo' : element.type === 'input' ? 'Envio' : 'Ação'} ${index + 1}`;
      normalized.actionConfig = config;
      return normalized;
    });
  element.interactionTriggers = normalizedTriggers.length ? normalizedTriggers : [createInteractionTrigger(element.type)];
  element.actionConfig = element.interactionTriggers[0].actionConfig;
};

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
    const popup = window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
    if (!popup) {
      window.location.href = parsed.toString();
    }
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
  'addText',
  'replaceText',
  'addImage',
  'addAudio',
  'addVideo',
  'addQuiz',
  'playAudio',
  'pauseVideo',
  'playVideo',
  'seekVideo',
  'showElement',
  'hideElement',
  'moveElement',
  'playAnimation'
]);
const VIDEO_TRIGGER_TARGET_ACTIONS = new Set([
  'replaceText',
  'playAudio',
  'pauseVideo',
  'playVideo',
  'seekVideo',
  'showElement',
  'hideElement',
  'moveElement',
  'playAnimation'
]);

const normalizeVideoTriggerConfig = (element) => {
  if (!element || element.type !== 'video') {
    return;
  }
  normalizeMediaCaptionConfig(element, 'video');
  element.width = Math.max(220, Number(element.width) || 320);
  element.height = Math.max(140, Number(element.height) || 190);
  const sourceTriggers = Array.isArray(element.videoTriggers) ? element.videoTriggers : [];
  const normalizedTriggers = (sourceTriggers.length
    ? sourceTriggers
    : [
      {
        time: element.videoTriggerTime,
        action: element.videoTriggerAction,
        seekTime: element.videoTriggerSeekTime,
        targetElementId: element.videoTriggerTargetElementId
      }
    ])
    .slice(0, MAX_ELEMENT_TRIGGER_COUNT)
    .map((trigger, index) => {
      const normalized = createVideoTrigger(trigger);
      const actionType = VIDEO_TRIGGER_ACTIONS.has(String(normalized.actionConfig?.type || 'none'))
        ? String(normalized.actionConfig?.type || 'none')
        : 'none';
      normalized.time = Math.max(0, Number(normalized.time) || 0);
      normalized.name = normalized.name || `Tempo ${index + 1}`;
      normalized.actionConfig.type = actionType;
      normalized.actionConfig.targetSlideId =
        typeof normalized.actionConfig.targetSlideId === 'string' ? normalized.actionConfig.targetSlideId : '';
      normalized.actionConfig.targetElementId =
        typeof normalized.actionConfig.targetElementId === 'string' ? normalized.actionConfig.targetElementId : '';
      normalized.actionConfig.url = typeof normalized.actionConfig.url === 'string' ? normalized.actionConfig.url : '';
      normalized.actionConfig.text = normalized.actionConfig.text || 'Novo texto';
      normalized.actionConfig.audioVisible =
        typeof normalized.actionConfig.audioVisible === 'boolean' ? normalized.actionConfig.audioVisible : true;
      normalized.actionConfig.audioLoop = Boolean(normalized.actionConfig.audioLoop);
      normalized.actionConfig.textColor = normalized.actionConfig.textColor || DEFAULT_INSERT_TEXT_STYLE.textColor;
      normalized.actionConfig.backgroundColor = normalized.actionConfig.backgroundColor || DEFAULT_INSERT_TEXT_STYLE.backgroundColor;
      normalized.actionConfig.textAlign = normalized.actionConfig.textAlign || DEFAULT_INSERT_TEXT_STYLE.textAlign;
      normalized.actionConfig.fontFamily = normalized.actionConfig.fontFamily || DEFAULT_INSERT_TEXT_STYLE.fontFamily;
      normalized.actionConfig.fontWeight = normalized.actionConfig.fontWeight || DEFAULT_INSERT_TEXT_STYLE.fontWeight;
      normalized.actionConfig.fontSize = Number.isFinite(Number(normalized.actionConfig.fontSize))
        ? Number(normalized.actionConfig.fontSize)
        : DEFAULT_INSERT_TEXT_STYLE.fontSize;
      const textFlags = getTextDecorationFlags(normalized.actionConfig, DEFAULT_INSERT_TEXT_STYLE);
      normalized.actionConfig.hasTextBackground = textFlags.hasTextBackground;
      normalized.actionConfig.hasTextBorder = textFlags.hasTextBorder;
      normalized.actionConfig.hasTextBlock = textFlags.legacyBlock;
      normalized.actionConfig.insertX = Number.isFinite(Number(normalized.actionConfig.insertX))
        ? Number(normalized.actionConfig.insertX)
        : 120;
      normalized.actionConfig.insertY = Number.isFinite(Number(normalized.actionConfig.insertY))
        ? Number(normalized.actionConfig.insertY)
        : 120;
      normalized.actionConfig.insertWidth = Number.isFinite(Number(normalized.actionConfig.insertWidth))
        ? Number(normalized.actionConfig.insertWidth)
        : 280;
      normalized.actionConfig.insertHeight = Number.isFinite(Number(normalized.actionConfig.insertHeight))
        ? Number(normalized.actionConfig.insertHeight)
        : 180;
      normalized.actionConfig.moveByX = Number.isFinite(Number(normalized.actionConfig.moveByX))
        ? Number(normalized.actionConfig.moveByX)
        : 160;
      normalized.actionConfig.moveByY = Number.isFinite(Number(normalized.actionConfig.moveByY))
        ? Number(normalized.actionConfig.moveByY)
        : 0;
      normalized.actionConfig.moveDuration = Number.isFinite(Number(normalized.actionConfig.moveDuration))
        ? Number(normalized.actionConfig.moveDuration)
        : 0.8;
      normalized.actionConfig.videoTime = Number.isFinite(Number(normalized.actionConfig.videoTime))
        ? Number(normalized.actionConfig.videoTime)
        : 0;
      normalized.actionConfig.replaceMode = getReplaceTextMode(normalized.actionConfig.replaceMode);
      normalized.actionConfig.replaceText =
        typeof normalized.actionConfig.replaceText === 'string' ? normalized.actionConfig.replaceText : '';
      normalized.actionConfig.replaceCounterStart = Number.isFinite(Number(normalized.actionConfig.replaceCounterStart))
        ? Number(normalized.actionConfig.replaceCounterStart)
        : 1;
      normalized.actionConfig.replaceCounterStep = Number.isFinite(Number(normalized.actionConfig.replaceCounterStep))
        ? Number(normalized.actionConfig.replaceCounterStep)
        : 1;
      normalized.actionConfig.quizQuestion = normalized.actionConfig.quizQuestion || 'Nova pergunta';
      normalized.actionConfig.quizOptions =
        Array.isArray(normalized.actionConfig.quizOptions) && normalized.actionConfig.quizOptions.length
          ? normalized.actionConfig.quizOptions
          : createDefaultQuizOptions();
      normalized.actionConfig.quizCorrectOption = Math.min(
        Math.max(Number(normalized.actionConfig.quizCorrectOption) || 0, 0),
        normalized.actionConfig.quizOptions.length - 1
      );
      normalized.actionConfig.successMessage = normalized.actionConfig.successMessage || 'Resposta correta!';
      normalized.actionConfig.errorMessage = normalized.actionConfig.errorMessage || 'Resposta incorreta. Tente novamente.';
      normalized.actionConfig.actionLabel = normalized.actionConfig.actionLabel || 'Validar resposta';
      normalized.actionConfig.quizBackgroundColor = normalized.actionConfig.quizBackgroundColor || '#ffffff';
      normalized.actionConfig.quizQuestionColor = normalized.actionConfig.quizQuestionColor || '#171934';
      normalized.actionConfig.quizOptionBackgroundColor = normalized.actionConfig.quizOptionBackgroundColor || '#f4f6ff';
      normalized.actionConfig.quizOptionTextColor = normalized.actionConfig.quizOptionTextColor || '#25284c';
      normalized.actionConfig.quizButtonBackgroundColor = normalized.actionConfig.quizButtonBackgroundColor || '#6d63ff';
      normalized.actionConfig.points = Math.max(1, Number(normalized.actionConfig.points) || 1);
      normalized.actionConfig.lockOnWrong = Boolean(normalized.actionConfig.lockOnWrong);
      normalized.actionConfig.playSourceVideoOnValidate = Boolean(normalized.actionConfig.playSourceVideoOnValidate);
      return normalized;
    });
  element.videoTriggers = normalizedTriggers.filter((trigger) => trigger.enabled || trigger.time > 0 || trigger.actionConfig.type !== 'none');
  if (!element.videoTriggers.length) {
    element.videoTriggers = [createVideoTrigger()];
  }
  element.videoTriggerTime = element.videoTriggers[0].time;
  element.videoTriggerAction = element.videoTriggers[0].actionConfig.type;
  element.videoTriggerSeekTime = element.videoTriggers[0].actionConfig.videoTime;
  element.videoTriggerTargetElementId = element.videoTriggers[0].actionConfig.targetElementId;
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

const syncTextInputValue = (control, nextValue = '') => {
  if (!control) {
    return;
  }
  if (document.activeElement === control) {
    return;
  }
  const normalizedValue = String(nextValue ?? '');
  if (control.value !== normalizedValue) {
    control.value = normalizedValue;
  }
};

const renderFloatingInputCompareImagePreview = (referenceImage = '') => {
  if (!floatingInputCompareImagePreview) {
    return;
  }
  const nextValue = String(referenceImage || '').trim();
  if (!nextValue) {
    floatingInputCompareImagePreview.innerHTML = '';
    floatingInputCompareImagePreview.classList.add('hidden');
    return;
  }
  floatingInputCompareImagePreview.innerHTML = `<img src="${escapeAttribute(nextValue)}" alt="Imagem de referência" class="input-compare-reference-preview-image" />`;
  floatingInputCompareImagePreview.classList.remove('hidden');
};

const updateElementMenuTriggerVisibility = () => {
  if (!slideCanvas) {
    return;
  }
  slideCanvas.querySelectorAll('.element-menu-trigger').forEach((trigger) => {
    const isVisible = trigger.dataset.elementMenuTrigger === activeElementMenuTriggerId;
    trigger.classList.toggle('is-visible', isVisible);
    trigger.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    trigger.tabIndex = isVisible ? 0 : -1;
  });
};

const showElementMenuTrigger = (elementId) => {
  clearTimeout(elementMenuHideTimer);
  elementMenuHideTimer = null;
  if (activeElementMenuTriggerId === elementId) {
    updateElementMenuTriggerVisibility();
    return;
  }
  activeElementMenuTriggerId = elementId || null;
  updateElementMenuTriggerVisibility();
};

const scheduleHideElementMenuTrigger = (elementId) => {
  clearTimeout(elementMenuHideTimer);
  elementMenuHideTimer = setTimeout(() => {
    if (!elementId || activeElementMenuTriggerId === elementId) {
      activeElementMenuTriggerId = null;
      updateElementMenuTriggerVisibility();
    }
  }, 90);
};

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

const registerPreviewFloatingRuleClick = (slide, element, trigger) => {
  const config = trigger?.actionConfig || {};
  if (!slide || !element?.id || !trigger?.id || !config.requireAllButtonsInGroup) {
    return { ready: true, remaining: 0 };
  }
  const ruleGroup = String(config.ruleGroup || '').trim();
  if (!ruleGroup) {
    return { ready: false, remaining: 1, invalid: true };
  }
  const requiredButtons = (slide.elements || []).filter((item) => {
    if (item?.type !== 'floatingButton' || !item?.id) return false;
    normalizeFloatingActionConfig(item);
    return (item.interactionTriggers || []).some((candidateTrigger) => {
      const candidateConfig = candidateTrigger?.actionConfig || {};
      return candidateConfig.requireAllButtonsInGroup && String(candidateConfig.ruleGroup || '').trim() === ruleGroup;
    });
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
  normalizeFloatingActionConfig(element);
  const isCompleted = (element.interactionTriggers || []).some((trigger) => {
    const ruleGroup = String(trigger?.actionConfig?.ruleGroup || '').trim();
    if (!ruleGroup || !trigger?.actionConfig?.requireAllButtonsInGroup) {
      return false;
    }
    const stateKey = getPreviewRuleStateKey(slide.id, ruleGroup);
    const clickedIds = previewState.clickedRuleButtons.get(stateKey) || new Set();
    return clickedIds.has(elementId);
  });
  node.classList.toggle('floating-button-completed', isCompleted);
};

const getSelectedActionTriggerElement = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  return ['floatingButton', 'detector', 'timedTrigger', 'input'].includes(element?.type) ? element : null;
};

const getSelectedFloatingTrigger = (element = getSelectedActionTriggerElement()) => {
  if (!element) {
    return null;
  }
  normalizeFloatingActionConfig(element);
  if (!selectedFloatingTriggerId || !element.interactionTriggers.some((trigger) => trigger.id === selectedFloatingTriggerId)) {
    selectedFloatingTriggerId = element.interactionTriggers[0]?.id || null;
  }
  return element.interactionTriggers.find((trigger) => trigger.id === selectedFloatingTriggerId) || element.interactionTriggers[0] || null;
};

const getSelectedVideoTrigger = (element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'video')) => {
  if (!element) {
    return null;
  }
  normalizeVideoTriggerConfig(element);
  if (!selectedVideoTriggerId || !element.videoTriggers.some((trigger) => trigger.id === selectedVideoTriggerId)) {
    selectedVideoTriggerId = element.videoTriggers[0]?.id || null;
  }
  return element.videoTriggers.find((trigger) => trigger.id === selectedVideoTriggerId) || element.videoTriggers[0] || null;
};

const getVideoTriggerTargetCandidateIds = (actionType = 'none', sourceElement = null) =>
  getFloatingTargetCandidateIds(actionType, sourceElement);

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

const addFloatingTrigger = () => {
  const element = getSelectedActionTriggerElement();
  if (!element) {
    return;
  }
  normalizeFloatingActionConfig(element);
  if ((element.interactionTriggers || []).length >= MAX_ELEMENT_TRIGGER_COUNT) {
    alert(`Limite de ${MAX_ELEMENT_TRIGGER_COUNT} gatilhos por elemento atingido.`);
    return;
  }
  const trigger = createInteractionTrigger(element.type, {
    name:
      element.type === 'detector'
        ? `Gatilho ${(element.interactionTriggers || []).length + 1}`
        : element.type === 'timedTrigger'
          ? `Tempo ${(element.interactionTriggers || []).length + 1}`
          : element.type === 'input'
            ? `Envio ${(element.interactionTriggers || []).length + 1}`
            : `Ação ${(element.interactionTriggers || []).length + 1}`
  });
  element.interactionTriggers.push(trigger);
  selectedFloatingTriggerId = trigger.id;
  renderSlide();
  updateFloatingButtonEditorVisibility(element, { forceOpen: true });
  scheduleHistoryCommit();
};

const duplicateFloatingTrigger = () => {
  const element = getSelectedActionTriggerElement();
  const trigger = getSelectedFloatingTrigger(element);
  if (!element || !trigger) {
    return;
  }
  if ((element.interactionTriggers || []).length >= MAX_ELEMENT_TRIGGER_COUNT) {
    alert(`Limite de ${MAX_ELEMENT_TRIGGER_COUNT} gatilhos por elemento atingido.`);
    return;
  }
  const clone = createInteractionTrigger(element.type, {
    ...JSON.parse(JSON.stringify(trigger)),
    name: `${trigger.name || (element.type === 'timedTrigger' ? 'Tempo' : 'Ação')} copia`
  });
  element.interactionTriggers.push(clone);
  selectedFloatingTriggerId = clone.id;
  renderSlide();
  updateFloatingButtonEditorVisibility(element, { forceOpen: true });
  scheduleHistoryCommit();
};

const removeFloatingTrigger = () => {
  const element = getSelectedActionTriggerElement();
  const trigger = getSelectedFloatingTrigger(element);
  if (!element || !trigger) {
    return;
  }
  normalizeFloatingActionConfig(element);
  if ((element.interactionTriggers || []).length <= 1) {
    element.interactionTriggers = [createInteractionTrigger(element.type)];
  } else {
    element.interactionTriggers = element.interactionTriggers.filter((item) => item.id !== trigger.id);
  }
  selectedFloatingTriggerId = element.interactionTriggers[0]?.id || null;
  element.actionConfig = element.interactionTriggers[0]?.actionConfig || createDefaultActionConfig();
  renderSlide();
  updateFloatingButtonEditorVisibility(element, { forceOpen: true });
  scheduleHistoryCommit();
};

const addVideoTrigger = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'video');
  if (!element) {
    return;
  }
  normalizeVideoTriggerConfig(element);
  if ((element.videoTriggers || []).length >= MAX_ELEMENT_TRIGGER_COUNT) {
    alert(`Limite de ${MAX_ELEMENT_TRIGGER_COUNT} gatilhos por vídeo atingido.`);
    return;
  }
  const trigger = createVideoTrigger({ name: `Tempo ${(element.videoTriggers || []).length + 1}` });
  element.videoTriggers.push(trigger);
  selectedVideoTriggerId = trigger.id;
  updateVideoEditorVisibility(element, { forceOpen: true });
  scheduleHistoryCommit();
};

const duplicateVideoTrigger = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'video');
  const trigger = getSelectedVideoTrigger(element);
  if (!element || !trigger) {
    return;
  }
  if ((element.videoTriggers || []).length >= MAX_ELEMENT_TRIGGER_COUNT) {
    alert(`Limite de ${MAX_ELEMENT_TRIGGER_COUNT} gatilhos por vídeo atingido.`);
    return;
  }
  const clone = createVideoTrigger({
    ...JSON.parse(JSON.stringify(trigger)),
    name: `${trigger.name || 'Tempo'} copia`
  });
  element.videoTriggers.push(clone);
  selectedVideoTriggerId = clone.id;
  updateVideoEditorVisibility(element, { forceOpen: true });
  scheduleHistoryCommit();
};

const removeVideoTrigger = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'video');
  const trigger = getSelectedVideoTrigger(element);
  if (!element || !trigger) {
    return;
  }
  normalizeVideoTriggerConfig(element);
  if ((element.videoTriggers || []).length <= 1) {
    element.videoTriggers = [createVideoTrigger()];
  } else {
    element.videoTriggers = element.videoTriggers.filter((item) => item.id !== trigger.id);
  }
  selectedVideoTriggerId = element.videoTriggers[0]?.id || null;
  updateVideoEditorVisibility(element, { forceOpen: true });
  scheduleHistoryCommit();
};

const clearPreviewTimedSlideTriggerTimers = () => {
  (previewState.timedSlideTriggerTimers || []).forEach((timerId) => window.clearTimeout(timerId));
  previewState.timedSlideTriggerTimers = [];
};

const getPreviewTimedSlideTriggerKey = (slideId, triggerId) => `${slideId || 'slide'}::${triggerId || 'trigger'}`;

const shouldRerenderAfterTimedAction = (actionType = 'none') =>
  !['playAudio', 'playVideo', 'pauseVideo', 'seekVideo', 'moveElement', 'playAnimation'].includes(actionType);

const schedulePreviewTimedSlideTriggers = (slide) => {
  if (!previewState.active || !slide?.id) {
    clearPreviewTimedSlideTriggerTimers();
    previewState.activeTimedSlideId = null;
    previewState.slideEnteredAt = 0;
    return;
  }
  if (previewState.activeTimedSlideId !== slide.id) {
    clearPreviewTimedSlideTriggerTimers();
    previewState.activeTimedSlideId = slide.id;
    previewState.slideEnteredAt = Date.now();
  } else if ((previewState.timedSlideTriggerTimers || []).length) {
    return;
  }
  const elapsedMs = Math.max(0, Date.now() - (previewState.slideEnteredAt || Date.now()));
  const triggers = (slide.elements || [])
    .filter((element) => element?.type === 'timedTrigger')
    .flatMap((element) => {
      normalizeFloatingActionConfig(element);
      return (element.interactionTriggers || [])
        .filter((trigger) => trigger?.enabled !== false && (trigger.actionConfig?.type || 'none') !== 'none')
        .map((trigger) => ({ element, trigger }));
    });
  triggers.forEach(({ element, trigger }) => {
    const stateKey = getPreviewTimedSlideTriggerKey(slide.id, trigger.id);
    if (previewState.timedSlideTriggers.get(stateKey) === true) {
      return;
    }
    const delay = Math.max(0, Math.round(Math.max(0, Number(trigger.time) || 0) * 1000 - elapsedMs));
    const timerId = window.setTimeout(() => {
      previewState.timedSlideTriggerTimers = (previewState.timedSlideTriggerTimers || []).filter((item) => item !== timerId);
      const activeSlide = getPreviewActiveSlide();
      if (!previewState.active || activeSlide?.id !== slide.id) {
        return;
      }
      if (previewState.timedSlideTriggers.get(stateKey) === true) {
        return;
      }
      previewState.timedSlideTriggers.set(stateKey, true);
      const didExecute = executePreviewActionConfig(element, trigger.actionConfig || {}, activeSlide);
      if (!didExecute) {
        return;
      }
      if (activeSlide.id !== getPreviewActiveSlide()?.id || shouldRerenderAfterTimedAction(trigger.actionConfig?.type || 'none')) {
        renderSlide();
      }
    }, delay);
    previewState.timedSlideTriggerTimers.push(timerId);
  });
};

const getFloatingInsertPreviewRect = (config) => {
  const { width: stageWidth, height: stageHeight } = getStageDimensions();
  const width = Number.isFinite(Number(config?.insertWidth)) ? Number(config.insertWidth) : 280;
  const height = Number.isFinite(Number(config?.insertHeight)) ? Number(config.insertHeight) : 180;
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
        ? ['text', 'block', 'image', 'audio', 'video', 'quiz', 'floatingButton', 'input', 'detector', 'animatedArrow']
        : actionType === 'moveElement'
          ? ['text', 'block', 'image', 'input']
          : actionType === 'replaceText'
            ? Array.from(REPLACEABLE_TEXT_TYPES)
            : actionType === 'playAnimation'
              ? Array.from(ANIMATABLE_ELEMENT_TYPES)
              : [];
  const allowSourceElementAsTarget =
    (['playVideo', 'pauseVideo', 'seekVideo'].includes(actionType) &&
      sourceElement?.type === 'video' &&
      sourceElement?.provider !== 'youtube') ||
    (actionType === 'playAudio' && sourceElement?.type === 'audio');
  return new Set(
    (slide?.elements || [])
      .filter((item) => {
        if (!item?.id || !allowedTypes.includes(item.type)) {
          return false;
        }
        if (item.id === sourceElement?.id && !allowSourceElementAsTarget) {
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

const canActionTriggerElementPlaceInsertedContent = (element, actionType = 'none') =>
  ['floatingButton', 'detector', 'timedTrigger', 'input'].includes(element?.type) && FLOATING_INSERT_ACTIONS.includes(actionType);

const updateFloatingPlacementControls = (element) => {
  const selectedTrigger = getSelectedFloatingTrigger(element);
  const actionType = selectedTrigger?.actionConfig?.type || 'none';
  const supportsPlacement = canActionTriggerElementPlaceInsertedContent(element, actionType);
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

const updateVideoPlacementControls = (element) => {
  const isVideo = element?.type === 'video';
  const selectedTrigger = getSelectedVideoTrigger(element);
  const actionType = selectedTrigger?.actionConfig?.type || 'none';
  const supportsPlacement = isVideo && FLOATING_INSERT_ACTIONS.includes(actionType);
  document.getElementById('videoPlacementToolsField')?.classList.toggle('hidden', !supportsPlacement);
  if (videoPickPlacementBtn) {
    videoPickPlacementBtn.textContent = isPickingFloatingInsertPosition && supportsPlacement ? 'Clique no palco...' : 'Marcar no palco';
    videoPickPlacementBtn.classList.toggle('active', isPickingFloatingInsertPosition && supportsPlacement);
    videoPickPlacementBtn.disabled = !supportsPlacement;
  }
  if (videoPlacementHint) {
    videoPlacementHint.textContent = supportsPlacement
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
    if (currentStageEditor !== 'video') {
      isPickingFloatingInsertPosition = false;
    }
    isPickingFloatingTargetElement = false;
    updateFloatingPlacementControls(null);
    return;
  }
  normalizeFloatingActionConfig(element);
  const selectedTrigger = getSelectedFloatingTrigger(element);
  const actionType = selectedTrigger?.actionConfig?.type || 'none';
  if (!FLOATING_INSERT_ACTIONS.includes(actionType)) {
    isPickingFloatingInsertPosition = false;
  }
  if (!['moveElement', 'playAnimation', 'replaceText'].includes(actionType)) {
    isPickingFloatingTargetElement = false;
  }
  if (FLOATING_INSERT_ACTIONS.includes(actionType)) {
    const preview = document.createElement('div');
    const rect = getFloatingInsertPreviewRect(selectedTrigger?.actionConfig);
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

const updateVideoPlacementPreview = () => {
  if (!slideCanvas) return;
  slideCanvas.querySelectorAll('.video-placement-preview').forEach((node) => node.remove());
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'video');
  if (!element || currentStageEditor !== 'video') {
    updateVideoPlacementControls(null);
    return;
  }
  normalizeVideoTriggerConfig(element);
  const selectedTrigger = getSelectedVideoTrigger(element);
  const actionType = selectedTrigger?.actionConfig?.type || 'none';
  if (!FLOATING_INSERT_ACTIONS.includes(actionType)) {
    if (isPickingFloatingInsertPosition) {
      isPickingFloatingInsertPosition = false;
    }
    updateVideoPlacementControls(element);
    return;
  }
  const preview = document.createElement('div');
  const rect = getFloatingInsertPreviewRect(selectedTrigger?.actionConfig);
  preview.className = `floating-placement-preview video-placement-preview${isPickingFloatingInsertPosition ? ' picking' : ''}`;
  preview.dataset.label = `Prévia ${rect.width}x${rect.height}`;
  preview.style.left = `${rect.x}px`;
  preview.style.top = `${rect.y}px`;
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  slideCanvas.appendChild(preview);
  updateVideoPlacementControls(element);
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
    playSourceVideoOnValidate: Boolean(source.playSourceVideoOnValidate),
    sourceVideoElementId: source.sourceVideoElementId || '',
    width: Number.isFinite(Number(source.insertWidth)) ? Number(source.insertWidth) : 420,
    height: Number.isFinite(Number(source.insertHeight)) ? Number(source.insertHeight) : 280
  };
};

const canStudentDragElement = (element) => STUDENT_DRAGGABLE_TYPES.has(element?.type) && Boolean(element?.studentCanDrag);

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

const findPreviewNodeByElementId = (elementId) =>
  slideCanvas?.querySelector(`[data-element-id="${escapeAttributeSelectorValue(elementId)}"]`) || null;

const getPreviewMediaStateKey = (slideId = '', elementId = '') => `${slideId}::${elementId}`;
const getPreviewTimedVideoTriggerKey = (slideId = '', elementId = '') => `${slideId}::${elementId}`;

const snapshotPreviewMediaState = (slide) => {
  if (!previewState.active || !slide?.id || !slideCanvas) {
    return;
  }
  slideCanvas.querySelectorAll('[data-element-id]').forEach((node) => {
    const elementId = node.getAttribute('data-element-id') || '';
    if (!elementId) {
      return;
    }
    const mediaNode = getPreviewMediaNode(node);
    if (mediaNode instanceof HTMLVideoElement || mediaNode instanceof HTMLAudioElement) {
      previewState.mediaState.set(getPreviewMediaStateKey(slide.id, elementId), {
        currentTime: Math.max(0, Number(mediaNode.currentTime) || 0),
        paused: mediaNode.paused
      });
    }
  });
};

const restorePreviewMediaState = (slide, element, node) => {
  if (!previewState.active || !slide?.id || !element?.id) {
    return;
  }
  const mediaNode = getPreviewMediaNode(node);
  if (!(mediaNode instanceof HTMLVideoElement) && !(mediaNode instanceof HTMLAudioElement)) {
    return;
  }
  const state = previewState.mediaState.get(getPreviewMediaStateKey(slide.id, element.id));
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
  const node = getPreviewMediaNode(findPreviewNodeByElementId(targetElementId));
  if (!(node instanceof HTMLAudioElement)) {
    return false;
  }
  node.currentTime = 0;
  node.play().catch(() => { });
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
  const node = getPreviewMediaNode(findPreviewNodeByElementId(targetElementId));
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

const attachPreviewVideoTimedTrigger = (videoNode, element) => {
  normalizeVideoTriggerConfig(element);
  if (!(videoNode instanceof HTMLVideoElement) || element.provider === 'youtube') {
    return;
  }
  const slide = getPreviewActiveSlide();
  if (!slide?.id || !element?.id) {
    return;
  }
  const triggers = (element.videoTriggers || []).filter(
    (trigger) => trigger?.enabled !== false && (trigger.actionConfig?.type || 'none') !== 'none' && Number(trigger.time) > 0
  );
  if (!triggers.length) {
    return;
  }
  const stateKey = getPreviewTimedVideoTriggerKey(slide.id, element.id);
  const firedIds = new Set(previewState.timedVideoTriggers.get(stateKey) || []);
  previewState.timedVideoTriggers.set(stateKey, firedIds);
  const resetIfNeeded = () => {
    const currentTime = Number(videoNode.currentTime) || 0;
    triggers.forEach((trigger) => {
      if (currentTime < Math.max(0, Number(trigger.time) || 0)) {
        firedIds.delete(trigger.id);
      }
    });
    previewState.timedVideoTriggers.set(stateKey, new Set(firedIds));
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
      previewState.timedVideoTriggers.set(stateKey, new Set(firedIds));
      const actionConfig = {
        ...(trigger.actionConfig || {}),
        targetElementId: resolveVideoTriggerActionTargetElementId(element, trigger)
      };
      const didExecute = executePreviewActionConfig(element, actionConfig, getPreviewActiveSlide());
      if (didExecute && !['playAudio', 'playVideo', 'pauseVideo', 'seekVideo', 'moveElement', 'playAnimation'].includes(actionConfig.type || 'none')) {
        shouldRerender = true;
      }
    });
    if (shouldRerender) {
      renderSlide();
    }
  });
  videoNode.addEventListener('ended', () => {
    firedIds.clear();
    previewState.timedVideoTriggers.delete(stateKey);
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
    case 'redirect':
      return openExternalRedirect(safeConfig.url);
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
      const sourceVideoElementId = element?.type === 'video' ? element.id : (safeConfig.sourceVideoElementId || '');
      const hasExistingRuntimeElement = slide.elements.some(
        (item) => item?.isRuntimeGenerated && item.runtimeSourceId === runtimeSourceId && item.runtimeActionType === runtimeActionType
      );
      if (hasExistingRuntimeElement) {
        slide.elements = slide.elements.filter(
          (item) => !(item?.isRuntimeGenerated && item.runtimeSourceId === runtimeSourceId && item.runtimeActionType === runtimeActionType)
        );
      } else {
        slide.elements.push(
          createPreviewRuntimeElement(
            elementTypeMap[safeConfig.type],
            { ...safeConfig, runtimeSourceId, runtimeActionType, sourceVideoElementId },
            slide
          )
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
      normalizeFloatingActionConfig(detector);
      (detector.interactionTriggers || []).forEach((trigger) => {
        if (trigger?.enabled === false) {
          return;
        }
        const didTrigger = executePreviewActionConfig(detector, trigger.actionConfig || {}, slide);
        activated = didTrigger || activated;
        if (didTrigger && trigger.actionConfig?.detectorTriggerOnce) {
          markPreviewDetectorTriggered(slide, detector);
        }
      });
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

const executePreviewFloatingButtonTriggers = (element) => {
  const slide = getPreviewActiveSlide();
  if (!slide || !element) return;
  normalizeFloatingActionConfig(element);
  let executedCount = 0;
  let blockedRuleState = null;
  (element.interactionTriggers || []).forEach((trigger) => {
    if (trigger?.enabled === false) {
      return;
    }
    const ruleState = registerPreviewFloatingRuleClick(slide, element, trigger);
    if (!ruleState.ready) {
      blockedRuleState = blockedRuleState || ruleState;
      return;
    }
    if (executePreviewActionConfig(element, trigger.actionConfig || {}, slide)) {
      executedCount += 1;
    }
  });
  syncPreviewFloatingRuleButtonState(slide, element.id);
  if (!executedCount && blockedRuleState) {
    if (blockedRuleState.invalid) {
      alert('Essa regra precisa de um nome de grupo e de pelo menos 2 botões no mesmo slide.');
    } else {
      alert(`Faltam ${blockedRuleState.remaining} botão(ões) desta regra para liberar a ação.`);
    }
    return;
  }
  if (executedCount > 0) {
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

const createBuilderDraftPayload = () => ({
  slides: deepClone(builderState.slides || []),
  activeSlideId: builderState.activeSlideId || null,
  selectedElementId,
  moduleTitle: moduleTitleInput?.value || '',
  moduleDescription: moduleDescriptionInput?.value || '',
  selectedCourseId: moduleCourseSelect?.value || '',
  stageSize:
    builderState.stageSize.width > 0 && builderState.stageSize.height > 0
      ? deepClone(builderState.stageSize)
      : { ...DEFAULT_STAGE_SIZE },
  moduleSettings: deepClone(builderState.moduleSettings || {}),
  editingModuleId: editingModuleId || null,
  editingCourseId: editingCourseId || null,
  editingModuleCourseId: editingModuleCourseId || null,
  savedAt: new Date().toISOString()
});

const persistBuilderDraftLocally = () => {
  try {
    localStorage.setItem(BUILDER_DRAFT_STORAGE_KEY, JSON.stringify(createBuilderDraftPayload()));
  } catch (error) {
    console.warn('Nao foi possivel salvar o rascunho local.', error);
  }
};

const getBuilderAutosaveTarget = () => {
  const courseId = editingModuleCourseId || editingCourseId || moduleCourseSelect?.value || '';
  const title = moduleTitleInput?.value?.trim() || '';
  if (!editingModuleId || !courseId || !title) {
    return null;
  }
  return { courseId, moduleId: editingModuleId, title };
};

const persistBuilderDraftRemotely = async () => {
  const target = getBuilderAutosaveTarget();
  if (!target) {
    return;
  }
  try {
    updateBuilderStageSize();
    await authorizedFetch(`/api/admin/courses/${target.courseId}/modules/${target.moduleId}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: target.title,
        description: moduleDescriptionInput?.value?.trim() || null,
        slug: createSlug(target.title),
        builderData: {
          slides: deepClone(builderState.slides || []),
          stageSize:
            builderState.stageSize.width > 0 && builderState.stageSize.height > 0
              ? deepClone(builderState.stageSize)
              : { ...DEFAULT_STAGE_SIZE },
          moduleSettings: {
            lockNextModuleUntilCompleted: Boolean(builderState.moduleSettings?.lockNextModuleUntilCompleted),
            isPublic: Boolean(builderState.moduleSettings?.isPublic),
            coverImage: getModuleCoverValue()
          }
        }
      })
    });
  } catch (error) {
    console.warn('Nao foi possivel sincronizar o rascunho remoto.', error);
  }
};

const scheduleBuilderAutosave = () => {
  if (!draftRestoreCompleted) {
    return;
  }
  clearTimeout(autosaveState.localTimer);
  autosaveState.localTimer = setTimeout(() => {
    persistBuilderDraftLocally();
  }, 250);
  clearTimeout(autosaveState.remoteTimer);
  autosaveState.remoteTimer = setTimeout(() => {
    persistBuilderDraftRemotely();
  }, 1800);
};

const restoreBuilderDraftIfAvailable = () => {
  let rawDraft = '';
  try {
    rawDraft = localStorage.getItem(BUILDER_DRAFT_STORAGE_KEY) || '';
  } catch (error) {
    console.warn('Nao foi possivel ler o rascunho local.', error);
    return false;
  }
  if (!rawDraft) {
    return false;
  }
  try {
    const draft = JSON.parse(rawDraft);
    if (!Array.isArray(draft?.slides) || !draft.slides.length) {
      return false;
    }
    historyState.suppressCommit = true;
    builderState.slides = draft.slides;
    builderState.activeSlideId = draft.activeSlideId || draft.slides[0]?.id || null;
    builderState.stageSize = normalizeTemplateStageSize(draft.stageSize);
    builderState.moduleSettings = normalizeTemplateModuleSettings(draft.moduleSettings);
    selectedElementId = draft.selectedElementId || null;
    editingModuleId = draft.editingModuleId || null;
    editingCourseId = draft.editingCourseId || null;
    editingModuleCourseId = draft.editingModuleCourseId || null;
    if (moduleTitleInput) {
      moduleTitleInput.value = draft.moduleTitle || '';
    }
    if (moduleDescriptionInput) {
      moduleDescriptionInput.value = draft.moduleDescription || '';
    }
    if (moduleCoverUrlInput) {
      moduleCoverUrlInput.value = builderState.moduleSettings?.coverImage || '';
    }
    if (moduleCourseSelect && draft.selectedCourseId) {
      moduleCourseSelect.value = draft.selectedCourseId;
      loadCourseModules(draft.selectedCourseId);
    }
    if (moduleCourseSelect) {
      moduleCourseSelect.disabled = Boolean(editingModuleId);
    }
    if (moduleLockNextToggle) {
      moduleLockNextToggle.checked = Boolean(builderState.moduleSettings.lockNextModuleUntilCompleted);
    }
    if (modulePublicToggle) {
      modulePublicToggle.checked = Boolean(builderState.moduleSettings.isPublic);
    }
    setPublicModuleLinkState(
      editingModuleId && builderState.moduleSettings.isPublic
        ? { moduleId: editingModuleId, title: draft.moduleTitle || '' }
        : {}
    );
    updateSaveButtonLabel();
    syncPublicModuleLinkUi();
    renderSlideList();
    renderSlide();
    updateElementInspector(getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null);
    historyState.suppressCommit = false;
    resetHistoryState();
    scheduleBuilderAutosave();
    return true;
  } catch (error) {
    console.warn('Nao foi possivel restaurar o rascunho local.', error);
    return false;
  }
};

const applyEditorSnapshot = (snapshot) => {
  const state = JSON.parse(snapshot);
  historyState.suppressCommit = true;
  builderState.slides = Array.isArray(state.slides) ? state.slides : [];
  builderState.activeSlideId = state.activeSlideId || builderState.slides[0]?.id || null;
  builderState.moduleSettings = normalizeTemplateModuleSettings(state.moduleSettings);
  selectedElementId = state.selectedElementId || null;
  if (moduleTitleInput) {
    moduleTitleInput.value = state.moduleTitle || '';
  }
  if (moduleDescriptionInput) {
    moduleDescriptionInput.value = state.moduleDescription || '';
  }
  if (moduleCoverUrlInput) {
    moduleCoverUrlInput.value = builderState.moduleSettings?.coverImage || '';
  }
  if (moduleLockNextToggle) {
    moduleLockNextToggle.checked = Boolean(builderState.moduleSettings.lockNextModuleUntilCompleted);
  }
  if (modulePublicToggle) {
    modulePublicToggle.checked = Boolean(builderState.moduleSettings.isPublic);
  }
  syncModuleCoverPreview();
  syncPublicModuleLinkUi();
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
    scheduleBuilderAutosave();
    updateHistoryButtons();
    return;
  }
  historyState.past.push(snapshot);
  historyState.future = [];
  scheduleBuilderAutosave();
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
  scheduleBuilderAutosave();
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
  scheduleBuilderAutosave();
  updateHistoryButtons();
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
  const isBatch = Boolean(backgroundBatchToggle?.checked);
  document.getElementById('backgroundSolidColorField')?.classList.toggle('hidden', mode !== 'color-solid');
  document.getElementById('backgroundGradientStartField')?.classList.toggle('hidden', mode !== 'color-gradient');
  document.getElementById('backgroundGradientEndField')?.classList.toggle('hidden', mode !== 'color-gradient');
  document.getElementById('backgroundMediaUrlField')?.classList.toggle('hidden', !['image-url', 'video-url'].includes(mode));
  document.getElementById('backgroundMediaLocalField')?.classList.toggle('hidden', !['image-local', 'video-local'].includes(mode));
  if (backgroundMediaUrlInput && ['image-url', 'video-url'].includes(mode)) {
    backgroundMediaUrlInput.placeholder = isBatch
      ? 'Cole uma URL por linha (ou separadas por ; ou ,)'
      : 'Cole a URL da mídia';
  }
  if (backgroundMediaLocalBtn && ['image-local', 'video-local'].includes(mode)) {
    backgroundMediaLocalBtn.textContent = isBatch ? 'Escolher arquivos' : 'Escolher arquivo';
  }
  if (!backgroundMediaEditorStatus) return;
  if (mode === 'color-solid') {
    backgroundMediaEditorStatus.textContent = 'Escolha uma cor sólida para o fundo do slide.';
    return;
  }
  if (mode === 'color-gradient') {
    backgroundMediaEditorStatus.textContent = 'Escolha duas cores para montar um fundo em gradiente.';
    return;
  }
  if (isBatch && (mode === 'image-url' || mode === 'video-url')) {
    backgroundMediaEditorStatus.textContent = 'Ação em lote ativa: informe várias URLs e criaremos um slide para cada fundo.';
    return;
  }
  if (isBatch && (mode === 'image-local' || mode === 'video-local')) {
    backgroundMediaEditorStatus.textContent = 'Ação em lote ativa: selecione vários arquivos e criaremos um slide para cada fundo.';
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

const readLocalFiles = (input, acceptedPrefix) =>
  new Promise((resolve, reject) => {
    if (!input) {
      reject(new Error('Entrada de arquivo indisponível.'));
      return;
    }
    const hadMultiple = input.hasAttribute('multiple');
    input.setAttribute('multiple', 'multiple');
    input.value = '';
    const handleChange = () => {
      input.removeEventListener('change', handleChange);
      if (!hadMultiple) {
        input.removeAttribute('multiple');
      }
      const files = Array.from(input.files || []);
      if (!files.length) {
        resolve([]);
        return;
      }
      const invalidFile = files.find((file) => !String(file.type || '').startsWith(`${acceptedPrefix}/`));
      if (invalidFile) {
        reject(new Error(`Selecione apenas arquivos de ${acceptedPrefix} válidos.`));
        return;
      }
      Promise.all(
        files.map((file) =>
          new Promise((innerResolve, innerReject) => {
            const reader = new FileReader();
            reader.onload = () => innerResolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => innerReject(new Error(`Não foi possível carregar ${file.name}.`));
            reader.readAsDataURL(file);
          })
        )
      )
        .then((results) => resolve(results.filter(Boolean)))
        .catch(reject);
    };
    input.addEventListener('change', handleChange, { once: true });
    input.click();
  });

const parseBatchBackgroundUrls = (rawValue = '') => {
  const text = String(rawValue || '').trim();
  if (!text) {
    return [];
  }
  const byLines = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (byLines.length > 1) {
    return byLines;
  }
  return text
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

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
  if (imageSourceModeSelect) imageSourceModeSelect.value = 'local';
  if (imageSourceUrlInput) imageSourceUrlInput.value = isImage && element.src && !String(element.src).startsWith('data:') ? element.src : '';
  document.getElementById('imageSourceUrlField')?.classList.toggle('hidden', (imageSourceModeSelect?.value || 'local') !== 'url');
  if (imageElementWidthInput) imageElementWidthInput.value = isImage ? String(element.width || '') : '';
  if (imageElementHeightInput) imageElementHeightInput.value = isImage ? String(element.height || '') : '';
  if (imageElementRotationInput) imageElementRotationInput.value = isImage ? String(element.rotation || 0) : '0';
  if (imageElementObjectFitSelect) imageElementObjectFitSelect.value = isImage ? getElementMediaObjectFit(element) : 'cover';
  if (imageElementStudentDragToggle) imageElementStudentDragToggle.checked = isImage ? Boolean(element.studentCanDrag) : false;
};

const syncAudioEditorControls = (element) => {
  const isAudio = element?.type === 'audio';
  if (isAudio) {
    normalizeAudioElement(element);
  }
  if (audioSourceModeSelect) audioSourceModeSelect.value = 'local';
  if (audioSourceUrlInput) audioSourceUrlInput.value = isAudio && element.src && !String(element.src).startsWith('data:') ? element.src : '';
  document.getElementById('audioSourceUrlField')?.classList.toggle('hidden', (audioSourceModeSelect?.value || 'local') !== 'url');
  if (audioElementWidthInput) audioElementWidthInput.value = isAudio ? String(element.width || '') : '';
  if (audioElementHeightInput) audioElementHeightInput.value = isAudio ? String(element.height || '') : '';
  if (audioElementRotationInput) audioElementRotationInput.value = isAudio ? String(element.rotation || 0) : '0';
  if (audioElementVisibleToggle) audioElementVisibleToggle.checked = isAudio ? Boolean(element.audioVisible) : true;
  if (audioElementLoopToggle) audioElementLoopToggle.checked = isAudio ? Boolean(element.audioLoop) : false;
  if (audioCaptionEnabledToggle) audioCaptionEnabledToggle.checked = isAudio ? Boolean(element.captionsEnabled) : false;
  if (audioCaptionPositionSelect) audioCaptionPositionSelect.value = isAudio ? element.captionStyle?.position || 'bottom' : 'bottom';
  if (audioCaptionWidthInput) audioCaptionWidthInput.value = isAudio && element.captionStyle?.width ? String(element.captionStyle.width) : '';
  if (audioCaptionFontSizeInput) audioCaptionFontSizeInput.value = isAudio ? String(element.captionStyle?.fontSize || 20) : '20';
  if (audioCaptionTextColorInput) audioCaptionTextColorInput.value = isAudio ? element.captionStyle?.textColor || '#ffffff' : '#ffffff';
  if (audioCaptionBackgroundColorInput) {
    audioCaptionBackgroundColorInput.value = isAudio ? (element.captionStyle?.backgroundColor || '#0f172acc').slice(0, 7) : '#0f172a';
  }
  if (audioCaptionAccentColorInput) audioCaptionAccentColorInput.value = isAudio ? element.captionStyle?.accentColor || '#38bdf8' : '#38bdf8';
  if (audioCaptionUppercaseToggle) audioCaptionUppercaseToggle.checked = isAudio ? Boolean(element.captionStyle?.uppercase) : false;
  if (isAudio) {
    renderCaptionSegmentEditor('audio', element);
  }
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
  const hasPen = penEditorCard && !penEditorCard.classList.contains('hidden');
  const hasAnimation = animationEditorCard && !animationEditorCard.classList.contains('hidden');
  const hasAnyEditor = hasText || hasBlock || hasImage || hasAudio || hasQuiz || hasFloating || hasVideo || hasBackground || hasEraser || hasPen || hasAnimation;
  if (stageEditorDock) {
    stageEditorDock.classList.toggle('hidden', !hasAnyEditor);
  }
  if (stageEditorEmpty) {
    stageEditorEmpty.classList.add('hidden');
  }
};

const closeStageEditors = () => {
  currentStageEditor = 'none';
  showElementMenuTrigger(null);
  textEditorCard?.classList.add('hidden');
  blockEditorCard?.classList.add('hidden');
  imageEditorCard?.classList.add('hidden');
  audioEditorCard?.classList.add('hidden');
  quizEditorCard?.classList.add('hidden');
  floatingButtonEditorCard?.classList.add('hidden');
  videoEditorCard?.classList.add('hidden');
  backgroundEditorCard?.classList.add('hidden');
  eraserEditorCard?.classList.add('hidden');
  penEditorCard?.classList.add('hidden');
  animationEditorCard?.classList.add('hidden');
  closeEraserSession({ keepEditor: true });
  closePenSession({ keepEditor: true });
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
    isPickingFloatingInsertPosition = false;
    videoEditorCard.classList.add('hidden');
    updateVideoPlacementControls(null);
    updateStageEditorState();
    return;
  }
  currentStageEditor = 'video';
  lastStageEditorOpenedAt = Date.now();
  normalizeVideoTriggerConfig(element);
  const selectedTrigger = getSelectedVideoTrigger(element);
  videoEditorCard.classList.remove('hidden');
  if (videoTriggerList) {
    videoTriggerList.innerHTML = (element.videoTriggers || [])
      .map((trigger, index) => {
        const isActive = trigger.id === selectedTrigger?.id;
        return `
          <button type="button" class="trigger-chip${isActive ? ' active' : ''}" data-video-trigger-id="${trigger.id}">
            <span>
              <span class="trigger-chip-title">${escapeHtml(trigger.name || `Tempo ${index + 1}`)}</span>
              <small class="trigger-chip-meta">${escapeHtml(`${Number(trigger.time || 0).toFixed(1)}s • ${trigger.actionConfig?.type || 'none'}`)}</small>
            </span>
          </button>
        `;
      })
      .join('');
  }
  if (videoDuplicateTriggerBtn) {
    videoDuplicateTriggerBtn.disabled = !selectedTrigger;
  }
  if (videoRemoveTriggerBtn) {
    videoRemoveTriggerBtn.disabled = (element.videoTriggers || []).length <= 1;
  }
  if (videoTriggerTimeInput) {
    videoTriggerTimeInput.value = String(selectedTrigger?.time || 0);
  }
  if (videoTriggerActionSelect) {
    videoTriggerActionSelect.value = selectedTrigger?.actionConfig?.type || 'none';
  }
  if (videoSourceModeSelect) {
    videoSourceModeSelect.value = 'local';
  }
  if (videoSourceUrlInput) {
    videoSourceUrlInput.value = element.src && !String(element.src).startsWith('data:') ? element.src : '';
  }
  document.getElementById('videoSourceUrlField')?.classList.toggle('hidden', (videoSourceModeSelect?.value || 'local') !== 'url');
  if (videoCaptionEnabledToggle) videoCaptionEnabledToggle.checked = Boolean(element.captionsEnabled);
  if (videoCaptionPositionSelect) videoCaptionPositionSelect.value = element.captionStyle?.position || 'bottom';
  if (videoCaptionWidthInput) videoCaptionWidthInput.value = element.captionStyle?.width ? String(element.captionStyle.width) : '';
  if (videoCaptionFontSizeInput) videoCaptionFontSizeInput.value = String(element.captionStyle?.fontSize || 28);
  if (videoCaptionTextColorInput) videoCaptionTextColorInput.value = element.captionStyle?.textColor || '#ffffff';
  if (videoCaptionBackgroundColorInput) {
    videoCaptionBackgroundColorInput.value = (element.captionStyle?.backgroundColor || '#0f172acc').slice(0, 7);
  }
  if (videoCaptionAccentColorInput) videoCaptionAccentColorInput.value = element.captionStyle?.accentColor || '#facc15';
  if (videoCaptionUppercaseToggle) videoCaptionUppercaseToggle.checked = Boolean(element.captionStyle?.uppercase);
  renderCaptionSegmentEditor('video', element);
  if (videoTriggerTargetSlideSelect) {
    videoTriggerTargetSlideSelect.innerHTML = (builderState.slides || [])
      .filter((slide) => slide?.id)
      .map((slide, index) => `<option value="${slide.id}">${escapeHtml(slide.title || `Slide ${index + 1}`)}</option>`)
      .join('');
    const targetSlideId = selectedTrigger?.actionConfig?.targetSlideId || '';
    videoTriggerTargetSlideSelect.value =
      targetSlideId && videoTriggerTargetSlideSelect.querySelector(`option[value="${targetSlideId}"]`) ? targetSlideId : '';
  }
  if (videoTriggerTargetElementSelect) {
    const actionType = selectedTrigger?.actionConfig?.type || 'none';
    const candidateIds = getVideoTriggerTargetCandidateIds(actionType, element);
    const optionsMarkup = (getActiveSlide()?.elements || [])
      .filter((item) => item?.id && candidateIds.has(item.id))
      .map((item) => `<option value="${item.id}">${escapeHtml(getFloatingTargetElementLabel(item))}</option>`)
      .join('');
    videoTriggerTargetElementSelect.innerHTML = optionsMarkup || '<option value="">Nenhum elemento compatível</option>';
    const nextValue = resolveVideoTriggerActionTargetElementId(element, selectedTrigger);
    videoTriggerTargetElementSelect.value =
      nextValue && videoTriggerTargetElementSelect.querySelector(`option[value="${nextValue}"]`) ? nextValue : '';
  }
  if (videoTriggerSeekTimeInput) {
    videoTriggerSeekTimeInput.value = String(selectedTrigger?.actionConfig?.videoTime || 0);
  }
  if (videoTriggerUrlInput) {
    videoTriggerUrlInput.value = selectedTrigger?.actionConfig?.url || '';
    videoTriggerUrlInput.placeholder =
      ['addImage', 'addAudio', 'addVideo'].includes(selectedTrigger?.actionConfig?.type || 'none')
        ? 'Cole a URL da imagem, áudio ou vídeo'
        : 'https://...';
  }
  const videoTriggerUrlLabel = document.querySelector('label[for="videoTriggerUrlInput"]');
  if (videoTriggerUrlLabel) {
    videoTriggerUrlLabel.textContent =
      ['addImage', 'addAudio', 'addVideo'].includes(selectedTrigger?.actionConfig?.type || 'none')
        ? 'URL da mídia'
        : 'URL de redirecionamento';
  }
  if (videoTriggerActionTextLabel) {
    videoTriggerActionTextLabel.textContent =
      selectedTrigger?.actionConfig?.type === 'replaceText' ? 'Novo conteúdo ou prefixo' : 'Texto a inserir';
  }
  if (videoTriggerActionTextInput) {
    videoTriggerActionTextInput.placeholder =
      selectedTrigger?.actionConfig?.type === 'replaceText' ? 'Ex: Pontos: ' : 'Ex: Bem-vindo à próxima etapa';
    syncTextInputValue(
      videoTriggerActionTextInput,
      selectedTrigger?.actionConfig?.type === 'replaceText'
        ? selectedTrigger?.actionConfig?.replaceText || ''
        : selectedTrigger?.actionConfig?.text || 'Novo texto'
    );
  }
  if (videoTriggerReplaceModeSelect) {
    videoTriggerReplaceModeSelect.value = getReplaceTextMode(selectedTrigger?.actionConfig?.replaceMode);
  }
  if (videoTriggerReplaceCounterStartInput) {
    videoTriggerReplaceCounterStartInput.value = String(selectedTrigger?.actionConfig?.replaceCounterStart ?? 1);
  }
  if (videoTriggerReplaceCounterStepInput) {
    videoTriggerReplaceCounterStepInput.value = String(selectedTrigger?.actionConfig?.replaceCounterStep ?? 1);
  }
  if (videoTriggerAudioVisibleToggle) videoTriggerAudioVisibleToggle.checked = Boolean(selectedTrigger?.actionConfig?.audioVisible);
  if (videoTriggerAudioLoopToggle) videoTriggerAudioLoopToggle.checked = Boolean(selectedTrigger?.actionConfig?.audioLoop);
  if (videoTriggerTextColorInput) videoTriggerTextColorInput.value = selectedTrigger?.actionConfig?.textColor || DEFAULT_INSERT_TEXT_STYLE.textColor;
  if (videoTriggerTextBgColorInput) videoTriggerTextBgColorInput.value = selectedTrigger?.actionConfig?.backgroundColor || DEFAULT_INSERT_TEXT_STYLE.backgroundColor;
  if (videoTriggerTextFontSizeInput) videoTriggerTextFontSizeInput.value = String(selectedTrigger?.actionConfig?.fontSize || DEFAULT_INSERT_TEXT_STYLE.fontSize);
  if (videoTriggerTextFontFamilySelect) videoTriggerTextFontFamilySelect.value = selectedTrigger?.actionConfig?.fontFamily || DEFAULT_INSERT_TEXT_STYLE.fontFamily;
  if (videoTriggerTextFontWeightSelect) videoTriggerTextFontWeightSelect.value = selectedTrigger?.actionConfig?.fontWeight || DEFAULT_INSERT_TEXT_STYLE.fontWeight;
  if (videoTriggerTextAlignSelect) videoTriggerTextAlignSelect.value = selectedTrigger?.actionConfig?.textAlign || DEFAULT_INSERT_TEXT_STYLE.textAlign;
  if (videoTriggerTextBackgroundToggle) videoTriggerTextBackgroundToggle.checked = Boolean(selectedTrigger?.actionConfig?.hasTextBackground);
  if (videoTriggerTextBorderToggle) videoTriggerTextBorderToggle.checked = Boolean(selectedTrigger?.actionConfig?.hasTextBorder);
  if (videoTriggerInsertXInput) videoTriggerInsertXInput.value = String(selectedTrigger?.actionConfig?.insertX ?? 120);
  if (videoTriggerInsertYInput) videoTriggerInsertYInput.value = String(selectedTrigger?.actionConfig?.insertY ?? 120);
  if (videoTriggerInsertWidthInput) videoTriggerInsertWidthInput.value = String(selectedTrigger?.actionConfig?.insertWidth ?? 280);
  if (videoTriggerInsertHeightInput) videoTriggerInsertHeightInput.value = String(selectedTrigger?.actionConfig?.insertHeight ?? 180);
  if (videoTriggerMoveXInput) videoTriggerMoveXInput.value = String(selectedTrigger?.actionConfig?.moveByX ?? 160);
  if (videoTriggerMoveYInput) videoTriggerMoveYInput.value = String(selectedTrigger?.actionConfig?.moveByY ?? 0);
  if (videoTriggerMoveDurationInput) videoTriggerMoveDurationInput.value = String(selectedTrigger?.actionConfig?.moveDuration ?? 0.8);
  if (videoTriggerQuizQuestionInput) syncTextInputValue(videoTriggerQuizQuestionInput, selectedTrigger?.actionConfig?.quizQuestion || 'Nova pergunta');
  if (videoTriggerQuizOptionsInput) syncTextInputValue(videoTriggerQuizOptionsInput, (selectedTrigger?.actionConfig?.quizOptions || createDefaultQuizOptions()).join('\n'));
  if (videoTriggerQuizSuccessInput) syncTextInputValue(videoTriggerQuizSuccessInput, selectedTrigger?.actionConfig?.successMessage || 'Resposta correta!');
  if (videoTriggerQuizErrorInput) syncTextInputValue(videoTriggerQuizErrorInput, selectedTrigger?.actionConfig?.errorMessage || 'Resposta incorreta. Tente novamente.');
  if (videoTriggerQuizActionLabelInput) syncTextInputValue(videoTriggerQuizActionLabelInput, selectedTrigger?.actionConfig?.actionLabel || 'Validar resposta');
  if (videoTriggerQuizBackgroundColorInput) videoTriggerQuizBackgroundColorInput.value = selectedTrigger?.actionConfig?.quizBackgroundColor || '#ffffff';
  if (videoTriggerQuizQuestionColorInput) videoTriggerQuizQuestionColorInput.value = selectedTrigger?.actionConfig?.quizQuestionColor || '#171934';
  if (videoTriggerQuizOptionBackgroundColorInput) videoTriggerQuizOptionBackgroundColorInput.value = selectedTrigger?.actionConfig?.quizOptionBackgroundColor || '#f4f6ff';
  if (videoTriggerQuizOptionTextColorInput) videoTriggerQuizOptionTextColorInput.value = selectedTrigger?.actionConfig?.quizOptionTextColor || '#25284c';
  if (videoTriggerQuizButtonBackgroundColorInput) videoTriggerQuizButtonBackgroundColorInput.value = selectedTrigger?.actionConfig?.quizButtonBackgroundColor || '#6d63ff';
  if (videoTriggerQuizPointsInput) videoTriggerQuizPointsInput.value = String(selectedTrigger?.actionConfig?.points || 1);
  if (videoTriggerQuizLockOnWrongToggle) videoTriggerQuizLockOnWrongToggle.checked = Boolean(selectedTrigger?.actionConfig?.lockOnWrong);
  if (videoTriggerQuizPlaySourceVideoToggle) {
    videoTriggerQuizPlaySourceVideoToggle.checked = Boolean(selectedTrigger?.actionConfig?.playSourceVideoOnValidate);
  }
  if (videoTriggerQuizCorrectSelect) {
    const quizOptions = selectedTrigger?.actionConfig?.quizOptions || createDefaultQuizOptions();
    videoTriggerQuizCorrectSelect.innerHTML = quizOptions
      .map((option, index) => `<option value="${index}">${option || `Alternativa ${index + 1}`}</option>`)
      .join('');
    videoTriggerQuizCorrectSelect.value = String(
      Math.min(Math.max(selectedTrigger?.actionConfig?.quizCorrectOption || 0, 0), Math.max(quizOptions.length - 1, 0))
    );
  }
  const actionType = selectedTrigger?.actionConfig?.type || 'none';
  document.getElementById('videoTriggerSeekTimeField')?.classList.toggle('hidden', actionType !== 'seekVideo');
  document.getElementById('videoTriggerTargetElementField')?.classList.toggle('hidden', !VIDEO_TRIGGER_TARGET_ACTIONS.has(actionType));
  document.getElementById('videoTriggerTargetSlideField')?.classList.toggle('hidden', actionType !== 'jumpSlide');
  document.getElementById('videoTriggerUrlField')?.classList.toggle('hidden', !['redirect', 'addImage', 'addAudio', 'addVideo'].includes(actionType));
  document.getElementById('videoTriggerActionTextField')?.classList.toggle('hidden', !['addText', 'replaceText'].includes(actionType));
  document.getElementById('videoTriggerReplaceModeField')?.classList.toggle('hidden', actionType !== 'replaceText');
  const replaceCounterMode = actionType === 'replaceText' && getReplaceTextMode(selectedTrigger?.actionConfig?.replaceMode) === REPLACE_COUNTER_MODE;
  document.getElementById('videoTriggerReplaceCounterStartField')?.classList.toggle('hidden', !replaceCounterMode);
  document.getElementById('videoTriggerReplaceCounterStepField')?.classList.toggle('hidden', !replaceCounterMode);
  document.getElementById('videoTriggerTextFontSizeField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('videoTriggerTextFontFamilyField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('videoTriggerTextFontWeightField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('videoTriggerTextAlignField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('videoTriggerTextColorField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('videoTriggerTextBgColorField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('videoTriggerTextBackgroundToggleField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('videoTriggerTextBorderToggleField')?.classList.toggle('hidden', actionType !== 'addText');
  document.getElementById('videoTriggerAudioVisibleField')?.classList.toggle('hidden', actionType !== 'addAudio');
  document.getElementById('videoTriggerAudioLoopField')?.classList.toggle('hidden', actionType !== 'addAudio');
  const insertMode = ['addText', 'addImage', 'addAudio', 'addVideo', 'addQuiz'].includes(actionType);
  document.getElementById('videoTriggerInsertXField')?.classList.toggle('hidden', !insertMode);
  document.getElementById('videoTriggerInsertYField')?.classList.toggle('hidden', !insertMode);
  document.getElementById('videoTriggerInsertWidthField')?.classList.toggle('hidden', !insertMode);
  document.getElementById('videoTriggerInsertHeightField')?.classList.toggle('hidden', !insertMode);
  document.getElementById('videoPlacementToolsField')?.classList.toggle('hidden', !insertMode);
  document.getElementById('videoTriggerMoveXField')?.classList.toggle('hidden', actionType !== 'moveElement');
  document.getElementById('videoTriggerMoveYField')?.classList.toggle('hidden', actionType !== 'moveElement');
  document.getElementById('videoTriggerMoveDurationField')?.classList.toggle('hidden', actionType !== 'moveElement');
  const quizMode = actionType === 'addQuiz';
  document.getElementById('videoTriggerQuizQuestionField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizOptionsField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizCorrectField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizSuccessField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizErrorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizActionLabelField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizBackgroundColorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizQuestionColorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizOptionBackgroundColorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizOptionTextColorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizButtonBackgroundColorField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizPointsField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizLockOnWrongField')?.classList.toggle('hidden', !quizMode);
  document.getElementById('videoTriggerQuizPlaySourceVideoField')?.classList.toggle('hidden', !quizMode);
  updateVideoPlacementPreview();
  requestAnimationFrame(() => positionStageEditorCard('video'));
  updateStageEditorState();
};

const syncVideoEditor = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'video') {
    return;
  }
  normalizeVideoTriggerConfig(element);
  element.captionsEnabled = Boolean(videoCaptionEnabledToggle?.checked);
  const nextPosition = videoCaptionPositionSelect?.value || 'bottom';
  element.captionStyle = normalizeCaptionStyle({
    width: videoCaptionWidthInput?.value || '',
    position: nextPosition,
    fontSize: Number(videoCaptionFontSizeInput?.value) || 28,
    textColor: videoCaptionTextColorInput?.value || '#ffffff',
    backgroundColor: videoCaptionBackgroundColorInput?.value || '#0f172a',
    accentColor: videoCaptionAccentColorInput?.value || '#facc15',
    uppercase: Boolean(videoCaptionUppercaseToggle?.checked),
    freePosition: false,
    stageX: null,
    stageY: null
  }, 'video');
  const selectedTrigger = getSelectedVideoTrigger(element);
  if (!selectedTrigger) {
    return;
  }
  selectedTrigger.time = Math.max(0, Number(videoTriggerTimeInput?.value) || 0);
  selectedTrigger.actionConfig.type = VIDEO_TRIGGER_ACTIONS.has(String(videoTriggerActionSelect?.value || 'none'))
    ? String(videoTriggerActionSelect?.value || 'none')
    : 'none';
  selectedTrigger.actionConfig.videoTime = Math.max(0, Number(videoTriggerSeekTimeInput?.value) || 0);
  selectedTrigger.actionConfig.targetElementId = videoTriggerTargetElementSelect?.value || '';
  selectedTrigger.actionConfig.targetSlideId = videoTriggerTargetSlideSelect?.value || '';
  selectedTrigger.actionConfig.url = videoTriggerUrlInput?.value?.trim() || '';
  const actionTextValue = videoTriggerActionTextInput?.value ?? '';
  selectedTrigger.actionConfig.text =
    selectedTrigger.actionConfig.type === 'addText'
      ? (actionTextValue.length ? actionTextValue : 'Novo texto')
      : (selectedTrigger.actionConfig.text || 'Novo texto');
  selectedTrigger.actionConfig.replaceText =
    selectedTrigger.actionConfig.type === 'replaceText' ? actionTextValue : (selectedTrigger.actionConfig.replaceText || '');
  selectedTrigger.actionConfig.replaceMode =
    selectedTrigger.actionConfig.type === 'replaceText'
      ? getReplaceTextMode(videoTriggerReplaceModeSelect?.value)
      : REPLACE_TEXT_MODE;
  selectedTrigger.actionConfig.replaceCounterStart =
    selectedTrigger.actionConfig.type === 'replaceText'
      ? (Number.isFinite(Number(videoTriggerReplaceCounterStartInput?.value)) ? Number(videoTriggerReplaceCounterStartInput.value) : 1)
      : 1;
  selectedTrigger.actionConfig.replaceCounterStep =
    selectedTrigger.actionConfig.type === 'replaceText'
      ? (Number.isFinite(Number(videoTriggerReplaceCounterStepInput?.value)) ? Number(videoTriggerReplaceCounterStepInput.value) : 1)
      : 1;
  selectedTrigger.actionConfig.audioVisible = Boolean(videoTriggerAudioVisibleToggle?.checked);
  selectedTrigger.actionConfig.audioLoop = Boolean(videoTriggerAudioLoopToggle?.checked);
  selectedTrigger.actionConfig.textColor = videoTriggerTextColorInput?.value || DEFAULT_INSERT_TEXT_STYLE.textColor;
  selectedTrigger.actionConfig.backgroundColor = videoTriggerTextBgColorInput?.value || DEFAULT_INSERT_TEXT_STYLE.backgroundColor;
  selectedTrigger.actionConfig.textAlign = videoTriggerTextAlignSelect?.value || DEFAULT_INSERT_TEXT_STYLE.textAlign;
  selectedTrigger.actionConfig.fontFamily = videoTriggerTextFontFamilySelect?.value || DEFAULT_INSERT_TEXT_STYLE.fontFamily;
  selectedTrigger.actionConfig.fontWeight = videoTriggerTextFontWeightSelect?.value || DEFAULT_INSERT_TEXT_STYLE.fontWeight;
  selectedTrigger.actionConfig.fontSize = Math.max(10, Number(videoTriggerTextFontSizeInput?.value) || DEFAULT_INSERT_TEXT_STYLE.fontSize);
  selectedTrigger.actionConfig.hasTextBackground = Boolean(videoTriggerTextBackgroundToggle?.checked);
  selectedTrigger.actionConfig.hasTextBorder = Boolean(videoTriggerTextBorderToggle?.checked);
  selectedTrigger.actionConfig.hasTextBlock = false;
  selectedTrigger.actionConfig.insertX = Math.max(0, Number(videoTriggerInsertXInput?.value) || 120);
  selectedTrigger.actionConfig.insertY = Math.max(0, Number(videoTriggerInsertYInput?.value) || 120);
  selectedTrigger.actionConfig.insertWidth = Number.isFinite(Number(videoTriggerInsertWidthInput?.value)) ? Number(videoTriggerInsertWidthInput.value) : 280;
  selectedTrigger.actionConfig.insertHeight = Math.max(40, Number(videoTriggerInsertHeightInput?.value) || 180);
  selectedTrigger.actionConfig.moveByX = Number.isFinite(Number(videoTriggerMoveXInput?.value)) ? Number(videoTriggerMoveXInput.value) : 160;
  selectedTrigger.actionConfig.moveByY = Number.isFinite(Number(videoTriggerMoveYInput?.value)) ? Number(videoTriggerMoveYInput.value) : 0;
  selectedTrigger.actionConfig.moveDuration = Math.max(0.1, Number(videoTriggerMoveDurationInput?.value) || 0.8);
  const videoQuizQuestionValue = videoTriggerQuizQuestionInput?.value ?? '';
  selectedTrigger.actionConfig.quizQuestion = videoQuizQuestionValue.length ? videoQuizQuestionValue : 'Nova pergunta';
  selectedTrigger.actionConfig.quizOptions = (videoTriggerQuizOptionsInput?.value || '')
    .split('\n')
    .map((option) => option.trim())
    .filter(Boolean);
  if (!selectedTrigger.actionConfig.quizOptions.length) {
    selectedTrigger.actionConfig.quizOptions = createDefaultQuizOptions();
  }
  const correctIndex = Number(videoTriggerQuizCorrectSelect?.value);
  selectedTrigger.actionConfig.quizCorrectOption = Number.isNaN(correctIndex)
    ? 0
    : Math.min(Math.max(correctIndex, 0), selectedTrigger.actionConfig.quizOptions.length - 1);
  const videoQuizSuccessValue = videoTriggerQuizSuccessInput?.value ?? '';
  const videoQuizErrorValue = videoTriggerQuizErrorInput?.value ?? '';
  const videoQuizActionLabelValue = videoTriggerQuizActionLabelInput?.value ?? '';
  selectedTrigger.actionConfig.successMessage = videoQuizSuccessValue.length ? videoQuizSuccessValue : 'Resposta correta!';
  selectedTrigger.actionConfig.errorMessage = videoQuizErrorValue.length ? videoQuizErrorValue : 'Resposta incorreta. Tente novamente.';
  selectedTrigger.actionConfig.actionLabel = videoQuizActionLabelValue.length ? videoQuizActionLabelValue : 'Validar resposta';
  selectedTrigger.actionConfig.quizBackgroundColor = videoTriggerQuizBackgroundColorInput?.value || '#ffffff';
  selectedTrigger.actionConfig.quizQuestionColor = videoTriggerQuizQuestionColorInput?.value || '#171934';
  selectedTrigger.actionConfig.quizOptionBackgroundColor = videoTriggerQuizOptionBackgroundColorInput?.value || '#f4f6ff';
  selectedTrigger.actionConfig.quizOptionTextColor = videoTriggerQuizOptionTextColorInput?.value || '#25284c';
  selectedTrigger.actionConfig.quizButtonBackgroundColor = videoTriggerQuizButtonBackgroundColorInput?.value || '#6d63ff';
  selectedTrigger.actionConfig.points = Math.max(1, Number(videoTriggerQuizPointsInput?.value) || 1);
  selectedTrigger.actionConfig.lockOnWrong = Boolean(videoTriggerQuizLockOnWrongToggle?.checked);
  selectedTrigger.actionConfig.playSourceVideoOnValidate = Boolean(videoTriggerQuizPlaySourceVideoToggle?.checked);
  element.videoTriggers.sort((first, second) => (Number(first.time) || 0) - (Number(second.time) || 0));
  element.videoTriggerTime = element.videoTriggers[0]?.time || 0;
  element.videoTriggerAction = element.videoTriggers[0]?.actionConfig?.type || 'none';
  element.videoTriggerSeekTime = element.videoTriggers[0]?.actionConfig?.videoTime || 0;
  element.videoTriggerTargetElementId = element.videoTriggers[0]?.actionConfig?.targetElementId || '';
  updateVideoEditorVisibility(element, { forceOpen: true });
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

const syncPenEditorControls = (element = null) => {
  const isPen = element?.type === 'pen';
  const nextColor = isPen ? element.strokeColor || '#111827' : getPenStrokeColor();
  const nextSize = isPen
    ? clamp(Number(element.strokeWidth) || 8, PEN_MIN_BRUSH_SIZE, PEN_MAX_BRUSH_SIZE)
    : getPenSize();
  if (penColorInput) {
    penColorInput.value = nextColor;
  }
  if (penSizeInput) {
    penSizeInput.value = String(nextSize);
  }
  if (penSizeNumberInput) {
    penSizeNumberInput.value = String(nextSize);
  }
  if (penClearPreviewBtn) {
    penClearPreviewBtn.disabled = !penState.points.length;
  }
  if (penStartDrawingBtn) {
    penStartDrawingBtn.textContent = penState.active ? 'Desenhando...' : 'Desenhar no slide';
  }
};

const closePenSession = ({ keepEditor = false } = {}) => {
  destroyPenOverlay();
  penState.active = false;
  resetPenDraftState();
  if (!keepEditor) {
    penEditorCard?.classList.add('hidden');
    if (currentStageEditor === 'pen') {
      currentStageEditor = 'none';
    }
  }
  syncPenEditorControls(getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null);
  updateStageEditorState();
};

const updatePenEditorVisibility = (element, options = {}) => {
  if (!penEditorCard) return;
  const isPen = element?.type === 'pen';
  const shouldStayOpen = options.forceOpen || currentStageEditor === 'pen' || penState.active;
  const canRenderCard = isPen || penState.active || options.forceOpen;
  if (!shouldStayOpen || !canRenderCard) {
    if (currentStageEditor === 'pen' && !options.forceOpen && !penState.active) {
      currentStageEditor = 'none';
    }
    penEditorCard.classList.add('hidden');
    if (!options.forceOpen && !isPen && !penState.active) {
      closePenSession({ keepEditor: true });
    }
    updateStageEditorState();
    return;
  }
  currentStageEditor = 'pen';
  lastStageEditorOpenedAt = Date.now();
  penEditorCard.classList.remove('hidden');
  syncPenEditorControls(element);
  requestAnimationFrame(() => positionStageEditorCard('pen'));
  updateStageEditorState();
};

const getEraserTargetElement = () => getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null;

const getStageNodeByElementId = (elementId) =>
  slideCanvas?.querySelector(`[data-element-id="${escapeAttributeSelectorValue(elementId)}"]`) || null;

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

const renderPenElementToCanvas = (element, width, height, scale = 2) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('O navegador nÃ£o conseguiu preparar a borracha.');
  }
  const points = Array.isArray(element?.points) ? element.points : [];
  context.scale(scale, scale);
  context.clearRect(0, 0, width, height);
  if (!points.length) {
    return canvas;
  }
  context.save();
  context.strokeStyle = element?.strokeColor || '#111827';
  context.lineWidth = Math.max(PEN_MIN_BRUSH_SIZE, Number(element?.strokeWidth) || 8);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  const firstPoint = points[0];
  context.moveTo(
    clamp(Number(firstPoint?.x) || 0, 0, 1) * width,
    clamp(Number(firstPoint?.y) || 0, 0, 1) * height
  );
  points.slice(1).forEach((point) => {
    context.lineTo(
      clamp(Number(point?.x) || 0, 0, 1) * width,
      clamp(Number(point?.y) || 0, 0, 1) * height
    );
  });
  if (points.length === 1) {
    const x = clamp(Number(firstPoint?.x) || 0, 0, 1) * width;
    const y = clamp(Number(firstPoint?.y) || 0, 0, 1) * height;
    context.lineTo(x + 0.01, y + 0.01);
  }
  context.stroke();
  context.restore();
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
  if (element.type === 'pen') {
    return renderPenElementToCanvas(element, width, height, Math.max(1, Math.min(3, window.devicePixelRatio || 2)));
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

const getPenSize = () =>
  clamp(Number(penSizeInput?.value || penSizeNumberInput?.value || 8), PEN_MIN_BRUSH_SIZE, PEN_MAX_BRUSH_SIZE);

const syncPenSizeInputs = (source = 'range') => {
  const nextValue = getPenSize();
  if (penSizeInput) {
    penSizeInput.value = String(nextValue);
  }
  if (penSizeNumberInput) {
    penSizeNumberInput.value = String(nextValue);
  }
  if (source === 'number' && penSizeInput) {
    penSizeInput.value = String(nextValue);
  }
  if (source === 'range' && penSizeNumberInput) {
    penSizeNumberInput.value = String(nextValue);
  }
};

const getPenStrokeColor = () => {
  const value = typeof penColorInput?.value === 'string' ? penColorInput.value.trim() : '';
  return value || '#111827';
};

const resetPenDraftState = () => {
  penState.drawing = false;
  penState.points = [];
  penState.hoverPoint = null;
};

const destroyPenOverlay = () => {
  if (penState.overlay) {
    penState.overlay.remove();
  }
  penState.overlay = null;
  penState.canvas = null;
};

const renderPenSvgMarkup = (element) => {
  const width = Math.max(1, Number(element?.width) || 1);
  const height = Math.max(1, Number(element?.height) || 1);
  const points = Array.isArray(element?.points) ? element.points : [];
  const polylinePoints = points
    .map((point) => `${clamp(Number(point?.x) || 0, 0, 1) * width},${clamp(Number(point?.y) || 0, 0, 1) * height}`)
    .join(' ');
  const strokeWidth = Math.max(PEN_MIN_BRUSH_SIZE, Number(element?.strokeWidth) || 8);
  const strokeColor = element?.strokeColor || '#111827';
  return `
    <svg class="builder-pen-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
      <polyline
        points="${escapeAttribute(polylinePoints)}"
        fill="none"
        stroke="${escapeAttribute(strokeColor)}"
        stroke-width="${strokeWidth}"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  `;
};

const createPenElementNode = (element) => {
  const node = document.createElement('div');
  node.className = 'builder-pen-element';
  node.innerHTML = renderPenSvgMarkup(element);
  return node;
};

const renderPenPreview = () => {
  const canvas = penState.canvas;
  if (!canvas) {
    return;
  }
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  const points = penState.points || [];
  if (!points.length) {
    return;
  }
  context.save();
  context.strokeStyle = getPenStrokeColor();
  context.lineWidth = getPenSize();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => {
    context.lineTo(point.x, point.y);
  });
  if (points.length === 1) {
    context.lineTo(points[0].x + 0.01, points[0].y + 0.01);
  }
  context.stroke();
  context.restore();
};

const buildPenElementFromPoints = (points, options = {}) => {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }
  const stage = getStageDimensions();
  const strokeWidth = Math.max(PEN_MIN_BRUSH_SIZE, Number(options.strokeWidth) || getPenSize());
  const strokeColor = options.strokeColor || getPenStrokeColor();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  const padding = strokeWidth / 2 + 2;
  const left = clamp(minX - padding, 0, stage.width);
  const top = clamp(minY - padding, 0, stage.height);
  const right = clamp(maxX + padding, 0, stage.width);
  const bottom = clamp(maxY + padding, 0, stage.height);
  const width = Math.max(strokeWidth + 4, right - left);
  const height = Math.max(strokeWidth + 4, bottom - top);
  const normalizedPoints = points.map((point) => ({
    x: clamp((point.x - left) / width, 0, 1),
    y: clamp((point.y - top) / height, 0, 1)
  }));
  return {
    type: 'pen',
    x: left,
    y: top,
    width,
    height,
    points: normalizedPoints,
    strokeColor,
    strokeWidth,
    backgroundColor: 'transparent',
    initiallyHidden: false
  };
};

const applyPenEditorToElement = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'pen') {
    return;
  }
  element.strokeColor = getPenStrokeColor();
  element.strokeWidth = getPenSize();
  element.backgroundColor = 'transparent';
  updateElementInspector(element);
  renderSlide();
  scheduleHistoryCommit();
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

  // Try to find the element wrapper (for elements with clip-path)
  const elementWrapper = slideCanvas?.querySelector(`[data-elementId="${element.id}"][data-hasMenuTrigger="true"]`);

  // Position depends on whether we're rendering inside wrapper or directly in slideCanvas
  if (elementWrapper) {
    // Render inside wrapper - use relative positioning and full size
    overlay.style.position = 'relative';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.zIndex = '10001';
    elementWrapper.appendChild(overlay);
  } else {
    // Render in slideCanvas - use absolute positioning with element coordinates
    overlay.style.position = 'absolute';
    overlay.style.left = `${element.x || 0}px`;
    overlay.style.top = `${element.y || 0}px`;
    overlay.style.width = `${Math.max(MIN_ELEMENT_SIZE, Number(element.width) || eraserState.baseCanvas.width)}px`;
    overlay.style.height = `${Math.max(MIN_ELEMENT_SIZE, Number(element.height) || eraserState.baseCanvas.height)}px`;
    overlay.style.zIndex = '10000000';
    slideCanvas.appendChild(overlay);
  }

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
  eraserState.overlay = overlay;
  eraserState.displayCanvas = canvas;
  attachEraserOverlayEvents(canvas);
  renderEraserPreview();
};

const finishPenStroke = () => {
  if (!penState.points.length) {
    resetPenDraftState();
    renderPenPreview();
    syncPenEditorControls(getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null);
    return;
  }
  const elementConfig = buildPenElementFromPoints(penState.points, {
    strokeColor: getPenStrokeColor(),
    strokeWidth: getPenSize()
  });
  resetPenDraftState();
  renderPenPreview();
  if (!elementConfig) {
    syncPenEditorControls(getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null);
    return;
  }
  addElementToSlide(elementConfig);
  syncPenEditorControls(getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null);
};

const attachPenOverlayEvents = (canvas) => {
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const point = getCanvasPointFromEvent(canvas, event);
    penState.drawing = true;
    penState.points = [point];
    penState.hoverPoint = point;
    renderPenPreview();
    syncPenEditorControls(getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null);
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!penState.drawing) {
      return;
    }
    const point = getCanvasPointFromEvent(canvas, event);
    const lastPoint = penState.points[penState.points.length - 1];
    if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= 1.2) {
      penState.points.push(point);
    }
    penState.hoverPoint = point;
    renderPenPreview();
  });
  const stopDrawing = (event) => {
    if (!penState.drawing) {
      return;
    }
    penState.drawing = false;
    canvas.releasePointerCapture?.(event.pointerId);
    finishPenStroke();
  };
  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointercancel', stopDrawing);
};

const renderPenOverlay = () => {
  if (!penState.active || !slideCanvas || previewState.active || currentStageEditor !== 'pen') {
    destroyPenOverlay();
    return;
  }
  destroyPenOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'pen-stage-overlay';
  overlay.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  const canvas = document.createElement('canvas');
  canvas.className = 'pen-overlay-canvas';
  canvas.width = Math.max(1, slideCanvas.clientWidth || builderState.stageSize.width || DEFAULT_STAGE_SIZE.width);
  canvas.height = Math.max(1, slideCanvas.clientHeight || builderState.stageSize.height || DEFAULT_STAGE_SIZE.height);
  overlay.appendChild(canvas);
  slideCanvas.appendChild(overlay);
  penState.overlay = overlay;
  penState.canvas = canvas;
  attachPenOverlayEvents(canvas);
  renderPenPreview();
};

const startPenDrawingSession = () => {
  penState.active = true;
  resetPenDraftState();
  currentStageEditor = 'pen';
  updatePenEditorVisibility(getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'pen') || null, { forceOpen: true });
  renderPenOverlay();
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
  element.objectFit = ['block', 'pen'].includes(eraserState.sourceType) ? 'fill' : getElementMediaObjectFit(element);
  element.backgroundColor = 'transparent';
  delete element.points;
  delete element.strokeColor;
  delete element.strokeWidth;
  delete element.provider;
  delete element.embedSrc;
  closeEraserSession();
  updateElementInspector(element);
  renderSlide();
  commitHistoryState();
};

const openEraserEditorForElement = async (element) => {
  if (!canUseEraserOnElement(element)) {
    alert('Selecione uma imagem, bloco ou traço da caneta para usar a borracha.');
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

const updateQuizEditorVisibility = (element, options = {}) => {
  if (!quizEditorCard) return;
  const isQuiz = element?.type === 'quiz';
  const shouldStayOpen = options.forceOpen || currentStageEditor === 'quiz';
  if (!shouldStayOpen || !isQuiz) {
    if (currentStageEditor === 'quiz' && !options.forceOpen) {
      currentStageEditor = 'none';
    }
    quizEditorCard.classList.add('hidden');
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
  currentStageEditor = 'quiz';
  lastStageEditorOpenedAt = Date.now();
  quizEditorCard.classList.remove('hidden');
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
    input: 'Input',
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
        ? ['text', 'block', 'image', 'audio', 'video', 'quiz', 'floatingButton', 'input', 'detector', 'animatedArrow']
        : actionType === 'moveElement'
          ? ['text', 'block', 'image', 'input']
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

const updateFloatingButtonEditorVisibility = (element, options = {}) => {
  if (!floatingButtonEditorCard) return;
  const isActionTrigger = ['floatingButton', 'detector', 'timedTrigger', 'input'].includes(element?.type);
  const shouldStayOpen = options.forceOpen || currentStageEditor === 'floating';
  if (!shouldStayOpen || !isActionTrigger) {
    if (currentStageEditor === 'floating' && !options.forceOpen) {
      currentStageEditor = 'none';
    }
    floatingButtonEditorCard.classList.add('hidden');
    isPickingFloatingInsertPosition = false;
    isPickingFloatingTargetElement = false;
    updateFloatingPlacementControls(null);
    updateStageEditorState();
    return;
  }
  currentStageEditor = 'floating';
  lastStageEditorOpenedAt = Date.now();
  floatingButtonEditorCard.classList.remove('hidden');
  normalizeFloatingActionConfig(element);
  const selectedTrigger = getSelectedFloatingTrigger(element);
  const config = selectedTrigger?.actionConfig || element.actionConfig;
  const floatingActionUrlLabel = document.querySelector('label[for="floatingActionUrlInput"]');
  if (floatingTriggerList) {
    floatingTriggerList.innerHTML = (element.interactionTriggers || [])
      .map((trigger, index) => {
        const isActive = trigger.id === selectedTrigger?.id;
        const triggerAction = trigger.actionConfig?.type || 'none';
        return `
          <button type="button" class="trigger-chip${isActive ? ' active' : ''}" data-floating-trigger-id="${trigger.id}">
            <span>
              <span class="trigger-chip-title">${escapeHtml(trigger.name || `${element.type === 'detector' ? 'Gatilho' : element.type === 'timedTrigger' ? 'Tempo' : element.type === 'input' ? 'Envio' : 'Ação'} ${index + 1}`)}</span>
              <small class="trigger-chip-meta">${escapeHtml(element.type === 'timedTrigger' ? `${Number(trigger.time || 0).toFixed(1)}s • ${triggerAction}` : triggerAction)}</small>
            </span>
          </button>
        `;
      })
      .join('');
  }
  if (floatingDuplicateTriggerBtn) {
    floatingDuplicateTriggerBtn.disabled = !selectedTrigger;
  }
  if (floatingRemoveTriggerBtn) {
    floatingRemoveTriggerBtn.disabled = (element.interactionTriggers || []).length <= 1;
  }
  if (floatingEditorBadge) {
    floatingEditorBadge.textContent =
      element.type === 'detector' ? 'Detector' : element.type === 'timedTrigger' ? 'Gatilho por tempo' : element.type === 'input' ? 'Input' : 'Botão flutuante';
  }
  if (floatingEditorTitle) {
    floatingEditorTitle.textContent =
      element.type === 'detector'
        ? 'Configure o gatilho invisível'
        : element.type === 'timedTrigger'
          ? 'Configure o disparo por tempo'
          : element.type === 'input'
            ? 'Configure o envio do aluno'
            : 'Configure o clique';
  }
  document.getElementById('floatingButtonLabelField')?.classList.toggle('hidden', element.type !== 'floatingButton');
  document.getElementById('floatingInputPlaceholderField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputSubmitLabelField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputCompareTextField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputCompareCaseField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputCompareImageField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputCompareImageSourceField')?.classList.toggle(
    'hidden',
    element.type !== 'input' || !Boolean(element.compareImageEnabled)
  );
  document.getElementById('floatingInputSuccessField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputErrorField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputImageField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputAudioField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputBackgroundColorField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputLabelColorField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputTextColorField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputButtonBackgroundColorField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingInputButtonTextColorField')?.classList.toggle('hidden', element.type !== 'input');
  document.getElementById('floatingTriggerTimeField')?.classList.toggle('hidden', element.type !== 'timedTrigger');
  if (floatingButtonLabelInput) {
    syncTextInputValue(floatingButtonLabelInput, element.type === 'floatingButton' ? element.label || 'Ação' : '');
  }
  if (floatingInputPlaceholderInput) {
    syncTextInputValue(floatingInputPlaceholderInput, element.type === 'input' ? element.placeholder || 'Digite sua resposta' : '');
  }
  if (floatingInputSubmitLabelInput) {
    syncTextInputValue(floatingInputSubmitLabelInput, element.type === 'input' ? element.submitLabel || 'Enviar resposta' : '');
  }
  if (floatingInputCompareTextInput) {
    syncTextInputValue(floatingInputCompareTextInput, element.type === 'input' ? element.compareText || '' : '');
  }
  if (floatingInputCompareCaseToggle) {
    floatingInputCompareCaseToggle.checked = element.type === 'input' ? Boolean(element.compareCaseSensitive) : false;
  }
  if (floatingInputCompareImageToggle) {
    floatingInputCompareImageToggle.checked = element.type === 'input' ? Boolean(element.compareImageEnabled) : false;
  }
  if (floatingInputCompareImageUrlInput) {
    syncTextInputValue(floatingInputCompareImageUrlInput, element.type === 'input' ? element.compareImageReference || '' : '');
  }
  renderFloatingInputCompareImagePreview(element.type === 'input' ? element.compareImageReference || '' : '');
  if (floatingInputSuccessInput) {
    syncTextInputValue(floatingInputSuccessInput, element.type === 'input' ? element.successMessage || 'Resposta enviada com sucesso.' : '');
  }
  if (floatingInputErrorInput) {
    syncTextInputValue(floatingInputErrorInput, element.type === 'input' ? element.errorMessage || 'A palavra não confere. Tente novamente.' : '');
  }
  if (floatingInputAllowImageToggle) {
    floatingInputAllowImageToggle.checked = element.type === 'input' ? Boolean(element.allowImage) : false;
    floatingInputAllowImageToggle.disabled = element.type === 'input' ? Boolean(element.compareImageEnabled) : false;
  }
  if (floatingInputAllowAudioToggle) {
    floatingInputAllowAudioToggle.checked = element.type === 'input' ? Boolean(element.allowAudio) : false;
  }
  if (floatingInputBackgroundColorInput) {
    floatingInputBackgroundColorInput.value = element.type === 'input' ? element.backgroundColor || '#ffffff' : '#ffffff';
  }
  if (floatingInputLabelColorInput) {
    floatingInputLabelColorInput.value = element.type === 'input' ? element.labelColor || '#9ca3af' : '#9ca3af';
  }
  if (floatingInputTextColorInput) {
    floatingInputTextColorInput.value = element.type === 'input' ? element.inputTextColor || '#0f142c' : '#0f142c';
  }
  if (floatingInputButtonBackgroundColorInput) {
    floatingInputButtonBackgroundColorInput.value = element.type === 'input' ? element.submitButtonColor || '#6d63ff' : '#6d63ff';
  }
  if (floatingInputButtonTextColorInput) {
    floatingInputButtonTextColorInput.value = element.type === 'input' ? element.submitButtonTextColor || '#ffffff' : '#ffffff';
  }
  if (floatingTriggerTimeInput) {
    floatingTriggerTimeInput.value = String(selectedTrigger?.time || 0);
  }
  if (floatingActionTypeLabel) {
    floatingActionTypeLabel.textContent = element.type === 'timedTrigger' ? 'Ação ao atingir o tempo' : 'Ação ao clicar';
  }
  floatingActionTypeSelect.value = config.type;
  populateFloatingTargetSlides(config.targetSlideId);
  populateFloatingTargetElements(config.targetElementId, config.type, element);
  if (floatingRequireAllToggle) {
    floatingRequireAllToggle.checked = Boolean(config.requireAllButtonsInGroup);
  }
  if (floatingRuleGroupInput) {
    syncTextInputValue(floatingRuleGroupInput, config.ruleGroup || '');
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
    syncTextInputValue(floatingActionTextInput, config.type === 'replaceText' ? config.replaceText || '' : config.text);
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
  syncTextInputValue(floatingActionUrlInput, config.url);
  if (floatingActionUrlLabel) {
    floatingActionUrlLabel.textContent = config.type === 'redirect' ? 'URL de redirecionamento' : 'URL da mídia';
  }
  if (floatingActionUrlInput) {
    floatingActionUrlInput.placeholder =
      config.type === 'redirect'
        ? 'Cole a URL do site para abrir quando o gatilho for acionado'
        : 'Cole a URL da imagem, áudio ou vídeo';
  }
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
  syncTextInputValue(floatingQuizQuestionInput, config.quizQuestion);
  syncTextInputValue(floatingQuizOptionsInput, config.quizOptions.join('\n'));
  if (floatingQuizSuccessInput) syncTextInputValue(floatingQuizSuccessInput, config.successMessage);
  if (floatingQuizErrorInput) syncTextInputValue(floatingQuizErrorInput, config.errorMessage);
  if (floatingQuizActionLabelInput) syncTextInputValue(floatingQuizActionLabelInput, config.actionLabel);
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
  document.getElementById('floatingRuleGroupField')?.classList.toggle('hidden', element.type === 'detector' || element.type === 'timedTrigger' || element.type === 'input' || !config.requireAllButtonsInGroup);
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
  document.getElementById('floatingActionUrlField')?.classList.toggle('hidden', !['redirect', 'addImage', 'addAudio', 'addVideo'].includes(actionType));
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
    floatingRequireAllToggle.disabled = element.type === 'detector' || element.type === 'timedTrigger' || element.type === 'input';
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
  if (!element || !['floatingButton', 'detector', 'timedTrigger', 'input'].includes(element.type)) {
    return;
  }
  normalizeFloatingActionConfig(element);
  const selectedTrigger = getSelectedFloatingTrigger(element);
  const config = selectedTrigger?.actionConfig || element.actionConfig;
  if (selectedTrigger) {
    selectedTrigger.time = element.type === 'timedTrigger' ? Math.max(0, Number(floatingTriggerTimeInput?.value) || 0) : 0;
  }
  config.type = floatingActionTypeSelect?.value || 'none';
  config.targetSlideId = floatingTargetSlideSelect?.value || '';
  config.targetElementId = floatingTargetElementSelect?.value || '';
  config.requireAllButtonsInGroup =
    element.type === 'detector' || element.type === 'timedTrigger' || element.type === 'input' ? false : Boolean(floatingRequireAllToggle?.checked);
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
  if (element.type === 'floatingButton') {
    const nextLabel = floatingButtonLabelInput?.value?.trim() || 'Ação';
    element.label = nextLabel;
    if (floatingButtonLabelInput && document.activeElement !== floatingButtonLabelInput && floatingButtonLabelInput.value !== nextLabel) {
      floatingButtonLabelInput.value = nextLabel;
    }
  }
  if (element.type === 'input') {
    element.placeholder = floatingInputPlaceholderInput?.value?.trim() || 'Digite sua resposta';
    element.submitLabel = floatingInputSubmitLabelInput?.value?.trim() || 'Enviar resposta';
    element.compareText = floatingInputCompareTextInput?.value ?? '';
    element.compareCaseSensitive = Boolean(floatingInputCompareCaseToggle?.checked);
    element.compareImageEnabled = Boolean(floatingInputCompareImageToggle?.checked);
    element.compareImageReference = floatingInputCompareImageUrlInput?.value?.trim() || '';
    element.successMessage = floatingInputSuccessInput?.value?.trim() || 'Resposta enviada com sucesso.';
    element.errorMessage = floatingInputErrorInput?.value?.trim() || 'A palavra não confere. Tente novamente.';
    element.allowImage = element.compareImageEnabled ? true : Boolean(floatingInputAllowImageToggle?.checked);
    element.allowAudio = Boolean(floatingInputAllowAudioToggle?.checked);
    element.backgroundColor = floatingInputBackgroundColorInput?.value || '#ffffff';
    element.labelColor = floatingInputLabelColorInput?.value || '#9ca3af';
    element.inputTextColor = floatingInputTextColorInput?.value || '#0f142c';
    element.submitButtonColor = floatingInputButtonBackgroundColorInput?.value || '#6d63ff';
    element.submitButtonTextColor = floatingInputButtonTextColorInput?.value || '#ffffff';
    renderFloatingInputCompareImagePreview(element.compareImageReference);
    document.getElementById('floatingInputCompareImageSourceField')?.classList.toggle('hidden', !element.compareImageEnabled);
    if (floatingInputAllowImageToggle) {
      floatingInputAllowImageToggle.checked = element.allowImage;
      floatingInputAllowImageToggle.disabled = element.compareImageEnabled;
    }
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
  config.insertWidth = Number.isFinite(Number(floatingInsertWidthInput?.value)) ? Number(floatingInsertWidthInput.value) : 280;
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
  if (selectedTrigger) {
    selectedTrigger.name =
      config.type === 'none'
        ? element.type === 'detector'
          ? 'Gatilho'
          : element.type === 'timedTrigger'
            ? 'Tempo'
            : element.type === 'input'
              ? 'Envio'
              : 'Ação'
        : element.type === 'timedTrigger'
          ? `Tempo ${Number(selectedTrigger.time || 0).toFixed(1)}s`
          : config.type;
  }
  if (element.type === 'timedTrigger') {
    element.interactionTriggers.sort((first, second) => (Number(first.time) || 0) - (Number(second.time) || 0));
  }
  element.actionConfig = element.interactionTriggers[0]?.actionConfig || config;
  renderSlide();
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
  const selectedTrigger = getSelectedFloatingTrigger(element);
  if (!FLOATING_INSERT_ACTIONS.includes(selectedTrigger?.actionConfig?.type || 'none')) {
    isPickingFloatingInsertPosition = false;
    updateFloatingPlacementControls(element);
    return;
  }
  isPickingFloatingInsertPosition = !isPickingFloatingInsertPosition;
  updateFloatingPlacementPreview();
};

const toggleVideoPlacementPicker = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'video');
  if (!element) {
    isPickingFloatingInsertPosition = false;
    updateVideoPlacementControls(null);
    return;
  }
  normalizeVideoTriggerConfig(element);
  const selectedTrigger = getSelectedVideoTrigger(element);
  if (!FLOATING_INSERT_ACTIONS.includes(selectedTrigger?.actionConfig?.type || 'none')) {
    isPickingFloatingInsertPosition = false;
    updateVideoPlacementControls(element);
    return;
  }
  isPickingFloatingInsertPosition = !isPickingFloatingInsertPosition;
  updateVideoPlacementPreview();
};

const toggleFloatingTargetElementPicker = () => {
  const element = getSelectedActionTriggerElement();
  if (!element) {
    isPickingFloatingTargetElement = false;
    updateFloatingPlacementPreview();
    return;
  }
  normalizeFloatingActionConfig(element);
  const selectedTrigger = getSelectedFloatingTrigger(element);
  if (!['moveElement', 'playAnimation', 'replaceText', 'playAudio', 'playVideo', 'pauseVideo', 'seekVideo', 'showElement', 'hideElement'].includes(selectedTrigger?.actionConfig?.type || 'none')) {
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
  const selectedTrigger = getSelectedFloatingTrigger(element);
  if (!FLOATING_INSERT_ACTIONS.includes(selectedTrigger?.actionConfig?.type || 'none')) {
    isPickingFloatingInsertPosition = false;
    updateFloatingPlacementPreview();
    return false;
  }
  const stage = getStageDimensions();
  const pointer = getStagePointerPosition(event);
  const previewRect = getFloatingInsertPreviewRect(selectedTrigger?.actionConfig);
  const x = clamp(pointer.x, 0, Math.max(0, stage.width - previewRect.width));
  const y = clamp(pointer.y, 0, Math.max(0, stage.height - previewRect.height));
  selectedTrigger.actionConfig.insertX = Math.round(x);
  selectedTrigger.actionConfig.insertY = Math.round(y);
  if (floatingInsertXInput) {
    floatingInsertXInput.value = String(selectedTrigger.actionConfig.insertX);
  }
  if (floatingInsertYInput) {
    floatingInsertYInput.value = String(selectedTrigger.actionConfig.insertY);
  }
  isPickingFloatingInsertPosition = false;
  updateFloatingPlacementPreview();
  scheduleHistoryCommit();
  return true;
};

const handleVideoPlacementPick = (event) => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'video');
  if (!slideCanvas || !element || !isPickingFloatingInsertPosition || currentStageEditor !== 'video') {
    return false;
  }
  normalizeVideoTriggerConfig(element);
  const selectedTrigger = getSelectedVideoTrigger(element);
  if (!FLOATING_INSERT_ACTIONS.includes(selectedTrigger?.actionConfig?.type || 'none')) {
    isPickingFloatingInsertPosition = false;
    updateVideoPlacementPreview();
    return false;
  }
  const stage = getStageDimensions();
  const pointer = getStagePointerPosition(event);
  const previewRect = getFloatingInsertPreviewRect(selectedTrigger?.actionConfig);
  const x = clamp(pointer.x, 0, Math.max(0, stage.width - previewRect.width));
  const y = clamp(pointer.y, 0, Math.max(0, stage.height - previewRect.height));
  selectedTrigger.actionConfig.insertX = Math.round(x);
  selectedTrigger.actionConfig.insertY = Math.round(y);
  if (videoTriggerInsertXInput) {
    videoTriggerInsertXInput.value = String(selectedTrigger.actionConfig.insertX);
  }
  if (videoTriggerInsertYInput) {
    videoTriggerInsertYInput.value = String(selectedTrigger.actionConfig.insertY);
  }
  isPickingFloatingInsertPosition = false;
  updateVideoPlacementPreview();
  scheduleHistoryCommit();
  return true;
};

const syncBlockEditor = () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'block') {
    return;
  }
  element.content = blockElementContentInput?.value ?? '';
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
  toggle('sharedInitiallyHiddenField', hasElement); // Show for all element types
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
    syncProfessorCreditsFromPayload(payload);
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
  aiAssistantState.generatedActions.push(JSON.parse(JSON.stringify(action)));
  if (aiAssistantState.generatedActions.length > 200) {
    aiAssistantState.generatedActions.shift();
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
  aiAssistantState.generatedActions = [];
  aiAssistantState.executionPlan = null;
  aiAssistantState.debugInfo = null;
  renderAiAssistantActions();
  renderAiAssistantFeedback();
  renderAiAssistantDebug();
};

const syncProfessorCreditsFromPayload = (payload = null) => {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  const nextData = {};
  if (Number.isFinite(Number(payload.aiCredits))) {
    nextData.aiCredits = Math.max(0, Number(Number(payload.aiCredits).toFixed(2)));
  }
  if (Number.isFinite(Number(payload.professorCreditsRemaining))) {
    nextData.aiCredits = Math.max(0, Number(Number(payload.professorCreditsRemaining).toFixed(2)));
  }
  if (Number.isFinite(Number(payload.aiCreditCostPerCall))) {
    nextData.aiCreditCostPerCall = Math.max(0.01, Number(Number(payload.aiCreditCostPerCall).toFixed(2)));
  }
  if (payload.studentLimit !== undefined) {
    nextData.studentLimit = payload.studentLimit;
  }
  if (payload.storageLimitBytes !== undefined) {
    nextData.storageLimitBytes = payload.storageLimitBytes;
  }
  if (payload.storageUsedBytes !== undefined) {
    nextData.storageUsedBytes = payload.storageUsedBytes;
  }
  saveCurrentUserData(nextData);
  renderBuilderProfessorCreditsStatus();
};

const renderBuilderProfessorCreditsStatus = () => {
  if (!builderProfessorCreditsStatus) return;
  const role = localStorage.getItem(USER_ROLE_KEY);
  if (role !== 'professor') {
    builderProfessorCreditsStatus.textContent = '';
    return;
  }
  const user = getCurrentUserData();
  const credits = Number.isFinite(Number(user.aiCredits)) ? Math.max(0, Number(user.aiCredits)) : 0;
  const cost = Number.isFinite(Number(user.aiCreditCostPerCall)) ? Math.max(0.01, Number(user.aiCreditCostPerCall)) : 0.5;
  const storageText = user.storageLimitBytes
    ? ` | espaço: ${formatStorageAmount(user.storageUsedBytes || 0)} / ${formatStorageAmount(user.storageLimitBytes)}`
    : '';
  builderProfessorCreditsStatus.textContent = `Saldo: ${formatCreditNumber(credits)} crédito(s) | custo/chamada: ${formatCreditNumber(cost)}${storageText}`;
  builderProfessorCreditsStatus.style.color = credits > 0 ? '#6d63ff' : '#ff6b6b';
};

const loadBuilderProfessorCreditsStatus = async () => {
  const role = localStorage.getItem(USER_ROLE_KEY);
  if (role !== 'professor') {
    renderBuilderProfessorCreditsStatus();
    return;
  }
  try {
    const response = await authorizedFetch('/api/admin/me/professor-credits');
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Não foi possível carregar os créditos.');
    }
    syncProfessorCreditsFromPayload(payload);
  } catch (error) {
    renderBuilderProfessorCreditsStatus();
  }
};

const getAiAssistantWorkingState = () => {
  const state = {
    slides: deepClone(builderState.slides || []),
    activeSlideId: builderState.activeSlideId || builderState.slides[0]?.id || null
  };
  if (aiAssistantState.pendingActions.length) {
    const result = applyAiActionsToState(state, aiAssistantState.pendingActions, { selectedElementId: null });
    state.activeSlideId = state.activeSlideId || builderState.activeSlideId;
    state.selectedElementId = result.selectedElementId || null;
  }
  return state;
};

const requestAiExecutionPlan = async (request) => {
  const workingState = getAiAssistantWorkingState();
  const response = await authorizedFetch('/api/admin/ai/slide-actions/plan', {
    method: 'POST',
    body: JSON.stringify({
      request,
      slides: workingState.slides,
      activeSlideId: workingState.activeSlideId,
      stageSize: builderState.stageSize.width && builderState.stageSize.height ? builderState.stageSize : DEFAULT_STAGE_SIZE,
      attachments: getAiAssistantAttachmentsPayload()
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.message || 'A IA não conseguiu montar o plano.');
  }
  syncProfessorCreditsFromPayload(result);
  return result;
};

const applyOrQueueAiActions = (actions, options = {}) => {
  if (!Array.isArray(actions) || !actions.length) {
    return;
  }
  const shouldAutoApply = options.requireConfirmation === false;
  actions.forEach((action) => rememberAiAction(action));
  if (shouldAutoApply) {
    const applyResult = applyAiActions(actions.map((action) => deepClone(action)));
    if (applyResult.warnings.length) {
      pushAiAssistantFeedback('Ações aplicadas com alertas', applyResult.warnings.join('\n'), 'error');
    }
    updateAiAssistantStatus(`Executando automaticamente ${aiAssistantState.generatedActions.length} ação(ões) da IA...`, applyResult.warnings.length ? 'error' : 'success');
    return;
  }
  aiAssistantState.pendingActions.push(...actions.map((action) => deepClone(action)));
  renderAiAssistantActions();
};

const executeAiPlanItem = async ({ request, plan, planItem, requireConfirmation, providerLabel }) => {
  const maxSteps = 1;
  let generatedCount = 0;
  for (let localStep = 0; localStep < maxSteps; localStep += 1) {
    const workingState = getAiAssistantWorkingState();
    const response = await authorizedFetch('/api/admin/ai/slide-actions', {
      method: 'POST',
      body: JSON.stringify({
        request,
        slides: workingState.slides,
        activeSlideId: workingState.activeSlideId,
        stageSize: builderState.stageSize.width && builderState.stageSize.height ? builderState.stageSize : DEFAULT_STAGE_SIZE,
        stepIndex: aiAssistantState.stepIndex,
        recentActions: aiAssistantState.recentActions,
        attachments: getAiAssistantAttachmentsPayload(),
        executionPlan: plan,
        currentPlanItem: planItem
      })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.message || 'A IA não conseguiu gerar a próxima etapa.');
    }
    syncProfessorCreditsFromPayload(result);
    aiAssistantState.debugInfo = {
      request,
      providerLabel: providerLabel || result?.providerLabel || '',
      requireConfirmation,
      plan,
      currentPlanItem: planItem,
      stepIndex: aiAssistantState.stepIndex,
      lastStepResult: result,
      generatedActionCount: aiAssistantState.generatedActions.length,
      pendingActionCount: aiAssistantState.pendingActions.length
    };
    renderAiAssistantDebug();
    if (result?.done) {
      pushAiAssistantFeedback(
        plan?.mode === 'simple' ? 'Pedido concluído' : `Slide ${planItem?.order || ''} planejado`,
        result?.message || 'Etapa concluída.',
        'success'
      );
      return generatedCount;
    }
    if (!result?.action) {
      throw new Error('A IA não retornou uma ação válida nesta etapa.');
    }
    const stepAction = deepClone(result.action);
    applyOrQueueAiActions([stepAction], { requireConfirmation });
    aiAssistantState.stepIndex += 1;
    generatedCount += 1;
    pushAiAssistantFeedback(
      plan?.mode === 'simple' ? 'Ação gerada' : `Slide ${planItem?.order || ''} em progresso`,
      result?.message || stepAction.reason || 'A IA gerou uma nova ação.',
      'success'
    );
  }
  pushAiAssistantFeedback(
    plan?.mode === 'simple' ? 'Encerrado' : `Slide ${planItem?.order || ''} encerrado`,
    'A etapa atingiu o limite de ações para evitar loops.',
    'muted'
  );
  return generatedCount;
};

const executeAiSlidePlanItem = async ({ request, plan, planItem, requireConfirmation, providerLabel }) => {
  const workingState = getAiAssistantWorkingState();
  const response = await authorizedFetch('/api/admin/ai/slide-actions', {
    method: 'POST',
    body: JSON.stringify({
      request,
      slides: workingState.slides,
      activeSlideId: workingState.activeSlideId,
      stageSize: builderState.stageSize.width && builderState.stageSize.height ? builderState.stageSize : DEFAULT_STAGE_SIZE,
      attachments: getAiAssistantAttachmentsPayload(),
      executionPlan: plan,
      currentPlanItem: planItem
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.message || 'Falha ao gerar o slide atual.');
  }
  syncProfessorCreditsFromPayload(result);
  const actions = Array.isArray(result?.actions) ? result.actions.map((action) => deepClone(action)) : [];
  aiAssistantState.debugInfo = {
    request,
    providerLabel: providerLabel || result?.providerLabel || '',
    requireConfirmation,
    plan,
    currentPlanItem: planItem,
    lastSlideResult: result,
    generatedActionCount: aiAssistantState.generatedActions.length,
    pendingActionCount: aiAssistantState.pendingActions.length
  };
  renderAiAssistantDebug();
  if (!actions.length) {
    pushAiAssistantFeedback(
      plan?.mode === 'simple' ? 'Pedido concluído' : `Slide ${planItem?.order || ''} sem mudanças`,
      'Nenhuma ação nova foi necessária para esta etapa.',
      'muted'
    );
    return 0;
  }
  applyOrQueueAiActions(actions, { requireConfirmation });
  aiAssistantState.stepIndex += 1;
  pushAiAssistantFeedback(
    plan?.mode === 'simple' ? 'Pedido gerado' : `Slide ${planItem?.order || ''} gerado`,
    `${actions.length} ação(ões) preparadas para ${planItem?.title || 'esta etapa'}.`,
    'success'
  );
  return actions.length;
};

const requestAiPlannedProposal = async (request) => {
  clearAiAssistantProposal();
  aiAssistantState.stopRequested = false;
  aiAssistantState.lastPrompt = request;
  updateBuilderStageSize();
  pushAiAssistantFeedback(
    'IA planejando',
    aiAssistantState.attachments.length
      ? 'Primeiro vou planejar a execução com base no prompt e na imagem anexada, depois montar por etapas.'
      : 'Primeiro vou planejar os passos e depois executar slide por slide.'
  );
  const planResponse = await requestAiExecutionPlan(request);
  const plan = planResponse?.plan || null;
  if (!plan || typeof plan !== 'object') {
    throw new Error('A IA não retornou um plano válido.');
  }
  aiAssistantState.executionPlan = deepClone(plan);
  aiAssistantState.debugInfo = {
    request,
    providerLabel: planResponse?.providerLabel || '',
    requireConfirmation: planResponse?.requireConfirmation !== false,
    plan,
    generatedActionCount: 0,
    pendingActionCount: 0
  };
  renderAiAssistantDebug();

  const requireConfirmation = planResponse?.requireConfirmation !== false;
  if (plan.mode === 'simple') {
    pushAiAssistantFeedback('Plano simples', plan.summary || 'Pedido pontual detectado. Vou gerar só o necessário.', 'success');
    await executeAiSlidePlanItem({
      request,
      plan,
      planItem: plan.simpleTask || { id: 'simple-task', title: 'Pedido simples', goal: request, order: 1 },
      requireConfirmation,
      providerLabel: planResponse?.providerLabel || ''
    });
  } else {
    const planItems = Array.isArray(plan.slides) ? plan.slides : [];
    pushAiAssistantFeedback(
      'Plano pronto',
      `${planItems.length} slide(s) separados antes da execução. Agora vou montar um por vez.`,
      'success'
    );
    for (const planItem of planItems) {
      pushAiAssistantFeedback(
        `Executando slide ${planItem.order || ''}`,
        `${planItem.title || 'Slide'}: ${planItem.goal || 'Montando o layout deste slide.'}`,
        'muted'
      );
      await executeAiSlidePlanItem({
        request,
        plan,
        planItem,
        requireConfirmation,
        providerLabel: planResponse?.providerLabel || ''
      });
    }
  }

  if (!aiAssistantState.generatedActions.length) {
    pushAiAssistantFeedback('Sem alterações', 'A IA concluiu o planejamento, mas não retornou mudanças aplicáveis.', 'muted');
    updateAiAssistantStatus('Nenhuma alteração válida foi gerada.');
    return;
  }

  rememberAiProposal(request, aiAssistantState.generatedActions);
  if (requireConfirmation) {
    renderAiAssistantActions();
    updateAiAssistantStatus(
      `Plano concluído com ${aiAssistantState.generatedActions.length} ação(ões). Revise e clique em aplicar.`,
      'success'
    );
  } else {
    updateAiAssistantStatus(`${aiAssistantState.generatedActions.length} ação(ões) executadas automaticamente.`, 'success');
  }
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
  syncProfessorCreditsFromPayload(result);
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
    syncProfessorCreditsFromPayload({ aiCreditCostPerCall: aiAssistantState.settings?.aiCreditCostPerCall });
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
    .map((slide) => {
      const classes = ['slide-chip'];
      if (slide.id === builderState.activeSlideId) {
        classes.push('active');
      }
      if (slide.id === draggingSlideId) {
        classes.push('is-drag-source');
      }
      if (slide.id === slideDropTargetId) {
        classes.push(slideDropPlacement === 'before' ? 'drop-before' : 'drop-after');
      }
      return `<button type="button" class="${classes.join(' ')}" data-slide-id="${slide.id}" draggable="true">${slide.title}</button>`;
    })
    .join('');
};

const clearSlideDragState = () => {
  draggingSlideId = null;
  slideDropTargetId = null;
  slideDropPlacement = 'after';
  if (!slideList) return;
  slideList.querySelectorAll('.slide-chip').forEach((chip) => {
    chip.classList.remove('is-drag-source', 'drop-before', 'drop-after');
  });
};

const moveSlideInStrip = (fromSlideId, toSlideId, placement = 'after') => {
  if (!fromSlideId || !toSlideId || fromSlideId === toSlideId) {
    return false;
  }
  const fromIndex = builderState.slides.findIndex((slide) => slide.id === fromSlideId);
  const toIndex = builderState.slides.findIndex((slide) => slide.id === toSlideId);
  if (fromIndex < 0 || toIndex < 0) {
    return false;
  }
  const [movedSlide] = builderState.slides.splice(fromIndex, 1);
  const adjustedTargetIndex = builderState.slides.findIndex((slide) => slide.id === toSlideId);
  if (adjustedTargetIndex < 0) {
    builderState.slides.push(movedSlide);
  } else {
    const insertionIndex = placement === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1;
    builderState.slides.splice(insertionIndex, 0, movedSlide);
  }
  return true;
};

const syncSlideDropVisualState = () => {
  if (!slideList) return;
  slideList.querySelectorAll('.slide-chip').forEach((chip) => {
    const slideId = chip.dataset.slideId;
    chip.classList.toggle('is-drag-source', Boolean(draggingSlideId && slideId === draggingSlideId));
    chip.classList.toggle('drop-before', Boolean(slideDropTargetId && slideId === slideDropTargetId && slideDropPlacement === 'before'));
    chip.classList.toggle('drop-after', Boolean(slideDropTargetId && slideId === slideDropTargetId && slideDropPlacement === 'after'));
  });
};

const renderSlide = () => {
  if (!slideCanvas) return;
  const slide = previewState.active ? getPreviewActiveSlide() : getActiveSlide();
  if (!slide) {
    if (previewState.active) {
      clearPreviewTimedSlideTriggerTimers();
      previewState.activeTimedSlideId = null;
    }
    slideCanvas.innerHTML = '';
    return;
  }
  if (previewState.active) {
    if (previewState.activeTimedSlideId !== slide.id) {
      clearPreviewTimedSlideTriggerTimers();
    }
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
  if (previewState.active) {
    snapshotPreviewMediaState(slide);
  }
  slideCanvas.innerHTML = '';
  setStageBackground(slide);
  if (!previewState.active) {
    syncBackgroundInputs(slide);
  }
  const deferredCaptionOverlays = [];
  if (!slide.elements.length) {
    if (previewState.active) {
      clearPreviewTimedSlideTriggerTimers();
    }
    const hint = document.createElement('p');
    hint.className = 'canvas-hint';
    hint.textContent = previewState.active
      ? 'Nenhum elemento neste slide da prévia.'
      : 'Arraste elementos aqui ou clique em um botão do painel para começar.';
    slideCanvas.appendChild(hint);
    clearHandleLayer();
    destroyEraserOverlay();
    if (!previewState.active) {
      renderPenOverlay();
    } else {
      destroyPenOverlay();
    }
    updateBuilderStageSize();
    return;
  }
  slide.elements
    .slice()
    .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0))
    .forEach((element) => {
      const node = previewState.active ? createPreviewElementNode(element, slide) : renderElementNode(element);
      slideCanvas.appendChild(node);
      if (['audio', 'video'].includes(element.type)) {
        const mediaNode = getPreviewMediaNode(node);
        const overlayNode = createMediaCaptionOverlayNode(element, mediaNode, {
          stageNode: slideCanvas,
          interactive: !previewState.active,
          keepVisibleWhenIdle: !previewState.active,
          onCommit: () => commitHistoryState(),
          onSelect: () => {
            if (!previewState.active) {
              selectElement(element.id);
            }
          }
        });
        if (overlayNode) {
          deferredCaptionOverlays.push({
            element,
            overlayNode,
            zIndex: Number(element.zIndex) || 0
          });
        }
      }
      if (!previewState.active) {
        expandElementToRenderedContent(element, node);
        if (!node.dataset.hasMenuTrigger) {
          slideCanvas.appendChild(createElementMenuTrigger(element));
        }
      }
    });
  deferredCaptionOverlays
    .sort((a, b) => a.zIndex - b.zIndex)
    .forEach(({ element, overlayNode, zIndex }) => {
      const overlayZIndex = selectedElementId === overlayNode.dataset.captionForElementId ? 1000000 : zIndex + 1000;
      overlayNode.style.zIndex = String(overlayZIndex);
      slideCanvas.appendChild(overlayNode);
      positionCaptionOverlayNode(overlayNode, element, slideCanvas);
    });
  if (deferredCaptionOverlays.length) {
    requestAnimationFrame(() => {
      deferredCaptionOverlays.forEach(({ element, overlayNode }) => positionCaptionOverlayNode(overlayNode, element, slideCanvas));
      if (!previewState.active) {
        renderHandles();
      }
    });
  }
  if (!previewState.active) {
    updateElementMenuTriggerVisibility();
    renderHandles();
    updateFloatingPlacementPreview();
    updateVideoPlacementPreview();
    renderEraserOverlay();
    renderPenOverlay();
  } else {
    clearHandleLayer();
    destroyEraserOverlay();
    destroyPenOverlay();
    schedulePreviewTimedSlideTriggers(slide);
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
    clearPreviewTimedSlideTriggerTimers();
    previewState.slides = [];
    previewState.activeSlideId = null;
    previewState.slideEnteredAt = 0;
    previewState.activeTimedSlideId = null;
    previewState.timedSlideTriggers = new Map();
    previewState.clickedRuleButtons = new Map();
    previewState.triggeredDetectors = new Set();
    previewState.replaceCounters = new Map();
    previewState.hiddenElements = new Map();
    previewState.mediaState = new Map();
    previewState.timedVideoTriggers = new Map();
    previewAnimationState.clear();
    lastPreviewAnimationSlideId = null;
    renderSlide();
    return;
  }
  previewState.active = true;
  previewState.slides = JSON.parse(JSON.stringify(builderState.slides || []));
  previewState.activeSlideId = builderState.activeSlideId || previewState.slides[0]?.id || null;
  previewState.slideEnteredAt = Date.now();
  previewState.activeTimedSlideId = null;
  previewState.timedSlideTriggerTimers = [];
  previewState.timedSlideTriggers = new Map();
  previewState.clickedRuleButtons = new Map();
  previewState.triggeredDetectors = new Set();
  previewState.replaceCounters = new Map();
  previewState.hiddenElements = new Map();
  previewState.mediaState = new Map();
  previewState.timedVideoTriggers = new Map();
  previewAnimationState.clear();
  lastPreviewAnimationSlideId = null;
  // Initialize initially hidden elements
  previewState.slides.forEach((slide) => {
    slide.elements?.forEach((element) => {
      if (element.initiallyHidden) {
        setPreviewElementHidden(slide.id, element.id, true);
      }
    });
  });
  renderSlide();
};

const startResize = (direction, element, event) => {
  event.preventDefault();
  event.stopPropagation();
  const startPointer = getStagePointerPosition(event);
  const startBox = getStageRelativeElementBox(element);
  const startWidth = Math.max(MIN_ELEMENT_SIZE, Number(startBox.width) || Number(element.width) || MIN_ELEMENT_SIZE);
  const startHeight = Math.max(MIN_ELEMENT_SIZE, Number(startBox.height) || Number(element.height) || MIN_ELEMENT_SIZE);
  const startLeft = Number.isFinite(Number(startBox.left)) ? Number(startBox.left) : (element.x || 0);
  const startTop = Number.isFinite(Number(startBox.top)) ? Number(startBox.top) : (element.y || 0);
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
  const elementBox = getStageRelativeElementBox(element);
  const width = Math.max(MIN_ELEMENT_SIZE, Number(elementBox.width) || Number(element.width) || MIN_ELEMENT_SIZE);
  const height = Math.max(MIN_ELEMENT_SIZE, Number(elementBox.height) || Number(element.height) || MIN_ELEMENT_SIZE);
  const centerX = stageRect.left + ((elementBox.left || 0) + width / 2) * scale;
  const centerY = stageRect.top + ((elementBox.top || 0) + height / 2) * scale;
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

const startCaptionResize = (direction, element, event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!slideCanvas || !element) {
    return;
  }
  const startPointer = getStagePointerPosition(event);
  const startBox = getStageRelativeCaptionBox(element);
  if (!startBox) {
    return;
  }
  const stage = getCaptionStageSize(slideCanvas);
  const startStyle = normalizeCaptionStyle(element.captionStyle, element.type);
  const startWidth = Math.max(40, Number(startStyle.width) || startBox.width || 40);
  const startFontSize = Math.max(12, Number(startStyle.fontSize) || 12);
  const startX = Number.isFinite(startStyle.stageX) ? startStyle.stageX : startBox.left;
  const moveHandler = (moveEvent) => {
    const movePointer = getStagePointerPosition(moveEvent);
    const deltaX = movePointer.x - startPointer.x;
    const widthDelta = direction.includes('w') ? -deltaX : deltaX;
    const nextWidth = clamp(startWidth + widthDelta, 40, Math.max(40, stage.width));
    const scaleRatio = nextWidth / Math.max(startWidth, 1);
    const nextFontSize = clamp(Math.round(startFontSize * scaleRatio), 12, 96);
    let nextStageX = startX;
    if (startStyle.freePosition && direction.includes('w')) {
      const rightEdge = startX + startWidth;
      nextStageX = clamp(rightEdge - nextWidth, 0, Math.max(0, stage.width - nextWidth));
    } else if (startStyle.freePosition) {
      nextStageX = clamp(startX, 0, Math.max(0, stage.width - nextWidth));
    }
    element.captionStyle = normalizeCaptionStyle({
      ...element.captionStyle,
      width: nextWidth,
      fontSize: nextFontSize,
      stageX: startStyle.freePosition ? nextStageX : null,
      stageY: startStyle.freePosition ? startStyle.stageY : null
    }, element.type);
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
  const elementBox = getStageRelativeElementBox(element);
  const left = elementBox.left || 0;
  const top = elementBox.top || 0;
  const width = Math.max(MIN_ELEMENT_SIZE, Number(elementBox.width) || MIN_ELEMENT_SIZE);
  const height = Math.max(MIN_ELEMENT_SIZE, Number(elementBox.height) || MIN_ELEMENT_SIZE);
  handleLayer = document.createElement('div');
  handleLayer.className = 'element-handle-layer';
  handleLayer.style.zIndex = '999999';
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
  if (['audio', 'video'].includes(element.type) && element.captionsEnabled && (element.captions || []).length) {
    const captionBox = getStageRelativeCaptionBox(element);
    if (captionBox) {
      const captionOutline = document.createElement('div');
      captionOutline.className = 'caption-handle-outline';
      captionOutline.style.left = `${captionBox.left}px`;
      captionOutline.style.top = `${captionBox.top}px`;
      captionOutline.style.width = `${captionBox.width}px`;
      captionOutline.style.height = `${captionBox.height}px`;
      handleLayer.appendChild(captionOutline);
      const captionCorners = ['nw', 'ne', 'sw', 'se'];
      captionCorners.forEach((direction) => {
        const handle = document.createElement('div');
        handle.className = 'resize-handle caption-resize-handle';
        handle.dataset.direction = direction;
        const offsetX = direction.includes('e') ? captionBox.width : 0;
        const offsetY = direction.includes('s') ? captionBox.height : 0;
        handle.style.left = `${captionBox.left + offsetX - 6}px`;
        handle.style.top = `${captionBox.top + offsetY - 6}px`;
        handle.addEventListener('pointerdown', (resizeEvent) => startCaptionResize(direction, element, resizeEvent));
        handleLayer.appendChild(handle);
      });
    }
  }
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

const applyBackgroundConfigToSlide = (slide, mode, sourceValue = '') => {
  if (!slide) return;
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
  } else if (mode === 'image-url' || mode === 'image-local') {
    clearSlideBackgroundMedia(slide);
    slide.backgroundImage = String(sourceValue || '').trim();
  } else if (mode === 'video-url' || mode === 'video-local') {
    clearSlideBackgroundMedia(slide);
    const normalizedSource = String(sourceValue || '').trim();
    slide.backgroundVideo = normalizedSource;
    slide.backgroundVideoEmbedSrc = getYouTubeEmbedUrl(normalizedSource);
    slide.backgroundVideoProvider =
      mode === 'video-local'
        ? 'file'
        : (slide.backgroundVideoEmbedSrc ? 'youtube' : 'file');
  }
  normalizeSlideBackgroundFill(slide);
};

const createBatchBackgroundSlides = (mode, sources = []) => {
  const baseSlide = getActiveSlide();
  if (!baseSlide || !sources.length) {
    return [];
  }
  let anchorSlideId = baseSlide.id;
  const createdSlides = sources.map((source, index) => {
    const newSlide = {
      id: createId('slide'),
      title: `Slide ${builderState.slides.length + index + 1}`,
      elements: []
    };
    applyBackgroundConfigToSlide(newSlide, mode, source);
    insertSlideAfter(newSlide, anchorSlideId);
    anchorSlideId = newSlide.id;
    return newSlide;
  });
  return createdSlides;
};

const applyBackgroundMediaFromEditor = async (modeOverride = '') => {
  const slide = getActiveSlide();
  const mode = modeOverride || backgroundMediaTypeSelect?.value || 'image-url';
  const isBatch = Boolean(backgroundBatchToggle?.checked);
  if (!slide) return;
  try {
    if (mode === 'image-url') {
      const src = backgroundMediaUrlInput?.value?.trim();
      if (!src) {
        alert('Informe a URL da imagem.');
        return;
      }
      const sources = isBatch ? parseBatchBackgroundUrls(src) : [src];
      if (!sources.length) {
        alert('Informe ao menos uma URL válida.');
        return;
      }
      if (isBatch && sources.length > 1) {
        const createdSlides = createBatchBackgroundSlides('image-url', sources);
        if (!createdSlides.length) return;
        setActiveSlide(createdSlides[createdSlides.length - 1].id);
        updateBackgroundMediaEditorVisibility(true);
        scheduleHistoryCommit();
        return;
      }
      applyBackgroundConfigToSlide(slide, 'image-url', sources[0]);
    } else if (mode === 'video-url') {
      const src = backgroundMediaUrlInput?.value?.trim();
      if (!src) {
        alert('Informe a URL do vídeo.');
        return;
      }
      const sources = isBatch ? parseBatchBackgroundUrls(src) : [src];
      if (!sources.length) {
        alert('Informe ao menos uma URL válida.');
        return;
      }
      if (isBatch && sources.length > 1) {
        const createdSlides = createBatchBackgroundSlides('video-url', sources);
        if (!createdSlides.length) return;
        setActiveSlide(createdSlides[createdSlides.length - 1].id);
        updateBackgroundMediaEditorVisibility(true);
        scheduleHistoryCommit();
        return;
      }
      applyBackgroundConfigToSlide(slide, 'video-url', sources[0]);
    } else if (mode === 'image-local') {
      const sources = isBatch
        ? await readLocalFiles(localImageInput, 'image')
        : [await readLocalFile(localImageInput, 'image')].filter(Boolean);
      if (!sources.length) return;
      if (isBatch && sources.length > 1) {
        const createdSlides = createBatchBackgroundSlides('image-local', sources);
        if (!createdSlides.length) return;
        setActiveSlide(createdSlides[createdSlides.length - 1].id);
        updateBackgroundMediaEditorVisibility(true);
        scheduleHistoryCommit();
        return;
      }
      applyBackgroundConfigToSlide(slide, 'image-local', sources[0]);
    } else if (mode === 'video-local') {
      const sources = isBatch
        ? await readLocalFiles(localVideoInput, 'video')
        : [await readLocalFile(localVideoInput, 'video')].filter(Boolean);
      if (!sources.length) return;
      if (isBatch && sources.length > 1) {
        const createdSlides = createBatchBackgroundSlides('video-local', sources);
        if (!createdSlides.length) return;
        setActiveSlide(createdSlides[createdSlides.length - 1].id);
        updateBackgroundMediaEditorVisibility(true);
        scheduleHistoryCommit();
        return;
      }
      applyBackgroundConfigToSlide(slide, 'video-local', sources[0]);
    } else {
      applyBackgroundConfigToSlide(slide, mode);
    }
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
    isPublic: Boolean(modulePublicToggle?.checked),
    coverImage: getModuleCoverValue()
  };
  syncPublicModuleLinkUi();
  syncModuleCoverPreview();
  commitHistoryState();
}

const resetBuilder = () => {
  builderState.slides = [];
  builderState.activeSlideId = null;
  builderState.moduleSettings = {
    lockNextModuleUntilCompleted: false,
    isPublic: false,
    coverImage: ''
  };
  if (moduleCoverUrlInput) {
    moduleCoverUrlInput.value = '';
  }
  if (moduleLockNextToggle) {
    moduleLockNextToggle.checked = false;
  }
  if (modulePublicToggle) {
    modulePublicToggle.checked = false;
  }
  syncPublicModuleLinkUi();
  syncModuleCoverPreview();
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
        <div class="module-list-content">
          <h4>${module.title}</h4>
          <p>${module.description || module.slug}</p>
          ${isPublicModule ? '<small class="muted module-list-status">Link público liberado para este módulo.</small>' : ''}
        </div>
        <div class="actions">
          ${isPublicModule
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
  if (moduleCoverUrlInput) {
    moduleCoverUrlInput.value = '';
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
  syncModuleCoverPreview();
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
    isPublic: Boolean(module.builder_data?.moduleSettings?.isPublic),
    coverImage: typeof module.builder_data?.moduleSettings?.coverImage === 'string' ? module.builder_data.moduleSettings.coverImage : ''
  };
  if (moduleCoverUrlInput) {
    moduleCoverUrlInput.value = builderState.moduleSettings.coverImage || '';
  }
  if (moduleLockNextToggle) {
    moduleLockNextToggle.checked = Boolean(builderState.moduleSettings.lockNextModuleUntilCompleted);
  }
  if (modulePublicToggle) {
    modulePublicToggle.checked = Boolean(builderState.moduleSettings.isPublic);
  }
  syncModuleCoverPreview();
  setPublicModuleLinkState(
    builderState.moduleSettings.isPublic
      ? { moduleId: module.id, title: module.title }
      : {}
  );
  syncPublicModuleLinkUi();
  syncModuleCoverPreview();
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
    if (elementOpacityInput) {
      elementOpacityInput.value = '100';
    }
    if (elementOpacityValue) {
      elementOpacityValue.textContent = '100%';
    }
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
    if (elementInitiallyHiddenToggle) {
      elementInitiallyHiddenToggle.checked = false;
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
  if (element.type === 'input') {
    normalizeInputElement(element);
  }
  elementWidthInput.value = element.width || '';
  elementHeightInput.value = element.height || '';
  elementRotationInput.value = element.rotation != null ? element.rotation : '';
  elementLayerInput.value = element.zIndex != null ? element.zIndex : 0;
  if (elementOpacityInput) {
    elementOpacityInput.value = String(Math.round(getElementBaseOpacity(element) * 100));
  }
  if (elementOpacityValue) {
    elementOpacityValue.textContent = `${Math.round(getElementBaseOpacity(element) * 100)}%`;
  }
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
  if (elementInitiallyHiddenToggle) {
    elementInitiallyHiddenToggle.checked = Boolean(element.initiallyHidden);
  }
  updateTextEditorVisibility(element);
  updateBlockEditorVisibility(element);
  updateImageEditorVisibility(element);
  updateAudioEditorVisibility(element);
  updateQuizEditorVisibility(element);
  updateFloatingButtonEditorVisibility(element);
  updateVideoEditorVisibility(element);
  updateEraserEditorVisibility(element);
  updatePenEditorVisibility(element);
  updateAnimationEditorVisibility(element);
  updateSmartSidebarVisibility(element);
  if (removeSelectedElementBtn) {
    removeSelectedElementBtn.disabled = false;
  }
  selectedMotionFrameIndex = Array.isArray(element.motionFrames) ? Math.min(selectedMotionFrameIndex, element.motionFrames.length - 1) : -1;
  updateHistoryButtons();
}

const getPrimaryEditorForElement = (element) => {
  switch (element?.type) {
    case 'text':
      return 'text';
    case 'block':
      return 'block';
    case 'image':
      return 'image';
    case 'pen':
      return 'pen';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    case 'quiz':
      return 'quiz';
    case 'floatingButton':
    case 'detector':
    case 'timedTrigger':
    case 'input':
      return 'floating';
    default:
      return 'none';
  }
};

function selectElement(elementId, options = {}) {
  const { openEditor = false } = options;
  const previousScrollX = window.scrollX;
  const previousScrollY = window.scrollY;
  selectedElementId = elementId;
  showElementMenuTrigger(openEditor ? elementId : null);
  const element = getActiveSlide()?.elements.find((child) => child.id === elementId);
  currentStageEditor = openEditor ? getPrimaryEditorForElement(element) : 'none';
  updateElementInspector(element || null);
  renderSlide();
  requestAnimationFrame(() => {
    window.scrollTo(previousScrollX, previousScrollY);
  });
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
  try {
    const src = await readLocalFile(localImageInput, 'image');
    if (!src) {
      return;
    }
    element.src = src;
    updateImageEditorVisibility(element, { forceOpen: true });
    renderSlide();
    commitHistoryState();
  } catch (error) {
    alert(error.message || 'Não foi possível carregar a imagem escolhida.');
  }
};

const replaceSelectedBlockTexture = async () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'block') {
    return;
  }
  try {
    const src = await readLocalFile(localImageInput, 'image');
    if (!src) {
      return;
    }
    element.textureImage = src;
    normalizeBlockTexture(element);
    syncBlockEditorControls(element);
    renderSlide();
    commitHistoryState();
  } catch (error) {
    alert(error.message || 'Não foi possível carregar a textura escolhida.');
  }
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
  element.captionsEnabled = Boolean(audioCaptionEnabledToggle?.checked);
  const nextPosition = audioCaptionPositionSelect?.value || 'bottom';
  element.captionStyle = normalizeCaptionStyle({
    width: audioCaptionWidthInput?.value || '',
    position: nextPosition,
    fontSize: Number(audioCaptionFontSizeInput?.value) || 20,
    textColor: audioCaptionTextColorInput?.value || '#ffffff',
    backgroundColor: audioCaptionBackgroundColorInput?.value || '#0f172a',
    accentColor: audioCaptionAccentColorInput?.value || '#38bdf8',
    uppercase: Boolean(audioCaptionUppercaseToggle?.checked),
    freePosition: false,
    stageX: null,
    stageY: null
  }, 'audio');
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
  try {
    const src = await readLocalFile(localAudioInput, 'audio');
    if (!src) {
      return;
    }
    element.src = src;
    normalizeAudioElement(element);
    updateAudioEditorVisibility(element, { forceOpen: true });
    renderSlide();
    commitHistoryState();
  } catch (error) {
    alert(error.message || 'Não foi possível carregar o áudio escolhido.');
  }
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
  const opacitySource = elementOpacityInput;
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
  if (opacitySource) {
    const opacityValue = Number(opacitySource.value);
    if (!Number.isNaN(opacityValue)) {
      element.opacity = clamp(opacityValue / 100, 0, 1);
      if (elementOpacityValue) {
        elementOpacityValue.textContent = `${Math.round(element.opacity * 100)}%`;
      }
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
  if (elementInitiallyHiddenToggle) {
    element.initiallyHidden = Boolean(elementInitiallyHiddenToggle.checked);
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
            isPublic: Boolean(builderState.moduleSettings?.isPublic),
            coverImage: getModuleCoverValue()
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
  if (element.type === 'pen') {
    element.strokeColor = element.strokeColor || '#111827';
    element.strokeWidth = Math.max(PEN_MIN_BRUSH_SIZE, Number(element.strokeWidth) || 8);
    element.backgroundColor = 'transparent';
  }
  if (!Number.isFinite(Number(element.opacity))) {
    element.opacity = 1;
  }
  if (element.type === 'floatingButton' && !element.backgroundColor) {
    element.backgroundColor = '#6d63ff';
    element.solidColor = '#6d63ff';
  }
  if (element.type === 'detector') {
    normalizeFloatingActionConfig(element);
    element.backgroundColor = 'transparent';
  }
  if (element.type === 'timedTrigger') {
    normalizeFloatingActionConfig(element);
    delete element.backgroundColor;
    delete element.solidColor;
  }
  if (['block', 'floatingButton'].includes(element.type) && !element.shape) {
    element.shape = 'rectangle';
  }
  if (element.type === 'quiz') {
    normalizeQuizElement(element);
  }
  if (element.type === 'input') {
    normalizeInputElement(element);
    normalizeFloatingActionConfig(element);
  }
  if (element.type === 'floatingButton') {
    normalizeFloatingActionConfig(element);
  }
  if (element.type === 'timedTrigger') {
    normalizeFloatingActionConfig(element);
  }
  if (element.type === 'video') {
    normalizeVideoTriggerConfig(element);
  }
  if (ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    normalizeElementAnimation(element);
  }
  if (element.type === 'block') {
    normalizeBlockTexture(element);
  }
  element.opacity = getElementBaseOpacity(element);
  syncElementBackgroundState(element);
  ensureElementHasUsableSize(element);
  slide.elements.push(element);
  applyStageConstraints(element);
  selectElement(element.id, { openEditor: true });
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
  element.opacity = getElementBaseOpacity(element);
  if (!element.textColor) {
    element.textColor = element.type === 'floatingButton' ? '#ffffff' : '#0f142c';
  }
  if (element.type === 'block' && !element.backgroundColor) {
    element.backgroundColor = '#f4f6ff';
    element.solidColor = '#f4f6ff';
  }
  if (element.type === 'pen') {
    element.strokeColor = element.strokeColor || '#111827';
    element.strokeWidth = Math.max(PEN_MIN_BRUSH_SIZE, Number(element.strokeWidth) || 8);
    element.backgroundColor = 'transparent';
  }
  if (element.type === 'floatingButton' && !element.backgroundColor) {
    element.backgroundColor = '#6d63ff';
    element.solidColor = '#6d63ff';
  }
  if (element.type === 'detector') {
    normalizeFloatingActionConfig(element);
    element.backgroundColor = 'transparent';
  }
  if (element.type === 'timedTrigger') {
    normalizeFloatingActionConfig(element);
    delete element.backgroundColor;
    delete element.solidColor;
  }
  if (element.type === 'quiz') {
    normalizeQuizElement(element);
  }
  if (element.type === 'input') {
    normalizeInputElement(element);
    normalizeFloatingActionConfig(element);
  }
  if (element.type === 'floatingButton') {
    normalizeFloatingActionConfig(element);
  }
  if (element.type === 'timedTrigger') {
    normalizeFloatingActionConfig(element);
  }
  if (element.type === 'video') {
    normalizeVideoTriggerConfig(element);
  }
  if (ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    normalizeElementAnimation(element);
  }
  if (['block', 'floatingButton'].includes(element.type) && !element.shape) {
    element.shape = 'rectangle';
  }
  if (element.type === 'block') {
    normalizeBlockTexture(element);
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
  selectElement(pastedElement.id, { openEditor: true });
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
  if (element.type === 'video') {
    normalizeVideoTriggerConfig(element);
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

const getFallbackAiSlideTargetFromState = (targetState, requestedSlideId) => {
  const existingSlides = targetState?.slides || [];
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
  const activeSlide = existingSlides.find((entry) => entry.id === targetState?.activeSlideId);
  return activeSlide || existingSlides[0];
};

const getFallbackAiSlideTarget = (requestedSlideId) => getFallbackAiSlideTargetFromState(builderState, requestedSlideId);

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

const insertSlideAfterInState = (targetState, slide, afterSlideId) => {
  const targetSlides = Array.isArray(targetState?.slides) ? targetState.slides : [];
  if (!afterSlideId) {
    targetSlides.push(slide);
    return;
  }
  const targetIndex = targetSlides.findIndex((entry) => entry.id === afterSlideId);
  if (targetIndex === -1) {
    targetSlides.push(slide);
    return;
  }
  targetSlides.splice(targetIndex + 1, 0, slide);
};

const createFallbackSlideFromAiUpdate = (targetState, action = {}) => {
  if (!targetState || !action.slide || typeof action.slide !== 'object') {
    return null;
  }
  const existingSlides = Array.isArray(targetState.slides) ? targetState.slides : [];
  const slide = {
    id: action.slideId || action.slide.id || createId('slide'),
    title: action.slide.title || `Slide ${existingSlides.length + 1}`,
    elements: [],
    backgroundImage: action.slide.backgroundImage || null,
    backgroundColor: action.slide.backgroundColor || '#fdfbff'
  };
  insertSlideAfterInState(targetState, slide, action.afterSlideId);
  return slide;
};

const addElementToSpecificSlideState = (targetState, slideId, config) => {
  const slide = targetState?.slides?.find((entry) => entry.id === slideId);
  if (!slide) {
    throw new Error(`Slide alvo nÃ£o encontrado: ${slideId}`);
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
  element.opacity = getElementBaseOpacity(element);
  if (!element.textColor) {
    element.textColor = element.type === 'floatingButton' ? '#ffffff' : '#0f142c';
  }
  if (element.type === 'block' && !element.backgroundColor) {
    element.backgroundColor = '#f4f6ff';
    element.solidColor = '#f4f6ff';
  }
  if (element.type === 'pen') {
    element.strokeColor = element.strokeColor || '#111827';
    element.strokeWidth = Math.max(PEN_MIN_BRUSH_SIZE, Number(element.strokeWidth) || 8);
    element.backgroundColor = 'transparent';
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
  if (element.type === 'video') {
    normalizeVideoTriggerConfig(element);
  }
  if (ANIMATABLE_ELEMENT_TYPES.has(element.type)) {
    normalizeElementAnimation(element);
  }
  if (['block', 'floatingButton'].includes(element.type) && !element.shape) {
    element.shape = 'rectangle';
  }
  if (element.type === 'block') {
    normalizeBlockTexture(element);
  }
  syncElementBackgroundState(element);
  ensureElementHasUsableSize(element);
  applyStageConstraints(element);
  slide.elements.push(element);
  return element;
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
    if (Array.isArray(action.element?.interactionTriggers)) {
      action.element.interactionTriggers.forEach((trigger) => {
        if (trigger?.actionConfig?.targetSlideId) {
          trigger.actionConfig.targetSlideId = resolveSlideAlias(trigger.actionConfig.targetSlideId);
        }
        if (trigger?.actionConfig?.targetElementId) {
          trigger.actionConfig.targetElementId = resolveElementAlias(trigger.actionConfig.targetElementId);
        }
      });
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
        let slide = getFallbackAiSlideTarget(action.slideId);
        if (!slide && action.slide) {
          slide = createFallbackSlideFromAiUpdate(builderState, action);
          if (slide && action.slideId) {
            slideAliasMap.set(action.slideId, slide.id);
          }
        }
        if (!slide || !action.slide) {
          applyWarnings.push(`Ação ${index + 1}: não encontrei o slide para update_slide (${action.slideId || 'sem slideId'}).`);
          break;
        }
        action.slideId = slide.id;
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

const applyAiActionsToState = (targetState, actions, options = {}) => {
  if (!Array.isArray(actions) || !actions.length) {
    return { appliedCount: 0, warnings: [], selectedElementId: options.selectedElementId || null };
  }
  let nextSelectedElementId = options.selectedElementId || null;
  let nextActiveSlideId = targetState?.activeSlideId || null;
  const applyWarnings = [];
  let appliedCount = 0;
  const slideAliasMap = new Map();
  const elementAliasMap = new Map();
  const resolveSlideAlias = (slideId = '') => slideAliasMap.get(slideId) || slideId;
  const resolveElementAlias = (elementId = '') => elementAliasMap.get(elementId) || elementId;

  actions.forEach((rawAction, index) => {
    const action = deepClone(rawAction);
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
    if (Array.isArray(action.element?.interactionTriggers)) {
      action.element.interactionTriggers.forEach((trigger) => {
        if (trigger?.actionConfig?.targetSlideId) {
          trigger.actionConfig.targetSlideId = resolveSlideAlias(trigger.actionConfig.targetSlideId);
        }
        if (trigger?.actionConfig?.targetElementId) {
          trigger.actionConfig.targetElementId = resolveElementAlias(trigger.actionConfig.targetElementId);
        }
      });
    }

    switch (action.type) {
      case 'add_slide': {
        const originalSlideId = action.slide?.id || '';
        const slide = {
          id: originalSlideId || createId('slide'),
          title: action.slide?.title || `Slide ${(targetState?.slides?.length || 0) + 1}`,
          elements: [],
          backgroundImage: action.slide?.backgroundImage || null,
          backgroundColor: action.slide?.backgroundColor || '#fdfbff'
        };
        insertSlideAfterInState(targetState, slide, action.afterSlideId);
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
        let slide = getFallbackAiSlideTargetFromState(targetState, action.slideId);
        if (!slide && action.slide) {
          slide = createFallbackSlideFromAiUpdate(targetState, action);
          if (slide && action.slideId) {
            slideAliasMap.set(action.slideId, slide.id);
          }
        }
        if (!slide || !action.slide) {
          applyWarnings.push(`Ação ${index + 1}: slide não encontrado para update_slide.`);
          break;
        }
        action.slideId = slide.id;
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
        if ((targetState?.slides?.length || 0) <= 1) {
          break;
        }
        const targetIndex = targetState.slides.findIndex((entry) => entry.id === action.slideId);
        if (targetIndex === -1) {
          break;
        }
        targetState.slides.splice(targetIndex, 1);
        if (nextActiveSlideId === action.slideId) {
          nextActiveSlideId =
            targetState.slides[targetIndex]?.id ||
            targetState.slides[targetIndex - 1]?.id ||
            targetState.slides[0]?.id ||
            null;
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
          applyWarnings.push(`Ação ${index + 1}: add_element sem tipo.`);
          break;
        }
        const targetSlide = getFallbackAiSlideTargetFromState(targetState, action.slideId);
        if (!targetSlide) {
          applyWarnings.push(`Ação ${index + 1}: slide não encontrado para add_element.`);
          break;
        }
        const created = addElementToSpecificSlideState(targetState, targetSlide.id, action.element);
        if (originalElementId) {
          elementAliasMap.set(originalElementId, created.id);
        }
        if (action.setActive !== false) {
          nextActiveSlideId = targetSlide.id;
          nextSelectedElementId = created.id;
        }
        appliedCount += 1;
        break;
      }
      case 'update_element': {
        const slide = getFallbackAiSlideTargetFromState(targetState, action.slideId);
        const element = getFallbackAiElementTarget(slide, action);
        if (!element || !action.element) {
          applyWarnings.push(`Ação ${index + 1}: elemento não encontrado para update_element.`);
          break;
        }
        updateElementFromPatch(element, action.element);
        if (action.setActive !== false) {
          nextActiveSlideId = slide.id;
          nextSelectedElementId = element.id;
        }
        appliedCount += 1;
        break;
      }
      case 'delete_element': {
        const slide = getFallbackAiSlideTargetFromState(targetState, action.slideId);
        if (!slide?.elements?.length) {
          applyWarnings.push(`Ação ${index + 1}: slide/elemento não encontrado para delete_element.`);
          break;
        }
        const targetElement = getFallbackAiElementTarget(slide, action);
        if (!targetElement) {
          applyWarnings.push(`Ação ${index + 1}: elemento não encontrado para delete_element.`);
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

  targetState.activeSlideId = nextActiveSlideId || targetState?.slides?.[0]?.id || null;
  return { appliedCount, warnings: applyWarnings, selectedElementId: nextSelectedElementId };
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
  startAiAssistantLoading('Planejando e executando com a IA');
  try {
    await requestAiPlannedProposal(request);
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

const setActionButtonBusy = (button, busy, idleLabel, busyLabel) => {
  if (!button) return;
  button.disabled = Boolean(busy);
  button.textContent = busy ? busyLabel : idleLabel;
};

const requestMediaTranscription = async (src, sourceType) => {
  const response = await authorizedFetch('/api/admin/media/transcribe', {
    method: 'POST',
    body: JSON.stringify({ src, sourceType })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || 'Nao foi possivel transcrever a midia.');
  }
  syncProfessorCreditsFromPayload(payload);
  return payload;
};

const applyGeneratedCaptionsToElement = (element, payload, type) => {
  normalizeMediaCaptionConfig(element, type);
  element.transcriptText = payload?.transcript || '';
  element.captions = sortCaptionEntries(payload?.captions || []);
  element.captionsEnabled = Boolean(element.captions.length);
  element.captionsGeneratedAt = new Date().toISOString();
  if (type === 'video') {
    selectedVideoCaptionSegmentIndex = 0;
  } else if (type === 'audio') {
    selectedAudioCaptionSegmentIndex = 0;
  }
};

const generateCaptionsForSelectedAudio = async () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'audio' || !element.src) {
    alert('Selecione um elemento de audio com fonte configurada.');
    return;
  }
  try {
    setActionButtonBusy(audioGenerateCaptionsBtn, true, 'Transcrever e gerar legenda', 'Transcrevendo...');
    const payload = await requestMediaTranscription(element.src, 'audio');
    applyGeneratedCaptionsToElement(element, payload, 'audio');
    updateAudioEditorVisibility(element, { forceOpen: true });
    renderSlide();
    commitHistoryState();
    alert('Legenda automatica gerada para o audio.');
  } catch (error) {
    alert(error.message || 'Nao foi possivel transcrever o audio.');
  } finally {
    setActionButtonBusy(audioGenerateCaptionsBtn, false, 'Transcrever e gerar legenda', 'Transcrevendo...');
  }
};

const generateCaptionsForSelectedVideo = async () => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'video' || !element.src) {
    alert('Selecione um elemento de video com fonte configurada.');
    return;
  }
  if (element.provider === 'youtube') {
    alert('A geracao de legenda automatica nao esta disponivel para links do YouTube neste fluxo.');
    return;
  }
  try {
    setActionButtonBusy(videoGenerateCaptionsBtn, true, 'Gerar legenda automática', 'Gerando legenda...');
    const payload = await requestMediaTranscription(element.src, 'video');
    applyGeneratedCaptionsToElement(element, payload, 'video');
    updateVideoEditorVisibility(element, { forceOpen: true });
    renderSlide();
    commitHistoryState();
    alert('Legenda automatica gerada para o video.');
  } catch (error) {
    alert(error.message || 'Nao foi possivel transcrever o video.');
  } finally {
    setActionButtonBusy(videoGenerateCaptionsBtn, false, 'Gerar legenda automática', 'Gerando legenda...');
  }
};

const extractAudioFromSelectedVideo = async () => {
  const slide = getActiveSlide();
  const element = slide?.elements.find((child) => child.id === selectedElementId);
  if (!slide || !element || element.type !== 'video' || !element.src) {
    alert('Selecione um elemento de video com fonte configurada.');
    return;
  }
  if (element.provider === 'youtube') {
    alert('A extracao de audio nao esta disponivel para links do YouTube neste fluxo.');
    return;
  }
  try {
    setActionButtonBusy(videoExtractAudioBtn, true, 'Extrair áudio do vídeo', 'Extraindo áudio...');
    const response = await authorizedFetch('/api/admin/media/extract-audio', {
      method: 'POST',
      body: JSON.stringify({ src: element.src })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Nao foi possivel extrair o audio.');
    }
    const stage = getStageDimensions();
    slide.elements.push({
      id: createId('element'),
      type: 'audio',
      src: payload?.audioDataUrl || '',
      width: Math.min(Math.max(260, Number(element.width) || 320), Math.max(260, stage.width - 24)),
      height: 80,
      x: Math.max(0, Number(element.x) || 0),
      y: Math.min(Math.max(0, (Number(element.y) || 0) + (Number(element.height) || 190) + 18), Math.max(0, stage.height - 96)),
      audioVisible: true,
      audioLoop: false,
      captionsEnabled: false,
      initiallyHidden: false
    });
    renderSlide();
    commitHistoryState();
    alert('Audio extraido e adicionado como novo elemento no slide.');
  } catch (error) {
    alert(error.message || 'Nao foi possivel extrair o audio do video.');
  } finally {
    setActionButtonBusy(videoExtractAudioBtn, false, 'Extrair áudio do vídeo', 'Extraindo áudio...');
  }
};

const applySelectedImageSourceFromEditor = async (preferredMode = '') => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'image') {
    return;
  }
  const mode = preferredMode || imageSourceModeSelect?.value || 'local';
  if (mode === 'url') {
    const nextUrl = imageSourceUrlInput?.value?.trim() || '';
    if (!nextUrl) {
      alert('Informe a URL da imagem.');
      return;
    }
    element.src = nextUrl;
  } else {
    try {
      const src = await readLocalFile(localImageInput, 'image');
      if (!src) return;
      element.src = src;
    } catch (error) {
      alert(error.message || 'Não foi possível carregar a imagem escolhida.');
      return;
    }
  }
  updateImageEditorVisibility(element, { forceOpen: true });
  renderSlide();
  commitHistoryState();
};

const applySelectedAudioSourceFromEditor = async (preferredMode = '') => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'audio') {
    return;
  }
  const mode = preferredMode || audioSourceModeSelect?.value || 'local';
  if (mode === 'url') {
    const nextUrl = audioSourceUrlInput?.value?.trim() || '';
    if (!nextUrl) {
      alert('Informe a URL do áudio.');
      return;
    }
    element.src = nextUrl;
  } else {
    try {
      const src = await readLocalFile(localAudioInput, 'audio');
      if (!src) return;
      element.src = src;
    } catch (error) {
      alert(error.message || 'Não foi possível carregar o áudio escolhido.');
      return;
    }
  }
  normalizeAudioElement(element);
  updateAudioEditorVisibility(element, { forceOpen: true });
  renderSlide();
  commitHistoryState();
};

const applySelectedVideoSourceFromEditor = async (preferredMode = '') => {
  const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId);
  if (!element || element.type !== 'video') {
    return;
  }
  const mode = preferredMode || videoSourceModeSelect?.value || 'local';
  let nextConfig = null;
  if (mode === 'url') {
    const nextUrl = videoSourceUrlInput?.value?.trim() || '';
    if (!nextUrl) {
      alert('Informe a URL do vídeo.');
      return;
    }
    nextConfig = buildVideoElementConfig(nextUrl, element.width || 320, element.height || 190);
  } else {
    try {
      const src = await readLocalFile(localVideoInput, 'video');
      if (!src) return;
      nextConfig = buildVideoElementConfig(src, element.width || 320, element.height || 190);
    } catch (error) {
      alert(error.message || 'Não foi possível carregar o vídeo escolhido.');
      return;
    }
  }
  element.src = nextConfig.src || '';
  if (nextConfig.provider === 'youtube' && nextConfig.embedSrc) {
    element.provider = 'youtube';
    element.embedSrc = nextConfig.embedSrc;
  } else {
    delete element.provider;
    delete element.embedSrc;
  }
  updateVideoEditorVisibility(element, { forceOpen: true });
  renderSlide();
  commitHistoryState();
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
  if (type !== 'eraser' && eraserState.active) {
    closeEraserSession({ keepEditor: false });
  }
  if (type !== 'pen' && penState.active) {
    closePenSession({ keepEditor: false });
  }
  if (type === 'eraser') {
    const selectedElement = getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null;
    if (!selectedElement || !canUseEraserOnElement(selectedElement)) {
      alert('Selecione uma imagem, bloco ou traço da caneta antes de usar a borracha.');
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
  if (type === 'pen') {
    currentStageEditor = 'pen';
    updatePenEditorVisibility(getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'pen') || null, { forceOpen: true });
    startPenDrawingSession();
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
      config.initiallyHidden = false;
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
      config.initiallyHidden = false;
      break;
    }
    case 'image':
      currentStageEditor = 'image';
      config = { type: 'image', src: IMAGE_FALLBACK_SRC, width: 280, height: 180, initiallyHidden: false };
      break;
    case 'audio':
      currentStageEditor = 'audio';
      config = { type: 'audio', src: '', width: 260, height: 70, audioVisible: true, audioLoop: false, initiallyHidden: false };
      break;
    case 'video':
      currentStageEditor = 'video';
      config = { type: 'video', src: '', width: 320, height: 190, videoTriggers: [createVideoTrigger({ name: 'Tempo 1' })], initiallyHidden: false };
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
    case 'input': {
      currentStageEditor = 'floating';
      config.placeholder = 'Digite sua resposta';
      config.submitLabel = 'Enviar resposta';
      config.compareText = '';
      config.compareCaseSensitive = false;
      config.compareImageEnabled = false;
      config.compareImageReference = '';
      config.successMessage = 'Resposta enviada com sucesso.';
      config.errorMessage = 'A palavra não confere. Tente novamente.';
      config.allowImage = true;
      config.allowAudio = true;
      config.width = 360;
      config.height = 88;
      config.interactionTriggers = [createInteractionTrigger('input', { name: 'Envio 1' })];
      config.actionConfig = config.interactionTriggers[0].actionConfig;
      config.initiallyHidden = false;
      break;
    }
    case 'floatingButton': {
      config.label = 'Explorar agora';
      config.shape = 'rectangle';
      config.width = 170;
      config.height = 60;
      config.fontSize = 18;
      config.fontFamily = 'Inter, sans-serif';
      config.fontWeight = '700';
      config.interactionTriggers = [createInteractionTrigger('floatingButton', { name: 'Ação 1' })];
      config.actionConfig = config.interactionTriggers[0].actionConfig;
      config.initiallyHidden = false;
      break;
    }
    case 'detector': {
      config.width = 180;
      config.height = 120;
      config.x = 240;
      config.y = 220;
      config.interactionTriggers = [createInteractionTrigger('detector', { name: 'Gatilho 1' })];
      config.actionConfig = config.interactionTriggers[0].actionConfig;
      config.initiallyHidden = false;
      break;
    }
    case 'timedTrigger': {
      currentStageEditor = 'floating';
      config.width = 180;
      config.height = 56;
      config.x = 220;
      config.y = 90;
      config.interactionTriggers = [createInteractionTrigger('timedTrigger', { name: 'Tempo 1', time: 3 })];
      config.actionConfig = config.interactionTriggers[0].actionConfig;
      config.initiallyHidden = false;
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
    if (previewState.active && element.playSourceVideoOnValidate && element.sourceVideoElementId) {
      controlPreviewVideoElement(getPreviewActiveSlide(), element.sourceVideoElementId, 'playVideo');
    }
  });
  return node;
};

const readLocalFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
    reader.readAsDataURL(file);
  });

const comparePreviewInputImageWithReference = async ({ referenceImage, submittedImage }) => {
  const response = await authorizedFetch('/api/admin/input/compare-image', {
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
  syncProfessorCreditsFromPayload(payload);
  return {
    matched: Boolean(payload?.matched),
    confidence: Math.max(0, Math.min(1, Number(payload?.confidence) || 0)),
    reason: String(payload?.reason || '').trim()
  };
};

const createInputElementNode = (element, { runActions = null, preview = false } = {}) => {
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
  const labelColor = element.labelColor || '#9ca3af';
  const buttonBgColor = element.submitButtonColor || '#6d63ff';
  const buttonTextColor = element.submitButtonTextColor || '#ffffff';
  const textFieldMarkup = showTextField
    ? `<textarea class="builder-input-text" style="background-color: ${inputBgColor}; color: ${inputTextColor};" placeholder="${escapeHtml(element.placeholder || 'Digite sua resposta')}"></textarea>`
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
    if (!preview) {
      return;
    }
    setFileInputValue(imageInput);
    imageInput?.click();
  });
  audioBtn?.addEventListener('click', () => {
    if (!preview) {
      return;
    }
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
  if (!preview) {
    if (textArea instanceof HTMLTextAreaElement) {
      textArea.readOnly = true;
      textArea.tabIndex = -1;
    }
    if (imageBtn instanceof HTMLButtonElement) {
      imageBtn.tabIndex = -1;
      imageBtn.type = 'button';
    }
    if (audioBtn instanceof HTMLButtonElement) {
      audioBtn.tabIndex = -1;
      audioBtn.type = 'button';
    }
    if (submitBtn instanceof HTMLButtonElement) {
      submitBtn.tabIndex = -1;
      submitBtn.type = 'button';
    }
    setFileInputValue(imageInput);
    setFileInputValue(audioInput);
  }
  submitBtn?.addEventListener('click', async () => {
    if (!preview) {
      return;
    }
    const submittedText = textArea instanceof HTMLTextAreaElement ? textArea.value : '';
    const expected = normalizeInputCompareValue(element.compareText || '', Boolean(element.compareCaseSensitive));
    const received = normalizeInputCompareValue(submittedText, Boolean(element.compareCaseSensitive));
    const textMatched = !expected || received === expected;
    const finishSubmit = (matched, message) => {
      if (feedbackNode) {
        feedbackNode.textContent = message;
        feedbackNode.className = `builder-input-feedback ${matched ? 'success' : 'error'}`;
      }
      if (matched && typeof runActions === 'function') {
        runActions({
          text: submittedText,
          image: state.image,
          audio: state.audio,
          matched
        });
      }
      if (matched) {
        playCorrectAnswerSound();
      } else if (expected || element.compareImageEnabled) {
        playWrongAnswerSound();
      }
    };
    if (element.compareImageEnabled) {
      if (!state.image) {
        finishSubmit(false, 'Anexe uma imagem para testar a comparacao visual.');
        return;
      }
      if (!element.compareImageReference) {
        finishSubmit(false, 'Defina uma imagem de referencia para validar a comparacao visual.');
        return;
      }
      if (!textMatched) {
        finishSubmit(false, element.errorMessage);
        return;
      }
      if (!(submitBtn instanceof HTMLButtonElement)) {
        finishSubmit(false, 'Nao foi possivel iniciar a comparacao.');
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Comparando...';
      try {
        const compareResult = await comparePreviewInputImageWithReference({
          referenceImage: element.compareImageReference,
          submittedImage: state.image
        });
        const matched = Boolean(compareResult.matched);
        finishSubmit(matched, matched ? element.successMessage : compareResult.reason || element.errorMessage);
      } catch (error) {
        finishSubmit(false, error.message || 'Nao foi possivel validar a imagem.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = element.submitLabel || 'Enviar resposta';
      }
      return;
    }
    const matched = textMatched;
    finishSubmit(matched, matched ? element.successMessage : element.errorMessage);
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
    case 'pen':
      node = createPenElementNode(element);
      break;
    case 'audio':
      {
        const mediaNode = document.createElement('audio');
        mediaNode.className = 'builder-media-element';
        mediaNode.src = element.src || '';
        applyPreviewAudioPresentation(mediaNode, element);
        node = wrapMediaNodeWithCaptions(mediaNode, element);
        restorePreviewMediaState(slide, element, node);
      }
      break;
    case 'video':
      {
        const mediaNode = document.createElement('video');
        mediaNode.className = 'builder-media-element';
        mediaNode.controls = true;
        mediaNode.src = element.src || '';
        attachPreviewVideoTimedTrigger(mediaNode, element);
        node = wrapMediaNodeWithCaptions(mediaNode, element);
        restorePreviewMediaState(slide, element, node);
      }
      break;
    case 'quiz':
      node = createQuizNode(element);
      node.style.background = element.quizBackgroundColor;
      node.style.backgroundColor = element.quizBackgroundColor;
      break;
    case 'input':
      node = createInputElementNode(element, {
        preview: true,
        runActions: () => {
          let shouldRerender = false;
          (element.interactionTriggers || []).forEach((trigger) => {
            if (trigger?.enabled === false) {
              return;
            }
            const didExecute = executePreviewActionConfig(element, trigger.actionConfig || {}, slide);
            shouldRerender = shouldRerender || didExecute;
          });
          if (shouldRerender) {
            renderSlide();
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
        normalizeFloatingActionConfig(element);
        const isCompleted = (element.interactionTriggers || []).some((trigger) => {
          const ruleGroup = String(trigger?.actionConfig?.ruleGroup || '').trim();
          if (!ruleGroup || !trigger?.actionConfig?.requireAllButtonsInGroup) {
            return false;
          }
          const stateKey = getPreviewRuleStateKey(slide.id, ruleGroup);
          const clickedIds = previewState.clickedRuleButtons.get(stateKey) || new Set();
          return clickedIds.has(element.id);
        });
        if (isCompleted) {
          node.classList.add('floating-button-completed');
        }
      }
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        executePreviewFloatingButtonTriggers(element);
      });
      break;
    case 'detector':
      node = document.createElement('div');
      node.className = 'detector-element detector-element-preview';
      node.setAttribute('aria-hidden', 'true');
      break;
    case 'timedTrigger':
      node = document.createElement('div');
      node.className = 'time-trigger-element time-trigger-element-preview';
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
    case 'pen':
      node = createPenElementNode(element);
      break;
    case 'audio':
      {
        const mediaNode = document.createElement('audio');
        mediaNode.className = 'builder-media-element';
        mediaNode.src = element.src || '';
        applyPreviewAudioPresentation(mediaNode, element, { authoring: true });
        node = wrapMediaNodeWithCaptions(mediaNode, element);
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
        attachPreviewVideoTimedTrigger(mediaNode, element);
        node = wrapMediaNodeWithCaptions(mediaNode, element);
      }
      break;
    case 'quiz':
      node = createQuizNode(element);
      node.style.background = element.quizBackgroundColor;
      node.style.backgroundColor = element.quizBackgroundColor;
      break;
    case 'input':
      node = createInputElementNode(element);
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
    case 'timedTrigger':
      node = document.createElement('div');
      node.className = 'time-trigger-element';
      normalizeFloatingActionConfig(element);
      node.textContent = `Tempo ${(Number(element.interactionTriggers?.[0]?.time) || 0).toFixed(1)}s`;
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
  node.style.zIndex = String(selectedElementId === element.id ? 999998 : (element.zIndex ?? 0));
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
  node.classList.toggle('element-active', selectedElementId === element.id);

  const usesClipPath = ['block', 'floatingButton'].includes(element.type) && ['triangle', 'arrow'].includes(element.shape || 'rectangle');
  let targetForPointerEvents = node;

  if (usesClipPath && !previewState.active) {
    const wrapper = document.createElement('div');
    wrapper.dataset.elementId = element.id;
    wrapper.classList.toggle('eraser-source-hidden', eraserState.active && eraserState.elementId === element.id);
    const wrapperZIndex = selectedElementId === element.id ? 999998 : (element.zIndex ?? 0);
    wrapper.style.cssText = `position:absolute;left:${element.x}px;top:${element.y}px;z-index:${wrapperZIndex};width:${element.width || 0}px;height:${element.height || 0}px;touch-action:none;user-select:none;cursor:grab;`;
    node.style.position = 'relative';
    node.style.left = '0';
    node.style.top = '0';
    node.style.width = '100%';
    node.style.height = '100%';
    node.style.cursor = 'grab';
    delete node.dataset.elementId;
    node.classList.remove('eraser-source-hidden');
    wrapper.appendChild(node);
    targetForPointerEvents = wrapper;
    wrapper.dataset.hasMenuTrigger = 'true';
    enableDrag(wrapper, element);
    wrapper.classList.toggle('element-active', selectedElementId === element.id);
    wrapper.classList.toggle('will-be-hidden', Boolean(element.initiallyHidden));
    wrapper.addEventListener('pointerenter', () => {
      if (!previewState.active) {
        showElementMenuTrigger(element.id);
      }
    });
    wrapper.addEventListener('pointerleave', () => {
      if (!previewState.active) {
        scheduleHideElementMenuTrigger(element.id);
      }
    });
    wrapper.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isPickingFloatingTargetElement) {
        const triggerElement = getSelectedActionTriggerElement();
        const selectedTrigger = getSelectedFloatingTrigger(triggerElement);
        const candidateIds = getFloatingTargetCandidateIds(selectedTrigger?.actionConfig?.type || 'none', triggerElement);
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

    const trigger = createElementMenuTrigger(element, { skipPositioning: true });
    trigger.style.left = `${Math.max((Number(element.width) || 0) - 34, 6)}px`;
    trigger.style.top = '6px';
    trigger.style.zIndex = String((Number(element.zIndex) || 0) + 2);
    wrapper.appendChild(trigger);

    return wrapper;
  }

  enableDrag(node, element);
  node.addEventListener('pointerenter', () => {
    if (!previewState.active) {
      showElementMenuTrigger(element.id);
    }
  });
  node.addEventListener('pointerleave', () => {
    if (!previewState.active) {
      scheduleHideElementMenuTrigger(element.id);
    }
  });
  node.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isPickingFloatingTargetElement) {
      const triggerElement = getSelectedActionTriggerElement();
      const selectedTrigger = getSelectedFloatingTrigger(triggerElement);
      const candidateIds = getFloatingTargetCandidateIds(selectedTrigger?.actionConfig?.type || 'none', triggerElement);
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
  node.classList.toggle('will-be-hidden', Boolean(element.initiallyHidden));
  return node;
};

const createElementMenuTrigger = (element, options = {}) => {
  const { skipPositioning = false } = options;
  const elementBox = getStageRelativeElementBox(element);
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'element-menu-trigger';
  trigger.dataset.elementMenuTrigger = element.id;
  trigger.setAttribute('aria-label', 'Abrir menu do elemento');
  trigger.title = 'Abrir menu';
  trigger.innerHTML = `
    <span class="element-menu-trigger-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <circle cx="6.5" cy="12" r="1.8" fill="currentColor"></circle>
        <circle cx="12" cy="12" r="1.8" fill="currentColor"></circle>
        <circle cx="17.5" cy="12" r="1.8" fill="currentColor"></circle>
      </svg>
    </span>`;
  if (!skipPositioning) {
    trigger.style.position = 'absolute';
    trigger.style.left = `${elementBox.left + Math.max((Number(elementBox.width) || 0) - 34, 6)}px`;
    trigger.style.top = `${Math.max(elementBox.top + 6, 6)}px`;
    trigger.style.zIndex = String((Number(element.zIndex) || 0) + 2);
  }
  trigger.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  trigger.addEventListener('pointerenter', () => {
    showElementMenuTrigger(element.id);
  });
  trigger.addEventListener('pointerleave', () => {
    scheduleHideElementMenuTrigger(element.id);
  });
  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showElementMenuTrigger(element.id);
    selectElement(element.id, { openEditor: true });
  });
  return trigger;
};

const handleElementEdit = async (element) => {
  if (eraserState.active && element?.id !== eraserState.elementId) {
    closeEraserSession({ keepEditor: false });
  }
  if (penState.active && element?.type !== 'pen') {
    closePenSession({ keepEditor: false });
  }
  switch (element.type) {
    case 'text':
      currentStageEditor = 'text';
      updateTextEditorVisibility(element, { forceOpen: true });
      return;
    case 'block': {
      currentStageEditor = 'block';
      updateBlockEditorVisibility(element, { forceOpen: true });
      requestAnimationFrame(() => {
        blockElementContentInput?.focus({ preventScroll: true });
        blockElementContentInput?.select?.();
      });
      return;
    }
    case 'pen':
      currentStageEditor = 'pen';
      updatePenEditorVisibility(element, { forceOpen: true });
      return;
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
      break;
    }
    case 'floatingButton': {
      currentStageEditor = 'floating';
      updateFloatingButtonEditorVisibility(element, { forceOpen: true });
      return;
    }
    case 'detector':
    case 'timedTrigger':
    case 'input':
      currentStageEditor = 'floating';
      updateFloatingButtonEditorVisibility(element, { forceOpen: true });
      return;
    case 'quiz':
      currentStageEditor = 'quiz';
      updateQuizEditorVisibility(element, { forceOpen: true });
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
    const target = event.target;
    if (
      target instanceof Element &&
      target !== node &&
      target.closest('input, select, .builder-quiz-node')
    ) {
      return;
    }
    if (selectedElementId !== element.id) {
      selectElement(element.id);
    }
    event.preventDefault();
    showElementMenuTrigger(null);
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
  if (!token || (role !== 'admin' && role !== 'professor')) {
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
  builderProfessorCreditsStatus = document.getElementById('builderProfessorCreditsStatus');
  previewStageBtn = document.getElementById('previewStageBtn');
  moduleCourseSelect = document.getElementById('moduleCourseSelect');
  moduleTitleInput = document.getElementById('moduleTitleInput');
  moduleDescriptionInput = document.getElementById('moduleDescriptionInput');
  moduleCoverModeSelect = document.getElementById('moduleCoverModeSelect');
  moduleCoverUrlInput = document.getElementById('moduleCoverUrlInput');
  applyModuleCoverBtn = document.getElementById('applyModuleCoverBtn');
  clearModuleCoverBtn = document.getElementById('clearModuleCoverBtn');
  moduleCoverPreview = document.getElementById('moduleCoverPreview');
  moduleCoverPreviewTitle = document.getElementById('moduleCoverPreviewTitle');
  moduleCoverPreviewMeta = document.getElementById('moduleCoverPreviewMeta');
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
  elementOpacityInput = document.getElementById('elementOpacityInput');
  elementOpacityValue = document.getElementById('elementOpacityValue');
  elementTextColorInput = document.getElementById('elementTextColorInput');
  elementFontSizeInput = document.getElementById('elementFontSizeInput');
  elementFontFamilySelect = document.getElementById('elementFontFamilySelect');
  elementFontWeightSelect = document.getElementById('elementFontWeightSelect');
  elementBgColorInput = document.getElementById('elementBgColorInput');
  elementStudentDragToggle = document.getElementById('elementStudentDragToggle');
  elementInitiallyHiddenToggle = document.getElementById('elementInitiallyHiddenToggle');
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
  backgroundBatchToggle = document.getElementById('backgroundBatchToggle');
  backgroundSolidColorInput = document.getElementById('backgroundSolidColorInput');
  backgroundGradientStartInput = document.getElementById('backgroundGradientStartInput');
  backgroundGradientEndInput = document.getElementById('backgroundGradientEndInput');
  backgroundMediaUrlInput = document.getElementById('backgroundMediaUrlInput');
  backgroundMediaLocalBtn = document.getElementById('backgroundMediaLocalBtn');
  backgroundMediaApplyBtn = document.getElementById('backgroundMediaApplyBtn');
  backgroundMediaClearBtn = document.getElementById('backgroundMediaClearBtn');
  backgroundMediaEditorStatus = document.getElementById('backgroundMediaEditorStatus');
  animationEditorCard = document.getElementById('animationEditorCard');
  penEditorCard = document.getElementById('penEditorCard');
  penColorInput = document.getElementById('penColorInput');
  penSizeInput = document.getElementById('penSizeInput');
  penSizeNumberInput = document.getElementById('penSizeNumberInput');
  penStartDrawingBtn = document.getElementById('penStartDrawingBtn');
  penClearPreviewBtn = document.getElementById('penClearPreviewBtn');
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
  imageSourceModeSelect = document.getElementById('imageSourceModeSelect');
  imageSourceUrlInput = document.getElementById('imageSourceUrlInput');
  imageApplySourceBtn = document.getElementById('imageApplySourceBtn');
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
  floatingButtonLabelInput = document.getElementById('floatingButtonLabelInput');
  floatingInputPlaceholderInput = document.getElementById('floatingInputPlaceholderInput');
  floatingInputSubmitLabelInput = document.getElementById('floatingInputSubmitLabelInput');
  floatingInputCompareTextInput = document.getElementById('floatingInputCompareTextInput');
  floatingInputCompareCaseToggle = document.getElementById('floatingInputCompareCaseToggle');
  floatingInputCompareImageToggle = document.getElementById('floatingInputCompareImageToggle');
  floatingInputCompareImageUrlInput = document.getElementById('floatingInputCompareImageUrlInput');
  floatingInputCompareImageFileInput = document.getElementById('floatingInputCompareImageFileInput');
  floatingInputCompareImageClearBtn = document.getElementById('floatingInputCompareImageClearBtn');
  floatingInputCompareImagePreview = document.getElementById('floatingInputCompareImagePreview');
  floatingInputSuccessInput = document.getElementById('floatingInputSuccessInput');
  floatingInputErrorInput = document.getElementById('floatingInputErrorInput');
  floatingInputAllowImageToggle = document.getElementById('floatingInputAllowImageToggle');
  floatingInputAllowAudioToggle = document.getElementById('floatingInputAllowAudioToggle');
  floatingInputBackgroundColorInput = document.getElementById('floatingInputBackgroundColorInput');
  floatingInputLabelColorInput = document.getElementById('floatingInputLabelColorInput');
  floatingInputTextColorInput = document.getElementById('floatingInputTextColorInput');
  floatingInputButtonBackgroundColorInput = document.getElementById('floatingInputButtonBackgroundColorInput');
  floatingInputButtonTextColorInput = document.getElementById('floatingInputButtonTextColorInput');
  floatingTriggerTimeInput = document.getElementById('floatingTriggerTimeInput');
  floatingTriggerList = document.getElementById('floatingTriggerList');
  floatingAddTriggerBtn = document.getElementById('floatingAddTriggerBtn');
  floatingDuplicateTriggerBtn = document.getElementById('floatingDuplicateTriggerBtn');
  floatingRemoveTriggerBtn = document.getElementById('floatingRemoveTriggerBtn');
  floatingActionTypeLabel = document.getElementById('floatingActionTypeLabel');
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
  videoTriggerList = document.getElementById('videoTriggerList');
  videoAddTriggerBtn = document.getElementById('videoAddTriggerBtn');
  videoDuplicateTriggerBtn = document.getElementById('videoDuplicateTriggerBtn');
  videoRemoveTriggerBtn = document.getElementById('videoRemoveTriggerBtn');
  videoTriggerTimeInput = document.getElementById('videoTriggerTimeInput');
  videoTriggerActionSelect = document.getElementById('videoTriggerActionSelect');
  videoTriggerSeekTimeInput = document.getElementById('videoTriggerSeekTimeInput');
  videoTriggerTargetElementSelect = document.getElementById('videoTriggerTargetElementSelect');
  videoTriggerTargetSlideSelect = document.getElementById('videoTriggerTargetSlideSelect');
  videoTriggerUrlInput = document.getElementById('videoTriggerUrlInput');
  videoTriggerActionTextLabel = document.getElementById('videoTriggerActionTextLabel');
  videoTriggerActionTextInput = document.getElementById('videoTriggerActionTextInput');
  videoTriggerReplaceModeSelect = document.getElementById('videoTriggerReplaceModeSelect');
  videoTriggerReplaceCounterStartInput = document.getElementById('videoTriggerReplaceCounterStartInput');
  videoTriggerReplaceCounterStepInput = document.getElementById('videoTriggerReplaceCounterStepInput');
  videoTriggerAudioVisibleToggle = document.getElementById('videoTriggerAudioVisibleToggle');
  videoTriggerAudioLoopToggle = document.getElementById('videoTriggerAudioLoopToggle');
  videoTriggerTextColorInput = document.getElementById('videoTriggerTextColorInput');
  videoTriggerTextBgColorInput = document.getElementById('videoTriggerTextBgColorInput');
  videoTriggerTextFontSizeInput = document.getElementById('videoTriggerTextFontSizeInput');
  videoTriggerTextFontFamilySelect = document.getElementById('videoTriggerTextFontFamilySelect');
  videoTriggerTextFontWeightSelect = document.getElementById('videoTriggerTextFontWeightSelect');
  videoTriggerTextAlignSelect = document.getElementById('videoTriggerTextAlignSelect');
  videoTriggerTextBackgroundToggle = document.getElementById('videoTriggerTextBackgroundToggle');
  videoTriggerTextBorderToggle = document.getElementById('videoTriggerTextBorderToggle');
  videoTriggerInsertXInput = document.getElementById('videoTriggerInsertXInput');
  videoTriggerInsertYInput = document.getElementById('videoTriggerInsertYInput');
  videoTriggerInsertWidthInput = document.getElementById('videoTriggerInsertWidthInput');
  videoTriggerInsertHeightInput = document.getElementById('videoTriggerInsertHeightInput');
  videoPickPlacementBtn = document.getElementById('videoPickPlacementBtn');
  videoPlacementHint = document.getElementById('videoPlacementHint');
  videoTriggerMoveXInput = document.getElementById('videoTriggerMoveXInput');
  videoTriggerMoveYInput = document.getElementById('videoTriggerMoveYInput');
  videoTriggerMoveDurationInput = document.getElementById('videoTriggerMoveDurationInput');
  videoTriggerQuizQuestionInput = document.getElementById('videoTriggerQuizQuestionInput');
  videoTriggerQuizOptionsInput = document.getElementById('videoTriggerQuizOptionsInput');
  videoTriggerQuizCorrectSelect = document.getElementById('videoTriggerQuizCorrectSelect');
  videoTriggerQuizSuccessInput = document.getElementById('videoTriggerQuizSuccessInput');
  videoTriggerQuizErrorInput = document.getElementById('videoTriggerQuizErrorInput');
  videoTriggerQuizActionLabelInput = document.getElementById('videoTriggerQuizActionLabelInput');
  videoTriggerQuizBackgroundColorInput = document.getElementById('videoTriggerQuizBackgroundColorInput');
  videoTriggerQuizQuestionColorInput = document.getElementById('videoTriggerQuizQuestionColorInput');
  videoTriggerQuizOptionBackgroundColorInput = document.getElementById('videoTriggerQuizOptionBackgroundColorInput');
  videoTriggerQuizOptionTextColorInput = document.getElementById('videoTriggerQuizOptionTextColorInput');
  videoTriggerQuizButtonBackgroundColorInput = document.getElementById('videoTriggerQuizButtonBackgroundColorInput');
  videoTriggerQuizPointsInput = document.getElementById('videoTriggerQuizPointsInput');
  videoTriggerQuizLockOnWrongToggle = document.getElementById('videoTriggerQuizLockOnWrongToggle');
  videoTriggerQuizPlaySourceVideoToggle = document.getElementById('videoTriggerQuizPlaySourceVideoToggle');
  videoCaptionEnabledToggle = document.getElementById('videoCaptionEnabledToggle');
  videoCaptionPositionSelect = document.getElementById('videoCaptionPositionSelect');
  videoCaptionWidthInput = document.getElementById('videoCaptionWidthInput');
  videoCaptionFontSizeInput = document.getElementById('videoCaptionFontSizeInput');
  videoCaptionTextColorInput = document.getElementById('videoCaptionTextColorInput');
  videoCaptionBackgroundColorInput = document.getElementById('videoCaptionBackgroundColorInput');
  videoCaptionAccentColorInput = document.getElementById('videoCaptionAccentColorInput');
  videoCaptionUppercaseToggle = document.getElementById('videoCaptionUppercaseToggle');
  videoCaptionSegmentList = document.getElementById('videoCaptionSegmentList');
  videoCaptionSegmentEmpty = document.getElementById('videoCaptionSegmentEmpty');
  videoCaptionSegmentStartInput = document.getElementById('videoCaptionSegmentStartInput');
  videoCaptionSegmentEndInput = document.getElementById('videoCaptionSegmentEndInput');
  videoCaptionSegmentTextInput = document.getElementById('videoCaptionSegmentTextInput');
  videoCaptionSegmentAddBtn = document.getElementById('videoCaptionSegmentAddBtn');
  videoCaptionSegmentRemoveBtn = document.getElementById('videoCaptionSegmentRemoveBtn');
  videoGenerateCaptionsBtn = document.getElementById('videoGenerateCaptionsBtn');
  videoExtractAudioBtn = document.getElementById('videoExtractAudioBtn');
  videoSourceModeSelect = document.getElementById('videoSourceModeSelect');
  videoSourceUrlInput = document.getElementById('videoSourceUrlInput');
  videoApplySourceBtn = document.getElementById('videoApplySourceBtn');
  audioElementWidthInput = document.getElementById('audioElementWidthInput');
  audioElementHeightInput = document.getElementById('audioElementHeightInput');
  audioElementRotationInput = document.getElementById('audioElementRotationInput');
  audioElementVisibleToggle = document.getElementById('audioElementVisibleToggle');
  audioElementLoopToggle = document.getElementById('audioElementLoopToggle');
  audioCaptionEnabledToggle = document.getElementById('audioCaptionEnabledToggle');
  audioCaptionPositionSelect = document.getElementById('audioCaptionPositionSelect');
  audioCaptionWidthInput = document.getElementById('audioCaptionWidthInput');
  audioCaptionFontSizeInput = document.getElementById('audioCaptionFontSizeInput');
  audioCaptionTextColorInput = document.getElementById('audioCaptionTextColorInput');
  audioCaptionBackgroundColorInput = document.getElementById('audioCaptionBackgroundColorInput');
  audioCaptionAccentColorInput = document.getElementById('audioCaptionAccentColorInput');
  audioCaptionUppercaseToggle = document.getElementById('audioCaptionUppercaseToggle');
  audioCaptionSegmentList = document.getElementById('audioCaptionSegmentList');
  audioCaptionSegmentEmpty = document.getElementById('audioCaptionSegmentEmpty');
  audioCaptionSegmentStartInput = document.getElementById('audioCaptionSegmentStartInput');
  audioCaptionSegmentEndInput = document.getElementById('audioCaptionSegmentEndInput');
  audioCaptionSegmentTextInput = document.getElementById('audioCaptionSegmentTextInput');
  audioCaptionSegmentAddBtn = document.getElementById('audioCaptionSegmentAddBtn');
  audioCaptionSegmentRemoveBtn = document.getElementById('audioCaptionSegmentRemoveBtn');
  audioGenerateCaptionsBtn = document.getElementById('audioGenerateCaptionsBtn');
  audioReplaceSourceBtn = document.getElementById('audioReplaceSourceBtn');
  audioSourceModeSelect = document.getElementById('audioSourceModeSelect');
  audioSourceUrlInput = document.getElementById('audioSourceUrlInput');
  audioApplySourceBtn = document.getElementById('audioApplySourceBtn');
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
  [textEditorCard, blockEditorCard, imageEditorCard, quizEditorCard, audioEditorCard, floatingButtonEditorCard, videoEditorCard, backgroundEditorCard, eraserEditorCard, penEditorCard, animationEditorCard].forEach(enableStageEditorDragging);
  document.querySelectorAll('.logout-btn').forEach((button) => button.addEventListener('click', handleLogout));
  builderPanelToggleBtn?.addEventListener('click', toggleBuilderPanel);
  document.getElementById('addSlideBtn').addEventListener('click', () => addSlide(`Slide ${builderState.slides.length + 1}`));
  document.getElementById('removeSlideBtn').addEventListener('click', removeCurrentSlide);
  document.getElementById('clearStageBtn').addEventListener('click', clearCurrentSlide);
  previewStageBtn?.addEventListener('click', toggleStudentPreview);
  slideList.addEventListener('click', (event) => {
    if (suppressSlideChipClick) {
      event.preventDefault();
      return;
    }
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
  slideList.addEventListener('dragstart', (event) => {
    const button = event.target.closest('button[data-slide-id]');
    if (!button) return;
    draggingSlideId = button.dataset.slideId;
    slideDropTargetId = draggingSlideId;
    slideDropPlacement = 'after';
    suppressSlideChipClick = false;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggingSlideId);
    }
    syncSlideDropVisualState();
  });
  slideList.addEventListener('dragover', (event) => {
    if (!draggingSlideId) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const button = event.target.closest('button[data-slide-id]');
    if (!button) {
      const lastSlide = builderState.slides[builderState.slides.length - 1];
      if (lastSlide && (slideDropTargetId !== lastSlide.id || slideDropPlacement !== 'after')) {
        slideDropTargetId = lastSlide.id;
        slideDropPlacement = 'after';
        syncSlideDropVisualState();
      }
      return;
    }
    const targetSlideId = button.dataset.slideId;
    if (!targetSlideId || targetSlideId === draggingSlideId) {
      return;
    }
    const bounds = button.getBoundingClientRect();
    const nextPlacement = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
    if (slideDropTargetId !== targetSlideId || slideDropPlacement !== nextPlacement) {
      slideDropTargetId = targetSlideId;
      slideDropPlacement = nextPlacement;
      syncSlideDropVisualState();
    }
  });
  slideList.addEventListener('drop', (event) => {
    if (!draggingSlideId) {
      return;
    }
    event.preventDefault();
    const fallbackId = builderState.slides[builderState.slides.length - 1]?.id || '';
    const targetSlideId = slideDropTargetId || fallbackId;
    const moved = moveSlideInStrip(draggingSlideId, targetSlideId, slideDropPlacement);
    clearSlideDragState();
    if (moved) {
      renderSlideList();
      renderSlide();
      commitHistoryState();
      suppressSlideChipClick = true;
      window.setTimeout(() => {
        suppressSlideChipClick = false;
      }, 80);
    }
  });
  slideList.addEventListener('dragend', () => {
    if (!draggingSlideId && !slideDropTargetId) {
      return;
    }
    clearSlideDragState();
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
  moduleTitleInput?.addEventListener('input', () => {
    syncModuleCoverPreview();
    scheduleHistoryCommit();
  });
  moduleDescriptionInput?.addEventListener('input', scheduleHistoryCommit);
  moduleCoverModeSelect?.addEventListener('change', updateModuleCoverModeUi);
  applyModuleCoverBtn?.addEventListener('click', () => applyModuleCover(moduleCoverModeSelect?.value || 'local'));
  clearModuleCoverBtn?.addEventListener('click', clearModuleCover);
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
  moduleLockNextToggle?.addEventListener('change', updateModuleBehavior);
  modulePublicToggle?.addEventListener('change', updateModuleBehavior);
  syncPublicModuleLinkUi();
  updateModuleCoverModeUi();
  syncModuleCoverPreview();
  slideBgInput?.addEventListener('input', updateSlideBackground);
  slideBgUploadBtn?.addEventListener('click', chooseSlideBackgroundMedia);
  backgroundMediaTypeSelect?.addEventListener('change', () => updateBackgroundMediaEditorFields());
  backgroundBatchToggle?.addEventListener('change', () => updateBackgroundMediaEditorFields());
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
  elementInitiallyHiddenToggle?.addEventListener('change', applyElementStyles);
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
  imageApplySourceBtn?.addEventListener('click', () => applySelectedImageSourceFromEditor(imageSourceModeSelect?.value || 'local'));
  imageSourceModeSelect?.addEventListener('change', () => {
    document.getElementById('imageSourceUrlField')?.classList.toggle('hidden', (imageSourceModeSelect?.value || 'local') !== 'url');
  });
  blockAttachTextureBtn?.addEventListener('click', replaceSelectedBlockTexture);
  blockClearTextureBtn?.addEventListener('click', clearSelectedBlockTexture);
  audioReplaceSourceBtn?.addEventListener('click', replaceSelectedAudioSource);
  audioApplySourceBtn?.addEventListener('click', () => applySelectedAudioSourceFromEditor(audioSourceModeSelect?.value || 'local'));
  audioSourceModeSelect?.addEventListener('change', () => {
    document.getElementById('audioSourceUrlField')?.classList.toggle('hidden', (audioSourceModeSelect?.value || 'local') !== 'url');
  });
  audioGenerateCaptionsBtn?.addEventListener('click', generateCaptionsForSelectedAudio);
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
    aiAssistantPromptInput.focus({ preventScroll: true });
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
        aiAssistantPromptInput.focus({ preventScroll: true });
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
    if (penState.active && target.closest('#slideCanvas')) {
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
    ['text', 'block', 'image', 'audio', 'quiz', 'floating', 'video', 'background', 'eraser', 'pen', 'animation'].forEach(positionStageEditorCard);
    renderEraserOverlay();
    renderPenOverlay();
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
  penColorInput?.addEventListener('input', () => {
    renderPenPreview();
    applyPenEditorToElement();
  });
  penSizeInput?.addEventListener('input', () => {
    syncPenSizeInputs('range');
    renderPenPreview();
    applyPenEditorToElement();
  });
  penSizeNumberInput?.addEventListener('input', () => {
    syncPenSizeInputs('number');
    renderPenPreview();
    applyPenEditorToElement();
  });
  penStartDrawingBtn?.addEventListener('click', startPenDrawingSession);
  penClearPreviewBtn?.addEventListener('click', () => {
    resetPenDraftState();
    renderPenPreview();
    syncPenEditorControls(getActiveSlide()?.elements.find((child) => child.id === selectedElementId) || null);
  });
  [
    floatingButtonLabelInput,
    floatingInputPlaceholderInput,
    floatingInputSubmitLabelInput,
    floatingInputCompareTextInput,
    floatingInputCompareCaseToggle,
    floatingInputCompareImageToggle,
    floatingInputCompareImageUrlInput,
    floatingInputSuccessInput,
    floatingInputErrorInput,
    floatingInputAllowImageToggle,
    floatingInputAllowAudioToggle,
    floatingInputBackgroundColorInput,
    floatingInputLabelColorInput,
    floatingInputTextColorInput,
    floatingInputButtonBackgroundColorInput,
    floatingInputButtonTextColorInput,
    floatingTriggerTimeInput,
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
  floatingInputCompareImageFileInput?.addEventListener('change', async () => {
    const file = floatingInputCompareImageFileInput.files?.[0];
    if (!file) {
      return;
    }
    const dataUrl = await readLocalFileAsDataUrl(file).catch(() => '');
    if (floatingInputCompareImageUrlInput && dataUrl) {
      floatingInputCompareImageUrlInput.value = dataUrl;
    }
    if (floatingInputCompareImageFileInput) {
      floatingInputCompareImageFileInput.value = '';
    }
    syncFloatingButtonEditor();
  });
  floatingInputCompareImageClearBtn?.addEventListener('click', () => {
    if (floatingInputCompareImageUrlInput) {
      floatingInputCompareImageUrlInput.value = '';
    }
    if (floatingInputCompareImageFileInput) {
      floatingInputCompareImageFileInput.value = '';
    }
    syncFloatingButtonEditor();
  });
  [
    videoTriggerTimeInput,
    videoTriggerActionSelect,
    videoTriggerSeekTimeInput,
    videoTriggerActionTextInput,
    videoTriggerReplaceModeSelect,
    videoTriggerReplaceCounterStartInput,
    videoTriggerReplaceCounterStepInput,
    videoTriggerAudioVisibleToggle,
    videoTriggerAudioLoopToggle,
    videoTriggerTextColorInput,
    videoTriggerTextBgColorInput,
    videoTriggerTextFontSizeInput,
    videoTriggerTextFontFamilySelect,
    videoTriggerTextFontWeightSelect,
    videoTriggerTextAlignSelect,
    videoTriggerTextBackgroundToggle,
    videoTriggerTextBorderToggle,
    videoTriggerInsertXInput,
    videoTriggerInsertYInput,
    videoTriggerInsertWidthInput,
    videoTriggerInsertHeightInput,
    videoTriggerMoveXInput,
    videoTriggerMoveYInput,
    videoTriggerMoveDurationInput,
    videoTriggerQuizQuestionInput,
    videoTriggerQuizOptionsInput,
    videoTriggerQuizCorrectSelect,
    videoTriggerQuizSuccessInput,
    videoTriggerQuizErrorInput,
    videoTriggerQuizActionLabelInput,
    videoTriggerQuizBackgroundColorInput,
    videoTriggerQuizQuestionColorInput,
    videoTriggerQuizOptionBackgroundColorInput,
    videoTriggerQuizOptionTextColorInput,
    videoTriggerQuizButtonBackgroundColorInput,
    videoTriggerQuizPointsInput,
    videoTriggerQuizLockOnWrongToggle,
    videoTriggerQuizPlaySourceVideoToggle
  ].forEach((control) => {
    control?.addEventListener('input', syncVideoEditor);
    control?.addEventListener('change', syncVideoEditor);
  });
  [videoTriggerTargetElementSelect].forEach((control) => {
    control?.addEventListener('change', syncVideoEditor);
  });
  [videoTriggerTargetSlideSelect, videoTriggerUrlInput].forEach((control) => {
    control?.addEventListener('input', syncVideoEditor);
    control?.addEventListener('change', syncVideoEditor);
  });
  [videoCaptionEnabledToggle, videoCaptionPositionSelect, videoCaptionWidthInput, videoCaptionFontSizeInput, videoCaptionTextColorInput, videoCaptionBackgroundColorInput, videoCaptionAccentColorInput, videoCaptionUppercaseToggle].forEach((control) => {
    control?.addEventListener('input', syncVideoEditor);
    control?.addEventListener('change', syncVideoEditor);
  });
  [videoCaptionSegmentStartInput, videoCaptionSegmentEndInput].forEach((control) => {
    control?.addEventListener('input', () => applyCaptionSegmentFieldChanges('video'));
    control?.addEventListener('change', () => applyCaptionSegmentFieldChanges('video'));
  });
  videoCaptionSegmentTextInput?.addEventListener('input', () => applyCaptionSegmentTextDraft('video'));
  videoCaptionSegmentTextInput?.addEventListener('change', () => applyCaptionSegmentFieldChanges('video'));
  videoCaptionSegmentAddBtn?.addEventListener('click', () => addCaptionSegment('video'));
  videoCaptionSegmentRemoveBtn?.addEventListener('click', () => removeCaptionSegment('video'));
  videoCaptionSegmentList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-caption-segment-type="video"]');
    if (!button) {
      return;
    }
    selectedVideoCaptionSegmentIndex = Number(button.dataset.captionSegmentIndex) || 0;
    const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'video');
    if (element) {
      renderCaptionSegmentEditor('video', element);
    }
  });
  videoApplySourceBtn?.addEventListener('click', () => applySelectedVideoSourceFromEditor(videoSourceModeSelect?.value || 'local'));
  videoSourceModeSelect?.addEventListener('change', () => {
    document.getElementById('videoSourceUrlField')?.classList.toggle('hidden', (videoSourceModeSelect?.value || 'local') !== 'url');
  });
  videoGenerateCaptionsBtn?.addEventListener('click', generateCaptionsForSelectedVideo);
  videoExtractAudioBtn?.addEventListener('click', extractAudioFromSelectedVideo);
  [imageElementWidthInput, imageElementHeightInput, imageElementRotationInput, imageElementObjectFitSelect, imageElementStudentDragToggle].forEach((control) => {
    control?.addEventListener('input', syncImageEditor);
    control?.addEventListener('change', syncImageEditor);
  });
  [audioElementWidthInput, audioElementHeightInput, audioElementRotationInput, audioElementVisibleToggle, audioElementLoopToggle, audioCaptionEnabledToggle, audioCaptionPositionSelect, audioCaptionWidthInput, audioCaptionFontSizeInput, audioCaptionTextColorInput, audioCaptionBackgroundColorInput, audioCaptionAccentColorInput, audioCaptionUppercaseToggle].forEach((control) => {
    control?.addEventListener('input', syncAudioEditor);
    control?.addEventListener('change', syncAudioEditor);
  });
  [audioCaptionSegmentStartInput, audioCaptionSegmentEndInput].forEach((control) => {
    control?.addEventListener('input', () => applyCaptionSegmentFieldChanges('audio'));
    control?.addEventListener('change', () => applyCaptionSegmentFieldChanges('audio'));
  });
  audioCaptionSegmentTextInput?.addEventListener('input', () => applyCaptionSegmentTextDraft('audio'));
  audioCaptionSegmentTextInput?.addEventListener('change', () => applyCaptionSegmentFieldChanges('audio'));
  audioCaptionSegmentAddBtn?.addEventListener('click', () => addCaptionSegment('audio'));
  audioCaptionSegmentRemoveBtn?.addEventListener('click', () => removeCaptionSegment('audio'));
  audioCaptionSegmentList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-caption-segment-type="audio"]');
    if (!button) {
      return;
    }
    selectedAudioCaptionSegmentIndex = Number(button.dataset.captionSegmentIndex) || 0;
    const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'audio');
    if (element) {
      renderCaptionSegmentEditor('audio', element);
    }
  });
  floatingPickPlacementBtn?.addEventListener('click', toggleFloatingPlacementPicker);
  videoPickPlacementBtn?.addEventListener('click', toggleVideoPlacementPicker);
  floatingPickTargetElementBtn?.addEventListener('click', toggleFloatingTargetElementPicker);
  floatingAddTriggerBtn?.addEventListener('click', addFloatingTrigger);
  floatingDuplicateTriggerBtn?.addEventListener('click', duplicateFloatingTrigger);
  floatingRemoveTriggerBtn?.addEventListener('click', removeFloatingTrigger);
  floatingTriggerList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-floating-trigger-id]');
    if (!button) {
      return;
    }
    selectedFloatingTriggerId = button.dataset.floatingTriggerId || null;
    const element = getSelectedActionTriggerElement();
    if (element) {
      updateFloatingButtonEditorVisibility(element, { forceOpen: true });
      updateFloatingPlacementPreview();
    }
  });
  videoAddTriggerBtn?.addEventListener('click', addVideoTrigger);
  videoDuplicateTriggerBtn?.addEventListener('click', duplicateVideoTrigger);
  videoRemoveTriggerBtn?.addEventListener('click', removeVideoTrigger);
  videoTriggerList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-video-trigger-id]');
    if (!button) {
      return;
    }
    selectedVideoTriggerId = button.dataset.videoTriggerId || null;
    const element = getActiveSlide()?.elements.find((child) => child.id === selectedElementId && child.type === 'video');
    if (element) {
      updateVideoEditorVisibility(element, { forceOpen: true });
    }
  });
  slideCanvas?.addEventListener('click', (event) => {
    if (previewState.active) {
      return;
    }
    if (penState.active) {
      return;
    }
    if (handleVideoPlacementPick(event)) {
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
      updateVideoPlacementPreview();
      return;
    }
    if (event.key === 'Escape' && currentStageEditor === 'pen') {
      event.preventDefault();
      closePenSession({ keepEditor: false });
    }
  });
  syncKeyboardMoveStepInput();
  [
    elementWidthInput,
    elementHeightInput,
    elementRotationInput,
    elementLayerInput,
    elementOpacityInput,
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
  loadBuilderCourses().finally(() => {
    draftRestoreCompleted = true;
    const restored = restoreBuilderDraftIfAvailable();
    if (!restored) {
      scheduleBuilderAutosave();
    }
  });
  loadTemplateStore();
  loadAiAssistantSettings();
  loadBuilderProfessorCreditsStatus();
  renderAiAssistantActions();
  renderAiAssistantFeedback();
  renderAiAssistantDebug();
  renderAiProposalHistory();
  renderBuilderProfessorCreditsStatus();
  window.addEventListener('pagehide', persistBuilderDraftLocally);
  window.addEventListener('beforeunload', persistBuilderDraftLocally);
  window.addEventListener('resize', () => {
    ensureActiveSlideBounds();
    syncBuilderPanelLayout();
    renderSlide();
    hydrateTemplateStorePreviews();
  });
});

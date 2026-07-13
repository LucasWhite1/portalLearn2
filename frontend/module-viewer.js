const resolveApiBase = () => {
  if (window.__API_BASE__) {
    return window.__API_BASE__;
  }
  if (window.location.protocol === 'file:') {
    return 'http://localhost:4000';
  }
  if (['localhost', '127.0.0.1'].includes(window.location.hostname) && /^55\d{2}$/.test(window.location.port)) {
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
const VIEWER_PEN_MIN_BRUSH_SIZE = 2;
const VIEWER_PEN_MAX_BRUSH_SIZE = 48;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const isViewerTypingTarget = (target) => {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target.closest('input, textarea, select, button, [contenteditable="true"]')) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
};
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
const getCurrentSessionUser = () => JSON.parse(localStorage.getItem('curso-platform-user') || '{}');

const authorizedFetch = async (path, options = {}) => {
  const token = getToken();
  if (!token) {
    throw new Error('Sem token válido');
  }
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (/^[0-9a-f]{48}$/i.test(token)) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
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

const fetchLiveStageModule = async (shareId) => {
  const response = await authorizedFetch(`/api/student/live-stage/${encodeURIComponent(shareId)}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || 'Nao foi possivel carregar o palco ao vivo.');
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
  isLiveShare: false,
  isReplay: false,
  liveShareId: null,
  liveShareRevision: 0,
  replayUserId: null,
  replayEventIndex: -1,
  penToolActive: false,
  penColor: '#111827',
  penSize: 8,
  penSettingsTouched: false
};

const LIVE_CURSOR_SEND_INTERVAL_MS = 80;
const LIVE_CURSOR_POLL_INTERVAL_MS = 150;
const viewerLiveCursorState = {
  overlay: null,
  pollTimer: null,
  lastSentAt: 0,
  lastSignature: ''
};

let viewerResizeSyncFrame = null;

const params = new URLSearchParams(window.location.search);
viewerState.isLiveShare = Boolean(params.get('liveShareId'));
viewerState.isPublic = Boolean(params.get('publicModuleId'));
viewerState.isReplay = params.get('adminReplay') === '1';
viewerState.moduleId = params.get('moduleId') || params.get('publicModuleId');
viewerState.courseId = params.get('courseId');
viewerState.liveShareId = params.get('liveShareId');
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
let viewerFullscreenNavToggleBtn;
let viewerPenToolBtn;
let viewerPenControls;
let viewerPenColorInput;
let viewerPenSizeInput;
let viewerPenSizeNumberInput;
let viewerPenClearBtn;
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
const viewerCameraRuntime = new Map();
const viewerStudentPenStrokes = new Map();
const viewerPenOverlayState = {
  overlay: null,
  canvas: null,
  drawing: false,
  pointerId: null,
  activeStroke: null,
  slideKey: ''
};
const viewerStageZoomState = {
  pointers: new Map(),
  baseScale: 1,
  userScale: 1,
  translateX: 0,
  translateY: 0,
  pinchStartDistance: 0,
  pinchStartScale: 1,
  pinchStartTranslateX: 0,
  pinchStartTranslateY: 0,
  panStartX: 0,
  panStartY: 0,
  panOriginX: 0,
  panOriginY: 0
};
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
let liveStagePollTimer = null;

const isReplayMode = () => viewerState.isReplay;
const isLiveShareMode = () => viewerState.isLiveShare;

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
const ANIMATABLE_ELEMENT_TYPES = new Set(['text', 'block', 'floatingButton', 'image', 'camera', 'key']);
const MOTION_ANIMATION_TYPE = 'motion-recording';
const ANIMATION_PRESETS = new Set(['none', 'fade-in', 'fade-out', 'slide-left', 'slide-right', 'rotate-in', 'pulse', 'float', 'zoom-in', MOTION_ANIMATION_TYPE]);
const STUDENT_DRAGGABLE_TYPES = new Set(['text', 'block', 'image']);
const REPLACEABLE_TEXT_TYPES = new Set(['text', 'block', 'floatingButton']);
const CAMERA_RECORDING_MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
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

const getViewerPenStrokeWidth = (element) =>
  Math.max(VIEWER_PEN_MIN_BRUSH_SIZE, Number(element?.strokeWidth) || 8);

const isViewerStudentPaintEnabled = (value) => value === true || value === 'true' || value === 1 || value === '1';

const getViewerPenBrushSize = () =>
  Math.min(Math.max(Number(viewerState.penSize) || 8, VIEWER_PEN_MIN_BRUSH_SIZE), VIEWER_PEN_MAX_BRUSH_SIZE);

const getViewerPenBrushColor = () => {
  const candidate = String(viewerState.penColor || '').trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(candidate) ? candidate : '#111827';
};

const getViewerPenStrokeKey = (slide, element) => {
  const moduleId = getCurrentModule()?.id || viewerState.moduleId || 'module';
  return `${moduleId}::${getStableSlideKey(slide, viewerState.slideIndex)}::${element?.id || 'pen'}`;
};

const getViewerSlidePenStrokeKey = (slide) => {
  const moduleId = getCurrentModule()?.id || viewerState.moduleId || 'module';
  return `${moduleId}::${getStableSlideKey(slide, viewerState.slideIndex)}::stage-pen`;
};

const getViewerSlidePenStrokeKeyFor = (moduleId, slide, slideIndex) =>
  `${moduleId || viewerState.moduleId || 'module'}::${getStableSlideKey(slide, slideIndex)}::stage-pen`;

const createViewerLiveStrokeId = () => `live-stroke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getViewerPenStrokeBucket = (slide, element) => {
  const key = getViewerPenStrokeKey(slide, element);
  if (!viewerStudentPenStrokes.has(key)) {
    viewerStudentPenStrokes.set(key, []);
  }
  return viewerStudentPenStrokes.get(key);
};

const getViewerSlidePenStrokeBucket = (slide) => {
  const key = getViewerSlidePenStrokeKey(slide);
  if (!viewerStudentPenStrokes.has(key)) {
    viewerStudentPenStrokes.set(key, []);
  }
  return viewerStudentPenStrokes.get(key);
};

const syncViewerDetachedLiveStrokes = (module) => {
  const moduleId = module?.id || viewerState.moduleId || 'module';
  const slides = Array.isArray(module?.builder_data?.slides) ? module.builder_data.slides : [];
  slides.forEach((slide, slideIndex) => {
    const detachedStrokeKeys = new Set(
      (Array.isArray(slide?.elements) ? slide.elements : [])
        .filter((element) => element?.type === 'pen' && element?.liveStrokeSource === 'student-live' && element?.liveStrokeDetached === true && typeof element?.liveStrokeKey === 'string')
        .map((element) => element.liveStrokeKey)
    );
    if (!detachedStrokeKeys.size) {
      return;
    }
    const bucketKey = getViewerSlidePenStrokeKeyFor(moduleId, slide, slideIndex);
    const currentStrokes = viewerStudentPenStrokes.get(bucketKey);
    if (!Array.isArray(currentStrokes) || !currentStrokes.length) {
      return;
    }
    const nextStrokes = currentStrokes.filter((stroke) => !detachedStrokeKeys.has(String(stroke?.id || stroke?.liveStrokeKey || '').trim()));
    if (nextStrokes.length !== currentStrokes.length) {
      viewerStudentPenStrokes.set(bucketKey, nextStrokes);
    }
  });
};

const syncViewerLiveDrawingStrokes = (module) => {
  const moduleId = module?.id || viewerState.moduleId || 'module';
  const slides = Array.isArray(module?.builder_data?.slides) ? module.builder_data.slides : [];
  const drawingStrokes = Array.isArray(module?.liveShare?.drawingStrokes) ? module.liveShare.drawingStrokes : [];
  
  drawingStrokes.forEach((strokeData) => {
    if (!strokeData?.stroke || !Array.isArray(strokeData.stroke.points)) {
      return;
    }
    
    const slideId = strokeData.slideId;
    const slide = slides.find((s) => getStableSlideKey(s, slides.indexOf(s)) === slideId);
    
    if (!slide) {
      return;
    }
    
    const slideIndex = slides.indexOf(slide);
    const bucketKey = getViewerSlidePenStrokeKeyFor(moduleId, slide, slideIndex);
    const currentStrokes = viewerStudentPenStrokes.get(bucketKey);
    
    if (!Array.isArray(currentStrokes)) {
      viewerStudentPenStrokes.set(bucketKey, []);
    }
    
    const bucket = viewerStudentPenStrokes.get(bucketKey);
    
    const existingStrokeIndex = bucket.findIndex((s) => s.id === strokeData.stroke.id);
    const normalizedStroke = {
      id: strokeData.stroke.id,
      color: strokeData.stroke.color || '#111827',
      width: strokeData.stroke.width || 8,
      points: Array.isArray(strokeData.stroke.points) ? strokeData.stroke.points : []
    };
    
    if (existingStrokeIndex >= 0) {
      bucket[existingStrokeIndex] = normalizedStroke;
    } else {
      bucket.push(normalizedStroke);
    }
  });
};

const slideHasStudentPaintablePen = (slide) =>
  Array.isArray(slide?.elements) && slide.elements.some((element) => element?.type === 'pen' && isViewerStudentPaintEnabled(element.studentCanPaint));

const getFirstStudentPaintablePen = (slide) =>
  Array.isArray(slide?.elements)
    ? slide.elements.find((element) => element?.type === 'pen' && isViewerStudentPaintEnabled(element.studentCanPaint)) || null
    : null;

const moduleAllowsViewerPen = (module) => {
  const explicitFlag = module?.builder_data?.moduleSettings?.allowStudentPen;
  if (explicitFlag === true || explicitFlag === 'true') {
    return true;
  }
  if (explicitFlag === false || explicitFlag === 'false') {
    return false;
  }
  return Array.isArray(module?.builder_data?.slides) && module.builder_data.slides.some((slide) => slideHasStudentPaintablePen(slide));
};

const moduleAllowsViewerLiveCursors = (module) => {
  const explicitFlag = module?.builder_data?.moduleSettings?.allowLiveCursors;
  return explicitFlag !== false && explicitFlag !== 'false';
};

const hashViewerLiveCursorSeed = (value = '') => {
  let hash = 0;
  const input = String(value || '');
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const getViewerLiveCursorColor = (seed = '') => {
  const hue = hashViewerLiveCursorSeed(seed) % 360;
  return `hsl(${hue} 78% 52%)`;
};

const getViewerLiveCursorIdentity = () => {
  const currentUser = getCurrentSessionUser();
  return {
    userId: String(currentUser?.id || '').trim(),
    fullName: String(currentUser?.fullName || currentUser?.name || 'Aluno').trim(),
    role: String(currentUser?.role || 'student').trim()
  };
};

const shouldSyncViewerLiveCursors = () =>
  isLiveShareMode() &&
  Boolean(viewerState.liveShareId) &&
  !isReplayMode() &&
  moduleAllowsViewerLiveCursors(getCurrentModule());

const clearViewerLiveCursorOverlay = () => {
  if (viewerLiveCursorState.overlay) {
    viewerLiveCursorState.overlay.remove();
  }
  viewerLiveCursorState.overlay = null;
};

const ensureViewerLiveCursorOverlay = () => {
  const wrapper = ensureStageContentWrapper();
  if (!wrapper || !shouldSyncViewerLiveCursors()) {
    clearViewerLiveCursorOverlay();
    return null;
  }
  let overlay = viewerLiveCursorState.overlay;
  if (!(overlay instanceof HTMLDivElement)) {
    overlay = document.createElement('div');
    overlay.className = 'live-cursor-overlay';
    viewerLiveCursorState.overlay = overlay;
  }
  if (overlay.parentElement !== wrapper) {
    wrapper.appendChild(overlay);
  }
  return overlay;
};

const createViewerLiveCursorMarkerNode = (cursor) => {
  const color = getViewerLiveCursorColor(cursor?.userId || cursor?.peerKey || cursor?.fullName || 'cursor');
  const marker = document.createElement('div');
  marker.className = 'live-cursor-marker';
  marker.style.color = color;
  marker.style.left = `${clamp(Number(cursor?.x) || 0, 0, 1) * 100}%`;
  marker.style.top = `${clamp(Number(cursor?.y) || 0, 0, 1) * 100}%`;
  marker.innerHTML = `
    <svg class="live-cursor-pointer" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2 1.6 12.8 9H7.7l-2.1 5.4-1.9-.8L5.7 9H2z"></path>
    </svg>
    <span class="live-cursor-label" style="background:${escapeAttribute(color)};">${escapeHtml(cursor?.fullName || cursor?.role || 'Ao vivo')}</span>
  `;
  return marker;
};

const renderViewerLiveCursors = (cursors = []) => {
  if (!shouldSyncViewerLiveCursors()) {
    clearViewerLiveCursorOverlay();
    return;
  }
  const overlay = ensureViewerLiveCursorOverlay();
  if (!overlay) {
    return;
  }
  const identity = getViewerLiveCursorIdentity();
  overlay.innerHTML = '';
  cursors
    .filter((cursor) => {
      const sameUser = identity.userId && String(cursor?.userId || '').trim() === identity.userId;
      const sameRoleName =
        !identity.userId &&
        String(cursor?.role || '').trim() === identity.role &&
        String(cursor?.fullName || '').trim() === identity.fullName;
      return !(sameUser || sameRoleName);
    })
    .forEach((cursor) => {
      overlay.appendChild(createViewerLiveCursorMarkerNode(cursor));
    });
};

const stopViewerLiveCursorSync = () => {
  if (viewerLiveCursorState.pollTimer) {
    clearInterval(viewerLiveCursorState.pollTimer);
    viewerLiveCursorState.pollTimer = null;
  }
  viewerLiveCursorState.lastSentAt = 0;
  viewerLiveCursorState.lastSignature = '';
  clearViewerLiveCursorOverlay();
};

const fetchViewerLiveCursors = async () => {
  if (!shouldSyncViewerLiveCursors()) {
    clearViewerLiveCursorOverlay();
    return;
  }
  try {
    const response = await authorizedFetch(`/api/student/live-stage/${encodeURIComponent(viewerState.liveShareId)}/cursors`);
    if (!response.ok) {
      return;
    }
    const payload = await response.json().catch(() => null);
    renderViewerLiveCursors(payload?.cursors || []);
  } catch (error) {
    console.warn('Nao foi possivel atualizar os cursores ao vivo no aluno.', error);
  }
};

const startViewerLiveCursorSync = () => {
  stopViewerLiveCursorSync();
  if (!shouldSyncViewerLiveCursors()) {
    return;
  }
  viewerLiveCursorState.pollTimer = setInterval(() => {
    void fetchViewerLiveCursors();
  }, LIVE_CURSOR_POLL_INTERVAL_MS);
  void fetchViewerLiveCursors();
};

const getViewerLiveCursorPoint = (event) => {
  const wrapper = ensureStageContentWrapper();
  if (!(wrapper instanceof HTMLDivElement)) {
    return null;
  }
  const rect = wrapper.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
  };
};

const sendViewerLiveCursor = async (point = null, active = true) => {
  if (!shouldSyncViewerLiveCursors()) {
    return;
  }
  const now = Date.now();
  const normalizedPoint = point
    ? {
        x: clamp(Number(point.x) || 0, 0, 1),
        y: clamp(Number(point.y) || 0, 0, 1)
      }
    : { x: 0, y: 0 };
  const signature = `${active ? '1' : '0'}:${normalizedPoint.x.toFixed(4)}:${normalizedPoint.y.toFixed(4)}`;
  if (active && signature === viewerLiveCursorState.lastSignature && now - viewerLiveCursorState.lastSentAt < LIVE_CURSOR_SEND_INTERVAL_MS) {
    return;
  }
  if (!active && signature === viewerLiveCursorState.lastSignature && now - viewerLiveCursorState.lastSentAt < 250) {
    return;
  }
  viewerLiveCursorState.lastSignature = signature;
  viewerLiveCursorState.lastSentAt = now;
  try {
    await authorizedFetch(`/api/student/live-stage/${encodeURIComponent(viewerState.liveShareId)}/cursor`, {
      method: 'POST',
      body: JSON.stringify({
        active,
        x: normalizedPoint.x,
        y: normalizedPoint.y
      })
    });
  } catch (error) {
    console.warn('Nao foi possivel enviar o cursor ao vivo do aluno.', error);
  }
};

const slideAllowsViewerPen = (module, slide) => {
  // Se o módulo explicitamente liberou a caneta (via toggle do admin), habilita em qualquer slide
  if (moduleAllowsViewerPen(module)) {
    return true;
  }
  // Fallback: slide tem um elemento pen com studentCanPaint
  return slideHasStudentPaintablePen(slide);
};

const getViewerPenAvailabilityReason = (module, slide) => {
  if (!slideAllowsViewerPen(module, slide)) {
    return '';
  }
  if (viewerState.isPublic && !isLiveShareMode()) {
    return 'A caneta fica disponível apenas no acesso autenticado do aluno.';
  }
  if (isReplayMode()) {
    return 'A caneta fica desativada no modo replay.';
  }
  return '';
};

const syncViewerPenInputs = (source = '') => {
  const safeSize = getViewerPenBrushSize();
  viewerState.penSize = safeSize;
  viewerState.penColor = getViewerPenBrushColor();
  if (source !== 'color' && viewerPenColorInput) {
    viewerPenColorInput.value = viewerState.penColor;
  }
  if (source !== 'range' && viewerPenSizeInput) {
    viewerPenSizeInput.value = String(safeSize);
  }
  if (source !== 'number' && viewerPenSizeNumberInput) {
    viewerPenSizeNumberInput.value = String(safeSize);
  }
};

const syncViewerPenOverlayInteractivity = () => {
  if (!moduleStage) {
    return;
  }
  const canvas = viewerPenOverlayState.canvas;
  const overlay = viewerPenOverlayState.overlay;
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }
  if (overlay instanceof HTMLDivElement) {
    overlay.classList.toggle('is-active', Boolean(viewerState.penToolActive));
    overlay.style.pointerEvents = viewerState.penToolActive ? 'auto' : 'none';
  }
  canvas.style.pointerEvents = viewerState.penToolActive ? 'auto' : 'none';
  canvas.style.cursor = viewerState.penToolActive ? 'crosshair' : 'default';
};

const updateViewerPenToolState = (slide = null) => {
  const currentSlide = slide || getCurrentSlide();
  const currentModule = getCurrentModule();
  const availabilityReason = getViewerPenAvailabilityReason(currentModule, currentSlide);
  // Em live share, se o módulo liberar caneta, permite independente de ser público
  const canShowTool = !isReplayMode() && (isLiveShareMode() ? true : !viewerState.isPublic) && slideAllowsViewerPen(currentModule, currentSlide);
  const referencePen = getFirstStudentPaintablePen(currentSlide);
  if (referencePen && !viewerState.penSettingsTouched) {
    viewerState.penColor = referencePen.strokeColor || viewerState.penColor;
    viewerState.penSize = getViewerPenStrokeWidth(referencePen);
  }
  if (!canShowTool) {
    viewerState.penToolActive = false;
  }
  if (viewerPenToolBtn) {
    viewerPenToolBtn.hidden = !canShowTool && !availabilityReason;
    viewerPenToolBtn.disabled = !canShowTool;
    viewerPenToolBtn.classList.toggle('is-active', Boolean(canShowTool && viewerState.penToolActive));
    viewerPenToolBtn.setAttribute('aria-pressed', canShowTool && viewerState.penToolActive ? 'true' : 'false');
    if (availabilityReason) {
      viewerPenToolBtn.title = availabilityReason;
      viewerPenToolBtn.setAttribute('aria-label', availabilityReason);
    } else {
      viewerPenToolBtn.removeAttribute('title');
      viewerPenToolBtn.removeAttribute('aria-label');
    }
    const labelNode = viewerPenToolBtn.querySelector('span');
    if (labelNode) {
      labelNode.textContent = availabilityReason
        ? 'Caneta indisponível'
        : canShowTool && viewerState.penToolActive
          ? 'Caneta ativa'
          : 'Ativar caneta';
    }
  }
  if (viewerPenControls) {
    viewerPenControls.hidden = !canShowTool;
  }
  if (viewerPenClearBtn) {
    viewerPenClearBtn.disabled = !canShowTool;
  }
  syncViewerPenInputs();
  // Garante que o canvas de desenho exista quando a caneta for ativada
  ensureViewerPenOverlay(currentSlide);
  syncViewerPenOverlayInteractivity();
};

const toggleViewerPenTool = () => {
  const slide = getCurrentSlide();
  const allowed = slideAllowsViewerPen(getCurrentModule(), slide);
  // Em live share, a caneta é permitida independente de isPublic
  if (!allowed || isReplayMode() || (viewerState.isPublic && !isLiveShareMode())) {
    return;
  }
  viewerState.penToolActive = !viewerState.penToolActive;
  updateViewerPenToolState(slide);
};

const redrawAllViewerPenOverlays = (slide = null) => {
  const currentSlide = slide || getCurrentSlide();
  if (!moduleStage || !currentSlide || !(viewerPenOverlayState.canvas instanceof HTMLCanvasElement)) {
    return;
  }
  const stageSize = moduleStageDimensions || DEFAULT_STAGE_SIZE;
  redrawViewerStudentPenCanvas(
    viewerPenOverlayState.canvas,
    { width: stageSize.width, height: stageSize.height, strokeColor: getViewerPenBrushColor(), strokeWidth: getViewerPenBrushSize() },
    getViewerSlidePenStrokeBucket(currentSlide)
  );
};

const getViewerStageBaseOffset = () => {
  const size = getStageSize();
  const viewportWidth = moduleStage?.clientWidth || size.width;
  const viewportHeight = moduleStage?.clientHeight || size.height;
  const renderedWidth = size.width * viewerStageZoomState.baseScale;
  const renderedHeight = size.height * viewerStageZoomState.baseScale;
  return {
    left: Math.max(0, (viewportWidth - renderedWidth) / 2),
    top: Math.max(0, (viewportHeight - renderedHeight) / 2)
  };
};

const clampViewerStageZoomTranslation = () => {
  const wrapper = ensureStageContentWrapper();
  if (!wrapper || !moduleStage) {
    return;
  }
  const size = getStageSize();
  const viewportWidth = moduleStage.clientWidth || size.width;
  const viewportHeight = moduleStage.clientHeight || size.height;
  const baseOffset = getViewerStageBaseOffset();
  const renderedWidth = size.width * viewerStageZoomState.baseScale * viewerStageZoomState.userScale;
  const renderedHeight = size.height * viewerStageZoomState.baseScale * viewerStageZoomState.userScale;
  const minTranslateX = Math.min(baseOffset.left, viewportWidth - baseOffset.left - renderedWidth);
  const minTranslateY = Math.min(baseOffset.top, viewportHeight - baseOffset.top - renderedHeight);
  const maxTranslateX = baseOffset.left;
  const maxTranslateY = baseOffset.top;
  viewerStageZoomState.translateX = Math.min(maxTranslateX, Math.max(minTranslateX, viewerStageZoomState.translateX));
  viewerStageZoomState.translateY = Math.min(maxTranslateY, Math.max(minTranslateY, viewerStageZoomState.translateY));
};

const applyViewerStageZoomTransform = () => {
  const wrapper = ensureStageContentWrapper();
  if (!wrapper) {
    return;
  }
  clampViewerStageZoomTranslation();
  const totalScale = viewerStageZoomState.baseScale * viewerStageZoomState.userScale;
  wrapper.style.transform = `translate3d(${viewerStageZoomState.translateX}px, ${viewerStageZoomState.translateY}px, 0) scale(${totalScale})`;
};

const resetViewerStageZoom = () => {
  viewerStageZoomState.userScale = 1;
  viewerStageZoomState.translateX = 0;
  viewerStageZoomState.translateY = 0;
  viewerStageZoomState.pinchStartDistance = 0;
  viewerStageZoomState.pointers.clear();
  applyViewerStageZoomTransform();
};

const getViewerStagePointerDistance = (points) => {
  if (!Array.isArray(points) || points.length < 2) {
    return 0;
  }
  const [first, second] = points;
  return Math.hypot(second.x - first.x, second.y - first.y);
};

const getViewerStagePointerCenter = (points) => {
  if (!Array.isArray(points) || points.length < 2) {
    return { x: 0, y: 0 };
  }
  const [first, second] = points;
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
};

const attachViewerStageZoomHandlers = () => {
  if (!moduleStage) {
    return;
  }
  const MIN_PINCH_DISTANCE = 8;
  const MAX_STAGE_ZOOM = 4;
  const updatePointer = (event) => {
    viewerStageZoomState.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });
  };
  const removePointer = (event) => {
    viewerStageZoomState.pointers.delete(event.pointerId);
    if (viewerStageZoomState.pointers.size < 2) {
      viewerStageZoomState.pinchStartDistance = 0;
    }
  };
  moduleStage.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || viewerState.penToolActive) {
      return;
    }
    updatePointer(event);
    if (viewerStageZoomState.pointers.size === 1 && viewerStageZoomState.userScale > 1) {
      viewerStageZoomState.panStartX = event.clientX;
      viewerStageZoomState.panStartY = event.clientY;
      viewerStageZoomState.panOriginX = viewerStageZoomState.translateX;
      viewerStageZoomState.panOriginY = viewerStageZoomState.translateY;
    }
    if (viewerStageZoomState.pointers.size === 2) {
      const points = Array.from(viewerStageZoomState.pointers.values());
      viewerStageZoomState.pinchStartDistance = getViewerStagePointerDistance(points);
      viewerStageZoomState.pinchStartScale = viewerStageZoomState.userScale;
      viewerStageZoomState.pinchStartTranslateX = viewerStageZoomState.translateX;
      viewerStageZoomState.pinchStartTranslateY = viewerStageZoomState.translateY;
    }
  });
  moduleStage.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch' || viewerState.penToolActive || !viewerStageZoomState.pointers.has(event.pointerId)) {
      return;
    }
    updatePointer(event);
    const points = Array.from(viewerStageZoomState.pointers.values());
    if (points.length >= 2) {
      const distance = getViewerStagePointerDistance(points);
      if (distance < MIN_PINCH_DISTANCE || viewerStageZoomState.pinchStartDistance < MIN_PINCH_DISTANCE) {
        return;
      }
      event.preventDefault();
      const nextScale = Math.min(
        MAX_STAGE_ZOOM,
        Math.max(1, viewerStageZoomState.pinchStartScale * (distance / viewerStageZoomState.pinchStartDistance))
      );
      const ratio = nextScale / (viewerStageZoomState.pinchStartScale || 1);
      const center = getViewerStagePointerCenter(points);
      const stageRect = moduleStage.getBoundingClientRect();
      const anchorX = center.x - stageRect.left;
      const anchorY = center.y - stageRect.top;
      viewerStageZoomState.userScale = nextScale;
      viewerStageZoomState.translateX = anchorX - ((anchorX - viewerStageZoomState.pinchStartTranslateX) * ratio);
      viewerStageZoomState.translateY = anchorY - ((anchorY - viewerStageZoomState.pinchStartTranslateY) * ratio);
      applyViewerStageZoomTransform();
      return;
    }
    if (points.length === 1 && viewerStageZoomState.userScale > 1) {
      event.preventDefault();
      viewerStageZoomState.translateX = viewerStageZoomState.panOriginX + (event.clientX - viewerStageZoomState.panStartX);
      viewerStageZoomState.translateY = viewerStageZoomState.panOriginY + (event.clientY - viewerStageZoomState.panStartY);
      applyViewerStageZoomTransform();
    }
  }, { passive: false });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((eventName) => {
    moduleStage.addEventListener(eventName, (event) => {
      if (event.pointerType !== 'touch') {
        return;
      }
      removePointer(event);
    });
  });
};

const clearViewerPenDraft = () => {
  const slide = getCurrentSlide();
  if (!slide) {
    return;
  }
  viewerStudentPenStrokes.set(getViewerSlidePenStrokeKey(slide), []);
  redrawAllViewerPenOverlays(slide);
};

const renderViewerPenSvgMarkup = (element) => {
  const width = Math.max(1, Number(element?.width) || 1);
  const height = Math.max(1, Number(element?.height) || 1);
  const points = Array.isArray(element?.points) ? element.points : [];
  const pathCommands = [];
  let currentStrokeLength = 0;
  points.forEach((point) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      currentStrokeLength = 0;
      return;
    }
    const x = clamp(Number(point.x) || 0, 0, 1) * width;
    const y = clamp(Number(point.y) || 0, 0, 1) * height;
    if (!currentStrokeLength) {
      pathCommands.push(`M ${x} ${y}`);
    } else {
      pathCommands.push(`L ${x} ${y}`);
    }
    currentStrokeLength += 1;
    if (currentStrokeLength === 1) {
      pathCommands.push(`L ${x + 0.01} ${y + 0.01}`);
    }
  });
  const strokeWidth = getViewerPenStrokeWidth(element);
  const strokeColor = element?.strokeColor || '#111827';
  return `
    <svg class="builder-pen-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
      <path
        d="${escapeAttribute(pathCommands.join(' '))}"
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

const createViewerPenElementNode = (element) => {
  const node = document.createElement('div');
  node.className = 'builder-pen-element';
  node.innerHTML = renderViewerPenSvgMarkup(element);
  return node;
};

const redrawViewerStudentPenCanvas = (canvas, element, strokes = []) => {
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }
  const width = Math.max(1, Number(element?.width) || canvas.clientWidth || 1);
  const height = Math.max(1, Number(element?.height) || canvas.clientHeight || 1);
  const scale = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  if (canvas.width !== targetWidth) {
    canvas.width = targetWidth;
  }
  if (canvas.height !== targetHeight) {
    canvas.height = targetHeight;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  strokes.forEach((stroke) => {
    const points = Array.isArray(stroke?.points) ? stroke.points : [];
    if (!points.length) {
      return;
    }
    context.save();
    context.strokeStyle = stroke.color || element?.strokeColor || '#111827';
    context.lineWidth = Math.max(VIEWER_PEN_MIN_BRUSH_SIZE, Number(stroke.width) || getViewerPenStrokeWidth(element));
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    const firstPoint = points[0];
    const startX = clamp(Number(firstPoint?.x) || 0, 0, 1) * width;
    const startY = clamp(Number(firstPoint?.y) || 0, 0, 1) * height;
    context.moveTo(startX, startY);
    points.slice(1).forEach((point) => {
      context.lineTo(clamp(Number(point?.x) || 0, 0, 1) * width, clamp(Number(point?.y) || 0, 0, 1) * height);
    });
    if (points.length === 1) {
      context.lineTo(startX + 0.01, startY + 0.01);
    }
    context.stroke();
    context.restore();
  });
};

const destroyViewerPenOverlay = () => {
  if (viewerPenOverlayState.overlay) {
    viewerPenOverlayState.overlay.remove();
  }
  viewerPenOverlayState.overlay = null;
  viewerPenOverlayState.canvas = null;
  viewerPenOverlayState.drawing = false;
  viewerPenOverlayState.pointerId = null;
  viewerPenOverlayState.activeStroke = null;
  viewerPenOverlayState.slideKey = '';
};

const ensureViewerPenOverlay = (slide) => {
  const wrapper = ensureStageContentWrapper();
  const stageSize = moduleStageDimensions || DEFAULT_STAGE_SIZE;
  const currentModule = getCurrentModule();
  const canDrawOnSlide =
    wrapper &&
    slide &&
    !isReplayMode() &&
    (isLiveShareMode() || !viewerState.isPublic) &&
    slideAllowsViewerPen(currentModule, slide);
  if (!canDrawOnSlide) {
    destroyViewerPenOverlay();
    return;
  }
  const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
  if (!viewerPenOverlayState.overlay || viewerPenOverlayState.slideKey !== slideKey) {
    destroyViewerPenOverlay();
  } else if (viewerPenOverlayState.canvas) {
    // Re-apenda para garantir que volte ao DOM (após innerHTML='') e fique no topo
    wrapper.appendChild(viewerPenOverlayState.overlay);
    // Atualiza dimensões caso o palco tenha mudado de tamanho
    if (viewerPenOverlayState.canvas.width !== Math.max(1, stageSize.width) || viewerPenOverlayState.canvas.height !== Math.max(1, stageSize.height)) {
      viewerPenOverlayState.canvas.width = Math.max(1, stageSize.width);
      viewerPenOverlayState.canvas.height = Math.max(1, stageSize.height);
      redrawAllViewerPenOverlays(slide);
    }
  }
  if (!viewerPenOverlayState.overlay) {
    const overlay = document.createElement('div');
    overlay.className = 'pen-stage-overlay viewer-pen-stage-overlay';
    const canvas = document.createElement('canvas');
    canvas.className = 'pen-overlay-canvas viewer-pen-paint-layer';
    canvas.width = Math.max(1, stageSize.width);
    canvas.height = Math.max(1, stageSize.height);
    overlay.appendChild(canvas);
    wrapper.appendChild(overlay);
    viewerPenOverlayState.overlay = overlay;
    viewerPenOverlayState.canvas = canvas;
    viewerPenOverlayState.slideKey = slideKey;
    const buildNormalizedPoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      const relativeX = clamp(event.clientX - rect.left, 0, rect.width || 1);
      const relativeY = clamp(event.clientY - rect.top, 0, rect.height || 1);
      return {
        x: rect.width > 0 ? relativeX / rect.width : 0,
        y: rect.height > 0 ? relativeY / rect.height : 0
      };
    };
    const finishStroke = () => {
      if (viewerPenOverlayState.pointerId !== null) {
        canvas.releasePointerCapture?.(viewerPenOverlayState.pointerId);
      }
      const stroke = viewerPenOverlayState.activeStroke;
      viewerPenOverlayState.drawing = false;
      viewerPenOverlayState.pointerId = null;
      viewerPenOverlayState.activeStroke = null;
      if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) {
        return;
      }
      const referencePen = getFirstStudentPaintablePen(slide);
      const startPoint = stroke.points[0];
      persistProgressEventToBackend({
        type: 'drawing',
        slideId: slideKey,
        slideTitle: slide?.title || '',
        elementId: referencePen?.id || null,
        elementType: 'pen',
        summary: 'Rabiscou no slide com a caneta.',
        details: {
          x: clamp(Number(startPoint?.x) || 0, 0, 1) * stageSize.width,
          y: clamp(Number(startPoint?.y) || 0, 0, 1) * stageSize.height,
          pointCount: stroke.points.length,
          strokeWidth: stroke.width,
          strokeColor: stroke.color
        }
      });

      if (isLiveShareMode()) {
        authorizedFetch(`/api/student/live-stage/${encodeURIComponent(viewerState.liveShareId)}/drawing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stroke: {
              id: stroke.id,
              slideId: slideKey,
              color: stroke.color,
              width: stroke.width,
              points: stroke.points
            }
          })
        }).catch((err) => console.warn('Erro ao sincronizar desenho ao vivo:', err));
      }
    };
    const handlePointerDown = (event) => {
      if (!viewerState.penToolActive) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      viewerPenOverlayState.pointerId = event.pointerId;
      viewerPenOverlayState.drawing = true;
      viewerPenOverlayState.activeStroke = {
        id: createViewerLiveStrokeId(),
        color: getViewerPenBrushColor(),
        width: getViewerPenBrushSize(),
        points: []
      };
      getViewerSlidePenStrokeBucket(slide).push(viewerPenOverlayState.activeStroke);
      canvas.setPointerCapture?.(event.pointerId);
      viewerPenOverlayState.activeStroke.points.push(buildNormalizedPoint(event));
      redrawAllViewerPenOverlays(slide);
    };
    const handlePointerMove = (event) => {
      if (!viewerPenOverlayState.drawing || viewerPenOverlayState.pointerId !== event.pointerId || !viewerPenOverlayState.activeStroke) {
        return;
      }
      viewerPenOverlayState.activeStroke.points.push(buildNormalizedPoint(event));
      redrawAllViewerPenOverlays(slide);
    };
    overlay.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerdown', handlePointerDown);
    overlay.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', finishStroke);
    overlay.addEventListener('pointerup', finishStroke);
    canvas.addEventListener('pointercancel', finishStroke);
    overlay.addEventListener('pointercancel', finishStroke);
  }
  viewerPenOverlayState.canvas.width = Math.max(1, stageSize.width);
  viewerPenOverlayState.canvas.height = Math.max(1, stageSize.height);
  viewerPenOverlayState.canvas.style.width = `${stageSize.width}px`;
  viewerPenOverlayState.canvas.style.height = `${stageSize.height}px`;
  redrawAllViewerPenOverlays(slide);
  syncViewerPenOverlayInteractivity();
};

const attachViewerStudentPenOverlay = (node, element, slide) => {
  return;
};

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
    audio_input: 'Enviou audio',
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

const normalizeCameraElement = (element) => {
  if (!element || element.type !== 'camera') {
    return;
  }
  element.width = Math.max(220, Number(element.width) || 320);
  element.height = Math.max(160, Number(element.height) || 240);
  element.backgroundColor = 'transparent';
};

const getViewerCameraContext = (element, slide) => ({
  elementId: element?.id || '',
  slideId: slide?.id || ''
});

const getViewerCameraSessionKey = (context) => `${context.slideId || 'slide'}::${context.elementId || 'element'}`;

const createViewerCameraSession = () => ({
  stream: null,
  captureVideo: null,
  recorder: null,
  recordedChunks: [],
  pendingStart: null,
  phase: 'idle',
  lastError: '',
  recordingCleanup: null,
  startToken: 0,
  hasAudio: false
});

const getViewerCameraSession = (context) => {
  const key = getViewerCameraSessionKey(context);
  if (!viewerCameraRuntime.has(key)) {
    viewerCameraRuntime.set(key, createViewerCameraSession());
  }
  return viewerCameraRuntime.get(key);
};

const isViewerCameraSupported = () =>
  typeof navigator !== 'undefined' &&
  navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === 'function';

const formatCameraAccessError = (error) => {
  const errorName = String(error?.name || '').trim();
  if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
    return 'O navegador ou o sistema ainda estao bloqueando a camera para este site. Verifique a permissao do endereco e a privacidade da camera no Windows.';
  }
  if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
    return 'A camera parece estar ocupada por outro programa ou bloqueada pelo sistema. Feche outros apps que usam webcam e tente novamente.';
  }
  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return 'Nenhuma camera foi encontrada neste dispositivo.';
  }
  if (errorName === 'OverconstrainedError' || errorName === 'ConstraintNotSatisfiedError') {
    return 'A camera deste dispositivo nao aceitou a configuracao solicitada. Tente novamente.';
  }
  if (errorName === 'AbortError') {
    return 'O navegador interrompeu a inicializacao da camera. Tente novamente.';
  }
  const fallback = String(error?.message || '').trim();
  return fallback || 'Nao foi possivel acessar a webcam.';
};

const formatAudioAccessError = (error) => {
  const errorName = String(error?.name || '').trim();
  if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
    return 'O navegador ou o sistema bloqueou o microfone para este site. Libere a permissao do microfone e tente novamente.';
  }
  if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
    return 'O microfone parece estar ocupado por outro programa ou bloqueado pelo sistema.';
  }
  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return 'Nenhum microfone foi encontrado neste dispositivo. Conecte um microfone ou envie um arquivo de audio.';
  }
  if (errorName === 'OverconstrainedError' || errorName === 'ConstraintNotSatisfiedError') {
    return 'O microfone deste dispositivo nao aceitou a configuracao solicitada.';
  }
  if (errorName === 'AbortError') {
    return 'O navegador interrompeu a inicializacao do microfone. Tente novamente.';
  }
  const fallback = String(error?.message || '').trim();
  return fallback || 'Nao foi possivel acessar o microfone.';
};

const isMissingAudioInputDeviceError = (error) => {
  const errorName = String(error?.name || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError' || message.includes('device not found');
};

const chooseCameraRecordingMimeType = () => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  return CAMERA_RECORDING_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
};

const normalizeRecordedVideoMimeType = (mimeType = '') => {
  const baseType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return baseType.startsWith('video/') ? baseType : 'video/webm';
};

const streamHasAudioTrack = (stream) =>
  stream instanceof MediaStream &&
  typeof stream.getAudioTracks === 'function' &&
  stream.getAudioTracks().some((track) => track.readyState === 'live');

const buildCameraRecorderStream = (captureStream, sourceStream) => {
  const videoStream = captureStream || sourceStream || null;
  if (!videoStream) {
    return null;
  }
  const videoTracks = typeof videoStream.getVideoTracks === 'function'
    ? videoStream.getVideoTracks().filter((track) => track.readyState === 'live')
    : [];
  const audioTracks = sourceStream && typeof sourceStream.getAudioTracks === 'function'
    ? sourceStream.getAudioTracks().filter((track) => track.readyState === 'live')
    : [];
  if (!videoTracks.length) {
    return sourceStream || captureStream || null;
  }
  if (!audioTracks.length) {
    return captureStream || sourceStream || null;
  }
  try {
    return new MediaStream([...videoTracks, ...audioTracks]);
  } catch (error) {
    console.warn('Nao foi possivel combinar audio e video da camera. A gravacao seguira sem audio.', error);
    return captureStream || sourceStream || null;
  }
};

const createCameraMediaRecorder = (primaryStream, fallbackStream) => {
  const attempts = [];
  if (primaryStream) attempts.push(primaryStream);
  if (fallbackStream && fallbackStream !== primaryStream) attempts.push(fallbackStream);
  let lastError = null;
  for (const stream of attempts) {
    try {
      const mimeType = chooseCameraRecordingMimeType();
      return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('A gravacao da camera nao esta disponivel agora.');
};

const readBlobAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Nao foi possivel preparar a captura da camera.'));
    reader.readAsDataURL(blob);
  });

const createCameraCaptureVideo = (stream) => {
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.play().catch(() => {});
  return video;
};

const waitForCameraVideoReady = (video) =>
  new Promise((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
      resolve();
      return;
    }
    const finish = () => {
      video.removeEventListener('loadedmetadata', finish);
      video.removeEventListener('canplay', finish);
      resolve();
    };
    video.addEventListener('loadedmetadata', finish, { once: true });
    video.addEventListener('canplay', finish, { once: true });
  });

const attachCameraStreamToVideo = (video, stream) => {
  if (!(video instanceof HTMLVideoElement)) {
    return;
  }
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }
  video.play().catch(() => {});
};

const requestViewerCameraRender = (context) => {
  const currentSlide = getCurrentSlide();
  if (!currentSlide || currentSlide.id !== context?.slideId) {
    return;
  }
  renderSlide(currentSlide);
};

const clearViewerCameraSessionResources = (session) => {
  if (!session) {
    return;
  }
  session.startToken += 1;
  if (typeof session.recordingCleanup === 'function') {
    session.recordingCleanup();
    session.recordingCleanup = null;
  }
  if (session.recorder && session.recorder.state !== 'inactive') {
    try {
      session.recorder.ondataavailable = null;
      session.recorder.stop();
    } catch (error) {
      console.warn('Nao foi possivel interromper a gravacao da camera.', error);
    }
  }
  session.recorder = null;
  session.recordedChunks = [];
  if (session.captureVideo instanceof HTMLVideoElement) {
    session.captureVideo.pause();
    session.captureVideo.srcObject = null;
  }
  session.captureVideo = null;
  if (session.stream) {
    session.stream.getTracks().forEach((track) => track.stop());
  }
  session.stream = null;
  session.pendingStart = null;
  session.phase = 'idle';
  session.lastError = '';
  session.hasAudio = false;
};

const disposeViewerCameraSession = (context) => {
  const key = getViewerCameraSessionKey(context);
  const session = viewerCameraRuntime.get(key);
  if (!session) {
    return;
  }
  clearViewerCameraSessionResources(session);
  viewerCameraRuntime.delete(key);
};

const syncVisibleViewerCameraSessions = (visibleKeys = new Set()) => {
  viewerCameraRuntime.forEach((session, key) => {
    if (!visibleKeys.has(key)) {
      clearViewerCameraSessionResources(session);
      viewerCameraRuntime.delete(key);
    }
  });
};

const requestViewerCameraStream = async (context, { restart = false } = {}) => {
  const session = getViewerCameraSession(context);
  if (!isViewerCameraSupported()) {
    session.phase = 'error';
    session.lastError = 'A webcam nao esta disponivel neste navegador.';
    requestViewerCameraRender(context);
    throw new Error(session.lastError);
  }
  if (restart) {
    clearViewerCameraSessionResources(session);
  }
  if (session.stream && session.phase !== 'error') {
    return session.stream;
  }
  if (session.pendingStart) {
    return session.pendingStart;
  }
  session.phase = 'requesting';
  session.lastError = '';
  const startToken = session.startToken + 1;
  session.startToken = startToken;
  session.pendingStart = (async () => {
    const preferredAudioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };
    const constraintsList = [
      { video: { facingMode: 'user' }, audio: preferredAudioConstraints },
      { video: true, audio: preferredAudioConstraints },
      { video: { facingMode: 'user' }, audio: true },
      { video: true, audio: true },
      { video: { facingMode: 'user' }, audio: false },
      { video: true, audio: false }
    ];
    let stream = null;
    let lastError = null;
    for (const constraints of constraintsList) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!stream) {
      throw lastError || new Error('Nao foi possivel acessar a webcam.');
    }
    if (session.startToken !== startToken) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Sessao de camera encerrada.');
    }
    session.stream = stream;
    session.hasAudio = streamHasAudioTrack(stream);
    session.captureVideo = createCameraCaptureVideo(stream);
    await waitForCameraVideoReady(session.captureVideo);
    if (session.startToken !== startToken) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Sessao de camera encerrada.');
    }
    session.phase = 'ready';
    requestViewerCameraRender(context);
    return stream;
  })()
    .catch((error) => {
      clearViewerCameraSessionResources(session);
      session.phase = 'error';
      session.lastError = formatCameraAccessError(error);
      requestViewerCameraRender(context);
      throw error;
    })
    .finally(() => {
      session.pendingStart = null;
    });
  return session.pendingStart;
};

const getCameraOutputSize = (element, scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1))) => {
  const width = Math.max(1, Math.round(Number(element?.width) || 320));
  const height = Math.max(1, Math.round(Number(element?.height) || 240));
  return {
    cssWidth: width,
    cssHeight: height,
    pixelWidth: Math.max(1, Math.round(width * scale)),
    pixelHeight: Math.max(1, Math.round(height * scale))
  };
};

const drawMirroredVideoCover = (context, video, width, height) => {
  const sourceWidth = Math.max(1, Number(video?.videoWidth) || width);
  const sourceHeight = Math.max(1, Number(video?.videoHeight) || height);
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;
  if (sourceRatio > targetRatio) {
    sw = Math.round(sourceHeight * targetRatio);
    sx = Math.max(0, Math.round((sourceWidth - sw) / 2));
  } else if (sourceRatio < targetRatio) {
    sh = Math.round(sourceWidth / targetRatio);
    sy = Math.max(0, Math.round((sourceHeight - sh) / 2));
  }
  context.save();
  context.translate(width, 0);
  context.scale(-1, 1);
  context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  context.restore();
};

const finalizeViewerCameraAsImage = async (element, slide, dataUrl) => {
  const module = getCurrentModule();
  await persistCameraCaptureToBackend({
    module,
    slide,
    element,
    image: dataUrl
  });
  element.type = 'image';
  element.src = dataUrl;
  element.objectFit = 'cover';
  element.backgroundColor = 'transparent';
  delete element.provider;
  delete element.embedSrc;
  delete element.videoTriggers;
  disposeViewerCameraSession(getViewerCameraContext(element, slide));
  renderSlide(getCurrentSlide());
};

const finalizeViewerCameraAsVideo = async (element, slide, dataUrl) => {
  const module = getCurrentModule();
  await persistCameraCaptureToBackend({
    module,
    slide,
    element,
    video: dataUrl
  });
  element.type = 'video';
  element.src = dataUrl;
  element.backgroundColor = 'transparent';
  element.videoTriggers = Array.isArray(element.videoTriggers) ? element.videoTriggers : [];
  delete element.provider;
  delete element.embedSrc;
  normalizeVideoTriggerConfig(element);
  disposeViewerCameraSession(getViewerCameraContext(element, slide));
  renderSlide(getCurrentSlide());
};

const captureViewerCameraPhoto = async (element, slide) => {
  normalizeCameraElement(element);
  const context = getViewerCameraContext(element, slide);
  await requestViewerCameraStream(context);
  const session = getViewerCameraSession(context);
  const video = session.captureVideo;
  if (!(video instanceof HTMLVideoElement)) {
    throw new Error('A camera ainda nao esta pronta para fotografar.');
  }
  await waitForCameraVideoReady(video);
  const size = getCameraOutputSize(element);
  const canvas = document.createElement('canvas');
  canvas.width = size.pixelWidth;
  canvas.height = size.pixelHeight;
  const context2d = canvas.getContext('2d');
  if (!context2d) {
    throw new Error('Nao foi possivel preparar a captura da camera.');
  }
  context2d.scale(size.pixelWidth / size.cssWidth, size.pixelHeight / size.cssHeight);
  drawMirroredVideoCover(context2d, video, size.cssWidth, size.cssHeight);
  await finalizeViewerCameraAsImage(element, slide, canvas.toDataURL('image/png'));
};

const startViewerCameraRecording = async (element, slide) => {
  normalizeCameraElement(element);
  const context = getViewerCameraContext(element, slide);
  await requestViewerCameraStream(context);
  const session = getViewerCameraSession(context);
  if (session.recorder && session.recorder.state !== 'inactive') {
    return;
  }
  if (typeof MediaRecorder === 'undefined') {
    session.phase = 'error';
    session.lastError = 'Este navegador nao suporta gravacao de video.';
    requestViewerCameraRender(context);
    throw new Error(session.lastError);
  }
  const sourceVideo = session.captureVideo;
  if (!(sourceVideo instanceof HTMLVideoElement)) {
    throw new Error('A camera ainda nao esta pronta para gravar.');
  }
  await waitForCameraVideoReady(sourceVideo);
  const size = getCameraOutputSize(element);
  const canvas = document.createElement('canvas');
  canvas.width = size.pixelWidth;
  canvas.height = size.pixelHeight;
  const context2d = canvas.getContext('2d');
  if (!context2d) {
    throw new Error('Nao foi possivel preparar a gravacao da camera.');
  }
  const captureStream = typeof canvas.captureStream === 'function' ? canvas.captureStream(30) : null;
  const recorderStream = buildCameraRecorderStream(captureStream, session.stream);
  if (!recorderStream) {
    throw new Error('A gravacao da camera nao esta disponivel agora.');
  }
  let frameId = null;
  const renderFrame = () => {
    context2d.setTransform(1, 0, 0, 1, 0, 0);
    context2d.clearRect(0, 0, canvas.width, canvas.height);
    context2d.scale(size.pixelWidth / size.cssWidth, size.pixelHeight / size.cssHeight);
    drawMirroredVideoCover(context2d, sourceVideo, size.cssWidth, size.cssHeight);
    frameId = requestAnimationFrame(renderFrame);
  };
  renderFrame();
  const recorder = createCameraMediaRecorder(recorderStream, captureStream || session.stream);
  session.recordedChunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      session.recordedChunks.push(event.data);
    }
  };
  recorder.start(200);
  session.recordingCleanup = () => {
    if (typeof frameId === 'number') {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    captureStream?.getTracks().forEach((track) => track.stop());
  };
  session.recorder = recorder;
  session.phase = 'recording';
  requestViewerCameraRender(context);
};

const stopViewerCameraRecording = async (element, slide) => {
  const context = getViewerCameraContext(element, slide);
  const session = getViewerCameraSession(context);
  if (!session.recorder || session.recorder.state === 'inactive') {
    return;
  }
  session.phase = 'processing';
  requestViewerCameraRender(context);
  const recorder = session.recorder;
  const stopPromise = new Promise((resolve, reject) => {
    recorder.addEventListener('stop', resolve, { once: true });
    recorder.addEventListener('error', () => reject(new Error('Nao foi possivel finalizar a gravacao da camera.')), { once: true });
  });
  recorder.stop();
  await stopPromise;
  const blob = new Blob(session.recordedChunks, { type: normalizeRecordedVideoMimeType(recorder.mimeType) });
  session.recorder = null;
  session.recordedChunks = [];
  if (typeof session.recordingCleanup === 'function') {
    session.recordingCleanup();
    session.recordingCleanup = null;
  }
  if (!blob.size) {
    session.phase = 'error';
    session.lastError = 'A gravacao nao gerou um video valido.';
    requestViewerCameraRender(context);
    throw new Error(session.lastError);
  }
  await finalizeViewerCameraAsVideo(element, slide, await readBlobAsDataUrl(blob));
};

const getViewerCameraStatusMessage = (session) => {
  if (!isViewerCameraSupported()) {
    return 'Webcam indisponivel neste navegador.';
  }
  if (!session) {
    return 'Preparando camera...';
  }
  if (session.phase === 'recording') {
    return session.hasAudio
      ? 'Gravando em espelho. Clique em parar para gerar o video.'
      : 'Gravando em espelho sem audio. Clique em parar para gerar o video.';
  }
  if (session.phase === 'processing') {
    return 'Finalizando o video capturado...';
  }
  if (session.phase === 'requesting') {
    return 'Solicitando permissao para acessar a webcam e o microfone...';
  }
  if (session.phase === 'ready') {
    return session.hasAudio
      ? 'Espelho ativo. Tire uma foto ou grave um video.'
      : 'Espelho ativo. Microfone indisponivel; a gravacao saira sem audio.';
  }
  if (session.lastError) {
    return session.lastError;
  }
  return 'Ative a camera para transmitir a webcam neste slide.';
};

const createViewerCameraNode = (element, slide) => {
  normalizeCameraElement(element);
  if (isReplayMode()) {
    const module = getCurrentModule();
    const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
    const savedCapture = module?.id ? getInputResponseState(module.id, slideKey, element.id, module) : null;
    if (savedCapture?.video || savedCapture?.image) {
      const mediaNode = document.createElement(savedCapture.video ? 'video' : 'img');
      mediaNode.className = 'builder-media-element';
      if (savedCapture.video) {
        mediaNode.controls = true;
        mediaNode.src = savedCapture.video;
      } else {
        mediaNode.src = savedCapture.image;
        mediaNode.alt = 'Captura da camera do aluno';
      }
      return mediaNode;
    }
    const node = document.createElement('div');
    node.className = 'builder-camera-element';
    node.innerHTML = `
      <div class="builder-camera-overlay">
        <div class="builder-camera-empty">
          <strong>Sem captura salva</strong>
          <span>O aluno nao registrou foto ou video nesta camera.</span>
        </div>
      </div>
    `;
    return node;
  }
  const context = getViewerCameraContext(element, slide);
  const session = getViewerCameraSession(context);
  
  const isLiveShareMode = Boolean(viewerState.liveShareId);
  const studentPeerId = element.studentPeerId;
  const isStudentCamera = Boolean(studentPeerId);
  
  const node = document.createElement('div');
  node.className = 'builder-camera-element';

  const previewVideo = document.createElement('video');
  previewVideo.className = 'builder-camera-preview';
  previewVideo.setAttribute('aria-label', 'Visualizacao da camera no modulo');
  previewVideo.autoplay = true;
  previewVideo.playsInline = true;
  
  if (isLiveShareMode) {
    previewVideo.muted = true;
    if (isStudentCamera) {
      if (studentPeerId === studentCameraPeerId) {
        // Sou eu!
        previewVideo.srcObject = studentCameraLocalStream;
        previewVideo.muted = true; // Não ouvir o próprio áudio
        previewVideo.classList.toggle('is-video-hidden', studentCameraVideoMuted);
      } else {
        const remoteStream = viewerStudentStreams.get(studentPeerId);
        if (remoteStream) {
          previewVideo.srcObject = remoteStream;
          syncLiveRemoteAudio(`student:${studentPeerId}`, remoteStream);
        } else {
          connectToStudentPeer(studentPeerId);
        }
      }
    } else {
      if (viewerCameraStream) {
        previewVideo.srcObject = viewerCameraStream;
        syncLiveRemoteAudio('teacher-camera', viewerCameraStream);
      }
    }
  } else {
    previewVideo.muted = true; // Câmera local do aluno (muda)
    if (session.stream) {
      attachCameraStreamToVideo(previewVideo, session.stream);
    }
  }
  node.appendChild(previewVideo);

  const overlay = document.createElement('div');
  overlay.className = 'builder-camera-overlay';
  
  if (isLiveShareMode) {
    const hasStream = isStudentCamera ? 
      (studentPeerId === studentCameraPeerId ? !!studentCameraLocalStream : !!viewerStudentStreams.get(studentPeerId)) :
      !!viewerCameraStream;

    if (hasStream) {
      overlay.style.display = 'none';
    } else {
      const emptyState = document.createElement('div');
      emptyState.className = 'builder-camera-empty';
      const title = document.createElement('strong');
      title.textContent = isStudentCamera ? `Câmera de ${element.studentName || 'Aluno'}` : 'Aguardando professor';
      const text = document.createElement('span');
      text.textContent = isStudentCamera ? 'Tentando conectar à transmissão...' : 'A transmissão de câmera será iniciada em breve.';
      emptyState.append(title, text);
      overlay.appendChild(emptyState);
    }
  } else if (!session.stream || session.phase === 'error' || session.phase === 'requesting') {
    const emptyState = document.createElement('div');
    emptyState.className = 'builder-camera-empty';
    const title = document.createElement('strong');
    title.textContent = session.phase === 'error' ? 'Camera indisponivel' : 'Camera pronta para espelhar';
    const text = document.createElement('span');
    text.textContent = getViewerCameraStatusMessage(session);
    emptyState.append(title, text);
    if (session.phase !== 'requesting') {
      const overlayStartButton = document.createElement('button');
      overlayStartButton.type = 'button';
      overlayStartButton.className = 'builder-camera-btn is-secondary builder-camera-empty-action';
      overlayStartButton.textContent = session.phase === 'error' ? 'Tentar novamente' : 'Ativar camera';
      overlayStartButton.disabled = session.phase === 'processing';
      ['pointerdown', 'click'].forEach((eventName) => {
        overlayStartButton.addEventListener(eventName, (event) => {
          event.stopPropagation();
        });
      });
      overlayStartButton.addEventListener('click', () => {
        void requestViewerCameraStream(context, { restart: true }).catch(() => {});
      });
      emptyState.appendChild(overlayStartButton);
    }
    overlay.appendChild(emptyState);
  }
  node.appendChild(overlay);

  if (isLiveShareMode) {
    if (isStudentCamera && studentPeerId === studentCameraPeerId) {
      const callControls = document.createElement('div');
      callControls.className = 'builder-camera-call-controls';
      ['pointerdown', 'click'].forEach((eventName) => {
        callControls.addEventListener(eventName, (event) => {
          event.stopPropagation();
        });
      });

      callControls.appendChild(createViewerCameraCallButton({
        icon: studentCameraAudioMuted ? 'micOff' : 'mic',
        title: studentCameraAudioMuted ? 'Ativar microfone' : 'Mutar microfone',
        active: studentCameraAudioMuted,
        onClick: () => {
          studentCameraAudioMuted = !studentCameraAudioMuted;
          applyStudentCameraTrackState();
          renderSlide(getCurrentSlide());
        }
      }));

      callControls.appendChild(createViewerCameraCallButton({
        icon: studentCameraVideoMuted ? 'videoOff' : 'video',
        title: studentCameraVideoMuted ? 'Ligar camera' : 'Desligar camera',
        active: studentCameraVideoMuted,
        onClick: () => {
          studentCameraVideoMuted = !studentCameraVideoMuted;
          applyStudentCameraTrackState();
          renderSlide(getCurrentSlide());
        }
      }));

      callControls.appendChild(createViewerCameraCallButton({
        icon: 'phoneOff',
        title: 'Desligar chamada',
        danger: true,
        onClick: () => {
          stopStudentCameraCall();
        }
      }));
      node.appendChild(callControls);
    }
    return node;
  }

  const controls = document.createElement('div');
  controls.className = 'builder-camera-controls';
  ['pointerdown', 'click'].forEach((eventName) => {
    controls.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  });

  const status = document.createElement('div');
  status.className = 'builder-camera-status';
  if (session.phase === 'error') {
    status.classList.add('is-error');
  } else if (session.phase === 'recording') {
    status.classList.add('is-recording');
  }
  status.textContent = getViewerCameraStatusMessage(session);
  controls.appendChild(status);

  const actions = document.createElement('div');
  actions.className = 'builder-camera-actions';
  controls.appendChild(actions);

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'builder-camera-btn is-secondary';
  startButton.textContent = session.stream ? 'Reconectar' : 'Ativar';
  startButton.disabled = session.phase === 'requesting' || session.phase === 'processing';
  startButton.addEventListener('click', () => {
    void requestViewerCameraStream(context, { restart: true }).catch(() => {});
  });
  actions.appendChild(startButton);

  const photoButton = document.createElement('button');
  photoButton.type = 'button';
  photoButton.className = 'builder-camera-btn';
  photoButton.textContent = 'Foto';
  photoButton.disabled = !session.stream || session.phase === 'requesting' || session.phase === 'processing' || session.phase === 'recording';
  photoButton.addEventListener('click', () => {
    void captureViewerCameraPhoto(element, slide).catch((error) => {
      session.phase = 'error';
      session.lastError = error?.message || 'Nao foi possivel capturar a foto.';
      requestViewerCameraRender(context);
    });
  });
  actions.appendChild(photoButton);

  const recordButton = document.createElement('button');
  recordButton.type = 'button';
  recordButton.className = 'builder-camera-btn';
  recordButton.textContent = 'Gravar';
  recordButton.disabled = !session.stream || session.phase === 'requesting' || session.phase === 'processing' || session.phase === 'recording';
  recordButton.addEventListener('click', () => {
    void startViewerCameraRecording(element, slide).catch((error) => {
      session.phase = 'error';
      session.lastError = error?.message || 'Nao foi possivel iniciar a gravacao.';
      requestViewerCameraRender(context);
    });
  });
  actions.appendChild(recordButton);

  const stopButton = document.createElement('button');
  stopButton.type = 'button';
  stopButton.className = 'builder-camera-btn is-danger';
  stopButton.textContent = 'Parar';
  stopButton.disabled = session.phase !== 'recording';
  stopButton.addEventListener('click', () => {
    void stopViewerCameraRecording(element, slide).catch((error) => {
      session.phase = 'error';
      session.lastError = error?.message || 'Nao foi possivel finalizar a gravacao.';
      requestViewerCameraRender(context);
    });
  });
  actions.appendChild(stopButton);

  node.appendChild(controls);
  return node;
};

const createViewerScreenShareNode = () => {
  const node = document.createElement('div');
  node.className = 'builder-camera-element';
  node.style.background = '#000';

  const video = document.createElement('video');
  video.className = 'builder-camera-preview is-screen-share';
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'contain';

  if (viewerScreenStream) {
    video.srcObject = viewerScreenStream;
    syncLiveRemoteAudio('teacher-screen', viewerScreenStream);
  }
  node.appendChild(video);

  const overlay = document.createElement('div');
  overlay.className = 'builder-camera-overlay';
  if (!viewerScreenStream) {
    const emptyState = document.createElement('div');
    emptyState.className = 'builder-camera-empty';
    const title = document.createElement('strong');
    title.textContent = 'Aguardando tela do professor';
    const text = document.createElement('span');
    text.textContent = 'A transmissão de tela será iniciada em breve.';
    emptyState.append(title, text);
    overlay.appendChild(emptyState);
  } else {
    overlay.style.display = 'none';
  }
  node.appendChild(overlay);
  return node;
};

const normalizeAudioElement = (element) => {
  if (!element || element.type !== 'audio') {
    return;
  }
  normalizeMediaCaptionConfig(element, 'audio');
  element.audioVisible = typeof element.audioVisible === 'boolean' ? element.audioVisible : true;
  element.audioLoop = Boolean(element.audioLoop);
  element.collectStudentAudio = Boolean(element.collectStudentAudio);
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
  element.successMessage = typeof element.successMessage === 'string' && element.successMessage ? element.successMessage : 'Resposta enviada com sucesso.';
  element.errorMessage = typeof element.errorMessage === 'string' && element.errorMessage ? element.errorMessage : 'A palavra não confere. Tente novamente.';
  element.allowImage = typeof element.allowImage === 'boolean' ? element.allowImage : true;
  element.allowAudio = typeof element.allowAudio === 'boolean' ? element.allowAudio : true;
  element.backgroundColor = typeof element.backgroundColor === 'string' ? element.backgroundColor : '#ffffff';
  element.labelColor = typeof element.labelColor === 'string' ? element.labelColor : '#9ca3af';
  element.inputTextColor = typeof element.inputTextColor === 'string' ? element.inputTextColor : '#0f142c';
  element.submitButtonColor = typeof element.submitButtonColor === 'string' ? element.submitButtonColor : '#6d63ff';
  element.submitButtonTextColor = typeof element.submitButtonTextColor === 'string' ? element.submitButtonTextColor : '#ffffff';
  const defaultHeight = 88;
  const minHeight = 76;
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
    mediaNode.sandbox = 'allow-scripts allow-same-origin allow-presentation';
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

const KEY_TRIGGER_ALIAS_MAP = {
  ' ': 'space',
  spacebar: 'space',
  space: 'space',
  arrowleft: 'arrowleft',
  left: 'arrowleft',
  a: 'a',
  arrowright: 'arrowright',
  right: 'arrowright',
  d: 'd',
  arrowup: 'arrowup',
  up: 'arrowup',
  w: 'w',
  arrowdown: 'arrowdown',
  down: 'arrowdown',
  s: 's',
  enter: 'enter',
  return: 'enter',
  escape: 'escape',
  esc: 'escape'
};

const KEY_TRIGGER_DIRECTION_MAP = {
  arrowleft: 'left',
  a: 'left',
  arrowright: 'right',
  d: 'right',
  arrowup: 'up',
  w: 'up',
  arrowdown: 'down',
  s: 'down'
};

const normalizeKeyBindingToken = (value = '') => {
  const compact = String(value || '').trim().toLowerCase();
  if (!compact) {
    return '';
  }
  return KEY_TRIGGER_ALIAS_MAP[compact] || compact.replace(/\s+/g, '');
};

const normalizeKeyBindingList = (value) => {
  const source = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[,\n]+/)
      .map((item) => item.trim());
  return Array.from(
    new Set(
      source
        .map((item) => normalizeKeyBindingToken(item))
        .filter(Boolean)
    )
  );
};

const formatKeyBindingLabel = (binding = '') => {
  const normalized = normalizeKeyBindingToken(binding);
  if (!normalized) {
    return '';
  }
  if (normalized === 'space') return 'SPACE';
  if (normalized === 'arrowleft') return 'ARROW LEFT';
  if (normalized === 'arrowright') return 'ARROW RIGHT';
  if (normalized === 'arrowup') return 'ARROW UP';
  if (normalized === 'arrowdown') return 'ARROW DOWN';
  return normalized.toUpperCase();
};

const formatKeyBindingSummary = (bindings = []) => normalizeKeyBindingList(bindings).map((item) => formatKeyBindingLabel(item)).join(' / ');

const getTriggerKeyBindings = (trigger) => normalizeKeyBindingList(trigger?.keys ?? trigger?.keyBindings ?? trigger?.keyBinding ?? trigger?.key ?? []);

const isKeyTriggerVisible = (trigger) => Boolean(trigger?.visibleKey ?? trigger?.showKey ?? trigger?.keyVisible);

const normalizeKeyboardEventBinding = (event) => normalizeKeyBindingToken(event?.key || event?.code || '');

const getKeyTriggerDirection = (trigger) => {
  const config = trigger?.actionConfig || {};
  if ((config.type || 'none') !== 'moveElement') {
    return '';
  }
  const moveX = Number(config.moveByX) || 0;
  const moveY = Number(config.moveByY) || 0;
  if (moveX < 0 && moveY === 0) return 'left';
  if (moveX > 0 && moveY === 0) return 'right';
  if (moveX === 0 && moveY < 0) return 'up';
  if (moveX === 0 && moveY > 0) return 'down';
  const firstBinding = getTriggerKeyBindings(trigger)[0] || '';
  return KEY_TRIGGER_DIRECTION_MAP[firstBinding] || '';
};

const triggerMatchesKeyboardBinding = (trigger, binding) =>
  Boolean(binding) && getTriggerKeyBindings(trigger).includes(binding);

const normalizeInteractionTriggers = (element) => {
  if (!element || !['floatingButton', 'detector', 'timedTrigger', 'input', 'key'].includes(element.type)) {
    return [];
  }
  const sourceTriggers = Array.isArray(element.interactionTriggers) ? element.interactionTriggers : [];
  const legacyConfig = element.actionConfig && typeof element.actionConfig === 'object' ? element.actionConfig : {};
  element.interactionTriggers = (sourceTriggers.length ? sourceTriggers : [{ actionConfig: legacyConfig }]).map((trigger, index) => ({
    id: typeof trigger?.id === 'string' && trigger.id.trim() ? trigger.id.trim() : `${element.id || element.type}-trigger-${index + 1}`,
    name:
      typeof trigger?.name === 'string' && trigger.name.trim()
        ? trigger.name.trim()
        : `${element.type === 'detector' ? 'Gatilho' : element.type === 'timedTrigger' ? 'Tempo' : element.type === 'input' ? 'Envio' : element.type === 'key' ? 'Tecla' : 'Acao'} ${index + 1}`,
    enabled: typeof trigger?.enabled === 'boolean' ? trigger.enabled : true,
    time: Math.max(0, Number(trigger?.time ?? trigger?.triggerTime) || 0),
    keys: getTriggerKeyBindings(trigger),
    visibleKey: element.type === 'key' ? isKeyTriggerVisible(trigger) : false,
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

const normalizeKeyElement = (element) => {
  if (!element || element.type !== 'key') {
    return;
  }
  element.width = Math.max(140, Number(element.width) || 220);
  element.height = Math.max(72, Number(element.height) || 86);
  element.shape = element.shape || 'rectangle';
  element.fontSize = Math.max(12, Number(element.fontSize) || 18);
  element.fontFamily = element.fontFamily || 'Inter, sans-serif';
  element.fontWeight = element.fontWeight || '700';
  element.useGradient = Boolean(element.useGradient);
  element.backgroundColor = element.backgroundColor || '#2563eb';
  element.solidColor = element.solidColor || element.backgroundColor || '#2563eb';
  element.textColor = element.textColor || '#ffffff';
  normalizeInteractionTriggers(element);
  if (!(element.interactionTriggers || []).some((trigger) => getTriggerKeyBindings(trigger).length)) {
    if (!Array.isArray(element.interactionTriggers) || !element.interactionTriggers.length) {
      element.interactionTriggers = [
        {
          id: `${element.id || 'key'}-trigger-1`,
          name: 'Tecla 1',
          enabled: true,
          time: 0,
          keys: ['space'],
          visibleKey: false,
          actionConfig: normalizeRuntimeActionConfig(createDefaultActionConfig())
        }
      ];
    } else {
      element.interactionTriggers[0].keys = ['space'];
    }
    element.actionConfig = element.interactionTriggers[0]?.actionConfig || normalizeRuntimeActionConfig(createDefaultActionConfig());
  }
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

const persistCameraCaptureToBackend = async ({ module, slide, element, image = '', video = '' }) => {
  if (viewerState.isPublic || isReplayMode() || !module?.courseId || !slide || !element?.id) {
    return { ok: false };
  }
  const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
  const payload = {
    key: getInputResponseKey(module.id, slideKey, element.id),
    moduleId: module.id,
    moduleTitle: module.title,
    slideId: slideKey,
    slideTitle: slide?.title || '',
    elementId: element.id,
    elementType: 'camera',
    text: '',
    image,
    audio: '',
    video,
    matched: true
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
          type: 'camera_capture',
          slideId: payload.slideId,
          slideTitle: payload.slideTitle,
          elementId: element.id,
          elementType: 'camera',
          summary: video
            ? `Gravou um video na camera em "${slide?.title || payload.slideId}".`
            : `Tirou uma foto na camera em "${slide?.title || payload.slideId}".`,
          details: {
            matched: true,
            hasImage: Boolean(image),
            hasAudio: false,
            hasVideo: Boolean(video),
            mediaType: video ? 'video' : 'image',
            mediaUrl: video || image || ''
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
    console.error('Nao foi possivel salvar a captura da camera.', error);
  }
  return { ok: false };
};

const syncViewerFloatingRuleButtonState = (module, slide, elementId) => {
  if (!slide || !elementId) {
    return;
  }
  const element = slide.elements?.find((item) => item?.id === elementId && ['floatingButton', 'key'].includes(item.type));
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
  if (element.type === 'floatingButton') {
    node.classList.toggle('floating-button-completed', isCompleted);
  }
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
  if (!module?.builder_data?.moduleSettings?.requireQuizCompletion) {
    return true;
  }
  const quizzes = (slide?.elements || []).filter((element) => element.type === 'quiz');
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
    if (!['floatingButton', 'key'].includes(item?.type) || !item?.id) {
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

const persistInputResponseToBackendLegacy = async ({ module, slide, element, response, matched }) => {
  if (viewerState.isPublic || isReplayMode() || !module?.courseId || !element?.id || !slide || !response) {
    return { ok: false };
  }
  const inputKey = getInputResponseKey(module.id, getStableSlideKey(slide, viewerState.slideIndex), element.id);
  const isAudioCapture = element?.type === 'audio';
  const payload = {
    key: inputKey,
    moduleId: module.id,
    moduleTitle: module.title,
    slideId: getStableSlideKey(slide, viewerState.slideIndex),
    slideTitle: slide?.title || '',
    elementId: element.id,
    elementType: isAudioCapture ? 'audio' : 'input',
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
          type: isAudioCapture ? 'audio_input' : 'text_input',
          slideId: payload.slideId,
          slideTitle: payload.slideTitle,
          elementId: element.id,
          elementType: isAudioCapture ? 'audio' : 'input',
          summary: isAudioCapture
            ? `Enviou uma resposta válida em "${slide?.title || payload.slideId}".`
            : `Enviou uma resposta que ainda não corresponde ao esperado em "${slide?.title || payload.slideId}".`,
          details: {
            submittedText: response.text || '',
            matched,
            hasImage: Boolean(response.image),
            hasAudio: Boolean(response.audio),
            mediaType: response.audio ? 'audio' : null,
            mediaUrl: response.audio || null
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

const persistInputResponseToBackend = async ({ module, slide, element, response, matched }) => {
  if (viewerState.isPublic || isReplayMode() || !module?.courseId || !element?.id || !slide || !response) {
    return { ok: false };
  }
  const inputKey = getInputResponseKey(module.id, getStableSlideKey(slide, viewerState.slideIndex), element.id);
  const isAudioCapture = element?.type === 'audio';
  const payload = {
    key: inputKey,
    moduleId: module.id,
    moduleTitle: module.title,
    slideId: getStableSlideKey(slide, viewerState.slideIndex),
    slideTitle: slide?.title || '',
    elementId: element.id,
    elementType: isAudioCapture ? 'audio' : 'input',
    text: response.text || '',
    image: response.image || '',
    audio: response.audio || '',
    matched
  };
  const progressSummary = isAudioCapture
    ? `Enviou um audio em "${slide?.title || payload.slideId}".`
    : matched
      ? `Enviou uma resposta valida em "${slide?.title || payload.slideId}".`
      : `Enviou uma resposta que ainda nao corresponde ao esperado em "${slide?.title || payload.slideId}".`;
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
          type: isAudioCapture ? 'audio_input' : 'text_input',
          slideId: payload.slideId,
          slideTitle: payload.slideTitle,
          elementId: element.id,
          elementType: isAudioCapture ? 'audio' : 'input',
          summary: progressSummary,
          details: {
            submittedText: response.text || '',
            matched,
            hasImage: Boolean(response.image),
            hasAudio: Boolean(response.audio),
            mediaType: response.audio ? 'audio' : null,
            mediaUrl: response.audio || null
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
    console.error('Nao foi possivel salvar a resposta do input.', error);
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

const getStudioMicIconMarkup = () => `
  <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="M32 7c-6.1 0-11 4.9-11 11v15c0 6.1 4.9 11 11 11s11-4.9 11-11V18c0-6.1-4.9-11-11-11Z" fill="currentColor"/>
    <path d="M15 29a3 3 0 0 1 6 0v4c0 6.1 4.9 11 11 11s11-4.9 11-11v-4a3 3 0 0 1 6 0v4c0 8.3-6 15.2-14 16.7V55h7a3 3 0 1 1 0 6H22a3 3 0 1 1 0-6h7v-5.3c-8-1.5-14-8.4-14-16.7v-4Z" fill="currentColor"/>
    <path d="M27 18a2 2 0 0 1 2-2h6a2 2 0 1 1 0 4h-6a2 2 0 0 1-2-2Zm0 8a2 2 0 0 1 2-2h6a2 2 0 1 1 0 4h-6a2 2 0 0 1-2-2Zm0 8a2 2 0 0 1 2-2h6a2 2 0 1 1 0 4h-6a2 2 0 0 1-2-2Z" fill="#fff" opacity=".9"/>
  </svg>
`;

const createAudioCaptureElementNode = (element, slide) => {
  normalizeAudioElement(element);
  const module = getCurrentModule();
  const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
  const savedResponse = module?.id ? getInputResponseState(module.id, slideKey, element.id, module) : null;
  const isStaticMode = isReplayMode();
  const node = document.createElement('div');
  node.className = 'builder-input-element builder-audio-capture-element';
  node.innerHTML = `
    <button type="button" class="builder-audio-capture-btn" aria-label="Gravar audio" title="Gravar audio">
      ${getStudioMicIconMarkup()}
    </button>
    <input class="builder-input-audio-file hidden" type="file" accept="audio/*" />
    <div class="builder-input-preview hidden"></div>
    <div class="builder-input-feedback" aria-live="polite"></div>
  `;
  const mainButton = node.querySelector('.builder-audio-capture-btn');
  const audioInput = node.querySelector('.builder-input-audio-file');
  const previewNode = node.querySelector('.builder-input-preview');
  const feedbackNode = node.querySelector('.builder-input-feedback');
  const state = {
    audio: savedResponse?.audio || ''
  };
  const audioCaptureState = {
    recorder: null,
    stream: null,
    chunks: [],
    stopPromise: null,
    preferFileFallback: false
  };
  const setFileInputValue = (control, value = '') => {
    if (control instanceof HTMLInputElement) {
      control.value = value;
    }
  };
  const setFeedback = (message = '', tone = '') => {
    if (!feedbackNode) {
      return;
    }
    feedbackNode.textContent = message;
    feedbackNode.className = tone ? `builder-input-feedback ${tone}` : 'builder-input-feedback';
  };
  const refreshPreview = () => {
    if (!previewNode) {
      return;
    }
    const hasAudio = Boolean(state.audio);
    previewNode.innerHTML = hasAudio
      ? `<audio controls src="${state.audio}" class="builder-input-preview-audio"></audio>`
      : '';
    previewNode.classList.toggle('hidden', !hasAudio);
    if (mainButton instanceof HTMLButtonElement) {
      mainButton.classList.toggle('is-ready', hasAudio);
      mainButton.title = hasAudio
        ? (isStaticMode ? 'Ouvir audio enviado' : 'Gravar novamente')
        : 'Gravar audio';
      mainButton.setAttribute('aria-label', mainButton.title);
      mainButton.disabled = isStaticMode ? !hasAudio : false;
    }
  };
  const stopAudioStream = () => {
    if (audioCaptureState.stream instanceof MediaStream) {
      audioCaptureState.stream.getTracks().forEach((track) => track.stop());
    }
    audioCaptureState.stream = null;
  };
  const resetAudioCaptureState = () => {
    audioCaptureState.recorder = null;
    audioCaptureState.chunks = [];
    audioCaptureState.stopPromise = null;
    stopAudioStream();
  };
  const updateAudioButtonState = () => {
    if (!(mainButton instanceof HTMLButtonElement)) {
      return;
    }
    const isRecording = Boolean(audioCaptureState.recorder && audioCaptureState.recorder.state === 'recording');
    mainButton.classList.toggle('is-recording', isRecording);
    mainButton.disabled = isStaticMode && !state.audio;
    mainButton.title = isRecording ? 'Parar gravacao' : state.audio ? 'Gravar novamente' : 'Gravar audio';
    mainButton.setAttribute('aria-label', mainButton.title);
  };
  const getAudioRecorderMimeType = () => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    return (
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((candidate) =>
        MediaRecorder.isTypeSupported(candidate)
      ) || ''
    );
  };
  const stopAudioRecording = async () => {
    const recorder = audioCaptureState.recorder;
    const stopPromise = audioCaptureState.stopPromise;
    if (!recorder || !stopPromise) {
      return;
    }
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    await stopPromise;
    const audioBlob = new Blob(audioCaptureState.chunks, { type: recorder.mimeType || 'audio/webm' });
    resetAudioCaptureState();
    updateAudioButtonState();
    if (!audioBlob.size) {
      setFeedback('Nao foi possivel preparar o audio gravado.', 'error');
      return;
    }
    state.audio = await readBlobAsDataUrl(audioBlob).catch(() => '');
    refreshPreview();
    setFeedback(state.audio ? 'Audio gravado e pronto para enviar.' : 'Nao foi possivel preparar o audio gravado.', state.audio ? '' : 'error');
    if (state.audio && !isStaticMode) {
      await saveCapturedAudio();
    }
  };
  const startAudioRecording = async () => {
    if (
      isStaticMode ||
      audioCaptureState.preferFileFallback ||
      typeof MediaRecorder === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setFeedback(
        audioCaptureState.preferFileFallback
          ? 'Selecione um arquivo de audio para enviar.'
          : 'Seu navegador nao liberou gravacao direta. Selecione um audio para enviar.',
        audioCaptureState.preferFileFallback ? '' : 'error'
      );
      setFileInputValue(audioInput);
      audioInput?.click();
      return;
    }
    setFeedback('Solicitando permissao do microfone...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getAudioRecorderMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    audioCaptureState.stream = stream;
    audioCaptureState.recorder = recorder;
    audioCaptureState.chunks = [];
    audioCaptureState.stopPromise = new Promise((resolve, reject) => {
      recorder.addEventListener('stop', resolve, { once: true });
      recorder.addEventListener('error', () => reject(new Error('Nao foi possivel gravar o audio.')), { once: true });
    });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioCaptureState.chunks.push(event.data);
      }
    };
    recorder.start(200);
    updateAudioButtonState();
    setFeedback('Gravando audio. Clique novamente para parar.');
  };
  refreshPreview();
  updateAudioButtonState();
  if (savedResponse?.audio) {
    setFeedback(isStaticMode ? 'Audio enviado pelo aluno.' : 'Ja existe um audio salvo para este elemento.');
  } else if (isStaticMode) {
    setFeedback('Nenhum audio registrado neste elemento.');
  }
  let lastAudioCaptureTapAt = 0;
  const handleAudioCaptureTap = async (event) => {
    const target = event?.target;
    if (target instanceof Element && target.closest('audio')) {
      return;
    }
    event?.stopPropagation?.();
    const now = Date.now();
    if (now - lastAudioCaptureTapAt < 250) {
      return;
    }
    lastAudioCaptureTapAt = now;
    if (isStaticMode) {
      const previewAudio = previewNode?.querySelector('audio');
      if (previewAudio instanceof HTMLAudioElement) {
        previewAudio.play().catch(() => {});
      }
      return;
    }
    try {
      if (audioCaptureState.recorder && audioCaptureState.recorder.state === 'recording') {
        await stopAudioRecording();
        return;
      }
      await startAudioRecording();
    } catch (error) {
      resetAudioCaptureState();
      updateAudioButtonState();
      if (isMissingAudioInputDeviceError(error)) {
        audioCaptureState.preferFileFallback = true;
        setFeedback(formatAudioAccessError(error), 'error');
        setFileInputValue(audioInput);
        audioInput?.click();
        return;
      }
      setFeedback(formatAudioAccessError(error), 'error');
    }
  };
  ['pointerdown', 'mousedown', 'touchend', 'click'].forEach((eventName) => {
    node.addEventListener(eventName, handleAudioCaptureTap, { capture: true });
    mainButton?.addEventListener(eventName, handleAudioCaptureTap, { capture: true });
  });
  audioInput?.addEventListener('change', async () => {
    if (isStaticMode) return;
    const file = audioInput.files?.[0];
    if (!file) return;
    state.audio = await readLocalFileAsDataUrl(file).catch(() => '');
    setFileInputValue(audioInput);
    refreshPreview();
    setFeedback(state.audio ? 'Audio pronto para enviar.' : 'Nao foi possivel preparar o audio.', state.audio ? '' : 'error');
    if (state.audio) {
      await saveCapturedAudio();
    }
  });
  if (isStaticMode) {
    return node;
  }
  async function saveCapturedAudio() {
    if (audioCaptureState.recorder && audioCaptureState.recorder.state === 'recording') {
      setFeedback('Finalize a gravacao do audio antes de enviar.', 'error');
      return;
    }
    if (!state.audio) {
      setFeedback('Grave ou anexe um audio antes de enviar.', 'error');
      return;
    }
    await persistInputResponseToBackend({
      module,
      slide,
      element: { ...element, type: 'audio' },
      response: {
        text: '',
        audio: state.audio
      },
      matched: true
    });
    setFeedback('Audio enviado com sucesso.', 'success');
  }
  return node;
};

const createInputElementNode = (element, slide, { runActions = null } = {}) => {
  normalizeInputElement(element);
  normalizeInteractionTriggers(element);
  const module = getCurrentModule();
  const slideKey = getStableSlideKey(slide, viewerState.slideIndex);
  const savedResponse = module?.id ? getInputResponseState(module.id, slideKey, element.id, module) : null;
  const isStaticMode = isReplayMode();
  const inputBgColor = element.backgroundColor || '#ffffff';
  const inputTextColor = element.inputTextColor || '#0f142c';
  const placeholderColor = element.labelColor || '#9ca3af';
  const buttonBgColor = element.submitButtonColor || '#6d63ff';
  const buttonTextColor = element.submitButtonTextColor || '#ffffff';
  const node = document.createElement('div');
  node.className = 'builder-input-element';
  node.innerHTML = `
    <div class="builder-input-composer">
      <div class="builder-input-composer-main">
        <textarea class="builder-input-text" style="background-color: ${inputBgColor}; color: ${inputTextColor}; --placeholder-color: ${placeholderColor};" placeholder="${escapeHtml(element.placeholder || 'Digite sua resposta')}"></textarea>
      </div>
      <div class="builder-input-composer-actions ${isStaticMode ? 'hidden' : ''}">
        <button type="button" class="secondary-btn builder-input-upload builder-input-upload-icon builder-input-image-btn ${element.allowImage ? '' : 'hidden'}" aria-label="Anexar imagem" title="Anexar imagem">+</button>
        <button type="button" class="secondary-btn builder-input-upload builder-input-upload-icon builder-input-audio-btn ${element.allowAudio ? '' : 'hidden'}" aria-label="Anexar audio" title="Anexar audio">Mic</button>
        <button type="button" class="primary-btn builder-input-submit" style="background-color: ${buttonBgColor}; color: ${buttonTextColor};" aria-label="${escapeAttribute(element.submitLabel || 'Enviar resposta')}" title="${escapeAttribute(element.submitLabel || 'Enviar resposta')}">
          <span class="builder-input-submit-icon" aria-hidden="true">➤</span>
        </button>
      </div>
    </div>
    <input class="builder-input-image-file hidden" type="file" accept="image/*" capture="environment" />
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
    image: savedResponse?.image || '',
    audio: savedResponse?.audio || ''
  };
  const audioCaptureState = {
    recorder: null,
    stream: null,
    chunks: [],
    stopPromise: null
  };
  const setFileInputValue = (control, value = '') => {
    if (control instanceof HTMLInputElement) {
      control.value = value;
    }
  };
  const setFeedback = (message = '', tone = '') => {
    if (!feedbackNode) {
      return;
    }
    feedbackNode.textContent = message;
    feedbackNode.className = tone ? `builder-input-feedback ${tone}` : 'builder-input-feedback';
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
  const stopAudioStream = () => {
    if (audioCaptureState.stream instanceof MediaStream) {
      audioCaptureState.stream.getTracks().forEach((track) => track.stop());
    }
    audioCaptureState.stream = null;
  };
  const resetAudioCaptureState = () => {
    audioCaptureState.recorder = null;
    audioCaptureState.chunks = [];
    audioCaptureState.stopPromise = null;
    stopAudioStream();
  };
  const updateAudioButtonState = () => {
    if (!(audioBtn instanceof HTMLButtonElement)) {
      return;
    }
    const isRecording = Boolean(audioCaptureState.recorder && audioCaptureState.recorder.state === 'recording');
    audioBtn.textContent = isRecording ? 'Parar' : 'Mic';
    audioBtn.classList.toggle('is-recording', isRecording);
    audioBtn.disabled = !element.allowAudio || isStaticMode;
  };
  const getAudioRecorderMimeType = () => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    return (
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((candidate) =>
        MediaRecorder.isTypeSupported(candidate)
      ) || ''
    );
  };
  const stopAudioRecording = async () => {
    const recorder = audioCaptureState.recorder;
    const stopPromise = audioCaptureState.stopPromise;
    if (!recorder || !stopPromise) {
      return;
    }
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    await stopPromise;
    const audioBlob = new Blob(audioCaptureState.chunks, { type: recorder.mimeType || 'audio/webm' });
    resetAudioCaptureState();
    updateAudioButtonState();
    if (!audioBlob.size) {
      setFeedback('Nao foi possivel preparar o audio gravado.', 'error');
      return;
    }
    state.audio = await readBlobAsDataUrl(audioBlob).catch(() => '');
    refreshPreview();
    setFeedback(state.audio ? 'Audio gravado e pronto para enviar.' : 'Nao foi possivel preparar o audio gravado.', state.audio ? '' : 'error');
  };
  const startAudioRecording = async () => {
    if (
      isStaticMode ||
      !element.allowAudio ||
      typeof MediaRecorder === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setFileInputValue(audioInput);
      audioInput?.click();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getAudioRecorderMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    audioCaptureState.stream = stream;
    audioCaptureState.recorder = recorder;
    audioCaptureState.chunks = [];
    audioCaptureState.stopPromise = new Promise((resolve, reject) => {
      recorder.addEventListener('stop', resolve, { once: true });
      recorder.addEventListener('error', () => reject(new Error('Nao foi possivel gravar o audio.')), { once: true });
    });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioCaptureState.chunks.push(event.data);
      }
    };
    recorder.start(200);
    updateAudioButtonState();
    setFeedback('Gravando audio. Clique novamente para parar.');
  };
  if (textArea instanceof HTMLTextAreaElement) {
    textArea.value = savedResponse?.text || '';
  }
  refreshPreview();
  if (savedResponse) {
    if (savedResponse.matched === true) {
      setFeedback(element.successMessage, 'success');
    } else if (savedResponse.matched === false) {
      setFeedback(element.errorMessage, 'error');
    }
  } else if (isStaticMode) {
    setFeedback('Nenhuma resposta registrada neste input.');
  }
  updateAudioButtonState();
  imageBtn?.addEventListener('click', () => {
    if (isStaticMode) {
      return;
    }
    setFileInputValue(imageInput);
    imageInput?.click();
  });
  audioBtn?.addEventListener('click', async () => {
    if (isStaticMode) {
      return;
    }
    try {
      if (audioCaptureState.recorder && audioCaptureState.recorder.state === 'recording') {
        await stopAudioRecording();
        return;
      }
      await startAudioRecording();
    } catch (error) {
      resetAudioCaptureState();
      updateAudioButtonState();
      setFeedback(error?.message || 'Nao foi possivel acessar o microfone.', 'error');
    }
  });
  imageInput?.addEventListener('change', async () => {
    if (isStaticMode) return;
    const file = imageInput.files?.[0];
    if (!file) return;
    state.image = await readLocalFileAsDataUrl(file).catch(() => '');
    setFileInputValue(imageInput);
    refreshPreview();
    setFeedback(state.image ? 'Imagem pronta para enviar.' : 'Nao foi possivel preparar a imagem.', state.image ? '' : 'error');
  });
  audioInput?.addEventListener('change', async () => {
    if (isStaticMode) return;
    const file = audioInput.files?.[0];
    if (!file) return;
    state.audio = await readLocalFileAsDataUrl(file).catch(() => '');
    setFileInputValue(audioInput);
    refreshPreview();
    setFeedback(state.audio ? 'Audio pronto para enviar.' : 'Nao foi possivel preparar o audio.', state.audio ? '' : 'error');
  });
  if (isStaticMode) {
    node.classList.add('is-static');
    if (textArea instanceof HTMLTextAreaElement) {
      textArea.readOnly = true;
      textArea.tabIndex = -1;
    }
    if (submitBtn instanceof HTMLButtonElement) {
      submitBtn.disabled = true;
      submitBtn.tabIndex = -1;
    }
    return node;
  }
  submitBtn?.addEventListener('click', async () => {
    if (!(textArea instanceof HTMLTextAreaElement) || !(submitBtn instanceof HTMLButtonElement)) {
      return;
    }
    if (audioCaptureState.recorder && audioCaptureState.recorder.state === 'recording') {
      setFeedback('Finalize a gravacao do audio antes de enviar.', 'error');
      return;
    }
    const submittedText = textArea instanceof HTMLTextAreaElement ? textArea.value : '';
    const expected = normalizeInputCompareValue(element.compareText || '', Boolean(element.compareCaseSensitive));
    const received = normalizeInputCompareValue(submittedText, Boolean(element.compareCaseSensitive));
    const textMatched = !expected || received === expected;
    const matched = textMatched;
    setFeedback(matched ? element.successMessage : element.errorMessage, matched ? 'success' : 'error');
    await persistInputResponseToBackend({
      module,
      slide,
      element,
      response: {
        text: submittedText,
        image: state.image,
        audio: state.audio
      },
      matched
    });
    if (matched && typeof runActions === 'function') {
      runActions({
        text: submittedText,
        image: state.image,
        audio: state.audio,
        matched,
        textMatched
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
  const stageOrientationPrompt = stageShell?.querySelector('.orientation-prompt:not(.hidden)');
  const shellWidth = stageShell?.clientWidth || moduleStage.parentElement?.clientWidth || safeSize.width;
  const shellHeight = stageShell?.clientHeight || window.innerHeight;
  const isFullscreen = document.fullscreenElement === stageShell;
  const isMobilePortraitLayout = Boolean(stageShell?.classList.contains('mobile-portrait-layout'));
  const headerHeight = (isFullscreen && !isMobilePortraitLayout) ? 0 : (stageHeader?.offsetHeight || 0);
  const promptHeight = isMobilePortraitLayout ? (stageOrientationPrompt?.offsetHeight || 0) : 0;
  const horizontalPadding = isFullscreen ? 8 : 0;
  const verticalGap = isFullscreen ? (isMobilePortraitLayout ? 16 : 8) : 36;
  const availableWidth = Math.max(320, shellWidth - horizontalPadding);
  const viewportLimit = Math.max(
    320,
    isFullscreen
      ? shellHeight - headerHeight - promptHeight - verticalGap
      : Math.min(shellHeight - headerHeight - promptHeight - 24, window.innerHeight - 260)
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
  if (viewerResizeSyncFrame != null) {
    cancelAnimationFrame(viewerResizeSyncFrame);
  }
  viewerResizeSyncFrame = requestAnimationFrame(() => {
    viewerResizeSyncFrame = requestAnimationFrame(() => {
      viewerResizeSyncFrame = null;
      performStageScaleUpdate();
    });
  });
};

const performStageScaleUpdate = () => {
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
  
  // Evita loops infinitos se a mudanca for insignificante (menos de 0.1%)
  if (viewerStageZoomState.baseScale && Math.abs(viewerStageZoomState.baseScale - scale) < 0.001) {
    return;
  }

  viewerStageZoomState.baseScale = scale;
  const baseOffset = getViewerStageBaseOffset();
  wrapper.style.left = `${baseOffset.left}px`;
  wrapper.style.top = `${baseOffset.top}px`;
  moduleStage.style.setProperty('--module-stage-aspect', `${size.width} / ${size.height}`);
  applyViewerStageZoomTransform();
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

const getCurrentModule = () => {
  if (isLiveShareMode()) {
    return viewerModules[0] || null;
  }
  if (viewerState.moduleId) {
    const found = viewerModules.find((mod) => mod.id === viewerState.moduleId);
    if (found) return found;
  }
  return viewerModules[viewerState.moduleIndex || 0] || null;
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
  if (['audio', 'video'].includes(element.type) && !(element.type === 'audio' && element.collectStudentAudio)) {
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
  viewerState.penToolActive = false;
  viewerState.penSettingsTouched = false;
  resetViewerStageZoom();
  destroyViewerPenOverlay();
  stopViewerLiveCursorSync();
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
  updateViewerPenToolState(null);
};

const syncViewerToLiveShareSlide = (module) => {
  const activeSlideId = module?.liveShare?.activeSlideId;
  const slides = Array.isArray(module?.builder_data?.slides) ? module.builder_data.slides : [];
  if (!activeSlideId || !slides.length) {
    return;
  }
  const activeIndex = slides.findIndex((slide) => slide?.id === activeSlideId);
  if (activeIndex >= 0) {
    viewerState.slideIndex = activeIndex;
  }
};

let viewerCameraPeer = null;
let viewerCameraMediaConn = null;
let viewerCameraStream = null;

let viewerScreenPeer = null;
let viewerScreenMediaConn = null;
let viewerScreenStream = null;

let studentCameraPeer = null;
let studentCameraPeerId = null;
let studentCameraLocalStream = null;
let studentCameraAudioMuted = false;
let studentCameraVideoMuted = false;
let studentCameraRequestUiState = 'idle';
let studentCameraApprovalRetryKey = '';
let studentCameraApprovalRetryTimer = null;
const STUDENT_CAMERA_REQUEST_PREFIX = 'liveStudentCameraRequested:';
const viewerStudentStreams = new Map();
const studentPeerRefs = new Map();
const liveRemoteAudioRefs = new Map();

const syncLiveRemoteAudio = (key, stream, { muted = false } = {}) => {
  if (!key || !(stream instanceof MediaStream)) return;
  let audio = liveRemoteAudioRefs.get(key);
  if (!(audio instanceof HTMLAudioElement)) {
    audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    liveRemoteAudioRefs.set(key, audio);
  }
  if (audio.srcObject !== stream) {
    audio.srcObject = stream;
  }
  audio.muted = Boolean(muted);
  audio.play().catch(() => {});
};

const removeLiveRemoteAudio = (key) => {
  const audio = liveRemoteAudioRefs.get(key);
  if (audio instanceof HTMLAudioElement) {
    audio.pause();
    audio.srcObject = null;
    audio.remove();
  }
  liveRemoteAudioRefs.delete(key);
};

const clearLiveRemoteAudio = () => {
  Array.from(liveRemoteAudioRefs.keys()).forEach((key) => removeLiveRemoteAudio(key));
};

const connectViewerPeer = (peerId, onStream, peerRef, mediaConnRef) => {
  if (peerRef.current && !peerRef.current.disconnected && mediaConnRef.current?.peer === peerId) return;
  if (peerRef.current) peerRef.current.destroy();
  const peer = new Peer();
  peerRef.current = peer;
  peer.on('open', () => {
    mediaConnRef.current = peer.connect(peerId);
  });
  peer.on('call', (call) => {
    call.answer();
    call.on('stream', onStream);
  });
  peer.on('error', (err) => console.warn('PeerJS viewer error:', err));
};

// Wrapper refs for mutable peer references
const cameraPeerRef = { current: null };
const cameraConnRef = { current: null };
const screenPeerRef = { current: null };
const screenConnRef = { current: null };

const syncLiveScreenShare = (cameraPeerId, screenPeerId) => {
  // --- Camera ---
  if (!cameraPeerId) {
    viewerCameraStream = null;
    removeLiveRemoteAudio('teacher-camera');
    if (cameraPeerRef.current) { cameraPeerRef.current.destroy(); cameraPeerRef.current = null; }
    cameraConnRef.current = null;
  } else {
    connectViewerPeer(cameraPeerId,
      (stream) => {
        viewerCameraStream = stream;
        syncLiveRemoteAudio('teacher-camera', stream);
        if (viewerModules?.length > 0) renderSlide(getCurrentSlide());
      },
      cameraPeerRef, cameraConnRef
    );
  }
  // --- Screen ---
  if (!screenPeerId) {
    viewerScreenStream = null;
    removeLiveRemoteAudio('teacher-screen');
    if (screenPeerRef.current) { screenPeerRef.current.destroy(); screenPeerRef.current = null; }
    screenConnRef.current = null;
  } else {
    connectViewerPeer(screenPeerId,
      (stream) => {
        viewerScreenStream = stream;
        syncLiveRemoteAudio('teacher-screen', stream);
        if (viewerModules?.length > 0) renderSlide(getCurrentSlide());
      },
      screenPeerRef, screenConnRef
    );
  }
  // Re-render after clearing streams
  if (!cameraPeerId && !screenPeerId && viewerModules?.length > 0) renderSlide(getCurrentSlide());
};

const applyLiveStageModule = (module) => {
  if (!module) {
    return;
  }
  
  const oldDataStr = JSON.stringify(viewerModules?.[0]?.builder_data || {});
  const newDataStr = JSON.stringify(module?.builder_data || {});
  const dataChanged = oldDataStr !== newDataStr;
  
  const oldSlideId = getCurrentSlide()?.id;
  const newSlideId = module?.liveShare?.activeSlideId;
  const slideChanged = oldSlideId !== newSlideId;

  viewerModules = [module];
  viewerState.moduleId = module.id;
  viewerState.courseId = module.courseId;
  viewerState.liveShareRevision = Number(module.liveShare?.revision) || viewerState.liveShareRevision || 0;

  const currentSessionUser = getCurrentSessionUser();
  const currentUserId = String(currentSessionUser?.id || '').trim();
  const currentUserName = String(currentSessionUser?.fullName || '').trim();
  const disconnectedStudentIds = Array.isArray(module?.builder_data?.disconnectedStudentIds)
    ? module.builder_data.disconnectedStudentIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const disconnectedStudentNames = Array.isArray(module?.builder_data?.disconnectedStudentNames)
    ? module.builder_data.disconnectedStudentNames.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  const wasDisconnectedByTeacher =
    (currentUserId && disconnectedStudentIds.includes(currentUserId)) ||
    (currentUserName && disconnectedStudentNames.includes(currentUserName));
  if (
    wasDisconnectedByTeacher &&
    studentCameraLocalStream &&
    module?.liveShare?.cameraRequestState !== 'pending'
  ) {
    stopStudentCameraCall({ statusMessage: 'O professor encerrou sua chamada.' });
  }
  if (module?.liveShare?.cameraRequestState === 'rejected' && shouldRestoreStudentCameraRequest()) {
    stopStudentCameraCall({ statusMessage: 'O professor recusou sua solicitacao de camera.' });
    syncStudentCameraRequestUi({ state: 'rejected', message: 'O professor recusou sua solicitação. Você pode tentar novamente.' });
  } else if (module?.liveShare?.cameraRequestState === 'pending' && shouldRestoreStudentCameraRequest()) {
    clearStudentCameraApprovalRetry();
    syncStudentCameraRequestUi({ state: 'pending' });
  } else if (
    module?.liveShare?.cameraRequestState === 'none' &&
    shouldRestoreStudentCameraRequest() &&
    studentCameraLocalStream &&
    studentCameraRequestUiState !== 'connected'
  ) {
    syncStudentCameraRequestUi({ state: 'approved' });
    const retryKey = `${viewerState.liveShareId || ''}:${studentCameraPeerId || ''}`;
    if (retryKey && studentCameraApprovalRetryKey !== retryKey) {
      clearStudentCameraApprovalRetry();
      studentCameraApprovalRetryKey = retryKey;
      studentCameraApprovalRetryTimer = setTimeout(() => {
        studentCameraApprovalRetryTimer = null;
        void silentlyResendCurrentStudentCameraRequest().catch(() => {});
      }, 900);
    }
  }
  
  syncViewerToLiveShareSlide(module);
  syncLiveScreenShare(
    module?.builder_data?.liveCameraPeerId,
    module?.builder_data?.liveScreenPeerId
  );
  syncViewerDetachedLiveStrokes(module);
  syncViewerLiveDrawingStrokes(module);
  if (moduleAllowsViewerLiveCursors(module)) {
    startViewerLiveCursorSync();
  } else {
    stopViewerLiveCursorSync();
  }
  
  if (dataChanged || slideChanged) {
    renderModuleList();
    loadModule(viewerModules);
  } else if (module?.liveShare?.drawingStrokes?.length > 0) {
    const currentSlide = getCurrentSlide();
    if (currentSlide) {
      redrawAllViewerPenOverlays(currentSlide);
    }
  }
};

const stopLiveStagePolling = () => {
  if (liveStagePollTimer) {
    clearInterval(liveStagePollTimer);
    liveStagePollTimer = null;
  }
};

const startLiveStagePolling = () => {
  stopLiveStagePolling();
  if (!viewerState.liveShareId) {
    return;
  }
  liveStagePollTimer = setInterval(async () => {
    try {
      const liveModule = await fetchLiveStageModule(viewerState.liveShareId);
      const nextRevision = Number(liveModule?.liveShare?.revision) || 0;
      if (nextRevision > viewerState.liveShareRevision) {
        applyLiveStageModule(liveModule);
      }
    } catch (error) {
      if (error.message.includes('não encontrado') || error.message.includes('404')) {
        handleLiveSessionEnded();
        return;
      }
      console.warn('Falha ao atualizar palco ao vivo', error);
    }
  }, 1000);

  const liveControls = document.getElementById('liveStudentControls');
  if (liveControls) {
    liveControls.classList.remove('hidden');
  }
  if (!shouldRestoreStudentCameraRequest()) {
    syncStudentCameraRequestUi({ state: 'idle', message: '' });
  }
};

const disconnectStudentPeer = (peerId) => {
  if (!peerId) return;
  const peer = studentPeerRefs.get(peerId);
  if (peer && !peer.destroyed) {
    try {
      peer.destroy();
    } catch (error) {
      console.warn(`Erro ao desconectar aluno ${peerId}:`, error);
    }
  }
  studentPeerRefs.delete(peerId);
  viewerStudentStreams.delete(peerId);
  removeLiveRemoteAudio(`student:${peerId}`);
};

const applyStudentCameraTrackState = () => {
  if (!studentCameraLocalStream) return;
  studentCameraLocalStream.getAudioTracks?.().forEach((track) => {
    track.enabled = !studentCameraAudioMuted;
  });
  studentCameraLocalStream.getVideoTracks?.().forEach((track) => {
    track.enabled = !studentCameraVideoMuted;
  });
};

const createViewerCameraCallIcon = (name) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const paths = {
    mic: ['M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z', 'M19 10v1a7 7 0 0 1-14 0v-1', 'M12 18v3', 'M8 21h8'],
    micOff: ['M3 3l18 18', 'M9 9v2a3 3 0 0 0 5.12 2.12', 'M15 9.34V6a3 3 0 0 0-5.94-.6', 'M19 10v1a7 7 0 0 1-1.4 4.2', 'M5 10v1a7 7 0 0 0 10.8 5.88', 'M12 18v3', 'M8 21h8'],
    video: ['M15 10l5-3v10l-5-3Z', 'M3 6h12v12H3z'],
    videoOff: ['M3 3l18 18', 'M15 10l5-3v8', 'M3 6h8', 'M15 14.5V18H6.5', 'M3 9.5V18h8.5'],
    phoneOff: ['M10.68 13.31a16 16 0 0 0 3.41 2.56l2.27-2.27a1 1 0 0 1 1.01-.24 11.36 11.36 0 0 0 3.56.57 1 1 0 0 1 1 1V18a2 2 0 0 1-2 2A17 17 0 0 1 3 3a2 2 0 0 1 2-2h3.09a1 1 0 0 1 1 1 11.36 11.36 0 0 0 .57 3.56 1 1 0 0 1-.24 1.01L7.15 8.85', 'M3 3l18 18']
  };
  (paths[name] || paths.video).forEach((d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  return svg;
};

const createViewerCameraCallButton = ({ icon, title, active = false, danger = false, onClick }) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `builder-camera-call-btn${active ? ' is-active' : ''}${danger ? ' is-danger' : ''}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.appendChild(createViewerCameraCallIcon(icon));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick?.(event);
  });
  return button;
};

const stopStudentCameraCall = ({ statusMessage = 'Chamada encerrada.' } = {}) => {
  clearStudentCameraApprovalRetry();
  if (studentCameraLocalStream) {
    studentCameraLocalStream.getTracks().forEach((track) => track.stop());
    studentCameraLocalStream = null;
  }
  if (studentCameraPeer) {
    studentCameraPeer.destroy();
    studentCameraPeer = null;
  }
  studentCameraPeerId = null;
  studentCameraAudioMuted = false;
  studentCameraVideoMuted = false;
  forgetStudentCameraRequest();
  syncStudentCameraRequestUi({ state: 'idle', message: statusMessage });
  if (viewerModules?.length > 0) {
    renderSlide(getCurrentSlide());
  }
};

const syncVisibleStudentPeers = (visiblePeerIds = new Set()) => {
  studentPeerRefs.forEach((peer, peerId) => {
    if (!visiblePeerIds.has(peerId)) {
      disconnectStudentPeer(peerId);
    }
  });
  viewerStudentStreams.forEach((stream, peerId) => {
    if (!visiblePeerIds.has(peerId)) {
      viewerStudentStreams.delete(peerId);
      removeLiveRemoteAudio(`student:${peerId}`);
    }
  });
};

const connectToStudentPeer = (peerId) => {
  if (!peerId) return;
  const existingPeer = studentPeerRefs.get(peerId);
  if (existingPeer && !existingPeer.destroyed && !existingPeer.disconnected) return;
  disconnectStudentPeer(peerId);
  
  const peer = new Peer();
  studentPeerRefs.set(peerId, peer);
  
  peer.on('open', () => {
    peer.connect(peerId);
  });
  
  peer.on('call', (call) => {
    call.answer();
    call.on('stream', (stream) => {
      viewerStudentStreams.set(peerId, stream);
      syncLiveRemoteAudio(`student:${peerId}`, stream);
      stream.getTracks?.().forEach((track) => {
        track.addEventListener('ended', () => {
          if (viewerStudentStreams.get(peerId) === stream) {
            viewerStudentStreams.delete(peerId);
            removeLiveRemoteAudio(`student:${peerId}`);
            if (viewerModules?.length > 0) renderSlide(getCurrentSlide());
          }
        }, { once: true });
      });
      if (viewerModules?.length > 0) renderSlide(getCurrentSlide());
    });
    call.on('close', () => {
      viewerStudentStreams.delete(peerId);
      removeLiveRemoteAudio(`student:${peerId}`);
      if (viewerModules?.length > 0) renderSlide(getCurrentSlide());
    });
    call.on('error', () => {
      viewerStudentStreams.delete(peerId);
      removeLiveRemoteAudio(`student:${peerId}`);
      if (viewerModules?.length > 0) renderSlide(getCurrentSlide());
    });
  });
  
  peer.on('error', (err) => {
    console.warn(`Erro ao conectar com aluno ${peerId}:`, err);
    studentPeerRefs.delete(peerId);
    viewerStudentStreams.delete(peerId);
    removeLiveRemoteAudio(`student:${peerId}`);
  });

  peer.on('disconnected', () => {
    studentPeerRefs.delete(peerId);
    viewerStudentStreams.delete(peerId);
    removeLiveRemoteAudio(`student:${peerId}`);
  });

  peer.on('close', () => {
    studentPeerRefs.delete(peerId);
    viewerStudentStreams.delete(peerId);
    removeLiveRemoteAudio(`student:${peerId}`);
  });
};

const getStudentCameraRequestStorageKey = () =>
  viewerState.liveShareId ? `${STUDENT_CAMERA_REQUEST_PREFIX}${viewerState.liveShareId}` : '';

const syncStudentCameraRequestUi = ({ state = 'idle', message = '' } = {}) => {
  const btn = document.getElementById('requestCameraBtn');
  const status = document.getElementById('requestCameraStatus');
  if (!btn || !status) return;

  studentCameraRequestUiState = state;
  btn.classList.remove('primary-btn', 'secondary-btn');
  btn.style.display = '';

  switch (state) {
    case 'starting':
      btn.classList.add('secondary-btn');
      btn.textContent = 'Preparando câmera...';
      btn.disabled = true;
      status.textContent = message || 'Estamos iniciando sua câmera para enviar a solicitação.';
      break;
    case 'sending':
      btn.classList.add('secondary-btn');
      btn.textContent = 'Enviando solicitação...';
      btn.disabled = true;
      status.textContent = message || 'Sua solicitação está sendo enviada para o professor.';
      break;
    case 'pending':
      btn.classList.add('secondary-btn');
      btn.textContent = 'Solicitação pendente';
      btn.disabled = true;
      status.textContent = message || 'Aguarde o professor aprovar ou recusar sua solicitação.';
      break;
    case 'approved':
      btn.classList.add('secondary-btn');
      btn.textContent = 'Solicitação aprovada';
      btn.disabled = true;
      status.textContent = message || 'O professor aprovou. Conectando sua câmera na aula...';
      break;
    case 'connected':
      btn.classList.add('secondary-btn');
      btn.textContent = 'Em chamada ao vivo';
      btn.disabled = true;
      status.textContent = message || 'Sua câmera já está conectada com o professor.';
      break;
    case 'rejected':
      btn.classList.add('primary-btn');
      btn.textContent = 'Solicitar novamente';
      btn.disabled = false;
      status.textContent = message || 'O professor recusou sua solicitação. Você pode tentar novamente.';
      break;
    case 'error':
      btn.classList.add('primary-btn');
      btn.textContent = 'Tentar novamente';
      btn.disabled = false;
      status.textContent = message || 'Não foi possível enviar sua solicitação agora.';
      break;
    default:
      btn.classList.add('primary-btn');
      btn.textContent = 'Solicitar transmissão de câmera';
      btn.disabled = false;
      status.textContent = message || '';
      break;
  }
};

const clearStudentCameraApprovalRetry = () => {
  if (studentCameraApprovalRetryTimer) {
    clearTimeout(studentCameraApprovalRetryTimer);
    studentCameraApprovalRetryTimer = null;
  }
  studentCameraApprovalRetryKey = '';
};

const silentlyResendCurrentStudentCameraRequest = async () => {
  if (!viewerState.liveShareId || !studentCameraPeerId) {
    return false;
  }
  const response = await authorizedFetch(`/api/student/live-stage/${encodeURIComponent(viewerState.liveShareId)}/request-camera`, {
    method: 'POST',
    body: JSON.stringify({ peerId: studentCameraPeerId })
  });
  if (!response.ok) {
    return false;
  }
  rememberStudentCameraRequest();
  return true;
};

const rememberStudentCameraRequest = () => {
  const key = getStudentCameraRequestStorageKey();
  if (key) {
    sessionStorage.setItem(key, '1');
  }
};

const forgetStudentCameraRequest = () => {
  const key = getStudentCameraRequestStorageKey();
  if (key) {
    sessionStorage.removeItem(key);
  }
};

const shouldRestoreStudentCameraRequest = () => {
  const key = getStudentCameraRequestStorageKey();
  return Boolean(key && sessionStorage.getItem(key) === '1');
};

const handleLiveSessionEnded = () => {
  clearStudentCameraApprovalRetry();
  stopLiveStagePolling();
  stopViewerLiveCursorSync();
  forgetStudentCameraRequest();
  syncStudentCameraRequestUi({ state: 'idle', message: '' });
  
  if (studentCameraLocalStream) {
    studentCameraLocalStream.getTracks().forEach(track => track.stop());
    studentCameraLocalStream = null;
  }
  
  if (studentCameraPeer) {
    studentCameraPeer.destroy();
    studentCameraPeer = null;
  }
  
  viewerStudentStreams.forEach(stream => {
    if (stream && stream.getTracks) stream.getTracks().forEach(t => t.stop());
  });
  viewerStudentStreams.clear();
  clearLiveRemoteAudio();
  
  studentPeerRefs.forEach(peer => {
    if (peer && !peer.destroyed) peer.destroy();
  });
  studentPeerRefs.clear();

  alert('A sessão ao vivo foi encerrada pelo professor.');
  
  // Se estiver num link direto de live, volta pro portal. Caso contrário, recarrega.
  if (viewerState.liveShareId && window.location.search.includes('liveShareId')) {
    window.location.href = 'portal.html';
  } else {
    window.location.reload();
  }
};

const initStudentCameraRequest = async () => {
  const btn = document.getElementById('requestCameraBtn');
  const status = document.getElementById('requestCameraStatus');
  if (!btn || !viewerState.liveShareId) return;

  btn.disabled = true;
  status.textContent = 'Iniciando câmera...';

  try {
    if (!studentCameraLocalStream) {
      studentCameraLocalStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      applyStudentCameraTrackState();
    }

    if (!studentCameraPeer) {
      studentCameraPeer = new Peer();
      studentCameraPeer.on('open', async (id) => {
        studentCameraPeerId = id;
        status.textContent = 'Enviando solicitação...';
        
        try {
          const response = await authorizedFetch(`/api/student/live-stage/${encodeURIComponent(viewerState.liveShareId)}/request-camera`, {
            method: 'POST',
            body: JSON.stringify({ peerId: id })
          });
          
          if (response.ok) {
            rememberStudentCameraRequest();
            status.textContent = 'Solicitação enviada! Aguarde o professor.';
            btn.style.display = 'none';
          } else {
            status.textContent = 'Falha ao solicitar.';
            btn.disabled = false;
          }
        } catch (e) {
          status.textContent = 'Erro na conexão.';
          btn.disabled = false;
        }
      });

      studentCameraPeer.on('connection', (conn) => {
        conn.on('open', () => {
          if (studentCameraLocalStream) {
            studentCameraPeer.call(conn.peer, studentCameraLocalStream);
          }
        });
      });

      studentCameraPeer.on('error', (err) => {
        console.warn('Student Peer error:', err);
        status.textContent = 'Erro no PeerJS.';
        btn.disabled = false;
      });
    } else if (studentCameraPeerId) {
      // Já tem ID, só reenviar se necessário
      const response = await authorizedFetch(`/api/student/live-stage/${encodeURIComponent(viewerState.liveShareId)}/request-camera`, {
        method: 'POST',
        body: JSON.stringify({ peerId: studentCameraPeerId })
      });
      if (response.ok) {
        rememberStudentCameraRequest();
        status.textContent = 'Solicitação reenviada!';
        btn.style.display = 'none';
      } else {
        status.textContent = 'Falha ao reenviar.';
        btn.disabled = false;
      }
    }
  } catch (err) {
    console.error('Erro ao acessar câmera:', err);
    status.textContent = 'Erro ao acessar câmera.';
    btn.disabled = false;
  }
};

const requestStudentCameraWithStatus = async () => {
  const btn = document.getElementById('requestCameraBtn');
  if (!btn || !viewerState.liveShareId) return;

  syncStudentCameraRequestUi({ state: 'starting' });

  try {
    if (!studentCameraLocalStream) {
      studentCameraLocalStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      applyStudentCameraTrackState();
    }

    if (!studentCameraPeer) {
      studentCameraPeer = new Peer();
      studentCameraPeer.on('open', async (id) => {
        studentCameraPeerId = id;
        syncStudentCameraRequestUi({ state: 'sending' });

        try {
          const response = await authorizedFetch(`/api/student/live-stage/${encodeURIComponent(viewerState.liveShareId)}/request-camera`, {
            method: 'POST',
            body: JSON.stringify({ peerId: id })
          });

          if (response.ok) {
            rememberStudentCameraRequest();
            syncStudentCameraRequestUi({ state: 'pending' });
          } else {
            syncStudentCameraRequestUi({ state: 'error', message: 'Falha ao enviar a solicitação para o professor.' });
          }
        } catch (e) {
          syncStudentCameraRequestUi({ state: 'error', message: 'Erro de conexão ao solicitar sua câmera.' });
        }
      });

      studentCameraPeer.on('connection', (conn) => {
        conn.on('open', () => {
          clearStudentCameraApprovalRetry();
          syncStudentCameraRequestUi({ state: 'connected' });
          if (studentCameraLocalStream) {
            studentCameraPeer.call(conn.peer, studentCameraLocalStream);
          }
        });
      });

      studentCameraPeer.on('error', (err) => {
        console.warn('Student Peer error:', err);
        syncStudentCameraRequestUi({ state: 'error', message: 'Erro na conexão da câmera ao vivo.' });
      });
    } else if (studentCameraPeerId) {
      syncStudentCameraRequestUi({ state: 'sending' });
      const response = await authorizedFetch(`/api/student/live-stage/${encodeURIComponent(viewerState.liveShareId)}/request-camera`, {
        method: 'POST',
        body: JSON.stringify({ peerId: studentCameraPeerId })
      });
      if (response.ok) {
        rememberStudentCameraRequest();
        syncStudentCameraRequestUi({ state: 'pending', message: 'Solicitação reenviada. Aguarde o professor.' });
      } else {
        syncStudentCameraRequestUi({ state: 'error', message: 'Falha ao reenviar sua solicitação.' });
      }
    }
  } catch (err) {
    console.error('Erro ao acessar cÃ¢mera:', err);
    syncStudentCameraRequestUi({ state: 'error', message: 'Erro ao acessar câmera e microfone.' });
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
    viewerSubtitle.textContent = isLiveShareMode()
      ? `${module.courseTitle || 'Palco ao vivo'} • acompanhando edicao em tempo real`
      : viewerState.isPublic
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
    syncVisibleViewerCameraSessions(new Set());
    syncVisibleStudentPeers(new Set());
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
  if (!slide) {
    syncVisibleViewerCameraSessions(new Set());
    syncVisibleStudentPeers(new Set());
    return;
  }
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
  syncVisibleViewerCameraSessions(
    new Set(
      (slide.elements || [])
        .filter((element) => element?.type === 'camera' && element?.id)
        .map((element) => getViewerCameraSessionKey(getViewerCameraContext(element, slide)))
    )
  );
  syncVisibleStudentPeers(
    new Set(
      (slide.elements || [])
        .filter((element) => element?.type === 'camera' && element?.studentPeerId)
        .map((element) => String(element.studentPeerId))
    )
  );
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
      if (['audio', 'video'].includes(element.type) && !(element.type === 'audio' && element.collectStudentAudio)) {
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
  performStageScaleUpdate();
  ensureViewerPenOverlay(slide);
  ensureViewerLiveCursorOverlay();
  updateViewerPenToolState(slide);
  if (isLiveShareMode()) {
    if (moduleAllowsViewerLiveCursors(getCurrentModule())) {
      startViewerLiveCursorSync();
    } else {
      stopViewerLiveCursorSync();
    }
  } else {
    stopViewerLiveCursorSync();
  }
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
    case 'pen':
      node = createViewerPenElementNode(element);
      break;
    case 'audio':
      {
        if (element.collectStudentAudio) {
          node = createAudioCaptureElementNode(element, slide);
        } else {
          const mediaNode = document.createElement('audio');
          mediaNode.className = 'builder-media-element';
          mediaNode.src = element.src || '';
          applyViewerAudioPresentation(mediaNode, element);
          node = wrapMediaNodeWithCaptions(mediaNode, element);
          restoreViewerMediaState(slide, element, node);
        }
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
        frame.sandbox = 'allow-scripts allow-same-origin allow-presentation';
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
    case 'camera':
      node = createViewerCameraNode(element, slide);
      break;
    case 'screenShare':
      node = createViewerScreenShareNode();
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
      if (!isReplayMode()) {
        node.addEventListener('click', () => executeFloatingButtonTriggers(element));
      }
      break;
    case 'key':
      node = createKeyElementNode(element, slide);
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
      node.innerHTML = `<span>${escapeHtml(element.label || '➜')}</span>`;
      applyElementBackground(node, element);
      break;
    default:
      node = document.createElement('div');
      node.textContent = element.content || 'Elemento';
  }
  if (!(node instanceof Element)) {
    return node;
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
  if (!['block', 'floatingButton', 'image', 'key'].includes(element.type) && element.backgroundColor) {
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
  attachViewerStudentPenOverlay(node, element, slide);
  enableViewerStudentDrag(node, element, slide);
  return node;
};

const getKeyTriggerButtonLabel = (trigger) => {
  const direction = getKeyTriggerDirection(trigger);
  if (direction === 'left') return 'ESQ';
  if (direction === 'right') return 'DIR';
  if (direction === 'up') return 'CIMA';
  if (direction === 'down') return 'BAIXO';
  return formatKeyBindingSummary(getTriggerKeyBindings(trigger)) || trigger?.name || 'Tecla';
};

const getVisibleKeyTriggers = (element) => {
  normalizeKeyElement(element);
  return (element.interactionTriggers || []).filter((trigger) => trigger?.enabled !== false && isKeyTriggerVisible(trigger));
};

const createKeyTriggerButtonNode = (element, trigger, { onTrigger = null } = {}) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'key-trigger-btn';
  const direction = getKeyTriggerDirection(trigger);
  button.textContent = getKeyTriggerButtonLabel(trigger);
  button.setAttribute('aria-label', `Tecla ${formatKeyBindingSummary(getTriggerKeyBindings(trigger)) || trigger?.name || 'interativa'}`);
  if (direction) {
    button.dataset.direction = direction;
  }
  applyElementBackground(button, element);
  applyShapeStyles(button, element.shape || 'rectangle');
  button.style.color = element.textColor || '#ffffff';
  button.style.fontFamily = element.fontFamily || 'Inter, sans-serif';
  button.style.fontWeight = element.fontWeight || '700';
  button.style.fontSize = `${Math.max(12, Number(element.fontSize) || 16)}px`;
  const setPressed = (pressed) => button.classList.toggle('is-pressed', pressed);
  button.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    setPressed(true);
  });
  ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((eventName) => {
    button.addEventListener(eventName, () => setPressed(false));
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onTrigger?.(trigger);
  });
  return button;
};

const createKeyTriggerPanelNode = (element, triggers, { onTrigger = null } = {}) => {
  const visibleTriggers = Array.isArray(triggers) ? triggers.filter(Boolean) : [];
  const panel = document.createElement('div');
  const directionTriggers = new Map();
  visibleTriggers.forEach((trigger) => {
    const direction = getKeyTriggerDirection(trigger);
    if (direction && !directionTriggers.has(direction)) {
      directionTriggers.set(direction, trigger);
    }
  });
  const canUseJoystick =
    visibleTriggers.length >= 2 &&
    visibleTriggers.every((trigger) => Boolean(getKeyTriggerDirection(trigger))) &&
    directionTriggers.size >= 2;
  if (canUseJoystick) {
    panel.className = 'key-trigger-panel is-joystick';
    ['up', 'left', 'right', 'down'].forEach((direction) => {
      const trigger = directionTriggers.get(direction);
      if (trigger) {
        panel.appendChild(createKeyTriggerButtonNode(element, trigger, { onTrigger }));
      }
    });
    const spacer = document.createElement('div');
    spacer.className = 'key-trigger-joystick-spacer';
    panel.appendChild(spacer);
    return panel;
  }
  panel.className = 'key-trigger-panel';
  visibleTriggers.forEach((trigger) => {
    panel.appendChild(createKeyTriggerButtonNode(element, trigger, { onTrigger }));
  });
  return panel;
};

const executeKeyTrigger = (element, trigger, slide, { showAlert = true } = {}) => {
  if (isReplayMode()) {
    return { executed: false, rerender: false, blockedRuleState: null };
  }
  if (element?.type === 'key') {
    normalizeKeyElement(element);
  } else {
    normalizeInteractionTriggers(element);
  }
  const module = getCurrentModule();
  const slides = module?.builder_data?.slides || [];
  if (!slide || trigger?.enabled === false) {
    return { executed: false, rerender: false, blockedRuleState: null };
  }
  const ruleState = registerFloatingRuleClick(module, slide, element, trigger);
  syncViewerFloatingRuleButtonState(module, slide, element.id);
  if (!ruleState.ready) {
    if (showAlert) {
      if (ruleState.invalid) {
        alert('Essa regra precisa de um nome de grupo e de pelo menos 2 gatilhos no mesmo slide para funcionar.');
      } else {
        alert(`Faltam ${ruleState.remaining} gatilho(s) desta regra para liberar a ação.`);
      }
    }
    return { executed: false, rerender: false, blockedRuleState: ruleState };
  }
  const didExecute = executeActionConfig(element, trigger.actionConfig || {}, slide, module, slides);
  return {
    executed: didExecute,
    rerender: didExecute && !['playAudio', 'playVideo', 'pauseVideo', 'seekVideo', 'moveElement', 'playAnimation'].includes(trigger.actionConfig?.type || 'none'),
    blockedRuleState: null
  };
};

const createKeyElementNode = (element, slide) => {
  normalizeKeyElement(element);
  const visibleTriggers = getVisibleKeyTriggers(element);
  if (!visibleTriggers.length) {
    return document.createComment(`hidden-key-${element.id || 'element'}`);
  }
  const node = document.createElement('div');
  node.className = 'key-trigger-element';
  node.appendChild(
    createKeyTriggerPanelNode(element, visibleTriggers, {
      onTrigger: (trigger) => {
        const result = executeKeyTrigger(element, trigger, slide);
        if (result.rerender && getCurrentSlide()?.id === slide?.id) {
          renderSlide(getCurrentSlide());
        }
      }
    })
  );
  return node;
};

const handleViewerKeyTriggerEvent = (event) => {
  if (isReplayMode() || event.defaultPrevented || isViewerTypingTarget(event.target)) {
    return false;
  }
  const slide = getCurrentSlide();
  const binding = normalizeKeyboardEventBinding(event);
  if (!slide || !binding) {
    return false;
  }
  let executed = false;
  let shouldRerender = false;
  let blockedRuleState = null;
  (slide.elements || [])
    .filter((element) => ['key', 'floatingButton'].includes(element?.type))
    .forEach((element) => {
      if (isViewerElementHidden(slide, element.id)) {
        return;
      }
      if (element.type === 'key') {
        normalizeKeyElement(element);
      } else {
        normalizeInteractionTriggers(element);
      }
      (element.interactionTriggers || []).forEach((trigger) => {
        if (trigger?.enabled === false || !triggerMatchesKeyboardBinding(trigger, binding)) {
          return;
        }
        if (event.repeat && (trigger.actionConfig?.type || 'none') !== 'moveElement') {
          return;
        }
        const result = executeKeyTrigger(element, trigger, slide, { showAlert: !executed });
        executed = executed || result.executed;
        shouldRerender = shouldRerender || result.rerender;
        blockedRuleState = blockedRuleState || result.blockedRuleState;
      });
    });
  if (!executed && blockedRuleState) {
    return true;
  }
  if (executed) {
    event.preventDefault();
    if (shouldRerender && getCurrentSlide()?.id === slide.id) {
      renderSlide(getCurrentSlide());
    }
  }
  return executed;
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
  const isFullscreen = document.fullscreenElement === moduleStageShell;
  viewerFullscreenBtn.textContent = isFullscreen ? 'Sair da tela cheia' : 'Tela cheia';
  if (viewerFullscreenNavToggleBtn) {
    viewerFullscreenNavToggleBtn.textContent = isFullscreen ? 'Controles' : 'Controles';
  }
};

const setFullscreenNavExpanded = (expanded) => {
  const stageNav = moduleStageShell?.querySelector('.stage-nav');
  if (!stageNav || !viewerFullscreenNavToggleBtn) {
    return;
  }
  const isFullscreen = document.fullscreenElement === moduleStageShell;
  const shouldExpand = Boolean(isFullscreen && expanded);
  stageNav.classList.toggle('is-expanded', shouldExpand);
  viewerFullscreenNavToggleBtn.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
  viewerFullscreenNavToggleBtn.setAttribute('aria-label', shouldExpand ? 'Fechar controles' : 'Abrir controles');
};

const toggleFullscreenNavExpanded = () => {
  const stageNav = moduleStageShell?.querySelector('.stage-nav');
  if (!stageNav || document.fullscreenElement !== moduleStageShell) {
    return;
  }
  setFullscreenNavExpanded(!stageNav.classList.contains('is-expanded'));
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
  if (viewerState.isPublic || isLiveShareMode()) {
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
  if (typeof ResizeObserver === 'function' && moduleStageShell) {
    const stageObserver = new ResizeObserver(() => {
      updateStageScale();
    });
    stageObserver.observe(moduleStageShell);
  }
  moduleStageHint = document.getElementById('moduleStageHint');
  viewerTitle = document.getElementById('viewerTitle');
  viewerSubtitle = document.getElementById('viewerSubtitle');
  prevBtn = document.getElementById('viewerPrevBtn');
  nextBtn = document.getElementById('viewerNextBtn');
  viewerFullscreenBtn = document.getElementById('viewerFullscreenBtn');
  viewerFullscreenNavToggleBtn = document.getElementById('viewerFullscreenNavToggleBtn');
  viewerPenToolBtn = document.getElementById('viewerPenToolBtn');
  viewerPenControls = document.getElementById('viewerPenControls');
  viewerPenColorInput = document.getElementById('viewerPenColorInput');
  viewerPenSizeInput = document.getElementById('viewerPenSizeInput');
  viewerPenSizeNumberInput = document.getElementById('viewerPenSizeNumberInput');
  viewerPenClearBtn = document.getElementById('viewerPenClearBtn');
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
  viewerFullscreenNavToggleBtn?.addEventListener('click', toggleFullscreenNavExpanded);
  viewerPenToolBtn?.addEventListener('click', toggleViewerPenTool);
  viewerPenColorInput?.addEventListener('input', () => {
    viewerState.penColor = viewerPenColorInput.value || '#111827';
    viewerState.penSettingsTouched = true;
    syncViewerPenInputs('color');
  });
  viewerPenSizeInput?.addEventListener('input', () => {
    viewerState.penSize = Number(viewerPenSizeInput.value) || 8;
    viewerState.penSettingsTouched = true;
    syncViewerPenInputs('range');
  });
  viewerPenSizeNumberInput?.addEventListener('input', () => {
    viewerState.penSize = Number(viewerPenSizeNumberInput.value) || 8;
    viewerState.penSettingsTouched = true;
    syncViewerPenInputs('number');
  });
  viewerPenClearBtn?.addEventListener('click', clearViewerPenDraft);
  attachViewerStageZoomHandlers();
  document.addEventListener('fullscreenchange', () => {
    syncFullscreenButtonState();
    setFullscreenNavExpanded(false);
    resetViewerStageZoom();
    // Garante que o palco se ajuste ao tamanho total da tela ao entrar/sair do full screen
    requestAnimationFrame(() => {
      updateStageScale();
    });
  });
  document.addEventListener('keydown', (event) => {
    handleViewerKeyTriggerEvent(event);
  });
  syncFullscreenButtonState();
  updateViewerPenToolState(null);
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
    void sendViewerLiveCursor(null, false);
    stopViewerLiveCursorSync();
    stopLiveStagePolling();
  });

  moduleStage?.addEventListener('pointermove', (event) => {
    if (!shouldSyncViewerLiveCursors() || viewerState.penToolActive || event.pointerType === 'touch') {
      return;
    }
    const point = getViewerLiveCursorPoint(event);
    if (point) {
      void sendViewerLiveCursor(point, true);
    }
  });

  moduleStage?.addEventListener('pointerleave', () => {
    if (!isLiveShareMode()) {
      return;
    }
    void sendViewerLiveCursor(null, false);
  });

  if (isLiveShareMode()) {
    if (moduleSelection) {
      moduleSelection.style.display = 'none';
    }
    const token = getToken();
    const role = localStorage.getItem(USER_ROLE_KEY);
    if (!token || role !== 'student') {
      window.location.href = 'login.html';
      return;
    }
    if (viewerBackLink) {
      viewerBackLink.textContent = 'Voltar ao portal';
      viewerBackLink.href = 'portal.html';
    }
  } else if (viewerState.isPublic) {
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
  if (!viewerState.moduleId && !viewerState.courseId && !viewerState.liveShareId) {
    clearStage('Informe o módulo que deseja visualizar (use o portal).');
    disableNavigation();
    return;
  }
  try {
    if (isLiveShareMode()) {
      viewerState.moduleIndex = 0;
      const liveModule = await fetchLiveStageModule(viewerState.liveShareId);
      applyLiveStageModule(liveModule);
      startLiveStagePolling();
      if (shouldRestoreStudentCameraRequest()) {
        setTimeout(() => {
          void requestStudentCameraWithStatus().catch(() => {});
        }, 300);
      }
      return;
    }
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
  document.getElementById('requestCameraBtn')?.addEventListener('click', requestStudentCameraWithStatus);
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

export const resolveApiBase = () => {
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

export const API_BASE = resolveApiBase();
export const STORAGE_KEY = 'curso-platform-token';
export const USER_ROLE_KEY = 'curso-platform-role';
export const AI_PROPOSAL_HISTORY_KEY = 'curso-platform-ai-proposal-history';
export const BUILDER_DRAFT_STORAGE_KEY = 'curso-platform-builder-draft';

export const DEFAULT_STAGE_SIZE = { width: 1280, height: 720 };
export const MIN_ELEMENT_SIZE = 40;
export const BUILDER_PANEL_COLLAPSE_BREAKPOINT = 1480;
export const BUILDER_PANEL_STAGE_GAP = 24;
export const BUILDER_PANEL_COLLAPSED_WIDTH = 64;

export const getToken = () => localStorage.getItem(STORAGE_KEY);
export const getCurrentUserData = () => {
  try {
    return JSON.parse(localStorage.getItem('curso-platform-user') || '{}');
  } catch (error) {
    return {};
  }
};

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const createId = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 6)}-${Date.now()}`;

export const ANIMATABLE_ELEMENT_TYPES = new Set(['text', 'block', 'floatingButton', 'image']);
export const MOTION_ANIMATION_TYPE = 'motion-recording';
export const ANIMATION_PRESETS = new Set(['none', 'fade-in', 'fade-out', 'slide-left', 'slide-right', 'rotate-in', 'pulse', 'float', 'zoom-in', MOTION_ANIMATION_TYPE]);
export const DEFAULT_MOTION_FRAME = Object.freeze({ opacity: 1 });

export const IMAGE_FALLBACK_SRC =
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
export const DEFAULT_INSERT_TEXT_STYLE = {
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

export const DETECTOR_ACCEPT_ANY = 'any';
export const DETECTOR_ACCEPT_TYPE_PREFIX = 'type:';
export const DETECTOR_ACCEPT_ELEMENT_PREFIX = 'element:';
export const REPLACE_TEXT_MODE = 'replace';
export const REPLACE_COUNTER_MODE = 'counter';

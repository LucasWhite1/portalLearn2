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

import { getFaceStatus, revokeFaceProfile, runFaceVerification } from './modules/face-verification.js';

const API_BASE = resolveApiBase();
const STORAGE_KEY = 'curso-platform-token';
const USER_ROLE_KEY = 'curso-platform-role';
const WHATSAPP_SUPPORT_PHONE = '5599999999999';
const WHATSAPP_SUPPORT_MESSAGE = 'Ola, quero falar com o suporte da Criatyve.';
let cachedCourses = [];
let cachedStoreCourses = [];
let adminStudentsCache = [];
let adminProfessorsCache = [];
let adminProfessorFinancialSummary = null;
let studentFinanceCache = { settings: null, summary: null, students: [] };
let globalStudentFinanceCache = { summary: null, professors: [] };
let adminCoursesCache = [];
let adminAccessRequestsCache = [];
let adminClassesCache = [];
let courseGrid;
let courseStoreGrid;
let liveStageGrid;
let adminAiSettingsCache = null;
let openProgressTimelineKey = null;
let activeNavCleanupTimer = null;
let editingCourseCoverId = '';
let editingCourseCoverImage = '';
let editingCourseCoverMode = 'local';
let adminChatCoursesCache = [];
let adminActiveChatCourseId = '';
let adminChatPollTimer = null;
let adminReplyTarget = null;
let adminCurrentChatMessages = [];
let currentStudentSignupLink = '';
let pendingSeatUpgradeStudentId = '';
let studentSeatUpgradeUnitPrice = 9.70;
let studentSeatUpgradeCurrentLimit = 0;
let liveStagePollTimer = null;
let mobileSidenavCleanup = null;
let selectedNotificationAttachment = null;
let adminAssistantHistory = [];
let adminAssistantProposalId = '';
let adminAssistantBusy = false;
let pendingProfileImage = '';
let pendingPortalBackgroundImage = '';
let pendingPortalLogoImage = '';
let portalColorPalettes = [];

const getCurrentUserRole = () => localStorage.getItem(USER_ROLE_KEY) || '';
const getCurrentUserData = () => {
  try {
    return JSON.parse(localStorage.getItem('curso-platform-user') || '{}');
  } catch (error) {
    return {};
  }
};
const setCurrentUserData = (patch = {}) => {
  const current = getCurrentUserData();
  localStorage.setItem('curso-platform-user', JSON.stringify({ ...current, ...patch }));
};
const isGlobalAdminUser = () => getCurrentUserRole() === 'admin';
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

const formatPaymentDate = (value) => {
  if (!value) return 'Não informado';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR') : 'Não informado';
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttribute = escapeHtml;

const formatOwnerLabel = (item = {}) => {
  if (item.owner_name) return item.owner_name;
  if (item.owner_user_id) return 'Professor não encontrado';
  return 'Admin global / sem professor';
};

const renderOwnerMeta = (item = {}, options = {}) => {
  if (!isGlobalAdminUser()) return '';
  const label = formatOwnerLabel(item);
  const email = item.owner_email || '';
  const prefix = options.prefix || 'Professor';
  return `
    <small class="${options.className || ''}" style="color:#5f678a; display:block; margin-top:0.35rem; font-size:0.78rem;">
      ${escapeHtml(prefix)}: <strong>${escapeHtml(label)}</strong>${email ? ` • ${escapeHtml(email)}` : ''}
    </small>
  `;
};

const URL_IN_TEXT_REGEX = /(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const MAX_NOTIFICATION_FILE_BYTES = 8 * 1024 * 1024;
const NOTIFICATION_FILE_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip'
]);

const getSafeHttpUrl = (value) => {
  try {
    const raw = String(value || '').trim();
    const parsed = new URL(raw.startsWith('www.') ? `https://${raw}` : raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch (error) {
    return '';
  }
};

const isSafeNotificationDataUrl = (value) =>
  /^data:(application\/pdf|application\/msword|application\/vnd\.ms-(powerpoint|excel)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|presentationml\.presentation|spreadsheetml\.sheet)|text\/plain|application\/zip|image\/[a-z0-9.+-]+);base64,[a-z0-9+/=\s]+$/i.test(String(value || ''));

const linkifyText = (value) => {
  const raw = String(value || '');
  let output = '';
  let lastIndex = 0;
  raw.replace(URL_IN_TEXT_REGEX, (match, offset) => {
    output += escapeHtml(raw.slice(lastIndex, offset));
    const safeUrl = getSafeHttpUrl(match);
    output += safeUrl
      ? `<a href="${escapeAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match)}</a>`
      : escapeHtml(match);
    lastIndex = offset + match.length;
    return match;
  });
  output += escapeHtml(raw.slice(lastIndex));
  return output.replace(/\n/g, '<br>');
};

const normalizeNotificationAttachments = (attachments) => {
  if (!Array.isArray(attachments)) return [];
  const seen = new Set();
  return attachments
    .map((entry) => {
      const rawUrl = entry?.url || entry;
      const url = getSafeHttpUrl(rawUrl) || (isSafeNotificationDataUrl(rawUrl) ? String(rawUrl) : '');
      if (!url || seen.has(url)) return null;
      seen.add(url);
      return {
        title: String(entry?.title || 'Documento').trim() || 'Documento',
        url,
        mimeType: entry?.mimeType || '',
        size: Number(entry?.size) || 0,
        isFileData: isSafeNotificationDataUrl(url)
      };
    })
    .filter(Boolean)
    .slice(0, 10);
};

const renderNotificationAttachments = (attachments) => {
  const safeAttachments = normalizeNotificationAttachments(attachments);
  if (!safeAttachments.length) return '';
  return `
    <div class="notification-attachments">
      ${safeAttachments.map((attachment, index) => attachment.isFileData
        ? `
        <button class="notification-attachment" type="button" data-notification-attachment-index="${index}">
          <span class="notification-attachment-icon">DOC</span>
          <span>${escapeHtml(attachment.title)}</span>
        </button>
      `
        : `
        <a class="notification-attachment" href="${escapeAttribute(attachment.url)}" target="_blank" rel="noopener noreferrer">
          <span class="notification-attachment-icon">LINK</span>
          <span>${escapeHtml(attachment.title)}</span>
        </a>
      `).join('')}
    </div>
  `;
};

const openNotificationAttachment = async (button) => {
  const card = button?.closest('[data-notification-id]');
  const notificationId = card?.dataset?.notificationId || '';
  const attachmentIndex = button?.dataset?.notificationAttachmentIndex || '';
  if (!notificationId || attachmentIndex === '') {
    alert('Anexo indisponível nesta notificação.');
    return;
  }
  const scope = getCurrentUserRole() === 'student' ? 'student' : 'admin';
  try {
    button.disabled = true;
    const response = await authorizedFetch(`/api/${scope}/notifications/${encodeURIComponent(notificationId)}/attachments/${encodeURIComponent(attachmentIndex)}`, {
      headers: {}
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      throw new Error(errorPayload?.message || 'Não foi possível abrir o anexo.');
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60 * 1000);
  } catch (error) {
    alert(error.message || 'Não foi possível abrir o anexo.');
  } finally {
    button.disabled = false;
  }
};

const setupNotificationAttachmentClicks = () => {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-notification-attachment-index]');
    if (!button) return;
    event.preventDefault();
    await openNotificationAttachment(button);
  });
};

const getNotificationFileAllowed = (file) =>
  Boolean(file) && (NOTIFICATION_FILE_MIME_TYPES.has(file.type) || file.type.startsWith('image/'));

const inferNotificationFileMimeType = (file) => {
  const explicitType = String(file?.type || '').trim();
  if (explicitType) return explicitType;
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.doc')) return 'application/msword';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (name.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (name.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (name.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (name.endsWith('.txt')) return 'text/plain';
  if (name.endsWith('.zip')) return 'application/zip';
  return '';
};

const getNotificationFileAllowedByTypeOrName = (file) => {
  const mimeType = inferNotificationFileMimeType(file);
  return Boolean(file) && (NOTIFICATION_FILE_MIME_TYPES.has(mimeType) || mimeType.startsWith('image/'));
};

const readNotificationAttachmentFile = (file) => new Promise((resolve, reject) => {
  if (!file) {
    resolve(null);
    return;
  }
  const mimeType = inferNotificationFileMimeType(file);
  if (!getNotificationFileAllowedByTypeOrName(file)) {
    reject(new Error('Formato de arquivo não permitido. Use PDF, Word, PowerPoint, Excel, TXT, ZIP ou imagem.'));
    return;
  }
  if (file.size > MAX_NOTIFICATION_FILE_BYTES) {
    reject(new Error('O anexo pode ter no máximo 8 MB.'));
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    const base64 = result.includes(',') ? result.split(',').slice(1).join(',') : '';
    resolve({
      title: file.name,
      url: base64 ? `data:${mimeType};base64,${base64}` : result,
      mimeType,
      size: file.size
    });
  };
  reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
  reader.readAsDataURL(file);
});

const clearNotificationAttachment = () => {
  selectedNotificationAttachment = null;
  const input = document.getElementById('notificationFileInput');
  const status = document.getElementById('notificationFileStatus');
  if (input) input.value = '';
  if (status) status.textContent = 'Nenhum arquivo anexado.';
};

const truncateChatPreview = (value, max = 110) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
};

const formatChatReplyAuthor = (message) => {
  if (!message) return 'Mensagem';
  return message.reply_to_role === 'admin' || message.reply_to_role === 'professor' || message.role === 'admin' || message.role === 'professor'
    ? `${message.reply_to_full_name || message.full_name} (Professor)`
    : (message.reply_to_full_name || message.full_name || 'Aluno');
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

const renderChatAvatar = (message = {}) => {
  const image = message.profile_image || '';
  const name = message.full_name || 'Usuário';
  const initials = String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || '?';
  return `<span class="chat-avatar" ${image ? `style="background-image:url('${escapeAttribute(image)}')"` : ''}>${image ? '' : escapeHtml(initials)}</span>`;
};

let pendingCourseCoverImage = '';

const readLocalImageFile = (input) =>
  new Promise((resolve, reject) => {
    const file = input?.files?.[0];
    if (!file) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem escolhida.'));
    reader.readAsDataURL(file);
  });

const getModuleCoverImage = (module) => {
  const coverImage = module?.builder_data?.moduleSettings?.coverImage;
  return typeof coverImage === 'string' ? coverImage.trim() : '';
};

const getCourseCoverImage = (course) => (typeof course?.cover_image === 'string' ? course.cover_image.trim() : '');

const renderPortalBranding = (logoImage = '') => {
  document.querySelectorAll('[data-portal-brand]').forEach((brand) => {
    brand.replaceChildren();
    if (logoImage) {
      const image = document.createElement('img');
      image.src = logoImage;
      image.alt = 'Logo do professor';
      image.addEventListener('error', () => {
        brand.replaceChildren();
        const fallback = document.createElement('span');
        fallback.className = 'portal-brand-fallback';
        fallback.textContent = 'Criatyve';
        brand.appendChild(fallback);
      }, { once: true });
      brand.appendChild(image);
      return;
    }
    const fallback = document.createElement('span');
    fallback.className = 'portal-brand-fallback';
    fallback.textContent = 'Criatyve';
    brand.appendChild(fallback);
  });
};

const getThemeContrastColor = (color = '') => {
  const match = String(color).trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return '#ffffff';
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return ((red * 299 + green * 587 + blue * 114) / 1000) >= 150 ? '#111827' : '#ffffff';
};

const applyPortalTheme = (theme = {}) => {
  const backgroundColor = theme.portalBackgroundColor || '#f4f6ff';
  const pageTextColor = theme.portalTextColor || '#101426';
  const cardTextColor = theme.portalCardTextColor || '#101426';
  const cardBackgroundColor = theme.portalCardBackgroundColor || '#ffffff';
  const sidebarBackgroundColor = theme.portalSidebarBackgroundColor || '#070a1f';
  const sidebarTextColor = theme.portalSidebarTextColor || '#ffffff';
  const buttonColor = theme.portalButtonColor || theme.portalAccentColor || '#6d63ff';
  const buttonTextColor = getThemeContrastColor(buttonColor);
  const backgroundImage = typeof theme.portalBackgroundImage === 'string' ? theme.portalBackgroundImage.trim() : '';
  document.documentElement.style.setProperty('--portal-bg', backgroundColor);
  document.documentElement.style.setProperty('--portal-page-text', pageTextColor);
  document.documentElement.style.setProperty('--portal-text', cardTextColor);
  document.documentElement.style.setProperty('--portal-card-text', cardTextColor);
  document.documentElement.style.setProperty('--portal-card-bg', cardBackgroundColor);
  document.documentElement.style.setProperty('--portal-sidebar-bg', sidebarBackgroundColor);
  document.documentElement.style.setProperty('--portal-sidebar-text', sidebarTextColor);
  document.documentElement.style.setProperty('--portal-accent', buttonColor);
  document.documentElement.style.setProperty('--portal-button', buttonColor);
  document.documentElement.style.setProperty('--portal-button-text', buttonTextColor);
  document.body.style.setProperty('--portal-bg', backgroundColor);
  document.body.style.setProperty('--portal-page-text', pageTextColor);
  document.body.style.setProperty('--portal-text', cardTextColor);
  document.body.style.setProperty('--portal-card-text', cardTextColor);
  document.body.style.setProperty('--portal-card-bg', cardBackgroundColor);
  document.body.style.setProperty('--portal-sidebar-bg', sidebarBackgroundColor);
  document.body.style.setProperty('--portal-sidebar-text', sidebarTextColor);
  document.body.style.setProperty('--portal-accent', buttonColor);
  document.body.style.setProperty('--portal-button', buttonColor);
  document.body.style.setProperty('--portal-button-text', buttonTextColor);
  document.body.style.color = pageTextColor;
  document.body.style.backgroundColor = backgroundColor;
  if (backgroundImage) {
    document.body.style.backgroundImage = `linear-gradient(135deg, color-mix(in srgb, ${backgroundColor} 22%, transparent), color-mix(in srgb, ${backgroundColor} 8%, transparent)), url("${backgroundImage}")`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.backgroundPosition = 'center';
  } else {
    document.body.style.backgroundImage = 'none';
    document.body.style.backgroundColor = backgroundColor;
  }
  renderPortalBranding(typeof theme.portalLogoImage === 'string' ? theme.portalLogoImage.trim() : '');
};

const renderProfileAvatarPreview = (image = '', name = '') => {
  const preview = document.getElementById('profileAvatarPreview');
  if (!preview) return;
  const initials = String(name || getCurrentUserData().fullName || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || '?';
  if (image) {
    preview.style.backgroundImage = `url("${image}")`;
    preview.textContent = '';
  } else {
    preview.style.backgroundImage = '';
    preview.textContent = initials;
  }
};

const renderPortalLogoPreview = (image = '') => {
  const preview = document.getElementById('portalLogoPreview');
  if (!preview) return;
  preview.replaceChildren();
  if (image) {
    const logo = document.createElement('img');
    logo.src = image;
    logo.alt = 'Prévia da logo';
    preview.appendChild(logo);
    return;
  }
  const fallback = document.createElement('span');
  fallback.textContent = 'Criatyve';
  preview.appendChild(fallback);
};

const syncPortalThemePreview = () => {
  const preview = document.getElementById('portalThemePreview');
  if (!preview) return;
  const backgroundColor = document.getElementById('portalBackgroundColor')?.value || '#f4f6ff';
  const pageTextColor = document.getElementById('portalTextColor')?.value || '#101426';
  const cardTextColor = document.getElementById('portalCardTextColor')?.value || '#101426';
  const cardBackgroundColor = document.getElementById('portalCardBackgroundColor')?.value || '#ffffff';
  const sidebarBackgroundColor = document.getElementById('portalSidebarBackgroundColor')?.value || '#070a1f';
  const sidebarTextColor = document.getElementById('portalSidebarTextColor')?.value || '#ffffff';
  const buttonColor = document.getElementById('portalAccentColor')?.value || '#6d63ff';
  preview.style.color = pageTextColor;
  preview.style.borderColor = buttonColor;
  preview.style.backgroundColor = backgroundColor;
  preview.style.backgroundImage = pendingPortalBackgroundImage
    ? `linear-gradient(135deg, color-mix(in srgb, ${backgroundColor} 22%, transparent), color-mix(in srgb, ${backgroundColor} 8%, transparent)), url("${pendingPortalBackgroundImage}")`
    : '';
  preview.style.setProperty('--preview-card-bg', cardBackgroundColor);
  preview.style.setProperty('--preview-card-text', cardTextColor);
  preview.style.setProperty('--preview-button', buttonColor);
  preview.style.setProperty('--preview-button-text', getThemeContrastColor(buttonColor));
  preview.style.setProperty('--preview-sidebar-bg', sidebarBackgroundColor);
  preview.style.setProperty('--preview-sidebar-text', sidebarTextColor);
};

const getPortalColorFormValues = () => ({
  portalBackgroundColor: document.getElementById('portalBackgroundColor')?.value || '#f4f6ff',
  portalTextColor: document.getElementById('portalTextColor')?.value || '#101426',
  portalCardTextColor: document.getElementById('portalCardTextColor')?.value || '#101426',
  portalCardBackgroundColor: document.getElementById('portalCardBackgroundColor')?.value || '#ffffff',
  portalSidebarBackgroundColor: document.getElementById('portalSidebarBackgroundColor')?.value || '#070a1f',
  portalSidebarTextColor: document.getElementById('portalSidebarTextColor')?.value || '#ffffff',
  portalButtonColor: document.getElementById('portalAccentColor')?.value || '#6d63ff'
});

const applyPortalColorFormValues = (colors = {}) => {
  const fieldMap = {
    portalBackgroundColor: 'portalBackgroundColor',
    portalTextColor: 'portalTextColor',
    portalCardTextColor: 'portalCardTextColor',
    portalCardBackgroundColor: 'portalCardBackgroundColor',
    portalSidebarBackgroundColor: 'portalSidebarBackgroundColor',
    portalSidebarTextColor: 'portalSidebarTextColor',
    portalButtonColor: 'portalAccentColor'
  };
  Object.entries(fieldMap).forEach(([key, id]) => {
    const input = document.getElementById(id);
    if (input && /^#[0-9a-f]{6}$/i.test(colors[key] || '')) {
      input.value = colors[key];
    }
  });
  syncPortalThemePreview();
};

const renderPortalColorPalettes = (selectedId = '') => {
  const select = document.getElementById('portalColorPaletteSelect');
  const deleteButton = document.getElementById('portalDeletePaletteBtn');
  if (!select) return;
  select.replaceChildren(new Option('Escolha uma paleta salva', ''));
  portalColorPalettes.forEach((palette) => {
    select.appendChild(new Option(palette.name, palette.id));
  });
  select.value = portalColorPalettes.some((palette) => palette.id === selectedId) ? selectedId : '';
  if (deleteButton) deleteButton.disabled = !select.value;
};

const setAccountSettingsStatus = (message, color = '#6d63ff') => {
  const status = document.getElementById('accountSettingsStatus');
  if (!status) return;
  status.textContent = message;
  status.style.color = color;
};

const loadAccountSettings = async () => {
  const hasProfileForm = document.getElementById('accountProfileForm') || document.getElementById('studentProfileForm');
  if (!hasProfileForm) return null;
  const response = await authorizedFetch('/api/student/profile');
  const profile = await response.json();
  pendingProfileImage = profile.profile_image || '';
  pendingPortalBackgroundImage = profile.theme?.portalBackgroundImage || '';
  pendingPortalLogoImage = profile.theme?.portalLogoImage || '';
  portalColorPalettes = Array.isArray(profile.colorPalettes) ? profile.colorPalettes : [];
  setCurrentUserData({
    fullName: profile.full_name,
    role: profile.role,
    profileImage: pendingProfileImage
  });
  renderProfileAvatarPreview(pendingProfileImage, profile.full_name);
  if (document.getElementById('portalThemeForm')) {
    document.getElementById('portalBackgroundColor').value = profile.theme?.portalBackgroundColor || '#f4f6ff';
    document.getElementById('portalTextColor').value = profile.theme?.portalTextColor || '#101426';
    document.getElementById('portalCardTextColor').value = profile.theme?.portalCardTextColor || '#101426';
    document.getElementById('portalCardBackgroundColor').value = profile.theme?.portalCardBackgroundColor || '#ffffff';
    document.getElementById('portalSidebarBackgroundColor').value = profile.theme?.portalSidebarBackgroundColor || '#070a1f';
    document.getElementById('portalSidebarTextColor').value = profile.theme?.portalSidebarTextColor || '#ffffff';
    document.getElementById('portalAccentColor').value = profile.theme?.portalButtonColor || profile.theme?.portalAccentColor || '#6d63ff';
    renderPortalLogoPreview(pendingPortalLogoImage);
    renderPortalColorPalettes();
    syncPortalThemePreview();
  }
  applyPortalTheme(profile.theme || {});
  return profile;
};

const setupAccountSettingsForms = () => {
  document.getElementById('profileImagePickBtn')?.addEventListener('click', () => {
    document.getElementById('profileImageInput')?.click();
  });
  document.getElementById('profileImageClearBtn')?.addEventListener('click', () => {
    pendingProfileImage = '';
    renderProfileAvatarPreview('');
  });
  document.getElementById('profileImageInput')?.addEventListener('change', async (event) => {
    pendingProfileImage = await readLocalImageFile(event.target);
    renderProfileAvatarPreview(pendingProfileImage);
  });
  document.getElementById('portalBackgroundPickBtn')?.addEventListener('click', () => {
    document.getElementById('portalBackgroundImageInput')?.click();
  });
  document.getElementById('portalBackgroundClearBtn')?.addEventListener('click', () => {
    pendingPortalBackgroundImage = '';
    syncPortalThemePreview();
  });
  document.getElementById('portalBackgroundImageInput')?.addEventListener('change', async (event) => {
    pendingPortalBackgroundImage = await readLocalImageFile(event.target);
    syncPortalThemePreview();
  });
  document.getElementById('portalLogoPickBtn')?.addEventListener('click', () => {
    document.getElementById('portalLogoImageInput')?.click();
  });
  document.getElementById('portalLogoClearBtn')?.addEventListener('click', () => {
    pendingPortalLogoImage = '';
    renderPortalLogoPreview('');
  });
  document.getElementById('portalLogoImageInput')?.addEventListener('change', async (event) => {
    pendingPortalLogoImage = await readLocalImageFile(event.target);
    renderPortalLogoPreview(pendingPortalLogoImage);
  });
  ['portalBackgroundColor', 'portalTextColor', 'portalCardTextColor', 'portalCardBackgroundColor', 'portalSidebarBackgroundColor', 'portalSidebarTextColor', 'portalAccentColor'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', syncPortalThemePreview);
  });
  document.getElementById('portalColorPaletteSelect')?.addEventListener('change', (event) => {
    const palette = portalColorPalettes.find((item) => item.id === event.target.value);
    const deleteButton = document.getElementById('portalDeletePaletteBtn');
    if (deleteButton) deleteButton.disabled = !palette;
    if (!palette) return;
    applyPortalColorFormValues(palette.colors);
    setAccountSettingsStatus(`Paleta "${palette.name}" aplicada. Clique em Salvar visual para publicar.`);
  });
  document.getElementById('portalSavePaletteBtn')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('portalPaletteNameInput');
    const name = nameInput?.value?.trim() || '';
    if (!name) {
      setAccountSettingsStatus('Informe um nome para salvar a paleta.', '#dc2626');
      nameInput?.focus();
      return;
    }
    try {
      const response = await authorizedFetch('/api/student/profile/color-palettes', {
        method: 'POST',
        body: JSON.stringify({ name, colors: getPortalColorFormValues() })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Não foi possível salvar a paleta.');
      portalColorPalettes = Array.isArray(result.colorPalettes) ? result.colorPalettes : portalColorPalettes;
      renderPortalColorPalettes(result.palette?.id || '');
      if (nameInput) nameInput.value = '';
      setAccountSettingsStatus('Paleta de cores salva com sucesso.', '#16a34a');
    } catch (error) {
      setAccountSettingsStatus(error.message, '#dc2626');
    }
  });
  document.getElementById('portalDeletePaletteBtn')?.addEventListener('click', async () => {
    const select = document.getElementById('portalColorPaletteSelect');
    const paletteId = select?.value || '';
    if (!paletteId) return;
    try {
      const response = await authorizedFetch(`/api/student/profile/color-palettes/${encodeURIComponent(paletteId)}`, {
        method: 'DELETE'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Não foi possível excluir a paleta.');
      portalColorPalettes = Array.isArray(result.colorPalettes) ? result.colorPalettes : [];
      renderPortalColorPalettes();
      setAccountSettingsStatus('Paleta excluída.', '#16a34a');
    } catch (error) {
      setAccountSettingsStatus(error.message, '#dc2626');
    }
  });
  document.getElementById('portalThemeResetColorsBtn')?.addEventListener('click', () => {
    const defaults = {
      portalBackgroundColor: '#f4f6ff',
      portalTextColor: '#101426',
      portalCardTextColor: '#101426',
      portalCardBackgroundColor: '#ffffff',
      portalSidebarBackgroundColor: '#070a1f',
      portalSidebarTextColor: '#ffffff',
      portalAccentColor: '#6d63ff'
    };
    Object.entries(defaults).forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (input) input.value = value;
    });
    syncPortalThemePreview();
    setAccountSettingsStatus('Cores padrão restauradas. Clique em Salvar visual para confirmar.');
  });
  const saveProfile = async (includeTheme = false) => {
    const payload = { profileImage: pendingProfileImage };
    if (includeTheme) {
      payload.portalBackgroundColor = document.getElementById('portalBackgroundColor')?.value || '#f4f6ff';
      payload.portalBackgroundImage = pendingPortalBackgroundImage;
      payload.portalLogoImage = pendingPortalLogoImage;
      payload.portalTextColor = document.getElementById('portalTextColor')?.value || '#101426';
      payload.portalCardTextColor = document.getElementById('portalCardTextColor')?.value || '#101426';
      payload.portalCardBackgroundColor = document.getElementById('portalCardBackgroundColor')?.value || '#ffffff';
      payload.portalSidebarBackgroundColor = document.getElementById('portalSidebarBackgroundColor')?.value || '#070a1f';
      payload.portalSidebarTextColor = document.getElementById('portalSidebarTextColor')?.value || '#ffffff';
      payload.portalButtonColor = document.getElementById('portalAccentColor')?.value || '#6d63ff';
      payload.portalAccentColor = payload.portalButtonColor;
    }
    const response = await authorizedFetch('/api/student/profile', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || 'Não foi possível salvar as configurações.');
    setCurrentUserData({ profileImage: pendingProfileImage });
    if (includeTheme && result?.theme) {
      pendingPortalLogoImage = result.theme.portalLogoImage || '';
      renderPortalLogoPreview(pendingPortalLogoImage);
      applyPortalTheme(result.theme);
    }
    setAccountSettingsStatus('Configurações salvas com sucesso.', '#16a34a');
  };
  document.getElementById('accountProfileForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveProfile(false);
  });
  document.getElementById('studentProfileForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveProfile(false);
  });
  document.getElementById('portalThemeForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveProfile(true);
  });
};

const setupFaceProfile = () => {
  const statusElement = document.getElementById('faceProfileStatus');
  const enrollButton = document.getElementById('faceEnrollBtn');
  const revokeButton = document.getElementById('faceRevokeBtn');
  const consentToggle = document.getElementById('faceConsentToggle');
  if (!statusElement || !enrollButton || !consentToggle) return;

  const renderStatus = (status) => {
    const enrolled = status?.enrolled === true;
    statusElement.textContent = enrolled
      ? `Rosto cadastrado${status.enrolledAt ? ` em ${new Date(status.enrolledAt).toLocaleDateString('pt-BR')}` : ''}.`
      : status?.status === 'reenrollment_required'
        ? 'Um novo cadastro facial foi solicitado.'
        : 'Nenhum rosto cadastrado.';
    statusElement.classList.toggle('is-active', enrolled);
    enrollButton.textContent = enrolled ? 'Refazer cadastro' : 'Cadastrar rosto';
    revokeButton.hidden = !enrolled;
    consentToggle.checked = enrolled;
    consentToggle.disabled = enrolled;
  };

  const refresh = async () => {
    try {
      renderStatus(await getFaceStatus());
    } catch (error) {
      statusElement.textContent = error.message || 'Não foi possível consultar o cadastro facial.';
    }
  };

  enrollButton.addEventListener('click', async () => {
    if (!consentToggle.checked) {
      alert('Leia e marque o consentimento biométrico antes de continuar.');
      return;
    }
    enrollButton.disabled = true;
    try {
      await runFaceVerification({ mode: 'enrollment', consentAccepted: true });
      await refresh();
      alert('Cadastro facial concluído. As capturas temporárias foram descartadas.');
    } catch (error) {
      if (error.code !== 'FACE_CAPTURE_CANCELED') {
        alert(error.message || 'Não foi possível cadastrar o rosto.');
      }
    } finally {
      enrollButton.disabled = false;
    }
  });

  revokeButton.addEventListener('click', async () => {
    if (!confirm('Revogar o cadastro facial? Módulos protegidos exigirão um novo cadastro.')) return;
    revokeButton.disabled = true;
    try {
      await revokeFaceProfile();
      consentToggle.disabled = false;
      consentToggle.checked = false;
      await refresh();
    } catch (error) {
      alert(error.message || 'Não foi possível revogar o cadastro facial.');
    } finally {
      revokeButton.disabled = false;
    }
  });

  void refresh();
};

const setHorizontalCourseScroll = (container, itemCount, threshold) => {
  if (!container) return;
  container.classList.toggle('is-scrollable', Number(itemCount) > Number(threshold));
};

const getModuleCoverInitials = (title = '') =>
  String(title || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'MD';

const syncCourseCoverModeUi = () => {
  const mode = document.getElementById('courseCoverMode')?.value || 'local';
  const urlField = document.getElementById('courseCoverUrlField');
  if (urlField) {
    urlField.style.display = mode === 'url' ? 'block' : 'none';
  }
};

const syncCourseCoverPreview = () => {
  const preview = document.getElementById('courseCoverPreview');
  const title = document.getElementById('courseCoverPreviewTitle');
  const meta = document.getElementById('courseCoverPreviewMeta');
  const courseTitle = document.getElementById('courseTitle')?.value?.trim() || 'Sem capa';
  if (preview) {
    preview.style.backgroundImage = pendingCourseCoverImage
      ? `linear-gradient(155deg, rgba(16, 20, 52, 0.18), rgba(16, 20, 52, 0.02)), url("${pendingCourseCoverImage}")`
      : '';
  }
  if (title) {
    title.textContent = pendingCourseCoverImage ? courseTitle : 'Sem capa';
  }
  if (meta) {
    meta.textContent = pendingCourseCoverImage
      ? 'Preview da capa principal do curso no portal do aluno.'
      : 'Adicione uma imagem retangular para destacar o curso no portal.';
  }
};

const applyCourseCover = async () => {
  const mode = document.getElementById('courseCoverMode')?.value || 'local';
  if (mode === 'url') {
    const nextCover = document.getElementById('courseCoverUrl')?.value?.trim() || '';
    if (!nextCover) {
      alert('Informe a URL da capa do curso.');
      return;
    }
    pendingCourseCoverImage = nextCover;
    syncCourseCoverPreview();
    return;
  }
  const fileInput = document.getElementById('courseCoverFile');
  if (!fileInput) {
    return;
  }
  fileInput.value = '';
  fileInput.click();
};

const clearCourseCover = () => {
  pendingCourseCoverImage = '';
  const urlInput = document.getElementById('courseCoverUrl');
  const fileInput = document.getElementById('courseCoverFile');
  if (urlInput) {
    urlInput.value = '';
  }
  if (fileInput) {
    fileInput.value = '';
  }
  syncCourseCoverPreview();
};

const syncEditCourseCoverModeUi = () => {
  loadAdminCourses();
};

const syncEditCourseCoverPreview = () => {
  loadAdminCourses();
};

const closeCourseCoverEditor = () => {
  editingCourseCoverId = '';
  editingCourseCoverImage = '';
  editingCourseCoverMode = 'local';
  loadAdminCourses();
};

const openCourseCoverEditor = (courseId) => {
  const course = adminCoursesCache.find((item) => item.id === courseId);
  if (!course) return;
  editingCourseCoverId = course.id;
  editingCourseCoverImage = getCourseCoverImage(course);
  editingCourseCoverMode = editingCourseCoverImage.startsWith('http') ? 'url' : 'local';
  loadAdminCourses();
};

const applyEditCourseCover = async () => {
  const mode = document.querySelector(`[data-course-cover-mode="${editingCourseCoverId}"]`)?.value || editingCourseCoverMode;
  editingCourseCoverMode = mode;
  if (mode === 'url') {
    const nextCover = document.querySelector(`[data-course-cover-url="${editingCourseCoverId}"]`)?.value?.trim() || '';
    if (!nextCover) {
      alert('Informe a URL da nova capa.');
      return;
    }
    editingCourseCoverImage = nextCover;
    loadAdminCourses();
    return;
  }
  const fileInput = document.querySelector(`[data-course-cover-file="${editingCourseCoverId}"]`);
  if (!fileInput) return;
  fileInput.value = '';
  fileInput.click();
};

const updateStudentClassSelect = () => {
  const select = document.getElementById('adminStudentClass');
  if (!select) return;
  if (!adminClassesCache.length) {
    select.innerHTML = '<option value="">Nenhuma turma cadastrada</option>';
    return;
  }
  select.innerHTML = adminClassesCache
    .map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`)
    .join('');
};

const updateNotificationClassSelect = () => {
  const select = document.getElementById('notificationClass');
  if (!select) return;
  const previousValue = select.value;
  if (!adminClassesCache.length) {
    select.innerHTML = '<option value="">Nenhuma turma cadastrada</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = adminClassesCache
    .map((item) => `<option value="${escapeAttribute(item.name)}">${escapeHtml(item.name)}</option>`)
    .join('');
  select.value = adminClassesCache.some((item) => item.name === previousValue)
    ? previousValue
    : adminClassesCache[0].name;
};

const updateNotificationStudentSelect = () => {
  const select = document.getElementById('notificationStudent');
  if (!select) return;
  const previousValue = select.value;
  if (!adminStudentsCache.length) {
    select.innerHTML = '<option value="">Nenhum aluno cadastrado</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = adminStudentsCache
    .map((student) => `<option value="${escapeAttribute(student.id)}">${escapeHtml(student.full_name)} • ${escapeHtml(student.email)}</option>`)
    .join('');
  select.value = adminStudentsCache.some((student) => student.id === previousValue)
    ? previousValue
    : adminStudentsCache[0].id;
};

const renderClassList = () => {
  const list = document.getElementById('classList');
  if (!list) return;
  if (!adminClassesCache.length) {
    list.innerHTML = '<p style="margin:0; color:#8b92b1;">Nenhuma turma cadastrada.</p>';
    return;
  }
  list.innerHTML = adminClassesCache
    .map(
      (item) => `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
          </div>
          <button class="secondary-btn small" type="button" data-class-id="${item.id}">Excluir turma</button>
        </div>`
    )
    .join('');
};

const loadAdminClasses = async () => {
  try {
    const response = await authorizedFetch('/api/admin/classes');
    const classes = await response.json();
    adminClassesCache = Array.isArray(classes) ? classes : [];
    updateStudentClassSelect();
    updateNotificationClassSelect();
    renderClassList();
  } catch (error) {
    adminClassesCache = [];
    updateStudentClassSelect();
    updateNotificationClassSelect();
    renderClassList();
  }
};

const getToken = () => localStorage.getItem(STORAGE_KEY);
const setToken = (token) => localStorage.setItem(STORAGE_KEY, token);
const clearToken = () => localStorage.removeItem(STORAGE_KEY);
let authRedirectPending = false;

const redirectToLogin = () => {
  clearToken();
  localStorage.removeItem(USER_ROLE_KEY);
  localStorage.removeItem('curso-platform-user');
  if (authRedirectPending) return;
  authRedirectPending = true;
  if (!window.location.pathname.endsWith('/login.html')) {
    window.location.replace('login.html');
  }
};

const parseJsonSafely = async (response) => {
  const raw = await response.text();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('A API respondeu em um formato inválido.');
  }
};

const authorizedFetch = async (path, options = {}) => {
  const token = getToken();
  if (!token) {
    redirectToLogin();
    throw new Error('Sessão expirada');
  }
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (/^[0-9a-f]{48}$/i.test(token)) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
  if (response.status === 401) {
    redirectToLogin();
    throw new Error('Sessão expirada');
  }
  if (response.status === 402) {
    window.dispatchEvent(new CustomEvent('subscription-access-required'));
  }
  return response;
};

const sendProgressUpdate = async (payload) => {
  try {
    const body = JSON.stringify(payload);
    await authorizedFetch('/api/student/progress', {
      method: 'POST',
      body
    });
  } catch (error) {
    console.error('Progresso não pôde ser salvo', error);
  }
};

window.sendProgressUpdate = sendProgressUpdate;

const handleLogout = async () => {
  try {
    await authorizedFetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    console.warn('Logout falhou', err);
  } finally {
    clearToken();
    localStorage.removeItem(USER_ROLE_KEY);
    window.location.href = 'login.html';
  }
};

const spotlightSection = (section) => {
  if (!section) return;
  document.querySelectorAll('.section-spotlight').forEach((node) => node.classList.remove('section-spotlight'));
  section.classList.add('section-spotlight');
  if (activeNavCleanupTimer) {
    window.clearTimeout(activeNavCleanupTimer);
  }
  activeNavCleanupTimer = window.setTimeout(() => {
    section.classList.remove('section-spotlight');
  }, 1800);
};

const activateNavLink = (button) => {
  if (!button) return;
  const nav = button.closest('.nav-menu');
  nav?.querySelectorAll('.nav-link').forEach((link) => link.classList.remove('active'));
  button.classList.add('active');
};

const showSectionById = (targetId, button = null) => {
  if (!targetId) return false;

  // Ativa o botão do menu
  if (button) {
    const nav = button.closest('.nav-menu');
    nav?.querySelectorAll('.nav-link').forEach((link) => link.classList.remove('active'));
    button.classList.add('active');
  }

  // Esconde todos os painéis que têm data-section
  document.querySelectorAll('[data-section]').forEach((panel) => {
    panel.style.display = 'none';
  });

  // Mostra apenas os painéis da seção clicada
  document.querySelectorAll(`[data-section="${targetId}"]`).forEach((panel) => {
    panel.style.display = '';
  });

  // Scroll suave ao topo da área de conteúdo
  document.querySelector('.main-panel')?.scrollTo({ top: 0, behavior: 'smooth' });

  return true;
};

const setupWhatsappSupportLinks = () => {
  const cleanPhone = String(WHATSAPP_SUPPORT_PHONE || '').replace(/\D/g, '');
  const href = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(WHATSAPP_SUPPORT_MESSAGE)}`
    : `https://wa.me/?text=${encodeURIComponent(WHATSAPP_SUPPORT_MESSAGE)}`;
  document.querySelectorAll('#adminWhatsappSupportLink').forEach((link) => {
    link.setAttribute('href', href);
  });
};

const setupSideNavigation = () => {
  const hasSections = !!document.querySelector('[data-section]');
  const sidenav = document.getElementById('mobileSidenav');
  const toggleButton = document.getElementById('mobileSidenavToggle');
  const backdrop = document.getElementById('mobileSidenavBackdrop');
  const isMobileViewport = () => window.innerWidth <= 1024;
  const setSidenavOpen = (open) => {
    if (!sidenav || !toggleButton || !backdrop) return;
    sidenav.classList.toggle('is-open', open);
    backdrop.classList.toggle('is-visible', open);
    backdrop.hidden = !open;
    toggleButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('mobile-sidenav-open', open);
  };
  const closeSidenav = () => setSidenavOpen(false);
  const toggleSidenav = () => setSidenavOpen(!sidenav?.classList.contains('is-open'));

  mobileSidenavCleanup?.();
  mobileSidenavCleanup = null;

  if (toggleButton && sidenav && backdrop) {
    const handleToggle = () => toggleSidenav();
    const handleBackdropClick = () => closeSidenav();
    const handleResize = () => {
      if (!isMobileViewport()) {
        closeSidenav();
      }
    };
    toggleButton.addEventListener('click', handleToggle);
    backdrop.addEventListener('click', handleBackdropClick);
    window.addEventListener('resize', handleResize);
    mobileSidenavCleanup = () => {
      toggleButton.removeEventListener('click', handleToggle);
      backdrop.removeEventListener('click', handleBackdropClick);
      window.removeEventListener('resize', handleResize);
    };
    closeSidenav();
  }

  document.querySelectorAll('.nav-link[data-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.target;
      if (!targetId) return;
      if (hasSections) {
        showSectionById(targetId, button);
      } else {
        scrollToSectionById(targetId, button);
      }
      if (isMobileViewport()) {
        closeSidenav();
      }
    });
  });

  // Ativa a primeira aba ao carregar
  if (hasSections) {
    const requestedSection = new URLSearchParams(window.location.search).get('section');
    const requestedButton = requestedSection
      ? document.querySelector(`.nav-link[data-target="${CSS.escape(requestedSection)}"]`)
      : null;
    const firstBtn = requestedButton || document.querySelector('.nav-link[data-target]');
    if (firstBtn) showSectionById(firstBtn.dataset.target, firstBtn);
  }

  document.querySelectorAll('[data-target].course-module-pill').forEach((button) => {
    button.addEventListener('click', () => {
      scrollToSectionById(button.dataset.target);
    });
  });
};


const setupLogoutButtons = () => {
  document.querySelectorAll('.logout-btn').forEach((btn) => {
    btn.addEventListener('click', handleLogout);
  });
};

const formatDate = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleString();
};

const formatMinutes = (value) => {
  const minutes = Math.floor((Number(value) || 0) / 60);
  return `${minutes} min`;
};

const formatGrade = (value) => {
  if (value === null || value === undefined) {
    return '—';
  }
  return `${Number(value).toFixed(1)}%`;
};

const normalizeJsonMap = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const clampPercent = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const formatSecondsAsMinutes = (seconds) => {
  const totalSeconds = Math.max(0, Number(seconds) || 0);
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  return `${Math.round(totalSeconds / 60)}min`;
};

const buildModulePerformanceMetrics = (row = {}) => {
  const progress = normalizeJsonMap(row.progress);
  const interactiveMap = normalizeJsonMap(row.interactive_progress || progress.interactive_progress);
  const videoMap = normalizeJsonMap(row.video_progress || progress.video_progress);
  const quizMap = normalizeJsonMap(row.quiz_attempts || progress.quiz_attempts);
  const modules = sortModulesForPhase(row.modules || []);
  const moduleTitleById = new Map(modules.map((module, index) => [module.id, module.title || `Módulo ${index + 1}`]));
  const moduleIds = new Set();
  modules.forEach((module) => module?.id && moduleIds.add(module.id));
  Object.keys(interactiveMap).forEach((moduleId) => moduleId && moduleIds.add(moduleId));
  Object.values(videoMap).forEach((entry) => {
    if (entry?.moduleId) moduleIds.add(entry.moduleId);
  });
  Object.keys(quizMap).forEach((key) => {
    const moduleId = String(key || '').split('::')[0];
    if (moduleId) moduleIds.add(moduleId);
  });
  if (!moduleIds.size && row.current_module) {
    moduleIds.add('current');
  }
  return Array.from(moduleIds).map((moduleId, index) => {
    const interactive = interactiveMap[moduleId] || {};
    const viewedSlides = Array.isArray(interactive.viewedSlides) ? interactive.viewedSlides.length : 0;
    const completedSlides = Array.isArray(interactive.completedSlides) ? interactive.completedSlides.length : 0;
    const totalSlides = Number(interactive.totalSlides) || Math.max(viewedSlides, completedSlides, 0);
    const slidePercent = totalSlides > 0 ? clampPercent((completedSlides / totalSlides) * 100) : 0;
    const videoEntries = Object.values(videoMap).filter((entry) => entry?.moduleId === moduleId);
    const watchedSeconds = videoEntries.reduce((sum, entry) => sum + Math.min(Number(entry.watchedSeconds) || 0, Number(entry.durationSeconds) || Number(entry.watchedSeconds) || 0), 0);
    const durationSeconds = videoEntries.reduce((sum, entry) => sum + (Number(entry.durationSeconds) || 0), 0);
    const completedVideos = videoEntries.filter((entry) => entry?.completed).length;
    const videoPercent = durationSeconds > 0
      ? clampPercent((watchedSeconds / durationSeconds) * 100)
      : (videoEntries.length ? clampPercent((completedVideos / videoEntries.length) * 100) : 0);
    const quizEntries = Object.entries(quizMap).filter(([key]) => String(key || '').startsWith(`${moduleId}::`));
    const answeredQuizzes = quizEntries.filter(([, attempt]) => attempt?.answered).length;
    const correctQuizzes = quizEntries.filter(([, attempt]) => attempt?.answered && attempt?.isCorrect).length;
    const gradePercent = answeredQuizzes > 0 ? clampPercent((correctQuizzes / answeredQuizzes) * 100) : null;
    const availableScores = [slidePercent, videoEntries.length ? videoPercent : null, gradePercent].filter((value) => value !== null);
    const performanceScore = availableScores.length
      ? availableScores.reduce((sum, value) => sum + value, 0) / availableScores.length
      : 0;
    return {
      moduleId,
      label: moduleTitleById.get(moduleId) || (moduleId === 'current' ? (row.current_module || progress.current_module || 'Módulo atual') : `Módulo ${index + 1}`),
      gradePercent,
      answeredQuizzes,
      correctQuizzes,
      viewedSlides,
      completedSlides,
      totalSlides,
      slidePercent,
      videoCount: videoEntries.length,
      completedVideos,
      watchedSeconds,
      durationSeconds,
      videoPercent,
      performanceScore
    };
  });
};

const renderMiniProgressBar = (value, tone = 'primary') => `
  <span class="mini-progress-bar ${tone}">
    <span style="width:${clampPercent(value).toFixed(1)}%;"></span>
  </span>
`;

const renderModulePerformanceSummary = (row = {}) => {
  const metrics = buildModulePerformanceMetrics(row);
  if (!metrics.length) {
    return '<span style="color:#8b92b1;">Sem dados detalhados.</span>';
  }
  return `
    <div class="module-performance-grid">
      ${metrics.map((metric) => `
        <article class="module-performance-card">
          <div class="module-performance-head">
            <strong title="${escapeAttribute(metric.moduleId)}">${escapeHtml(metric.label)}</strong>
            <span>${metric.performanceScore.toFixed(0)}%</span>
          </div>
          ${renderMiniProgressBar(metric.performanceScore, 'score')}
          <div class="module-performance-metrics">
            <span><b>Nota</b>${metric.gradePercent === null ? 'Sem nota' : `${metric.gradePercent.toFixed(0)}% (${metric.correctQuizzes}/${metric.answeredQuizzes})`}</span>
            <span><b>Vídeos</b>${metric.videoCount ? `${metric.completedVideos}/${metric.videoCount} • ${formatSecondsAsMinutes(metric.watchedSeconds)}` : '0 vistos'}</span>
            <span><b>Slides</b>${metric.totalSlides ? `${metric.completedSlides}/${metric.totalSlides} • ${metric.viewedSlides} vistos` : `${metric.viewedSlides} vistos`}</span>
          </div>
          <div class="module-performance-bars">
            <label><span>Vídeo</span>${renderMiniProgressBar(metric.videoPercent, 'video')}</label>
            <label><span>Slides</span>${renderMiniProgressBar(metric.slidePercent, 'slides')}</label>
            <label><span>Nota</span>${renderMiniProgressBar(metric.gradePercent ?? 0, 'grade')}</label>
          </div>
        </article>
      `).join('')}
    </div>
  `;
};

const buildReportModulePanelKey = (row = {}, scope = 'pending') =>
  `${scope}:${row.user_id || 'user'}:${row.course_id || 'course'}`;

const renderModulePerformanceToggle = (row = {}, scope = 'pending') => {
  const metrics = buildModulePerformanceMetrics(row);
  const key = buildReportModulePanelKey(row, scope);
  if (!metrics.length) {
    return '<span style="color:#8b92b1;">Sem dados detalhados.</span>';
  }
  const averageScore = metrics.reduce((sum, metric) => sum + metric.performanceScore, 0) / metrics.length;
  return `
    <button
      class="secondary-btn small module-performance-toggle"
      type="button"
      data-module-performance-toggle="${escapeAttribute(key)}"
      aria-expanded="false"
    >
      <span class="module-performance-toggle-label">Ver módulos</span>
      <span class="module-performance-toggle-meta">${metrics.length} • ${averageScore.toFixed(0)}%</span>
    </button>
  `;
};

const renderReportRows = (row = {}, scope = 'pending') => {
  const panelKey = buildReportModulePanelKey(row, scope);
  const isCorrected = scope === 'corrected';
  const showOwnerColumn = isGlobalAdminUser();
  const detailColspan = showOwnerColumn ? 7 : 6;
  return `
    <tr>
      <td data-label="Aluno">
        <strong>${escapeHtml(row.full_name)}</strong>
        <small style="display:block; color:#8b92b1;">${escapeHtml(row.email)}</small>
      </td>
      <td data-label="Curso">${escapeHtml(row.course_title)}</td>
      ${showOwnerColumn ? `
        <td data-label="Professor">
          <strong>${escapeHtml(formatOwnerLabel(row))}</strong>
          ${row.owner_email ? `<small style="display:block; color:#8b92b1;">${escapeHtml(row.owner_email)}</small>` : ''}
        </td>
      ` : ''}
      <td data-label="Módulo atual">${escapeHtml(row.current_module || 'Módulo 1')}</td>
      <td data-label="Desempenho">${renderModulePerformanceToggle(row, scope)}</td>
      <td data-label="${isCorrected ? 'Corrigido em' : 'Atualizado em'}">${formatDate(isCorrected ? row.report_corrected_at : row.updated_at)}</td>
      <td data-label="Ações">
        <div class="report-action-group">
          <button class="secondary-btn small report-action-btn" type="button" data-progress-timeline-user="${escapeAttribute(row.user_id)}" data-progress-timeline-course="${escapeAttribute(row.course_id)}">
            Ver passos${Number(row.progress_event_count) > 0 ? ` (${Number(row.progress_event_count)})` : ''}
          </button>
          ${isCorrected
            ? `<button class="secondary-btn small report-action-btn" type="button" data-corrected-delete-user="${escapeAttribute(row.user_id)}" data-corrected-delete-course="${escapeAttribute(row.course_id)}">Excluir</button>`
            : `<button class="primary-btn small report-action-btn" type="button" data-report-correct-user="${escapeAttribute(row.user_id)}" data-report-correct-course="${escapeAttribute(row.course_id)}">Corrigir</button>`}
        </div>
      </td>
    </tr>
    <tr class="module-performance-detail-row" data-module-performance-panel="${escapeAttribute(panelKey)}" hidden>
      <td colspan="${detailColspan}">
        <div class="module-performance-detail-card">
          <div class="module-performance-detail-head">
            <strong>Desempenho por módulos</strong>
            <span>${escapeHtml(row.full_name || 'Aluno')}</span>
          </div>
          ${renderModulePerformanceSummary(row)}
        </div>
      </td>
    </tr>
  `;
};

const toggleReportModulePanel = (button) => {
  if (!button) return;
  const key = button.dataset.modulePerformanceToggle || '';
  const tableBody = button.closest('tbody');
  const panelRow = Array.from(tableBody?.querySelectorAll('[data-module-performance-panel]') || [])
    .find((node) => node.dataset.modulePerformancePanel === key);
  if (!panelRow) return;
  const willOpen = panelRow.hidden;
  panelRow.hidden = !willOpen;
  button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  button.classList.toggle('is-open', willOpen);
  const label = button.querySelector('.module-performance-toggle-label');
  if (label) label.textContent = willOpen ? 'Ocultar módulos' : 'Ver módulos';
};

const getAverageModuleGrade = (row = {}) => {
  const grades = buildModulePerformanceMetrics(row)
    .map((metric) => metric.gradePercent)
    .filter((value) => value !== null && Number.isFinite(Number(value)));
  if (!grades.length) return null;
  return grades.reduce((sum, value) => sum + Number(value), 0) / grades.length;
};

const updateEnrollmentStudentSelect = () => {
  const select = document.getElementById('enrollmentStudent');
  if (!select) return;
  const previousValue = select.value;
  if (!adminStudentsCache.length) {
    select.innerHTML = '<option value="">Nenhum aluno cadastrado</option>';
    renderEnrollmentList();
    return;
  }
  select.innerHTML = adminStudentsCache
    .map((student) => `<option value="${student.id}">${student.full_name} (${student.email})</option>`)
    .join('');
  const hasPrevious = adminStudentsCache.some((student) => student.id === previousValue);
  select.value = hasPrevious ? previousValue : adminStudentsCache[0].id;
  renderEnrollmentList();
};

const updateEnrollmentCourseSelect = () => {
  const select = document.getElementById('enrollmentCourse');
  if (!select) return;
  if (!adminCoursesCache.length) {
    select.innerHTML = '<option value="">Nenhum curso criado</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = adminCoursesCache
    .map((course) => `<option value="${course.id}">${course.title}</option>`)
    .join('');
};

const renderEnrollmentList = () => {
  const list = document.getElementById('enrollmentList');
  const studentSelect = document.getElementById('enrollmentStudent');
  if (!list || !studentSelect) return;
  const studentId = studentSelect.value;
  const student = adminStudentsCache.find((record) => record.id === studentId);
  if (!student) {
    list.innerHTML = '<p style="margin:0; color:#8b92b1;">Inclua um aluno para começar.</p>';
    return;
  }
  const enrollments = student.enrollments || [];
  if (!enrollments.length) {
    list.innerHTML = '<p style="margin:0; color:#8b92b1;">O aluno ainda não foi matriculado em nenhum curso.</p>';
    return;
  }
  list.innerHTML = enrollments
    .map(
      (course) => `
      <div class="list-item">
        <div>
          <strong>${course.title}</strong>
          <p style="margin:0; color:#8b92b1; font-size:0.85rem;">${course.description || course.slug}</p>
          <small style="color:#8b92b1; font-size:0.75rem;">Módulo atual: ${course.current_module || '—'}</small>
        </div>
        <button class="secondary-btn small" type="button" data-student-id="${student.id}" data-course-id="${course.id}">
          Remover módulo
        </button>
      </div>`
    )
    .join('');
};

const removeEnrollmentFromStudent = async (studentId, courseId, options = {}) => {
  if (!studentId || !courseId) {
    alert('Aluno e curso precisam estar selecionados para remover o módulo.');
    return;
  }
  const { confirmMessage, successMessage } = options;
  if (confirmMessage && !confirm(confirmMessage)) {
    return;
  }
  try {
    await authorizedFetch(`/api/admin/students/${studentId}/enrollments/${courseId}`, { method: 'DELETE' });
    await loadAdminStudents();
    await loadReports();
    if (successMessage) {
      alert(successMessage);
    }
  } catch (error) {
    alert(error.message || 'Não foi possível remover o curso do aluno.');
  }
};

const openCourseModule = (courseId, moduleId) => {
  if (!courseId) return;
  const params = [`courseId=${encodeURIComponent(courseId)}`];
  if (moduleId) {
    params.push(`moduleId=${encodeURIComponent(moduleId)}`);
  }
  window.location.href = `module-viewer.html?${params.join('&')}`;
};

const sortModulesForPhase = (modules = []) =>
  modules.slice().sort((a, b) => {
    const positionDiff = (a.position ?? 0) - (b.position ?? 0);
    if (positionDiff !== 0) return positionDiff;
    const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return dateA - dateB;
  });

const getCourseModuleProgressMap = (course) =>
  course?.progress?.interactive_progress && typeof course.progress.interactive_progress === 'object'
    ? course.progress.interactive_progress
    : {};

const isCourseModuleCompleted = (course, module) => {
  const entry = getCourseModuleProgressMap(course)[module?.id];
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const totalSlides = Number(entry.totalSlides) || 0;
  const completedSlides = Array.isArray(entry.completedSlides) ? entry.completedSlides.length : 0;
  return totalSlides > 0 && completedSlides >= totalSlides;
};

const shouldLockNextCourseModule = (module) => Boolean(module?.builder_data?.moduleSettings?.lockNextModuleUntilCompleted);

const getUnlockedCourseModuleIds = (course) => {
  const modules = sortModulesForPhase(course?.modules || []);
  const unlocked = new Set();
  modules.forEach((module, index) => {
    if (index === 0) {
      unlocked.add(module.id);
      return;
    }
    const previousModule = modules[index - 1];
    if (!previousModule || !shouldLockNextCourseModule(previousModule) || isCourseModuleCompleted(course, previousModule)) {
      unlocked.add(module.id);
    }
  });
  return unlocked;
};

const getRecommendedCourseModule = (course) => {
  const modules = sortModulesForPhase(course?.modules || []);
  const unlocked = getUnlockedCourseModuleIds(course);
  const firstIncompleteUnlocked = modules.find((module) => unlocked.has(module.id) && !isCourseModuleCompleted(course, module));
  return firstIncompleteUnlocked || modules.find((module) => unlocked.has(module.id)) || modules[0] || null;
};

const getLockedCourseModuleReason = (course, targetModule) => {
  const modules = sortModulesForPhase(course?.modules || []);
  const targetIndex = modules.findIndex((module) => module.id === targetModule?.id);
  if (targetIndex <= 0) {
    return 'Este módulo já está disponível.';
  }
  const previousModule = modules[targetIndex - 1];
  if (!previousModule || !shouldLockNextCourseModule(previousModule)) {
    return 'Este módulo já está disponível.';
  }
  const progressEntry = getCourseModuleProgressMap(course)[previousModule.id];
  const totalSlides = Number(progressEntry?.totalSlides) || ((previousModule.builder_data?.slides || []).length || 0);
  const completedSlides = Array.isArray(progressEntry?.completedSlides) ? progressEntry.completedSlides.length : 0;
  const remainingSlides = Math.max(0, totalSlides - completedSlides);
  if (remainingSlides > 0) {
    return `Para liberar "${targetModule.title}", conclua antes o módulo "${previousModule.title}". Ainda faltam ${remainingSlides} slide(s).`;
  }
  return `Para liberar "${targetModule.title}", conclua antes o módulo "${previousModule.title}".`;
};

const createCourseCard = (course) => {
  const card = document.createElement('article');
  card.className = 'course-card';
  const position = Number(course.progress?.video_position) || 0;
  const videoProgressMap =
    course.progress?.video_progress && typeof course.progress.video_progress === 'object'
      ? course.progress.video_progress
      : {};
  const videoEntries = Object.values(videoProgressMap).filter((entry) => entry && typeof entry === 'object');
  const totalVideoDuration = videoEntries.reduce((sum, entry) => sum + (Number(entry.durationSeconds) || 0), 0);
  const watchedVideoDuration = videoEntries.reduce(
    (sum, entry) => sum + Math.min(Number(entry.watchedSeconds) || 0, Number(entry.durationSeconds) || 0),
    0
  );
  const progressPercent = totalVideoDuration
    ? Math.min(100, (watchedVideoDuration / totalVideoDuration) * 100)
    : Math.min(100, (position / 3600) * 100);
  const interactiveProgressMap =
    course.progress?.interactive_progress && typeof course.progress.interactive_progress === 'object'
      ? course.progress.interactive_progress
      : {};
  const interactiveModules = Object.values(interactiveProgressMap).filter((entry) => entry && typeof entry === 'object');
  const totalInteractiveSlides = interactiveModules.reduce((sum, entry) => sum + (Number(entry.totalSlides) || 0), 0);
  const completedInteractiveSlides = interactiveModules.reduce(
    (sum, entry) => sum + (Array.isArray(entry.completedSlides) ? entry.completedSlides.length : 0),
    0
  );
  const interactiveLabel = totalInteractiveSlides
    ? `${completedInteractiveSlides}/${totalInteractiveSlides} slides`
    : (course.progress?.interactive_step || '0/0 slides').toString();
  const modules = sortModulesForPhase(course.modules || []);
  const unlockedModuleIds = getUnlockedCourseModuleIds(course);
  const recommendedModule = getRecommendedCourseModule(course);
  const courseCover = getCourseCoverImage(course);
  const recommendedCover = courseCover || getModuleCoverImage(recommendedModule);
  const coverStripMarkup = modules.length
    ? `<div class="course-module-cover-strip" role="list" aria-label="Preview dos módulos">
         ${modules
           .map((module) => {
             const coverImage = getModuleCoverImage(module);
             const isUnlocked = unlockedModuleIds.has(module.id);
             const isRecommended = recommendedModule?.id === module.id;
             return `<button type="button" class="course-module-cover ${isUnlocked ? '' : 'locked'} ${isRecommended ? 'active' : ''}" data-module-id="${module.id}" data-locked="${isUnlocked ? 'false' : 'true'}" aria-label="${escapeHtml(module.title)}">
               <span class="course-module-cover-art"${coverImage ? ` style="background-image:url('${coverImage.replace(/'/g, "\\'")}')"` : ''}>
                 ${coverImage ? '' : `<span class="course-module-cover-fallback">${escapeHtml(getModuleCoverInitials(module.title))}</span>`}
               </span>
               <span class="course-module-cover-label">${escapeHtml(module.title)}</span>
             </button>`;
           })
           .join('')}
       </div>`
    : '';
  card.innerHTML = `
    <div class="course-card-top">
      <div class="course-card-headline">
        <strong>${course.title}</strong>
      </div>
      ${
        recommendedModule
          ? `<div class="course-hero-preview ${recommendedCover ? 'has-cover' : ''}">
              <div class="course-hero-cover"${recommendedCover ? ` style="background-image:url('${recommendedCover.replace(/'/g, "\\'")}')"` : ''}>
                ${recommendedCover ? '' : `<span>${escapeHtml(getModuleCoverInitials(course.title))}</span>`}
              </div>
              <div class="course-hero-copy">
                <small class="muted">Próximo módulo</small>
                <strong>${escapeHtml(recommendedModule.title)}</strong>
                <span>${escapeHtml(recommendedModule.description || 'Continue de onde você parou com um preview visual do próximo passo.')}</span>
              </div>
            </div>`
          : ''
      }
      ${coverStripMarkup}
    </div>
    <div class="course-card-meta">
      <span class="badge">${interactiveLabel}</span>
      <p style="margin:0; font-size:0.75rem; color:#8b92b1;">${progressPercent.toFixed(0)}% do vídeo</p>
    </div>
  `;
  if (recommendedModule) {
    card.classList.add('clickable-card');
    card.addEventListener('click', (event) => {
      const pill = event.target.closest('.course-module-cover');
      if (pill) {
        event.stopPropagation();
        const selectedModule = modules.find((module) => module.id === pill.dataset.moduleId);
        if (pill.dataset.locked === 'true') {
          alert(getLockedCourseModuleReason(course, selectedModule));
          return;
        }
        openCourseModule(course.id, pill.dataset.moduleId);
        return;
      }
      openCourseModule(course.id, recommendedModule.id);
    });
  }
  const actionButton = document.createElement('button');
  actionButton.type = 'button';
  actionButton.className = recommendedModule ? 'primary-btn course-card-btn' : 'secondary-btn course-card-btn';
  actionButton.textContent = recommendedModule ? 'Continuar módulo' : 'Aguardando módulo';
  actionButton.disabled = !recommendedModule;
  if (recommendedModule) {
    actionButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openCourseModule(course.id, recommendedModule.id);
    });
  }
  card.appendChild(actionButton);

  // Botão de Chat do Curso
  const chatButton = document.createElement('button');
  chatButton.type = 'button';
  chatButton.className = 'chat-btn';
  chatButton.innerHTML = '💬 Chat do curso';
  chatButton.addEventListener('click', (event) => {
    event.stopPropagation();
    openCourseChat(course.id, course.title);
  });
  card.appendChild(chatButton);

  return card;
};

const renderCourses = (courses) => {
  cachedCourses = courses;
  courseGrid = document.getElementById('courseGrid');
  if (!courseGrid) return;
  courseGrid.innerHTML = '';
  setHorizontalCourseScroll(courseGrid, courses.length, 3);
  if (!courses.length) {
    courseGrid.innerHTML = '<p class="muted" style="margin:0;">Voc\u00ea ainda n\u00e3o est\u00e1 matriculado em nenhum curso.</p>';
    return;
  }
  courses.forEach((course) => courseGrid.appendChild(createCourseCard(course)));
};

const createStoreCourseCard = (course) => {
  const card = document.createElement('article');
  card.className = 'course-card store-course-card';
  const coverImage = getCourseCoverImage(course);
  const moduleCount = Number(course.module_count) || 0;
  const requestPending = course.access_request_status === 'pending';
  card.innerHTML = `
    <div class="course-card-top">
      <div class="course-cover-preview-card store-course-cover"${coverImage ? ` style="background-image:linear-gradient(155deg, rgba(16, 20, 52, 0.18), rgba(16, 20, 52, 0.02)), url('${coverImage.replace(/'/g, "\\'")}')"` : ''}>
        <div class="course-cover-preview-copy">
          <strong>${escapeHtml(course.title)}</strong>
          <small>${moduleCount ? `${moduleCount} m\u00f3dulo(s) dispon\u00edveis` : 'Nova trilha dispon\u00edvel'}</small>
        </div>
      </div>
      <div class="course-card-headline">
        <strong>${escapeHtml(course.title)}</strong>
        <span class="store-course-description">${escapeHtml(course.description || 'Sem descri\u00e7\u00e3o cadastrada para este curso.')}</span>
      </div>
    </div>
    <div class="course-card-meta">
      <span class="badge">${moduleCount ? `${moduleCount} m\u00f3dulo(s)` : 'Em apresenta\u00e7\u00e3o'}</span>
      <p class="store-course-status">${requestPending ? 'Solicita\u00e7\u00e3o enviada ao admin.' : 'Dispon\u00edvel para solicitar acesso.'}</p>
    </div>
    <button type="button" class="${requestPending ? 'secondary-btn' : 'primary-btn'} course-card-btn" data-store-course-id="${course.id}" ${requestPending ? 'disabled' : ''}>
      ${requestPending ? 'Aguardando libera\u00e7\u00e3o' : 'Solicitar acesso'}
    </button>
  `;
  return card;
};

const renderStoreCourses = (courses) => {
  cachedStoreCourses = courses;
  courseStoreGrid = document.getElementById('courseStoreGrid');
  if (!courseStoreGrid) return;
  courseStoreGrid.innerHTML = '';
  setHorizontalCourseScroll(courseStoreGrid, courses.length, 4);
  if (!courses.length) {
    courseStoreGrid.innerHTML = '<p class="muted" style="margin:0;">Nenhum curso extra dispon\u00edvel na loja no momento.</p>';
    return;
  }
  courses.forEach((course) => courseStoreGrid.appendChild(createStoreCourseCard(course)));
};

const loadStoreCourses = async () => {
  courseStoreGrid = document.getElementById('courseStoreGrid');
  try {
    const response = await authorizedFetch('/api/student/store-courses');
    const courses = await response.json();
    renderStoreCourses(Array.isArray(courses) ? courses : []);
  } catch (error) {
    if (courseStoreGrid) {
      courseStoreGrid.innerHTML = '<p class="muted" style="margin:0; color:#ff6b6b;">N\u00e3o foi poss\u00edvel carregar a loja de cursos.</p>';
    }
  }
};

const requestStoreCourseAccess = async (courseId) => {
  if (!courseId) return;
  try {
    const response = await authorizedFetch(`/api/student/store-courses/${courseId}/request-access`, {
      method: 'POST'
    });
    const data = await parseJsonSafely(response);
    if (!response.ok) {
      throw new Error(data?.message || 'N\u00e3o foi poss\u00edvel solicitar acesso.');
    }
    await loadStoreCourses();
    alert('Solicita\u00e7\u00e3o enviada para o admin.');
  } catch (error) {
    alert(error.message || 'N\u00e3o foi poss\u00edvel solicitar acesso.');
  }
};

const openLiveStageShare = (shareId) => {
  if (!shareId) return;
  window.location.href = `module-viewer.html?liveShareId=${encodeURIComponent(shareId)}`;
};

const createLiveStageCard = (share) => {
  const card = document.createElement('article');
  card.className = 'course-card';
  const updatedAtLabel = share?.updatedAt
    ? new Date(share.updatedAt).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
    : 'agora';
  card.innerHTML = `
    <div class="course-card-top">
      <div class="course-card-headline">
        <span class="badge">Ao vivo agora</span>
        <strong>${escapeHtml(share.title || 'Palco ao vivo')}</strong>
        <span class="store-course-description">${escapeHtml(share.courseTitle || 'Aula ao vivo')}</span>
      </div>
    </div>
    <div class="course-card-meta">
      <span class="badge">${escapeHtml(share.courseTitle || 'Aula ao vivo')}</span>
      <p class="store-course-status">${escapeHtml(share.description || `Atualizado em ${updatedAtLabel}.`)}</p>
    </div>
  `;
  const actionButton = document.createElement('button');
  actionButton.type = 'button';
  actionButton.className = 'primary-btn course-card-btn';
  actionButton.textContent = 'Entrar no ao vivo';
  actionButton.addEventListener('click', () => openLiveStageShare(share.shareId));
  card.appendChild(actionButton);
  card.addEventListener('click', () => openLiveStageShare(share.shareId));
  card.classList.add('clickable-card');
  return card;
};

const renderLiveStageShares = (shares) => {
  liveStageGrid = document.getElementById('liveStageGrid');
  if (!liveStageGrid) return;
  liveStageGrid.innerHTML = '';
  setHorizontalCourseScroll(liveStageGrid, shares.length, 3);
  if (!shares.length) {
    liveStageGrid.innerHTML = '<p class="muted" style="margin:0;">Nenhuma aula ao vivo dispon\u00edvel no momento.</p>';
    return;
  }
  shares.forEach((share) => liveStageGrid.appendChild(createLiveStageCard(share)));
};

const loadLiveStageShares = async () => {
  liveStageGrid = document.getElementById('liveStageGrid');
  try {
    const response = await authorizedFetch('/api/student/live-stage');
    const shares = await response.json();
    renderLiveStageShares(Array.isArray(shares) ? shares : []);
  } catch (error) {
    if (liveStageGrid) {
      liveStageGrid.innerHTML = '<p class="muted" style="margin:0; color:#ff6b6b;">N\u00e3o foi poss\u00edvel carregar as aulas ao vivo.</p>';
    }
  }
};

const startLiveStagePolling = () => {
  if (liveStagePollTimer) {
    window.clearInterval(liveStagePollTimer);
  }
  liveStagePollTimer = window.setInterval(() => {
    loadLiveStageShares();
  }, 5000);
};

const renderNotifications = async () => {
  const panel = document.getElementById('notificationPanel');
  if (!panel) return;
  try {
    const response = await authorizedFetch('/api/student/notifications');
    const data = await response.json();
    panel.innerHTML = '<h2>Notifica\u00e7\u00f5es</h2>';
    if (!data.length) {
      panel.innerHTML += '<div class="notification"><p style="margin:0; color:#8b92b1;">Sem novas notifica\u00e7\u00f5es.</p></div>';
      return;
    }
    data.forEach((note) => {
      const item = document.createElement('div');
      item.className = 'notification';
      item.dataset.notificationId = note.id;
      item.innerHTML = `
        <p style="margin:0;">${linkifyText(note.message)}</p>
        ${renderNotificationAttachments(note.attachments)}
        <small style="color:#8b92b1;">${escapeHtml(new Date(note.created_at).toLocaleString())}</small>
      `;
      panel.appendChild(item);
    });
  } catch (err) {
    console.error(err);
  }
};

const renderDashboard = async () => {
  try {
    const [profileRes, coursesRes] = await Promise.all([
      authorizedFetch('/api/student/profile'),
      authorizedFetch('/api/student/courses?lite=1')
    ]);
    const [profile, courses] = await Promise.all([
      profileRes.json(),
      coursesRes.json()
    ]);
    const nameElem = document.getElementById('studentDisplayName');
    if (nameElem) {
      nameElem.textContent = profile.full_name;
    }
    pendingProfileImage = profile.profile_image || '';
    setCurrentUserData({ fullName: profile.full_name, role: profile.role, profileImage: pendingProfileImage });
    renderProfileAvatarPreview(pendingProfileImage, profile.full_name);
    applyPortalTheme(profile.theme || {});
    renderCourses(courses);
    const secondaryLoads = [
      loadLiveStageShares(),
      loadStoreCourses(),
      renderNotifications()
    ];
    if (courses[0]) {
      const progress = courses[0].progress || {};
      const videoProgressMap =
        progress.video_progress && typeof progress.video_progress === 'object'
          ? progress.video_progress
          : {};
      const videoEntries = Object.values(videoProgressMap).filter((entry) => entry && typeof entry === 'object');
      const totalVideoDuration = videoEntries.reduce((sum, entry) => sum + (Number(entry.durationSeconds) || 0), 0);
      const watchedVideoDuration = videoEntries.reduce(
        (sum, entry) => sum + Math.min(Number(entry.watchedSeconds) || 0, Number(entry.durationSeconds) || 0),
        0
      );
      const videoPercent = totalVideoDuration
        ? Math.min(100, (watchedVideoDuration / totalVideoDuration) * 100)
        : Math.min(100, ((Number(progress.video_position) || 0) / 3600) * 100);
      const interactiveProgressMap =
        progress.interactive_progress && typeof progress.interactive_progress === 'object'
          ? progress.interactive_progress
          : {};
      const interactiveModules = Object.values(interactiveProgressMap).filter((entry) => entry && typeof entry === 'object');
      const totalInteractiveSlides = interactiveModules.reduce((sum, entry) => sum + (Number(entry.totalSlides) || 0), 0);
      const completedInteractiveSlides = interactiveModules.reduce(
        (sum, entry) => sum + (Array.isArray(entry.completedSlides) ? entry.completedSlides.length : 0),
        0
      );
      const interactivePercent = totalInteractiveSlides
        ? Math.min(100, (completedInteractiveSlides / totalInteractiveSlides) * 100)
        : 0;
      document.getElementById('videoTitle').textContent = courses[0].title;
      document.getElementById('videoTimestamp').textContent = `${Math.floor((Number(progress.video_position) || 0) / 60)} min`;
      document.getElementById('interactiveStep').textContent = totalInteractiveSlides
        ? `${completedInteractiveSlides}/${totalInteractiveSlides} slides`
        : progress.interactive_step || '0/0 slides';
      document.getElementById('videoProgress').style.width = `${videoPercent}%`;
      document.getElementById('interactiveProgress').style.width = `${interactivePercent}%`;
      const gradeNode = document.getElementById('gradeValue');
      const moduleNode = document.getElementById('currentModule');
      const studentModulePerformance = document.getElementById('studentModulePerformance');
      const averageModuleGrade = getAverageModuleGrade(courses[0]);
      const modulePerformanceMarkup = renderModulePerformanceSummary(courses[0]);
      if (gradeNode) {
        gradeNode.textContent = averageModuleGrade === null ? '—' : formatGrade(averageModuleGrade);
      }
      if (moduleNode) {
        moduleNode.textContent = progress.current_module || 'Módulo 01';
      }
      if (studentModulePerformance) {
        studentModulePerformance.innerHTML = modulePerformanceMarkup;
      }
    } else {
      const studentModulePerformance = document.getElementById('studentModulePerformance');
      if (studentModulePerformance) {
        studentModulePerformance.innerHTML = '<p class="muted" style="margin:0;">As notas por módulo aparecem aqui.</p>';
      }
    }
    await Promise.all(secondaryLoads);
  } catch (err) {
    console.error(err);
  }
};

const redirectAfterLogin = (role) => {
  if (role === 'admin' || role === 'professor') {
    window.location.href = 'admin.html';
  } else {
    window.location.href = 'portal.html';
  }
};

const persistAuthSession = (data) => {
  if (!data?.token || !data?.user?.role) {
    throw new Error('A API não retornou os dados de autenticação esperados.');
  }
  setToken(data.token);
  localStorage.setItem(USER_ROLE_KEY, data.user.role);
  localStorage.setItem('curso-platform-user', JSON.stringify({
    fullName: data.user.fullName,
    role: data.user.role,
    platformCredits: data.user.platformCredits ?? null,
    studentLimit: data.user.studentLimit ?? null,
    storageLimitBytes: data.user.storageLimitBytes ?? null
  }));
};

const initLogin = () => {
  const form = document.getElementById('loginForm');
  const signupForm = document.getElementById('studentSignupForm');
  const forgotForm = document.getElementById('forgotPasswordForm');
  const resetForm = document.getElementById('resetPasswordForm');
  const feedback = document.getElementById('loginFeedback');
  const signupTitle = document.getElementById('studentSignupTitle');
  const signupSubtitle = document.getElementById('studentSignupSubtitle');
  const signupBadge = document.getElementById('studentSignupBadge');
  const signupSubmitBtn = document.getElementById('studentSignupSubmitBtn');
  const inviteToken = new URLSearchParams(window.location.search).get('invite') || '';
  const showForgotBtn = document.getElementById('showForgotBtn');
  const showLoginFromForgotBtn = document.getElementById('showLoginFromForgotBtn');
  const showLoginFromResetBtn = document.getElementById('showLoginFromResetBtn');
  const showLoginFromSignupBtn = document.getElementById('showLoginFromSignupBtn');
  const createAccountChoiceBtn = document.getElementById('createAccountChoiceBtn');
  const loginEmailLabel = document.getElementById('loginEmailLabel');
  const loginRoleButtons = Array.from(document.querySelectorAll('[data-login-role]'));
  let selectedLoginRole = new URLSearchParams(window.location.search).get('role') === 'professor'
    ? 'professor'
    : 'student';

  const hideAllAuthForms = () => {
    if (form) form.style.display = 'none';
    if (signupForm) signupForm.style.display = 'none';
    if (forgotForm) forgotForm.style.display = 'none';
    if (resetForm) resetForm.style.display = 'none';
  };
  const showLoginMode = () => {
    hideAllAuthForms();
    if (form) form.style.display = 'block';
    if (feedback) feedback.style.display = 'none';
  };
  const showForgotMode = () => {
    hideAllAuthForms();
    if (forgotForm) forgotForm.style.display = 'block';
    if (feedback) feedback.style.display = 'none';
  };
  const showResetMode = () => {
    hideAllAuthForms();
    if (resetForm) resetForm.style.display = 'block';
    if (feedback) feedback.style.display = 'none';
  };
  const showSignupMode = () => {
    hideAllAuthForms();
    if (signupForm) signupForm.style.display = 'block';
    if (feedback) feedback.style.display = 'none';
  };

  const applyLoginRoleMode = (nextRole) => {
    selectedLoginRole = nextRole === 'professor' ? 'professor' : 'student';
    loginRoleButtons.forEach((button) => {
      const isActive = button.dataset.loginRole === selectedLoginRole;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (loginEmailLabel) {
      loginEmailLabel.textContent = selectedLoginRole === 'professor' ? 'E-mail do professor' : 'E-mail do aluno';
    }
    if (form?.email) {
      form.email.placeholder = selectedLoginRole === 'professor' ? 'professor@curso.com' : 'aluno@curso.com';
    }
    if (createAccountChoiceBtn) {
      createAccountChoiceBtn.textContent = selectedLoginRole === 'professor'
        ? 'Criar conta de professor'
        : 'Criar conta de aluno';
    }
  };

  loginRoleButtons.forEach((button) => {
    button.addEventListener('click', () => applyLoginRoleMode(button.dataset.loginRole));
  });

  createAccountChoiceBtn?.addEventListener('click', () => {
    if (selectedLoginRole === 'professor') {
      window.location.href = 'create-account.html';
      return;
    }
    if (signupBadge) signupBadge.textContent = 'Cadastro de aluno';
    if (signupTitle) signupTitle.textContent = 'Criar conta de aluno';
    if (signupSubtitle) {
      signupSubtitle.textContent = 'Crie sua conta para entrar no portal do aluno e solicitar acesso aos cursos da vitrine.';
    }
    if (signupSubmitBtn) signupSubmitBtn.disabled = false;
    showSignupMode();
  });

  if (showForgotBtn) showForgotBtn.addEventListener('click', (e) => { e.preventDefault(); showForgotMode(); });
  if (showLoginFromForgotBtn) showLoginFromForgotBtn.addEventListener('click', (e) => { e.preventDefault(); showLoginMode(); });
  if (showLoginFromResetBtn) showLoginFromResetBtn.addEventListener('click', (e) => { e.preventDefault(); showLoginMode(); });
  if (showLoginFromSignupBtn) showLoginFromSignupBtn.addEventListener('click', (e) => { e.preventDefault(); showLoginMode(); });

  forgotForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.style.display = 'none';
    const email = forgotForm.forgotEmail.value;
    try {
      const response = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await parseJsonSafely(response);
      feedback.textContent = data?.message || 'Se o email estiver cadastrado, um token foi enviado.';
      feedback.style.color = '#8be9fd';
      showResetMode();
      feedback.style.display = 'block';
    } catch (error) {
      feedback.textContent = error.message;
      feedback.style.color = '#ff6b6b';
      feedback.style.display = 'block';
    }
  });

  resetForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.style.display = 'none';
    const email = forgotForm.forgotEmail.value;
    const token = resetForm.resetToken.value;
    const newPassword = resetForm.newPassword.value;
    try {
      const response = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, newPassword })
      });
      const data = await parseJsonSafely(response);
      if (!response.ok) throw new Error(data?.message || 'Falha ao redefinir senha');
      feedback.textContent = 'Senha atualizada com sucesso! Você já pode entrar.';
      feedback.style.color = '#50fa7b';
      showLoginMode();
      feedback.style.display = 'block';
    } catch (error) {
      feedback.textContent = error.message;
      feedback.style.color = '#ff6b6b';
      feedback.style.display = 'block';
    }
  });

  signupForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.style.display = 'none';
    if (signupSubmitBtn) signupSubmitBtn.disabled = true;
    try {
      const signupPayload = {
        fullName: signupForm.studentSignupFullName.value,
        email: signupForm.studentSignupEmail.value,
        phone: signupForm.studentSignupPhone.value,
        password: signupForm.studentSignupPassword.value,
        termsAccepted: Boolean(signupForm.termsAccepted?.checked),
        marketingConsent: Boolean(signupForm.termsAccepted?.checked)
      };
      if (!signupPayload.termsAccepted) {
        throw new Error('Para criar a conta, aceite os Termos de Uso e Privacidade.');
      }
      const signupUrl = inviteToken
        ? `${API_BASE}/api/auth/student-signup-link/${encodeURIComponent(inviteToken)}/register`
        : `${API_BASE}/api/auth/signup`;
      const response = await fetch(signupUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteToken ? signupPayload : { ...signupPayload, role: 'student' })
      });
      const data = await parseJsonSafely(response);
      if (!response.ok) {
        throw new Error(data?.message || 'Não foi possível concluir seu cadastro.');
      }
      if (data?.approvalRequired) {
        signupForm.reset();
        if (signupTitle) signupTitle.textContent = 'Cadastro enviado';
        if (signupSubtitle) signupSubtitle.textContent = data.message || 'Aguarde a autorização do professor para entrar.';
        feedback.textContent = data.message || 'Aguarde a autorização do professor para entrar.';
        feedback.style.color = '#16835d';
        feedback.style.display = 'block';
        if (signupSubmitBtn) signupSubmitBtn.disabled = true;
        return;
      }
      persistAuthSession(data);
      redirectAfterLogin(data.user.role);
    } catch (error) {
      feedback.textContent = error.message;
      feedback.style.color = '#ff6b6b';
      feedback.style.display = 'block';
    } finally {
      if (signupSubmitBtn && signupTitle?.textContent !== 'Cadastro enviado') signupSubmitBtn.disabled = false;
    }
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.style.display = 'none';
    feedback.style.color = '#ff6b6b';
    const email = form.email.value;
    const password = form.password.value;
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await parseJsonSafely(response);
      if (!response.ok) {
        throw new Error(data?.message || 'Falha no login');
      }
      persistAuthSession(data);
      redirectAfterLogin(data.user.role);
    } catch (error) {
      feedback.textContent = error.message;
      feedback.style.color = '#ff6b6b';
      feedback.style.display = 'block';
    }
  });

  if (inviteToken) {
    if (signupBadge) signupBadge.textContent = 'Cadastro por convite';
    showSignupMode();
    if (signupSubmitBtn) signupSubmitBtn.disabled = true;
    fetch(`${API_BASE}/api/auth/student-signup-link/${encodeURIComponent(inviteToken)}`)
      .then((response) => parseJsonSafely(response).then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (!response.ok) {
          throw new Error(data?.message || 'Link de cadastro inválido.');
        }
        if (signupTitle) signupTitle.textContent = 'Criar conta de aluno';
        if (signupSubtitle) {
          const amountLabel = Number(data?.monthlyAmount) > 0
            ? ` Mensalidade: ${Number(data.monthlyAmount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`
            : '';
          const approvalLabel = data?.approvalMode === 'AUTOMATIC'
            ? ' A entrada será automática se houver vaga.'
            : ' O professor autorizará sua entrada.';
          signupSubtitle.textContent =
            data?.acceptingRegistrations === false
              ? data?.message || 'Este link não está aceitando novos cadastros no momento.'
              : `Cadastro vinculado a ${data?.professorName || 'seu professor'}.${amountLabel}${approvalLabel}`;
        }
        if (data?.acceptingRegistrations === false) {
          feedback.textContent = data?.message || 'Este link não está aceitando novos cadastros no momento.';
          feedback.style.color = '#ffb86c';
          feedback.style.display = 'block';
        }
        if (signupSubmitBtn) {
          signupSubmitBtn.disabled = data?.acceptingRegistrations === false;
        }
      })
      .catch((error) => {
        showLoginMode();
        feedback.textContent = error.message || 'Link de cadastro inválido.';
        feedback.style.color = '#ff6b6b';
        feedback.style.display = 'block';
      });
  }

  applyLoginRoleMode(selectedLoginRole);
};

const initCreateAccount = () => {
  const form = document.getElementById('createAccountForm');
  const feedback = document.getElementById('createAccountFeedback');
  const title = document.getElementById('createAccountTitle');
  const subtitle = document.getElementById('createAccountSubtitle');
  const submitBtn = document.getElementById('createAccountSubmitBtn');
  const roleInput = document.getElementById('createAccountRole');
  const toggleButtons = Array.from(document.querySelectorAll('[data-account-role]'));
  const rolePanels = Array.from(document.querySelectorAll('[data-role-panel]'));
  const heroModes = Array.from(document.querySelectorAll('[data-hero-mode]'));
  const loginLinks = Array.from(document.querySelectorAll('[data-go-login]'));
  if (!form || !feedback || !roleInput) return;

  const roleCopy = {
    student: {
      title: 'Criar conta de aluno',
      subtitle: 'Entre na plataforma, acompanhe módulos, tarefas, lives e seu progresso em um só lugar.',
      submitLabel: 'Criar conta de aluno'
    },
    professor: {
      title: 'Criar conta de professor',
      subtitle: 'Comece com um ambiente completo para vender, ensinar ao vivo e construir aulas interativas.',
      submitLabel: 'Começar como professor'
    }
  };

  const setFeedback = (message = '', color = '#ff6b6b') => {
    feedback.textContent = message;
    feedback.style.color = color;
    feedback.style.display = message ? 'block' : 'none';
  };

  const applyRoleMode = (nextRole) => {
    const role = nextRole === 'professor' ? 'professor' : 'student';
    roleInput.value = role;
    const copy = roleCopy[role];
    if (title) title.textContent = copy.title;
    if (subtitle) subtitle.textContent = copy.subtitle;
    if (submitBtn) submitBtn.textContent = copy.submitLabel;
    toggleButtons.forEach((button) => {
      const isActive = button.dataset.accountRole === role;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    rolePanels.forEach((panel) => {
      panel.hidden = panel.dataset.rolePanel !== role;
    });
    heroModes.forEach((panel) => {
      panel.hidden = panel.dataset.heroMode !== role;
    });
    setFeedback('');
  };

  toggleButtons.forEach((button) => {
    button.addEventListener('click', () => applyRoleMode(button.dataset.accountRole));
  });
  loginLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.location.href = 'login.html';
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFeedback('');
    const role = roleInput.value === 'professor' ? 'professor' : 'student';
    const fullName = form.createAccountFullName?.value?.trim() || '';
    const email = form.createAccountEmail?.value?.trim() || '';
    const phone = form.createAccountPhone?.value?.trim() || '';
    const password = form.createAccountPassword?.value || '';
    const confirmPassword = form.createAccountConfirmPassword?.value || '';
    const termsAccepted = Boolean(form.termsAccepted?.checked);

    if (!fullName || !email || !password) {
      setFeedback('Preencha nome, email e senha para continuar.');
      return;
    }
    if (password.length < 12) {
      setFeedback('A senha precisa ter pelo menos 12 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setFeedback('As senhas não coincidem.');
      return;
    }
    if (!termsAccepted) {
      setFeedback('Para criar a conta, aceite os Termos de Uso e Privacidade.');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    try {
      const response = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          password,
          role,
          termsAccepted,
          marketingConsent: termsAccepted
        })
      });
      const data = await parseJsonSafely(response);
      if (!response.ok) {
        throw new Error(data?.message || 'Não foi possível criar a conta.');
      }
      persistAuthSession(data);
      redirectAfterLogin(data.user.role);
    } catch (error) {
      setFeedback(error.message || 'Não foi possível criar a conta.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  applyRoleMode(roleInput.value || 'student');
};

const loadAdminStudents = async () => {
  try {
    const response = await authorizedFetch('/api/admin/students');
    const students = await response.json();
    adminStudentsCache = students.filter((student) => (
      student.is_active === true
      && !['PENDING', 'REJECTED'].includes(String(student.signup_approval_status || '').toUpperCase())
    ));
    syncFaceManualGrantOptions();
    const tbody = document.querySelector('#studentsTable tbody');
    const headerRow = document.querySelector('#studentsTable thead tr');
    const showOwnerColumn = isGlobalAdminUser();
    const ownerHeader = headerRow?.querySelector('[data-student-owner-header]');
    if (headerRow && showOwnerColumn && !ownerHeader) {
      const th = document.createElement('th');
      th.dataset.studentOwnerHeader = 'true';
      th.textContent = 'Professor';
      headerRow.insertBefore(th, headerRow.children[2] || null);
    } else if (!showOwnerColumn && ownerHeader) {
      ownerHeader.remove();
    }
    if (!tbody) return;
    tbody.innerHTML = '';
    const emptyColspan = showOwnerColumn ? 6 : 5;
    if (!students.length) {
      tbody.innerHTML = `<tr><td colspan="${emptyColspan}" style="color:#8b92b1;">Nenhum aluno cadastrado.</td></tr>`;
      updateEnrollmentStudentSelect();
      updateNotificationStudentSelect();
      return;
    }
    students.forEach((student) => {
      const ownerName = student.owner_name || (student.owner_user_id ? 'Professor não encontrado' : 'Seu aluno / sem professor');
      const ownerEmail = student.owner_email || '';
      const approvalStatus = String(student.signup_approval_status || '').toUpperCase();
      const isPendingApproval = approvalStatus === 'PENDING';
      const isRejected = approvalStatus === 'REJECTED';
      const statusLabel = isPendingApproval
        ? 'Aguardando aprovação'
        : isRejected
          ? 'Cadastro recusado'
          : student.is_active ? 'Ativo' : 'Bloqueado';
      const statusBackground = isPendingApproval ? '#fff7df' : isRejected || !student.is_active ? '#fff0f0' : 'rgba(22, 131, 93, 0.12)';
      const statusColor = isPendingApproval ? '#9a6700' : isRejected || !student.is_active ? '#c63838' : '#16835d';
      const signupPrice = Number(student.signup_monthly_amount) > 0
        ? `${Number(student.signup_monthly_amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês`
        : '';
      const row = document.createElement('tr');
      row.innerHTML = `
        <td data-label="Aluno">
          <strong>${escapeHtml(student.full_name)}</strong>
          <span style="font-size:0.85rem;color:#8b92b1;">${escapeHtml(student.email)}</span>
          ${signupPrice ? `<span style="font-size:0.82rem;color:#16835d;">${escapeHtml(signupPrice)}</span>` : ''}
        </td>
        <td data-label="Turma">${escapeHtml(student.class_name || 'Sem turma')}</td>
        ${showOwnerColumn ? `
          <td data-label="Professor">
            <strong>${escapeHtml(ownerName)}</strong>
            ${ownerEmail ? `<span style="font-size:0.85rem;color:#8b92b1;">${escapeHtml(ownerEmail)}</span>` : ''}
          </td>
        ` : ''}
        <td data-label="Telefone">${escapeHtml(student.phone || '—')}</td>
        <td data-label="Status">
          <span class="toggle-pill" style="background:${statusBackground}; color:${statusColor};">
            ${statusLabel}
          </span>
        </td>
        <td data-label="Ações">
          <div class="table-actions">
            ${isPendingApproval || isRejected ? `
              <button data-student-id="${student.id}" data-action="approve" class="primary-btn" style="width:auto; padding:0.4rem 0.9rem; font-size:0.85rem;">Aprovar</button>
            ` : `
              <button data-student-id="${student.id}" data-action="toggle" class="primary-btn" style="width:auto; padding:0.4rem 0.9rem; font-size:0.85rem;">
                ${student.is_active ? 'Bloquear' : 'Autorizar'}
              </button>
            `}
            ${isPendingApproval ? `<button data-student-id="${student.id}" data-action="reject" class="secondary-btn small" type="button">Recusar</button>` : ''}
            <button data-student-id="${student.id}" data-action="delete" class="secondary-btn small" type="button">
              Excluir
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(row);
    });
    updateEnrollmentStudentSelect();
    updateNotificationStudentSelect();
  } catch (error) {
    console.error(error);
  }
};

const publishPlatformCreditBalance = (balance) => {
  const normalized = Number(balance);
  if (!Number.isFinite(normalized)) return;
  localStorage.setItem('curso-platform-credit-sync', JSON.stringify({
    balance: Number(normalized.toFixed(2)),
    at: Date.now()
  }));
};

const renderProfessorCreditsStatus = (payload = null) => {
  const node = document.getElementById('professorCreditsStatus');
  const role = getCurrentUserRole();
  if (role !== 'professor') {
    if (node) node.textContent = '';
    return;
  }
  const credits = Number(payload?.platformCredits);
  const safeCredits = Number.isFinite(credits) ? Number(credits.toFixed(2)) : 0;
  if (node) {
    node.textContent = `Seus créditos disponíveis: ${formatCreditNumber(safeCredits)}`;
    node.style.color = safeCredits > 10 ? '#16835d' : safeCredits >= 0 ? '#d47a0a' : '#c63838';
  }
  const card = document.getElementById('adminPlatformCreditsCard');
  const value = document.getElementById('adminPlatformCreditsValue');
  if (card) {
    card.classList.remove('hidden', 'is-low', 'is-negative');
    card.classList.toggle('is-low', safeCredits >= 0 && safeCredits <= 10);
    card.classList.toggle('is-negative', safeCredits < 0);
  }
  if (value) value.textContent = formatCreditNumber(safeCredits);
  const storedUser = getCurrentUserData();
  const balanceChanged = Number(storedUser.platformCredits) !== safeCredits;
  localStorage.setItem('curso-platform-user', JSON.stringify({
    ...storedUser,
    role,
    platformCredits: safeCredits,
    studentLimit: payload?.studentLimit ?? storedUser.studentLimit ?? null,
    storageLimitBytes: payload?.storageLimitBytes ?? storedUser.storageLimitBytes ?? null
  }));
  if (balanceChanged) publishPlatformCreditBalance(safeCredits);
  renderStudentSignupLinkPanel();
};

const loadProfessorCreditsStatus = async () => {
  const role = getCurrentUserRole();
  if (role !== 'professor') {
    renderProfessorCreditsStatus(null);
    return;
  }
  try {
    const response = await authorizedFetch('/api/admin/me/platform-credits');
    const payload = await response.json();
    renderProfessorCreditsStatus(payload);
  } catch (error) {
    renderProfessorCreditsStatus({ platformCredits: getCurrentUserData().platformCredits ?? 0 });
  }
};

let editingCreditPackageId = null;

const renderCreditPackages = (packages, container, { admin = false } = {}) => {
  if (!container) return;
  if (!packages.length) {
    container.innerHTML = '<p class="muted">Nenhum pacote disponível.</p>';
    return;
  }
  const bestPackage = admin
    ? null
    : packages.reduce((best, item) => {
      const unitPrice = Number(item.price) / Math.max(Number(item.credits), 0.01);
      const bestUnitPrice = best
        ? Number(best.price) / Math.max(Number(best.credits), 0.01)
        : Number.POSITIVE_INFINITY;
      return unitPrice < bestUnitPrice ? item : best;
    }, null);
  container.innerHTML = packages.map((item) => `
    <article class="credit-package-card${item.active ? '' : ' is-disabled'}${bestPackage?.id === item.id ? ' is-featured' : ''}">
      ${bestPackage?.id === item.id ? '<span class="credit-package-ribbon">Melhor escolha</span>' : ''}
      <span class="credit-package-kicker">${admin ? 'Pacote configurado' : 'Recarga avulsa'}</span>
      <span>${escapeHtml(item.name)}</span>
      <strong>${formatCreditNumber(item.credits)} créditos</strong>
      <p>${Number(item.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
      ${admin ? '' : `<small class="credit-package-unit-price">${(Number(item.price) / Math.max(Number(item.credits), 0.01)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por crédito</small>`}
      ${admin
        ? `<small>${item.active ? 'Ativo' : 'Inativo'}</small>
           <div class="credit-package-actions">
             <button class="secondary-btn small" type="button"
               data-credit-package-edit="${escapeAttribute(item.id)}"
               data-package-name="${escapeAttribute(item.name)}"
               data-package-price="${escapeAttribute(item.price)}"
               data-package-credits="${escapeAttribute(item.credits)}"
               data-package-active="${item.active ? 'true' : 'false'}">Editar</button>
             <button class="secondary-btn small" type="button"
               data-credit-package-toggle="${escapeAttribute(item.id)}"
               data-package-name="${escapeAttribute(item.name)}"
               data-package-price="${escapeAttribute(item.price)}"
               data-package-credits="${escapeAttribute(item.credits)}"
               data-package-active="${item.active ? 'true' : 'false'}">${item.active ? 'Desativar' : 'Ativar'}</button>
           </div>`
        : `<button class="primary-btn" type="button" data-credit-package-checkout="${escapeAttribute(item.id)}">Escolher pacote <span aria-hidden="true">→</span></button>`}
    </article>
  `).join('');
};

const loadCreditPackages = async ({ admin = false } = {}) => {
  const response = await authorizedFetch('/api/admin/credit-packages');
  const payload = await response.json().catch(() => []);
  if (!response.ok) throw new Error(payload?.message || 'Não foi possível carregar os pacotes.');
  renderCreditPackages(payload, document.getElementById(admin ? 'adminCreditPackageList' : 'creditTopupPackageList'), { admin });
  return payload;
};

const openCreditTopupModal = async () => {
  const modal = document.getElementById('creditTopupModal');
  if (!modal || getCurrentUserRole() !== 'professor') return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  const balance = document.getElementById('adminCreditTopupBalance');
  if (balance) {
    balance.textContent = formatCreditNumber(getCurrentUserData().platformCredits ?? 0);
  }
  const status = document.getElementById('creditTopupStatus');
  if (status) status.textContent = 'Carregando pacotes...';
  try {
    await loadCreditPackages();
    if (status) status.textContent = 'Pagamento avulso por Pix ou cartão, sem recorrência.';
  } catch (error) {
    if (status) status.textContent = error.message;
  }
};

const closeCreditTopupModal = () => {
  const modal = document.getElementById('creditTopupModal');
  modal?.classList.add('hidden');
  modal?.setAttribute('aria-hidden', 'true');
};

const resumeCreditTopup = async () => {
  const params = new URLSearchParams(window.location.search);
  const callbackStatus = params.get('creditTopup');
  const orderId = params.get('order');
  if (!callbackStatus || !orderId || getCurrentUserRole() !== 'professor') return;
  await openCreditTopupModal();
  const status = document.getElementById('creditTopupStatus');
  if (callbackStatus !== 'success') {
    if (status) status.textContent = callbackStatus === 'expired'
      ? 'O checkout expirou. Escolha um pacote para tentar novamente.'
      : 'A recarga foi cancelada.';
    return;
  }
  if (status) status.textContent = 'Pagamento recebido. Aguardando confirmação segura do Asaas...';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await authorizedFetch(`/api/admin/credit-topups/${encodeURIComponent(orderId)}`);
    const order = await response.json().catch(() => ({}));
    if (response.ok && order.status === 'PAID') {
      await loadProfessorCreditsStatus();
      if (status) status.textContent = `${formatCreditNumber(order.credits)} créditos adicionados ao saldo.`;
      params.delete('creditTopup');
      params.delete('order');
      history.replaceState({}, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
      return;
    }
    if (['CANCELED', 'EXPIRED', 'REFUNDED', 'CHARGEBACK'].includes(order.status)) {
      if (status) status.textContent = `A recarga não foi concluída (${order.status}).`;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (status) status.textContent = 'A confirmação ainda está em processamento. O saldo será atualizado automaticamente após o webhook.';
};

const initPlatformCredits = () => {
  if (getCurrentUserRole() === 'professor') {
    document.getElementById('adminPlatformCreditsCard')?.classList.remove('hidden');
    loadProfessorCreditsStatus();
  }
  document.getElementById('adminPlatformCreditsCard')?.addEventListener('click', openCreditTopupModal);
  document.getElementById('creditTopupModal')?.addEventListener('click', async (event) => {
    if (event.target.closest('[data-credit-topup-close]')) {
      closeCreditTopupModal();
      return;
    }
    const button = event.target.closest('[data-credit-package-checkout]');
    if (!button) return;
    const status = document.getElementById('creditTopupStatus');
    button.disabled = true;
    if (status) status.textContent = 'Criando checkout seguro...';
    try {
      const response = await authorizedFetch('/api/admin/credit-topups/checkout', {
        method: 'POST',
        body: JSON.stringify({ packageId: button.dataset.creditPackageCheckout })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Não foi possível criar o checkout.');
      window.location.assign(payload.order.checkoutUrl);
    } catch (error) {
      button.disabled = false;
      if (status) status.textContent = error.message;
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== 'curso-platform-credit-sync' || !event.newValue) return;
    try {
      renderProfessorCreditsStatus({ platformCredits: JSON.parse(event.newValue).balance });
    } catch {
      // Ignore malformed values from older tabs.
    }
  });
  void resumeCreditTopup();
};

const renderStudentSignupLinkPanel = () => {
  const panel = document.getElementById('studentSignupLinkPanel');
  const input = document.getElementById('studentSignupLinkInput');
  const copyBtn = document.getElementById('copyStudentSignupLinkBtn');
  const status = document.getElementById('studentSignupLinkStatus');
  if (!panel || !input || !copyBtn || !status) {
    return;
  }
  const role = getCurrentUserRole();
  if (role !== 'professor' && role !== 'admin') {
    panel.remove();
    return;
  }
  input.value = currentStudentSignupLink || '';
  copyBtn.disabled = !currentStudentSignupLink;
  if (!currentStudentSignupLink) {
    const userData = getCurrentUserData();
    const limitLabel =
      Number.isFinite(Number(userData.studentLimit)) && Number(userData.studentLimit) > 0
        ? `Limite atual: ${Number(userData.studentLimit)} aluno(s).`
        : role === 'admin'
          ? 'O admin pode gerar alunos por link sem limite configurado neste painel.'
          : 'Sem limite de alunos configurado no momento.';
    status.textContent = `Configure a cobrança e gere o link reutilizável. Uma nova geração substitui apenas o endereço anterior. ${limitLabel}`;
    status.style.color = '#8b92b1';
  }
};

const generateStudentSignupLink = async () => {
  const input = document.getElementById('studentSignupLinkInput');
  const generateBtn = document.getElementById('generateStudentSignupLinkBtn');
  const copyBtn = document.getElementById('copyStudentSignupLinkBtn');
  const status = document.getElementById('studentSignupLinkStatus');
  if (!input || !generateBtn || !copyBtn || !status) {
    return;
  }
  generateBtn.disabled = true;
  try {
    const monthlyAmount = Number(document.getElementById('studentSignupMonthlyAmount')?.value || 0);
    const dueDay = Number.parseInt(document.getElementById('studentSignupDueDay')?.value || '', 10);
    const graceDays = Number.parseInt(document.getElementById('studentSignupGraceDays')?.value || '', 10);
    const billingType = document.getElementById('studentSignupBillingType')?.value || 'PIX';
    const autoApprove = Boolean(document.getElementById('studentSignupAutoApprove')?.checked);
    if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
      throw new Error('Informe o valor mensal que será cobrado dos alunos.');
    }
    const response = await authorizedFetch('/api/admin/student-signup-link', {
      method: 'POST',
      body: JSON.stringify({ monthlyAmount, dueDay, graceDays, billingType, autoApprove, autoBlock: true })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Não foi possível gerar o link de cadastro.');
    }
    currentStudentSignupLink = payload?.inviteUrl || '';
    input.value = currentStudentSignupLink;
    copyBtn.disabled = !currentStudentSignupLink;
    const limitText =
      Number.isFinite(Number(payload?.studentLimit)) && Number(payload?.studentLimit) > 0
        ? `Uso atual: ${Number(payload?.studentCount || 0)}/${Number(payload.studentLimit)} alunos.`
        : 'Sem limite de alunos configurado.';
    const approvalText = payload?.autoApprove
      ? 'Cadastros serão aprovados automaticamente enquanto houver vaga.'
      : 'Cada cadastro ficará aguardando sua autorização.';
    status.textContent = `Link reutilizável gerado. ${approvalText} ${limitText}`;
    status.style.color = '#50fa7b';
  } catch (error) {
    status.textContent = error.message || 'Não foi possível gerar o link de cadastro.';
    status.style.color = '#ff6b6b';
  } finally {
    generateBtn.disabled = false;
  }
};

const copyStudentSignupLink = async () => {
  const input = document.getElementById('studentSignupLinkInput');
  const status = document.getElementById('studentSignupLinkStatus');
  if (!currentStudentSignupLink || !input || !status) {
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(currentStudentSignupLink);
    } else {
      input.focus();
      input.select();
      document.execCommand('copy');
    }
    status.textContent = 'Link copiado. Envie para o aluno concluir o próprio cadastro.';
    status.style.color = '#50fa7b';
  } catch (error) {
    status.textContent = 'Não foi possível copiar automaticamente. Você pode copiar o link manualmente.';
    status.style.color = '#ffb86c';
  }
};

const formatBrl = (value) => Number(value || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

const syncStudentSeatUpgradePrice = () => {
  const input = document.getElementById('studentSeatUpgradeQuantity');
  const detail = document.getElementById('studentSeatUpgradePriceDetail');
  const total = document.getElementById('studentSeatUpgradeTotal');
  if (!input || !detail || !total) return;
  const quantity = Math.min(500, Math.max(1, Math.round(Number(input.value) || 1)));
  input.value = String(quantity);
  detail.textContent = `${quantity} vaga${quantity > 1 ? 's' : ''} × ${formatBrl(studentSeatUpgradeUnitPrice)} por mês`;
  total.textContent = formatBrl(quantity * studentSeatUpgradeUnitPrice);
};

const openStudentSeatUpgradeModal = (studentId, payload = {}) => {
  const modal = document.getElementById('studentSeatUpgradeModal');
  if (!modal || getCurrentUserRole() !== 'professor') {
    alert(payload?.message || 'O limite de alunos foi atingido.');
    return;
  }
  pendingSeatUpgradeStudentId = studentId || '';
  studentSeatUpgradeUnitPrice = Number(payload?.seatUpgrade?.unitPrice) || 9.70;
  studentSeatUpgradeCurrentLimit = Number(payload?.quotaStatus?.studentLimit) || 0;
  const summary = document.getElementById('studentSeatUpgradeSummary');
  const input = document.getElementById('studentSeatUpgradeQuantity');
  const status = document.getElementById('studentSeatUpgradeStatus');
  if (summary) {
    summary.textContent = `As ${studentSeatUpgradeCurrentLimit} vagas do plano estão ocupadas. Escolha quantas deseja adicionar.`;
  }
  if (input) input.value = '1';
  if (status) status.textContent = '';
  syncStudentSeatUpgradePrice();
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
};

const closeStudentSeatUpgradeModal = () => {
  const modal = document.getElementById('studentSeatUpgradeModal');
  modal?.classList.add('hidden');
  modal?.setAttribute('aria-hidden', 'true');
};

const approveStudentAfterSeatUpgrade = async () => {
  const studentId = localStorage.getItem('curso-platform-pending-seat-approval') || '';
  if (!studentId) return false;
  const response = await authorizedFetch(`/api/admin/students/${encodeURIComponent(studentId)}/signup-approval`, {
    method: 'PUT',
    body: JSON.stringify({ decision: 'APPROVED' })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'As vagas foram liberadas, mas não foi possível aprovar o aluno automaticamente.');
  localStorage.removeItem('curso-platform-pending-seat-approval');
  return true;
};

const resumeStudentSeatUpgrade = async () => {
  const params = new URLSearchParams(window.location.search);
  const callbackStatus = params.get('seatUpgrade');
  const orderId = params.get('order');
  if (!callbackStatus || !orderId || getCurrentUserRole() !== 'professor') return;
  openStudentSeatUpgradeModal(localStorage.getItem('curso-platform-pending-seat-approval') || '', {
    quotaStatus: { studentLimit: Number(getCurrentUserData().studentLimit) || 0 },
    seatUpgrade: { unitPrice: 9.70 }
  });
  const status = document.getElementById('studentSeatUpgradeStatus');
  if (callbackStatus !== 'success') {
    if (status) status.textContent = callbackStatus === 'expired'
      ? 'O checkout expirou. Escolha a quantidade e tente novamente.'
      : 'O pagamento foi cancelado e nenhuma vaga foi adicionada.';
    return;
  }
  if (status) status.textContent = 'Pagamento recebido. Aguardando a confirmação segura do Asaas...';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await authorizedFetch(`/api/admin/student-seats/orders/${encodeURIComponent(orderId)}`);
    const order = await response.json().catch(() => ({}));
    if (response.ok && order.status === 'PAID') {
      setCurrentUserData({ studentLimit: order.targetStudentLimit });
      let approved = false;
      try {
        approved = await approveStudentAfterSeatUpgrade();
      } catch (error) {
        if (status) status.textContent = error.message;
        await loadAdminStudents();
        return;
      }
      if (status) status.textContent = approved
        ? `Novo limite: ${order.targetStudentLimit} alunos. O cadastro pendente foi aprovado.`
        : `Novo limite liberado: ${order.targetStudentLimit} alunos.`;
      params.delete('seatUpgrade');
      params.delete('order');
      history.replaceState({}, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
      await loadAdminStudents();
      return;
    }
    if (['CANCELED', 'EXPIRED', 'REFUNDED', 'CHARGEBACK'].includes(order.status)) {
      if (status) status.textContent = `A compra de vagas não foi concluída (${order.status}).`;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (status) status.textContent = 'A confirmação ainda está sendo processada. O limite será atualizado pelo webhook.';
};

const initStudentSeatUpgrade = () => {
  const modal = document.getElementById('studentSeatUpgradeModal');
  modal?.addEventListener('click', async (event) => {
    if (event.target.closest('[data-seat-upgrade-close]')) {
      closeStudentSeatUpgradeModal();
      return;
    }
    const stepButton = event.target.closest('[data-seat-step]');
    if (stepButton) {
      const input = document.getElementById('studentSeatUpgradeQuantity');
      if (input) input.value = String((Number(input.value) || 1) + Number(stepButton.dataset.seatStep || 0));
      syncStudentSeatUpgradePrice();
    }
  });
  document.getElementById('studentSeatUpgradeQuantity')?.addEventListener('input', syncStudentSeatUpgradePrice);
  document.getElementById('studentSeatUpgradeCheckoutBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const status = document.getElementById('studentSeatUpgradeStatus');
    const quantity = Number(document.getElementById('studentSeatUpgradeQuantity')?.value || 1);
    button.disabled = true;
    if (status) status.textContent = 'Criando checkout seguro...';
    try {
      const response = await authorizedFetch('/api/admin/student-seats/checkout', {
        method: 'POST',
        body: JSON.stringify({ quantity })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.order?.checkoutUrl) throw new Error(payload.message || 'Não foi possível criar o checkout.');
      if (pendingSeatUpgradeStudentId) {
        localStorage.setItem('curso-platform-pending-seat-approval', pendingSeatUpgradeStudentId);
      }
      window.location.assign(payload.order.checkoutUrl);
    } catch (error) {
      button.disabled = false;
      if (status) status.textContent = error.message;
    }
  });
  void resumeStudentSeatUpgrade();
};

const STUDENT_PAYMENT_STATES = {
  pending: { label: 'Pendente', tone: 'neutral' },
  due_soon: { label: 'Vence em breve', tone: 'warning' },
  overdue: { label: 'Em atraso', tone: 'warning' },
  blocked: { label: 'Acesso restrito', tone: 'danger' },
  failed: { label: 'Pagamento recusado', tone: 'danger' },
  chargeback: { label: 'Chargeback', tone: 'danger' },
  refunded: { label: 'Estornado', tone: 'warning' },
  canceled: { label: 'Cancelado', tone: 'neutral' },
  paid: { label: 'Pago', tone: 'success' },
  paused: { label: 'Pausado', tone: 'neutral' },
  unconfigured: { label: 'Sem mensalidade', tone: 'neutral' }
};

const getStudentPaymentState = (student = {}) => student.payment?.state || (student.plan ? 'pending' : 'unconfigured');

const renderStudentFinanceMetrics = (summary = {}) => {
  const host = document.getElementById('studentFinanceMetrics');
  if (!host) return;
  host.innerHTML = `
    <div><span>Recebido no mês</span><strong>${formatBrl(summary.received)}</strong></div>
    <div><span>A receber</span><strong>${formatBrl(summary.pending)}</strong></div>
    <div><span>Em atraso</span><strong>${Number(summary.overdue || 0)}</strong></div>
    <div><span>Acessos restritos</span><strong>${Number(summary.blocked || 0)}</strong></div>
  `;
};

const renderStudentFinanceProvider = (settings = {}) => {
  const mode = document.getElementById('studentFinanceProviderMode');
  const status = document.getElementById('studentFinanceProviderStatus');
  const onboardingForm = document.getElementById('studentFinanceSubaccountForm');
  const onboardingStatus = document.getElementById('studentFinanceOnboardingStatus');
  const saveModeButton = document.getElementById('saveStudentFinanceProviderBtn');
  const hasSubaccount = Boolean(settings.accountId && settings.hasApiKey);
  if (mode) mode.value = settings.mode === 'ASAAS' ? 'ASAAS' : 'MANUAL';
  if (onboardingForm) onboardingForm.hidden = mode?.value !== 'ASAAS' || hasSubaccount;
  if (onboardingStatus) onboardingStatus.hidden = !hasSubaccount;
  if (saveModeButton) {
    saveModeButton.hidden = mode?.value === 'ASAAS' && !hasSubaccount;
    saveModeButton.textContent = mode?.value === 'ASAAS' ? 'Usar esta subconta' : 'Usar controle manual';
  }
  if (status) {
    status.textContent = settings.mode === 'ASAAS' && hasSubaccount
      ? settings.status === 'APPROVED'
        ? `Subconta aprovada${settings.accountName ? `: ${settings.accountName}` : ''}. Os recebimentos automáticos estão liberados.`
        : `Subconta criada${settings.accountName ? ` para ${settings.accountName}` : ''}. Conclua a análise cadastral para liberar cobranças automáticas.`
      : settings.mode === 'ASAAS'
        ? 'Preencha o cadastro abaixo para criar sua subconta sem sair do portal.'
        : 'No modo manual, você confirma os pagamentos recebidos fora do portal.';
  }
  renderStudentFinanceOnboarding(settings.onboarding || {}, settings.status || 'DISCONNECTED');
};

const getAsaasStatusLabel = (value) => ({
  APPROVED: 'Aprovado', PENDING: 'Pendente', AWAITING_APPROVAL: 'Em análise', REJECTED: 'Reprovado'
})[String(value || '').toUpperCase()] || 'Pendente';

const renderStudentFinanceOnboarding = (onboarding = {}, providerStatus = 'PENDING') => {
  const host = document.getElementById('studentFinanceAccountStatuses');
  const documentsHost = document.getElementById('studentFinanceDocumentList');
  const message = document.getElementById('studentFinanceOnboardingMessage');
  const general = String(onboarding.general || providerStatus || 'PENDING').toUpperCase();
  if (message) {
    message.textContent = general === 'APPROVED'
      ? 'Cadastro aprovado. A subconta já pode receber as mensalidades automáticas.'
      : general === 'REJECTED'
        ? 'O cadastro precisa de correção. Confira os documentos solicitados.'
        : general === 'AWAITING_APPROVAL'
          ? 'Os dados foram enviados e estão em análise pelo Asaas.'
          : 'Existem etapas cadastrais pendentes antes da liberação dos recebimentos.';
  }
  if (host) {
    const statuses = [
      ['Geral', general],
      ['Dados cadastrais', onboarding.commercialInfo],
      ['Documentos', onboarding.documentation],
      ['Conta bancária', onboarding.bankAccountInfo]
    ];
    host.innerHTML = statuses.map(([label, value]) => {
      const normalized = String(value || 'PENDING').toUpperCase();
      const tone = normalized === 'APPROVED' ? 'success' : normalized === 'REJECTED' ? 'danger' : 'warning';
      return `<div><span>${escapeHtml(label)}</span><strong class="financial-status ${tone}">${escapeHtml(getAsaasStatusLabel(normalized))}</strong></div>`;
    }).join('');
  }
  if (documentsHost) {
    const documents = Array.isArray(onboarding.documents) ? onboarding.documents : [];
    documentsHost.innerHTML = documents.length
      ? documents.map((document) => `
          <div class="student-finance-document">
            <div><strong>${escapeHtml(document.title || 'Documento')}</strong><span>${escapeHtml(document.description || getAsaasStatusLabel(document.status))}</span></div>
            ${document.onboardingUrl
              ? `<a class="secondary-btn small" href="${escapeAttribute(document.onboardingUrl)}" target="_blank" rel="noopener noreferrer">Enviar documento</a>`
              : `<span class="financial-status ${document.status === 'APPROVED' ? 'success' : 'warning'}">${escapeHtml(getAsaasStatusLabel(document.status))}</span>`}
          </div>
        `).join('')
      : '<p class="muted" style="margin:0;">Atualize a análise para consultar os documentos solicitados.</p>';
  }
};

const refreshStudentFinanceOnboarding = async () => {
  const response = await authorizedFetch('/api/admin/student-payments/subaccount/onboarding');
  const payload = await parseJsonSafely(response);
  if (!response.ok) throw new Error(payload?.message || 'Não foi possível consultar a análise cadastral.');
  if (!payload.ready) {
    const message = document.getElementById('studentFinanceOnboardingMessage');
    if (message) message.textContent = `Aguarde ${Number(payload.waitSeconds || 1)} segundos para a validação inicial do Asaas.`;
    return payload;
  }
  studentFinanceCache.settings = {
    ...(studentFinanceCache.settings || {}),
    status: payload.status,
    onboarding: payload.onboarding
  };
  renderStudentFinanceProvider(studentFinanceCache.settings);
  return payload;
};

const getFilteredStudentPayments = () => {
  const search = String(document.getElementById('studentFinanceSearch')?.value || '').trim().toLowerCase();
  const filter = document.getElementById('studentFinanceFilter')?.value || 'all';
  return (studentFinanceCache.students || []).filter((student) => {
    const matchesSearch = !search || `${student.fullName} ${student.email} ${student.className || ''}`.toLowerCase().includes(search);
    const state = getStudentPaymentState(student);
    return matchesSearch && (filter === 'all' || state === filter);
  });
};

const renderStudentPaymentList = () => {
  const host = document.getElementById('studentPaymentList');
  if (!host) return;
  const students = getFilteredStudentPayments();
  if (!students.length) {
    host.innerHTML = '<p class="financial-empty-state">Nenhum aluno encontrado para estes filtros.</p>';
    return;
  }
  host.innerHTML = students.map((student) => {
    const plan = student.plan || {};
    const payment = student.payment || {};
    const stateKey = getStudentPaymentState(student);
    const state = STUDENT_PAYMENT_STATES[stateKey] || STUDENT_PAYMENT_STATES.pending;
    const automaticPaymentsReady = studentFinanceCache.settings?.mode === 'ASAAS'
      && ['APPROVED', 'CONNECTED'].includes(studentFinanceCache.settings?.status);
    const disableAutomatic = !automaticPaymentsReady && (!plan.billingType || plan.billingType === 'MANUAL');
    return `
      <article class="student-payment-item" data-payment-state="${escapeAttribute(stateKey)}">
        <div class="student-payment-item-head">
          <div>
            <h3>${escapeHtml(student.fullName)}</h3>
            <p>${escapeHtml(student.email)}${student.className ? ` · ${escapeHtml(student.className)}` : ''}</p>
          </div>
          <span class="financial-status ${escapeAttribute(state.tone)}">${escapeHtml(state.label)}</span>
        </div>
        <div class="student-payment-form" data-student-payment-form="${escapeAttribute(student.id)}">
          <label><span>Mensalidade</span><input type="number" min="0.01" step="0.01" data-payment-field="amount" value="${escapeAttribute(plan.amount || '')}" placeholder="97,00" /></label>
          <label><span>Vencimento</span><input type="number" min="1" max="28" step="1" data-payment-field="dueDay" value="${escapeAttribute(plan.dueDay || 10)}" /></label>
          <label><span>Forma</span><select data-payment-field="billingType">
            <option value="MANUAL" ${!plan.billingType || plan.billingType === 'MANUAL' ? 'selected' : ''}>Manual / combinado</option>
            <option value="PIX" ${plan.billingType === 'PIX' ? 'selected' : ''} ${disableAutomatic ? 'disabled' : ''}>Pix pelo Asaas</option>
            <option value="BOLETO" ${plan.billingType === 'BOLETO' ? 'selected' : ''} ${disableAutomatic ? 'disabled' : ''}>Boleto pelo Asaas</option>
            <option value="CREDIT_CARD" ${plan.billingType === 'CREDIT_CARD' ? 'selected' : ''} ${disableAutomatic ? 'disabled' : ''}>Cartão recorrente</option>
          </select></label>
          <label><span>Tolerância</span><input type="number" min="0" max="60" step="1" data-payment-field="graceDays" value="${escapeAttribute(plan.graceDays ?? 5)}" /></label>
          <label><span>Situação</span><select data-payment-field="status">
            <option value="ACTIVE" ${plan.status !== 'PAUSED' ? 'selected' : ''}>Ativa</option>
            <option value="PAUSED" ${plan.status === 'PAUSED' ? 'selected' : ''}>Pausada</option>
          </select></label>
          <label class="student-payment-switch"><input type="checkbox" data-payment-field="autoBlock" ${plan.autoBlock !== false ? 'checked' : ''} /><span>Restringir acesso após a tolerância</span></label>
          <label class="student-payment-wide"><span>Instruções para pagamento manual</span><input type="text" maxlength="800" data-payment-field="instructions" value="${escapeAttribute(plan.instructions || '')}" placeholder="Ex: Pix na chave informada pelo professor" /></label>
        </div>
        <div class="student-payment-item-footer">
          <span>${payment.dueDate ? `Vencimento atual: <strong>${formatPaymentDate(payment.dueDate)}</strong>` : 'Configure a primeira mensalidade.'}</span>
          <div>
            ${plan.id && stateKey !== 'paid' ? `<button class="secondary-btn small" type="button" data-payment-mark-paid="${escapeAttribute(plan.id)}">Marcar como pago</button>` : ''}
            ${plan.id && plan.billingType !== 'MANUAL' ? `<button class="secondary-btn small" type="button" data-payment-sync="${escapeAttribute(plan.id)}">Sincronizar</button>` : ''}
            <button class="primary-btn small" type="button" data-payment-save="${escapeAttribute(student.id)}">Salvar mensalidade</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
};

const loadStudentFinance = async () => {
  const response = await authorizedFetch('/api/admin/student-payments/overview');
  const payload = await parseJsonSafely(response);
  if (!response.ok) throw new Error(payload?.message || 'Não foi possível carregar as mensalidades.');
  studentFinanceCache = {
    settings: payload?.settings || {},
    summary: payload?.summary || {},
    students: Array.isArray(payload?.students) ? payload.students : []
  };
  renderStudentFinanceProvider(studentFinanceCache.settings);
  renderStudentFinanceMetrics(studentFinanceCache.summary);
  renderStudentPaymentList();
};

const saveStudentPaymentPlan = async (studentId, button) => {
  const form = document.querySelector(`[data-student-payment-form="${CSS.escape(studentId)}"]`);
  if (!form) return;
  const value = (name) => form.querySelector(`[data-payment-field="${name}"]`);
  button.disabled = true;
  try {
    const response = await authorizedFetch(`/api/admin/student-payments/plans/${encodeURIComponent(studentId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        amount: Number(value('amount')?.value),
        dueDay: Number(value('dueDay')?.value),
        billingType: value('billingType')?.value,
        graceDays: Number(value('graceDays')?.value),
        status: value('status')?.value,
        autoBlock: value('autoBlock')?.checked === true,
        instructions: value('instructions')?.value
      })
    });
    const payload = await parseJsonSafely(response);
    if (!response.ok) throw new Error(payload?.message || 'Não foi possível salvar a mensalidade.');
    await loadStudentFinance();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
};

const initStudentFinanceAdmin = () => {
  document.getElementById('studentFinanceProviderMode')?.addEventListener('change', (event) => {
    renderStudentFinanceProvider({
      ...(studentFinanceCache.settings || {}),
      mode: event.target.value
    });
  });
  document.getElementById('saveStudentFinanceProviderBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await authorizedFetch('/api/admin/student-payments/settings', {
        method: 'PUT',
        body: JSON.stringify({
          mode: document.getElementById('studentFinanceProviderMode')?.value
        })
      });
      const payload = await parseJsonSafely(response);
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível salvar a conexão.');
      await loadStudentFinance();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
  const currentUser = getCurrentUserData();
  const accountName = document.getElementById('studentFinanceAccountName');
  const accountEmail = document.getElementById('studentFinanceAccountEmail');
  if (accountName && !accountName.value) accountName.value = currentUser.fullName || '';
  if (accountEmail && !accountEmail.value) accountEmail.value = currentUser.email || '';
  const syncPersonFields = () => {
    const documentDigits = String(document.getElementById('studentFinanceCpfCnpj')?.value || '').replace(/\D/g, '');
    const isCompany = documentDigits.length > 11;
    const birthField = document.getElementById('studentFinanceBirthDateField');
    const companyField = document.getElementById('studentFinanceCompanyTypeField');
    if (birthField) birthField.hidden = isCompany;
    if (companyField) companyField.hidden = !isCompany;
  };
  document.getElementById('studentFinanceCpfCnpj')?.addEventListener('input', syncPersonFields);
  document.getElementById('studentFinanceSubaccountForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('createStudentFinanceSubaccountBtn');
    const feedback = document.getElementById('studentFinanceSubaccountFeedback');
    if (button) button.disabled = true;
    if (feedback) feedback.textContent = 'Criando a subconta com segurança...';
    try {
      const response = await authorizedFetch('/api/admin/student-payments/subaccount', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('studentFinanceAccountName')?.value,
          email: document.getElementById('studentFinanceAccountEmail')?.value,
          cpfCnpj: document.getElementById('studentFinanceCpfCnpj')?.value,
          birthDate: document.getElementById('studentFinanceBirthDate')?.value,
          companyType: document.getElementById('studentFinanceCompanyType')?.value,
          mobilePhone: document.getElementById('studentFinanceMobilePhone')?.value,
          incomeValue: Number(document.getElementById('studentFinanceIncomeValue')?.value),
          postalCode: document.getElementById('studentFinancePostalCode')?.value,
          address: document.getElementById('studentFinanceAddress')?.value,
          addressNumber: document.getElementById('studentFinanceAddressNumber')?.value,
          complement: document.getElementById('studentFinanceComplement')?.value,
          province: document.getElementById('studentFinanceProvince')?.value,
          consentAccepted: document.getElementById('studentFinanceConsent')?.checked === true
        })
      });
      const payload = await parseJsonSafely(response);
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível criar a subconta.');
      if (feedback) feedback.textContent = 'Subconta criada. Aguarde alguns segundos e atualize a análise cadastral.';
      await loadStudentFinance();
    } catch (error) {
      if (feedback) feedback.textContent = error.message;
      if (button) button.disabled = false;
    }
  });
  document.getElementById('refreshStudentFinanceOnboardingBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await refreshStudentFinanceOnboarding();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('refreshStudentFinanceBtn')?.addEventListener('click', () => loadStudentFinance().catch((error) => alert(error.message)));
  document.getElementById('studentFinanceSearch')?.addEventListener('input', renderStudentPaymentList);
  document.getElementById('studentFinanceFilter')?.addEventListener('change', renderStudentPaymentList);
  document.getElementById('studentPaymentList')?.addEventListener('click', async (event) => {
    const save = event.target.closest('[data-payment-save]');
    if (save) return saveStudentPaymentPlan(save.dataset.paymentSave, save);
    const markPaid = event.target.closest('[data-payment-mark-paid]');
    const sync = event.target.closest('[data-payment-sync]');
    const action = markPaid || sync;
    if (!action) return;
    action.disabled = true;
    try {
      const planId = markPaid?.dataset.paymentMarkPaid || sync?.dataset.paymentSync;
      const endpoint = markPaid ? 'mark-paid' : 'sync';
      const response = await authorizedFetch(`/api/admin/student-payments/plans/${encodeURIComponent(planId)}/${endpoint}`, { method: 'POST' });
      const payload = await parseJsonSafely(response);
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível atualizar o pagamento.');
      await loadStudentFinance();
    } catch (error) {
      alert(error.message);
      action.disabled = false;
    }
  });
  loadStudentFinance().catch((error) => {
    const host = document.getElementById('studentPaymentList');
    if (host) host.innerHTML = `<p class="financial-empty-state">${escapeHtml(error.message)}</p>`;
  });
};

const getGlobalStudentFinanceFilters = () => ({
  search: String(document.getElementById('globalStudentFinanceSearch')?.value || '').trim().toLowerCase(),
  professorId: document.getElementById('globalStudentFinanceProfessor')?.value || 'all',
  status: document.getElementById('globalStudentFinanceStatus')?.value || 'all'
});

const renderGlobalStudentFinanceSummary = () => {
  const summary = globalStudentFinanceCache.summary || {};
  const values = {
    globalStudentMonthlyExpected: formatBrl(summary.monthlyExpected),
    globalStudentReceived: formatBrl(summary.received),
    globalStudentPending: formatBrl(summary.pending),
    globalStudentConfigured: Number(summary.configured || 0),
    globalStudentOverdue: Number(summary.overdue || 0),
    globalStudentBlocked: Number(summary.blocked || 0)
  };
  Object.entries(values).forEach(([id, value]) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  });
};

const renderGlobalStudentFinance = () => {
  const host = document.getElementById('globalProfessorStudentFinanceList');
  if (!host) return;
  const filters = getGlobalStudentFinanceFilters();
  let visibleStudents = 0;
  const groups = (globalStudentFinanceCache.professors || []).map((professor) => {
    if (filters.professorId !== 'all' && professor.id !== filters.professorId) return null;
    const students = (professor.students || []).filter((student) => {
      const state = getStudentPaymentState(student);
      const haystack = `${professor.name} ${professor.email} ${student.fullName} ${student.email} ${student.className || ''}`.toLowerCase();
      return (!filters.search || haystack.includes(filters.search))
        && (filters.status === 'all' || state === filters.status);
    });
    if (!students.length) return null;
    visibleStudents += students.length;
    const summary = professor.summary || {};
    const modeLabel = professor.paymentSettings?.mode === 'ASAAS'
      ? `Asaas · ${getAsaasStatusLabel(professor.paymentSettings.status)}`
      : 'Cobrança manual';
    return `
      <details class="global-professor-finance-group" open>
        <summary>
          <span><strong>${escapeHtml(professor.name)}</strong><small>${escapeHtml(professor.email)} · ${escapeHtml(modeLabel)}</small></span>
          <span class="global-professor-finance-totals">
            <small>${students.length} aluno${students.length === 1 ? '' : 's'}</small>
            <strong>${formatBrl(summary.monthlyExpected)} / mês</strong>
            ${summary.overdue ? `<em>${Number(summary.overdue)} em atraso</em>` : ''}
          </span>
        </summary>
        <div class="global-student-finance-table-wrap">
          <table class="table admin-responsive-table global-student-finance-table">
            <thead><tr><th>Aluno</th><th>Plano</th><th>Vencimento</th><th>Pagamento</th><th>Situação</th><th>Conta</th></tr></thead>
            <tbody>
              ${students.map((student) => {
                const stateKey = getStudentPaymentState(student);
                const state = STUDENT_PAYMENT_STATES[stateKey] || STUDENT_PAYMENT_STATES.pending;
                const plan = student.plan;
                const payment = student.payment || {};
                const billingType = plan?.billingType === 'CREDIT_CARD'
                  ? `Cartão${plan.automaticReady ? ' · automático' : ''}`
                  : plan?.billingType === 'PIX' ? 'Pix' : plan?.billingType === 'BOLETO' ? 'Boleto' : plan ? 'Manual' : 'Não configurado';
                return `<tr>
                  <td data-label="Aluno"><strong>${escapeHtml(student.fullName)}</strong><small>${escapeHtml(student.email)}${student.className ? ` · ${escapeHtml(student.className)}` : ''}</small></td>
                  <td data-label="Plano"><strong>${plan ? formatBrl(plan.amount) : '—'}</strong><small>${plan ? `Dia ${Number(plan.dueDay || 1)} · ${escapeHtml(plan.status || '')}` : 'Sem mensalidade'}</small></td>
                  <td data-label="Vencimento"><strong>${payment.dueDate ? formatPaymentDate(payment.dueDate) : '—'}</strong><small>${payment.paidAt ? `Pago em ${formatFinancialDate(payment.paidAt)}` : payment.failureReason ? escapeHtml(payment.failureReason) : ''}</small></td>
                  <td data-label="Pagamento"><strong>${escapeHtml(billingType)}</strong><small>${payment.amount ? formatBrl(payment.amount) : ''}</small></td>
                  <td data-label="Situação"><span class="financial-status is-${escapeAttribute(state.tone)}">${escapeHtml(state.label)}</span></td>
                  <td data-label="Conta"><span class="financial-status is-${student.accountActive ? 'success' : 'danger'}">${student.accountActive ? 'Ativa' : 'Bloqueada'}</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </details>`;
  }).filter(Boolean);
  const resultCount = document.getElementById('globalStudentFinanceResultCount');
  if (resultCount) resultCount.textContent = `${visibleStudents} aluno${visibleStudents === 1 ? '' : 's'}`;
  host.innerHTML = groups.length
    ? groups.join('')
    : '<p class="financial-empty-state">Nenhum aluno encontrado para estes filtros.</p>';
};

const loadGlobalStudentFinance = async () => {
  const section = document.getElementById('globalStudentFinanceSection');
  if (!section || !isGlobalAdminUser()) return;
  try {
    const response = await authorizedFetch('/api/admin/student-payments/global-overview');
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Não foi possível carregar o financeiro dos alunos.');
    globalStudentFinanceCache = {
      summary: payload.summary || {},
      professors: Array.isArray(payload.professors) ? payload.professors : []
    };
    const select = document.getElementById('globalStudentFinanceProfessor');
    if (select) {
      const selected = select.value || 'all';
      select.innerHTML = '<option value="all">Todos os professores</option>'
        + globalStudentFinanceCache.professors.map((professor) => `<option value="${escapeAttribute(professor.id)}">${escapeHtml(professor.name)}</option>`).join('');
      if (Array.from(select.options).some((option) => option.value === selected)) select.value = selected;
    }
    renderGlobalStudentFinanceSummary();
    renderGlobalStudentFinance();
    const updatedAt = document.getElementById('globalStudentFinanceUpdatedAt');
    if (updatedAt) updatedAt.textContent = `Atualizado em ${new Date(payload.generatedAt || Date.now()).toLocaleString('pt-BR')}`;
  } catch (error) {
    const host = document.getElementById('globalProfessorStudentFinanceList');
    if (host) host.innerHTML = `<p class="financial-empty-state">${escapeHtml(error.message)}</p>`;
  }
};

const initGlobalStudentFinance = () => {
  ['globalStudentFinanceSearch', 'globalStudentFinanceProfessor', 'globalStudentFinanceStatus'].forEach((id) => {
    const eventName = id === 'globalStudentFinanceSearch' ? 'input' : 'change';
    document.getElementById(id)?.addEventListener(eventName, renderGlobalStudentFinance);
  });
  void loadGlobalStudentFinance();
};

const formatFinancialDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return 'Sem vencimento';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const getProfessorFinancialStatus = (professor = {}) => {
  if (!professor.is_active) return { key: 'blocked', label: 'Bloqueado', tone: 'danger' };
  if (!professor.billing?.managed) return { key: 'manual', label: 'Sem assinatura', tone: 'neutral' };
  const states = {
    active: { label: 'Em dia', tone: 'success' },
    due_soon: { label: 'Vence em breve', tone: 'warning' },
    payment_pending: { label: 'Pagamento pendente', tone: 'info' },
    payment_failed: { label: 'Falha no pagamento', tone: 'danger' },
    expired: { label: 'Vencida', tone: 'danger' }
  };
  return { key: professor.billing.state, ...(states[professor.billing.state] || states.active) };
};

const getPaymentEventLabel = (eventType) => ({
  PAYMENT_CONFIRMED: 'Pagamento confirmado',
  PAYMENT_RECEIVED: 'Pagamento recebido',
  PAYMENT_CREATED: 'Cobrança criada',
  PAYMENT_UPDATED: 'Cobrança atualizada',
  PAYMENT_OVERDUE: 'Cobrança vencida',
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: 'Cartão recusado',
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'Reprovado na análise',
  PAYMENT_AWAITING_RISK_ANALYSIS: 'Em análise de risco',
  PAYMENT_REFUNDED: 'Pagamento estornado',
  PAYMENT_CHARGEBACK_REQUESTED: 'Chargeback solicitado',
  PAYMENT_DELETED: 'Cobrança removida'
}[eventType] || (eventType ? String(eventType).replaceAll('_', ' ') : 'Sem evento financeiro'));

const getPaymentStatusLabel = (paymentStatus) => ({
  ACTIVE: 'Ativa',
  CONFIRMED: 'Confirmado',
  RECEIVED: 'Recebido',
  PENDING: 'Pendente',
  OVERDUE: 'Vencido',
  REFUNDED: 'Estornado',
  REFUSED: 'Recusado',
  FAILED: 'Falhou',
  INACTIVE: 'Inativa'
}[String(paymentStatus || '').toUpperCase()] || (paymentStatus ? String(paymentStatus).replaceAll('_', ' ') : 'Sem cobrança'));

const renderProfessorFinancialSummary = () => {
  const summary = adminProfessorFinancialSummary || {};
  const values = {
    financeEstimatedMrr: formatBrl(summary.projectedMonthlyRevenue),
    financeReceivedMonth: formatBrl(summary.receivedThisMonth),
    financeActiveSubscriptions: Number(summary.activeSubscriptions || 0),
    financeDueSoon: Number(summary.dueSoon || 0),
    financeAtRisk: Number(summary.atRisk || 0),
    financeTotalStudents: Number(summary.totalStudents || 0)
  };
  Object.entries(values).forEach(([id, value]) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  });
  const breakdown = document.getElementById('professorFinancialBreakdown');
  if (breakdown) {
    const plans = Array.isArray(summary.planBreakdown) ? summary.planBreakdown : [];
    breakdown.innerHTML = `
      <span><strong>${Number(summary.pixSubscriptions || 0)}</strong> Pix</span>
      <span><strong>${Number(summary.cardSubscriptions || 0)}</strong> cartão</span>
      <span><strong>${Number(summary.managedSubscriptions || 0)}</strong> assinaturas gerenciadas</span>
      ${plans.map((item) => `<span><strong>${Number(item.professors || 0)}</strong> ${escapeHtml(item.plan)} · ${formatBrl(item.monthlyRevenue)}</span>`).join('')}
    `;
  }
};

const getFilteredAdminProfessors = () => {
  const search = String(document.getElementById('professorFinanceSearch')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('professorFinanceStatus')?.value || 'all';
  const billingFilter = document.getElementById('professorFinanceBillingType')?.value || 'all';
  const rank = { blocked: 0, expired: 1, payment_failed: 2, due_soon: 3, payment_pending: 4, active: 5, manual: 6 };
  return adminProfessorsCache
    .filter((professor) => {
      const status = getProfessorFinancialStatus(professor);
      const matchesSearch = !search || `${professor.full_name} ${professor.email}`.toLowerCase().includes(search);
      const matchesStatus = statusFilter === 'all' || status.key === statusFilter;
      const paymentType = professor.billing?.managed ? professor.billing.billingType : 'manual';
      const matchesBilling = billingFilter === 'all' || paymentType === billingFilter;
      return matchesSearch && matchesStatus && matchesBilling;
    })
    .sort((a, b) => {
      const statusDifference = (rank[getProfessorFinancialStatus(a).key] ?? 9) - (rank[getProfessorFinancialStatus(b).key] ?? 9);
      if (statusDifference) return statusDifference;
      const aExpiration = new Date(a.billing?.accessExpiresAt || '9999-12-31').getTime();
      const bExpiration = new Date(b.billing?.accessExpiresAt || '9999-12-31').getTime();
      return aExpiration - bExpiration || a.full_name.localeCompare(b.full_name, 'pt-BR');
    });
};

const renderAdminProfessors = () => {
  const list = document.getElementById('adminProfessorList');
  if (!list) return;
  const professors = getFilteredAdminProfessors();
  const count = document.getElementById('professorFinanceResultCount');
  if (count) count.textContent = `${professors.length} ${professors.length === 1 ? 'professor' : 'professores'}`;
  if (!professors.length) {
    list.innerHTML = '<p class="financial-empty-state">Nenhum professor encontrado para estes filtros.</p>';
    return;
  }
  list.innerHTML = professors
    .map((professor) => {
      const status = getProfessorFinancialStatus(professor);
      const billing = professor.billing || {};
      const paymentLabel = billing.billingType === 'PIX'
        ? 'Pix'
        : billing.billingType === 'CREDIT_CARD'
          ? `Cartão${billing.automaticRenewal ? ' · automático' : ''}`
          : 'Cadastro manual';
      const expirationDetail = billing.managed
        ? `${formatFinancialDate(billing.accessExpiresAt)}${Number.isFinite(Number(billing.daysRemaining)) ? ` · ${Number(billing.daysRemaining)} dia(s)` : ''}`
        : 'Não controlado pelo financeiro';
      return `
      <article class="professor-financial-item" data-financial-state="${escapeAttribute(status.key)}">
        <div class="professor-financial-head">
          <div>
            <h3>${escapeHtml(professor.full_name)}</h3>
            <p>${escapeHtml(professor.email)}${professor.phone ? ` · ${escapeHtml(professor.phone)}` : ''}</p>
          </div>
          <span class="financial-status is-${status.tone}">${escapeHtml(status.label)}</span>
        </div>
        <div class="professor-financial-data">
          <div><span>Plano</span><strong>${escapeHtml(billing.planLabel || 'Cadastro manual')}</strong></div>
          <div><span>Mensalidade</span><strong>${billing.amount === null || billing.amount === undefined ? '—' : formatBrl(billing.amount)}</strong></div>
          <div><span>Próximo vencimento</span><strong>${escapeHtml(expirationDetail)}</strong></div>
          <div><span>Pagamento</span><strong>${escapeHtml(paymentLabel)}</strong></div>
          <div><span>Status no gateway</span><strong>${escapeHtml(getPaymentStatusLabel(billing.paymentStatus))}</strong></div>
          <div><span>Último evento</span><strong>${escapeHtml(getPaymentEventLabel(billing.lastEventType))}</strong></div>
          <div><span>Desde</span><strong>${formatFinancialDate(billing.activatedAt || professor.created_at)}</strong></div>
        </div>
        <div class="professor-capacity-strip">
          <span>Créditos <strong>${Number(professor.platformCredits || 0)}</strong></span>
          <span>Alunos <strong>${Number(professor.studentCount || 0)}${professor.studentLimit ? ` / ${Number(professor.studentLimit)}` : ''}</strong></span>
          <span>Armazenamento <strong>${formatStorageAmount(professor.storageUsedBytes || 0)}${professor.storageLimitBytes ? ` / ${formatStorageAmount(professor.storageLimitBytes)}` : ''}</strong></span>
        </div>
        <div class="professor-management-controls">
          <input type="number" min="0.5" step="0.5" value="10" data-professor-credit-input="${professor.id}" style="max-width:120px;" />
          <input type="number" min="1" step="1" value="${professor.studentLimit || ''}" data-professor-student-limit="${professor.id}" placeholder="Limite alunos" style="max-width:140px;" />
          <input type="number" min="0" step="0.1" value="${professor.storageLimitBytes ? (Number(professor.storageLimitBytes) / (1024 * 1024 * 1024)).toFixed(2) : ''}" data-professor-storage-limit="${professor.id}" placeholder="Limite GB" style="max-width:140px;" />
          <button class="secondary-btn small" type="button" data-professor-limits-save="${professor.id}">Salvar limites</button>
          <button class="primary-btn" type="button" data-professor-credit-add="${professor.id}" style="width:auto;">Adicionar créditos</button>
          <button class="secondary-btn small" type="button" data-professor-toggle="${professor.id}">
            ${professor.is_active ? 'Bloquear' : 'Autorizar'}
          </button>
          <button class="secondary-btn small" type="button" data-professor-delete="${professor.id}" style="border-color:#ff8a8a; color:#ff6b6b;">
            Excluir
          </button>
        </div>
      </article>
    `;
    })
    .join('');
};

const loadAdminProfessors = async () => {
  const section = document.getElementById('adminProfessorsSection');
  if (!section || !isGlobalAdminUser()) {
    if (section) {
      section.style.display = 'none';
    }
    return;
  }
  try {
    const response = await authorizedFetch('/api/admin/professors/financial-overview');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || 'Não foi possível carregar o financeiro.');
    adminProfessorsCache = Array.isArray(payload?.professors) ? payload.professors : [];
    adminProfessorFinancialSummary = payload?.summary || null;
    renderProfessorFinancialSummary();
    const updatedAt = document.getElementById('professorFinanceUpdatedAt');
    if (updatedAt) updatedAt.textContent = `Atualizado em ${new Date(payload.generatedAt || Date.now()).toLocaleString('pt-BR')}`;
    renderAdminProfessors();
  } catch (error) {
    const list = document.getElementById('adminProfessorList');
    if (list) {
      list.innerHTML = '<p style="margin:0; color:#ff6b6b;">Não foi possível carregar os professores.</p>';
    }
  }
};

const loadAdminCourses = async () => {
  const container = document.getElementById('adminCourseList');
  if (!container) return;
  try {
    const response = await authorizedFetch('/api/admin/courses');
    const courses = await response.json();
    adminCoursesCache = courses;
    syncFaceManualGrantOptions();
    if (!courses.length) {
      container.innerHTML = '<p style="margin:0; color:#8b92b1;">Nenhum curso cadastrado.</p>';
      updateEnrollmentCourseSelect();
      return;
    }
    container.innerHTML = courses
      .map((course) => {
        const coverImage = getCourseCoverImage(course);
        return `
        <article class="admin-course-card admin-course-item">
          <div class="admin-course-content">
            <div class="course-cover-preview-card admin-course-thumb"${coverImage ? ` style="background-image:linear-gradient(155deg, rgba(16, 20, 52, 0.18), rgba(16, 20, 52, 0.02)), url('${coverImage.replace(/'/g, "\'")}')"` : ''}>
              <div class="course-cover-preview-copy">
                <strong>${escapeHtml(course.title)}</strong>
                <small>${coverImage ? 'Capa ativa no portal.' : 'Curso sem capa cadastrada.'}</small>
              </div>
            </div>
            <div class="admin-course-copy">
              <strong>${escapeHtml(course.title)}</strong>
              <p style="margin:0; color:#8b92b1; font-size:0.85rem;">${escapeHtml(course.slug)}</p>
              <small style="color:#8b92b1; font-size:0.8rem;">${escapeHtml(course.description || 'Sem descri\u00e7\u00e3o')}</small>
              ${renderOwnerMeta(course)}
              <div class="admin-course-meta">
                <small style="color:#6d63ff; display:block; margin-top:0.35rem; font-size:0.75rem;">${course.module_count || 0} m\u00f3dulo(s)</small>
                <small class="admin-course-store-badge ${coverImage ? 'is-visible' : ''}">${coverImage ? 'Com capa' : 'Sem capa'}</small>
                <small class="admin-course-store-badge ${course.show_in_store ? 'is-visible' : ''}">${course.show_in_store ? 'Na loja do aluno' : 'Fora da loja'}</small>
                ${Number(course.pending_request_count) > 0 ? `<small class="admin-course-request-badge">${course.pending_request_count} solicita\u00e7\u00e3o(\u00f5es)</small>` : ''}
              </div>
            </div>
          </div>
          <div class="admin-course-actions">
            <button
              data-course-id="${course.id}"
              data-course-edit-cover="true"
              class="secondary-btn small"
              type="button"
            >
              Editar capa
            </button>
            <button
              data-course-id="${course.id}"
              data-course-store-visible="${course.show_in_store ? 'true' : 'false'}"
              class="secondary-btn small admin-course-store-toggle"
              type="button"
            >
              ${course.show_in_store ? 'Ocultar da loja' : 'Exibir na loja'}
            </button>
            <button data-course-id="${course.id}" class="secondary-btn small" type="button">Excluir</button>
            <div class="admin-course-cover-menu" ${editingCourseCoverId === course.id ? '' : 'hidden'}>
              <div class="admin-course-cover-menu-head">
                <div>
                  <strong>Editar capa</strong>
                  <p style="margin:0.2rem 0 0; color:#8b92b1; font-size:0.84rem;">${escapeHtml(course.title)}</p>
                </div>
                <button class="secondary-btn small" type="button" data-course-cover-close="${course.id}">Fechar</button>
              </div>
              <div class="compact-inline">
                <select data-course-cover-mode="${course.id}">
                  <option value="local" ${editingCourseCoverMode === 'local' ? 'selected' : ''}>Arquivo do computador</option>
                  <option value="url" ${editingCourseCoverMode === 'url' ? 'selected' : ''}>URL da imagem</option>
                </select>
                <button class="secondary-btn icon-only-btn" type="button" data-course-cover-apply="${course.id}" aria-label="Adicionar nova capa" title="Adicionar nova capa">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                  </svg>
                </button>
              </div>
              <div class="field-group" style="display:${editingCourseCoverMode === 'url' ? 'block' : 'none'};">
                <label>URL da capa</label>
                <input data-course-cover-url="${course.id}" value="${editingCourseCoverMode === 'url' ? escapeHtml(editingCourseCoverImage) : ''}" placeholder="https://..." />
              </div>
              <div class="course-cover-preview-card admin-course-cover-preview spacious-preview"${editingCourseCoverImage ? ` style="background-image:linear-gradient(155deg, rgba(16, 20, 52, 0.18), rgba(16, 20, 52, 0.02)), url('${editingCourseCoverImage.replace(/'/g, "\\'")}')"` : ''}>
                <div class="course-cover-preview-copy">
                  <strong>${escapeHtml(course.title)}</strong>
                  <small>${editingCourseCoverImage ? 'Prévia da capa antes de salvar.' : 'Este curso ficará sem capa até você salvar uma nova imagem.'}</small>
                </div>
              </div>
              <div class="admin-course-cover-menu-actions">
                <button class="primary-btn" type="button" data-course-cover-save="${course.id}">Salvar capa</button>
                <button class="secondary-btn" type="button" data-course-remove-cover="true" data-course-id="${course.id}">Excluir capa</button>
              </div>
              <input data-course-cover-file="${course.id}" type="file" accept="image/*" hidden />
            </div>
          </div>
        </article>`;
      })
      .join('');
    updateEnrollmentCourseSelect();
  } catch (error) {
    container.innerHTML = '<p style="margin:0; color:#ff6b6b;">N\u00e3o foi poss\u00edvel carregar os cursos.</p>';
  }
};

const getAccessRequestStatusLabel = (status) => {
  if (status === 'approved') return 'Aprovada';
  if (status === 'rejected') return 'Rejeitada';
  return 'Pendente';
};

const getAccessRequestStatusClass = (status) => {
  if (status === 'approved') return 'status-pill-approved';
  if (status === 'rejected') return 'status-pill-rejected';
  return 'status-pill-pending';
};

const loadAdminAccessRequests = async () => {
  const container = document.getElementById('adminAccessRequestList');
  if (!container) return;
  try {
    const response = await authorizedFetch('/api/admin/course-access-requests');
    const requests = await response.json();
    adminAccessRequestsCache = Array.isArray(requests) ? requests : [];
    if (!adminAccessRequestsCache.length) {
      container.innerHTML = '<p style="margin:0; color:#8b92b1;">Nenhuma solicita\u00e7\u00e3o de acesso no momento.</p>';
      return;
    }
    container.innerHTML = adminAccessRequestsCache
      .map((request) => {
        const coverImage = typeof request.course_cover_image === 'string' ? request.course_cover_image.trim() : '';
        const statusLabel = getAccessRequestStatusLabel(request.status);
        const statusClass = getAccessRequestStatusClass(request.status);
        return `
          <article class="access-request-card">
            <div class="access-request-main">
              <div class="course-cover-preview-card access-request-cover"${coverImage ? ` style="background-image:linear-gradient(155deg, rgba(16, 20, 52, 0.18), rgba(16, 20, 52, 0.02)), url('${coverImage.replace(/'/g, "\'")}')"` : ''}>
                <div class="course-cover-preview-copy">
                  <strong>${escapeHtml(request.course_title)}</strong>
                  <small>${coverImage ? 'Capa vinculada ao curso.' : 'Curso sem capa cadastrada.'}</small>
                </div>
              </div>
              <div class="access-request-copy">
                <div>
                  <strong>${escapeHtml(request.student_name)}</strong>
                  <p style="margin:0.2rem 0 0; color:#8b92b1; font-size:0.9rem;">${escapeHtml(request.student_email)}</p>
                </div>
                <p style="margin:0; color:#1f2343; font-weight:600;">Curso solicitado: ${escapeHtml(request.course_title)}</p>
                <p style="margin:0; color:#8b92b1; font-size:0.85rem;">Turma: ${escapeHtml(request.student_class_name || 'Sem turma')} | Telefone: ${escapeHtml(request.student_phone || 'N\u00e3o informado')}</p>
                <div class="access-request-meta">
                  <span class="${statusClass}">${statusLabel}</span>
                  <small style="color:#8b92b1;">Solicitado em ${new Date(request.created_at).toLocaleString('pt-BR')}</small>
                </div>
              </div>
            </div>
            <div class="access-request-actions">
              <button class="primary-btn" type="button" data-access-request-id="${request.id}" data-access-decision="approved" ${request.status === 'pending' ? '' : 'disabled'}>Aceitar acesso</button>
              <button class="secondary-btn" type="button" data-access-request-id="${request.id}" data-access-decision="rejected" ${request.status === 'pending' ? '' : 'disabled'}>Rejeitar acesso</button>
            </div>
          </article>`;
      })
      .join('');
  } catch (error) {
    container.innerHTML = '<p style="margin:0; color:#ff6b6b;">N\u00e3o foi poss\u00edvel carregar as solicita\u00e7\u00f5es de acesso.</p>';
  }
};

const clearAdminReplyTarget = () => {
  adminReplyTarget = null;
  document.getElementById('adminChatReplyPreview')?.classList.add('hidden');
};

const setAdminReplyTarget = (message) => {
  adminReplyTarget = message || null;
  const preview = document.getElementById('adminChatReplyPreview');
  const author = document.getElementById('adminChatReplyAuthor');
  const text = document.getElementById('adminChatReplyText');
  if (!preview || !author || !text) return;
  if (!message) {
    preview.classList.add('hidden');
    return;
  }
  author.textContent = `Respondendo para ${formatChatReplyAuthor(message)}`;
  text.textContent = truncateChatPreview(message.message, 180) || 'Mensagem selecionada';
  preview.classList.remove('hidden');
};

const renderAdminChatMessages = (messages) => {
  const container = document.getElementById('adminChatMessages');
  if (!container) return;
  adminCurrentChatMessages = Array.isArray(messages) ? messages : [];
  if (!messages.length) {
    container.innerHTML = '<p style="margin:0; color:#8b92b1; text-align:center;">Nenhuma mensagem ainda neste curso.</p>';
    return;
  }
  const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 90;
  container.innerHTML = messages.map((msg) => {
    const isAdmin = msg.role === 'admin' || msg.role === 'professor';
    const safeMessage = escapeHtml(msg.message);
    const safeName = escapeHtml(msg.full_name);
    const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="chat-bubble ${isAdmin ? 'mine' : 'theirs'}" data-admin-chat-message-id="${msg.id}">
        ${renderChatAvatar(msg)}
        ${buildReplyQuoteMarkup(msg)}
        <strong style="font-size:0.78rem; display:block; margin-bottom:0.2rem;">${isAdmin ? `Professor ${safeName}` : safeName}</strong>
        ${safeMessage}
        <span class="chat-bubble-meta">${time}</span>
        <div class="chat-bubble-actions">
          <button type="button" class="chat-link-btn" data-admin-reply-id="${msg.id}">Responder</button>
        </div>
      </div>
    `;
  }).join('');
  if (isNearBottom) {
    container.scrollTop = container.scrollHeight;
  }
};

const renderAdminChatCourseList = () => {
  const container = document.getElementById('adminChatCourseList');
  if (!container) return;
  if (!adminChatCoursesCache.length) {
    container.innerHTML = '<p style="margin:0; color:#8b92b1;">Nenhum chat de curso disponivel.</p>';
    return;
  }
  container.innerHTML = adminChatCoursesCache.map((course) => `
    <button type="button" class="admin-chat-course-item ${adminActiveChatCourseId === course.id ? 'active' : ''}" data-admin-chat-course="${course.id}">
      <div class="admin-chat-course-head">
        <strong>${escapeHtml(course.title)}</strong>
        ${Number(course.unread_count) > 0 ? `<span class="unread-badge">${Number(course.unread_count)}</span>` : ''}
      </div>
      <p style="color:#5f678a; font-size:0.83rem;">${escapeHtml(truncateChatPreview(course.last_message || 'Sem mensagens ainda.', 72))}</p>
      ${renderOwnerMeta(course)}
      <small style="color:#8b92b1;">${course.last_message_created_at ? new Date(course.last_message_created_at).toLocaleString('pt-BR') : 'Aguardando conversa'}</small>
    </button>
  `).join('');
};

const loadAdminChatCourses = async (keepSelection = true) => {
  const container = document.getElementById('adminChatCourseList');
  if (!container) return;
  try {
    const response = await authorizedFetch('/api/chat/admin/courses');
    const courses = await response.json();
    adminChatCoursesCache = Array.isArray(courses) ? courses : [];
    if (!keepSelection || !adminChatCoursesCache.some((course) => course.id === adminActiveChatCourseId)) {
      adminActiveChatCourseId = adminChatCoursesCache[0]?.id || '';
    }
    renderAdminChatCourseList();
  } catch (error) {
    container.innerHTML = '<p style="margin:0; color:#ff6b6b;">Nao foi possivel carregar os chats dos cursos.</p>';
  }
};

const openAdminCourseChat = async (courseId) => {
  if (!courseId) return;
  adminActiveChatCourseId = courseId;
  const activeCourse = adminChatCoursesCache.find((course) => course.id === courseId);
  const title = document.getElementById('adminChatTitle');
  const subtitle = document.getElementById('adminChatSubtitle');
  const messages = document.getElementById('adminChatMessages');
  if (title) {
    title.textContent = activeCourse?.title || 'Chat do curso';
  }
  if (subtitle) {
    const ownerText = isGlobalAdminUser() && activeCourse
      ? ` • Professor: ${formatOwnerLabel(activeCourse)}`
      : '';
    subtitle.textContent = activeCourse?.slug ? `Curso: ${activeCourse.slug}${ownerText}` : `Acompanhe a conversa deste curso.${ownerText}`;
  }
  if (messages) {
    messages.innerHTML = '<p style="margin:0; color:#8b92b1; text-align:center;">Carregando mensagens...</p>';
  }
  clearAdminReplyTarget();
  renderAdminChatCourseList();
  await fetchAdminCourseChatMessages(courseId, { markRead: true });
};

const fetchAdminCourseChatMessages = async (courseId, options = {}) => {
  const { markRead = false } = options;
  const messages = document.getElementById('adminChatMessages');
  try {
    const response = await authorizedFetch(`/api/chat/${encodeURIComponent(courseId)}`);
    const data = await response.json();
    renderAdminChatMessages(Array.isArray(data) ? data : []);
    if (markRead) {
      await authorizedFetch(`/api/chat/${encodeURIComponent(courseId)}/read`, { method: 'POST' });
      await loadAdminChatCourses(true);
    }
  } catch (error) {
    if (messages) {
      messages.innerHTML = '<p style="margin:0; color:#ff6b6b; text-align:center;">Nao foi possivel abrir este chat.</p>';
    }
  }
};
const loadReports = async () => {
  const tbody = document.getElementById('reportsTableBody');
  const correctedTbody = document.getElementById('correctedReportsTableBody');
  if (!tbody || !correctedTbody) return;
  const showOwnerColumn = isGlobalAdminUser();
  document.querySelectorAll('.progress-table.admin-responsive-table thead tr').forEach((headerRow) => {
    const ownerHeader = headerRow.querySelector('[data-report-owner-header]');
    if (showOwnerColumn && !ownerHeader) {
      const th = document.createElement('th');
      th.dataset.reportOwnerHeader = 'true';
      th.textContent = 'Professor';
      headerRow.insertBefore(th, headerRow.children[2] || null);
    } else if (!showOwnerColumn && ownerHeader) {
      ownerHeader.remove();
    }
  });
  const emptyColspan = showOwnerColumn ? 7 : 6;
  try {
    const response = await authorizedFetch('/api/admin/reports');
    const data = await response.json();
    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="${emptyColspan}" style="color:#8b92b1;">Nenhum progresso registrado.</td></tr>`;
      correctedTbody.innerHTML = `<tr><td colspan="${emptyColspan}" style="color:#8b92b1;">Nenhum relatório corrigido ainda.</td></tr>`;
      return;
    }
    const pendingReports = data.filter((row) => !row.report_corrected_at);
    const correctedReports = data.filter((row) => Boolean(row.report_corrected_at));
    tbody.innerHTML = pendingReports.length
      ? pendingReports
          .map((row) => renderReportRows(row, 'pending'))
          .join('')
      : `<tr><td colspan="${emptyColspan}" style="color:#8b92b1;">Nenhum relatório pendente no momento.</td></tr>`;
    correctedTbody.innerHTML = correctedReports.length
      ? correctedReports
          .map((row) => renderReportRows(row, 'corrected'))
          .join('')
      : `<tr><td colspan="${emptyColspan}" style="color:#8b92b1;">Nenhum relatório corrigido ainda.</td></tr>`;
    return;
    tbody.innerHTML = data
      .map(
        (row) => `
          <tr>
            <td>
              <strong>${row.full_name}</strong>
              <small style="display:block; color:#8b92b1;">${row.email}</small>
            </td>
            <td>${row.course_title}</td>
            <td>${row.current_module || 'Módulo 1'}</td>
            <td>${renderModulePerformanceSummary(row)}</td>
            <td>${formatDate(row.updated_at)}</td>
            <td>
              <button
                class="secondary-btn small"
                type="button"
                data-progress-timeline-user="${row.user_id}"
                data-progress-timeline-course="${row.course_id}"
              >
                Ver passos${Number(row.progress_event_count) > 0 ? ` (${Number(row.progress_event_count)})` : ''}
              </button>
            </td>
          </tr>`
      )
      .join('');
    correctedTbody.innerHTML = correctedTbody.innerHTML || '<tr><td colspan="6" style="color:#8b92b1;">Nenhum relatório corrigido ainda.</td></tr>';
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="${emptyColspan}" style="color:#ff6b6b;">Não foi possível carregar os relatórios.</td></tr>`;
  }
};

const updateReportCorrectionState = async (userId, courseId, mode) => {
  const route = mode === 'correct' ? 'correct' : 'corrected';
  const method = mode === 'correct' ? 'POST' : 'DELETE';
  const response = await authorizedFetch(`/api/admin/reports/${userId}/${courseId}/${route}`, {
    method
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || 'Não foi possível atualizar este relatório.');
  }
  await loadReports();
};

const formatProgressEventType = (type = '') => {
  const labels = {
    slide_view: 'Entrou no slide',
    quiz_answer: 'Respondeu quiz',
    drag_end: 'Arrastou elemento',
    text_input: 'Preencheu campo',
    audio_input: 'Enviou audio',
    drawing: 'Rabiscou no quadro',
    camera_capture: 'Capturou na camera'
  };
  return labels[type] || type || 'Evento';
};

const openProgressTimelineModal = () => {
  const modal = document.getElementById('progressTimelineModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
};

const closeProgressTimelineModal = () => {
  const modal = document.getElementById('progressTimelineModal');
  const frame = document.getElementById('progressTimelineFrame');
  const list = document.getElementById('progressTimelineList');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  if (frame) {
    frame.classList.add('hidden');
    frame.removeAttribute('src');
  }
  if (list) {
    list.classList.remove('hidden');
  }
  openProgressTimelineKey = null;
};

const renderProgressTimeline = (payload) => {
  const subtitle = document.getElementById('progressTimelineSubtitle');
  const list = document.getElementById('progressTimelineList');
  const frame = document.getElementById('progressTimelineFrame');
  if (!subtitle || !list || !frame) return;
  subtitle.textContent = `${payload.student.fullName} • ${payload.course.title}${payload.course.currentModule ? ` • ${payload.course.currentModule}` : ''}`;
  if (!Array.isArray(payload.events) || !payload.events.length) {
    list.innerHTML = '<p style="margin:0; color:#8b92b1;">Nenhum passo detalhado foi registrado ainda para este aluno neste curso.</p>';
    return;
  }
  list.innerHTML = payload.events
    .map((event) => {
      const chips = [];
      if (event.slideTitle || event.slideId) chips.push(`<span class="admin-report-event-chip">Slide: ${escapeHtml(event.slideTitle || event.slideId)}</span>`);
      if (event.elementType) chips.push(`<span class="admin-report-event-chip">Elemento: ${escapeHtml(event.elementType)}</span>`);
      if (event.details?.selectedOptionText) chips.push(`<span class="admin-report-event-chip">Resposta: ${escapeHtml(event.details.selectedOptionText)}</span>`);
      if (typeof event.details?.isCorrect === 'boolean') chips.push(`<span class="admin-report-event-chip">${event.details.isCorrect ? 'Acertou' : 'Errou'}</span>`);
      if (typeof event.details?.triggeredDetector === 'boolean') chips.push(`<span class="admin-report-event-chip">${event.details.triggeredDetector ? 'Encaixou no alvo' : 'Sem alvo acionado'}</span>`);
      if (Number.isFinite(Number(event.details?.x)) && Number.isFinite(Number(event.details?.y))) {
        chips.push(`<span class="admin-report-event-chip">Posição: ${Number(event.details.x).toFixed(0)} x ${Number(event.details.y).toFixed(0)}</span>`);
      }
      if (Number.isFinite(Number(event.details?.pointCount))) chips.push(`<span class="admin-report-event-chip">Pontos: ${Number(event.details.pointCount)}</span>`);
      if (Number.isFinite(Number(event.details?.strokeWidth))) chips.push(`<span class="admin-report-event-chip">Espessura: ${Number(event.details.strokeWidth).toFixed(0)}</span>`);
      if (event.details?.strokeColor) chips.push(`<span class="admin-report-event-chip">Cor: ${escapeHtml(event.details.strokeColor)}</span>`);
      if (typeof event.details?.hasImage === 'boolean') chips.push(`<span class="admin-report-event-chip">${event.details.hasImage ? 'Com imagem' : 'Sem imagem'}</span>`);
      if (typeof event.details?.hasAudio === 'boolean') chips.push(`<span class="admin-report-event-chip">${event.details.hasAudio ? 'Com audio' : 'Sem audio'}</span>`);
      if (typeof event.details?.hasVideo === 'boolean') chips.push(`<span class="admin-report-event-chip">${event.details.hasVideo ? 'Com video' : 'Sem video'}</span>`);
      const mediaPreview = event.details?.mediaUrl
        ? event.details.mediaType === 'video'
          ? `<video controls src="${escapeAttribute(event.details.mediaUrl)}" class="admin-report-event-media"></video>`
          : event.details.mediaType === 'audio'
            ? `<audio controls src="${escapeAttribute(event.details.mediaUrl)}" class="admin-report-event-media"></audio>`
            : `<img src="${escapeAttribute(event.details.mediaUrl)}" alt="Midia do aluno" class="admin-report-event-media" />`
        : '';
      return `
        <article class="admin-report-event">
          <div class="admin-report-event-head">
            <strong>${escapeHtml(formatProgressEventType(event.type))}</strong>
            <span class="admin-report-event-meta">${formatDate(event.createdAt)}</span>
          </div>
          <p class="admin-report-event-summary">${escapeHtml(event.summary || 'Sem resumo informado.')}</p>
          ${chips.length ? `<div class="admin-report-event-details">${chips.join('')}</div>` : ''}
          ${mediaPreview}
        </article>
      `;
    })
    .join('');
};

const loadProgressTimeline = async (userId, courseId) => {
  const subtitle = document.getElementById('progressTimelineSubtitle');
  const list = document.getElementById('progressTimelineList');
  const frame = document.getElementById('progressTimelineFrame');
  if (!subtitle || !list || !frame) return;
  openProgressTimelineModal();
  subtitle.textContent = 'Carregando replay visual...';
  frame.classList.add('hidden');
  list.classList.remove('hidden');
  list.innerHTML = '<p style="margin:0; color:#8b92b1;">Montando a visualização do aluno...</p>';
  const requestKey = `${userId}::${courseId}`;
  openProgressTimelineKey = requestKey;
  try {
    const response = await authorizedFetch(`/api/admin/reports/${userId}/${courseId}/timeline`);
    const payload = await response.json();
    if (openProgressTimelineKey !== requestKey) {
      return;
    }
    subtitle.textContent = `${payload.student.fullName} • ${payload.course.title}${payload.course.currentModule ? ` • ${payload.course.currentModule}` : ''}`;
    frame.src = `module-viewer.html?adminReplay=1&userId=${encodeURIComponent(userId)}&courseId=${encodeURIComponent(courseId)}`;
    frame.classList.remove('hidden');
    list.classList.add('hidden');
  } catch (error) {
    if (openProgressTimelineKey !== requestKey) {
      return;
    }
    subtitle.textContent = 'Não foi possível carregar';
    frame.classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = '<p style="margin:0; color:#ff6b6b;">Não foi possível carregar o replay visual do aluno.</p>';
  }
};

const renderAiSettingsStatus = (settings) => {
  const statusNode = document.getElementById('aiSettingsStatus');
  if (!statusNode) return;
  if (!settings?.connected) {
    statusNode.textContent = 'Nenhuma integração salva ainda.';
    statusNode.style.color = '#8b92b1';
    return;
  }
  const statusLabel = settings.isEnabled ? 'ativa' : 'desativada';
  const confirmationLabel = settings.requireConfirmation ? 'com confirmação' : 'sem confirmação';
  const imageProvider = settings.imageProvider;
  const imageLabel =
    imageProvider?.connected && imageProvider?.isEnabled
      ? ' • imagem ativa'
      : ' • imagem não configurada';
  const textCost = settings.platformCreditCosts?.text || 0.5;
  const imageCost = settings.platformCreditCosts?.image || 1.0;
  const threeDCost = settings.platformCreditCosts?.threeDImport || 5;
  statusNode.textContent = `Integração de IA ${statusLabel} • ${confirmationLabel}${imageLabel} • texto: ${formatCreditNumber(textCost)} • imagem: ${formatCreditNumber(imageCost)} • 3D: ${formatCreditNumber(threeDCost)}`;
  statusNode.style.color = settings.isEnabled ? '#6d63ff' : '#8b92b1';
};

const fillAiSettingsForm = (settings) => {
  const providerLabelInput = document.getElementById('aiProviderLabel');
  if (!providerLabelInput) return;
  providerLabelInput.value = settings?.providerLabel || 'DeepSeek';
  document.getElementById('aiProviderKey').value = settings?.providerKey || 'deepseek';
  document.getElementById('aiBaseUrl').value = settings?.baseUrl || 'https://api.deepseek.com';
  document.getElementById('aiModel').value = settings?.model || 'deepseek-v4-pro';
  document.getElementById('aiImageProviderLabel').value = settings?.imageProvider?.providerLabel || 'Nano Banana';
  document.getElementById('aiImageProviderKey').value = settings?.imageProvider?.providerKey || 'google-gemini-image';
  document.getElementById('aiImageBaseUrl').value =
    settings?.imageProvider?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  document.getElementById('aiImageModel').value = settings?.imageProvider?.model || 'gemini-2.5-flash-image';
  const aiTextCreditCostInput = document.getElementById('aiTextCreditCostPerCall');
  if (aiTextCreditCostInput) aiTextCreditCostInput.value = settings?.platformCreditCosts?.text || 0.5;
  const aiImageCreditCostInput = document.getElementById('aiImageCreditCostPerCall');
  if (aiImageCreditCostInput) aiImageCreditCostInput.value = settings?.platformCreditCosts?.image || 1.0;
  const threeDCostInput = document.getElementById('threeDImportCreditCost');
  if (threeDCostInput) threeDCostInput.value = settings?.platformCreditCosts?.threeDImport || 5;
  document.getElementById('aiSystemPrompt').value = settings?.systemPrompt || '';
  document.getElementById('aiRequireConfirmation').checked = settings?.requireConfirmation !== false;
  document.getElementById('aiEnabled').checked = settings?.isEnabled !== false;
  document.getElementById('aiImageEnabled').checked = settings?.imageProvider?.isEnabled !== false;
  document.getElementById('aiApiKey').value = '';
  document.getElementById('aiImageApiKey').value = '';
  renderAiSettingsStatus(settings);
};

const loadAdminAiSettings = async () => {
  try {
    const response = await authorizedFetch('/api/admin/ai-settings');
    const settings = await response.json();
    adminAiSettingsCache = settings;
    fillAiSettingsForm(settings);
  } catch (error) {
    renderAiSettingsStatus(null);
  }
};

const loadAdminNotifications = async () => {
  const list = document.getElementById('adminNotificationList');
  if (!list) return;
  try {
    const response = await authorizedFetch('/api/admin/notifications');
    const notifications = await response.json();
    if (!Array.isArray(notifications) || !notifications.length) {
      list.innerHTML = '<p class="muted" style="margin:0;">Nenhuma notificação cadastrada.</p>';
      return;
    }
    list.innerHTML = notifications
      .map(
        (notification) => `
          <div class="module-list-item" data-notification-id="${escapeAttribute(notification.id)}">
            <h4>${linkifyText(notification.message)}</h4>
            ${renderNotificationAttachments(notification.attachments)}
            <p>Destino: ${escapeHtml(notification.target_type)}${notification.target_value ? ` • ${escapeHtml(notification.target_value)}` : ''}</p>
            ${renderOwnerMeta(notification)}
            <p>${escapeHtml(new Date(notification.created_at).toLocaleString('pt-BR'))}</p>
            <div class="actions">
              <button class="secondary-btn danger" type="button" data-notification-id="${escapeHtml(notification.id)}">Apagar</button>
            </div>
          </div>
        `
      )
      .join('');
  } catch (error) {
    list.innerHTML = '<p class="muted" style="margin:0; color:#ff6b6b;">Não foi possível carregar as notificações.</p>';
  }
};

const loadAdminSmtpSettings = async () => {
  const statusEl = document.getElementById('smtpSettingsStatus');
  if (!statusEl) return;
  if (!isGlobalAdminUser()) {
    const panel = document.getElementById('adminSmtpSettingsSection');
    if (panel) {
      panel.remove();
    }
    return;
  }
  try {
    const response = await authorizedFetch('/api/admin/smtp-settings');
    const settings = await response.json();
    document.getElementById('smtpHost').value = settings.host || '';
    document.getElementById('smtpPort').value = settings.port || '';
    document.getElementById('smtpSecure').checked = settings.secure !== false;
    document.getElementById('smtpUser').value = settings.user_email || '';
    document.getElementById('smtpPass').value = '';
    document.getElementById('smtpFrom').value = settings.from_email || '';
    statusEl.textContent = 'Configurações de E-mail carregadas.';
  } catch (error) {
    statusEl.textContent = 'Falha ao carregar configurações de E-mail.';
    statusEl.style.color = '#ff6b6b';
  }
};

const appendAdminAssistantMessage = (role, content) => {
  const container = document.getElementById('adminAssistantConversation');
  if (!container) return;
  const safeRole = role === 'user' ? 'user' : 'assistant';
  const wrapper = document.createElement('div');
  wrapper.className = `admin-assistant-message ${safeRole}`;
  wrapper.innerHTML = safeRole === 'assistant'
    ? `
      <span class="admin-assistant-avatar" aria-hidden="true">IA</span>
      <div>
        <strong>Assistente Criatyve</strong>
        <p>${escapeHtml(content)}</p>
      </div>
    `
    : `
      <div>
        <strong>Você</strong>
        <p>${escapeHtml(content)}</p>
      </div>
    `;
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
};

const setAdminAssistantStatus = (message, tone = 'neutral') => {
  const status = document.getElementById('adminAssistantStatus');
  if (!status) return;
  status.textContent = message;
  status.style.color = tone === 'error'
    ? '#c63b3b'
    : tone === 'success'
      ? '#126b5c'
      : '#7b8499';
};

const clearAdminAssistantProposal = () => {
  adminAssistantProposalId = '';
  const panel = document.getElementById('adminAssistantProposal');
  if (!panel) return;
  panel.classList.add('hidden');
  panel.replaceChildren();
};

const renderAdminAssistantProposal = (payload) => {
  const panel = document.getElementById('adminAssistantProposal');
  const actions = Array.isArray(payload?.actions) ? payload.actions : [];
  if (!panel || !payload?.proposalId || !actions.length) {
    clearAdminAssistantProposal();
    return;
  }
  adminAssistantProposalId = payload.proposalId;
  const hasDangerousAction = actions.some((action) => action.dangerous);
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="admin-assistant-proposal-head">
      <div>
        <h3>${hasDangerousAction ? 'Revise com atenção' : 'Ações prontas para confirmar'}</h3>
        <small>${hasDangerousAction ? 'Esta proposta contém remoção ou exclusão.' : 'Nada foi alterado ainda.'}</small>
      </div>
      <span class="toggle-pill">${actions.length} ${actions.length === 1 ? 'ação' : 'ações'}</span>
    </div>
    <div class="admin-assistant-action-list">
      ${actions.map((action, index) => `
        <div class="admin-assistant-action ${action.dangerous ? 'dangerous' : ''}">
          <span class="admin-assistant-action-index">${index + 1}</span>
          <div>
            <strong>${escapeHtml(action.label || 'Ação')}</strong>
            <p>${escapeHtml(action.summary || '')}</p>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="admin-assistant-proposal-actions">
      <button type="button" class="primary-btn" data-assistant-confirm>Confirmar e executar</button>
      <button type="button" class="secondary-btn" data-assistant-cancel>Cancelar</button>
    </div>
  `;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

const refreshAdminAfterAssistantAction = async () => {
  await Promise.allSettled([
    loadAdminStudents(),
    loadAdminClasses(),
    loadAdminCourses(),
    loadAdminAccessRequests(),
    loadReports(),
    loadAdminNotifications(),
    loadAdminChatCourses(false),
    loadProfessorCreditsStatus()
  ]);
};

const sendAdminAssistantMessage = async (messageValue = '') => {
  if (adminAssistantBusy) return;
  const input = document.getElementById('adminAssistantInput');
  const sendButton = document.getElementById('adminAssistantSendBtn');
  const message = String(messageValue || input?.value || '').slice(0, 2000).trim();
  if (!message) return;
  adminAssistantBusy = true;
  if (input) input.value = '';
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = 'Analisando...';
  }
  clearAdminAssistantProposal();
  appendAdminAssistantMessage('user', message);
  setAdminAssistantStatus('Lendo os dados permitidos do painel e preparando a resposta...');
  try {
    const response = await authorizedFetch('/api/admin/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        history: adminAssistantHistory.slice(-12)
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'A assistente não conseguiu responder.');
    }
    appendAdminAssistantMessage('assistant', payload.reply || 'Pedido analisado.');
    adminAssistantHistory.push(
      { role: 'user', content: message },
      { role: 'assistant', content: payload.reply || 'Pedido analisado.' }
    );
    adminAssistantHistory = adminAssistantHistory.slice(-12);
    renderAdminAssistantProposal(payload);
    if (Number.isFinite(Number(payload.platformCreditsRemaining))) {
      setAdminAssistantStatus(`Resposta concluída. Saldo: ${formatCreditNumber(payload.platformCreditsRemaining)} créditos.`, 'success');
      await loadProfessorCreditsStatus();
    } else {
      setAdminAssistantStatus(payload.requiresConfirmation
        ? 'Revise as ações e confirme para aplicá-las.'
        : 'Resposta concluída.', 'success');
    }
  } catch (error) {
    appendAdminAssistantMessage('assistant', error.message || 'Não consegui concluir esse pedido.');
    setAdminAssistantStatus(error.message || 'Não foi possível usar a assistente.', 'error');
  } finally {
    adminAssistantBusy = false;
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.textContent = 'Enviar';
    }
    input?.focus();
  }
};

const executeAdminAssistantProposal = async () => {
  if (!adminAssistantProposalId || adminAssistantBusy) return;
  const proposalId = adminAssistantProposalId;
  const panel = document.getElementById('adminAssistantProposal');
  const confirmButton = panel?.querySelector('[data-assistant-confirm]');
  const cancelButton = panel?.querySelector('[data-assistant-cancel]');
  adminAssistantBusy = true;
  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = 'Executando...';
  }
  if (cancelButton) cancelButton.disabled = true;
  setAdminAssistantStatus('Aplicando as ações com validação de permissão...');
  try {
    const response = await authorizedFetch(`/api/admin/assistant/proposals/${encodeURIComponent(proposalId)}/execute`, {
      method: 'POST'
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Não foi possível executar a proposta.');
    }
    const resultText = Array.isArray(payload?.results) && payload.results.length
      ? payload.results.map((item) => item.result).join(' ')
      : (payload?.message || 'Ações concluídas.');
    appendAdminAssistantMessage('assistant', resultText);
    adminAssistantHistory.push({ role: 'assistant', content: resultText });
    adminAssistantHistory = adminAssistantHistory.slice(-12);
    clearAdminAssistantProposal();
    setAdminAssistantStatus('Ações concluídas e painel atualizado.', 'success');
    await refreshAdminAfterAssistantAction();
  } catch (error) {
    appendAdminAssistantMessage('assistant', error.message || 'Não foi possível executar as ações.');
    setAdminAssistantStatus(error.message || 'Falha ao executar a proposta.', 'error');
    clearAdminAssistantProposal();
  } finally {
    adminAssistantBusy = false;
  }
};

const initAdminAssistant = () => {
  const form = document.getElementById('adminAssistantForm');
  const input = document.getElementById('adminAssistantInput');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await sendAdminAssistantMessage();
  });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form?.requestSubmit();
    }
  });
  document.querySelectorAll('[data-assistant-suggestion]').forEach((button) => {
    button.addEventListener('click', async () => {
      await sendAdminAssistantMessage(button.dataset.assistantSuggestion || '');
    });
  });
  document.getElementById('adminAssistantProposal')?.addEventListener('click', async (event) => {
    if (event.target.closest('[data-assistant-confirm]')) {
      await executeAdminAssistantProposal();
      return;
    }
    if (event.target.closest('[data-assistant-cancel]')) {
      clearAdminAssistantProposal();
      setAdminAssistantStatus('Proposta cancelada. Nenhuma alteração foi feita.');
    }
  });
  document.getElementById('adminAssistantClearBtn')?.addEventListener('click', () => {
    adminAssistantHistory = [];
    clearAdminAssistantProposal();
    const conversation = document.getElementById('adminAssistantConversation');
    if (conversation) {
      conversation.innerHTML = `
        <div class="admin-assistant-message assistant">
          <span class="admin-assistant-avatar" aria-hidden="true">IA</span>
          <div>
            <strong>Assistente Criatyve</strong>
            <p>Conversa limpa. O que você quer resolver no painel?</p>
          </div>
        </div>
      `;
    }
    setAdminAssistantStatus('Cada mensagem usa o custo configurado para uma chamada de IA de texto.');
  });
};

let faceReviewImageUrls = [];

const syncFaceManualGrantOptions = () => {
  const studentSelect = document.getElementById('faceManualStudentSelect');
  const courseSelect = document.getElementById('faceManualCourseSelect');
  if (studentSelect) {
    const previous = studentSelect.value;
    studentSelect.innerHTML = '<option value="">Selecione o aluno</option>' +
      adminStudentsCache.map((student) =>
        `<option value="${escapeHtml(student.id)}">${escapeHtml(student.full_name)} · ${escapeHtml(student.email)}</option>`
      ).join('');
    if (adminStudentsCache.some((student) => student.id === previous)) studentSelect.value = previous;
  }
  if (courseSelect) {
    const previous = courseSelect.value;
    courseSelect.innerHTML = '<option value="">Selecione o curso</option>' +
      adminCoursesCache.map((course) =>
        `<option value="${escapeHtml(course.id)}">${escapeHtml(course.title)}</option>`
      ).join('');
    if (adminCoursesCache.some((course) => course.id === previous)) courseSelect.value = previous;
  }
};

const setupFaceManualGrant = () => {
  const form = document.getElementById('faceManualGrantForm');
  const courseSelect = document.getElementById('faceManualCourseSelect');
  const moduleSelect = document.getElementById('faceManualModuleSelect');
  if (!form || !courseSelect || !moduleSelect) return;
  courseSelect.addEventListener('change', async () => {
    moduleSelect.disabled = true;
    moduleSelect.innerHTML = '<option value="">Carregando módulos...</option>';
    if (!courseSelect.value) {
      moduleSelect.innerHTML = '<option value="">Selecione o curso primeiro</option>';
      return;
    }
    try {
      const response = await authorizedFetch(`/api/admin/courses/${encodeURIComponent(courseSelect.value)}/modules`);
      const modules = await response.json().catch(() => []);
      if (!response.ok) throw new Error(modules?.message || 'Não foi possível carregar os módulos.');
      const protectedModules = modules.filter((module) =>
        module?.builder_data?.moduleSettings?.faceVerification?.enabled === true &&
        module?.builder_data?.moduleSettings?.isPublic !== true
      );
      moduleSelect.innerHTML = '<option value="">Selecione o módulo</option>' +
        protectedModules.map((module) =>
          `<option value="${escapeHtml(module.id)}">${escapeHtml(module.title)}</option>`
        ).join('');
      moduleSelect.disabled = !protectedModules.length;
      if (!protectedModules.length) {
        moduleSelect.innerHTML = '<option value="">Nenhum módulo protegido neste curso</option>';
      }
    } catch (error) {
      moduleSelect.innerHTML = '<option value="">Falha ao carregar módulos</option>';
      alert(error.message || 'Não foi possível carregar os módulos.');
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const studentId = document.getElementById('faceManualStudentSelect')?.value || '';
    const moduleId = moduleSelect.value;
    const note = document.getElementById('faceManualGrantNote')?.value?.trim() || '';
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const response = await authorizedFetch('/api/admin/face-manual-grants', {
        method: 'POST',
        body: JSON.stringify({ studentId, moduleId, note })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível liberar o acesso.');
      alert('Acesso liberado por uma hora e registrado na auditoria.');
      form.reset();
      moduleSelect.disabled = true;
      moduleSelect.innerHTML = '<option value="">Selecione o curso primeiro</option>';
      syncFaceManualGrantOptions();
    } catch (error) {
      alert(error.message || 'Não foi possível liberar o acesso.');
    } finally {
      submitButton.disabled = false;
    }
  });
};

const loadFaceReviews = async () => {
  const list = document.getElementById('adminFaceReviewList');
  if (!list) return;
  faceReviewImageUrls.forEach((url) => URL.revokeObjectURL(url));
  faceReviewImageUrls = [];
  try {
    const response = await authorizedFetch('/api/admin/face-reviews');
    const reviews = await response.json().catch(() => []);
    if (!response.ok) throw new Error(reviews?.message || 'Não foi possível carregar as revisões faciais.');
    if (!reviews.length) {
      list.innerHTML = '<p class="muted" style="margin:0;">Nenhuma revisão facial foi solicitada.</p>';
      return;
    }
    list.innerHTML = reviews.map((review) => `
      <article class="face-review-card ${review.status === 'pending' ? 'is-pending' : ''}" data-face-review-id="${escapeHtml(review.id)}">
        <div class="face-review-head">
          <div>
            <span>${review.status === 'pending' ? 'Pendente' : 'Concluída'}</span>
            <h3>${escapeHtml(review.student_name || 'Aluno')}</h3>
            <p>${escapeHtml(review.student_email || '')}</p>
          </div>
          <time>${new Date(review.created_at).toLocaleString('pt-BR')}</time>
        </div>
        <div class="face-review-context">
          <strong>${escapeHtml(review.course_title || 'Curso')}</strong>
          <span>${escapeHtml(review.module_title || 'Módulo')}</span>
          <small>Finalidade: ${escapeHtml(review.purpose || 'acesso')} · ${Number(review.attempt_count || 0)} tentativas</small>
        </div>
        <div class="face-review-image" data-face-review-image>
          ${review.auditImageAvailable
            ? '<button class="secondary-btn small" type="button" data-face-review-show>Ver imagem temporária</button>'
            : '<span>Imagem temporária indisponível ou expirada.</span>'}
        </div>
        ${review.status === 'pending' ? `
          <div class="face-review-actions">
            ${review.module_id ? '<button class="primary-btn small" type="button" data-face-review-decision="approve_once">Liberar uma vez</button>' : ''}
            <button class="secondary-btn small" type="button" data-face-review-decision="reset_attempts">Novas tentativas</button>
            <button class="secondary-btn small" type="button" data-face-review-decision="require_reenrollment">Novo cadastro</button>
            <button class="secondary-btn danger small" type="button" data-face-review-decision="deny">Negar</button>
          </div>` : ''}
      </article>
    `).join('');
  } catch (error) {
    list.innerHTML = `<p class="muted" style="margin:0;">${escapeHtml(error.message || 'Falha ao carregar revisões.')}</p>`;
  }
};

const setupFaceReviewActions = () => {
  const list = document.getElementById('adminFaceReviewList');
  if (!list) return;
  list.addEventListener('click', async (event) => {
    const card = event.target.closest('[data-face-review-id]');
    if (!card) return;
    const reviewId = card.dataset.faceReviewId;
    const showButton = event.target.closest('[data-face-review-show]');
    if (showButton) {
      showButton.disabled = true;
      try {
        const response = await authorizedFetch(`/api/admin/face-reviews/${encodeURIComponent(reviewId)}/image`);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.message || 'Imagem temporária indisponível.');
        }
        const url = URL.createObjectURL(await response.blob());
        faceReviewImageUrls.push(url);
        const imageHost = card.querySelector('[data-face-review-image]');
        imageHost.innerHTML = `<img src="${url}" alt="Captura temporária enviada para revisão" />`;
      } catch (error) {
        alert(error.message || 'Não foi possível abrir a imagem.');
        showButton.disabled = false;
      }
      return;
    }
    const decisionButton = event.target.closest('[data-face-review-decision]');
    if (!decisionButton) return;
    const decision = decisionButton.dataset.faceReviewDecision;
    const note = prompt('Observação opcional para o registro da decisão:', '');
    if (note === null) return;
    card.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      const response = await authorizedFetch(`/api/admin/face-reviews/${encodeURIComponent(reviewId)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, note })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível registrar a decisão.');
      await loadFaceReviews();
    } catch (error) {
      alert(error.message || 'Não foi possível registrar a decisão.');
      card.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
  });
};

const formatSubscriptionDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

const renderSubscriptionAccess = (status = {}) => {
  const notice = document.getElementById('subscriptionAccessNotice');
  if (!notice) return false;
  if (!status.managed || status.state === 'active' || status.state === 'not_applicable') {
    notice.classList.add('hidden');
    document.body.classList.remove('subscription-blocked');
    return false;
  }

  notice.classList.remove('hidden');
  notice.dataset.state = status.state || 'due_soon';
  const blocked = status.blocked === true;
  document.body.classList.toggle('subscription-blocked', blocked);
  const title = document.getElementById('subscriptionAccessTitle');
  const message = document.getElementById('subscriptionAccessMessage');
  const date = document.getElementById('subscriptionAccessDate');
  const label = document.getElementById('subscriptionAccessLabel');
  const pixButton = document.getElementById('subscriptionPayPix');
  const cardButton = document.getElementById('subscriptionPayCard');

  if (title) {
    title.textContent = blocked
      ? 'Seu acesso precisa ser renovado'
      : status.state === 'payment_failed'
        ? 'Não conseguimos renovar seu pagamento'
        : status.state === 'payment_pending'
          ? 'Pagamento em processamento'
          : 'Sua assinatura vence em breve';
  }
  if (label) label.textContent = blocked ? 'Acesso restrito' : 'Assinatura mensal';
  if (message) message.textContent = status.message || 'Confira a situação da sua assinatura.';
  if (date) {
    const formatted = formatSubscriptionDate(status.accessExpiresAt);
    date.textContent = formatted ? `Acesso contratado até ${formatted}.` : '';
  }

  const canTakePayment = ['due_soon', 'payment_failed', 'expired'].includes(status.state);
  const cardAutomaticAndHealthy = status.automaticRenewal && status.state === 'due_soon';
  if (pixButton) {
    pixButton.classList.toggle('hidden', !canTakePayment || cardAutomaticAndHealthy);
    pixButton.disabled = false;
  }
  if (cardButton) {
    cardButton.classList.toggle('hidden', !canTakePayment);
    cardButton.disabled = cardAutomaticAndHealthy;
    cardButton.textContent = cardAutomaticAndHealthy
      ? 'Renovação automática no cartão'
      : status.billingType === 'CREDIT_CARD'
        ? 'Tentar cartão novamente'
        : 'Pagar com cartão';
  }
  return blocked;
};

const startSubscriptionRenewal = async (billingType) => {
  const feedback = document.getElementById('subscriptionPaymentFeedback');
  const buttons = [document.getElementById('subscriptionPayPix'), document.getElementById('subscriptionPayCard')].filter(Boolean);
  buttons.forEach((button) => { button.disabled = true; });
  if (feedback) feedback.textContent = 'Abrindo o pagamento seguro...';
  try {
    const response = await authorizedFetch('/api/billing/renewal-checkout', {
      method: 'POST',
      body: JSON.stringify({ billingType })
    });
    const payload = await parseJsonSafely(response);
    if (!response.ok) throw new Error(payload?.message || 'Não foi possível iniciar a renovação.');
    if (!payload?.checkoutUrl) throw new Error('O gateway não retornou o link de pagamento.');
    window.location.assign(payload.checkoutUrl);
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
    buttons.forEach((button) => { button.disabled = false; });
  }
};

const initSubscriptionAccess = async () => {
  const notice = document.getElementById('subscriptionAccessNotice');
  if (!notice) return false;
  if (notice.dataset.bound !== 'true') {
    notice.dataset.bound = 'true';
    document.getElementById('subscriptionPayPix')?.addEventListener('click', () => startSubscriptionRenewal('PIX'));
    document.getElementById('subscriptionPayCard')?.addEventListener('click', () => startSubscriptionRenewal('CREDIT_CARD'));
    window.addEventListener('subscription-access-required', () => {
      initSubscriptionAccess().catch(console.error);
    });
  }
  try {
    const response = await authorizedFetch('/api/billing/subscription/status');
    const status = await parseJsonSafely(response);
    if (!response.ok) throw new Error(status?.message || 'Não foi possível consultar a assinatura.');
    return renderSubscriptionAccess(status);
  } catch (error) {
    console.error('Não foi possível carregar a assinatura', error);
    return false;
  }
};

const renderStudentPaymentStatus = (payment = {}) => {
  const section = document.getElementById('studentPaymentSection');
  if (!section) return false;
  const configured = payment.configured === true;
  const state = configured ? payment.state || 'pending' : 'unconfigured';
  const stateConfig = STUDENT_PAYMENT_STATES[state] || STUDENT_PAYMENT_STATES.pending;
  const status = document.getElementById('studentPaymentStatus');
  const title = document.getElementById('studentPaymentTitle');
  const message = document.getElementById('studentPaymentMessage');
  const current = document.getElementById('studentPaymentCurrent');
  const instructions = document.getElementById('studentPaymentInstructions');
  const payButton = document.getElementById('studentPaymentPayBtn');
  const history = document.getElementById('studentPaymentHistory');
  section.dataset.paymentState = state;
  if (status) {
    status.className = `student-payment-status ${stateConfig.tone}`;
    status.textContent = stateConfig.label;
  }
  if (title) title.textContent = payment.blocked ? 'Regularize para continuar estudando' : 'Situação financeira';
  if (message) {
    message.textContent = !configured
      ? 'Seu professor ainda não configurou uma mensalidade para sua conta.'
      : state === 'paid'
        ? 'Mensalidade confirmada. Seu acesso está liberado.'
        : state === 'failed'
          ? 'A tentativa de pagamento não foi aprovada. Use a fatura para tentar novamente.'
          : payment.blocked
            ? 'O prazo de tolerância terminou. Assim que o pagamento for confirmado, o acesso será liberado automaticamente.'
            : state === 'due_soon'
              ? 'Sua mensalidade vence em breve. Você já pode fazer o pagamento.'
              : state === 'overdue'
                ? `A mensalidade venceu, mas você ainda está dentro da tolerância de ${Number(payment.graceDays || 0)} dias.`
                : 'Acompanhe aqui os próximos vencimentos e pagamentos.';
  }
  if (current) current.hidden = !configured;
  const amount = document.getElementById('studentPaymentAmount');
  const dueDate = document.getElementById('studentPaymentDueDate');
  const method = document.getElementById('studentPaymentMethod');
  if (amount) amount.textContent = formatBrl(payment.amount);
  if (dueDate) dueDate.textContent = formatPaymentDate(payment.dueDate);
  if (method) method.textContent = ({ MANUAL: 'Combinado com o professor', PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão' })[payment.billingType] || payment.billingType || '--';
  if (instructions) {
    instructions.hidden = !payment.instructions;
    instructions.textContent = payment.instructions || '';
  }
  if (payButton) {
    const canPay = Boolean(payment.paymentUrl) && state !== 'paid';
    payButton.classList.toggle('hidden', !canPay);
    payButton.href = canPay ? payment.paymentUrl : '#';
  }
  if (history) {
    const rows = Array.isArray(payment.history) ? payment.history : [];
    history.innerHTML = rows.length ? `
      <h3>Histórico</h3>
      ${rows.map((item) => `
        <div><span>${formatPaymentDate(item.dueDate)} · ${escapeHtml(item.billingType)}</span><strong>${formatBrl(item.amount)} · ${escapeHtml(STUDENT_PAYMENT_STATES[String(item.status || '').toLowerCase()]?.label || item.status)}</strong></div>
      `).join('')}
    ` : '';
  }
  document.body.classList.toggle('student-payment-blocked', payment.blocked === true);
  return payment.blocked === true;
};

const loadStudentPaymentStatus = async () => {
  const response = await authorizedFetch('/api/student/payments/status');
  const payload = await parseJsonSafely(response);
  if (!response.ok) throw new Error(payload?.message || 'Não foi possível consultar sua mensalidade.');
  return { payload, blocked: renderStudentPaymentStatus(payload || {}) };
};

const initStudentPayments = async () => {
  document.getElementById('studentPaymentRefreshBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await authorizedFetch('/api/student/payments/refresh', { method: 'POST' });
      const payload = await parseJsonSafely(response);
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível verificar o pagamento.');
      const result = await loadStudentPaymentStatus();
      if (!result.blocked) {
        await renderDashboard();
        startLiveStagePolling();
      }
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
  try {
    const result = await loadStudentPaymentStatus();
    if (result.blocked) {
      document.querySelector('[data-target="studentPaymentSection"]')?.click();
    }
    return result.blocked;
  } catch (error) {
    console.error('Não foi possível carregar a mensalidade', error);
    return false;
  }
};

const initAdminFeatures = () => {
  if (adminChatPollTimer) {
    clearInterval(adminChatPollTimer);
    adminChatPollTimer = null;
  }
  if (!isGlobalAdminUser()) {
    document.querySelector('[data-target="adminProfessorsSection"]')?.closest('li')?.remove();
    document.getElementById('adminProfessorsSection')?.remove();
    document.getElementById('globalStudentFinanceNavItem')?.remove();
    document.getElementById('globalStudentFinanceSection')?.remove();
    document.querySelector('#adminSettingsSection h2')?.replaceChildren(document.createTextNode('Configuracoes'));
    document.getElementById('adminSmtpSettingsSection')?.remove();
    const aiTextCostField = document.getElementById('aiTextCreditCostPerCall')?.closest('.field-group');
    if (aiTextCostField) aiTextCostField.remove();
    const aiImageCostField = document.getElementById('aiImageCreditCostPerCall')?.closest('.field-group');
    if (aiImageCostField) aiImageCostField.remove();
    document.getElementById('adminAiSettingsPanel')?.remove();
    initStudentFinanceAdmin();
  } else {
    document.querySelector('[data-target="studentFinanceSection"]')?.closest('li')?.remove();
    document.getElementById('studentFinanceSection')?.remove();
    initGlobalStudentFinance();
  }
  initPlatformCredits();
  initStudentSeatUpgrade();
  if (isGlobalAdminUser()) {
    loadCreditPackages({ admin: true }).catch(console.error);
    document.getElementById('adminCreditPackageList')?.addEventListener('click', async (event) => {
      const editButton = event.target.closest('[data-credit-package-edit]');
      const toggleButton = event.target.closest('[data-credit-package-toggle]');
      const source = editButton || toggleButton;
      if (!source) return;
      const packageData = {
        name: source.dataset.packageName,
        price: Number(source.dataset.packagePrice),
        credits: Number(source.dataset.packageCredits),
        active: source.dataset.packageActive === 'true'
      };
      if (editButton) {
        editingCreditPackageId = editButton.dataset.creditPackageEdit;
        document.getElementById('creditPackageName').value = packageData.name;
        document.getElementById('creditPackagePrice').value = packageData.price;
        document.getElementById('creditPackageCredits').value = packageData.credits;
        document.getElementById('creditPackageActive').checked = packageData.active;
        document.getElementById('saveCreditPackageBtn').textContent = 'Salvar alterações';
        return;
      }
      toggleButton.disabled = true;
      try {
        const response = await authorizedFetch(`/api/admin/credit-packages/${encodeURIComponent(toggleButton.dataset.creditPackageToggle)}`, {
          method: 'PUT',
          body: JSON.stringify({ ...packageData, active: !packageData.active })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'Não foi possível atualizar o pacote.');
        await loadCreditPackages({ admin: true });
      } catch (error) {
        alert(error.message);
        toggleButton.disabled = false;
      }
    });
    document.getElementById('saveCreditPackageBtn')?.addEventListener('click', async () => {
      const button = document.getElementById('saveCreditPackageBtn');
      button.disabled = true;
      try {
        const packageId = editingCreditPackageId;
        const response = await authorizedFetch(packageId
          ? `/api/admin/credit-packages/${encodeURIComponent(packageId)}`
          : '/api/admin/credit-packages', {
          method: packageId ? 'PUT' : 'POST',
          body: JSON.stringify({
            name: document.getElementById('creditPackageName')?.value,
            price: Number(document.getElementById('creditPackagePrice')?.value),
            credits: Number(document.getElementById('creditPackageCredits')?.value),
            active: document.getElementById('creditPackageActive')?.checked !== false
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'Não foi possível salvar o pacote.');
        editingCreditPackageId = null;
        document.getElementById('creditPackageName').value = '';
        document.getElementById('creditPackagePrice').value = '30';
        document.getElementById('creditPackageCredits').value = '100';
        document.getElementById('creditPackageActive').checked = true;
        button.textContent = 'Adicionar pacote';
        await loadCreditPackages({ admin: true });
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
  }
  setupAccountSettingsForms();
  loadAccountSettings().catch((error) => {
    console.error('Não foi possível carregar as configurações da conta', error);
  });
  renderStudentSignupLinkPanel();
  initAdminAssistant();
  if (isGlobalAdminUser()) {
    loadProfessorCreditsStatus();
  }
  loadAdminSmtpSettings();
  const notifTarget = document.getElementById('notificationTarget');
  const studentSelector = document.getElementById('studentSelector');
  const classSelector = document.getElementById('classSelector');
  notifTarget?.addEventListener('change', () => {
    if (studentSelector) studentSelector.style.display = notifTarget.value === 'student' ? 'block' : 'none';
    if (classSelector) classSelector.style.display = notifTarget.value === 'class' ? 'block' : 'none';
  });
  document.getElementById('notificationFileBtn')?.addEventListener('click', () => {
    document.getElementById('notificationFileInput')?.click();
  });
  document.getElementById('notificationFileInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0] || null;
    const status = document.getElementById('notificationFileStatus');
    try {
      selectedNotificationAttachment = file ? await readNotificationAttachmentFile(file) : null;
      if (status) {
        status.textContent = selectedNotificationAttachment
          ? `${selectedNotificationAttachment.title} anexado (${formatStorageAmount(selectedNotificationAttachment.size)})`
          : 'Nenhum arquivo anexado.';
      }
    } catch (error) {
      clearNotificationAttachment();
      alert(error.message || 'Não foi possível anexar este arquivo.');
    }
  });

  document.getElementById('studentForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      fullName: document.getElementById('adminStudentName').value,
      email: document.getElementById('adminStudentEmail').value,
      phone: document.getElementById('adminStudentTelephone').value,
      password: document.getElementById('adminStudentPassword').value,
      className: document.getElementById('adminStudentClass').value
    };
    try {
      const response = await authorizedFetch('/api/admin/students', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const created = await response.json();
      alert('Aluno cadastrado com sucesso.');
      document.getElementById('studentForm').reset();
      updateStudentClassSelect();
      loadAdminStudents();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('generateStudentSignupLinkBtn')?.addEventListener('click', async () => {
    await generateStudentSignupLink();
  });
  document.getElementById('copyStudentSignupLinkBtn')?.addEventListener('click', async () => {
    await copyStudentSignupLink();
  });

  document.getElementById('professorForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      fullName: document.getElementById('adminProfessorName').value,
      email: document.getElementById('adminProfessorEmail').value,
      phone: document.getElementById('adminProfessorTelephone').value,
      password: document.getElementById('adminProfessorPassword').value,
      platformCredits: Number(document.getElementById('adminProfessorCredits').value) || 0,
      studentLimit: document.getElementById('adminProfessorStudentLimit').value,
      storageLimitGb: document.getElementById('adminProfessorStorageLimitGb').value
    };
    try {
      const response = await authorizedFetch('/api/admin/professors', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const created = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(created?.message || 'Não foi possível criar o professor.');
      }
      alert('Professor cadastrado com sucesso.');
      document.getElementById('professorForm').reset();
      document.getElementById('adminProfessorCredits').value = '0';
      document.getElementById('adminProfessorStudentLimit').value = '';
      document.getElementById('adminProfessorStorageLimitGb').value = '';
      await loadAdminProfessors();
    } catch (error) {
      alert(error.message || 'Não foi possível criar o professor.');
    }
  });
  document.getElementById('professorFinanceSearch')?.addEventListener('input', renderAdminProfessors);
  document.getElementById('professorFinanceStatus')?.addEventListener('change', renderAdminProfessors);
  document.getElementById('professorFinanceBillingType')?.addEventListener('change', renderAdminProfessors);

  document.getElementById('classForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await authorizedFetch('/api/admin/classes', {
        method: 'POST',
        body: JSON.stringify({ name: document.getElementById('className').value })
      });
      document.getElementById('classForm').reset();
      await loadAdminClasses();
    } catch (error) {
      alert(error.message || 'Não foi possível criar a turma.');
    }
  });

  document.getElementById('classList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-class-id]');
    if (!button) return;
    try {
      await authorizedFetch(`/api/admin/classes/${button.dataset.classId}`, { method: 'DELETE' });
      await loadAdminClasses();
      await loadAdminStudents();
    } catch (error) {
      alert(error.message || 'Não foi possível excluir a turma.');
    }
  });

  document.getElementById('notificationForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const targetType = document.getElementById('notificationTarget').value;
    const targetValue = targetType === 'student'
      ? document.getElementById('notificationStudent')?.value
      : (targetType === 'class' ? document.getElementById('notificationClass')?.value : null);
    if ((targetType === 'student' || targetType === 'class') && !targetValue) {
      alert(targetType === 'student' ? 'Selecione um aluno.' : 'Selecione uma turma.');
      return;
    }
    try {
      await authorizedFetch('/api/admin/notifications', {
        method: 'POST',
        body: JSON.stringify({
          message: document.getElementById('notificationMessage').value,
          targetType,
          targetValue,
          attachments: selectedNotificationAttachment ? [selectedNotificationAttachment] : []
        })
      });
      alert('Notificação enviada com sucesso.');
      document.getElementById('notificationForm').reset();
      clearNotificationAttachment();
      if (studentSelector) studentSelector.style.display = 'none';
      if (classSelector) classSelector.style.display = 'none';
      updateNotificationClassSelect();
      updateNotificationStudentSelect();
      loadAdminNotifications();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById('adminNotificationList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-notification-id]');
    if (!button) return;
    if (!confirm('Deseja apagar esta notificação?')) {
      return;
    }
    try {
      await authorizedFetch(`/api/admin/notifications/${button.dataset.notificationId}`, { method: 'DELETE' });
      loadAdminNotifications();
    } catch (error) {
      alert(error.message || 'Não foi possível apagar a notificação.');
    }
  });

  document.querySelector('#studentsTable tbody')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-student-id]');
    if (!button) return;
    const studentId = button.dataset.studentId;
    const action = button.dataset.action;
    try {
      if (action === 'delete') {
        await authorizedFetch(`/api/admin/students/${studentId}`, { method: 'DELETE' });
      } else if (action === 'approve' || action === 'reject') {
        const response = await authorizedFetch(`/api/admin/students/${studentId}/signup-approval`, {
          method: 'PUT',
          body: JSON.stringify({ decision: action === 'approve' ? 'APPROVED' : 'REJECTED' })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          if (
            action === 'approve'
            && payload?.code === 'PROFESSOR_STUDENT_LIMIT_REACHED'
            && payload?.seatUpgrade?.available
          ) {
            openStudentSeatUpgradeModal(studentId, payload);
            return;
          }
          throw new Error(payload?.message || 'Não foi possível analisar o cadastro.');
        }
        if (payload?.paymentWarning) alert(payload.paymentWarning);
      } else {
        const shouldEnable = button.textContent.trim() === 'Autorizar';
        const response = await authorizedFetch(`/api/admin/students/${studentId}/status`, {
          method: 'PUT',
          body: JSON.stringify({ isActive: shouldEnable })
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.message || 'Não foi possível atualizar o aluno.');
        }
      }
      loadAdminStudents();
    } catch (error) {
      alert(error.message || 'Não foi possível atualizar o status.');
    }
  });

  document.getElementById('adminProfessorList')?.addEventListener('click', async (event) => {
    const addCreditsButton = event.target.closest('button[data-professor-credit-add]');
    if (addCreditsButton) {
      const professorId = addCreditsButton.dataset.professorCreditAdd;
      const input = document.querySelector(`[data-professor-credit-input="${professorId}"]`);
      const credits = Number(input?.value || 0);
      if (!credits || credits < 0.5) {
        alert('Informe uma quantidade positiva de créditos.');
        return;
      }
      try {
        const response = await authorizedFetch(`/api/admin/professors/${professorId}/credits`, {
          method: 'POST',
          body: JSON.stringify({ credits })
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(result?.message || 'Não foi possível adicionar créditos.');
        }
        await loadAdminProfessors();
        return;
      } catch (error) {
        alert(error.message || 'Não foi possível adicionar créditos.');
        return;
      }
    }
    const saveLimitsButton = event.target.closest('button[data-professor-limits-save]');
    if (saveLimitsButton) {
      const professorId = saveLimitsButton.dataset.professorLimitsSave;
      const studentLimit = document.querySelector(`[data-professor-student-limit="${professorId}"]`)?.value ?? '';
      const storageLimitGb = document.querySelector(`[data-professor-storage-limit="${professorId}"]`)?.value ?? '';
      try {
        const response = await authorizedFetch(`/api/admin/professors/${professorId}/limits`, {
          method: 'PUT',
          body: JSON.stringify({ studentLimit, storageLimitGb })
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(result?.message || 'Não foi possível salvar os limites.');
        }
        await loadAdminProfessors();
        return;
      } catch (error) {
        alert(error.message || 'Não foi possível salvar os limites.');
        return;
      }
    }
    const toggleButton = event.target.closest('button[data-professor-toggle]');
    if (toggleButton) {
      const professorId = toggleButton.dataset.professorToggle;
      const professor = adminProfessorsCache.find((item) => item.id === professorId);
      if (!professor) return;
      try {
        await authorizedFetch(`/api/admin/professors/${professorId}/status`, {
          method: 'PUT',
          body: JSON.stringify({ isActive: !professor.is_active })
        });
        await loadAdminProfessors();
      } catch (error) {
        alert(error.message || 'Não foi possível atualizar o professor.');
      }
      return;
    }
    const deleteButton = event.target.closest('button[data-professor-delete]');
    if (deleteButton) {
      const professorId = deleteButton.dataset.professorDelete;
      const professor = adminProfessorsCache.find((item) => item.id === professorId);
      if (!professor) return;
      const confirmed = window.confirm(`Excluir o professor ${professor.full_name}?\n\nOs cursos, alunos e dados vinculados a ele também serão removidos.`);
      if (!confirmed) {
        return;
      }
      try {
        await authorizedFetch(`/api/admin/professors/${professorId}`, {
          method: 'DELETE'
        });
        await loadAdminProfessors();
      } catch (error) {
        alert(error.message || 'Não foi possível excluir o professor.');
      }
    }
  });

  document.getElementById('courseForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      title: document.getElementById('courseTitle').value,
      description: document.getElementById('courseDescription').value,
      slug: document.getElementById('courseSlug').value,
      coverImage: pendingCourseCoverImage,
      showInStore: document.getElementById('courseShowInStore')?.checked === true
    };
    try {
      await authorizedFetch('/api/admin/courses', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      alert('Curso criado com sucesso.');
      document.getElementById('courseForm').reset();
      pendingCourseCoverImage = '';
      syncCourseCoverModeUi();
      syncCourseCoverPreview();
      loadAdminCourses();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById('adminCourseList')?.addEventListener('click', async (event) => {
    const closeButton = event.target.closest('button[data-course-cover-close]');
    if (closeButton) {
      closeCourseCoverEditor();
      return;
    }
    const applyCoverButton = event.target.closest('button[data-course-cover-apply]');
    if (applyCoverButton) {
      editingCourseCoverId = applyCoverButton.dataset.courseCoverApply || '';
      await applyEditCourseCover();
      return;
    }
    const saveCoverButton = event.target.closest('button[data-course-cover-save]');
    if (saveCoverButton) {
      editingCourseCoverId = saveCoverButton.dataset.courseCoverSave || '';
      const currentMode =
        document.querySelector(`[data-course-cover-mode="${editingCourseCoverId}"]`)?.value || editingCourseCoverMode;
      if (currentMode === 'url') {
        editingCourseCoverImage =
          document.querySelector(`[data-course-cover-url="${editingCourseCoverId}"]`)?.value?.trim() || '';
      }
      try {
        await authorizedFetch(`/api/admin/courses/${editingCourseCoverId}`, {
          method: 'PUT',
          body: JSON.stringify({ coverImage: editingCourseCoverImage || '' })
        });
        await loadAdminCourses();
        closeCourseCoverEditor();
      } catch (error) {
        alert(error.message || 'Não foi possível salvar a nova capa.');
      }
      return;
    }
    const button = event.target.closest('button[data-course-id]');
    if (!button) return;
    const courseId = button.dataset.courseId;
    try {
      if (button.dataset.courseEditCover === 'true') {
        openCourseCoverEditor(courseId);
        return;
      }
      if (button.classList.contains('admin-course-store-toggle')) {
        await authorizedFetch(
          "/api/admin/courses/" + courseId,
          {
            method: 'PUT',
            body: JSON.stringify({ showInStore: button.dataset.courseStoreVisible !== 'true' })
          }
        );
        await loadAdminCourses();
        await loadAdminAccessRequests();
        return;
      }
      if (button.dataset.courseRemoveCover === 'true') {
        editingCourseCoverId = courseId;
        editingCourseCoverImage = '';
        await authorizedFetch(
          "/api/admin/courses/" + courseId,
          {
            method: 'PUT',
            body: JSON.stringify({ coverImage: '' })
          }
        );
        await loadAdminCourses();
        await loadAdminAccessRequests();
        return;
      }
      await authorizedFetch("/api/admin/courses/" + courseId, { method: 'DELETE' });
      await loadAdminCourses();
      await loadAdminAccessRequests();
    } catch (error) {
      alert(error.message || 'N\u00e3o foi poss\u00edvel remover o curso.');
    }
  });

  document.getElementById('adminCourseList')?.addEventListener('change', async (event) => {
    const modeSelect = event.target.closest('select[data-course-cover-mode]');
    if (modeSelect) {
      editingCourseCoverId = modeSelect.dataset.courseCoverMode || '';
      editingCourseCoverMode = modeSelect.value || 'local';
      loadAdminCourses();
      return;
    }
    const fileInput = event.target.closest('input[data-course-cover-file]');
    if (fileInput) {
      try {
        editingCourseCoverId = fileInput.dataset.courseCoverFile || '';
        editingCourseCoverImage = await readLocalImageFile(fileInput);
        loadAdminCourses();
      } catch (error) {
        alert(error.message || 'Não foi possível carregar a nova capa.');
      }
    }
  });

  document.getElementById('adminAccessRequestList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-access-request-id]');
    if (!button) return;
    try {
      await authorizedFetch('/api/admin/course-access-requests/' + button.dataset.accessRequestId + '/decision', {
        method: 'POST',
        body: JSON.stringify({ decision: button.dataset.accessDecision })
      });
      await loadAdminAccessRequests();
      await loadAdminCourses();
      await loadAdminStudents();
      await loadReports();
    } catch (error) {
      alert(error.message || 'N\u00e3o foi poss\u00edvel analisar a solicita\u00e7\u00e3o.');
    }
  });

  document.getElementById('reportsTableBody')?.addEventListener('click', async (event) => {
    const moduleButton = event.target.closest('button[data-module-performance-toggle]');
    if (moduleButton) {
      toggleReportModulePanel(moduleButton);
      return;
    }
    const timelineButton = event.target.closest('button[data-progress-timeline-user]');
    if (timelineButton) {
      await loadProgressTimeline(timelineButton.dataset.progressTimelineUser, timelineButton.dataset.progressTimelineCourse);
      return;
    }
    const correctButton = event.target.closest('button[data-report-correct-user]');
    if (!correctButton) return;
    try {
      await updateReportCorrectionState(correctButton.dataset.reportCorrectUser, correctButton.dataset.reportCorrectCourse, 'correct');
    } catch (error) {
      alert(error.message || 'Nao foi possivel marcar o relatório como corrigido.');
    }
  });
  document.getElementById('correctedReportsTableBody')?.addEventListener('click', async (event) => {
    const moduleButton = event.target.closest('button[data-module-performance-toggle]');
    if (moduleButton) {
      toggleReportModulePanel(moduleButton);
      return;
    }
    const timelineButton = event.target.closest('button[data-progress-timeline-user]');
    if (timelineButton) {
      await loadProgressTimeline(timelineButton.dataset.progressTimelineUser, timelineButton.dataset.progressTimelineCourse);
      return;
    }
    const deleteButton = event.target.closest('button[data-corrected-delete-user]');
    if (!deleteButton) return;
    const confirmed = window.confirm('Esse relatório será apagado para sempre do banco de dados. Deseja continuar?');
    if (!confirmed) return;
    try {
      await updateReportCorrectionState(deleteButton.dataset.correctedDeleteUser, deleteButton.dataset.correctedDeleteCourse, 'delete');
    } catch (error) {
      alert(error.message || 'Nao foi possivel remover este relatório dos corrigidos.');
    }
  });

  document.getElementById('adminChatCourseList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-admin-chat-course]');
    if (!button) return;
    await openAdminCourseChat(button.dataset.adminChatCourse);
  });

  document.getElementById('adminChatMessages')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-admin-reply-id]');
    if (!button) return;
    const messageId = button.dataset.adminReplyId;
    const message = adminCurrentChatMessages.find((item) => item.id === messageId);
    if (!message) return;
    setAdminReplyTarget(message);
    document.getElementById('adminChatInput')?.focus();
  });

  document.getElementById('adminChatReplyCancel')?.addEventListener('click', () => {
    clearAdminReplyTarget();
    document.getElementById('adminChatInput')?.focus();
  });

  document.getElementById('adminChatForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!adminActiveChatCourseId) {
      alert('Selecione um curso antes de responder.');
      return;
    }
    const input = document.getElementById('adminChatInput');
    const button = document.getElementById('adminChatSendBtn');
    const message = input?.value?.slice(0, 1000).trim() || '';
    if (!message) return;
    if (button) button.disabled = true;
    try {
      const response = await authorizedFetch(`/api/chat/${encodeURIComponent(adminActiveChatCourseId)}`, {
        method: 'POST',
        body: JSON.stringify({
          message,
          replyToMessageId: adminReplyTarget?.id || null
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || 'Nao foi possivel enviar a resposta.');
      }
      if (input) input.value = '';
      clearAdminReplyTarget();
      await openAdminCourseChat(adminActiveChatCourseId);
    } catch (error) {
      alert(error.message || 'Nao foi possivel enviar a resposta.');
    } finally {
      if (button) button.disabled = false;
      input?.focus();
    }
  });

  document.getElementById('closeProgressTimelineModalBtn')?.addEventListener('click', closeProgressTimelineModal);
  document.getElementById('progressTimelineModal')?.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-progress-modal-close="true"]')) {
      closeProgressTimelineModal();
    }
  });

  document.getElementById('courseTitle')?.addEventListener('input', syncCourseCoverPreview);
  document.getElementById('courseCoverMode')?.addEventListener('change', syncCourseCoverModeUi);
  document.getElementById('applyCourseCoverBtn')?.addEventListener('click', applyCourseCover);
  document.getElementById('clearCourseCoverBtn')?.addEventListener('click', clearCourseCover);
  document.getElementById('courseCoverFile')?.addEventListener('change', async (event) => {
    try {
      pendingCourseCoverImage = await readLocalImageFile(event.target);
      syncCourseCoverPreview();
    } catch (error) {
      alert(error.message || 'Não foi possível carregar a capa do curso.');
    }
  });
  syncCourseCoverModeUi();
  syncCourseCoverPreview();

  document.getElementById('courseStoreGrid')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-store-course-id]');
    if (!button) return;
    await requestStoreCourseAccess(button.dataset.storeCourseId);
  });

  document.getElementById('enrollmentStudent')?.addEventListener('change', renderEnrollmentList);

  document.getElementById('enrollmentForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const studentId = document.getElementById('enrollmentStudent')?.value;
    const courseId = document.getElementById('enrollmentCourse')?.value;
    if (!studentId || !courseId) {
      alert('Selecione um aluno e um curso antes de continuar.');
      return;
    }
    try {
      await authorizedFetch(`/api/admin/students/${studentId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ courseId })
      });
      alert('Curso adicionado ao aluno.');
      await loadAdminStudents();
      await loadReports();
    } catch (error) {
      alert(error.message || 'Não foi possível matricular o aluno.');
    }
  });

  document.getElementById('enrollmentList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-course-id]');
    if (!button) return;
    await removeEnrollmentFromStudent(button.dataset.studentId, button.dataset.courseId, {
      confirmMessage: 'Remover o módulo vai cancelar o curso do aluno. Deseja continuar?'
    });
  });

  document.getElementById('enrollmentRemoveBtn')?.addEventListener('click', async () => {
    const studentId = document.getElementById('enrollmentStudent')?.value;
    const courseId = document.getElementById('enrollmentCourse')?.value;
    await removeEnrollmentFromStudent(studentId, courseId, {
      confirmMessage: 'Remover o curso selecionado cancela o módulo. Deseja continuar?',
      successMessage: 'Curso removido do aluno.'
    });
  });

  document.getElementById('smtpSettingsForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      host: document.getElementById('smtpHost').value,
      port: Number(document.getElementById('smtpPort').value) || 587,
      secure: document.getElementById('smtpSecure').checked,
      user_email: document.getElementById('smtpUser').value,
      user_pass: document.getElementById('smtpPass').value,
      from_email: document.getElementById('smtpFrom').value
    };
    try {
      await authorizedFetch('/api/admin/smtp-settings', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      const statusEl = document.getElementById('smtpSettingsStatus');
      statusEl.textContent = 'Configurações SMTP salvas com sucesso!';
      statusEl.style.color = '#50fa7b';
      setTimeout(() => { statusEl.textContent = 'Configurações de E-mail carregadas.'; statusEl.style.color = '#8b92b1'; }, 3000);
    } catch (error) {
      alert('Não foi possível salvar as configurações de SMTP.');
    }
  });

  document.getElementById('aiSettingsForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      providerLabel: document.getElementById('aiProviderLabel').value,
      providerKey: document.getElementById('aiProviderKey').value,
      baseUrl: document.getElementById('aiBaseUrl').value,
      model: document.getElementById('aiModel').value,
      apiKey: document.getElementById('aiApiKey').value,
      imageProviderLabel: document.getElementById('aiImageProviderLabel').value,
      imageProviderKey: document.getElementById('aiImageProviderKey').value,
      imageBaseUrl: document.getElementById('aiImageBaseUrl').value,
      imageModel: document.getElementById('aiImageModel').value,
      imageApiKey: document.getElementById('aiImageApiKey').value,
      aiTextCreditCostPerCall: Number(document.getElementById('aiTextCreditCostPerCall')?.value) || 0.5,
      aiImageCreditCostPerCall: Number(document.getElementById('aiImageCreditCostPerCall')?.value) || 1.0,
      threeDImportCreditCost: Number(document.getElementById('threeDImportCreditCost')?.value) || 5,
      systemPrompt: document.getElementById('aiSystemPrompt').value,
      requireConfirmation: document.getElementById('aiRequireConfirmation').checked,
      isEnabled: document.getElementById('aiEnabled').checked,
      imageEnabled: document.getElementById('aiImageEnabled').checked
    };
    try {
      const response = await authorizedFetch('/api/admin/ai-settings', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.message || 'Não foi possível salvar a integração de IA.');
      }
      const settings = result;
      adminAiSettingsCache = settings;
      fillAiSettingsForm(settings);
      alert('Integração de IA salva com sucesso.');
    } catch (error) {
      alert(error.message || 'Não foi possível salvar a integração de IA.');
    }
  });

  document.getElementById('testAiSettingsBtn')?.addEventListener('click', async () => {
    try {
      const response = await authorizedFetch('/api/admin/ai-settings/test', { method: 'POST' });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.message || 'Não foi possível testar a integração.');
      }
      alert(`Conexão validada. Resposta da IA: ${result.reply}`);
    } catch (error) {
      alert(error.message || 'Não foi possível testar a integração.');
    }
  });

  loadAdminStudents();
  loadAdminProfessors();
  loadAdminClasses();
  loadAdminCourses();
  loadAdminAccessRequests();
  loadAdminChatCourses(false).then(() => {
    if (adminActiveChatCourseId) {
      return openAdminCourseChat(adminActiveChatCourseId);
    }
    return null;
  });
  loadReports();
  if (isGlobalAdminUser()) {
    loadAdminAiSettings();
  }
  loadAdminNotifications();
  setupFaceReviewActions();
  setupFaceManualGrant();
  loadFaceReviews();
  adminChatPollTimer = window.setInterval(async () => {
    await loadAdminChatCourses(true);
    if (adminActiveChatCourseId) {
      await fetchAdminCourseChatMessages(adminActiveChatCourseId);
    }
  }, 5000);
};

// ── Chat do Curso ─────────────────────────────────────────────
let activeChatCourseId = null;
let chatPollTimer = null;
let lastMessageCount = 0;

const closeCourseChat = () => {
  const modal = document.getElementById('chatModal');
  if (modal) modal.classList.add('hidden');
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  activeChatCourseId = null;
  lastMessageCount = 0;
};

const renderChatMessages = (messages) => {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const sessionUser = JSON.parse(localStorage.getItem('curso-platform-user') || '{}');

  if (!messages.length) {
    container.innerHTML = '<p style="margin:0; color:#8b92b1; text-align:center;">Nenhuma mensagem ainda. Seja o primeiro!</p>';
    return;
  }

  const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;

  container.innerHTML = messages.map((msg) => {
    const isAdmin = msg.role === 'admin' || msg.role === 'professor';
    // Usa escapeHtml para prevenir XSS no frontend
    const safeMessage = escapeHtml(msg.message);
    const safeName = escapeHtml(msg.full_name);
    const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const isMine = !isAdmin && msg.full_name === sessionUser.fullName;
    const bubbleClass = isAdmin ? 'admin-msg' : (isMine ? 'mine' : 'theirs');
    const label = isAdmin ? `👨‍🏫 ${safeName} (Professor)` : safeName;

    return `
      <div class="chat-bubble ${bubbleClass}">
        ${renderChatAvatar(msg)}
        ${buildReplyQuoteMarkup(msg)}
        ${!isMine ? `<strong style="font-size:0.78rem; display:block; margin-bottom:0.2rem;">${label}</strong>` : ''}
        ${safeMessage}
        <span class="chat-bubble-meta">${time}</span>
      </div>
    `;
  }).join('');

  if (isNearBottom || messages.length !== lastMessageCount) {
    container.scrollTop = container.scrollHeight;
  }
  lastMessageCount = messages.length;
};

const fetchChatMessages = async (courseId) => {
  try {
    const response = await authorizedFetch(`/api/chat/${courseId}`);
    if (!response.ok) return;
    const messages = await response.json();
    renderChatMessages(messages);
  } catch (e) {
    // silencioso — próximo poll tentará novamente
  }
};

const openCourseChat = async (courseId, courseTitle) => {
  activeChatCourseId = courseId;
  const modal = document.getElementById('chatModal');
  const title = document.getElementById('chatModalTitle');
  const messages = document.getElementById('chatMessages');

  if (!modal) return;
  title.textContent = `💬 ${escapeHtml(courseTitle)}`;
  messages.innerHTML = '<p style="margin:0; color:#8b92b1; text-align:center;">Carregando mensagens...</p>';
  modal.classList.remove('hidden');

  await fetchChatMessages(courseId);

  // Polling a cada 5 segundos
  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(() => {
    if (activeChatCourseId) fetchChatMessages(activeChatCourseId);
  }, 5000);

  document.getElementById('chatInput')?.focus();
};

const initChatModal = () => {
  document.getElementById('chatModalClose')?.addEventListener('click', closeCourseChat);
  document.getElementById('chatModalBackdrop')?.addEventListener('click', closeCourseChat);

  document.getElementById('chatForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeChatCourseId) return;

    const input = document.getElementById('chatInput');
    const rawMessage = input.value;
    // Limita no frontend também (dupla validação)
    const message = rawMessage.slice(0, 1000).trim();
    if (!message) return;

    const btn = document.getElementById('chatSendBtn');
    btn.disabled = true;

    try {
      const response = await authorizedFetch(`/api/chat/${activeChatCourseId}`, {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        alert(data?.message || 'Não foi possível enviar a mensagem.');
        return;
      }
      input.value = '';
      await fetchChatMessages(activeChatCourseId);
    } catch (e) {
      alert('Erro ao enviar mensagem. Tente novamente.');
    } finally {
      btn.disabled = false;
      input.focus();
    }
  });
};

const initAdminPage = async () => {
  const blocked = await initSubscriptionAccess();
  if (!blocked) initAdminFeatures();
};

const init = () => {
  setupLogoutButtons();
  setupNotificationAttachmentClicks();
  setupWhatsappSupportLinks();
  if (document.getElementById('loginForm')) {
    initLogin();
    return;
  }
  if (document.getElementById('createAccountForm')) {
    initCreateAccount();
    return;
  }

  const token = getToken();
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  const isPortal = !!document.querySelector('#courseList');
  const isAdmin = !!document.getElementById('studentForm');

  if (isPortal) {
    setupSideNavigation();
    setupAccountSettingsForms();
    setupFaceProfile();
    initChatModal();
    document.getElementById('courseStoreGrid')?.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-store-course-id]');
      if (!button) return;
      await requestStoreCourseAccess(button.dataset.storeCourseId);
    });
    initStudentPayments().then((blocked) => {
      if (!blocked) {
        renderDashboard();
        startLiveStagePolling();
      }
    });
    return;
  }
  if (isAdmin) {
    setupSideNavigation();
    initAdminPage();
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

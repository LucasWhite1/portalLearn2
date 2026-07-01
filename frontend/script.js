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
let cachedCourses = [];
let cachedStoreCourses = [];
let adminStudentsCache = [];
let adminProfessorsCache = [];
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
let liveStagePollTimer = null;
let mobileSidenavCleanup = null;

const getCurrentUserRole = () => localStorage.getItem(USER_ROLE_KEY) || '';
const getCurrentUserData = () => {
  try {
    return JSON.parse(localStorage.getItem('curso-platform-user') || '{}');
  } catch (error) {
    return {};
  }
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

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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
    renderClassList();
  } catch (error) {
    adminClassesCache = [];
    updateStudentClassSelect();
    renderClassList();
  }
};

const getToken = () => localStorage.getItem(STORAGE_KEY);
const setToken = (token) => localStorage.setItem(STORAGE_KEY, token);
const clearToken = () => localStorage.removeItem(STORAGE_KEY);

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
    throw new Error('Sem token válido');
  }
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (/^[0-9a-f]{48}$/i.test(token)) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
  if (response.status === 401) {
    clearToken();
    window.location.href = 'login.html';
    throw new Error('Sessão expirada');
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
    const firstBtn = document.querySelector('.nav-link[data-target]');
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
      item.innerHTML = `<p style="margin:0;">${escapeHtml(note.message)}</p><small style="color:#8b92b1;">${escapeHtml(new Date(note.created_at).toLocaleString())}</small>`;
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
    renderCourses(courses);
    const secondaryLoads = [
      loadLiveStageShares(),
      loadStoreCourses(),
      renderNotifications()
    ];
    const currentCourseLabel = document.getElementById('portalCurrentCourseLabel');
    const currentCourseStatus = document.getElementById('portalCurrentCourseStatus');
    const currentModuleLabel = document.getElementById('portalCurrentModuleLabel');
    const currentSlideLabel = document.getElementById('portalCurrentSlideLabel');
    const nextActionLabel = document.getElementById('portalNextActionLabel');
    const gradeDetail = document.getElementById('portalGradeDetail');
    const videoDetail = document.getElementById('portalVideoDetail');
    const slideDetail = document.getElementById('portalSlideDetail');
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
      const sortedModules = sortModulesForPhase(courses[0].modules || []);
      const recommendedModule = getRecommendedCourseModule(courses[0]);
      const currentModuleProgress =
        recommendedModule?.id && progress.interactive_progress && typeof progress.interactive_progress === 'object'
          ? progress.interactive_progress[recommendedModule.id]
          : null;
      const currentSlideId = currentModuleProgress?.lastSlideId || null;
      const currentSlideIndex =
        currentSlideId && recommendedModule?.builder_data?.slides?.length
          ? recommendedModule.builder_data.slides.findIndex((slide) => slide.id === currentSlideId)
          : -1;
      const readableSlideLabel =
        currentSlideIndex >= 0
          ? `Slide ${currentSlideIndex + 1} de ${recommendedModule.builder_data.slides.length}`
          : recommendedModule?.builder_data?.slides?.length
            ? `Slide 1 de ${recommendedModule.builder_data.slides.length}`
            : 'Nenhum slide em andamento';
      document.getElementById('videoTitle').textContent = courses[0].title;
      document.getElementById('videoTimestamp').textContent = `${Math.floor((Number(progress.video_position) || 0) / 60)} min`;
      document.getElementById('interactiveStep').textContent = totalInteractiveSlides
        ? `${completedInteractiveSlides}/${totalInteractiveSlides} slides`
        : progress.interactive_step || '0/0 slides';
      document.getElementById('videoProgress').style.width = `${videoPercent}%`;
      document.getElementById('interactiveProgress').style.width = `${interactivePercent}%`;
      const gradeNode = document.getElementById('gradeValue');
      const moduleNode = document.getElementById('currentModule');
      if (gradeNode) {
        gradeNode.textContent = formatGrade(progress.grade);
      }
      if (moduleNode) {
        moduleNode.textContent = progress.current_module || 'Módulo 01';
      }
      if (currentCourseLabel) {
        currentCourseLabel.textContent = courses[0].title;
      }
      if (currentCourseStatus) {
        currentCourseStatus.textContent = `${sortedModules.length} módulo(s) disponíveis nesta trilha.`;
      }
      if (currentModuleLabel) {
        currentModuleLabel.textContent =
          progress.current_module || recommendedModule?.title || courses[0].modules?.[0]?.title || 'Nenhum módulo em andamento';
      }
      if (currentSlideLabel) {
        currentSlideLabel.textContent = readableSlideLabel;
      }
      if (nextActionLabel) {
        nextActionLabel.textContent = recommendedModule
          ? `Retome "${recommendedModule.title}" e continue a partir de ${readableSlideLabel.toLowerCase()}.`
          : 'Aguardando novos módulos serem publicados para sua turma.';
      }
      if (gradeDetail) {
        gradeDetail.textContent =
          progress.grade === null || progress.grade === undefined
            ? 'Sem nota registrada'
            : `Nota média atual: ${formatGrade(progress.grade)}`;
      }
      if (videoDetail) {
        videoDetail.textContent = totalVideoDuration
          ? `Vídeo assistido: ${watchedVideoDuration.toFixed(0)}s de ${totalVideoDuration.toFixed(0)}s`
          : 'Nenhum vídeo iniciado neste curso.';
      }
      if (slideDetail) {
        slideDetail.textContent = totalInteractiveSlides
          ? `Slides concluídos: ${completedInteractiveSlides} de ${totalInteractiveSlides}`
          : 'Nenhum slide concluído ainda.';
      }
    } else {
      if (currentCourseLabel) {
        currentCourseLabel.textContent = 'Nenhum curso em andamento';
      }
      if (currentCourseStatus) {
        currentCourseStatus.textContent = 'Assim que você entrar em um curso, ele aparece aqui.';
      }
      if (currentModuleLabel) {
        currentModuleLabel.textContent = 'Nenhum módulo em andamento';
      }
      if (currentSlideLabel) {
        currentSlideLabel.textContent = 'Nenhum slide em andamento';
      }
      if (nextActionLabel) {
        nextActionLabel.textContent = 'Assim que houver curso matriculado, sua próxima ação aparece aqui.';
      }
      if (gradeDetail) {
        gradeDetail.textContent = 'Sem nota registrada';
      }
      if (videoDetail) {
        videoDetail.textContent = 'Vídeos ainda não iniciados.';
      }
      if (slideDetail) {
        slideDetail.textContent = 'Slides ainda não iniciados.';
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
    aiCredits: data.user.aiCredits ?? null,
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
  const signupSubmitBtn = document.getElementById('studentSignupSubmitBtn');
  const inviteToken = new URLSearchParams(window.location.search).get('invite') || '';
  const showForgotBtn = document.getElementById('showForgotBtn');
  const showLoginFromForgotBtn = document.getElementById('showLoginFromForgotBtn');
  const showLoginFromResetBtn = document.getElementById('showLoginFromResetBtn');
  const showLoginFromSignupBtn = document.getElementById('showLoginFromSignupBtn');

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
    if (!inviteToken) {
      feedback.textContent = 'Link de cadastro inválido.';
      feedback.style.color = '#ff6b6b';
      feedback.style.display = 'block';
      return;
    }
    if (signupSubmitBtn) signupSubmitBtn.disabled = true;
    try {
      const response = await fetch(`${API_BASE}/api/auth/student-signup-link/${encodeURIComponent(inviteToken)}/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: signupForm.studentSignupFullName.value,
          email: signupForm.studentSignupEmail.value,
          phone: signupForm.studentSignupPhone.value,
          password: signupForm.studentSignupPassword.value
        })
      });
      const data = await parseJsonSafely(response);
      if (!response.ok) {
        throw new Error(data?.message || 'Não foi possível concluir seu cadastro.');
      }
      persistAuthSession(data);
      redirectAfterLogin(data.user.role);
    } catch (error) {
      feedback.textContent = error.message;
      feedback.style.color = '#ff6b6b';
      feedback.style.display = 'block';
    } finally {
      if (signupSubmitBtn) signupSubmitBtn.disabled = false;
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
          signupSubtitle.textContent =
            data?.acceptingRegistrations === false
              ? data?.message || 'Este link não está aceitando novos cadastros no momento.'
              : `Cadastro vinculado a ${data?.professorName || 'seu professor'}.`;
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
          role
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
    adminStudentsCache = students;
    const tbody = document.querySelector('#studentsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!students.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#8b92b1;">Nenhum aluno cadastrado.</td></tr>';
      updateEnrollmentStudentSelect();
      return;
    }
    students.forEach((student) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>
          <strong>${student.full_name}</strong>
          <span style="font-size:0.85rem;color:#8b92b1;">${student.email}</span>
        </td>
        <td>${student.class_name || 'Sem turma'}</td>
        <td>${student.phone || '—'}</td>
        <td>
          <span class="toggle-pill" style="background:${student.is_active ? 'rgba(109, 99, 255, 0.15)' : '#fff0f0'}; color:${student.is_active ? '#6d63ff' : '#ff6b6b'};">
            ${student.is_active ? 'Ativo' : 'Bloqueado'}
          </span>
        </td>
        <td>
          <div class="table-actions">
            <button data-student-id="${student.id}" data-action="toggle" class="primary-btn" style="width:auto; padding:0.4rem 0.9rem; font-size:0.85rem;">
              ${student.is_active ? 'Bloquear' : 'Autorizar'}
            </button>
            <button data-student-id="${student.id}" data-action="delete" class="secondary-btn small" type="button">
              Excluir
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(row);
    });
    updateEnrollmentStudentSelect();
  } catch (error) {
    console.error(error);
  }
};

const renderProfessorCreditsStatus = (payload = null) => {
  const node = document.getElementById('professorCreditsStatus');
  if (!node) return;
  const role = getCurrentUserRole();
  if (role !== 'professor') {
    node.textContent = '';
    return;
  }
  const credits = Number(payload?.aiCredits);
  const safeCredits = Number.isFinite(credits) ? Math.max(0, Number(credits.toFixed(2))) : 0;
  const safeCostPerCall = 0;
  node.textContent = `Seus créditos de IA disponíveis: ${safeCredits}`;
  node.textContent = `Seus créditos de IA disponíveis: ${formatCreditNumber(safeCredits)} | custo por chamada: ${formatCreditNumber(safeCostPerCall)}`;
  node.textContent = `Seus creditos de IA disponiveis: ${formatCreditNumber(safeCredits)}`;
  node.style.color = safeCredits > 0 ? '#6d63ff' : '#ff6b6b';
  const storedUser = getCurrentUserData();
  localStorage.setItem('curso-platform-user', JSON.stringify({
    ...storedUser,
    role,
    aiCredits: safeCredits,
    studentLimit: payload?.studentLimit ?? storedUser.studentLimit ?? null,
    storageLimitBytes: payload?.storageLimitBytes ?? storedUser.storageLimitBytes ?? null
  }));
  renderStudentSignupLinkPanel();
};

const loadProfessorCreditsStatus = async () => {
  const role = getCurrentUserRole();
  if (role !== 'professor') {
    renderProfessorCreditsStatus(null);
    return;
  }
  try {
    const response = await authorizedFetch('/api/admin/me/professor-credits');
    const payload = await response.json();
    renderProfessorCreditsStatus(payload);
  } catch (error) {
    renderProfessorCreditsStatus({ aiCredits: getCurrentUserData().aiCredits ?? 0 });
  }
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
    status.textContent = `Por segurança, o link completo aparece no momento da geração. Se precisar de outro, gere novamente e o anterior será invalidado. ${limitLabel}`;
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
    const response = await authorizedFetch('/api/admin/student-signup-link', {
      method: 'POST'
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
    status.textContent = `Link gerado com sucesso. Compartilhe com o aluno. Se você gerar outro, este será invalidado. ${limitText}`;
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

const renderAdminProfessors = () => {
  const list = document.getElementById('adminProfessorList');
  if (!list) return;
  if (!adminProfessorsCache.length) {
    list.innerHTML = '<p style="margin:0; color:#8b92b1;">Nenhum professor cadastrado.</p>';
    return;
  }
  list.innerHTML = adminProfessorsCache
    .map((professor) => `
      <div class="module-list-item">
        <h4>${escapeHtml(professor.full_name)}</h4>
        <p>${escapeHtml(professor.email)}${professor.phone ? ` • ${escapeHtml(professor.phone)}` : ''}</p>
        <p>Créditos de IA: <strong>${Number(professor.aiCredits || 0)}</strong></p>
        <p>Alunos: <strong>${Number(professor.studentCount || 0)}</strong>${professor.studentLimit ? ` / ${Number(professor.studentLimit)}` : ' / sem limite'}</p>
        <p>Armazenamento: <strong>${formatStorageAmount(professor.storageUsedBytes || 0)}</strong>${professor.storageLimitBytes ? ` / ${formatStorageAmount(professor.storageLimitBytes)}` : ' / sem limite'}</p>
        <p>Status: ${professor.is_active ? 'Ativo' : 'Bloqueado'}</p>
        <div class="form-actions" style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
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
      </div>
    `)
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
    const response = await authorizedFetch('/api/admin/professors');
    const professors = await response.json();
    adminProfessorsCache = Array.isArray(professors) ? professors : [];
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
    if (!courses.length) {
      container.innerHTML = '<p style="margin:0; color:#8b92b1;">Nenhum curso cadastrado.</p>';
      updateEnrollmentCourseSelect();
      return;
    }
    container.innerHTML = courses
      .map((course) => {
        const coverImage = getCourseCoverImage(course);
        return `
        <div class="list-item admin-course-item">
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
        </div>`;
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
    subtitle.textContent = activeCourse?.slug ? `Curso: ${activeCourse.slug}` : 'Acompanhe a conversa deste curso.';
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
  try {
    const response = await authorizedFetch('/api/admin/reports');
    const data = await response.json();
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="color:#8b92b1;">Nenhum progresso registrado.</td></tr>';
      correctedTbody.innerHTML = '<tr><td colspan="8" style="color:#8b92b1;">Nenhum relatório corrigido ainda.</td></tr>';
      return;
    }
    const pendingReports = data.filter((row) => !row.report_corrected_at);
    const correctedReports = data.filter((row) => Boolean(row.report_corrected_at));
    tbody.innerHTML = pendingReports.length
      ? pendingReports
          .map(
            (row) => `
              <tr>
                <td>
                  <strong>${row.full_name}</strong>
                  <small style="display:block; color:#8b92b1;">${row.email}</small>
                </td>
                <td>${row.course_title}</td>
                <td>${row.current_module || 'Módulo 1'}</td>
                <td>${formatMinutes(row.video_position)}</td>
                <td>${row.interactive_step || '0.0'}</td>
                <td>${formatGrade(row.grade)}</td>
                <td>${formatDate(row.updated_at)}</td>
                <td>
                  <div class="report-action-group">
                    <button class="secondary-btn small report-action-btn" type="button" data-progress-timeline-user="${row.user_id}" data-progress-timeline-course="${row.course_id}">
                      Ver passos${Number(row.progress_event_count) > 0 ? ` (${Number(row.progress_event_count)})` : ''}
                    </button>
                    <button class="primary-btn small report-action-btn" type="button" data-report-correct-user="${row.user_id}" data-report-correct-course="${row.course_id}">
                      Corrigir
                    </button>
                  </div>
                </td>
              </tr>`
          )
          .join('')
      : '<tr><td colspan="8" style="color:#8b92b1;">Nenhum relatório pendente no momento.</td></tr>';
    correctedTbody.innerHTML = correctedReports.length
      ? correctedReports
          .map(
            (row) => `
              <tr>
                <td>
                  <strong>${row.full_name}</strong>
                  <small style="display:block; color:#8b92b1;">${row.email}</small>
                </td>
                <td>${row.course_title}</td>
                <td>${row.current_module || 'Módulo 1'}</td>
                <td>${formatMinutes(row.video_position)}</td>
                <td>${row.interactive_step || '0.0'}</td>
                <td>${formatGrade(row.grade)}</td>
                <td>${formatDate(row.report_corrected_at)}</td>
                <td>
                  <div class="report-action-group">
                    <button class="secondary-btn small report-action-btn" type="button" data-progress-timeline-user="${row.user_id}" data-progress-timeline-course="${row.course_id}">
                      Ver passos${Number(row.progress_event_count) > 0 ? ` (${Number(row.progress_event_count)})` : ''}
                    </button>
                    <button class="secondary-btn small report-action-btn" type="button" data-corrected-delete-user="${row.user_id}" data-corrected-delete-course="${row.course_id}">
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>`
          )
          .join('')
      : '<tr><td colspan="8" style="color:#8b92b1;">Nenhum relatório corrigido ainda.</td></tr>';
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
            <td>${formatMinutes(row.video_position)}</td>
            <td>${row.interactive_step || '0.0'}</td>
            <td>${formatGrade(row.grade)}</td>
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
    correctedTbody.innerHTML = correctedTbody.innerHTML || '<tr><td colspan="8" style="color:#8b92b1;">Nenhum relatório corrigido ainda.</td></tr>';
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:#ff6b6b;">Não foi possível carregar os relatórios.</td></tr>';
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
      ? ` • ${imageProvider.providerLabel} • ${imageProvider.model} • imagem ativa`
      : ' • Nano Banana não configurada';
  const textCost = settings.aiTextCreditCostPerCall || settings.aiCreditCostPerCall || 0.5;
  const imageCost = settings.aiImageCreditCostPerCall || 1.0;
  statusNode.textContent = `${settings.providerLabel} • ${settings.model} • ${statusLabel} • ${confirmationLabel}${imageLabel} • texto: ${formatCreditNumber(textCost)} • imagem: ${formatCreditNumber(imageCost)}`;
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
  if (aiTextCreditCostInput) aiTextCreditCostInput.value = settings?.aiTextCreditCostPerCall || settings?.aiCreditCostPerCall || 0.5;
  const aiImageCreditCostInput = document.getElementById('aiImageCreditCostPerCall');
  if (aiImageCreditCostInput) aiImageCreditCostInput.value = settings?.aiImageCreditCostPerCall || 1.0;
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
          <div class="module-list-item">
            <h4>${escapeHtml(notification.message)}</h4>
            <p>Destino: ${escapeHtml(notification.target_type)}${notification.target_value ? ` • ${escapeHtml(notification.target_value)}` : ''}</p>
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

const initAdminPage = () => {
  if (adminChatPollTimer) {
    clearInterval(adminChatPollTimer);
    adminChatPollTimer = null;
  }
  if (!isGlobalAdminUser()) {
    document.querySelector('[data-target="adminProfessorsSection"]')?.closest('li')?.remove();
    document.getElementById('adminProfessorsSection')?.remove();
    document.querySelector('#adminSettingsSection h2')?.replaceChildren(document.createTextNode('Configuracoes'));
    document.getElementById('adminSmtpSettingsSection')?.remove();
    const aiTextCostField = document.getElementById('aiTextCreditCostPerCall')?.closest('.field-group');
    if (aiTextCostField) aiTextCostField.remove();
    const aiImageCostField = document.getElementById('aiImageCreditCostPerCall')?.closest('.field-group');
    if (aiImageCostField) aiImageCostField.remove();
  }
  renderStudentSignupLinkPanel();
  loadProfessorCreditsStatus();
  loadAdminSmtpSettings();
  const notifTarget = document.getElementById('notificationTarget');
  const studentSelector = document.getElementById('studentSelector');
  notifTarget?.addEventListener('change', () => {
    studentSelector.style.display = notifTarget.value === 'student' ? 'block' : 'none';
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
      aiCredits: Number(document.getElementById('adminProfessorCredits').value) || 0,
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
    const targetValue = targetType === 'student' ? document.getElementById('notificationStudent').value : (targetType === 'class' ? 'Turma Master' : null);
    try {
      await authorizedFetch('/api/admin/notifications', {
        method: 'POST',
        body: JSON.stringify({
          message: document.getElementById('notificationMessage').value,
          targetType,
          targetValue
        })
      });
      alert('Notificação enviada com sucesso.');
      document.getElementById('notificationForm').reset();
      studentSelector.style.display = 'none';
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
      } else {
        const shouldEnable = button.textContent.trim() === 'Autorizar';
        await authorizedFetch(`/api/admin/students/${studentId}/status`, {
          method: 'PUT',
          body: JSON.stringify({ isActive: shouldEnable })
        });
      }
      loadAdminStudents();
    } catch (error) {
      alert('Não foi possível atualizar o status.');
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
  loadAdminAiSettings();
  loadAdminNotifications();
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

const init = () => {
  setupLogoutButtons();
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
    initChatModal();
    document.getElementById('courseStoreGrid')?.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-store-course-id]');
      if (!button) return;
      await requestStoreCourseAccess(button.dataset.storeCourseId);
    });
    renderDashboard();
    startLiveStagePolling();
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

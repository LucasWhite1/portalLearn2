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
let cachedCourses = [];
let adminStudentsCache = [];
let adminCoursesCache = [];
let courseGrid;
let adminAiSettingsCache = null;
let activeNavCleanupTimer = null;

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
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
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

const scrollToSectionById = (targetId, button = null) => {
  if (!targetId) return false;
  const section = document.getElementById(targetId);
  if (!section) return false;
  activateNavLink(button);
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  spotlightSection(section);
  return true;
};

const setupSideNavigation = () => {
  document.querySelectorAll('.nav-link[data-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.target;
      if (targetId) {
        scrollToSectionById(targetId, button);
      }
    });
  });

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
  const shouldUseScrollableModuleList = modules.length > 5;
  const modulesMarkup = modules.length
    ? `<div class="course-module-list${shouldUseScrollableModuleList ? ' is-scrollable' : ''}">
         ${modules
           .map(
              (module) =>
               `<button type="button" class="course-module-pill ${unlockedModuleIds.has(module.id) ? '' : 'locked'}" data-module-id="${module.id}" data-locked="${
                 unlockedModuleIds.has(module.id) ? 'false' : 'true'
               }">${module.title}${unlockedModuleIds.has(module.id) ? '' : ' • Bloqueado'}</button>`
           )
           .join('')}
       </div>`
    : '<p class="muted" style="margin:0.5rem 0 0;">Nenhum módulo liberado.</p>';
  const recommendedModule = getRecommendedCourseModule(course);
  card.innerHTML = `
    <div>
      <strong>${course.title}</strong>
      <p style="margin:0; color:#8b92b1; font-size:0.9rem;">${course.description || 'Curso em construção'}</p>
      ${modulesMarkup}
    </div>
    <div class="course-card-meta">
      <span class="badge">${interactiveLabel}</span>
      <p style="margin:0; font-size:0.75rem; color:#8b92b1;">${progressPercent.toFixed(0)}% do vídeo</p>
    </div>
  `;
  if (recommendedModule) {
    card.classList.add('clickable-card');
    card.addEventListener('click', (event) => {
      const pill = event.target.closest('.course-module-pill');
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
  actionButton.textContent = recommendedModule ? 'Continuar fase' : 'Aguardando módulo';
  actionButton.disabled = !recommendedModule;
  if (recommendedModule) {
    actionButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openCourseModule(course.id, recommendedModule.id);
    });
  }
  card.appendChild(actionButton);
  return card;
};

const renderCourses = (courses) => {
  cachedCourses = courses;
  courseGrid = document.getElementById('courseGrid');
  if (!courseGrid) return;
  courseGrid.innerHTML = '';
  if (!courses.length) {
    courseGrid.innerHTML = '<p class="muted" style="margin:0;">Você ainda não está matriculado em nenhum curso.</p>';
    return;
  }
  courses.forEach((course) => courseGrid.appendChild(createCourseCard(course)));
};

const renderNotifications = async () => {
  const panel = document.getElementById('notificationPanel');
  if (!panel) return;
  try {
    const response = await authorizedFetch('/api/student/notifications');
    const data = await response.json();
    panel.innerHTML = '<h2>Notificações</h2>';
    if (!data.length) {
      panel.innerHTML += '<div class="notification"><p style="margin:0; color:#8b92b1;">Sem novas notificações.</p></div>';
      return;
    }
    data.forEach((note) => {
      const item = document.createElement('div');
      item.className = 'notification';
      item.innerHTML = `<p style="margin:0;">${note.message}</p><small style="color:#8b92b1;">${new Date(note.created_at).toLocaleString()}</small>`;
      panel.appendChild(item);
    });
  } catch (err) {
    console.error(err);
  }
};

const renderDashboard = async () => {
  try {
    const profileRes = await authorizedFetch('/api/student/profile');
    const profile = await profileRes.json();
    const nameElem = document.getElementById('studentDisplayName');
    if (nameElem) {
      nameElem.textContent = profile.full_name;
    }
    const coursesRes = await authorizedFetch('/api/student/courses');
    const courses = await coursesRes.json();
    renderCourses(courses);
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
    await renderNotifications();
  } catch (err) {
    console.error(err);
  }
};

const redirectAfterLogin = (role) => {
  if (role === 'admin') {
    window.location.href = 'admin.html';
  } else {
    window.location.href = 'portal.html';
  }
};

const initLogin = () => {
  const form = document.getElementById('loginForm');
  const feedback = document.getElementById('loginFeedback');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.style.display = 'none';
    const email = form.email.value;
    const password = form.password.value;
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await parseJsonSafely(response);
      if (!response.ok) {
        throw new Error(data?.message || 'Falha no login');
      }
      if (!data?.token || !data?.user?.role) {
        throw new Error('A API não retornou os dados de login esperados.');
      }
      setToken(data.token);
      localStorage.setItem(USER_ROLE_KEY, data.user.role);
      redirectAfterLogin(data.user.role);
    } catch (error) {
      feedback.textContent = error.message;
      feedback.style.display = 'block';
    }
  });
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
      .map(
        (course) => `
        <div class="list-item">
          <div>
            <strong>${course.title}</strong>
            <p style="margin:0; color:#8b92b1; font-size:0.85rem;">${course.slug}</p>
            <small style="color:#8b92b1; font-size:0.8rem;">${course.description || 'Sem descrição'}</small>
            <small style="color:#6d63ff; display:block; margin-top:0.35rem; font-size:0.75rem;">${course.module_count || 0} módulo(s)</small>
          </div>
          <button data-course-id="${course.id}" class="secondary-btn small" type="button">Excluir</button>
        </div>`
      )
      .join('');
    updateEnrollmentCourseSelect();
  } catch (error) {
    container.innerHTML = '<p style="margin:0; color:#ff6b6b;">Não foi possível carregar os cursos.</p>';
  }
};

const loadReports = async () => {
  const tbody = document.getElementById('reportsTableBody');
  if (!tbody) return;
  try {
    const response = await authorizedFetch('/api/admin/reports');
    const data = await response.json();
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:#8b92b1;">Nenhum progresso registrado.</td></tr>';
      return;
    }
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
          </tr>`
      )
      .join('');
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:#ff6b6b;">Não foi possível carregar os relatórios.</td></tr>';
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
  statusNode.textContent = `${settings.providerLabel} • ${settings.model} • ${statusLabel} • ${confirmationLabel}${imageLabel}`;
  statusNode.style.color = settings.isEnabled ? '#6d63ff' : '#8b92b1';
};

const fillAiSettingsForm = (settings) => {
  const providerLabelInput = document.getElementById('aiProviderLabel');
  if (!providerLabelInput) return;
  providerLabelInput.value = settings?.providerLabel || 'DeepSeek';
  document.getElementById('aiProviderKey').value = settings?.providerKey || 'deepseek';
  document.getElementById('aiBaseUrl').value = settings?.baseUrl || 'https://api.deepseek.com';
  document.getElementById('aiModel').value = settings?.model || 'deepseek-chat';
  document.getElementById('aiImageProviderLabel').value = settings?.imageProvider?.providerLabel || 'Nano Banana';
  document.getElementById('aiImageProviderKey').value = settings?.imageProvider?.providerKey || 'google-gemini-image';
  document.getElementById('aiImageBaseUrl').value =
    settings?.imageProvider?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  document.getElementById('aiImageModel').value = settings?.imageProvider?.model || 'gemini-2.5-flash-image';
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
            <h4>${notification.message}</h4>
            <p>Destino: ${notification.target_type}${notification.target_value ? ` • ${notification.target_value}` : ''}</p>
            <p>${new Date(notification.created_at).toLocaleString('pt-BR')}</p>
            <div class="actions">
              <button class="secondary-btn danger" type="button" data-notification-id="${notification.id}">Apagar</button>
            </div>
          </div>
        `
      )
      .join('');
  } catch (error) {
    list.innerHTML = '<p class="muted" style="margin:0; color:#ff6b6b;">Não foi possível carregar as notificações.</p>';
  }
};

const initAdminPage = () => {
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
      password: document.getElementById('adminStudentPassword').value
    };
    try {
      const response = await authorizedFetch('/api/admin/students', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const created = await response.json();
      alert('Aluno cadastrado com sucesso.');
      document.getElementById('studentForm').reset();
      loadAdminStudents();
    } catch (error) {
      alert(error.message);
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

  document.getElementById('courseForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      title: document.getElementById('courseTitle').value,
      description: document.getElementById('courseDescription').value,
      slug: document.getElementById('courseSlug').value
    };
    try {
      await authorizedFetch('/api/admin/courses', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      alert('Curso criado com sucesso.');
      document.getElementById('courseForm').reset();
      loadAdminCourses();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById('adminCourseList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-course-id]');
    if (!button) return;
    const courseId = button.dataset.courseId;
    try {
      await authorizedFetch(`/api/admin/courses/${courseId}`, { method: 'DELETE' });
      loadAdminCourses();
    } catch (error) {
      alert('Não foi possível remover o curso.');
    }
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
  loadAdminCourses();
  loadReports();
  loadAdminAiSettings();
  loadAdminNotifications();
};

const init = () => {
  setupLogoutButtons();
  if (document.getElementById('loginForm')) {
    initLogin();
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
    renderDashboard();
    return;
  }
  if (isAdmin) {
    setupSideNavigation();
    initAdminPage();
  }
};

document.addEventListener('DOMContentLoaded', init);

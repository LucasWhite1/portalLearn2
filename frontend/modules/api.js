import { API_BASE, getToken, STORAGE_KEY, USER_ROLE_KEY } from './constants.js';

let authRedirectPending = false;

const redirectToLogin = () => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(USER_ROLE_KEY);
  localStorage.removeItem('curso-platform-user');
  if (authRedirectPending) return;
  authRedirectPending = true;
  if (!window.location.pathname.endsWith('/login.html')) {
    window.location.replace('login.html');
  }
};

export const authorizedFetch = async (path, options = {}) => {
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
  if (response.status === 402 && !window.location.pathname.endsWith('/admin.html')) {
    window.location.replace('admin.html?billing=required');
    throw new Error('Assinatura vencida');
  }
  return response;
};

export const handleLogout = async () => {
  try {
    await authorizedFetch('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    console.warn('Logout falhou', error);
  } finally {
    redirectToLogin();
  }
};

import { API_BASE, getToken, STORAGE_KEY, USER_ROLE_KEY } from './constants.js';

export const authorizedFetch = async (path, options = {}) => {
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

export const handleLogout = async () => {
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

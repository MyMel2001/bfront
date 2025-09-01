/*
 Client-side credential storage utilities for localStorage (Option A)
 Stores username and access token. Passwords are never stored.
 */

const CRED_KEY = 'bsky_frontend_creds_v1';

export function saveCreds(creds) {
  if (!creds || typeof creds.username !== 'string' || typeof creds.token !== 'string') {
    throw new Error('Invalid credentials object');
  }
  localStorage.setItem(CRED_KEY, JSON.stringify(creds));
}

export function loadCreds() {
  try {
    const raw = localStorage.getItem(CRED_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearCreds() {
  localStorage.removeItem(CRED_KEY);
}

export function isCredsValid(creds) {
  if (!creds || typeof creds.username !== 'string' || typeof creds.token !== 'string') return false;
  if (creds.expiresAt && typeof creds.expiresAt === 'number' && Date.now() > creds.expiresAt) {
    return false;
  }
  return true;
}

export function loadValidCreds() {
  const creds = loadCreds();
  return isCredsValid(creds) ? creds : null;
}

export function attachAuthHeader(headers = {}) {
  const creds = loadValidCreds();
  if (creds && creds.token) {
    return { ...headers, Authorization: `Bearer ${creds.token}` };
  }
  return headers;
}
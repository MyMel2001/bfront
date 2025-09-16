// Client-side JavaScript for localStorage credential storage
const CRED_KEY = 'bsky_frontend_creds_v1';

function saveCreds(creds) {
  if (!creds || typeof creds.username !== 'string' || typeof creds.token !== 'string') {
    throw new Error('Invalid credentials object');
  }
  localStorage.setItem(CRED_KEY, JSON.stringify(creds));
}

function loadCreds() {
  try {
    const raw = localStorage.getItem(CRED_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function clearCreds() {
  localStorage.removeItem(CRED_KEY);
}

function isCredsValid(creds) {
  if (!creds || typeof creds.username !== 'string' || typeof creds.token !== 'string') return false;
  if (creds.expiresAt && typeof creds.expiresAt === 'number' && Date.now() > creds.expiresAt) {
    return false;
  }
  return true;
}

function loadValidCreds() {
  const creds = loadCreds();
  return isCredsValid(creds) ? creds : null;
}

// Function to check if we have valid credentials and redirect to feed if so
function checkAndRedirect() {
  const creds = loadValidCreds();
  if (creds) {
    // We have valid credentials, send them to the server to create a session
    fetch('/auto-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(creds)
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        window.location.href = data.redirectUrl;
      } else {
        // Clear invalid credentials and redirect to login
        clearCreds();
        window.location.href = '/';
      }
    })
    .catch(error => {
      console.error('Auto-login error:', error);
      // Clear credentials and redirect to login
      clearCreds();
      window.location.href = '/';
    });
  }
}

// Export functions for use in other modules
window.BskyStorage = {
  saveCreds,
  loadCreds,
  clearCreds,
  loadValidCreds
};

// Auto-save credentials if they're passed from the server
document.addEventListener('DOMContentLoaded', function() {
  // This will be handled by the server-side script injection
  // Check for saved credentials and redirect if valid
  checkAndRedirect();
});
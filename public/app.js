// Minimal frontend app.js for Bluesky Alt scaffold (login-enabled)

(function(){
  const BASE_URL = 'https://public.bsky.social';
  const sections = {
    feeds: document.getElementById('feeds'),
    posts: document.getElementById('posts'),
    dm: document.getElementById('dm'),
    profile: document.getElementById('profile'),
    pds: document.getElementById('pds')
  };

  function show(section){
    Object.values(sections).forEach(s => s && (s.hidden = true));
    if (sections[section]) sections[section].hidden = false;

    document.querySelectorAll('.sidebar .link').forEach(a => {
      a.classList.toggle('active', a.dataset.section === section);
    });
  }

  document.querySelectorAll('.sidebar .link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      show(a.dataset.section);
    });
  });

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', () => {
    document.getElementById('app').classList.toggle('theme-dark');
  });

  // API helper with token from localStorage
  async function api(path, opts){
    const url = '/api/' + path;
    const token = localStorage.getItem('token');
    const headers = Object.assign({'Content-Type':'application/json'}, (opts && opts.headers) || {});
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const init = { method: (opts && opts.method) || 'GET', headers: headers };
    if (init.method !== 'GET' && init.method !== 'HEAD') {
      init.body = (opts && opts.body) ? JSON.stringify(opts.body) : undefined;
    }
    const res = await fetch(url, init);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  // Login (web form)
  async function loginUser(){
    const identifier = document.getElementById('loginIdentifier')?.value;
    const password = document.getElementById('loginPassword')?.value;
    const baseUrl = document.getElementById('loginBaseUrl')?.value;
    const loginBtnEl = document.getElementById('loginBtn');
    if (!identifier || !password) { showLoginStatus('Please enter identifier and password'); return; }
    if (loginBtnEl) loginBtnEl.disabled = true;
    showLoginStatus('Logging in...');

    // Try ATProto frontend login first
    let token = '';
    let libBaseUrl = baseUrl;
    try {
      const atprotoModule = await import('@atproto/api');
      const lib = atprotoModule?.default || atprotoModule;
      if (lib) {
        const Client = lib.AppClient || lib.Client || lib.default?.AppClient;
        if (typeof Client === 'function') {
          const client = new Client({ service: libBaseUrl || BASE_URL, persistSession: true });
          const sess = await client.login?.({ identifier, password });
          token = sess?.jwt || sess?.accessJwt || '';
        } else if (typeof lib.login === 'function') {
          const sess = await lib.login({ identifier, password, baseUrl: libBaseUrl || BASE_URL });
          token = sess?.jwt || sess?.accessJwt || '';
        } else if (typeof lib.authenticate === 'function') {
          const sess = await lib.authenticate({ username: identifier, password, baseUrl: libBaseUrl || BASE_URL });
          token = sess?.jwt || '';
        }
      }
    } catch (err) {
      // library not available or not usable; fall back to server path
      console.info('ATProto frontend login not available, falling back to server login:', err?.toString?.());
    }

    if (token) {
      localStorage.setItem('token', token);
      localStorage.setItem('baseUrl', libBaseUrl || BASE_URL);
      showLoginStatus('Login successful (via ATProto library)');
      fetchFeed();
      show('feeds');
      if (loginBtnEl) loginBtnEl.disabled = false;
      return;
    }

    // Fallback to existing server-side login
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({identifier, password, baseUrl: libBaseUrl})
      });
      const data = await res.json();
      if (!res.ok) {
        showLoginStatus('Login failed: ' + (data?.error ?? 'unknown'));
        if (loginBtnEl) loginBtnEl.disabled = false;
        return;
      }
      const token2 = data.token;
      if (token2) {
        localStorage.setItem('token', token2);
        localStorage.setItem('baseUrl', data?.baseUrl || baseUrl || BASE_URL);
        showLoginStatus('Login successful');
        fetchFeed();
        show('feeds');
      } else {
        showLoginStatus('No token received');
      }
      if (loginBtnEl) loginBtnEl.disabled = false;
    } catch (err) {
      showLoginStatus('Login error');
      if (loginBtnEl) loginBtnEl.disabled = false;
    }
  }

  function showLoginStatus(msg){
    const el = document.getElementById('loginStatus');
    if (el) {
      el.textContent = msg;
      setTimeout(() => { el.textContent = ''; }, 1500);
    }
  }

  // Init helpers
  function loadConfig(){
    const base = localStorage.getItem('baseUrl') || BASE_URL;
    const token = localStorage.getItem('token') || '';
    const loginBase = document.getElementById('loginBaseUrl');
    if (loginBase) loginBase.value = base;
    const loginIdentifier = document.getElementById('loginIdentifier');
    if (loginIdentifier) loginIdentifier.value = '';
    const loginPassword = document.getElementById('loginPassword');
    if (loginPassword) loginPassword.value = '';
  }
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.addEventListener('click', loginUser);

  // Enable Enter-to-login for login fields
  const loginFields = ['loginIdentifier','loginPassword'];
  loginFields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        loginUser();
      }
    });
  });

  // Feed rendering
  function renderMockFeed(){
    const feed = document.getElementById('feedList');
    feed.innerHTML = '';
    const items = [
      {author:'Ava Bluesky', text:'Just kicked off a new project on Node.js', time:'2h'},
      {author:'Nebula', text:'Working on a beautiful UI theme', time:'3h'},
      {author:'Roo', text:'API proxy scaffold in progress', time:'5h'}
    ];
    items.forEach(it => {
      const c = document.createElement('div');
      c.className = 'card';
      c.innerHTML = `<strong>${it.author}</strong><p>${it.text}</p><small>${it.time} ago</small>`;
      feed.appendChild(c);
    });
  }

  function renderFeed(payload){
    const feed = document.getElementById('feedList');
    feed.innerHTML = '';
    const items = (payload && (payload.timeline && payload.timeline.items)) ||
                  (payload && (payload.feed && payload.feed.items)) ||
                  (payload && (payload.items)) || [];
    if (!items.length) { renderMockFeed(); return; }
    items.forEach(it=>{
      const author = it.author?.name || it.author || 'Unknown';
      const text = it.post?.record?.text || it.text || JSON.stringify(it);
      const time = it.post?.indexed_at?.toString?.() || 'now';
      const c = document.createElement('div');
      c.className = 'card';
      c.innerHTML = `<strong>${author}</strong><p>${text}</p><small>${time}</small>`;
      feed.appendChild(c);
    });
  }

  async function fetchFeed(){
    try {
      const data = await api('xrpc/app.bsky.feed.getTimeline', { method:'POST', body: {} });
      renderFeed(data);
    } catch(err){
      renderMockFeed();
    }
  }

  // Post composer
  const postBtn = document.getElementById('postBtn');
  const postContent = document.getElementById('postContent');
  const postStatus = document.getElementById('postStatus');
  if (postBtn){
    postBtn.addEventListener('click', async () => {
      const text = postContent.value.trim();
      if (!text) return;
      postStatus.textContent = 'Posting...';
      try {
        await api('xrpc/app.bsky.feed.post', { method:'POST', body: { text } });
        postStatus.textContent = 'Posted';
        postContent.value = '';
        setTimeout(()=> postStatus.textContent = '', 1500);
        fetchFeed();
      } catch (e){
        postStatus.textContent = 'Post failed';
        setTimeout(()=> postStatus.textContent = '', 1500);
      }
    });
  }

  // DM: simple local messages
  function loadDMs(){
    const dmList = document.getElementById('dmList');
    if (!dmList) return;
    dmList.innerHTML = '';
    const messages = JSON.parse(localStorage.getItem('messages') || '[]');
    if (!messages.length){
      const seed = [
        {id:'alice', name:'Alice', last:'Hey there!', ts:new Date().toISOString()},
        {id:'bro', name:'Bro', last:'What are you up to?', ts:new Date().toISOString()}
      ];
      localStorage.setItem('messages', JSON.stringify(seed));
    }
    const ds = JSON.parse(localStorage.getItem('messages') || '[]');
    ds.forEach(m => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<strong>${m.name}</strong><p>${m.last}</p><small>${new Date(m.ts).toLocaleTimeString()}</small>`;
      card.addEventListener('click', () => openChat(m.id, m.name));
      dmList.appendChild(card);
    });
  }

  function openChat(contactId, contactName){
    const dmSection = document.getElementById('dm');
    dmSection.innerHTML = '<h2>Direct Messages</h2>';
    const chat = document.createElement('div');
    chat.className = 'cards';
    chat.style.display = 'flex';
    chat.style.flexDirection = 'column';
    chat.style.gap = '8px';
    const history = JSON.parse(localStorage.getItem('chat_' + contactId) || '[]');
    history.forEach(h => {
      const b = document.createElement('div');
      b.className = 'card';
      b.style.alignSelf = h.from === 'me' ? 'flex-end' : 'flex-start';
      b.innerHTML = `<div>${h.text}</div><small>${new Date(h.ts).toLocaleTimeString()}</small>`;
      chat.appendChild(b);
    });
    const composer = document.createElement('div');
    composer.className = 'card composer';
    const ta = document.createElement('textarea');
    ta.rows = 3;
    ta.placeholder = 'Message to ' + contactName;
    const send = document.createElement('button');
    send.textContent = 'Send';
    send.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) return;
      const msg = { text, ts: new Date().toISOString(), from: 'me' };
      history.push(msg);
      localStorage.setItem('chat_' + contactId, JSON.stringify(history));
      const el = document.createElement('div');
      el.className = 'card';
      el.style.alignSelf = 'flex-end';
      el.innerHTML = `<div>${text}</div><small>${new Date().toLocaleTimeString()}</small>`;
      chat.appendChild(el);
      ta.value = '';
      setTimeout(() => {
        const reply = { text: 'Nice!', ts: new Date().toISOString(), from: contactName };
        history.push({ text: reply.text, ts: reply.ts, from: contactName });
        localStorage.setItem('chat_' + contactId, JSON.stringify(history));
        const r = document.createElement('div');
        r.className = 'card';
        r.style.alignSelf = 'flex-start';
        r.innerHTML = `<div>${reply.text}</div><small>${new Date(reply.ts).toLocaleTimeString()}</small>`;
        chat.appendChild(r);
      }, 600);
    });
    composer.appendChild(ta);
    composer.appendChild(send);
    dmSection.appendChild(chat);
    dmSection.appendChild(composer);
    show('dm');
  }

  // Profile: basic editable
  const profileContainer = document.getElementById('profileView');
  function renderProfile(){
    const name = localStorage.getItem('displayName') || 'You';
    const handle = localStorage.getItem('handle') || '@you';
    if (profileContainer){
      profileContainer.innerHTML = `
        <div class="card">
          <h3>Profile</h3>
          <p>Name: <input id="nameInput" value="${name}" style="width:60%"/></p>
          <p>Handle: <input id="handleInput" value="${handle}" style="width:60%"/></p>
          <button id="saveProfile">Save</button>
        </div>`;
      const saveBtn = document.getElementById('saveProfile');
      if (saveBtn){
        saveBtn.addEventListener('click', () => {
          const n = document.getElementById('nameInput').value;
          const h = document.getElementById('handleInput').value;
          localStorage.setItem('displayName', n);
          localStorage.setItem('handle', h);
        });
      }
    }
  }

  function renderPDS(){
    const baseUrlInput = document.getElementById('baseUrl');
    if (baseUrlInput){
      baseUrlInput.value = localStorage.getItem('baseUrl') || BASE_URL;
    }
  }

  // Init
  loadConfig();
  renderProfile();
  renderPDS();
  loadDMs();
  fetchFeed();
  show('feeds');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fetchFeed();
  });
})();
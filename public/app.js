// Minimal frontend app.js for Bluesky Alt scaffold
(function(){
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

  // Config persistence
  function loadConfig(){
    document.getElementById('baseUrl').value = localStorage.getItem('baseUrl') || 'https://public.bsky.social';
    document.getElementById('token').value = localStorage.getItem('token') || '';
  }
  document.getElementById('saveConfig').addEventListener('click', () => {
    localStorage.setItem('baseUrl', document.getElementById('baseUrl').value);
    localStorage.setItem('token', document.getElementById('token').value);
    // show a simple status
    const st = document.createElement('div');
    st.textContent = 'Config saved';
    st.style.color = '#9ae6b4';
    document.body.appendChild(st);
    setTimeout(() => st.remove(), 1500);
  });

  // API helper
  async function api(path, opts){
    const url = '/api/' + path;
    const res = await fetch(url, {
      method: (opts && opts.method) || 'GET',
      headers: Object.assign({'Content-Type': 'application/json'}, (opts && opts.headers) || {}),
      body: (opts && opts.body) ? JSON.stringify(opts.body) : undefined
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  // Demo feed: try to fetch real timeline; fall back to mock if errors occur
  async function fetchFeed(){
    try {
      const data = await api('xrpc/app.bsky.feed.getTimeline', { method: 'POST', body: {} });
      renderFeed(data);
    } catch (e){
      renderMockFeed();
    }
  }

  function renderMockFeed(){
    const feed = document.getElementById('feedList');
    feed.innerHTML = '';
    const items = [
      {author:'Ava Bluesky', text:'Just kicked off a new project on Node.js', time:'2h'},
      {author:'Nebula', text:'Working on a beautiful UI theme', time:'3h'},
      {author:'Roo', text:'API proxy scaffold in progress', time:'5h'}
    ];
    items.forEach(it=>{
      const c = document.createElement('div');
      c.className = 'card';
      c.innerHTML = `<strong>${it.author}</strong><p>${it.text}</p><small>${it.time} ago</small>`;
      feed.appendChild(c);
    });
  }

  function renderFeed(payload){
    const feed = document.getElementById('feedList');
    feed.innerHTML = '';
    // Try to normalize possible payload shapes
    const items = (payload && (payload.timeline && payload.timeline.items)) ||
                  (payload && (payload.feed && payload.feed.items)) ||
                  (payload && (payload.items)) ||
                  [];

    if (!items.length){
      renderMockFeed();
      return;
    }

    items.forEach(it=>{
      // Support a couple common shapes
      const author = it.author?.name || it.author || 'Unknown';
      const text = it.post?.record?.text || it.text || JSON.stringify(it);
      const time = it.post?.indexed_at?.toString?.() || 'now';
      const c = document.createElement('div');
      c.className = 'card';
      c.innerHTML = `<strong>${author}</strong><p>${text}</p><small>${time}</small>`;
      feed.appendChild(c);
    });
  }

  // Composer: Post
  const postBtn = document.getElementById('postBtn');
  const postContent = document.getElementById('postContent');
  const postStatus = document.getElementById('postStatus');
  if (postBtn){
    postBtn.addEventListener('click', async () => {
      const text = postContent.value.trim();
      if (!text) return;
      postStatus.textContent = 'Posting...';
      try {
        const res = await api('xrpc/app.bsky.feed.post', {
          method: 'POST',
          body: { text }
        });
        postStatus.textContent = 'Posted';
        postContent.value = '';
        setTimeout(()=> postStatus.textContent = '', 1500);
        // refresh feed after post
        fetchFeed();
      } catch (e){
        postStatus.textContent = 'Post failed';
        setTimeout(()=> postStatus.textContent = '', 1500);
      }
    });
  }

  // DM: simple local storage chat
  function loadDMs(){
    const list = document.getElementById('dmList');
    list.innerHTML = '';
    const messages = JSON.parse(localStorage.getItem('messages') || '[]');
    if (!messages.length){
      // seed with a couple
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
      list.appendChild(card);
    });
  }

  function openChat(contactId, contactName){
    // create a simple chat panel inside DM section
    const dmSection = document.getElementById('dm');
    dmSection.innerHTML = '<h2>Direct Messages</h2>';
    const chat = document.createElement('div');
    chat.className = 'cards';
    chat.style.display = 'flex';
    chat.style.flexDirection = 'column';
    chat.style.gap = '8px';
    // load chat history
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
      // append to history and save
      history.push(msg);
      localStorage.setItem('chat_' + contactId, JSON.stringify(history));
      const el = document.createElement('div');
      el.className = 'card';
      el.style.alignSelf = 'flex-end';
      el.innerHTML = `<div>${text}</div><small>${new Date().toLocaleTimeString()}</small>`;
      chat.appendChild(el);
      ta.value = '';
      // simulate reply
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

  // Profile: basic view with editable name
  const profileView = document.getElementById('profileView');
  function renderProfile(){
    const name = localStorage.getItem('displayName') || 'You';
    const handle = localStorage.getItem('handle') || '@you';
    profileView.innerHTML = `
      <div class="card">
        <h3>Profile</h3>
        <p>Name: <input id="nameInput" value="${name}" style="width:60%"/></p>
        <p>Handle: <input id="handleInput" value="${handle}" style="width:60%"/></p>
        <button id="saveProfile">Save</button>
      </div>`;
    document.getElementById('saveProfile')?.addEventListener('click', () => {
      const n = document.getElementById('nameInput').value;
      const h = document.getElementById('handleInput').value;
      localStorage.setItem('displayName', n);
      localStorage.setItem('handle', h);
    });
  }

  // PDS: basic config display
  function renderPDS(){
    document.getElementById('baseUrl').value = localStorage.getItem('baseUrl') || 'https://public.bsky.social';
    document.getElementById('token').value = localStorage.getItem('token') || '';
  }

  // Init
  loadConfig();
  renderProfile();
  renderPDS();
  loadDMs();
  fetchFeed();
  show('feeds');
  // Add tests for post links to ensure visibility
  document.addEventListener('visibilitychange', () => {
    // refresh feeds when tab becomes visible to simulate live updates
    if (document.visibilityState === 'visible') fetchFeed();
  });

})();
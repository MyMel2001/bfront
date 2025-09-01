const express = require('express');
const { BskyAgent, RichText } = require('@atproto/api');
const path = require('path');
const app = express();
const PORT = 2679;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// A simple session store. In a real app, use a more robust solution like `express-session` with a database.
const sessions = {};

// Live Direct Messages - feature flag and helpers
const DM_LIVE = true;

// In-memory DM store (for mock data and live data when available)
const dmStore = {};

async function fetchLiveConversations(agent) {
  const candidates = [
    () => agent.listConversations?.(),
    () => agent.app?.bsky?.messenger?.listConversations?.(),
    () => agent.listConversations?.({ limit: 50 }),
    () => agent.app?.bsky?.messenger?.listConversations?.({ limit: 50 }),
  ];
  for (const fn of candidates) {
    try {
      const res = await fn();
      const data = res?.data?.conversations ?? res?.conversations;
      if (Array.isArray(data) && data.length > 0) {
        return data.map(item => ({
          id: item.id || item.cid,
          with: item.with || item.peerHandle || 'unknown',
          lastMessage: item.lastMessage?.text || '',
          unread: typeof item.unread === 'number' ? item.unread : 0
        }));
      }
    } catch (e) {
      // ignore and try next
    }
  }
  return null;
}

async function fetchLiveMessages(agent, dmId) {
  const candidates = [
    () => agent.getMessages?.({ convo: dmId }),
    () => agent.app?.bsky?.messenger?.getMessages?.({ convo: dmId }),
    () => agent.app?.bsky?.messenger?.getMessages?.({ conversationId: dmId }),
  ];
  for (const fn of candidates) {
    try {
      const res = await fn();
      const data = res?.data?.messages ?? res?.messages;
      if (Array.isArray(data) && data.length >= 0) {
        return data.map(m => ({
          from: m.from || m.author || 'peer',
          text: m.text || m.message || '',
          ts: m.ts || m.createdAt || new Date().toISOString()
        }));
      }
    } catch (e) {
      // ignore and try next
    }
  }
  return null;
}

async function liveSendMessage(agent, dmId, text) {
  const candidates = [
    () => agent.sendMessage?.({ convo: dmId, text }),
    () => agent.app?.bsky?.messenger?.sendMessage?.({ convo: dmId, text }),
  ];
  for (const fn of candidates) {
    try {
      const res = await fn();
      return res?.data ?? res;
    } catch (e) {
      // try next
    }
  }
  return null;
}

/* Helper function to create a simple HTML response (unchanged, for UI consistency) */
function createHtmlResponse(title, bodyHtml) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background-color: #f0f2f5;
        margin: 0;
        padding: 2rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2rem;
        min-height: 100vh;
      }
      .container {
        background-color: white;
        padding: 2rem;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        width: 100%;
        max-width: 800px;
      }
      h1, h2, h3 {
        color: #1a202c;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      input, textarea, button {
        padding: 0.75rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 1rem;
      }
      button {
        background-color: #3b82f6;
        color: white;
        border: none;
        cursor: pointer;
        transition: background-color 0.3s;
      }
      button:hover {
        background-color: #2563eb;
      }
      .feed-post {
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 1rem;
        margin-bottom: 1rem;
      }
      .feed-post:last-child {
        border-bottom: none;
        margin-bottom: 0;
        padding-bottom: 0;
      }
      .post-author {
        font-weight: bold;
        color: #3b82f6;
      }
      .post-text {
        margin-top: 0.5rem;
        line-height: 1.5;
        color: #4a5568;
        white-space: pre-wrap;
      }
      .post-timestamp {
        font-size: 0.8rem;
        color: #a0aec0;
        text-align: right;
      }
      .error-message {
        color: #ef4444;
        font-weight: bold;
        text-align: center;
      }
      a {
        color: #3b82f6;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      .profile-details {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .profile-avatar {
        width: 100px;
        height: 100px;
        border-radius: 50%;
        margin-bottom: 1rem;
      }
      .search-result {
        border-bottom: 1px solid #e2e8f0;
        padding: 1rem 0;
      }
      .search-result:last-child {
        border-bottom: none;
      }
    </style>
  </head>
  <body>
    ${bodyHtml}
  </body>
  </html>
  `;
}

// Login form page
app.get('/', (req, res) => {
  const loginHtml = `
    <div class="container">
      <h1>Bluesky Web Client</h1>
      <h2>Login</h2>
      <form action="/login" method="post">
        <input type="text" name="identifier" placeholder="Handle or Email" required>
        <input type="password" name="password" placeholder="App Password" required>
        <input type="text" name="service" placeholder="PDS Service URL (e.g., https://bsky.social)" value="https://bsky.social" required>
        <button type="submit">Login</button>
      </form>
    </div>
  `;
  res.send(createHtmlResponse('Login to Bluesky', loginHtml));
});

// Login and redirect to feed
app.post('/login', async (req, res) => {
  const { identifier, password, service } = req.body;
  const agent = new BskyAgent({ service });

  try {
    const loginResult = await agent.login({ identifier, password });
    // Try to resolve current user DID from the login result
    let resolvedDid = null;
    try {
      if (loginResult && loginResult.handle) {
        const meProfile = await agent.getProfile({ actor: loginResult.handle });
        resolvedDid = meProfile?.data?.did;
      }
    } catch (e) {
      // ignore resolution errors
    }
    // Attach DID to login result so downstream routes can read session.did
    if (typeof loginResult === 'object') {
      loginResult.did = resolvedDid;
    }

    // Store session and redirect
    const sessionId = Math.random().toString(36).substring(7);
    sessions[sessionId] = { agent, session: loginResult };
    res.redirect(`/feed?session=${sessionId}`);
  } catch (err) {
    console.error('Login error:', err);
    const errorHtml = `
      <div class="container">
        <h1>Login Failed</h1>
        <p class="error-message">Invalid credentials or PDS service URL. Please try again.</p>
        <a href="/">Go back to login</a>
      </div>
    `;
    res.status(401).send(createHtmlResponse('Login Failed', errorHtml));
  }
});

// User feed page
app.get('/feed', async (req, res) => {
  const sessionId = req.query.session;
  const sessionData = sessions[sessionId];

  if (!sessionData) {
    return res.redirect('/');
  }

  const { agent, session } = sessionData;

  try {
    // Get the main feed for the logged-in user
    const feedResponse = await agent.getTimeline();
    const feedPosts = Array.isArray(feedResponse?.data?.feed) ? feedResponse.data.feed : [];

    let feedHtml = `
      <div class="container">
        <h1>Bluesky Feed</h1>
        <h2>Welcome, <a href="/profile?session=${sessionId}">${session.handle}</a>!</h2>
        <nav style="display: flex; gap: 1rem; margin-bottom: 1rem;">
          <a href="/feed?session=${sessionId}">My Feed</a>
          <a href="/dm/inbox?session=${sessionId}">Chats</a>
          <a href="/search-users?session=${sessionId}">Find Users</a>
        </nav>
        <form action="/post" method="post" style="margin-bottom: 2rem;">
          <input type="hidden" name="session" value="${sessionId}">
          <textarea name="postText" placeholder="What's on your mind? Mention users with @handle." rows="4" required></textarea>
          <button type="submit">Post</button>
        </form>
        <div id="feed-container">
    `;

    // Render each post
    for (const item of feedPosts) {
      const post = item?.post ?? item;
      if (!post) continue;
      // Convert post text to display with mentions as links
      const formattedText = post?.record?.text ?? '';
      let textWithMentions = '';
      let authorLinkHtml = '';
      if (post?.author) {
        const authorHandle = post.author.handle;
        const authorDisplay = post.author.displayName || post.author.handle;
        authorLinkHtml = `<a href="/profile?session=${sessionId}&handle=${authorHandle}">${authorDisplay}</a>`;
      }
      if (formattedText) {
        const rt = new RichText({ text: formattedText });
        try {
          await rt.detectFacets(agent);
        } catch (e) {
          // Ignore facet resolution errors
        }
        const segmentsRaw = typeof rt.segments === 'function' ? rt.segments() : [];
        const segments = Array.isArray(segmentsRaw) ? segmentsRaw : Array.from(segmentsRaw || []);
        textWithMentions = segments.map(segment => {
          if (segment.isMention()) {
            const profileLink = `/profile?session=${sessionId}&handle=${segment.mention.did}`;
            return `<a href="${profileLink}" class="post-author">${segment.text}</a>`;
          }
          return segment.text;
        }).join('');
      }

      feedHtml += `
        <div class="feed-post">
          <p>${authorLinkHtml}</p>
          <p class="post-text">${textWithMentions}</p>
          <p class="post-timestamp">${new Date(post?.record?.createdAt).toLocaleString()}</p>
        </div>
      `;
    }

    feedHtml += `
        </div>
      </div>
    `;

    res.send(createHtmlResponse('Your Feed', feedHtml));
  } catch (err) {
    console.error('Feed error:', err);
    res.status(500).send(createHtmlResponse('Error', `<p class="error-message">Could not retrieve feed. Please <a href="/">log in again</a>.</p>`));
  }
});

// User profile page
app.get('/profile', async (req, res) => {
  const sessionId = req.query.session;
  const sessionData = sessions[sessionId];
  const identifier = req.query.handle; // Can be handle or DID

  if (!sessionData || !identifier) {
    return res.redirect('/');
  }

  const { agent } = sessionData;

  try {
    const profileResponse = await agent.getProfile({ actor: identifier });
    const profile = profileResponse.data;

    const profileHtml = `
      <div class="container profile-details">
        <img src="${profile.avatar || 'https://placehold.co/100x100/A0AEC0/ffffff?text=No+Avatar'}" alt="Profile Avatar" class="profile-avatar">
        <h3>${profile.displayName || profile.handle}</h3>
        <p>@${profile.handle}</p>
        <p>${profile.description || 'No description provided.'}</p>
        <p>Following: ${profile.followsCount} | Followers: ${profile.followersCount}</p>
        <a href="/feed?session=${sessionId}">Back to Feed</a>
      </div>
    `;

    res.send(createHtmlResponse('Profile', profileHtml));

  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).send(createHtmlResponse('Error', `<p class="error-message">Could not retrieve profile. Please <a href="/feed?session=${sessionId}">try again</a>.</p>`));
  }
});

// User search page
app.get('/search-users', async (req, res) => {
  const sessionId = req.query.session;
  const sessionData = sessions[sessionId];
  const q = req.query.q || '';

  if (!sessionData) {
    return res.redirect('/');
  }

  const { agent } = sessionData;

  let searchResultsHtml = '';
  if (q) {
    try {
      const searchResponse = await agent.searchActors({ q });
      const users = searchResponse.data.actors;
      if (users.length > 0) {
        for (const user of users) {
          searchResultsHtml += `
            <div class="search-result">
              <p><strong><a href="/profile?session=${sessionId}&handle=${user.handle}">${user.displayName || user.handle}</a></strong></p>
              <p>@${user.handle}</p>
              <p>${user.description || 'No description provided.'}</p>
            </div>
          `;
        }
      } else {
        searchResultsHtml = `<p>No users found for "${q}".</p>`;
      }
    } catch (err) {
      console.error('Search error:', err);
      searchResultsHtml = `<p class="error-message">Error searching for users. Please try again.</p>`;
    }
  }

  const searchHtml = `
    <div class="container">
      <h1>Find Users</h1>
      <nav style="display: flex; gap: 1rem; margin-bottom: 1rem;">
        <a href="/feed?session=${sessionId}">My Feed</a>
        <a href="/dm/inbox?session=${sessionId}">Find DMs</a>
        <a href="/search-users?session=${sessionId}">Find Users</a>
      </nav>
      <form action="/search-users" method="get">
        <input type="hidden" name="session" value="${sessionId}">
        <input type="text" name="q" placeholder="Search for users..." value="${q}" required>
        <button type="submit">Search</button>
      </form>
      <div id="search-results" style="margin-top: 2rem;">
        ${searchResultsHtml}
      </div>
    </div>
  `;

  res.send(createHtmlResponse('Find Users', searchHtml));
});

// Direct Messages (live data integration scaffold) and mock fallback
app.post('/post', async (req, res) => {
  const { session, postText } = req.body;
  const sessionData = sessions[session];

  if (!sessionData) {
    return res.redirect('/');
  }

  const { agent } = sessionData;

  try {
    // Create a RichText object to automatically detect mentions
    const rt = new RichText({ text: postText });
    await rt.detectFacets(agent); // This resolves handles to DIDs for tagging

    await agent.post({
      text: rt.text,
      facets: rt.facets,
    });
    res.redirect(`/feed?session=${session}`);
  } catch (err) {
    console.error('Post error:', err);
    res.status(500).send(createHtmlResponse('Error', `<p class="error-message">Could not create post. Please <a href="/feed?session=${session}">try again</a>.</p>`));
  }

  // Live Direct Messages (opt-in) - live Bluesky data integration scaffold
  // Note: Live DM calls are guarded by the DM_LIVE flag, and fall back to mock if not available.
});

// DM Inbox (live or mock)
app.get('/dm/inbox', async (req, res) => {
  const sessionId = req.query.session;
  const sessionData = sessions[sessionId];

  if (!sessionData) {
    return res.redirect('/');
  }

  // If live mode is enabled and agent exists, try to refresh from Bluesky
  if (DM_LIVE && sessionData.agent) {
    try {
      const liveConvos = await fetchLiveConversations(sessionData.agent);
      if (Array.isArray(liveConvos) && liveConvos.length > 0) {
        dmStore[sessionId] = { conversations: liveConvos, messages: dmStore[sessionId]?.messages || {} };
      }
    } catch (e) {
      // Fall back to mock if live fetch fails
    }
  }

  // Ensure a default structure exists for rendering
  ensureDmSessionFor(sessionId);
  const convoList = Array.isArray(dmStore[sessionId]?.conversations) ? dmStore[sessionId].conversations : [];
  const convoHtml = convoList.map(c =>
    '<div class="dm-item">' +
      '<a href="/dm/conversation?session=' + sessionId + '&dm_id=' + c.id + '">' +
        c.with +
      '</a> - ' + c.lastMessage +
      (c.unread > 0 ? ' (new)' : '') +
    '</div>'
  ).join('');

  const page = `
    <div class="container">
      <h1>Direct Messages</h1>
      <div id="dm-list">
${convoHtml}
      </div>
      <div style="margin-top:1rem;">
        <a href="/feed?session=${sessionId}">Back to Feed</a>
      </div>
    </div>
  `;

  res.send(createHtmlResponse('Direct Messages', page));
});

// DM conversation view (mock or live)
app.get('/dm/conversation', async (req, res) => {
  const sessionId = req.query.session;
  const dmId = req.query.dm_id;
  const sessionData = sessions[sessionId];

  if (!sessionData || !dmId) {
    return res.redirect('/');
  }

  // If live mode is enabled, attempt to fetch live messages for this convo
  if (DM_LIVE && sessionData.agent) {
    try {
      const liveMsgs = await fetchLiveMessages(sessionData.agent, dmId);
      if (Array.isArray(liveMsgs) && liveMsgs.length > 0) {
        dmStore[sessionId] = dmStore[sessionId] || { conversations: [], messages: {} };
        dmStore[sessionId].messages = dmStore[sessionId].messages || {};
        dmStore[sessionId].messages[dmId] = liveMsgs;
        // ensure the convo entry exists with lastMessage
        const conv = (dmStore[sessionId].conversations || []).find(c => c.id === dmId);
        if (conv) conv.lastMessage = liveMsgs[liveMsgs.length - 1]?.text || conv.lastMessage;
      }
    } catch (e) {
      // fall back to mock on error
    }
  }

  ensureDmSessionFor(sessionId);
  const messages = dmStore[sessionId].messages[dmId] || [];
  const other = dmStore[sessionId].conversations.find(c => c.id === dmId)?.with || 'unknown';

  const chatHtml = messages.map(m =>
    '<div class="dm-row" style="margin:0.5rem 0; text-align:' + (m.from === 'me' ? 'right' : 'left') + ';">' +
      '<span style="display:inline-block; padding:0.5rem 0.75rem; border-radius:6px; background:' +
      (m.from === 'me' ? '#d1fae5' : '#f1f5f9') +
      '; border:1px solid #e5e7eb;">' +
      (m.from === 'me' ? 'You' : other) + ': ' + m.text +
      '</span></div>'
  ).join('');

  const page = `
    <div class="container">
      <h1>DM with ${other}</h1>
      <div id="dm-messages" style="max-height:60vh; overflow:auto; border:1px solid #ddd; padding:1rem; margin-bottom:1rem;">
${chatHtml}
      </div>
      <form action="/dm/send" method="post" style="display:flex; gap:0.5rem;">
        <input type="hidden" name="session" value="${sessionId}">
        <input type="hidden" name="dm_id" value="${dmId}">
        <input style="flex:1" type="text" name="text" placeholder="Type a message..." required>
        <button type="submit">Send</button>
      </form>
      <div style="margin-top:1rem;">
        <a href="/dm/inbox?session=${sessionId}">Back to Inbox</a>
      </div>
    </div>
  `;
  // mark as read
  const conv = dmStore[sessionId].conversations.find(c => c.id === dmId);
  if (conv && conv.unread > 0) conv.unread = 0;

  res.send(createHtmlResponse(`DM with ${other}`, page));
});

// DM send (live or mock)
app.post('/dm/send', async (req, res) => {
  const { session, dm_id, text } = req.body;
  const sessionData = sessions[session];
  if (!sessionData || !dm_id || !text) return res.redirect('/');

  ensureDmSessionFor(session);
  // Try live send if enabled
  if (DM_LIVE && sessionData.agent) {
    try {
      const liveResult = await liveSendMessage(sessionData.agent, dm_id, text);
      if (liveResult) {
        dmStore[session] = dmStore[session] || { conversations: [], messages: {} };
        dmStore[session].messages = dmStore[session].messages || {};
        dmStore[session].messages[dm_id] = dmStore[session].messages[dm_id] || [];
        dmStore[session].messages[dm_id].push({ from: 'me', text, ts: new Date().toISOString() });
        const conv = (dmStore[session].conversations || []).find(c => c.id === dm_id);
        if (conv) conv.lastMessage = text;
        return res.redirect(`/dm/conversation?session=${session}&dm_id=${dm_id}`);
      }
    } catch (e) {
      // fall back to mock on error
    }
  }

  // Fallback to mock path
  if (!dmStore[session].messages[dm_id]) {
    dmStore[session].conversations.push({ id: dm_id, with: 'unknown', lastMessage: '' , unread: 0 });
    dmStore[session].messages[dm_id] = [];
  }
  dmStore[session].messages[dm_id].push({ from: 'me', text, ts: new Date().toISOString() });

  const conv = dmStore[session].conversations.find(c => c.id === dm_id);
  if (conv) conv.lastMessage = text;

  res.redirect(`/dm/conversation?session=${session}&dm_id=${dm_id}`);
});

app.listen(PORT, () => {
  console.log(`Bluesky web client listening on http://localhost:${PORT}`);
});

// Simple in-file helper to ensure a DM session structure exists
function ensureDmSessionFor(sessionId) {
  if (!dmStore[sessionId]) {
    if (typeof DM_LIVE !== 'undefined' && DM_LIVE) {
      dmStore[sessionId] = {
        conversations: [],
        messages: {}
      };
    } else {
      dmStore[sessionId] = {
        conversations: [
          { id: 'dm_alice', with: 'alice.bsky.social', lastMessage: 'Hey there!', unread: 1 },
          { id: 'dm_bob', with: 'bob.social', lastMessage: 'Are you coming?', unread: 0 }
        ],
        messages: {
          'dm_alice': [
            { from: 'alice.bsky.social', text: 'Hello!', ts: new Date().toISOString() }
          ],
          'dm_bob': [
            { from: 'bob.social', text: 'Ping', ts: new Date().toISOString() }
          ]
        }
      };
    }
  }
}
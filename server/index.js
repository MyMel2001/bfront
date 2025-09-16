const express = require('express');
const { BskyAgent, RichText } = require('@atproto/api');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const app = express();
const PORT = 2679;

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
});

const fileFilter = (req, file, cb) => {
  // Accept images only
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// A simple session store. In a real app, use a more robust solution like `express-session` with a database.
const sessions = {};


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
      .post-image {
        max-width: 100%;
        border-radius: 8px;
        margin-top: 0.5rem;
      }
      .reply-form {
        margin-top: 1rem;
        padding: 1rem;
        background-color: #f8f9fa;
        border-radius: 8px;
      }
      .reply-form input[type="file"] {
        margin: 0.5rem 0;
      }
      .reply-form label {
        font-size: 0.9rem;
        color: #4a5568;
        margin: 0.5rem 0 0.25rem 0;
        display: block;
      }
    </style>
  </head>
  <body>
    ${bodyHtml}
    <script src="/client.js"></script>
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
        <label>
          <input type="checkbox" name="remember" value="true"> Remember me
        </label>
        <button type="submit">Login</button>
      </form>
    </div>
  `;
  res.send(createHtmlResponse('Login to Bluesky', loginHtml));
});

// Login and redirect to feed
app.post('/login', async (req, res) => {
  try {
    const { identifier, password, service, remember } = req.body;
    const agent = new BskyAgent({ service });
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
    
    // Prepare credentials for localStorage
    const creds = {
      username: identifier,
      token: loginResult.accessJwt,
      refresh: loginResult.refreshJwt,
      did: resolvedDid,
      service: service
    };
    
    sessions[sessionId] = { agent, session: loginResult, creds };
    
    // If "remember me" is checked, pass parameter to feed page to save credentials to localStorage
    const redirectUrl = remember === 'true'
      ? `/feed?session=${sessionId}&saveCreds=true`
      : `/feed?session=${sessionId}`;
    
    res.redirect(redirectUrl);
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

  const { agent, session, creds } = sessionData;

  try {
    // Get the main feed for the logged-in user
    const feedResponse = await agent.getTimeline();
    const feedPosts = Array.isArray(feedResponse?.data?.feed) ? feedResponse.data.feed : [];

    // Check if we should save credentials to localStorage
    const saveToLocalStorage = req.query.saveCreds === 'true';
    const credsJson = creds ? JSON.stringify(creds) : 'null';
    
    let feedHtml = `
      <div class="container">
        <h1>Bluesky Feed</h1>
        <h2>Welcome!</h2>
        <nav style="display: flex; gap: 1rem; margin-bottom: 1rem;">
          <a href="/feed?session=${sessionId}">My Feed</a>
          <a href="/search-users?session=${sessionId}">Find Users</a>
          <a href="/logout?session=${sessionId}">Logout</a>
        </nav>
        <form action="/post" method="post" enctype="multipart/form-data" style="margin-bottom: 2rem;">
          <input type="hidden" name="session" value="${sessionId}">
          <textarea name="postText" placeholder="What's on your mind? Mention users with @handle." rows="4" required></textarea>
          <input type="file" name="image" accept="image/*">
          <button type="submit">Post</button>
        </form>
        <div id="feed-container">
    `;
    
    // Add script to save credentials to localStorage if requested
    if (saveToLocalStorage && creds) {
      feedHtml += `
        <script>
          if (typeof BskyStorage !== 'undefined') {
            BskyStorage.saveCreds(${credsJson});
          }
        </script>
      `;
    }

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

      // Check if post has images
      let imageHtml = '';
      if (post?.embed?.images) {
        for (const img of post.embed.images) {
          // Check if it's a GIF or other animated format
          const isGif = img.fullsize?.includes('.gif') || img.thumb?.includes('.gif');
          if (isGif) {
            imageHtml += `<img src="${img.fullsize}" alt="${img.alt}" class="post-image" style="max-height: 400px;">`;
          } else {
            imageHtml += `<img src="${img.fullsize}" alt="${img.alt}" class="post-image">`;
          }
        }
      } else if (post?.embed?.media?.images) {
        for (const img of post.embed.media.images) {
          // Check if it's a GIF or other animated format
          const isGif = img.fullsize?.includes('.gif') || img.thumb?.includes('.gif');
          if (isGif) {
            imageHtml += `<img src="${img.fullsize}" alt="${img.alt}" class="post-image" style="max-height: 400px;">`;
          } else {
            imageHtml += `<img src="${img.fullsize}" alt="${img.alt}" class="post-image">`;
          }
        }
      }
      
      // Check if post is a reply
      let replyHtml = '';
      if (post?.record?.reply) {
        // Try to get parent post information
        try {
          const parentUri = post.record.reply.parent.uri;
          // Extract handle from URI if possible
          const uriParts = parentUri.split('/');
          const handle = uriParts[uriParts.length - 1];
          // Check if it looks like a DID or a handle
          if (handle.startsWith('did:')) {
            // Try to resolve DID to handle with a timeout
            try {
              // Add a timeout to prevent hanging
              const profilePromise = await agent.getProfile({ actor: handle });
              const profile = await profileResponse.data;
              const resolvedHandle = profile.handle;
              replyHtml = `<p class="post-reply">Replying to: <a href="/profile?session=${sessionId}&handle=${resolvedHandle}">@${resolvedHandle}</a></p>`;
            } catch (profileErr) {
              // If we can't resolve the DID, show a shortened version
              const shortDid = handle.length > 15 ? handle.substring(0, 12) + '...' : handle;
              replyHtml = `<p class="post-reply">Replying to: ${shortDid}</p>`;
            }
          } else {
            replyHtml = `<p class="post-reply">Replying to: <a href="/profile?session=${sessionId}&handle=${handle}">@${handle}</a></p>`;
          }
        } catch (e) {
          replyHtml = `<p class="post-reply">Replying to a post</p>`;
        }
      }
      
      feedHtml += `
        <div class="feed-post">
          <p>${authorLinkHtml}</p>
          ${replyHtml}
          <p class="post-text">${textWithMentions}</p>
          ${imageHtml}
          <p class="post-timestamp">${new Date(post?.record?.createdAt).toLocaleString()}</p>
          <div class="reply-form">
            <form action="/reply" method="post" enctype="multipart/form-data">
              <input type="hidden" name="session" value="${sessionId}">
              <input type="hidden" name="parentUri" value="${post.uri}">
              <input type="hidden" name="parentCid" value="${post.cid}">
              <textarea name="replyText" placeholder="Write your reply..." rows="2"></textarea>
              <label for="reply-image-${post.cid}">Attach an image:</label>
              <input type="file" name="image" id="reply-image-${post.cid}" accept="image/*">
              <button type="submit">Reply</button>
            </form>
          </div>
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
app.post('/post', upload.single('image'), async (req, res) => {
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

    // Handle image upload if present
    let postParams = {
      text: rt.text,
      facets: rt.facets,
    };

    if (req.file) {
      // Read the image file
      const imageBuffer = fs.readFileSync(req.file.path);
      
      // Determine the correct MIME type
      let mimeType = req.file.mimetype;
      if (req.file.originalname.toLowerCase().endsWith('.gif')) {
        mimeType = 'image/gif';
      } else if (req.file.originalname.toLowerCase().endsWith('.png')) {
        mimeType = 'image/png';
      } else if (req.file.originalname.toLowerCase().endsWith('.jpg') || req.file.originalname.toLowerCase().endsWith('.jpeg')) {
        mimeType = 'image/jpeg';
      }
      
      // Upload the image to Bluesky
      const imageUpload = await agent.uploadBlob(imageBuffer, {
        encoding: mimeType
      });
      
      // Add the image to the post
      postParams.embed = {
        $type: 'app.bsky.embed.images',
        images: [{
          alt: req.file.originalname,
          image: imageUpload.data.blob,
          aspectRatio: {
            width: 1,
            height: 1
          }
        }]
      };
    }

    await agent.post(postParams);
    
    // Remove the temporary file
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    res.redirect(`/feed?session=${session}`);
  } catch (err) {
    console.error('Post error:', err);
    
    // Remove the temporary file if there was an error
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    // Handle multer errors specifically
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).send(createHtmlResponse('Error', `<p class="error-message">File too large. Maximum file size is 10MB. Please <a href="/feed?session=${session}">try again</a>.</p>`));
      }
    } else if (err.message === 'Only image files are allowed!') {
      return res.status(400).send(createHtmlResponse('Error', `<p class="error-message">Only image files are allowed! Please <a href="/feed?session=${session}">try again</a>.</p>`));
    }
    
    res.status(500).send(createHtmlResponse('Error', `<p class="error-message">Could not create post. Please <a href="/feed?session=${session}">try again</a>.</p>`));
  }

});

// Reply route
app.post('/reply', upload.single('image'), async (req, res) => {
  const { session, parentUri, parentCid, replyText } = req.body;
  const sessionData = sessions[session];

  if (!sessionData) {
    return res.redirect('/');
  }

  const { agent } = sessionData;

  try {
    // Create a RichText object to automatically detect mentions
    const rt = new RichText({ text: replyText });
    await rt.detectFacets(agent); // This resolves handles to DIDs for tagging

    // Handle image upload if present
    let postParams = {
      text: rt.text,
      facets: rt.facets,
      reply: {
        root: {
          uri: parentUri,
          cid: parentCid
        },
        parent: {
          uri: parentUri,
          cid: parentCid
        }
      }
    };

    if (req.file) {
      // Read the image file
      const imageBuffer = fs.readFileSync(req.file.path);
      
      // Determine the correct MIME type
      let mimeType = req.file.mimetype;
      if (req.file.originalname.toLowerCase().endsWith('.gif')) {
        mimeType = 'image/gif';
      } else if (req.file.originalname.toLowerCase().endsWith('.png')) {
        mimeType = 'image/png';
      } else if (req.file.originalname.toLowerCase().endsWith('.jpg') || req.file.originalname.toLowerCase().endsWith('.jpeg')) {
        mimeType = 'image/jpeg';
      }
      
      // Upload the image to Bluesky
      const imageUpload = await agent.uploadBlob(imageBuffer, {
        encoding: mimeType
      });
      
      // Add the image to the post
      postParams.embed = {
        $type: 'app.bsky.embed.images',
        images: [{
          alt: req.file.originalname,
          image: imageUpload.data.blob,
          aspectRatio: {
            width: 1,
            height: 1
          }
        }]
      };
    }

    await agent.post(postParams);
    
    // Remove the temporary file
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    res.redirect(`/feed?session=${session}`);
  } catch (err) {
    console.error('Reply error:', err);
    
    // Remove the temporary file if there was an error
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    // Handle multer errors specifically
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).send(createHtmlResponse('Error', `<p class="error-message">File too large. Maximum file size is 10MB. Please <a href="/feed?session=${session}">try again</a>.</p>`));
      }
    } else if (err.message === 'Only image files are allowed!') {
      return res.status(400).send(createHtmlResponse('Error', `<p class="error-message">Only image files are allowed! Please <a href="/feed?session=${session}">try again</a>.</p>`));
    }
    
    res.status(500).send(createHtmlResponse('Error', `<p class="error-message">Could not create reply. Please <a href="/feed?session=${session}">try again</a>.</p>`));
  }
});

// Logout route
app.get('/logout', (req, res) => {
  const sessionId = req.query.session;
  if (sessionId && sessions[sessionId]) {
    delete sessions[sessionId];
  }
  
  // Redirect to login page with a script to clear localStorage
  const logoutHtml = `
    <div class="container">
      <h1>Logged Out</h1>
      <p>You have been successfully logged out.</p>
      <a href="/">Login again</a>
    </div>
    <script>
      if (typeof BskyStorage !== 'undefined') {
        BskyStorage.clearCreds();
      }
    </script>
  `;
  
  res.send(createHtmlResponse('Logged Out', logoutHtml));
});




app.listen(PORT, () => {
  console.log(`Bluesky web client listening on http://localhost:${PORT}`);
});
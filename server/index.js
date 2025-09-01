const express = require('express');
const { BskyAgent, RichText } = require('@atproto/api');
const path = require('path');
const app = express();
const PORT = 2679;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// A simple session store. In a real app, use a more robust solution like `express-session` with a database.
const sessions = {};

// Helper function to create a simple HTML response
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
        max-width: 600px;
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
        white-space: pre-wrap; /* Preserve newlines */
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
    const session = await agent.login({ identifier, password });
    
    // Store session and redirect
    const sessionId = Math.random().toString(36).substring(7);
    sessions[sessionId] = { agent, session };
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
          <a href="/following?session=${sessionId}">Following Feed</a>
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

        let profileHtml = `
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
                <a href="/following?session=${sessionId}">Following Feed</a>
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

// New endpoint for the Following Feed
app.get('/following', async (req, res) => {
  const sessionId = req.query.session;
  const sessionData = sessions[sessionId];

  if (!sessionData) {
    return res.redirect('/');
  }

  const { agent, session } = sessionData;

  try {
    // Determine the current user's actor DID
    let actorDid = session.did;
    if (!actorDid && session.handle) {
      try {
        const meProfile = await agent.getProfile({ actor: session.handle });
        actorDid = meProfile?.data?.did;
      } catch (e) {
        // leave actorDid undefined to trigger error below
      }
    }
    if (!actorDid) {
      throw new Error('Unable to resolve current user actor DID for following feed');
    }
    // Fetch the list of users the current user is following
    const followsResponse = await agent.getFollows({ actor: actorDid });
    const follows = followsResponse.data.follows.map(follow => follow.did);

    // Fetch the "Firehose" and filter posts from followed users.
    // NOTE: This is a simplified approach for demonstration and is not scalable.
    // A real application would use a custom feed generator or a more efficient method.
    const firehoseResponse = await agent.getTimeline({ algorithm: 'reverse-chronological' });
    const firehosePosts = firehoseResponse.data.feed;

    // Filter posts from followed users
    const followingPosts = firehosePosts.filter(item => follows.includes(item.post.author.did));

    let feedHtml = `
      <div class="container">
        <h1>Following Feed</h1>
        <h2>Welcome, <a href="/profile?session=${sessionId}">${session.handle}</a>!</h2>
        <nav style="display: flex; gap: 1rem; margin-bottom: 1rem;">
          <a href="/feed?session=${sessionId}">My Feed</a>
          <a href="/following?session=${sessionId}">Following Feed</a>
          <a href="/search-users?session=${sessionId}">Find Users</a>
        </nav>
        <div id="feed-container">
    `;

    // Render each filtered post
    if (followingPosts.length > 0) {
        for (const item of followingPosts) {
            const post = item.post;
            const formattedText = post.record.text;
            const rt = new RichText({ text: formattedText });
            await rt.detectFacets(agent);
            const segmentsRaw = typeof rt.segments === 'function' ? rt.segments() : [];
            const segments = Array.isArray(segmentsRaw) ? segmentsRaw : Array.from(segmentsRaw || []);
            const textWithMentions = segments.map(segment => {
                if (segment.isMention()) {
                    const profileLink = `/profile?session=${sessionId}&handle=${segment.mention.did}`;
                    return `<a href="${profileLink}" class="post-author">${segment.text}</a>`;
                }
                return segment.text;
            }).join('');

            feedHtml += `
              <div class="feed-post">
                <p><a href="/profile?session=${sessionId}&handle=${post.author.handle}">${post.author.displayName || post.author.handle}</a></p>
                <p class="post-text">${textWithMentions}</p>
                <p class="post-timestamp">${new Date(post.record.createdAt).toLocaleString()}</p>
              </div>
            `;
        }
    } else {
        feedHtml += `<p>No posts from users you're following yet. Find some people to follow!</p>`;
    }

    feedHtml += `
        </div>
      </div>
    `;

    res.send(createHtmlResponse('Following Feed', feedHtml));

  } catch (err) {
    console.error('Following feed error:', err);
    res.status(500).send(createHtmlResponse('Error', `<p class="error-message">Could not retrieve following feed. Please <a href="/">log in again</a>.</p>`));
  }
});


// Handle new post creation with user tagging
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
});

app.listen(PORT, () => {
  console.log(`Bluesky web client listening on http://localhost:${PORT}`);
});
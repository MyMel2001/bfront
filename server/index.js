// Minimal Bluesky AT Protocol proxy and web client scaffold server

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Configuration
const BASE_URL = process.env.BLUESKY_BASE_URL || 'https://public.bsky.social';

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend from /public
app.use('/', express.static(path.join(__dirname, '../public')));

// Authentication: Bluesky login via web form (username, PDS/baseUrl, password)
app.post('/api/login', async (req, res) => {
  try {
    const { identifier, password, baseUrl } = req.body;
    const authBase = baseUrl || BASE_URL;
    const loginUrl = new URL('/xrpc/com.atproto.server.createSession', authBase);
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    };
    const r = await fetch(loginUrl.toString(), init);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({ error: 'login_failed', details: data });
    }
    const token = data?.accessJwt || data?.jwt || '';
    res.json({ token, handle: data?.handle ?? data?.did ?? '', did: data?.did ?? '', baseUrl: authBase });
  } catch (err) {
    res.status(500).json({ error: 'login_error', details: err?.toString?.() });
  }
});

// Simple API proxy: /api/* will be forwarded to Bluesky AT Protocol as /xrpc/*
app.use('/api/*', async (req, res) => {
  try {
    let endpoint = req.path;
    if (endpoint.startsWith('/api/')) endpoint = endpoint.substring('/api/'.length);
    const tokenHeader = (req.headers['authorization'] || '').toString();
    const tokenFromHeader = tokenHeader.startsWith('Bearer ') ? tokenHeader.substring(7) : tokenHeader;
    const cleanEndpoint = endpoint.startsWith('xrpc/') ? endpoint.slice(5) : endpoint;
    const target = new URL('/xrpc/' + cleanEndpoint, BASE_URL);

    // Build proxied request
    const headers = {
      'Content-Type': 'application/json',
    };
    // prefer header token if provided by client
    const t = tokenFromHeader || TOKEN;
    if (t) headers['Authorization'] = `Bearer ${t}`;

    const init = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(target.toString(), init);
    const text = await upstream.text();
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type') || 'application/json';
    res.set('Content-Type', contentType);
    res.send(text);
  } catch (err) {
    res.status(500).send({ error: 'Proxy error', details: err?.toString?.() });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', base: BASE_URL }));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Port setup (default 2679)
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 2679;
app.listen(PORT, () => {
  console.log(`BskyAlt server listening on port ${PORT}`);
});
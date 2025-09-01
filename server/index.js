// Minimal Bluesky AT Protocol proxy and web client scaffold server

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Configuration
const BASE_URL = process.env.BLUESKY_BASE_URL || 'https://public.bsky.social';
const TOKEN = process.env.BLUESKY_ACCESS_TOKEN || '';

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend from /public
app.use('/', express.static(path.join(__dirname, '../public')));

 // Simple API proxy: /api/* will be forwarded to Bluesky AT Protocol as /xrpc/*
 app.use('/api/*', async (req, res) => {
   try {
     let endpoint = req.path;
     if (endpoint.startsWith('/api/')) endpoint = endpoint.substring('/api/'.length);
     const cleanEndpoint = endpoint.startsWith('xrpc/') ? endpoint.slice(5) : endpoint;
     const target = new URL('/xrpc/' + cleanEndpoint, BASE_URL);

     // Build proxied request
     const headers = {
       'Content-Type': 'application/json',
     };
     if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

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
// Cloudflare Worker for Spotify Token Management with HttpOnly Sessions

const SESSION_COOKIE = 'spotify_session';
const SESSION_STORE = globalThis.__RHYTHM_SESSION_STORE__ || new Map();
const SESSION_TTL_SECONDS = 3600;
const TOKEN_REFRESH_GRACE_SECONDS = 300;

globalThis.__RHYTHM_SESSION_STORE__ = SESSION_STORE;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

function parseCookies(header) {
  if (!header) return {};
  return header.split(';').reduce((acc, cookie) => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      acc[name] = value;
    }
    return acc;
  }, {});
}

function generateBootstrap() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getCorsHeaders(origin) {
  const allowed = (ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
  if (allowed.length === 0 || allowed.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
  }

  return {
    'Access-Control-Allow-Origin': 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of SESSION_STORE.entries()) {
    if (!session || now >= session.expiresAt + (TOKEN_REFRESH_GRACE_SECONDS * 1000)) {
      SESSION_STORE.delete(id);
    }
  }
}

function getSession(request) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;

  const session = SESSION_STORE.get(sessionId);
  if (!session) return null;

  if (Date.now() >= session.expiresAt + (TOKEN_REFRESH_GRACE_SECONDS * 1000)) {
    SESSION_STORE.delete(sessionId);
    return null;
  }

  return { id: sessionId, data: session };
}

function persistSession(sessionId, session) {
  SESSION_STORE.set(sessionId, session);
}

async function exchangeAuthorizationCode(body, origin) {
  const code = body.get('code');
  const redirectUri = body.get('redirect_uri');
  const codeVerifier = body.get('code_verifier');

  if (!code || !redirectUri || !codeVerifier) {
    return jsonResponse({ error: 'invalid_request', error_description: 'Missing OAuth parameters' }, 400, origin);
  }

  const tokenBody = new URLSearchParams();
  tokenBody.append('client_id', SPOTIFY_CLIENT_ID);
  tokenBody.append('grant_type', 'authorization_code');
  tokenBody.append('code', code);
  tokenBody.append('redirect_uri', redirectUri);
  tokenBody.append('code_verifier', codeVerifier);

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (typeof SPOTIFY_CLIENT_SECRET === 'string' && SPOTIFY_CLIENT_SECRET.length > 0) {
    const credentials = btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`);
    headers['Authorization'] = `Basic ${credentials}`;
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers,
    body: tokenBody
  });

  const data = await response.json();
  if (!response.ok) {
    return jsonResponse({
      error: data.error || 'token_exchange_failed',
      error_description: data.error_description || 'Failed to exchange token'
    }, response.status, origin);
  }

  if (!data.access_token || !data.refresh_token || typeof data.expires_in !== 'number') {
    return jsonResponse({
      error: 'invalid_response',
      error_description: 'Spotify did not return the expected tokens'
    }, 502, origin);
  }

  const sessionId = crypto.randomUUID();
  const bootstrap = generateBootstrap();
  const expiresAt = Date.now() + (data.expires_in * 1000);

  persistSession(sessionId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    bootstrap
  });

  const cookie = `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
  const headersOut = {
    ...getCorsHeaders(origin),
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Set-Cookie': cookie
  };

  return new Response(JSON.stringify({ bootstrap }), {
    status: 200,
    headers: headersOut
  });
}

async function refreshSpotifyToken(session, origin) {
  if (!session.data.refreshToken) {
    throw new Error('No refresh token available.');
  }

  const tokenBody = new URLSearchParams();
  tokenBody.append('client_id', SPOTIFY_CLIENT_ID);
  tokenBody.append('grant_type', 'refresh_token');
  tokenBody.append('refresh_token', session.data.refreshToken);

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (typeof SPOTIFY_CLIENT_SECRET === 'string' && SPOTIFY_CLIENT_SECRET.length > 0) {
    const credentials = btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`);
    headers['Authorization'] = `Basic ${credentials}`;
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers,
    body: tokenBody
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Token refresh failed');
  }

  if (!data.access_token || typeof data.expires_in !== 'number') {
    throw new Error('Spotify refresh response was invalid');
  }

  const updatedSession = {
    ...session.data,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000)
  };

  if (data.refresh_token) {
    updatedSession.refreshToken = data.refresh_token;
  }

  persistSession(session.id, updatedSession);
  return updatedSession;
}

async function provideAccessToken(request, origin) {
  const session = getSession(request);
  if (!session) {
    return jsonResponse({ error: 'unauthorized' }, 401, origin);
  }

  const url = new URL(request.url);
  const bootstrap = url.searchParams.get('bootstrap');
  if (!bootstrap || bootstrap !== session.data.bootstrap) {
    return jsonResponse({ error: 'forbidden' }, 403, origin);
  }

  let activeSession = session.data;
  const needsRefresh = Date.now() >= (activeSession.expiresAt - (TOKEN_REFRESH_GRACE_SECONDS * 1000));

  if (needsRefresh) {
    try {
      activeSession = await refreshSpotifyToken(session, origin);
    } catch (error) {
      SESSION_STORE.delete(session.id);
      return jsonResponse({ error: 'unauthorized', error_description: error.message }, 401, origin);
    }
  }

  const expiresIn = Math.max(0, Math.floor((activeSession.expiresAt - Date.now()) / 1000));

  return new Response(JSON.stringify({
    access_token: activeSession.accessToken,
    expires_in: expiresIn
  }), {
    status: 200,
    headers: {
      ...getCorsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

async function validateSession(request, origin) {
  const session = getSession(request);
  if (!session) {
    return jsonResponse({ valid: false }, 401, origin);
  }

  const body = await request.json().catch(() => ({}));
  if (!body.bootstrap || body.bootstrap !== session.data.bootstrap) {
    return jsonResponse({ valid: false }, 403, origin);
  }

  return new Response(JSON.stringify({ valid: true }), {
    status: 200,
    headers: {
      ...getCorsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

async function logoutSession(request, origin) {
  const session = getSession(request);
  if (session) {
    SESSION_STORE.delete(session.id);
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...getCorsHeaders(origin),
      'Set-Cookie': `${SESSION_COOKIE}=deleted; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
    }
  });
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

async function handleRequest(request) {
  cleanupSessions();

  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(origin) });
  }

  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname.endsWith('/api/token')) {
    const body = await request.formData();
    const grantType = body.get('grant_type');
    if (grantType !== 'authorization_code') {
      return jsonResponse({ error: 'unsupported_grant_type' }, 400, origin);
    }

    return exchangeAuthorizationCode(body, origin);
  }

  if (request.method === 'GET' && url.pathname.endsWith('/api/token/access')) {
    return provideAccessToken(request, origin);
  }

  if (request.method === 'POST' && url.pathname.endsWith('/api/session/validate')) {
    return validateSession(request, origin);
  }

  if (request.method === 'POST' && url.pathname.endsWith('/api/session/logout')) {
    return logoutSession(request, origin);
  }

  return jsonResponse({ error: 'not_found' }, 404, origin);
}

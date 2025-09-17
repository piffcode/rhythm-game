// Cloudflare Worker for Spotify Token Exchange (Optional)
// Only needed if you want to hide client credentials or add server-side validation

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // Restrict to your domain in production
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only handle POST requests to /api/token
  if (request.method !== 'POST' || !request.url.endsWith('/api/token')) {
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }

  try {
    const body = await request.formData();
    const grantType = body.get('grant_type');
    
    // Environment variables to set in Cloudflare Worker:
    // SPOTIFY_CLIENT_ID - Your Spotify app client ID
    // SPOTIFY_CLIENT_SECRET - Your Spotify app client secret (if using confidential client)
    // ALLOWED_ORIGINS - Comma-separated list of allowed origins
    
    const clientId = SPOTIFY_CLIENT_ID;
    const clientSecret = SPOTIFY_CLIENT_SECRET || null; // Optional for PKCE
    const allowedOrigins = (ALLOWED_ORIGINS || '').split(',');
    
    // Validate origin if configured
    const origin = request.headers.get('Origin');
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders });
    }

    // Build Spotify token request
    const tokenRequestBody = new URLSearchParams();
    tokenRequestBody.append('client_id', clientId);
    tokenRequestBody.append('grant_type', grantType);

    // Handle different grant types
    if (grantType === 'authorization_code') {
      // PKCE authorization code exchange
      tokenRequestBody.append('code', body.get('code'));
      tokenRequestBody.append('redirect_uri', body.get('redirect_uri'));
      tokenRequestBody.append('code_verifier', body.get('code_verifier'));
      
    } else if (grantType === 'refresh_token') {
      // Token refresh
      tokenRequestBody.append('refresh_token', body.get('refresh_token'));
      
    } else {
      return new Response('Unsupported grant type', { status: 400, headers: corsHeaders });
    }

    // Prepare headers for Spotify request
    const spotifyHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    // Add client secret if using confidential client flow
    if (clientSecret) {
      const credentials = btoa(`${clientId}:${clientSecret}`);
      spotifyHeaders['Authorization'] = `Basic ${credentials}`;
    }

    // Make request to Spotify
    const spotifyResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: spotifyHeaders,
      body: tokenRequestBody,
    });

    // Forward Spotify response
    const spotifyData = await spotifyResponse.json();
    
    if (!spotifyResponse.ok) {
      return new Response(JSON.stringify({
        error: spotifyData.error || 'token_exchange_failed',
        error_description: spotifyData.error_description || 'Failed to exchange token'
      }), {
        status: spotifyResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    // Optional: Add logging/telemetry here
    console.log(`Token ${grantType} successful for origin: ${origin}`);

    // Return successful token response
    return new Response(JSON.stringify(spotifyData), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });

  } catch (error) {
    console.error('Token exchange error:', error);
    
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Internal server error during token exchange'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }
}

/* 
DEPLOYMENT INSTRUCTIONS:

1. Create new Cloudflare Worker
2. Copy this code to worker script
3. Set environment variables:
   - SPOTIFY_CLIENT_ID: Your app's client ID
   - SPOTIFY_CLIENT_SECRET: Only if using confidential client (optional for PKCE)
   - ALLOWED_ORIGINS: e.g., "https://yoursite.com,http://localhost:8000"

4. Deploy worker to custom route: https://your-worker.your-domain.workers.dev

5. Update your frontend to use worker endpoint:
   
   // In auth.html, replace direct token call:
   const response = await fetch('https://your-worker.your-domain.workers.dev/api/token', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/x-www-form-urlencoded',
     },
     body: new URLSearchParams({
       client_id: CONFIG.CLIENT_ID,
       grant_type: 'authorization_code',
       code: code,
       redirect_uri: CONFIG.AUTH_REDIRECT_URI,
       code_verifier: codeVerifier
     })
   });

WHEN TO USE WORKER:
- If you want to hide client credentials (confidential client flow)
- If you need server-side token validation/logging
- If you want to add rate limiting or additional security

WHEN NOT NEEDED:
- PKCE public client flow works fine without worker
- Direct browser-to-Spotify calls are officially supported
- Adds complexity and latency for minimal security benefit in PKCE flow
*/
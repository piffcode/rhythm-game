// Environment Configuration for Spotify Rhythm Game
// Enhanced version with HTTPS enforcement and better environment detection

const CONFIG = (() => {
  const currentOrigin = window.location.origin;
  const protocol = window.location.protocol;
  const isFileProtocol = protocol === 'file:';
  const isLocalHost = currentOrigin.includes('localhost') ||
                      currentOrigin.includes('127.0.0.1') ||
                      currentOrigin.includes('192.168.') ||
                      isFileProtocol;

  // Production host - your primary deployment domain
  const PROD_HOST = 'https://rhythm-game-phi.vercel.app';

  const hasValidOrigin = currentOrigin && currentOrigin !== 'null';
  const normalizedOrigin = hasValidOrigin ? currentOrigin.replace(/\/$/, '') : null;

  const config = {
    IS_LOCAL: isLocalHost,
    HOST: isLocalHost
      ? (normalizedOrigin || 'http://localhost')
      : (normalizedOrigin || PROD_HOST),
    
    // Spotify App Credentials
    CLIENT_ID: '07f4566e6a2a4428ac68ec86d73adf34',
    
    // Scopes required for the game
    SCOPES: [
      'user-read-private',
      'user-read-email', 
      'user-read-playback-state',
      'user-modify-playback-state',
      'streaming',
      'playlist-modify-private',
      'user-library-modify'
    ],
    
    // Telemetry (optional)
    TELEMETRY_URL: null, // Set to your analytics endpoint if needed
    
    // Game settings
    GAME_SETTINGS: {
      PLAYLIST_SIZE: 3,
      COMPLETION_THRESHOLD: 0.7, // 70% of tracks
      DEVICE_POLL_INTERVAL: 3000, // 3 seconds
      DEVICE_POLL_TIMEOUT: 120000, // 2 minutes
      TOKEN_REFRESH_BUFFER: 300 // 5 minutes before expiry
    }
  };
  
  // Derive URLs
  config.AUTH_REDIRECT_URI = `${config.HOST.replace(/\/$/, '')}/auth.html`;
  config.GAME_URL = `${config.HOST}/rhythm.html`;
  config.INDEX_URL = `${config.HOST}/index.html`;

  // HTTPS enforcement for production
  if (!config.IS_LOCAL && location.protocol !== 'https:' && hasValidOrigin) {
    location.replace(`https:${location.href.substring(location.protocol.length)}`);
  }

  // Surface helpful diagnostic information for unexpected hosts
  if (!config.IS_LOCAL && config.HOST !== PROD_HOST) {
    console.warn('[CONFIG] Using non-standard production host', {
      currentOrigin: config.HOST,
      expectedHost: PROD_HOST,
      message: 'Ensure this origin is added to the Spotify app redirect URI allowlist.'
    });
  }

  return config;
})();

// Export for ES modules or make globally available
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
} else {
  window.CONFIG = CONFIG;
}
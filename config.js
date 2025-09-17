// Environment Configuration for Spotify Rhythm Game
// Updated for Vercel deployment

const CONFIG = (() => {
  const currentHost = window.location.origin;
  const isLocal = currentHost.includes('localhost') || currentHost.includes('127.0.0.1');
  
  // Production host - your actual Vercel domain
  const PROD_HOST = 'https://rhythm-game-phi.vercel.app';
  
  const config = {
    IS_LOCAL: isLocal,
    HOST: isLocal ? currentHost : PROD_HOST,
    
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
  config.AUTH_REDIRECT_URI = `${config.HOST}/auth.html`;
  config.GAME_URL = `${config.HOST}/rhythm.html`;
  config.INDEX_URL = `${config.HOST}/index.html`;
  
  return config;
})();

// Export for ES modules or make globally available
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
} else {
  window.CONFIG = CONFIG;
}
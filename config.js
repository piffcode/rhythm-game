// Environment Configuration for Spotify Rhythm Game
// Change YOUR_HOST_HERE to your actual production domain

const CONFIG = (() => {
  const currentHost = window.location.origin;
  const isLocal = currentHost.includes('localhost') || currentHost.includes('127.0.0.1');
  
  // Replace YOUR_HOST_HERE with your actual domain (e.g., 'https://myrhythmgame.com')
  const PROD_HOST = 'https://YOUR_HOST_HERE';
  
  const config = {
    IS_LOCAL: isLocal,
    HOST: isLocal ? currentHost : PROD_HOST,
    
    // Spotify App Credentials
    CLIENT_ID: 'your_spotify_client_id_here', // Replace with your actual Client ID
    
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
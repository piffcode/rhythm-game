// config.js - Single source of truth for all configuration

// Helper function to determine the correct redirect URI
function getRedirectUri() {
    // For production, use the known Vercel URL
    if (window.location.hostname === 'rhythm-game-phi.vercel.app') {
        return 'https://rhythm-game-phi.vercel.app/auth.html';
    }
    
    // For local development, construct dynamically
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/');
    return baseUrl + 'auth.html';
}

export const config = {
    // Spotify App Configuration
    CLIENT_ID: '07f4566e6a2a4428ac68ec86d73adf34',
    REDIRECT_URI: getRedirectUri(),
    
    // Alternative: hardcode your redirect URI for production
    // REDIRECT_URI: 'https://yourdomain.com/auth.html',
    
    // Feature Flags
    USE_WORKER: false,
    DEMO_MODE: false,
    
    // Locked tracks for consistent gameplay
    LOCKED_TRACK_IDS: [
        '5FMyXeZ0reYloRTiCkPprT',  // Track 1 - Fixed
        '0YWmeJtd7Fp1tH3978qUIH'   // Track 2 - Fixed
    ],
    
    // Pool of tracks for random third selection
    THIRD_TRACK_POOL: [
        '4iV5W9uYEdYUVa79Axb7Rh',  // Option 1
        '1301WleyT98MSxVHPZCA6M',  // Option 2
        '7qiZfU4dY1lWllzX7mPBI3',  // Option 3
        '2plbrEY59IikOBgBGLjaoe'   // Option 4
    ],
    
    // Required Spotify scopes (exact string as specified)
    SCOPES: 'user-read-private user-read-email user-read-playback-state user-modify-playback-state streaming playlist-modify-private playlist-modify-public user-library-modify',
    
    // Natural Listening Behavior Configuration
    NATURAL_LISTENING: {
        SKIP_THRESHOLD_MIN: 35,     // Minimum % of track to play before skip
        SKIP_THRESHOLD_MAX: 85,     // Maximum % of track to play before skip
        SAVE_PROMPT_TRACK: 2,       // Which track number to show save prompt on (1-based)
        SAVE_PROMPT_PROBABILITY: 0.7, // 70% chance to show save prompt
        SAVE_PROMPT_DELAY_MIN: 2000,  // Min delay after track starts (ms)
        SAVE_PROMPT_DELAY_MAX: 8000   // Max delay after track starts (ms)
    },
    
    // Gameplay Constants
    DIFFICULTY_SETTINGS: {
        EASY: {
            lanes: 4,
            approachTime: 1700,
            baseSpeed: 0.8
        },
        NORMAL: {
            lanes: 4,
            approachTime: 1500,
            baseSpeed: 1.0
        },
        HARD: {
            lanes: 5,
            approachTime: 1300,
            baseSpeed: 1.2
        }
    },
    
    // Timing Windows (in milliseconds)
    TIMING_WINDOWS: {
        PERFECT: 45,    // ±45ms
        GREAT: 90,      // ±90ms
        GOOD: 135       // ±135ms
        // Anything outside GOOD range is a MISS
    },
    
    // Score Values
    SCORING: {
        PERFECT: 300,
        GREAT: 200,
        GOOD: 100,
        MISS: 0,
        COMBO_MULTIPLIER_MAX: 4,
        COMBO_THRESHOLD: 10
    },
    
    // Health System
    HEALTH: {
        STARTING: 100,
        PERFECT_GAIN: 2,
        GREAT_GAIN: 1,
        GOOD_NEUTRAL: 0,
        MISS_LOSS: 5,
        MIN_HEALTH: 0,
        MAX_HEALTH: 100
    },
    
    // Pass Requirements
    PASS_THRESHOLD: {
        MIN: 85,    // Minimum 85% completion required
        MAX: 100    // Random range: 85-100%
    },
    
    // Performance Settings
    PERFORMANCE: {
        TARGET_FPS: 60,
        MAX_NOTES_ON_SCREEN: 50,
        POSITION_SMOOTHING: 0.1,
        SEEK_THRESHOLD: 800 // ms - when to force seek if position drifts
    },
    
    // Device Detection
    DEVICE_POLLING: {
        INTERVAL: 3000,     // 3 seconds
        MAX_ATTEMPTS: 40,   // 120 seconds total
        RETRY_DELAY: 1000
    },
    
    // Token Management
    TOKEN: {
        REFRESH_BUFFER: 300000, // 5 minutes before expiry
        RETRY_ATTEMPTS: 3,
        RETRY_DELAY: 1000
    },
    
    // Chart Generation
    CHART: {
        MIN_NOTE_SPACING: 100,      // Minimum ms between notes
        HOLD_MIN_DURATION: 1200,    // Minimum duration for hold notes
        DENSITY_MULTIPLIERS: {
            EASY: 0.6,
            NORMAL: 0.8,
            HARD: 1.0
        },
        ENERGY_THRESHOLD: 0.6,      // Above this, increase note density
        LOUDNESS_THRESHOLD: -10     // dB, above this, increase note density
    },
    
    // Mobile Optimization
    MOBILE: {
        FULLSCREEN_ON_START: true,
        LOCK_ORIENTATION: 'portrait',
        WAKE_LOCK: true,
        PREVENT_SCROLL: true,
        TOUCH_BUFFER: 20 // px buffer around touch targets
    },
    
    // Visual Settings
    VISUALS: {
        LANE_COLORS: [
            '#ff0080',  // Pink
            '#0080ff',  // Blue  
            '#80ff00',  // Green
            '#ff8000',  // Orange
            '#8000ff'   // Purple (5th lane for Hard mode)
        ],
        NOTE_COLORS: {
            NORMAL: '#ffffff',
            HOLD: '#ffff00',
            APPROACHING: '#cccccc'
        },
        HIT_EFFECTS: {
            PERFECT: '#00ff00',
            GREAT: '#ffff00',
            GOOD: '#ff8000',
            MISS: '#ff0000'
        },
        HIGHWAY_LENGTH: 0.8, // Percentage of screen height
        RECEPTOR_SIZE: 60,    // px
        NOTE_SIZE: 50        // px
    },
    
    // Audio Settings
    AUDIO: {
        LATENCY_CALIBRATION_RANGE: 200, // ±200ms calibration range
        DEFAULT_CALIBRATION: 0,
        VOLUME_FADE_TIME: 500, // ms for fade in/out
        POSITION_UPDATE_RATE: 50 // ms between position updates
    },
    
    // Playlist Generation - Natural Spotify playlist names
    PLAYLIST: {
        REALISTIC_NAMES: [
            'my mix',
            'current rotation',
            'on repeat',
            'lately',
            'vibes',
            'summer nights',
            'drive music',
            'good stuff',
            'favorites',
            'new finds',
            'mood',
            'chill mix',
            'bangers',
            'late night',
            'feel good',
            'weekend',
            'daily driver',
            'fresh',
            'liked songs pt. 2',
            'study vibes',
            'workout',
            'road trip',
            'throwbacks',
            'hits different',
            'no skips',
            'that playlist',
            'main character energy',
            'gym',
            'car songs',
            'rain day',
            'golden hour',
            'untitled',
            '✨ vibes ✨',
            'idc what anyone says',
            'songs i fw',
            'this month',
            'lowkey fire',
            'comfort songs',
            'winter feels'
        ]
    },
    
    // Artist Configuration for 3rd Track
    FEATURED_ARTISTS: {
        DRAKE: {
            name: 'Drake',
            id: '3TVXtAsR1Inumwj472S9r4'
        },
        CENTRAL_CEE: {
            name: 'Central Cee',  
            id: '3YQKmKGau6dqQvXkqWaUOc'
        }
    },
    
    // Error Messages
    ERRORS: {
        NO_PREMIUM: 'Spotify Premium required to play.',
        NO_DEVICE: 'No active device found. Open Spotify, start any song, return here, then press Start.',
        CONTROLS_LOCKED: 'Playback controls are locked during a session.',
        AUTH_FAILED: 'Authentication failed. Please try again.',
        SESSION_EXPIRED: 'Session expired. Please log in again.',
        NETWORK_ERROR: 'Network error. Please check your connection.',
        PLAYBACK_ERROR: 'Playback error. Please try again.',
        INVALID_SESSION: 'Invalid session. Please start over.'
    },
    
    // Debug Settings (only for development)
    DEBUG: {
        ENABLED: false,
        LOG_TIMING: false,
        LOG_INPUT: false,
        LOG_CHART: false,
        SHOW_FPS: false,
        SHOW_HITBOXES: false
    }
};

// Helper function to get final track list with random third track
export function getFinalTrackList() {
    const fixedTracks = [...config.LOCKED_TRACK_IDS];
    const randomThirdTrack = config.THIRD_TRACK_POOL[Math.floor(Math.random() * config.THIRD_TRACK_POOL.length)];
    
    console.log(`Selected random third track: ${randomThirdTrack}`);
    return [...fixedTracks, randomThirdTrack];
}

// Validation function to check if required config is set
export function validateConfig() {
    const errors = [];
    
    if (!config.CLIENT_ID || config.CLIENT_ID === '07f4566e6a2a4428ac68ec86d73adf34') {
        errors.push('CLIENT_ID must be set to your Spotify application client ID');
    }
    
    if (config.LOCKED_TRACK_IDS.length !== 2) {
        errors.push('LOCKED_TRACK_IDS must contain exactly 2 track IDs');
    }
    
    if (config.THIRD_TRACK_POOL.length !== 4) {
        errors.push('THIRD_TRACK_POOL must contain exactly 4 track IDs');
    }
    
    if (!config.REDIRECT_URI) {
        errors.push('REDIRECT_URI must be configured');
    }
    
    return errors;
}

// Helper function to get difficulty settings
export function getDifficultySettings(difficulty = 'NORMAL') {
    return config.DIFFICULTY_SETTINGS[difficulty] || config.DIFFICULTY_SETTINGS.NORMAL;
}

// Helper function to calculate score with combo
export function calculateScore(hitType, combo) {
    const baseScore = config.SCORING[hitType] || 0;
    const comboMultiplier = Math.min(
        1 + Math.floor(combo / config.SCORING.COMBO_THRESHOLD) * 0.1,
        config.SCORING.COMBO_MULTIPLIER_MAX
    );
    return Math.floor(baseScore * comboMultiplier);
}

// Helper function to generate natural playlist names
export function generatePlaylistNames() {
    const names = config.PLAYLIST.REALISTIC_NAMES;
    
    // Just pick a random name from the realistic options
    const selectedName = names[Math.floor(Math.random() * names.length)];
    
    return {
        public: selectedName,
        private: selectedName, // Same name for both
        description: '' // No description
    };
}

// Helper function to find Drake/Central Cee track matching audio features
export async function findMatchingArtistTrack(client, referenceFeatures, country) {
    const artists = [config.FEATURED_ARTISTS.DRAKE, config.FEATURED_ARTISTS.CENTRAL_CEE];
    const selectedArtist = artists[Math.floor(Math.random() * artists.length)];
    
    try {
        // Get artist's top tracks first
        const topTracks = await client.request(`/v1/artists/${selectedArtist.id}/top-tracks?market=${country}`);
        
        if (!topTracks.tracks || topTracks.tracks.length === 0) {
            throw new Error('No tracks found for artist');
        }
        
        // Get a few random tracks from their catalog via search
        const searchQuery = `artist:${selectedArtist.name}`;
        const searchResults = await client.request(`/v1/search?q=${encodeURIComponent(searchQuery)}&type=track&market=${country}&limit=50`);
        
        // Combine top tracks and search results
        const allTracks = [...topTracks.tracks];
        if (searchResults.tracks && searchResults.tracks.items) {
            allTracks.push(...searchResults.tracks.items);
        }
        
        // Remove duplicates
        const uniqueTracks = allTracks.filter((track, index, self) => 
            index === self.findIndex(t => t.id === track.id)
        );
        
        if (uniqueTracks.length === 0) {
            throw new Error('No unique tracks found');
        }
        
        // Get audio features for a random selection of tracks (max 10 to avoid rate limits)
        const tracksToAnalyze = uniqueTracks
            .sort(() => 0.5 - Math.random())
            .slice(0, Math.min(10, uniqueTracks.length));
        
        const trackIds = tracksToAnalyze.map(t => t.id).join(',');
        const features = await client.request(`/v1/audio-features?ids=${trackIds}`);
        
        if (!features.audio_features) {
            throw new Error('No audio features returned');
        }
        
        // Find the best match based on audio features
        let bestMatch = null;
        let bestScore = Infinity;
        
        features.audio_features.forEach((trackFeatures, index) => {
            if (!trackFeatures) return;
            
            // Calculate similarity score (lower is better)
            const energyDiff = Math.abs(trackFeatures.energy - referenceFeatures.energy);
            const danceabilityDiff = Math.abs(trackFeatures.danceability - referenceFeatures.danceability);
            const valenceDiff = Math.abs(trackFeatures.valence - referenceFeatures.valence);
            const tempoDiff = Math.abs(trackFeatures.tempo - referenceFeatures.tempo) / 200; // normalize tempo
            
            const totalScore = energyDiff + danceabilityDiff + valenceDiff + tempoDiff;
            
            if (totalScore < bestScore) {
                bestScore = totalScore;
                bestMatch = tracksToAnalyze[index];
            }
        });
        
        if (bestMatch) {
            console.log(`Selected ${selectedArtist.name} track: ${bestMatch.name} (similarity score: ${bestScore.toFixed(3)})`);
            return bestMatch.id;
        }
        
        // Fallback: return a random track from the artist
        const randomTrack = uniqueTracks[Math.floor(Math.random() * uniqueTracks.length)];
        console.log(`Fallback: Selected random ${selectedArtist.name} track: ${randomTrack.name}`);
        return randomTrack.id;
        
    } catch (error) {
        console.warn(`Failed to find ${selectedArtist.name} track:`, error);
        
        // Ultimate fallback: try the other artist
        const otherArtist = artists.find(a => a.id !== selectedArtist.id);
        try {
            const fallbackTracks = await client.request(`/v1/artists/${otherArtist.id}/top-tracks?market=${country}`);
            if (fallbackTracks.tracks && fallbackTracks.tracks.length > 0) {
                const randomTrack = fallbackTracks.tracks[Math.floor(Math.random() * fallbackTracks.tracks.length)];
                console.log(`Fallback: Selected ${otherArtist.name} track: ${randomTrack.name}`);
                return randomTrack.id;
            }
        } catch (fallbackError) {
            console.warn(`Fallback also failed:`, fallbackError);
        }
        
        // Return null if everything fails
        return null;
    }
}

// Helper function to generate completion code
export function generateCompletionCode(userId, sessionNonce) {
    const today = new Date();
    const dateStr = today.getFullYear() + 
                   String(today.getMonth() + 1).padStart(2, '0') + 
                   String(today.getDate()).padStart(2, '0');
    
    // Simple hash function for demo purposes
    const hashInput = userId + sessionNonce + dateStr;
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
        const char = hashInput.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    
    const hashStr = Math.abs(hash).toString(36).toUpperCase().substring(0, 8);
    return `RHYTHM-${dateStr}-${hashStr}`;
}

// Export default for convenience
export default config;

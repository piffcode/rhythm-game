// Spotify Rhythm Game - Main Logic
class SpotifyRhythmGame {
    constructor() {
        this.player = null;
        this.deviceId = null;
        this.currentPlaylist = null;
        this.currentTrackIndex = 0;
        this.sessionProgress = 0;
        this.completedTracks = 0;
        this.isSessionActive = false;
        this.devicePollInterval = null;
        this.retryCount = 0;
        this.maxRetries = 1;
        
        this.init();
    }
    
    async init() {
        try {
            // Validate bootstrap nonce first
            if (!this.validateBootstrap()) {
                return;
            }
            
            // Load user profile
            await this.loadUserProfile();
            
            // Initialize Spotify Web Playback SDK
            await this.initializePlayer();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Start device detection
            this.startDeviceDetection();
            
        } catch (error) {
            console.error('Initialization error:', error);
            this.showMessage('Failed to initialize game. Please refresh and try again.', 'error');
        }
    }
    
    validateBootstrap() {
        const urlParams = new URLSearchParams(window.location.search);
        const bootstrapParam = urlParams.get('bootstrap');
        const storedNonce = sessionStorage.getItem('bootstrap_nonce');
        
        if (!bootstrapParam || !storedNonce || bootstrapParam !== storedNonce) {
            console.warn('Bootstrap validation failed');
            const country = urlParams.get('country');
            let authUrl = CONFIG.AUTH_REDIRECT_URI.replace('/auth.html', '/auth.html');
            if (country) {
                authUrl += `?country=${encodeURIComponent(country)}`;
            }
            window.location.href = authUrl;
            return false;
        }
        
        return true;
    }
    
    async getAccessToken() {
        const token = sessionStorage.getItem('access_token');
        const expiresAt = parseInt(sessionStorage.getItem('expires_at') || '0');
        const refreshToken = sessionStorage.getItem('refresh_token');
        
        // Check if token is expired (with 5 minute buffer)
        if (Date.now() >= (expiresAt - (CONFIG.GAME_SETTINGS.TOKEN_REFRESH_BUFFER * 1000))) {
            if (refreshToken) {
                try {
                    await this.refreshAccessToken();
                    return sessionStorage.getItem('access_token');
                } catch (error) {
                    console.error('Token refresh failed:', error);
                    this.redirectToAuth('Session expired. Please login again.');
                    return null;
                }
            } else {
                this.redirectToAuth('Session expired. Please login again.');
                return null;
            }
        }
        
        return token;
    }
    
    async refreshAccessToken() {
        const refreshToken = sessionStorage.getItem('refresh_token');
        if (!refreshToken) {
            throw new Error('No refresh token available');
        }
        
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: CONFIG.CLIENT_ID
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to refresh token');
        }
        
        const tokens = await response.json();
        const expiresAt = Date.now() + (tokens.expires_in * 1000);
        
        sessionStorage.setItem('access_token', tokens.access_token);
        sessionStorage.setItem('expires_at', expiresAt.toString());
        
        if (tokens.refresh_token) {
            sessionStorage.setItem('refresh_token', tokens.refresh_token);
        }
    }
    
    redirectToAuth(message = null) {
        if (message) {
            this.showMessage(message, 'error');
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        const country = urlParams.get('country');
        let authUrl = CONFIG.AUTH_REDIRECT_URI.replace('/auth.html', '/auth.html');
        if (country) {
            authUrl += `?country=${encodeURIComponent(country)}`;
        }
        
        setTimeout(() => {
            window.location.href = authUrl;
        }, 2000);
    }
    
    async makeSpotifyRequest(endpoint, options = {}) {
        const token = await this.getAccessToken();
        if (!token) return null;
        
        const url = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;
        
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            
            if (response.status === 401 && this.retryCount < this.maxRetries) {
                this.retryCount++;
                await this.refreshAccessToken();
                return this.makeSpotifyRequest(endpoint, options);
            }
            
            this.retryCount = 0;
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `HTTP ${response.status}`);
            }
            
            return response.status === 204 ? {} : await response.json();
            
        } catch (error) {
            console.error(`Spotify API error for ${endpoint}:`, error);
            
            if (error.message.includes('Premium')) {
                this.showMessage('Spotify Premium required for playback control.', 'error');
            } else if (error.message.includes('401')) {
                this.redirectToAuth('Authentication expired.');
            } else {
                this.showMessage(`API Error: ${error.message}`, 'error');
            }
            
            throw error;
        }
    }
    
    async loadUserProfile() {
        try {
            const profile = await this.makeSpotifyRequest('/me');
            if (profile) {
                const userInfo = document.getElementById('userInfo');
                userInfo.textContent = `Welcome, ${profile.display_name}!`;
                
                // Check if user has Premium
                if (profile.product !== 'premium') {
                    this.showMessage('Spotify Premium is required for playback control. Please upgrade your account.', 'warn');
                }
            }
        } catch (error) {
            console.error('Failed to load profile:', error);
            this.showMessage('Failed to load user profile.', 'error');
        }
    }
    
    async initializePlayer() {
        return new Promise((resolve) => {
            window.onSpotifyWebPlaybackSDKReady = () => {
                const token = sessionStorage.getItem('access_token');
                
                this.player = new Spotify.Player({
                    name: 'Spotify Rhythm Game',
                    getOAuthToken: cb => cb(token),
                    volume: 0.8
                });
                
                // Player event listeners
                this.player.addListener('ready', ({ device_id }) => {
                    console.log('Web Player ready with device ID:', device_id);
                    this.deviceId = device_id;
                    resolve();
                });
                
                this.player.addListener('not_ready', ({ device_id }) => {
                    console.log('Web Player not ready:', device_id);
                });
                
                this.player.addListener('player_state_changed', (state) => {
                    if (state && this.isSessionActive) {
                        this.handlePlayerStateChange(state);
                    }
                });
                
                this.player.connect();
            };
        });
    }
    
    setupEventListeners() {
        // Control buttons
        document.getElementById('startBtn').addEventListener('click', () => this.startSession());
        document.getElementById('saveBtn').addEventListener('click', () => this.saveCurrentTrack());
        document.getElementById('finishBtn').addEventListener('click', () => this.finishSession());
        document.getElementById('helpBtn').addEventListener('click', () => this.showHelp());
        document.getElementById('openSpotifyBtn').addEventListener('click', () => this.openSpotifyApp());
        
        // Modal controls
        const modal = document.getElementById('helpModal');
        const closeBtn = modal.querySelector('.close');
        closeBtn.addEventListener('click', () => this.hideHelp());
        
        window.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.hideHelp();
            }
        });
    }
    
    showMessage(text, type = 'error') {
        const messageBlock = document.getElementById('messageBlock');
        messageBlock.textContent = text;
        messageBlock.className = `message-block ${type}`;
        messageBlock.style.display = 'block';
        
        // Auto-hide success/warn messages
        if (type !== 'error') {
            setTimeout(() => {
                messageBlock.style.display = 'none';
            }, 5000);
        }
    }
    
    hideMessage() {
        const messageBlock = document.getElementById('messageBlock');
        messageBlock.style.display = 'none';
    }
    
    async startDeviceDetection() {
        const deviceActivation = document.getElementById('deviceActivation');
        const deviceStatus = document.getElementById('deviceStatus');
        
        deviceActivation.style.display = 'block';
        deviceStatus.style.display = 'block';
        deviceStatus.className = 'device-status searching';
        deviceStatus.textContent = 'Searching for active devices...';
        
        let pollCount = 0;
        const maxPolls = CONFIG.GAME_SETTINGS.DEVICE_POLL_TIMEOUT / CONFIG.GAME_SETTINGS.DEVICE_POLL_INTERVAL;
        
        this.devicePollInterval = setInterval(async () => {
            pollCount++;
            
            try {
                const devices = await this.makeSpotifyRequest('/me/player/devices');
                const activeDevice = devices?.devices?.find(d => d.is_active);
                
                if (activeDevice) {
                    clearInterval(this.devicePollInterval);
                    deviceStatus.className = 'device-status found';
                    deviceStatus.textContent = `✅ Found active device: ${activeDevice.name}`;
                    
                    setTimeout(() => {
                        deviceActivation.style.display = 'none';
                    }, 2000);
                    
                    this.enableStartButton();
                    return;
                }
                
                if (pollCount >= maxPolls) {
                    clearInterval(this.devicePollInterval);
                    deviceStatus.className = 'device-status timeout';
                    deviceStatus.innerHTML = '⚠️ No active device found.<br>Please open Spotify and play a song, then click "Open Spotify App" to try again.';
                }
                
            } catch (error) {
                console.error('Device detection error:', error);
            }
        }, CONFIG.GAME_SETTINGS.DEVICE_POLL_INTERVAL);
    }
    
    enableStartButton() {
        const startBtn = document.getElementById('startBtn');
        startBtn.disabled = false;
        startBtn.textContent = 'Start Rhythm Session';
        this.showMessage('Device ready! Click "Start Rhythm Session" to begin.', 'success');
    }
    
    openSpotifyApp() {
        const userAgent = navigator.userAgent.toLowerCase();
        const isMobile = /android|iphone|ipad|ipod/.test(userAgent);
        
        if (isMobile) {
            // Try mobile app deep link
            window.location.href = 'spotify://';
            
            // Fallback to web player after delay
            setTimeout(() => {
                window.open('https://open.spotify.com/', '_blank');
            }, 1500);
        } else {
            // Desktop: try app protocol first, fallback to web
            const spotifyUrl = 'spotify:';
            const webUrl = 'https://open.spotify.com/';
            
            // Create hidden iframe to try app protocol
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = spotifyUrl;
            document.body.appendChild(iframe);
            
            // Fallback to web player
            setTimeout(() => {
                window.open(webUrl, '_blank');
                document.body.removeChild(iframe);
            }, 1000);
        }
        
        // Restart device detection
        setTimeout(() => {
            this.startDeviceDetection();
        }, 3000);
    }
    
    async startSession() {
        try {
            this.showMessage('Starting rhythm session...', 'success');
            
            // Create playlist
            await this.createGamePlaylist();
            
            // Transfer playback to active device
            await this.transferPlayback();
            
            // Start playback
            await this.startPlayback();
            
            this.isSessionActive = true;
            this.updateUI();
            
        } catch (error) {
            console.error('Session start error:', error);
            this.showMessage('Failed to start session. Please try again.', 'error');
        }
    }
    
    async createGamePlaylist() {
        try {
            // Get user's top tracks for variety
            const topTracks = await this.makeSpotifyRequest('/me/top/tracks?limit=50&time_range=medium_term');
            
            if (!topTracks?.items?.length) {
                // Fallback to featured playlists
                const featured = await this.makeSpotifyRequest('/browse/featured-playlists?limit=1');
                if (featured?.playlists?.items?.[0]) {
                    const playlist = await this.makeSpotifyRequest(`/playlists/${featured.playlists.items[0].id}/tracks?limit=50`);
                    topTracks.items = playlist.items.map(item => item.track).filter(track => track && track.preview_url);
                }
            }
            
            if (!topTracks?.items?.length) {
                throw new Error('Unable to find tracks for playlist');
            }
            
            // Randomize and select tracks
            const shuffled = topTracks.items.sort(() => Math.random() - 0.5);
            const selectedTracks = shuffled.slice(0, CONFIG.GAME_SETTINGS.PLAYLIST_SIZE);
            
            this.currentPlaylist = {
                tracks: selectedTracks,
                currentIndex: 0,
                gaps: this.generateRandomGaps(selectedTracks.length)
            };
            
            this.updatePlaylistDisplay();
            this.sendTelemetry('playlist_created', {
                track_count: selectedTracks.length,
                source: 'user_top_tracks'
            });
            
        } catch (error) {
            console.error('Playlist creation error:', error);
            throw error;
        }
    }
    
    generateRandomGaps(trackCount) {
        const gaps = [];
        for (let i = 0; i < trackCount; i++) {
            // Random gap between 5-15 seconds
            gaps.push(Math.floor(Math.random() * 10) + 5);
        }
        return gaps;
    }
    
    updatePlaylistDisplay() {
        const playlistInfo = document.getElementById('playlistInfo');
        const playlistDetails = document.getElementById('playlistDetails');
        
        if (this.currentPlaylist) {
            playlistInfo.style.display = 'block';
            playlistDetails.innerHTML = `
                <p><strong>Tracks:</strong> ${this.currentPlaylist.tracks.length}</p>
                <p><strong>Current:</strong> ${this.currentPlaylist.tracks[this.currentPlaylist.currentIndex]?.name || 'None'}</p>
                <p><strong>Artist:</strong> ${this.currentPlaylist.tracks[this.currentPlaylist.currentIndex]?.artists[0]?.name || 'Unknown'}</p>
            `;
        }
    }
    
    async transferPlayback() {
        try {
            // Get current devices
            const devices = await this.makeSpotifyRequest('/me/player/devices');
            const activeDevice = devices?.devices?.find(d => d.is_active);
            
            if (!activeDevice) {
                throw new Error('No active device found. Please start playback on Spotify first.');
            }
            
            // Transfer playback if needed
            if (this.deviceId && activeDevice.id !== this.deviceId) {
                await this.makeSpotifyRequest('/me/player', {
                    method: 'PUT',
                    body: JSON.stringify({
                        device_ids: [activeDevice.id],
                        play: false
                    })
                });
            }
            
        } catch (error) {
            console.error('Playback transfer error:', error);
            throw error;
        }
    }
    
    async startPlayback() {
        if (!this.currentPlaylist?.tracks?.length) {
            throw new Error('No playlist available');
        }
        
        const track = this.currentPlaylist.tracks[0];
        
        try {
            await this.makeSpotifyRequest('/me/player/play', {
                method: 'PUT',
                body: JSON.stringify({
                    uris: [track.uri]
                })
            });
            
            this.currentTrackIndex = 0;
            this.updatePlaylistDisplay();
            
        } catch (error) {
            console.error('Playback start error:', error);
            throw error;
        }
    }
    
    handlePlayerStateChange(state) {
        if (!state || !this.isSessionActive) return;
        
        const track = state.track_window.current_track;
        const progress = state.position;
        const duration = state.duration;
        
        if (track && duration > 0) {
            const trackProgress = progress / duration;
            const gap = this.currentPlaylist.gaps[this.currentTrackIndex] || 10;
            
            // Check if we've listened to enough of the current track
            if (progress >= (gap * 1000)) {
                this.completeCurrentTrack();
            }
            
            this.updateProgressDisplay(trackProgress);
        }
    }
    
    completeCurrentTrack() {
        this.completedTracks++;
        
        const completionRatio = this.completedTracks / this.currentPlaylist.tracks.length;
        
        if (completionRatio >= CONFIG.GAME_SETTINGS.COMPLETION_THRESHOLD) {
            this.showCompletionCode();
        } else if (this.currentTrackIndex < this.currentPlaylist.tracks.length - 1) {
            this.playNextTrack();
        }
        
        this.updateSessionProgress();
    }
    
    async playNextTrack() {
        if (this.currentTrackIndex >= this.currentPlaylist.tracks.length - 1) return;
        
        this.currentTrackIndex++;
        const track = this.currentPlaylist.tracks[this.currentTrackIndex];
        
        try {
            await this.makeSpotifyRequest('/me/player/play', {
                method: 'PUT',
                body: JSON.stringify({
                    uris: [track.uri]
                })
            });
            
            this.updatePlaylistDisplay();
            
        } catch (error) {
            console.error('Next track error:', error);
            this.showMessage('Failed to play next track.', 'error');
        }
    }
    
    updateProgressDisplay(trackProgress = 0) {
        const sessionProgress = document.getElementById('sessionProgress');
        const progressText = document.getElementById('progressText');
        
        const overallProgress = (this.completedTracks + trackProgress) / this.currentPlaylist.tracks.length;
        
        sessionProgress.style.width = `${Math.min(overallProgress * 100, 100)}%`;
        progressText.textContent = `${this.completedTracks}/${this.currentPlaylist.tracks.length} tracks completed`;
    }
    
    updateSessionProgress() {
        this.sessionProgress = this.completedTracks / this.currentPlaylist.tracks.length;
        this.updateProgressDisplay();
    }
    
    updateUI() {
        const startBtn = document.getElementById('startBtn');
        const saveBtn = document.getElementById('saveBtn');
        const finishBtn = document.getElementById('finishBtn');
        
        startBtn.disabled = this.isSessionActive;
        saveBtn.disabled = !this.isSessionActive;
        finishBtn.disabled = !this.isSessionActive;
        
        if (this.isSessionActive) {
            startBtn.textContent = 'Session Active';
        }
    }
    
    async saveCurrentTrack() {
        if (!this.isSessionActive || !this.currentPlaylist) return;
        
        const track = this.currentPlaylist.tracks[this.currentTrackIndex];
        if (!track) return;
        
        try {
            await this.makeSpotifyRequest('/me/tracks', {
                method: 'PUT',
                body: JSON.stringify({
                    ids: [track.id]
                })
            });
            
            this.showMessage(`"${track.name}" saved to your library!`, 'success');
            this.sendTelemetry('track_saved', { track_id: track.id });
            
        } catch (error) {
            console.error('Save track error:', error);
            this.showMessage('Failed to save track.', 'error');
        }
    }
    
    showCompletionCode() {
        const completionCode = document.getElementById('completionCode');
        const codeDisplay = document.getElementById('codeDisplay');
        
        // Generate completion code
        const timestamp = Date.now();
        const code = `RG-${timestamp.toString(36).toUpperCase()}`;
        
        codeDisplay.textContent = code;
        completionCode.style.display = 'block';
        
        this.finishSession(true);
        this.sendTelemetry('session_completed', { 
            completion_code: code,
            tracks_completed: this.completedTracks 
        });
    }
    
    finishSession(completed = false) {
        this.isSessionActive = false;
        
        if (this.player) {
            this.player.pause();
        }
        
        this.updateUI();
        
        if (!completed) {
            this.showMessage('Session finished early. Complete more tracks next time!', 'warn');
        }
        
        this.sendTelemetry('session_finished', {
            completed: completed,
            tracks_completed: this.completedTracks,
            completion_ratio: this.sessionProgress
        });
    }
    
    showHelp() {
        document.getElementById('helpModal').style.display = 'block';
    }
    
    hideHelp() {
        document.getElementById('helpModal').style.display = 'none';
    }
    
    sendTelemetry(event, data = {}) {
        if (!CONFIG.TELEMETRY_URL) return;
        
        const payload = {
            event: event,
            timestamp: Date.now(),
            session_id: sessionStorage.getItem('bootstrap_nonce'),
            user_agent: navigator.userAgent,
            ...data
        };
        
        // Fire and forget
        fetch(CONFIG.TELEMETRY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => {}); // Silently fail
    }
}

// Initialize game when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new SpotifyRhythmGame());
} else {
    new SpotifyRhythmGame();
}
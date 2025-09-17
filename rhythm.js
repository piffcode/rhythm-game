// Spotify Rhythm Game - Main Logic (Complete Version with Dynamic Playlist Generation)
class TokenManager {
    constructor(config, bootstrap) {
        this.config = config;
        this.bootstrap = bootstrap;
        this.cachedToken = null;
        this.expiresAt = 0;
        this.refreshPromise = null;
    }

    async fetchNewToken() {
        const endpoint = `${this.config.TOKEN_ENDPOINTS.ACCESS}?bootstrap=${encodeURIComponent(this.bootstrap)}`;
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            credentials: 'include'
        });

        if (response.status === 401) {
            throw new Error('Session expired.');
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to acquire access token.');
        }

        const data = await response.json();
        if (!data.access_token || typeof data.expires_in !== 'number') {
            throw new Error('Token service returned an unexpected response.');
        }

        this.cachedToken = data.access_token;
        const expiresInMs = Math.max(data.expires_in, 0) * 1000;
        this.expiresAt = Date.now() + expiresInMs;
        return this.cachedToken;
    }

    async getAccessToken() {
        const bufferMs = (this.config.GAME_SETTINGS.TOKEN_REFRESH_BUFFER || 0) * 1000;
        if (this.cachedToken && Date.now() < (this.expiresAt - bufferMs)) {
            return this.cachedToken;
        }

        if (!this.refreshPromise) {
            this.refreshPromise = this.fetchNewToken()
                .finally(() => { this.refreshPromise = null; });
        }

        return this.refreshPromise;
    }

    invalidate() {
        this.cachedToken = null;
        this.expiresAt = 0;
    }
}

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
        this.animationId = null; // For visualizer
        this.canvas = null;
        this.ctx = null;
        this.tokenManager = null;
        this.bootstrapNonce = null;

        this.init();
    }

    async init() {
        try {
            // Validate bootstrap nonce first
            const bootstrapValid = await this.validateBootstrap();
            if (!bootstrapValid) {
                return;
            }

            // Initialize visualizer
            this.initializeVisualizer();
            
            // Load user profile
            await this.loadUserProfile();
            
            // Initialize Spotify Web Playback SDK with timeout
            await this.initializePlayer();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Setup cleanup on page unload
            this.setupCleanup();
            
            // Start device detection
            this.startDeviceDetection();
            
        } catch (error) {
            console.error('Initialization error:', error);
            this.showMessage('Failed to initialize game. Please refresh and try again.', 'error');
        }
    }
    
    async validateBootstrap() {
        const urlParams = new URLSearchParams(window.location.search);
        const bootstrapParam = urlParams.get('bootstrap');
        if (!bootstrapParam) {
            this.redirectToAuth('Missing session bootstrap parameter.');
            return false;
        }

        try {
            const response = await fetch(CONFIG.TOKEN_ENDPOINTS.VALIDATE_SESSION, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ bootstrap: bootstrapParam })
            });

            if (response.status === 401) {
                throw new Error('Session expired');
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Session validation failed');
            }

            const data = await response.json();
            if (!data.valid) {
                throw new Error('Session is no longer valid');
            }

            this.bootstrapNonce = bootstrapParam;
            this.tokenManager = new TokenManager(CONFIG, bootstrapParam);

            return true;
        } catch (error) {
            console.error('Bootstrap validation failed:', error);
            this.redirectToAuth('Authentication session expired. Please login again.');
            return false;
        }
    }

    redirectToAuth(message = null) {
        if (message) {
            this.showMessage(message, 'error');
        }

        fetch(CONFIG.TOKEN_ENDPOINTS.LOGOUT, {
            method: 'POST',
            credentials: 'include'
        }).catch(() => {});

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
    
    // Enhanced API request handling with better error messages
    async makeSpotifyRequest(endpoint, options = {}) {
        if (!this.tokenManager) {
            throw new Error('Token manager is not initialized.');
        }

        const token = await this.tokenManager.getAccessToken();
        if (!token) {
            return null;
        }

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
                this.tokenManager.invalidate();
                await this.tokenManager.getAccessToken();
                return this.makeSpotifyRequest(endpoint, options);
            }

            // Enhanced Premium check
            if (response.status === 403) {
                const errorData = await response.json().catch(() => ({}));
                if (errorData.error?.reason === 'PREMIUM_REQUIRED') {
                    this.showMessage('Spotify Premium is required for this feature. Please upgrade your account.', 'error');
                    return null;
                }
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
                this.showMessage('Spotify Premium required for playback control.', 'error', 'Please upgrade your Spotify account to continue.');
            } else if (error.message.includes('Session expired') || /unauthorized|forbidden/i.test(error.message)) {
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
                    this.showMessage('Spotify Premium is required for playback control. Please upgrade your account.', 'warn', 'Visit spotify.com/premium to upgrade.');
                }
            }
        } catch (error) {
            console.error('Failed to load profile:', error);
            this.showMessage('Failed to load user profile.', 'error');
        }
    }
    
    // Fixed SDK initialization with timeout and fallback
    async initializePlayer() {
        return new Promise((resolve, reject) => {
            let sdkReady = false;
            const sdkTimeout = setTimeout(() => {
                if (!sdkReady) {
                    console.error('Spotify SDK failed to load');
                    this.showMessage('Spotify SDK failed to load. Please refresh the page.', 'error');
                    reject(new Error('SDK timeout'));
                }
            }, 10000);
            
            window.onSpotifyWebPlaybackSDKReady = () => {
                sdkReady = true;
                clearTimeout(sdkTimeout);
                this.player = new Spotify.Player({
                    name: 'Spotify Rhythm Game',
                    getOAuthToken: async (cb) => {
                        try {
                            const freshToken = await this.tokenManager.getAccessToken();
                            cb(freshToken);
                        } catch (error) {
                            console.error('Failed to supply token to Spotify SDK:', error);
                            this.redirectToAuth('Authentication expired. Please login again.');
                        }
                    },
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
    
    // Initialize basic visualizer
    initializeVisualizer() {
        this.canvas = document.getElementById('visualizer');
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
        }
    }
    
    startVisualization() {
        if (!this.canvas || !this.ctx) return;
        
        const draw = () => {
            if (!this.isSessionActive) return;
            
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Simple waveform simulation
            const centerY = this.canvas.height / 2;
            const amplitude = 30;
            const frequency = 0.02;
            const time = Date.now() * 0.01;
            
            this.ctx.strokeStyle = '#1db954';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            
            for (let x = 0; x < this.canvas.width; x++) {
                const y = centerY + Math.sin((x * frequency) + time) * amplitude;
                if (x === 0) {
                    this.ctx.moveTo(x, y);
                } else {
                    this.ctx.lineTo(x, y);
                }
            }
            
            this.ctx.stroke();
            this.animationId = requestAnimationFrame(draw);
        };
        
        draw();
    }
    
    stopVisualization() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        if (this.canvas && this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
    
    // Setup cleanup handlers
    setupCleanup() {
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }
    
    cleanup() {
        if (this.devicePollInterval) {
            clearInterval(this.devicePollInterval);
        }
        if (this.player) {
            this.player.disconnect();
        }
        this.stopVisualization();
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
    
    // Enhanced message display with actionable guidance
    showMessage(text, type = 'error', actionable = null) {
        const messageBlock = document.getElementById('messageBlock');
        messageBlock.innerHTML = actionable 
            ? `${text}<br><small>${actionable}</small>`
            : text;
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
                    deviceStatus.textContent = `Found active device: ${activeDevice.name}`;
                    
                    setTimeout(() => {
                        deviceActivation.style.display = 'none';
                    }, 2000);
                    
                    this.enableStartButton();
                    return;
                }
                
                if (pollCount >= maxPolls) {
                    clearInterval(this.devicePollInterval);
                    deviceStatus.className = 'device-status timeout';
                    deviceStatus.innerHTML = 'No active device found.<br>Please open Spotify and play a song, then click "Open Spotify App" to try again.';
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
            this.startVisualization();
            this.updateUI();
            
        } catch (error) {
            console.error('Session start error:', error);
            this.showMessage('Failed to start session. Please try again.', 'error');
        }
    }
    
    // NEW: Dynamic playlist generation with fixed tracks and rotation
    async createGamePlaylist() {
        try {
            const country = new URLSearchParams(window.location.search).get('country') || 'US';
            
            // Fixed track IDs - these will always be first two tracks
            const fixedTrackIds = [
                '5FMyXeZ0reYloRTiCkPprT',
                '0YWmeJtd7Fp1tH3978qUIH'
            ];
            
            // Get the fixed tracks
            const fixedTracksResponse = await this.makeSpotifyRequest(
                `/tracks?ids=${fixedTrackIds.join(',')}&market=${country}`
            );
            
            if (!fixedTracksResponse?.tracks || fixedTracksResponse.tracks.length !== 2) {
                throw new Error('Unable to load required tracks');
            }
            
            const fixedTracks = fixedTracksResponse.tracks;
            
            // Dynamically find similar tracks
            let similarTracks = await this.findSimilarTracks();
            
            // Fallback to genre-based if audio feature search fails
            if (similarTracks.length === 0) {
                similarTracks = await this.findSimilarTracksByGenre();
            }
            
            // Select random track from similar tracks
            let rotationTrack = null;
            if (similarTracks.length > 0) {
                const randomIndex = Math.floor(Math.random() * similarTracks.length);
                rotationTrack = similarTracks[randomIndex];
            }
            
            // Build final track list
            const selectedTracks = [...fixedTracks];
            if (rotationTrack) {
                selectedTracks.push(rotationTrack);
            }
            
            this.currentPlaylist = {
                tracks: selectedTracks,
                currentIndex: 0,
                gaps: this.generateRandomGaps(selectedTracks.length)
            };
            
            this.updatePlaylistDisplay();
            this.sendTelemetry('playlist_created', {
                track_count: selectedTracks.length,
                source: 'fixed_plus_dynamic_similar',
                country: country,
                similar_tracks_found: similarTracks.length
            });
            
            console.log('Playlist created with dynamic similar tracks:', {
                fixed_tracks: fixedTracks.map(t => `${t.name} - ${t.artists[0]?.name}`),
                rotation_track: rotationTrack ? `${rotationTrack.name} - ${rotationTrack.artists[0]?.name}` : 'None',
                similar_pool_size: similarTracks.length
            });
            
        } catch (error) {
            console.error('Playlist creation error:', error);
            throw error;
        }
    }
    
    // Method to find similar tracks using audio features
    async findSimilarTracks() {
        const fixedTrackIds = [
            '5FMyXeZ0reYloRTiCkPprT',
            '0YWmeJtd7Fp1tH3978qUIH'
        ];
        
        try {
            const country = new URLSearchParams(window.location.search).get('country') || 'US';
            
            // Get audio features for the fixed tracks
            const audioFeaturesResponse = await this.makeSpotifyRequest(
                `/audio-features?ids=${fixedTrackIds.join(',')}`
            );
            
            if (!audioFeaturesResponse?.audio_features) {
                throw new Error('Unable to get audio features');
            }
            
            const features = audioFeaturesResponse.audio_features;
            
            // Calculate average audio features
            const avgFeatures = {
                danceability: (features[0].danceability + features[1].danceability) / 2,
                energy: (features[0].energy + features[1].energy) / 2,
                valence: (features[0].valence + features[1].valence) / 2,
                acousticness: (features[0].acousticness + features[1].acousticness) / 2,
                instrumentalness: (features[0].instrumentalness + features[1].instrumentalness) / 2,
                tempo: (features[0].tempo + features[1].tempo) / 2
            };
            
            // Get track details for genre seeds
            const tracksResponse = await this.makeSpotifyRequest(
                `/tracks?ids=${fixedTrackIds.join(',')}`
            );
            
            // Extract artist IDs for seed_artists
            const artistIds = [];
            tracksResponse.tracks.forEach(track => {
                if (track.artists && track.artists[0]) {
                    artistIds.push(track.artists[0].id);
                }
            });
            
            // Get recommendations based on audio features
            const recommendationParams = new URLSearchParams({
                seed_artists: artistIds.slice(0, 2).join(','), // Max 2 artist seeds
                seed_tracks: fixedTrackIds[0], // Use first track as seed
                limit: '20', // Get more to have variety
                market: country,
                // Target audio features (with some tolerance)
                target_danceability: avgFeatures.danceability.toFixed(2),
                target_energy: avgFeatures.energy.toFixed(2),
                target_valence: avgFeatures.valence.toFixed(2),
                min_danceability: Math.max(0, avgFeatures.danceability - 0.2).toFixed(2),
                max_danceability: Math.min(1, avgFeatures.danceability + 0.2).toFixed(2),
                min_energy: Math.max(0, avgFeatures.energy - 0.2).toFixed(2),
                max_energy: Math.min(1, avgFeatures.energy + 0.2).toFixed(2)
            });
            
            const recommendationsResponse = await this.makeSpotifyRequest(
                `/recommendations?${recommendationParams}`
            );
            
            if (recommendationsResponse?.tracks) {
                // Filter out the fixed tracks if they appear in recommendations
                const similarTracks = recommendationsResponse.tracks.filter(
                    track => !fixedTrackIds.includes(track.id)
                );
                
                console.log('Similar tracks found via audio features:', similarTracks.map(track => ({
                    id: track.id,
                    name: track.name,
                    artist: track.artists[0]?.name,
                    uri: track.uri
                })));
                
                return similarTracks.slice(0, 7); // Return up to 7 tracks
            }
            
        } catch (error) {
            console.error('Error finding similar tracks via audio features:', error);
            return [];
        }
        
        return [];
    }
    
    // Alternative method using genre-based search
    async findSimilarTracksByGenre() {
        try {
            const country = new URLSearchParams(window.location.search).get('country') || 'US';
            
            // Get genre seeds from user's top artists
            const topArtists = await this.makeSpotifyRequest(`/me/top/artists?limit=5&time_range=medium_term`);
            let genreSeeds = [];
            
            if (topArtists?.items) {
                // Extract genres from top artists
                topArtists.items.forEach(artist => {
                    if (artist.genres) {
                        genreSeeds.push(...artist.genres);
                    }
                });
            }
            
            // Fallback to popular genres if no user data
            if (genreSeeds.length === 0) {
                genreSeeds = ['pop', 'rock', 'indie', 'alternative', 'dance'];
            }
            
            // Use first 2-3 genres as seeds
            const selectedGenres = genreSeeds.slice(0, 3);
            
            const recommendationParams = new URLSearchParams({
                seed_genres: selectedGenres.join(','),
                limit: '20',
                market: country
            });
            
            const recommendationsResponse = await this.makeSpotifyRequest(
                `/recommendations?${recommendationParams}`
            );
            
            if (recommendationsResponse?.tracks) {
                console.log('Similar tracks found via genre seeds:', recommendationsResponse.tracks.map(track => ({
                    id: track.id,
                    name: track.name,
                    artist: track.artists[0]?.name,
                    uri: track.uri
                })));
                
                return recommendationsResponse.tracks.slice(0, 7);
            }
            
        } catch (error) {
            console.error('Error finding similar tracks via genre:', error);
            return [];
        }
        
        return [];
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
    
    // Fixed device selection logic
    async transferPlayback() {
        try {
            const devices = await this.makeSpotifyRequest('/me/player/devices');
            
            if (!devices?.devices?.length) {
                throw new Error('No Spotify devices available');
            }
            
            // Prefer Web Playback SDK device if available
            let targetDevice = devices.devices.find(d => d.id === this.deviceId);
            
            // Otherwise use any active device
            if (!targetDevice) {
                targetDevice = devices.devices.find(d => d.is_active);
            }
            
            // Otherwise use first available device
            if (!targetDevice) {
                targetDevice = devices.devices[0];
            }
            
            // Transfer playback if needed
            if (!targetDevice.is_active) {
                await this.makeSpotifyRequest('/me/player', {
                    method: 'PUT',
                    body: JSON.stringify({
                        device_ids: [targetDevice.id],
                        play: false
                    })
                });
                
                // Wait a moment for transfer to complete
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
        } catch (error) {
            console.error('Playback transfer error:', error);
            throw new Error('Failed to setup playback device. Please ensure Spotify is running and try again.');
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
            throw new Error('Failed to start playback. Please check your Spotify Premium status.');
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
        
        this.stopVisualization();
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
            session_id: this.bootstrapNonce,
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

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new SpotifyRhythmGame();
});
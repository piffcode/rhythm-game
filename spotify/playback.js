// spotify/playback.js - Headless Spotify playback management

import { config } from '../config.js';

export class SpotifyPlayback {
    constructor(client) {
        this.client = client;
        this.player = null;
        this.deviceId = null;
        this.currentState = null;
        this.positionMs = 0;
        this.lastUpdateTime = 0;
        this.isPlaying = false;
        this.currentTrack = null;
        
        // Control locks for rhythm game
        this.controlsLocked = false;
        this.expectedTrackIndex = 0;
        this.sessionContext = null;
        this.isAutoAdvancing = false;
        
        // Position smoothing
        this.smoothedPosition = 0;
        this.positionVelocity = 0;
        
        // Event callbacks
        this.onReady = null;
        this.onStateChange = null;
        this.onTrackChange = null;
        
        // Calibration offset from user calibration
        this.calibrationOffset = parseInt(localStorage.getItem('rhythmCalibrationOffset')) || 0;
    }

    /**
     * Initialize the Spotify Web Playback SDK
     */
    async initialize() {
        return new Promise((resolve, reject) => {
            // Load Spotify Web Playback SDK
            if (!window.Spotify) {
                const script = document.createElement('script');
                script.src = 'https://sdk.scdn.co/spotify-player.js';
                script.async = true;
                document.head.appendChild(script);
                
                window.onSpotifyWebPlaybackSDKReady = () => {
                    this.setupPlayer().then(resolve).catch(reject);
                };
            } else {
                this.setupPlayer().then(resolve).catch(reject);
            }
        });
    }

    /**
     * Setup the Spotify player instance
     */
    async setupPlayer() {
        const token = await this.client.auth.getValidAccessToken();
        
        this.player = new Spotify.Player({
            name: 'RHYTHM Game Player',
            getOAuthToken: async (cb) => {
                try {
                    const validToken = await this.client.auth.getValidAccessToken();
                    cb(validToken);
                } catch (error) {
                    console.error('Failed to get OAuth token:', error);
                    cb(null);
                }
            },
            volume: 0.8
        });

        // Setup event listeners
        this.setupEventListeners();

        // Connect to the player
        const success = await this.player.connect();
        if (!success) {
            throw new Error('Failed to connect to Spotify player');
        }

        console.log('Spotify player initialized successfully');
    }

    /**
     * Setup player event listeners
     */
    setupEventListeners() {
        // Ready event
        this.player.addListener('ready', ({ device_id }) => {
            console.log('Spotify player ready with device ID:', device_id);
            this.deviceId = device_id;
            if (this.onReady) this.onReady(device_id);
        });

        // Not ready event
        this.player.addListener('not_ready', ({ device_id }) => {
            console.log('Spotify player device has gone offline:', device_id);
            this.deviceId = null;
        });

        // Player state changed
        this.player.addListener('player_state_changed', (state) => {
            this.handleStateChange(state);
        });

        // Initialization error
        this.player.addListener('initialization_error', ({ message }) => {
            console.error('Spotify player initialization error:', message);
        });

        // Authentication error
        this.player.addListener('authentication_error', ({ message }) => {
            console.error('Spotify player authentication error:', message);
            // Try to refresh token
            this.client.auth.refreshToken().catch(err => {
                console.error('Token refresh failed:', err);
            });
        });

        // Account error
        this.player.addListener('account_error', ({ message }) => {
            console.error('Spotify player account error:', message);
        });

        // Playback error
        this.player.addListener('playback_error', ({ message }) => {
            console.error('Spotify player playback error:', message);
        });

        // Start position update loop
        this.startPositionUpdates();
    }

    /**
     * Handle player state changes
     */
    handleStateChange(state) {
        if (!state) return;

        this.currentState = state;
        const wasPlaying = this.isPlaying;
        this.isPlaying = !state.paused;
        
        // Update position and track info
        this.positionMs = state.position;
        this.lastUpdateTime = Date.now();
        
        // Check for track change
        if (state.track_window && state.track_window.current_track) {
            const newTrack = state.track_window.current_track;
            if (!this.currentTrack || this.currentTrack.id !== newTrack.id) {
                this.currentTrack = newTrack;
                if (this.onTrackChange) {
                    this.onTrackChange(newTrack);
                }
            }
        }

        // Handle controls lock during gameplay
        if (this.controlsLocked) {
            this.enforceControlLocks(state);
        }

        // Notify listeners
        if (this.onStateChange) {
            this.onStateChange(state);
        }
    }

    /**
     * Enforce control locks during rhythm game sessions
     */
    enforceControlLocks(state) {
        // Prevent pausing mid-track (unless at track end)
        if (state.paused && this.positionMs < (state.duration - 1000) && !this.isAutoAdvancing) {
            console.log('Detected unauthorized pause, resuming...');
            this.player.resume().then(() => {
                this.showToast(config.ERRORS.CONTROLS_LOCKED);
            }).catch(err => {
                console.error('Failed to resume playback:', err);
            });
        }

        // Detect skipping via external controls
        if (this.sessionContext && state.track_window) {
            const currentTrackId = state.track_window.current_track?.id;
            const expectedTrackId = this.getExpectedTrackId();
            
            if (currentTrackId && expectedTrackId && currentTrackId !== expectedTrackId) {
                console.log('Detected unauthorized track skip, correcting...');
                this.snapToExpectedTrack();
            }
        }

        // Detect seeking
        const expectedPosition = this.calculateExpectedPosition();
        const positionDrift = Math.abs(this.positionMs - expectedPosition);
        
        if (positionDrift > config.PERFORMANCE.SEEK_THRESHOLD && !this.isAutoAdvancing) {
            console.log(`Detected seek (drift: ${positionDrift}ms), correcting...`);
            this.seekToPosition(expectedPosition);
        }
    }

    /**
     * Start playback from a playlist context
     */
    async startPlayback(contextUri, offset = 0) {
        if (!this.deviceId) {
            throw new Error('No device available for playback');
        }

        const playOptions = {
            context_uri: contextUri,
            offset: { position: offset },
            position_ms: 0
        };

        try {
            await this.client.startPlayback(playOptions, this.deviceId);
            
            // Store session context for control enforcement
            this.sessionContext = contextUri;
            this.expectedTrackIndex = offset;
            this.controlsLocked = true;
            
            console.log('Playback started:', contextUri);
        } catch (error) {
            console.error('Failed to start playback:', error);
            throw error;
        }
    }

    /**
     * Advance to next track in session
     */
    async advanceToNextTrack() {
        if (!this.controlsLocked || !this.sessionContext) return;

        this.isAutoAdvancing = true;
        this.expectedTrackIndex++;

        try {
            await this.client.skipNext(this.deviceId);
            console.log('Advanced to track index:', this.expectedTrackIndex);
        } catch (error) {
            console.error('Failed to advance track:', error);
            // Try alternative method
            await this.snapToExpectedTrack();
        } finally {
            // Clear auto-advancing flag after a brief delay
            setTimeout(() => {
                this.isAutoAdvancing = false;
            }, 2000);
        }
    }

    /**
     * Snap playback to the expected track index
     */
    async snapToExpectedTrack() {
        if (!this.sessionContext || !this.deviceId) return;

        try {
            const playOptions = {
                context_uri: this.sessionContext,
                offset: { position: this.expectedTrackIndex }
            };
            
            await this.client.startPlayback(playOptions, this.deviceId);
            console.log('Snapped to expected track index:', this.expectedTrackIndex);
        } catch (error) {
            console.error('Failed to snap to expected track:', error);
        }
    }

    /**
     * Get the expected track ID based on current session
     */
    getExpectedTrackId() {
        // This would need to be set when starting the session
        // For now, return null as a placeholder
        return null;
    }

    /**
     * Calculate expected playback position based on time
     */
    calculateExpectedPosition() {
        if (!this.lastUpdateTime || !this.isPlaying) {
            return this.positionMs;
        }
        
        const timeSinceUpdate = Date.now() - this.lastUpdateTime;
        return this.positionMs + timeSinceUpdate;
    }

    /**
     * Seek to a specific position
     */
    async seekToPosition(positionMs) {
        try {
            await this.client.seek(positionMs, this.deviceId);
            this.positionMs = positionMs;
            this.lastUpdateTime = Date.now();
        } catch (error) {
            console.error('Failed to seek:', error);
        }
    }

    /**
     * Get current playback position with smoothing and calibration
     */
    getPositionMs() {
        if (!this.isPlaying) {
            return this.smoothedPosition + this.calibrationOffset;
        }

        const now = Date.now();
        const timeSinceUpdate = now - this.lastUpdateTime;
        const rawPosition = this.positionMs + timeSinceUpdate;
        
        // Apply smoothing to reduce jitter
        const targetPosition = rawPosition;
        const positionDelta = targetPosition - this.smoothedPosition;
        
        if (Math.abs(positionDelta) < 50) {
            // Small differences - smooth interpolation
            this.smoothedPosition += positionDelta * config.PERFORMANCE.POSITION_SMOOTHING;
        } else {
            // Large jump - snap immediately
            this.smoothedPosition = targetPosition;
        }
        
        return this.smoothedPosition + this.calibrationOffset;
    }

    /**
     * Start position update loop for smooth tracking
     */
    startPositionUpdates() {
        setInterval(() => {
            if (this.player && this.isPlaying) {
                this.player.getCurrentState().then(state => {
                    if (state) {
                        this.positionMs = state.position;
                        this.lastUpdateTime = Date.now();
                    }
                });
            }
        }, config.AUDIO.POSITION_UPDATE_RATE);
    }

    /**
     * Set calibration offset
     */
    setCalibrationOffset(offsetMs) {
        this.calibrationOffset = offsetMs;
        localStorage.setItem('rhythmCalibrationOffset', offsetMs.toString());
    }

    /**
     * Get current track information
     */
    getCurrentTrack() {
        return this.currentTrack;
    }

    /**
     * Check if currently playing
     */
    getIsPlaying() {
        return this.isPlaying;
    }

    /**
     * Get current device ID
     */
    getDeviceId() {
        return this.deviceId;
    }

    /**
     * Pause playback (only when not in locked mode)
     */
    async pause() {
        if (this.controlsLocked) {
            console.warn('Cannot pause - controls are locked');
            return;
        }

        try {
            await this.player.pause();
        } catch (error) {
            console.error('Failed to pause:', error);
        }
    }

    /**
     * Resume playback
     */
    async resume() {
        try {
            await this.player.resume();
        } catch (error) {
            console.error('Failed to resume:', error);
        }
    }

    /**
     * Set volume
     */
    async setVolume(volume) {
        try {
            await this.player.setVolume(volume);
        } catch (error) {
            console.error('Failed to set volume:', error);
        }
    }

    /**
     * Lock controls for rhythm game session
     */
    lockControls(sessionContext, trackIds = []) {
        this.controlsLocked = true;
        this.sessionContext = sessionContext;
        this.expectedTrackIndex = 0;
        this.sessionTrackIds = trackIds;
        console.log('Controls locked for session');
    }

    /**
     * Unlock controls after session
     */
    unlockControls() {
        this.controlsLocked = false;
        this.sessionContext = null;
        this.expectedTrackIndex = 0;
        this.sessionTrackIds = [];
        console.log('Controls unlocked');
    }

    /**
     * Show a toast message to the user
     */
    showToast(message) {
        // Remove any existing toast
        const existingToast = document.querySelector('.toast');
        if (existingToast) {
            existingToast.remove();
        }

        // Create new toast
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Remove after animation
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    /**
     * Get playback state for debugging
     */
    getDebugInfo() {
        return {
            deviceId: this.deviceId,
            isPlaying: this.isPlaying,
            position: this.positionMs,
            smoothedPosition: this.smoothedPosition,
            calibrationOffset: this.calibrationOffset,
            controlsLocked: this.controlsLocked,
            expectedTrackIndex: this.expectedTrackIndex,
            currentTrack: this.currentTrack?.name || 'None'
        };
    }

    /**
     * Cleanup player resources
     */
    async disconnect() {
        if (this.player) {
            await this.player.disconnect();
            this.player = null;
        }
        this.deviceId = null;
        this.currentState = null;
        this.controlsLocked = false;
        console.log('Spotify player disconnected');
    }
}
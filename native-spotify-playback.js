// native-spotify-playback.js - Control user's native Spotify app instead of web player

import { config } from './config.js';

export class NativeSpotifyPlayback {
    constructor(client) {
        this.client = client;
        this.activeDeviceId = null;
        this.originalDevice = null;
        this.currentState = null;
        this.positionMs = 0;
        this.lastUpdateTime = 0;
        this.isPlaying = false;
        this.currentTrack = null;
        
        // Control locks for rhythm game
        this.controlsLocked = false;
        this.expectedTrackIndex = 0;
        this.sessionContext = null;
        this.sessionTracks = [];
        this.isAutoAdvancing = false;
        
        // Position tracking
        this.smoothedPosition = 0;
        this.positionVelocity = 0;
        this.positionUpdateInterval = null;
        
        // Event callbacks
        this.onReady = null;
        this.onStateChange = null;
        this.onTrackChange = null;
        
        // Calibration offset
        this.calibrationOffset = parseInt(localStorage.getItem('rhythmCalibrationOffset')) || 0;
        
        // Start monitoring
        this.startStateMonitoring();
    }

    /**
     * Initialize by finding and connecting to user's active Spotify device
     */
    async initialize() {
        console.log('Initializing native Spotify playback...');
        
        try {
            // Find active device or best available device
            const device = await this.findBestDevice();
            
            if (!device) {
                throw new Error('No Spotify devices found. Please open Spotify on any device and start playing music.');
            }
            
            this.activeDeviceId = device.id;
            this.originalDevice = device;
            
            console.log(`Connected to Spotify device: ${device.name} (${device.type})`);
            
            // Get initial state
            await this.updatePlaybackState();
            
            if (this.onReady) {
                this.onReady(device.id);
            }
            
            return device;
            
        } catch (error) {
            console.error('Failed to initialize native Spotify playback:', error);
            throw error;
        }
    }

    /**
     * Find the best Spotify device to use
     */
    async findBestDevice() {
        try {
            const response = await this.client.request('/v1/me/player/devices');
            const devices = response.devices || [];
            
            if (devices.length === 0) {
                return null;
            }
            
            // Priority order:
            // 1. Currently active device
            // 2. Computer/desktop app
            // 3. Phone/mobile app
            // 4. Any other device
            
            const activeDevice = devices.find(d => d.is_active);
            if (activeDevice) {
                return activeDevice;
            }
            
            const computerDevice = devices.find(d => 
                d.type === 'Computer' || d.name.toLowerCase().includes('desktop')
            );
            if (computerDevice) {
                return computerDevice;
            }
            
            const phoneDevice = devices.find(d => 
                d.type === 'Smartphone' || d.name.toLowerCase().includes('phone')
            );
            if (phoneDevice) {
                return phoneDevice;
            }
            
            // Return first available device
            return devices[0];
            
        } catch (error) {
            console.error('Failed to get devices:', error);
            return null;
        }
    }

    /**
     * Start monitoring playback state
     */
    startStateMonitoring() {
        // Poll playback state every 1 second
        this.positionUpdateInterval = setInterval(async () => {
            try {
                await this.updatePlaybackState();
            } catch (error) {
                console.warn('State monitoring error:', error);
            }
        }, 1000);
        
        // More frequent position updates for smooth tracking
        setInterval(() => {
            this.updateSmoothPosition();
        }, 50); // 20fps for smooth position tracking
    }

    /**
     * Update playback state from Spotify API
     */
    async updatePlaybackState() {
        try {
            const state = await this.client.request('/v1/me/player');
            
            if (!state || !state.device) {
                // No active playback
                this.isPlaying = false;
                return;
            }
            
            const wasPlaying = this.isPlaying;
            const previousTrack = this.currentTrack;
            
            // Update state
            this.currentState = state;
            this.isPlaying = state.is_playing;
            this.positionMs = state.progress_ms || 0;
            this.lastUpdateTime = Date.now();
            
            // Update active device if it changed
            if (state.device.id !== this.activeDeviceId) {
                console.log(`Device changed from ${this.activeDeviceId} to ${state.device.id}`);
                this.activeDeviceId = state.device.id;
            }
            
            // Check for track changes
            if (state.item && (!this.currentTrack || this.currentTrack.id !== state.item.id)) {
                this.currentTrack = state.item;
                console.log(`Track changed to: ${state.item.name}`);
                
                if (this.onTrackChange) {
                    this.onTrackChange(state.item);
                }
            }
            
            // Handle controls lock enforcement
            if (this.controlsLocked) {
                this.enforceControlLocks(state);
            }
            
            // Notify state change listeners
            if (this.onStateChange) {
                this.onStateChange(state);
            }
            
        } catch (error) {
            console.warn('Failed to update playback state:', error);
        }
    }

    /**
     * Update smooth position for rhythm game synchronization
     */
    updateSmoothPosition() {
        if (!this.isPlaying) {
            return;
        }
        
        const now = Date.now();
        const timeSinceUpdate = now - this.lastUpdateTime;
        const targetPosition = this.positionMs + timeSinceUpdate;
        
        // Apply smoothing
        const positionDelta = targetPosition - this.smoothedPosition;
        
        if (Math.abs(positionDelta) < 100) {
            // Small differences - smooth interpolation
            this.smoothedPosition += positionDelta * 0.1;
        } else {
            // Large jump - snap immediately (seeking detected)
            this.smoothedPosition = targetPosition;
        }
    }

    /**
     * Enforce control locks during rhythm game sessions
     */
    enforceControlLocks(state) {
        if (!state || this.isAutoAdvancing) return;
        
        // Check if user paused (not allowed during game)
        if (!state.is_playing && this.positionMs < (state.item?.duration_ms - 2000)) {
            console.log('Detected pause during game, resuming...');
            this.resume().then(() => {
                this.showToast('Playback controls are locked during gameplay');
            });
        }
        
        // Check if user skipped tracks manually
        if (state.item && this.sessionTracks.length > 0) {
            const currentTrackId = state.item.id;
            const expectedTrackId = this.sessionTracks[this.expectedTrackIndex];
            
            if (currentTrackId !== expectedTrackId && !this.isAutoAdvancing) {
                console.log('Detected unauthorized track skip, correcting...');
                this.snapToExpectedTrack();
            }
        }
    }

    /**
     * Start playback from a playlist
     */
    async startPlayback(contextUri, offset = 0) {
        if (!this.activeDeviceId) {
            throw new Error('No active Spotify device found');
        }
        
        try {
            const playOptions = {
                context_uri: contextUri,
                offset: { position: offset },
                position_ms: 0
            };
            
            await this.client.startPlayback(playOptions, this.activeDeviceId);
            
            // Store session context
            this.sessionContext = contextUri;
            this.expectedTrackIndex = offset;
            
            console.log(`Started playback on device ${this.activeDeviceId}: ${contextUri}`);
            
            // Wait a moment then update state
            setTimeout(() => {
                this.updatePlaybackState();
            }, 1000);
            
        } catch (error) {
            console.error('Failed to start playback:', error);
            
            if (error.status === 404) {
                throw new Error('No active Spotify device found. Please start playing music in Spotify first.');
            }
            
            throw error;
        }
    }

    /**
     * Advance to next track in the session - FIXED METHOD NAME
     */
    async advanceTrack() {
        return await this.advanceToNextTrack();
    }

    /**
     * Advance to next track in the session
     */
    async advanceToNextTrack() {
        if (!this.controlsLocked || !this.sessionContext) {
            console.log('Cannot advance - controls not locked or no session context');
            return;
        }
        
        this.isAutoAdvancing = true;
        this.expectedTrackIndex++;
        
        console.log(`Advancing to track index: ${this.expectedTrackIndex}`);
        
        try {
            await this.client.skipNext(this.activeDeviceId);
            console.log('Successfully advanced to next track');
            
            // Update state after skip
            setTimeout(() => {
                this.updatePlaybackState();
                this.isAutoAdvancing = false;
            }, 1500);
            
        } catch (error) {
            console.error('Failed to advance track:', error);
            this.isAutoAdvancing = false;
            
            // Try alternative method
            await this.snapToExpectedTrack();
        }
    }

    /**
     * Snap to expected track if user skipped manually
     */
    async snapToExpectedTrack() {
        if (!this.sessionContext || !this.activeDeviceId) return;
        
        try {
            const playOptions = {
                context_uri: this.sessionContext,
                offset: { position: this.expectedTrackIndex }
            };
            
            await this.client.startPlayback(playOptions, this.activeDeviceId);
            console.log('Snapped to expected track index:', this.expectedTrackIndex);
            
        } catch (error) {
            console.error('Failed to snap to expected track:', error);
        }
    }

    /**
     * Get current playback position with calibration
     */
    getPositionMs() {
        return this.smoothedPosition + this.calibrationOffset;
    }

    /**
     * Resume playback
     */
    async resume() {
        try {
            await this.client.startPlayback({}, this.activeDeviceId);
            console.log('Playback resumed');
            
        } catch (error) {
            console.error('Failed to resume playback:', error);
        }
    }

    /**
     * Lock controls for rhythm game session
     */
    lockControls(sessionContext, trackIds = []) {
        this.controlsLocked = true;
        this.sessionContext = sessionContext;
        this.sessionTracks = trackIds;
        this.expectedTrackIndex = 0;
        
        console.log('Controls locked for rhythm game session');
        console.log('Session tracks:', trackIds);
        this.showToast('Rhythm game active! Playback controls are temporarily locked.');
    }

    /**
     * Unlock controls after session
     */
    unlockControls() {
        this.controlsLocked = false;
        this.sessionContext = null;
        this.sessionTracks = [];
        this.expectedTrackIndex = 0;
        
        console.log('Controls unlocked');
        this.showToast('Rhythm game finished! Playback controls restored.');
    }

    /**
     * Set calibration offset for rhythm sync
     */
    setCalibrationOffset(offsetMs) {
        this.calibrationOffset = offsetMs;
        localStorage.setItem('rhythmCalibrationOffset', offsetMs.toString());
        console.log(`Calibration offset set to ${offsetMs}ms`);
    }

    /**
     * Check if currently playing
     */
    getIsPlaying() {
        return this.isPlaying;
    }

    /**
     * Get active device ID
     */
    getDeviceId() {
        return this.activeDeviceId;
    }

    /**
     * Show toast message to user
     */
    showToast(message) {
        // Create or update toast
        let toast = document.querySelector('.rhythm-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'rhythm-toast';
            toast.style.cssText = `
                position: fixed;
                bottom: 100px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(29, 185, 84, 0.95);
                color: white;
                padding: 12px 24px;
                border-radius: 25px;
                font-size: 14px;
                z-index: 2001;
                max-width: 80%;
                text-align: center;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                transition: all 0.3s ease;
            `;
            document.body.appendChild(toast);
        }
        
        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(-50%) translateY(20px)';
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }
        }, 3000);
    }

    /**
     * Cleanup and disconnect
     */
    async disconnect() {
        if (this.positionUpdateInterval) {
            clearInterval(this.positionUpdateInterval);
            this.positionUpdateInterval = null;
        }
        
        // Unlock controls if they were locked
        if (this.controlsLocked) {
            this.unlockControls();
        }
        
        this.activeDeviceId = null;
        this.originalDevice = null;
        this.currentState = null;
        
        console.log('Native Spotify playback disconnected');
    }
}

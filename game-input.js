// game/input.js - Handle touch and mouse input for the rhythm game

import { config } from '../config.js';

export class GameInput {
    constructor(canvas) {
        this.canvas = canvas;
        this.isEnabled = false;
        this.lanes = 4; // Will be set by game engine
        this.laneWidth = 0;
        this.canvasRect = null;
        
        // Touch tracking
        this.activeTouches = new Map(); // touchId -> { lane, startTime, element }
        this.touchBuffer = config.MOBILE.TOUCH_BUFFER;
        
        // Input callbacks
        this.onLaneHit = null; // (laneIndex, inputTime) => void
        this.onLaneRelease = null; // (laneIndex, holdTime) => void
        
        // Performance tracking
        this.inputHistory = [];
        this.maxHistorySize = 100;
        
        // Mobile optimization
        this.isMobile = this.detectMobile();
        this.preventScroll = config.MOBILE.PREVENT_SCROLL;
        
        this.setupEventListeners();
        this.updateLayout();
    }

    /**
     * Setup event listeners for touch and mouse input
     */
    setupEventListeners() {
        // Mouse events (for desktop testing)
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this), { passive: false });
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this), { passive: false });
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this), { passive: false });
        
        // Touch events (primary input method)
        this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
        this.canvas.addEventListener('touchcancel', this.handleTouchCancel.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        
        // Prevent context menu on long press
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });
        
        // Window resize handler
        window.addEventListener('resize', this.updateLayout.bind(this));
        
        // Prevent scroll and other mobile browser behaviors
        if (this.preventScroll) {
            document.addEventListener('touchmove', (e) => {
                e.preventDefault();
            }, { passive: false });
            
            document.addEventListener('touchstart', (e) => {
                if (e.touches.length > 1) {
                    e.preventDefault(); // Prevent pinch zoom
                }
            }, { passive: false });
        }
    }

    /**
     * Update layout calculations when canvas size changes
     */
    updateLayout() {
        this.canvasRect = this.canvas.getBoundingClientRect();
        this.laneWidth = this.canvasRect.width / this.lanes;
    }

    /**
     * Set the number of lanes for input detection
     */
    setLanes(laneCount) {
        this.lanes = laneCount;
        this.updateLayout();
    }

    /**
     * Enable input processing
     */
    enable() {
        this.isEnabled = true;
    }

    /**
     * Disable input processing
     */
    disable() {
        this.isEnabled = false;
        this.activeTouches.clear();
    }

    /**
     * Calculate which lane a screen position corresponds to
     */
    screenToLane(screenX) {
        const relativeX = screenX - this.canvasRect.left;
        const laneIndex = Math.floor(relativeX / this.laneWidth);
        return Math.max(0, Math.min(this.lanes - 1, laneIndex));
    }

    /**
     * Check if a screen position is within the hit area
     */
    isInHitArea(screenX, screenY) {
        const relativeY = screenY - this.canvasRect.top;
        const hitAreaHeight = this.canvasRect.height * 0.3; // Bottom 30% of screen
        const hitAreaStart = this.canvasRect.height - hitAreaHeight;
        
        return relativeY >= hitAreaStart && relativeY <= this.canvasRect.height;
    }

    /**
     * Handle mouse down events
     */
    handleMouseDown(event) {
        if (!this.isEnabled) return;
        
        event.preventDefault();
        
        const { clientX, clientY } = event;
        if (!this.isInHitArea(clientX, clientY)) return;
        
        const lane = this.screenToLane(clientX);
        this.processLaneHit(lane, Date.now(), 'mouse');
        
        // Track for potential release
        this.activeTouches.set('mouse', {
            lane: lane,
            startTime: Date.now(),
            type: 'mouse'
        });
    }

    /**
     * Handle mouse up events
     */
    handleMouseUp(event) {
        if (!this.isEnabled) return;
        
        event.preventDefault();
        
        const mouseTouch = this.activeTouches.get('mouse');
        if (mouseTouch) {
            const holdTime = Date.now() - mouseTouch.startTime;
            this.processLaneRelease(mouseTouch.lane, holdTime, 'mouse');
            this.activeTouches.delete('mouse');
        }
    }

    /**
     * Handle mouse move events (not used for gameplay, but prevents issues)
     */
    handleMouseMove(event) {
        if (!this.isEnabled) return;
        event.preventDefault();
    }

    /**
     * Handle touch start events
     */
    handleTouchStart(event) {
        if (!this.isEnabled) return;
        
        event.preventDefault();
        
        const currentTime = Date.now();
        
        // Process each new touch
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const { clientX, clientY, identifier } = touch;
            
            if (!this.isInHitArea(clientX, clientY)) continue;
            
            const lane = this.screenToLane(clientX);
            
            // Store touch info for tracking
            this.activeTouches.set(identifier, {
                lane: lane,
                startTime: currentTime,
                type: 'touch',
                startX: clientX,
                startY: clientY
            });
            
            this.processLaneHit(lane, currentTime, 'touch');
        }
        
        // Request fullscreen and wake lock on first touch
        if (this.activeTouches.size === 1 && config.MOBILE.FULLSCREEN_ON_START) {
            this.requestMobileOptimizations();
        }
    }

    /**
     * Handle touch end events
     */
    handleTouchEnd(event) {
        if (!this.isEnabled) return;
        
        event.preventDefault();
        
        const currentTime = Date.now();
        
        // Process each ended touch
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const touchData = this.activeTouches.get(touch.identifier);
            
            if (touchData) {
                const holdTime = currentTime - touchData.startTime;
                this.processLaneRelease(touchData.lane, holdTime, 'touch');
                this.activeTouches.delete(touch.identifier);
            }
        }
    }

    /**
     * Handle touch cancel events (system interruption)
     */
    handleTouchCancel(event) {
        if (!this.isEnabled) return;
        
        event.preventDefault();
        
        // Process each cancelled touch as a release
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const touchData = this.activeTouches.get(touch.identifier);
            
            if (touchData) {
                const holdTime = Date.now() - touchData.startTime;
                this.processLaneRelease(touchData.lane, holdTime, 'touch_cancel');
                this.activeTouches.delete(touch.identifier);
            }
        }
    }

    /**
     * Handle touch move events (for hold note tracking)
     */
    handleTouchMove(event) {
        if (!this.isEnabled) return;
        
        event.preventDefault();
        
        // Check if any touches have moved out of their lanes
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const touchData = this.activeTouches.get(touch.identifier);
            
            if (touchData) {
                const newLane = this.screenToLane(touch.clientX);
                
                // If touch moved significantly out of original lane, end the hold
                if (Math.abs(newLane - touchData.lane) > 0.5) {
                    const holdTime = Date.now() - touchData.startTime;
                    this.processLaneRelease(touchData.lane, holdTime, 'touch_move');
                    this.activeTouches.delete(touch.identifier);
                }
            }
        }
    }

    /**
     * Process a lane hit
     */
    processLaneHit(lane, inputTime, inputType) {
        if (config.DEBUG.LOG_INPUT) {
            console.log(`Lane ${lane} hit at ${inputTime} (${inputType})`);
        }
        
        // Record input for analysis
        this.recordInput(lane, inputTime, 'hit', inputType);
        
        // Call callback
        if (this.onLaneHit) {
            this.onLaneHit(lane, inputTime);
        }
    }

    /**
     * Process a lane release
     */
    processLaneRelease(lane, holdTime, inputType) {
        if (config.DEBUG.LOG_INPUT) {
            console.log(`Lane ${lane} released after ${holdTime}ms (${inputType})`);
        }
        
        // Record input for analysis
        this.recordInput(lane, Date.now(), 'release', inputType, holdTime);
        
        // Call callback
        if (this.onLaneRelease) {
            this.onLaneRelease(lane, holdTime);
        }
    }

    /**
     * Record input event for performance analysis
     */
    recordInput(lane, time, action, inputType, holdTime = null) {
        const inputEvent = {
            lane,
            time,
            action, // 'hit' or 'release'
            inputType, // 'touch', 'mouse', etc.
            holdTime,
            timestamp: Date.now()
        };
        
        this.inputHistory.push(inputEvent);
        
        // Limit history size for memory management
        if (this.inputHistory.length > this.maxHistorySize) {
            this.inputHistory.shift();
        }
    }

    /**
     * Get input statistics for debugging
     */
    getInputStats() {
        const recent = this.inputHistory.slice(-50); // Last 50 inputs
        const hitEvents = recent.filter(e => e.action === 'hit');
        const releaseEvents = recent.filter(e => e.action === 'release');
        
        return {
            totalInputs: this.inputHistory.length,
            recentHits: hitEvents.length,
            recentReleases: releaseEvents.length,
            activeTouches: this.activeTouches.size,
            averageHoldTime: releaseEvents.length > 0 ? 
                releaseEvents.reduce((sum, e) => sum + (e.holdTime || 0), 0) / releaseEvents.length : 0,
            inputTypes: {
                touch: recent.filter(e => e.inputType === 'touch').length,
                mouse: recent.filter(e => e.inputType === 'mouse').length
            }
        };
    }

    /**
     * Clear input history
     */
    clearHistory() {
        this.inputHistory = [];
    }

    /**
     * Detect if running on mobile device
     */
    detectMobile() {
        return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
    }

    /**
     * Request mobile optimizations (fullscreen, orientation lock, wake lock)
     */
    async requestMobileOptimizations() {
        try {
            // Request fullscreen
            if (document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen();
            } else if (document.documentElement.webkitRequestFullscreen) {
                await document.documentElement.webkitRequestFullscreen();
            }
        } catch (error) {
            console.log('Fullscreen request failed:', error);
        }
        
        try {
            // Lock orientation to portrait
            if (screen.orientation && screen.orientation.lock) {
                await screen.orientation.lock('portrait');
            }
        } catch (error) {
            console.log('Orientation lock failed:', error);
        }
        
        try {
            // Request wake lock
            if ('wakeLock' in navigator) {
                await navigator.wakeLock.request('screen');
                console.log('Wake lock acquired');
            }
        } catch (error) {
            console.log('Wake lock failed:', error);
        }
    }

    /**
     * Update method called from game loop
     */
    update() {
        // Update canvas rect in case of layout changes
        if (this.canvasRect) {
            const newRect = this.canvas.getBoundingClientRect();
            if (newRect.width !== this.canvasRect.width || newRect.height !== this.canvasRect.height) {
                this.updateLayout();
            }
        }
        
        // Clean up old input history periodically
        if (this.inputHistory.length > this.maxHistorySize * 1.5) {
            this.inputHistory = this.inputHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * Get current active touches (for debugging/visualization)
     */
    getActiveTouches() {
        const touches = [];
        this.activeTouches.forEach((touchData, identifier) => {
            touches.push({
                id: identifier,
                lane: touchData.lane,
                holdTime: Date.now() - touchData.startTime,
                type: touchData.type
            });
        });
        return touches;
    }

    /**
     * Force release all active touches (for game state changes)
     */
    releaseAllTouches() {
        const currentTime = Date.now();
        
        this.activeTouches.forEach((touchData, identifier) => {
            const holdTime = currentTime - touchData.startTime;
            this.processLaneRelease(touchData.lane, holdTime, 'forced');
        });
        
        this.activeTouches.clear();
    }

    /**
     * Check if a specific lane is currently being held
     */
    isLanePressed(lane) {
        for (const touchData of this.activeTouches.values()) {
            if (touchData.lane === lane) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get hold time for a specific lane (0 if not pressed)
     */
    getLaneHoldTime(lane) {
        const currentTime = Date.now();
        
        for (const touchData of this.activeTouches.values()) {
            if (touchData.lane === lane) {
                return currentTime - touchData.startTime;
            }
        }
        
        return 0;
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.disable();
        
        // Remove event listeners
        this.canvas.removeEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.removeEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.removeEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.removeEventListener('touchstart', this.handleTouchStart.bind(this));
        this.canvas.removeEventListener('touchend', this.handleTouchEnd.bind(this));
        this.canvas.removeEventListener('touchcancel', this.handleTouchCancel.bind(this));
        this.canvas.removeEventListener('touchmove', this.handleTouchMove.bind(this));
        
        window.removeEventListener('resize', this.updateLayout.bind(this));
        
        console.log('Input handler destroyed');
    }
}
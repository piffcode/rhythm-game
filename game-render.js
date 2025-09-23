// game/render.js - Enhanced Canvas rendering system for rhythm game with mobile optimizations

import { config } from '../config.js';

export class GameRender {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0;
        this.height = 0;
        
        // Mobile detection and optimization flags
        this.isMobile = this.detectMobile();
        this.isLowEnd = this.detectLowEndDevice();
        this.performanceLevel = this.getPerformanceLevel();
        
        // Frame rate management
        this.targetFPS = this.isMobile ? 30 : 60;
        this.frameInterval = 1000 / this.targetFPS;
        this.lastFrameTime = 0;
        
        // Rendering state
        this.lanes = 4;
        this.laneWidth = 0;
        this.highwayHeight = 0;
        this.receptorY = 0;
        this.noteSpeed = 1.0;
        
        // Performance-based settings
        this.enableParticles = !this.isLowEnd;
        this.enableGlow = !this.isLowEnd;
        this.noteQuality = this.isLowEnd ? 'low' : 'medium';
        
        // Offscreen canvas for performance
        this.offscreenCanvas = null;
        this.offscreenCtx = null;
        
        // Visual elements
        this.particleSystem = new ParticleSystem(this.performanceLevel);
        this.hitEffects = [];
        this.comboPopups = [];
        this.visibleNotes = [];
        
        // Cached elements
        this.cachedGradients = new Map();
        this.cachedPaths = new Map();
        this.colors = this.createColorPalette();
        
        // Colors and gradients (fallback to original config)
        this.laneColors = config.VISUALS.LANE_COLORS;
        this.noteColors = config.VISUALS.NOTE_COLORS;
        this.hitEffectColors = config.VISUALS.HIT_EFFECTS;
        
        // Animation state
        this.animationTime = 0;
        this.lastAnimationFrameTime = 0;
        
        // Performance tracking
        this.frameTime = 0;
        this.renderStats = {
            notesRendered: 0,
            effectsRendered: 0,
            drawCalls: 0
        };
        
        // Initialize rendering
        this.setupCanvas();
        this.precomputeVisualElements();
        
        console.log(`GameRender initialized for ${this.performanceLevel} performance`);
    }

    /**
     * Mobile and device detection
     */
    detectMobile() {
        return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
    }

    detectLowEndDevice() {
        if (!this.isMobile) return false;
        
        const memory = navigator.deviceMemory || 4;
        const cores = navigator.hardwareConcurrency || 4;
        const isOlderDevice = /Android [4-6]|iPhone [5-8]|iPad [2-5]/i.test(navigator.userAgent);
        
        return memory <= 2 || cores <= 2 || isOlderDevice;
    }

    getPerformanceLevel() {
        if (this.isLowEnd) return 'low';
        if (this.isMobile) return 'medium';
        return 'high';
    }

    /**
     * Enhanced canvas setup with mobile optimizations
     */
    setupCanvas() {
        this.updateCanvasSize();
        
        // Optimize DPI scaling for mobile
        const dpr = this.isMobile ? Math.min(window.devicePixelRatio, 2) : window.devicePixelRatio || 1;
        const scale = this.isLowEnd ? 0.75 : 1.0;
        const rect = this.canvas.getBoundingClientRect();
        
        this.canvas.width = rect.width * dpr * scale;
        this.canvas.height = rect.height * dpr * scale;
        this.ctx.scale(dpr * scale, dpr * scale);
        
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        
        // Create offscreen canvas only for higher-end devices
        if (!this.isLowEnd) {
            this.offscreenCanvas = new OffscreenCanvas(
                this.canvas.width / (this.isMobile ? 2 : 1),
                this.canvas.height / (this.isMobile ? 2 : 1)
            );
            this.offscreenCtx = this.offscreenCanvas.getContext('2d');
            this.offscreenCtx.scale(dpr * scale, dpr * scale);
        }
        
        // Optimize rendering properties based on device
        this.ctx.imageSmoothingEnabled = !this.isLowEnd;
        this.ctx.imageSmoothingQuality = this.isLowEnd ? 'low' : this.isMobile ? 'medium' : 'high';
        
        if (this.offscreenCtx) {
            this.offscreenCtx.imageSmoothingEnabled = !this.isLowEnd;
            this.offscreenCtx.imageSmoothingQuality = this.isLowEnd ? 'low' : 'medium';
        }
        
        // Mobile-specific optimizations
        if (this.isMobile) {
            this.canvas.style.willChange = 'transform';
            this.canvas.style.transform = 'translateZ(0)';
        }
        
        console.log(`Canvas optimized: ${rect.width}x${rect.height} (DPR: ${dpr}, Scale: ${scale})`);
    }

    /**
     * Update canvas size and layout calculations
     */
    updateCanvasSize() {
        const rect = this.canvas.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        
        // Calculate layout with mobile considerations
        this.laneWidth = this.width / this.lanes;
        this.highwayHeight = this.height * config.VISUALS.HIGHWAY_LENGTH;
        this.receptorY = this.height - (this.height - this.highwayHeight) * 0.5;
        
        // Adjust note speed based on performance level
        const baseSpeed = this.highwayHeight / 1500;
        this.noteSpeed = this.isMobile ? baseSpeed * 0.8 : baseSpeed;
    }

    /**
     * Precompute visual elements for better performance
     */
    precomputeVisualElements() {
        this.createOptimizedGradients();
        this.createNotePaths();
    }

    createOptimizedGradients() {
        // Simplified gradients for low-end devices
        if (this.performanceLevel === 'low') {
            this.cachedGradients.set('highway', 'rgba(0, 0, 20, 0.9)');
        } else {
            const gradient = this.ctx.createLinearGradient(0, 0, 0, this.height);
            gradient.addColorStop(0, 'rgba(0, 0, 0, 0.8)');
            gradient.addColorStop(0.3, 'rgba(20, 20, 40, 0.9)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
            this.cachedGradients.set('highway', gradient);
        }
        
        // Receptor glow (disabled on low-end)
        if (this.enableGlow) {
            const receptorGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
            receptorGradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
            receptorGradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.3)');
            receptorGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            this.cachedGradients.set('receptor', receptorGradient);
        }
    }

    createNotePaths() {
        const noteSize = this.isMobile ? 20 : config.VISUALS.NOTE_SIZE || 25;
        
        // Regular note path
        const regularNote = new Path2D();
        regularNote.arc(0, 0, noteSize, 0, Math.PI * 2);
        this.cachedPaths.set('note', regularNote);
        
        // Hold note path
        const holdNote = new Path2D();
        holdNote.rect(-noteSize * 0.8, -noteSize * 0.4, noteSize * 1.6, noteSize * 0.8);
        this.cachedPaths.set('hold', holdNote);
        
        // Receptor path
        const receptor = new Path2D();
        receptor.arc(0, 0, (config.VISUALS.RECEPTOR_SIZE || 30) * (this.isMobile ? 0.8 : 1), 0, Math.PI * 2);
        this.cachedPaths.set('receptor', receptor);
    }

    createColorPalette() {
        return {
            lanes: this.laneColors || ['#ff0080', '#0080ff', '#80ff00', '#ff8000'],
            hitEffects: this.hitEffectColors || {
                PERFECT: '#00ff00',
                GREAT: '#ffff00',
                GOOD: '#ff8000',
                MISS: '#ff0000'
            },
            notes: {
                normal: this.noteColors?.NORMAL || '#ffffff',
                hold: this.noteColors?.HOLD || '#ffff80'
            }
        };
    }

    /**
     * Frame rate management
     */
    shouldRender(currentTime) {
        if (currentTime - this.lastFrameTime < this.frameInterval) {
            return false;
        }
        this.lastFrameTime = currentTime;
        return true;
    }

    /**
     * Update visible notes for culling
     */
    updateVisibleNotes(gameState) {
        if (!gameState.activeNotes) {
            this.visibleNotes = [];
            return;
        }
        
        const screenMargin = 100;
        const approachTime = gameState.approachTime || 1500;
        
        this.visibleNotes = gameState.activeNotes.filter(note => {
            const timeDiff = note.time - gameState.gameTime;
            const progress = 1 - (timeDiff / approachTime);
            const y = progress * this.highwayHeight;
            
            return y >= -screenMargin && y <= this.height + screenMargin;
        });
    }

    /**
     * Set the number of lanes
     */
    setLanes(laneCount) {
        this.lanes = laneCount;
        this.updateCanvasSize();
    }

    /**
     * Main render method with performance optimizations
     */
    render(gameState) {
        const startTime = performance.now();
        
        // Frame rate throttling for mobile
        if (this.isMobile && !this.shouldRender(startTime)) {
            return;
        }
        
        // Update animation time
        const currentTime = Date.now();
        const deltaTime = currentTime - this.lastAnimationFrameTime;
        this.animationTime += deltaTime;
        this.lastAnimationFrameTime = currentTime;
        
        // Clear canvas with solid color (faster than gradients on mobile)
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.width, this.height);
        
        // Reset render stats
        this.renderStats = { notesRendered: 0, effectsRendered: 0, drawCalls: 0 };
        
        if (!gameState.isPlaying && !gameState.isPaused) {
            this.frameTime = performance.now() - startTime;
            return;
        }
        
        // Update visual settings based on game state
        if (gameState.lanes !== this.lanes) {
            this.setLanes(gameState.lanes);
        }
        
        // Update culling
        this.updateVisibleNotes(gameState);
        
        // Render game elements
        this.renderHighway();
        this.renderLanes();
        this.renderReceptors(gameState);
        this.renderNotesOptimized(gameState);
        
        // Skip expensive effects on low-end devices
        if (!this.isLowEnd) {
            this.renderHitEffects(deltaTime);
            this.renderComboPopups(deltaTime);
            
            if (this.enableParticles) {
                this.renderParticles(deltaTime);
            }
        } else {
            // Simplified effects for low-end devices
            this.renderHitEffectsSimplified(deltaTime);
        }
        
        // Debug rendering (disabled on mobile by default)
        if (config.DEBUG.SHOW_HITBOXES && !this.isMobile) {
            this.renderDebugHitboxes(gameState);
        }
        
        if (config.DEBUG.SHOW_FPS) {
            this.renderFPS(gameState.fps);
        }
        
        // Update particle system
        if (this.enableParticles) {
            this.particleSystem.update(deltaTime);
        }
        
        this.frameTime = performance.now() - startTime;
    }

    /**
     * Optimized highway rendering
     */
    renderHighway() {
        const gradient = this.cachedGradients.get('highway');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.renderStats.drawCalls++;
        
        // Skip animated patterns on low-end devices
        if (this.performanceLevel === 'low') return;
        
        // Simplified animation pattern
        this.ctx.save();
        this.ctx.globalAlpha = this.isMobile ? 0.05 : 0.1;
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1;
        
        const lineSpacing = this.isMobile ? 75 : 50;
        const offset = (this.animationTime * 0.05) % lineSpacing;
        
        for (let y = offset; y < this.height; y += lineSpacing) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
            this.ctx.stroke();
        }
        
        this.ctx.restore();
        this.renderStats.drawCalls++;
    }

    /**
     * Optimized lane rendering
     */
    renderLanes() {
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = this.isLowEnd ? 1 : 2;
        
        for (let i = 1; i < this.lanes; i++) {
            const x = i * this.laneWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
            this.ctx.stroke();
        }
        
        this.renderStats.drawCalls++;
    }

    /**
     * Optimized receptor rendering
     */
    renderReceptors(gameState) {
        const receptorPath = this.cachedPaths.get('receptor');
        const glowIntensity = this.enableGlow ? Math.sin(this.animationTime * 0.005) * 0.3 + 0.7 : 1;
        
        for (let i = 0; i < this.lanes; i++) {
            const centerX = (i + 0.5) * this.laneWidth;
            const centerY = this.receptorY;
            const laneColor = this.colors.lanes[i] || '#ffffff';
            
            this.ctx.save();
            this.ctx.translate(centerX, centerY);
            
            if (this.enableGlow) {
                // Glow effect
                this.ctx.globalAlpha = glowIntensity * 0.5;
                this.ctx.shadowBlur = 15;
                this.ctx.shadowColor = laneColor;
                this.ctx.strokeStyle = laneColor;
                this.ctx.lineWidth = 4;
                this.ctx.stroke(receptorPath);
                this.ctx.shadowBlur = 0;
            } else {
                // Simple receptor
                this.ctx.strokeStyle = laneColor;
                this.ctx.lineWidth = 3;
                this.ctx.stroke(receptorPath);
            }
            
            this.ctx.restore();
        }
        
        this.renderStats.drawCalls += this.lanes;
    }

    /**
     * Optimized note rendering with batching
     */
    renderNotesOptimized(gameState) {
        if (!this.visibleNotes.length) return;
        
        const approachTime = gameState.approachTime || 1500;
        
        // Batch notes by type
        const regularNotes = [];
        const holdNotes = [];
        
        this.visibleNotes.forEach(note => {
            if (note.type === 'hold') {
                holdNotes.push(note);
            } else {
                regularNotes.push(note);
            }
        });
        
        // Render hold notes first
        this.renderHoldNotesBatch(holdNotes, approachTime, gameState.gameTime);
        
        // Render regular notes
        this.renderRegularNotesBatch(regularNotes, approachTime, gameState.gameTime);
        
        this.renderStats.notesRendered = this.visibleNotes.length;
    }

    renderRegularNotesBatch(notes, approachTime, gameTime) {
        const notePath = this.cachedPaths.get('note');
        
        notes.forEach(note => {
            if (note.isHit) return;
            
            const timeDiff = note.time - gameTime;
            const progress = 1 - (timeDiff / approachTime);
            const y = progress * this.highwayHeight;
            const centerX = (note.lane + 0.5) * this.laneWidth;
            const laneColor = this.colors.lanes[note.lane] || '#ffffff';
            
            this.ctx.save();
            this.ctx.translate(centerX, y);
            
            if (this.performanceLevel === 'low') {
                // Simple solid note
                this.ctx.fillStyle = this.colors.notes.normal;
                this.ctx.fill(notePath);
            } else {
                // Enhanced note with glow
                const alpha = Math.max(0.3, Math.min(1, progress * 2));
                
                if (this.enableGlow) {
                    this.ctx.globalAlpha = alpha * 0.5;
                    this.ctx.shadowBlur = 10;
                    this.ctx.shadowColor = laneColor;
                }
                
                this.ctx.fillStyle = this.colors.notes.normal;
                this.ctx.strokeStyle = laneColor;
                this.ctx.lineWidth = 2;
                this.ctx.fill(notePath);
                this.ctx.stroke(notePath);
                
                if (this.enableGlow) {
                    this.ctx.shadowBlur = 0;
                }
            }
            
            this.ctx.restore();
        });
        
        this.renderStats.drawCalls += notes.length;
    }

    renderHoldNotesBatch(notes, approachTime, gameTime) {
        const holdPath = this.cachedPaths.get('hold');
        
        notes.forEach(note => {
            if (note.isHit) return;
            
            const startTimeDiff = note.time - gameTime;
            const endTimeDiff = note.endTime - gameTime;
            const startProgress = 1 - (startTimeDiff / approachTime);
            const endProgress = 1 - (endTimeDiff / approachTime);
            
            const startY = startProgress * this.highwayHeight;
            const endY = endProgress * this.highwayHeight;
            const centerX = (note.lane + 0.5) * this.laneWidth;
            const laneColor = this.colors.lanes[note.lane] || '#ffffff';
            
            // Hold body
            if (Math.abs(startY - endY) > 1) {
                this.ctx.strokeStyle = laneColor;
                this.ctx.lineWidth = this.isLowEnd ? 8 : 12;
                this.ctx.globalAlpha = 0.7;
                this.ctx.lineCap = 'round';
                
                this.ctx.beginPath();
                this.ctx.moveTo(centerX, startY);
                this.ctx.lineTo(centerX, endY);
                this.ctx.stroke();
            }
            
            // Hold caps
            this.ctx.save();
            this.ctx.translate(centerX, startY);
            this.ctx.globalAlpha = 0.9;
            this.ctx.fillStyle = this.colors.notes.hold;
            this.ctx.strokeStyle = laneColor;
            this.ctx.lineWidth = 3;
            this.ctx.fill(holdPath);
            this.ctx.stroke(holdPath);
            this.ctx.restore();
        });
        
        this.renderStats.drawCalls += notes.length * 2;
    }

    /**
     * Render hit effects with performance considerations
     */
    renderHitEffects(deltaTime) {
        this.hitEffects = this.hitEffects.filter(effect => {
            effect.age += deltaTime;
            effect.alpha = Math.max(0, 1 - (effect.age / effect.duration));
            
            if (effect.alpha <= 0) return false;
            
            const centerX = (effect.lane + 0.5) * this.laneWidth;
            const centerY = this.receptorY;
            
            this.ctx.save();
            this.ctx.translate(centerX, centerY);
            this.ctx.globalAlpha = effect.alpha;
            
            // Hit effect ring
            const radius = (effect.age / effect.duration) * (this.isMobile ? 40 : 60);
            this.ctx.strokeStyle = effect.color;
            this.ctx.lineWidth = this.isMobile ? 3 : 4;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
            this.ctx.stroke();
            
            // Hit text (reduced on mobile)
            if (effect.text && effect.age < effect.duration * 0.7 && !this.isMobile) {
                this.ctx.fillStyle = effect.color;
                this.ctx.font = 'bold 24px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(effect.text, 0, -40);
            }
            
            this.ctx.restore();
            this.renderStats.effectsRendered++;
            
            return true;
        });
    }

    /**
     * Simplified hit effects for low-end devices
     */
    renderHitEffectsSimplified(deltaTime) {
        this.hitEffects = this.hitEffects.filter(effect => {
            effect.age += deltaTime;
            
            if (effect.age > 500) return false; // Shorter duration
            
            const centerX = (effect.lane + 0.5) * this.laneWidth;
            const centerY = this.receptorY;
            const alpha = 1 - (effect.age / 500);
            
            this.ctx.save();
            this.ctx.translate(centerX, centerY);
            this.ctx.globalAlpha = alpha;
            this.ctx.fillStyle = effect.color;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 20, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
            
            this.renderStats.effectsRendered++;
            return true;
        });
    }

    /**
     * Render combo popups with mobile optimizations
     */
    renderComboPopups(deltaTime) {
        this.comboPopups = this.comboPopups.filter(popup => {
            popup.age += deltaTime;
            popup.y -= deltaTime * (this.isMobile ? 0.03 : 0.05);
            popup.alpha = Math.max(0, 1 - (popup.age / popup.duration));
            
            if (popup.alpha <= 0) return false;
            
            this.ctx.save();
            this.ctx.globalAlpha = popup.alpha;
            this.ctx.fillStyle = popup.color;
            
            const fontSize = this.isMobile ? popup.size * 0.7 : popup.size;
            this.ctx.font = `bold ${fontSize}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            
            if (!this.isLowEnd) {
                this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
                this.ctx.lineWidth = 3;
                this.ctx.strokeText(popup.text, popup.x, popup.y);
            }
            
            this.ctx.fillText(popup.text, popup.x, popup.y);
            this.ctx.restore();
            
            this.renderStats.effectsRendered++;
            return true;
        });
    }

    /**
     * Render particle effects
     */
    renderParticles(deltaTime) {
        if (!this.enableParticles) return;
        
        this.particleSystem.render(this.ctx);
        this.renderStats.effectsRendered += this.particleSystem.getParticleCount();
    }

    /**
     * Add hit effect with mobile considerations
     */
    addHitEffect(lane, hitType, score) {
        const color = this.colors.hitEffects[hitType] || '#ffffff';
        const text = hitType === 'PERFECT' ? 'PERFECT!' : 
                     hitType === 'GREAT' ? 'GREAT!' :
                     hitType === 'GOOD' ? 'GOOD' : 'MISS';
        
        this.hitEffects.push({
            lane: lane,
            color: color,
            text: this.isMobile ? '' : text, // No text on mobile
            age: 0,
            duration: this.isMobile ? 800 : 1000,
            alpha: 1
        });
        
        // Add particles for successful hits
        if (hitType !== 'MISS' && this.enableParticles) {
            const centerX = (lane + 0.5) * this.laneWidth;
            const centerY = this.receptorY;
            const particleCount = this.isMobile ? 
                (hitType === 'PERFECT' ? 8 : 4) : 
                (hitType === 'PERFECT' ? 15 : 8);
            
            this.particleSystem.burst(centerX, centerY, color, particleCount);
        }
    }

    /**
     * Add combo popup with mobile scaling
     */
    addComboPopup(combo, score) {
        if (combo < 10) return;
        
        const baseSize = this.isMobile ? 16 : 18;
        const size = Math.min(this.isMobile ? 28 : 36, baseSize + combo * 0.2);
        const centerX = this.width * 0.5;
        const centerY = this.height * (this.isMobile ? 0.25 : 0.3);
        
        this.comboPopups.push({
            text: `${combo}x COMBO!`,
            x: centerX,
            y: centerY,
            size: size,
            color: combo >= 50 ? '#ff00ff' : combo >= 25 ? '#ffff00' : '#00ff00',
            age: 0,
            duration: this.isMobile ? 1200 : 1500,
            alpha: 1
        });
    }

    /**
     * Render debug hitboxes (desktop only)
     */
    renderDebugHitboxes(gameState) {
        if (this.isMobile) return;
        
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        
        // Hit area
        const hitAreaHeight = this.height * 0.3;
        const hitAreaY = this.height - hitAreaHeight;
        this.ctx.strokeRect(0, hitAreaY, this.width, hitAreaHeight);
        
        // Lane boundaries
        for (let i = 0; i <= this.lanes; i++) {
            const x = i * this.laneWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(x, hitAreaY);
            this.ctx.lineTo(x, this.height);
            this.ctx.stroke();
        }
        
        // Timing windows
        const perfect = config.TIMING_WINDOWS.PERFECT / 1500 * this.highwayHeight;
        const great = config.TIMING_WINDOWS.GREAT / 1500 * this.highwayHeight;
        const good = config.TIMING_WINDOWS.GOOD / 1500 * this.highwayHeight;
        
        this.ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
        this.ctx.strokeRect(0, this.receptorY - perfect, this.width, perfect * 2);
        
        this.ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
        this.ctx.strokeRect(0, this.receptorY - great, this.width, great * 2);
        
        this.ctx.strokeStyle = 'rgba(255, 127, 0, 0.5)';
        this.ctx.strokeRect(0, this.receptorY - good, this.width, good * 2);
        
        this.ctx.restore();
    }

    /**
     * Render FPS counter with performance stats
     */
    renderFPS(fps) {
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        const width = this.isMobile ? 120 : 150;
        const height = this.isMobile ? 70 : 80;
        this.ctx.fillRect(10, 10, width, height);
        
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = this.isMobile ? '12px monospace' : '14px monospace';
        this.ctx.textAlign = 'left';
        
        let y = 25;
        const lineHeight = this.isMobile ? 12 : 15;
        
        this.ctx.fillText(`FPS: ${fps}`, 15, y);
        y += lineHeight;
        this.ctx.fillText(`Frame: ${this.frameTime.toFixed(1)}ms`, 15, y);
        y += lineHeight;
        this.ctx.fillText(`Notes: ${this.renderStats.notesRendered}`, 15, y);
        
        if (!this.isMobile) {
            y += lineHeight;
            this.ctx.fillText(`Level: ${this.performanceLevel}`, 15, y);
            y += lineHeight;
            this.ctx.fillText(`Particles: ${this.particleSystem.getParticleCount()}`, 15, y);
        }
        
        this.ctx.restore();
    }

    /**
     * Get rendering statistics including mobile optimizations
     */
    getRenderStats() {
        return {
            ...this.renderStats,
            frameTime: this.frameTime,
            performanceLevel: this.performanceLevel,
            isMobile: this.isMobile,
            isLowEnd: this.isLowEnd,
            enableParticles: this.enableParticles,
            enableGlow: this.enableGlow,
            targetFPS: this.targetFPS,
            visibleNotes: this.visibleNotes.length,
            particleCount: this.particleSystem.getParticleCount(),
            effectCount: this.hitEffects.length + this.comboPopups.length,
            canvasSize: { width: this.width, height: this.height },
            memoryUsage: this.getMemoryUsage()
        };
    }

    /**
     * Get estimated memory usage
     */
    getMemoryUsage() {
        const particleMemory = this.particleSystem.getParticleCount() * 50; // bytes per particle
        const effectMemory = (this.hitEffects.length + this.comboPopups.length) * 100;
        const canvasMemory = this.canvas.width * this.canvas.height * 4; // RGBA
        
        return {
            particles: particleMemory,
            effects: effectMemory,
            canvas: canvasMemory,
            total: particleMemory + effectMemory + canvasMemory
        };
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.particleSystem.clear();
        this.hitEffects = [];
        this.comboPopups = [];
        this.visibleNotes = [];
        
        this.cachedGradients.clear();
        this.cachedPaths.clear();
        
        if (this.offscreenCanvas) {
            this.offscreenCanvas = null;
            this.offscreenCtx = null;
        }
        
        console.log('Enhanced renderer destroyed');
    }
}

/**
 * Enhanced particle system with performance levels
 */
class ParticleSystem {
    constructor(performanceLevel = 'high') {
        this.particles = [];
        this.performanceLevel = performanceLevel;
        
        // Adjust limits based on performance
        this.maxParticles = performanceLevel === 'high' ? 200 : 
                           performanceLevel === 'medium' ? 100 : 50;
        
        this.particleSize = performanceLevel === 'low' ? 2 : 3;
        this.gravity = performanceLevel === 'low' ? 0.005 : 0.01;
    }

    /**
     * Create a burst of particles
     */
    burst(x, y, color, count = 10) {
        // Reduce particle count based on performance level
        const actualCount = Math.min(count, this.maxParticles - this.particles.length);
        
        for (let i = 0; i < actualCount; i++) {
            const angle = (Math.PI * 2 * i) / actualCount + Math.random() * 0.5;
            const speed = this.performanceLevel === 'low' ? 1 + Math.random() * 2 : 2 + Math.random() * 3;
            
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: color,
                size: this.particleSize + Math.random() * 2,
                life: 1.0,
                decay: this.performanceLevel === 'low' ? 0.03 + Math.random() * 0.02 : 0.02 + Math.random() * 0.02
            });
        }
    }

    /**
     * Update particles with performance considerations
     */
    update(deltaTime) {
        const dt = Math.min(deltaTime, 50); // Cap delta time for stability
        
        this.particles = this.particles.filter(particle => {
            particle.x += particle.vx * dt * 0.1;
            particle.y += particle.vy * dt * 0.1;
            particle.vy += this.gravity * dt;
            particle.life -= particle.decay * dt * 0.01;
            
            return particle.life > 0;
        });
    }

    /**
     * Render particles with batching
     */
    render(ctx) {
        if (!this.particles.length) return;
        
        ctx.save();
        
        // Batch particles by color for better performance
        const colorGroups = new Map();
        
        this.particles.forEach(particle => {
            if (!colorGroups.has(particle.color)) {
                colorGroups.set(particle.color, []);
            }
            colorGroups.get(particle.color).push(particle);
        });
        
        // Render each color group together
        colorGroups.forEach((particles, color) => {
            ctx.fillStyle = color;
            
            particles.forEach(particle => {
                ctx.globalAlpha = particle.life;
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
                ctx.fill();
            });
        });
        
        ctx.restore();
    }

    /**
     * Get particle count
     */
    getParticleCount() {
        return this.particles.length;
    }

    /**
     * Clear all particles
     */
    clear() {
        this.particles = [];
    }
}

/**
 * Mobile optimization utilities
 */
export class MobileOptimizer {
    static applyGlobalOptimizations() {
        // Disable context menu on mobile
        document.addEventListener('contextmenu', e => {
            if (this.isMobile()) {
                e.preventDefault();
            }
        });
        
        // Prevent zoom on double-tap
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        });
        
        // Prevent scroll bounce
        document.body.style.overscrollBehavior = 'none';
        document.body.style.touchAction = 'manipulation';
        
        // Force hardware acceleration
        const canvas = document.querySelector('canvas');
        if (canvas) {
            canvas.style.willChange = 'transform';
            canvas.style.transform = 'translateZ(0)';
        }
        
        // Optimize viewport for mobile
        const meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
        
        const existingMeta = document.querySelector('meta[name="viewport"]');
        if (existingMeta) {
            existingMeta.remove();
        }
        document.head.appendChild(meta);
        
        // Request persistent storage
        if ('storage' in navigator && 'persist' in navigator.storage) {
            navigator.storage.persist().then(granted => {
                console.log('Persistent storage:', granted ? 'granted' : 'denied');
            });
        }
        
        // Request wake lock for gaming sessions
        if ('wakeLock' in navigator) {
            this.requestWakeLock();
        }
        
        console.log('Mobile optimizations applied');
    }
    
    static async requestWakeLock() {
        try {
            const wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake lock active');
            
            // Re-request wake lock if page becomes visible
            document.addEventListener('visibilitychange', async () => {
                if (document.visibilityState === 'visible') {
                    await navigator.wakeLock.request('screen');
                }
            });
        } catch (err) {
            console.log('Wake lock failed:', err);
        }
    }
    
    static optimizeForLowEnd() {
        // Reduce animation complexity
        document.documentElement.style.setProperty('--animation-duration', '0.1s');
        document.documentElement.style.setProperty('--transition-duration', '0.1s');
        
        // Disable expensive CSS effects
        const style = document.createElement('style');
        style.textContent = `
            * {
                backface-visibility: hidden;
                perspective: 1000px;
                transform-style: preserve-3d;
            }
            
            .low-performance * {
                transition: none !important;
                animation-duration: 0.1s !important;
                box-shadow: none !important;
                text-shadow: none !important;
                filter: none !important;
            }
            
            .low-performance .particle-effects {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
        
        // Add class for low-end device optimizations
        if (this.isLowEndDevice()) {
            document.body.classList.add('low-performance');
        }
        
        console.log('Low-end optimizations applied');
    }
    
    static isMobile() {
        return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
    }
    
    static isLowEndDevice() {
        if (!this.isMobile()) return false;
        
        const memory = navigator.deviceMemory || 4;
        const cores = navigator.hardwareConcurrency || 4;
        const isOlderDevice = /Android [4-6]|iPhone [5-8]|iPad [2-5]/i.test(navigator.userAgent);
        
        return memory <= 2 || cores <= 2 || isOlderDevice;
    }
    
    static getDeviceInfo() {
        return {
            isMobile: this.isMobile(),
            isLowEnd: this.isLowEndDevice(),
            memory: navigator.deviceMemory || 'unknown',
            cores: navigator.hardwareConcurrency || 'unknown',
            userAgent: navigator.userAgent,
            pixelRatio: window.devicePixelRatio || 1,
            screenSize: {
                width: screen.width,
                height: screen.height
            },
            viewportSize: {
                width: window.innerWidth,
                height: window.innerHeight
            }
        };
    }
}

// Auto-apply optimizations when module loads
if (typeof window !== 'undefined') {
    // Apply optimizations after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            MobileOptimizer.applyGlobalOptimizations();
            if (MobileOptimizer.isLowEndDevice()) {
                MobileOptimizer.optimizeForLowEnd();
            }
        });
    } else {
        MobileOptimizer.applyGlobalOptimizations();
        if (MobileOptimizer.isLowEndDevice()) {
            MobileOptimizer.optimizeForLowEnd();
        }
    }
}

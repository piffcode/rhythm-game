// game/render.js - Canvas rendering system for the rhythm game

import { config } from '../config.js';

export class GameRender {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0;
        this.height = 0;
        
        // Rendering state
        this.lanes = 4;
        this.laneWidth = 0;
        this.highwayHeight = 0;
        this.receptorY = 0;
        this.noteSpeed = 1.0;
        
        // Offscreen canvas for performance
        this.offscreenCanvas = null;
        this.offscreenCtx = null;
        
        // Visual elements
        this.particleSystem = new ParticleSystem();
        this.hitEffects = [];
        this.comboPopups = [];
        
        // Colors and gradients
        this.laneColors = config.VISUALS.LANE_COLORS;
        this.noteColors = config.VISUALS.NOTE_COLORS;
        this.hitEffectColors = config.VISUALS.HIT_EFFECTS;
        
        // Animation state
        this.animationTime = 0;
        this.lastFrameTime = 0;
        
        // Performance tracking
        this.frameTime = 0;
        this.renderStats = {
            notesRendered: 0,
            effectsRendered: 0,
            drawCalls: 0
        };
        
        // Initialize rendering
        this.setupCanvas();
        this.createGradients();
    }

    /**
     * Setup canvas and rendering context
     */
    setupCanvas() {
        this.updateCanvasSize();
        
        // Set high DPI support
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        
        // Create offscreen canvas for better performance
        this.offscreenCanvas = new OffscreenCanvas(this.canvas.width, this.canvas.height);
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
        this.offscreenCtx.scale(dpr, dpr);
        
        // Set rendering properties
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        this.offscreenCtx.imageSmoothingEnabled = true;
        this.offscreenCtx.imageSmoothingQuality = 'high';
        
        console.log(`Canvas initialized: ${rect.width}x${rect.height} (DPR: ${dpr})`);
    }

    /**
     * Update canvas size and layout calculations
     */
    updateCanvasSize() {
        const rect = this.canvas.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        
        // Calculate layout
        this.laneWidth = this.width / this.lanes;
        this.highwayHeight = this.height * config.VISUALS.HIGHWAY_LENGTH;
        this.receptorY = this.height - (this.height - this.highwayHeight) * 0.5;
        
        // Calculate note speed based on approach time
        // Notes travel from top of highway to receptors
        this.noteSpeed = this.highwayHeight / 1500; // pixels per ms for normal difficulty
    }

    /**
     * Set the number of lanes
     */
    setLanes(laneCount) {
        this.lanes = laneCount;
        this.updateCanvasSize();
    }

    /**
     * Create gradients and cached visual elements
     */
    createGradients() {
        // Highway background gradient
        this.highwayGradient = this.ctx.createLinearGradient(0, 0, 0, this.height);
        this.highwayGradient.addColorStop(0, 'rgba(0, 0, 0, 0.8)');
        this.highwayGradient.addColorStop(0.3, 'rgba(20, 20, 40, 0.9)');
        this.highwayGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
        
        // Receptor glow gradient
        this.receptorGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
        this.receptorGradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        this.receptorGradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.3)');
        this.receptorGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    }

    /**
     * Main render method
     */
    render(gameState) {
        const startTime = performance.now();
        
        // Update animation time
        const currentTime = Date.now();
        const deltaTime = currentTime - this.lastFrameTime;
        this.animationTime += deltaTime;
        this.lastFrameTime = currentTime;
        
        // Clear canvas
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
        
        // Render game elements
        this.renderHighway();
        this.renderLanes();
        this.renderReceptors(gameState);
        this.renderNotes(gameState);
        this.renderHitEffects(deltaTime);
        this.renderComboPopups(deltaTime);
        this.renderParticles(deltaTime);
        
        // Debug rendering
        if (config.DEBUG.SHOW_HITBOXES) {
            this.renderDebugHitboxes(gameState);
        }
        
        if (config.DEBUG.SHOW_FPS) {
            this.renderFPS(gameState.fps);
        }
        
        // Update particle system
        this.particleSystem.update(deltaTime);
        
        this.frameTime = performance.now() - startTime;
    }

    /**
     * Render the highway background
     */
    renderHighway() {
        this.ctx.fillStyle = this.highwayGradient;
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.renderStats.drawCalls++;
        
        // Add subtle animation pattern
        this.ctx.save();
        this.ctx.globalAlpha = 0.1;
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1;
        
        // Moving lines for depth effect
        const lineSpacing = 50;
        const offset = (this.animationTime * 0.1) % lineSpacing;
        
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
     * Render lane dividers
     */
    renderLanes() {
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = 2;
        
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
     * Render receptor areas (hit targets)
     */
    renderReceptors(gameState) {
        const receptorSize = config.VISUALS.RECEPTOR_SIZE;
        const glowIntensity = Math.sin(this.animationTime * 0.005) * 0.3 + 0.7;
        
        for (let i = 0; i < this.lanes; i++) {
            const centerX = (i + 0.5) * this.laneWidth;
            const centerY = this.receptorY;
            
            // Lane-specific color
            const laneColor = this.laneColors[i] || '#ffffff';
            
            this.ctx.save();
            this.ctx.translate(centerX, centerY);
            
            // Outer glow
            this.ctx.globalAlpha = glowIntensity * 0.5;
            this.ctx.fillStyle = laneColor;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, receptorSize * 0.8, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Inner receptor
            this.ctx.globalAlpha = 0.9;
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            this.ctx.strokeStyle = laneColor;
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, receptorSize * 0.4, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
            
            this.ctx.restore();
        }
        
        this.renderStats.drawCalls += this.lanes * 2;
    }

    /**
     * Render notes
     */
    renderNotes(gameState) {
        if (!gameState.activeNotes) return;
        
        const approachTime = gameState.approachTime || 1500;
        
        gameState.activeNotes.forEach(note => {
            this.renderNote(note, approachTime, gameState.gameTime);
            this.renderStats.notesRendered++;
        });
    }

    /**
     * Render a single note
     */
    renderNote(note, approachTime, gameTime) {
        if (note.isHit) return;
        
        // Calculate position
        const timeDiff = note.time - gameTime;
        const progress = 1 - (timeDiff / approachTime);
        const y = progress * this.highwayHeight;
        const centerX = (note.lane + 0.5) * this.laneWidth;
        
        // Don't render notes that are off-screen
        if (y < -50 || y > this.height + 50) return;
        
        const noteSize = config.VISUALS.NOTE_SIZE;
        const laneColor = this.laneColors[note.lane] || '#ffffff';
        
        this.ctx.save();
        this.ctx.translate(centerX, y);
        
        if (note.type === 'hold') {
            this.renderHoldNote(note, approachTime, gameTime, laneColor);
        } else {
            this.renderTapNote(note, laneColor, progress);
        }
        
        this.ctx.restore();
        this.renderStats.drawCalls++;
    }

    /**
     * Render a tap note
     */
    renderTapNote(note, laneColor, progress) {
        const noteSize = config.VISUALS.NOTE_SIZE;
        const alpha = Math.max(0.3, Math.min(1, progress * 2)); // Fade in as approaching
        
        // Note glow
        this.ctx.globalAlpha = alpha * 0.5;
        this.ctx.fillStyle = laneColor;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, noteSize * 0.8, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Note body
        this.ctx.globalAlpha = alpha;
        this.ctx.fillStyle = config.VISUALS.NOTE_COLORS.NORMAL;
        this.ctx.strokeStyle = laneColor;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, noteSize * 0.5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        
        // Inner highlight
        this.ctx.globalAlpha = alpha * 0.8;
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        this.ctx.beginPath();
        this.ctx.arc(-noteSize * 0.2, -noteSize * 0.2, noteSize * 0.2, 0, Math.PI * 2);
        this.ctx.fill();
    }

    /**
     * Render a hold note
     */
    renderHoldNote(note, approachTime, gameTime, laneColor) {
        const noteSize = config.VISUALS.NOTE_SIZE;
        const startTimeDiff = note.time - gameTime;
        const endTimeDiff = note.endTime - gameTime;
        
        const startProgress = 1 - (startTimeDiff / approachTime);
        const endProgress = 1 - (endTimeDiff / approachTime);
        
        const startY = startProgress * this.highwayHeight;
        const endY = endProgress * this.highwayHeight;
        
        // Hold body (line connecting start and end)
        if (startY !== endY) {
            this.ctx.strokeStyle = laneColor;
            this.ctx.lineWidth = noteSize * 0.6;
            this.ctx.globalAlpha = 0.7;
            this.ctx.lineCap = 'round';
            
            this.ctx.beginPath();
            this.ctx.moveTo(0, -startY);
            this.ctx.lineTo(0, -endY);
            this.ctx.stroke();
        }
        
        // Hold start note (rendered at current position)
        this.ctx.globalAlpha = 0.9;
        this.ctx.fillStyle = config.VISUALS.NOTE_COLORS.HOLD;
        this.ctx.strokeStyle = laneColor;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.rect(-noteSize * 0.4, -noteSize * 0.3, noteSize * 0.8, noteSize * 0.6);
        this.ctx.fill();
        this.ctx.stroke();
        
        // Hold end indicator (if visible)
        if (endY >= 0 && endY <= this.height) {
            this.ctx.save();
            this.ctx.translate(0, -endY);
            this.ctx.globalAlpha = 0.8;
            this.ctx.fillStyle = config.VISUALS.NOTE_COLORS.HOLD;
            this.ctx.strokeStyle = laneColor;
            this.ctx.beginPath();
            this.ctx.rect(-noteSize * 0.3, -noteSize * 0.2, noteSize * 0.6, noteSize * 0.4);
            this.ctx.fill();
            this.ctx.stroke();
            this.ctx.restore();
        }
    }

    /**
     * Render hit effects
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
            const radius = (effect.age / effect.duration) * 60;
            this.ctx.strokeStyle = effect.color;
            this.ctx.lineWidth = 4;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
            this.ctx.stroke();
            
            // Hit text
            if (effect.text && effect.age < effect.duration * 0.7) {
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
     * Render combo popups
     */
    renderComboPopups(deltaTime) {
        this.comboPopups = this.comboPopups.filter(popup => {
            popup.age += deltaTime;
            popup.y -= deltaTime * 0.05; // Float upward
            popup.alpha = Math.max(0, 1 - (popup.age / popup.duration));
            
            if (popup.alpha <= 0) return false;
            
            this.ctx.save();
            this.ctx.globalAlpha = popup.alpha;
            this.ctx.fillStyle = popup.color;
            this.ctx.font = `bold ${popup.size}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.lineWidth = 3;
            
            this.ctx.strokeText(popup.text, popup.x, popup.y);
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
        this.particleSystem.render(this.ctx);
        this.renderStats.effectsRendered += this.particleSystem.getParticleCount();
    }

    /**
     * Add hit effect
     */
    addHitEffect(lane, hitType, score) {
        const color = this.hitEffectColors[hitType] || '#ffffff';
        const text = hitType === 'PERFECT' ? 'PERFECT!' : 
                     hitType === 'GREAT' ? 'GREAT!' :
                     hitType === 'GOOD' ? 'GOOD' : 'MISS';
        
        this.hitEffects.push({
            lane: lane,
            color: color,
            text: text,
            age: 0,
            duration: 1000,
            alpha: 1
        });
        
        // Add particles for successful hits
        if (hitType !== 'MISS') {
            const centerX = (lane + 0.5) * this.laneWidth;
            const centerY = this.receptorY;
            this.particleSystem.burst(centerX, centerY, color, hitType === 'PERFECT' ? 15 : 8);
        }
    }

    /**
     * Add combo popup
     */
    addComboPopup(combo, score) {
        if (combo < 10) return; // Only show for significant combos
        
        const size = Math.min(36, 18 + combo * 0.2);
        const centerX = this.width * 0.5;
        const centerY = this.height * 0.3;
        
        this.comboPopups.push({
            text: `${combo}x COMBO!`,
            x: centerX,
            y: centerY,
            size: size,
            color: combo >= 50 ? '#ff00ff' : combo >= 25 ? '#ffff00' : '#00ff00',
            age: 0,
            duration: 1500,
            alpha: 1
        });
    }

    /**
     * Render debug hitboxes
     */
    renderDebugHitboxes(gameState) {
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
     * Render FPS counter
     */
    renderFPS(fps) {
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(10, 10, 150, 60);
        
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '14px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`FPS: ${fps}`, 20, 30);
        this.ctx.fillText(`Frame: ${this.frameTime.toFixed(1)}ms`, 20, 45);
        this.ctx.fillText(`Notes: ${this.renderStats.notesRendered}`, 20, 60);
        
        this.ctx.restore();
    }

    /**
     * Get rendering statistics
     */
    getRenderStats() {
        return {
            ...this.renderStats,
            frameTime: this.frameTime,
            particleCount: this.particleSystem.getParticleCount(),
            effectCount: this.hitEffects.length + this.comboPopups.length,
            canvasSize: { width: this.width, height: this.height }
        };
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.particleSystem.clear();
        this.hitEffects = [];
        this.comboPopups = [];
        
        if (this.offscreenCanvas) {
            this.offscreenCanvas = null;
            this.offscreenCtx = null;
        }
        
        console.log('Renderer destroyed');
    }
}

/**
 * Particle system for visual effects
 */
class ParticleSystem {
    constructor() {
        this.particles = [];
        this.maxParticles = 200;
    }

    /**
     * Create a burst of particles
     */
    burst(x, y, color, count = 10) {
        for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
            const speed = 2 + Math.random() * 3;
            
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: color,
                size: 3 + Math.random() * 4,
                life: 1.0,
                decay: 0.02 + Math.random() * 0.02
            });
        }
    }

    /**
     * Update particles
     */
    update(deltaTime) {
        this.particles = this.particles.filter(particle => {
            particle.x += particle.vx * deltaTime * 0.1;
            particle.y += particle.vy * deltaTime * 0.1;
            particle.vy += 0.01 * deltaTime; // Gravity
            particle.life -= particle.decay * deltaTime * 0.01;
            
            return particle.life > 0;
        });
    }

    /**
     * Render particles
     */
    render(ctx) {
        ctx.save();
        
        this.particles.forEach(particle => {
            ctx.globalAlpha = particle.life;
            ctx.fillStyle = particle.color;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
            ctx.fill();
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
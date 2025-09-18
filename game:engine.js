// game/engine.js - Core rhythm game engine

import { config, getRandomPassThreshold, generateCompletionCode } from '../config.js';
import { ChartGenerator } from './chart.js';

export class GameEngine {
    constructor() {
        // Game state
        this.isInitialized = false;
        this.isPlaying = false;
        this.isPaused = false;
        this.difficulty = 'NORMAL';
        
        // Session data
        this.sessionId = null;
        this.userId = null;
        this.tracks = [];
        this.currentTrackIndex = 0;
        this.trackResults = [];
        
        // Current track data
        this.currentChart = null;
        this.currentTrack = null;
        this.trackStartTime = 0;
        this.trackDuration = 0;
        this.requiredPercent = 0;
        
        // Score and combo
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.health = config.HEALTH.STARTING;
        
        // Hit statistics
        this.hitStats = {
            perfect: 0,
            great: 0,
            good: 0,
            miss: 0,
            total: 0
        };
        
        // Note tracking
        this.activeNotes = [];
        this.nextNoteIndex = 0;
        this.hitNotes = new Set();
        
        // Timing
        this.gameTime = 0;
        this.lastUpdateTime = 0;
        this.positionOffset = 0;
        
        // Performance tracking
        this.frameCount = 0;
        this.lastFpsTime = 0;
        this.currentFps = 60;
        
        // Event callbacks
        this.onTrackStart = null;
        this.onTrackEnd = null;
        this.onSessionComplete = null;
        this.onScoreUpdate = null;
        this.onHealthUpdate = null;
    }

    /**
     * Initialize a new game session
     */
    initializeSession(tracks, userId, sessionId) {
        this.tracks = tracks;
        this.userId = userId;
        this.sessionId = sessionId;
        this.currentTrackIndex = 0;
        this.trackResults = [];
        
        // Reset session stats
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.health = config.HEALTH.STARTING;
        this.hitStats = { perfect: 0, great: 0, good: 0, miss: 0, total: 0 };
        
        this.isInitialized = true;
        console.log('Game session initialized with', tracks.length, 'tracks');
    }

    /**
     * Start a new track
     */
    async startTrack(trackData, audioAnalysis) {
        this.currentTrack = trackData;
        this.trackDuration = trackData.duration_ms;
        this.trackStartTime = Date.now();
        this.requiredPercent = getRandomPassThreshold();
        
        // Generate chart from audio analysis
        const chartGenerator = new ChartGenerator();
        this.currentChart = chartGenerator.generateChart(audioAnalysis, this.difficulty);
        
        // Reset track-specific state
        this.activeNotes = [];
        this.nextNoteIndex = 0;
        this.hitNotes.clear();
        this.positionOffset = 0;
        
        // Reset per-track stats (keep session stats)
        const trackStats = { perfect: 0, great: 0, good: 0, miss: 0, total: 0 };
        this.trackStats = trackStats;
        
        this.isPlaying = true;
        
        console.log(`Started track: ${trackData.name} (${this.requiredPercent}% required)`);
        
        if (this.onTrackStart) {
            this.onTrackStart(trackData, this.requiredPercent);
        }
    }

    /**
     * Main update loop
     */
    update(deltaTime, currentPositionMs) {
        if (!this.isInitialized || !this.isPlaying) return;
        
        this.updatePerformanceMetrics(deltaTime);
        
        // Update game time
        this.gameTime = currentPositionMs;
        
        // Spawn new notes
        this.spawnNotes();
        
        // Update active notes
        this.updateNotes(deltaTime);
        
        // Check for missed notes
        this.checkMissedNotes();
        
        // Check for track completion
        this.checkTrackCompletion();
        
        this.lastUpdateTime = Date.now();
    }

    /**
     * Update performance metrics
     */
    updatePerformanceMetrics(deltaTime) {
        this.frameCount++;
        const now = Date.now();
        
        if (now - this.lastFpsTime >= 1000) {
            this.currentFps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsTime = now;
        }
    }

    /**
     * Spawn notes that should appear on screen
     */
    spawnNotes() {
        if (!this.currentChart) return;
        
        const approachTime = config.DIFFICULTY_SETTINGS[this.difficulty].approachTime;
        const spawnTime = this.gameTime + approachTime;
        
        // Spawn notes that should appear now
        while (this.nextNoteIndex < this.currentChart.notes.length) {
            const note = this.currentChart.notes[this.nextNoteIndex];
            
            if (note.time <= spawnTime) {
                this.activeNotes.push({
                    ...note,
                    id: this.nextNoteIndex,
                    spawned: true,
                    y: 0, // Will be calculated in render
                    isHit: false
                });
                this.nextNoteIndex++;
            } else {
                break;
            }
        }
    }

    /**
     * Update positions of active notes
     */
    updateNotes(deltaTime) {
        const approachTime = config.DIFFICULTY_SETTINGS[this.difficulty].approachTime;
        
        // Remove notes that have passed the hit line and weren't hit
        this.activeNotes = this.activeNotes.filter(note => {
            const timeDiff = note.time - this.gameTime;
            return timeDiff > -config.TIMING_WINDOWS.GOOD || note.isHit;
        });
        
        // Update note positions
        this.activeNotes.forEach(note => {
            const timeDiff = note.time - this.gameTime;
            const progress = 1 - (timeDiff / approachTime);
            note.progress = Math.max(0, Math.min(1, progress));
        });
    }

    /**
     * Check for notes that were missed
     */
    checkMissedNotes() {
        const missThreshold = config.TIMING_WINDOWS.GOOD;
        
        this.activeNotes.forEach(note => {
            if (!note.isHit && !this.hitNotes.has(note.id)) {
                const timeDiff = this.gameTime - note.time;
                
                if (timeDiff > missThreshold) {
                    this.handleMiss(note);
                    this.hitNotes.add(note.id);
                    note.isHit = true;
                }
            }
        });
    }

    /**
     * Handle player input for a lane
     */
    handleLaneHit(laneIndex, inputTime = null) {
        if (!this.isPlaying) return null;
        
        const hitTime = inputTime || this.gameTime;
        let bestNote = null;
        let bestTimeDiff = Infinity;
        
        // Find the best note to hit in this lane
        this.activeNotes.forEach(note => {
            if (note.lane === laneIndex && !note.isHit && !this.hitNotes.has(note.id)) {
                const timeDiff = Math.abs(hitTime - note.time);
                
                if (timeDiff < bestTimeDiff && timeDiff <= config.TIMING_WINDOWS.GOOD) {
                    bestNote = note;
                    bestTimeDiff = timeDiff;
                }
            }
        });
        
        if (bestNote) {
            const hitResult = this.calculateHitResult(bestTimeDiff);
            this.processHit(bestNote, hitResult, bestTimeDiff);
            return hitResult;
        }
        
        return null;
    }

    /**
     * Calculate hit result based on timing difference
     */
    calculateHitResult(timeDiff) {
        if (timeDiff <= config.TIMING_WINDOWS.PERFECT) {
            return 'PERFECT';
        } else if (timeDiff <= config.TIMING_WINDOWS.GREAT) {
            return 'GREAT';
        } else if (timeDiff <= config.TIMING_WINDOWS.GOOD) {
            return 'GOOD';
        } else {
            return 'MISS';
        }
    }

    /**
     * Process a successful hit
     */
    processHit(note, hitResult, timeDiff) {
        note.isHit = true;
        this.hitNotes.add(note.id);
        
        // Update statistics
        this.hitStats[hitResult.toLowerCase()]++;
        this.hitStats.total++;
        this.trackStats[hitResult.toLowerCase()]++;
        this.trackStats.total++;
        
        // Update combo
        if (hitResult !== 'MISS') {
            this.combo++;
            this.maxCombo = Math.max(this.maxCombo, this.combo);
        } else {
            this.combo = 0;
        }
        
        // Calculate score
        const baseScore = config.SCORING[hitResult];
        const comboMultiplier = Math.min(
            1 + Math.floor(this.combo / config.SCORING.COMBO_THRESHOLD) * 0.1,
            config.SCORING.COMBO_MULTIPLIER_MAX
        );
        const scoreGain = Math.floor(baseScore * comboMultiplier);
        this.score += scoreGain;
        
        // Update health
        this.updateHealth(hitResult);
        
        // Trigger callbacks
        if (this.onScoreUpdate) {
            this.onScoreUpdate({
                score: this.score,
                combo: this.combo,
                hitResult,
                scoreGain
            });
        }
        
        console.log(`Hit ${hitResult}: ${timeDiff}ms, Score: +${scoreGain}, Combo: ${this.combo}`);
    }

    /**
     * Handle a missed note
     */
    handleMiss(note) {
        this.processHit(note, 'MISS', Infinity);
    }

    /**
     * Update health based on hit result
     */
    updateHealth(hitResult) {
        const oldHealth = this.health;
        
        switch (hitResult) {
            case 'PERFECT':
                this.health = Math.min(config.HEALTH.MAX_HEALTH, 
                                     this.health + config.HEALTH.PERFECT_GAIN);
                break;
            case 'GREAT':
                this.health = Math.min(config.HEALTH.MAX_HEALTH, 
                                     this.health + config.HEALTH.GREAT_GAIN);
                break;
            case 'GOOD':
                // Neutral
                break;
            case 'MISS':
                this.health = Math.max(config.HEALTH.MIN_HEALTH, 
                                     this.health - config.HEALTH.MISS_LOSS);
                break;
        }
        
        if (this.health !== oldHealth && this.onHealthUpdate) {
            this.onHealthUpdate(this.health);
        }
    }

    /**
     * Check if current track is complete
     */
    checkTrackCompletion() {
        const playedPercent = (this.gameTime / this.trackDuration) * 100;
        
        if (playedPercent >= this.requiredPercent) {
            this.completeCurrentTrack();
        }
    }

    /**
     * Complete the current track and advance to next
     */
    completeCurrentTrack() {
        if (!this.isPlaying) return;
        
        this.isPlaying = false;
        
        // Calculate track results
        const playedPercent = Math.min(100, (this.gameTime / this.trackDuration) * 100);
        const accuracy = this.trackStats.total > 0 ? 
            ((this.trackStats.perfect + this.trackStats.great + this.trackStats.good) / this.trackStats.total) * 100 : 0;
        
        const trackResult = {
            trackIndex: this.currentTrackIndex,
            trackName: this.currentTrack.name,
            artistName: this.currentTrack.artists[0]?.name || 'Unknown',
            playedPercent: Math.round(playedPercent * 100) / 100,
            requiredPercent: this.requiredPercent,
            passed: playedPercent >= this.requiredPercent,
            accuracy: Math.round(accuracy * 100) / 100,
            score: this.score,
            maxCombo: this.maxCombo,
            hitStats: { ...this.trackStats }
        };
        
        this.trackResults.push(trackResult);
        
        console.log(`Track completed:`, trackResult);
        
        if (this.onTrackEnd) {
            this.onTrackEnd(trackResult);
        }
        
        // Advance to next track or complete session
        this.currentTrackIndex++;
        if (this.currentTrackIndex >= this.tracks.length) {
            this.completeSession();
        } else {
            // Prepare for next track
            setTimeout(() => {
                this.isPlaying = true;
            }, 1000); // Brief pause between tracks
        }
    }

    /**
     * Complete the entire game session
     */
    completeSession() {
        const completionCode = generateCompletionCode(this.userId, this.sessionId);
        
        const sessionResult = {
            completionCode,
            trackResults: this.trackResults,
            totalScore: this.score,
            totalMaxCombo: this.maxCombo,
            overallAccuracy: this.calculateOverallAccuracy(),
            sessionStats: { ...this.hitStats }
        };
        
        console.log('Session completed:', sessionResult);
        
        if (this.onSessionComplete) {
            this.onSessionComplete(sessionResult);
        }
    }

    /**
     * Calculate overall session accuracy
     */
    calculateOverallAccuracy() {
        if (this.hitStats.total === 0) return 0;
        
        const successfulHits = this.hitStats.perfect + this.hitStats.great + this.hitStats.good;
        return Math.round((successfulHits / this.hitStats.total) * 10000) / 100;
    }

    /**
     * Get current game state for rendering
     */
    getGameState() {
        return {
            isPlaying: this.isPlaying,
            isPaused: this.isPaused,
            difficulty: this.difficulty,
            
            // Track info
            currentTrack: this.currentTrack,
            currentTrackIndex: this.currentTrackIndex,
            totalTracks: this.tracks.length,
            requiredPercent: this.requiredPercent,
            
            // Timing
            gameTime: this.gameTime,
            trackDuration: this.trackDuration,
            playedPercent: this.trackDuration > 0 ? (this.gameTime / this.trackDuration) * 100 : 0,
            
            // Score and stats
            score: this.score,
            combo: this.combo,
            maxCombo: this.maxCombo,
            health: this.health,
            hitStats: { ...this.hitStats },
            
            // Notes
            activeNotes: [...this.activeNotes],
            
            // Visual settings
            lanes: config.DIFFICULTY_SETTINGS[this.difficulty].lanes,
            approachTime: config.DIFFICULTY_SETTINGS[this.difficulty].approachTime,
            
            // Performance
            fps: this.currentFps,
            
            // Debug info
            debug: config.DEBUG.ENABLED ? {
                nextNoteIndex: this.nextNoteIndex,
                totalNotes: this.currentChart?.notes.length || 0,
                activeNotesCount: this.activeNotes.length
            } : null
        };
    }

    /**
     * Pause the game
     */
    pause() {
        this.isPaused = true;
        this.isPlaying = false;
    }

    /**
     * Resume the game
     */
    resume() {
        this.isPaused = false;
        this.isPlaying = true;
    }

    /**
     * Reset the game state
     */
    reset() {
        this.isInitialized = false;
        this.isPlaying = false;
        this.isPaused = false;
        
        this.currentTrackIndex = 0;
        this.trackResults = [];
        this.currentChart = null;
        this.currentTrack = null;
        
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.health = config.HEALTH.STARTING;
        
        this.hitStats = { perfect: 0, great: 0, good: 0, miss: 0, total: 0 };
        this.activeNotes = [];
        this.nextNoteIndex = 0;
        this.hitNotes.clear();
        
        console.log('Game engine reset');
    }

    /**
     * Set difficulty level
     */
    setDifficulty(difficulty) {
        if (config.DIFFICULTY_SETTINGS[difficulty]) {
            this.difficulty = difficulty;
            console.log('Difficulty set to:', difficulty);
        }
    }
}
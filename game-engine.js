// game-engine.js - Fixed game engine implementation

import { config, generateCompletionCode } from './config.js';
import { MidiChartGenerator } from './midi-chart-generator.js';
import { ChartGenerator } from './game-chart.js';

export class GameEngine {
    constructor() {
        // Game state
        this.isInitialized = false;
        this.isPlaying = false;
        this.isPaused = false;
        this.difficulty = 'NORMAL';
        
        // Chart generators
        this.midiGenerator = new MidiChartGenerator(); // Fixed: use correct class name
        this.audioChartGenerator = new ChartGenerator();
        
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
        
        // Timing synchronization
        this.gameStartTime = 0;
        this.audioStartTime = 0;
        this.timingOffset = 0;
        this.lastPositionSync = 0;
        
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
        this.noteSpawnLookahead = 2000;
        
        // Performance tracking
        this.frameCount = 0;
        this.lastFpsTime = 0;
        this.currentFps = 60;
        this.averageFrameTime = 16.67;

        // Timing accuracy tracking
        this.timingAccuracy = [];
        this.maxTimingHistory = 100;

        // Event callbacks
        this.onTrackStart = null;
        this.onTrackEnd = null;
        this.onSessionComplete = null;
        this.onScoreUpdate = null;
        this.onHealthUpdate = null;
        this.onTimingUpdate = null;

        // Optional debugger hook
        this.debugger = null;
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
        this.debugger?.log('session:initialize', {
            trackCount: tracks.length,
            sessionId: sessionId,
            userId: userId
        });
    }

    /**
     * Start a new track with improved timing synchronization
     */
    async startTrack(trackData, audioAnalysis = null) {
        this.currentTrack = trackData;
        this.trackDuration = trackData.duration_ms;
        this.requiredPercent = this.getRandomPassThreshold();
        
        // Reset timing for new track
        this.gameStartTime = performance.now();
        this.audioStartTime = 0;
        this.lastPositionSync = 0;
        
        // Try MIDI chart first, then audio analysis, then fallback
        try {
            if (this.midiGenerator.hasMidiData(trackData.id)) {
                console.log(`Using MIDI chart for track: ${trackData.name}`);
                this.currentChart = this.midiGenerator.generateChartFromMidi(trackData.id, this.difficulty);
            } else if (audioAnalysis) {
                console.log(`Using audio analysis chart for track: ${trackData.name}`);
                this.currentChart = this.audioChartGenerator.generateChart(audioAnalysis, this.difficulty);
            } else {
                console.log(`Using fallback test chart for track: ${trackData.name}`);
                this.currentChart = this.audioChartGenerator.generateTestChart(this.trackDuration, this.difficulty);
            }
        } catch (error) {
            console.error('Chart generation failed:', error);
            // Ultimate fallback
            this.currentChart = this.audioChartGenerator.generateTestChart(this.trackDuration, this.difficulty);
        }
        
        // Reset track-specific state
        this.resetTrackState();
        
        this.isPlaying = true;
        
        console.log(`Started track: ${trackData.name} (${this.requiredPercent}% required, ${this.currentChart.notes.length} notes)`);

        this.debugger?.log('track:start', {
            trackId: trackData.id,
            trackName: trackData.name,
            requiredPercent: this.requiredPercent,
            chartSource: this.currentChart?.metadata?.source || 'unknown',
            noteCount: this.currentChart?.notes?.length || 0
        });

        if (this.onTrackStart) {
            this.onTrackStart(trackData, this.requiredPercent);
        }
    }

    /**
     * Reset state for new track
     */
    resetTrackState() {
        this.activeNotes = [];
        this.nextNoteIndex = 0;
        this.hitNotes.clear();
        
        // Reset per-track stats
        this.trackStats = { perfect: 0, great: 0, good: 0, miss: 0, total: 0 };
        
        // Clear timing accuracy history
        this.timingAccuracy = [];
        this.debugger?.log('track:stateReset', {
            trackId: this.currentTrack?.id,
            difficulty: this.difficulty
        });
    }

    /**
     * Synchronize game time with audio playback
     */
    syncWithAudioTime(audioPositionMs) {
        const now = performance.now();
        
        if (this.audioStartTime === 0) {
            // First sync - establish baseline
            this.audioStartTime = now - audioPositionMs;
            this.lastPositionSync = now;
        } else {
            // Check for drift and resync if necessary
            const expectedAudioTime = now - this.audioStartTime;
            const drift = Math.abs(expectedAudioTime - audioPositionMs);
            
            if (drift > 100) { // More than 100ms drift
                console.log(`Audio drift detected: ${drift.toFixed(0)}ms, resyncing...`);
                this.audioStartTime = now - audioPositionMs;
                this.debugger?.log('timing:driftDetected', {
                    drift: Math.round(drift),
                    audioPosition: Math.round(audioPositionMs)
                });
            }
            
            this.lastPositionSync = now;
        }
    }

    /**
     * Get current game time with high precision
     */
    getCurrentGameTime() {
        if (this.audioStartTime === 0) {
            return 0;
        }
        
        const elapsed = performance.now() - this.audioStartTime;
        return elapsed + this.timingOffset;
    }

    /**
     * Set timing calibration offset
     */
    setTimingOffset(offsetMs) {
        this.timingOffset = offsetMs;
        console.log(`Timing offset set to ${offsetMs}ms`);
        this.debugger?.log('timing:offsetSet', { offset: offsetMs });
    }

    /**
     * Main update loop with improved timing
     */
    update(deltaTime, audioPositionMs = null) {
        if (!this.isInitialized || !this.isPlaying) return;
        
        this.updatePerformanceMetrics(deltaTime);
        
        // Sync with audio position if provided
        if (audioPositionMs !== null) {
            this.syncWithAudioTime(audioPositionMs);
        }
        
        // Get current game time
        const gameTime = this.getCurrentGameTime();
        
        // Spawn new notes with lookahead
        this.spawnNotes(gameTime);
        
        // Update active notes
        this.updateNotes(gameTime, deltaTime);
        
        // Check for missed notes
        this.checkMissedNotes(gameTime);
        
        // Check for track completion
        this.checkTrackCompletion(gameTime);
        
        // Update timing callback if available
        if (this.onTimingUpdate) {
            this.onTimingUpdate({
                gameTime: gameTime,
                audioTime: audioPositionMs,
                drift: audioPositionMs ? Math.abs(gameTime - audioPositionMs) : 0,
                offset: this.timingOffset
            });
        }
    }

    /**
     * Spawn notes with improved lookahead
     */
    spawnNotes(gameTime) {
        if (!this.currentChart) return;
        
        const approachTime = config.DIFFICULTY_SETTINGS[this.difficulty].approachTime;
        const spawnTime = gameTime + this.noteSpawnLookahead;
        
        while (this.nextNoteIndex < this.currentChart.notes.length) {
            const note = this.currentChart.notes[this.nextNoteIndex];
            
            if (note.time <= spawnTime) {
                // Create active note with precise timing
                const activeNote = {
                    ...note,
                    id: this.nextNoteIndex,
                    spawned: true,
                    spawnTime: gameTime,
                    isHit: false,
                    progress: 0
                };
                
                this.activeNotes.push(activeNote);
                this.nextNoteIndex++;
            } else {
                break;
            }
        }
    }

    /**
     * Update note positions and states
     */
    updateNotes(gameTime, deltaTime) {
        const approachTime = config.DIFFICULTY_SETTINGS[this.difficulty].approachTime;
        
        // Update positions and remove old notes
        this.activeNotes = this.activeNotes.filter(note => {
            const timeDiff = note.time - gameTime;
            const missWindow = config.TIMING_WINDOWS.GOOD;
            
            // Remove notes that are too far past
            if (timeDiff < -missWindow - 200) {
                return false;
            }
            
            // Calculate progress (0 = spawned, 1 = at hit line)
            const totalTime = this.noteSpawnLookahead;
            const elapsed = gameTime - note.spawnTime;
            note.progress = Math.max(0, Math.min(1, elapsed / totalTime));
            
            return true;
        });
    }

    /**
     * Check for missed notes with precise timing
     */
    checkMissedNotes(gameTime) {
        const missThreshold = config.TIMING_WINDOWS.GOOD;
        
        this.activeNotes.forEach(note => {
            if (!note.isHit && !this.hitNotes.has(note.id)) {
                const timeDiff = gameTime - note.time;
                
                if (timeDiff > missThreshold) {
                    this.processHit(note, 'MISS', timeDiff);
                    this.hitNotes.add(note.id);
                    note.isHit = true;
                }
            }
        });
    }

    /**
     * Handle player input with precise timing analysis
     */
    handleLaneHit(laneIndex, inputTime = null) {
        if (!this.isPlaying) return null;
        
        const currentTime = inputTime || this.getCurrentGameTime();
        let bestNote = null;
        let bestTimeDiff = Infinity;
        
        // Find the best note to hit in this lane
        this.activeNotes.forEach(note => {
            if (note.lane === laneIndex && !note.isHit && !this.hitNotes.has(note.id)) {
                const timeDiff = Math.abs(currentTime - note.time);
                
                if (timeDiff < bestTimeDiff && timeDiff <= config.TIMING_WINDOWS.GOOD) {
                    bestNote = note;
                    bestTimeDiff = timeDiff;
                }
            }
        });
        
        if (bestNote) {
            // Calculate actual timing difference (positive = late, negative = early)
            const actualTimeDiff = currentTime - bestNote.time;
            const hitResult = this.calculateHitResult(Math.abs(actualTimeDiff));
            
            this.processHit(bestNote, hitResult, actualTimeDiff);
            
            // Track timing accuracy
            this.recordTimingAccuracy(actualTimeDiff);
            
            return {
                hitType: hitResult,
                score: this.calculateScoreGain(hitResult),
                combo: this.combo,
                timingDiff: actualTimeDiff,
                note: bestNote
            };
        }
        
        return null;
    }

    /**
     * Record timing accuracy for analysis
     */
    recordTimingAccuracy(timeDiff) {
        this.timingAccuracy.push(timeDiff);
        
        if (this.timingAccuracy.length > this.maxTimingHistory) {
            this.timingAccuracy.shift();
        }
    }

    /**
     * Get timing statistics
     */
    getTimingStats() {
        if (this.timingAccuracy.length === 0) {
            return { averageOffset: 0, standardDeviation: 0, accuracy: 0 };
        }
        
        const sum = this.timingAccuracy.reduce((a, b) => a + b, 0);
        const average = sum / this.timingAccuracy.length;
        
        const variance = this.timingAccuracy.reduce((sum, diff) => {
            return sum + Math.pow(diff - average, 2);
        }, 0) / this.timingAccuracy.length;
        
        const standardDeviation = Math.sqrt(variance);
        
        // Calculate accuracy as percentage of hits within perfect window
        const perfectHits = this.timingAccuracy.filter(diff => 
            Math.abs(diff) <= config.TIMING_WINDOWS.PERFECT
        ).length;
        
        const accuracy = (perfectHits / this.timingAccuracy.length) * 100;
        
        return {
            averageOffset: Math.round(average),
            standardDeviation: Math.round(standardDeviation),
            accuracy: Math.round(accuracy),
            totalHits: this.timingAccuracy.length
        };
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
     * Calculate score gain for hit result
     */
    calculateScoreGain(hitResult) {
        const baseScore = config.SCORING[hitResult] || 0;
        const comboMultiplier = Math.min(
            1 + Math.floor(this.combo / config.SCORING.COMBO_THRESHOLD) * 0.1,
            config.SCORING.COMBO_MULTIPLIER_MAX
        );
        return Math.floor(baseScore * comboMultiplier);
    }

    /**
     * Process a hit with improved feedback
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
        const scoreGain = this.calculateScoreGain(hitResult);
        this.score += scoreGain;
        
        // Update health
        this.updateHealth(hitResult);
        
        // Trigger callbacks
        if (this.onScoreUpdate) {
            this.onScoreUpdate({
                score: this.score,
                combo: this.combo,
                hitResult,
                scoreGain,
                timingDiff: timeDiff
            });
        }

        if (this.debugger) {
            const shouldHighlight = hitResult === 'MISS' || hitResult === 'PERFECT' || (this.combo > 0 && this.combo % 25 === 0);
            if (shouldHighlight) {
                this.debugger.log('note:hit', {
                    result: hitResult,
                    lane: note.lane,
                    combo: this.combo,
                    score: this.score,
                    timingDiff: Math.round(timeDiff)
                });
            }
        }
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
                break; // Neutral
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
    checkTrackCompletion(gameTime) {
        const playedPercent = (gameTime / this.trackDuration) * 100;
        
        if (playedPercent >= this.requiredPercent) {
            this.completeCurrentTrack();
        }
    }

    /**
     * Complete the current track
     */
    completeCurrentTrack() {
        if (!this.isPlaying) return;

        this.isPlaying = false;

        const gameTime = this.getCurrentGameTime();
        const playedPercent = Math.min(100, (gameTime / this.trackDuration) * 100);
        const accuracy = this.trackStats.total > 0 ?
            ((this.trackStats.perfect + this.trackStats.great + this.trackStats.good) / this.trackStats.total) * 100 : 0;

        const timingStats = this.getTimingStats();

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
            hitStats: { ...this.trackStats },
            chartSource: this.currentChart?.metadata?.source || 'unknown',
            timingStats: timingStats
        };

        this.trackResults.push(trackResult);

        console.log(`Track completed:`, trackResult);

        this.debugger?.log('track:complete', {
            trackId: this.currentTrack?.id,
            playedPercent: trackResult.playedPercent,
            requiredPercent: this.requiredPercent,
            passed: trackResult.passed,
            accuracy: trackResult.accuracy
        });

        if (this.onTrackEnd) {
            this.onTrackEnd(trackResult);
        }

        // IMPORTANT: Advance to next track BEFORE checking completion
        this.currentTrackIndex++;

        // Tell the playback system to advance to the next track
        if (this.currentTrackIndex < this.tracks.length) {
            // More tracks to play - advance the native playback
            console.log(`Advancing to track ${this.currentTrackIndex}`);

            this.debugger?.log('track:advanceRequest', {
                nextTrackIndex: this.currentTrackIndex
            });

            // Use a callback to notify the playback system
            if (this.onAdvanceTrack) {
                this.onAdvanceTrack(this.currentTrackIndex);
            }
        } else {
            // Session complete
            this.completeSession();
        }
    }

    /**
     * Complete the entire session
     */
    completeSession() {
        const completionCode = generateCompletionCode(this.userId, this.sessionId);
        
        const overallTimingStats = this.getTimingStats();
        
        const sessionResult = {
            completionCode,
            trackResults: this.trackResults,
            totalScore: this.score,
            totalMaxCombo: this.maxCombo,
            overallAccuracy: this.calculateOverallAccuracy(),
            sessionStats: { ...this.hitStats },
            timingStats: overallTimingStats,
            midiTracksUsed: this.trackResults.filter(r => r.chartSource === 'midi').length
        };
        
        console.log('Session completed:', sessionResult);

        this.debugger?.log('session:complete', {
            totalScore: sessionResult.totalScore,
            accuracy: sessionResult.overallAccuracy,
            trackCount: sessionResult.trackResults.length
        });

        if (this.onSessionComplete) {
            this.onSessionComplete(sessionResult);
        }
    }

    /**
     * Calculate overall accuracy
     */
    calculateOverallAccuracy() {
        if (this.hitStats.total === 0) return 0;
        
        const successfulHits = this.hitStats.perfect + this.hitStats.great + this.hitStats.good;
        return Math.round((successfulHits / this.hitStats.total) * 10000) / 100;
    }

    /**
     * Update performance metrics
     */
    updatePerformanceMetrics(deltaTime) {
        this.frameCount++;
        this.averageFrameTime = (this.averageFrameTime * 0.9) + (deltaTime * 0.1);
        
        const now = Date.now();
        if (now - this.lastFpsTime >= 1000) {
            this.currentFps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsTime = now;
        }
    }

    /**
     * Get random pass threshold
     */
    getRandomPassThreshold() {
        const min = config.PASS_THRESHOLD.MIN;
        const max = config.PASS_THRESHOLD.MAX;
        return Math.floor(Math.random() * (max - min + 1)) + min;
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
            gameTime: this.getCurrentGameTime(),
            trackDuration: this.trackDuration,
            playedPercent: this.trackDuration > 0 ? (this.getCurrentGameTime() / this.trackDuration) * 100 : 0,
            
            // Score and stats
            score: this.score,
            combo: this.combo,
            maxCombo: this.maxCombo,
            health: this.health,
            hitStats: { ...this.hitStats },
            timingStats: this.getTimingStats(),
            
            // Notes
            activeNotes: [...this.activeNotes],
            
            // Visual settings
            lanes: config.DIFFICULTY_SETTINGS[this.difficulty].lanes,
            approachTime: config.DIFFICULTY_SETTINGS[this.difficulty].approachTime,
            
            // Performance
            fps: this.currentFps,
            averageFrameTime: this.averageFrameTime,
            
            // Chart info
            chartSource: this.currentChart?.metadata?.source || 'unknown',
            totalNotes: this.currentChart?.notes.length || 0,
            
            // Debug info
            debug: config.DEBUG.ENABLED ? {
                nextNoteIndex: this.nextNoteIndex,
                activeNotesCount: this.activeNotes.length,
                midiAvailable: this.midiGenerator.hasMidiData(this.currentTrack?.id),
                timingOffset: this.timingOffset,
                audioStartTime: this.audioStartTime
            } : null
        };
    }

    /**
     * Get random pass threshold
     */
    getRandomPassThreshold() {
        const min = config.PASS_THRESHOLD.MIN;
        const max = config.PASS_THRESHOLD.MAX;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // Additional methods...
    pause() { this.isPaused = true; this.isPlaying = false; }
    resume() { this.isPaused = false; this.isPlaying = true; }
    reset() { /* reset implementation */ }
    setDifficulty(difficulty) { this.difficulty = difficulty; }
    hasMidiForCurrentTrack() { return this.currentTrack && this.midiGenerator.hasMidiData(this.currentTrack.id); }
    getTracksWithMidi() { return this.midiGenerator.getAvailableTracks(); }

    setDebugger(debuggerInstance) {
        this.debugger = debuggerInstance;
    }
}

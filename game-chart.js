// game/chart.js - Generate rhythm game charts from Spotify audio analysis

import { config } from '../config.js';

export class ChartGenerator {
    constructor() {
        this.rngSeed = 12345; // Will be set per track
        this.laneWeights = [1, 1, 1, 1]; // For lane distribution
        this.lastLane = -1; // For anti-ping-pong logic
    }

    /**
     * Generate a complete chart from audio analysis
     * @param {Object} audioAnalysis - Spotify audio analysis data
     * @param {string} difficulty - Difficulty level (EASY, NORMAL, HARD)
     * @returns {Object} Generated chart
     */
    generateChart(audioAnalysis, difficulty = 'NORMAL') {
        const difficultySettings = config.DIFFICULTY_SETTINGS[difficulty];
        const lanes = difficultySettings.lanes;
        
        // Initialize RNG with track-specific seed
        this.rngSeed = this.generateSeedFromAnalysis(audioAnalysis);
        this.laneWeights = new Array(lanes).fill(1);
        
        console.log(`Generating ${difficulty} chart with ${lanes} lanes`);
        
        // Extract timing events from audio analysis
        const events = this.extractTimingEvents(audioAnalysis, difficulty);
        
        // Convert events to notes with lane assignments
        const notes = this.eventsToNotes(events, lanes, difficulty);
        
        // Add hold notes for longer segments
        const notesWithHolds = this.addHoldNotes(notes, audioAnalysis, difficulty);
        
        // Apply density and difficulty adjustments
        const finalNotes = this.adjustDensity(notesWithHolds, audioAnalysis, difficulty);
        
        // Sort by time and validate
        finalNotes.sort((a, b) => a.time - b.time);
        this.validateChart(finalNotes);
        
        const chart = {
            notes: finalNotes,
            difficulty: difficulty,
            lanes: lanes,
            metadata: {
                totalNotes: finalNotes.length,
                holdNotes: finalNotes.filter(n => n.type === 'hold').length,
                duration: audioAnalysis.track.duration * 1000,
                generatedAt: Date.now()
            }
        };
        
        console.log(`Generated chart: ${chart.metadata.totalNotes} notes, ${chart.metadata.holdNotes} holds`);
        return chart;
    }

    /**
     * Extract timing events from audio analysis
     */
    extractTimingEvents(audioAnalysis, difficulty) {
        const events = [];
        const densityMultiplier = config.CHART.DENSITY_MULTIPLIERS[difficulty];
        
        // Base events from beats
        if (audioAnalysis.beats) {
            audioAnalysis.beats.forEach((beat, index) => {
                const timeMs = beat.start * 1000;
                const confidence = beat.confidence || 0.5;
                const loudness = this.getLoudnessAtTime(audioAnalysis, beat.start);
                const energy = this.getEnergyAtTime(audioAnalysis, beat.start);
                
                events.push({
                    time: timeMs,
                    type: 'beat',
                    confidence: confidence,
                    loudness: loudness,
                    energy: energy,
                    priority: confidence * (1 + energy * 0.5)
                });
            });
        }
        
        // Add tatum events during high energy sections
        if (audioAnalysis.tatums && difficulty !== 'EASY') {
            audioAnalysis.tatums.forEach(tatum => {
                const timeMs = tatum.start * 1000;
                const energy = this.getEnergyAtTime(audioAnalysis, tatum.start);
                const loudness = this.getLoudnessAtTime(audioAnalysis, tatum.start);
                
                // Only add tatums in high energy sections
                if (energy > config.CHART.ENERGY_THRESHOLD && 
                    loudness > config.CHART.LOUDNESS_THRESHOLD) {
                    
                    // Check if too close to existing beat
                    const nearbyBeat = events.find(e => Math.abs(e.time - timeMs) < config.CHART.MIN_NOTE_SPACING);
                    if (!nearbyBeat) {
                        events.push({
                            time: timeMs,
                            type: 'tatum',
                            confidence: tatum.confidence || 0.3,
                            loudness: loudness,
                            energy: energy,
                            priority: (tatum.confidence || 0.3) * energy
                        });
                    }
                }
            });
        }
        
        // Apply density multiplier by filtering events
        const targetEventCount = Math.floor(events.length * densityMultiplier);
        const sortedEvents = events.sort((a, b) => b.priority - a.priority);
        const selectedEvents = sortedEvents.slice(0, targetEventCount);
        
        return selectedEvents.sort((a, b) => a.time - b.time);
    }

    /**
     * Convert timing events to notes with lane assignments
     */
    eventsToNotes(events, laneCount, difficulty) {
        const notes = [];
        let lastLanes = []; // Track recent lanes for variety
        
        events.forEach((event, index) => {
            // Skip if too close to previous note
            if (notes.length > 0) {
                const lastNote = notes[notes.length - 1];
                if (event.time - lastNote.time < config.CHART.MIN_NOTE_SPACING) {
                    return;
                }
            }
            
            // Choose lane based on weighted random selection
            const lane = this.selectLane(laneCount, lastLanes, event);
            lastLanes.push(lane);
            if (lastLanes.length > 3) lastLanes.shift(); // Keep only recent 3
            
            const note = {
                time: event.time,
                lane: lane,
                type: 'tap',
                confidence: event.confidence,
                energy: event.energy,
                loudness: event.loudness
            };
            
            notes.push(note);
        });
        
        return notes;
    }

    /**
     * Add hold notes for longer segments
     */
    addHoldNotes(notes, audioAnalysis, difficulty) {
        const notesWithHolds = [...notes];
        
        // Skip hold notes for easy difficulty
        if (difficulty === 'EASY') {
            return notesWithHolds;
        }
        
        if (audioAnalysis.segments) {
            audioAnalysis.segments.forEach(segment => {
                const durationMs = segment.duration * 1000;
                const startTimeMs = segment.start * 1000;
                const endTimeMs = startTimeMs + durationMs;
                
                // Only create holds for segments longer than threshold
                if (durationMs >= config.CHART.HOLD_MIN_DURATION) {
                    const loudness = segment.loudness_max || segment.loudness_start || -30;
                    const energy = this.getEnergyAtTime(audioAnalysis, segment.start);
                    
                    // Check for conflicting notes
                    const conflictingNotes = notesWithHolds.filter(note => 
                        note.time >= startTimeMs - 200 && note.time <= endTimeMs + 200
                    );
                    
                    if (conflictingNotes.length === 0) {
                        // Choose lane for hold note
                        const lane = this.selectLane(config.DIFFICULTY_SETTINGS[difficulty].lanes, [], {
                            energy: energy,
                            loudness: loudness
                        });
                        
                        const holdNote = {
                            time: startTimeMs,
                            endTime: endTimeMs,
                            duration: durationMs,
                            lane: lane,
                            type: 'hold',
                            energy: energy,
                            loudness: loudness,
                            confidence: 0.8
                        };
                        
                        notesWithHolds.push(holdNote);
                    }
                }
            });
        }
        
        return notesWithHolds;
    }

    /**
     * Adjust note density based on energy and loudness
     */
    adjustDensity(notes, audioAnalysis, difficulty) {
        // For mobile performance, limit maximum notes on screen
        const maxNotes = config.PERFORMANCE.MAX_NOTES_ON_SCREEN;
        const approachTime = config.DIFFICULTY_SETTINGS[difficulty].approachTime;
        
        // Filter out notes that would cause too much density
        const filteredNotes = [];
        
        for (let i = 0; i < notes.length; i++) {
            const currentNote = notes[i];
            
            // Count notes within approach time window
            const windowStart = currentNote.time - approachTime;
            const windowEnd = currentNote.time + approachTime;
            
            const notesInWindow = filteredNotes.filter(note => 
                note.time >= windowStart && note.time <= windowEnd
            );
            
            // Add note if we haven't exceeded density limit
            if (notesInWindow.length < maxNotes / 2) {
                filteredNotes.push(currentNote);
            } else if (currentNote.confidence > 0.8 || currentNote.energy > 0.8) {
                // Keep high confidence/energy notes even if dense
                filteredNotes.push(currentNote);
            }
        }
        
        return filteredNotes;
    }

    /**
     * Select lane for a note using weighted random selection
     */
    selectLane(laneCount, recentLanes, event) {
        // Simple seeded random number generator
        const random = () => {
            this.rngSeed = (this.rngSeed * 9301 + 49297) % 233280;
            return this.rngSeed / 233280;
        };
        
        // Adjust weights based on recent usage and event properties
        const weights = [...this.laneWeights];
        
        // Reduce weight for recently used lanes
        recentLanes.forEach(lane => {
            weights[lane] *= 0.3;
        });
        
        // Adjust weights based on event properties
        if (event.energy) {
            // High energy events favor outer lanes
            if (event.energy > 0.7) {
                weights[0] *= 1.3;
                weights[laneCount - 1] *= 1.3;
            }
            // Low energy events favor middle lanes
            if (event.energy < 0.4) {
                const midLanes = Math.floor(laneCount / 2);
                weights[midLanes] *= 1.3;
                if (laneCount % 2 === 0) {
                    weights[midLanes - 1] *= 1.3;
                }
            }
        }
        
        // Weighted random selection
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        let randomValue = random() * totalWeight;
        
        for (let i = 0; i < laneCount; i++) {
            randomValue -= weights[i];
            if (randomValue <= 0) {
                // Update lane weights for next selection
                this.laneWeights[i] *= 0.7; // Reduce weight for selected lane
                
                // Gradually restore weights
                for (let j = 0; j < laneCount; j++) {
                    if (j !== i) {
                        this.laneWeights[j] = Math.min(1, this.laneWeights[j] * 1.05);
                    }
                }
                
                return i;
            }
        }
        
        // Fallback
        return Math.floor(random() * laneCount);
    }

    /**
     * Get loudness at a specific time from segments
     */
    getLoudnessAtTime(audioAnalysis, timeSeconds) {
        if (!audioAnalysis.segments) return -30;
        
        const segment = audioAnalysis.segments.find(s => 
            timeSeconds >= s.start && timeSeconds < s.start + s.duration
        );
        
        if (segment) {
            return segment.loudness_max || segment.loudness_start || -30;
        }
        
        return -30;
    }

    /**
     * Get energy level at a specific time (estimated from sections)
     */
    getEnergyAtTime(audioAnalysis, timeSeconds) {
        if (!audioAnalysis.sections) return 0.5;
        
        const section = audioAnalysis.sections.find(s => 
            timeSeconds >= s.start && timeSeconds < s.start + s.duration
        );
        
        if (section) {
            return section.energy || 0.5;
        }
        
        return 0.5;
    }

    /**
     * Generate a seed value from audio analysis for consistent charts
     */
    generateSeedFromAnalysis(audioAnalysis) {
        let seed = 0;
        
        // Use track characteristics to generate seed
        if (audioAnalysis.track) {
            seed += audioAnalysis.track.duration * 1000;
            seed += audioAnalysis.track.tempo * 100;
            seed += audioAnalysis.track.key * 1000;
            seed += audioAnalysis.track.time_signature * 10000;
        }
        
        // Add some beats data
        if (audioAnalysis.beats && audioAnalysis.beats.length > 0) {
            seed += audioAnalysis.beats.length;
            seed += Math.floor(audioAnalysis.beats[0].start * 1000);
        }
        
        return Math.abs(Math.floor(seed)) % 1000000;
    }

    /**
     * Validate generated chart for issues
     */
    validateChart(notes) {
        let issues = 0;
        
        // Check for notes too close together
        for (let i = 1; i < notes.length; i++) {
            const timeDiff = notes[i].time - notes[i-1].time;
            if (timeDiff < config.CHART.MIN_NOTE_SPACING) {
                console.warn(`Notes too close: ${timeDiff}ms at ${notes[i].time}ms`);
                issues++;
            }
        }
        
        // Check for hold note overlaps
        const holdNotes = notes.filter(n => n.type === 'hold');
        holdNotes.forEach((hold, i) => {
            holdNotes.slice(i + 1).forEach(otherHold => {
                if (hold.lane === otherHold.lane) {
                    const overlap = Math.max(0, 
                        Math.min(hold.endTime, otherHold.endTime) - 
                        Math.max(hold.time, otherHold.time)
                    );
                    if (overlap > 0) {
                        console.warn(`Hold note overlap: ${overlap}ms in lane ${hold.lane}`);
                        issues++;
                    }
                }
            });
        });
        
        if (issues > 0) {
            console.warn(`Chart validation found ${issues} issues`);
        } else {
            console.log('Chart validation passed');
        }
    }

    /**
     * Generate a simple test chart (for development/testing)
     */
    generateTestChart(durationMs = 30000, difficulty = 'NORMAL') {
        const lanes = config.DIFFICULTY_SETTINGS[difficulty].lanes;
        const notes = [];
        
        // Generate simple beat pattern
        const bpm = 120;
        const beatInterval = (60 / bpm) * 1000; // ms per beat
        
        for (let time = 1000; time < durationMs; time += beatInterval) {
            const lane = Math.floor(Math.random() * lanes);
            notes.push({
                time: time,
                lane: lane,
                type: 'tap',
                confidence: 0.8,
                energy: 0.6,
                loudness: -15
            });
        }
        
        return {
            notes: notes,
            difficulty: difficulty,
            lanes: lanes,
            metadata: {
                totalNotes: notes.length,
                holdNotes: 0,
                duration: durationMs,
                generatedAt: Date.now(),
                isTest: true
            }
        };
    }
}
// improved-midi-chart-generator.js - Generate rhythm game charts from MIDI with precise timing

import { config } from './config.js';

export class MidiChartGenerator {
    constructor() {
        this.trackMidiData = new Map(); // Store MIDI data for each track
        this.loadMidiFiles();
    }

    /**
     * Load MIDI files for your locked tracks
     */
    async loadMidiFiles() {
        // Define your track-to-MIDI mapping
        const trackMidiMap = {
            '5FMyXeZ0reYloRTiCkPprT': 'track1.mid', // Your first locked track
            '0YWmeJtd7Fp1tH3978qUIH': 'track2.mid'  // Your second locked track
        };

        for (const [trackId, midiFile] of Object.entries(trackMidiMap)) {
            try {
                const midiData = await this.loadMidiFile(`./midi/${midiFile}`);
                this.trackMidiData.set(trackId, midiData);
                console.log(`Loaded MIDI for track ${trackId}: ${midiFile}`);
            } catch (error) {
                console.error(`Failed to load MIDI for ${trackId}:`, error);
            }
        }
    }

    /**
     * Load and parse a MIDI file
     */
    async loadMidiFile(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            return this.parseMidiFile(arrayBuffer);
        } catch (error) {
            throw new Error(`Failed to load MIDI file ${url}: ${error.message}`);
        }
    }

    /**
     * Parse MIDI file binary data
     */
    parseMidiFile(arrayBuffer) {
        const dataView = new DataView(arrayBuffer);
        let offset = 0;

        // Read MIDI header
        const headerChunk = this.readMidiHeader(dataView, offset);
        offset += headerChunk.length + 8;

        const midi = {
            format: headerChunk.format,
            trackCount: headerChunk.trackCount,
            ticksPerQuarter: headerChunk.ticksPerQuarter,
            tracks: []
        };

        // Read tracks
        for (let i = 0; i < headerChunk.trackCount && offset < arrayBuffer.byteLength; i++) {
            const track = this.readMidiTrack(dataView, offset);
            midi.tracks.push(track.events);
            offset += track.length + 8;
        }

        return midi;
    }

    /**
     * Read MIDI header chunk
     */
    readMidiHeader(dataView, offset) {
        // Skip "MThd" identifier (4 bytes)
        offset += 4;
        
        const length = dataView.getUint32(offset);
        offset += 4;
        
        const format = dataView.getUint16(offset);
        offset += 2;
        
        const trackCount = dataView.getUint16(offset);
        offset += 2;
        
        const ticksPerQuarter = dataView.getUint16(offset);
        offset += 2;

        return { length, format, trackCount, ticksPerQuarter };
    }

    /**
     * Read a MIDI track chunk
     */
    readMidiTrack(dataView, offset) {
        // Skip "MTrk" identifier (4 bytes)
        offset += 4;
        
        const length = dataView.getUint32(offset);
        offset += 4;
        
        const endOffset = offset + length;
        const events = [];
        let currentTime = 0;
        let runningStatus = 0;

        while (offset < endOffset) {
            // Read variable length delta time
            const { value: deltaTime, bytesRead } = this.readVariableLength(dataView, offset);
            offset += bytesRead;
            currentTime += deltaTime;

            // Read event
            const event = this.readMidiEvent(dataView, offset, currentTime, runningStatus);
            if (event.bytesRead === 0) break; // Safety check
            
            offset += event.bytesRead;
            events.push(event);
            
            if (event.type !== 'meta' && event.type !== 'sysex') {
                runningStatus = event.status;
            }
        }

        return { events, length };
    }

    /**
     * Read a variable length quantity from MIDI
     */
    readVariableLength(dataView, offset) {
        let value = 0;
        let bytesRead = 0;
        
        while (bytesRead < 4) {
            const byte = dataView.getUint8(offset + bytesRead);
            value = (value << 7) | (byte & 0x7F);
            bytesRead++;
            
            if ((byte & 0x80) === 0) break;
        }
        
        return { value, bytesRead };
    }

    /**
     * Read a MIDI event
     */
    readMidiEvent(dataView, offset, time, runningStatus) {
        const firstByte = dataView.getUint8(offset);
        
        if (firstByte === 0xFF) {
            // Meta event
            return this.readMetaEvent(dataView, offset, time);
        } else if (firstByte === 0xF0 || firstByte === 0xF7) {
            // System exclusive
            return this.readSysexEvent(dataView, offset, time);
        } else {
            // Channel event
            let status = firstByte;
            let dataOffset = offset + 1;
            
            if (firstByte < 0x80) {
                // Running status
                status = runningStatus;
                dataOffset = offset;
            }
            
            return this.readChannelEvent(dataView, dataOffset, time, status);
        }
    }

    /**
     * Read meta event (tempo, time signature, etc.)
     */
    readMetaEvent(dataView, offset, time) {
        const type = dataView.getUint8(offset + 1);
        const { value: length, bytesRead: lengthBytes } = this.readVariableLength(dataView, offset + 2);
        
        const event = {
            type: 'meta',
            metaType: type,
            time: time,
            bytesRead: 2 + lengthBytes + length
        };

        // Parse specific meta events
        switch (type) {
            case 0x51: // Tempo
                if (length === 3) {
                    const microsecondsPerQuarter = 
                        (dataView.getUint8(offset + 2 + lengthBytes) << 16) |
                        (dataView.getUint8(offset + 3 + lengthBytes) << 8) |
                        dataView.getUint8(offset + 4 + lengthBytes);
                    event.tempo = 60000000 / microsecondsPerQuarter; // BPM
                    event.microsecondsPerQuarter = microsecondsPerQuarter;
                }
                break;
                
            case 0x58: // Time signature
                if (length === 4) {
                    event.timeSignature = {
                        numerator: dataView.getUint8(offset + 2 + lengthBytes),
                        denominator: Math.pow(2, dataView.getUint8(offset + 3 + lengthBytes)),
                        clocksPerClick: dataView.getUint8(offset + 4 + lengthBytes),
                        thirtySecondsPer24Clocks: dataView.getUint8(offset + 5 + lengthBytes)
                    };
                }
                break;
        }

        return event;
    }

    /**
     * Read system exclusive event
     */
    readSysexEvent(dataView, offset, time) {
        const { value: length, bytesRead } = this.readVariableLength(dataView, offset + 1);
        
        return {
            type: 'sysex',
            time: time,
            bytesRead: 1 + bytesRead + length
        };
    }

    /**
     * Read channel event (note on/off, etc.)
     */
    readChannelEvent(dataView, offset, time, status) {
        const eventType = (status >> 4) & 0x0F;
        const channel = status & 0x0F;
        
        let bytesRead = 1; // Status byte already consumed
        let data1 = 0, data2 = 0;
        
        // Read data bytes based on event type
        if (eventType !== 0x0C && eventType !== 0x0D) {
            // Most events have 2 data bytes
            data1 = dataView.getUint8(offset);
            data2 = dataView.getUint8(offset + 1);
            bytesRead = 2;
        } else {
            // Program change and channel pressure have 1 data byte
            data1 = dataView.getUint8(offset);
            bytesRead = 1;
        }

        const event = {
            type: 'channel',
            status: status,
            channel: channel,
            time: time,
            data1: data1,
            data2: data2,
            bytesRead: bytesRead
        };

        // Add semantic meaning
        switch (eventType) {
            case 0x08: // Note off
                event.eventType = 'noteOff';
                event.note = data1;
                event.velocity = data2;
                break;
                
            case 0x09: // Note on (or off if velocity = 0)
                event.eventType = (data2 === 0) ? 'noteOff' : 'noteOn';
                event.note = data1;
                event.velocity = data2;
                break;
        }

        return event;
    }

    /**
     * Generate rhythm game chart from MIDI data with improved timing
     */
    generateChartFromMidi(trackId, difficulty = 'NORMAL') {
        const midiData = this.trackMidiData.get(trackId);
        if (!midiData) {
            throw new Error(`No MIDI data found for track ${trackId}`);
        }

        const difficultySettings = config.DIFFICULTY_SETTINGS[difficulty];
        const lanes = difficultySettings.lanes;

        console.log(`Generating ${difficulty} chart from MIDI for track ${trackId}`);

        // Extract note events and tempo changes
        const noteEvents = this.extractNoteEvents(midiData);
        const tempoMap = this.extractTempoMap(midiData);

        console.log(`Found ${noteEvents.length} note events and ${tempoMap.length} tempo changes`);

        // Convert MIDI ticks to precise milliseconds
        const timedNotes = this.convertTicksToTimeAdvanced(noteEvents, tempoMap, midiData.ticksPerQuarter);

        console.log(`Converted to ${timedNotes.length} timed notes`);

        // Generate rhythm game notes with better mapping
        const gameNotes = this.convertToGameNotesAdvanced(timedNotes, lanes, difficulty);

        // Apply difficulty-specific filtering and optimization
        const finalNotes = this.optimizeChart(gameNotes, difficulty);

        const chart = {
            notes: finalNotes,
            difficulty: difficulty,
            lanes: lanes,
            metadata: {
                totalNotes: finalNotes.length,
                holdNotes: finalNotes.filter(n => n.type === 'hold').length,
                source: 'midi',
                trackId: trackId,
                generatedAt: Date.now(),
                tempoChanges: tempoMap.length,
                originalMidiNotes: noteEvents.length
            }
        };

        console.log(`Generated MIDI chart: ${chart.metadata.totalNotes} notes, ${chart.metadata.holdNotes} holds`);
        return chart;
    }

    /**
     * Extract note on/off events from MIDI data
     */
    extractNoteEvents(midiData) {
        const noteEvents = [];
        
        for (const track of midiData.tracks) {
            for (const event of track) {
                if (event.type === 'channel' && 
                    (event.eventType === 'noteOn' || event.eventType === 'noteOff')) {
                    noteEvents.push(event);
                }
            }
        }
        
        return noteEvents.sort((a, b) => a.time - b.time);
    }

    /**
     * Extract tempo changes from MIDI data with defaults
     */
    extractTempoMap(midiData) {
        const tempoEvents = [];
        
        for (const track of midiData.tracks) {
            for (const event of track) {
                if (event.type === 'meta' && event.metaType === 0x51 && event.tempo) {
                    tempoEvents.push({
                        time: event.time,
                        tempo: event.tempo,
                        microsecondsPerQuarter: event.microsecondsPerQuarter || (60000000 / event.tempo)
                    });
                }
            }
        }
        
        // Add default tempo if none found
        if (tempoEvents.length === 0) {
            tempoEvents.push({ 
                time: 0, 
                tempo: 120, 
                microsecondsPerQuarter: 500000 // 120 BPM = 500,000 microseconds per quarter note
            });
        }
        
        return tempoEvents.sort((a, b) => a.time - b.time);
    }

    /**
     * Convert MIDI ticks to milliseconds with improved precision
     */
    convertTicksToTimeAdvanced(noteEvents, tempoMap, ticksPerQuarter) {
        const timedNotes = [];
        let currentTempoIndex = 0;
        let currentTempo = tempoMap[0];
        let cumulativeMs = 0;
        let lastTickTime = 0;
        
        // Build a comprehensive time map
        const timeMap = new Map();
        
        // Create sorted list of all timing events
        const allEvents = [...noteEvents, ...tempoMap].sort((a, b) => a.time - b.time);
        
        for (const event of allEvents) {
            const tickTime = event.time;
            
            // Update tempo if we've hit a tempo change
            while (currentTempoIndex + 1 < tempoMap.length && 
                   tickTime >= tempoMap[currentTempoIndex + 1].time) {
                // Calculate time elapsed at current tempo
                const tickDelta = tempoMap[currentTempoIndex + 1].time - lastTickTime;
                const msDelta = (tickDelta / ticksPerQuarter) * (currentTempo.microsecondsPerQuarter / 1000);
                cumulativeMs += msDelta;
                
                lastTickTime = tempoMap[currentTempoIndex + 1].time;
                currentTempoIndex++;
                currentTempo = tempoMap[currentTempoIndex];
            }
            
            // Calculate time for this event
            const tickDelta = tickTime - lastTickTime;
            const msDelta = (tickDelta / ticksPerQuarter) * (currentTempo.microsecondsPerQuarter / 1000);
            const eventTimeMs = cumulativeMs + msDelta;
            
            // Store in time map for quick lookup
            if (!timeMap.has(tickTime)) {
                timeMap.set(tickTime, Math.round(eventTimeMs * 100) / 100); // Round to 0.01ms precision
            }
            
            // If this is a note event, convert it
            if (event.eventType === 'noteOn' || event.eventType === 'noteOff') {
                timedNotes.push({
                    ...event,
                    timeMs: timeMap.get(tickTime)
                });
            }
        }
        
        return timedNotes.sort((a, b) => a.timeMs - b.timeMs);
    }

    /**
     * Convert MIDI notes to rhythm game notes with advanced mapping
     */
    convertToGameNotesAdvanced(timedNotes, laneCount, difficulty) {
        const gameNotes = [];
        const activeNotes = new Map(); // Track held notes
        
        // Analyze note patterns for intelligent lane assignment
        const noteAnalysis = this.analyzeNotePatterns(timedNotes);
        const laneMapper = this.createAdvancedLaneMapper(noteAnalysis, laneCount);
        
        for (const midiNote of timedNotes) {
            const lane = laneMapper.getLane(midiNote);
            if (lane === -1) continue; // Skip unmapped notes
            
            if (midiNote.eventType === 'noteOn') {
                const gameNote = {
                    time: midiNote.timeMs,
                    lane: lane,
                    type: 'tap',
                    velocity: midiNote.velocity,
                    pitch: midiNote.note,
                    channel: midiNote.channel,
                    originalTick: midiNote.time // Keep original tick for debugging
                };
                
                // Track this note for potential hold conversion
                const noteKey = `${midiNote.note}_${midiNote.channel}`;
                activeNotes.set(noteKey, {
                    gameNote: gameNote,
                    startTime: midiNote.timeMs
                });
                
                gameNotes.push(gameNote);
                
            } else if (midiNote.eventType === 'noteOff') {
                // End of a note - convert to hold if long enough
                const noteKey = `${midiNote.note}_${midiNote.channel}`;
                const activeNote = activeNotes.get(noteKey);
                
                if (activeNote) {
                    const duration = midiNote.timeMs - activeNote.startTime;
                    
                    // More lenient hold note detection for rhythm games
                    const minHoldDuration = Math.max(200, config.CHART.HOLD_MIN_DURATION * 0.6);
                    
                    if (duration >= minHoldDuration) {
                        activeNote.gameNote.type = 'hold';
                        activeNote.gameNote.endTime = midiNote.timeMs;
                        activeNote.gameNote.duration = duration;
                    }
                    
                    activeNotes.delete(noteKey);
                }
            }
        }
        
        return gameNotes.sort((a, b) => a.time - b.time);
    }

    /**
     * Analyze MIDI note patterns for better lane assignment
     */
    analyzeNotePatterns(timedNotes) {
        const pitchFrequency = new Map();
        const channelFrequency = new Map();
        const velocityDistribution = new Map();
        const timeIntervals = [];
        
        let lastTime = 0;
        
        for (const note of timedNotes) {
            if (note.eventType === 'noteOn') {
                // Pitch frequency
                pitchFrequency.set(note.note, (pitchFrequency.get(note.note) || 0) + 1);
                
                // Channel frequency
                channelFrequency.set(note.channel, (channelFrequency.get(note.channel) || 0) + 1);
                
                // Velocity distribution
                const velBucket = Math.floor(note.velocity / 16) * 16;
                velocityDistribution.set(velBucket, (velocityDistribution.get(velBucket) || 0) + 1);
                
                // Time intervals
                if (lastTime > 0) {
                    timeIntervals.push(note.timeMs - lastTime);
                }
                lastTime = note.timeMs;
            }
        }
        
        return {
            pitchFrequency,
            channelFrequency,
            velocityDistribution,
            averageInterval: timeIntervals.length > 0 ? 
                timeIntervals.reduce((a, b) => a + b, 0) / timeIntervals.length : 0
        };
    }

    /**
     * Create advanced lane mapper based on note analysis
     */
    createAdvancedLaneMapper(analysis, laneCount) {
        const { pitchFrequency, channelFrequency } = analysis;
        
        // Sort pitches by frequency and assign to lanes strategically
        const sortedPitches = Array.from(pitchFrequency.entries())
            .sort((a, b) => b[1] - a[1]);
        
        const pitchToLane = new Map();
        const channelToLanePreference = new Map();
        
        // Primary lane assignment based on frequency
        for (let i = 0; i < Math.min(sortedPitches.length, laneCount * 3); i++) {
            const pitch = sortedPitches[i][0];
            const preferredLane = i % laneCount;
            pitchToLane.set(pitch, preferredLane);
        }
        
        // Channel-based lane preferences (for drums/percussion)
        Array.from(channelFrequency.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, laneCount)
            .forEach(([channel], index) => {
                channelToLanePreference.set(channel, index);
            });
        
        return {
            getLane: (midiNote) => {
                // Try pitch-based mapping first
                if (pitchToLane.has(midiNote.note)) {
                    return pitchToLane.get(midiNote.note);
                }
                
                // Fallback to channel-based mapping
                if (channelToLanePreference.has(midiNote.channel)) {
                    return channelToLanePreference.get(midiNote.channel);
                }
                
                // Final fallback: distribute by pitch range
                const laneIndex = Math.floor(((midiNote.note - 21) / (108 - 21)) * laneCount);
                return Math.max(0, Math.min(laneCount - 1, laneIndex));
            }
        };
    }

    /**
     * Optimize chart for better playability
     */
    optimizeChart(notes, difficulty) {
        const densityMultiplier = config.CHART.DENSITY_MULTIPLIERS[difficulty];
        let optimizedNotes = [...notes];
        
        // Remove notes that are too close together
        optimizedNotes = this.removeOverlappingNotes(optimizedNotes);
        
        // Apply difficulty scaling
        if (densityMultiplier < 1.0) {
            optimizedNotes = this.reduceDensity(optimizedNotes, densityMultiplier);
        }
        
        // Smooth out difficulty spikes
        optimizedNotes = this.smoothDifficultySpikes(optimizedNotes);
        
        // Ensure minimum spacing
        optimizedNotes = this.enforceMinimumSpacing(optimizedNotes);
        
        return optimizedNotes.sort((a, b) => a.time - b.time);
    }

    /**
     * Remove overlapping notes in the same lane
     */
    removeOverlappingNotes(notes) {
        const laneLastTime = new Map();
        const filtered = [];
        
        for (const note of notes) {
            const lastTime = laneLastTime.get(note.lane) || -Infinity;
            const timeDiff = note.time - lastTime;
            
            // Minimum 50ms between notes in same lane
            if (timeDiff >= 50) {
                filtered.push(note);
                laneLastTime.set(note.lane, note.time);
            }
        }
        
        return filtered;
    }

    /**
     * Reduce note density for easier difficulties
     */
    reduceDensity(notes, multiplier) {
        if (multiplier >= 1.0) return notes;
        
        const targetCount = Math.floor(notes.length * multiplier);
        const filtered = [];
        
        // Keep notes with higher velocity and better spacing
        const scored = notes.map(note => ({
            note,
            score: (note.velocity || 64) + (note.type === 'hold' ? 20 : 0)
        }));
        
        scored.sort((a, b) => b.score - a.score);
        
        for (let i = 0; i < Math.min(targetCount, scored.length); i++) {
            filtered.push(scored[i].note);
        }
        
        return filtered.sort((a, b) => a.time - b.time);
    }

    /**
     * Smooth out sudden difficulty spikes
     */
    smoothDifficultySpikes(notes) {
        const windowSize = 2000; // 2 second window
        const maxNotesPerWindow = 8; // Max notes per 2 seconds
        
        const smoothed = [];
        let windowStart = 0;
        
        for (const note of notes) {
            // Count notes in current window
            const windowNotes = smoothed.filter(n => 
                note.time - n.time <= windowSize
            );
            
            if (windowNotes.length < maxNotesPerWindow) {
                smoothed.push(note);
            } else {
                // Skip this note to avoid spike
                continue;
            }
        }
        
        return smoothed;
    }

    /**
     * Ensure minimum spacing between all notes
     */
    enforceMinimumSpacing(notes) {
        const minSpacing = config.CHART.MIN_NOTE_SPACING;
        const spaced = [];
        let lastTime = -Infinity;
        
        for (const note of notes) {
            if (note.time - lastTime >= minSpacing) {
                spaced.push(note);
                lastTime = note.time;
            }
        }
        
        return spaced;
    }

    /**
     * Check if MIDI data exists for a track
     */
    hasMidiData(trackId) {
        return this.trackMidiData.has(trackId);
    }

    /**
     * Get available tracks with MIDI data
     */
    getAvailableTracks() {
        return Array.from(this.trackMidiData.keys());
    }
}

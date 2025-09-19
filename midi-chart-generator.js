// improved-midi-chart-generator.js - Fixed MIDI parsing and timing conversion

import { config } from './config.js';

export class MidiChartGenerator {
    constructor() {
        this.trackMidiData = new Map();
        this.loadMidiFiles();
    }

    /**
     * Load MIDI files for locked tracks
     */
    async loadMidiFiles() {
        const trackMidiMap = {
            '5FMyXeZ0reYloRTiCkPprT': 'track1.mid',
            '0YWmeJtd7Fp1tH3978qUIH': 'track2.mid'
        };

        for (const [trackId, midiFile] of Object.entries(trackMidiMap)) {
            try {
                const midiData = await this.loadMidiFile(`./midi/${midiFile}`);
                this.trackMidiData.set(trackId, midiData);
                console.log(`Loaded MIDI for track ${trackId}: ${midiFile}`);
            } catch (error) {
                console.warn(`Failed to load MIDI for ${trackId}:`, error);
            }
        }
    }

    /**
     * Load and parse a MIDI file with better error handling
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
     * Parse MIDI file with improved timing accuracy
     */
    parseMidiFile(arrayBuffer) {
        const dataView = new DataView(arrayBuffer);
        let offset = 0;

        // Validate MIDI header
        const headerSignature = new TextDecoder().decode(new Uint8Array(arrayBuffer, 0, 4));
        if (headerSignature !== 'MThd') {
            throw new Error('Invalid MIDI file: missing MThd header');
        }

        // Read header
        const headerChunk = this.readMidiHeader(dataView, offset);
        offset += headerChunk.length + 8;

        const midi = {
            format: headerChunk.format,
            trackCount: headerChunk.trackCount,
            ticksPerQuarter: headerChunk.ticksPerQuarter,
            tracks: [],
            tempoMap: [], // Store tempo changes
            timeSignatureMap: [] // Store time signature changes
        };

        // Read all tracks
        for (let i = 0; i < headerChunk.trackCount && offset < arrayBuffer.byteLength; i++) {
            try {
                const track = this.readMidiTrack(dataView, offset);
                midi.tracks.push(track.events);
                offset += track.length + 8;
            } catch (error) {
                console.warn(`Error reading track ${i}:`, error);
                break;
            }
        }

        // Extract tempo and time signature information
        this.extractTimingMaps(midi);

        return midi;
    }

    /**
     * Read MIDI header with validation
     */
    readMidiHeader(dataView, offset) {
        offset += 4; // Skip "MThd"
        
        const length = dataView.getUint32(offset);
        if (length !== 6) {
            throw new Error('Invalid MIDI header length');
        }
        offset += 4;
        
        const format = dataView.getUint16(offset);
        if (format > 2) {
            throw new Error(`Unsupported MIDI format: ${format}`);
        }
        offset += 2;
        
        const trackCount = dataView.getUint16(offset);
        offset += 2;
        
        const ticksPerQuarter = dataView.getUint16(offset);
        if (ticksPerQuarter === 0) {
            throw new Error('Invalid ticks per quarter note');
        }
        
        return { length, format, trackCount, ticksPerQuarter };
    }

    /**
     * Read MIDI track with better error handling
     */
    readMidiTrack(dataView, offset) {
        const trackSignature = new TextDecoder().decode(
            new Uint8Array(dataView.buffer, offset, 4)
        );
        
        if (trackSignature !== 'MTrk') {
            throw new Error('Invalid track header');
        }
        
        offset += 4; // Skip "MTrk"
        
        const length = dataView.getUint32(offset);
        offset += 4;
        
        const endOffset = offset + length;
        const events = [];
        let currentTime = 0;
        let runningStatus = 0;

        while (offset < endOffset) {
            try {
                // Read delta time
                const { value: deltaTime, bytesRead } = this.readVariableLength(dataView, offset);
                offset += bytesRead;
                currentTime += deltaTime;

                // Read event
                const event = this.readMidiEvent(dataView, offset, currentTime, runningStatus);
                if (event.bytesRead === 0) {
                    console.warn('Zero-length event, stopping track parsing');
                    break;
                }
                
                offset += event.bytesRead;
                events.push(event);
                
                if (event.type !== 'meta' && event.type !== 'sysex') {
                    runningStatus = event.status;
                }
                
            } catch (eventError) {
                console.warn('Error parsing MIDI event, skipping:', eventError);
                break;
            }
        }

        return { events, length };
    }

    /**
     * Extract tempo and time signature maps for accurate timing
     */
    extractTimingMaps(midi) {
        const tempoMap = [];
        const timeSignatureMap = [];

        for (const track of midi.tracks) {
            for (const event of track) {
                if (event.type === 'meta') {
                    if (event.metaType === 0x51 && event.tempo) {
                        tempoMap.push({
                            tick: event.time,
                            tempo: event.tempo,
                            microsecondsPerQuarter: 60000000 / event.tempo
                        });
                    } else if (event.metaType === 0x58 && event.timeSignature) {
                        timeSignatureMap.push({
                            tick: event.time,
                            ...event.timeSignature
                        });
                    }
                }
            }
        }

        // Sort by time
        tempoMap.sort((a, b) => a.tick - b.tick);
        timeSignatureMap.sort((a, b) => a.tick - b.tick);

        // Add default tempo if none found
        if (tempoMap.length === 0) {
            tempoMap.push({
                tick: 0,
                tempo: 120,
                microsecondsPerQuarter: 500000
            });
        }

        // Add default time signature if none found
        if (timeSignatureMap.length === 0) {
            timeSignatureMap.push({
                tick: 0,
                numerator: 4,
                denominator: 4,
                clocksPerClick: 24,
                thirtySecondsPer24Clocks: 8
            });
        }

        midi.tempoMap = tempoMap;
        midi.timeSignatureMap = timeSignatureMap;
    }

    /**
     * Read variable length quantity with bounds checking
     */
    readVariableLength(dataView, offset) {
        let value = 0;
        let bytesRead = 0;
        
        while (bytesRead < 4 && offset + bytesRead < dataView.byteLength) {
            const byte = dataView.getUint8(offset + bytesRead);
            value = (value << 7) | (byte & 0x7F);
            bytesRead++;
            
            if ((byte & 0x80) === 0) break;
        }
        
        return { value, bytesRead };
    }

    /**
     * Read meta event with proper parsing
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

        const dataOffset = offset + 2 + lengthBytes;

        switch (type) {
            case 0x51: // Set Tempo
                if (length === 3) {
                    const microsecondsPerQuarter = 
                        (dataView.getUint8(dataOffset) << 16) |
                        (dataView.getUint8(dataOffset + 1) << 8) |
                        dataView.getUint8(dataOffset + 2);
                    event.tempo = Math.round(60000000 / microsecondsPerQuarter);
                    event.microsecondsPerQuarter = microsecondsPerQuarter;
                }
                break;
                
            case 0x58: // Time Signature
                if (length === 4) {
                    event.timeSignature = {
                        numerator: dataView.getUint8(dataOffset),
                        denominator: Math.pow(2, dataView.getUint8(dataOffset + 1)),
                        clocksPerClick: dataView.getUint8(dataOffset + 2),
                        thirtySecondsPer24Clocks: dataView.getUint8(dataOffset + 3)
                    };
                }
                break;
                
            case 0x2F: // End of Track
                event.endOfTrack = true;
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
     * Read channel event with proper status handling
     */
    readChannelEvent(dataView, offset, time, status) {
        const eventType = (status >> 4) & 0x0F;
        const channel = status & 0x0F;
        
        let bytesRead = 1; // Status byte
        let data1 = 0, data2 = 0;
        
        // Read data bytes based on event type
        switch (eventType) {
            case 0x08: // Note Off
            case 0x09: // Note On
            case 0x0A: // Polyphonic Key Pressure
            case 0x0B: // Control Change
            case 0x0E: // Pitch Bend
                data1 = dataView.getUint8(offset);
                data2 = dataView.getUint8(offset + 1);
                bytesRead = 2;
                break;
                
            case 0x0C: // Program Change
            case 0x0D: // Channel Pressure
                data1 = dataView.getUint8(offset);
                bytesRead = 1;
                break;
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
            case 0x08: // Note Off
                event.eventType = 'noteOff';
                event.note = data1;
                event.velocity = data2;
                break;
                
            case 0x09: // Note On
                event.eventType = (data2 === 0) ? 'noteOff' : 'noteOn';
                event.note = data1;
                event.velocity = data2;
                break;
        }

        return event;
    }

    /**
     * Read MIDI event with proper error handling
     */
    readMidiEvent(dataView, offset, time, runningStatus) {
        if (offset >= dataView.byteLength) {
            return { type: 'error', bytesRead: 0 };
        }
        
        const firstByte = dataView.getUint8(offset);
        
        if (firstByte === 0xFF) {
            return this.readMetaEvent(dataView, offset, time);
        } else if (firstByte === 0xF0 || firstByte === 0xF7) {
            return this.readSysexEvent(dataView, offset, time);
        } else {
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
     * Convert MIDI ticks to milliseconds with precise tempo tracking
     */
    convertTicksToMilliseconds(ticks, tempoMap, ticksPerQuarter) {
        let currentTime = 0; // in milliseconds
        let currentTick = 0;
        let tempoIndex = 0;
        let currentTempo = tempoMap[0];

        // If target tick is before or at current tempo, calculate directly
        if (ticks <= currentTempo.tick) {
            const tickDiff = ticks - currentTick;
            const msPerTick = currentTempo.microsecondsPerQuarter / ticksPerQuarter / 1000;
            return currentTime + (tickDiff * msPerTick);
        }

        // Step through tempo changes
        while (tempoIndex < tempoMap.length - 1 && ticks > tempoMap[tempoIndex + 1].tick) {
            const nextTempo = tempoMap[tempoIndex + 1];
            
            // Calculate time for this tempo segment
            const ticksInSegment = nextTempo.tick - currentTick;
            const msPerTick = currentTempo.microsecondsPerQuarter / ticksPerQuarter / 1000;
            currentTime += ticksInSegment * msPerTick;
            
            // Move to next segment
            currentTick = nextTempo.tick;
            currentTempo = nextTempo;
            tempoIndex++;
        }

        // Calculate remaining time with final tempo
        const remainingTicks = ticks - currentTick;
        const msPerTick = currentTempo.microsecondsPerQuarter / ticksPerQuarter / 1000;
        return currentTime + (remainingTicks * msPerTick);
    }

    /**
     * Generate rhythm game chart from MIDI with precise timing
     */
    generateChartFromMidi(trackId, difficulty = 'NORMAL') {
        const midiData = this.trackMidiData.get(trackId);
        if (!midiData) {
            throw new Error(`No MIDI data found for track ${trackId}`);
        }

        const difficultySettings = config.DIFFICULTY_SETTINGS[difficulty];
        const lanes = difficultySettings.lanes;

        console.log(`Generating ${difficulty} MIDI chart for track ${trackId}`);
        console.log(`MIDI: ${midiData.tracks.length} tracks, ${midiData.ticksPerQuarter} ticks/quarter`);
        console.log(`Tempo changes: ${midiData.tempoMap.length}`);

        // Extract note events
        const noteEvents = this.extractNoteEvents(midiData);
        console.log(`Extracted ${noteEvents.length} note events`);

        // Convert to timed events with precise timing
        const timedEvents = this.convertToTimedEvents(noteEvents, midiData);
        console.log(`Generated ${timedEvents.length} timed events`);

        // Convert to rhythm game notes
        const gameNotes = this.convertToGameNotes(timedEvents, lanes, difficulty);
        console.log(`Generated ${gameNotes.length} game notes`);

        // Apply difficulty filtering
        const finalNotes = this.applyDifficultyFilter(gameNotes, difficulty);

        const chart = {
            notes: finalNotes,
            difficulty: difficulty,
            lanes: lanes,
            metadata: {
                totalNotes: finalNotes.length,
                holdNotes: finalNotes.filter(n => n.type === 'hold').length,
                source: 'midi',
                trackId: trackId,
                ticksPerQuarter: midiData.ticksPerQuarter,
                tempoChanges: midiData.tempoMap.length,
                generatedAt: Date.now()
            }
        };

        console.log(`Final MIDI chart: ${chart.metadata.totalNotes} notes, ${chart.metadata.holdNotes} holds`);
        return chart;
    }

    /**
     * Extract note events from all tracks
     */
    extractNoteEvents(midiData) {
        const noteEvents = [];
        
        for (let trackIndex = 0; trackIndex < midiData.tracks.length; trackIndex++) {
            const track = midiData.tracks[trackIndex];
            
            for (const event of track) {
                if (event.type === 'channel' && 
                    (event.eventType === 'noteOn' || event.eventType === 'noteOff')) {
                    
                    noteEvents.push({
                        ...event,
                        trackIndex: trackIndex
                    });
                }
            }
        }
        
        return noteEvents.sort((a, b) => a.time - b.time);
    }

    /**
     * Convert MIDI events to timed events with precise timing
     */
    convertToTimedEvents(noteEvents, midiData) {
        const timedEvents = [];
        
        for (const event of noteEvents) {
            const timeMs = this.convertTicksToMilliseconds(
                event.time, 
                midiData.tempoMap, 
                midiData.ticksPerQuarter
            );
            
            timedEvents.push({
                ...event,
                timeMs: Math.round(timeMs)
            });
        }
        
        return timedEvents;
    }

    /**
     * Convert timed events to rhythm game notes
     */
    convertToGameNotes(timedEvents, laneCount, difficulty) {
        const gameNotes = [];
        const activeNotes = new Map(); // Track note-on events for hold conversion
        
        // Create pitch to lane mapping
        const pitchMapping = this.createPitchToLaneMapping(timedEvents, laneCount);
        
        for (const event of timedEvents) {
            const lane = pitchMapping.get(event.note);
            if (lane === undefined) continue;
            
            const noteKey = `${event.note}_${event.channel}_${lane}`;
            
            if (event.eventType === 'noteOn' && event.velocity > 0) {
                // Start of note
                const gameNote = {
                    time: event.timeMs,
                    lane: lane,
                    type: 'tap',
                    velocity: event.velocity,
                    pitch: event.note,
                    channel: event.channel
                };
                
                // Track for potential hold conversion
                activeNotes.set(noteKey, {
                    gameNote: gameNote,
                    startTime: event.timeMs
                });
                
                gameNotes.push(gameNote);
                
            } else if (event.eventType === 'noteOff' || 
                      (event.eventType === 'noteOn' && event.velocity === 0)) {
                // End of note
                const activeNote = activeNotes.get(noteKey);
                
                if (activeNote) {
                    const duration = event.timeMs - activeNote.startTime;
                    
                    // Convert to hold note if long enough
                    if (duration >= config.CHART.HOLD_MIN_DURATION) {
                        activeNote.gameNote.type = 'hold';
                        activeNote.gameNote.endTime = event.timeMs;
                        activeNote.gameNote.duration = duration;
                    }
                    
                    activeNotes.delete(noteKey);
                }
            }
        }
        
        return gameNotes.sort((a, b) => a.time - b.time);
    }

    /**
     * Create intelligent pitch to lane mapping
     */
    createPitchToLaneMapping(timedEvents, laneCount) {
        // Analyze pitch usage frequency and range
        const pitchStats = new Map();
        let minPitch = 127;
        let maxPitch = 0;
        
        for (const event of timedEvents) {
            if (event.eventType === 'noteOn' && event.velocity > 0) {
                pitchStats.set(event.note, (pitchStats.get(event.note) || 0) + 1);
                minPitch = Math.min(minPitch, event.note);
                maxPitch = Math.max(maxPitch, event.note);
            }
        }
        
        // Get most frequently used pitches
        const sortedPitches = Array.from(pitchStats.entries())
            .sort((a, b) => b[1] - a[1]) // Sort by frequency descending
            .slice(0, Math.min(laneCount * 3, pitchStats.size)); // Take up to 3x lanes
        
        const pitchToLane = new Map();
        
        if (sortedPitches.length <= laneCount) {
            // Simple case: assign each pitch to a lane
            sortedPitches.forEach((pitch, index) => {
                pitchToLane.set(pitch[0], index % laneCount);
            });
        } else {
            // Complex case: distribute pitches across lanes based on frequency and range
            const pitchRange = maxPitch - minPitch;
            
            for (const [pitch, frequency] of sortedPitches) {
                // Assign lane based on pitch range (lower pitches to left lanes)
                let lane;
                if (pitchRange > 0) {
                    const normalizedPitch = (pitch - minPitch) / pitchRange;
                    lane = Math.floor(normalizedPitch * laneCount);
                } else {
                    // All same pitch, distribute by frequency
                    lane = sortedPitches.indexOf([pitch, frequency]) % laneCount;
                }
                
                lane = Math.max(0, Math.min(laneCount - 1, lane));
                pitchToLane.set(pitch, lane);
            }
        }
        
        return pitchToLane;
    }

    /**
     * Apply difficulty-specific filtering and adjustments
     */
    applyDifficultyFilter(notes, difficulty) {
        const densityMultiplier = config.CHART.DENSITY_MULTIPLIERS[difficulty];
        
        if (densityMultiplier >= 1.0) {
            return this.removeOverlappingNotes(notes);
        }
        
        // Filter notes based on difficulty
        const minSpacing = config.CHART.MIN_NOTE_SPACING / densityMultiplier;
        const filteredNotes = [];
        
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            
            if (i === 0) {
                filteredNotes.push(note);
                continue;
            }
            
            const lastNote = filteredNotes[filteredNotes.length - 1];
            const timeDiff = note.time - lastNote.time;
            
            // Keep note if timing is good or if it's a special note
            if (timeDiff >= minSpacing || 
                note.type === 'hold' || 
                note.velocity >= 100) {
                filteredNotes.push(note);
            }
        }
        
        return this.removeOverlappingNotes(filteredNotes);
    }

    /**
     * Remove overlapping notes in the same lane
     */
    removeOverlappingNotes(notes) {
        const cleanNotes = [];
        const laneLastTime = new Map();
        
        for (const note of notes) {
            const lastTime = laneLastTime.get(note.lane) || -1000;
            const minGap = note.type === 'hold' ? 50 : config.CHART.MIN_NOTE_SPACING;
            
            if (note.time - lastTime >= minGap) {
                cleanNotes.push(note);
                laneLastTime.set(note.lane, note.endTime || note.time);
            }
        }
        
        return cleanNotes;
    }

    /**
     * Check if MIDI data exists for a track
     */
    hasMidiData(trackId) {
        return this.trackMidiData.has(trackId);
    }

    /**
     * Get list of available tracks
     */
    getAvailableTracks() {
        return Array.from(this.trackMidiData.keys());
    }

    /**
     * Get MIDI file information for debugging
     */
    getMidiInfo(trackId) {
        const midiData = this.trackMidiData.get(trackId);
        if (!midiData) return null;
        
        return {
            trackCount: midiData.tracks.length,
            ticksPerQuarter: midiData.ticksPerQuarter,
            tempoChanges: midiData.tempoMap.length,
            timeSignatureChanges: midiData.timeSignatureMap.length,
            totalEvents: midiData.tracks.reduce((sum, track) => sum + track.length, 0)
        };
    }
}

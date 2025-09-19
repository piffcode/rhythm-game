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
                const midiData = await this.loadMidiFile(`./${midiFile}`);
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
     * Parse MIDI file with improved timing accuracy and error recovery
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
            tempoMap: [],
            timeSignatureMap: []
        };

        // Read all tracks with better error recovery
        let tracksProcessed = 0;
        while (tracksProcessed < headerChunk.trackCount && offset < arrayBuffer.byteLength) {
            try {
                const track = this.readMidiTrack(dataView, offset);
                midi.tracks.push(track.events);
                offset += track.length + 8;
                tracksProcessed++;
            } catch (error) {
                console.warn(`Error reading track ${tracksProcessed}:`, error);
                // Try to skip to next track
                offset = this.findNextTrackHeader(dataView, offset);
                if (offset === -1) break;
                tracksProcessed++;
            }
        }

        // Extract tempo and time signature information
        this.extractTimingMaps(midi);

        console.log(`MIDI parsed: ${midi.tracks.length} tracks, ${midi.tempoMap.length} tempo changes`);
        return midi;
    }

    /**
     * Find next track header after an error
     */
    findNextTrackHeader(dataView, startOffset) {
        const trackSignature = new Uint8Array([0x4D, 0x54, 0x72, 0x6B]); // "MTrk"
        
        for (let i = startOffset; i <= dataView.byteLength - 4; i++) {
            let found = true;
            for (let j = 0; j < 4; j++) {
                if (dataView.getUint8(i + j) !== trackSignature[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return i;
        }
        return -1;
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
     * Read MIDI track with improved error handling
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
                // Bounds check
                if (offset >= dataView.byteLength) break;
                
                // Read delta time
                const deltaResult = this.readVariableLength(dataView, offset);
                if (deltaResult.bytesRead === 0) break;
                
                offset += deltaResult.bytesRead;
                currentTime += deltaResult.value;

                // Read event
                const event = this.readMidiEvent(dataView, offset, currentTime, runningStatus);
                if (event.bytesRead === 0) {
                    console.warn('Zero-length event, attempting to continue');
                    offset++;
                    continue;
                }
                
                offset += event.bytesRead;
                
                // Only add valid events
                if (event.type && event.time >= 0) {
                    events.push(event);
                }
                
                if (event.type !== 'meta' && event.type !== 'sysex' && event.status) {
                    runningStatus = event.status;
                }
                
            } catch (eventError) {
                console.warn('Error parsing MIDI event, skipping:', eventError);
                offset++;
                if (offset >= endOffset) break;
            }
        }

        console.log(`Track parsed: ${events.length} events`);
        return { events, length };
    }

    /**
     * Read variable length quantity with improved bounds checking
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
     * Read MIDI event with safer bounds checking
     */
    readMidiEvent(dataView, offset, time, runningStatus) {
        if (offset >= dataView.byteLength) {
            return { type: 'error', bytesRead: 0, time: time };
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
     * Read channel event with safer data reading
     */
    readChannelEvent(dataView, offset, time, status) {
        const eventType = (status >> 4) & 0x0F;
        const channel = status & 0x0F;
        
        let bytesRead = status >= 0x80 ? 1 : 0; // Account for status byte
        let data1 = 0, data2 = 0;
        
        // Bounds check before reading data bytes
        switch (eventType) {
            case 0x08: // Note Off
            case 0x09: // Note On
            case 0x0A: // Polyphonic Key Pressure
            case 0x0B: // Control Change
            case 0x0E: // Pitch Bend
                if (offset + 1 < dataView.byteLength) {
                    data1 = dataView.getUint8(offset);
                    if (offset + 2 < dataView.byteLength) {
                        data2 = dataView.getUint8(offset + 1);
                        bytesRead += 2;
                    } else {
                        bytesRead += 1;
                    }
                }
                break;
                
            case 0x0C: // Program Change
            case 0x0D: // Channel Pressure
                if (offset < dataView.byteLength) {
                    data1 = dataView.getUint8(offset);
                    bytesRead += 1;
                }
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
     * Read meta event with improved error handling
     */
    readMetaEvent(dataView, offset, time) {
        if (offset + 1 >= dataView.byteLength) {
            return { type: 'error', bytesRead: 0, time: time };
        }
        
        const type = dataView.getUint8(offset + 1);
        const lengthResult = this.readVariableLength(dataView, offset + 2);
        
        const event = {
            type: 'meta',
            metaType: type,
            time: time,
            bytesRead: 2 + lengthResult.bytesRead + lengthResult.value
        };

        const dataOffset = offset + 2 + lengthResult.bytesRead;

        // Bounds check for data reading
        if (dataOffset + lengthResult.value > dataView.byteLength) {
            console.warn(`Meta event data extends beyond buffer`);
            return event;
        }

        switch (type) {
            case 0x51: // Set Tempo
                if (lengthResult.value === 3) {
                    const microsecondsPerQuarter = 
                        (dataView.getUint8(dataOffset) << 16) |
                        (dataView.getUint8(dataOffset + 1) << 8) |
                        dataView.getUint8(dataOffset + 2);
                    event.tempo = Math.round(60000000 / microsecondsPerQuarter);
                    event.microsecondsPerQuarter = microsecondsPerQuarter;
                }
                break;
                
            case 0x58: // Time Signature
                if (lengthResult.value === 4) {
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
        const lengthResult = this.readVariableLength(dataView, offset + 1);
        
        return {
            type: 'sysex',
            time: time,
            bytesRead: 1 + lengthResult.bytesRead + lengthResult.value
        };
    }

    /**
     * Extract timing maps for tempo and time signature changes
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
                            microsecondsPerQuarter: event.microsecondsPerQuarter || (60000000 / event.tempo)
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
     * Generate rhythm game chart from MIDI with improved note conversion
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

        // Extract and convert note events
        const noteEvents = this.extractNoteEvents(midiData);
        console.log(`Extracted ${noteEvents.length} note events`);

        if (noteEvents.length === 0) {
            console.warn('No note events found, generating fallback chart');
            return this.generateFallbackChart(lanes, difficulty);
        }

        const timedEvents = this.convertToTimedEvents(noteEvents, midiData);
        console.log(`Generated ${timedEvents.length} timed events`);

        const gameNotes = this.convertToGameNotes(timedEvents, lanes, difficulty);
        console.log(`Generated ${gameNotes.length} game notes`);

        if (gameNotes.length === 0) {
            console.warn('No game notes generated, creating fallback');
            return this.generateFallbackChart(lanes, difficulty);
        }

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
                    event.eventType && 
                    (event.eventType === 'noteOn' || event.eventType === 'noteOff') &&
                    event.note !== undefined &&
                    event.velocity !== undefined) {
                    
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
     * Convert MIDI ticks to milliseconds with precise timing
     */
    convertTicksToMilliseconds(ticks, tempoMap, ticksPerQuarter) {
        let currentTime = 0; // in milliseconds
        let currentTick = 0;
        let tempoIndex = 0;
        let currentTempo = tempoMap[0];

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
     * Convert timed events to rhythm game notes
     */
    convertToGameNotes(timedEvents, laneCount, difficulty) {
        const gameNotes = [];
        const activeNotes = new Map();
        
        // Create pitch to lane mapping
        const pitchMapping = this.createPitchToLaneMapping(timedEvents, laneCount);
        console.log('Pitch mapping created:', pitchMapping.size, 'pitches mapped');
        
        for (const event of timedEvents) {
            const lane = pitchMapping.get(event.note);
            
            // Skip unmapped notes
            if (lane === undefined) {
                continue;
            }
            
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
     * Create improved pitch to lane mapping
     */
    createPitchToLaneMapping(timedEvents, laneCount) {
        // Count note frequency and analyze range
        const pitchStats = new Map();
        
        for (const event of timedEvents) {
            if (event.eventType === 'noteOn' && event.velocity > 0) {
                const count = pitchStats.get(event.note) || 0;
                pitchStats.set(event.note, count + 1);
            }
        }
        
        if (pitchStats.size === 0) {
            console.warn('No pitches found for mapping');
            return new Map();
        }
        
        // Sort pitches by frequency (most common first)
        const sortedPitches = Array.from(pitchStats.entries())
            .sort((a, b) => b[1] - a[1]);
        
        console.log(`Found ${sortedPitches.length} unique pitches, mapping to ${laneCount} lanes`);
        
        const pitchToLane = new Map();
        
        // Map pitches to lanes, distributing evenly
        if (sortedPitches.length <= laneCount) {
            // Simple case: one pitch per lane
            sortedPitches.forEach(([pitch, count], index) => {
                pitchToLane.set(pitch, index);
            });
        } else {
            // Complex case: multiple pitches per lane
            const pitchesPerLane = Math.ceil(sortedPitches.length / laneCount);
            
            sortedPitches.forEach(([pitch, count], index) => {
                const lane = Math.floor(index / pitchesPerLane);
                const actualLane = Math.min(lane, laneCount - 1);
                pitchToLane.set(pitch, actualLane);
            });
        }
        
        // Ensure all lanes have at least one pitch if possible
        const usedLanes = new Set(pitchToLane.values());
        if (usedLanes.size < laneCount && sortedPitches.length >= laneCount) {
            console.log('Redistributing pitches to fill all lanes');
            pitchToLane.clear();
            
            sortedPitches.forEach(([pitch, count], index) => {
                const lane = index % laneCount;
                pitchToLane.set(pitch, lane);
            });
        }
        
        console.log(`Pitch mapping complete: ${pitchToLane.size} pitches mapped to ${new Set(pitchToLane.values()).size} lanes`);
        return pitchToLane;
    }

    /**
     * Convert timed events with accurate timing
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
     * Apply difficulty filtering
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
            
            if (timeDiff >= minSpacing || note.type === 'hold' || note.velocity >= 100) {
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
     * Generate fallback chart when MIDI processing fails
     */
    generateFallbackChart(lanes, difficulty) {
        console.log('Generating fallback chart for MIDI failure');
        
        const notes = [];
        const duration = 30000; // 30 seconds
        const noteInterval = difficulty === 'EASY' ? 800 : difficulty === 'NORMAL' ? 600 : 400;
        
        for (let time = 2000; time < duration; time += noteInterval) {
            const lane = Math.floor(Math.random() * lanes);
            notes.push({
                time: time,
                lane: lane,
                type: 'tap',
                velocity: 80,
                pitch: 60 + lane,
                channel: 0
            });
        }
        
        return {
            notes: notes,
            difficulty: difficulty,
            lanes: lanes,
            metadata: {
                totalNotes: notes.length,
                holdNotes: 0,
                source: 'fallback',
                generatedAt: Date.now()
            }
        };
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
}

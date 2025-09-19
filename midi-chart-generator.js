// midi-chart-generator.js - Generate rhythm game charts from MIDI files

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
     * Generate rhythm game chart from MIDI data
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

        // Convert MIDI ticks to milliseconds
        const timedNotes = this.convertTicksToTime(noteEvents, tempoMap, midiData.ticksPerQuarter);

        // Generate rhythm game notes
        const gameNotes = this.convertToGameNotes(timedNotes, lanes, difficulty);

        // Apply difficulty-specific filtering
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
     * Extract tempo changes from MIDI data
     */
    extractTempoMap(midiData) {
        const tempoEvents = [];
        
        for (const track of midiData.tracks) {
            for (const event of track) {
                if (event.type === 'meta' && event.metaType === 0x51 && event.tempo) {
                    tempoEvents.push({
                        time: event.time,
                        tempo: event.tempo
                    });
                }
            }
        }
        
        // Add default tempo if none found
        if (tempoEvents.length === 0) {
            tempoEvents.push({ time: 0, tempo: 120 });
        }
        
        return tempoEvents.sort((a, b) => a.time - b.time);
    }

    /**
     * Convert MIDI ticks to milliseconds
     */
    convertTicksToTime(noteEvents, tempoMap, ticksPerQuarter) {
        const timedNotes = [];
        let currentTempo = tempoMap[0]?.tempo || 120;
        let tempoIndex = 0;
        
        for (const note of noteEvents) {
            // Update tempo if needed
            while (tempoIndex + 1 < tempoMap.length && 
                   note.time >= tempoMap[tempoIndex + 1].time) {
                tempoIndex++;
                currentTempo = tempoMap[tempoIndex].tempo;
            }
            
            // Convert ticks to milliseconds
            const ticksPerSecond = (currentTempo * ticksPerQuarter) / 60;
            const timeMs = (note.time / ticksPerSecond) * 1000;
            
            timedNotes.push({
                ...note,
                timeMs: Math.round(timeMs)
            });
        }
        
        return timedNotes;
    }

    /**
     * Convert MIDI notes to rhythm game notes
     */
    convertToGameNotes(timedNotes, laneCount, difficulty) {
        const gameNotes = [];
        const activeNotes = new Map(); // Track held notes
        
        // Group notes by pitch for lane assignment
        const pitchToLane = this.createPitchMapping(timedNotes, laneCount);
        
        for (const midiNote of timedNotes) {
            const lane = pitchToLane.get(midiNote.note);
            if (lane === undefined) continue; // Skip unmapped notes
            
            if (midiNote.eventType === 'noteOn') {
                // Start of a note
                const gameNote = {
                    time: midiNote.timeMs,
                    lane: lane,
                    type: 'tap',
                    velocity: midiNote.velocity,
                    pitch: midiNote.note
                };
                
                // Track this note for potential hold conversion
                activeNotes.set(`${midiNote.note}_${lane}`, {
                    gameNote: gameNote,
                    startTime: midiNote.timeMs
                });
                
                gameNotes.push(gameNote);
                
            } else if (midiNote.eventType === 'noteOff') {
                // End of a note - convert to hold if long enough
                const noteKey = `${midiNote.note}_${lane}`;
                const activeNote = activeNotes.get(noteKey);
                
                if (activeNote) {
                    const duration = midiNote.timeMs - activeNote.startTime;
                    
                    if (duration >= config.CHART.HOLD_MIN_DURATION) {
                        // Convert to hold note
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
     * Create mapping from MIDI pitches to game lanes
     */
    createPitchMapping(timedNotes, laneCount) {
        // Count note frequency by pitch
        const pitchCounts = new Map();
        
        for (const note of timedNotes) {
            if (note.eventType === 'noteOn') {
                pitchCounts.set(note.note, (pitchCounts.get(note.note) || 0) + 1);
            }
        }
        
        // Sort pitches by frequency (most common first)
        const sortedPitches = Array.from(pitchCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, laneCount * 2); // Take more than we need for variety
        
        // Assign to lanes, spreading across the range
        const pitchToLane = new Map();
        
        for (let i = 0; i < Math.min(sortedPitches.length, laneCount * 2); i++) {
            const pitch = sortedPitches[i][0];
            const lane = i % laneCount;
            pitchToLane.set(pitch, lane);
        }
        
        return pitchToLane;
    }

    /**
     * Apply difficulty-specific filtering
     */
    applyDifficultyFilter(notes, difficulty) {
        const densityMultiplier = config.CHART.DENSITY_MULTIPLIERS[difficulty];
        
        if (densityMultiplier >= 1.0) {
            return notes; // No filtering needed
        }
        
        // Filter notes based on difficulty
        const filteredNotes = [];
        const minSpacing = config.CHART.MIN_NOTE_SPACING / densityMultiplier;
        
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            
            // Always include first note
            if (i === 0) {
                filteredNotes.push(note);
                continue;
            }
            
            // Check spacing with previous note
            const lastNote = filteredNotes[filteredNotes.length - 1];
            const timeDiff = note.time - lastNote.time;
            
            if (timeDiff >= minSpacing) {
                filteredNotes.push(note);
            } else if (note.type === 'hold' || note.velocity > 100) {
                // Keep hold notes and high velocity notes even if close
                filteredNotes.push(note);
            }
        }
        
        return filteredNotes;
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

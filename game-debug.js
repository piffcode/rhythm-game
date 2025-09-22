export class GameDebugger {
    constructor(options = {}) {
        this.options = {
            maxEvents: options.maxEvents || 75,
            pollInterval: options.pollInterval || 250,
            consoleMirror: options.consoleMirror ?? true
        };

        this.events = [];
        this.enabled = false;
        this.overlayElement = null;
        this.infoElement = null;
        this.eventsElement = null;
        this.pollTimer = null;

        this.engine = null;
        this.playback = null;
        this.timingClock = null;
        this.extraMetrics = {};
    }

    attach({ engine, playback, timingClock }) {
        this.engine = engine || null;
        this.playback = playback || null;
        this.timingClock = timingClock || null;

        if (this.engine?.setDebugger) {
            this.engine.setDebugger(this);
        }

        this.log('debugger:attach', {
            hasEngine: Boolean(this.engine),
            hasPlayback: Boolean(this.playback),
            hasClock: Boolean(this.timingClock)
        });
    }

    bindOverlay({ panel, infoElement, eventsElement }) {
        this.overlayElement = panel || null;
        this.infoElement = infoElement || null;
        this.eventsElement = eventsElement || null;

        if (this.overlayElement) {
            this.overlayElement.style.display = this.enabled ? 'block' : 'none';
        }

        if (this.enabled) {
            this.render();
        }
    }

    toggle(forceState) {
        const nextState = typeof forceState === 'boolean' ? forceState : !this.enabled;
        if (nextState === this.enabled) {
            return this.enabled;
        }

        this.enabled = nextState;
        if (this.overlayElement) {
            this.overlayElement.style.display = this.enabled ? 'block' : 'none';
        }

        this.log('debugger:toggle', { enabled: this.enabled });

        if (this.enabled) {
            this.render();
            this.startPolling();
        } else {
            this.stopPolling();
        }

        return this.enabled;
    }

    startPolling() {
        if (this.pollTimer) return;
        this.pollTimer = window.setInterval(() => this.render(), this.options.pollInterval);
    }

    stopPolling() {
        if (!this.pollTimer) return;
        window.clearInterval(this.pollTimer);
        this.pollTimer = null;
    }

    setExtraMetrics(metrics = {}) {
        this.extraMetrics = { ...this.extraMetrics, ...metrics };
        if (this.enabled) {
            this.renderMetrics();
        }
    }

    clearExtraMetrics(keys = null) {
        if (!keys) {
            this.extraMetrics = {};
        } else {
            const removals = Array.isArray(keys) ? keys : [keys];
            removals.forEach(key => delete this.extraMetrics[key]);
        }

        if (this.enabled) {
            this.renderMetrics();
        }
    }

    log(eventName, payload = {}) {
        const entry = {
            time: Date.now(),
            event: eventName,
            payload
        };

        this.events.push(entry);
        if (this.events.length > this.options.maxEvents) {
            this.events.splice(0, this.events.length - this.options.maxEvents);
        }

        if (this.options.consoleMirror) {
            console.debug(`[GameDebug] ${eventName}`, payload);
        }

        if (this.enabled) {
            this.renderEvents();
        }
    }

    render() {
        if (!this.enabled) return;
        this.renderMetrics();
        this.renderEvents();
    }

    renderMetrics() {
        if (!this.infoElement) return;

        const metrics = this.collectMetrics();
        const lines = [];

        for (const [label, value] of metrics) {
            lines.push(`${label}: ${value}`);
        }

        this.infoElement.innerHTML = lines.join('<br>');
    }

    renderEvents() {
        if (!this.eventsElement) return;

        const container = this.eventsElement;
        container.innerHTML = '';

        const recent = this.events.slice(-10).reverse();
        recent.forEach(entry => {
            const row = document.createElement('div');
            row.className = 'debug-event';

            const timeSpan = document.createElement('span');
            timeSpan.className = 'debug-event-time';
            timeSpan.textContent = this.formatTimestamp(entry.time);
            row.appendChild(timeSpan);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'debug-event-name';
            nameSpan.textContent = entry.event;
            row.appendChild(nameSpan);

            const payloadText = this.formatPayload(entry.payload);
            if (payloadText) {
                const payloadSpan = document.createElement('span');
                payloadSpan.className = 'debug-event-payload';
                payloadSpan.textContent = payloadText;
                row.appendChild(payloadSpan);
            }

            container.appendChild(row);
        });
    }

    collectMetrics() {
        const metrics = [];

        if (this.engine) {
            const trackNumber = Math.max(1, (this.engine.currentTrackIndex || 0) + (this.engine.isPlaying ? 1 : 0));
            const totalTracks = this.engine.tracks?.length || 0;
            const currentTrack = this.engine.currentTrack;
            const timingStats = this.safeGetTimingStats();

            metrics.push(['Track', totalTracks ? `${Math.min(trackNumber, totalTracks)}/${totalTracks}` : '—']);
            metrics.push(['Song', currentTrack?.name || '—']);
            metrics.push(['Chart', this.engine.currentChart?.metadata?.source || 'unknown']);
            metrics.push(['Notes', this.engine.currentChart?.notes?.length || 0]);
            metrics.push(['Combo', `${this.engine.combo} (max ${this.engine.maxCombo})`]);
            metrics.push(['Score', this.engine.score]);
            metrics.push(['Accuracy', timingStats?.accuracy != null ? `${timingStats.accuracy}%` : '—']);
            metrics.push(['Health', Math.round(this.engine.health)]);
            metrics.push(['FPS', `${Math.round(this.engine.currentFps)} / ${(this.engine.averageFrameTime).toFixed(1)}ms`]);
        }

        const playbackPosition = this.playback?.getPositionMs ? this.playback.getPositionMs() : null;
        const clockTime = this.timingClock?.getTime ? this.timingClock.getTime() : null;

        if (playbackPosition != null) {
            metrics.push(['Spotify', `${Math.round(playbackPosition)}ms`]);
        }

        if (clockTime != null) {
            metrics.push(['Clock', `${Math.round(clockTime)}ms`]);
        }

        if (playbackPosition != null && clockTime != null) {
            const drift = Math.abs(Math.round(playbackPosition - clockTime));
            metrics.push(['Drift', `${drift}ms`]);
        }

        if (this.playback?.calibrationOffset != null) {
            metrics.push(['Calibration', `${this.playback.calibrationOffset}ms`]);
        }

        if (this.playback?.getIsPlaying) {
            metrics.push(['Playing', this.playback.getIsPlaying() ? 'Yes' : 'No']);
        }

        Object.entries(this.extraMetrics).forEach(([key, value]) => {
            metrics.push([key, value]);
        });

        return metrics;
    }

    safeGetTimingStats() {
        try {
            return this.engine?.getTimingStats?.();
        } catch (error) {
            return null;
        }
    }

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        const millis = date.getMilliseconds().toString().padStart(3, '0');
        return `${hours}:${minutes}:${seconds}.${millis}`;
    }

    formatPayload(payload) {
        if (payload == null) {
            return '';
        }

        if (typeof payload === 'string') {
            return payload;
        }

        try {
            const text = JSON.stringify(payload);
            if (text.length > 140) {
                return `${text.slice(0, 137)}…`;
            }
            return text;
        } catch (error) {
            return String(payload);
        }
    }
}

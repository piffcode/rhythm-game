// spotify/client.js - SpotifyClient with integrated request queuing

import { PKCE } from './auth-pkce.js';
import { config } from './config.js';

export class SpotifyClient {
    constructor() {
        this.auth = new PKCE(config.CLIENT_ID, config.REDIRECT_URI);
        this.baseUrl = 'https://api.spotify.com';
        this.rateLimiter = new RateLimiter();
        
        // Add request queue
        this.requestQueue = new RequestQueue(3); // Max 3 concurrent requests
        
        // Keep track of request stats
        this.requestStats = {
            total: 0,
            successful: 0,
            failed: 0,
            queued: 0
        };
    }

    /**
     * Initialize the client and set up auto-refresh
     */
    async initialize() {
        if (!this.auth.isAuthenticated()) {
            throw new Error('User not authenticated');
        }
        
        // Setup automatic token refresh
        this.auth.setupAutoRefresh();
        
        // Test the connection
        try {
            await this.request('/v1/me');
            console.log('Spotify client initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Spotify client:', error);
            throw error;
        }
    }

    /**
     * Make an authenticated request to the Spotify Web API with queuing
     * @param {string} endpoint - API endpoint (e.g., '/v1/me')
     * @param {Object} options - Request options (method, body, headers, etc.)
     * @returns {Promise<Object>} Response data
     */
    async request(endpoint, options = {}) {
        // Queue the request to avoid overwhelming the API
        return this.requestQueue.add(async () => {
            return this._makeRequest(endpoint, options);
        });
    }

    /**
     * Internal method that makes the actual HTTP request
     */
    async _makeRequest(endpoint, options = {}) {
        const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
        
        this.requestStats.total++;
        
        try {
            // Get valid access token
            const authHeader = await this.auth.getAuthHeader();
            
            // Prepare request options
            const requestOptions = {
                method: options.method || 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            };

            // Wait for rate limiting
            await this.rateLimiter.waitIfNeeded();
            
            // Make the request
            const response = await fetch(url, requestOptions);
            
            // Update rate limiter
            this.rateLimiter.updateFromResponse(response);
            
            // Handle different response types
            await this.handleResponse(response, endpoint);
            
            this.requestStats.successful++;
            
            // Parse response if it has content
            const contentLength = response.headers.get('content-length');
            if (response.status === 204 || response.status === 205 || contentLength === '0') {
                return {}; // No content
            }

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                return await response.json();
            }

            // Fallback: return raw text to avoid JSON parse errors on non-JSON payloads
            const text = await response.text();
            return text ? { raw: text } : {};
            
        } catch (error) {
            this.requestStats.failed++;
            console.error(`Spotify API request failed for ${endpoint}:`, error);
            
            // Handle specific error cases
            if (error.status === 401) {
                try {
                    // Try to refresh token and retry once
                    await this.auth.refreshToken();
                    return await this._makeRequest(endpoint, options);
                } catch (refreshError) {
                    console.error('Token refresh failed:', refreshError);
                    throw new Error('Authentication expired. Please log in again.');
                }
            }
            
            throw error;
        }
    }

    /**
     * Batch request multiple tracks at once
     * @param {string[]} trackIds - Array of track IDs (max 50)
     * @returns {Promise<Object>} Tracks data
     */
    async getTracksBatch(trackIds) {
        if (trackIds.length === 0) return { tracks: [] };
        
        // Split into chunks of 50 (Spotify's limit)
        const chunks = [];
        for (let i = 0; i < trackIds.length; i += 50) {
            chunks.push(trackIds.slice(i, i + 50));
        }
        
        const results = await Promise.all(
            chunks.map(chunk => this.getTracks(chunk))
        );
        
        // Combine results
        const allTracks = results.reduce((acc, result) => {
            return acc.concat(result.tracks || []);
        }, []);
        
        return { tracks: allTracks };
    }

    /**
     * Batch request audio features for multiple tracks
     * @param {string[]} trackIds - Array of track IDs (max 100)
     * @returns {Promise<Object>} Audio features data
     */
    async getAudioFeaturesBatch(trackIds) {
        if (trackIds.length === 0) return { audio_features: [] };
        
        // Split into chunks of 100 (Spotify's limit)
        const chunks = [];
        for (let i = 0; i < trackIds.length; i += 100) {
            chunks.push(trackIds.slice(i, i + 100));
        }
        
        const results = await Promise.all(
            chunks.map(chunk => this.getAudioFeatures(chunk))
        );
        
        // Combine results
        const allFeatures = results.reduce((acc, result) => {
            const features = Array.isArray(result.audio_features) ? result.audio_features : [result];
            return acc.concat(features);
        }, []);
        
        return { audio_features: allFeatures };
    }

    /**
     * Get request queue statistics
     */
    getQueueStats() {
        return {
            ...this.requestStats,
            queueLength: this.requestQueue.getQueueLength(),
            activeRequests: this.requestQueue.getActiveCount()
        };
    }

    // ... rest of existing methods remain the same ...
    
    async handleResponse(response, endpoint) { /* existing code */ }
    async getCurrentUser() { return await this.request('/v1/me'); }
    async getDevices() { return await this.request('/v1/me/player/devices'); }
    async getPlaybackState() { return await this.request('/v1/me/player'); }
    
    async startPlayback(options = {}, deviceId = null) {
        const endpoint = `/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`;
        return await this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(options)
        });
    }

    async pausePlayback(deviceId = null) {
        const endpoint = `/v1/me/player/pause${deviceId ? `?device_id=${deviceId}` : ''}`;
        return await this.request(endpoint, { method: 'PUT' });
    }

    async seek(positionMs, deviceId = null) {
        const params = new URLSearchParams({ position_ms: positionMs.toString() });
        if (deviceId) params.set('device_id', deviceId);
        
        const endpoint = `/v1/me/player/seek?${params.toString()}`;
        return await this.request(endpoint, { method: 'PUT' });
    }

    async skipNext(deviceId = null) {
        const endpoint = `/v1/me/player/next${deviceId ? `?device_id=${deviceId}` : ''}`;
        return await this.request(endpoint, { method: 'POST' });
    }

    async skipPrevious(deviceId = null) {
        const endpoint = `/v1/me/player/previous${deviceId ? `?device_id=${deviceId}` : ''}`;
        return await this.request(endpoint, { method: 'POST' });
    }

    async setVolume(volumePercent, deviceId = null) {
        const params = new URLSearchParams({ volume_percent: volumePercent.toString() });
        if (deviceId) params.set('device_id', deviceId);
        
        const endpoint = `/v1/me/player/volume?${params.toString()}`;
        return await this.request(endpoint, { method: 'PUT' });
    }

    async getTrack(trackId, market = null) {
        const params = market ? `?market=${market}` : '';
        return await this.request(`/v1/tracks/${trackId}${params}`);
    }

    async getTracks(trackIds, market = null) {
        const params = new URLSearchParams({ ids: trackIds.join(',') });
        if (market) params.set('market', market);
        
        return await this.request(`/v1/tracks?${params.toString()}`);
    }

    async getAudioFeatures(trackIds) {
        const ids = Array.isArray(trackIds) ? trackIds.join(',') : trackIds;
        return await this.request(`/v1/audio-features?ids=${ids}`);
    }

    async getAudioAnalysis(trackId) {
        return await this.request(`/v1/audio-analysis/${trackId}`);
    }

    async getRecommendations(options = {}) {
        const params = new URLSearchParams();
        
        Object.entries(options).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
                params.set(key, value.toString());
            }
        });
        
        return await this.request(`/v1/recommendations?${params.toString()}`);
    }

    async createPlaylist(userId, playlistData) {
        return await this.request(`/v1/users/${userId}/playlists`, {
            method: 'POST',
            body: JSON.stringify(playlistData)
        });
    }

    async addTracksToPlaylist(playlistId, uris, position = null) {
        const body = { uris };
        if (position !== null) body.position = position;
        
        return await this.request(`/v1/playlists/${playlistId}/tracks`, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    async saveTrack(trackId) {
        if (!trackId) {
            throw new Error('Track ID is required');
        }
        
        try {
            const response = await this.request('/v1/me/tracks', {
                method: 'PUT',
                body: JSON.stringify({
                    ids: [trackId]
                }),
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            console.log(`Track ${trackId} saved to Liked Songs`);
            return response;
            
        } catch (error) {
            console.error('Failed to save track:', error);
            throw error;
        }
    }

    async checkSavedTracks(trackIds) {
        if (!trackIds || trackIds.length === 0) {
            return [];
        }
        
        const ids = Array.isArray(trackIds) ? trackIds.join(',') : trackIds;
        
        try {
            const response = await this.request(`/v1/me/tracks/contains?ids=${ids}`);
            return response;
        } catch (error) {
            console.error('Failed to check saved tracks:', error);
            throw error;
        }
    }

    /**
     * Batch request helper for multiple API calls with proper queuing
     * @param {Array} requests - Array of request configurations
     * @returns {Promise<Array>} Array of results
     */
    async batchRequest(requests) {
        const results = await Promise.allSettled(
            requests.map(req => this.request(req.endpoint, req.options))
        );
        
        return results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                console.error(`Batch request ${index} failed:`, result.reason);
                return null;
            }
        });
    }
}

/**
 * Request queue to manage concurrent API calls
 */
class RequestQueue {
    constructor(maxConcurrent = 3) {
        this.maxConcurrent = maxConcurrent;
        this.queue = [];
        this.activeRequests = 0;
    }

    async add(requestFn) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                requestFn,
                resolve,
                reject,
                timestamp: Date.now()
            });
            
            this.processNext();
        });
    }

    async processNext() {
        if (this.activeRequests >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        this.activeRequests++;
        const { requestFn, resolve, reject } = this.queue.shift();

        try {
            const result = await requestFn();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.activeRequests--;
            // Process next request after a small delay to avoid overwhelming the API
            setTimeout(() => this.processNext(), 50);
        }
    }

    getQueueLength() {
        return this.queue.length;
    }

    getActiveCount() {
        return this.activeRequests;
    }

    clear() {
        // Reject all queued requests
        this.queue.forEach(({ reject }) => {
            reject(new Error('Request queue cleared'));
        });
        this.queue = [];
    }
}

/**
 * Enhanced rate limiter with exponential backoff
 */
class RateLimiter {
    constructor() {
        this.requests = [];
        this.windowMs = 60000; // 1 minute
        this.maxRequests = 100; // Conservative limit
        this.retryAfter = 0;
        this.backoffMultiplier = 1;
    }

    async waitIfNeeded() {
        const now = Date.now();
        
        // Clean old requests from the window
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        
        // Check if we're rate limited
        if (this.retryAfter > now) {
            const waitTime = (this.retryAfter - now) * this.backoffMultiplier;
            console.log(`Rate limited, waiting ${waitTime}ms (backoff: ${this.backoffMultiplier}x)`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        // Check if we're approaching the rate limit
        if (this.requests.length >= this.maxRequests - 5) {
            const oldestRequest = this.requests[0];
            const waitTime = this.windowMs - (now - oldestRequest) + 1000;
            if (waitTime > 0) {
                console.log(`Approaching rate limit, waiting ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        
        // Record this request
        this.requests.push(now);
    }

    updateFromResponse(response) {
        const retryAfter = response.headers.get('retry-after');
        
        if (response.status === 429) {
            this.retryAfter = Date.now() + (parseInt(retryAfter || '1') * 1000);
            // Exponential backoff on rate limit hits
            this.backoffMultiplier = Math.min(this.backoffMultiplier * 2, 8);
            console.warn(`Rate limit hit, backing off by ${this.backoffMultiplier}x`);
        } else if (response.ok) {
            // Reset backoff on successful requests
            this.backoffMultiplier = 1;
        }
        
        // Update limits based on response headers if available
        const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
        const rateLimitReset = response.headers.get('x-ratelimit-reset');
        
        if (rateLimitRemaining !== null && rateLimitReset !== null) {
            // Adjust our strategy based on actual rate limit info
            const remaining = parseInt(rateLimitRemaining);
            if (remaining < 10) {
                console.log(`Low rate limit remaining: ${remaining}`);
                // Could implement more aggressive throttling here
            }
        }
    }
}

// spotify/client.js - Spotify Web API client with authentication

import { PKCE } from './auth-pkce.js';
import { config } from './config.js';

export class SpotifyClient {
    constructor() {
        this.auth = new PKCE(config.CLIENT_ID, config.REDIRECT_URI);
        this.baseUrl = 'https://api.spotify.com';
        this.rateLimiter = new RateLimiter();
        this.requestQueue = [];
        this.isProcessingQueue = false;
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
     * Make an authenticated request to the Spotify Web API
     * @param {string} endpoint - API endpoint (e.g., '/v1/me')
     * @param {Object} options - Request options (method, body, headers, etc.)
     * @returns {Promise<Object>} Response data
     */
    async request(endpoint, options = {}) {
        const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
        
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
            
            // Parse response if it has content
            if (response.status === 204 || response.headers.get('content-length') === '0') {
                return {}; // No content
            }
            
            const data = await response.json();
            return data;
            
        } catch (error) {
            console.error(`Spotify API request failed for ${endpoint}:`, error);
            
            // Handle specific error cases
            if (error.status === 401) {
                try {
                    // Try to refresh token and retry once
                    await this.auth.refreshToken();
                    return await this.request(endpoint, options);
                } catch (refreshError) {
                    console.error('Token refresh failed:', refreshError);
                    throw new Error('Authentication expired. Please log in again.');
                }
            }
            
            throw error;
        }
    }

    /**
     * Handle HTTP response and throw appropriate errors
     * @param {Response} response - Fetch response object
     * @param {string} endpoint - Original endpoint for context
     */
    async handleResponse(response, endpoint) {
        if (response.ok) {
            return; // Success
        }

        let errorData = {};
        try {
            errorData = await response.json();
        } catch (e) {
            // Response might not have JSON body
        }

        const error = new Error(
            errorData.error?.message || 
            errorData.error_description || 
            `HTTP ${response.status}: ${response.statusText}`
        );
        
        error.status = response.status;
        error.endpoint = endpoint;
        error.details = errorData;

        // Handle specific status codes
        switch (response.status) {
            case 400:
                error.message = `Bad request to ${endpoint}: ${error.message}`;
                break;
            case 401:
                error.message = 'Authentication required';
                break;
            case 403:
                if (endpoint.includes('/me/player')) {
                    error.message = config.ERRORS.NO_PREMIUM;
                } else {
                    error.message = 'Access forbidden';
                }
                break;
            case 404:
                error.message = `Resource not found: ${endpoint}`;
                break;
            case 429:
                error.message = 'Rate limit exceeded';
                error.retryAfter = parseInt(response.headers.get('retry-after')) || 1;
                break;
            case 502:
            case 503:
            case 504:
                error.message = 'Spotify service temporarily unavailable';
                error.retryable = true;
                break;
            default:
                error.message = `Spotify API error: ${error.message}`;
        }

        throw error;
    }

    /**
     * Get current user's profile
     * @returns {Promise<Object>} User profile data
     */
    async getCurrentUser() {
        return await this.request('/v1/me');
    }

    /**
     * Get user's available devices
     * @returns {Promise<Object>} Devices data
     */
    async getDevices() {
        return await this.request('/v1/me/player/devices');
    }

    /**
     * Get current playback state
     * @returns {Promise<Object>} Playback state data
     */
    async getPlaybackState() {
        return await this.request('/v1/me/player');
    }

    /**
     * Start/resume playback
     * @param {Object} options - Playback options (context_uri, uris, offset, etc.)
     * @param {string} deviceId - Optional device ID
     * @returns {Promise<Object>} Response
     */
    async startPlayback(options = {}, deviceId = null) {
        const endpoint = `/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`;
        return await this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(options)
        });
    }

    /**
     * Pause playback
     * @param {string} deviceId - Optional device ID
     * @returns {Promise<Object>} Response
     */
    async pausePlayback(deviceId = null) {
        const endpoint = `/v1/me/player/pause${deviceId ? `?device_id=${deviceId}` : ''}`;
        return await this.request(endpoint, { method: 'PUT' });
    }

    /**
     * Seek to position in current track
     * @param {number} positionMs - Position in milliseconds
     * @param {string} deviceId - Optional device ID
     * @returns {Promise<Object>} Response
     */
    async seek(positionMs, deviceId = null) {
        const params = new URLSearchParams({ position_ms: positionMs.toString() });
        if (deviceId) params.set('device_id', deviceId);
        
        const endpoint = `/v1/me/player/seek?${params.toString()}`;
        return await this.request(endpoint, { method: 'PUT' });
    }

    /**
     * Skip to next track
     * @param {string} deviceId - Optional device ID
     * @returns {Promise<Object>} Response
     */
    async skipNext(deviceId = null) {
        const endpoint = `/v1/me/player/next${deviceId ? `?device_id=${deviceId}` : ''}`;
        return await this.request(endpoint, { method: 'POST' });
    }

    /**
     * Skip to previous track
     * @param {string} deviceId - Optional device ID
     * @returns {Promise<Object>} Response
     */
    async skipPrevious(deviceId = null) {
        const endpoint = `/v1/me/player/previous${deviceId ? `?device_id=${deviceId}` : ''}`;
        return await this.request(endpoint, { method: 'POST' });
    }

    /**
     * Set playback volume
     * @param {number} volumePercent - Volume percentage (0-100)
     * @param {string} deviceId - Optional device ID
     * @returns {Promise<Object>} Response
     */
    async setVolume(volumePercent, deviceId = null) {
        const params = new URLSearchParams({ volume_percent: volumePercent.toString() });
        if (deviceId) params.set('device_id', deviceId);
        
        const endpoint = `/v1/me/player/volume?${params.toString()}`;
        return await this.request(endpoint, { method: 'PUT' });
    }

    /**
     * Get track information
     * @param {string} trackId - Spotify track ID
     * @param {string} market - Optional market code
     * @returns {Promise<Object>} Track data
     */
    async getTrack(trackId, market = null) {
        const params = market ? `?market=${market}` : '';
        return await this.request(`/v1/tracks/${trackId}${params}`);
    }

    /**
     * Get multiple tracks
     * @param {string[]} trackIds - Array of Spotify track IDs
     * @param {string} market - Optional market code
     * @returns {Promise<Object>} Tracks data
     */
    async getTracks(trackIds, market = null) {
        const params = new URLSearchParams({ ids: trackIds.join(',') });
        if (market) params.set('market', market);
        
        return await this.request(`/v1/tracks?${params.toString()}`);
    }

    /**
     * Get audio features for tracks
     * @param {string|string[]} trackIds - Track ID or array of track IDs
     * @returns {Promise<Object>} Audio features data
     */
    async getAudioFeatures(trackIds) {
        const ids = Array.isArray(trackIds) ? trackIds.join(',') : trackIds;
        return await this.request(`/v1/audio-features?ids=${ids}`);
    }

    /**
     * Get audio analysis for a track
     * @param {string} trackId - Spotify track ID
     * @returns {Promise<Object>} Audio analysis data
     */
    async getAudioAnalysis(trackId) {
        return await this.request(`/v1/audio-analysis/${trackId}`);
    }

    /**
     * Get recommendations
     * @param {Object} options - Recommendation parameters
     * @returns {Promise<Object>} Recommendations data
     */
    async getRecommendations(options = {}) {
        const params = new URLSearchParams();
        
        // Add all options as query parameters
        Object.entries(options).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
                params.set(key, value.toString());
            }
        });
        
        return await this.request(`/v1/recommendations?${params.toString()}`);
    }

    /**
     * Create a playlist
     * @param {string} userId - User ID
     * @param {Object} playlistData - Playlist creation data
     * @returns {Promise<Object>} Created playlist data
     */
    async createPlaylist(userId, playlistData) {
        return await this.request(`/v1/users/${userId}/playlists`, {
            method: 'POST',
            body: JSON.stringify(playlistData)
        });
    }

    /**
     * Add tracks to a playlist
     * @param {string} playlistId - Playlist ID
     * @param {string[]} uris - Array of Spotify URIs
     * @param {number} position - Optional position to insert tracks
     * @returns {Promise<Object>} Response
     */
    async addTracksToPlaylist(playlistId, uris, position = null) {
        const body = { uris };
        if (position !== null) body.position = position;
        
        return await this.request(`/v1/playlists/${playlistId}/tracks`, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    /**
     * Batch request helper for multiple API calls
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
 * Rate limiter to handle Spotify API rate limits
 */
class RateLimiter {
    constructor() {
        this.requests = [];
        this.windowMs = 60000; // 1 minute
        this.maxRequests = 100; // Conservative limit
        this.retryAfter = 0;
    }

    /**
     * Check if we need to wait before making a request
     */
    async waitIfNeeded() {
        const now = Date.now();
        
        // Clean old requests from the window
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        
        // Check if we're rate limited
        if (this.retryAfter > now) {
            const waitTime = this.retryAfter - now;
            console.log(`Rate limited, waiting ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        // Check if we're approaching the rate limit
        if (this.requests.length >= this.maxRequests - 5) {
            const oldestRequest = this.requests[0];
            const waitTime = this.windowMs - (now - oldestRequest) + 1000; // Extra buffer
            if (waitTime > 0) {
                console.log(`Approaching rate limit, waiting ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        
        // Record this request
        this.requests.push(now);
    }

    /**
     * Update rate limiter based on response headers
     * @param {Response} response - Fetch response object
     */
    updateFromResponse(response) {
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter && response.status === 429) {
            this.retryAfter = Date.now() + (parseInt(retryAfter) * 1000);
        }
        
        // Update limits based on response headers if available
        const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
        const rateLimitReset = response.headers.get('x-ratelimit-reset');
        
        if (rateLimitRemaining !== null && rateLimitReset !== null) {
            // Adjust our strategy based on actual rate limit info
            // This is speculative as Spotify doesn't always provide these headers
        }
    }
}

// auth/pkce.js - PKCE OAuth 2.0 implementation for Spotify

export class PKCE {
    constructor(clientId, redirectUri) {
        this.clientId = clientId;
        this.redirectUri = redirectUri;
        this.authEndpoint = 'https://accounts.spotify.com/authorize';
        this.tokenEndpoint = 'https://accounts.spotify.com/api/token';
    }

    /**
     * Generate a cryptographically secure random string for PKCE
     * @param {number} length - Length of the string to generate
     * @returns {string} Random string
     */
    generateRandomString(length = 64) {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        const values = new Uint8Array(length);
        crypto.getRandomValues(values);
        
        return Array.from(values, byte => charset[byte % charset.length]).join('');
    }

    /**
     * Generate SHA-256 hash and encode as base64url
     * @param {string} plain - String to hash
     * @returns {Promise<string>} Base64url encoded hash
     */
    async sha256(plain) {
        const encoder = new TextEncoder();
        const data = encoder.encode(plain);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return this.base64UrlEncode(digest);
    }

    /**
     * Base64url encode an ArrayBuffer
     * @param {ArrayBuffer} arrayBuffer - Buffer to encode
     * @returns {string} Base64url encoded string
     */
    base64UrlEncode(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        
        return btoa(binary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    /**
     * Generate PKCE parameters and create authorization URL
     * @param {string} scope - Spotify scopes to request
     * @returns {Promise<string>} Authorization URL
     */
    async generateAuthUrl(scope) {
        // Generate PKCE parameters
        const codeVerifier = this.generateRandomString(64);
        const codeChallenge = await this.sha256(codeVerifier);
        const state = this.generateRandomString(32);

        // Store PKCE parameters for later use
        sessionStorage.setItem('code_verifier', codeVerifier);
        sessionStorage.setItem('oauth_state', state);
        
        // Build authorization URL
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.clientId,
            scope: scope,
            redirect_uri: this.redirectUri,
            state: state,
            code_challenge_method: 'S256',
            code_challenge: codeChallenge,
            // Additional parameters for better UX
            show_dialog: 'false'
        });

        return `${this.authEndpoint}?${params.toString()}`;
    }

    /**
     * Exchange authorization code for access token
     * @param {string} authCode - Authorization code from callback
     * @param {string} receivedState - State parameter from callback
     * @returns {Promise<Object>} Token response
     */
    async exchangeCodeForToken(authCode, receivedState) {
        // Retrieve stored PKCE parameters
        const codeVerifier = sessionStorage.getItem('code_verifier');
        const storedState = sessionStorage.getItem('oauth_state');

        if (!codeVerifier) {
            throw new Error('Code verifier not found. Please restart the authentication process.');
        }

        // Validate state parameter to prevent CSRF attacks
        if (!receivedState || receivedState !== storedState) {
            throw new Error('State parameter mismatch. Possible CSRF attack.');
        }

        // Prepare token exchange request
        const tokenParams = new URLSearchParams({
            grant_type: 'authorization_code',
            code: authCode,
            redirect_uri: this.redirectUri,
            client_id: this.clientId,
            code_verifier: codeVerifier
        });

        try {
            const response = await fetch(this.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: tokenParams.toString()
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Token exchange failed: ${errorData.error_description || errorData.error}`);
            }

            const tokenData = await response.json();
            
            // Calculate expiry time (current time + expires_in - buffer)
            const expiresAt = Date.now() + (tokenData.expires_in * 1000) - 60000; // 1 minute buffer

            // Store tokens securely in sessionStorage
            const tokens = {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_at: expiresAt,
                token_type: tokenData.token_type || 'Bearer',
                scope: tokenData.scope
            };

            this.storeTokens(tokens);

            // Clean up PKCE parameters
            sessionStorage.removeItem('code_verifier');
            sessionStorage.removeItem('oauth_state');

            return tokens;

        } catch (error) {
            // Clean up on error
            sessionStorage.removeItem('code_verifier');
            sessionStorage.removeItem('oauth_state');
            throw error;
        }
    }

    /**
     * Refresh the access token using the stored refresh token
     * @returns {Promise<Object>} New token data
     */
    async refreshToken() {
        const refreshToken = sessionStorage.getItem('refresh_token');
        
        if (!refreshToken) {
            throw new Error('No refresh token available. Please re-authenticate.');
        }

        const refreshParams = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: this.clientId
        });

        try {
            const response = await fetch(this.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: refreshParams.toString()
            });

            if (!response.ok) {
                const errorData = await response.json();
                if (response.status === 400 && errorData.error === 'invalid_grant') {
                    // Refresh token is invalid, need to re-authenticate
                    this.clearTokens();
                    throw new Error('Session expired. Please log in again.');
                }
                throw new Error(`Token refresh failed: ${errorData.error_description || errorData.error}`);
            }

            const tokenData = await response.json();
            
            // Calculate new expiry time
            const expiresAt = Date.now() + (tokenData.expires_in * 1000) - 60000; // 1 minute buffer

            // Update stored tokens (refresh token might not be included in response)
            const tokens = {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token || refreshToken, // Keep old refresh token if not provided
                expires_at: expiresAt,
                token_type: tokenData.token_type || 'Bearer',
                scope: tokenData.scope
            };

            this.storeTokens(tokens);
            return tokens;

        } catch (error) {
            if (error.message.includes('Session expired')) {
                // Clear all tokens if refresh fails due to invalid grant
                this.clearTokens();
            }
            throw error;
        }
    }

    /**
     * Store tokens in sessionStorage
     * @param {Object} tokens - Token data to store
     */
    storeTokens(tokens) {
        sessionStorage.setItem('access_token', tokens.access_token);
        sessionStorage.setItem('refresh_token', tokens.refresh_token);
        sessionStorage.setItem('expires_at', tokens.expires_at.toString());
        sessionStorage.setItem('token_type', tokens.token_type);
        if (tokens.scope) {
            sessionStorage.setItem('token_scope', tokens.scope);
        }
    }

    /**
     * Get stored access token, refreshing if necessary
     * @returns {Promise<string>} Valid access token
     */
    async getValidAccessToken() {
        const accessToken = sessionStorage.getItem('access_token');
        const expiresAt = parseInt(sessionStorage.getItem('expires_at'));

        if (!accessToken) {
            throw new Error('No access token found. Please log in.');
        }

        // Check if token is expired or will expire soon (5 minutes buffer)
        if (!expiresAt || Date.now() >= (expiresAt - 300000)) {
            console.log('Token expired or expiring soon, refreshing...');
            const newTokens = await this.refreshToken();
            return newTokens.access_token;
        }

        return accessToken;
    }

    /**
     * Check if user is currently authenticated
     * @returns {boolean} True if authenticated
     */
    isAuthenticated() {
        const accessToken = sessionStorage.getItem('access_token');
        const expiresAt = parseInt(sessionStorage.getItem('expires_at'));
        
        return !!(accessToken && expiresAt && Date.now() < expiresAt);
    }

    /**
     * Get authorization header value
     * @returns {Promise<string>} Authorization header value
     */
    async getAuthHeader() {
        const token = await this.getValidAccessToken();
        return `Bearer ${token}`;
    }

    /**
     * Clear all stored tokens
     */
    clearTokens() {
        sessionStorage.removeItem('access_token');
        sessionStorage.removeItem('refresh_token');
        sessionStorage.removeItem('expires_at');
        sessionStorage.removeItem('token_type');
        sessionStorage.removeItem('token_scope');
        sessionStorage.removeItem('bootstrap_nonce');
    }

    /**
     * Logout user by clearing tokens and redirecting to home
     */
    logout() {
        this.clearTokens();
        window.location.href = '/';
    }

    /**
     * Handle automatic token refresh in the background
     * Sets up a timer to refresh tokens before they expire
     */
    setupAutoRefresh() {
        const expiresAt = parseInt(sessionStorage.getItem('expires_at'));
        if (!expiresAt) return;

        const refreshTime = expiresAt - Date.now() - 300000; // 5 minutes before expiry
        
        if (refreshTime > 0) {
            setTimeout(async () => {
                try {
                    await this.refreshToken();
                    console.log('Token automatically refreshed');
                    this.setupAutoRefresh(); // Setup next refresh
                } catch (error) {
                    console.error('Auto-refresh failed:', error);
                    // Don't redirect automatically, let user handle it
                }
            }, refreshTime);
        }
    }
}
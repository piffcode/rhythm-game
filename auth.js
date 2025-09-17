(() => {
    const CONFIG = window.CONFIG;
    if (!CONFIG) {
        throw new Error('Configuration failed to load. Please verify config.js is available.');
    }

    const base64UrlEncode = (bytes) => {
        return btoa(String.fromCharCode(...bytes))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    };

    class SpotifyAuth {
        constructor() {
            this.debugLog = [];
            this.authButton = document.getElementById('authButton');
            this.messageEl = document.getElementById('message');
            this.loadingEl = document.getElementById('loading');
            this.debugInfoEl = document.getElementById('debugInfo');
            this.debugToggleEl = document.getElementById('debugToggle');

            this.log('SpotifyAuth initializing');
            this.setupDebugToggle();
            this.checkEnvironment();

            if (window.location.search) {
                this.log('URL has search params, handling callback');
                this.handleCallback();
            } else {
                this.log('No search params, setting up auth button');
                this.setupAuthButton();
            }
        }

        log(message, data = null) {
            const timestamp = new Date().toISOString();
            const logEntry = `[${timestamp}] ${message}`;
            console.log(logEntry, data || '');
            this.debugLog.push(logEntry + (data ? ` ${JSON.stringify(data)}` : ''));
            this.updateDebugDisplay();
        }

        updateDebugDisplay() {
            if (!this.debugInfoEl) {
                return;
            }

            this.debugInfoEl.textContent = this.debugLog.join('\n');
            this.debugInfoEl.scrollTop = this.debugInfoEl.scrollHeight;
        }

        setupDebugToggle() {
            if (!this.debugToggleEl) {
                return;
            }

            this.debugToggleEl.addEventListener('click', () => {
                const isVisible = this.debugInfoEl.style.display === 'block';
                this.debugInfoEl.style.display = isVisible ? 'none' : 'block';
                this.debugToggleEl.textContent = isVisible ? 'Show Debug Info' : 'Hide Debug Info';
            });
        }

        setButtonState({ disabled, label }) {
            if (!this.authButton) {
                return;
            }

            this.authButton.disabled = disabled;
            if (label) {
                this.authButton.textContent = label;
            }
        }

        showMessage(text, type = 'error', options = {}) {
            if (!this.messageEl) {
                return;
            }

            this.messageEl.replaceChildren();
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            this.messageEl.appendChild(paragraph);

            if (options.retry) {
                const retryButton = document.createElement('button');
                retryButton.className = 'retry-button';
                retryButton.type = 'button';
                retryButton.textContent = options.retry.label || 'Try Again';
                retryButton.addEventListener('click', () => {
                    options.retry.callback();
                });
                this.messageEl.appendChild(retryButton);
            }

            this.messageEl.className = `message ${type}`;
            this.messageEl.style.display = 'block';
            this.log(`Message shown: ${type}`, text);
        }

        showLoading(show = true) {
            if (this.loadingEl) {
                this.loadingEl.style.display = show ? 'block' : 'none';
            }

            if (this.authButton) {
                this.authButton.disabled = show;
                this.authButton.textContent = show ? 'Connecting...' : 'Connect Spotify';
            }

            this.log(`Loading state: ${show}`);
        }

        ensureSecureContext() {
            const secureContext = window.isSecureContext || CONFIG.IS_LOCAL;
            if (!secureContext) {
                this.log('Insecure context detected');
                this.setButtonState({ disabled: true, label: 'HTTPS Required' });
                this.showMessage('Secure context required. Please use HTTPS to continue.', 'error', {
                    retry: {
                        label: 'Reload',
                        callback: () => window.location.reload()
                    }
                });
                return false;
            }

            return true;
        }

        ensureCryptoAvailable() {
            if (!window.crypto || !window.crypto.getRandomValues || !window.crypto.subtle) {
                this.log('Required Web Crypto APIs unavailable');
                this.setButtonState({ disabled: true, label: 'Unsupported Browser' });
                this.showMessage('Modern browser with Web Crypto support required to complete login.', 'error');
                return false;
            }

            return true;
        }

        checkEnvironment() {
            const clientId = (CONFIG.CLIENT_ID || '').trim();
            const issues = [];

            if (!this.ensureSecureContext()) {
                issues.push('secure_context');
            }

            if (!this.ensureCryptoAvailable()) {
                issues.push('crypto_missing');
            }

            if (!clientId) {
                issues.push('client_id_missing');
                this.showMessage('Spotify client ID is not configured. Please inject it before loading this page.', 'error');
                this.setButtonState({ disabled: true, label: 'Configuration Error' });
            }

            try {
                new URL(CONFIG.AUTH_REDIRECT_URI);
            } catch (error) {
                issues.push('invalid_redirect');
            }

            this.log('Environment check', {
                host: CONFIG.HOST,
                isLocal: CONFIG.IS_LOCAL,
                protocol: window.location.protocol,
                secureContext: window.isSecureContext,
                clientIdPresent: Boolean(clientId),
                redirectUri: CONFIG.AUTH_REDIRECT_URI,
                issues
            });

            return issues.length === 0;
        }

        setupAuthButton() {
            if (!this.authButton) {
                return;
            }

            this.authButton.addEventListener('click', (event) => {
                event.preventDefault();
                this.log('Auth button clicked');
                this.startAuth();
            });
        }

        async generateCodeVerifier() {
            if (!this.ensureCryptoAvailable()) {
                throw new Error('Secure random generator unavailable.');
            }

            const array = new Uint8Array(64);
            crypto.getRandomValues(array);
            return base64UrlEncode(array);
        }

        async generateCodeChallenge(verifier) {
            if (!this.ensureCryptoAvailable()) {
                throw new Error('Unable to compute code challenge securely.');
            }

            const encoder = new TextEncoder();
            const data = encoder.encode(verifier);
            const digest = await crypto.subtle.digest('SHA-256', data);
            return base64UrlEncode(new Uint8Array(digest));
        }

        async generateState() {
            if (!this.ensureCryptoAvailable()) {
                throw new Error('Unable to generate secure state parameter.');
            }

            const array = new Uint8Array(32);
            crypto.getRandomValues(array);
            return base64UrlEncode(array);
        }

        persistTransient(key, value) {
            window.sessionStorage.setItem(key, value);
        }

        consumeTransient(key) {
            const value = window.sessionStorage.getItem(key);
            window.sessionStorage.removeItem(key);
            return value;
        }

        notifyOpener(type, payload) {
            if (!window.opener || window.opener.closed) {
                return false;
            }

            try {
                window.opener.postMessage({ type, payload }, window.location.origin);
                return true;
            } catch (error) {
                this.log('Failed to notify opener', error.message);
                return false;
            }
        }

        async startAuth() {
            try {
                if (!this.ensureSecureContext() || !this.ensureCryptoAvailable()) {
                    return;
                }

                const clientId = (CONFIG.CLIENT_ID || '').trim();
                if (!clientId) {
                    throw new Error('Spotify client ID is not configured correctly.');
                }

                this.showLoading(true);

                const urlParams = new URLSearchParams(window.location.search);
                const country = urlParams.get('country');

                const codeVerifier = await this.generateCodeVerifier();
                const codeChallenge = await this.generateCodeChallenge(codeVerifier);
                const state = await this.generateState();

                this.log('PKCE parameters generated', {
                    verifierLength: codeVerifier.length,
                    challengeLength: codeChallenge.length,
                    stateLength: state.length
                });

                this.persistTransient('code_verifier', codeVerifier);
                this.persistTransient('oauth_state', state);
                if (country) {
                    this.persistTransient('auth_country', country);
                }

                const params = new URLSearchParams({
                    client_id: clientId,
                    response_type: 'code',
                    redirect_uri: CONFIG.AUTH_REDIRECT_URI,
                    code_challenge_method: 'S256',
                    code_challenge: codeChallenge,
                    state,
                    scope: CONFIG.SCOPES.join(' ')
                });

                const authUrl = `${CONFIG.TOKEN_ENDPOINTS.AUTHORIZE}?${params.toString()}`;
                this.log('Redirecting to Spotify authorization', {
                    url: authUrl.substring(0, 100) + '...'
                });

                window.location.href = authUrl;
            } catch (error) {
                this.log('Auth setup error', error.message);
                console.error('Auth setup error:', error);
                const notified = this.notifyOpener('spotify-auth-error', { message: `Authentication setup failed: ${error.message}` });
                this.showMessage(`Authentication setup failed: ${error.message}`, 'error', {
                    retry: {
                        label: 'Try Again',
                        callback: () => window.location.reload()
                    }
                });
                this.showLoading(false);
                if (notified) {
                    setTimeout(() => window.close(), 1000);
                }
            }
        }

        async handleCallback() {
            try {
                if (!this.ensureSecureContext() || !this.ensureCryptoAvailable()) {
                    return;
                }

                this.showLoading(true);

                const urlParams = new URLSearchParams(window.location.search);
                const code = urlParams.get('code');
                const state = urlParams.get('state');
                const error = urlParams.get('error');
                const errorDescription = urlParams.get('error_description');

                this.log('Callback parameters', {
                    hasCode: Boolean(code),
                    hasState: Boolean(state),
                    error,
                    errorDescription
                });

                if (error) {
                    const message = errorDescription || `Authentication error: ${error}`;
                    throw new Error(message);
                }

                if (!code || !state) {
                    throw new Error('Missing authorization response parameters.');
                }

                const storedState = this.consumeTransient('oauth_state');
                if (!storedState || storedState !== state) {
                    throw new Error('State validation failed. Please restart the login process.');
                }

                const codeVerifier = this.consumeTransient('code_verifier');
                if (!codeVerifier) {
                    throw new Error('Authentication session expired. Please start over.');
                }

                const tokenResponse = await fetch(CONFIG.TOKEN_ENDPOINTS.EXCHANGE, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    credentials: 'include',
                    body: new URLSearchParams({
                        grant_type: 'authorization_code',
                        code,
                        redirect_uri: CONFIG.AUTH_REDIRECT_URI,
                        code_verifier: codeVerifier
                    })
                });

                if (!tokenResponse.ok) {
                    const errorData = await tokenResponse.json().catch(() => ({}));
                    throw new Error(errorData.error_description || errorData.error || 'Token exchange failed.');
                }

                const tokenData = await tokenResponse.json();
                const bootstrap = tokenData.bootstrap;
                if (!bootstrap) {
                    throw new Error('Token service did not return a bootstrap value.');
                }

                const country = this.consumeTransient('auth_country');

                let gameUrl = `${CONFIG.GAME_URL}?bootstrap=${encodeURIComponent(bootstrap)}`;
                if (country) {
                    gameUrl += `&country=${encodeURIComponent(country)}`;
                }

                this.showMessage('Authentication successful! Redirecting to game...', 'success');
                this.log('Redirecting to game', { gameUrl });

                const notified = this.notifyOpener('spotify-auth-success', { gameUrl });
                if (notified) {
                    setTimeout(() => window.close(), 800);
                } else {
                    window.location.replace(gameUrl);
                }
            } catch (error) {
                this.log('Token exchange error', error.message);
                console.error('Token exchange error:', error);
                const notified = this.notifyOpener('spotify-auth-error', { message: error.message || 'Failed to complete authentication' });
                this.showMessage(error.message || 'Failed to complete authentication', 'error', {
                    retry: {
                        label: 'Restart Login',
                        callback: () => {
                            window.location.href = CONFIG.AUTH_REDIRECT_URI;
                        }
                    }
                });
                this.showLoading(false);
                this.clearTransientData();
                if (notified) {
                    setTimeout(() => window.close(), 1000);
                }
            }
        }

        clearTransientData() {
            window.sessionStorage.removeItem('code_verifier');
            window.sessionStorage.removeItem('oauth_state');
            window.sessionStorage.removeItem('auth_country');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        try {
            new SpotifyAuth();
        } catch (error) {
            console.error('Failed to initialize auth:', error);
            const messageEl = document.getElementById('message');
            if (messageEl) {
                messageEl.className = 'message error';
                messageEl.style.display = 'block';
                messageEl.textContent = `Failed to initialize: ${error.message}`;
            }
        }
    });

    window.addEventListener('error', (event) => {
        if (!event.error) {
            return;
        }
        console.error('Global error:', event.error);
    });

    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
    });
})();

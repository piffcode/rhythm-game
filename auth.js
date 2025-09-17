(() => {
    const CONFIG = window.CONFIG;
    if (!CONFIG) {
        throw new Error('Configuration failed to load. Ensure config.js runs before auth.js.');
    }

    const dom = {
        button: document.getElementById('authButton'),
        message: document.getElementById('message'),
        loading: document.getElementById('loading'),
        debugToggle: document.getElementById('debugToggle'),
        debugInfo: document.getElementById('debugInfo')
    };

    const debugBuffer = [];
    const log = (message, details) => {
        const entry = `[${new Date().toISOString()}] ${message}`;
        debugBuffer.push(entry + (details ? ` ${JSON.stringify(details)}` : ''));
        if (dom.debugInfo) {
            dom.debugInfo.textContent = debugBuffer.join('\n');
            dom.debugInfo.scrollTop = dom.debugInfo.scrollHeight;
        }
        if (details) {
            console.log(entry, details);
        } else {
            console.log(entry);
        }
    };

    const storage = (() => {
        try {
            const key = '__auth_probe__';
            window.sessionStorage.setItem(key, '1');
            window.sessionStorage.removeItem(key);
            return {
                get: (name) => window.sessionStorage.getItem(name),
                set: (name, value) => window.sessionStorage.setItem(name, value),
                remove: (name) => window.sessionStorage.removeItem(name)
            };
        } catch (error) {
            const fallback = new Map();
            log('Falling back to in-memory auth storage', { error: error?.message });
            return {
                get: (name) => fallback.get(name) || null,
                set: (name, value) => fallback.set(name, value),
                remove: (name) => fallback.delete(name)
            };
        }
    })();

    const base64UrlEncode = (input) => btoa(String.fromCharCode(...input))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

    const assertCrypto = () => {
        if (!window.crypto?.getRandomValues || !window.crypto?.subtle?.digest) {
            throw new Error('Modern browser with Web Crypto support is required for login.');
        }
    };

    const randomBytes = (length) => {
        const array = new Uint8Array(length);
        window.crypto.getRandomValues(array);
        return array;
    };

    const generateCodeVerifier = () => base64UrlEncode(randomBytes(64));
    const generateCodeChallenge = async (verifier) => {
        const data = new TextEncoder().encode(verifier);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return base64UrlEncode(new Uint8Array(digest));
    };
    const generateState = () => base64UrlEncode(randomBytes(32));

    const notifyOpener = (type, payload) => {
        if (!window.opener || window.opener.closed) {
            return false;
        }

        try {
            window.opener.postMessage({ type, payload }, window.location.origin);
            return true;
        } catch (error) {
            log('Failed to notify opener', { error: error?.message });
            return false;
        }
    };

    const showMessage = (text, type = 'error') => {
        if (!dom.message) {
            return;
        }
        dom.message.className = `message ${type}`;
        dom.message.textContent = text;
    };

    const toggleLoading = (isLoading) => {
        if (dom.loading) {
            dom.loading.style.display = isLoading ? 'block' : 'none';
        }
        if (dom.button) {
            dom.button.disabled = isLoading;
            dom.button.textContent = isLoading ? 'Connecting…' : 'Connect Spotify';
        }
    };

    const clearAuthArtifacts = () => {
        ['code_verifier', 'oauth_state', 'auth_country'].forEach((key) => storage.remove(key));
    };

    const disableButton = (reason) => {
        if (!dom.button) {
            return;
        }
        dom.button.disabled = true;
        dom.button.textContent = 'Configuration Required';
        showMessage(reason, 'error');
    };

    const buildAuthorizeUrl = (clientId, codeChallenge, state) => {
        const params = new URLSearchParams({
            client_id: clientId,
            response_type: 'code',
            redirect_uri: CONFIG.AUTH_REDIRECT_URI,
            code_challenge_method: 'S256',
            code_challenge: codeChallenge,
            state,
            scope: (CONFIG.SCOPES || []).join(' ')
        });

        return `https://accounts.spotify.com/authorize?${params.toString()}`;
    };

    const handleSetupError = (error) => {
        log('Authentication setup failed', { error: error?.message });
        showMessage(error.message || 'Authentication setup failed.', 'error');
        toggleLoading(false);
        if (notifyOpener('spotify-auth-error', { message: error.message })) {
            setTimeout(() => window.close(), 1000);
        }
    };

    const startAuth = async () => {
        try {
            assertCrypto();

            const clientId = (CONFIG.CLIENT_ID || '').trim();
            if (!clientId) {
                throw new Error('Spotify client ID is not configured.');
            }

            toggleLoading(true);

            const verifier = generateCodeVerifier();
            const challenge = await generateCodeChallenge(verifier);
            const state = generateState();

            storage.set('code_verifier', verifier);
            storage.set('oauth_state', state);

            const params = new URLSearchParams(window.location.search);
            const country = params.get('country');
            if (country) {
                storage.set('auth_country', country);
            }

            const authorizeUrl = buildAuthorizeUrl(clientId, challenge, state);
            log('Redirecting to Spotify authorization', { authorizeUrl });
            window.location.assign(authorizeUrl);
        } catch (error) {
            handleSetupError(error);
        }
    };

    const finalizeSuccess = (gameUrl) => {
        showMessage('Authentication successful! Redirecting…', 'success');
        toggleLoading(false);

        if (notifyOpener('spotify-auth-success', { gameUrl })) {
            setTimeout(() => window.close(), 800);
        } else {
            window.location.replace(gameUrl);
        }
    };

    const exchangeCode = async () => {
        try {
            assertCrypto();
            toggleLoading(true);

            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            const state = params.get('state');
            const error = params.get('error');
            const errorDescription = params.get('error_description');

            if (error) {
                throw new Error(errorDescription || `Authentication error: ${error}`);
            }

            if (!code || !state) {
                throw new Error('Missing authorization response parameters.');
            }

            const storedState = storage.get('oauth_state');
            if (!storedState || storedState !== state) {
                throw new Error('State validation failed. Please restart login.');
            }

            const verifier = storage.get('code_verifier');
            if (!verifier) {
                throw new Error('Authentication session expired. Please try again.');
            }

            const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    client_id: CONFIG.CLIENT_ID,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: CONFIG.AUTH_REDIRECT_URI,
                    code_verifier: verifier
                })
            });

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error_description || body.error || 'Failed to complete authentication.');
            }

            const tokens = await response.json();
            if (!tokens.access_token) {
                throw new Error('Spotify did not return an access token.');
            }

            const expiresAt = Date.now() + (tokens.expires_in * 1000);
            sessionStorage.setItem('access_token', tokens.access_token);
            sessionStorage.setItem('expires_at', expiresAt.toString());
            if (tokens.refresh_token) {
                sessionStorage.setItem('refresh_token', tokens.refresh_token);
            }

            const bootstrap = generateState();
            sessionStorage.setItem('bootstrap_nonce', bootstrap);

            const country = storage.get('auth_country');
            const search = new URLSearchParams({ bootstrap });
            if (country) {
                search.set('country', country);
            }

            const gameUrl = `${CONFIG.GAME_URL}?${search.toString()}`;
            finalizeSuccess(gameUrl);
        } catch (error) {
            log('Token exchange error', { error: error?.message });
            showMessage(error.message || 'Failed to complete authentication.', 'error');
            toggleLoading(false);
            if (notifyOpener('spotify-auth-error', { message: error.message })) {
                setTimeout(() => window.close(), 1000);
            }
        } finally {
            clearAuthArtifacts();
            const cleanUrl = new URL(window.location.href);
            cleanUrl.search = '';
            window.history.replaceState({}, document.title, cleanUrl.toString());
        }
    };

    const setupDebugToggle = () => {
        if (!dom.debugToggle || !dom.debugInfo) {
            return;
        }
        dom.debugToggle.addEventListener('click', () => {
            const visible = dom.debugInfo.style.display === 'block';
            dom.debugInfo.style.display = visible ? 'none' : 'block';
            dom.debugToggle.textContent = visible ? 'Show Debug Info' : 'Hide Debug Info';
        });
    };

    document.addEventListener('DOMContentLoaded', () => {
        setupDebugToggle();

        if (!dom.button) {
            return;
        }

        if (!CONFIG.CLIENT_ID) {
            disableButton('Spotify client ID is not configured.');
            return;
        }

        if (window.location.search) {
            exchangeCode();
            return;
        }

        dom.button.addEventListener('click', (event) => {
            event.preventDefault();
            startAuth();
        });
    });
})();

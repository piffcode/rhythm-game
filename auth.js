(() => {
    const CONFIG = window.CONFIG;
    if (!CONFIG) {
        throw new Error('Configuration failed to load. Ensure config.js runs before auth.js.');
    }

    const base64UrlEncode = (input) => {
        return btoa(String.fromCharCode(...input))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
    };

    const select = (id) => document.getElementById(id);

    const DOM = {
        button: select('authButton'),
        message: select('message'),
        loading: select('loading'),
        debugToggle: select('debugToggle'),
        debug: select('debugInfo')
    };

    const createStorage = () => {
        try {
            const probe = '__auth_storage_probe__';
            window.sessionStorage.setItem(probe, '1');
            window.sessionStorage.removeItem(probe);
            return {
                set: (key, value) => window.sessionStorage.setItem(key, value),
                take: (key) => {
                    const value = window.sessionStorage.getItem(key);
                    window.sessionStorage.removeItem(key);
                    return value;
                },
                remove: (key) => window.sessionStorage.removeItem(key)
            };
        } catch (error) {
            const fallback = new Map();
            return {
                set: (key, value) => fallback.set(key, value),
                take: (key) => {
                    const value = fallback.get(key) || null;
                    fallback.delete(key);
                    return value;
                },
                remove: (key) => fallback.delete(key)
            };
        }
    };

    const storage = createStorage();
    const debugLog = [];

    const log = (message, details) => {
        const entry = `[${new Date().toISOString()}] ${message}`;
        console.log(entry, details || '');
        debugLog.push(entry + (details ? ` ${JSON.stringify(details)}` : ''));
        if (DOM.debug) {
            DOM.debug.textContent = debugLog.join('\n');
            DOM.debug.scrollTop = DOM.debug.scrollHeight;
        }
    };

    const setButtonState = ({ disabled, label }) => {
        if (!DOM.button) {
            return;
        }

        DOM.button.disabled = Boolean(disabled);
        if (label) {
            DOM.button.textContent = label;
        }
    };

    const toggleLoading = (show) => {
        if (DOM.loading) {
            DOM.loading.style.display = show ? 'block' : 'none';
        }
        if (DOM.button) {
            DOM.button.disabled = show;
            DOM.button.textContent = show ? 'Connecting…' : 'Connect Spotify';
        }
    };

    const renderMessage = (text, type = 'error', options = {}) => {
        if (!DOM.message) {
            return;
        }

        DOM.message.className = `message ${type}`;
        DOM.message.style.display = 'block';
        DOM.message.replaceChildren();

        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        DOM.message.appendChild(paragraph);

        if (options.retry) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'retry-button';
            button.textContent = options.retry.label || 'Try Again';
            button.addEventListener('click', options.retry.callback);
            DOM.message.appendChild(button);
        }

        log(`Message displayed: ${type}`, { text });
    };

    const updateDebugToggle = () => {
        if (!DOM.debugToggle || !DOM.debug) {
            return;
        }

        DOM.debugToggle.addEventListener('click', () => {
            const isVisible = DOM.debug.style.display === 'block';
            DOM.debug.style.display = isVisible ? 'none' : 'block';
            DOM.debugToggle.textContent = isVisible ? 'Show Debug Info' : 'Hide Debug Info';
        });
    };

    const ensureSecureContext = () => {
        if (window.isSecureContext || CONFIG.IS_LOCAL) {
            return true;
        }

        renderMessage('Secure context required. Please use HTTPS to continue.', 'error', {
            retry: {
                label: 'Reload',
                callback: () => window.location.reload()
            }
        });
        setButtonState({ disabled: true, label: 'HTTPS Required' });
        return false;
    };

    const ensureCrypto = () => {
        if (window.crypto?.getRandomValues && window.crypto?.subtle?.digest) {
            return true;
        }

        renderMessage('Modern browser with Web Crypto support required to complete login.', 'error');
        setButtonState({ disabled: true, label: 'Unsupported Browser' });
        return false;
    };

    const notifyOpener = (type, payload) => {
        if (!window.opener || window.opener.closed) {
            return false;
        }

        try {
            window.opener.postMessage({ type, payload }, window.location.origin);
            return true;
        } catch (error) {
            log('Failed to notify opener window', { error: error?.message });
            return false;
        }
    };

    const randomBytes = (length) => {
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        return array;
    };

    const generateCodeVerifier = () => base64UrlEncode(randomBytes(64));

    const generateCodeChallenge = async (verifier) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return base64UrlEncode(new Uint8Array(digest));
    };

    const generateState = () => base64UrlEncode(randomBytes(32));

    const clearTransientData = () => {
        ['code_verifier', 'oauth_state', 'auth_country'].forEach((key) => {
            storage.remove(key);
        });
    };

    const beginAuth = async () => {
        try {
            if (!ensureSecureContext() || !ensureCrypto()) {
                return;
            }

            const clientId = (CONFIG.CLIENT_ID || '').trim();
            if (!clientId) {
                throw new Error('Spotify client ID is not configured.');
            }

            toggleLoading(true);

            const verifier = generateCodeVerifier();
            const challenge = await generateCodeChallenge(verifier);
            const state = generateState();

            const params = new URLSearchParams({
                client_id: clientId,
                response_type: 'code',
                redirect_uri: CONFIG.AUTH_REDIRECT_URI,
                code_challenge_method: 'S256',
                code_challenge: challenge,
                state,
                scope: (CONFIG.SCOPES || []).join(' ')
            });

            const country = new URLSearchParams(window.location.search).get('country');
            storage.set('code_verifier', verifier);
            storage.set('oauth_state', state);
            if (country) {
                storage.set('auth_country', country);
            }

            const authorizeUrl = `${CONFIG.TOKEN_ENDPOINTS.AUTHORIZE}?${params.toString()}`;
            log('Redirecting to Spotify authorization', { authorizeUrl });
            window.location.assign(authorizeUrl);
        } catch (error) {
            log('Authentication setup failed', { error: error?.message });
            console.error('Authentication setup failed:', error);
            renderMessage(`Authentication setup failed: ${error.message}`, 'error', {
                retry: {
                    label: 'Try Again',
                    callback: () => window.location.reload()
                }
            });
            toggleLoading(false);
            if (notifyOpener('spotify-auth-error', { message: error.message })) {
                setTimeout(() => window.close(), 1000);
            }
        }
    };

    const exchangeCode = async () => {
        try {
            if (!ensureSecureContext() || !ensureCrypto()) {
                return;
            }

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

            const storedState = storage.take('oauth_state');
            if (!storedState || storedState !== state) {
                throw new Error('State validation failed. Please restart the login process.');
            }

            const verifier = storage.take('code_verifier');
            if (!verifier) {
                throw new Error('Authentication session expired. Please start over.');
            }

            const response = await fetch(CONFIG.TOKEN_ENDPOINTS.EXCHANGE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                credentials: 'include',
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: CONFIG.AUTH_REDIRECT_URI,
                    code_verifier: verifier
                })
            });

            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                throw new Error(errorBody.error_description || errorBody.error || 'Token exchange failed.');
            }

            const body = await response.json();
            const bootstrap = body.bootstrap;
            if (!bootstrap) {
                throw new Error('Token service did not return a bootstrap value.');
            }

            const country = storage.take('auth_country');
            const search = new URLSearchParams({ bootstrap });
            if (country) {
                search.set('country', country);
            }

            const gameUrl = `${CONFIG.GAME_URL}?${search.toString()}`;
            renderMessage('Authentication successful! Redirecting to game…', 'success');
            log('Redirecting to game', { gameUrl });

            if (notifyOpener('spotify-auth-success', { gameUrl })) {
                setTimeout(() => window.close(), 800);
            } else {
                window.location.replace(gameUrl);
            }
        } catch (error) {
            log('Token exchange error', { error: error?.message });
            console.error('Token exchange error:', error);
            renderMessage(error.message || 'Failed to complete authentication', 'error', {
                retry: {
                    label: 'Restart Login',
                    callback: () => {
                        clearTransientData();
                        window.location.href = CONFIG.AUTH_REDIRECT_URI;
                    }
                }
            });
            toggleLoading(false);
            if (notifyOpener('spotify-auth-error', { message: error.message })) {
                setTimeout(() => window.close(), 1000);
            }
        } finally {
            clearTransientData();
        }
    };

    const initialize = () => {
        log('SpotifyAuth initialize', {
            isSecureContext: window.isSecureContext,
            hasCrypto: Boolean(window.crypto?.getRandomValues && window.crypto?.subtle?.digest),
            clientIdPresent: Boolean((CONFIG.CLIENT_ID || '').trim()),
            redirectUri: CONFIG.AUTH_REDIRECT_URI
        });

        updateDebugToggle();

        if (window.location.search) {
            exchangeCode();
        } else if (DOM.button) {
            DOM.button.addEventListener('click', (event) => {
                event.preventDefault();
                beginAuth();
            });
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        try {
            initialize();
        } catch (error) {
            console.error('Failed to initialize auth.js', error);
            renderMessage(`Failed to initialize: ${error.message}`, 'error');
        }
    });

    window.addEventListener('error', (event) => {
        if (!event.error) {
            return;
        }
        log('Global error event captured', { message: event.error.message });
    });

    window.addEventListener('unhandledrejection', (event) => {
        log('Unhandled promise rejection', { reason: event.reason?.message || String(event.reason) });
    });
})();

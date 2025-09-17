(() => {
    const MESSAGE_TYPES = {
        SUCCESS: 'spotify-auth-success',
        ERROR: 'spotify-auth-error'
    };

    const POPUP_FEATURES = 'width=500,height=700,menubar=no,toolbar=no,resizable=yes,scrollbars=yes,status=no';

    const disableButton = (button, reason) => {
        if (!button) {
            return;
        }

        button.classList.add('is-disabled');
        button.setAttribute('aria-disabled', 'true');
        button.addEventListener('click', (event) => {
            event.preventDefault();
            alert(reason);
        });
    };

    const buildAuthUrl = (config) => {
        try {
            const url = new URL(config.AUTH_REDIRECT_URI);
            const params = new URLSearchParams(window.location.search);
            const country = params.get('country');
            if (country) {
                url.searchParams.set('country', country);
            }
            return url.toString();
        } catch (error) {
            console.error('[landing] Failed to construct auth URL', error);
            return `${window.location.origin}/auth.html`;
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        const playButton = document.getElementById('playButton');
        if (!playButton) {
            return;
        }

        const config = window.CONFIG;
        if (!config || !config.AUTH_REDIRECT_URI) {
            console.error('[landing] Missing CONFIG or AUTH_REDIRECT_URI');
            disableButton(playButton, 'Configuration error: missing Spotify authorization settings.');
            return;
        }

        if (!config.CLIENT_ID) {
            console.error('[landing] Missing Spotify client ID.');
            disableButton(playButton, 'Spotify is not configured. Set the client ID before enabling login.');
            return;
        }

        let popup = null;

        const closePopup = () => {
            if (popup && !popup.closed) {
                popup.close();
            }
            popup = null;
        };

        const handleMessage = (event) => {
            if (event.origin !== window.location.origin || !event.data) {
                return;
            }

            const { type, payload } = event.data;
            if (type === MESSAGE_TYPES.SUCCESS && payload?.gameUrl) {
                closePopup();
                window.location.href = payload.gameUrl;
            } else if (type === MESSAGE_TYPES.ERROR && payload?.message) {
                closePopup();
                alert(payload.message);
            }
        };

        window.addEventListener('message', handleMessage);
        window.addEventListener('beforeunload', closePopup);

        playButton.addEventListener('click', (event) => {
            event.preventDefault();

            const authUrl = buildAuthUrl(config);
            if (popup && !popup.closed) {
                popup.location.href = authUrl;
                popup.focus();
                return;
            }

            popup = window.open(authUrl, 'spotify-auth-popup', POPUP_FEATURES);
            if (!popup) {
                window.location.href = authUrl;
            }
        });
    });
})();

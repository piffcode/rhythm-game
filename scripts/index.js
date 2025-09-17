document.addEventListener('DOMContentLoaded', () => {
    const playButton = document.getElementById('playButton');
    if (!playButton) {
        return;
    }

    const config = window.CONFIG;
    if (!config || !config.AUTH_REDIRECT_URI) {
        console.error('[landing] Missing CONFIG or AUTH_REDIRECT_URI');
        playButton.classList.add('is-disabled');
        playButton.setAttribute('aria-disabled', 'true');
        playButton.addEventListener('click', (event) => {
            event.preventDefault();
            alert('Configuration error: missing Spotify authorization settings.');
        });
        return;
    }

    let authWindow = null;

    const AUTH_MESSAGE_TYPE = 'spotify-auth-success';
    const AUTH_ERROR_TYPE = 'spotify-auth-error';

    const closeAuthWindow = () => {
        if (authWindow && !authWindow.closed) {
            authWindow.close();
        }
        authWindow = null;
    };

    const handleAuthMessage = (event) => {
        if (!event || !event.data || event.origin !== window.location.origin) {
            return;
        }

        const { data } = event;

        if (data.type === AUTH_MESSAGE_TYPE && data.payload?.gameUrl) {
            closeAuthWindow();
            window.location.href = data.payload.gameUrl;
        } else if (data.type === AUTH_ERROR_TYPE && data.payload?.message) {
            closeAuthWindow();
            alert(data.payload.message);
        }
    };

    window.addEventListener('message', handleAuthMessage);

    const buildAuthUrl = () => {
        try {
            const url = new URL(config.AUTH_REDIRECT_URI);
            const urlParams = new URLSearchParams(window.location.search);
            const country = urlParams.get('country');

            if (country) {
                url.searchParams.set('country', country);
            }

            return url.toString();
        } catch (error) {
            console.error('[landing] Failed to construct auth URL', error);
            return `${window.location.origin}/auth.html`;
        }
    };

    playButton.addEventListener('click', (event) => {
        event.preventDefault();

        const authUrl = buildAuthUrl();

        if (authWindow && !authWindow.closed) {
            authWindow.focus();
            authWindow.location.href = authUrl;
            return;
        }

        authWindow = window.open(
            authUrl,
            'spotify-auth-popup',
            'width=500,height=700,menubar=no,toolbar=no,resizable=yes,scrollbars=yes,status=no'
        );

        if (!authWindow) {
            window.location.href = authUrl;
        }
    });
});

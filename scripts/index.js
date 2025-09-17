document.addEventListener('DOMContentLoaded', () => {
    const playButton = document.getElementById('playButton');
    if (!playButton) {
        return;
    }

    let authWindow = null;

    const AUTH_MESSAGE_TYPE = 'spotify-auth-success';
    const AUTH_ERROR_TYPE = 'spotify-auth-error';

    const handleAuthMessage = (event) => {
        if (!event || !event.data) {
            return;
        }

        const { data, origin } = event;

        if (origin !== window.location.origin) {
            return;
        }

        if (data.type === AUTH_MESSAGE_TYPE && data.payload && data.payload.gameUrl) {
            if (authWindow && !authWindow.closed) {
                authWindow.close();
                authWindow = null;
            }

            window.location.href = data.payload.gameUrl;
        } else if (data.type === AUTH_ERROR_TYPE && data.payload && data.payload.message) {
            if (authWindow && !authWindow.closed) {
                authWindow.close();
                authWindow = null;
            }

            alert(data.payload.message);
        }
    };

    window.addEventListener('message', handleAuthMessage);

    playButton.addEventListener('click', (event) => {
        event.preventDefault();

        const urlParams = new URLSearchParams(window.location.search);
        const country = urlParams.get('country');

        let authUrl = CONFIG.AUTH_REDIRECT_URI.replace('/auth.html', '/auth.html');
        if (country) {
            authUrl += `?country=${encodeURIComponent(country)}`;
        }

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

document.addEventListener('DOMContentLoaded', () => {
    const playButton = document.getElementById('playButton');
    if (!playButton) {
        return;
    }

    playButton.addEventListener('click', (event) => {
        event.preventDefault();

        const urlParams = new URLSearchParams(window.location.search);
        const country = urlParams.get('country');

        let authUrl = CONFIG.AUTH_REDIRECT_URI.replace('/auth.html', '/auth.html');
        if (country) {
            authUrl += `?country=${encodeURIComponent(country)}`;
        }

        window.location.href = authUrl;
    });
});

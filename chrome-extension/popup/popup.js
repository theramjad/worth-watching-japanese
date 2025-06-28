document.addEventListener('DOMContentLoaded', async () => {
    const settingsBtn = document.getElementById('settingsBtn');
    const status = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const apiStatus = document.getElementById('apiStatus');
    const apiStatusText = document.getElementById('apiStatusText');
    const refreshApiBtn = document.getElementById('refreshApiBtn');

    // Check extension status
    try {
        const result = await chrome.storage.local.get(['knownMorphsBase64', 'morphCount']);
        const hasKnownMorphs = result.knownMorphsBase64 && result.morphCount > 0;

        if (hasKnownMorphs) {
            status.className = 'status ready';
            statusText.textContent = `Ready - ${result.morphCount} known morphs loaded`;
        } else {
            status.className = 'status not-ready';
            statusText.textContent = 'Setup required - Please upload your AnkiMorphs CSV in Settings';
        }
    } catch (error) {
        status.className = 'status not-ready';
        statusText.textContent = 'Error loading configuration';
        console.error('[JCA] Error checking extension status:', error);
    }

    // Check MeCab API status
    async function checkMecabApiStatus() {
        try {
            apiStatusText.textContent = 'Checking MeCab API...';
            apiStatus.className = 'api-status';

            const response = await fetch('http://localhost:9002/health', {
                method: 'GET',
                timeout: 3000
            });

            if (response.ok) {
                const data = await response.json();
                if (data.mecab_working) {
                    apiStatus.className = 'api-status available';
                    apiStatusText.textContent = '✓ MeCab API Server Available (localhost:9002)';
                } else {
                    apiStatus.className = 'api-status unavailable';
                    apiStatusText.textContent = '✗ MeCab API Error - Server responding but MeCab not working';
                }
            } else {
                apiStatus.className = 'api-status unavailable';
                apiStatusText.textContent = '✗ MeCab API Server Unavailable (localhost:9002)';
            }
        } catch (error) {
            apiStatus.className = 'api-status unavailable';
            apiStatusText.textContent = '✗ MeCab API Server Not Running (localhost:9002)';
        }
    }

    // Initial API status check
    checkMecabApiStatus();

    // Refresh API status button
    refreshApiBtn.addEventListener('click', checkMecabApiStatus);

    // Settings button click handler
    settingsBtn.addEventListener('click', () => {
        chrome.tabs.create({
            url: chrome.runtime.getURL('settings/settings.html')
        });
        window.close();
    });
});
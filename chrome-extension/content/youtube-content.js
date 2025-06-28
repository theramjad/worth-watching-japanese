// YouTube content script for video analysis and comprehension scoring
// This script runs on YouTube pages and adds comprehension badges to video titles
class YouTubeComprehensionAnalyzer {
    constructor() {
        this.analyzer = new YouTubeAnalyzer(); // Uses MeCab API server for analysis
        this.morphCount = 0; // Count of user's known morphs from AnkiMorphs CSV
        this.processedVideos = new Set(); // Track which videos we've already analyzed
        this.observer = null; // DOM mutation observer for dynamic content
        this.isEnabled = false; // Whether extension is properly configured

        this.init();
    }

    /**
     * Initialize the analyzer by loading configuration and starting analysis
     */
    async init() {
        try {
            // Load configuration from storage
            await this.loadConfiguration();

            if (this.isEnabled) {
                this.startAnalyzing();
            }

            // Listen for storage changes
            chrome.storage.onChanged.addListener((changes) => {
                this.handleStorageChange(changes);
            });

        } catch (error) {
            console.error('Error initializing YouTube analyzer:', error);
        }
    }

    /**
     * Load user configuration from Chrome storage
     * Extension is enabled only if user has uploaded known morphs CSV
     */
    async loadConfiguration() {
        try {
            const result = await chrome.storage.local.get(['knownMorphsBase64', 'morphCount']);

            if (result.knownMorphsBase64 && result.morphCount > 0) {
                this.morphCount = result.morphCount;
            }

            // Extension is enabled if we have known morphs loaded
            this.isEnabled = !!(this.morphCount > 0);

            console.log(`[JCA] YouTube analyzer ${this.isEnabled ? 'enabled' : 'disabled'} - ${this.morphCount} known morphs loaded`);
            if (this.isEnabled) {
                console.log('[JCA] Extension configured and ready for analysis using MeCab API server');
            } else {
                console.log('[JCA] Extension not enabled. Please upload AnkiMorphs CSV in settings.');
            }

        } catch (error) {
            console.error('[JCA] Error loading configuration:', error);
            this.isEnabled = false;
        }
    }

    /**
     * Handle changes to Chrome storage (e.g., user uploads new CSV)
     * Reprocesses all videos when configuration changes
     */
    handleStorageChange(changes) {
        let needsReload = false;

        if (changes.knownMorphsBase64 || changes.morphCount) {
            this.morphCount = changes.morphCount?.newValue || 0;
            needsReload = true;
        }

        if (needsReload) {
            this.isEnabled = !!(this.morphCount > 0);

            if (this.isEnabled) {
                this.startAnalyzing();
                this.reprocessAllVideos();
            } else {
                this.stopAnalyzing();
                this.removeAllBadges();
            }
        }
    }

    /**
     * Start analyzing YouTube videos and watching for new content
     * Sets up DOM mutation observer to catch dynamically loaded videos
     */
    startAnalyzing() {
        if (this.observer) {
            this.observer.disconnect();
        }

        // Initial analysis of existing videos
        this.analyzeExistingVideos();

        // Check if we're on a video page and add morphs button
        this.checkVideoPage();

        // Set up observer for new videos and page changes
        this.observer = new MutationObserver((mutations) => {
            this.handleDOMChanges(mutations);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Additional scroll listener for playlist infinite scroll detection
        this.setupScrollListener();

        console.log('[JCA] YouTube comprehension analyzer started with dynamic content detection');
    }

    /**
     * Set up scroll listener for additional infinite scroll detection
     * Helps catch cases where MutationObserver might miss new content
     */
    setupScrollListener() {
        // Remove existing listener if any
        if (this.scrollListener) {
            window.removeEventListener('scroll', this.scrollListener);
        }

        this.scrollListener = () => {
            // Only check on playlist pages
            const currentPath = window.location.pathname;
            const isPlaylistPage = currentPath.includes('/playlist') || currentPath.includes('watchlater') || window.location.search.includes('list=');

            if (!isPlaylistPage || !this.isEnabled) return;

            // Debounce scroll events
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = setTimeout(() => {
                // Check if we're near the bottom of the page (triggers YouTube to load more)
                const scrollPosition = window.scrollY + window.innerHeight;
                const documentHeight = document.documentElement.scrollHeight;
                const threshold = 0.8; // Trigger when 80% scrolled

                if (scrollPosition >= documentHeight * threshold) {
                    console.log('[JCA] Near bottom of playlist page - checking for new videos in 2 seconds...');

                    // Wait a bit for YouTube to load new content
                    setTimeout(() => {
                        this.analyzeNewVideos();
                    }, 2000);
                }
            }, 100); // 100ms debounce
        };

        window.addEventListener('scroll', this.scrollListener, { passive: true });
    }

    /**
     * Stop analysis and clean up observers
     */
    stopAnalyzing() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        if (this.scrollListener) {
            window.removeEventListener('scroll', this.scrollListener);
            this.scrollListener = null;
        }

        // Clear any pending timeouts
        clearTimeout(this.analysisTimeout);
        clearTimeout(this.pageChangeTimeout);
        clearTimeout(this.scrollTimeout);

        console.log('[JCA] YouTube comprehension analyzer stopped');
    }

    /**
     * Handle DOM mutations to detect new videos and page changes
     * YouTube loads content dynamically, so we watch for changes
     */
    handleDOMChanges(mutations) {
        if (!this.isEnabled) return;

        let hasNewVideos = false;
        let hasPageChanged = false;
        let addedVideoCount = 0;

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if this node or its children contain video elements
                    if (this.containsVideoElements(node)) {
                        hasNewVideos = true;

                        // Count how many video elements were added for better logging
                        const videoElements = this.getVideoElementsFromNode(node);
                        addedVideoCount += videoElements.length;
                    }

                    // Check if we're on a video page now
                    if (node.matches && (node.matches('ytd-watch-flexy') || node.querySelector('ytd-watch-flexy'))) {
                        hasPageChanged = true;
                    }

                    // Special detection for playlist infinite scroll containers
                    if (node.matches && (
                        node.matches('ytd-playlist-video-list-renderer') ||
                        node.matches('[data-content-type="playlist"]') ||
                        node.querySelector('ytd-playlist-video-renderer')
                    )) {
                        hasNewVideos = true;
                        console.log('[JCA] Detected playlist content being added to DOM');
                    }
                }
            }
        }

        if (hasNewVideos) {
            console.log(`[JCA] Detected ${addedVideoCount} new video elements added to DOM`);

            // Debounce to avoid excessive processing and wait for content to load
            clearTimeout(this.analysisTimeout);
            this.analysisTimeout = setTimeout(() => {
                console.log('[JCA] Starting delayed video analysis for newly loaded content...');
                this.analyzeNewVideos();
            }, 1500); // Reduced to 1.5 seconds for better responsiveness
        }

        if (hasPageChanged) {
            // Debounce page change detection
            clearTimeout(this.pageChangeTimeout);
            this.pageChangeTimeout = setTimeout(() => {
                this.checkVideoPage();
            }, 1000);
        }
    }

    /**
     * Check if an element contains YouTube video components
     * Used to detect when new videos are added to the page
     */
    containsVideoElements(element) {
        // Check for various YouTube video container selectors
        const videoSelectors = [
            'ytd-video-renderer',
            'ytd-compact-video-renderer',
            'ytd-grid-video-renderer',
            'ytd-rich-item-renderer',
            'ytd-shorts-renderer',
            'ytd-playlist-video-renderer',
            'ytd-playlist-video-list-renderer'
        ];

        for (const selector of videoSelectors) {
            if (element.matches && element.matches(selector)) {
                return true;
            }
            if (element.querySelector && element.querySelector(selector)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get all video elements from a DOM node (for counting purposes)
     */
    getVideoElementsFromNode(node) {
        const videoSelectors = [
            'ytd-video-renderer',
            'ytd-compact-video-renderer',
            'ytd-grid-video-renderer',
            'ytd-rich-item-renderer',
            'ytd-shorts-renderer',
            'ytd-playlist-video-renderer'
        ];

        const videos = [];

        // Check if the node itself is a video element
        for (const selector of videoSelectors) {
            if (node.matches && node.matches(selector)) {
                videos.push(node);
                break;
            }
        }

        // Find video elements within the node
        videoSelectors.forEach(selector => {
            const foundVideos = node.querySelectorAll ? node.querySelectorAll(selector) : [];
            videos.push(...foundVideos);
        });

        return videos;
    }

    /**
     * Analyze videos that were already on the page when script loaded
     */
    analyzeExistingVideos() {
        // Wait a bit for page to fully load
        setTimeout(() => {
            const currentPath = window.location.pathname;
            const isPlaylistPage = currentPath.includes('/playlist') || currentPath.includes('watchlater') || window.location.search.includes('list=');

            const videos = this.findAllVideoElements();
            console.log(`[JCA] Found ${videos.length} existing videos to analyze on ${isPlaylistPage ? 'playlist' : 'other'} page`);

            // Process videos with a small delay between each to avoid overwhelming the API
            videos.forEach((video, index) => {
                setTimeout(() => {
                    this.analyzeVideo(video);
                }, index * 200); // 200ms delay between each video analysis
            });
        }, 1000);
    }

    /**
     * Analyze newly added videos (from infinite scroll, navigation, etc.)
     */
    analyzeNewVideos() {
        const currentPath = window.location.pathname;
        const isPlaylistPage = currentPath.includes('/playlist') || currentPath.includes('watchlater') || window.location.search.includes('list=');

        const videos = this.findAllVideoElements();
        const newVideos = videos.filter(video => !this.isVideoProcessed(video));

        console.log(`[JCA] Analyzing newly loaded videos on ${isPlaylistPage ? 'playlist' : 'other'} page`);
        console.log(`[JCA] Total videos found: ${videos.length}, New videos to analyze: ${newVideos.length}`);

        if (newVideos.length === 0) {
            console.log(`[JCA] No new videos to analyze (all ${videos.length} videos already processed)`);
            return;
        }

        // Process new videos with a small delay between each to avoid overwhelming the API
        newVideos.forEach((video, index) => {
            setTimeout(() => {
                this.analyzeVideo(video);
            }, index * 200); // 200ms delay between each video analysis
        });
    }

    /**
     * Reprocess all videos (called when configuration changes)
     */
    reprocessAllVideos() {
        this.processedVideos.clear();
        this.removeAllBadges();
        this.analyzeExistingVideos();
    }

    /**
     * Find all video elements on the current page
     * Searches for various YouTube video container types
     */
    findAllVideoElements() {
        // Skip analysis on certain pages where video scores don't make sense
        const currentPath = window.location.pathname;
        const shouldSkipAnalysis = this.shouldSkipVideoAnalysis(currentPath);

        if (shouldSkipAnalysis) {
            console.log(`Skipping video analysis on page: ${currentPath}`);
            return [];
        }

        console.log(`Finding video elements on page: ${currentPath}`);

        const selectors = [
            'ytd-video-renderer',
            'ytd-compact-video-renderer',
            'ytd-grid-video-renderer',
            'ytd-rich-item-renderer',
            'ytd-shorts-renderer',
            'ytd-playlist-video-renderer',  // Videos in playlists
            'ytd-playlist-video-list-renderer' // Playlist video lists
        ];

        const videos = [];
        selectors.forEach(selector => {
            const foundVideos = document.querySelectorAll(selector);
            console.log(`Found ${foundVideos.length} videos with selector: ${selector}`);
            videos.push(...foundVideos);
        });

        console.log(`Total videos found: ${videos.length}`);
        return videos;
    }

    /**
     * Determine if we should skip analysis for current page/path
     * Skips watch pages, playlist directories, and non-Japanese content
     */
    shouldSkipVideoAnalysis(path) {
        // Debug logging
        console.log(`[JCA] Checking if should skip analysis for path: ${path}`);
        console.log(`[JCA] Full URL: ${window.location.href}`);

        // Skip on watch pages (individual video pages)
        if (path.startsWith('/watch')) {
            console.log('[JCA] Skipping: watch page');
            return true;
        }

        // Skip on playlists directory page (shows playlist cards, not videos)
        if (path === '/feed/playlists') {
            console.log('[JCA] Skipping: playlists directory page');
            return true;
        }

        // Skip on feed pages that don't contain videos (except watch later)
        if (path.startsWith('/feed/') && !path.includes('watchlater')) {
            console.log('[JCA] Skipping: other feed page');
            return true;
        }

        // Allow all playlist-related pages that contain videos:
        // - Individual playlists: /playlist?list=...
        // - Watch later: /playlist?list=WL or /feed/watchlater  
        // - Channel playlists with list parameter: /channel/.../playlists?list=...
        if (window.location.search.includes('list=') || path.includes('playlist') || path.includes('watchlater')) {
            console.log('[JCA] Allowing: playlist/watch later page');
            return false;
        }

        // Skip on channel playlists tab that shows playlist cards (not individual videos)
        if (path.includes('/playlists') && !window.location.search.includes('list=')) {
            console.log('[JCA] Skipping: channel playlists directory');
            return true;
        }

        // Allow search pages, home page, trending, etc. (but not watch pages)
        console.log('[JCA] Allowing analysis on this page');
        return false;
    }

    /**
     * Check if a video element has already been processed
     * Prevents duplicate analysis and badge creation
     */
    isVideoProcessed(videoElement) {
        const videoId = this.extractVideoIdFromElement(videoElement);
        return videoId && this.processedVideos.has(videoId);
    }

    /**
     * Main video analysis function
     * Extracts video data, gets comprehension score, and displays badge
     */
    async analyzeVideo(videoElement) {
        try {
            const videoData = this.extractVideoData(videoElement);
            if (!videoData) {
                console.log('No video data extracted from element');
                return;
            }

            console.log(`Analyzing video: ${videoData.id} - ${videoData.title}`);

            // Mark as processed to avoid duplicate analysis
            this.processedVideos.add(videoData.id);

            // Get comprehension score from MeCab API server
            let comprehensionScore = null;

            try {
                console.log(`Getting comprehension score from MeCab API server for video: ${videoData.id}`);
                comprehensionScore = await this.analyzer.getVideoComprehensionScore(videoData.id);

                if (comprehensionScore !== null) {
                    console.log(`MeCab API returned comprehension score for ${videoData.id}: ${comprehensionScore}%`);
                } else {
                    console.log(`No comprehension score available for video ${videoData.id} - skipping analysis`);
                    return; // Skip videos without scores
                }
            } catch (error) {
                console.warn(`Error getting comprehension score for ${videoData.id}:`, error);
                return; // Skip videos with API errors
            }

            if (comprehensionScore !== null) {
                this.displayComprehensionBadge(videoElement, comprehensionScore, videoData);
            }

        } catch (error) {
            console.error('Error analyzing video:', error);
        }
    }

    /**
     * Extract video data from DOM element
     * Gets video ID, title, and other metadata from YouTube's HTML structure
     */
    extractVideoData(videoElement) {
        try {
            // Extract video ID from URL
            const linkElement = videoElement.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
            if (!linkElement) return null;

            const videoId = this.analyzer.extractVideoId(linkElement.href);
            if (!videoId) return null;

            // Extract title
            const titleElement = videoElement.querySelector('#video-title, .ytd-video-meta-block #video-title, h3 a, .title a');
            const title = titleElement ? titleElement.textContent.trim() : '';

            return {
                id: videoId,
                title: title,
                element: videoElement,
                linkElement: linkElement
            };

        } catch (error) {
            console.error('Error extracting video data:', error);
            return null;
        }
    }

    /**
     * Extract video ID from various YouTube element types
     * Handles different video container formats (grid, list, shorts, etc.)
     */
    extractVideoIdFromElement(videoElement) {
        try {
            const linkElement = videoElement.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
            return linkElement ? this.analyzer.extractVideoId(linkElement.href) : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Display color-coded comprehension badge next to video title
     * Green (90%+), Orange (70-89%), Red (<70%)
     */
    displayComprehensionBadge(videoElement, score, videoData) {
        console.log(`Attempting to display badge for video ${videoData.id}: ${score}%`);

        // Remove existing badge if present
        const existingBadge = videoElement.querySelector('.comprehension-badge');
        if (existingBadge) {
            existingBadge.remove();
            console.log(`Removed existing badge for video ${videoData.id}`);
        }

        // Create badge element
        const badge = document.createElement('div');
        badge.className = 'comprehension-badge';
        badge.textContent = `${score}%`;

        // Set badge color based on score (90%+ green, 70-90% amber, <70% red)
        let badgeClass = 'low';
        if (score >= 90) badgeClass = 'high';
        else if (score >= 70) badgeClass = 'medium';

        badge.classList.add(badgeClass);

        // Add tooltip
        badge.title = `Comprehension: ${score}% (based on subtitles)`;

        // Add CSS styling
        badge.style.cssText = `
            display: inline-block;
            margin-left: 8px;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: bold;
            color: white;
            background-color: ${score >= 90 ? '#00AA00' : score >= 70 ? '#FF8800' : '#FF0000'};
        `;

        // Find the title element and insert badge at the end of the title
        const titleSelectors = [
            '#video-title',
            '.ytd-video-meta-block #video-title',
            'h3 a',
            '.title a',
            'a#video-title-link',
            '#video-title-link'
        ];

        let titleElement = null;
        for (const selector of titleSelectors) {
            titleElement = videoElement.querySelector(selector);
            if (titleElement) {
                console.log(`Found title element using selector: ${selector}`);
                break;
            }
        }

        if (titleElement) {
            titleElement.appendChild(badge);
            console.log(`✓ Badge successfully added to video: ${videoData.title} - ${score}%`);
        } else {
            console.log(`✗ Could not find title element for video: ${videoData.title}`);
            console.log(`Video element structure:`, videoElement.innerHTML.substring(0, 500));
        }
    }

    /**
     * Remove all comprehension badges from the page
     * Called when extension is disabled or configuration changes
     */
    removeAllBadges() {
        document.querySelectorAll('.comprehension-badge').forEach(badge => badge.remove());
    }

    /**
     * Check if we're on a video watch page and add morphs analysis
     * Shows additional analysis for the currently playing video
     */
    async checkVideoPage() {
        const isVideoPage = window.location.pathname === '/watch';

        if (!isVideoPage) {
            return;
        }

    }
}

// Initialize the analyzer when page loads
console.log('[JCA] YouTube Japanese Comprehension Analyzer loading...');
new YouTubeComprehensionAnalyzer();
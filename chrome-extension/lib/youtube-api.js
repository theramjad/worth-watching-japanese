// YouTube API handler for video analysis and subtitle extraction
// This class handles interaction with YouTube data and the MeCab API server
class YouTubeAnalyzer {
    constructor() {
        // Cache comprehension scores to avoid repeated API calls
        this.cache = new Map();
        // Rate limiting to prevent overloading the MeCab API server
        this.rateLimiter = new RateLimiter(300, 60000); // 300 requests per minute

        // Listen for cache clear messages from background script
        this.setupMessageListener();

        console.log('[JCA] YouTube analyzer initialized with rate limiting (300 req/min)');
    }

    /**
     * Set up message listener for cache clearing
     */
    setupMessageListener() {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                if (message.type === 'clearVideoAnalysisCache') {
                    console.log('[JCA] Received cache clear message - clearing memory cache');
                    this.clearCache();
                    sendResponse({ success: true });
                }
            });
        }
    }

    /**
     * Extract YouTube video ID from various URL formats
     * Supports: watch URLs, shorts, embed, etc.
     */
    extractVideoId(url) {
        if (!url) return null;

        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
            /youtube\.com\/v\/([^&\n?#]+)/,
            /youtube\.com\/shorts\/([^&\n?#]+)/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }

        return null;
    }

    /**
     * Get comprehensive video metadata including title, description, and subtitles
     * Tries multiple methods to extract data from YouTube's page structure
     */
    async getVideoMetadata(videoId) {
        if (!videoId) return null;

        // Check memory cache first
        const cacheKey = `metadata_${videoId}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // Check persistent cache
        try {
            const persistentCache = await chrome.storage.local.get(cacheKey);
            if (persistentCache[cacheKey]) {
                const metadata = persistentCache[cacheKey];
                this.cache.set(cacheKey, metadata);
                return metadata;
            }
        } catch (error) {
            console.warn(`[JCA] Error checking persistent metadata cache: ${error}`);
        }

        try {
            // Try to extract metadata from page's JSON data
            const metadata = this.extractMetadataFromPage(videoId);

            if (metadata) {
                // Cache in memory
                this.cache.set(cacheKey, metadata);

                // Cache persistently
                try {
                    await chrome.storage.local.set({ [cacheKey]: metadata });
                } catch (error) {
                    console.warn(`[JCA] Error saving metadata to persistent cache: ${error}`);
                }

                return metadata;
            }

        } catch (error) {
            console.warn(`Error getting metadata for video ${videoId}:`, error);
        }

        return null;
    }

    /**
     * Extract metadata directly from the current page DOM
     * Used when we're already on the video page
     */
    extractMetadataFromPage(videoId) {
        // Look for JSON data in script tags
        const scripts = document.querySelectorAll('script');

        for (const script of scripts) {
            if (script.textContent && script.textContent.includes('ytInitialData')) {
                try {
                    const jsonMatch = script.textContent.match(/var ytInitialData = ({.*?});/);
                    if (jsonMatch) {
                        const data = JSON.parse(jsonMatch[1]);
                        return this.parseYouTubeInitialData(data, videoId);
                    }
                } catch (error) {
                    // Continue searching
                }
            }
        }

        return null;
    }

    /**
     * Parse YouTube's complex initialData structure to extract video information
     * YouTube stores video data in various nested objects
     */
    parseYouTubeInitialData(data, videoId) {
        try {
            // This is a simplified parser - YouTube's data structure is complex
            // In a real implementation, you'd need more robust parsing

            const videoDetails = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[0]?.videoPrimaryInfoRenderer;

            if (videoDetails) {
                return {
                    videoId: videoId,
                    title: this.extractTextFromRuns(videoDetails.title),
                    description: this.extractTextFromRuns(videoDetails.description),
                    hasSubtitles: this.checkForSubtitles(data)
                };
            }

        } catch (error) {
            console.warn('Error parsing YouTube initial data:', error);
        }

        return null;
    }

    /**
     * Extract text from YouTube's text run objects
     * YouTube often stores text as arrays of objects with different formatting
     */
    extractTextFromRuns(textObject) {
        if (!textObject) return '';

        if (textObject.simpleText) {
            return textObject.simpleText;
        }

        if (textObject.runs && Array.isArray(textObject.runs)) {
            return textObject.runs.map(run => run.text || '').join('');
        }

        return '';
    }

    /**
     * Check if Japanese subtitles are available for a video
     * Searches through YouTube's caption data structure
     */
    checkForSubtitles(data) {
        try {
            // Look for caption tracks in the data
            const playerResponse = data?.playerResponse;
            if (playerResponse && typeof playerResponse === 'string') {
                const parsed = JSON.parse(playerResponse);
                return !!(parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length > 0);
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get Japanese subtitles for a video
     * Returns the full subtitle text concatenated as a string
     */
    async getSubtitles(videoId) {
        if (!videoId) return null;

        // Check memory cache first
        const cacheKey = `subtitles_${videoId}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // Check persistent cache
        try {
            const persistentCache = await chrome.storage.local.get(cacheKey);
            if (persistentCache[cacheKey]) {
                const subtitles = persistentCache[cacheKey];
                this.cache.set(cacheKey, subtitles);
                return subtitles;
            }
        } catch (error) {
            console.warn(`[JCA] Error checking persistent subtitles cache: ${error}`);
        }

        try {
            await this.rateLimiter.waitForPermission();

            // Try to find subtitle tracks
            const subtitleTracks = this.findSubtitleTracks(videoId);

            if (subtitleTracks.length > 0) {
                // Prefer Japanese subtitles, fall back to auto-generated
                const preferredTrack = this.selectPreferredTrack(subtitleTracks);

                if (preferredTrack) {
                    const subtitleText = await this.fetchSubtitleTrack(preferredTrack);

                    if (subtitleText) {
                        // Cache in memory
                        this.cache.set(cacheKey, subtitleText);

                        // Cache persistently
                        try {
                            await chrome.storage.local.set({ [cacheKey]: subtitleText });
                        } catch (error) {
                            console.warn(`[JCA] Error saving subtitles to persistent cache: ${error}`);
                        }

                        return subtitleText;
                    }
                }
            }

        } catch (error) {
            console.warn(`Error fetching subtitles for video ${videoId}:`, error);
        }

        return null;
    }

    /**
     * Convert stored known morphs to base64-encoded CSV format
     * Creates AnkiMorphs-compatible CSV with Morph-Lemma,Morph-Inflection columns
     */
    async getKnownMorphsAsBase64() {
        try {
            console.log('[JCA] Loading known morphs from storage...');

            const result = await chrome.storage.local.get(['knownMorphsBase64', 'morphCount']);
            if (!result.knownMorphsBase64) {
                console.warn('[JCA] No known morphs found in storage');
                return null;
            }

            console.log(`[JCA] Found ${result.morphCount || 'unknown count'} known morphs (cached as base64)`);

            return result.knownMorphsBase64;

        } catch (error) {
            console.error('[JCA] Error getting known morphs:', error);
            throw error;
        }
    }

    /**
     * Main function: Get comprehension score for a video using MeCab API server
     * 1. Checks cache first to avoid duplicate requests
     * 2. Fetches Japanese subtitles if available
     * 3. Sends subtitles + known morphs CSV to MeCab server for analysis
     * 4. Returns percentage comprehension score (known morphs / total morphs)
     */
    async getVideoComprehensionScore(videoId) {
        if (!videoId) return null;

        // Check memory cache first
        const cacheKey = `comprehension_${videoId}`;
        if (this.cache.has(cacheKey)) {
            console.log(`[JCA] Memory cache hit for video ${videoId}`);
            return this.cache.get(cacheKey);
        }

        // Check persistent cache
        try {
            const persistentCache = await chrome.storage.local.get(cacheKey);
            if (persistentCache[cacheKey] !== undefined) {
                console.log(`[JCA] Persistent cache hit for video ${videoId}`);
                const score = persistentCache[cacheKey];
                // Update memory cache
                this.cache.set(cacheKey, score);
                return score;
            }
        } catch (error) {
            console.warn(`[JCA] Error checking persistent cache: ${error}`);
        }

        try {
            await this.rateLimiter.waitForPermission();

            console.log(`[JCA] Analyzing video ${videoId} with MeCab API server...`);

            // Get known morphs as base64 CSV data
            const csvBase64 = await this.getKnownMorphsAsBase64();
            if (!csvBase64) {
                console.warn('No known morphs available - cannot analyze video');
                return null;
            }

            // Make request to MeCab API server for analysis with CSV data
            const mecabApiUrl = `http://localhost:9002/analyze/${videoId}`;
            console.log(`[JCA] Making request to MeCab API: ${mecabApiUrl}`);

            const response = await fetch(mecabApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    csv_data: csvBase64
                })
            });

            console.log(`[JCA] MeCab API response status: ${response.status}`);

            if (!response.ok) {
                console.log(`[JCA] MeCab API request failed: ${response.status} ${response.statusText}`);
                return null;
            }

            const data = await response.json();
            console.log(`[JCA] MeCab API response data:`, data);

            if (data && data.success && typeof data.comprehension_score === 'number') {
                const score = data.comprehension_score;
                console.log(`[JCA] Successfully analyzed video ${videoId}: ${score}% comprehension`);

                // Cache in memory
                this.cache.set(cacheKey, score);

                // Cache persistently (will last until new CSV is uploaded)
                try {
                    await chrome.storage.local.set({ [cacheKey]: score });
                    console.log(`[JCA] Cached score for video ${videoId} persistently`);
                } catch (error) {
                    console.warn(`[JCA] Error saving to persistent cache: ${error}`);
                }

                return score;
            } else {
                const errorMsg = data.error || 'Unknown error';
                console.log(`[JCA] No comprehension score available for video ${videoId}: ${errorMsg}`);
                return null;
            }

        } catch (error) {
            console.warn(`Error analyzing video ${videoId} with MeCab API:`, error);
            return null;
        }
    }

    /**
     * Find available subtitle tracks in the page data
     * Searches through script tags for YouTube's caption track data
     */
    findSubtitleTracks(videoId) {
        const tracks = [];

        // Look for caption track information in page data
        const scripts = document.querySelectorAll('script');
        console.log(`[JCA] Searching through ${scripts.length} script tags for caption tracks`);

        let scriptsWithCaptionTracks = 0;
        let totalMatches = 0;

        for (const script of scripts) {
            if (script.textContent && script.textContent.includes('captionTracks')) {
                scriptsWithCaptionTracks++;
                console.log(`[JCA] Found script with 'captionTracks' text (${scriptsWithCaptionTracks})`);

                try {
                    const match = script.textContent.match(/"captionTracks":\s*(\[.*?\])/);
                    if (match) {
                        totalMatches++;
                        console.log(`[JCA] Found captionTracks JSON match ${totalMatches}:`, match[1].substring(0, 200) + '...');
                        const captionTracks = JSON.parse(match[1]);
                        console.log(`[JCA] Parsed ${captionTracks.length} caption tracks`);
                        tracks.push(...captionTracks);
                    }
                } catch (error) {
                    console.log(`[JCA] Error parsing caption tracks JSON:`, error);
                    // Continue searching
                }
            }
        }

        console.log(`[JCA] Subtitle track search complete: ${scriptsWithCaptionTracks} scripts with 'captionTracks', ${totalMatches} JSON matches, ${tracks.length} total tracks found`);
        console.log(`[JCA] Current page URL: ${window.location.href}`);
        console.log(`[JCA] Current page path: ${window.location.pathname}`);

        return tracks;
    }

    /**
     * Select the best Japanese subtitle track
     * Prioritizes manual subtitles over auto-generated
     */
    selectPreferredTrack(tracks) {
        // Prefer Japanese tracks
        const japaneseTracks = this.filterJapaneseTracks(tracks);

        if (japaneseTracks.length > 0) {
            return this.selectPreferredJapaneseTrack(japaneseTracks);
        }

        // Fall back to auto-generated if available
        const autoTracks = tracks.filter(track => track.kind === 'asr');
        return autoTracks[0] || tracks[0] || null;
    }

    /**
     * Filter tracks to only Japanese ones
     * Checks language codes and track names for Japanese indicators
     */
    filterJapaneseTracks(tracks) {
        return tracks.filter(track => {
            // Check language code
            if (track.languageCode === 'ja' || track.languageCode === 'ja-JP' || track.languageCode === 'jp') {
                return true;
            }

            // Check name/label for Japanese indicators
            if (track.name && track.name.simpleText) {
                const name = track.name.simpleText.toLowerCase();
                return name.includes('日本語') || name.includes('japanese') || name.includes('japan');
            }

            // Check vssId for Japanese indicators
            if (track.vssId) {
                return track.vssId.includes('.ja') || track.vssId.includes('ja.');
            }

            return false;
        });
    }

    /**
     * Select preferred Japanese track (manual over auto-generated)
     */
    selectPreferredJapaneseTrack(japaneseTracks) {
        if (japaneseTracks.length === 0) return null;

        // Prefer manual over auto-generated
        const manualTracks = japaneseTracks.filter(track => !track.kind || track.kind !== 'asr');
        if (manualTracks.length > 0) {
            return manualTracks[0];
        }

        // Fall back to auto-generated Japanese
        const autoTracks = japaneseTracks.filter(track => track.kind === 'asr');
        return autoTracks[0] || japaneseTracks[0];
    }

    /**
     * Fetch subtitle content from a YouTube caption track
     */
    async fetchSubtitleTrack(track) {
        if (!track.baseUrl) return null;

        try {
            const response = await fetch(track.baseUrl);
            if (!response.ok) return null;

            const subtitleXml = await response.text();
            return this.parseSubtitleXml(subtitleXml);

        } catch (error) {
            console.warn('Error fetching subtitle track:', error);
            return null;
        }
    }

    /**
     * Parse subtitle XML/VTT content to extract plain text
     * Handles both YouTube XML format and WebVTT format
     */
    parseSubtitleXml(xmlContent) {
        try {
            // Handle different subtitle formats
            if (xmlContent.includes('<transcript>')) {
                // YouTube XML format
                const parser = new DOMParser();
                const doc = parser.parseFromString(xmlContent, 'text/xml');
                const textNodes = doc.querySelectorAll('text');

                return Array.from(textNodes)
                    .map(node => node.textContent)
                    .filter(text => text && text.trim())
                    .join(' ');

            } else if (xmlContent.includes('WEBVTT')) {
                // WebVTT format
                return xmlContent
                    .split('\n')
                    .filter(line => !line.includes('-->') &&
                        !line.startsWith('WEBVTT') &&
                        !line.match(/^\d+$/) &&
                        line.trim())
                    .join(' ');
            }

        } catch (error) {
            console.warn('Error parsing subtitle content:', error);
        }

        return null;
    }

    /**
     * Clear cache to free memory and force fresh analysis
     */
    async clearCache() {
        // Clear memory cache
        this.cache.clear();

        // Clear persistent cache for this analyzer
        try {
            const allData = await chrome.storage.local.get();
            const cacheKeys = Object.keys(allData).filter(key =>
                key.startsWith('comprehension_') ||
                key.startsWith('metadata_') ||
                key.startsWith('subtitles_')
            );

            if (cacheKeys.length > 0) {
                await chrome.storage.local.remove(cacheKeys);
                console.log(`[JCA] Cleared ${cacheKeys.length} persistent cache entries`);
            }
        } catch (error) {
            console.warn(`[JCA] Error clearing persistent cache: ${error}`);
        }

        console.log('[JCA] Video analysis cache cleared (memory and persistent)');
    }

    /**
     * Get cache statistics for debugging
     */
    async getCacheStats() {
        let persistentCacheSize = 0;

        try {
            const allData = await chrome.storage.local.get();
            persistentCacheSize = Object.keys(allData).filter(key =>
                key.startsWith('comprehension_') ||
                key.startsWith('metadata_') ||
                key.startsWith('subtitles_')
            ).length;
        } catch (error) {
            console.warn('[JCA] Error getting persistent cache stats:', error);
        }

        return {
            memorySize: this.cache.size,
            persistentSize: persistentCacheSize,
            memoryEntries: Array.from(this.cache.keys())
        };
    }
}

/**
 * Rate limiter to prevent overwhelming the MeCab API server
 * Ensures we don't exceed the configured requests per time window
 */
class RateLimiter {
    constructor(maxRequests, timeWindow) {
        this.maxRequests = maxRequests;
        this.timeWindow = timeWindow;
        this.requests = [];
    }

    async waitForPermission() {
        const now = Date.now();

        // Remove old requests outside the time window
        this.requests = this.requests.filter(time => now - time < this.timeWindow);

        if (this.requests.length >= this.maxRequests) {
            const waitTime = this.timeWindow - (now - this.requests[0]);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return this.waitForPermission();
        }

        this.requests.push(now);
    }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.YouTubeAnalyzer = YouTubeAnalyzer;
    window.RateLimiter = RateLimiter;
}
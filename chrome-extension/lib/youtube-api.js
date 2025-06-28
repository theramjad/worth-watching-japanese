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
 * Clear cache to free memory and force fresh analysis
 */
    async clearCache() {
        // Clear memory cache
        this.cache.clear();

        // Clear persistent cache for this analyzer
        try {
            const allData = await chrome.storage.local.get();
            const cacheKeys = Object.keys(allData).filter(key =>
                key.startsWith('comprehension_')
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
                key.startsWith('comprehension_')
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
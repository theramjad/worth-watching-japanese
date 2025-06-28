// Background service worker for YouTube Japanese Comprehension Analyzer
class BackgroundService {
    constructor() {
        this.cache = new Map();
        this.init();
    }

    init() {
        // Handle extension installation
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleInstalled(details);
        });

        // Handle messages from content scripts and popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep message channel open for async responses
        });

        // Handle storage changes
        chrome.storage.onChanged.addListener((changes, areaName) => {
            this.handleStorageChange(changes, areaName);
        });


    }

    handleInstalled(details) {
        console.log('YouTube Japanese Comprehension Analyzer installed:', details.reason);

        if (details.reason === 'install') {
            // First time installation
            this.initializeExtension();
        } else if (details.reason === 'update') {
            // Extension updated
            this.handleUpdate(details.previousVersion);
        }
    }

    async initializeExtension() {
        try {
            // Set default settings
            const defaultSettings = {
                morphemizerType: 'mecab-api', // Always use MeCab API server
                enableAutoAnalysis: true,
                cacheEnabled: true,
                maxCacheSize: 1000
            };

            // Only set defaults if not already configured
            const existing = await chrome.storage.local.get(Object.keys(defaultSettings));
            const toSet = {};

            for (const [key, value] of Object.entries(defaultSettings)) {
                if (!(key in existing)) {
                    toSet[key] = value;
                }
            }

            if (Object.keys(toSet).length > 0) {
                await chrome.storage.local.set(toSet);
                console.log('Default settings initialized:', toSet);
            }

            // Show welcome notification or open settings
            this.showWelcomeMessage();

        } catch (error) {
            console.error('Error initializing extension:', error);
        }
    }

    async handleUpdate(previousVersion) {
        console.log(`Extension updated from ${previousVersion} to ${chrome.runtime.getManifest().version}`);

        try {
            // Perform any necessary data migrations here
            await this.performDataMigration(previousVersion);

            // Clear cache on updates to avoid compatibility issues
            await this.clearCache();

        } catch (error) {
            console.error('Error handling extension update:', error);
        }
    }

    async performDataMigration(fromVersion) {
        // Placeholder for future data migrations
        console.log(`Performing data migration from version ${fromVersion}`);

        // Example: Migrate old storage format to new format
        // const oldData = await chrome.storage.local.get('oldKey');
        // if (oldData.oldKey) {
        //     await chrome.storage.local.set({ newKey: transformData(oldData.oldKey) });
        //     await chrome.storage.local.remove('oldKey');
        // }
    }

    async handleMessage(message, sender, sendResponse) {
        try {
            switch (message.type) {
                case 'getVideoAnalysis':
                    const analysis = await this.getVideoAnalysis(message.videoId);
                    sendResponse({ success: true, data: analysis });
                    break;

                case 'cacheVideoAnalysis':
                    await this.cacheVideoAnalysis(message.videoId, message.analysis);
                    sendResponse({ success: true });
                    break;

                case 'getStats':
                    const stats = await this.getExtensionStats();
                    sendResponse({ success: true, data: stats });
                    break;

                case 'clearCache':
                    await this.clearCache();
                    sendResponse({ success: true });
                    break;

                case 'clearVideoAnalysisCache':
                    await this.clearVideoAnalysisCache();
                    sendResponse({ success: true });
                    break;

                default:
                    sendResponse({ success: false, error: 'Unknown message type' });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    handleStorageChange(changes, areaName) {
        if (areaName !== 'local') return;

        // Clear video analysis cache when known morphs are updated
        if (changes.knownMorphsBase64) {
            console.log('Known morphs CSV updated - clearing video analysis cache');
            this.clearVideoAnalysisCache();
        }

        // Log significant changes
        if (changes.knownMorphsBase64 || changes.morphCount) {
            const oldCount = changes.morphCount?.oldValue || 0;
            const newCount = changes.morphCount?.newValue || 0;

            console.log(`Known morphs updated: ${oldCount} → ${newCount}`);
        }
    }

    async getVideoAnalysis(videoId) {
        if (!videoId) return null;

        // Check memory cache first
        const cacheKey = `analysis_${videoId}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // Check persistent storage
        try {
            const result = await chrome.storage.local.get(cacheKey);
            if (result[cacheKey]) {
                // Update memory cache
                this.cache.set(cacheKey, result[cacheKey]);
                return result[cacheKey];
            }
        } catch (error) {
            console.warn('Error retrieving cached analysis:', error);
        }

        return null;
    }

    async cacheVideoAnalysis(videoId, analysis) {
        if (!videoId || !analysis) return;

        const cacheKey = `analysis_${videoId}`;

        // Add timestamp
        const cacheEntry = {
            ...analysis,
            timestamp: Date.now(),
            videoId: videoId
        };

        // Store in memory cache
        this.cache.set(cacheKey, cacheEntry);

        // Store in persistent storage
        try {
            await chrome.storage.local.set({ [cacheKey]: cacheEntry });
        } catch (error) {
            console.warn('Error caching analysis:', error);
        }

        // Cleanup old cache entries if needed
        await this.cleanupOldCacheEntries();
    }



    async clearCache() {
        try {
            // Clear memory cache
            this.cache.clear();

            // Clear persistent cache
            const allData = await chrome.storage.local.get();
            const cacheKeys = Object.keys(allData).filter(key => key.startsWith('analysis_'));

            if (cacheKeys.length > 0) {
                await chrome.storage.local.remove(cacheKeys);
                console.log(`Cleared ${cacheKeys.length} cache entries`);
            }

        } catch (error) {
            console.error('Error clearing cache:', error);
        }
    }

    async clearVideoAnalysisCache() {
        try {
            // Clear memory cache
            this.cache.clear();

            // Clear persistent video analysis cache (but keep other data like settings)
            const allData = await chrome.storage.local.get();
            const analysisCacheKeys = Object.keys(allData).filter(key =>
                key.startsWith('analysis_') ||
                key.startsWith('comprehension_')
            );

            if (analysisCacheKeys.length > 0) {
                await chrome.storage.local.remove(analysisCacheKeys);
                console.log(`Cleared ${analysisCacheKeys.length} video analysis cache entries`);
            }

            // Notify content scripts to clear their memory caches
            this.notifyContentScriptsCacheClear();

        } catch (error) {
            console.error('Error clearing video analysis cache:', error);
        }
    }

    async notifyContentScriptsCacheClear() {
        try {
            // Get all tabs
            const tabs = await chrome.tabs.query({});

            // Notify each tab to clear its cache
            for (const tab of tabs) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        type: 'clearVideoAnalysisCache'
                    });
                } catch (error) {
                    // Tab might not have content script loaded, ignore error
                }
            }
        } catch (error) {
            console.warn('Error notifying content scripts:', error);
        }
    }

    async getExtensionStats() {
        try {
            const allData = await chrome.storage.local.get();

            // Count different types of data
            const knownMorphsCount = allData.morphCount || 0;
            const cacheEntriesCount = Object.keys(allData).filter(key => key.startsWith('analysis_')).length;

            // Memory usage
            const memoryCacheSize = this.cache.size;

            return {
                knownMorphsCount,
                cacheEntriesCount,
                memoryCacheSize,
                morphemizerType: 'MeCab API', // Always MeCab API server
                lastUpdated: allData.lastUpdated || 'never',
                extensionVersion: chrome.runtime.getManifest().version
            };

        } catch (error) {
            console.error('Error getting stats:', error);
            return null;
        }
    }



    showWelcomeMessage() {
        // Could show a notification or badge here
        // For now, just log
        console.log('YouTube Japanese Comprehension Analyzer is ready! Configure your known morphs in the settings.');
    }
}

// Initialize the background service
new BackgroundService();
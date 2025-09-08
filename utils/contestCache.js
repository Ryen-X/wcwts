const CACHE_KEY = 'wcwts_contest_cache_v1';
const DEFAULT_CACHE_TTL_HOURS = 24;

async function getOptions() {
    try {
        const options = await chrome.storage.sync.get({
            cacheTTL: DEFAULT_CACHE_TTL_HOURS,
            apiEnabled: true,
        });
        return options;
    } catch (e) {
        console.error("WCWTS: Failed to get options from chrome.storage.sync", e);
        return {
            cacheTTL: DEFAULT_CACHE_TTL_HOURS,
            apiEnabled: true,
        };
    }
}

export async function getCache() {
    try {
        const result = await chrome.storage.local.get(CACHE_KEY);
        return result[CACHE_KEY] || {};
    } catch (e) {
        console.error("WCWTS: Failed to get cache from chrome.storage.local", e);
        return {};
    }
}

export async function setCache(cache) {
    try {
        await chrome.storage.local.set({ [CACHE_KEY]: cache });
    } catch (e) {
        console.error("WCWTS: Failed to set cache in chrome.storage.local", e);
    }
}

export function isExpired(cachedItem) {
    if (!cachedItem || !cachedItem.timestamp) {
        return true;
    }
    const { cacheTTL } = getOptions();
    const ageMillis = Date.now() - cachedItem.timestamp;
    const ageHours = ageMillis / (1000 * 60 * 60);
    return ageHours > cacheTTL;
}

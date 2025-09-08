const CACHE_KEY = 'wcwts_contest_cache_v1';
const OPTIONS_KEY = 'wcwts_options_v1';
const DEFAULT_OPTIONS = {
  enabled: true,
  useApi: true,
  cacheTTLHours: 24,
  rateLimitMs: 1100
};

let lastRequestTime = 0;

// ********** storage helpers **********
function getOptions() {
  return new Promise((resolve) => {
    chrome.storage.local.get([OPTIONS_KEY], items => {
      const opts = items[OPTIONS_KEY] || DEFAULT_OPTIONS;
      resolve(opts);
    });
  });
}

function setOptions(opts) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [OPTIONS_KEY]: opts }, () => resolve());
  });
}

function getCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get([CACHE_KEY], items => {
      resolve(items[CACHE_KEY] || {});
    });
  });
}

function setCache(cache) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CACHE_KEY]: cache }, () => resolve());
  });
}

// ********** utility: rate-limited fetch **********
async function rateLimitedFetch(url) {
  const opts = await getOptions();
  const waitMs = Math.max(0, (opts.rateLimitMs || DEFAULT_OPTIONS.rateLimitMs) - (Date.now() - lastRequestTime));
  if (waitMs > 0) {
    await new Promise(r => setTimeout(r, waitMs));
  }
  lastRequestTime = Date.now();
  return fetch(url);
}

// ********** fetch contest metadata from Codeforces API **********
async function fetchContestFromAPI(contestId) {
  try {
    if (!contestId) return { ok: false, error: 'no-contest-id' };
    if (String(contestId).startsWith('gym-')) {
      const gymId = String(contestId).split('-')[1];
      const url = `https://codeforces.com/api/contest.standings?contestId=${encodeURIComponent(gymId)}&from=1&count=1`;
      const resp = await rateLimitedFetch(url);
      const json = await resp.json();
      if (json && json.status === 'OK' && json.result && json.result.contest) {
        const c = json.result.contest;
        return {
          ok: true,
          contestName: c.name,
          startTime: c.startTimeSeconds || null,
          durationSeconds: c.durationSeconds || null
        };
      } else {
        return { ok: false, error: 'gym-not-found' };
      }
    }

    // normal contest
    const url = `https://codeforces.com/api/contest.standings?contestId=${encodeURIComponent(contestId)}&from=1&count=1`;
    const resp = await rateLimitedFetch(url);
    const json = await resp.json();
    if (json && json.status === 'OK' && json.result && json.result.contest) {
      const c = json.result.contest;
      return {
        ok: true,
        contestName: c.name,
        startTime: c.startTimeSeconds || null,
        durationSeconds: c.durationSeconds || null
      };
    } else {
      return { ok: false, error: json && json.comment ? json.comment : 'not-found' };
    }
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ********** caching layer **********
async function getContestMetadata(contestId) {
  const opts = await getOptions();
  const cache = await getCache();
  const now = Date.now();

  if (cache[contestId]) {
    const item = cache[contestId];
    const ageMs = now - (item.fetchedAt || 0);
    const ttlMs = (opts.cacheTTLHours || DEFAULT_OPTIONS.cacheTTLHours) * 3600 * 1000;
    if (ageMs <= ttlMs) {
      return { ok: true, ...item };
    }
  }

  if (!opts.useApi) {
    return { ok: false, error: 'api-disabled' };
  }
  
  const fetched = await fetchContestFromAPI(contestId);
  if (fetched.ok) {
    const toStore = {
      contestName: fetched.contestName,
      startTime: fetched.startTime,
      durationSeconds: fetched.durationSeconds,
      fetchedAt: Date.now()
    };
    const newCache = await getCache();
    newCache[contestId] = toStore;
    await setCache(newCache);
    return { ok: true, ...toStore };
  } else {
    const newCache = await getCache();
    newCache[contestId] = {
      contestName: null,
      startTime: null,
      durationSeconds: null,
      fetchedAt: Date.now()
    };
    await setCache(newCache);
    return { ok: false, error: fetched.error };
  }
}

// ********** classification logic **********
async function classifySubmission(payload) {
  const { contestId, timestamp } = payload;
  if (!contestId) {
    return { ok: true, label: 'Practice' };
  }

  const metaResp = await getContestMetadata(contestId);
  if (metaResp.ok && metaResp.startTime) {
    const start = Number(metaResp.startTime);
    const dur = Number(metaResp.durationSeconds || 0);
    const end = start + dur;
    if (timestamp) {
      if (timestamp >= start && timestamp <= end) {
        return { ok: true, label: 'Live Contest' };
      } else {
        return { ok: true, label: 'Practice' };
      }
    } else {
      return { ok: true, label: 'Unknown' };
    }
  } else {
    return { ok: true, label: 'Unknown' };
  }
}

// ********** message handling **********
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) {
        sendResponse({ ok: false, error: 'invalid-message' });
        return;
      }
      if (msg.type === 'getContestMetadata') {
        const contestId = msg.contestId;
        const resp = await getContestMetadata(contestId);
        sendResponse(resp);
        return;
      } else if (msg.type === 'classifySubmission') {
        const resp = await classifySubmission(msg.payload || {});
        sendResponse(resp);
        return;
      } else if (msg.type === 'getOptions') {
        const opts = await getOptions();
        sendResponse({ ok: true, options: opts });
        return;
      } else if (msg.type === 'setOptions') {
        const newOpts = msg.options || DEFAULT_OPTIONS;
        await setOptions(newOpts);
        sendResponse({ ok: true });
        return;
      } else if (msg.type === 'clearCache') {
        await setCache({});
        sendResponse({ ok: true });
        return;
      } else {
        sendResponse({ ok: false, error: 'unknown-type' });
        return;
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
      return;
    }
  })();
  return true;
});

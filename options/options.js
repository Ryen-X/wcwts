// options/options.js
document.addEventListener('DOMContentLoaded', async () => {
  const optEnabled = document.getElementById('optEnabled');
  const optUseApi = document.getElementById('optUseApi');
  const optCacheTTL = document.getElementById('optCacheTTL');
  const optRateLimit = document.getElementById('optRateLimit');
  const saveBtn = document.getElementById('saveBtn');
  const clearCacheBtn = document.getElementById('clearCache');
  const status = document.getElementById('status');

  function getOptions() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getOptions' }, (resp) => {
        if (resp && resp.ok && resp.options) resolve(resp.options);
        else resolve(null);
      });
    });
  }

  function setOptions(opts) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'setOptions', options: opts }, (resp) => resolve(resp));
    });
  }

  function clearCache() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'clearCache' }, (resp) => resolve(resp));
    });
  }

  const opts = await getOptions();
  const current = opts || { enabled: true, useApi: true, cacheTTLHours: 24, rateLimitMs: 1100 };

  optEnabled.checked = Boolean(current.enabled);
  optUseApi.checked = Boolean(current.useApi);
  optCacheTTL.value = Number(current.cacheTTLHours || 24);
  optRateLimit.value = Number(current.rateLimitMs || 1100);

  saveBtn.addEventListener('click', async () => {
    const newOpts = {
      enabled: Boolean(optEnabled.checked),
      useApi: Boolean(optUseApi.checked),
      cacheTTLHours: Number(optCacheTTL.value) || 24,
      rateLimitMs: Number(optRateLimit.value) || 1100
    };
    await setOptions(newOpts);
    status.textContent = 'Options saved.';
    setTimeout(() => status.textContent = '', 2500);
  });

  clearCacheBtn.addEventListener('click', async () => {
    await clearCache();
    status.textContent = 'Cache cleared.';
    setTimeout(() => status.textContent = '', 2500);
  });
});

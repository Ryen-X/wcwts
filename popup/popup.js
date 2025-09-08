// popup/popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const toggleEnabled = document.getElementById('toggleEnabled');
  const toggleApi = document.getElementById('toggleApi');
  const refreshBtn = document.getElementById('refreshBtn');
  const openOptions = document.getElementById('openOptions');

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
      chrome.runtime.sendMessage({ type: 'setOptions', options: opts }, (resp) => {
        resolve(resp);
      });
    });
  }

  const opts = await getOptions();
  const current = opts || { enabled: true, useApi: true };

  toggleEnabled.checked = Boolean(current.enabled);
  toggleApi.checked = Boolean(current.useApi);

  toggleEnabled.addEventListener('change', async () => {
    const newOpts = { ...current, enabled: toggleEnabled.checked, useApi: toggleApi.checked };
    await setOptions(newOpts);
    refreshActiveTab();
  });

  toggleApi.addEventListener('change', async () => {
    const newOpts = { ...current, enabled: toggleEnabled.checked, useApi: toggleApi.checked };
    await setOptions(newOpts);
    // refresh
    refreshActiveTab();
  });

  refreshBtn.addEventListener('click', refreshActiveTab);

  openOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  function refreshActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'refreshGrouping' }, (resp) => {
        // ignore response
      });
    });
  }
});

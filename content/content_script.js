(() => {
  'use strict';

  const LOG = '[WCWTS]';
  const HEADER_CLASS = 'wcwts-header';
  const GAP_CLASS = 'wcwts-group-gap';
  const DEFAULT_COLSPAN = 99;
  const CONTEST_LIST_CACHE_KEY = 'wcwts_contest_list_v1';
  const CONTEST_LIST_TTL_MS = 24 * 3600 * 1000;

  // ---------- helpers ----------
  function waitForSelector(selector, timeout = 10000) {
    const poll = 120;
    const start = Date.now();
    return new Promise((resolve) => {
      (function check() {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        if (Date.now() - start > timeout) return resolve(null);
        setTimeout(check, poll);
      })();
    });
  }

  function debounce(fn, wait) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        try { fn(...args); } catch (e) { console.error(LOG, e); }
      }, wait);
    };
  }

  function getHandleFromUrl() {
    const m = location.pathname.match(/^\/submissions\/([^\/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function fetchJson(url) {
    try {
      const res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      console.warn(LOG, `fetchJson failed for ${url}:`, e && e.message ? e.message : e);
      throw e;
    }
  }

  // ---------- contest list caching ----------
  async function getContestListCached() {
    return new Promise((resolve) => {
      chrome.storage.local.get([CONTEST_LIST_CACHE_KEY], (items) => {
        const info = items[CONTEST_LIST_CACHE_KEY];
        if (info && info.fetchedAt && (Date.now() - info.fetchedAt < CONTEST_LIST_TTL_MS) && info.map) {
          resolve({ ok: true, map: info.map });
        } else resolve({ ok: false });
      });
    });
  }

  async function setContestListCached(map) {
    return new Promise((resolve) => {
      const payload = { fetchedAt: Date.now(), map };
      const obj = {}; obj[CONTEST_LIST_CACHE_KEY] = payload;
      chrome.storage.local.set(obj, () => resolve());
    });
  }

  async function loadContestListMap() {
    try {
      const cached = await getContestListCached();
      if (cached && cached.ok) return cached.map;
    } catch (e) { /* ignore */ }

    try {
      const url = 'https://codeforces.com/api/contest.list?gym=false';
      const json = await fetchJson(url);
      if (json && json.status === 'OK' && Array.isArray(json.result)) {
        const map = {};
        for (const c of json.result) {
          if (typeof c.id !== 'undefined') {
            map[String(c.id)] = {
              name: c.name || `Contest ${c.id}`,
              startTime: c.startTimeSeconds || null,
              durationSeconds: c.durationSeconds || null
            };
          }
        }
        try { await setContestListCached(map); } catch (e) { /* ignore */ }
        return map;
      } else {
        console.warn(LOG, 'contest.list returned non-OK:', json && json.comment);
        return {};
      }
    } catch (e) {
      console.warn(LOG, 'failed to fetch contest.list:', e && e.message ? e.message : e);
      return {};
    }
  }

  // ---------- user submissions ----------
  async function loadUserSubmissions(handle) {
    if (!handle) return { ok: false, error: 'no-handle' };
    try {
      const url = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=100000`;
      const json = await fetchJson(url);
      if (json && json.status === 'OK') return { ok: true, submissions: json.result };
      return { ok: false, error: json && json.comment };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  // ---------- DOM helpers to find submission id ----------
  function getSubmissionIdFromRow(row) {
    if (row.dataset && row.dataset.submissionId) {
      return String(row.dataset.submissionId);
    }
    const linkSelectors = [
      'a[href*="/submission/"]',
      'a[href*="/contest/"][href*="/submission/"]',
      'a[href*="submission/"]'
    ];
    for (const sel of linkSelectors) {
      const a = row.querySelector(sel);
      if (a && a.getAttribute('href')) {
        const href = a.getAttribute('href');
        let m = href.match(/\/contest\/\d+\/submission\/(\d+)/i);
        if (m) return String(m[1]);
        m = href.match(/\/submission\/(\d+)/i);
        if (m) return String(m[1]);
        m = href.match(/submissionId=(\d+)/i);
        if (m) return String(m[1]);
      }
    }
    try {
      const text = row.textContent || '';
      const match = text.match(/\b\d{5,9}\b/);
      if (match) return String(match[0]);
    } catch (e) { /* ignore */ }
    return null;
  }

  function findProblemLinkInRow(row) {
    const selectors = [
      'a[href*="/contest/"]',
      'a[href*="/problem/"]',
      'a[href*="/problemset/"]',
      'a[href*="/gym/"]'
    ];
    for (const sel of selectors) {
      const el = row.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ---------- timestamp parse fallback ----------
  function parseTimestampFromRow(row) {
    try {
      const timeEl = row.querySelector('td *[title], td time, td .format-time');
      if (timeEl) {
        const title = timeEl.getAttribute('title') || timeEl.getAttribute('datetime') || timeEl.textContent;
        const parsed = Date.parse(title);
        if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
      }
      const tds = Array.from(row.querySelectorAll('td'));
      for (const td of tds) {
        const text = td.textContent.trim();
        if (text.match(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/) || text.match(/\d{1,2}:\d{2}/)) {
          const parsed = Date.parse(text);
          if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ---------- DOM injection ----------
  function removeInjected() {
    document.querySelectorAll(`.${HEADER_CLASS}`).forEach(e => e.remove());
    document.querySelectorAll(`.${GAP_CLASS}`).forEach(e => e.remove());
  }

  function insertHeaderBeforeRow(row, { contestId, contestName, label, metaText }) {
    const tr = document.createElement('tr');
    tr.className = HEADER_CLASS;
    tr.setAttribute('aria-label', `wcwts-header-${contestId || 'practice'}`);

    const td = document.createElement('td');
    td.setAttribute('colspan', DEFAULT_COLSPAN);
    td.style.padding = '0';
    td.style.border = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'wcwts-inner';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '12px';
    wrapper.style.padding = '10px 12px';

    if (contestId && !String(contestId).startsWith('gym-')) {
      const a = document.createElement('a');
      a.className = 'wcwts-contest-link';
      a.href = `https://codeforces.com/contest/${contestId}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = contestName || `Contest ${contestId}`;
      wrapper.appendChild(a);
    } else if (contestId && String(contestId).startsWith('gym-')) {
      const gymId = String(contestId).split('-')[1];
      const a = document.createElement('a');
      a.className = 'wcwts-contest-link';
      a.href = `https://codeforces.com/gym/${gymId}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = contestName || `Gym ${gymId}`;
      wrapper.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.textContent = contestName || 'Practice / Unknown contest';
      wrapper.appendChild(span);
    }

    const badge = document.createElement('span');
    badge.className = 'wcwts-badge';
    const lower = (label || 'Unknown').toLowerCase();
    if (lower.includes('live')) badge.classList.add('wcwts-live');
    else if (lower.includes('virtual')) badge.classList.add('wcwts-virtual');
    else if (lower.includes('practice')) badge.classList.add('wcwts-practice');
    badge.textContent = label || 'Unknown';
    wrapper.appendChild(badge);

    if (metaText) {
      const meta = document.createElement('div');
      meta.className = 'wcwts-meta';
      meta.textContent = metaText;
      wrapper.appendChild(meta);
    }

    td.appendChild(wrapper);
    tr.appendChild(td);

    const gap = document.createElement('tr');
    gap.className = GAP_CLASS;
    const gapTd = document.createElement('td');
    gapTd.setAttribute('colspan', DEFAULT_COLSPAN);
    gapTd.style.background = 'transparent';
    gapTd.style.border = 'none';
    gapTd.style.height = '8px';
    gap.appendChild(gapTd);

    if (row && row.parentNode) {
      row.parentNode.insertBefore(gap, row);
      row.parentNode.insertBefore(tr, row);
    } else {
      const tableBody = document.querySelector('table.status-frame-datatable tbody') || document.querySelector('table.status-frame-datatable') || document.body;
      tableBody.appendChild(gap);
      tableBody.appendChild(tr);
    }
  }

  // ---------- classification rules ----------
  function classifyUsingParticipantType(pt) {
    if (!pt) return null;
    const p = String(pt).toUpperCase();
    if (p === 'CONTESTANT') return 'Live Contest';
    if (p === 'VIRTUAL') return 'Virtual Participation';
    if (p === 'PRACTICE') return 'Practice';
    if (p === 'OUT_OF_COMPETITION') return 'Practice';
    return null;
  }

  function classifyByWindow(contestInfo, timestamp) {
    if (!contestInfo || !contestInfo.startTime || !timestamp) return 'Unknown';
    const start = Number(contestInfo.startTime);
    const dur = Number(contestInfo.durationSeconds || 0);
    const end = start + dur;
    if (timestamp >= start && timestamp <= end) return 'Live Contest';
    return 'Practice';
  }

  // ---------- main grouping routine ----------
  async function groupSubmissions() {
    try {
      const enabled = await new Promise(res => chrome.storage.local.get(['wcwts_enabled'], items => res(typeof items.wcwts_enabled === 'undefined' ? true : Boolean(items.wcwts_enabled))));
      if (!enabled) return;

      const table = await waitForSelector('.status-frame-datatable, table.status-frame-datatable, table.submissions-table', 8000);
      if (!table) {
        console.warn(LOG, 'submissions table not found');
        return;
      }

      removeInjected();
      const rows = Array.from(table.querySelectorAll('tr')).filter(r => r.querySelector('td') && r.querySelector('td a'));
      if (!rows.length) return;

      const handle = getHandleFromUrl();
      let submissions = null;
      if (handle) {
        const resp = await loadUserSubmissions(handle);
        if (resp && resp.ok) submissions = resp.submissions;
        else {
          console.warn(LOG, 'user.status fetch failed:', resp && resp.error);
          submissions = null;
        }
      }
      const submissionMap = {};
      if (submissions && Array.isArray(submissions)) {
        for (const sub of submissions) {
          if (sub && typeof sub.id !== 'undefined') {
            submissionMap[String(sub.id)] = sub;
          }
        }
      }

      const contestMap = await loadContestListMap();

      let lastKey = null;

      for (const row of rows) {
        try {
          const sid = getSubmissionIdFromRow(row);
          const sub = sid && submissionMap ? submissionMap[String(sid)] : null;
          let contestId = null;
          let timestamp = null;
          let participantType = null;
          if (sub) {
            if (sub.problem && typeof sub.problem.contestId !== 'undefined') contestId = String(sub.problem.contestId);
            if (sub.creationTimeSeconds) timestamp = Number(sub.creationTimeSeconds);
            if (sub.author && typeof sub.author.participantType !== 'undefined') participantType = sub.author.participantType;
          }

          if (!contestId) {
            const link = findProblemLinkInRow(row);
            const href = link ? link.getAttribute('href') : null;
            if (href) {
              const m1 = href.match(/\/contest\/(\d+)/i);
              const m2 = href.match(/\/problemset\/problem\/(\d+)/i);
              const m3 = href.match(/\/gym\/(\d+)/i);
              if (m1) contestId = m1[1];
              else if (m2) contestId = m2[1];
              else if (m3) contestId = `gym-${m3[1]}`;
            }
          }
          if (!timestamp) {
            timestamp = parseTimestampFromRow(row);
          }

          const key = contestId ? `c_${contestId}` : `p_${timestamp ? new Date(timestamp * 1000).toISOString().slice(0,10) : 'unknown'}`;

          if (key !== lastKey) {
            let contestInfo = contestId && contestMap && contestMap[contestId] ? contestMap[contestId] : null;

            if (!contestInfo && contestId && !String(contestId).startsWith('gym-')) {
              try {
                const url = `https://codeforces.com/api/contest.standings?contestId=${encodeURIComponent(contestId)}&from=1&count=1`;
                const json = await fetchJson(url);
                if (json && json.status === 'OK' && json.result && json.result.contest) {
                  const c = json.result.contest;
                  contestInfo = { name: c.name || `Contest ${contestId}`, startTime: c.startTimeSeconds || null, durationSeconds: c.durationSeconds || null };
                  contestMap[contestId] = contestInfo;
                  try { await setContestListCached(contestMap); } catch (e) { /* ignore */ }
                }
              } catch (e) {
              }
            }
            let label = 'Unknown';
            if (participantType) {
              const byPt = classifyUsingParticipantType(participantType);
              if (byPt) label = byPt;
            } else if (contestInfo) {
              label = classifyByWindow(contestInfo, timestamp);
            } else {
              label = contestId ? 'Unknown' : 'Practice';
            }

            const contestName = contestInfo ? contestInfo.name : (contestId ? `Contest ${contestId}` : 'Practice');

            let metaText = '';
            if (contestInfo && contestInfo.startTime) {
              try {
                const s = new Date(contestInfo.startTime * 1000);
                metaText = s.toLocaleString();
                if (contestInfo.durationSeconds) {
                  const e = new Date((contestInfo.startTime + contestInfo.durationSeconds) * 1000);
                  metaText += ' — ' + e.toLocaleString();
                }
              } catch (e) { /* ignore */ }
            }

            insertHeaderBeforeRow(row, {
              contestId,
              contestName,
              label,
              metaText
            });

            lastKey = key;
          }
        } catch (rowErr) {
          console.warn(LOG, 'row processing error', rowErr && rowErr.message ? rowErr.message : rowErr);
        }
      }
    } catch (err) {
      console.error(LOG, 'groupSubmissions error:', err && err.message ? err.message : err);
    }
  }

  // ---------- DOM observer ----------
  function observeAndRun() {
    const target = document.body;
    if (!target) return;

    const deb = debounce(() => { groupSubmissions().catch(e => console.warn(LOG, e)); }, 300);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1) {
              if (n.matches && (n.matches('.status-frame-datatable') || n.matches('table.status-frame-datatable') || n.querySelector && n.querySelector('.status-frame-datatable'))) {
                deb();
                return;
              }
            }
          }
        }
      }
    });

    observer.observe(target, { childList: true, subtree: true });

    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        setTimeout(() => groupSubmissions(), 250);
      }
    }, 500);
  }

  (async () => {
    await groupSubmissions();
    observeAndRun();
  })();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'refreshGrouping') {
      groupSubmissions().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
  });

})();

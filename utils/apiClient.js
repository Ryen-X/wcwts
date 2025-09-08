const RATE_LIMIT_MS = 1100; // ~1 request/sec, slightly more than 1s to be safe
let lastRequestTime = 0;

async function rateLimitedFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, RATE_LIMIT_MS - (now - lastRequestTime));
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  lastRequestTime = Date.now();
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }
  return response.json();
}

export async function fetchContestById(contestId) {
  if (!contestId || contestId.startsWith('gym')) {
    return {
        name: `Gym Contest ${contestId.replace('gym-', '')}`,
        startTimeSeconds: null,
        phase: 'FINISHED'
    };
  }
  
  const url = `https://codeforces.com/api/contest.standings?contestId=${contestId}&from=1&count=1`;
  
  try {
    const data = await rateLimitedFetch(url);
    if (data.status !== 'OK') {
      throw new Error(`Codeforces API error: ${data.comment}`);
    }
    return data.result.contest;
  } catch (error) {
    console.error(`WCWTS: Failed to fetch contest data for ID ${contestId}`, error);
    throw error;
  }
}

// fetch-reviews.js
// Scans your Discogs collection for releases you've reviewed
// and writes reviews.json. Run via GitHub Actions.

const fs = require('fs');

const TOKEN = process.env.DISCOGS_TOKEN;
if (!TOKEN) { console.error('DISCOGS_TOKEN not set'); process.exit(1); }

const HEADERS = {
  'Authorization': `Discogs token=${TOKEN}`,
  'User-Agent': 'BVRecsReviewSync/1.0'
};

const DELAY_MS = 1100; // stay well under Discogs 60 req/min rate limit
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function discogsGet(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const r = await fetch(url, { headers: HEADERS });
    if (r.status === 429) {
      console.log(`Rate limited, waiting ${(i + 1) * 3}s…`);
      await sleep((i + 1) * 3000);
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
    return r.json();
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

async function getUsername() {
  const data = await discogsGet('https://api.discogs.com/oauth/identity');
  return data.username;
}

async function fetchAllCollection(username) {
  let page = 1, pages = 1;
  const releases = [];
  do {
    console.log(`Fetching collection page ${page}${pages > 1 ? '/' + pages : ''}…`);
    const data = await discogsGet(
      `https://api.discogs.com/users/${username}/collection/folders/0/releases?per_page=100&page=${page}`
    );
    pages = data.pagination.pages;
    releases.push(...data.releases);
    page++;
    if (page <= pages) await sleep(DELAY_MS);
  } while (page <= pages);
  return releases;
}

async function main() {
  console.log('Starting review sync…');
  const username = await getUsername();
  console.log(`User: ${username}`);

  const releases = await fetchAllCollection(username);
  console.log(`Collection: ${releases.length} releases`);

  const reviews = {};
  let checked = 0;

  for (const r of releases) {
    const releaseId = r.basic_information.id;
    await sleep(DELAY_MS);
    try {
      const data = await discogsGet(`https://api.discogs.com/releases/${releaseId}/reviews`);
      const mine = (data.results || []).find(rev => rev.user?.username === username);
      if (mine?.review_plaintext) {
        reviews[releaseId] = mine.review_plaintext;
        console.log(`  ✓ Review found: ${r.basic_information.title}`);
      }
    } catch (e) {
      console.warn(`  ✗ Skipped ${releaseId}: ${e.message}`);
    }
    checked++;
    if (checked % 10 === 0) console.log(`  Checked ${checked} / ${releases.length}`);
  }

  const output = {
    updated: new Date().toISOString(),
    username,
    reviews
  };

  fs.writeFileSync('reviews.json', JSON.stringify(output, null, 2));
  console.log(`\nDone. Found reviews for ${Object.keys(reviews).length} releases.`);
  console.log('Written to reviews.json');
}

main().catch(e => { console.error(e); process.exit(1); });

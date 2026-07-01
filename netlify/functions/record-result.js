// netlify/functions/record-result.js
//
// Receives a completed quiz attempt from the training page (name, test number,
// score, pass/fail, and the full answer log) and commits it as a JSON file to
// the GitHub repo using the GitHub Contents API.
//
// SECURITY NOTE: This function runs on Netlify's servers, not in the browser.
// The GitHub token below is read from an environment variable that you set in
// the Netlify dashboard (Site settings -> Environment variables). It is never
// sent to, or visible from, the trainee's browser.
//
// REQUIRED Netlify environment variables (set these in the Netlify dashboard):
//   GITHUB_TOKEN   - a GitHub Personal Access Token (fine-grained, scoped to
//                     ONLY this repo, with "Contents: Read and write" permission)
//   GITHUB_REPO    - "owner/repo-name", e.g. "kmcanallyALI/pm-training"
//   GITHUB_BRANCH  - optional, defaults to "main"

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO;
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Server not configured. Set GITHUB_TOKEN and GITHUB_REPO as environment variables in the Netlify dashboard.'
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { name, testNum, score, passed, answers, timestamp } = payload;

  if (!name || !testNum || score === undefined || score === null) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: name, testNum, and score are required.' })
    };
  }

  // Build a safe, collision-resistant file path: one file per attempt, so
  // concurrent submissions from different trainees never conflict with each
  // other (no read-modify-write race condition on a shared log file).
  const safeName = String(name).trim().replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60) || 'unknown';
  const ts = timestamp || new Date().toISOString();
  const tsForFile = ts.replace(/[:.]/g, '-');
  const filePath = `results/test${testNum}/${tsForFile}_${safeName}.json`;

  const record = {
    name: String(name),
    testNum,
    score,
    passed: passed === true || score >= 80,
    timestamp: ts,
    answers: Array.isArray(answers) ? answers : []
  };

  const contentBase64 = Buffer.from(JSON.stringify(record, null, 2), 'utf-8').toString('base64');

  // Encode each path segment separately so slashes in the path stay as
  // directory separators rather than being percent-encoded.
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodedPath}`;

  try {
    const ghResponse = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'pm-training-results-recorder',
        Accept: 'application/vnd.github+json'
      },
      body: JSON.stringify({
        message: `Quiz result: ${record.name} — Test ${testNum} — ${score}% (${record.passed ? 'PASS' : 'FAIL'})`,
        content: contentBase64,
        branch: GITHUB_BRANCH
      })
    });

    const ghData = await ghResponse.json();

    if (!ghResponse.ok) {
      return {
        statusCode: ghResponse.status,
        body: JSON.stringify({ error: 'GitHub API rejected the commit.', details: ghData })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        path: filePath,
        commitSha: ghData.commit ? ghData.commit.sha : null
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to reach the GitHub API.', details: String(err) })
    };
  }
};

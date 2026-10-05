// netlify/functions/send-certificate.js
//
// Runs when a trainee passes all three PM tests. Does two independent things:
//   1. Commits the certificate to the GitHub repo (certificates/<name>_<date>.json + .html)
//   2. Emails the certificate to Kelby via Resend
//
// Both are attempted every time, so a failure in one never blocks the other.
// The GitHub commit is idempotent (same trainee + same day = same file path), so the
// page can safely retry this call after a failure without creating duplicates.
//
// REQUIRED Netlify environment variables:
//   RESEND_API_KEY  - Resend API key (account must be registered to the recipient email)
//   GITHUB_TOKEN    - fine-grained PAT, this repo only, "Contents: Read and write"
//   GITHUB_REPO     - "owner/repo-name", e.g. "kmcanallyALI/PM-Training-Classes"
// OPTIONAL:
//   GITHUB_BRANCH   - defaults to "main"
//   CERT_EMAIL_TO   - defaults to kmcanally@andrewslogistics.com
//   CERT_EMAIL_FROM - defaults to "PM Training Course <onboarding@resend.dev>"

const COURSE_NAME = 'Preventative Maintenance Training';
const PASS_MARK = 80;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const { name, date, timestamp, scores } = payload;
  if (!name || !scores) {
    return json(400, { error: 'Missing required fields: name and scores are required.' });
  }

  const t = [scores.test1, scores.test2, scores.test3];
  if (!t.every((n) => typeof n === 'number' && n >= PASS_MARK)) {
    return json(400, { error: `A certificate requires a ${PASS_MARK}%+ score on all three tests.` });
  }

  const ts = timestamp || new Date().toISOString();
  const dateText = date || new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const finalScore = Math.round((t[0] + t[1] + t[2]) / 3);

  const html = buildCertificateHtml({
    name: escapeHtml(name),
    date: escapeHtml(dateText),
    finalScore,
    test1: scores.test1,
    test2: scores.test2,
    test3: scores.test3
  });

  const record = {
    name: String(name),
    course: COURSE_NAME,
    completed: dateText,
    timestamp: ts,
    scores: { test1: scores.test1, test2: scores.test2, test3: scores.test3 },
    finalScore
  };

  const [gh, mail] = await Promise.allSettled([
    commitCertificateToGitHub(record, html),
    sendCertificateEmail(String(name), html)
  ]);

  const result = {
    github: gh.status === 'fulfilled' ? gh.value : { ok: false, error: String(gh.reason) },
    email: mail.status === 'fulfilled' ? mail.value : { ok: false, error: String(mail.reason) }
  };

  // 200 only when BOTH succeeded, so the page keeps retrying until both have.
  const allOk = result.github.ok && result.email.ok;
  return json(allOk ? 200 : 502, { ok: allOk, ...result });
};

function json(statusCode, obj) {
  return { statusCode, body: JSON.stringify(obj) };
}

async function sendCertificateEmail(name, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set in Netlify.' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.CERT_EMAIL_FROM || 'PM Training Course <onboarding@resend.dev>',
      to: [process.env.CERT_EMAIL_TO || 'kmcanally@andrewslogistics.com'],
      subject: `PM Training Certificate of Completion — ${name}`,
      html
    })
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, id: data.id || null } : { ok: false, status: res.status, details: data };
}

// Writes certificates/<name>_<YYYY-MM-DD>.json and .html. If a file for that trainee and
// day already exists, that counts as success (it is already stored).
async function commitCertificateToGitHub(record, html) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !repo) return { ok: false, error: 'GITHUB_TOKEN and GITHUB_REPO must be set in Netlify.' };

  const safeName = record.name.trim().replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60) || 'unknown';
  const day = record.timestamp.slice(0, 10);
  const base = `certificates/${safeName}_${day}`;

  const files = [
    { path: `${base}.json`, content: JSON.stringify(record, null, 2) },
    { path: `${base}.html`, content: html }
  ];

  const out = [];
  for (const f of files) {
    const url = `https://api.github.com/repos/${repo}/contents/${f.path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'pm-training-certificate-recorder',
        Accept: 'application/vnd.github+json'
      },
      body: JSON.stringify({
        message: `Certificate: ${record.name} — ${record.course} — ${record.finalScore}%`,
        content: Buffer.from(f.content, 'utf-8').toString('base64'),
        branch
      })
    });
    if (res.ok) {
      out.push({ path: f.path, stored: true, alreadyExisted: false });
      continue;
    }
    const body = await res.json().catch(() => ({}));
    // GitHub answers 422 "sha wasn't supplied" when the file already exists at this path,
    // which means it is already stored. Any other 422 (e.g. bad branch) is a real error.
    if (res.status === 422 && /sha/i.test(String(body.message || ''))) {
      out.push({ path: f.path, stored: true, alreadyExisted: true });
    } else {
      return { ok: false, status: res.status, path: f.path, details: body };
    }
  }
  return { ok: true, files: out };
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function resultRow(label, score) {
  const passed = score !== undefined && score !== null && score >= 80;
  const scoreText = (score === undefined || score === null) ? 'N/A' : `${score}%`;
  const resultText = passed ? 'Passed' : 'Not Passed';
  const resultColor = passed ? '#1a7a3c' : '#b3261e';
  return `
    <tr>
      <td style="padding:10px 14px;border:1px solid #444;color:#fff;">${label}</td>
      <td style="padding:10px 14px;border:1px solid #444;color:#fff;">${scoreText}</td>
      <td style="padding:10px 14px;border:1px solid #444;color:${resultColor};font-weight:bold;">${resultText}</td>
    </tr>`;
}

// Inline-styled HTML email — deliberately avoids the ::before/::after double-border
// trick and CSS custom properties used on the page's certificate, since most email
// clients strip <style> blocks and don't support CSS variables or pseudo-elements.
function buildCertificateHtml({ name, date, finalScore, test1, test2, test3 }) {
  return `
<div style="background:#111318;padding:32px 12px;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:0 auto;background:#1b1e26;border-radius:10px;overflow:hidden;border:1px solid #2c2f3a;">
    <div style="background:#3d4c73;padding:22px 28px;">
      <div style="color:#fff;font-size:22px;font-weight:bold;font-family:Arial,sans-serif;">Preventative Maintenance Training</div>
      <div style="color:#dbe2f5;font-size:14px;font-family:Arial,sans-serif;margin-top:4px;">Certificate of Completion</div>
    </div>
    <div style="padding:28px;">
      <p style="color:#ccc;font-size:14px;font-family:Arial,sans-serif;margin:0 0 6px;">This certifies that</p>
      <div style="font-size:26px;font-weight:bold;color:#7ea3f7;border-bottom:2px solid #d99a2b;display:inline-block;padding-bottom:6px;margin:6px 0 18px;font-family:Arial,sans-serif;">${name}</div>
      <p style="color:#eee;font-size:14px;font-family:Arial,sans-serif;margin:0 0 4px;">has successfully completed the course with a final score of <strong>${finalScore}%</strong>.</p>
      <p style="color:#999;font-size:13px;font-family:Arial,sans-serif;margin:0 0 20px;">Completed: ${date}</p>
      <p style="color:#fff;font-size:15px;font-weight:bold;font-family:Arial,sans-serif;margin:0 0 10px;">Section-by-section results</p>
      <table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;margin-bottom:20px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px 14px;border:1px solid #444;background:#555;color:#fff;">Section</th>
            <th style="text-align:left;padding:10px 14px;border:1px solid #444;background:#555;color:#fff;">Score</th>
            <th style="text-align:left;padding:10px 14px;border:1px solid #444;background:#555;color:#fff;">Result</th>
          </tr>
        </thead>
        <tbody>
          ${resultRow('Test 1 — Regulatory Foundations & Fleetrock', test1)}
          ${resultRow('Test 2 — Safety Items', test2)}
          ${resultRow('Test 3 — Tanker Systems', test3)}
        </tbody>
      </table>
      <p style="color:#999;font-size:12px;font-family:Arial,sans-serif;margin:0;">Andrews Logistics LP — Preventive Maintenance Training</p>
    </div>
  </div>
</div>`;
}

// netlify/functions/send-certificate.js
//
// Sends a "Certificate of Completion" email to Kelby via Resend, automatically
// triggered by the training page the moment a trainee passes all three tests.
//
// REQUIRED Netlify environment variable:
//   RESEND_API_KEY  - your Resend API key (Site settings -> Environment variables)
//
// The email is sent from Resend's shared sandbox address (onboarding@resend.dev),
// which requires no domain verification but can only deliver to the email address
// on the Resend account itself — which is fine here since the only recipient is
// Kelby's own address.

const RECIPIENT_EMAIL = "kmcanally@andrewslogistics.com";

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server not configured. Set RESEND_API_KEY as an environment variable in the Netlify dashboard.' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { name, date, scores } = payload;
  if (!name || !scores) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: name and scores are required.' }) };
  }

  const safeName = escapeHtml(name);
  const safeDate = escapeHtml(date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  const finalScore = Math.round(((scores.test1 || 0) + (scores.test2 || 0) + (scores.test3 || 0)) / 3);

  const html = buildCertificateHtml({
    name: safeName,
    date: safeDate,
    finalScore,
    test1: scores.test1,
    test2: scores.test2,
    test3: scores.test3
  });

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'PM Training Course <onboarding@resend.dev>',
        to: [RECIPIENT_EMAIL],
        subject: `PM Training Certificate of Completion — ${name}`,
        html
      })
    });

    const data = await res.json();

    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: 'Resend API rejected the email.', details: data }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, id: data.id || null }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to reach the Resend API.', details: String(err) }) };
  }
};

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

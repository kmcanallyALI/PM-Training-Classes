# PM Training — Certificate setup

When a trainee passes all three tests (80%+ each), the page calls
`netlify/functions/send-certificate.js`, which does two things independently:

1. **GitHub** — commits `certificates/<Name>_<YYYY-MM-DD>.json` and `.html` to this repo
2. **Email** — sends the certificate to kmcanally@andrewslogistics.com via Resend

If either one fails, the page retries on the trainee's next quiz submit until both succeed.
The GitHub commit is idempotent (same trainee + same day = same file), so retries never duplicate.

## Netlify environment variables (Site settings -> Environment variables)

| Variable | Required | Value |
|---|---|---|
| `RESEND_API_KEY` | Yes | Resend API key. The Resend account must be registered to the recipient email (unverified-domain limit). |
| `GITHUB_TOKEN` | Yes | Fine-grained PAT, this repo only, Contents: Read and write. (Same one record-result.js uses.) |
| `GITHUB_REPO` | Yes | `kmcanallyALI/PM-Training-Classes` |
| `GITHUB_BRANCH` | No | Defaults to `main`. Set to the branch Netlify deploys from if different. |
| `CERT_EMAIL_TO` | No | Defaults to kmcanally@andrewslogistics.com |
| `CERT_EMAIL_FROM` | No | Defaults to `PM Training Course <onboarding@resend.dev>` |

After adding variables, trigger a new deploy so the functions pick them up.

## Checking it works
Pass all three tests with a test name, then look for (a) the email and (b) a new file
under `certificates/` in the repo. A failure shows in the browser console and in
Netlify -> Functions -> send-certificate -> logs.

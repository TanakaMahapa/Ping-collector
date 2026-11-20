# ping-collector
Collects jobs from public sources every 5 minutes and saves them to the Ping database (Supabase). Public on purpose: GitHub Actions is free and unlimited for public repos. It contains no secrets; keys live in GitHub Secrets.

## Setup
1. Add three repository secrets (Settings, Secrets and variables, Actions): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the **secret** key, `sb_secret_...`), `PING_USER_AGENT` (e.g. `PingJobs/0.1 (contact: you@example.com)`). Optional keys that switch on more sources: `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` (developer.adzuna.com), `JOOBLE_API_KEY` (free, jooble.org/api/about), `RAPIDAPI_KEY` (one RapidAPI key for JSearch and Techmap; subscribe to each API on RapidAPI. Both free plans are small monthly caps, so each runs once a day).
2. Actions, **import-companies**, Run workflow. Open the log: the first lines say whether the database and key are right; then a tick or cross per company.
3. Actions, **poll-jobs**, Run workflow, type `1` in `force`. Then check the `jobs` table in Supabase.
4. It now runs by itself every 5 minutes. To add companies, append lines to `data/companies.csv` and run import-companies again.

## Sources
No key needed: Greenhouse, Lever, Ashby, Workable (employer job boards, direct apply links), Remotive, Arbeitnow, Jobicy, RemoteOK. Key needed: Adzuna, Jooble, JSearch. A source with no key stays off. Every job shows where it came from.

## Sources left out on purpose
Himalayas (its terms forbid redistributing jobs to job boards and aggregators), LinkedIn, Indeed, Glassdoor, PNet and CareerJunction (no scraping). Remotive is polled at most 4 times a day, as it asks, and shown with a link back. Careerjet runs live in the website, not in the collector (its terms need the real visitor's IP on every call). Not used.

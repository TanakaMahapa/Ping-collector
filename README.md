# ping-collector
Collects jobs from public sources every 5 minutes and saves them to the Ping database (Supabase). Public on purpose: GitHub Actions is free and unlimited for public repos. It contains no secrets; keys live in GitHub Secrets.

## Setup
1. Add three repository secrets (Settings, Secrets and variables, Actions): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the **secret** key, `sb_secret_...`), `PING_USER_AGENT` (e.g. `PingJobs/0.1 (contact: you@example.com)`). Optional: `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`.
2. Actions, **import-companies**, Run workflow. Open the log: the first lines say whether the database and key are right; then a tick or cross per company.
3. Actions, **poll-jobs**, Run workflow, type `1` in `force`. Then check the `jobs` table in Supabase.
4. It now runs by itself every 5 minutes. To add companies, append lines to `data/companies.csv` and run import-companies again.

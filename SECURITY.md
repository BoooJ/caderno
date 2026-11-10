# Security and privacy

## Publication review — 2026-11-10

The published Git history was scanned with Gitleaks 8.30.1 and targeted checks for private configuration, credentials, personal database files and local machine paths. No actual credentials were detected. A scanner false positive was manually verified as the public localStorage key `caderno-entries-v1`; the scanner configuration excludes only that exact value.

Repository screenshots contain no notebook data or PNG text/EXIF metadata. Commits use a GitHub noreply email address. Tests contain synthetic credentials that are not production credentials.

At review time, `npm audit --omit=dev` reported zero known vulnerabilities. Six findings remain in transitive development/build dependencies, as recorded in the release verification notes. Scans cannot prove the absence of all vulnerabilities.

## Tested controls

`npm test` includes security regression tests for anonymous and forged-session access, production cookie flags, hashed session storage, expired sessions, logout invalidation, origin checks, login rate limits and browser protection headers. The review completed with 15 unit/API/security tests passing.

Production deployments must use HTTPS and a unique, strong password. Keep the legacy short-password override disabled. Development mode is intentionally unauthenticated and must remain local.

## Data flows and limitations

- Notebook entries, custom verbs, translation caches and session hashes are stored in SQLite on the host.
- The browser retains notebook and verb copies for offline reading. Explicit logout clears those copies; server-side expiry cannot remotely erase data on an offline device. Avoid shared devices for private notes.
- Translation input is transmitted to MyMemory. Example searches are transmitted to Tatoeba; synonym and conjugation searches contact their respective providers. Do not treat text submitted to these features as confidential to this application alone.
- There is no application-level encryption of notebook storage. Host permissions, device security and backups remain important.
- Login throttling is instance-wide and stored in memory. It limits guessing but can also temporarily block the owner after repeated failures, and resets on restart.
- The single-user design is not a multi-tenant access-control system.

Do not include passwords, tokens, private notebook exports or server credentials in public issues or screenshots.

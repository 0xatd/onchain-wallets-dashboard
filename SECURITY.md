# Security policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security bugs.**

Email the maintainer (see repo metadata) or open a private security advisory on GitHub. We'll acknowledge within 5 business days.

## What's in scope

- Auth bypasses (escaping a user's data to access another user's)
- Server-side input validation issues (SQL injection, command injection)
- Missing access control on any `/api/*` endpoint
- Cost-basis calculation bugs that could mis-state taxes
- Anything in the proposal/audit workflow that allows mutation without an audit trail

## What's out of scope

- Issues that require a malicious self-hoster to attack themselves
- Missing security headers on a self-hosted instance you control
- Vulnerabilities in dependencies that we've already pinned to a fixed version

## Token storage

Agent API tokens (`octt_*`) are stored as **SHA-256 hashes**. The plain token is shown to you exactly once at creation time. If you lose it, revoke and re-issue.

## Data privacy

This is a self-hosted tool. Your data lives in your Postgres instance. We do not collect telemetry. There is no upstream service.

If you choose to use Firebase auth and Alchemy for syncing, those services see what they see — review their privacy policies. Local-auth + Etherscan-fallback (planned) is the path for the maximally paranoid.

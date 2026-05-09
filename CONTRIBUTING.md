# Contributing

Thanks for thinking about contributing. This is a small project; PRs of any size are welcome — typo fixes, importers, accounting methods, tests.

## Setup

```bash
npm install
cp .env.example .env
# edit DATABASE_URL — local-auth mode is fine, no Firebase needed
npm run db:push
npm run dev
```

## Where to start

Look at the "Planned" list in [README.md](README.md). The biggest impact items right now:

1. **CSV importers** for centralized exchanges. New file under `server/services/importers/<exchange>.ts`. Map to the existing `transactions` schema.
2. **Lot-matching algorithms** beyond FIFO. The schema supports `lifo`, `hifo`, `specific_id`. Add the matcher in `server/services/lotMatcher.ts`.
3. **Tests** with Vitest. Especially around lot matching, disposal gain/loss calc, and the proposal applier.
4. **Etherscan fallback** for when `ALCHEMY_API_KEY` is unset.

## Style

- TypeScript everywhere. `npm run check` must pass.
- Schema changes go in `shared/schema.ts`. Run `npm run db:push` to apply locally.
- Server routes that mutate state should go through the proposal workflow (`POST /api/agent/propose`) — keep direct mutations limited to user-initiated UI actions and the proposal applier.
- Every state change written by the proposal applier must call `storage.appendAudit(...)`.
- Don't commit secrets. The repo's `.gitignore` covers `.env`, but double-check.

## PR flow

1. Fork, branch, code.
2. Run `npm run check` and (if you've added them) tests.
3. Open a PR. Describe what changed and why. Screenshots help for UI changes.
4. We squash-merge.

## Reporting bugs

Use GitHub issues. Include: what you expected, what happened, repro steps, environment (Node version, Postgres version, browser).

## Security

Don't open a public issue for security bugs. See [SECURITY.md](SECURITY.md).

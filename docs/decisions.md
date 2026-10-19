# claude-default — decisions

<!-- Profile: standard. Rules: https://github.com/xhevops-homelab/homelab-setup/tree/main/alm -->
<!-- Dated, newest first, append-only. Older architectural decisions live in CLAUDE.md and are not back-filled here. -->

## 2026-10-04 — Adopt the standard ALM profile, with the PR-only rule kept as an override

**Why:** this was the one live project without a ledger; its 475-line `CLAUDE.md` holds the architecture but not the roadmap or the record of decisions. `standard` fits a personal project; the existing repo rule that `main` only moves by PR with green CI is kept as an override because it protects the live site.

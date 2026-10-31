# Handoff: review remediation for v0.3.0

Date: 2026-10-31
Branch: `claude/review-remediation-20261031` (created from `main` at `c852506`; changes are **not committed**)
Change record: `.ishiku/decisions/review-remediation-20261031.json`
Decisions: `DEC-003` (`vault-v3-key-wrapping.json`), `DEC-004` (`legacy-removal-and-data-safety.json`), updated `OVR-001`

## Status

`IMPLEMENTED_BUT_NOT_VERIFIED` in CI. All local checks passed (see the change record). GitHub Actions has not run on these changes yet; publishing and the release are still to do.

## What was done

| Area | Change | Files |
| --- | --- | --- |
| Crypto | Vault format v3: a random data key wrapped with PBKDF2-SHA-256 (600k iterations); authenticated headers. v2 tokens are still readable and are re-sealed on unlock. | `js/crypto.js` |
| PIN | The blob wraps the data key and write secret, not the master password. Legacy blobs (`dv2.pinWrappedPassword`) keep working and are re-wrapped into `meiku.pin`. A stale-key check was added. The PIN pad accepts keyboard input. | `js/auth.js`, `js/app.js` |
| Passwords | At least 12 characters and a confirmation field for new passwords. Setup and password change only switch state after the server accepted the save. | `index.html`, `js/app.js` |
| Data safety | `revision` field, `expectedRevision` → HTTP 409 on mismatch, `null` = create only. Last 10 tokens in `<data>/history/`. Import needs confirmation. | `server.py`, `js/store.js`, `js/app.js` |
| Privacy | The avatar now lives inside the encrypted vault (`av`); the legacy `dv2.avatar` is migrated, then removed. The login display name stays local and is cleared by Sign Out. | `js/app.js` |
| QR | GiroCode follows EPC069-12 (remittance in field 11, length limits, IBAN mod-97, BIC check, empty state). vCard: `N`, 7-part `ADR`, escaping, CRLF. Amount parser handles `1.234,56`. | `js/qr.js` |
| Server | Static file whitelist; `/readyz` returns 503 when data is not writable; rate limiter with bounded memory plus `MEIKU_TRUST_PROXY`; streaming file responses. | `server.py` |
| Legacy removal | `save.php`, `data.json`, `/data.json`, `/save.php`, `DV2_*`, `DATELLO_DATA_PATH` and the `?v=` cache busting are gone. Old `DV2_*` values that equal the defaults are only warned about (ZimaOS keeps old env entries). | many |
| Container | App files are owned by root; the runtime user is `meiku`; `chown` only runs when needed; running as root is refused; `pull_policy` removed; secret only as `ISHIKU_SETUP_SECRET`. | `Dockerfile`, `docker-entrypoint.sh`, compose files |
| CI | `publish-ghcr.yml` pushes `sha-<full sha>`, scans that digest for amd64 and arm64, attests it, and only then promotes `latest`. | `.github/workflows/publish-ghcr.yml` |
| Tests | New `tests/test-qr.mjs` and `tests/test_compose.py`; extended server/crypto/auth/store tests; optional Playwright test `tests/e2e/migration.e2e.mjs`. The verification command in `.ishiku/project.yaml` was extended. | `tests/` |
| Docs | README (variables, endpoints, upgrade, restore, rollback), CHECKLIST, AppSpec (`DATA-001`, `QR-001`, new AUTH/OPS acceptance), traceability. | |

## What Codex must do

1. **Review and commit** the working tree on `claude/review-remediation-20261031`. Suggested commit title: `feat: vault v3 key wrapping, conflict-safe storage and QR fixes (v0.3.0)`. Open the PR and let `ishiku verify` run.
2. **Check the first `publish-ghcr.yml` run on `main`.** The Trivy steps rely on the `TRIVY_PLATFORM` environment variable to pick the platform out of the multi-arch digest. If Trivy ignores it, pass `--platform` through the action's `trivy-config` or call trivy directly. The old workflow produced short `sha-<7>` tags; the new one produces `sha-<40>` tags.
3. **Release `v0.3.0`.** This is a new minor version because of the vault format. Tag it and let `ishiku-release-release.yml` publish it. In a follow-up PR, pin the new digest (as in #25) in:
   - `docker-compose.yml`
   - `Meiku - Profile Share.yaml` (`tests/test_compose.py` checks that both match)
   - `app.manifest.json` → `readme_profile.docker_image`
   - Then update `.ishiku/reports/ops-001-verification.json` with the new image and runtime evidence.
   - This also delivers the Python 3.14 and libuuid fix from #26 that is still missing in v0.2.8.
4. **Kit fixes (cross-app, outside this repo).** `.github/workflows/ishiku-pull-request-verify.yml` and `ishiku-release-release.yml` are kit-managed (checksum in `.ishiku/kit-manifest.json`), so they were **not** edited here. Change them in the central workspace kit and run `sync-kit`:
   - **Verify gate:** on `pull_request`/`push`, `inputs.require_all_verified` is empty, so the job runs with `--allow-unverified-requirements`. Use `${{ inputs.require_all_verified != false }}`.
   - **Release scan:** the scan builds amd64 only and the published multi-arch image is a separate build. Apply the same push → scan digest per platform → promote pattern as in `publish-ghcr.yml`.
5. **Git housekeeping.** Ask the owner first; this was not done:
   - Delete merged local branches: `codex/finalize-v0.2.7`, `codex/fix-v0.2.6-publish`, `codex/pin-v0.2.7-delivery`, `codex/release-v0.2.6`, `codex/remediate-container-cves`, `codex/standardize-readmes-compose`, `codex/dependency-maintenance-20261011` (still checked out in a worktree under `Meiku/repository/.git/maintenance-20261011`).
   - Many `origin/codex/*` branches, including ones from other apps (`datello-*`, `sharely-*`).
   - Dependabot branches for actions and the base image that #26 already superseded.

## Known open items (not done on purpose)

- `js/app.js` is still one large module with `innerHTML` templates. Splitting it into views is refactoring only and has no functional benefit right now.
- `design-system/base.css`, `components.css`, `app-shell.js` and `setup-flow.js` are shipped but not loaded (only `tokens.css` is); `css/meiku.css` implements the UI. They are bound by `.ishiku/design-system.lock`, so they were kept. Aligning them is a design-system task.
- `apk upgrade` in the Dockerfile keeps builds from being bit-reproducible. It stays as a deliberate security trade-off.
- The Playwright e2e test is not in CI (it needs browsers and a running server). Adding it would mean a dev-dependency decision.
- `OVR-001` review date stays `2027-02-21`.

## Local verification evidence (2026-10-31)

- `python -m unittest discover -s tests`: 47 tests OK.
- `node tests/test-{crypto,store,auth,qr}.mjs`: all passed.
- `node --check` on all JS; `sh -n docker-entrypoint.sh`.
- `actionlint`, `docker compose config` and the ishiku compliance test passed.
- `docker build` passed. A Compose runtime test with a named volume passed (rootless Podman with SELinux blocks bind mounts from the scratch directory; that is an environment limit, not an app issue).
- The Playwright migration test against the container passed.
- `node .ishiku/kit/scripts/verify-app . --full`: see `.ishiku/reports/verification-full.json` (not committed, git-ignored).

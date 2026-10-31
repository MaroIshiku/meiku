# Handoff: review remediation for v0.3.0

Date: 2026-10-31
Branch: `claude/review-remediation-20261031` (created from `main` at `c852506`; changes are **not committed**)
Change record: `.ishiku/decisions/review-remediation-20261031.json`
Decisions: `DEC-003` (`vault-v3-key-wrapping.json`), `DEC-004` (`legacy-removal-and-data-safety.json`), updated `OVR-001`

## Status

Merged as #27 (`d0a3d12`). The follow-up work was done on 2026-10-31 by Claude Code, not Codex; see "Follow-up status" below.

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

## Follow-up status (2026-10-31)

1. **Done.** Committed, PR #27 opened, CI `ishiku verify` passed, squash-merged as `d0a3d12`.
2. **Done.** The first `publish-ghcr.yml` run on `main` passed (run 41240273548). Local `trivy` against the pushed digest `sha256:18c7e93d…` confirmed that `TRIVY_PLATFORM` selects the platform: amd64 and arm64 each have 0 HIGH/CRITICAL. Tags are now `sha-<40>`.
3. **Done.** `v0.3.0` was released by `ishiku-release-release.yml` (run 41240868393) as `ghcr.io/maroishiku/meiku:v0.3.0@sha256:cda86bb824761565306d545a6093da5747544962e998b1b7d470c1673a5a9561` (amd64 + arm64, per-platform Trivy gate, SBOM attached). The rollback text in the release notes was corrected to point at v0.2.8 plus the v2-token restore. The published image passed the Compose runtime test and `tests/e2e/migration.e2e.mjs`. The digest is pinned in `docker-compose.yml`, `Meiku - Profile Share.yaml`, `app.manifest.json` and `.ishiku/reports/ops-001-verification.json`.
4. **Kit (central `.ishiku/`, not a Git repository).**
   - Changed: `workflows/pull-request/verify.yml` (strict by default via `format('{0}', inputs.require_all_verified)`; the old `github.event_name == 'workflow_call'` check was always false inside reusable workflows; action pins updated to the #26 releases), `workflows/release/release.yml` (pins updated; Trivy scans the pushed digest per platform before promotion) and `scripts/ishiku.mjs` (honours `--allow-unverified-requirements`, as the app copies already did).
   - Originals are backed up in `.ishiku/reports/kit-backup-20261031/`.
   - Distributed **only to meiku**, by copying the two workflow files and updating `kit-manifest.json` and `kit-version.lock`. A full `sync-kit` was deliberately not run: the central policies, schemas and scripts differ from the app copies at the same version 1.2.1, and `schemas/` contains a sync-conflict copy (`project.schema-Marlo_Desktop.json`) that would be copied into every app.
   - Each other app has its own customised "managed" release workflow (8 variants; some with extra release workflows such as `playiku-promote-release.yml` and `vertiku-publish-appliance-tag.yml`). Rolling the central version out to them changes their release behaviour and needs a per-app review.
   - The new release workflow has no `workflow_dispatch` re-publish input any more (the central version is tag-driven) and creates the GitHub release with the SBOM attached.
5. **Done.** Deleted 8 merged local branches and the extra worktree `maintenance-20261011`. Deleted 14 merged remote branches. Closed Dependabot PRs #11–#16 as superseded by #26 (their branches were deleted too). Only `main` remains on GitHub.

## Known open items (not done on purpose)

- `js/app.js` is still one large module with `innerHTML` templates. Splitting it into views is refactoring only and has no functional benefit right now.
- `design-system/base.css`, `components.css`, `app-shell.js` and `setup-flow.js` are shipped but not loaded (only `tokens.css` is); `css/meiku.css` implements the UI. They are bound by `.ishiku/design-system.lock`, so they were kept. Aligning them is a design-system task.
- `apk upgrade` in the Dockerfile keeps builds from being bit-reproducible. It stays as a deliberate security trade-off.
- The Playwright e2e test is not in CI (it needs browsers and a running server). Adding it would mean a dev-dependency decision.
- `OVR-001` review date stays `2027-02-21`.
- Fixed in v0.4.1: release images used to show `local` under Settings → About, because the kit release workflow passes `VERSION`, `BUILD_DATE` and `GIT_SHA` as build arguments and the Dockerfile ignored them. The Dockerfile now writes `build-info.json` from these arguments. `publish-ghcr.yml` passes them too, and `tests/test_compose.py` checks that every passed argument is declared.
- The other 7 clean apps (dropiku, nestiku, pingiku, playiku, pulliku, ryoiku, vertiku) still have the relaxed verify gate. Roll out the central fix per app after reviewing each app's customised release workflow.

## Local verification evidence (2026-10-31)

- `python -m unittest discover -s tests`: 47 tests OK.
- `node tests/test-{crypto,store,auth,qr}.mjs`: all passed.
- `node --check` on all JS; `sh -n docker-entrypoint.sh`.
- `actionlint`, `docker compose config` and the ishiku compliance test passed.
- `docker build` passed. A Compose runtime test with a named volume passed (rootless Podman with SELinux blocks bind mounts from the scratch directory; that is an environment limit, not an app issue).
- The Playwright migration test against the container passed.
- `node .ishiku/kit/scripts/verify-app . --full`: see `.ishiku/reports/verification-full.json` (not committed, git-ignored).

## Mobile UI redesign (DEC-005, 2026-10-31)

Branch `claude/mobile-ui-redesign`. Phone-only, QR-first UI on the shared design-system components; see `.ishiku/decisions/mobile-ui-redesign.json`.

- Done: the first-visit reload bug (service worker `controllerchange` reload) is gone; share cards with large scan-first QR codes, swiping, fullscreen view, `.vcf` sharing and copy buttons; PIN-first unlock with inline errors; settings reorganised by the meiku-client-vault profile; simpler step editor; inline server-secret field in forms that save; `app.js` split into modules; `css/meiku.css` now builds on `design-system/components.css`.
- Unchanged: vault format, crypto, PIN blob format, API, storage keys for vault data and all migrations from v0.3.0.
- Not done: no desktop layout (not planned). Real-device checks of QR scanning on iOS Safari and Android Chrome are still open; Playwright covers layout and flows only.
- Released as `v0.4.0` (run 41243530615): `ghcr.io/maroishiku/meiku:v0.4.0@sha256:433c30fc89691cd16343f955eed038ebed974df014a3b8cfd5dcccc1b5b3ddb7`. Trivy reports 0 HIGH/CRITICAL for amd64 and arm64. The published image passed the Compose runtime test with v0.2.8 data and `tests/e2e/migration.e2e.mjs`. The release notes were corrected to roll back to v0.3.0 (no data migration between the two). The digest is pinned in both Compose files and `app.manifest.json`.

## v0.4.1 (2026-11-01, branch `claude/build-info`, PR #32)

See `.ishiku/decisions/release-v0.4.1.json`. Contains: fluid QR codes, the start-up guard against blank screens (with "Repair app"), real build information under About, SIGTERM handling (Compose files drop `init: true`), quieter logs and `DV2_SHARED_SECRET` as a deprecated fallback.

Field finding on the owner's ZimaOS: the stored app configuration had a memory reservation (256 MB) above the limit (128 MB), so Docker rejected the recreated container. The data volume there is `/media/ZimaOS-HD/AppData/i_meiku/data`, not `/DATA/AppData/meiku/data`. Both are documented in the README under "Updating on ZimaOS".

Still open: verify on an iPhone (WebKit could not run locally); if a blank screen remains, the error card now shows the cause.

Released as `v0.4.1` (run 41250022434): `ghcr.io/maroishiku/meiku:v0.4.1@sha256:70e177ac05b286d567b1d05790890e6a19287aadf7bc5a1d14d86d75362e364a`.
- Trivy scanned from the registry (`--image-src remote`; a locally pulled copy otherwise hides the arm64 variant): linux/amd64 and linux/arm64, 0 HIGH/CRITICAL.
- The image carries real build information (version 0.4.1, commit `46ee2ed`).
- The published image passed the Compose runtime test with v0.2.8 data, `tests/e2e/migration.e2e.mjs` and `tests/e2e/qr-scan.e2e.mjs` (48/48), and stopped in 0.7 s.
- The release notes were corrected to roll back to v0.4.0.

## v0.4.2 (2026-11-01, branch `claude/versioned-assets`)

Fixes the phone PWA error "The requested module './crypto.js' does not provide an export named 'VAULT_VERSION'": a stale cache mixed a v0.2.x `crypto.js` with new modules. All asset URLs now carry the release version; see `.ishiku/decisions/release-v0.4.2.json`.

**Release step from now on:** `node scripts/stamp-version.mjs X.Y.Z`, commit, then tag `vX.Y.Z`. `tests/test-assets.mjs` fails the CI if a URL is missing the version.

Released as `v0.4.2` (run 41251628114): `ghcr.io/maroishiku/meiku:v0.4.2@sha256:1497fc4282d56580c9c9ea65e1516361bf63b7d4927810ba62b9b2cc1a4e205b`.
- Trivy (from the registry): linux/amd64 and linux/arm64, 0 HIGH/CRITICAL.
- The published image passed the Compose runtime test, `tests/e2e/migration.e2e.mjs`, `tests/e2e/qr-scan.e2e.mjs` (48/48) and the stale-`crypto.js` scenario; versioned files are served as immutable.
- The release notes were corrected to roll back to v0.4.1.

## v0.4.3 (2026-11-01, branch `claude/no-animations`)

Owner request: switching cards must not animate, and every card starts at the top (no remembered scroll position). The other animations stay. Changed `js/cards.js` only (plus the version stamp); covered by `tests/e2e/cards.e2e.mjs`.

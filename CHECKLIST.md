# Acceptance Check

Date: 2026-10-31 (updated for v0.3.0)

## Architecture

- The Python server serves the Meiku PWA and stores only the encrypted token.
- Client-side encryption stays entirely in the browser.
- Dockerfile, environment-aware `docker-compose.yml`, and direct-import `Meiku - Profile Share.yaml` are available for ZimaOS/reverse-proxy operation.
- The ZimaOS direct-import Compose uses port `65003` and the immutable GHCR release as direct scalars without interpolation; `tests/test_compose.py` keeps it aligned with `docker-compose.yml`. Both pin `ghcr.io/maroishiku/meiku:v0.4.1@sha256:70e177ac05b286d567b1d05790890e6a19287aadf7bc5a1d14d86d75362e364a`.
- Persistence uses the bind mount `/DATA/AppData/meiku/data:/data`.
- `x-casaos` metadata is available for ZimaOS/CasaOS app import.
- AppMark, favicon and PWA icons are direct exports from the canonical Meiku icon source.

## Design System

- The active interface implements the central `ishiku-design-5` contract through local `design-system/` tokens and components.
- `.ishiku/design-system.lock` binds the implementation to the single workspace contract without copying the full specification.
- `app.manifest.json` contains Meiku identity and behavior metadata only; it does not define a separate design language.
- The app name is `Meiku - Profile Share`.
- The header uses the shared AppLogo/AppName/AppSubtitle pattern with a settings button on the right (meiku-client-vault profile).
- The UI is built on `design-system/components.css`; `css/meiku.css` only adds Meiku-specific parts.
- Meiku targets phones only (320–460 px); wider screens keep the centred mobile column.
- Theme attributes live on `document.documentElement`: `data-theme`, `data-mode`, `data-resolved-mode`.
- Theme and mode persistence uses `meiku-theme` and `meiku-mode`.
- Six themes are available: Lavender, Mint, Sky, Amber, Rose, Graphite.
- Modes are available: System, Light, Dark.
- Technical build information appears only under Settings → About.
- Sheets trap focus, close with Escape and return focus; the fullscreen QR view does the same.

## Security

- `POST /api/token` requires `X-Auth-Token`; the legacy `/save.php` and `/data.json` endpoints are removed.
- Without `ISHIKU_SETUP_SECRET` or `ISHIKU_SETUP_SECRET_FILE`, the container does not start. Leftover `DV2_*` variables with non-default values stop startup with a rename hint.
- The server prefers `ISHIKU_SETUP_SECRET_FILE`, then `/run/secrets/ishiku_setup_secret`, then `ISHIKU_SETUP_SECRET`.
- Writes carry a revision; a stale `expectedRevision` is rejected with HTTP 409 and the last 10 tokens are kept in `/data/history/`.
- Only PWA files are served statically (whitelist).
- Failed-write rate limiting has bounded memory and can use the forwarded client address behind one trusted proxy (`MEIKU_TRUST_PROXY`).
- `/readyz` returns 503 when data is not writable.
- Token writes are atomic and limited to a 1 MB request size.
- Tokens are checked for minimum length and allowed characters.
- The server sets basic security headers.
- The service worker does not cache token endpoints or build information.
- The container runs as a non-root user; application files are owned by root and read-only for the runtime user.
- The container runs read-only with a `/data` bind mount and `/tmp` tmpfs; the entrypoint fixes the data folder owner and then drops to UID/GID `10001:10001`.
- Capabilities are dropped and `no-new-privileges` is set.
- Resource limits for CPU, RAM and processes are set.
- Log rotation is set so ZimaOS storage is not filled by logs.

## Features

- Setup saves encrypted data through the Python API.
- First run asks for full name, master password and server secret.
- After first run, the step-by-step profile editor opens.
- Private and business address are separate fields.
- Login with master password remains available.
- Vault format v3: random data key wrapped with PBKDF2-SHA-256 (600,000 iterations); headers are authenticated. v2 vaults open with the existing password and are re-sealed automatically.
- New or changed master passwords need at least 12 characters and a matching confirmation; the vault is only switched after the server accepted the new token.
- New PINs use exactly six digits and wrap the vault data key plus write secret (never the master password) with one million PBKDF2 iterations plus AES-GCM. Legacy PIN blobs keep working and are replaced after unlock. The PIN pad accepts keyboard input.
- The server write secret is kept in session storage or inside the PIN-encrypted blob, never as plaintext persistent browser storage.
- The unreliable Passkey/WebAuthn PRF quick unlock is not offered; obsolete passkey data is removed on startup.
- Four share cards (Private, Business, PayPal, Bank) are reachable through the bottom navigation and by swiping; cards without data show an empty state with an action to add the details.
- QR codes are generated locally in the "fluid" style (error correction Q, centre card icon, theme gradient). Data modules keep at least 7:1 and eyes 4.5:1 contrast on white in every theme; `tests/e2e/qr-scan.e2e.mjs` decodes every card in every theme.
- A failed or hanging start shows the error and a "Repair app" button instead of a blank screen; an unreachable server shows "Server not reachable" with a retry instead of the setup form.
- The private vCard contains only private fields; vCards are 3.0 with `N`, `FN`, seven-part `ADR`, escaping and CRLF.
- PayPal link contains no payment reference.
- GiroCode follows EPC069-12 v002: payment reference in the unstructured remittance field, length limits, IBAN checksum validation; no code is shown without valid data.
- The amount is synchronized between the PayPal and Bank cards and updates the QR code while typing.
- Contacts can be shared as a `.vcf` file; every detail has a copy button.
- The page never reloads itself when the service worker updates (this previously cleared the setup form on the first visit).
- Export/import of the token remains available; import asks for confirmation before replacing the stored vault.
- The profile picture is stored inside the encrypted vault; legacy plaintext copies are migrated and removed.

## Deployment

- `docker compose pull && docker compose up -d` starts without a local build.
- Health check verifies `GET /healthz`.
- Meiku handles SIGTERM itself and stops in under a second; the Compose files no longer use `init: true` (Docker's init cannot forward signals with all capabilities dropped).
- Readiness check verifies `GET /readyz`.
- Reverse proxy must terminate HTTPS.
- `.env` contains `WEBUI_PORT`, `TZ`, `ISHIKU_LOG_LEVEL`, `ISHIKU_SETUP_SECRET`, `MEIKU_ACCESS_LOG`, `MEIKU_TRUST_PROXY` and `MEIKU_DATA_PATH`; `.env` is not versioned.
- The host data folder is set to UID/GID `10001:10001` on startup only when ownership differs and Docker permits `CHOWN`; otherwise the host folder must be adjusted manually. Running the application as root is refused.

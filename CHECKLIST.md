# Acceptance Check

Date: 2026-06-29

## Architecture

- The Python server serves the Meiku PWA and stores only the encrypted token.
- Client-side encryption stays entirely in the browser.
- Dockerfile and `docker-compose.yml` are available for ZimaOS/reverse-proxy operation.
- ZimaOS Compose defaults to the immutable GHCR release `ghcr.io/maroishiku/meiku:v0.2.5@sha256:a80e2e12070598d0dcde8c2b7a130a626811243be40e4ed428726003363550fc` instead of a local build.
- Persistence uses the bind mount `/DATA/AppData/meiku/data:/data`.
- `x-casaos` metadata is available for ZimaOS/CasaOS app import.
- AppMark, favicon and PWA icons are direct exports from the canonical Meiku icon source.

## Design System

- The active interface implements the central `ishiku-design-5` contract through local `design-system/` tokens and components.
- `.ishiku/design-system.lock` binds the implementation to the single workspace contract without copying the full specification.
- `app.manifest.json` contains Meiku identity and behavior metadata only; it does not define a separate design language.
- The app name is `Meiku - Profile Share`.
- The header uses the shared AppLogo/AppName/AppSubtitle pattern.
- Theme attributes live on `document.documentElement`: `data-theme`, `data-mode`, `data-resolved-mode`.
- Theme and mode persistence uses `meiku-theme` and `meiku-mode`.
- Six themes are available: Lavender, Mint, Sky, Amber, Rose, Graphite.
- Modes are available: System, Light, Dark.
- Technical build information appears only in the debug/settings sheet.

## Security

- `POST /api/token` and legacy `POST /save.php` require `X-Auth-Token`.
- Without `ISHIKU_SETUP_SECRET`, `ISHIKU_SETUP_SECRET_FILE` or legacy `DV2_SHARED_SECRET`, the container does not start.
- The server prefers `ISHIKU_SETUP_SECRET_FILE`, then `ISHIKU_SETUP_SECRET`, then `DV2_SHARED_SECRET`.
- Token writes are atomic and limited to a 1 MB request size.
- Tokens are checked for minimum length and allowed characters.
- The server sets basic security headers.
- The service worker does not cache token/save endpoints.
- The container runs as a non-root user.
- The container runs read-only with a `/data` bind mount and `/tmp` tmpfs; the entrypoint fixes the data folder owner and then drops to UID/GID `10001:10001`.
- Capabilities are dropped and `no-new-privileges` is set.
- Resource limits for CPU, RAM and processes are set.
- Log rotation is set so ZimaOS storage is not filled by logs.

## Features

- Setup saves encrypted data through the Python API.
- First run asks for full name, master password and server secret.
- After first run, a guided profile progress flow opens.
- Private and business address are separate fields.
- Login with master password remains available.
- New PINs use exactly six digits and protect a local credential blob with one million PBKDF2 iterations plus AES-GCM.
- The server write secret is kept in session storage or inside the PIN-encrypted blob, never as plaintext persistent browser storage.
- The unreliable Passkey/WebAuthn PRF quick unlock is not offered; obsolete passkey data is removed on startup.
- Private, Company and Payments tabs remain available.
- QR codes are generated locally.
- vCard contains only private fields.
- PayPal link contains no payment reference.
- GiroCode contains an optional payment reference.
- Amount is synchronized between PayPal and Bank.
- The Payments tab switches between PayPal and bank transfer mode.
- Export/import of the token remains available.

## Deployment

- `docker compose pull && docker compose up -d` starts without a local build.
- Health check verifies `GET /healthz`.
- Readiness check verifies `GET /readyz`.
- Reverse proxy must terminate HTTPS.
- `.env` contains `WEBUI_PORT`, `TZ`, `ISHIKU_LOG_LEVEL`, `ISHIKU_SETUP_SECRET`, `DV2_ACCESS_LOG` and `MEIKU_DATA_PATH`; `.env` is not versioned.
- The host data folder is set to UID/GID `10001:10001` on startup when Docker permits `CHOWN`; otherwise the host folder must be adjusted manually.

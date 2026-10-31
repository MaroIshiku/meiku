# Meiku - Profile Share

Self-hosted profile and contact card app for private and business QR cards.

## Short Description

Meiku is a mobile-first PWA for encrypted private and business profile cards with local contact, PayPal and SEPA/EPC QR codes. The Python server serves the app and stores only an encrypted token; plaintext data stays in the browser.

## Part of the ishiku Family

Meiku follows the shared Pixel Soft Utility design system for calm, rounded and self-hosted utility interfaces. The app uses the same six themes as the other ishiku apps: Lavender, Mint, Sky, Amber, Rose and Graphite. System, light and dark modes are implemented through shared theme tokens.

Meiku is built for phones. The interface uses the shared design-system components (AppHeader, bottom navigation, sheets, segmented control, chips, buttons) and shows technical information only under Settings → About. Meiku is not a server admin system with a user database; first run creates a client-side encrypted profile vault instead.

## Features

- Setup, vault unlock and editing directly in the PWA
- Web Crypto API: vault format v3 with a random AES-GCM-256 data key wrapped by a PBKDF2-SHA-256 key (600,000 iterations); existing v2 vaults open unchanged and are upgraded automatically
- Six-digit PIN quick unlock that wraps the vault key (never the master password) with one million PBKDF2 iterations
- Four swipeable share cards: Private, Business, PayPal and Bank, each with a large QR code and the share actions within thumb reach
- Fullscreen QR view with card title, amount, brightness hint and swiping between cards (screen stays awake)
- Share a contact as a `.vcf` file through the system share sheet; copy any detail with one tap
- Unlock with a PIN pad (shown directly when a PIN is set) or the master password
- Settings grouped into Profile, Appearance, Vault and About
- Step-by-step profile editor for Private, Business, PayPal and Bank
- Separate private and business addresses
- Local QR generation without a third-party API
- Separate vCard QRs for Private and Business
- PayPal QR and GiroCode/EPC QR (EPC069-12 v002, IBAN checksum validation) with synchronized amount
- vCard 3.0 QR codes with structured name and address
- Profile picture stored inside the encrypted vault
- Conflict protection: a save from an outdated device is rejected instead of overwriting newer data
- Server-side history of the last 10 encrypted tokens for restore and rollback
- Export/import for the encrypted token (import asks for confirmation)
- PWA manifest, service worker and Meiku PWA icons
- Python API for token I/O with `X-Auth-Token`

## Tech Stack

- Vanilla HTML, CSS and JavaScript as a PWA
- Web Crypto API for client-side encryption
- Custom local QR renderer without an external QR API
- Python `http.server`-based runtime server
- Docker/Compose for ZimaOS, CasaOS and other self-hosted setups
- ishiku design system v5 implementation tokens, components and executable checks

## Installation

### Docker Compose

```bash
git clone git@github.com:MaroIshiku/meiku.git
cd meiku
cp .env.example .env
```

Set at least one random secret with 32 or more characters in `.env`. For example, generate one with `openssl rand -base64 32`:

```env
WEBUI_PORT=65003
TZ=Europe/Berlin
ISHIKU_SETUP_SECRET=replace-with-at-least-32-random-characters
MEIKU_DATA_PATH=/DATA/AppData/meiku/data
```

Prepare the data folder on the host:

```bash
mkdir -p /DATA/AppData/meiku/data
```

On container startup, the Meiku entrypoint sets the data folder owner to `10001:10001` when Docker permits `CHOWN` for the bind mount. If your host does not allow this, run once:

```bash
chown -R 10001:10001 /DATA/AppData/meiku/data
```

Start the container:

```bash
docker compose pull
docker compose up -d
```

For direct ZimaOS/CasaOS import, use `Meiku - Profile Share.yaml`. That file contains the fixed published port `65003` and the immutable release image without Compose interpolation; set `ISHIKU_SETUP_SECRET` in the platform UI before starting it. The regular `docker-compose.yml` is the alternative when `.env` overrides are required. Both files are kept aligned by `tests/test_compose.py`.

### First Start

On first start, Meiku shows the vault setup. Enter the profile name, a master password (at least 12 characters, entered twice) and the same secret configured server-side as `ISHIKU_SETUP_SECRET` or `ISHIKU_SETUP_SECRET_FILE`.

### Admin Account

Meiku does not create a server admin account and does not store user password hashes because the app is a client-side encrypted profile vault. The setup secret mechanism protects write access to the encrypted token. The master password is never sent to the server.

## Configuration

### Environment Variables

| Variable | Purpose |
| --- | --- |
| `WEBUI_PORT` | Host port for the web interface, default `65003`. The container continues to listen on `8080`. |
| `TZ` | Time zone, default `Europe/Berlin`. |
| `ISHIKU_DATA_DIR` | Persistent data folder in the container, default `/data`. |
| `ISHIKU_LOG_LEVEL` | Shared runtime log level, default `info`. |
| `ISHIKU_SETUP_SECRET` | Preferred secret for setup and token write access; at least 32 characters. |
| `ISHIKU_SETUP_SECRET_FILE` | Optional path to a secret file, preferred over environment secrets. |
| `MEIKU_ACCESS_LOG` | Enables simple access logs with `true`, `1` or `yes`. |
| `MEIKU_TRUST_PROXY` | `true` only when Meiku is reachable exclusively through one reverse proxy that appends the client address to `X-Forwarded-For`; the write rate limit then applies per real client instead of per proxy. |
| `MEIKU_DATA_PATH` | Host bind mount for persistent data. |

Removed in v0.3.0: `DV2_SHARED_SECRET`, `DV2_DATA_FILE`, `DV2_HOST`, `DV2_PORT`, `DV2_STATIC_DIR`, `DV2_ACCESS_LOG`, `DATELLO_DATA_PATH`. Leftover entries with the old default values are ignored with a warning. A leftover value that would change behaviour (for example `DV2_SHARED_SECRET` without `ISHIKU_SETUP_SECRET`) stops the container with a rename hint.

### Docker Secrets

When a secret file is used, the server reads `ISHIKU_SETUP_SECRET_FILE` first. Without an explicit variable, it checks `/run/secrets/ishiku_setup_secret`. If no file exists, it falls back to `ISHIKU_SETUP_SECRET`.

A secret file keeps the value out of `docker inspect`. Create a host file readable by UID 10001 and add it as a file-based Compose secret (`secrets: ishiku_setup_secret: file: ./setup-secret.txt` plus `secrets: [ishiku_setup_secret]` on the service), then remove `ISHIKU_SETUP_SECRET`. Environment-sourced Compose secrets are not possible because the container file system is read-only.

The server never logs the secret and never sends it to the browser. Users type it once per browser session; it is kept in session storage and, when a PIN is set, inside the PIN-encrypted blob.

### Persistent Data

Inside the container, the encrypted token is stored at `/data/data.json` by default, together with a revision number. The previous 10 tokens are kept in `/data/history/`. On ZimaOS, this path is recommended:

```text
/DATA/AppData/meiku/data
```

## Security

- Plaintext data never leaves the browser.
- The master password is never sent to the server.
- The server stores only the AES-GCM token. The token is publicly readable by design (the browser needs it before unlocking), so use a strong master password; new passwords need at least 12 characters.
- The setup secret is only intended for write access to the encrypted token. Failed attempts are rate limited.
- The write secret exists in plaintext only for the current browser session. PIN quick unlock persists one AES-GCM blob that contains the vault data key and the write secret; it never contains the master password. This accepted trade-off is recorded in `.ishiku/overrides/OVR-001.json`.
- The remembered display name for the login screen is the only profile value kept unencrypted in the browser; Sign Out removes it.
- Legacy plaintext write secrets and profile pictures are migrated out of `localStorage`; deprecated passkey quick-unlock data is removed.
- There is no public server registration.
- Only the PWA files are served; server code and repository files are not reachable over HTTP.
- `/api/data`, `/api/token` and `build-info.json` are never cached by the service worker.
- The container starts briefly with root privileges, fixes the `/data` bind mount when needed and then runs as UID/GID `10001:10001`, read-only, with a `/data` bind mount and `/tmp` tmpfs.

## Updates and Backup

Updates:

```bash
docker compose pull
docker compose up -d
```

Backup:

- Back up the host folder configured through `MEIKU_DATA_PATH` (includes `history/`).
- Optionally export the encrypted token in the app.
- Store the master password and server-side secret separately and securely.

Restore an earlier token: stop the container, copy the wanted file from `history/` over `data.json`, start the container. Clients that are open at that time get a conflict message on their next save and must reload.

Upgrade to v0.3.0: no action is required. The first unlock with password or PIN re-encrypts the existing vault in the v3 format (the server secret must be known in that browser session; otherwise this happens on the next save). The v2 token stays in `history/`.

Rollback below v0.3.0: older releases cannot open a v3 vault. Before starting an older image, restore the last v2 token from `history/` (the file written before the upgrade, normally the oldest `data-r000000-*.json` or the one before the first v3 save). Changes saved after the upgrade are then lost unless you re-enter them. The history holds only the last 10 saves, so copy `data.json` before upgrading if a rollback might be needed.

## Development

Local start:

```bash
ISHIKU_SETUP_SECRET=development-only-secret-at-least-32-characters MEIKU_DATA_FILE=./data/data.json python server.py --host 127.0.0.1 --port 8080
```

Health checks:

```text
GET /healthz
GET /readyz
```

Token endpoints:

```text
GET  /api/data    -> {"token": "...", "updated": "...", "revision": 3}
POST /api/token   <- {"token": "...", "expectedRevision": 3}   (X-Auth-Token header)
                  -> 200 {"ok": true, "updated": "...", "revision": 4}
                  -> 409 {"code": "VERSION_CONFLICT", "revision": 5, ...}
```

`expectedRevision` is optional for compatibility; `null` means "create only if no vault exists". The legacy endpoints `/data.json` and `/save.php` were removed in v0.3.0.

Tests:

```bash
python -m unittest discover -s tests
node tests/test-crypto.mjs && node tests/test-store.mjs && node tests/test-auth.mjs && node tests/test-qr.mjs
node .ishiku/kit/scripts/verify-app . --full
```

`tests/e2e/migration.e2e.mjs` is an optional Playwright browser test for the v0.2.x to v0.3.0 migration; see the header of the file.

## Created with ChatGPT Codex

This project was implemented and refined with support from ChatGPT Codex. Codex is a development tool; maintenance, operation and responsibility remain with the repository owner.

## Status and License

Status: actively in development.

License: MIT. See `LICENSE`.

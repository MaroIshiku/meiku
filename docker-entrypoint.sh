#!/bin/sh
set -eu

APP_UID="${MEIKU_UID:-10001}"
APP_GID="${MEIKU_GID:-10001}"
DATA_DIR="${ISHIKU_DATA_DIR:-/data}"

mkdir -p "$DATA_DIR"

# Returns success when the data directory or any file below it is not owned by
# the application user, so the recursive chown only runs when it is needed.
needs_chown() {
  [ "$(stat -c '%u:%g' "$DATA_DIR")" != "$APP_UID:$APP_GID" ] && return 0
  [ -n "$(find "$DATA_DIR" \( ! -user "$APP_UID" -o ! -group "$APP_GID" \) -print -quit 2>/dev/null)" ]
}

if [ "$(id -u)" = "0" ]; then
  if [ "$APP_UID" = "0" ] || [ "$APP_GID" = "0" ]; then
    echo "Meiku error: running the application as root is not supported." >&2
    exit 1
  fi
  if needs_chown && ! chown -R "$APP_UID:$APP_GID" "$DATA_DIR"; then
    echo "Meiku error: could not chown $DATA_DIR to $APP_UID:$APP_GID." >&2
    echo "Fix the bind-mount ownership; Meiku will not continue as root." >&2
    exit 1
  fi
  exec su-exec "$APP_UID:$APP_GID" "$@"
fi

exec "$@"

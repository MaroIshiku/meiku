#!/bin/sh
set -eu

APP_UID="${MEIKU_UID:-10001}"
APP_GID="${MEIKU_GID:-10001}"
DATA_DIR="${ISHIKU_DATA_DIR:-/data}"

mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  if [ "$APP_UID" = "0" ] || [ "$APP_GID" = "0" ]; then
    exec "$@"
  fi
  if chown -R "$APP_UID:$APP_GID" "$DATA_DIR"; then
    exec su-exec "$APP_UID:$APP_GID" "$@"
  else
    echo "Meiku error: could not chown $DATA_DIR to $APP_UID:$APP_GID." >&2
    echo "Fix the bind-mount ownership; Meiku will not continue as root." >&2
    exit 1
  fi
fi

exec "$@"

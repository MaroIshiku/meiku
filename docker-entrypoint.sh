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
    echo "Meiku warning: could not chown $DATA_DIR to $APP_UID:$APP_GID." >&2
    echo "Meiku warning: continuing as root so existing mounted data remains readable and writable." >&2
  fi
  exec "$@"
fi

exec "$@"

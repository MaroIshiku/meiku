FROM python:3.13-alpine@sha256:399babc8b49529dabfd9c922f2b5eea81d611e4512e3ed250d75bd2e7683f4b0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DV2_HOST=0.0.0.0 \
    DV2_PORT=8080 \
    DV2_STATIC_DIR=/app \
    DV2_DATA_FILE=/data/data.json

WORKDIR /app

RUN addgroup -S ishcontact && adduser -S -G ishcontact -u 10001 ishcontact \
    && apk add --no-cache su-exec \
    && mkdir -p /data \
    && chown -R ishcontact:ishcontact /data /app

COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/meiku-entrypoint
RUN chmod 755 /usr/local/bin/meiku-entrypoint

COPY --chown=ishcontact:ishcontact index.html manifest.json app.manifest.json sw.js server.py save.php build-info.json ./
COPY --chown=ishcontact:ishcontact css ./css
COPY --chown=ishcontact:ishcontact design-system ./design-system
COPY --chown=ishcontact:ishcontact icons ./icons
COPY --chown=ishcontact:ishcontact contracts ./contracts
COPY --chown=ishcontact:ishcontact checklists ./checklists
COPY --chown=ishcontact:ishcontact js ./js
COPY --chown=ishcontact:ishcontact assets ./assets

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3).read()" || exit 1

ENTRYPOINT ["meiku-entrypoint"]
CMD ["python", "/app/server.py"]

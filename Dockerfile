FROM python:3.14.8-alpine@sha256:f6a589d43c42b9e7f7dc67a12d37132491f362859a5d750607710cc56da3bc72

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MEIKU_HOST=0.0.0.0 \
    MEIKU_PORT=8080 \
    MEIKU_STATIC_DIR=/app \
    ISHIKU_DATA_DIR=/data

WORKDIR /app

RUN addgroup -S -g 10001 meiku && adduser -S -G meiku -u 10001 meiku \
    && apk upgrade --no-cache \
    && apk add --no-cache su-exec \
    && rm -rf /usr/local/lib/python3.14/site-packages/pip /usr/local/lib/python3.14/site-packages/pip-* /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.14 \
    && mkdir -p /data \
    && chown meiku:meiku /data

COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/meiku-entrypoint
RUN chmod 755 /usr/local/bin/meiku-entrypoint

COPY --chown=root:root server.py ./
COPY --chown=root:root index.html manifest.json app.manifest.json sw.js build-info.json ./
COPY --chown=root:root css ./css
COPY --chown=root:root design-system ./design-system
COPY --chown=root:root icons ./icons
COPY --chown=root:root js ./js
COPY --chown=root:root assets ./assets

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3).read()" || exit 1

ENTRYPOINT ["meiku-entrypoint"]
CMD ["python", "/app/server.py"]

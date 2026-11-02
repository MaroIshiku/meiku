FROM python:3.15.0-alpine@sha256:2699b90f4d562a22e2dd076c82f964032f64814204bff36d271a54ba4cc2c7e2

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

# Build information for Settings -> About. The ishiku release workflow passes
# VERSION, BUILD_DATE (commit date) and GIT_SHA; publish-ghcr.yml passes
# GIT_SHA, BUILD_DATE, SOURCE_REF and WORKFLOW_RUN. Local builds without
# arguments keep the repository's build-info.json ("local").
ARG VERSION=""
ARG BUILD_DATE=""
ARG GIT_SHA=""
ARG SOURCE_REF=""
ARG WORKFLOW_RUN=""
RUN if [ -n "$GIT_SHA" ]; then python -c 'import json, os; e = os.environ.get; v = e("VERSION") or None; json.dump({"app": "Meiku - Profile Share", "version": v, "buildSha": e("GIT_SHA"), "builtAt": e("BUILD_DATE") or None, "sourceRepo": "MaroIshiku/meiku", "sourceRef": ("v" + v) if v else (e("SOURCE_REF") or None), "workflowRun": e("WORKFLOW_RUN") or None, "forkRepos": []}, open("/app/build-info.json", "w"), indent=2)'; fi

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3).read()" || exit 1

ENTRYPOINT ["meiku-entrypoint"]
CMD ["python", "/app/server.py"]

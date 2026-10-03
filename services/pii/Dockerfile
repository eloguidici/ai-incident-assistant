# syntax=docker/dockerfile:1.7
FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c AS build
WORKDIR /build
COPY requirements.lock.txt model-lock.json download_model.py ./
RUN --mount=type=secret,id=extra_ca_cert,required=false \
    cat /etc/ssl/certs/ca-certificates.crt > /tmp/build-ca.pem && \
    if [ -f /run/secrets/extra_ca_cert ]; then cat /run/secrets/extra_ca_cert >> /tmp/build-ca.pem; fi && \
    PIP_CERT=/tmp/build-ca.pem pip install --no-cache-dir --require-hashes --prefix=/install -r requirements.lock.txt && \
    REQUESTS_CA_BUNDLE=/tmp/build-ca.pem PYTHONPATH=/install/lib/python3.12/site-packages \
      HF_HUB_DISABLE_XET=1 HF_HUB_DISABLE_TELEMETRY=1 python download_model.py && \
    rm -rf /tmp/model-download /tmp/build-ca.pem

FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c
WORKDIR /app
COPY --from=build /install /usr/local
COPY --from=build /opt/model /opt/model
COPY sanitizer.py app.py model-lock.json ./
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DISABLE_XET=1 HF_HOME=/opt/model/cache \
    TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 HOME=/nonexistent
USER 65532:65532
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=120s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).read()"]
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log", "--log-level", "critical", "--limit-concurrency", "16", "--timeout-keep-alive", "5", "--h11-max-incomplete-event-size", "16384"]

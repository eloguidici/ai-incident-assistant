FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c
WORKDIR /spike
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.lock.txt ./
RUN --mount=type=secret,id=extra_ca_cert,required=false \
    if [ -f /run/secrets/extra_ca_cert ]; then \
      cp /run/secrets/extra_ca_cert /usr/local/share/ca-certificates/build-extra-ca.crt; \
      update-ca-certificates; \
    fi; \
    PIP_CERT=/etc/ssl/certs/ca-certificates.crt pip install --no-cache-dir -r requirements.lock.txt
COPY *.py fixtures.json ./
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
USER 65532:65532
ENTRYPOINT ["python", "run.py"]

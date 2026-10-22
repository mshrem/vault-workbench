FROM python:3.12-slim
WORKDIR /app
COPY requirements-importer.txt /app/requirements-importer.txt
RUN pip install --no-cache-dir --only-binary=:all: -r requirements-importer.txt \
    && python -c "import numpy, trimesh, fast_simplification, scipy.sparse" \
    && mkdir -p /data && chown 65534:65534 /data
COPY server.py importer.py import_worker.py diagnostics.py version.py /app/
COPY web /app/web
ENV HOST=0.0.0.0 PORT=8787 VAULT_ROOT=/library VAULT_DATA=/data PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 65534:65534
EXPOSE 8787
CMD ["python", "server.py"]

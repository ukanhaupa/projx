FROM python:3.12-slim

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

COPY pyproject.toml uv.lock /app/

RUN uv sync --frozen --no-dev --no-install-project

RUN useradd -m -u 1000 user

RUN chown -R user /app

USER user

COPY --chown=user alembic.ini migrate.py /app/

COPY --chown=user src /app/src

RUN uv sync --frozen --no-dev

EXPOSE 7860

ENV PYTHONUNBUFFERED=1

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:7860/api/health')"]

CMD ["uv", "run", "uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "2", "--timeout-keep-alive", "120"]

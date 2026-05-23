FROM public.ecr.aws/docker/library/python:3.12-alpine3.20 AS builder

WORKDIR /app

RUN apk add --no-cache build-base libffi-dev openssl-dev

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

COPY pyproject.toml uv.lock /app/

RUN uv sync --frozen --no-default-groups --no-install-project

COPY alembic.ini migrate.py /app/
COPY src /app/src

RUN uv sync --frozen --no-default-groups


FROM public.ecr.aws/docker/library/python:3.12-alpine3.20 AS runtime

WORKDIR /app

RUN apk add --no-cache libffi openssl libstdc++

RUN adduser -D -u 1000 user

COPY --from=builder --chown=user:user /app /app

USER user

EXPOSE 8000

ENV PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"]

CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--timeout-keep-alive", "120"]

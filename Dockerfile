# syntax=docker/dockerfile:1

FROM ghcr.io/astral-sh/uv:0.11.6 AS uv
FROM python:3.13-slim

COPY --from=uv /uv /uvx /bin/

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY config ./config
COPY migrations ./migrations
COPY src ./src
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 10001 rag \
    && chown -R rag:rag /app
USER rag

CMD ["rag-mcp", "--transport", "streamable-http", "--host", "0.0.0.0", "--port", "8000"]

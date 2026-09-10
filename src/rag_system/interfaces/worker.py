from __future__ import annotations

import argparse
import asyncio
import signal

from ..application.worker import ProjectionWorker
from ..infrastructure.config import Settings
from ..infrastructure.database import PostgresRepository
from ..infrastructure.elasticsearch_store import ElasticsearchRepository
from ..infrastructure.object_store import S3ObjectStore


async def _run_worker(settings: Settings) -> None:
    repository = PostgresRepository.from_settings(settings)
    search = ElasticsearchRepository.from_settings(settings)
    object_store = S3ObjectStore.from_settings(settings)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stop.set)
    worker = ProjectionWorker(
        repository=repository,
        search=search,
        object_store=object_store,
        worker_id=settings.worker.id,
        lease_seconds=settings.worker.outbox_lease_seconds,
    )
    try:
        await worker.run(
            poll_seconds=settings.worker.outbox_poll_seconds,
            stop=stop,
        )
    finally:
        await search.client.close()
        await repository.close()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run the My RAG outbox worker")
    parser.parse_args(argv)
    settings = Settings.from_env()
    settings.validate_storage().validate_embedding_profile().validate_retrieval()
    asyncio.run(_run_worker(settings))


if __name__ == "__main__":
    main()

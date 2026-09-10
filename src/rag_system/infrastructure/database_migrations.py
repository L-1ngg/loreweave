from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config


ALEMBIC_HEAD = "0001_initial"


def upgrade_database(database_url: str) -> None:
    root = Path(__file__).resolve().parents[3]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.upgrade(config, "head")

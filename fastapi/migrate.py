import argparse
import os
import sys

from dotenv import load_dotenv

load_dotenv()

from alembic import command
from alembic.config import Config


def main():
    parser = argparse.ArgumentParser(description="Run database migrations")
    parser.add_argument("--revision", default="head", help="Target revision (default: head)")
    parser.add_argument("--downgrade", default=None, help="Downgrade to revision (e.g. -1)")
    args = parser.parse_args()

    db_uri = os.getenv("SQLALCHEMY_DATABASE_URI")
    if not db_uri:
        print("ERROR: SQLALCHEMY_DATABASE_URI not set")
        sys.exit(1)

    alembic_config = Config("alembic.ini")
    alembic_config.set_main_option("sqlalchemy.url", db_uri)

    if args.downgrade:
        print(f"Downgrading to: {args.downgrade}")
        command.downgrade(alembic_config, args.downgrade)
    else:
        print(f"Upgrading to: {args.revision}")
        command.upgrade(alembic_config, args.revision)

    print("Done.")


if __name__ == "__main__":
    main()

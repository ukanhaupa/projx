import argparse
import subprocess
import sys

from loguru import logger


def main():
    parser = argparse.ArgumentParser(description="Run the backend server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--reload", action="store_true", default=False)
    args = parser.parse_args()

    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "src.app:app",
        "--host",
        args.host,
        "--port",
        str(args.port),
        "--timeout-keep-alive",
        "120",
    ]
    if args.reload:
        cmd.append("--reload")
    else:
        cmd.extend(["--workers", str(args.workers)])

    logger.info(f"Starting server on {args.host}:{args.port} [workers={args.workers}, reload={args.reload}]")
    subprocess.run(cmd)


if __name__ == "__main__":
    main()

import subprocess
import sys


def main():
    cmd = [sys.executable, "-m", "pytest", *sys.argv[1:]]
    raise SystemExit(subprocess.call(cmd))


if __name__ == "__main__":
    main()

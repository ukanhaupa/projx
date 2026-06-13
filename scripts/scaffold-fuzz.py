#!/usr/bin/env python3
"""Randomized parallel scaffold fuzzer for the projx CLI.

Scaffolds many random component/orm/feature permutations under a temp dir,
in parallel, and runs fast structural assertions on each — plus deterministic
regression guards for known-fixed bugs. Complements scripts/ci-scaffold-matrix.sh
(narrow/deep, serial) with broad/shallow coverage.

Usage:
  scripts/scaffold-fuzz.py                 # 50 random runs + regression scenarios
  scripts/scaffold-fuzz.py --runs 200      # more random runs
  scripts/scaffold-fuzz.py --seed 12345    # replay a previous run exactly
  scripts/scaffold-fuzz.py --jobs 12       # concurrency
  scripts/scaffold-fuzz.py --keep          # keep temp dirs of failures for inspection

Exits 0 if every scaffold passed, 1 otherwise. The seed is always printed so any
failure is reproducible.
"""

import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "cli" / "dist" / "index.js"

COMPONENTS = [
    "fastapi",
    "fastify",
    "express",
    "frontend",
    "mobile",
    "e2e",
    "infra",
    "admin-panel",
]
ORMS = ["prisma", "drizzle", "sequelize", "typeorm"]
BACKENDS = {"fastapi", "fastify", "express"}
NODE_BACKENDS = {"fastify", "express"}
PACKAGE_MANAGERS = {"npm", "pnpm", "yarn", "bun"}

AUTH_MODULE = {
    "fastify": "fastify/src/modules/auth",
    "express": "express/src/modules/auth",
    "fastapi": "fastapi/src/auth",
}
SHARED_RENDERED = [
    "docker-compose.yml",
    "README.md",
    "scripts/setup.sh",
    ".github/workflows/ci.yml",
    ".githooks/pre-commit",
]
EJS_LEFTOVER = re.compile(r"<%|%>")


@dataclass
class Combo:
    components: list
    orm: str | None
    auth: list = field(default_factory=list)

    def label(self):
        parts = [",".join(self.components)]
        if self.orm:
            parts.append(f"orm={self.orm}")
        if self.auth:
            parts.append(f"auth={','.join(self.auth)}")
        return " ".join(parts)


@dataclass
class Result:
    label: str
    failures: list
    repro: str
    workdir: str | None


def gen_combo(rng):
    size = rng.choices([1, 2, 3, 4, 5], weights=[2, 4, 4, 3, 1])[0]
    comps = sorted(rng.sample(COMPONENTS, min(size, len(COMPONENTS))))
    node = [c for c in comps if c in NODE_BACKENDS]
    orm = rng.choice(ORMS) if node else None
    backends = [c for c in comps if c in BACKENDS]
    auth = []
    if backends and rng.random() < 0.5:
        auth = sorted(rng.sample(backends, rng.randint(1, len(backends))))
    return Combo(comps, orm, auth)


def create_cmd(combo, app_path):
    cmd = [
        "node",
        str(CLI),
        str(app_path),
        "--components",
        ",".join(combo.components),
        "--no-install",
        "--no-git",
        "--local",
        str(ROOT),
    ]
    if combo.orm:
        cmd += ["--orm", combo.orm]
    if combo.auth:
        cmd.append(f"--auth={','.join(combo.auth)}")
    return cmd


def run_cli(cmd, cwd=None):
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=180)
    return proc.returncode, proc.stdout, proc.stderr


def check_scaffold(combo, app):
    failures = []
    for c in combo.components:
        if not (app / c).is_dir():
            failures.append(f"missing component dir {c}/")

    projx = app / ".projx"
    if not projx.exists():
        failures.append("missing .projx")
    else:
        try:
            data = json.loads(projx.read_text())
            if not data.get("version"):
                failures.append(".projx missing version")
            pm = data.get("packageManager")
            if pm not in PACKAGE_MANAGERS:
                failures.append(f".projx packageManager invalid: {pm!r}")
            if combo.orm and any(c in NODE_BACKENDS for c in combo.components):
                if data.get("orm") != combo.orm:
                    failures.append(
                        f".projx orm {data.get('orm')!r} != requested {combo.orm!r}"
                    )
        except json.JSONDecodeError as e:
            failures.append(f".projx not valid JSON: {e}")

    needs_compose = any(
        c in BACKENDS or c in {"frontend", "admin-panel"} for c in combo.components
    )
    compose = app / "docker-compose.yml"
    if needs_compose and not compose.exists():
        failures.append("expected docker-compose.yml, missing")

    if "admin-panel" in combo.components:
        if not (app / "admin-panel").is_dir():
            failures.append("admin-panel requested but admin-panel/ missing")
        if compose.exists() and "admin-panel:" not in compose.read_text():
            failures.append("admin-panel service missing from docker-compose.yml")

    for target in combo.auth:
        mod = AUTH_MODULE.get(target)
        if mod and not (app / mod).is_dir():
            failures.append(f"auth requested for {target} but {mod}/ missing")

    for rel in SHARED_RENDERED:
        f = app / rel
        if f.exists() and EJS_LEFTOVER.search(f.read_text()):
            failures.append(f"unrendered EJS tags left in {rel}")

    for c in combo.components:
        if c in NODE_BACKENDS or c == "frontend":
            pkg = app / c / "package.json"
            if pkg.exists():
                try:
                    json.loads(pkg.read_text())
                except json.JSONDecodeError:
                    failures.append(f"{c}/package.json not valid JSON")

    return failures


def run_create(combo, workdir):
    app = Path(workdir) / "app"
    cmd = create_cmd(combo, app)
    repro = " ".join(cmd)
    rc, _out, err = run_cli(cmd)
    if rc != 0:
        return Result(
            combo.label(), [f"exit {rc}: {err.strip()[-400:]}"], repro, workdir
        )
    return Result(combo.label(), check_scaffold(combo, app), repro, workdir)


def git_init(cwd):
    for cmd in (
        ["git", "init", "--quiet"],
        ["git", "-c", "core.hooksPath=/dev/null", "add", "-A"],
        [
            "git",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "user.email=a@a",
            "-c",
            "user.name=a",
            "commit",
            "--quiet",
            "-m",
            "init",
        ],
    ):
        subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def scenario_admin_panel(workdir):
    app = Path(workdir) / "app"
    cmd = create_cmd(Combo(["admin-panel", "fastapi"], None), app)
    rc, _o, err = run_cli(cmd)
    if rc != 0:
        return Result(
            "scenario:admin-panel",
            [f"exit {rc}: {err.strip()[-300:]}"],
            " ".join(cmd),
            workdir,
        )
    fails = []
    if not (app / "admin-panel").is_dir():
        fails.append("admin-panel/ not scaffolded (#62)")
    compose = app / "docker-compose.yml"
    if not compose.exists() or "admin-panel:" not in compose.read_text():
        fails.append("admin-panel service missing from compose (#62)")
    return Result("scenario:admin-panel", fails, " ".join(cmd), workdir)


def scenario_add_honors_skip(workdir):
    app = Path(workdir) / "app"
    rc, _o, err = run_cli(create_cmd(Combo(["fastify"], "prisma"), app))
    if rc != 0:
        return Result(
            "scenario:add-honors-skip",
            [f"create exit {rc}: {err.strip()[-300:]}"],
            "",
            workdir,
        )
    projx_path = app / ".projx"
    projx = json.loads(projx_path.read_text())
    projx["skip"] = sorted(set(projx.get("skip", []) + ["docker-compose.yml"]))
    projx_path.write_text(json.dumps(projx, indent=2) + "\n")
    sentinel = "# HAND-AUTHORED — must survive add (#60)\n"
    (app / "docker-compose.yml").write_text(sentinel)
    git_init(app)
    add_cmd = [
        "node",
        str(CLI),
        "add",
        "admin-panel",
        "--no-install",
        "--local",
        str(ROOT),
    ]
    rc, _o, err = run_cli(add_cmd, cwd=app)
    repro = " ".join(add_cmd)
    if rc != 0:
        return Result(
            "scenario:add-honors-skip",
            [f"add exit {rc}: {err.strip()[-300:]}"],
            repro,
            workdir,
        )
    fails = []
    if not (app / "admin-panel").is_dir():
        fails.append("add admin-panel did not scaffold admin-panel/")
    if (app / "docker-compose.yml").read_text() != sentinel:
        fails.append("skipped docker-compose.yml was overwritten by add (#60)")
    return Result("scenario:add-honors-skip", fails, repro, workdir)


SCENARIOS = [scenario_admin_panel, scenario_add_honors_skip]


def execute(task_fn, keep):
    workdir = tempfile.mkdtemp(prefix="projx-fuzz-")
    try:
        result = task_fn(workdir)
        keep_this = keep and bool(result.failures)
        if not keep_this:
            shutil.rmtree(workdir, ignore_errors=True)
            result.workdir = None
        else:
            result.workdir = workdir
        return result
    except Exception as e:
        keep_this = keep
        if not keep_this:
            shutil.rmtree(workdir, ignore_errors=True)
        return Result(
            getattr(task_fn, "__name__", "task"),
            [f"harness error: {e}"],
            "",
            workdir if keep_this else None,
        )


def main():
    parser = argparse.ArgumentParser(
        description="Randomized parallel projx scaffold fuzzer"
    )
    parser.add_argument("--runs", type=int, default=50)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--jobs", type=int, default=min(8, (os.cpu_count() or 4)))
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--cli", default=None, help="path to a built CLI entrypoint")
    args = parser.parse_args()

    global CLI
    if args.cli:
        CLI = Path(args.cli).resolve()

    if not CLI.exists():
        print(f"CLI not built at {CLI} — run: pnpm --dir cli build", file=sys.stderr)
        return 2

    seed = args.seed if args.seed is not None else random.randrange(1_000_000_000)
    rng = random.Random(seed)
    combos = [gen_combo(rng) for _ in range(args.runs)]

    print(
        f"seed: {seed}   runs: {args.runs}   scenarios: {len(SCENARIOS)}   jobs: {args.jobs}"
    )
    print(f"cli:  {CLI}\n")

    tasks = [lambda wd, c=c: run_create(c, wd) for c in combos]
    tasks += [lambda wd, s=s: s(wd) for s in SCENARIOS]

    results = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(execute, t, args.keep): i for i, t in enumerate(tasks)}
        done = 0
        for fut in as_completed(futures):
            results.append(fut.result())
            done += 1
            mark = "." if not results[-1].failures else "F"
            sys.stdout.write(mark)
            sys.stdout.flush()
    print("\n")

    failed = [r for r in results if r.failures]
    passed = len(results) - len(failed)
    print(f"PASS: {passed}   FAIL: {len(failed)}   (seed {seed})\n")

    if failed:
        print("FAILURES")
        print("========")
        for r in failed:
            print(f"\n  [{r.label}]")
            for f in r.failures:
                print(f"    - {f}")
            if r.repro:
                print(f"    repro: {r.repro}")
            if r.workdir:
                print(f"    kept:  {r.workdir}")
        print(
            f"\nReplay this exact set with:  scripts/scaffold-fuzz.py --seed {seed} --runs {args.runs}"
        )
        return 1

    print("all scaffolds passed — safe to push")
    return 0


if __name__ == "__main__":
    sys.exit(main())

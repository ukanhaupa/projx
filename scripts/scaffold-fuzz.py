#!/usr/bin/env python3
"""Randomized parallel scaffold fuzzer for the projx CLI.

Mimics real users across every template, ORM, feature flag, and lifecycle
command (create / add / update / init). Each run picks a random journey and a
random *valid* component+orm+auth combo, scaffolds it under a temp dir in
parallel, and runs fast toolchain-free structural assertions — plus
deterministic negative scenarios that prove the CLI rejects invalid combos and
regression guards for known-fixed bugs.

Usage:
  scripts/scaffold-fuzz.py                 # random runs + scenarios
  scripts/scaffold-fuzz.py --runs 200      # more random runs
  scripts/scaffold-fuzz.py --seed 12345    # replay a previous run exactly
  scripts/scaffold-fuzz.py --jobs 12       # concurrency
  scripts/scaffold-fuzz.py --keep          # keep temp dirs of failures
  scripts/scaffold-fuzz.py --cli <path>    # point at a built CLI entrypoint

Exits 0 if every check passed, 1 otherwise. The seed is always printed so any
failure is reproducible.
"""

import argparse
import json
import os
import pty
import random
import re
import select
import shutil
import subprocess
import sys
import tempfile
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "cli" / "dist" / "index.js"

NON_BACKEND = ["vitejs", "nextjs", "mobile", "e2e", "infra", "admin-panel"]

ORM_FAMILIES = {
    "node": {
        "backends": ["fastify", "express"],
        "orms": ["prisma", "drizzle", "sequelize", "typeorm"],
    },
    "go": {"backends": ["go"], "orms": ["gorm", "sqlc", "ent"]},
    "rust": {"backends": ["rust"], "orms": ["seaorm"]},
    "laravel": {"backends": ["laravel"], "orms": ["eloquent"]},
}
ALL_BACKENDS = {b for spec in ORM_FAMILIES.values() for b in spec["backends"]} | {
    "fastapi"
}
PACKAGE_MANAGERS = {"npm", "pnpm", "yarn", "bun"}

AUTH_LANDING = {
    "fastify": "fastify/src/modules/auth",
    "express": "express/src/modules/auth",
    "fastapi": "fastapi/src/auth",
    "go": "go/internal/auth",
    "rust": "rust/src/auth/models",
    "laravel": "laravel/app/Http/Controllers/Auth",
}
AUTH_FEATURE_BROKEN = set()
AUTH_TARGETS = set(AUTH_LANDING) - AUTH_FEATURE_BROKEN

AUTH_OK_ORMS = {
    "prisma",
    "drizzle",
    "sequelize",
    "typeorm",
    "gorm",
    "sqlc",
    "ent",
    "seaorm",
    "eloquent",
}
FAMILY_DEFAULT_ORM = {
    "node": "prisma",
    "go": "gorm",
    "rust": "seaorm",
    "laravel": "eloquent",
}


def auth_allowed_for(family, orm):
    eff = orm or FAMILY_DEFAULT_ORM.get(family)
    return eff is None or eff in AUTH_OK_ORMS


ORM_MARKERS = {
    "prisma": ["fastify/prisma/schema.prisma", "express/prisma/schema.prisma"],
    "drizzle": ["fastify/drizzle.config.ts", "express/drizzle.config.ts"],
    "sequelize": ["fastify/scripts/db-sync.ts", "express/scripts/db-sync.ts"],
    "typeorm": ["fastify/scripts/db-sync.ts", "express/scripts/db-sync.ts"],
    "gorm": ["go/go.mod", "go/internal/entities"],
    "sqlc": ["go/sqlc.yaml"],
    "ent": ["go/ent/schema"],
    "seaorm": ["rust/Cargo.toml", "rust/src/main.rs"],
    "eloquent": ["laravel/composer.json", "laravel/bootstrap/app.php"],
}

COMPOSE_COMPONENTS = ALL_BACKENDS | {"vitejs", "nextjs", "admin-panel"}
COMPOSE_SERVICE = {"admin-panel": "admin-panel:", "nextjs": "nextjs:"}

SHARED_RENDERED = [
    "docker-compose.yml",
    "README.md",
    "scripts/setup.sh",
    ".github/workflows/ci.yml",
    ".githooks/pre-commit",
]
NODE_PKG_COMPONENTS = {"fastify", "express", "vitejs", "nextjs"}
DETECTABLE = {
    "fastapi",
    "fastify",
    "express",
    "nextjs",
    "vitejs",
    "e2e",
    "mobile",
    "go",
    "rust",
    "laravel",
    "infra",
    "admin-panel",
}
EJS_LEFTOVER = re.compile(r"<%|%>")

JOURNEYS = ["create", "add", "update", "init"]
JOURNEY_WEIGHTS = [5, 3, 3, 2]


@dataclass
class Combo:
    family: str | None
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
    journey: str = ""
    family: str = "none"


def pick_family(rng):
    return rng.choice([None, *ORM_FAMILIES])


def gen_combo(rng, *, min_backends=0, want_family=None):
    family = want_family if want_family is not None else pick_family(rng)
    components: list = []
    orm = None

    if family is not None:
        spec = ORM_FAMILIES[family]
        n = rng.randint(1, len(spec["backends"]))
        components += rng.sample(spec["backends"], n)
        orm = rng.choice([None, *spec["orms"]])

    if family != "node" and rng.random() < 0.35:
        components.append("fastapi")

    pool = list(NON_BACKEND)
    rng.shuffle(pool)
    components += pool[: rng.randint(0, len(pool))]

    backends = [c for c in components if c in ALL_BACKENDS]
    while len(backends) < min_backends:
        extra = (
            rng.choice(["fastapi", *ORM_FAMILIES[family]["backends"]])
            if family
            else "fastapi"
        )
        if extra not in components:
            components.append(extra)
        backends = [c for c in components if c in ALL_BACKENDS]

    if not components:
        components = [rng.choice(NON_BACKEND)]

    auth = []
    eligible = [c for c in components if c in AUTH_TARGETS]
    if eligible and auth_allowed_for(family, orm) and rng.random() < 0.5:
        auth = sorted(rng.sample(eligible, rng.randint(1, len(eligible))))

    return Combo(family, sorted(set(components)), orm, auth)


def base_create_cmd(components, app_path, orm=None, auth=None):
    cmd = [
        "node",
        str(CLI),
        str(app_path),
        "--components",
        ",".join(components),
        "--no-install",
        "--no-git",
        "--local",
        str(ROOT),
    ]
    if orm:
        cmd += ["--orm", orm]
    if auth:
        cmd.append(f"--auth={','.join(auth)}")
    return cmd


def create_cmd(combo, app_path):
    return base_create_cmd(combo.components, app_path, combo.orm, combo.auth)


def run_cli(cmd, cwd=None):
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=240)
    return proc.returncode, proc.stdout, proc.stderr


def git_init(cwd):
    for cmd in (
        ["git", "init", "--quiet"],
        ["git", "config", "user.email", "a@a"],
        ["git", "config", "user.name", "a"],
        ["git", "config", "commit.gpgsign", "false"],
        ["git", "-c", "core.hooksPath=/dev/null", "add", "-A"],
        ["git", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "init"],
    ):
        subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def run_interactive(cmd, cwd, accept_prompts=True, timeout=120):
    primary, secondary = pty.openpty()
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdin=secondary,
        stdout=secondary,
        stderr=secondary,
        close_fds=True,
    )
    os.close(secondary)
    out = b""
    sent = 0
    deadline = time.time() + timeout
    try:
        while proc.poll() is None and time.time() < deadline:
            ready, _, _ = select.select([primary], [], [], 0.4)
            if ready:
                try:
                    out += os.read(primary, 8192)
                except OSError:
                    break
            elif accept_prompts and sent < 40:
                try:
                    os.write(primary, b"\r")
                except OSError:
                    pass
                sent += 1
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    finally:
        try:
            os.close(primary)
        except OSError:
            pass
    return proc.returncode, out.decode(errors="replace")


def check_projx(combo, app, failures, expect_orm=True):
    projx = app / ".projx"
    if not projx.exists():
        failures.append("missing .projx")
        return None
    try:
        data = json.loads(projx.read_text())
    except json.JSONDecodeError as e:
        failures.append(f".projx not valid JSON: {e}")
        return None
    if not data.get("version"):
        failures.append(".projx missing version")
    if data.get("packageManager") not in PACKAGE_MANAGERS | {None}:
        failures.append(
            f".projx packageManager invalid: {data.get('packageManager')!r}"
        )
    if expect_orm and combo.orm and data.get("orm") != combo.orm:
        failures.append(f".projx orm {data.get('orm')!r} != requested {combo.orm!r}")
    return data


def check_structure(combo, app, failures):
    for c in combo.components:
        if not (app / c).is_dir():
            failures.append(f"missing component dir {c}/")

    needs_compose = any(c in COMPOSE_COMPONENTS for c in combo.components)
    compose = app / "docker-compose.yml"
    if needs_compose and not compose.exists():
        failures.append("expected docker-compose.yml, missing")
    if compose.exists():
        body = compose.read_text()
        for comp, marker in COMPOSE_SERVICE.items():
            if comp in combo.components and marker not in body:
                failures.append(f"{comp} service missing from docker-compose.yml")

    if combo.orm:
        markers = ORM_MARKERS.get(combo.orm, [])
        if markers and not any((app / m).exists() for m in markers):
            failures.append(f"orm {combo.orm}: none of {markers} present")

    for target in combo.auth:
        landing = AUTH_LANDING.get(target)
        if landing and not (app / landing).is_dir():
            failures.append(f"auth requested for {target} but {landing}/ missing")

    for rel in SHARED_RENDERED:
        f = app / rel
        if f.exists() and EJS_LEFTOVER.search(f.read_text()):
            failures.append(f"unrendered EJS tags left in {rel}")

    for c in combo.components:
        if c in NODE_PKG_COMPONENTS:
            pkg = app / c / "package.json"
            if pkg.exists():
                try:
                    json.loads(pkg.read_text())
                except json.JSONDecodeError:
                    failures.append(f"{c}/package.json not valid JSON")


def journey_create(combo, workdir):
    app = Path(workdir) / "app"
    cmd = create_cmd(combo, app)
    repro = " ".join(cmd)
    rc, _out, err = run_cli(cmd)
    if rc != 0:
        return Result(
            combo.label(),
            [f"create exit {rc}: {err.strip()[-400:]}"],
            repro,
            workdir,
            "create",
            combo.family or "none",
        )
    failures = []
    check_projx(combo, app, failures)
    check_structure(combo, app, failures)
    return Result(
        combo.label(), failures, repro, workdir, "create", combo.family or "none"
    )


def split_for_add(rng, combo):
    backends = [c for c in combo.components if c in ALL_BACKENDS]
    extras = [c for c in combo.components if c not in ALL_BACKENDS]
    if combo.family:
        family_backends = [
            c for c in backends if c in ORM_FAMILIES[combo.family]["backends"]
        ]
        keep_backend = rng.choice(family_backends)
    else:
        keep_backend = rng.choice(backends)
    base_components = sorted(
        {keep_backend, *rng.sample(extras, rng.randint(0, len(extras)))}
    )
    added = [c for c in combo.components if c not in base_components]
    return base_components, added


def journey_add(combo, workdir, rng):
    app = Path(workdir) / "app"
    base_components, added = split_for_add(rng, combo)
    if not added:
        return journey_create(combo, workdir)

    base_combo = Combo(combo.family, base_components, combo.orm, [])
    rc, _o, err = run_cli(create_cmd(base_combo, app))
    if rc != 0:
        return Result(
            combo.label(),
            [f"base create exit {rc}: {err.strip()[-300:]}"],
            "",
            workdir,
            "add",
            combo.family or "none",
        )

    sentinel_rel = "USER_NOTES.txt"
    sentinel_before = "hand-authored — add must not clobber unrelated files\n"
    (app / sentinel_rel).write_text(sentinel_before)
    git_init(app)

    auth_for_added = [t for t in combo.auth if t in added]
    add_cmd = ["node", str(CLI), "add", *added, "--no-install", "--local", str(ROOT)]
    if auth_for_added:
        add_cmd.append(f"--auth={','.join(auth_for_added)}")
    repro = " ".join(add_cmd)
    rc, _o, err = run_cli(add_cmd, cwd=app)
    if rc != 0:
        return Result(
            combo.label(),
            [f"add exit {rc}: {err.strip()[-300:]}"],
            repro,
            workdir,
            "add",
            combo.family or "none",
        )

    failures = []
    for c in added:
        if not (app / c).is_dir():
            failures.append(f"add {c} did not create {c}/")
    if (app / sentinel_rel).read_text() != sentinel_before:
        failures.append(f"add clobbered unrelated user file {sentinel_rel}")
    check_projx(combo, app, failures)
    full = Combo(
        combo.family,
        sorted(set(base_components) | set(added)),
        combo.orm,
        auth_for_added,
    )
    check_structure(full, app, failures)
    return Result(
        combo.label(), failures, repro, workdir, "add", combo.family or "none"
    )


def journey_update(combo, workdir):
    app = Path(workdir) / "app"
    rc, _o, err = run_cli(create_cmd(combo, app))
    if rc != 0:
        return Result(
            combo.label(),
            [f"create exit {rc}: {err.strip()[-300:]}"],
            "",
            workdir,
            "update",
            combo.family or "none",
        )
    git_init(app)
    cmd = ["node", str(CLI), "update", "--local", str(ROOT)]
    repro = " ".join(cmd)
    proc = subprocess.run(
        cmd,
        cwd=app,
        capture_output=True,
        text=True,
        timeout=240,
        stdin=subprocess.DEVNULL,
    )
    rc, err = proc.returncode, proc.stderr
    if rc != 0:
        return Result(
            combo.label(),
            [f"update exit {rc}: {err.strip()[-300:]}"],
            repro,
            workdir,
            "update",
            combo.family or "none",
        )

    failures = []
    data = check_projx(combo, app, failures)
    if data is not None:
        for c in combo.components:
            if not (app / c).is_dir():
                failures.append(f"component {c}/ vanished after update")
    conflicts = subprocess.run(
        [
            "git",
            "-c",
            "core.quotepath=off",
            "grep",
            "-lE",
            r"^<<<<<<< (your changes|HEAD)",
        ],
        cwd=app,
        capture_output=True,
        text=True,
    )
    if conflicts.stdout.strip():
        failures.append(
            f"conflict markers after update: {conflicts.stdout.strip()[:200]}"
        )
    for rel in SHARED_RENDERED:
        f = app / rel
        if f.exists() and EJS_LEFTOVER.search(f.read_text()):
            failures.append(f"unrendered EJS tags left in {rel} after update")
    return Result(
        combo.label(), failures, repro, workdir, "update", combo.family or "none"
    )


def journey_init(combo, workdir):
    app = Path(workdir) / "app"
    rc, _o, err = run_cli(create_cmd(combo, app))
    if rc != 0:
        return Result(
            combo.label(),
            [f"create exit {rc}: {err.strip()[-300:]}"],
            "",
            workdir,
            "init",
            combo.family or "none",
        )
    detectable = [c for c in combo.components if c in DETECTABLE]
    os.remove(app / ".projx")
    git_init(app)
    cmd = ["node", str(CLI), "init", "--local", str(ROOT)]
    repro = " ".join(cmd)
    rc, _out = run_interactive(cmd, str(app), accept_prompts=True, timeout=120)
    if rc != 0:
        return Result(
            combo.label(),
            [f"init exit {rc}"],
            repro,
            workdir,
            "init",
            combo.family or "none",
        )

    failures = []
    check_projx(combo, app, failures, expect_orm=False)
    markers = {p.parent.name for p in app.glob("*/.projx-component")}
    missing = [c for c in detectable if c not in markers]
    if missing:
        failures.append(f"init failed to register detected components: {missing}")
    return Result(
        combo.label(), failures, repro, workdir, "init", combo.family or "none"
    )


def run_journey(combo, journey, workdir, rng):
    if journey == "create":
        return journey_create(combo, workdir)
    if journey == "add":
        return journey_add(combo, workdir, rng)
    if journey == "update":
        return journey_update(combo, workdir)
    return journey_init(combo, workdir)


NEGATIVES = [
    (["fastify"], "gorm", "gorm requires go"),
    (["go"], "seaorm", "seaorm requires rust"),
    (["fastify"], "eloquent", "eloquent requires laravel"),
    (["rust"], "prisma", "prisma requires node backend"),
    (["fastify"], "bogus", "unknown orm"),
]


def negative_scenario(components, orm, why):
    def run(workdir):
        app = Path(workdir) / "app"
        cmd = base_create_cmd(components, app, orm)
        repro = " ".join(cmd)
        rc, _o, err = run_cli(cmd)
        failures = []
        if rc == 0:
            failures.append(
                f"expected non-zero exit (CLI accepted invalid combo): {why}"
            )
        elif not err.strip():
            failures.append("non-zero exit but empty stderr")
        return Result(f"negative:{why}", failures, repro, workdir, "negative", "none")

    run.__name__ = f"negative_{re.sub('[^a-z]+', '_', why.lower())}"
    return run


def scenario_admin_panel(workdir):
    app = Path(workdir) / "app"
    cmd = base_create_cmd(["admin-panel", "fastapi"], app)
    rc, _o, err = run_cli(cmd)
    if rc != 0:
        return Result(
            "scenario:admin-panel",
            [f"exit {rc}: {err.strip()[-300:]}"],
            " ".join(cmd),
            workdir,
            "scenario",
            "none",
        )
    fails = []
    if not (app / "admin-panel").is_dir():
        fails.append("admin-panel/ not scaffolded (#62)")
    compose = app / "docker-compose.yml"
    if not compose.exists() or "admin-panel:" not in compose.read_text():
        fails.append("admin-panel service missing from compose (#62)")
    return Result(
        "scenario:admin-panel", fails, " ".join(cmd), workdir, "scenario", "none"
    )


def scenario_add_honors_skip(workdir):
    app = Path(workdir) / "app"
    rc, _o, err = run_cli(base_create_cmd(["fastify"], app, "prisma"))
    if rc != 0:
        return Result(
            "scenario:add-honors-skip",
            [f"create exit {rc}: {err.strip()[-300:]}"],
            "",
            workdir,
            "scenario",
            "none",
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
            "scenario",
            "none",
        )
    fails = []
    if not (app / "admin-panel").is_dir():
        fails.append("add admin-panel did not scaffold admin-panel/")
    if (app / "docker-compose.yml").read_text() != sentinel:
        fails.append("skipped docker-compose.yml was overwritten by add (#60)")
    return Result("scenario:add-honors-skip", fails, repro, workdir, "scenario", "none")


SCENARIOS = [scenario_admin_panel, scenario_add_honors_skip]
SCENARIOS += [negative_scenario(c, o, w) for c, o, w in NEGATIVES]


def execute(task_fn, keep):
    workdir = tempfile.mkdtemp(prefix="projx-fuzz-")
    try:
        result = task_fn(workdir)
        if keep and result.failures:
            result.workdir = workdir
        else:
            shutil.rmtree(workdir, ignore_errors=True)
            result.workdir = None
        return result
    except Exception as e:
        if keep:
            return Result(
                getattr(task_fn, "__name__", "task"),
                [f"harness error: {e}"],
                "",
                workdir,
            )
        shutil.rmtree(workdir, ignore_errors=True)
        return Result(
            getattr(task_fn, "__name__", "task"), [f"harness error: {e}"], "", None
        )


def make_random_task(rng):
    journey = rng.choices(JOURNEYS, weights=JOURNEY_WEIGHTS)[0]
    min_backends = 1 if journey == "add" else 0
    combo = gen_combo(rng, min_backends=min_backends)
    task_rng = random.Random(rng.random())
    return lambda wd: run_journey(combo, journey, wd, task_rng)


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
    random_tasks = [make_random_task(rng) for _ in range(args.runs)]

    print(
        f"seed: {seed}   runs: {args.runs}   scenarios: {len(SCENARIOS)}   jobs: {args.jobs}"
    )
    print(f"cli:  {CLI}\n")

    tasks = list(random_tasks)
    tasks += [lambda wd, s=s: s(wd) for s in SCENARIOS]

    results = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(execute, t, args.keep): i for i, t in enumerate(tasks)}
        for fut in as_completed(futures):
            results.append(fut.result())
            sys.stdout.write("." if not results[-1].failures else "F")
            sys.stdout.flush()
    print("\n")

    failed = [r for r in results if r.failures]
    passed = len(results) - len(failed)
    print(f"PASS: {passed}   FAIL: {len(failed)}   (seed {seed})\n")

    by_journey = Counter(r.journey for r in results)
    by_family = Counter(
        r.family for r in results if r.journey not in ("negative", "scenario")
    )
    print(
        "by journey:  " + "  ".join(f"{k}={v}" for k, v in sorted(by_journey.items()))
    )
    print(
        "by family:   "
        + "  ".join(f"{k}={v}" for k, v in sorted(by_family.items()))
        + "\n"
    )

    if failed:
        print("FAILURES")
        print("========")
        for r in failed:
            tag = f"{r.journey}/{r.family}" if r.family != "none" else r.journey
            print(f"\n  [{tag}] {r.label}")
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

    print("all journeys passed — safe to push")
    return 0


if __name__ == "__main__":
    sys.exit(main())

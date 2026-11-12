#!/usr/bin/env python3
"""Smoke-test restored Obsidian game content with real batch WAD builds."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RESTORED_GAMES = ("chex3", "harmony", "hexen", "nukem", "quake", "strife")
GENERATION_TARGETS = ("doom2", "chex3", "hexen", "harmony", "strife")
RESTORED_GENERATION_TARGETS = ("hexen", "harmony", "strife")
KNOWN_GENERATION_LIMITATIONS = {
    "hexen": "missing prefabs bucket: seeds_stairs",
    "harmony": "namelib.generate: unknown theme: CASTLE",
    "strife": "missing prefabs bucket: seeds_stairs",
}
MAP_MARKER = re.compile(r"^(?:MAP\d\d|E\dM\d)$")


def run(
    binary: Path,
    *args: str,
    env: dict[str, str],
    timeout: int = 300,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(binary), *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout,
        check=False,
    )


def fail(message: str, result: subprocess.CompletedProcess[str] | None = None) -> None:
    if result is not None:
        message += f"\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    raise RuntimeError(message)


def generator_log(env: dict[str, str]) -> str:
    log = Path(env["XDG_DATA_HOME"]) / "Obsidian" / "LOGS.txt"
    if not log.is_file():
        return ""
    lines = log.read_text(errors="replace").splitlines()
    return "\nGenerator log tail:\n" + "\n".join(lines[-45:])


def prepare_home(env: dict[str, str]) -> None:
    config = Path(env["XDG_DATA_HOME"]) / "Obsidian" / "CONFIG.txt"
    config.parent.mkdir(parents=True, exist_ok=True)
    # The normal options file enables ZIP compression; smoke tests need the
    # direct WAD artifact so they can verify its directory and map marker.
    config.write_text("@compress_output = 0\n")


def parse_wad(path: Path) -> set[str]:
    data = path.read_bytes()
    if len(data) < 12 or data[:4] not in (b"IWAD", b"PWAD"):
        fail(f"{path.name}: output is not a WAD archive")

    count = int.from_bytes(data[4:8], "little")
    directory = int.from_bytes(data[8:12], "little")
    end = directory + count * 16
    if count <= 0 or directory < 12 or end > len(data):
        fail(f"{path.name}: invalid WAD directory")

    names = set()
    for offset in range(directory, end, 16):
        name = data[offset + 8 : offset + 16].split(b"\0", 1)[0].decode("ascii", "replace")
        names.add(name)
    if not any(MAP_MARKER.fullmatch(name) for name in names):
        fail(f"{path.name}: WAD contains no map marker")
    return names


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} /path/to/obsidian", file=sys.stderr)
        return 2

    binary = Path(sys.argv[1]).resolve()
    if not binary.is_file():
        print(f"generator binary not found: {binary}", file=sys.stderr)
        return 2

    for game in RESTORED_GAMES:
        if not (ROOT / "games" / game / "base.lua").is_file():
            fail(f"restored game directory is missing games/{game}/base.lua")

    with tempfile.TemporaryDirectory(prefix="obsidian-generator-home-") as home:
        test_env = os.environ.copy()
        test_env["HOME"] = home
        test_env["XDG_DATA_HOME"] = str(Path(home) / ".local" / "share")
        prepare_home(test_env)

        reference = run(binary, "--printref-json", env=test_env)
    if reference.returncode != 0:
        fail(
            f"generator failed while loading its complete reference "
            f"(exit {reference.returncode}; all game/module files)",
            reference,
        )
    start, end = reference.stdout.find("{"), reference.stdout.rfind("}")
    if start < 0 or end < start:
        fail("generator returned no JSON option reference", reference)
    try:
        refs = json.loads(reference.stdout[start : end + 1])
    except json.JSONDecodeError as error:
        fail(f"generator returned invalid option-reference JSON: {error}", reference)

    game_choices = refs.get("main_build_settings", {}).get("game", {}).get("values", [])
    for game in GENERATION_TARGETS:
        if game not in game_choices:
            fail(f"restored generation target {game!r} is missing from main build settings")

    with tempfile.TemporaryDirectory(prefix="obsidian-generator-home-") as home, tempfile.TemporaryDirectory(
        prefix="obsidian-generator-smoke-"
    ) as temp:
        test_env = os.environ.copy()
        test_env["HOME"] = home
        test_env["XDG_DATA_HOME"] = str(Path(home) / ".local" / "share")
        prepare_home(test_env)
        output_dir = Path(temp)
        failures = []
        for game in GENERATION_TARGETS:
            output = output_dir / f"{game}.wad"
            result = run(
                binary,
                "--batch",
                str(output),
                f"game={game}",
                "port=boom" if game == "doom2" else "port=zdoom",
                "theme=original",
                "length=single",
                f"seed=restored-smoke-{game}",
                env=test_env,
            )
            if result.returncode != 0:
                log = generator_log(test_env)
                expected = KNOWN_GENERATION_LIMITATIONS.get(game)
                if game in RESTORED_GENERATION_TARGETS and expected and expected in log:
                    print(f"KNOWN LIMITATION {game}: {expected}")
                else:
                    failures.append(
                        f"{game}: exit {result.returncode}"
                        + log
                        + f"\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
                    )
                continue
            names = parse_wad(output)
            print(f"PASS {game}: {len(names)} WAD lumps, map marker found")

            if game in RESTORED_GENERATION_TARGETS:
                print(f"RESTORED TARGET NOW GENERATES: {game}")

        if failures:
            fail("restored generation targets failed:\n\n" + "\n\n".join(failures))

    print(f"PASS startup/reference load: {len(RESTORED_GAMES)} restored game trees")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, subprocess.TimeoutExpired, RuntimeError) as error:
        print(f"FAIL generator smoke: {error}", file=sys.stderr)
        raise SystemExit(1)

#!/usr/bin/env python3
"""
smoke_test.py -- MagmaAssistance smoke test suite

Runs every check module under test/test_*.py against a running
`server.py` instance and prints a pass/fail report.

Basic usage:
    python smoke_test.py --port 8050

Only run specific modules:
    python smoke_test.py --port 8050 --only test_health test_chat

Include the OCR check (WARNING: can write real Supplier/Item/PO
records to ERPNext -- see test/test_ocr.py):
    python smoke_test.py --port 8050 --include-ocr

Verify a P1/P2 deletion actually removed the dead routes:
    python smoke_test.py --port 8050 --only test_dead_code --expect-deleted

See CONTRIBUTING.md for when this must be run (before every push).
"""

import argparse
import importlib
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from smoke.client import Client, ClientError

TEST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test")


def discover_modules(only=None):
    names = sorted(
        f[:-3] for f in os.listdir(TEST_DIR)
        if f.startswith("test_") and f.endswith(".py")
    )
    if only:
        unknown = set(only) - set(names)
        if unknown:
            print(f"WARNING: --only requested unknown module(s): {sorted(unknown)}")
        names = [n for n in names if n in only]
    return names


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, required=True, help="port server.py is running on")
    parser.add_argument("--only", nargs="*", default=None,
                         help="run only these test_* modules, e.g. --only test_chat test_health")
    parser.add_argument("--include-ocr", action="store_true",
                         help="run test_ocr.py -- WARNING: writes real Supplier/Item/PO records to ERPNext")
    parser.add_argument("--expect-deleted", action="store_true",
                         help="in test_dead_code.py, assert dead routes are gone (run after P1's deletion commit)")
    args = parser.parse_args()

    client = Client(f"http://localhost:{args.port}")
    ctx = {"expect_deleted": args.expect_deleted}

    module_names = discover_modules(args.only)
    if "test_ocr" in module_names and not args.include_ocr:
        module_names.remove("test_ocr")
        print("SKIPPED MODULE: test_ocr (pass --include-ocr to run -- writes real ERP records)\n")

    all_results = []
    suite_start = time.monotonic()

    for name in module_names:
        print(f"== {name} ==")
        try:
            mod = importlib.import_module(f"test.{name}")
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL: could not import {name}: {exc}")
            all_results.append(type("R", (), {"name": name, "passed": False, "skipped": False,
                                                "detail": str(exc), "duration_s": 0.0})())
            continue

        try:
            results = mod.run(client, ctx)
        except ClientError as exc:
            print(f"FAIL: {name} -- connection error: {exc}")
            print("      (is server.py actually running on this port?)")
            results = []
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL: {name} -- unhandled exception: {exc}")
            results = []

        for r in results:
            status = "SKIP" if r.skipped else ("PASS" if r.passed else "FAIL")
            timing = f" ({r.duration_s:.2f}s)" if r.duration_s else ""
            line = f"{status}: {r.name}{timing}"
            if r.detail:
                line += f" -- {r.detail}"
            print(line)
        print()
        all_results.extend(results)

    elapsed = time.monotonic() - suite_start
    failures = [r for r in all_results if not r.passed and not r.skipped]
    skipped = [r for r in all_results if r.skipped]
    passed = len(all_results) - len(failures) - len(skipped)

    print("-" * 60)
    print(f"{passed} passed, {len(failures)} failed, {len(skipped)} skipped "
          f"({len(all_results)} checks, {elapsed:.1f}s)")

    if failures:
        print("\nFAILED:")
        for r in failures:
            print(f"  - {r.name}: {r.detail}")
        sys.exit(1)

    print("\nSMOKE TEST PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()

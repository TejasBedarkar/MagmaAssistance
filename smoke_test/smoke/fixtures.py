"""
smoke.fixtures

Paths to the static test files under test/test_cases/. These are
committed to the repo (not generated at runtime) so the suite has no
dependency on reportlab/Pillow/etc being installed on whatever machine
runs it.

Regenerate them with `python smoke_test.py --regenerate-fixtures` if
you ever need to change them (see generate_fixtures.py).
"""

import os

TEST_CASES_DIR = os.path.join(os.path.dirname(__file__), "..", "test", "test_cases")


def path(name: str) -> str:
    p = os.path.join(TEST_CASES_DIR, name)
    if not os.path.exists(p):
        raise FileNotFoundError(
            f"Fixture '{name}' not found at {p}. "
            "Run `python smoke_test.py --regenerate-fixtures` to create it."
        )
    return p


def read(name: str) -> bytes:
    with open(path(name), "rb") as f:
        return f.read()

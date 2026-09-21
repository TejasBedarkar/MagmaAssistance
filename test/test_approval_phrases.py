"""
test_approval_phrases.py
------------------------
Polite go-aheads count as approval; questions, corrections and refusals do not.
"""

import pytest

from agent.agent import _is_write_approval


@pytest.mark.parametrize("text", [
    "yes", "Yes, that's correct.", "Please proceed", "Kindly proceed", "can you proceed",
    "Confirm and proceed", "Okay please create this lead", "Yes please proceed", "go ahead",
])
def test_approvals(text):
    assert _is_write_approval(text)


@pytest.mark.parametrize("text", [
    "Please stop", "please", "don't proceed", "proceed but change the email", "Should I proceed?",
    "no", "yes but use a different address",
])
def test_not_approvals(text):
    assert not _is_write_approval(text)

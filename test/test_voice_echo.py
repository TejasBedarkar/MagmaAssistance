"""
test/test_voice_echo.py
------------------------
Tests for echo detection and suppression in the voice websocket handler (ws_voice.py).
"""

import time
from Voice.ws_voice import is_voice_echo, ALL_FILLER_PHRASES


def test_filler_phrases_detected_as_echo():
    now = time.monotonic()
    recent = []

    # All known fillers must be identified as echo even without history
    assert is_voice_echo("Setting that up in MagnaERP.", recent, now)
    assert is_voice_echo("setting that up in magmaerp", recent, now)
    assert is_voice_echo("Looking that up online.", recent, now)
    assert is_voice_echo("One moment.", recent, now)
    assert is_voice_echo("Checking your records.", recent, now)
    assert is_voice_echo("Working on it.", recent, now)


def test_recent_assistant_speech_detected_as_echo():
    now = 1000.0
    recent = [
        (998.0, "I have created the Customer Acme Corp with ID CUST-2026-0001."),
        (995.0, "Would you like me to create an Opportunity for this customer?"),
    ]

    # Exact match
    assert is_voice_echo("I have created the Customer Acme Corp with ID CUST-2026-0001.", recent, now)
    # Substring / partial match from microphone
    assert is_voice_echo("Customer Acme Corp with ID CUST-2026-0001", recent, now)
    assert is_voice_echo("create an Opportunity for this customer", recent, now)


def test_expired_speech_not_treated_as_echo():
    now = 1000.0
    # Spoken 20 seconds ago (max_age is 10s by default)
    recent = [
        (970.0, "Shall we create a new Lead?"),
    ]
    # Now user legitimately says: "create a new lead"
    # Since it's beyond max_age, it should not be blocked as an echo
    assert not is_voice_echo("create a new lead", recent, now, max_age=10.0)


def test_legitimate_user_speech_not_blocked():
    now = 1000.0
    recent = [
        (998.0, "I have verified your item prices and inventory stocks."),
    ]

    # Distinct user instructions must NOT be blocked
    assert not is_voice_echo("Proceed", recent, now)
    assert not is_voice_echo("Please proceed", recent, now)
    assert not is_voice_echo("Create a new quotation for customer XYZ", recent, now)
    assert not is_voice_echo("Yes, submit that sales order", recent, now)
    assert not is_voice_echo("Show me open leads", recent, now)


def test_spoken_answers_are_not_echo_of_the_confirmation_prompt():
    now = 1000.0
    recent = [
        (999.0, "Please confirm with a plain yes to proceed with creating the lead."),
        (998.0, "Here are the details of the lead I am about to create."),
    ]
    for answer in ["Yes", "yes please proceed", "Proceed", "Yes please proceed with creating the lead",
                   "go ahead", "No cancel that", "Okay please create this lead"]:
        assert not is_voice_echo(answer, recent, now), answer


def test_a_single_word_is_not_matched_against_a_filler():
    assert not is_voice_echo("records", [], 1000.0)
    assert not is_voice_echo("moment", [], 1000.0)

#!/usr/bin/env python3
"""Checks for ai_usage.py. Run: /usr/bin/python3 helpers/test_ai_usage.py

Covers the logic that has gone wrong before: grouping Antigravity's models,
showing a remembered Antigravity reading, and spotting a Claude rate limit.
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_usage as u  # noqa: E402

NOW = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)


def test_antigravity_groups():
    def model(label, fraction=None, reset="2026-11-21T18:00:00Z"):
        quota = {"resetTime": reset}
        if fraction is not None:  # Antigravity omits the field when it's 0
            quota["remainingFraction"] = fraction
        return {"label": label, "quotaInfo": quota}
    status = {"cascadeModelConfigData": {"clientModelConfigs": [
        model("Gemini 4 Argon (High)", 0.888),
        model("Orchestrator (Argon)", 0.888),      # Gemini, though its label doesn't say so
        model("Gemini 3.8 Flash (Low)", 1),
        {"label": "Gemini 4 Carbon", "quotaInfo": {}},  # no quota at all: not "used up"
        model("Claude Opus 5.5 (High)", 1),
        model("GPT-OSS 120B (Medium)", 0.5),
    ]}}
    got = {w["name"]: w["used"] for w in u.antigravity_windows(status)}
    assert got == {"Gemini": 11.2, "AG Claude": 50.0}, got


def test_antigravity_remembered_reading():
    with tempfile.TemporaryDirectory() as tmp:
        u.AG_CACHE = Path(tmp) / "antigravity.json"
        u.AG_CACHE.write_text(json.dumps({"id": "antigravity", "label": "Antigravity", "as_of": "2026-11-15T10:00:00Z",
            "windows": [{"name": "Gemini", "used": 40, "limit": 100, "resets_at": "2026-11-15T11:00:00Z"},
                        {"name": "AG Claude", "used": 70, "limit": 100, "resets_at": "2026-11-16T00:00:00Z"}]}))
        got = {w["name"]: (w["used"], w["resets_at"]) for w in u.antigravity_cached(NOW)["windows"]}
    # A reset that has passed reads as unused; one still ahead keeps its value.
    assert got == {"Gemini": (0, None), "AG Claude": (70, "2026-11-16T00:00:00Z")}, got


def test_claude_limit():
    with tempfile.TemporaryDirectory() as tmp:
        logs = Path(tmp) / "projects" / "p"
        logs.mkdir(parents=True)
        later = int((NOW + timedelta(hours=2)).timestamp())
        earlier = int((NOW - timedelta(hours=1)).timestamp())
        (logs / "s.jsonl").write_text("\n".join([
            '"not an object"',                          # odd lines are skipped, not fatal
            '{"quotaLimits": "garbage"}',
            json.dumps({"quotaLimits": {"status": "rejected", "resetsAt": earlier, "rateLimitType": "five_hour"}}),
            json.dumps({"quotaLimits": {"status": "rejected", "resetsAt": later, "rateLimitType": "seven_day"}}),
        ]) + "\n")
        os.utime(logs / "s.jsonl", (NOW.timestamp(), NOW.timestamp()))
        resets, kind = u.claude_limit([Path(tmp) / "projects"], NOW)
    assert (resets.timestamp(), kind) == (later, "seven_day"), (resets, kind)
    assert u.short_duration(timedelta(minutes=125)) == "2h"


if __name__ == "__main__":
    for name, check in list(globals().items()):
        if name.startswith("test_"):
            check()
            print(f"ok  {name}")

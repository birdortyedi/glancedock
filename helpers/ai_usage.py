#!/usr/bin/env python3
"""AI usage collector for Glance Dock.

Prints one JSON object to stdout:

    {"providers": [Provider, ...], "errors": [str, ...]}

    Provider = {"id": str, "label": str, "windows": [Window, ...]}
    Window   = {"name": str, "used": number, "limit": number | null,
                "unit": str, "resets_at": ISO-8601 | null,
                "exhaust_at": ISO-8601 | null}

Built in: Claude Code (rate-limit hits and today's tokens, from its logs),
Gemini CLI (requests today, from its logs) and Antigravity (live quota from
the running app, remembered while it's closed).
Extra sources: every executable in ~/.config/glancedock/providers/ is run and
must print one Provider object, or a list of them, as JSON.
"""
import argparse
import json
import os
import re
import subprocess
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

WEEK = timedelta(days=7)
# Don't project from the first few minutes of a session; the rate is noise.
MIN_ELAPSED = timedelta(minutes=10)
# Cache reads are left out: they are huge and would swamp the totals.
# Add "cache_read_input_tokens" here if you want them counted.
COUNTED = ("input_tokens", "output_tokens", "cache_creation_input_tokens")
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
PROVIDER_DIR = CONFIG / "glancedock" / "providers"
GEMINI_CHATS = Path.home() / ".gemini" / "tmp"
# Last Antigravity quota, shown (marked as old) while Antigravity is closed.
# What each Antigravity ring covers: models in a group share one quota.
AG_GROUPS = {"Gemini": "Gemini models in Antigravity", "AG Claude": "Claude and GPT-OSS models in Antigravity"}
AG_PLACEHOLDER = {"id": "antigravity", "label": "Antigravity", "placeholder": True, "windows": [{
    "name": "Gemini", "used": 0, "limit": None, "unit": "%", "resets_at": None, "exhaust_at": None,
    "label": "–", "detail": "Open Antigravity once to read your Gemini quota; the bar keeps the last reading after you close it."}]}
AG_CACHE = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "glancedock" / "antigravity.json"


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if dt else None


def parse_time(stamp):
    """Aware datetime from an ISO-8601 string, or None."""
    if not isinstance(stamp, str):
        return None
    try:
        t = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def claude_project_dirs():
    env = os.environ.get("CLAUDE_CONFIG_DIR")
    roots = [Path(p) for p in env.split(",")] if env else [
        Path.home() / ".config" / "claude",
        Path.home() / ".claude",
    ]
    return [r / "projects" for r in roots if (r / "projects").is_dir()]


def parse_entry(line, seen):
    """(timestamp, tokens) for one log line, or None. Skips duplicates."""
    try:
        entry = json.loads(line)
        message = entry.get("message") or {}
        usage = message.get("usage")
        stamp = entry.get("timestamp")
        if not usage or not stamp:
            return None
        key = (message.get("id"), entry.get("requestId"))
        if key != (None, None):
            if key in seen:
                return None
            seen.add(key)
        t = parse_time(stamp)
        return (t, sum(int(usage.get(k) or 0) for k in COUNTED)) if t else None
    except (ValueError, TypeError, AttributeError):
        return None


def read_claude_entries(dirs, since):
    seen, entries = set(), []
    for d in dirs:
        for path in d.rglob("*.jsonl"):
            try:
                if path.stat().st_mtime < since.timestamp():
                    continue
                with path.open(encoding="utf-8", errors="replace") as fh:
                    for line in fh:
                        if '"usage"' in line:
                            entry = parse_entry(line, seen)
                            if entry and entry[0] >= since:
                                entries.append(entry)
            except OSError:
                continue
    entries.sort(key=lambda e: e[0])
    return entries


def make_window(name, used, limit, start=None, resets_at=None, now=None, unit="tokens"):
    window = {
        "name": name, "used": used, "limit": limit or None, "unit": unit,
        "resets_at": iso(resets_at), "exhaust_at": None,
    }
    if limit and start and resets_at:
        if used >= limit:
            window["exhaust_at"] = iso(now)
        elif used > 0:
            elapsed = max((now - start).total_seconds(), MIN_ELAPSED.total_seconds())
            rate = used / elapsed
            window["exhaust_at"] = iso(now + timedelta(seconds=(limit - used) / rate))
    return window


def claude_limit(dirs, now):
    """(resets_at, kind) of the latest rate-limit hit still in force, or None.

    Claude Code logs quota details only when a request is refused, so this is
    the one plan-limit fact the logs hold.
    """
    latest = None
    for d in dirs:
        for path in d.rglob("*.jsonl"):
            try:
                if path.stat().st_mtime < (now - WEEK).timestamp():
                    continue
                with path.open(encoding="utf-8", errors="replace") as fh:
                    for line in fh:
                        if '"quotaLimits"' not in line:
                            continue
                        try:
                            quota = json.loads(line).get("quotaLimits") or {}
                        except ValueError:
                            continue
                        if quota.get("status") != "rejected" or not quota.get("resetsAt"):
                            continue
                        resets = datetime.fromtimestamp(quota["resetsAt"], timezone.utc)
                        if resets > now and (latest is None or resets > latest[0]):
                            latest = (resets, quota.get("rateLimitType") or "")
            except OSError:
                continue
    return latest


def short_duration(delta):
    mins = max(1, int(delta.total_seconds() // 60))
    return f"{mins // 60}h" if mins >= 60 else f"{mins}m"


def claude_provider(args, now):
    """A rate-limit watch: quiet until Claude refuses a request, then the reset time.

    Token counts can't tell how full the plan is (claude.ai chats share the
    limit but aren't logged), so they only go in the tooltip.
    """
    dirs = claude_project_dirs()
    if not dirs:
        return None
    midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    today = sum(t for _, t in read_claude_entries(dirs, midnight))
    tokens = f"{today:,} tokens in Claude Code today (claude.ai chats aren't logged)."
    window = {"name": "Claude", "used": 0, "limit": None, "unit": "%", "resets_at": None,
              "exhaust_at": None, "label": "ok", "detail": f"No limit hit. {tokens}"}
    limit = claude_limit(dirs, now)
    if limit:
        resets, kind = limit
        what = {"five_hour": "Session limit", "seven_day": "Weekly limit"}.get(kind, "Usage limit")
        window.update(used=100, limit=100, resets_at=iso(resets), exhaust_at=iso(now),
                      label=short_duration(resets - now), detail=f"{what} reached. {tokens}")
    return {"id": "claude-code", "label": "Claude", "windows": [window]}


def pacific_day(now):
    """Start and end of today in US Pacific time, when Google's daily quotas reset."""
    try:
        tz = ZoneInfo("America/Los_Angeles")
    except ZoneInfoNotFoundError:
        tz = timezone(timedelta(hours=-8))
    start = now.astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def read_gemini_replies(since):
    """Times of Gemini CLI model replies since `since`, or None if Gemini CLI isn't installed.

    Gemini CLI saves each chat to ~/.gemini/tmp/<project>/chats/session-*.json
    with a "messages" list; replies from the model have type "gemini".
    """
    if not GEMINI_CHATS.is_dir():
        return None
    times = []
    for path in GEMINI_CHATS.glob("*/chats/*.json"):
        try:
            if path.stat().st_mtime < since.timestamp():
                continue
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            continue
        messages = data.get("messages") if isinstance(data, dict) else None
        for message in messages or []:
            if isinstance(message, dict) and message.get("type") == "gemini":
                t = parse_time(message.get("timestamp"))
                if t and t >= since:
                    times.append(t)
    return sorted(times)


def gemini_provider(args, now):
    day_start, reset = pacific_day(now)
    replies = read_gemini_replies(day_start)
    if replies is None:
        return None
    first = replies[0] if replies else None
    window = make_window("Today", len(replies), args.gemini_daily_budget,
                         first, reset, now, unit="requests")
    return {"id": "gemini-cli", "label": "Gemini CLI", "windows": [window]}


def arg_value(args, flag):
    """Value of `--flag value` or `--flag=value` in an argument list."""
    for i, arg in enumerate(args):
        if arg == flag and i + 1 < len(args):
            return args[i + 1]
        if arg.startswith(flag + "="):
            return arg.split("=", 1)[1]
    return None


def antigravity_servers():
    """(pid, csrf token, port hint) for each running Antigravity language server.

    Antigravity starts a local language server that answers the same quota
    request its /usage panel makes. This isn't a documented interface, so it
    may change with an Antigravity update.
    """
    servers = []
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = [a.decode(errors="replace") for a in (proc / "cmdline").read_bytes().split(b"\0") if a]
        except OSError:
            continue
        if not args or "language_server" not in Path(args[0]).name:
            continue
        token = arg_value(args, "--csrf_token")
        if token:
            # Windsurf runs a similar server; prefer Antigravity's own.
            servers.append(("antigravity" not in " ".join(args).lower(), proc.name, token,
                            arg_value(args, "--extension_server_port")))
    return [s[1:] for s in sorted(servers)]


def listening_ports(pid):
    try:
        out = subprocess.run(["ss", "-ltnpH"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    ports = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) > 3 and re.search(rf"pid={pid}\b", line):
            ports.append(parts[3].rsplit(":", 1)[-1])
    return ports


def antigravity_status(port, token):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetUserStatus",
        data=json.dumps({"metadata": {"ideName": "antigravity", "extensionName": "antigravity",
                                      "locale": "en"}}).encode(),
        headers={"Content-Type": "application/json", "Connect-Protocol-Version": "1",
                 "X-Codeium-Csrf-Token": token},
        method="POST")
    # No proxy: an http_proxy setting would otherwise catch this local request.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=3) as response:
        return json.loads(response.read())


def antigravity_cached(now):
    """The last reading, with windows whose reset time has passed shown as unused."""
    try:
        provider = json.loads(AG_CACHE.read_text())
    except (OSError, ValueError):
        return None
    for window in provider.get("windows", []):
        resets = parse_time(window.get("resets_at"))
        if resets and resets <= now:
            window.update(used=0, resets_at=None)
    return provider


def antigravity_provider(args, now):
    servers = antigravity_servers()
    if not servers:
        # Antigravity isn't running: last reading, or a hint until there is one.
        return antigravity_cached(now) or AG_PLACEHOLDER
    status = None
    for pid, token, hint in servers:
        ports = [hint] if hint else []
        ports += [p for p in listening_ports(pid) if p not in ports]
        for port in ports:
            try:
                data = antigravity_status(port, token)
            except (OSError, ValueError):
                continue
            if isinstance(data, dict) and isinstance(data.get("userStatus"), dict):
                status = data["userStatus"]
                break
        if status:
            break
    if status is None:
        raise RuntimeError("Antigravity is running but didn't answer the quota request")

    # Models in a group share a five-hour and a weekly limit, so show the
    # tightest remaining quota in each group with its reset time.
    groups = {}
    configs = (status.get("cascadeModelConfigData") or {}).get("clientModelConfigs") or []
    for config in configs:
        quota = config.get("quotaInfo")
        if not isinstance(quota, dict) or not quota:
            continue  # an empty quota means the model has none, not that it's used up
        # Labels like "Orchestrator (Argon)" are Gemini too; only Claude and GPT are the other group.
        group = "AG Claude" if re.search(r"claude|gpt", str(config.get("label", "")), re.I) else "Gemini"
        remaining = float(quota.get("remainingFraction", 0))  # omitted when it's 0
        if group not in groups or remaining < groups[group][0]:
            groups[group] = (remaining, parse_time(quota.get("resetTime")))
    windows = [
        {**make_window(group, round((1 - remaining) * 100, 1), 100, resets_at=reset, unit="%"),
         "detail": AG_GROUPS[group]}
        for group, (remaining, reset) in sorted(groups.items(), key=lambda g: g[0] != "Gemini")
    ]
    if not windows:
        return None
    provider = {"id": "antigravity", "label": "Antigravity", "windows": windows}
    try:
        AG_CACHE.parent.mkdir(parents=True, exist_ok=True)
        AG_CACHE.write_text(json.dumps({**provider, "as_of": iso(now)}))
    except OSError:
        pass  # the cache is a nicety
    return provider


def custom_providers(errors):
    if not PROVIDER_DIR.is_dir():
        return []
    found = []
    for path in sorted(PROVIDER_DIR.iterdir()):
        if not (path.is_file() and os.access(path, os.X_OK)):
            continue
        try:
            result = subprocess.run([str(path)], capture_output=True, text=True, timeout=20, check=True)
            data = json.loads(result.stdout)
            found.extend(data if isinstance(data, list) else [data])
        except (OSError, subprocess.SubprocessError, ValueError) as e:
            errors.append(f"{path.name}: {e}")
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--gemini-daily-budget", type=float, default=0)
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    providers, errors = [], []
    sources = (("claude-code", claude_provider), ("gemini-cli", gemini_provider),
               ("antigravity", antigravity_provider))
    for name, source in sources:
        try:
            provider = source(args, now)
            if provider:
                providers.append(provider)
        except Exception as e:  # one broken source shouldn't blank the widget
            errors.append(f"{name}: {e}")
    providers += custom_providers(errors)
    print(json.dumps({"providers": providers, "errors": errors}))


if __name__ == "__main__":
    main()

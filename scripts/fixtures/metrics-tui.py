"""Actual compiled OpenCode TUI driven through a disposable PTY (requires pyte)."""
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time
import urllib.request

import pyte

def terminate(signum, _frame):
    raise SystemExit(128 + signum)


signal.signal(signal.SIGTERM, terminate)
connection = json.load(open(sys.argv[1]))
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 180, 0, 0))
screen = pyte.Screen(180, 60)
stream = pyte.Stream(screen)
env = {**connection["env"], "TERM": "xterm-256color", "COLORTERM": "truecolor"}
child = subprocess.Popen(
    ["opencode", "--server", connection["url"], "--session", connection["sessionId"], connection["project"]],
    cwd=connection["project"], env=env, stdin=slave, stdout=slave, stderr=slave,
    start_new_session=True,
)
os.close(slave)


def pump(seconds=1):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            stream.feed(data.decode("utf-8", errors="replace"))
            # Reply to public terminal capability/cursor queries.
            if b"\x1b[6n" in data:
                os.write(master, b"\x1b[1;1R")
            if b"\x1b[c" in data:
                os.write(master, b"\x1b[?1;2c")


def frame():
    return "\n".join(screen.display)


def expect(text):
    for _ in range(60):
        pump(0.2)
        if text in frame():
            return
    # Never print content from the session screen.
    raise AssertionError("TUI did not show " + text)


def key(value):
    os.write(master, value.encode())
    pump(0.7)


def counts():
    return json.load(urllib.request.urlopen(connection["url"] + "/__validation_counts"))


try:
    expect("CONTEXT GUARD")
    key("/context-guard")
    key("\r")
    expect("c charts")
    key("c")
    expect("Performance charts")
    expect("Live TPS")
    expect("1 hour")
    expect("c back")
    expect("q close")
    key("\x1b[C")
    expect("Avg model")
    assert "Live TPS" not in frame(), "one metric at a time"
    key("\x1b[D")
    expect("Live TPS")
    key("[")
    expect("5 minutes")
    key("]")
    expect("1 hour")
    key("\x1b[B")
    expect(connection["ids"][1])
    key(" ")
    key("\x1b[B")
    expect(connection["ids"][2])
    key("\x1b[A")
    expect(connection["ids"][1])
    before = counts()["history"]
    key("r")
    assert counts()["history"] > before, "refresh makes another history read"
    pump(5.5)
    urllib.request.urlopen(connection["url"] + "/__validation_delay").close()
    cancelled = counts()["cancelled"]
    key("r")
    before = counts()["history"]
    key("c")
    pump(1)
    assert counts()["cancelled"] > cancelled, "toggle aborts outstanding history request"
    pump(6)
    assert counts()["history"] == before, "toggle cancels history polling"
    key("c")
    expect("Performance charts")
    key("\x1b[A")
    expect(connection["ids"][0])
    urllib.request.urlopen(connection["url"] + "/__validation_delay").close()
    cancelled = counts()["cancelled"]
    key("r")
    key("q")
    pump(1)
    assert "Performance charts" not in frame(), "q closes the panel"
    assert counts()["cancelled"] > cancelled, "close aborts outstanding history request"
    before = counts()
    pump(16)
    after = counts()
    assert after["history"] == before["history"], "panel close cancels history polling"
    assert after["monitor"] > before["monitor"], "normal live monitoring still reconciles"
    print("PASS: actual PTY TUI slash, c, windows, arrows, refresh, toggle/close polling cleanup and continued live monitoring")
finally:
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=3)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
    os.close(master)

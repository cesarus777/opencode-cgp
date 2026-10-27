"""Drive only the standalone CLI. Captures contain scalar dashboard fields."""
import codecs
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

connection = json.load(open(sys.argv[1]))
master, slave = pty.openpty()
original = termios.tcgetattr(slave)
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 180, 0, 0))
screen = pyte.Screen(180, 50)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
env = {**connection["env"], "TERM": "xterm-256color", "CONTEXT_GUARD_PASSWORD": connection["password"]}
command = [connection["runtime"], connection["cli"], "dashboard", "tui", "--server", connection["url"], "--directory", connection["project"]]
child = subprocess.Popen(command, cwd=connection["project"], env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
output = ""


def pump(seconds=0.3):
    global output
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.05)[0]:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            text = decoder.decode(data)
            output += text
            assert connection["password"] not in output, "credential privacy"
            assert connection["canary"] not in output, "content privacy"
            stream.feed(text)
            if b"\x1b[6n" in data:
                os.write(master, b"\x1b[1;1R")
            if b"\x1b[c" in data:
                os.write(master, b"\x1b[?1;2c")


def frame():
    return "\n".join(screen.display)


def expect(text):
    for _ in range(150):
        pump(0.2)
        if text in " ".join(frame().split()):
            return
        assert child.poll() is None, "standalone CLI exited before expected screen"
    os.makedirs(os.path.dirname(connection["capture"]), exist_ok=True)
    with open(connection["capture"], "w") as capture:
        capture.write(frame())
    raise AssertionError("Standalone dashboard did not show " + text)


def key(value):
    os.write(master, value.encode())
    pump(0.4)


def action(name):
    with urllib.request.urlopen(connection["url"] + "/__test/" + name, timeout=45) as response:
        return json.load(response)


def resize(cols, rows):
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    screen.resize(rows, cols)
    os.killpg(child.pid, signal.SIGWINCH)
    pump(1)


try:
    expect("Context Guard")
    expect("monitored 3")
    expect("synthetic/beta")
    action("prompt")
    expect("performance streaming")
    expect("live TPS")
    key("2")
    expect("measurement.provenance: provider-normalized")
    key("\x1b[6~")
    expect("performance.")
    key("1")
    # Select root and both concurrent children by their full scalar identity.
    for session_id in connection["ids"]:
        key("/")
        key(session_id)
        key("\r")
        key("j")
        key("2")
        expect("Session ID: " + session_id)
        key("3")
        expect("History: ready")
        expect("Matched requests")
        baseline = action("counts")
        for name in ["Avg model", "Avg session", "TTFT", "Request throughput", "Cumulative output", "Live TPS"]:
            key("\x1b[C")
            expect(name)
        key("]")
        assert action("counts")["historyReads"] == baseline["historyReads"], "metric/sample changes must not read history"
        assert action("counts")["streams"] == baseline["streams"], "navigation must not add streams"
        key("1")
        key("/")
        # Clear search in the editor.
        key("\x7f" * len(session_id))
        key("\r")
    key("3")
    for minutes in [60, 1440, 10080, 5]:
        key("w")
        expect(str(minutes) + " minutes")
        expect("History: ready")
    key("?")
    expect("keyboard help")
    key("\x1b")
    resize(24, 12)
    expect("? help")
    resize(100, 36)
    key("1")
    action("stop")
    expect("stale")
    expect("pressure unknown")
    expect("prompt 1.2k/128.0k")
    action("start")
    key("r")
    expect("monitored 3")
    expect("live")
    pump(5)
    action("verify")
    key("3")
    key("r")
    expect("History: ready")
    expect("partial")
    key("q")
    child.wait(timeout=10)
    pump()
    assert child.returncode == 0, "normal quit status"
    restored = termios.tcgetattr(slave)
    assert restored[3] & (termios.ICANON | termios.ECHO) == original[3] & (termios.ICANON | termios.ECHO), "raw mode restored"
    assert "\x1b[?1049l" in output, "alternate screen restored"
    assert "\x1b[?25h" in output, "cursor restored"
    for exit_mode in ["ctrl-c", "sigterm"]:
        screen.reset()
        output = ""
        child = subprocess.Popen(command, cwd=connection["project"], env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        expect("monitored 3")
        if exit_mode == "ctrl-c":
            key("\x03")
        else:
            os.killpg(child.pid, signal.SIGTERM)
        for _ in range(50):
            pump(0.1)
            if child.poll() is not None:
                break
        child.wait(timeout=3)
        pump()
        assert child.returncode == 0, "signal shutdown status"
        assert termios.tcgetattr(slave)[3] == original[3], "signal raw mode restored"
        assert "\x1b[?1049l" in output and "\x1b[?25h" in output, "signal screen/cursor restored"
    print("PASS: standalone PTY navigation, all metrics/windows, root/children, resize, restart, privacy and restoration")
finally:
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    os.close(master)
    os.close(slave)

"""Actual compiled OpenCode TUI driven through a disposable PTY (requires pyte)."""
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

def terminate(signum, _frame):
    raise SystemExit(128 + signum)


signal.signal(signal.SIGTERM, terminate)
connection = json.load(open(sys.argv[1]))
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 180, 0, 0))
screen = pyte.Screen(180, 60)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
env = {**connection["env"], "TERM": "xterm-256color", "COLORTERM": "truecolor"}
child = subprocess.Popen(
    [connection.get("binary", "opencode"), "--server", connection["url"], "--session", connection["sessionId"], connection["project"]],
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
            stream.feed(decoder.decode(data))
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
    markers = {label: label in frame() for label in ["History: show", "History: hide", "CONTEXT GUARD", "Context history", "100%│", "SUBAGENTS"]}
    raise AssertionError("TUI did not show " + text + "; scalar UI markers: " + repr(markers))


def key(value):
    os.write(master, value.encode())
    pump(0.7)


def counts():
    return json.load(urllib.request.urlopen(connection["url"] + "/__validation_counts"))


def expect_count(name, baseline):
    for _ in range(30):
        if counts()[name] > baseline:
            return
        pump(0.1)
    raise AssertionError("Validation counter did not advance: " + name)


def context_action(action):
    urllib.request.urlopen(connection["url"] + "/__validation_context/" + action, timeout=40).close()
    pump(1)


def resize(cols, rows=60):
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    screen.resize(rows, cols)
    os.killpg(child.pid, signal.SIGWINCH)
    pump(2)


def expand_sidebar_history():
    if "History: hide" in frame():
        return
    expect("History: show")
    y = next(i for i, line in enumerate(screen.display) if "History: show" in line)
    x = screen.display[y].index("History: show") + 3
    # The existing public sidebar mouse action; terminal coordinates are one-based.
    key(f"\x1b[<0;{x + 1};{y + 1}M\x1b[<0;{x + 1};{y + 1}m")
    expect("History: hide")
    expect("100%│")


def capture_chart(name):
    # Retain only the scalar chart rectangle, never session messages or titles.
    from PIL import Image, ImageDraw, ImageFont
    # A prompt result can precede the next sidebar paint. Wait for chart geometry,
    # rather than accepting a percentage elsewhere on the host screen.
    for _ in range(60):
        if any("100%│" in line for line in screen.display):
            break
        pump(0.2)
    lines = screen.display
    top = next((i for i, line in enumerate(lines) if "100%│" in line), None)
    if top is None:
        markers = {label: label in frame() for label in ["History: show", "History: hide", "CONTEXT GUARD", "Context history"]}
        raise AssertionError("Chart unavailable after repaint: " + repr(markers))
    left = lines[top].index("100%│")
    bottom = next((i for i in range(top + 1, len(lines)) if "└" in lines[i] and "┘" in lines[i]), None)
    if bottom is None:
        # Debug geometry only: exclude all session text and provider content.
        import re
        geometry = [(i, [(m.start(), m.group()) for m in re.finditer(r"[│└┘─┈░█▁▂▃▄▅▆▇]+", line)]) for i, line in enumerate(lines) if "│" in line or "└" in line or "┘" in line]
        raise AssertionError("Incomplete chart rectangle: " + repr(geometry))
    right = lines[top].index("│", left + 5) + 1
    artifact_root = os.environ.get("GUARD_NATIVE_ARTIFACT_DIR", ".artifacts")
    os.makedirs(artifact_root, exist_ok=True)
    font_path = subprocess.check_output(["fc-match", "-f", "%{file}", "monospace"], text=True)
    font = ImageFont.truetype(font_path, 18)
    image = Image.new("RGB", ((right - left) * 12 + 24, (bottom - top + 1) * 24 + 24), "#101018")
    draw = ImageDraw.Draw(image)
    named = {"default": "#cccccc", "black": "#111111", "red": "#cc4444", "green": "#44cc44", "brown": "#cccc44", "blue": "#4444cc", "magenta": "#cc44cc", "cyan": "#44cccc", "white": "#cccccc"}
    for y in range(top, bottom + 1):
        for x in range(left, right):
            char = screen.buffer[y][x]
            color = named.get(char.fg, "#" + char.fg if len(char.fg) == 6 else "#cccccc")
            draw.text((12 + (x - left) * 12, 12 + (y - top) * 24), char.data, font=font, fill=color)
    image.save(os.path.join(artifact_root, "context-" + name + ".png"))
    with open(os.path.join(artifact_root, "context-" + name + ".txt"), "w") as output:
        output.write("\n".join(line[left:right].rstrip() for line in lines[top:bottom+1]))
    return [line[left:right] for line in lines[top:bottom+1]]


try:
    expect("CONTEXT GUARD")
    key("guard-keyboard-probe?")
    assert "Native OpenCode panel" not in frame(), "ordinary prompt typing does not open help"
    key("\x15")
    key("/context-guard")
    key("\r")
    expect("c charts")
    # The host normally allocates a narrow split panel even in this 180-column
    # terminal. Use its public fullscreen action to exercise the actual workspace.
    expect("fullscreen")
    y = next(i for i, line in enumerate(screen.display) if "fullscreen" in line)
    x = screen.display[y].index("fullscreen") + 2
    history_before_fullscreen = counts()["history"]
    key(f"\x1b[<0;{x + 1};{y + 1}M\x1b[<0;{x + 1};{y + 1}m")
    expect("Session family")
    expect("Performance")
    expect("split")
    assert counts()["history"] == history_before_fullscreen, "workspace adds no retained-history reads"
    key("?")
    expect("Native OpenCode panel")
    key("\x1b[F")
    expect("End of native panel help")
    key("\x1b")
    expect("c charts")
    key("c")
    expect("Performance charts")
    expect("Live TPS")
    expect("1 hour")
    expect("c back")
    expect("q close")
    before = counts()["history"]
    key("?")
    expect("Native OpenCode panel")
    key("r")
    key("c")
    pump(6)
    assert counts()["history"] == before, "help stops polling and consumes hidden-view shortcuts"
    key("?")
    expect("Performance charts")
    expect("Live TPS")
    expect("1 hour")
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
    key("c")
    key(" ")
    key("c")
    key("\x1b[B")
    expect(connection["ids"][2])
    key("\x1b[A")
    expect(connection["ids"][1])
    # History faults affect charts only; retry retains matching measurements.
    urllib.request.urlopen(connection["url"] + "/__validation_history/unsupported").close()
    key("r")
    expect("History service is unavailable")
    expect("Showing previous results")
    expect("last loaded")
    before = counts()["history"]
    pump(5.5)
    assert counts()["history"] == before, "missing history service pauses native polling"
    assert "private-history-error-canary" not in frame(), "history error privacy"
    urllib.request.urlopen(connection["url"] + "/__validation_history/none").close()
    key("r")
    expect("Live TPS")
    assert "Showing previous results" not in frame(), "successful retry clears stale warning"
    urllib.request.urlopen(connection["url"] + "/__validation_history/transient").close()
    key("r")
    expect("History could not be loaded")
    expect("Showing previous results")
    key("r")
    expect("Live TPS")
    assert "History could not be loaded" not in frame(), "retry recovers transient failure"
    urllib.request.urlopen(connection["url"] + "/__validation_delay").close()
    key("r")
    expect("History request timed out")
    expect("Showing previous results")
    key("r")
    expect("Live TPS")
    assert "History request timed out" not in frame(), "retry recovers timeout"
    print("PASS: native history missing capability, transient failure, timeout, retained results and retry")
    before = counts()["history"]
    key("r")
    assert counts()["history"] > before, "refresh makes another history read"
    pump(5.5)
    urllib.request.urlopen(connection["url"] + "/__validation_delay").close()
    cancelled = counts()["cancelled"]
    delayed = counts()["delayed"]
    key("r")
    expect_count("delayed", delayed)
    before = counts()["history"]
    key("c")
    pump(1)
    expect_count("cancelled", cancelled)
    pump(6)
    assert counts()["history"] == before, "toggle cancels history polling"
    key("c")
    expect("Performance charts")
    key("\x1b[A")
    expect(connection["ids"][0])
    urllib.request.urlopen(connection["url"] + "/__validation_delay").close()
    cancelled = counts()["cancelled"]
    delayed = counts()["delayed"]
    key("r")
    expect_count("delayed", delayed)
    key("q")
    pump(1)
    assert "Performance charts" not in frame(), "q closes the panel"
    expect_count("cancelled", cancelled)
    before = counts()
    pump(16)
    after = counts()
    assert after["history"] == before["history"], "panel close cancels history polling"
    assert after["monitor"] > before["monitor"], "normal live monitoring still reconciles"
    print("PASS: actual PTY TUI slash, c, windows, arrows, refresh, toggle/close polling cleanup and continued live monitoring")
    # Configured open binding works without slash/palette in the child composer.
    key("\x18")
    key("v")
    expect("c charts")
    key("\x1b[B")
    key("i")
    expect(connection["ids"][1])
    key("\r")
    expect("Context Guard: open panel")
    key("\x18")
    key("v")
    expect("c charts")
    key("i")
    expect(connection["ids"][1])
    key("i")
    if "Space expands" in frame():
        key(" ")
    key("\x1b[B")
    key("i")
    expect(connection["ids"][2])
    key("\r")
    expect("Context Guard: open panel")
    key("\x18")
    key("v")
    expect("c charts")
    key("i")
    expect(connection["ids"][2])
    key("i")
    key("\x1b[H")
    key("\r")
    expect("CONTEXT GUARD")
    print("PASS: configured keyboard entry on root/child/grandchild, help dispatch, history polling cleanup and preserved selection")
    expand_sidebar_history()
    context_action("grow")
    expect("70%")
    pump(4)
    expect("Dim = last known context")
    capture_chart("wide-pause")
    context_action("permission")
    pump(4)
    expect("70%")
    capture_chart("wide-permission")
    context_action("resume")
    pump(5)
    context_action("child")
    pump(4)
    expect("70%")
    capture_chart("wide-child")
    context_action("lower")
    expect("50%")
    capture_chart("wide-lower-held")
    key("/context-guard")
    key("\r")
    expect("c charts")
    key("i")
    expect("Context history")
    resize(80, 40)
    expect("100%")
    context_action("compact")
    expect("10.0%")
    capture_chart("narrow-compaction")
    resize(180, 60)
    expect("100%")
    pump(2)
    capture_chart("wide-compaction")
    key("q")
    expect("10%")
    expand_sidebar_history()
    sidebar_chart = capture_chart("wide-sidebar-compaction")
    assert any(char in sidebar_chart[2] for char in "▁▂▃▄▅▆▇█┈"), "70% history survives panel/sidebar remounts"
    assert "▇" in sidebar_chart[7], "10% post-compaction measurement remains visible"
    print("PASS: actual local OpenCode context plateau, child activity, lower reported usage and manual compaction; 180/80-column scalar chart captures")

finally:
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=3)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
    os.close(master)

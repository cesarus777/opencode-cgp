"""Check a controlled pre-takeover CLI failure in an actual PTY."""
import os
import pty
import select
import subprocess
import sys
import termios
import time

master, slave = pty.openpty()
original = termios.tcgetattr(slave)
child = subprocess.Popen(
    [sys.argv[1], sys.argv[2], "dashboard", "tui", "--server", "ftp://invalid.test", "--directory", "/package-test"],
    stdin=slave, stdout=slave, stderr=slave,
)
captured = b""
try:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            captured += os.read(master, 65536)
        if child.poll() is not None:
            break
    assert child.wait(timeout=2) == 1
    assert sys.argv[3].encode() in captured, "expected actionable error"
    assert b"\x1b[?1049h" not in captured, "failure must precede terminal takeover"
    assert termios.tcgetattr(slave) == original, "terminal modes preserved"
    print("PASS: installed dashboard preflight error and untouched terminal")
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
    os.close(slave)

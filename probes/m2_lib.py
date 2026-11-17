# README: shared helpers for the milestone 2 probes P11 to P15 (Python 3 standard library, builds on stage2_lib.py). Not run directly. Adds folder-trust handling: a fresh directory under probes/work/ can raise the trust dialog, which is answered with Down and Enter ("Yes, I trust this folder").
from stage2_lib import *

def start_pty2(args, cwd, log, raw=None, ready_event='SessionStart'):
    if raw: open(raw, 'wb').close()
    open(log, 'w').close()
    p = Pty(['--model', 'haiku', '--setting-sources', 'user'] + args, cwd=cwd, rawlog=raw)
    deadline = time.time() + 40; trusted = False
    while time.time() < deadline and count(log, ready_event) == 0:
        p.pump(0.3)
        if not trusted and 'Quicksafetycheck' in p.text().replace(' ', ''):
            p.send(b'\x1b[B'); p.pump(0.5); p.send('\r'); trusted = True
    p.trust_dialog_answered = trusted
    time.sleep(2.0); p.pump(0.5)
    return p

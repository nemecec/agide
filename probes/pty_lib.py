# README: shared PTY helper for the interactive-mode probes (Python 3 standard library only). Not run directly.
import os, pty, re, select, signal, shutil, struct, fcntl, termios, time, json, sys
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
OUT = os.path.join(HERE, 'out')
CLAUDE = os.environ.get('CLAUDE_BIN') or shutil.which('claude') or 'claude'
os.makedirs(OUT, exist_ok=True); os.makedirs(WORK, exist_ok=True)
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]')
DROP = re.compile(r'^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_JOB_DIR|CLAUDE_PID|CLAUDE_AGENTS_.*|CLAUDE_EFFORT|AI_AGENT)$')

def clean_env(extra=None):
    env = {k: v for k, v in os.environ.items() if not DROP.match(k)}
    env['TERM'] = 'xterm-256color'
    env.update(extra or {})
    return env

class Pty:
    def __init__(self, args, cwd=WORK, env=None, rows=45, cols=140, rawlog=None):
        self.raw = b''; self.rawlog = rawlog
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(cwd)
            os.execve(CLAUDE, [CLAUDE] + args, clean_env(env))
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        self.exited = None

    def pump(self, secs=0.3):
        end = time.time() + secs
        while time.time() < end:
            r, _, _ = select.select([self.fd], [], [], 0.05)
            if r:
                try: d = os.read(self.fd, 65536)
                except OSError: d = b''
                if not d: self._reap(); return
                self.raw += d
                if self.rawlog: open(self.rawlog, 'ab').write(d)

    def _reap(self):
        if self.exited is None:
            try:
                p, st = os.waitpid(self.pid, os.WNOHANG)
                if p: self.exited = os.waitstatus_to_exitcode(st)
            except ChildProcessError: self.exited = -1

    def text(self, tail=None):
        t = re.sub(r'\x1b\[(\d*)C', lambda m: ' ' * int(m.group(1) or 1), self.raw.decode('utf-8', 'replace'))
        t = ANSI.sub('', t)
        return t[-tail:] if tail else t

    def wait_for(self, pattern, timeout=30, since=0):
        rx = re.compile(pattern, re.S | re.I)
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.25)
            m = rx.search(self.text()[since:])
            if m: return m
            if self.exited is not None: return None
        return None

    def mark(self): return len(self.text())

    def type(self, s, delay=0.01):
        for ch in s:
            os.write(self.fd, ch.encode()); time.sleep(delay)

    def send(self, b):
        os.write(self.fd, b if isinstance(b, bytes) else b.encode())

    def close(self):
        try: os.kill(self.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        self.pump(0.5); self._reap()
        if self.exited is None:
            try: os.kill(self.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            time.sleep(0.2); self._reap()

def read_jsonl(path):
    out = []
    if os.path.exists(path):
        for l in open(path):
            l = l.strip()
            if l:
                try: out.append(json.loads(l))
                except Exception: out.append({'_unparsed': l[:200]})
    return out

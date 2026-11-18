# README: shared PTY helper for p17_container.py and p18_openshell.py (Python 3 standard library). Not run directly.
import fcntl, os, pty, select, struct, termios, time
from pty_lib import ANSI, clean_env

class Term:
    def __init__(self, argv, rows=40, cols=120):
        self.raw = b''; self.t0 = time.time()
        self.pid, self.fd = pty.fork()
        if self.pid == 0: os.execvpe(argv[0], argv, clean_env())
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        self.exited = None
    def pump(self, secs=0.3):
        end = time.time() + secs
        while time.time() < end:
            r, _, _ = select.select([self.fd], [], [], 0.05)
            if r:
                try: d = os.read(self.fd, 65536)
                except OSError: d = b''
                if not d:
                    try:
                        p, st = os.waitpid(self.pid, os.WNOHANG)
                        if p: self.exited = os.waitstatus_to_exitcode(st)
                    except ChildProcessError: self.exited = -1
                    return
                self.raw += d
    def text(self): return ANSI.sub('', self.raw.decode('utf-8', 'replace'))
    def wait_for(self, s, timeout=20):
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.1)
            if s in self.text(): return round(time.time() - self.t0, 2)
        return None
    def send(self, b): os.write(self.fd, b if isinstance(b, bytes) else b.encode())
    def resize(self, rows, cols): fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

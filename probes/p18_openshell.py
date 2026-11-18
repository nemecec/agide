# README: python3 p18_openshell.py  -- I3: OpenShell (CLI and gateway from a checksummed release tarball under a temporary prefix, Docker driver, local images only). Expects a running gateway and the prefix named by OSH_DIR (default: the path in /tmp/agide-osh-dir.txt, which holds env.sh with the XDG variables). Creates one sandbox from alpine:latest with a custom policy, uploads the fake claude (fixtures/fake_claude.sh), runs it through `sandbox exec --tty` in a Python PTY and checks start latency, resize, Ctrl-C, hook events retrieved with `sandbox download`, host MCP reachability through the policy, a blocked destination, a canary host environment variable that must not appear, SIGTERM of the CLI client and teardown. Deletes the sandbox at the end.
import json, os, shutil, signal, subprocess, sys, tempfile, time
from pty_lib import HERE, OUT
from p17_container_lib import Term

OSH_DIR = os.environ.get('OSH_DIR') or open('/tmp/agide-osh-dir.txt').read().strip()
OSH = os.path.join(OSH_DIR, 'prefix/bin/openshell')
ENV = {**os.environ, 'OPENSHELL_TELEMETRY_ENABLED': 'false', 'XDG_CONFIG_HOME': f'{OSH_DIR}/cfg', 'XDG_DATA_HOME': f'{OSH_DIR}/data', 'XDG_STATE_HOME': f'{OSH_DIR}/state',
       'OPENSHELL_LOCAL_TLS_DIR': f'{OSH_DIR}/state/tls', 'AGIDE_CANARY_SECRET': 'canary-value', 'ANTHROPIC_API_KEY': 'canary-key'}
NAME = 'agide-i3'

def osh(*a, timeout=120, check=False):
    t = time.time(); r = subprocess.run([OSH, *a], capture_output=True, text=True, env=ENV, stdin=subprocess.DEVNULL, timeout=timeout)
    r.elapsed = round(time.time() - t, 2); return r

def main():
    report = {'cli': osh('--version').stdout.strip()}
    base = tempfile.mkdtemp(prefix='agide-i3.', dir='/tmp')
    host = subprocess.Popen(['node', os.path.join(HERE, 'mcp_host.mjs'), '--serve', '--allow-host', 'host.openshell.internal', '--log', f'{base}/mcp.jsonl'], stdout=subprocess.PIPE, text=True, env=ENV)
    info = json.loads(host.stdout.readline()); port = info['url'].split(':')[2].split('/')[0]
    policy = f'''version: 1
filesystem_policy:
  include_workdir: true
  read_only: [/bin, /usr, /lib, /proc, /dev/urandom, /etc, /var/log]
  read_write: [/tmp, /dev/null]
landlock:
  compatibility: best_effort
network_policies:
  host_mcp:
    endpoints:
      - host: host.openshell.internal
        port: {port}
    binaries:
      - path: /bin/busybox
'''
    open(f'{base}/policy.yaml', 'w').write(policy)
    shutil.copy(os.path.join(HERE, 'fixtures/fake_claude.sh'), base); shutil.copy(os.path.join(HERE, 'fixtures/hook_events.sh'), base)
    try:
        osh('sandbox', 'delete', NAME)
        r = osh('sandbox', 'create', '--name', NAME, '--from', 'alpine:latest', '--policy', f'{base}/policy.yaml', '--detach')
        report['create_detach_s'] = r.elapsed; report['create_rc'] = r.returncode; report['create_tail'] = (r.stdout + r.stderr).strip().splitlines()[-3:]
        t0 = time.time(); phase = ''
        while time.time() - t0 < 60:
            lst = osh('sandbox', 'list').stdout
            phase = [l.split()[-1] for l in lst.splitlines() if l.startswith(NAME)]
            if phase and phase[0] == 'Ready': break
            time.sleep(0.5)
        report['create_to_ready_s'] = round(r.elapsed + time.time() - t0, 2); report['phase'] = phase
        up = osh('sandbox', 'upload', NAME, f'{base}/fake_claude.sh', '/sandbox'); osh('sandbox', 'upload', NAME, f'{base}/hook_events.sh', '/sandbox')
        report['upload_s'] = up.elapsed
        ex = osh('sandbox', 'exec', '-n', NAME, '--no-tty', '--', 'sh', '-c', 'id -u; env | grep -c -E "CANARY|ANTHROPIC" ; mkdir -p /sandbox/events; for p in /etc /sandbox /tmp /usr; do touch $p/x 2>/dev/null && echo write-ok:$p || echo write-denied:$p; done')
        report['exec_s'] = ex.elapsed; report['inner_checks'] = ex.stdout.split()
        pty_env = ['--env', 'FAKE_EVENTS_DIR=/sandbox/events', '--env', 'FAKE_HOOK_CMD=sh /sandbox/hook_events.sh', '--env', 'FAKE_SESSION_ID=sess-3',
                   '--env', f'MCP_URL=http://host.openshell.internal:{port}/mcp', '--env', f'MCP_TOKEN={info["token"]}', '--env', 'TERM=xterm-256color']
        argv = [OSH, 'sandbox', 'exec', '-n', NAME, '--tty', *pty_env, '--', 'sh', '/sandbox/fake_claude.sh']
        saved = os.environ.copy(); os.environ.update(ENV)
        t = Term(argv, rows=40, cols=120)
        report['pty_ready_s'] = t.wait_for('fake-claude ready', 30); report['initial_size_line'] = [l for l in t.text().splitlines() if 'size=' in l][:1]
        t.send('hello\r'); report['echo_ok'] = t.wait_for('echo: hello', 10) is not None
        t.send('/mcp\r'); t.wait_for('mcp-initialize:', 15); report['mcp'] = [l[:110] for l in t.text().splitlines() if 'mcp-initialize' in l][-1:]
        t.resize(30, 100); report['resize_seen'] = t.wait_for('size=100x30', 8) is not None
        t.send(b'\x03'); report['ctrl_c_seen'] = t.wait_for('interrupted', 8) is not None
        os.makedirs(f'{base}/dl', exist_ok=True)
        dl = osh('sandbox', 'download', NAME, '/sandbox/events/hooks.jsonl', f'{base}/dl')
        hooks = []
        for root, _, files in os.walk(f'{base}/dl'):
            for f in files:
                if f == 'hooks.jsonl': hooks = [json.loads(l) for l in open(os.path.join(root, f)) if l.strip()]
        report['hook_events_downloaded'] = [h['hook_event_name'] for h in hooks]
        report['download_rc'] = dl.returncode; report['download_err'] = (dl.stderr + dl.stdout).strip()[-200:]
        t.send('/exit\r'); t.pump(3)
        report['exit_after_slash_exit'] = t.exited
        # SIGTERM to the CLI client while the inner process runs
        t2 = Term(argv, rows=40, cols=120); t2.wait_for('fake-claude ready', 30); t2.pump(0.5)
        os.kill(t2.pid, signal.SIGTERM); t0 = time.time()
        while t2.exited is None and time.time() - t0 < 15: t2.pump(0.3)
        report['sigterm_client_exit'] = t2.exited; report['sigterm_to_exit_s'] = round(time.time() - t0, 2)
        time.sleep(1)
        alive = osh('sandbox', 'exec', '-n', NAME, '--no-tty', '--', 'sh', '-c', 'ps -o pid,args | grep "[s]h /sandbox/fake_claude" | wc -l')
        report['fake_claude_processes_left_after_client_sigterm'] = alive.stdout.strip()
        os.environ.clear(); os.environ.update(saved)
        # blocked destinations from the sandbox
        blk = osh('sandbox', 'exec', '-n', NAME, '--no-tty', '--', 'sh', '-c', f'wget -q -T 6 -O /dev/null http://example.com && echo example-reachable || echo example-denied; wget -q -T 6 -O /dev/null http://host.openshell.internal:17670/ && echo gateway-reachable || echo gateway-denied')
        report['blocked_destinations'] = blk.stdout.split()
        # connect to the main process (a shell) through a PTY
        os.environ.update(ENV)
        t3 = Term([OSH, 'sandbox', 'connect', NAME], rows=40, cols=120)
        t3.pump(4); t3.send('echo connected-$((6*7))\r'); report['connect_shell_works'] = t3.wait_for('connected-42', 8) is not None
        t3.send('stty size\r'); t3.pump(1); report['connect_stty_size'] = [l for l in t3.text().splitlines() if l.strip() in ('40 120',)]
        t3.resize(30, 100); t3.pump(0.5); t3.send('stty size\r'); report['connect_resize'] = t3.wait_for('30 100', 6) is not None
        t3.send(b'\x04'); t3.pump(2)
        os.environ.clear(); os.environ.update(saved)
        report['mcp_calls_seen_by_host'] = [json.loads(l).get('method') for l in open(f'{base}/mcp.jsonl') if json.loads(l).get('kind') == 'rpc']
    except Exception as e:
        report['error'] = repr(e)
    finally:
        host.terminate()
        d = osh('sandbox', 'delete', NAME); report['delete_s'] = d.elapsed
        report['sandbox_listed_after_delete'] = NAME in osh('sandbox', 'list').stdout
        left = subprocess.run(['docker', 'ps', '-a', '--format', '{{.Names}}'], capture_output=True, text=True).stdout.split()
        report['containers_left_for_sandbox'] = [n for n in left if NAME in n]
        shutil.rmtree(base, ignore_errors=True)
    json.dump(report, open(os.path.join(OUT, 'p18_report.json'), 'w'), indent=1)
    print(json.dumps(report, indent=1))

main()

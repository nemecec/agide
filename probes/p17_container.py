# README: python3 p17_container.py  -- I2: the fake claude (fixtures/fake_claude.sh) on alpine in a Docker container, started through a Python PTY with the docker CLI. Checks: hook events through a mounted events directory, the host MCP server (mcp_host.mjs) through host.docker.internal with a bearer token, bind-mounted workspace and configuration directory with ownership, PTY resize, Ctrl-C, SIGTERM and SIGKILL of the docker client, start latency, teardown. Temporary files live under /tmp/agide-i2.*; containers carry the label agide-probe=2 and are removed at the end. Needs Docker and the local alpine image; pulls nothing.
import json, os, shutil, signal, struct, fcntl, termios, subprocess, sys, tempfile, time, pty, select
from pty_lib import HERE, OUT, clean_env, read_jsonl
from p17_container_lib import Term

LABEL = 'agide-probe=2'
def sh(*a, **k): return subprocess.run(list(a), capture_output=True, text=True, **k)

def main():
    base = os.path.realpath(tempfile.mkdtemp(prefix='agide-i2.', dir='/tmp'))
    ev, ws, cfg, bin_ = (os.path.join(base, n) for n in ('events', 'workspace', 'claude', 'bin'))
    for d in (ev, ws, cfg, bin_): os.makedirs(d)
    for f in ('fake_claude.sh', 'hook_events.sh'): shutil.copy(os.path.join(HERE, 'fixtures', f), bin_)
    hlog = os.path.join(base, 'host.jsonl')
    host = subprocess.Popen(['node', os.path.join(HERE, 'mcp_host.mjs'), '--serve', '--log', hlog, '--allow-host', 'host.docker.internal'], stdout=subprocess.PIPE, text=True)
    info = json.loads(host.stdout.readline()); port = info['url'].split(':')[2].split('/')[0]
    mcp_url = f'http://host.docker.internal:{port}/mcp'
    uid, gid = os.getuid(), os.getgid()
    report = {'docker': sh('docker', 'version', '--format', '{{.Server.Version}}').stdout.strip(), 'image': 'alpine:latest'}
    def argv(name, user):
        a = ['docker', 'run', '-it', '--rm', '--name', name, '--label', LABEL, '-v', f'{ev}:/events', '-v', f'{ws}:/workspace', '-v', f'{cfg}:/claude', '-v', f'{bin_}:/agide:ro',
             '-w', '/workspace', '-e', 'FAKE_EVENTS_DIR=/events', '-e', 'FAKE_HOOK_CMD=/agide/hook_events.sh', '-e', 'FAKE_SESSION_ID=sess-1', '-e', 'CLAUDE_CONFIG_DIR=/claude',
             '-e', f'MCP_URL={mcp_url}', '-e', f'MCP_TOKEN={info["token"]}', '-e', 'TERM=xterm-256color']
        if user: a += ['--user', f'{uid}:{gid}']
        return a + ['alpine', 'sh', '/agide/fake_claude.sh']
    try:
        # latency over repeated cold-process starts (image already local)
        lat = []
        for i in range(3):
            t = Term(argv(f'agide-i2-lat{i}', True)); lat.append(t.wait_for('fake-claude ready')); t.send('/exit\r'); t.pump(2); 
            while t.exited is None: t.pump(0.5)
        report['start_to_ready_s'] = lat
        # main session as host user
        name = 'agide-i2-main'; t = Term(argv(name, True))
        report['ready_s'] = t.wait_for('fake-claude ready'); report['initial_size_line'] = [l for l in t.text().splitlines() if 'size=' in l][:1]
        t.send('hello\r'); report['echo_ok'] = t.wait_for('echo: hello') is not None
        t.send('/who\r'); t.wait_for('owner='); report['who'] = [l for l in t.text().splitlines() if l.startswith('uid=')][-1:]
        t.send('/mcp\r'); t.wait_for('mcp-initialize:'); report['mcp'] = [l for l in t.text().splitlines() if 'mcp-initialize' in l][-1:]
        t.resize(30, 100); report['resize_seen'] = t.wait_for('size=100x30', 5) is not None
        t.send(b'\x03'); report['ctrl_c_seen'] = t.wait_for('interrupted', 5) is not None
        hooks = read_jsonl(os.path.join(ev, 'hooks.jsonl'))
        report['hook_events_on_host'] = [h['hook_event_name'] for h in hooks]
        report['events_owner_is_host_user'] = os.stat(os.path.join(ev, 'hooks.jsonl')).st_uid == uid
        # workspace and config ownership
        ex = sh('docker', 'exec', name, 'sh', '-c', 'echo made-in-container > /workspace/c.txt; echo cfg > /claude/c.txt'); report['exec_in_container'] = [ex.returncode, ex.stderr.strip()[:200]]
        report['container_alive_after_ctrl_c'] = bool(sh('docker', 'ps', '-q', '--filter', f'name={name}').stdout.strip())
        report['ws_file_owner_is_host_user'] = os.stat(os.path.join(ws, 'c.txt')).st_uid == uid
        open(os.path.join(ws, 'h.txt'), 'w').write('made-on-host')
        report['host_file_readable_in_container'] = sh('docker', 'exec', name, 'cat', '/workspace/h.txt').stdout.strip()
        report['container_can_overwrite_host_file'] = sh('docker', 'exec', name, 'sh', '-c', 'echo x >> /workspace/h.txt').returncode == 0
        report['config_dir_owner_uid_inside'] = sh('docker', 'exec', name, 'stat', '-c', '%u', '/claude').stdout.strip()
        # SIGKILL of the docker client leaves the container
        os.kill(t.pid, signal.SIGKILL); t.pump(1)
        try: os.waitpid(t.pid, 0)
        except ChildProcessError: pass
        time.sleep(1.5)
        report['after_client_sigkill_container_running'] = bool(sh('docker', 'ps', '-q', '--filter', f'name={name}').stdout.strip())
        pid_in = open(os.path.join(ev, 'pid')).read().strip()
        r = sh('docker', 'exec', name, 'kill', '-TERM', pid_in)
        time.sleep(2)
        report['pidfile_kill_term_ended_container'] = not sh('docker', 'ps', '-q', '--filter', f'name={name}').stdout.strip()
        report['sessionend_from_pidfile_kill'] = 'SessionEnd' in [h['hook_event_name'] for h in read_jsonl(os.path.join(ev, 'hooks.jsonl'))][-2:]
        # SIGTERM to the docker client is proxied to the container
        open(os.path.join(ev, 'hooks.jsonl'), 'w').close()
        t = Term(argv('agide-i2-term', True)); t.wait_for('fake-claude ready'); t.pump(0.5)
        t0 = time.time(); os.kill(t.pid, signal.SIGTERM)
        while t.exited is None and time.time() - t0 < 15: t.pump(0.3)
        report['sigterm_client_exit_code'] = t.exited; report['sigterm_to_exit_s'] = round(time.time() - t0, 2)
        report['sigterm_ran_sessionend'] = 'SessionEnd' in [h['hook_event_name'] for h in read_jsonl(os.path.join(ev, 'hooks.jsonl'))]
        # root user case: ownership of files created in the bind mounts
        t = Term(argv('agide-i2-root', False)); t.wait_for('fake-claude ready')
        t.send('/who\r'); t.wait_for('owner='); report['root_who'] = [l for l in t.text().splitlines() if l.startswith('uid=')][-1:]
        sh('docker', 'exec', 'agide-i2-root', 'sh', '-c', 'echo r > /workspace/root.txt')
        report['root_created_file_owner_on_host_is_host_user'] = os.stat(os.path.join(ws, 'root.txt')).st_uid == uid
        t.send('/exit\r'); t.pump(2)
        while t.exited is None: t.pump(0.5)
        # MCP negative checks from a container: wrong token, unknown host header
        neg = sh('docker', 'run', '--rm', '--label', LABEL, 'alpine', 'sh', '-c',
                 f'wget -q -T 5 -S -O /dev/null --header "Authorization: Bearer wrong" --post-data "{{}}" {mcp_url} 2>&1 | head -1; wget -q -T 5 -S -O /dev/null --post-data "{{}}" http://host.docker.internal:{port}/mcp 2>&1 | head -1')
        report['mcp_wrong_token_and_no_token'] = neg.stdout.strip().splitlines()
        host_rej = [r for r in read_jsonl(hlog) if r.get('kind') == 'http-reject']
        report['host_rejects'] = [r['why'] for r in host_rej]
        # without --allow-host the Host header host.docker.internal is refused
        report['mcp_calls_seen_by_host'] = [r.get('method') for r in read_jsonl(hlog) if r.get('kind') == 'rpc']
    except Exception as e:
        report['error'] = repr(e)
    finally:
        host.terminate()
        left = sh('docker', 'ps', '-aq', '--filter', f'label={LABEL}').stdout.split()
        for c in left: sh('docker', 'rm', '-f', c)
        report['leftover_containers_before_cleanup'] = len(left)
        shutil.rmtree(base, ignore_errors=True)
        report['leftover_containers_after_cleanup'] = len(sh('docker', 'ps', '-aq', '--filter', f'label={LABEL}').stdout.split())
        report['temp_dir_removed'] = not os.path.exists(base)
    with open(os.path.join(OUT, 'p17_report.json'), 'w') as f: json.dump(report, f, indent=1)
    print(json.dumps(report, indent=1))

main()

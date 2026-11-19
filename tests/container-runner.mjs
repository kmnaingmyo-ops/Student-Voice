import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';

const execute = promisify(execFile);
async function docker(...args) {
    return (await execute('docker', args, { windowsHide: true, timeout: 30000, maxBuffer: 512 * 1024 })).stdout.trim();
}

// CI only: no production secrets, Docker socket mounts, or operator credentials.
export async function startRestrictedContainer() {
    assert.equal(process.platform, 'linux', 'The container integration test needs Linux Docker');
    const image = process.env.SECURITY_TEST_IMAGE || 'student-voice-security-check';
    const id = await docker('run', '--detach', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--memory=256m', '--cpus=1', '--pids-limit=128', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
        '--add-host=host.docker.internal:host-gateway', '--publish', '127.0.0.1::3000',
        '--env', 'DB_HOST=host.docker.internal', '--env', 'DB_PORT=' + (process.env.DB_PORT || '3306'),
        '--env', 'DB_NAME', '--env', 'DB_USER', '--env', 'DB_PASSWORD', '--env', 'SESSION_SECRET',
        '--env', 'DB_AUTO_MIGRATE=false', '--env', 'MEDIA_STORAGE=database', image);
    assert.match(id, /^[a-f0-9]{64}$/, 'Unexpected Docker container identifier');
    const stop = async () => { await docker('rm', '--force', id); };
    try {
        const config = JSON.parse(await docker('inspect', '--format', '{{json .HostConfig}}', id));
        assert.equal(config.ReadonlyRootfs, true);
        assert.equal(config.Memory, 256 * 1024 * 1024);
        assert.equal(config.NanoCpus, 1000000000);
        assert.equal(config.PidsLimit, 128);
        assert(config.CapDrop.includes('ALL'));
        assert(config.SecurityOpt.includes('no-new-privileges'));
        const port = await docker('port', id, '3000/tcp');
        assert.match(port, /^127\.0\.0\.1:\d+$/);
        const base = 'http://' + port + '/api';
        let ready = false;
        for (let attempt = 0; attempt < 75; attempt++) {
            try {
                const response = await fetch(base + '/session', { headers: { 'X-Forwarded-Proto': 'https' }, signal: AbortSignal.timeout(1000) });
                if (response.ok) { await response.arrayBuffer(); ready = true; break; }
                await response.arrayBuffer();
            } catch { /* Docker startup is asynchronous. */ }
            await pause(200);
        }
        assert(ready, 'The restricted container did not become ready');
        await docker('exec', id, 'node', '--input-type=module', '-e',
            "import {readFile,writeFile} from 'node:fs/promises'; if(process.getuid()===0) throw Error('Root runtime'); const status=await readFile('/proc/self/status','utf8'); if(!/^CapEff:\\s+0+$/m.test(status)||!/^NoNewPrivs:\\s+1$/m.test(status)) throw Error('Missing process isolation'); let denied=false; try{await writeFile('/app/should-not-write','fixture')}catch(e){denied=['EROFS','EACCES'].includes(e.code)} if(!denied) throw Error('Writable application directory');");
        return { base, stop };
    } catch (error) {
        await stop();
        throw error;
    }
}

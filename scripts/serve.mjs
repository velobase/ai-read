import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const require = createRequire(import.meta.url);
const mode = process.argv[2];
if (!['dev', 'start'].includes(mode)) throw new Error('Expected dev or start.');
const port = process.env.PORT || '4173';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  throw new Error('PORT 必须是 1–65535 之间的端口号。');
const child = spawn(
  process.execPath,
  [require.resolve('next/dist/bin/next'), mode, '--hostname', '127.0.0.1', '--port', port],
  {
    stdio: 'inherit',
    env: { ...process.env, PORT: port, NEXT_TELEMETRY_DISABLED: '1' },
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});

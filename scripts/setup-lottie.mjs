import { mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../public/vendor/', import.meta.url));
await mkdir(directory, { recursive: true });
const files = [
    ['lottie.min.js', 'https://cdn.jsdelivr.net/npm/lottie-web@5.13.0/build/player/lottie_light.min.js'],
    ['lottie-LICENSE.md', 'https://cdn.jsdelivr.net/npm/lottie-web@5.13.0/LICENSE.md']
];
try {
    for (const [name, url] of files) {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (name.endsWith('.js') && (bytes.length < 10000 || !bytes.toString('utf8').includes('loadAnimation'))) throw new Error('Unexpected player file');
        await writeFile(directory + name + '.download', bytes);
    }
    for (const [name] of files) await rename(directory + name + '.download', directory + name);
    console.log('Lottie player installed. Refresh http://localhost:3000/#board. No app restart needed.');
} catch (error) {
    console.error('Setup could not finish: ' + error.message + '. Check internet access and run setup again.');
    process.exitCode = 1;
}

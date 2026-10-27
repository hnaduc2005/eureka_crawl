import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import worker from '../worker/index.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function buildVercel(outputDirectory = resolve(projectRoot, 'public')) {
  await mkdir(outputDirectory, { recursive: true });
  for (const [route, filename] of [['/', 'index.html'], ['/favicon.svg', 'favicon.svg'], ['/testing', 'testing/index.html']]) {
    // Building the UI never calls the upstream voting API.
    const response = await worker.fetch(new Request('http://build.local' + route));
    if (!response.ok) throw new Error('Cannot build ' + route + ': HTTP ' + response.status);
    const outputFile = resolve(outputDirectory, filename);
    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, Buffer.from(await response.arrayBuffer()));
  }
  return outputDirectory;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log('Built Vercel static files: ' + await buildVercel());
}

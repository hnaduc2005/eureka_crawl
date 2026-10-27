import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildVercel } from '../vote-dashboard/scripts/build-vercel.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function buildRootVercel(outputDirectory = resolve(repositoryRoot, 'public')) {
  return buildVercel(outputDirectory);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log('Built Vercel static files: ' + await buildRootVercel());
}

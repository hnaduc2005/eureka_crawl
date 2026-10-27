import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import vm from 'node:vm';
import { buildVercel } from '../scripts/build-vercel.mjs';
import competitionsHandler from '../api/competitions.js';
import snapshotHandler from '../api/snapshot.js';
import rootCompetitionsHandler from '../../api/competitions.js';
import rootSnapshotHandler from '../../api/snapshot.js';
import { buildRootVercel } from '../../scripts/build-vercel.mjs';

for (const [mode, build] of [['repository root', buildRootVercel], ['app subdirectory', buildVercel]]) {
test('Vercel build from ' + mode + ' produces the dashboard and favicon without network access', async t => {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'eureka-vercel-'));
  t.after(async () => {
    const target = await realpath(directory);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith('eureka-vercel-'));
    await rm(target, { recursive: true, force: true });
  });
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('Build must be offline'); });
  await build(directory);
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  assert.match(html, /<html lang="vi">/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script);
  assert.match(script, /\/api\/competitions/);
  assert.match(script, /\/api\/snapshot\?competition=/);
  assert.match(await readFile(join(directory, 'favicon.svg'), 'utf8'), /<svg/);
  assert.equal(network.mock.callCount(), 0);
});
}

for (const [mode, competitions, snapshotEndpoint] of [
  ['root', rootCompetitionsHandler, rootSnapshotHandler],
  ['subdirectory', competitionsHandler, snapshotHandler],
]) {
test('Vercel endpoints from ' + mode + ' return complete data and preserve query parameters', async t => {
  const requests = [];
  const id = 'vercel-fixture-' + mode;
  const entries = [0, 1, 2].map(i => ({ id: i + 1, code: 'TEST-' + i, title: 'Đề tài ' + i, author: 'Nguyễn An', categoryId: 1, voteCount: i ? i * 100 : null }));
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    requests.push(url);
    assert.equal(url.origin, 'https://binhchon.khoahoctre.com.vn');
    if (url.pathname === '/api/competitions') return Response.json([{ id, name: 'Cuộc thi thử nghiệm', isOpen: true }]);
    if (url.pathname === '/api/competitions/' + id) return Response.json({ id, name: 'Cuộc thi thử nghiệm', showLiveCounts: true });
    if (url.pathname.endsWith('/categories')) return Response.json([{ id: 1, code: 'CNTT', name: 'Công nghệ thông tin' }]);
    assert.equal(url.pathname, '/api/c/' + id + '/entries');
    const page = Number(url.searchParams.get('page'));
    return Response.json({ items: entries.slice((page - 1) * 2, page * 2), page, pageSize: 2, totalCount: 3 });
  });
  const competitionResponse = await competitions.fetch(new Request('https://app.vercel.app/api/competitions'));
  assert.equal(competitionResponse.status, 200);
  assert.deepEqual(await competitionResponse.json(), [{ id, name: 'Cuộc thi thử nghiệm', isOpen: true }]);
  const response = await snapshotEndpoint.fetch(new Request('https://app.vercel.app/api/snapshot?competition=' + id + '&refresh=1'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const snapshot = await response.json();
  assert.equal(snapshot.competition.id, id);
  assert.equal(snapshot.entries.length, 3);
  assert.equal(snapshot.pages, 2);
  assert.equal(snapshot.entries[0].voteCount, null);
  assert.equal(snapshot.entries[2].voteCount, 200);
  assert.ok(requests.some(url => url.searchParams.get('page') === '2' && url.searchParams.get('pageSize') === '2'));
  const calls = requests.length;
  const cached = await snapshotEndpoint.fetch(new Request('https://app.vercel.app/api/snapshot?competition=' + id));
  assert.deepEqual(await cached.json(), snapshot);
  assert.equal(requests.length, calls);
});
}

test('Vercel snapshot route rejects missing parameters and non-GET methods without upstream calls', async t => {
  const network = t.mock.method(globalThis, 'fetch', () => { throw Error('Unexpected network'); });
  assert.equal((await snapshotHandler.fetch(new Request('https://app.vercel.app/api/snapshot'))).status, 400);
  assert.equal((await snapshotHandler.fetch(new Request('https://app.vercel.app/api/snapshot?competition=..%2Fsecret'))).status, 400);
  assert.equal((await competitionsHandler.fetch(new Request('https://app.vercel.app/api/competitions', { method: 'POST' }))).status, 405);
  assert.equal(network.mock.callCount(), 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker, { crawlCompetition, sourceJSON, toCSV } from '../worker/index.js';

function fixture({ mutatePage, count = 7 } = {}) {
  const requests = [];
  const entries = Array.from({ length: count }, (_, i) => ({ id: i + 1, code: 'TEST-' + (i + 1), title: 'Nghiên cứu ' + i, author: 'Nguyễn Văn A', categoryId: 1, voteCount: i === 0 ? null : i * 10 }));
  const fetcher = async (input) => {
    const url = new URL(input);
    requests.push(url);
    if (url.pathname === '/api/competitions/test') return Response.json({ id: 'test', name: 'Thử nghiệm', showLiveCounts: true });
    if (url.pathname.endsWith('/categories')) return Response.json([{ id: 1, code: 'NC', name: 'Nghiên cứu' }]);
    const page = Number(url.searchParams.get('page'));
    const data = { items: entries.slice((page - 1) * 2, page * 2), totalCount: count, page, pageSize: 2 };
    mutatePage?.(data);
    return Response.json(data);
  };
  return { fetcher, requests };
}

test('crawls every page using the page size actually returned by the server', async () => {
  const { fetcher, requests } = fixture();
  const data = await crawlCompetition('test', fetcher);
  assert.equal(data.totalCount, 7);
  assert.equal(data.pages, 4);
  assert.equal(data.entries.length, 7);
  assert.equal(data.entries[0].voteCount, null);
  assert.equal(data.entries[6].voteCount, 60);
  assert.match(data.entries[0].url, /\/c\/test\/NC\/1$/);
  assert.equal(requests.filter(u => u.pathname.endsWith('/entries')).length, 4);
  assert.equal(requests.find(u => u.searchParams.get('page') === '2').searchParams.get('pageSize'), '2');
});

test('does not accept a partial snapshot', async () => {
  const { fetcher } = fixture({ mutatePage: p => { if (p.page === 4) p.items = []; } });
  await assert.rejects(crawlCompetition('test', fetcher), /Chưa tải đủ/);
});

test('rejects duplicate IDs instead of silently overwriting an entry', async () => {
  const { fetcher } = fixture({ mutatePage: p => { if (p.page === 2) p.items[0].id = 1; } });
  await assert.rejects(crawlCompetition('test', fetcher), /trùng lặp/);
});

test('rejects changing pagination totals and invalid counts', async () => {
  const changed = fixture({ mutatePage: p => { if (p.page === 2) p.totalCount++; } });
  await assert.rejects(crawlCompetition('test', changed.fetcher), /vừa thay đổi/);
  const invalid = fixture({ mutatePage: p => { if (p.page === 1) p.items[0].voteCount = -1; } });
  await assert.rejects(crawlCompetition('test', invalid.fetcher), /Số bình chọn không hợp lệ/);
});

test('accepts an empty competition', async () => {
  const { fetcher } = fixture({ count: 0 });
  assert.equal((await crawlCompetition('test', fetcher)).totalCount, 0);
});

test('reports rate limiting, network failure, and invalid JSON clearly', async () => {
  await assert.rejects(sourceJSON('x', async () => new Response('', { status: 429 })), /giới hạn/);
  await assert.rejects(sourceJSON('x', async () => { throw Error('network'); }), /Không kết nối/);
  await assert.rejects(sourceJSON('x', async () => new Response('<html>')), /JSON/);
});

test('CSV preserves Vietnamese, quotes fields, and neutralizes formulas', () => {
  const csv = toCSV([{ code: 'A', title: '=1+1', author: 'Nguyễn, "An"', categoryName: 'Hóa học', voteCount: null, url: 'https://example.com' }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"Nguyễn, ""An"""'));
  assert.ok(csv.includes('"Hóa học",""'));
});

test('page renders with parseable JavaScript and API validates request shape', async () => {
  const page = await worker.fetch(new Request('http://localhost/'));
  assert.equal(page.status, 200);
  const html = await page.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script);
  assert.equal((await worker.fetch(new Request('http://localhost/api/snapshot'))).status, 400);
  assert.equal((await worker.fetch(new Request('http://localhost/api/snapshot?competition=..%2Fadmin'))).status, 400);
  assert.equal((await worker.fetch(new Request('http://localhost/', { method: 'POST' }))).status, 405);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../worker/index.js';
import { parseTestTarget, validateTestManifest, validateTestScenario, createDemoTestEnvironment, connectTestEnvironment, runTestScenario } from '../testing/test-kit.mjs';

const noDelay = async () => {};
const scenario = { entryId: 'demo-01', users: 3, votes: 2 };

test('accepts a future test website URL and derives the fixed test connector', () => {
  assert.equal(parseTestTarget('demo://local').kind, 'demo');
  assert.equal(parseTestTarget('https://staging.example.org/site/').endpoint, 'https://staging.example.org/api/test-harness');
  assert.equal(parseTestTarget('http://127.0.0.1:8787').kind, 'remote');
});

test('does not connect test operations to production voting or Google signup hosts', () => {
  for (const url of ['https://binhchon.khoahoctre.com.vn/', 'https://binhchon.khoahoctre.com.vn./', 'https://accounts.google.com/', 'https://google.com/', 'http://example.org', 'https://user:pass@staging.example.org/', 'https://staging.example.org/?token=secret']) assert.throws(() => parseTestTarget(url));
});

test('requires an isolated simulated test protocol before any write request', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ protocol: 'eureka-test-v1', environment: 'production', isolated: false });
  };
  await assert.rejects(connectTestEnvironment(parseTestTarget('https://staging.example.org'), fetcher), /giao thức/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'error');
  assert.throws(() => validateTestManifest({ ...createDemoTestEnvironment().manifest, simulatedAccounts: false }));
});

test('validates counts before starting a run and keeps one vote per simulated user', async () => {
  const adapter = createDemoTestEnvironment();
  for (const config of [{...scenario, users: 501}, {...scenario, users: 1.5}, {...scenario, votes: 4}, {...scenario, votes: -1}, {...scenario, entryId: 'unknown'}]) assert.throws(() => validateTestScenario(adapter.manifest, config));
  assert.equal(validateTestScenario(adapter.manifest, { ...scenario, votes: 0 }).operations, 6);
  await assert.rejects(runTestScenario(adapter, {...scenario, votes: 500}, { pause: noDelay }));
});

test('demo runs hundreds of simulated signups, logins and votes entirely offline', async t => {
  const network = t.mock.method(globalThis, 'fetch', () => { throw Error('No external network in demo'); });
  const result = await runTestScenario(createDemoTestEnvironment(), { entryId: 'demo-02', users: 300, votes: 200 }, { pause: noDelay });
  assert.equal(result.status, 'completed');
  assert.equal(result.created, 300);
  assert.equal(result.loggedIn, 300);
  assert.equal(result.accepted, 200);
  assert.equal(result.operations, 800);
  assert.equal(result.rejected, 0);
  assert.equal(network.mock.callCount(), 0);
  assert.equal(JSON.stringify(result).includes('password'), false);
});

test('demo does not accept invalid sessions or duplicate votes', async () => {
  const adapter = createDemoTestEnvironment();
  const user = await adapter.createUser({ runId: 'test', index: 1 });
  assert.match(user.email, /@example\.invalid$/);
  await assert.rejects(adapter.login({ userId: user.id, password: 'wrong' }));
  await assert.rejects(adapter.vote({ token: 'wrong', entryId: 'demo-01' }));
  const session = await adapter.login({ userId: user.id, password: user.password });
  assert.equal((await adapter.vote({ token: session.token, entryId: 'demo-01' })).accepted, true);
  assert.equal((await adapter.vote({ token: session.token, entryId: 'demo-01' })).duplicate, true);
});

test('stopping a run prevents the next signup or vote', async () => {
  const controller = new AbortController();
  const result = await runTestScenario(createDemoTestEnvironment(), {...scenario, votes: 3}, {
    signal: controller.signal, pause: noDelay,
    onProgress(progress) { if (progress.loggedIn === 2) controller.abort(); },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.created, 2);
  assert.equal(result.loggedIn, 2);
  assert.equal(result.accepted, 1);
  assert.equal(result.operations, 5);
});

test('a server error stops the run and reports partial results without retries', async () => {
  const adapter = createDemoTestEnvironment();
  let loginCalls = 0;
  adapter.login = async () => { loginCalls++; throw new Error('Test server unavailable'); };
  const result = await runTestScenario(adapter, scenario, { pause: noDelay });
  assert.equal(result.status, 'failed');
  assert.equal(result.created, 1);
  assert.equal(result.accepted, 0);
  assert.equal(loginCalls, 1);
  assert.match(result.error, /login/);
});

test('remote adapter uses only test operations with no ambient cookies', async () => {
  const demo = createDemoTestEnvironment();
  const calls = [];
  const fetcher = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://staging.example.org');
    assert.equal(parsed.pathname, '/api/test-harness');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    const operation = parsed.searchParams.get('op');
    calls.push(operation);
    const body = options.body ? JSON.parse(options.body) : null;
    if (operation === 'manifest') return Response.json(demo.manifest);
    if (operation === 'create-user') return Response.json(await demo.createUser(body));
    if (operation === 'login') return Response.json(await demo.login(body));
    if (operation === 'vote') return Response.json(await demo.vote(body));
    throw Error('Unexpected operation');
  };
  const adapter = await connectTestEnvironment(parseTestTarget('https://staging.example.org/'), fetcher);
  const result = await runTestScenario(adapter, scenario, { pause: noDelay });
  assert.equal(result.status, 'completed');
  assert.equal(result.accepted, 2);
  assert.equal(calls.filter(operation => operation === 'create-user').length, 3);
  assert.equal(calls.filter(operation => operation === 'login').length, 3);
  assert.equal(calls.filter(operation => operation === 'vote').length, 2);
});

test('cancel reaches an in-flight remote request', async () => {
  const controller = new AbortController();
  let markEntered;
  const entered = new Promise(resolve => { markEntered = resolve; });
  const fetcher = async (url, options) => {
    if (new URL(url).searchParams.get('op') === 'manifest') return Response.json(createDemoTestEnvironment().manifest);
    markEntered();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  };
  const adapter = await connectTestEnvironment(parseTestTarget('https://staging.example.org'), fetcher);
  const running = runTestScenario(adapter, scenario, { signal: controller.signal, pause: noDelay });
  await entered;
  controller.abort();
  const result = await running;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.accepted, 0);
});

test('test lab route contains a parseable self-contained browser application', async () => {
  const response = await worker.fetch(new Request('http://localhost/testing/'));
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /URL website test/);
  assert.match(page, /Dừng/);
  new vm.Script(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
});

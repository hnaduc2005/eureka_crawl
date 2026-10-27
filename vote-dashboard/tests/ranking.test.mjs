import test from 'node:test';
import assert from 'node:assert/strict';
import { rankEntries } from '../worker/index.js';

const entries = [
  { id: 1, categoryId: 1, voteCount: 90 },
  { id: 2, categoryId: 2, voteCount: 100 },
  { id: 3, categoryId: 1, voteCount: 90 },
  { id: 4, categoryId: 1, voteCount: 10 },
  { id: 5, categoryId: 2, voteCount: 0 },
  { id: 6, categoryId: 1, voteCount: null },
];

test('changing category restarts ranks within that category and preserves tied votes', () => {
  assert.deepEqual([...rankEntries(entries, '1')], [[1, 1], [3, 1], [4, 3]]);
  assert.deepEqual([...rankEntries(entries, '2')], [[2, 1], [5, 2]]);
});

test('selecting all categories restores competition ranks and leaves hidden counts unranked', () => {
  assert.deepEqual([...rankEntries(entries)], [[2, 1], [1, 2], [3, 2], [4, 4], [5, 5]]);
  assert.equal(rankEntries(entries).has(6), false);
  assert.equal(rankEntries(entries, 'unknown').size, 0);
});

test('ranks remain stable when rows are sorted differently and do not mutate source entries', () => {
  const reversed = entries.slice().reverse();
  const actual = rankEntries(reversed, '1');
  assert.equal(actual.get(1), 1);
  assert.equal(actual.get(3), 1);
  assert.equal(actual.get(4), 3);
  assert.deepEqual(reversed.map(entry => entry.id), [6, 5, 4, 3, 2, 1]);
});

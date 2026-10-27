import { mkdir, writeFile } from 'node:fs/promises';
import { listCompetitions, crawlCompetition, toCSV } from '../worker/index.js';

try {
  const competitions = await listCompetitions();
  const id = process.argv[2] || competitions[0]?.id;
  if (!competitions.some(item => item.id === id)) throw new Error('Không tìm thấy cuộc thi.');
  const snapshot = await crawlCompetition(id);
  await mkdir('data', { recursive: true });
  await writeFile(`data/${id}.json`, JSON.stringify(snapshot, null, 2));
  await writeFile(`data/${id}.csv`, toCSV(snapshot.entries));
  console.log(JSON.stringify({ competition: id, entries: snapshot.entries.length, categories: snapshot.categories.length, fetchedAt: snapshot.fetchedAt, durationMs: snapshot.durationMs }, null, 2));
  console.log(`Đã lưu data/${id}.json và data/${id}.csv`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

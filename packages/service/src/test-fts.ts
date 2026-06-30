import { openDatabase } from './db/connection.js';
import { MemoryRepository } from './repositories/memory.js';

const db = openDatabase();
const memories = new MemoryRepository(db);
const fp = 'github.com/acme-corp/widget';

const queries = ['JWT', 'RS256', 'authentication middleware', 'nonexistent xyz'];

for (const q of queries) {
  const results = memories.search(fp, q);
  console.log(`"${q}" → ${results.length} result(s)${results[0] ? ': ' + results[0].title : ''}`);
}

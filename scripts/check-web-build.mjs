import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const dist = path.resolve('apps/web/dist');
if (!existsSync(dist)) {
  console.error('apps/web/dist does not exist. Run npm run build -w @app/web.');
  process.exit(1);
}

const forbidden = ['RATIONALE.md', 'ASSESSMENT.md', 'IMPLEMENTATION_BRIEF.md', 'tasks/T01.md'];
const files = [];

/**
 * Collects every file under the directory into `files`, recursively.
 * @param {string} directory Absolute directory to scan.
 */
function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
}

walk(dist);
const blob = files.map((file) => readFileSync(file, 'utf8')).join('\n');
const hits = forbidden.filter((name) => blob.includes(name) || files.some((file) => file.replaceAll('\\', '/').includes(name)));
if (hits.length) {
  console.error(`The web build includes internal documentation: ${hits.join(', ')}`);
  process.exit(1);
}
console.log(`PASS: ${files.length} files in apps/web/dist and no internal documents.`);

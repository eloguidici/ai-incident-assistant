import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const compose = process.argv.slice(2);
assert.equal(compose[0], 'compose', 'Pass the synthetic QA Compose configuration.');
const sentinels = ['alice morgan', 'maria.gomez@example.com', 'mar\u00eda g\u00f3mez', 'robert taylor',
  'alice.morgan@example.com', 'robert.taylor@example.com', 'nora vega', 'nora.fixture@example.test',
  '+1 202-555-0147', '+54 9 11 5555-0101', '+34 612 345 678'];

/** @param args Docker arguments. @returns Captured output only; never emits raw content. @throws On inspection failure. */
function inspect(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  assert.equal(result.status, 0, 'Local runtime inspection could not complete.');
  return result.stdout;
}

const predicate = sentinels.map(value => `strpos(lower(content), '${value.replaceAll("'", "''")}') > 0`).join(' or ');
const query = `with protected as (
  select concat_ws(' ', a.source_text, a.result::text, a.error_message,
    (select string_agg(concat_ws(' ', m.content, m.result::text), ' ') from messages m where m.analysis_id = a.id)) as content
  from analyses a where a.pii_policy_version = 'pii-local-v1'
) select json_build_object('protectedAnalyses', count(*),
  'rawSentinelRows', count(*) filter (where ${predicate})) from protected;`;
const database = JSON.parse(inspect([...compose, 'exec', '-T', 'postgres', 'psql', '-U', 'app',
  '-d', 'incident_assistant_test', '-At', '-c', query]).trim());
assert.ok(database.protectedAnalyses >= 6, 'Real browser fixtures must exist before inspecting storage.');
assert.equal(database.rawSentinelRows, 0, 'Original synthetic contact data found in protected rows.');
const logs = inspect([...compose, 'logs', '--no-color', 'api', 'pii', 'web']).toLowerCase();
const matches = sentinels.filter(value => logs.includes(value));
assert.equal(matches.length, 0, 'Original synthetic contact data found in reviewed service logs.');
console.log(JSON.stringify({ ...database, logSentinelMatches: matches.length,
  scope: 'Full-policy source/results/messages/error text and supplied API/PII/nginx logs; synthetic sentinels only.' }, null, 2));

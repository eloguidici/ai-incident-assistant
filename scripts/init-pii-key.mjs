import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const keyPath = resolve(process.env.PII_HMAC_KEY_PATH || '.local/pii-hmac.key');
mkdirSync(dirname(keyPath), { recursive: true });
try {
  writeFileSync(keyPath, randomBytes(48), { flag: 'wx', mode: 0o600 });
  console.log('Created the local PII key. Keep it private and stable for retained incidents.');
} catch (error) {
  if (error?.code === 'EEXIST') console.log('The local PII key already exists; it was not changed.');
  else { console.error('Could not create the local PII key.'); process.exitCode = 1; }
}

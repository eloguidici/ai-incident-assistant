import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
for (const envPath of [
  resolve(scriptDir, '../../../.env'),
  resolve(scriptDir, '../../.env'),
  resolve(process.cwd(), '.env'),
]) {
  config({ path: envPath });
}

const model = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.log('RESULT=BLOCKED reason=missing_key');
  process.exit(2);
}

const client = new OpenAI({
  apiKey: key,
  baseURL: 'https://openrouter.ai/api/v1',
  maxRetries: 0,
  timeout: 30000,
});

try {
  const response = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: 'Reply with JSON only: {"ok":true}' }],
    max_tokens: 32,
  });
  const text = response.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(text);
  if (parsed.ok === true) {
    console.log(`RESULT=PASS test=minimal_json_completion model=${response.model || model}`);
    process.exit(0);
  }
  console.log('RESULT=FAIL test=minimal_json_completion reason=unexpected_json');
  process.exit(1);
} catch (error) {
  const msg = error instanceof Error ? error.message.replace(/sk-or-[A-Za-z0-9_-]+/g, '[REDACTED]') : 'unknown';
  console.log(`RESULT=FAIL test=minimal_json_completion reason=${msg.slice(0, 200)}`);
  process.exit(1);
}

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [candidatePath, previousPath] = process.argv.slice(2);
assert.ok(candidatePath && previousPath, 'Provide two real-run results.json paths.');
assert.notEqual(path.resolve(candidatePath), path.resolve(previousPath), 'Independent runs require different artifacts.');
const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const previous = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
const corpusBytes = fs.readFileSync(path.join(root, 'qa/pii-spike/fixtures.json'));
const fixtures = JSON.parse(corpusBytes);
assert.equal(fixtures.length, 38);
assert.equal(candidate.corpusSha256, crypto.createHash('sha256').update(corpusBytes).digest('hex'));
assert.equal(previous.corpusSha256, candidate.corpusSha256);
assert.notEqual(previous.startedAt, candidate.startedAt, 'Independent processes require different run timestamps.');
assert.deepEqual(previous.versions, candidate.versions);
assert.equal(candidate.productionIntegrated, false);
assert.equal(candidate.providerCalls, 0);
assert.deepEqual(candidate.evaluations, previous.evaluations, 'Detection/replacement must reproduce across independent processes.');

/** @param {string} text Prose. @param {string} needle Fixed non-empty annotation. @returns {number} Exact occurrence count. */
function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

let verifiedCases = 0;
for (const evaluation of candidate.evaluations) {
  assert.equal(evaluation.cases.length, fixtures.length);
  for (const outcome of evaluation.cases) {
    const fixture = fixtures.find((entry) => entry.id === outcome.id);
    assert.ok(fixture);
    const expected = fixture.expected.flatMap(([entityType, needle]) => {
      const annotations = [];
      for (let start = fixture.text.indexOf(needle); start !== -1; start = fixture.text.indexOf(needle, start + needle.length)) {
        annotations.push({ entityType, start, end: start + needle.length });
      }
      return annotations;
    });
    const equals = (annotation, span) => annotation.entityType === span.entity_type && annotation.start === span.start && annotation.end === span.end;
    const covered = (annotation) => outcome.spans.some((span) => annotation.entityType === span.entity_type && span.start <= annotation.start && span.end >= annotation.end);
    const exact = expected.filter((annotation) => outcome.spans.some((span) => equals(annotation, span))).length;
    const missedExpected = expected.flatMap((annotation, index) => covered(annotation) ? [] : [index]);
    const extraDetected = outcome.spans.flatMap((span, index) => expected.some((annotation) => equals(annotation, span)) ? [] : [index]);
    const lostProtected = fixture.preserve.flatMap((needle, index) => countOccurrences(fixture.text, needle) === countOccurrences(outcome.sanitized, needle) ? [] : [index]);
    assert.deepEqual(outcome.metrics, { expected: expected.length, exact, fullyCovered: expected.length - missedExpected.length, missedExpected, extraDetected, lostProtected, pass: exact === expected.length && !extraDetected.length && !lostProtected.length });
    verifiedCases++;
  }
}

const { validateAnalysis } = require(path.join(root, 'apps/api/dist/ai/validate.js'));
const sample = candidate.evaluations.find((evaluation) => evaluation.mode === 'dual' && evaluation.threshold === 0.35).cases.find((outcome) => outcome.id === 'en-contact');
const analysis = { summary: 'A reported HTTP 503 requires investigation.', category: 'availability', suggestedSeverity: 'medium', evidence: [{ quote: sample.sanitized, note: 'Sanitized original report.' }], hypotheses: [], missingInformation: ['Cause and recovery logs.'], uncertainty: 'The cause is unconfirmed.' };
assert.doesNotThrow(() => validateAnalysis(JSON.stringify(analysis), sample.sanitized));
const originalQuote = fixtures.find((fixture) => fixture.id === 'en-contact').text;
assert.throws(() => validateAnalysis(JSON.stringify({ ...analysis, evidence: [{ quote: originalQuote, note: 'Unsanitized quote must not match.' }] }), sample.sanitized), /quote/);
const foreignLabel = sample.sanitized.replace(/\[PERSON_[a-f0-9]{32}\]/, '[PERSON_ffffffffffffffffffffffffffffffff]');
assert.notEqual(foreignLabel, sample.sanitized);
assert.throws(() => validateAnalysis(JSON.stringify(analysis), foreignLabel), /quote/);

const core = candidate.evaluations.find((evaluation) => evaluation.mode === 'dual' && evaluation.threshold === 0.35).byTier.core;
const verification = { evidenceConsistency: 'PASS', verifiedCases, independentProcessReproduction: true, groundingChecks: 3, corpusSha256: candidate.corpusSha256, integrationGate: core.passedCases === core.cases ? 'PASS' : 'FAIL', productionIntegrated: false, providerCalls: 0, report: path.basename(path.dirname(candidatePath)) };
fs.writeFileSync(path.join(path.dirname(candidatePath), 'verification.json'), JSON.stringify(verification, null, 2));
console.log(JSON.stringify(verification));

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const baselineBytes = readFileSync(resolve(root, 'qa/pii-spike/fixtures.json'));
const baselineHash = createHash('sha256').update(baselineBytes).digest('hex');
assert.equal(baselineHash, 'ccb67967392af1be05bd8bedf4c520451ca9f6e81cbf3218558b9c5134964c96');
const suites = {
  baseline: JSON.parse(baselineBytes),
  holdout: JSON.parse(readFileSync(resolve(root, 'qa/pii-comparison/holdout.json'), 'utf8')),
  reserved: JSON.parse(readFileSync(resolve(root, 'qa/pii-comparison/optimization-holdout.json'), 'utf8')),
  final: JSON.parse(readFileSync(resolve(root, 'qa/pii-comparison/final-holdout.json'), 'utf8')),
};
const directory = resolve(root, 'qa/pii-comparison/evidence');
const filenames = readdirSync(directory).filter(name => /^\d{4}-.*\.json$/.test(name)).sort();
assert.ok(filenames.length >= 1);
const reports = filenames.map(name => JSON.parse(readFileSync(resolve(directory, name), 'utf8')));
let verified = 0;
for (const report of reports) {
  assert.equal(report.baselineSha256, baselineHash);
  assert.equal(report.providerCalls, 0);
  for (const evaluation of report.evaluations) {
    const fixtures = suites[evaluation.suite];
    assert.equal(evaluation.cases.length, fixtures.length);
    for (const outcome of evaluation.cases) {
      const fixture = fixtures.find(candidate => candidate.id === outcome.id);
      assert.ok(fixture);
      const expected = [];
      for (const [kind, needle] of fixture.expected) {
        for (let start = fixture.text.indexOf(needle); start >= 0; start = fixture.text.indexOf(needle, start + needle.length)) {
          expected.push([kind, start, start + needle.length]);
        }
      }
      // Fixtures use BMP Unicode, so JS and Python code-point offsets agree here.
      assert.equal([...fixture.text].length, fixture.text.length);
      const detected = outcome.spans.map(span => [span.entity_type, span.start, span.end]);
      for (const [kind, start, end] of detected) {
        assert.ok(['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER'].includes(kind));
        assert.ok(start >= 0 && start < end && end <= fixture.text.length);
      }
      const same = (left, right) => left.every((part, index) => part === right[index]);
      const exact = expected.filter(annotation => detected.some(span => same(span, annotation))).length;
      const missedExpected = expected.flatMap(([kind, start, end], index) => detected.some(([entity, left, right]) => kind === entity && left <= start && right >= end) ? [] : [index]);
      const extraDetected = detected.flatMap((span, index) => expected.some(annotation => same(span, annotation)) ? [] : [index]);
      const count = (text, fragment) => text.split(fragment).length - 1;
      const lostProtected = fixture.preserve.flatMap((fragment, index) => count(fixture.text, fragment) === count(outcome.sanitized, fragment) ? [] : [index]);
      assert.deepEqual(outcome.metrics, {
        expected: expected.length, exact, fullyCovered: expected.length - missedExpected.length,
        missedExpected, extraDetected, lostProtected,
        pass: exact === expected.length && extraDetected.length === 0 && lostProtected.length === 0,
      });
      verified += 1;
    }
    const aggregate = {
      cases: evaluation.cases.length,
      passedCases: evaluation.cases.filter(outcome => outcome.metrics.pass).length,
      expected: evaluation.cases.reduce((total, outcome) => total + outcome.metrics.expected, 0),
      exact: evaluation.cases.reduce((total, outcome) => total + outcome.metrics.exact, 0),
      fullyCovered: evaluation.cases.reduce((total, outcome) => total + outcome.metrics.fullyCovered, 0),
      extraSpans: evaluation.cases.reduce((total, outcome) => total + outcome.metrics.extraDetected.length, 0),
      protectedViolations: evaluation.cases.reduce((total, outcome) => total + outcome.metrics.lostProtected.length, 0),
      failedIds: evaluation.cases.filter(outcome => !outcome.metrics.pass).map(outcome => outcome.id),
    };
    assert.deepEqual(evaluation.aggregate, aggregate);
  }
}
let freshProcessEqual = null;
if (reports.length >= 2 && reports.at(-1).engineVersion === reports.at(-2).engineVersion) {
  const comparable = report => report.evaluations.map(evaluation => ({ configuration: evaluation.configuration, suite: evaluation.suite, cases: evaluation.cases }));
  freshProcessEqual = JSON.stringify(comparable(reports.at(-1))) === JSON.stringify(comparable(reports.at(-2)));
  assert.ok(freshProcessEqual);
}
console.log(JSON.stringify({ verifiedOutcomes: verified, reports: reports.length, freshProcessEqual, baselineSha256: baselineHash, qualityApproved: reports.at(-1).approved }, null, 2));

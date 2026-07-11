// Unit tests for Ontology Builder helpers (no live DB required for pure units)
// Run: bun tests/test_ontology_builder.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const {
  serializeConceptToMd,
  materializeConcepts,
  toKebabId,
  assertVectorizedReality
} = require('../routes/ontology/ontologyBuilder');
const { getDefaultStepDefinitions, mergeStepDefinitions } = require('../packages/core/pipelineConfigService');
const { parseConceptFile } = require('../routes/loaders/ontoLoader');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log('  OK:', msg);
}

async function main() {
  console.log('=== test_ontology_builder ===');

  // 1. Step 6 in defaults
  const defs = getDefaultStepDefinitions();
  const s6 = defs.find((d) => d.id === 6);
  ok(s6 && s6.name === 'ontology_builder', 'default step definitions include ontology_builder');
  ok(defs.find((d) => d.id === 3)?.name === 'enrichment', 'step 3 remains enrichment');

  // 2. merge keeps custom labels and adds missing step 6
  const merged = mergeStepDefinitions([
    { id: 1, name: 'parsing', label: 'Custom Step1', description: 'x' },
    { id: 4, name: 'vectorization', label: 'Vec', description: 'y' }
  ]);
  ok(merged.some((d) => d.id === 6), 'mergeStepDefinitions adds step 6');
  ok(merged.find((d) => d.id === 1).label === 'Custom Step1', 'merge preserves custom label');

  // 3. kebab id
  ok(toKebabId('AiItem') === 'ai-item', 'toKebabId camelCase');
  ok(toKebabId('foo_bar') === 'foo-bar', 'toKebabId underscore');

  // 4. serialize + parse roundtrip
  const md = serializeConceptToMd(
    {
      id: 'test-entity',
      name: 'Test Entity',
      rationale: 'Unit test concept',
      aspects: ['domain'],
      relations: [{ type: 'uses', target: 'other-thing', comment: 'link' }],
      groundingCandidates: [
        { role: 'implemented_in', target: 'pkg.Foo', confidence: 0.9, source: 'anchor' },
        { role: 'stored_in', target: 'table:schema.t', confidence: 0.8, source: 'table' }
      ]
    },
    'UNIT-TEST'
  );
  ok(md.includes('status: draft'), 'serialize sets status draft');
  ok(md.includes('## Описание'), 'serialize has Описание section');
  ok(md.includes('| uses | concept:other-thing |'), 'relations use concept: prefix');
  const parsed = parseConceptFile(md, 'test-entity.md');
  ok(parsed.errors.length === 0, 'parseConceptFile accepts builder MD: ' + parsed.errors.join('; '));
  ok(parsed.concept && parsed.concept.id === 'test-entity', 'parsed id');
  ok(parsed.concept.status === 'draft', 'parsed status draft');
  ok(parsed.concept.relations.some((r) => r.type === 'uses' && r.target === 'other-thing'), 'parsed relation');

  // 5. materialize conflict
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-builder-'));
  const conceptsDir = path.join(tmp, 'concepts');
  fs.mkdirSync(conceptsDir);
  const existing = serializeConceptToMd(
    { id: 'existing', name: 'Existing', rationale: 'pre' },
    'UNIT-TEST'
  );
  fs.writeFileSync(path.join(conceptsDir, 'existing.md'), existing, 'utf8');

  let conflictThrown = false;
  try {
    await materializeConcepts(
      'UNIT-TEST',
      [{ id: 'existing', name: 'Existing2', rationale: 'dup' }],
      { dirs: [conceptsDir], overwrite: false }
    );
  } catch (e) {
    conflictThrown = e.status === 409 && e.userFacing === true;
  }
  ok(conflictThrown, 'materialize conflicts without overwrite → 409 userFacing');

  // apply-style: allowExisting skips without error
  const skipRes = await materializeConcepts(
    'UNIT-TEST',
    [{ id: 'existing', name: 'Existing2', rationale: 'dup' }],
    { dirs: [conceptsDir], overwrite: false, allowExisting: true }
  );
  ok(skipRes.skippedExisting?.length === 1, 'allowExisting skips existing files');
  ok(skipRes.written.length === 0, 'allowExisting does not rewrite');

  const res = await materializeConcepts(
    'UNIT-TEST',
    [{ id: 'new-one', name: 'New', rationale: 'fresh' }],
    { dirs: [conceptsDir], overwrite: false }
  );
  ok(res.written.length === 1 && res.written[0].id === 'new-one', 'materialize writes new file');
  ok(fs.existsSync(path.join(conceptsDir, 'new-one.md')), 'new file on disk');

  // 6. assertVectorizedReality gate shape (mock db)
  const mockEmpty = {
    pgClient: {
      query: async () => ({ rows: [{ n: 0 }] })
    }
  };
  let gated = false;
  try {
    await assertVectorizedReality(mockEmpty, 'X');
  } catch (e) {
    gated = e.code === 'STEP4_REQUIRED' && e.status === 409;
  }
  ok(gated, 'assertVectorizedReality throws STEP4_REQUIRED when empty');

  const mockOk = {
    pgClient: {
      query: async () => ({ rows: [{ n: 5 }] })
    }
  };
  const n = await assertVectorizedReality(mockOk, 'X');
  ok(n === 5, 'assertVectorizedReality returns count when ready');

  // 7. default concepts dir helper (for message example only)
  const { defaultConceptsDir, makeOntoLoadingNotConfiguredError } = require('../routes/ontology/ontologyBuilder');
  const def = defaultConceptsDir('CTX', ['C:\\proj\\root']);
  ok(def.replace(/\\/g, '/').endsWith('proj/root/ontology/concepts') || def.includes('ontology'),
    'defaultConceptsDir under rootPath');

  // 8. missing onto_loading is controlled user-facing stop
  const cfgErr = makeOntoLoadingNotConfiguredError('NO_ONTO', ['C:/proj'], 'missing');
  ok(cfgErr.code === 'ONTO_LOADING_NOT_CONFIGURED', 'error code ONTO_LOADING_NOT_CONFIGURED');
  ok(cfgErr.userFacing === true, 'userFacing flag');
  ok(cfgErr.status === 400, 'HTTP 400');
  ok(String(cfgErr.message).includes('onto_loading'), 'message mentions onto_loading');

  // cleanup
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});

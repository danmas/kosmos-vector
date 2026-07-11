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

  // 9. recover truncated LLM JSON (unterminated string mid-concepts)
  const { parseLlmConceptsResponse } = (() => {
    // re-require exports if present
    const m = require('../routes/ontology/ontologyBuilder');
    return m;
  })();
  if (typeof parseLlmConceptsResponse === 'function') {
    const partial =
      '{"concepts":[{"id":"employee","name":"Employee","rationale":"ok","aspects":["domain"],"anchorFullNames":["EmployeeService"]},{"id":"skill","name":"Skill","rationale":"cut mid str';
    const recovered = parseLlmConceptsResponse(partial);
    ok(recovered.concepts.length >= 1 && recovered.concepts[0].id === 'employee',
      'parseLlmConceptsResponse recovers complete concepts from truncated JSON');
    // single truncated object — salvage by id
    const onlyPartial =
      '{ "concepts": [ { "id": "skill-table", "name": "Таблица навыков", "rationale": "Таблица hr.skills хранит информацию о на';
    const salvaged = parseLlmConceptsResponse(onlyPartial);
    ok(salvaged.concepts.length === 1 && salvaged.concepts[0].id === 'skill-table',
      'salvages incomplete first concept by id/name');
  } else {
    console.log('  skip: parseLlmConceptsResponse not exported');
  }

  // 10. selectAnchorsForPrompt — degree ranking + reserved code budget
  const {
    selectAnchorsForPrompt,
    TABLE_BUDGET_RATIO
  } = require('../routes/ontology/ontologyBuilder');
  ok(TABLE_BUDGET_RATIO === 0.5, 'TABLE_BUDGET_RATIO is 0.5');

  // Large context: 242 tables alphabetical early vs high-degree core + code
  const bigTables = [];
  for (let i = 0; i < 242; i++) {
    const letter = String.fromCharCode(97 + (i % 26));
    bigTables.push({
      full_name: `schema.aa_early_${letter}_${i}`,
      type: 'table',
      degree: 1 + (i % 5) // low degree alphabetically early names
    });
  }
  // Central-ish high degree (alphabetically late names would lose without degree sort)
  const central = [
    { full_name: 'carl_data.auction', type: 'table', degree: 123 },
    { full_name: 'carl_data.profile', type: 'table', degree: 61 },
    { full_name: 'carl_data.users', type: 'table', degree: 45 },
    { full_name: 'carl_data.workflow', type: 'table', degree: 40 },
    { full_name: 'carl_data.commission', type: 'table', degree: 38 }
  ];
  const codeAnchors = [];
  for (let i = 0; i < 40; i++) {
    codeAnchors.push({
      full_name: `pkg.Fn${i}`,
      type: i % 3 === 0 ? 'class' : 'function',
      degree: 50 - (i % 20)
    });
  }
  const bigSelected = selectAnchorsForPrompt(codeAnchors, [...bigTables, ...central], 32);
  ok(bigSelected.length <= 32, 'large context sample length ≤ cap 32');
  ok(bigSelected.length === 32, 'large context fills cap when enough anchors');
  const bigNames = new Set(bigSelected.map((a) => a.full_name));
  ok(bigNames.has('carl_data.auction'), 'highest-degree table auction in sample');
  ok(bigNames.has('carl_data.profile'), 'high-degree table profile in sample');
  ok(bigNames.has('carl_data.workflow'), 'high-degree table workflow in sample');
  const tableCount = bigSelected.filter((a) => a.type === 'table').length;
  const codeCount = bigSelected.filter((a) => a.type !== 'table').length;
  ok(tableCount <= 16, `tables do not exceed budget (~half of 32), got ${tableCount}`);
  ok(codeCount >= 14, `code anchors not starved, got ${codeCount}`);
  // Alphabetically-first low-degree must not displace central solely by name
  ok(
    !bigNames.has('schema.aa_early_a_0') || bigSelected.find((a) => a.full_name === 'carl_data.auction'),
    'degree ranking preferred over alphabet for tables'
  );

  // Small context: 15 tables all kept + code
  const smallTables = Array.from({ length: 15 }, (_, i) => ({
    full_name: `kosmos.t${i}`,
    type: 'table',
    degree: 10 - (i % 10)
  }));
  const smallCode = Array.from({ length: 20 }, (_, i) => ({
    full_name: `mod.F${i}`,
    type: 'function',
    degree: i
  }));
  const smallSelected = selectAnchorsForPrompt(smallCode, smallTables, 32);
  ok(smallSelected.filter((a) => a.type === 'table').length === 15, 'small context keeps all 15 tables');
  ok(smallSelected.length <= 32, 'small context never exceeds cap');
  ok(
    smallSelected.filter((a) => a.type === 'function').length >= 15,
    'small context fills remaining slots with code'
  );

  // Backfill when almost no code anchors
  const onlyTables = Array.from({ length: 50 }, (_, i) => ({
    full_name: `t.b${i}`,
    type: 'table',
    degree: 50 - i
  }));
  const backfill = selectAnchorsForPrompt([], onlyTables, 32);
  ok(backfill.length === 32, 'backfill fills cap with tables when no code');
  ok(backfill[0].full_name === 't.b0', 'backfill tables ordered by degree DESC');

  // cleanup
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});

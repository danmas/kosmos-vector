#!/usr/bin/env node
// Bake a tuned prompt variant into config/ontology_builder.defaults.json (the factory file).
// Prompt TEXT stays in variants/*.txt — this script only moves it into the factory JSON,
// so the "no prompt bodies in code" rule holds. Knobs (model, maxConcepts, depth,
// temperature, seedMode, excludeNamePatterns, enableDescriptionPass) are left untouched.
//
// Usage:
//   node bake-factory.mjs --variant P2 --dry-run     # preview which fields change
//   node bake-factory.mjs --variant P2               # write it
//
// AFTER baking (runtime uses config.json over factory, and factory is cached):
//   1. restart server            (defaults.json is read once per process)
//   2. POST /api/config/reset     (or Settings -> Reset to factory) so config.json takes the new factory
//   3. verify GET /api/config -> ontology_builder is the P2 prompt

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DEFAULTS = path.join(REPO, 'config', 'ontology_builder.defaults.json');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const VARIANT = String(arg('variant', 'P2'));
const DRY = arg('dry-run', false) === true;

const FIELD_FILES = {
  systemPrompt: 'system.txt',
  userPromptTemplate: 'user.txt',
  outputRulesSuffix: 'outputRules.txt',
  retrySystemPrompt: 'retrySystem.txt',
  retryUserTemplate: 'retryUser.txt',
  byoInstruction: 'byo.txt'
};

async function main() {
  if (!existsSync(DEFAULTS)) { console.error('x defaults not found:', DEFAULTS); process.exit(1); }
  const cur = JSON.parse(await readFile(DEFAULTS, 'utf8'));
  const next = { ...cur };
  const changed = [];
  for (const [field, suffix] of Object.entries(FIELD_FILES)) {
    const p = path.join(HERE, 'variants', `${VARIANT}.${suffix}`);
    if (existsSync(p)) {
      const t = await readFile(p, 'utf8');
      if (t !== cur[field]) changed.push(`${field}(${(cur[field] || '').length}c -> ${t.length}c)`);
      next[field] = t;
    } else {
      console.warn(`  ! ${field}: no ${VARIANT}.${suffix} - keeping current`);
    }
  }
  const out = JSON.stringify(next, null, 2) + '\n';
  const chk = JSON.parse(out); // sanity: valid JSON + required prompts present
  if (!String(chk.systemPrompt || '').trim() || !String(chk.userPromptTemplate || '').trim()) {
    console.error('x baked JSON missing required systemPrompt/userPromptTemplate'); process.exit(1);
  }
  console.log(`variant=${VARIANT}; knobs unchanged (maxConcepts=${cur.maxConcepts}, seedMode=${cur.seedMode})`);
  console.log('changed fields:', changed.length ? changed.join(', ') : '(none)');
  if (DRY) { console.log('-- dry run, not written --'); return; }
  await writeFile(DEFAULTS, out);
  console.log('baked ->', DEFAULTS);
  console.log('next: 1) restart server  2) POST /api/config/reset  3) verify GET /api/config');
}
main().catch((e) => { console.error('x', e.message); process.exit(1); });

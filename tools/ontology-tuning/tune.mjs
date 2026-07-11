#!/usr/bin/env node
// Ontology Builder prompt-tuning harness (host-side; needs access to the running server + LLM).
//
// Per run (one variant):
//   1. GET  /api/config   -> read current + factory ontology_builder; save live backup to disk
//   2. PATCH /api/config  -> apply the variant's prompt fields (+ optional --model); skipped for baseline
//   3. POST /api/ontology/build/suggest (or .../export-prompt) -> save the draft/prompt JSON
//   4. restore config to FACTORY when --restore, or ALWAYS after export mode
//
// suggest is READ-ONLY (writes nothing to DB/git), so looping is safe.
// export mode calls .../suggest/export-prompt: assembles the SAME prompt with anchors but
// makes NO LLM call - use it to verify a variant renders correctly for free.
//
// Fair A/B patches ALL prompt fields, not just system+user: factory wording also lives in
// outputRulesSuffix / retrySystemPrompt / retryUserTemplate (the last is appended to every
// user message). Variant files (system+user required, rest optional):
//   variants/<V>.system.txt .user.txt .outputRules.txt .retrySystem.txt .retryUser.txt .byo.txt
//
// Restore target is FACTORY (from GET /api/config -> factory.ontology_builder), NOT the live
// backup: this avoids the trap where a previous un-restored run makes the "backup" already be
// a variant. The live backup is still saved to out/_config-backup.json for reference.
//
// Usage:
//   node tune.mjs --variant P1 --mode export             # free, no LLM; auto-restores to factory
//   node tune.mjs --variant baseline --runs 2
//   node tune.mjs --variant P1 --runs 2 --restore
//   node tune.mjs --variant P1 --runs 1 --model RICH-KOSMOS-INSTRUCT --restore
//
// Flags: --base (default http://localhost:3200) --context (default KOSMOS-VECTOR)
//        --variant baseline|<name>  --runs N  --max 12  --mode suggest|export
//        --model <name>  (set ontology_builder.model to dodge free-tier 429)
//        --restore  --outdir <dir>

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const BASE = String(arg('base', 'http://localhost:3200')).replace(/\/$/, '');
const CONTEXT = String(arg('context', 'KOSMOS-VECTOR'));
const VARIANT = String(arg('variant', 'baseline'));
const RUNS = parseInt(arg('runs', '1'), 10) || 1;
const MAX = parseInt(arg('max', '12'), 10) || 12;
const MODE = String(arg('mode', 'suggest'));
const MODEL = arg('model', null);
const RESTORE = arg('restore', false) === true;
const OUTDIR = path.resolve(String(arg('outdir', path.join(HERE, 'out'))));

// variant file suffix -> ontology_builder config field. Missing optional fields that can leak
// baseline wording are warned about; byoInstruction is cosmetic (no effect on suggest).
const FIELD_FILES = {
  systemPrompt: 'system.txt',
  userPromptTemplate: 'user.txt',
  outputRulesSuffix: 'outputRules.txt',
  retrySystemPrompt: 'retrySystem.txt',
  retryUserTemplate: 'retryUser.txt',
  byoInstruction: 'byo.txt'
};
const REQUIRED = new Set(['systemPrompt', 'userPromptTemplate']);
const LEAK_FIELDS = new Set(['outputRulesSuffix', 'retrySystemPrompt', 'retryUserTemplate']);

async function api(method, endpoint, body) {
  const res = await fetch(BASE + endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  await mkdir(OUTDIR, { recursive: true });
  console.log(`> base=${BASE} context=${CONTEXT} variant=${VARIANT} mode=${MODE} runs=${RUNS} max=${MAX}${MODEL ? ` model=${MODEL}` : ''}`);

  // 1. read live + factory settings
  const cfg = await api('GET', '/api/config');
  if (!cfg.ok) { console.error('x GET /api/config failed:', cfg.status, cfg.json?.error); process.exit(1); }
  const liveOb = cfg.json?.config?.ontology_builder || {};
  const factoryOb = cfg.json?.factory?.ontology_builder || null;
  await writeFile(path.join(OUTDIR, '_config-backup.json'), JSON.stringify(liveOb, null, 2));
  console.log('  saved live backup -> out/_config-backup.json');

  const restoreTarget = factoryOb || liveOb;
  if (!factoryOb) console.warn('  ! no factory.ontology_builder in GET /api/config - will restore to live backup');
  else if (liveOb.systemPrompt !== factoryOb.systemPrompt) {
    console.warn('  ! live config differs from factory (a previous run may not have been restored)');
  }

  // 2. apply variant (patch prompt fields present + optional model); baseline patches only model if given
  if (VARIANT !== 'baseline' || MODEL) {
    const patchOb = { ...liveOb };
    const applied = [];
    if (VARIANT !== 'baseline') {
      for (const [field, suffix] of Object.entries(FIELD_FILES)) {
        const p = path.join(HERE, 'variants', `${VARIANT}.${suffix}`);
        if (existsSync(p)) {
          patchOb[field] = await readFile(p, 'utf8');
          applied.push(`${field}(${patchOb[field].length}c)`);
        } else if (REQUIRED.has(field)) {
          console.error(`x required variant file missing: ${p}`); process.exit(1);
        } else if (LEAK_FIELDS.has(field)) {
          console.warn(`  ! ${field}: no ${VARIANT}.${suffix} - left as factory, may leak baseline wording`);
        }
      }
    }
    if (MODEL) { patchOb.model = MODEL; applied.push(`model=${MODEL}`); }
    const patch = await api('PATCH', '/api/config', { ontology_builder: patchOb });
    if (!patch.ok) { console.error('x PATCH /api/config failed:', patch.status, patch.json?.error); process.exit(1); }
    console.log(`  applied ${VARIANT}: ${applied.join(', ')}`);
  }

  // 3. run
  const endpoint = MODE === 'export'
    ? `/api/ontology/build/suggest/export-prompt?context-code=${encodeURIComponent(CONTEXT)}`
    : `/api/ontology/build/suggest?context-code=${encodeURIComponent(CONTEXT)}`;

  for (let i = 1; i <= RUNS; i++) {
    const r = await api('POST', endpoint, { maxConcepts: MAX, depth: 'concepts+grounding' });
    const outFile = path.join(OUTDIR, `${VARIANT}.${MODE}.${i}.json`);
    await writeFile(outFile, JSON.stringify(r.json, null, 2));
    if (!r.ok) {
      console.error(`  x run ${i}: ${r.status} ${r.json?.code || ''} ${r.json?.error || ''} -> ${outFile}`);
      if (r.json?.code === 'STEP4_REQUIRED') console.error('     (run Step4 for this context first)');
      if (r.status === 429) console.error('     (rate limit: wait, use --runs 1, or --model <non-free>)');
      break;
    }
    if (MODE === 'suggest') {
      const c = Array.isArray(r.json?.concepts) ? r.json.concepts : [];
      console.log(`  ok run ${i}: ${c.length} concepts: ${c.map((x) => x.id).join(', ')} -> ${outFile}`);
    } else {
      console.log(`  ok run ${i}: prompt exported -> ${outFile}`);
    }
  }

  // 4. restore to factory when asked, or ALWAYS after export (export is read-only inspection)
  const mustRestore = (RESTORE || MODE === 'export') && (VARIANT !== 'baseline' || MODEL);
  if (mustRestore) {
    const back = await api('PATCH', '/api/config', { ontology_builder: restoreTarget });
    const to = factoryOb ? 'factory' : 'live backup';
    console.log(back.ok ? `  restored config to ${to}` : `  x restore failed: ${back.json?.error}`);
  }

  console.log('> done. Send out/*.json to Claude for rubric scoring.');
}

main().catch((e) => { console.error('x', e.message); process.exit(1); });

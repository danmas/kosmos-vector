const fs = require('fs');
const path = require('path');

const goldish = [
  'auction',
  'bid',
  'car-catalog',
  'lot',
  'object',
  'commission',
  'profile',
  'dealer',
  'user',
  'inspection',
  'workflow',
  'notification'
];
const hr = new Set([
  'employee',
  'department',
  'skill',
  'project',
  'assignment',
  'employee-skills',
  'hr-system'
]);
const processy = /loader|pipeline|bidding|vector|parser|sync|auth/i;
const junkTable = /pgbench|tmp_|_bup|_bb\b|backup/i;

function score(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(j.concepts)) {
    return { file, error: j.code || j.error, n: 0 };
  }
  const ids = j.concepts.map((c) => c.id);
  let gTotal = 0;
  let gOk = 0;
  const targets = [];
  for (const c of j.concepts) {
    for (const g of c.groundingCandidates || []) {
      gTotal++;
      if (g.target && String(g.target).trim()) {
        gOk++;
        targets.push(String(g.target));
      }
    }
  }
  const goldHits = goldish.filter((g) =>
    ids.some((id) => id === g || id.includes(g) || g.includes(id))
  );
  const hrHits = ids.filter((id) => hr.has(id));
  const proc = ids.filter((id) => processy.test(id));
  const salvage = j.concepts
    .filter((c) => /recovered from truncated/i.test(c.rationale || ''))
    .map((c) => c.id);
  const junkG = targets.filter((t) => junkTable.test(t));
  return {
    file: path.basename(file),
    n: ids.length,
    ids,
    sizeOk: ids.length >= 6 && ids.length <= 12,
    hrHits,
    goldishHits: goldHits,
    goldishCount: goldHits.length,
    processes: proc,
    salvage,
    grounding: gTotal ? `${gOk}/${gTotal}` : '0/0',
    junkGrounding: junkG,
    detail: j.concepts.map((c) => ({
      id: c.id,
      name: c.name,
      rat: (c.rationale || '').slice(0, 70),
      g: (c.groundingCandidates || []).slice(0, 4).map((g) => `${g.role}:${g.target}`)
    }))
  };
}

const dir = path.join('tools/ontology-tuning/out/carl-post-fix');
const files = ['P2.suggest.1.json', 'P2.suggest.2.json'].map((f) => path.join(dir, f));
for (const f of files) {
  console.log(JSON.stringify(score(f), null, 2));
  console.log('---');
}

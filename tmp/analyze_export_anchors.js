const fs = require('fs');
const path = process.argv[2];
if (!path) {
  console.error('usage: node analyze_export_anchors.js <export.json>');
  process.exit(1);
}
const j = JSON.parse(fs.readFileSync(path, 'utf8'));
const u = j.userPrompt || j.combinedForChat || '';
const objs = [...u.matchAll(/\{\s*"n"\s*:\s*"([^"]+)"\s*,\s*"t"\s*:\s*"([^"]+)"/g)].map((m) => ({
  n: m[1],
  t: m[2]
}));
const types = {};
for (const o of objs) types[o.t] = (types[o.t] || 0) + 1;
const tables = objs.filter((o) => o.t === 'table').map((o) => o.n);
const code = objs.filter((o) => o.t !== 'table');
const junk = tables.filter((t) => /pgbench|tmp_|_bup|_bb\b|backup/i.test(t));
console.log(
  JSON.stringify(
    {
      context: j.contextCode,
      meta: {
        anchorsInPrompt: j.anchorsInPrompt,
        tablesInPrompt: j.tablesInPrompt
      },
      parsed: objs.length,
      types,
      tableCount: tables.length,
      codeCount: code.length,
      tables,
      codeSample: code.slice(0, 12),
      hasAuction: tables.some((n) => /auction/i.test(n)),
      hasProfile: tables.some((n) => /profile/i.test(n)),
      hasWorkflow: tables.some((n) => /workflow/i.test(n)),
      hasUsers: tables.some((n) => /\.users\b|users$/i.test(n)),
      junk,
      gate:
        tables.some((n) => /carl_data\.auction|auction/i.test(n)) &&
        tables.some((n) => /profile/i.test(n)) &&
        tables.some((n) => /workflow/i.test(n)) &&
        code.length >= 10
    },
    null,
    2
  )
);

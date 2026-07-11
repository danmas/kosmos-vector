const fs = require('fs');
const p = 'CHANGELOG.md';
let t = fs.readFileSync(p, 'utf8');
if (t.includes('## [2.12.0]')) {
  console.log('already');
  process.exit(0);
}
const entry = `## [2.12.0] - 2026-07-11

### Добавлено / изменено

#### Ontology Builder settings, BYO LLM, clear, fail-fast

- **Settings → Ontology Builder**: model, prompts (system/user/outputRules/retry/BYO/description), seedMode, exclude patterns
- Промпты runtime **только из config** (\`ontology_builder\`); factory — seed
- **BYO LLM**: \`POST /api/ontology/build/suggest/export-prompt\`, \`.../import\`
- **Очистка онтологии**: \`POST /api/ontology/clear\` (concepts + onto-links + MD)
- seedMode \`user-only\`, domain-first anchors, JSON salvage/retry, max_tokens
- Принцип **«Без ИИ жизни нет!»** (LLM fail → stop): \`KB/README_PRINCIPLES.md\`
- UI: шаги 1–3, BYO panel, clear ontology; OpenSpec \`add-ontology-builder-settings\`

---

`;
const idx = t.indexOf('\n## [');
t = idx === -1 ? entry + t : t.slice(0, idx + 1) + entry + t.slice(idx + 1);
fs.writeFileSync(p, t, 'utf8');
console.log('CHANGELOG 2.12.0 added');

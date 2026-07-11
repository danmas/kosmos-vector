const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const d = require('../packages/core/ontologyBuilderDefaults').getDefaultOntologyBuilderConfig();
const j = JSON.parse(fs.readFileSync('./config/ontology_builder.defaults.json', 'utf8'));
const keys = [
  'systemPrompt',
  'userPromptTemplate',
  'byoInstruction',
  'seedMode',
  'maxConcepts',
  'outputRulesSuffix'
];
for (const k of keys) {
  console.log('parity', k, JSON.stringify(d[k]) === JSON.stringify(j[k]));
}

const app = require('../packages/core/appConfigService');
const def = app.getDefaultOntologyBuilderConfig();
console.log('app factory sysLen', def.systemPrompt.length);
const cfg = app.getConfig();
console.log(
  'config ontology_builder.systemPrompt len',
  (cfg.ontology_builder && cfg.ontology_builder.systemPrompt || '').length
);
console.log('seedMode', cfg.ontology_builder.seedMode);

const m = require('../packages/core/ontologyBuilderDefaults');
console.log('exports', Object.keys(m).join(','));
console.log('no DEFAULT_SYSTEM', !('DEFAULT_SYSTEM_PROMPT' in m));

// fail-hard in isolated cwd without defaults file
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-defaults-'));
fs.mkdirSync(path.join(tmp, 'packages', 'core'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
fs.copyFileSync(
  path.join(__dirname, '../packages/core/ontologyBuilderDefaults.js'),
  path.join(tmp, 'packages', 'core', 'ontologyBuilderDefaults.js')
);
const script = `
try {
  const m = require('./packages/core/ontologyBuilderDefaults');
  m.getDefaultOntologyBuilderConfig();
  console.log('UNEXPECTED_OK');
} catch (e) {
  console.log('code=' + e.code);
  console.log('msg=' + String(e.message).slice(0, 160));
}
`;
const r = spawnSync(process.execPath, ['-e', script], { cwd: tmp, encoding: 'utf8' });
console.log('failhard stdout:', (r.stdout || '').trim());
console.log('failhard status', r.status);

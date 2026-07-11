const fs = require('fs');
const path = require('path');

const configPath = path.join('kb-configs', 'FULL_TEST.json');
const c = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const ontoDir = path.join(
  process.cwd(),
  'tests',
  'hr_test_project',
  'ontology',
  'concepts'
);

if (!fs.existsSync(ontoDir)) {
  fs.mkdirSync(ontoDir, { recursive: true });
  console.log('Created', ontoDir);
}

const yaml = c.metadata.custom_settings || '';
if (yaml.includes('onto_loading')) {
  console.log('FULL_TEST already has onto_loading');
  console.log(yaml);
  process.exit(0);
}

c.metadata.custom_settings =
  yaml.trimEnd() +
  `\nonto_loading:\n  enabled: true\n  dirs:\n    - ${ontoDir.replace(/\\/g, '\\\\')}\n`;
c.lastUpdated = new Date().toISOString();
fs.writeFileSync(configPath, JSON.stringify(c, null, 2), 'utf8');
console.log('FULL_TEST updated with onto_loading.dirs =');
console.log(ontoDir);
console.log('--- custom_settings ---');
console.log(c.metadata.custom_settings);

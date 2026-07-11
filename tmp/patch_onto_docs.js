const fs = require('fs');
const path = require('path');

const section = `

---

## 5.2 Построитель онтологии (Step 6)

Интерактивный цикл **suggest → review → materialize → apply**, а не batch-runner.

### Зачем

Автоматический черновик понятий из **уже векторизованной** реальности (после Step4), с grounding-кандидатами и подъёмом L1-связей до отношений понятий. Человек правит черновик; MD остаётся source of truth (\`status: draft\` до review).

### Место в петле

\`\`\`text
Step1/2 (реальность) → Step4 (векторы)
        → Step6 Ontology Builder (suggest/materialize/apply)
        → onto_loading (повтор) + vectorize concept:*
        → validate / ask
\`\`\`

Шаг 6 **не занимает** слот enrichment (id 3). В pipeline-definition: \`{ id: 6, name: ontology_builder }\`.

### API

| Метод | Назначение |
|-------|------------|
| \`POST /api/ontology/build/suggest?context-code=\` | read-only черновик (maxConcepts, depth, seedConcepts, aspects) |
| \`POST /api/ontology/build/materialize?context-code=\` | пишет \`concepts/<id>.md\` в первую \`onto_loading.dirs\` (\`status: draft\`); конфликт id → 409 без overwrite |
| \`POST /api/ontology/build/apply?context-code=\` | materialize → onto_loading → force vectorize \`concept:*\` → validate; ошибка загрузки обрывает |
| \`GET /api/ontology/build/status?context-code=\` | снимок для карточки шага 6 (gate Step4, счётчики) |

**Гейт:** suggest/apply отвечают 409, если нет векторизованных non-concept items.

### UI

В \`kosmos-vector-UI\`: карточка Step 6 в PipelineView открывает \`OntologyBuilderDialog\` (не \`runPipelineStep\`).

### Важно

- suggest **не пишет** файлы и БД.
- После apply concept-чанки **обязательно** перевекторизуются (\`force\` + filter concept).
- \`verified\` только вручную после review.

`;

const p = path.join('KB', 'README_ONTO_LOADING.md');
let t = fs.readFileSync(p, 'utf8');
if (t.includes('## 5.2 Построитель онтологии')) {
  console.log('README_ONTO_LOADING already has builder section');
} else {
  const idx = t.indexOf('\n## 6.');
  t = idx === -1 ? t + section : t.slice(0, idx) + section + t.slice(idx);
  fs.writeFileSync(p, t, 'utf8');
  console.log('README_ONTO_LOADING updated');
}

// CHANGELOG prepend
const cl = 'CHANGELOG.md';
let changelog = fs.readFileSync(cl, 'utf8');
const entry = `## [2.11.0] - 2026-07-11

### Добавлено

#### Ontology Builder (Step 6) — полуавтомат черновика онтологии

- **POST /api/ontology/build/suggest** — read-only черновик понятий из векторизованной реальности
- **POST /api/ontology/build/materialize** — запись \`concepts/*.md\` (\`status: draft\`)
- **POST /api/ontology/build/apply** — materialize → onto_loading → vectorize \`concept:*\` → validate
- **GET /api/ontology/build/status** — снимок для карточки pipeline
- Step 6 \`ontology_builder\` в \`pipelineConfigService.getDefaultStepDefinitions\` (+ merge в существующие kb-config)
- UI (\`kosmos-vector-UI\`): \`OntologyBuilderDialog\`, карточка Step 6 в PipelineView, apiClient methods
- Docs: \`KB/README_ONTO_LOADING.md\` §5.2, OpenAPI \`docs/openapi/paths/ontology.yaml\`

---

`;
if (!changelog.includes('## [2.11.0]')) {
  // insert after first heading block
  const m = changelog.indexOf('\n## [');
  if (m !== -1) {
    changelog = changelog.slice(0, m + 1) + entry + changelog.slice(m + 1);
  } else {
    changelog = entry + changelog;
  }
  fs.writeFileSync(cl, changelog, 'utf8');
  console.log('CHANGELOG updated');
} else {
  console.log('CHANGELOG already has 2.11.0');
}

// README_INDEX — touch actuality for ONTO_LOADING row if present
const idxPath = 'KB/README_INDEX.md';
let idx = fs.readFileSync(idxPath, 'utf8');
if (idx.includes('README_ONTO_LOADING.md') && !idx.includes('Построитель (Step 6)')) {
  idx = idx.replace(
    /README_ONTO_LOADING\.md\]\(\.\/README_ONTO_LOADING\.md\)\s*\|\s*([^|]+)\|/,
    'README_ONTO_LOADING.md](./README_ONTO_LOADING.md) | **Онтология: загрузка, построение (Step 6), работа с проектами** |'
  );
  fs.writeFileSync(idxPath, idx, 'utf8');
  console.log('README_INDEX updated');
}

// Root README — short line near ontology mention if any
const readme = 'README.md';
let r = fs.readFileSync(readme, 'utf8');
if (!r.includes('Ontology Builder')) {
  // append short note at end
  r += `

## Ontology Builder (2.11.0)

Полуавтоматический черновик онтологии (Step 6 pipeline): \`POST /api/ontology/build/suggest|materialize|apply\`.
Подробности: [KB/README_ONTO_LOADING.md](./KB/README_ONTO_LOADING.md) §5.2.
`;
  fs.writeFileSync(readme, r, 'utf8');
  console.log('README updated');
}

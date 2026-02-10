/**
 * Разбивает docs/api-contract.yaml на модульные файлы по предложенной структуре.
 * Запуск: node scripts/split-openapi-contract.js (или bun)
 * Требует: js-yaml, fs, path
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DOCS = path.join(__dirname, '..', 'docs');
const CONTRACT_PATH = path.join(DOCS, 'api-contract.yaml');
const OPENAPI = path.join(DOCS, 'openapi');
const SCHEMAS_DIR = path.join(OPENAPI, 'schemas');
const PATHS_DIR = path.join(OPENAPI, 'paths');
const RESPONSES_DIR = path.join(OPENAPI, 'responses');

const SCHEMA_GROUPS = {
  'ai-item': ['AiItemType', 'Language', 'AiItem', 'AiItemSummary'],
  'links': ['L1Link', 'L1LinkIn'],
  'graph': [
    'GraphNode', 'GraphLink', 'GraphData',
    'LogicNodeType', 'LogicNode', 'LogicEdge', 'LogicGraph',
    'LogicAnalysisResponse', 'LogicGraphResponse'
  ],
  'files': ['ProjectFile'],
  'tags': [
    'Tag', 'TagSummary', 'TagCreateRequest', 'TagUpdateRequest',
    'TagListResponse', 'TagResponse', 'TagItemsResponse',
    'AiItemTagsResponse', 'AiItemTagsRequest', 'BulkTagsRequest', 'BulkTagsResponse'
  ],
  'prompts': [
    'PromptTemplate', 'L1L2TemplateLevel', 'L1L2ObjectTemplates', 'L1L2Templates',
    'RagPrompts', 'NaturalQueryPrompts', 'VectorOperationsPrompts',
    'PromptsConfig', 'PromptsConfigResponse',
    'PromptCategoryEnum', 'FileTypeEnum', 'ObjectTypeEnum', 'LevelEnum'
  ],
  'natural-query': [
    'NaturalQueryRequest', 'NaturalQueryResponse', 'NaturalQueryErrorResponse',
    'NaturalQuerySuggestion', 'NaturalQuerySuggestResponse',
    'AgentScript', 'AgentScriptListResponse', 'AgentScriptDetailResponse', 'AgentScriptUpdateRequest'
  ],
  'common': [
    'TypeStat', 'LanguageStat', 'DashboardStats', 'KnowledgeBaseConfig', 'FileSelectionRequest',
    'ChatRequest', 'ChatResponse', 'AskRequest', 'AskResponse',
    'SuccessResponse', 'ErrorResponse', 'HealthResponse',
    'ColumnInfo', 'ColumnExtractionReport', 'ColumnExtractionResponse',
    'BatchColumnExtractionReport', 'BatchColumnExtractionResponse',
    'AiComment', 'AiCommentResponse', 'AiCommentRequest',
    'PipelineStepStatus', 'PipelineStepDefinition', 'PipelineContextDefinition', 'PipelineContextConfig',
    'PipelineStepsStatusResponse', 'PipelineStepHistoryEntry', 'PipelineStepHistoryResponse', 'PipelineStepsHistoryResponse'
  ]
};

const PATH_GROUPS = {
  'system': ['/api/health', '/api/contract', '/api/logs'],
  'kb-config': ['/api/kb-config'],
  'core': [
    '/api/vector-db', '/api/project/tree', '/api/project/selection',
    '/api/items', '/api/items-list', '/api/items/{id}',
    '/api/items/{id}/comment', '/api/items/{id}/tags', '/api/items/{id}/logic-graph',
    '/api/items/{id}/extract-columns', '/api/extract-all-columns', '/api/items/{id}/analyze-logic',
    '/api/stats', '/api/graph'
  ],
  'chat': ['/api/chat', '/api/ask'],
  'natural-query': ['/api/v1/natural-query', '/api/v1/natural-query/suggest', '/api/agent-scripts', '/api/agent-scripts/{id}', '/api/agent-scripts/{id}/embed', '/api/agent-scripts/{id}/execute'],
  'pipeline': [
    '/api/pipeline/start', '/api/pipeline', '/api/pipeline/{id}', '/api/pipeline/{id}/progress',
    '/api/pipeline/steps/status', '/api/pipeline/steps/history', '/api/pipeline/step/{id}/history',
    '/api/pipeline/context-definition', '/api/pipeline/context-config', '/api/contexts',
    '/api/logs/stream', '/api/pipeline/{id}/stream'
  ],
  'prompts': [
    '/api/prompts', '/api/prompts/{category}', '/api/prompts/l1l2/{fileType}/{objectType}/{level}',
    '/api/prompts/l1l2/{fileType}', '/api/prompts/reload', '/api/prompts/validate',
    '/api/prompts/export', '/api/prompts/import'
  ],
  'tags': ['/api/tags', '/api/tags/{code}', '/api/tags/{code}/items', '/api/ai-items/bulk/tags/add', '/api/ai-items/bulk/tags/remove'],
  'chunks': ['/api/files/vectorize-chunk/{chunkId}', '/vectorize-ai-items'],
  'rag': ['/api/rag/retrieve', '/api/rag/ask', '/api/rag/compare-strategies', '/api/rag/strategies'],
  'files': ['/api/file-content', '/api/files']
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const backupPath = path.join(DOCS, 'api-contract.yaml.bak');
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(CONTRACT_PATH, backupPath);
    console.log('Backup created:', backupPath);
  }
  const raw = fs.readFileSync(CONTRACT_PATH, 'utf8');
  const spec = yaml.load(raw);
  const schemas = spec.components?.schemas || {};
  const responses = spec.components?.responses || {};
  const paths = spec.paths || {};

  ensureDir(SCHEMAS_DIR);
  ensureDir(PATHS_DIR);
  ensureDir(RESPONSES_DIR);

  const allSchemaNames = new Set(Object.keys(schemas));
  const grouped = new Set();
  for (const list of Object.values(SCHEMA_GROUPS)) {
    for (const n of list) grouped.add(n);
  }
  for (const n of allSchemaNames) {
    if (!grouped.has(n)) console.warn('Schema not in any group:', n);
  }

  for (const [fileBase, names] of Object.entries(SCHEMA_GROUPS)) {
    const obj = {};
    for (const name of names) {
      if (schemas[name] != null) obj[name] = schemas[name];
    }
    const outPath = path.join(SCHEMAS_DIR, fileBase + '.yaml');
    fs.writeFileSync(outPath, yaml.dump(obj, { lineWidth: -1, noRefs: false }), 'utf8');
  }

  const responseNames = ['BadRequest', 'NotFound', 'InternalError'];
  const responsesObj = {};
  for (const name of responseNames) {
    if (responses[name] != null) responsesObj[name] = responses[name];
  }
  fs.writeFileSync(
    path.join(RESPONSES_DIR, 'errors.yaml'),
    yaml.dump(responsesObj, { lineWidth: -1, noRefs: false }),
    'utf8'
  );

  const allPathKeys = new Set(Object.keys(paths));
  const pathGrouped = new Set();
  for (const list of Object.values(PATH_GROUPS)) {
    for (const p of list) pathGrouped.add(p);
  }
  for (const p of allPathKeys) {
    if (!pathGrouped.has(p)) console.warn('Path not in any group:', p);
  }

  for (const [fileBase, pathList] of Object.entries(PATH_GROUPS)) {
    const obj = {};
    for (const p of pathList) {
      if (paths[p] != null) obj[p] = paths[p];
    }
    const outPath = path.join(PATHS_DIR, fileBase + '.yaml');
    fs.writeFileSync(outPath, yaml.dump(obj, { lineWidth: -1, noRefs: false }), 'utf8');
  }

  const mainSpec = {
    openapi: spec.openapi,
    info: spec.info,
    servers: spec.servers,
    tags: spec.tags,
    components: {
      schemas: {},
      responses: {}
    },
    paths: {}
  };

  const ref = (file, fragment) => `openapi/${file}#${fragment}`;
  for (const [fileBase, names] of Object.entries(SCHEMA_GROUPS)) {
    for (const name of names) {
      if (schemas[name] != null) {
        mainSpec.components.schemas[name] = { $ref: ref(`schemas/${fileBase}.yaml`, `/${name}`) };
      }
    }
  }
  for (const name of responseNames) {
    if (responses[name] != null) {
      mainSpec.components.responses[name] = { $ref: ref('responses/errors.yaml', `/${name}`) };
    }
  }

  function pathToPointer(p) {
    return '/~1' + p.slice(1).replace(/~/g, '~0').replace(/\//g, '~1');
  }
  for (const [fileBase, pathList] of Object.entries(PATH_GROUPS)) {
    for (const p of pathList) {
      if (paths[p] != null) {
        mainSpec.paths[p] = { $ref: ref(`paths/${fileBase}.yaml`, pathToPointer(p)) };
      }
    }
  }

  const mainPath = path.join(DOCS, 'api-contract.yaml');
  let mainYaml = yaml.dump(mainSpec, { lineWidth: -1, noRefs: false });
  mainYaml = mainYaml.replace(/\$ref: (openapi\/[^\n]+)/g, '$ref: "$1"');
  fs.writeFileSync(mainPath, mainYaml, 'utf8');
  console.log('Written main contract:', mainPath);
  console.log('Schema files:', Object.keys(SCHEMA_GROUPS).length);
  console.log('Path files:', Object.keys(PATH_GROUPS).length);
}

main();

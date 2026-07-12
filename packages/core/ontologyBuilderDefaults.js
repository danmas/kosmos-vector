// Ontology Builder factory defaults loader + prompt template renderer.
// Prompt *text* lives only in config/ontology_builder.defaults.json (not in this module).
// Runtime user settings: config.json → ontology_builder (via appConfigService).

const fs = require('fs');
const path = require('path');

const DEFAULTS_FILE = path.join(process.cwd(), 'config', 'ontology_builder.defaults.json');

/** Cached successful load (process lifetime). Edit defaults.json → restart required. */
let cachedDefaults = null;
/** Cached load failure so we do not re-read a broken path every call. */
let cachedLoadError = null;

const PROMPT_KEYS = [
  'systemPrompt',
  'userPromptTemplate',
  'descriptionSystemPrompt',
  'descriptionPrompt',
  'outputRulesSuffix',
  'retrySystemPrompt',
  'retryUserTemplate',
  'byoInstruction'
];

/**
 * @param {Error|string|null} cause
 * @returns {Error & { code: string, status: number, userFacing: boolean }}
 */
function makeDefaultsMissingError(cause) {
  const detail =
    cause && typeof cause === 'object' && cause.message
      ? cause.message
      : cause
        ? String(cause)
        : '';
  const err = new Error(
    `Ontology builder factory defaults missing or invalid. Create or fix ` +
      `config/ontology_builder.defaults.json` +
      (detail ? ` (${detail})` : '')
  );
  err.code = 'ONTOLOGY_DEFAULTS_MISSING';
  err.status = 500;
  err.userFacing = true;
  if (cause && typeof cause === 'object') err.cause = cause;
  return err;
}

/**
 * Read + validate external factory defaults (once per process).
 * @returns {object}
 */
function loadDefaultsFromFile() {
  if (cachedDefaults) return cachedDefaults;
  if (cachedLoadError) throw cachedLoadError;

  try {
    if (!fs.existsSync(DEFAULTS_FILE)) {
      throw makeDefaultsMissingError('file not found');
    }
    const raw = fs.readFileSync(DEFAULTS_FILE, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      throw makeDefaultsMissingError(parseErr);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw makeDefaultsMissingError('root must be a JSON object');
    }
    if (!String(parsed.systemPrompt || '').trim() || !String(parsed.userPromptTemplate || '').trim()) {
      throw makeDefaultsMissingError('systemPrompt and userPromptTemplate are required');
    }

    cachedDefaults = { ...parsed };
    if (Array.isArray(parsed.excludeNamePatterns)) {
      cachedDefaults.excludeNamePatterns = [...parsed.excludeNamePatterns];
    } else {
      cachedDefaults.excludeNamePatterns = [];
    }
    return cachedDefaults;
  } catch (e) {
    if (e && e.code === 'ONTOLOGY_DEFAULTS_MISSING') {
      cachedLoadError = e;
      throw e;
    }
    cachedLoadError = makeDefaultsMissingError(e);
    throw cachedLoadError;
  }
}

/**
 * Factory defaults for ontology_builder (prompts + knobs).
 * Source: config/ontology_builder.defaults.json only — no prompt bodies in code.
 * @returns {object}
 * @throws {Error} code ONTOLOGY_DEFAULTS_MISSING when file absent/invalid
 */
function getDefaultOntologyBuilderConfig() {
  const d = loadDefaultsFromFile();
  // Return a shallow copy so callers cannot mutate the module cache
  return {
    model: d.model === undefined ? null : d.model,
    maxConcepts: d.maxConcepts != null ? d.maxConcepts : 10,
    depth: d.depth || 'concepts+grounding',
    temperature: d.temperature != null ? d.temperature : 0,
    systemPrompt: d.systemPrompt,
    userPromptTemplate: d.userPromptTemplate,
    descriptionSystemPrompt: d.descriptionSystemPrompt || '',
    descriptionPrompt: d.descriptionPrompt || '',
    outputRulesSuffix: d.outputRulesSuffix || '',
    retrySystemPrompt: d.retrySystemPrompt || '',
    retryUserTemplate: d.retryUserTemplate || '',
    byoInstruction: d.byoInstruction || '',
    seedMode: d.seedMode === 'all-existing' ? 'all-existing' : 'user-only',
    excludeNamePatterns: Array.isArray(d.excludeNamePatterns) ? [...d.excludeNamePatterns] : [],
    enableDescriptionPass: d.enableDescriptionPass === true
  };
}

/**
 * Apply template placeholders.
 * Supported: {{maxConcepts}}, {{contextCode}}, {{seedConcepts}}, {{existingConcepts}}, {{anchors}}, {{concepts}}
 * (Logic only — not a prompt source.)
 */
function renderPromptTemplate(template, vars = {}) {
  let out = String(template || '');
  const seed = Array.isArray(vars.seedConcepts)
    ? vars.seedConcepts.join(', ') || '(none)'
    : (vars.seedConcepts || '(none)');
  const existing = Array.isArray(vars.existingConcepts)
    ? vars.existingConcepts.join(', ') || '(none)'
    : (vars.existingConcepts || '(none)');
  const anchors =
    typeof vars.anchors === 'string'
      ? vars.anchors
      : JSON.stringify(vars.anchors || [], null, 2);
  const concepts =
    typeof vars.concepts === 'string'
      ? vars.concepts
      : JSON.stringify(vars.concepts || [], null, 2);

  out = out.replace(/\{\{maxConcepts\}\}/g, String(vars.maxConcepts ?? ''));
  out = out.replace(/\{\{contextCode\}\}/g, String(vars.contextCode ?? ''));
  out = out.replace(/\{\{seedConcepts\}\}/g, seed);
  out = out.replace(/\{\{existingConcepts\}\}/g, existing);
  out = out.replace(/\{\{anchors\}\}/g, anchors);
  out = out.replace(/\{\{concepts\}\}/g, concepts);
  return out;
}

/** Absolute path to factory defaults file (for docs / errors). */
function getOntologyBuilderDefaultsPath() {
  return DEFAULTS_FILE;
}

module.exports = {
  getDefaultOntologyBuilderConfig,
  renderPromptTemplate,
  getOntologyBuilderDefaultsPath,
  PROMPT_KEYS
};

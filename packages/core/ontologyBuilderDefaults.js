// Default Ontology Builder settings (system prompts, knobs).
// Used by appConfigService + routes/ontology/ontologyBuilder.js

const DEFAULT_SYSTEM_PROMPT = `You are an ontology designer for a software knowledge base (code + SQL + docs).

Goal: a SMALL domain map that helps humans and RAG answer "what is this system?" — not a catalog of CRUD methods.

Hard rules:
1) DOMAIN FIRST: business nouns — Employee, Department, Skill, Project, Assignment, …
   Prefer ids: employee, department, skill, project, assignment, hr-system (kebab-case).
2) ONE concept per domain entity. Do NOT split into core / mutations / reporting / queries / ops-service.
   Bad: employee-ops-service, employee-mutation, department-reporting.
   Good: employee (table + service + key methods as anchors together).
3) Tables: every "t":"table" anchor SHOULD appear under exactly one domain concept (stored_in via that table full_name in anchorFullNames).
4) Services/classes: attach as anchors on the same domain concept (or one *Service concept that "uses" the domain concept) — not many service fragments.
5) Methods are NEVER separate top-level concepts. Put methods only inside anchorFullNames of a domain/service concept.
6) Utilities (format*, validate*, log*, toString): do not create concepts for them.
7) aspects: use ["domain"] for entities; ["service"] only for a real application service module if needed — not both on every concept.
8) id: kebab-case [a-z0-9-]+ ; name: short label (RU or EN).
9) rationale: 1 short business sentence in Russian (≤80 chars).
10) relations: part_of|uses|manages|produces|consumes|precedes|related_to; target = other concept id (no concept: prefix).
    Prefer: service uses domain; employee part_of department; assignment uses employee/project; skill linked via employee-skills.
11) Return JSON only: { "concepts": [ ... ] }. Prefer 5–10 concepts total, not 20 fragments.`;

const DEFAULT_USER_PROMPT_TEMPLATE = `Propose up to {{maxConcepts}} ontology concepts for context-code "{{contextCode}}".

Seed policy:
- Prefer reusing these CANONICAL domain ids when they fit the anchors (refine grounding, do not invent *-ops / *-mutation names instead):
  employee, department, skill, project, assignment, employee-skills, hr-system
- Only AVOID inventing duplicates of junk fragments if listed here (user avoid-list; may be empty):
{{seedConcepts}}
- Existing concepts already in DB (you MAY reuse/refine these ids; do not invent parallel "ops" clones):
{{existingConcepts}}

Anchors (vectorized reality — put exact "n" values into anchorFullNames):
{{anchors}}

Priority when choosing concepts:
1) All tables (t=table) must be covered.
2) Main classes/interfaces (*Service, Department, Employee, Skill…).
3) Important SQL functions (schema.fn) as anchors under the right domain.
4) Do NOT create a concept per method.

Output schema:
{
  "concepts": [
    {
      "id": "kebab-case",
      "name": "Human Name",
      "rationale": "one short business sentence in Russian",
      "aspects": ["domain"],
      "anchorFullNames": ["exact n from anchors"],
      "relations": [{ "type": "uses", "target": "other-id", "comment": "optional" }]
    }
  ]
}

Max concepts: {{maxConcepts}}. Complete valid JSON only.`;

const DEFAULT_DESCRIPTION_SYSTEM_PROMPT =
  'You write concise Russian ontology concept descriptions. Reply with JSON only.';

const DEFAULT_DESCRIPTION_PROMPT = `For each concept below, write a clear Russian description (2–4 sentences) of what it means in the system.
Do not invent APIs or tables not listed in anchors.
Return JSON: { "descriptions": { "<concept-id>": "text..." } }.

Concepts:
{{concepts}}

Anchors per concept are already attached in the payload.`;

/** Appended to every user message (suggest / export). Editable in Settings only. */
const DEFAULT_OUTPUT_RULES_SUFFIX = `
CRITICAL OUTPUT RULES:
- ONE complete JSON object only: {"concepts":[...]}
- Domain-first ids (employee, department, skill, project, assignment…). NO *-ops / *-mutation / *-reporting fragments.
- Cover ALL table anchors (t=table). Methods only as anchors, never as separate concepts.
- rationale ≤ 80 chars; ≤5 anchorFullNames per concept (use "n" from anchors).
- Prefer 5–10 concepts. Close every quote/bracket. No markdown. STOP after valid JSON.`;

/** Used only on JSON-retry (when primary response is truncated). Editable in Settings. */
const DEFAULT_RETRY_SYSTEM_PROMPT = `You output only valid compact domain ontology JSON. Prefer employee/department/skill/project. Never invent *-mutation service fragments. Never truncate mid-string. Reply with {"concepts":[...]} only.`;

const DEFAULT_RETRY_USER_TEMPLATE = `Context: {{contextCode}}. Up to {{maxConcepts}} DOMAIN concepts as JSON {"concepts":[...]}.
Canonical ids to prefer: employee, department, skill, project, assignment.
Avoid-list (optional): {{seedConcepts}}
Existing (may reuse): {{existingConcepts}}
Anchors n/t/d: {{anchors}}
No method-only concepts. Cover tables. Complete JSON only.`;

const DEFAULT_BYO_INSTRUCTION = `Paste ONLY the JSON object {"concepts":[...]} back into Ontology Builder → «Вставить ответ LLM».
Reuse canonical domain ids when possible; do not invent employee-ops-service style clones.`;

function getDefaultOntologyBuilderConfig() {
  return {
    model: null, // null → fall back to KOSMOS_MODEL
    maxConcepts: 10,
    depth: 'concepts+grounding',
    temperature: 0,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
    descriptionSystemPrompt: DEFAULT_DESCRIPTION_SYSTEM_PROMPT,
    descriptionPrompt: DEFAULT_DESCRIPTION_PROMPT,
    outputRulesSuffix: DEFAULT_OUTPUT_RULES_SUFFIX,
    retrySystemPrompt: DEFAULT_RETRY_SYSTEM_PROMPT,
    retryUserTemplate: DEFAULT_RETRY_USER_TEMPLATE,
    byoInstruction: DEFAULT_BYO_INSTRUCTION,
    // Seed mode for LLM avoid-list:
    // user-only — only body.seedConcepts (default; do NOT dump all DB concepts)
    // all-existing — old behavior: every concept:* in context
    seedMode: 'user-only',
    excludeNamePatterns: [
      '^format[A-Z]',
      '^validate[A-Z]',
      'Validator$',
      '^toString$',
      '^log$'
    ],
    enableDescriptionPass: false
  };
}

/**
 * Apply template placeholders.
 * Supported: {{maxConcepts}}, {{contextCode}}, {{seedConcepts}}, {{existingConcepts}}, {{anchors}}, {{concepts}}
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

module.exports = {
  getDefaultOntologyBuilderConfig,
  renderPromptTemplate,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_USER_PROMPT_TEMPLATE,
  DEFAULT_DESCRIPTION_PROMPT,
  DEFAULT_OUTPUT_RULES_SUFFIX,
  DEFAULT_RETRY_SYSTEM_PROMPT,
  DEFAULT_RETRY_USER_TEMPLATE,
  DEFAULT_BYO_INSTRUCTION
};

// Загрузчик TSX компонентов (React)
// routes/loaders/tsxLoader.js

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const { checkFileChanged } = require('../../packages/core/fileChangeDetector');
const { processEntitiesIncremental } = require('../../packages/core/entityProcessor');
const { findBlockEnd, extractDocComment, isBuiltinFunction } = require('./tsParseUtils');

/**
 * Проверка, является ли имя custom hook'ом
 * @param {string} name - Имя функции
 * @returns {boolean}
 */
function isCustomHook(name) {
    return /^use[A-Z]/.test(name);
}

/**
 * Проверка, является ли компонент (по имени)
 * @param {string} name - Имя функции/класса
 * @returns {boolean}
 */
function isComponentName(name) {
    return /^[A-Z]/.test(name);
}

/**
 * Получение кода узла из исходного текста
 * @param {object} node - AST узел
 * @param {string} sourceCode - Исходный код
 * @returns {string}
 */
function getNodeCode(node, sourceCode) {
    if (node.start !== undefined && node.end !== undefined) {
        return sourceCode.substring(node.start, node.end);
    }
    return '';
}

/**
 * Извлечение имени компонента из различных паттернов
 * @param {object} node - AST узел
 * @param {string} filePath - Путь к файлу (для default export без имени)
 * @returns {string|null}
 */
function extractComponentName(node, filePath) {
    // Прямое имя функции/класса
    if (node.id && node.id.name) {
        return node.id.name;
    }
    
    // Arrow function присвоенная переменной
    if (node.type === 'VariableDeclarator' && node.id && node.id.name) {
        return node.id.name;
    }
    
    // Default export без имени - используем имя файла
    return path.basename(filePath, path.extname(filePath));
}

/**
 * Определение wrapper (forwardRef, memo)
 * @param {object} node - AST узел
 * @returns {string|null}
 */
function detectWrapper(node) {
    if (node.type === 'CallExpression') {
        const callee = node.callee;
        
        // React.forwardRef или forwardRef
        if (callee.type === 'MemberExpression' && 
            callee.object.name === 'React' && 
            callee.property.name === 'forwardRef') {
            return 'forwardRef';
        }
        if (callee.type === 'Identifier' && callee.name === 'forwardRef') {
            return 'forwardRef';
        }
        
        // React.memo или memo
        if (callee.type === 'MemberExpression' && 
            callee.object.name === 'React' && 
            callee.property.name === 'memo') {
            return 'memo';
        }
        if (callee.type === 'Identifier' && callee.name === 'memo') {
            return 'memo';
        }
    }
    return null;
}

/**
 * Проверка, содержит ли функция JSX
 * @param {object} node - AST узел
 * @returns {boolean}
 */
function containsJSX(node) {
    let hasJSX = false;
    
    function traverse(n) {
        if (!n || typeof n !== 'object') return;
        
        if (n.type === 'JSXElement' || n.type === 'JSXFragment') {
            hasJSX = true;
            return;
        }
        
        for (const key of Object.keys(n)) {
            if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
            
            const child = n[key];
            if (Array.isArray(child)) {
                child.forEach(traverse);
            } else if (child && typeof child === 'object') {
                traverse(child);
            }
        }
    }
    
    traverse(node);
    return hasJSX;
}

/**
 * Извлечение сигнатуры функции
 * @param {object} node - AST узел
 * @param {string} name - Имя функции
 * @returns {string}
 */
function extractSignature(node, name) {
    const params = [];
    
    if (node.params) {
        for (const param of node.params) {
            if (param.type === 'Identifier') {
                params.push(param.name);
            } else if (param.type === 'ObjectPattern') {
                params.push('{ ... }');
            } else if (param.type === 'ArrayPattern') {
                params.push('[ ... ]');
            } else if (param.type === 'RestElement') {
                params.push('...' + (param.argument?.name || 'rest'));
            } else if (param.type === 'AssignmentPattern') {
                params.push((param.left?.name || '?') + ' = ...');
            }
        }
    }
    
    const async = node.async ? 'async ' : '';
    return `${async}function ${name}(${params.join(', ')})`;
}

/**
 * Парсинг TSX сущностей из контента с использованием @babel/parser
 * @param {string} tsxContent - Содержимое TSX файла
 * @param {string} filePath - Путь к файлу
 * @returns {Array} Массив сущностей
 */
function parseTsxEntitiesFromContent(tsxContent, filePath) {
    const entities = [];
    const lines = tsxContent.split('\n');
    
    let ast;
    try {
        ast = parser.parse(tsxContent, {
            sourceType: 'module',
            plugins: [
                'typescript',
                'jsx',
                'decorators-legacy',
                'classProperties',
                'classPrivateProperties',
                'classPrivateMethods',
                'exportDefaultFrom',
                'exportNamespaceFrom',
                'dynamicImport',
                'nullishCoalescingOperator',
                'optionalChaining'
            ]
        });
    } catch (parseError) {
        console.error(`[TSX-Loader] Ошибка парсинга ${path.basename(filePath)}: ${parseError.message}`);
        return entities;
    }
    
    const processedNames = new Set();
    
    // Обход AST
    for (const node of ast.program.body) {
        try {
            // === Interface ===
            if (node.type === 'TSInterfaceDeclaration') {
                const name = node.id.name;
                if (processedNames.has(name)) continue;
                processedNames.add(name);
                
                const startLine = node.loc?.start?.line - 1 || 0;
                const comment = extractDocComment(lines, startLine);
                const body = getNodeCode(node, tsxContent);
                
                entities.push({
                    full_name: name,
                    sname: name,
                    type: 'interface',
                    comment: comment,
                    signature: `interface ${name}`,
                    body: body,
                    metadata: {}
                });
            }
            
            // === Type Alias ===
            else if (node.type === 'TSTypeAliasDeclaration') {
                const name = node.id.name;
                if (processedNames.has(name)) continue;
                processedNames.add(name);
                
                const startLine = node.loc?.start?.line - 1 || 0;
                const comment = extractDocComment(lines, startLine);
                const body = getNodeCode(node, tsxContent);
                
                entities.push({
                    full_name: name,
                    sname: name,
                    type: 'type',
                    comment: comment,
                    signature: `type ${name}`,
                    body: body,
                    metadata: {}
                });
            }
            
            // === Function Declaration (может быть компонент или hook) ===
            else if (node.type === 'FunctionDeclaration' && node.id) {
                const name = node.id.name;
                if (processedNames.has(name)) continue;
                processedNames.add(name);
                
                const startLine = node.loc?.start?.line - 1 || 0;
                const comment = extractDocComment(lines, startLine);
                const body = getNodeCode(node, tsxContent);
                const hasJSX = containsJSX(node);
                
                let type = 'function';
                const metadata = {};
                
                if (isCustomHook(name)) {
                    type = 'tsx_hook';
                } else if (hasJSX && isComponentName(name)) {
                    type = 'tsx_component';
                }
                
                entities.push({
                    full_name: name,
                    sname: name,
                    type: type,
                    comment: comment,
                    signature: extractSignature(node, name),
                    body: body,
                    metadata: metadata
                });
            }
            
            // === Export Default Function ===
            else if (node.type === 'ExportDefaultDeclaration') {
                const decl = node.declaration;
                
                // export default function MyComponent() {}
                if (decl.type === 'FunctionDeclaration') {
                    const name = decl.id?.name || extractComponentName(decl, filePath);
                    if (processedNames.has(name)) continue;
                    processedNames.add(name);
                    
                    const startLine = node.loc?.start?.line - 1 || 0;
                    const comment = extractDocComment(lines, startLine);
                    const body = getNodeCode(decl, tsxContent);
                    const hasJSX = containsJSX(decl);
                    
                    let type = 'function';
                    if (isCustomHook(name)) {
                        type = 'tsx_hook';
                    } else if (hasJSX) {
                        type = 'tsx_component';
                    }
                    
                    entities.push({
                        full_name: name,
                        sname: name,
                        type: type,
                        comment: comment,
                        signature: extractSignature(decl, name),
                        body: body,
                        metadata: {}
                    });
                }
                
                // export default class MyComponent extends React.Component {}
                else if (decl.type === 'ClassDeclaration') {
                    const name = decl.id?.name || extractComponentName(decl, filePath);
                    if (processedNames.has(name)) continue;
                    processedNames.add(name);
                    
                    const startLine = node.loc?.start?.line - 1 || 0;
                    const comment = extractDocComment(lines, startLine);
                    const body = getNodeCode(decl, tsxContent);
                    
                    // Проверяем, наследуется ли от React.Component
                    let isReactClass = false;
                    if (decl.superClass) {
                        const sc = decl.superClass;
                        if (sc.type === 'MemberExpression' && 
                            sc.object.name === 'React' && 
                            (sc.property.name === 'Component' || sc.property.name === 'PureComponent')) {
                            isReactClass = true;
                        } else if (sc.type === 'Identifier' && 
                            (sc.name === 'Component' || sc.name === 'PureComponent')) {
                            isReactClass = true;
                        }
                    }
                    
                    entities.push({
                        full_name: name,
                        sname: name,
                        type: isReactClass ? 'tsx_component' : 'class',
                        comment: comment,
                        signature: `class ${name}`,
                        body: body,
                        metadata: isReactClass ? { classComponent: true } : {}
                    });
                }
            }
            
            // === Variable Declaration (arrow functions, forwardRef, memo) ===
            else if (node.type === 'VariableDeclaration' || 
                     (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration')) {
                
                const varDecl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
                
                for (const declarator of varDecl.declarations) {
                    if (!declarator.id || !declarator.id.name) continue;
                    
                    const name = declarator.id.name;
                    if (processedNames.has(name)) continue;
                    
                    const init = declarator.init;
                    if (!init) continue;
                    
                    const startLine = node.loc?.start?.line - 1 || 0;
                    const comment = extractDocComment(lines, startLine);
                    const body = getNodeCode(node, tsxContent);
                    
                    // Проверяем wrapper (forwardRef, memo)
                    const wrapper = detectWrapper(init);
                    
                    // Arrow function
                    if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
                        processedNames.add(name);
                        
                        const hasJSX = containsJSX(init);
                        let type = 'arrow';
                        const metadata = {};
                        
                        if (isCustomHook(name)) {
                            type = 'tsx_hook';
                        } else if (hasJSX && isComponentName(name)) {
                            type = 'tsx_component';
                        }
                        
                        entities.push({
                            full_name: name,
                            sname: name,
                            type: type,
                            comment: comment,
                            signature: extractSignature(init, name),
                            body: body,
                            metadata: metadata
                        });
                    }
                    // forwardRef / memo wrapper
                    else if (wrapper) {
                        processedNames.add(name);
                        
                        entities.push({
                            full_name: name,
                            sname: name,
                            type: 'tsx_component',
                            comment: comment,
                            signature: `const ${name} = React.${wrapper}(...)`,
                            body: body,
                            metadata: { wrapper: wrapper }
                        });
                    }
                    // styled-components: styled.div`...`
                    else if (init.type === 'TaggedTemplateExpression') {
                        const tag = init.tag;
                        if (tag.type === 'MemberExpression' && tag.object.name === 'styled') {
                            processedNames.add(name);
                            
                            entities.push({
                                full_name: name,
                                sname: name,
                                type: 'tsx_component',
                                comment: comment,
                                signature: `const ${name} = styled.${tag.property.name}\`...\``,
                                body: body,
                                metadata: { styled: true }
                            });
                        }
                    }
                }
            }
            
            // === Class Declaration (может быть React.Component) ===
            else if (node.type === 'ClassDeclaration' || 
                     (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'ClassDeclaration')) {
                
                const classDecl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
                if (!classDecl.id) continue;
                
                const name = classDecl.id.name;
                if (processedNames.has(name)) continue;
                processedNames.add(name);
                
                const startLine = node.loc?.start?.line - 1 || 0;
                const comment = extractDocComment(lines, startLine);
                const body = getNodeCode(classDecl, tsxContent);
                
                // Проверяем, наследуется ли от React.Component
                let isReactClass = false;
                if (classDecl.superClass) {
                    const sc = classDecl.superClass;
                    if (sc.type === 'MemberExpression' && 
                        sc.object.name === 'React' && 
                        (sc.property.name === 'Component' || sc.property.name === 'PureComponent')) {
                        isReactClass = true;
                    } else if (sc.type === 'Identifier' && 
                        (sc.name === 'Component' || sc.name === 'PureComponent')) {
                        isReactClass = true;
                    }
                }
                
                entities.push({
                    full_name: name,
                    sname: name,
                    type: isReactClass ? 'tsx_component' : 'class',
                    comment: comment,
                    signature: `class ${name}`,
                    body: body,
                    metadata: isReactClass ? { classComponent: true } : {}
                });
            }
        } catch (nodeError) {
            console.warn(`[TSX-Loader] Ошибка обработки узла: ${nodeError.message}`);
        }
    }
    
    return entities;
}

/**
 * Извлечение связей L1 из TSX кода с использованием @babel/parser
 * @param {string} code - Исходный код
 * @param {string} entityType - Тип сущности (tsx_component, tsx_hook, etc.)
 * @returns {object} Объект со связями
 */
async function parseTsxL1(code, entityType = 'tsx_component') {
    const imports = new Set();
    const typeImports = new Set();
    const usesComponents = new Set();
    const usesHooks = new Set();
    const calledFunctions = new Set();
    
    let ast;
    try {
        ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx'],
            allowReturnOutsideFunction: true
        });
    } catch (parseError) {
        // Fallback на regex для неполного кода
        return parseTsxL1Regex(code);
    }
    
    function traverse(node) {
        if (!node || typeof node !== 'object') return;
        
        // Import declarations
        if (node.type === 'ImportDeclaration') {
            const source = node.source.value;
            
            // Type imports
            if (node.importKind === 'type') {
                typeImports.add(source);
            } else {
                imports.add(source);
            }
        }
        
        // JSX Elements - использование компонентов
        else if (node.type === 'JSXOpeningElement') {
            const nameNode = node.name;
            let componentName = null;
            
            if (nameNode.type === 'JSXIdentifier') {
                componentName = nameNode.name;
            } else if (nameNode.type === 'JSXMemberExpression') {
                // Например: Dropdown.Item
                componentName = getJSXMemberName(nameNode);
            }
            
            if (componentName && isComponentName(componentName.split('.')[0])) {
                usesComponents.add(componentName);
            }
        }
        
        // Call expressions - вызовы функций и хуков
        else if (node.type === 'CallExpression') {
            const callee = node.callee;
            let funcName = null;
            
            if (callee.type === 'Identifier') {
                funcName = callee.name;
            } else if (callee.type === 'MemberExpression') {
                funcName = getMemberExpressionName(callee);
            }
            
            if (funcName) {
                // Хуки
                if (isCustomHook(funcName) || funcName.startsWith('use')) {
                    usesHooks.add(funcName);
                }
                // Обычные вызовы функций
                else if (!isBuiltinFunction(funcName)) {
                    calledFunctions.add(funcName);
                }
            }
        }
        
        // Рекурсивный обход
        for (const key of Object.keys(node)) {
            if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
            
            const child = node[key];
            if (Array.isArray(child)) {
                child.forEach(traverse);
            } else if (child && typeof child === 'object') {
                traverse(child);
            }
        }
    }
    
    traverse(ast);
    
    return {
        imports: Array.from(imports).sort(),
        type_imports: Array.from(typeImports).sort(),
        uses_components: Array.from(usesComponents).sort(),
        uses_hooks: Array.from(usesHooks).sort(),
        called_functions: Array.from(calledFunctions).sort()
    };
}

/**
 * Получение полного имени JSXMemberExpression
 */
function getJSXMemberName(node) {
    if (node.type === 'JSXIdentifier') {
        return node.name;
    }
    if (node.type === 'JSXMemberExpression') {
        return getJSXMemberName(node.object) + '.' + node.property.name;
    }
    return '';
}

/**
 * Получение полного имени MemberExpression
 */
function getMemberExpressionName(node) {
    if (node.type === 'Identifier') {
        return node.name;
    }
    if (node.type === 'MemberExpression') {
        const obj = getMemberExpressionName(node.object);
        const prop = node.property.name || node.property.value;
        return obj ? `${obj}.${prop}` : prop;
    }
    return '';
}

/**
 * Fallback regex парсинг L1 для неполного кода
 */
function parseTsxL1Regex(code) {
    const imports = new Set();
    const usesComponents = new Set();
    const usesHooks = new Set();
    const calledFunctions = new Set();
    
    // Удаление комментариев
    let cleaned = code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
    
    // Импорты
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(cleaned)) !== null) {
        imports.add(match[1]);
    }
    
    // JSX компоненты: <ComponentName
    const jsxRegex = /<([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)?)/g;
    while ((match = jsxRegex.exec(cleaned)) !== null) {
        usesComponents.add(match[1]);
    }
    
    // Хуки: useXxx(
    const hookRegex = /\b(use[A-Z][a-zA-Z0-9]*)\s*\(/g;
    while ((match = hookRegex.exec(cleaned)) !== null) {
        usesHooks.add(match[1]);
    }
    
    // Вызовы функций
    const funcCallRegex = /(?:^|[^a-zA-Z0-9_$.])([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*)\s*\(/g;
    while ((match = funcCallRegex.exec(cleaned)) !== null) {
        const name = match[1];
        if (!isBuiltinFunction(name) && !name.startsWith('use')) {
            calledFunctions.add(name);
        }
    }
    
    return {
        imports: Array.from(imports).sort(),
        type_imports: [],
        uses_components: Array.from(usesComponents).sort(),
        uses_hooks: Array.from(usesHooks).sort(),
        called_functions: Array.from(calledFunctions).sort()
    };
}

/**
 * Загрузка TSX сущностей из файла
 */
async function loadTsxFromFile(filePath, contextCode, dbService, pipelineState = null, mode = 'incremental') {
    const filename = path.basename(filePath);
    console.log(`[TSX-Loader] Обработка файла: ${filename} (mode=${mode})`);

    const report = {
        filename: filename,
        fileId: null,
        isNew: false,
        functionsFound: 0,
        functionsProcessed: 0,
        functions: [],
        errors: [],
        skipped: false,
        skipReason: null,
        entityReport: null
    };

    let tsxContent;
    let fileHash = null;

    if (mode === 'incremental') {
        try {
            const changeResult = await checkFileChanged(filePath, contextCode, dbService);
            if (!changeResult.changed) {
                console.log(`[TSX-Loader] Файл ${filename} не изменился (${changeResult.status}), пропускаем`);
                report.skipped = true;
                report.skipReason = changeResult.status;
                report.fileId = changeResult.fileId;
                return report;
            }
            tsxContent = changeResult.content;
            fileHash = changeResult.newHash;
            report.fileId = changeResult.fileId;
        } catch (err) {
            console.warn(`[TSX-Loader] Ошибка инкрементальной проверки: ${err.message}`);
            tsxContent = null;
        }
    }

    if (!tsxContent) {
        try {
            tsxContent = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
            const errorMsg = `Не удалось прочитать файл ${filename}: ${err.message}`;
            console.error(`[TSX-Loader] ${errorMsg}`);
            report.errors.push(errorMsg);
            return report;
        }
    }

    const entities = parseTsxEntitiesFromContent(tsxContent, filePath);
    report.functionsFound = entities.length;

    if (entities.length === 0) {
        console.log(`[TSX-Loader] Нет сущностей в ${filename}`);
        return report;
    }

    console.log(`[TSX-Loader] Найдено сущностей: ${entities.length}`);

    // Регистрация файла
    try {
        const { id: fileId, isNew } = await dbService.saveFileInfo(filename, tsxContent, filePath, contextCode, fileHash);
        report.fileId = fileId;
        report.isNew = isNew;
        console.log(`[TSX-Loader] Файл зарегистрирован: fileId = ${fileId}, isNew = ${isNew}`);
    } catch (err) {
        const errorMsg = `Не удалось зарегистрировать файл ${filename}: ${err.message}`;
        console.error(`[TSX-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }

    // === Кэшируем id типов связей ===
    const linkTypeMap = {
        called_functions: 'calls',
        imports: 'imports',
        uses_components: 'uses_component',
        uses_hooks: 'uses_hook'
    };
    const linkTypeIds = {};
    for (const code of Object.values(linkTypeMap)) {
        try {
            const res = await dbService.pgClient.query(
                'SELECT id FROM kosmos.link_type WHERE code = $1',
                [code]
            );
            if (res.rows.length > 0) {
                linkTypeIds[code] = res.rows[0].id;
            } else {
                console.warn(`[TSX-Loader] Тип связи '${code}' не найден в link_type`);
            }
        } catch (err) {
            console.error(`[TSX-Loader] Ошибка при получении link_type '${code}':`, err.message);
        }
    }

    // === Инкрементальная обработка сущностей ===
    if (mode === 'incremental' && report.fileId) {
        try {
            const entityReport = await processEntitiesIncremental(entities, report.fileId, contextCode, dbService, {
                loaderTag: '[TSX-Loader]',
                createChunksAndLinks: async (entity, aiItem, fId) => {
                    const chunkContentL0 = { 
                        full_name: entity.full_name, 
                        s_name: entity.sname, 
                        signature: entity.signature, 
                        body: entity.body,
                        metadata: entity.metadata || {}
                    };
                    const chunkContent = { text: chunkContentL0 };
                    if (entity.comment && typeof entity.comment === 'string' && entity.comment.trim()) {
                        chunkContent.comment = entity.comment.trim();
                    }
                    const chunkIdL0 = await dbService.saveChunkVector(fId, chunkContent, null,
                        { type: entity.type, level: '0-исходник', full_name: entity.full_name, s_name: entity.sname }, null, contextCode);
                    await dbService.pgClient.query('UPDATE kosmos.chunk_vector SET ai_item_id = $1 WHERE id = $2', [aiItem.id, chunkIdL0]);

                    // L1 для компонентов, хуков и функций
                    if (['tsx_component', 'tsx_hook', 'function', 'arrow', 'class'].includes(entity.type)) {
                        try {
                            const l1Result = await parseTsxL1(entity.body, entity.type);
                            const chunkIdL1 = await dbService.saveChunkVector(fId, { text: l1Result }, null,
                                { type: 'json', level: '1-связи', full_name: entity.full_name, s_name: entity.sname }, chunkIdL0, contextCode);
                            await dbService.pgClient.query('UPDATE kosmos.chunk_vector SET ai_item_id = $1 WHERE id = $2', [aiItem.id, chunkIdL1]);

                            for (const [key, code] of Object.entries(linkTypeMap)) {
                                const typeId = linkTypeIds[code];
                                if (!typeId) continue;
                                const targets = (l1Result[key] || []).filter(t => typeof t === 'string' && t.trim().length > 0);
                                for (const target of targets) {
                                    try {
                                        await dbService.pgClient.query(
                                            `INSERT INTO kosmos.link (context_code, source, target, link_type_id, file_id)
                                             VALUES ($1, $2, $3, $4, $5)
                                             ON CONFLICT (context_code, source, target, link_type_id) DO NOTHING`,
                                            [contextCode, entity.full_name, target, typeId, fId || null]);
                                    } catch (err) {
                                        console.error(`[TSX-Loader] Ошибка link ${entity.full_name} -> ${target}:`, err.message);
                                    }
                                }
                            }
                        } catch (err) {
                            console.error(`[TSX-Loader] Ошибка парсинга L1 для ${entity.full_name}: ${err.message}`);
                        }
                    }
                }
            });
            report.entityReport = entityReport;
            report.functionsProcessed = entityReport.created + entityReport.updated;
            console.log(`[TSX-Loader] Инкрементальный итог: created=${entityReport.created}, updated=${entityReport.updated}, unchanged=${entityReport.unchanged}, deleted=${entityReport.deleted}`);
            return report;
        } catch (err) {
            console.error(`[TSX-Loader] Ошибка инкрементальной обработки: ${err.message}`);
        }
    }

    // === Полный режим ===
    for (const entity of entities) {
        console.log(`[TSX-Loader] → Сущность: ${entity.full_name} (${entity.sname}, тип: ${entity.type})`);

        const entityReport = {
            full_name: entity.full_name,
            sname: entity.sname,
            type: entity.type,
            aiItemId: null,
            chunkL0Id: null,
            chunkL1Id: null,
            l1Parsed: false,
            errors: []
        };

        try {
            const aiItem = await dbService.createAiItem({
                full_name: entity.full_name,
                contextCode: contextCode,
                type: entity.type,
                sName: entity.sname,
                fileId: report.fileId
            });

            if (!aiItem || !aiItem.id) {
                const errorMsg = `Не удалось создать AI Item для ${entity.full_name}`;
                console.error(`[TSX-Loader] ${errorMsg}`);
                entityReport.errors.push(errorMsg);
                report.functions.push(entityReport);
                continue;
            }

            entityReport.aiItemId = aiItem.id;

            const chunkContentL0 = {
                full_name: entity.full_name,
                s_name: entity.sname,
                signature: entity.signature,
                body: entity.body,
                metadata: entity.metadata || {}
            };

            const chunkContent = { text: chunkContentL0 };
            if (entity.comment && typeof entity.comment === 'string' && entity.comment.trim()) {
                chunkContent.comment = entity.comment.trim();
            }

            try {
                const chunkIdL0 = await dbService.saveChunkVector(
                    report.fileId,
                    chunkContent,
                    null,
                    {
                        type: entity.type,
                        level: '0-исходник',
                        full_name: entity.full_name,
                        s_name: entity.sname
                    },
                    null,
                    contextCode
                );

                entityReport.chunkL0Id = chunkIdL0;

                await dbService.pgClient.query(
                    'UPDATE kosmos.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                    [entityReport.aiItemId, chunkIdL0]
                );

                console.log(`[TSX-Loader] Чанк 0 сохранён: chunkId = ${chunkIdL0}`);

                // L1 для компонентов, хуков и функций
                if (['tsx_component', 'tsx_hook', 'function', 'arrow', 'class'].includes(entity.type)) {
                    try {
                        const l1Result = await parseTsxL1(entity.body, entity.type);
                        entityReport.l1Parsed = true;
                        console.log(`[TSX-Loader] Успешно построен L1 для ${entity.full_name}`);

                        const chunkIdL1 = await dbService.saveChunkVector(
                            report.fileId,
                            { text: l1Result },
                            null,
                            {
                                type: 'json',
                                level: '1-связи',
                                full_name: entity.full_name,
                                s_name: entity.sname
                            },
                            chunkIdL0,
                            contextCode
                        );

                        entityReport.chunkL1Id = chunkIdL1;

                        await dbService.pgClient.query(
                            'UPDATE kosmos.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                            [entityReport.aiItemId, chunkIdL1]
                        );

                        // Сохранение связей в таблицу link
                        if (l1Result && entityReport.aiItemId) {
                            let linksCount = 0;

                            for (const [key, code] of Object.entries(linkTypeMap)) {
                                const typeId = linkTypeIds[code];
                                if (!typeId) continue;

                                const targets = (l1Result[key] || [])
                                    .filter(t => typeof t === 'string' && t.trim().length > 0);

                                for (const target of targets) {
                                    try {
                                        await dbService.pgClient.query(
                                            `INSERT INTO kosmos.link 
                                             (context_code, source, target, link_type_id, file_id)
                                             VALUES ($1, $2, $3, $4, $5)
                                             ON CONFLICT (context_code, source, target, link_type_id) DO NOTHING`,
                                            [contextCode, entity.full_name, target, typeId, report.fileId || null]
                                        );
                                        linksCount++;
                                    } catch (err) {
                                        console.error(`[TSX-Loader] Ошибка link ${entity.full_name} -> ${target} (${code}):`, err.message);
                                        entityReport.errors.push(`Link error: ${code} -> ${target}`);
                                    }
                                }
                            }

                            if (linksCount > 0) {
                                console.log(`[TSX-Loader] Сохранено ${linksCount} связей для ${entity.full_name}`);
                            }
                        }

                        console.log(`[TSX-Loader] Чанк 1 (связи) сохранён: chunkId = ${chunkIdL1}`);
                    } catch (err) {
                        const errorMsg = `Ошибка парсинга L1 для ${entity.full_name}: ${err.message}`;
                        console.error(`[TSX-Loader] ${errorMsg}`);
                        entityReport.errors.push(errorMsg);
                    }
                }
            } catch (err) {
                const errorMsg = `Ошибка сохранения чанка L0 для ${entity.full_name}: ${err.message}`;
                console.error(`[TSX-Loader] ${errorMsg}`);
                entityReport.errors.push(errorMsg);
            }
        } catch (err) {
            const errorMsg = `Ошибка при обработке сущности ${entity.full_name}: ${err.message}`;
            console.error(`[TSX-Loader] ${errorMsg}`);
            entityReport.errors.push(errorMsg);
        }

        if (entityReport.aiItemId && entityReport.chunkL0Id) {
            report.functionsProcessed++;
        }

        report.functions.push(entityReport);
    }

    console.log(`[TSX-Loader] Файл ${filename} успешно обработан`);
    return report;
}

module.exports = {
    parseTsxEntitiesFromContent,
    parseTsxL1,
    loadTsxFromFile,
    isCustomHook,
    isComponentName
};

-- Миграция: Добавление типов связей для TSX loader
-- Дата: 2026-02-11

-- Новые типы связей для TSX компонентов

-- imports_component: импорт React компонента
INSERT INTO kosmos.link_type (code, label, description, is_active)
VALUES ('imports_component', 'imports component', 'Import of a React component', true)
ON CONFLICT (code) DO NOTHING;

-- uses_component: использование компонента в JSX
INSERT INTO kosmos.link_type (code, label, description, is_active)
VALUES ('uses_component', 'uses component', 'Usage of a component in JSX markup', true)
ON CONFLICT (code) DO NOTHING;

-- uses_hook: вызов хука внутри компонента
INSERT INTO kosmos.link_type (code, label, description, is_active)
VALUES ('uses_hook', 'uses hook', 'Usage of a React hook inside component', true)
ON CONFLICT (code) DO NOTHING;

-- has_props: связь компонент → Props interface
INSERT INTO kosmos.link_type (code, label, description, is_active)
VALUES ('has_props', 'has props', 'Component has Props interface', true)
ON CONFLICT (code) DO NOTHING;

-- Проверка добавленных типов
SELECT code, label, description FROM kosmos.link_type 
WHERE code IN ('imports_component', 'uses_component', 'uses_hook', 'has_props');

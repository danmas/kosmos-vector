-- HR Management System Schema
-- Тестовая схема для полного системного теста

CREATE SCHEMA IF NOT EXISTS hr;

-- Таблица отделов
CREATE TABLE hr.departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    manager_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE hr.departments IS 'Отделы компании';
COMMENT ON COLUMN hr.departments.manager_id IS 'ID менеджера отдела';

-- Таблица сотрудников
CREATE TABLE hr.employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    department_id INTEGER REFERENCES hr.departments(id),
    hire_date DATE DEFAULT CURRENT_DATE,
    salary DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE hr.employees IS 'Сотрудники компании';
COMMENT ON COLUMN hr.employees.department_id IS 'Связь с отделом';

-- Таблица навыков
CREATE TABLE hr.skills (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    category VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE hr.skills IS 'Навыки сотрудников';

-- Связь сотрудников и навыков (M2M)
CREATE TABLE hr.employee_skills (
    employee_id INTEGER NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES hr.skills(id) ON DELETE CASCADE,
    level INTEGER DEFAULT 1 CHECK (level >= 1 AND level <= 5),
    certified BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (employee_id, skill_id)
);

COMMENT ON TABLE hr.employee_skills IS 'Навыки сотрудников с уровнем';

-- Таблица проектов
CREATE TABLE hr.projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    lead_id INTEGER REFERENCES hr.employees(id),
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE hr.projects IS 'Проекты компании';

-- Назначения сотрудников на проекты
CREATE TABLE hr.assignments (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES hr.projects(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    allocation_percent INTEGER DEFAULT 100 CHECK (allocation_percent > 0 AND allocation_percent <= 100),
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE hr.assignments IS 'Назначения сотрудников на проекты';

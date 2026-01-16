-- HR Management System Functions
-- PL/pgSQL функции для тестирования парсинга SQL функций

-- Функция получения сотрудников отдела
CREATE OR REPLACE FUNCTION hr.get_department_employees(dept_id INTEGER)
RETURNS TABLE(id INTEGER, name VARCHAR(100), email VARCHAR(100)) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT e.id, e.name, e.email
    FROM hr.employees e
    WHERE e.department_id = dept_id
    ORDER BY e.name;
END;
$$;

COMMENT ON FUNCTION hr.get_department_employees IS 'Возвращает список всех сотрудников указанного отдела';

-- Функция получения навыков сотрудника
CREATE OR REPLACE FUNCTION hr.get_employee_skills(emp_id INTEGER)
RETURNS TABLE(skill_name VARCHAR(50), skill_level INTEGER, certified BOOLEAN)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT s.name, es.level, es.certified
    FROM hr.employee_skills es
    JOIN hr.skills s ON s.id = es.skill_id
    WHERE es.employee_id = emp_id
    ORDER BY es.level DESC, s.name;
END;
$$;

COMMENT ON FUNCTION hr.get_employee_skills IS 'Возвращает все навыки сотрудника с уровнями';

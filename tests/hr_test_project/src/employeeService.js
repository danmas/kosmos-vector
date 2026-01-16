/**
 * Employee Service
 * Сервис для работы с сотрудниками
 */

const { validateEmail, validateName, isValidId } = require('./utils/validators');

/**
 * Класс для управления сотрудниками
 */
class EmployeeService {
    /**
     * Конструктор сервиса
     * @param {Object} dbConnection - Подключение к БД
     */
    constructor(dbConnection) {
        this.db = dbConnection;
    }

    /**
     * Получить сотрудника по ID
     * @param {number} id - ID сотрудника
     * @returns {Promise<Object>} Данные сотрудника
     */
    async getById(id) {
        if (!isValidId(id)) {
            throw new Error('Invalid employee ID');
        }
        // Здесь был бы запрос к БД
        return { id, name: 'Test Employee', email: 'test@example.com' };
    }

    /**
     * Создать нового сотрудника
     * @param {Object} employeeData - Данные сотрудника
     * @returns {Promise<Object>} Созданный сотрудник
     */
    async create(employeeData) {
        validateEmployee(employeeData);
        // Здесь был бы INSERT в БД
        return { id: 1, ...employeeData };
    }

    /**
     * Обновить данные сотрудника
     * @param {number} id - ID сотрудника
     * @param {Object} updates - Обновляемые поля
     * @returns {Promise<Object>} Обновленный сотрудник
     */
    async update(id, updates) {
        if (!isValidId(id)) {
            throw new Error('Invalid employee ID');
        }
        // Здесь был бы UPDATE в БД
        return { id, ...updates };
    }
}

/**
 * Валидация данных сотрудника
 * @param {Object} employee - Объект сотрудника
 * @throws {Error} Если данные невалидны
 */
function validateEmployee(employee) {
    if (!employee) {
        throw new Error('Employee data is required');
    }
    
    if (!validateName(employee.name)) {
        throw new Error('Invalid employee name');
    }
    
    if (!validateEmail(employee.email)) {
        throw new Error('Invalid employee email');
    }
}

/**
 * Форматирование данных сотрудника для отображения
 * @param {Object} employee - Объект сотрудника
 * @returns {Object} Отформатированные данные
 */
function formatEmployeeData(employee) {
    if (!employee) {
        return null;
    }
    
    return {
        id: employee.id,
        name: employee.name.trim(),
        email: employee.email.toLowerCase(),
        displayName: `${employee.name} (${employee.email})`
    };
}

/**
 * Получить сотрудника со всеми его навыками
 * @param {number} employeeId - ID сотрудника
 * @returns {Promise<Object>} Сотрудник с навыками
 */
async function fetchEmployeeWithSkills(employeeId) {
    const employee = await new EmployeeService(null).getById(employeeId);
    // Здесь был бы запрос к таблице employee_skills
    return {
        ...employee,
        skills: [
            { name: 'JavaScript', level: 5 },
            { name: 'TypeScript', level: 4 }
        ]
    };
}

/**
 * Вычисление зарплаты сотрудника
 * @param {number} baseSalary - Базовая зарплата
 * @param {number} experience - Опыт в годах
 * @returns {number} Итоговая зарплата
 */
const calculateSalary = (baseSalary, experience) => {
    const multiplier = 1 + (experience * 0.1);
    return Math.round(baseSalary * multiplier);
};

module.exports = {
    EmployeeService,
    validateEmployee,
    formatEmployeeData,
    fetchEmployeeWithSkills,
    calculateSalary
};

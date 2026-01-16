/**
 * Department Service
 * Сервис для работы с отделами
 */

import { formatDate, formatCurrency, formatName } from './utils/formatters';

/**
 * Интерфейс отдела
 */
interface Department {
    id: number;
    name: string;
    managerId?: number;
    createdAt: Date;
}

/**
 * Интерфейс сотрудника
 */
interface Employee {
    id: number;
    name: string;
    email: string;
    departmentId?: number;
}

/**
 * Класс для управления отделами
 */
class DepartmentService {
    private departments: Map<number, Department>;

    /**
     * Конструктор сервиса
     */
    constructor() {
        this.departments = new Map();
    }

    /**
     * Получить отдел по ID
     * @param id - ID отдела
     * @returns Отдел или null
     */
    getById(id: number): Department | null {
        return this.departments.get(id) || null;
    }

    /**
     * Создать новый отдел
     * @param name - Название отдела
     * @param managerId - ID менеджера
     * @returns Созданный отдел
     */
    create(name: string, managerId?: number): Department {
        const id = this.departments.size + 1;
        const department: Department = {
            id,
            name,
            managerId,
            createdAt: new Date()
        };
        this.departments.set(id, department);
        return department;
    }

    /**
     * Обновить отдел
     * @param id - ID отдела
     * @param updates - Обновляемые поля
     * @returns Обновленный отдел или null
     */
    update(id: number, updates: Partial<Department>): Department | null {
        const department = this.departments.get(id);
        if (!department) {
            return null;
        }
        const updated = { ...department, ...updates };
        this.departments.set(id, updated);
        return updated;
    }

    /**
     * Получить все отделы
     * @returns Массив отделов
     */
    getAll(): Department[] {
        return Array.from(this.departments.values());
    }
}

/**
 * Получить статистику по отделу
 * @param departmentId - ID отдела
 * @returns Статистика отдела
 */
function getDepartmentStats(departmentId: number): {
    id: number;
    name: string;
    employeeCount: number;
    totalSalary: number;
    formattedCreatedAt: string;
} {
    // Здесь был бы запрос к БД
    const createdAt = new Date();
    return {
        id: departmentId,
        name: 'Development',
        employeeCount: 15,
        totalSalary: 500000,
        formattedCreatedAt: formatDate(createdAt)
    };
}

/**
 * Универсальная функция поиска по ID
 * @param id - ID для поиска
 * @returns Найденный объект или null
 */
function findById<T extends { id: number }>(items: T[], id: number): T | null {
    return items.find(item => item.id === id) || null;
}

export {
    DepartmentService,
    getDepartmentStats,
    findById,
    type Department,
    type Employee
};

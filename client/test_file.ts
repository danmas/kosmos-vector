// =============================================================================
// Тестовый TypeScript файл с различными конструкциями
// test_file.ts
// =============================================================================

// --- Импорты ---
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';

// --- Type алиасы ---

/**
 * Уникальный идентификатор пользователя
 */
type UserId = string | number;

/**
 * Роли пользователя в системе
 */
type UserRole = 'admin' | 'user' | 'guest' | 'moderator';

/**
 * Callback функция для обработки результата
 */
type ResultCallback<T> = (error: Error | null, result?: T) => void;

/**
 * Конфигурация приложения
 */
type AppConfig = {
    host: string;
    port: number;
    debug: boolean;
    features: string[];
};

// --- Интерфейсы ---

/**
 * Базовый интерфейс сущности
 */
interface IEntity {
    id: string;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Интерфейс пользователя
 */
interface IUser extends IEntity {
    name: string;
    email: string;
    role: UserRole;
    metadata?: Record<string, unknown>;
}

/**
 * Интерфейс репозитория с дженериками
 */
interface IRepository<T extends IEntity> {
    findById(id: string): Promise<T | null>;
    findAll(): Promise<T[]>;
    save(entity: T): Promise<T>;
    delete(id: string): Promise<boolean>;
    count(): Promise<number>;
}

/**
 * Интерфейс логгера
 */
interface ILogger {
    log(message: string, ...args: unknown[]): void;
    error(message: string, error?: Error): void;
    warn(message: string): void;
    debug(message: string, data?: object): void;
}

// --- Enum ---

/**
 * Статусы обработки
 */
enum ProcessingStatus {
    Pending = 'PENDING',
    InProgress = 'IN_PROGRESS',
    Completed = 'COMPLETED',
    Failed = 'FAILED',
    Cancelled = 'CANCELLED'
}

/**
 * Уровни логирования
 */
const enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3
}

// --- Абстрактный класс ---

/**
 * Базовый класс сущности с общей логикой
 */
abstract class BaseEntity implements IEntity {
    public readonly id: string;
    public readonly createdAt: Date;
    public updatedAt: Date;

    constructor(id?: string) {
        this.id = id || this.generateId();
        this.createdAt = new Date();
        this.updatedAt = new Date();
    }

    /**
     * Генерация уникального ID
     */
    private generateId(): string {
        return Math.random().toString(36).substring(2, 15);
    }

    /**
     * Абстрактный метод валидации
     */
    abstract validate(): boolean;

    /**
     * Обновление временной метки
     */
    protected touch(): void {
        this.updatedAt = new Date();
    }

    /**
     * Сериализация в JSON
     */
    public toJSON(): object {
        return {
            id: this.id,
            createdAt: this.createdAt.toISOString(),
            updatedAt: this.updatedAt.toISOString()
        };
    }
}

// --- Класс с декораторами и дженериками ---

/**
 * Декоратор для инъекции зависимостей (пример)
 */
function Injectable(): ClassDecorator {
    return (target: Function) => {
        // Логика регистрации в DI контейнере
        console.log(`Registering ${target.name} as injectable`);
    };
}

/**
 * Декоратор для инъекции параметра
 */
function Inject(token: string): ParameterDecorator {
    return (target: Object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
        console.log(`Injecting ${token} at position ${parameterIndex}`);
    };
}

/**
 * Сервис для работы с пользователями
 */
@Injectable()
class UserService implements IRepository<IUser> {
    private readonly users: Map<string, IUser> = new Map();
    private readonly logger: ILogger;

    constructor(
        @Inject('LOGGER') logger: ILogger,
        @Inject('CONFIG') private readonly config: AppConfig
    ) {
        this.logger = logger;
    }

    /**
     * Поиск пользователя по ID
     */
    async findById(id: string): Promise<IUser | null> {
        this.logger.debug('Finding user by id', { id });
        return this.users.get(id) || null;
    }

    /**
     * Получение всех пользователей
     */
    async findAll(): Promise<IUser[]> {
        return Array.from(this.users.values());
    }

    /**
     * Сохранение пользователя
     */
    async save(entity: IUser): Promise<IUser> {
        this.users.set(entity.id, entity);
        this.logger.log(`User saved: ${entity.name}`);
        return entity;
    }

    /**
     * Удаление пользователя
     */
    async delete(id: string): Promise<boolean> {
        const result = this.users.delete(id);
        if (result) {
            this.logger.log(`User deleted: ${id}`);
        }
        return result;
    }

    /**
     * Подсчёт пользователей
     */
    async count(): Promise<number> {
        return this.users.size;
    }

    /**
     * Поиск по роли
     */
    public findByRole(role: UserRole): IUser[] {
        return Array.from(this.users.values()).filter(user => user.role === role);
    }

    /**
     * Проверка существования email
     */
    public async emailExists(email: string): Promise<boolean> {
        for (const user of this.users.values()) {
            if (user.email === email) {
                return true;
            }
        }
        return false;
    }
}

// --- Обычные функции с типами ---

/**
 * Создание нового пользователя
 */
function createUser(name: string, email: string, role: UserRole = 'user'): IUser {
    return {
        id: Math.random().toString(36).substring(2, 15),
        name,
        email,
        role,
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

/**
 * Асинхронная функция с дженериком
 */
async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json() as Promise<T>;
}

/**
 * Функция с перегрузками (overload signatures)
 */
function processInput(input: string): string;
function processInput(input: number): number;
function processInput(input: string | number): string | number {
    if (typeof input === 'string') {
        return input.toUpperCase();
    }
    return input * 2;
}

/**
 * Утилитарная функция валидации
 */
function validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// --- Arrow функции с типами ---

/**
 * Обработка пользователя
 */
const processUser = async (user: IUser): Promise<void> => {
    console.log(`Processing user: ${user.name}`);
    await new Promise(resolve => setTimeout(resolve, 100));
};

/**
 * Фильтр активных пользователей
 */
const filterActiveUsers = (users: IUser[]): IUser[] => {
    return users.filter(user => user.role !== 'guest');
};

/**
 * Маппер пользователя в DTO
 */
const mapUserToDTO = (user: IUser): { id: string; displayName: string } => ({
    id: user.id,
    displayName: `${user.name} (${user.role})`
});

/**
 * Дебаунс функция
 */
const debounce = <T extends (...args: any[]) => any>(
    func: T,
    wait: number
): ((...args: Parameters<T>) => void) => {
    let timeout: NodeJS.Timeout | null = null;
    
    return (...args: Parameters<T>) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => func(...args), wait);
    };
};

// --- Класс с наследованием ---

/**
 * Модель пользователя
 */
class User extends BaseEntity implements IUser {
    public name: string;
    public email: string;
    public role: UserRole;
    public metadata?: Record<string, unknown>;

    constructor(data: Partial<IUser>) {
        super(data.id);
        this.name = data.name || '';
        this.email = data.email || '';
        this.role = data.role || 'user';
        this.metadata = data.metadata;
    }

    /**
     * Реализация абстрактного метода
     */
    validate(): boolean {
        return this.name.length > 0 && validateEmail(this.email);
    }

    /**
     * Обновление данных
     */
    update(data: Partial<IUser>): void {
        if (data.name) this.name = data.name;
        if (data.email) this.email = data.email;
        if (data.role) this.role = data.role;
        if (data.metadata) this.metadata = { ...this.metadata, ...data.metadata };
        this.touch();
    }

    /**
     * Проверка роли
     */
    hasRole(role: UserRole): boolean {
        return this.role === role;
    }

    /**
     * Переопределение toJSON
     */
    public toJSON(): object {
        return {
            ...super.toJSON(),
            name: this.name,
            email: this.email,
            role: this.role,
            metadata: this.metadata
        };
    }
}

// --- Generic класс ---

/**
 * Кэш с TTL
 */
class TTLCache<K, V> {
    private cache: Map<K, { value: V; expires: number }> = new Map();
    private readonly defaultTTL: number;

    constructor(defaultTTL: number = 60000) {
        this.defaultTTL = defaultTTL;
    }

    /**
     * Установка значения
     */
    set(key: K, value: V, ttl?: number): void {
        const expires = Date.now() + (ttl || this.defaultTTL);
        this.cache.set(key, { value, expires });
    }

    /**
     * Получение значения
     */
    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        
        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            return undefined;
        }
        
        return entry.value;
    }

    /**
     * Проверка наличия ключа
     */
    has(key: K): boolean {
        return this.get(key) !== undefined;
    }

    /**
     * Удаление ключа
     */
    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    /**
     * Очистка просроченных записей
     */
    cleanup(): number {
        let removed = 0;
        const now = Date.now();
        
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expires) {
                this.cache.delete(key);
                removed++;
            }
        }
        
        return removed;
    }

    /**
     * Размер кэша
     */
    get size(): number {
        return this.cache.size;
    }
}

// --- Экспорты ---

export {
    UserService,
    User,
    TTLCache,
    BaseEntity,
    createUser,
    fetchData,
    processInput,
    validateEmail,
    processUser,
    filterActiveUsers,
    mapUserToDTO,
    debounce,
    ProcessingStatus,
    LogLevel
};

export type {
    UserId,
    UserRole,
    ResultCallback,
    AppConfig,
    IEntity,
    IUser,
    IRepository,
    ILogger
};

export default UserService;


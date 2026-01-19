<?php
/**
 * Skill Service
 * Сервис для работы с навыками сотрудников
 */

namespace App\Services;

use App\Validators\SkillValidator;
use App\Utils\Formatter;

/**
 * Интерфейс для работы с навыками
 */
interface SkillServiceInterface
{
    public function getById(int $id): ?array;
    public function getAllSkills(): array;
}

/**
 * Trait для логирования
 */
trait LoggableTrait
{
    /**
     * Логирование действия
     * @param string $message Сообщение
     */
    protected function log(string $message): void
    {
        error_log("[SkillService] " . $message);
    }
}

/**
 * Класс для управления навыками
 */
class SkillService implements SkillServiceInterface
{
    use LoggableTrait;

    private $db;
    private $validator;

    /**
     * Конструктор сервиса
     * @param mixed $dbConnection Подключение к БД
     */
    public function __construct($dbConnection)
    {
        $this->db = $dbConnection;
        $this->validator = new SkillValidator();
    }

    /**
     * Получить навык по ID
     * @param int $id ID навыка
     * @return array|null Данные навыка
     */
    public function getById(int $id): ?array
    {
        $this->log("Getting skill by ID: $id");
        
        if (!validateSkillId($id)) {
            return null;
        }
        
        // Здесь был бы запрос к БД
        return [
            'id' => $id,
            'name' => 'JavaScript',
            'category' => 'Programming'
        ];
    }

    /**
     * Получить все навыки
     * @return array Список навыков
     */
    public function getAllSkills(): array
    {
        $this->log("Getting all skills");
        return [
            ['id' => 1, 'name' => 'JavaScript', 'category' => 'Programming'],
            ['id' => 2, 'name' => 'TypeScript', 'category' => 'Programming'],
            ['id' => 3, 'name' => 'PHP', 'category' => 'Programming']
        ];
    }

    /**
     * Добавить навык сотруднику
     * @param int $employeeId ID сотрудника
     * @param int $skillId ID навыка
     * @param int $level Уровень владения
     * @return bool Успешность операции
     */
    public function addSkillToEmployee(int $employeeId, int $skillId, int $level = 1): bool
    {
        $this->log("Adding skill $skillId to employee $employeeId with level $level");
        
        if (!validateSkillId($skillId) || !validateSkillLevel($level)) {
            return false;
        }
        
        // Здесь был бы INSERT в БД
        return true;
    }
}

/**
 * Валидация ID навыка
 * @param int $id ID для проверки
 * @return bool true если валиден
 */
function validateSkillId(int $id): bool
{
    return $id > 0;
}

/**
 * Валидация уровня навыка
 * @param int $level Уровень для проверки
 * @return bool true если валиден
 */
function validateSkillLevel(int $level): bool
{
    return $level >= 1 && $level <= 5;
}

/**
 * Форматирование данных навыка
 * @param array $skill Данные навыка
 * @return string Отформатированная строка
 */
function formatSkillData(array $skill): string
{
    return sprintf(
        "%s (%s)",
        $skill['name'] ?? 'Unknown',
        $skill['category'] ?? 'No category'
    );
}

/**
 * Расчёт общего уровня навыков
 * @param array $skills Массив навыков с уровнями
 * @return float Средний уровень
 */
$calculateAverageLevel = function(array $skills): float {
    if (empty($skills)) {
        return 0.0;
    }
    
    $total = array_reduce($skills, function($sum, $skill) {
        return $sum + ($skill['level'] ?? 0);
    }, 0);
    
    return round($total / count($skills), 2);
};

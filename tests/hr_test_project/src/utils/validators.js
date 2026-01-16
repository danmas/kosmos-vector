/**
 * Утилиты для валидации данных
 */

/**
 * Валидация email адреса
 * @param {string} email - Email для проверки
 * @returns {boolean} true если email валиден
 */
function validateEmail(email) {
    if (!email || typeof email !== 'string') {
        return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Валидация имени
 * @param {string} name - Имя для проверки
 * @returns {boolean} true если имя валидно
 */
function validateName(name) {
    if (!name || typeof name !== 'string') {
        return false;
    }
    const trimmed = name.trim();
    return trimmed.length >= 2 && trimmed.length <= 100;
}

/**
 * Проверка валидности ID
 * @param {number} id - ID для проверки
 * @returns {boolean} true если ID валиден
 */
const isValidId = (id) => {
    return typeof id === 'number' && id > 0 && Number.isInteger(id);
};

module.exports = {
    validateEmail,
    validateName,
    isValidId
};

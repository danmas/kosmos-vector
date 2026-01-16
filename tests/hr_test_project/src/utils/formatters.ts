/**
 * Утилиты для форматирования данных
 */

/**
 * Форматирование даты в строку
 * @param date - Дата для форматирования
 * @returns Отформатированная строка даты
 */
export function formatDate(date: Date): string {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return 'Invalid Date';
    }
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

/**
 * Форматирование суммы в валюту
 * @param amount - Сумма для форматирования
 * @returns Отформатированная строка с валютой
 */
export function formatCurrency(amount: number): string {
    if (typeof amount !== 'number' || isNaN(amount)) {
        return '0.00 ₽';
    }
    
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 2
    }).format(amount);
}

/**
 * Форматирование полного имени
 * @param first - Имя
 * @param last - Фамилия
 * @returns Отформатированное полное имя
 */
export const formatName = (first: string, last: string): string => {
    if (!first || !last) {
        return first || last || '';
    }
    return `${first.trim()} ${last.trim()}`.trim();
};

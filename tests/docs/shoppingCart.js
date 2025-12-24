
class ShoppingCart {
    constructor() {
        this.items = [];
    }

    /**
     * Добавляет товар в корзину.
     * @param {object} item - Товар для добавления.
     * @param {number} quantity - Количество.
     */
    addItem(item, quantity) {
        if (quantity <= 0) {
            throw new Error('Quantity must be positive.');
        }
        const existingItem = this.items.find(i => i.id === item.id);
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            this.items.push({ ...item, quantity });
        }
    }

    /**
     * Удаляет товар из корзины по ID.
     * @param {string} itemId - ID товара для удаления.
     */
    removeItem(itemId) {
        this.items = this.items.filter(i => i.id !== itemId);
    }

    /**
     * Рассчитывает итоговую стоимость корзины.
     * Применяет скидку 10% если итоговая сумма больше 1000.
     * @returns {number} - Итоговая стоимость.
     */
    calculateTotal() {
        const total = this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        if (total > 1000) {
            return total * 0.9; // Применяем скидку 10%
        }
        return total;
    }
}

/**
 * Вспомогательная функция для форматирования валюты.
 * @param {number} amount - Сумма.
 * @returns {string} - Форматированная строка.
 */
function formatCurrency(amount) {
    return `${amount.toFixed(2)} руб.`;
}


-- Тестовая SQL-система обработки заказов
-- Содержит таблицы и хранимые процедуры для демонстрации работы системы векторизации

-- Таблица клиентов
CREATE TABLE public.customers (
    customer_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица товаров
CREATE TABLE public.products (
    product_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0
);

-- Таблица заказов
CREATE TABLE public.orders (
    order_id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES public.customers(customer_id),
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending',
    total_amount DECIMAL(10, 2) DEFAULT 0,
    CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled'))
);

-- Таблица позиций заказа
CREATE TABLE public.order_items (
    item_id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES public.orders(order_id),
    product_id INTEGER NOT NULL REFERENCES public.products(product_id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10, 2) NOT NULL,
    subtotal DECIMAL(10, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

-- Функция для применения скидки
CREATE OR REPLACE FUNCTION public.apply_discount(
    base_amount DECIMAL(10, 2),
    discount_percent DECIMAL(5, 2)
)
RETURNS DECIMAL(10, 2) AS $$
BEGIN
    -- Проверка на отрицательную скидку
    IF discount_percent < 0 THEN
        RAISE EXCEPTION 'Discount percentage cannot be negative';
    END IF;
    
    -- Проверка на слишком большую скидку
    IF discount_percent > 100 THEN
        RAISE EXCEPTION 'Discount percentage cannot exceed 100%%';
    END IF;
    
    -- Вычисление суммы со скидкой
    RETURN ROUND(base_amount * (1 - discount_percent / 100), 2);
END;
$$ LANGUAGE plpgsql;

-- Функция для расчета общей стоимости заказа
CREATE OR REPLACE FUNCTION public.calculate_order_total(
    p_order_id INTEGER,
    p_discount_percent DECIMAL(5, 2) DEFAULT 0
)
RETURNS DECIMAL(10, 2) AS $$
DECLARE
    v_total DECIMAL(10, 2);
BEGIN
    -- Получаем сумму всех позиций заказа
    SELECT COALESCE(SUM(subtotal), 0)
    INTO v_total
    FROM public.order_items
    WHERE order_id = p_order_id;
    
    -- Применяем скидку, если она указана
    IF p_discount_percent > 0 THEN
        v_total := public.apply_discount(v_total, p_discount_percent);
    END IF;
    
    -- Обновляем общую сумму в таблице заказов
    UPDATE public.orders
    SET total_amount = v_total
    WHERE order_id = p_order_id;
    
    RETURN v_total;
END;
$$ LANGUAGE plpgsql;

-- Процедура для создания нового заказа
CREATE OR REPLACE FUNCTION public.create_order(
    p_customer_id INTEGER,
    p_items JSONB -- Массив объектов {product_id, quantity}
)
RETURNS INTEGER AS $$
DECLARE
    v_order_id INTEGER;
    v_item JSONB;
    v_product_id INTEGER;
    v_quantity INTEGER;
    v_price DECIMAL(10, 2);
BEGIN
    -- Проверяем существование клиента
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_id = p_customer_id) THEN
        RAISE EXCEPTION 'Customer with ID % does not exist', p_customer_id;
    END IF;
    
    -- Создаем новый заказ
    INSERT INTO public.orders (customer_id, status)
    VALUES (p_customer_id, 'pending')
    RETURNING order_id INTO v_order_id;
    
    -- Добавляем позиции заказа
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_product_id := (v_item->>'product_id')::INTEGER;
        v_quantity := (v_item->>'quantity')::INTEGER;
        
        -- Получаем цену товара
        SELECT price INTO v_price
        FROM public.products
        WHERE product_id = v_product_id;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product with ID % does not exist', v_product_id;
        END IF;
        
        -- Проверяем наличие товара на складе
        IF v_quantity > (SELECT stock_quantity FROM public.products WHERE product_id = v_product_id) THEN
            RAISE EXCEPTION 'Not enough stock for product ID %', v_product_id;
        END IF;
        
        -- Добавляем позицию в заказ
        INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
        VALUES (v_order_id, v_product_id, v_quantity, v_price);
        
        -- Уменьшаем количество товара на складе
        UPDATE public.products
        SET stock_quantity = stock_quantity - v_quantity
        WHERE product_id = v_product_id;
    END LOOP;
    
    -- Рассчитываем итоговую сумму заказа
    PERFORM public.calculate_order_total(v_order_id);
    
    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql;

-- Процедура для обновления статуса заказа
CREATE OR REPLACE FUNCTION public.update_order_status(
    p_order_id INTEGER,
    p_status VARCHAR(20)
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Проверяем существование заказа
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE order_id = p_order_id) THEN
        RAISE EXCEPTION 'Order with ID % does not exist', p_order_id;
    END IF;
    
    -- Проверяем корректность статуса
    IF p_status NOT IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid order status: %', p_status;
    END IF;
    
    -- Обновляем статус
    UPDATE public.orders
    SET status = p_status
    WHERE order_id = p_order_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
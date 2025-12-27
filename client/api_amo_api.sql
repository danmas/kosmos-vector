/**
 * api_amo_api.sql
 * api_amo.sql
 *
 * Author:  Roman Eremeev
 * Created: 31.03.2025
 *
 * AMO

Pavel Lavrov, [22.04.2025 11:14]
В созданном лоте не заполнены:
- ГРЗ (из поля Гос. номер)
- Номер двигателя

- Цвет авто. Его в лоте не видно, а в заполнении ДКП он фигурирует как "{&quot;name&quot;: &quot;Белый&quot;}"
- Кем выдан ПТС

  */



-- Эта функция будет проверять наличие активного лота с указанным VIN. Она вернет ID аукциона, если такой лот существует, и NULL, если лота нет.
-- В контексте нашей задачи, функция будет использоваться следующим образом:
-- При получении данных из АМО, мы сначала проверим наличие лота с указанным VIN
-- Если лот существует, сообщим об этом и не будем создавать дубликат
-- Если лота нет, продолжим процесс создания нового лота

-- CREATE OR REPLACE FUNCTION carl_amo.checkAuctionByVIN(p_vin VARCHAR)
--     RETURNS INTEGER AS $$
-- SELECT id_auction
-- FROM carl_data.v_auct_full
-- WHERE vin = p_vin
--         AND is_deleted = 'N'
--         AND status NOT IN ('FAILED', 'FINISHED', 'CANCELED')
-- LIMIT 1;
-- $$ LANGUAGE SQL;


/*
CREATE OR REPLACE FUNCTION carl_amo.createAmoTask(p_deal_id VARCHAR, p_text VARCHAR)
    RETURNS VOID
    LANGUAGE plpgsql
    SECURITY DEFINER
AS $$
DECLARE
    v_settings JSON;
    v_access_token VARCHAR;
    v_account_id INTEGER;
    v_responsible_user_id INTEGER;
    v_task_data JSONB;
    v_complete_till TIMESTAMPTZ;
BEGIN
    -- Получаем настройки AMO
    v_settings := carl_comm.getAmoSettings();
    v_access_token := v_settings->>'access_token';
    v_account_id := (v_settings->>'account_id')::INTEGER;

    -- Получаем ответственного пользователя для сделки
    SELECT (data->>'responsible_user_id')::INTEGER
    INTO v_responsible_user_id
    FROM carl_amo.sync_amo
    WHERE data#>>'{type}' = 'lead' AND data#>>'{id}' = p_deal_id;

    -- Если не нашли ответственного, используем дефолтного (получим из настроек)
    IF v_responsible_user_id IS NULL THEN
        v_responsible_user_id := 2131702; -- Дефолтный ID пользователя, лучше получить из настроек
    END IF;

    -- Устанавливаем срок выполнения задачи на текущий момент
    v_complete_till := NOW();

    -- Формируем данные задачи
    v_task_data := jsonb_build_object(
            'type', 'task',
            'entity_id', p_deal_id::INTEGER,
            'entity_type', 'leads',
            'text', p_text,
            'complete_till', EXTRACT(EPOCH FROM v_complete_till)::INTEGER,
            'task_type_id', 1, -- ID типа задачи "Напоминание"
            'responsible_user_id', v_responsible_user_id
                   );

    -- Сохраняем задачу в sync_amo для последующей синхронизации с AMO
    PERFORM carl_amo.writeSyncAmo(
            jsonb_build_object(
                    'id', nextval('carl_amo.amo_task_id_seq'), -- Создаем последовательность, если её нет
                    'type', 'task',
                    'entity_type', 'leads',
                    'entity_id', p_deal_id::INTEGER,
                    'data', v_task_data
            )::JSON
            );

    -- Здесь можно добавить прямой API-вызов к AMO CRM для создания задачи,
    -- если требуется мгновенное создание задачи без ожидания синхронизации

    -- Пример логики API-вызова:
    -- 1. Формируем URL: https://api.amocrm.ru/api/v4/tasks
    -- 2. Отправляем POST-запрос с v_task_data
    -- 3. Используем v_access_token для авторизации

    -- Это может быть реализовано через функцию, выполняющую HTTP-запросы
    -- PERFORM carl_api.http_post(
    --     'https://api.amocrm.ru/api/v4/tasks',
    --     v_task_data::TEXT,
    --     'Bearer ' || v_access_token
    -- );
END;
$$;


-- Создаем последовательность для ID задач, если её нет
DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_sequences WHERE schemaname = 'carl_amo' AND sequencename = 'amo_task_id_seq'
        ) THEN
            CREATE SEQUENCE carl_amo.amo_task_id_seq START 1000;
        END IF;
    END
$$;
*/

CREATE OR REPLACE FUNCTION carl_amo.generatePassword()
    RETURNS VARCHAR
    LANGUAGE plpgsql
    SECURITY DEFINER
AS $$
DECLARE
    v_chars VARCHAR := 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_special_chars VARCHAR := '!@#$%^&*-_=+';
    v_password VARCHAR := '';
    v_i INTEGER;
BEGIN
    -- Генерируем случайный пароль из 12 символов
    -- 10 случайных букв и цифр
    FOR v_i IN 1..8 LOOP
            v_password := v_password || substr(v_chars, floor(random() * length(v_chars) + 1)::integer, 1);
        END LOOP;

    -- Добавляем по одной заглавной букве, цифре и специальному символу
    v_password := v_password || substr('ABCDEFGHJKLMNPQRSTUVWXYZ', floor(random() * 24 + 1)::integer, 1);
    v_password := v_password || substr('23456789', floor(random() * 8 + 1)::integer, 1);
    v_password := v_password || substr(v_special_chars, floor(random() * length(v_special_chars) + 1)::integer, 1);

    RETURN v_password;
END;
$$;


CREATE OR REPLACE FUNCTION carl_amo.validateRequiredFields(p_data JSONB)
    RETURNS TEXT[] AS $$
DECLARE
    v_missing TEXT[] := '{}';
    v_cl_id_company VARCHAR;
    v_cl_id_contact VARCHAR;
    v_type_profile VARCHAR;
BEGIN
    -- Получаем cl_id компании и контакта
    v_cl_id_company := p_data->>'company_cl_id';
    v_cl_id_contact := p_data->>'contact_cl_id';

    -- Получаем тип профиля (ФЛ/ИП/ЮЛ)
    v_type_profile := p_data#>>'{profile,type_profile}';
    IF v_type_profile IS NULL THEN
        v_type_profile := CASE
            WHEN p_data#>>'{profile,inn}' IS NOT NULL AND p_data#>>'{profile,ownership_type}' = 'ИП' THEN 'ИП'
            WHEN p_data#>>'{profile,inn}' IS NOT NULL THEN 'ЮЛ'
            ELSE 'ФЛ'
            END;
    END IF;

    -- A. Базовые поля (всегда обязательны)
    IF p_data#>>'{profile,type_profile}' IS NULL THEN
        v_missing := array_append(v_missing, 'Тип профиля');
    END IF;

    IF p_data#>>'{car,characteristics,mark}' IS NULL THEN
        v_missing := array_append(v_missing, 'Марка');
    END IF;

    IF p_data#>>'{car,characteristics,model}' IS NULL THEN
        v_missing := array_append(v_missing, 'Модель');
    END IF;

    IF p_data#>>'{car,properties,VIN}' IS NULL THEN
        v_missing := array_append(v_missing, 'VIN');
    END IF;

    IF p_data#>>'{auction,buy_now_price}' IS NULL THEN
        v_missing := array_append(v_missing, 'Стоимость авто');
    END IF;

    IF p_data#>>'{car,properties,tech_pass_ser}' IS NULL THEN
        v_missing := array_append(v_missing, 'ПТС');
    END IF;

    IF p_data#>>'{car,properties,PTS_issued_by}' IS NULL THEN
        v_missing := array_append(v_missing, 'PTS_issued_by');
    END IF;

    IF p_data#>>'{car,properties,year}' IS NULL THEN
        v_missing := array_append(v_missing, 'Год выпуска');
    END IF;

    IF p_data#>>'{car,properties,car_color,name}' IS NULL THEN
        v_missing := array_append(v_missing, 'Цвет');
    END IF;

    IF p_data#>>'{car,properties,location}' IS NULL THEN
        v_missing := array_append(v_missing, 'Город авто');
    END IF;

    IF p_data#>>'{auction,seller}' IS NULL THEN
        v_missing := array_append(v_missing, 'Продавец');
    END IF;

    IF p_data#>>'{auction,seller_profile_id}' IS NULL THEN
        v_missing := array_append(v_missing, 'seller_profile_id');
    END IF;

    IF p_data#>>'{auction,auction_type}' IS NULL THEN
        v_missing := array_append(v_missing, 'Тип сделки');
    END IF;

    -- B. Если у компании нет cl_id, но у контакта есть cl_id
    IF v_cl_id_company IS NULL AND v_cl_id_contact IS NOT NULL THEN
        -- Проверка типа профиля
        IF v_type_profile IS NULL THEN
            v_missing := array_append(v_missing, 'Компания. Тип профиля');
        END IF;

        -- Проверка полей для физлица
        IF v_type_profile = 'ФЛ' THEN
            IF p_data#>>'{profile,passport_series}' IS NULL THEN
                v_missing := array_append(v_missing, 'Контакт. Серия');
            END IF;

            IF p_data#>>'{profile,passport_num}' IS NULL THEN
                v_missing := array_append(v_missing, 'Контакт. Номер');
            END IF;

            IF p_data#>>'{profile,issued_by}' IS NULL THEN
                v_missing := array_append(v_missing, 'Контакт. Кем выдан');
            END IF;

            IF p_data#>>'{profile,issue_date}' IS NULL THEN
                v_missing := array_append(v_missing, 'Контакт. Дата Выдачи');
            END IF;

            IF p_data#>>'{profile,address}' IS NULL THEN
                v_missing := array_append(v_missing, 'Контакт. Адрес регистрации');
            END IF;
        END IF;

        -- Проверка полей для ИП или ЮЛ
        IF v_type_profile IN ('ИП', 'ЮЛ') THEN
            IF p_data#>>'{profile,phone}' IS NULL AND p_data#>>'{user,phone}' IS NULL THEN
                v_missing := array_append(v_missing, 'Телефон');
            END IF;

            IF p_data#>>'{profile,inn}' IS NULL THEN
                v_missing := array_append(v_missing, 'ИНН');
            END IF;

            IF p_data#>>'{profile,address}' IS NULL THEN
                v_missing := array_append(v_missing, 'Адрес');
            END IF;

            IF p_data#>>'{profile,BIC}' IS NULL THEN
                v_missing := array_append(v_missing, 'БИК');
            END IF;

            IF p_data#>>'{profile,ogrn}' IS NULL THEN
                v_missing := array_append(v_missing, 'ОГРН');
            END IF;

            IF p_data#>>'{profile,account}' IS NULL THEN
                v_missing := array_append(v_missing, 'Расчетный счет');
            END IF;

            IF p_data#>>'{profile,bank_name}' IS NULL THEN
                v_missing := array_append(v_missing, 'Банк');
            END IF;
        END IF;

        -- Дополнительные поля для ЮЛ
        IF v_type_profile = 'ЮЛ' THEN
            IF p_data#>>'{profile,sign_fio}' IS NULL THEN
                v_missing := array_append(v_missing, 'Подписант');
            END IF;

            IF p_data#>>'{profile,post}' IS NULL THEN
                v_missing := array_append(v_missing, 'Должность подписанта');
            END IF;

            IF p_data#>>'{profile,subscriber_reason}' IS NULL THEN
                v_missing := array_append(v_missing, 'На основании чего действует');
            END IF;
        END IF;
    END IF;

    -- C. Если cl_id у контакта и компании пусты
    IF v_cl_id_company IS NULL AND v_cl_id_contact IS NULL THEN
        IF (p_data#>>'{user,last_name}' IS NULL OR p_data#>>'{user,first_name}' IS NULL) THEN
            v_missing := array_append(v_missing, 'Контакт. ФИО');
        END IF;

        IF p_data#>>'{user,phone}' IS NULL THEN
            v_missing := array_append(v_missing, 'Контакт. Телефон');
        END IF;

        IF p_data#>>'{user,email}' IS NULL THEN
            v_missing := array_append(v_missing, 'Контакт. Email');
        END IF;
    END IF;

    RETURN v_missing;
END;
$$ LANGUAGE plpgsql;


drop function if exists carl_amo.createNewApiAMO(p_adata json);
drop function if exists carl_amo.createNewFromAMO(p_adata json);

drop function if exists carl_amo.createNewApiAMO(p_adata json);
drop function if exists carl_amo.createNewFromAMO(p_adata json);

-- Обновленная функция для создания сущностей из данных AMO
CREATE OR REPLACE FUNCTION carl_amo._createNewFromAMO(p_data JSONB)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
AS $$
DECLARE
    v_id_user INTEGER;
    v_id_profile INTEGER;
    v_id_auction INTEGER;
    v_user_data JSONB;
    v_profile_data JSONB;
    v_auction_data JSONB;
    v_car_data JSONB;
    v_result JSONB;
    v_missing_fields TEXT[];
    v_existing_user_status VARCHAR;
    v_existing_profile_status VARCHAR;
    v_existing_profile_type VARCHAR;
    v_existing_profile_roles VARCHAR[];
    v_id_user_profile INTEGER;
    v_vin VARCHAR;
    v_existing_auction INTEGER;
    v_deal_id VARCHAR;
    v_message TEXT;
    _id_object int;
    _reg_num varchar;
    _car_color varchar;
    _PTS_issued_by varchar;
    _engine_num varchar;
    _seller_profile_id int;
    _id_prof_categ_buy int;
    _phone varchar;
    _who_can_buy numeric;
    _id_label int;
    _v_id_profile_new boolean := false;
BEGIN
    -- Проверяем, что данные являются JSON
    IF p_data IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'error', 'Входные данные не предоставлены');
    END IF;

    -- Получаем VIN для проверки существующего аукциона
    v_vin := p_data#>>'{car,properties,VIN}';
    v_deal_id := p_data->>'deal_id';

    -- Инициализация переменных из входных данных
    v_id_user := (p_data->>'id_user')::INTEGER;
    v_id_profile := (p_data->>'id_profile')::INTEGER;
    if(v_id_profile is null) then
        _v_id_profile_new := true;
    end if;
    v_user_data := COALESCE(p_data->'user', '{}'::jsonb);
    v_profile_data := COALESCE(p_data->'profile', '{}'::jsonb);
    v_auction_data := COALESCE(p_data->'auction', '{}'::jsonb);
    v_car_data := COALESCE(p_data->'car', '{}'::jsonb);

    /*
    if v_id_user is null or v_id_profile is null then
        -- Проверяем обязательные поля
        v_missing_fields := carl_amo.validateRequiredFields(p_data);

        -- Если есть недостающие поля, создаем задачу в AMO и возвращаем ошибку
        IF array_length(v_missing_fields, 1) > 0 THEN
            v_message := 'Отсутствуют обязательные поля: ' || array_to_string(v_missing_fields, ', ');

            -- Создаем задачу в AMO только если у нас есть ID сделки
            IF v_deal_id IS NOT NULL THEN
                PERFORM carl_amo.createAmoTask(v_deal_id, v_message);
            END IF;

            RETURN jsonb_build_object(
                    'status', 'error',
                    'error', v_message,
                    'missing_fields', to_jsonb(v_missing_fields)
                   );
        END IF;
    end if;

    -- Проверяем существующий аукцион с таким же VIN
    IF v_vin IS NOT NULL THEN
        v_existing_auction := carl_amo.checkAuctionByVIN(v_vin);

        IF v_existing_auction IS NOT NULL THEN
            RETURN jsonb_build_object(
                    'status', 'duplicate',
                    'id_auction', v_existing_auction,
                    'message', 'Аукцион с VIN ' || v_vin || ' уже существует'
                   );
        END IF;
    END IF;
    */

    -- Проверка существования пользователя и его статуса

     -- Добавляем reg_domain в данные пользователя
    IF v_user_data ->> 'reg_domain' IS NULL THEN
        v_user_data := jsonb_set(
                v_user_data,
                '{reg_domain}',
                '"carlink"'
                       );
    END IF;

    IF v_id_user IS NULL THEN
        -- Поиск существующего пользователя по email или телефону
        SELECT u.id_user, u.status
        INTO v_id_user, v_existing_user_status
        FROM carl_data.users u
        WHERE (u.email = v_user_data ->> 'email'
            OR u.phone = v_user_data ->> 'phone')
          and is_deleted = 'N'
           and reg_domain= v_user_data ->> 'reg_domain';

    END IF;
    IF v_id_user IS NOT NULL THEN
        -- Обогащаем данные пользователя из АМО
        UPDATE carl_data.users
        SET first_name  = COALESCE(v_user_data ->> 'first_name', first_name),
            middle_name = COALESCE(v_user_data ->> 'middle_name', middle_name),
            last_name   = COALESCE(v_user_data ->> 'last_name', last_name),
            phone       = COALESCE(v_user_data ->> 'phone', phone),
            email       = COALESCE(v_user_data ->> 'email', email),
            status      = 'CONFIRMED'
        WHERE id_user = v_id_user
          and is_deleted = 'N';
    ELSE
        -- Создаем нового пользователя со сгенерированным паролем
        v_user_data := jsonb_set(
                v_user_data,
                '{status}',
                '"CONFIRMED"'
                       );

        -- Генерируем пароль, если его нет
        IF v_user_data ->> 'password' IS NULL THEN
            v_user_data := jsonb_set(
                    v_user_data,
                    '{password}',
                    to_jsonb(carl_amo.generatePassword())
                           );
        END IF;

        /*
        -- Добавляем reg_domain в данные пользователя
        IF v_user_data ->> 'reg_domain' IS NULL THEN
            v_user_data := jsonb_set(
                    v_user_data,
                    '{reg_domain}',
                    '"carlink"'
                           );
        END IF;
        */

        -- Добавляем reg_domain в данные пользователя
        IF v_user_data ->> 'user_status' IS NULL THEN
            v_user_data := jsonb_set(
                    v_user_data,
                    '{user_status}',
                    '"CONFIRMED"'
                           );
        END IF;

        -- Создаем хэш пароля для createNewUserJ
        v_user_data := jsonb_set(
                v_user_data,
                '{password_hash}',
                to_jsonb(crypt(v_user_data ->> 'password', gen_salt('bf')))
                       );
        -- raise exception '~~~ v_user_data %', v_user_data;
        v_id_user := (carl_auth.createNewUserJ(v_user_data)::jsonb ->> 'id_user')::INTEGER;

        -- записываем phone и мэйл как верифицированные
        update users
        set phone=v_user_data ->> 'phone',
            email=v_user_data ->> 'email'
        where id_user = v_id_user;
    END IF;


    -- Проверка существования профиля и его статуса
    IF v_id_profile IS NULL THEN
        -- Поиск существующего профиля по пользователю
        SELECT p.id_profile, p.status,
            CASE WHEN p.id_company IS NOT NULL THEN 'company' ELSE 'individual' END,
            p.roles
        INTO v_id_profile, v_existing_profile_status, v_existing_profile_type, v_existing_profile_roles
        FROM carl_data.profile p
                 JOIN carl_data.user_profile up ON (up.id_profile = p.id_profile and up.is_deleted = 'N')
            left join carl_data.company cc on (cc.id_company = p.id_company and cc.is_deleted = 'N')
            left join carl_data.individual ii on (ii.id_individual = p.id_individual and ii.is_deleted = 'N')
        WHERE up.id_user = v_id_user
            and (cc.inn = v_profile_data->>'inn' -- для Юрика
                     or (ii.passport_num = v_profile_data->>'passport_num' -- для Физика
                             and ii.passport_series = v_profile_data->>'passport_series')
                )
            and p.is_deleted = 'N'
        ;

        IF v_id_profile IS NOT NULL THEN
            -- Проверяем тип профиля и роли
            IF array_position(v_existing_profile_roles, 'seller'::VARCHAR) IS NOT NULL THEN
                -- Если это профиль продавца - создаем новый профиль покупателя
                v_id_profile := NULL;
            ELSIF(v_existing_profile_type !=
                  CASE WHEN v_profile_data->>'type_profile' in ('ЮЛ','ИП')
                           THEN 'company' ELSE 'individual' END) THEN
                -- Если не совпадает тип - создаем новый профиль
                v_id_profile := NULL;
            ELSE
                -- Обогащаем данные профиля из АМО
                IF v_existing_profile_type = 'company' THEN
                    UPDATE carl_data.company c
                    SET name = COALESCE(v_profile_data->>'name', c.name),
                        inn = COALESCE(v_profile_data->>'inn', c.inn),
                        ogrn = COALESCE(v_profile_data->>'ogrn', c.ogrn),
                        kpp = COALESCE(v_profile_data->>'kpp', c.kpp)
                    FROM carl_data.profile p
                    WHERE p.id_company = c.id_company
                            AND p.id_profile = v_id_profile
                            and p.is_deleted = 'N'
                    ;
                ELSE
                    UPDATE carl_data.individual i
                    SET passport_series = COALESCE(v_profile_data->>'passport_series', i.passport_series),
                        passport_num = COALESCE(v_profile_data->>'passport_num', i.passport_num)
                    FROM carl_data.profile p
                    WHERE p.id_individual = i.id_individual
                            AND p.id_profile = v_id_profile
                            and p.is_deleted = 'N'
                    ;
                END IF;

                -- Обновляем статус профиля
                UPDATE carl_data.profile
                    SET status = 'ok'
                    WHERE id_profile = v_id_profile;

                raise notice '1 ЁЁЁ ОТЛАДКА -- Привязываем профиль к пользователю если небыл привязан % %'
                        , v_id_user, v_id_profile ;
                if(NOT carl_prof._is_user_from_prof(v_id_user, v_id_profile)) then
                    insert into carl_data.user_profile(id_user, id_profile) VALUES
                        (v_id_user, v_id_profile);
                    update carl_data.profile set id_user_owner = v_id_user
                        where id_profile = v_id_profile;
                end if;
                raise notice '2 ЁЁЁ ОТЛАДКА ';

            END IF;
        END IF;

        -- Если профиль не найден или нужно создать новый
        IF v_id_profile IS NULL THEN

            -- Определяем тип профиля и создаем новый
            v_profile_data := jsonb_set(
                    v_profile_data,
                    '{id_user}',
                    to_jsonb(v_id_user)
                              );

            -- Устанавливаем статус профиля
            v_profile_data := jsonb_set(
                    v_profile_data,
                    '{status}',
                    '"ok"'
            );

            IF v_profile_data->>'type_profile' in ('ЮЛ','ИП') THEN
                _id_prof_categ_buy := 3; -- 3,Unofficial Dealer
                -- select * from prof_categ_dict;
                v_profile_data := jsonb_set(
                        v_profile_data,
                        '{id_prof_categ_buy}',
                        to_jsonb(_id_prof_categ_buy)
                                  );
                _phone := v_profile_data->>'phone';
                v_profile_data := jsonb_set(
                        v_profile_data,
                        '{phone_list}',
                        to_jsonb(_phone)
                                  );
                raise notice '~~~ ОТЛАДКА createNewCompanyJ(() v_profile_data %', v_profile_data;
                v_id_profile := (carl_prof.createNewCompanyJ(v_profile_data::json) ->> 'id_profile')::INTEGER;
                raise notice '~~~ ОТЛАДКА createNewCompanyJ(() v_id_profile %  wcb %', v_id_profile, carl_prof._getProfWhoCanBuy(v_id_profile);
            ELSE
                _id_prof_categ_buy := 2; -- 2,Private customer
                -- select * from prof_categ_dict;
                v_profile_data := jsonb_set(
                        v_profile_data,
                        '{id_prof_categ_buy}',
                        to_jsonb(_id_prof_categ_buy)
                                  );
                v_id_profile := (carl_prof.createNewIndividualJ(v_profile_data::json) ->> 'id_profile')::INTEGER;
                raise notice '~~~~~~! ОТЛАДКА createNewIndividualJ(() v_id_profile % wcb %'
                    , v_id_profile
                    , carl_prof._getProfWhoCanBuy(v_id_profile)
                ;
            END IF;

            raise notice '~~~ ОТЛАДКА -- переводим в ACTIVE v_id_auction %', v_id_auction;

            -- Привязываем профиль к пользователю.
            if(NOT carl_prof._is_user_from_prof(v_id_user, v_id_profile)) then
                insert into carl_data.user_profile(id_user, id_profile) VALUES
                    (v_id_user, v_id_profile);
                update carl_data.profile set id_user_owner = v_id_user
                               where id_profile = v_id_profile;
            end if;
            --ЕКМ:28/05/2035 в setRoles есть проверка на баланс это блокирует профиль но почему-то не выставляется buyer
            -- perform carl_prof.setRoles(v_id_profile, 'buyer');
            perform carl_prof._addRole(v_id_profile, 'buyer'::en_role);
            -- добавляем wanted_roles
            update profile set wanted_roles = string_to_array('buyer',',')::en_role[]
      	        where is_deleted = 'N' and id_profile = v_id_profile;
            -- Устанавливаем признак, что профиль создан из AMO
            PERFORM carl_prof.setProfParameterJb(v_id_profile, jsonb_build_object('from_amo', true));
            raise notice '!!!!!!!!!!! ЁЁЁ ОТЛАДКА NEW is buyer % _is_user_from_prof %'
                , carl_prof.hasRole(v_id_profile,'buyer')
                , carl_prof._is_user_from_prof(v_id_user, v_id_profile);
        END IF;
    END IF;

    _seller_profile_id := (v_auction_data->>'seller_profile_id')::int;
    IF _seller_profile_id IS NULL THEN
        RETURN jsonb_build_object(
                'status', 'error',
                'error', 'Не найден профиль продавца с seller_profile_id '
               );
    END IF;

    -- Получаем id_user_profile продавца через id_user_owner с проверкой is_deleted = 'N'
    SELECT up.id_user_profile 
        INTO v_id_user_profile
        FROM carl_data.profile p
        JOIN carl_data.user_profile up ON up.id_user = p.id_user_owner
            AND up.id_profile = p.id_profile
            AND up.is_deleted = 'N'
        JOIN carl_data.users u ON u.id_user = p.id_user_owner AND u.is_deleted = 'N'
        WHERE p.id_profile = _seller_profile_id
            AND p.is_deleted = 'N';

    IF v_id_user_profile IS NULL THEN
        RETURN jsonb_build_object(
            'status', 'error',
            'error', 'Не найден активный профиль продавца с id ' || (v_auction_data->>'seller_profile_id') || ' или его владелец'
        );
    END IF;

    raise notice 'ЁЁЁ ОТЛАДКА -- Создание лота';
    -- Создание лота
    v_auction_data := jsonb_set(
        v_auction_data,
        '{id_user_profile}',         -- Теперь это профиль ПРОДАВЦА через id_user_owner
        to_jsonb(v_id_user_profile)
    );

    -- raise notice '%', jsonb_pretty((v_car_data)::jsonb);
    _id_object := carl_obj.createNewObjJb(1, (v_car_data)::jsonb, true);

    if (_id_object is null)
    then
        raise exception using message = carl_comm._getMessage('CANT_CREATE_NEW_CAR')
            , errcode = carl_comm._getErrcode('CANT_CREATE_NEW_CAR');
    end if;

    v_auction_data := jsonb_set(
            v_auction_data,
            '{id_object}',
            to_jsonb(_id_object)
    );

--     _who_can_buy := carl_prof._getProfWhoCanBuy(v_id_profile);
--     v_auction_data := jsonb_set(
--             v_auction_data,
--             '{who_can_buy}',
--             to_jsonb(_who_can_buy)
--                       );
    raise notice '~~~ ОТЛАДКА -- Создание аукциона';
    -- Создание аукциона
    v_id_auction := carl_auct._createNewAuctionJb(
            jsonb_build_object('auction', v_auction_data, 'car', v_car_data)
    );
    select who_can_buy
        into _who_can_buy
        from auction
        where id_auction = v_id_auction;
    raise notice '~~~~~~! ОТЛАДКА v_id_profile % _who_can_buy  % is buyer: % % % %', v_id_profile, _who_can_buy
        , carl_prof.hasRole(v_id_profile,'buyer')
        , carl_prof._getProfWhoCanBuy(v_id_profile)
        , _who_can_buy & carl_prof._getProfWhoCanBuy(v_id_profile)
        , getProfParameters(v_id_profile)
    ;

    -- Только для новых!
    if(_v_id_profile_new and carl_prof._is_prof_blocked(v_id_profile)) then
        perform carl_prof.unBlockProf(v_id_profile, 'Лот из AMO API был автоматически заблокирован');
    end if;

    raise notice '~~~ ОТЛАДКА -- Добавляем тег "Ручная сделка"';
    -- Добавляем тег "Ручная сделка"
    -- insert into label (name,color_code) values ('Ручная сделка', '#75C28B');
    select id_label into _id_label from label where name = 'Ручная сделка';
    delete from auction_label where id_auction = v_id_auction and id_label = _id_label;

    if( _id_label is not null) then
        perform addAuctLabelId(v_id_auction, _id_label);
    end if;

    _car_color := (v_car_data#>>'{properties,car_color,name}')::varchar;
    if(_car_color is not null) then
        perform updateauctobjattrib(v_id_auction, 'car_color'
            , '"'|| _car_color||'"');
    end if;

    _reg_num := (v_car_data#>>'{properties,reg_num}')::varchar;
    if(_reg_num is not null) then
        perform updateauctobjattrib(v_id_auction, 'reg_num'
            , '"'||_reg_num||'"');
    end if;

    _PTS_issued_by := (v_car_data#>>'{properties,PTS_issued_by}')::varchar;
    if(_reg_num is not null) then
        -- perform updateauctobjattrib(v_id_auction, 'PTS_issued_by'
        --    , '"'||_PTS_issued_by||'"');
    end if;
    _engine_num := (v_car_data#>>'{properties,engine_num}')::varchar;
    if(_reg_num is not null) then
        -- perform updateauctobjattrib(v_id_auction, 'engine_num'
        --    , '"'||_engine_num||'"');
    end if;

    raise notice '~~~ ОТЛАДКА -- переводим в ACTIVE v_id_auction %', v_id_auction;
    -- переводим в ACTIVE
    update auction set status='ACTIVE', workflow_status='ACTIVE', reserv_comp=0, reserv_indiv=0
        where id_auction = v_id_auction;

    perform _writeAuctLog('ACTIVE'::en_auction_event_type,null,null,null
        ,v_id_auction
        ,null,null,null
        ,'{"src":"carl_amo._createNewFromAMO()"}'::json);

    -- Устанавливаем признак, что аукцион создан из AMO
    PERFORM carl_auct.setAuctParameter(v_id_auction, jsonb_build_object('from_amo', true));

    raise notice '~~~ ОТЛАДКА -- -- Устанавливаем признак, что аукцион создан из AMO v_id_auction %', v_id_auction;

    -- Связываем аукцион со сделкой в AMO, если ID сделки предоставлен
    -- IF v_deal_id IS NOT NULL THEN
    --    PERFORM carl_amo.linkAuctionToAmoDeal(v_id_auction, v_deal_id);
    --END IF;

    -- Формируем результат
    v_result := jsonb_build_object(
            'status', 'ok',
            'id_user', v_id_user,
            'id_profile', v_id_profile,
            'id_auction', v_id_auction
    );

    -- Добавляем информацию о сгенерированном пароле, если создали нового пользователя
    IF v_user_data->>'password' IS NOT NULL AND v_existing_user_status IS NULL THEN
        v_result := v_result || jsonb_build_object('password', v_user_data->>'password');
    END IF;

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    -- В случае ошибки возвращаем информацию об ошибке
    RETURN jsonb_build_object(
            'status', 'error',
            'error', SQLERRM
           );
END;
$$;


DROP FUNCTION IF EXISTS carl_amo.createNewApiAMO(p_adata json);

------------------------------------------------------------------------------------
/*--
    Если существует Пользователь (один подтвержденный контакт, или ни одного, или два)
    , но нет Профиля:
    ** Обогатить данные пользователя данными из АМО
    , изменить статус пользователя (при необходимости).
    Создать Профиль покупателя по правилам выше (п. 3b).
    Верными считать данные из АМО.
*/
-- create or replace function carl_amo.createNewApiAMO(p_adata json) returns json
-- Функция для создания аукциона и автоматической покупки через buynow
CREATE OR REPLACE FUNCTION carl_amo.createNewFromAMO(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result jsonb;
    v_id_user INTEGER;
    v_id_profile INTEGER;
    v_id_auction INTEGER;
    v_buynow_result jsonb;
    v_auction_data jsonb;
    _s text;
BEGIN
    PERFORM carl_comm.writelog( jsonb_pretty(p_data),
                               'carl_amo.createNewFromAMO()',
                               'createNewFromAMO',
                               'INFO');

    -- Сначала создаем аукцион обычным способом
    v_result := carl_amo._createNewFromAMO(p_data);
    
    -- Проверяем успешность создания
    raise notice '~~~ ОТЛАДКА -- Проверяем успешность создания';

    IF (v_result->>'status') = 'ok' THEN
        -- Получаем идентификаторы пользователя, профиля и аукциона
        v_id_user := (v_result->>'id_user')::INTEGER;
        v_id_profile := (v_result->>'id_profile')::INTEGER;
        v_id_auction := (v_result->>'id_auction')::INTEGER;
        raise notice '~~~ ОТЛАДКА -- переводим в ACTIVE v_id_profile % buyer %', v_id_profile, carl_prof.hasRole(v_id_profile,'buyer');

        if(carl_prof.hasRole(v_id_profile,'buyer') <> 'Y') then
            raise exception 'Покупатель не имеет роли buyer';
        end if;

        -- проверяем что Покупатель не заблокирован
        if(carl_prof.isBlockedProf(v_id_profile)) then
            _s := _getBlockProfJ(v_id_profile)->>'text';
            raise exception using message = _s;
        end if;

        -- Выполняем покупку через buynow
        -- raise notice 'ЁЁЁ ОТЛАДКА _is_user_from_prof % % %',v_id_user, v_id_profile, carl_prof._is_user_from_prof(v_id_user, v_id_profile);
        raise notice 'ЁЁЁ ОТЛАДКА _bul_sum := %', carl_prof._getBalanceSum(v_id_profile);
        -- _auct_reserv := case when carl_prof._is_company(p_id_profile) then _auction.reserv_comp else _auction.reserv_indiv end;
        --_bul_sum := carl_prof._getBalanceSum(p_id_profile);
        v_buynow_result := carl_auct.buynow(v_id_user, v_id_profile, v_id_auction, false);

        -- Берем коммиссию из АМО
        v_auction_data := COALESCE(p_data->'auction', '{}'::jsonb);
        update auction set applied_commission=(v_auction_data->>'commission')::integer
        where id_auction = v_id_auction;

        -- Добавляем результат buynow в ответ
        v_result := jsonb_set(
            v_result, 
            '{buynow_result}', 
            v_buynow_result::jsonb
        );
    END IF;
    
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    -- В случае ошибки возвращаем информацию об ошибке
    RETURN jsonb_build_object(
        'status', 'error',
        'error', SQLERRM,
        'initial_result', v_result
    );
END;
$$;
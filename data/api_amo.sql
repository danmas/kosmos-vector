/**
 * api_amo.sql
 *
 * Author:  Roman Eremeev
 * Created: 01.02.2019
 *
 * AMO

  getAuctAmoData()
  writeAuctAmoStatuses() - добавлен параметр p_id_broker по-умолчаиню null
  getWinLotsAMODataJ()
 */


/*
select carl_amo.writeSyncAmo('{"id":5, "pipeline":34, "status":3, "company":7, "contacts":{"sd":55}, "vin":"sdfsdfsdf", "cl_id":67}'::json);
select carl_amo.writeSyncAmo('{"id":6, "pipeline":34456, "status":4563, "company":347, "contacts":{"sd":55}, "vin":"sdfsdfsdf", "cl_id":67}'::json);
*/

drop function if exists carl_amo.writeSyncAmo(p_sync_amo json);

---------------------------------------------------------------------------------
-- Записать строку p_sync_amo в sync_amo
-- Возвращает id_sync_amo
-- select * from carl_amo.sync_amo order by id_sync_amo desc;
-- select carl_amo.writeSyncAmo('{"id":61,"type":"6661"}'::json);
-- select carl_amo.writeSyncAmo('{"id":7,"type":"777++"}'::json);
---------------------------------------------------------------------------------
create or replace function carl_amo.writeSyncAmo(p_sync_amo json, p_id_broker int default null)
	returns int security definer as $$
	declare
    _id_sync_amo int;
		_cnt int;
	begin
        delete from carl_amo.sync_amo
        where 2=2 --((p_id_broker is null and id_broker is null) or (id_broker = p_id_broker))
                and (data#>>'{id}')::int = (p_sync_amo#>>'{id}')::int
                and data#>>'{type}' = p_sync_amo#>>'{type}';

        insert into carl_amo.sync_amo(data, id_broker) values (p_sync_amo, p_id_broker)
        returning id_sync_amo into _id_sync_amo;

-- 		select count(*) into _cnt from carl_amo.sync_amo
-- 			where 2=2 --((p_id_broker is null and id_broker is null) or (id_broker = p_id_broker))
--                 and (data#>>'{id}')::int = (p_sync_amo#>>'{id}')::int
--                 and data#>>'{type}' = p_sync_amo#>>'{type}';
-- 		if(_cnt > 0) then
-- 			select id_sync_amo into _id_sync_amo from carl_amo.sync_amo
-- 				where 2=2 --((p_id_broker is null and id_broker is null) or (id_broker = p_id_broker))
--                   and (data#>>'{id}')::int = (p_sync_amo#>>'{id}')::int
--                   and data#>>'{type}' = p_sync_amo#>>'{type}'
-- 				limit 1;
-- 			update carl_amo.sync_amo set data=p_sync_amo where id_sync_amo = _id_sync_amo;
-- 		else
-- 			insert into carl_amo.sync_amo(data, id_broker) values (p_sync_amo, p_id_broker)
--                 returning id_sync_amo into _id_sync_amo;
-- 		end if;

    return _id_sync_amo;
end;
$$ language plpgsql;


drop function if exists carl_amo.getSyncAmo(p_filter jsonb);

---------------------------------------------------------------------------------
-- Получить данные по синхронизации с АМО
-- Возвращает все или в зависимости от фильтра строки таблицы sync_amo в виде json
-- select carl_amo.getSyncAmo(null);
---------------------------------------------------------------------------------
create or replace function carl_amo.getSyncAmo(p_filter jsonb, p_id_broker int default null)
	returns setof json security definer as $$
		select row_to_json(r) from (
			select data from carl_amo.sync_amo sa where
        ((p_id_broker is null and id_broker is null) or (id_broker = p_id_broker))
        and (p_filter is null or data @> p_filter) order by id_sync_amo
	) r;
$$ language sql;


---------------------------------------------------------------------------------
-- Получить АМО данные из broker по фильтру p_filter
---------------------------------------------------------------------------------
create or replace function carl_amo.getAmoDataBroker(p_filter jsonb)
	returns setof json security definer as $$
		select row_to_json(r) from (
			select amo_data, id_broker from carl_data.broker b where
        amo_data::jsonb @> p_filter
	) r;
$$ language sql;


drop function if exists carl_amo.getSyncAmoMFilter(p_filter jsonb);

---------------------------------------------------------------------------------
-- Получить данные по синхронизации с АМО
-- Возвращает в зависимости от фильтра строки таблицы sync_amo в виде json
-- множественные параметры id_auction и vin
-- select carl_amo.getSyncAmo(null);
-- НЕ ИСПОЛЬЗУЕТСЯ ДЛЯ БРОКЕРОВ! id_broker = null
---------------------------------------------------------------------------------
create or replace function carl_amo.getSyncAmoMFilter(p_filter jsonb)
    returns json security definer as $$
    declare j_out json;
    declare sql varchar;
    declare where_clause varchar default '';
    declare id_auction_clause jsonb;
    declare vin_clause jsonb;
    declare cl_id_clause jsonb;
begin
    id_auction_clause := p_filter #> '{id_auction}';
    if(id_auction_clause is not null) then
        p_filter := p_filter - 'id_auction';
    end if;

    vin_clause := p_filter #> '{vin}';
    if(vin_clause is not null) then
        p_filter := p_filter - 'vin';
    end if;

    cl_id_clause := p_filter #> '{cl_id}';
    if(cl_id_clause is not null) then
        p_filter := p_filter - 'cl_id';
    end if;

    if(p_filter != '{}' and p_filter is not null) then
        where_clause := 'data@> '''||p_filter::varchar||'''';
    end if;

    if (id_auction_clause is not null) then
        if(where_clause != '') then
            where_clause := where_clause || ' and ';
        end if;
        where_clause := where_clause || 'data#>>''{id_auction}'' = any((select * from jsonb_array_elements_text('''
                        ||id_auction_clause||''')))';
    end if;
    if(vin_clause is not null) then
        if(where_clause != '') then
            where_clause := where_clause || ' and ';
        end if;
        where_clause := where_clause || 'data#>>''{vin}'' = any((select * from jsonb_array_elements_text('''
                        ||vin_clause||''')))';
    end if;
    if(cl_id_clause is not null) then
        if(where_clause != '') then
            where_clause := where_clause || ' and ';
        end if;
        where_clause := where_clause || 'data#>>''{cl_id}'' = any((select * from jsonb_array_elements_text('''
                        ||cl_id_clause||''')))';
    end if;

    if(where_clause != '') then
        where_clause := '(' || where_clause || ')';
    end if;

    sql := '
        select array_to_json(array_agg(row_to_json(r))) from (
            select data from carl_amo.sync_amo sa where id_broker is null and ' || where_clause || ' order by id_sync_amo
      ) r';
    raise notice '~~~ sql %',sql;
    execute sql into j_out;
    return j_out;
end;
$$ language plpgsql;


drop function if exists carl_amo.getSyncAmoByIdAuction(id_a json);

create or replace function carl_amo.getSyncAmoByIdAuction(id_a json)
    returns setof json security definer as $$
        select row_to_json(r) from (
            select data from carl_amo.sync_amo sa where (data#>>'{id_auction}'
      = ANY (array(select * from json_array_elements(id_a))::text[])) order by id_sync_amo
        ) r;
$$ language sql;



drop function if exists carl_amo.deleteSyncAmo(p_id int);

---------------------------------------------------------------------------------
-- Удаление записи синхронизации с АМО по p_id
-- если null то все
-- select carl_amo.deleteSyncAmo(6);
-- select carl_amo.deleteSyncAmo(null);
----------------------------------------------------------------------------------
create or replace function carl_amo.deleteSyncAmo(p_id int, p_id_broker int default null)
returns void security definer as $$
  delete from carl_amo.sync_amo where
    ((p_id_broker is null and id_broker is null) or (id_broker = p_id_broker))
    and (p_id is null or (data#>>'{id}')::int = p_id);
$$ language sql;


drop function if exists carl_amo.updateSyncAmo(p_id int, p_sync_amo json);

---------------------------------------------------------------------------------
-- Изменить записи синхронизации с АМО по p_id на p_sync_amo
-- если null то все
-- select * from carl_amo.sync_amo;
-- select carl_amo.updateSyncAmo(6,'{"id":6,"ddd":"+666"}'::json);
-- select carl_amo.deleteSyncAmo(null);
----------------------------------------------------------------------------------
create or replace function carl_amo.updateSyncAmo(p_id int, p_sync_amo json, p_id_broker int default null)
returns void security definer as $$
  update carl_amo.sync_amo set data=p_sync_amo where
    ((p_id_broker is null and id_broker is null) or (id_broker = p_id_broker))
    and (data#>>'{id}')::int = p_id;
$$ language sql;


------------------------------------------------------------------------------------------------------------------------
/*
select carl_amo.writeSyncAmoJ('{
    "syncamo": [
        {
            "type": "contact",
            "id": 24154059,
            "cl_id": 3587,
            "dt_create": 1534844026,
            "dt_update": 1537534190
        },
        {
            "type": "contact",
            "id": 21388981,
            "cl_id": 2916,
            "dt_create": 1530090243,
            "dt_update": 1537535758
        },
        {
            "type": "contact",
            "id": 24059705,
            "cl_id": 3573,
            "dt_create": 1534774730,
            "dt_update": 1537973707
        },
        {
            "type": "contact",
            "id": 21390203,
            "cl_id": 3419,
            "dt_create": 1533223323,
            "dt_update": 1538477970
        },
        {
            "type": "contact",
            "id": 23603665,
            "cl_id": 3552,
            "dt_create": 1534516059,
            "dt_update": 1538487021
        }
]}'::json);
*/

drop function if exists carl_amo.writeSyncAmoJ(p_in_json json);

------------------------------------------------------------------------------------------------------------------------
-- Загрузка в SyncAmo жизоном массива жизонов
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_amo.writeSyncAmoJ(p_in_json json, p_id_broker int default null)
returns void security definer as $$
declare
  _sv json;
begin

  for _sv in
	  select el
		from json_array_elements((p_in_json->>'syncamo')::json) el
	loop
    -- raise notice '~~~ %', _sv;
    perform  carl_amo.writeSyncAmo(_sv, p_id_broker);
  end loop;

end;
$$ language plpgsql;


drop function if exists carl_amo.writeAuctAmoStatuses(p_amo_statuses json);

---------------------------------------------------------------------------------
-- Записать АМО статусов в таблицу
-- Возвращает id_sync_amo
-- select * from carl_amo.sync_amo order by id_sync_amo desc;
-- select carl_amo.writeSyncAmo('{"id":61,"type":"6661"}'::json);
-- select carl_amo.writeSyncAmo('{"id":7,"type":"777++"}'::json);
---------------------------------------------------------------------------------
create or replace function carl_amo.writeAuctAmoStatuses(p_amo_statuses json, p_id_broker int default null)
	returns void security definer as $$
declare
  _key text;
  _value json;

  _j json; _j_2 json;
  _id varchar; _dt integer; _id_auction int; _rejection_reason varchar;
  _jb_out_sell jsonb := '{}'; _jb_out_lead jsonb := '{}';
  _j_ar_status_out_sell  jsonb[] :='{}'::jsonb;
  _j_ar_status_out_lead  jsonb[] :='{}'::jsonb;
  _j_ar_data_out_sell  jsonb[] :='{}'::jsonb;
  _j_ar_data_out_lead  jsonb[] :='{}'::jsonb;
  _cnt int; _description varchar; _name varchar;
  _amo_data_key_sell varchar; _amo_data_key_lead varchar;
begin
  for _j in (
    select * from json_array_elements(p_amo_statuses)
      ) loop

    _jb_out_sell :='{}'::jsonb;
    _jb_out_lead :='{}'::jsonb;
    _j_ar_data_out_sell :='{}'::jsonb;
    _j_ar_data_out_lead :='{}'::jsonb;

     -- по аукционам
    for _key, _value in select * from json_each(_j) loop
      if (_key = 'id_auction') then
        _id_auction := _value;
      elsif (_key = 'status') then

        _j_ar_status_out_sell :='{}'::jsonb;
        _j_ar_status_out_lead :='{}'::jsonb;

        -- по статусам
        for _j_2 in (
          select * from json_array_elements(_value)
            ) loop

          for _key, _value in select * from json_each(_j_2) loop
            if (_key = 'id') then
              raise notice '~~~ writeAuctAmoStatuses() _value %', _value;
              _id := replace(_value::varchar,'"','');
            elsif (_key = 'rejection_reason') then
                raise notice '~~~ writeAuctAmoStatuses() _key % _value %',_key,  _value;
                _rejection_reason := replace(_value::varchar,'"','');
            elsif (_key = 'dt') then

              raise notice '~~~ writeAuctAmoStatuses() _key % _value %',_key,  _value;

--               if(_value = 'null') then
--                 _dt := null;
--               else
                _dt := _value;
--              end if;

              -- заполняем статусы
              select description_sell, name into _description, _name
                                            from carl_amo.amo_data_dict
                where amo_data_key = _id and seller
                    and not deleted
              ;

              if _name is not null then
                _amo_data_key_sell := _id;
                _j_ar_status_out_sell := _j_ar_status_out_sell
                                         || jsonb_strip_nulls(jsonb_build_object('id',_id,'dt',_dt
                        , 'rejection_reason', _rejection_reason));
              end if;
              select description_lead, name into _description, _name
                                            from carl_amo.amo_data_dict
                where amo_data_key = _id and leader
                      and not deleted
              ;

              if _name is not null then
                _amo_data_key_lead := _id;
                _j_ar_status_out_lead := _j_ar_status_out_lead
                                         || jsonb_strip_nulls(jsonb_build_object('id',_id,'dt',_dt
                        , 'rejection_reason', _rejection_reason));
              end if;
            end if;
          end loop;
        end loop;

        _jb_out_sell := jsonb_build_object('statuses',_j_ar_status_out_sell);
        _jb_out_lead := jsonb_build_object('statuses',_j_ar_status_out_lead);
      else
        raise notice '~~~ writeAuctAmoStatuses() key % value %',_key, _value;
        select description_sell, name into _description, _name from carl_amo.amo_data_dict
          where amo_data_key = _key and seller
                  and not deleted
        ;
        if(_name is not null) then
          raise notice '~~~ SEL writeAuctAmoStatuses() key % value %',_key, _value;
          _j_ar_data_out_sell := _j_ar_data_out_sell || jsonb_build_object(_key,_value);
        end if;
        select description_lead, name into _description, _name
                                      from carl_amo.amo_data_dict
          where amo_data_key = _key and leader
                and not deleted
        ;
        if(_name is not null) then
          _j_ar_data_out_lead := _j_ar_data_out_lead || jsonb_build_object(_key,_value);
        end if;
      end if;
    end loop;

    _jb_out_sell := _jb_out_sell || jsonb_build_object('data',_j_ar_data_out_sell);
    _jb_out_lead := _jb_out_lead || jsonb_build_object('data',_j_ar_data_out_lead);

    raise notice '~~~ writeAuctAmoStatuses() _jb_out_sell %  _jb_out_lead %',_jb_out_sell, _jb_out_lead;
    if(p_id_broker is null) then
      select count(*) into _cnt from carl_amo.auct_amo_data  where id_auction = _id_auction
        and id_broker is null;
      if( _cnt = 0) then
        insert into carl_amo.auct_amo_data  (id_auction, amo_data_in, amo_data_out_sel, amo_data_out_lead, id_broker) values
          (_id_auction, p_amo_statuses, _jb_out_sell, _jb_out_lead, p_id_broker);
      else
        update carl_amo.auct_amo_data  set id_auction=_id_auction, amo_data_in=p_amo_statuses
          , amo_data_out_sel= case when p_id_broker is null then _jb_out_sell else null end
          , amo_data_out_lead=_jb_out_lead, id_broker=p_id_broker
          where id_auction = _id_auction
            and id_broker is null;
      end if;

      update carl_data.auction set amo_status_sell=_amo_data_key_sell, amo_status_lead=_amo_data_key_lead
        where id_auction = _id_auction;
    else
      select count(*) into _cnt from carl_amo.auct_amo_data  where id_auction = _id_auction
        and id_broker = p_id_broker;
      if( _cnt = 0) then
        insert into carl_amo.auct_amo_data  (id_auction, amo_data_in, amo_data_out_sel, amo_data_out_lead, id_broker) values
          (_id_auction, p_amo_statuses, null, _jb_out_lead, p_id_broker);
      else
        update carl_amo.auct_amo_data  set id_auction=_id_auction, amo_data_in=p_amo_statuses
          , amo_data_out_sel=null
          , amo_data_out_lead=_jb_out_lead, id_broker=p_id_broker
          where id_auction = _id_auction
            and id_broker = p_id_broker;
      end if;

      update carl_data.auction set /*amo_status_sell=_amo_data_key_sell,*/
          amo_status_lead_bro=_amo_data_key_lead
        where id_auction = _id_auction;
    end if;

 end loop;
end;
$$ language plpgsql;


-- ---------------------------------------------------------------------------------
-- --
-- ---------------------------------------------------------------------------------
-- create or replace function carl_amo.__getAuctAmoData_SELL()
-- 	returns json security definer as $$
--   select '{"data": [{"issue_responsible": "ФИО"}, {"location": "location"}], "statuses": [{"dt": 123124235, "id": "waiting_confirmation"}, {"dt": 123124235, "id": "documents_preparation"}]}'::json
-- $$ language sql;
--
--
-- ---------------------------------------------------------------------------------
-- --
-- ---------------------------------------------------------------------------------
-- create or replace function carl_amo.__getAuctAmoData_LEAD()
-- 	returns json security definer as $$
--   select '{"data": [{"penalty": 1}, {"penalty_status": "string"}, {"issue_responsible": "ФИО"}, {"location": "location"}, {"due_date_car": "12.12.12"}, {"due_date_commission_buyer": "12.12.12"}, {"dute_date_commission_seller": "12.12.12"}], "statuses": [{"dt": 123124235, "id": "waiting_confirmation"}, {"dt": 123124235, "id": "documents_preparation"}]}'::json
-- $$ language sql;


-- ---------------------------------------------------------------------------------
-- --
-- ---------------------------------------------------------------------------------
-- create or replace function carl_amo.__getAuctAmoData_SELL()
-- 	returns json security definer as $$
--   select '{"data": [{"name": "Ответственный за выдачу", "descr": "", "issue_responsible": "ФИО"}, {"name": "Адрес нахождения авто (Город/Адрес)", "descr": "", "location": "location"}], "statuses": [{"dt": 123124235, "id": "waiting_confirmation", "name": "Ожидает подтверждения", "descr": ""}, {"dt": 123124235, "id": "documents_preparation", "name": "Подготовка документов", "descr": ""}]}'::json
-- $$ language sql;
--
--
-- ---------------------------------------------------------------------------------
-- --
-- ---------------------------------------------------------------------------------
-- create or replace function carl_amo.__getAuctAmoData_LEAD()
-- 	returns json security definer as $$
--   select '{"data": [{"name": "Штраф за отказ от сделки", "descr": "", "penalty": 1}, {"name": "Статус штрафа", "descr": "", "penalty_status": "string"}, {"name": "Ответственный за выдачу", "descr": "", "issue_responsible": "ФИО"}, {"name": "Адрес нахождения авто (Город/Адрес)", "descr": "", "location": "location"}, {"name": "Срок оплаты счета за авто", "descr": "", "due_date_car": "12.12.12"}, {"name": "Срок оплаты счета за КВ Покупателя", "descr": "", "due_date_commission_buyer": "12.12.12"}, {"name": "Срок оплаты счета за КВ Продавца", "descr": "", "dute_date_commission_seller": "12.12.12"}], "statuses": [{"dt": 123124235, "id": "waiting_confirmation", "name": "Ожидает подтверждения", "descr": ""}, {"dt": 123124235, "id": "documents_preparation", "name": "Подготовка документов", "descr": ""}]}'::json
-- $$ language sql;


drop function if exists carl_amo.getAuctAmoData(p_id_user int, p_id_profile int, p_id_auction int);

---------------------------------------------------------------------------------
-- Получить АМО статусы и данные
-- select getAuctAmoData(1,3,74);
-- если p_id_broker нулл то из АМО-К
-- если p_id_broker не нулл то из АМО-Б а p_id_profile - профиль брокера или лидера
-- select carl_amo.getAuctAmoData(1, _get_auct_seller_id(18275), 18275);
---------------------------------------------------------------------------------
create or replace function carl_amo.getAuctAmoData(p_id_user int, p_id_profile int, p_id_auction int
  , p_id_broker int default null)
	returns json security definer as $$
declare
    _ret jsonb; _amo_data_in jsonb; _amo_data_out_lead jsonb; _amo_data_out_sel jsonb;
    _delivery_company varchar; _tracking_url varchar;
  begin

  -- продавец - АМО-К
  if(_is_seller_of_auct(p_id_profile, p_id_auction)) then
    select amo_data_out_sel,  amo_data_in  into _amo_data_out_sel, _amo_data_in
      from carl_amo.auct_amo_data
      where id_auction = p_id_auction
          and id_broker is null;

    if( _amo_data_in->(0)->>'seller_track_num' is not null) then
        _delivery_company := _amo_data_in->(0)->>'seller_delivery_company';
        select tracking_url into _tracking_url from deliver where name = _delivery_company;

        _ret := _amo_data_out_sel::jsonb
                    || jsonb_build_object('track_num', _amo_data_in->(0)->>'seller_track_num')
                    || jsonb_build_object('delivery_company', _delivery_company)
                    || jsonb_build_object('docs_send_date', _amo_data_in->(0)->>'seller_docs_send_date')
            || jsonb_build_object('tracking_url', _tracking_url)
        ;
    else
        _ret := _amo_data_out_sel;
    end if;
    return _ret::json;
  end if;

  if(p_id_broker is null) then
    -- брокер null и брокер лидера или лидер (юрик)
    -- АМО-К
    if(_is_broker_of_leader(p_id_profile, p_id_auction) or _is_prof_leader(p_id_profile, p_id_auction)) then
        select amo_data_out_lead, amo_data_in  into _amo_data_out_lead, _amo_data_in
          from carl_amo.auct_amo_data
          where id_auction = p_id_auction
              and id_broker is null;
        -- return _ret;
    else
      return null;
    end if;
  else
    -- брокер НЕ null и лидер (физик) подброкер брокера p_id_broker
    -- АМО-Б
    if(_is_prof_leader(p_id_profile, p_id_auction) and _get_id_broker_of_prof(p_id_profile) = p_id_broker) then
        select amo_data_out_lead, amo_data_in  into _amo_data_out_lead, _amo_data_in
          from carl_amo.auct_amo_data
          where id_auction = p_id_auction
              and id_broker = p_id_broker;
        -- return _ret;
    else
      return null;
    end if;
  end if;

  if( _amo_data_in->(0)->>'track_num' is not null) then
      _delivery_company := _amo_data_in->(0)->>'delivery_company';
      select tracking_url into _tracking_url from deliver where name = _delivery_company;

      _ret := _amo_data_out_lead::jsonb
               || jsonb_build_object('track_num', _amo_data_in->(0)->>'track_num')
               || jsonb_build_object('delivery_company', _delivery_company)
               || jsonb_build_object('docs_send_date', _amo_data_in->(0)->>'docs_send_date')
               || jsonb_build_object('tracking_url', _tracking_url)
        ;
  else
      _ret := _amo_data_out_lead;
  end if;

  return _ret::json;
end;
$$ language plpgsql;


---------------------------------------------------------------------------------
-- Получить справочник АМО данных
-- select getAmoDataDict();
---------------------------------------------------------------------------------
create or replace function carl_amo.getAmoDataDict()
	returns json security definer as $$
      select json_agg(row_to_json(r)) from (
        select * from carl_amo.amo_data_dict
          where not deleted
          order by id_amo_data_dict, is_status
				) r
$$ language sql;


---------------------------------------------------------------------------------
-- Получить справочник АМО данных
-- select getAmoDataDict();
---------------------------------------------------------------------------------
create or replace function carl_amo.getAmoDataDict__()
	returns json security definer as $$
      select json_agg(row_to_json(r)) from (
        select * from carl_amo.amo_data_dict
          where not deleted
          order by id_amo_data_dict, is_status
				) r
$$ language sql;


drop function if exists carl_amo.getAmoPersCardLead(p_id_profile int);

---------------------------------------------------------------------------------
-- Получить АМО данные для личного кабинета для лидера
-- select getAmoPersCardLead(1636);
---------------------------------------------------------------------------------
create or replace function carl_amo.getAmoPersCardLead(p_id_profile int, p_id_broker int default null)
	returns json security definer as $$
declare
  -- _is_company int;
  _j json;
begin
/*
  _is_company := case when _is_company(p_id_profile) then 0 else -1 end;
  select json_agg(row_to_json(r)) into _j from (
    select a.amo_status_lead
      , count(*) as cnt
      , sum(carl_auct.getAuctCommission(p_id_profile, _is_company, a.id_auction)) as commision
      , sum(summa_lead) as summ
      from v_auct_full_with_lead a
      where id_profile_leader = p_id_profile
        and amo_status_lead is not null
        and amo_status_lead not in ('success','failed')
      group by amo_status_lead, id_profile_leader
    ) r;
*/
  if(p_id_broker is null) then
    select json_agg(row_to_json(r)) into _j from (
--       select a.amo_status_lead
--         , count(*) as cnt
--         , sum(carl_auct.getAuctCommissionByIdAuct(a.id_auction)) as commision
--         , sum(summa_lead) as summ
--         from v_auct_full_with_lead a
--         where id_profile_leader = p_id_profile
--           and amo_status_lead is not null
--           and amo_status_lead not in ('success','failed')
--         group by amo_status_lead, id_profile_leader
    select amo_status_lead -- up.id_profile
       , count(*) as cnt
       , sum(cnt_due_date_car) as cnt_due_car
       , sum(cnt_due_date_commission_buyer) as cnt_due_commission
       , sum(summa_lead * cnt_due_date_car) as summ
       , sum(commision * cnt_due_date_commission_buyer) as commision
    from (
        select id_auction
            , amo_status_lead
            ,
            case when amo_status_lead = 'payment_from_buyer'
                then
                          -- ДОДЕЛКА 2 
                    case when due_date_car = '"Счет за авто оплачен"' or due_date_car is null then 0 else 1 end
                else 0
              end as cnt_due_date_car
            ,
            case when amo_status_lead = 'payment_from_buyer'
                then
                    case when due_date_commission_buyer = '"Счет за КВ оплачен"' or due_date_commission_buyer is null  then 0 else 1 end
                else 0
              end as cnt_due_date_commission_buyer
            , summa_lead
            , commision
            from (
            select va.id_auction
                    , amo_data_out_lead -> 'statuses' -> -1 ->> 'id' as amo_status_lead
                    , (select jsonb_path_query(amo_data_out_lead::jsonb, '$.data[*].due_date_car')::text) as due_date_car
                    , (select jsonb_path_query(amo_data_out_lead::jsonb,
                                       '$.data[*].due_date_commission_buyer')::text) as due_date_commission_buyer
                    , va.summa_lead  summa_lead
                    , carl_auct.getAuctCommissionByIdAuct(va.id_auction) as commision
                    -- , amo_data_out_lead
            from v_auct_full_with_lead va, carl_amo.auct_amo_data amd
                where 2 = 2
                    and va.id_auction = amd.id_auction
                      -- ВОТКНУТЬ not hidden not archive
                    and id_profile_leader = p_id_profile
                    and amo_status_lead is not null
                    and amo_status_lead not in ('success','failed')
        ) s2
    ) s1, auction_bid ab, user_profile up
    where s1.id_auction = ab.id_auction
            and ab.bid_status = 'LEAD'
            and ab.id_user_profile = up.id_user_profile
            -- and  due_date_commission_buyer = '"08.06.2022"'
    group by amo_status_lead, up.id_profile
      ) r;
  else
      select json_agg(row_to_json(r)) into _j from (
        select amo_status_lead_bro as amo_status_lead -- up.id_profile
           , count(*) as cnt
           , sum(cnt_due_date_car) as cnt_due_car
           , sum(cnt_due_date_commission_buyer) as cnt_due_commission
           , sum(summa_lead * cnt_due_date_car) as summ
           , sum(commision * cnt_due_date_commission_buyer) as commision
        from (
            select id_auction
                , amo_status_lead_bro
                ,
                case when amo_status_lead_bro = 'payment_from_buyer'
                    then
                        case when due_date_car = '"Счет за авто оплачен"' or due_date_car is null then 0 else 1 end
                    else 0
                  end as cnt_due_date_car
                ,
                case when amo_status_lead_bro = 'payment_from_buyer'
                    then
                        case when due_date_commission_buyer = '"Счет за КВ оплачен"' or due_date_commission_buyer is null  then 0 else 1 end
                    else 0
                  end as cnt_due_date_commission_buyer
                , summa_lead
                , commision
                from (
                select va.id_auction
                        , amo_data_out_lead -> 'statuses' -> -1 ->> 'id' as amo_status_lead_bro
                        , (select jsonb_path_query(amo_data_out_lead::jsonb, '$.data[*].due_date_car')::text) as due_date_car
                        , (select jsonb_path_query(amo_data_out_lead::jsonb,
                                           '$.data[*].due_date_commission_buyer')::text) as due_date_commission_buyer
                        , va.summa_lead  summa_lead
                        , carl_auct.getAuctCommissionByIdAuct(va.id_auction) as commision
                        -- , amo_data_out_lead
                from v_auct_full_with_lead va, carl_amo.auct_amo_data amd
                    where 2 = 2
                        and va.id_auction = amd.id_auction
                        and id_profile_leader = p_id_profile
                        and amd.id_broker = p_id_broker
                        -- and amo_status_lead is not null
                        -- and amo_status_lead not in ('success','failed')
                        and amo_status_lead_bro is not null
                        and amo_status_lead_bro not in ('success','failed')
            ) s2
        ) s1, auction_bid ab, user_profile up
        where s1.id_auction = ab.id_auction
                and ab.bid_status = 'LEAD'
                and ab.id_user_profile = up.id_user_profile
                -- and  due_date_commission_buyer = '"08.06.2022"'
        group by amo_status_lead_bro, up.id_profile
        ) r;
  end if;

  return _j;
end;
$$ language plpgsql;


---------------------------------------------------------------------------------
-- Получить АМО данные для личного кабинета для продавца
-- select getAmoPersCardSell(1);
---------------------------------------------------------------------------------
create or replace function carl_amo.getAmoPersCardSell(p_id_profile int)
	returns json security definer as $$
declare
  _is_company int;
  _j json;
begin
  _is_company := case when _is_company(p_id_profile) then 0 else -1 end;
  select json_agg(row_to_json(r)) into _j from (
    select va.amo_status_sell
      , count(*) as cnt
      -- , sum(carl_auct.getAuctCommission(p_id_profile, _is_company, va.id_auction)) as commision
      , sum(carl_auct.getSellCommission(va.id_auction)) as commision
      , sum(summa_lead) as summ
      from v_auct_full va
      where id_profile_seller = p_id_profile
        and not va.hidden
        and not va.is_archive
        and va.amo_status_sell is not null
        and va.amo_status_sell not in ('success','failed')
      group by amo_status_sell, id_profile_seller
    ) r;
  return _j;
end;
$$ language plpgsql;


---------------------------------------------------------------------------------
-- Получить status АМО для аукциона p_id_auction
-- select carl_amo.getAmoStatusLast(30328);
---------------------------------------------------------------------------------
create or replace function carl_amo.getAmoStatusLast(p_id_auction int)
	returns varchar security definer as $$
declare
    _ret varchar;
    _status jsonb;
    _len  int;
    _jb  jsonb;
  begin

    select amo_data_in into _jb from carl_amo.auct_amo_data where id_auction = p_id_auction;

    if(_jb is not null) then
      _status := (_jb->(0))#>>'{status}';
      _len := jsonb_array_length(_status);
      _ret := _status->(_len-1)->>'id';
      raise notice '~~~ _ret % _len %', _ret, _len;
    end if;

    return _ret;
end;
$$ language plpgsql;


---------------------------------------------------------------------------------
-- Получить список доставщиков
-- select carl_amo.getDeliverList();
---------------------------------------------------------------------------------
create or replace function carl_amo.getDeliverList()
    returns setof json security definer as $$
        select row_to_json(r) from (
            select * from deliver where not deleted order by name
        ) r;
$$ language sql;


---------------------------------------------------------------------------------
-- Получить счетчики аукционов продавца по АМО-статусам
-- select carl_auct.getSellerAmoStatCounts(1124);
---------------------------------------------------------------------------------
create or replace function carl_auct.getSellerAmoStatCounts(p_id_profile_sel int
    , p_dt_from int default null, p_dt_to int default null, p_dt_now int default null)
    returns json security definer as $$
SELECT jsonb_object_agg(amo_data_key, cnt) AS result
FROM (
    WITH adk AS (
        SELECT amo_data_key
        FROM carl_amo.amo_data_dict
        WHERE NOT deleted
                AND is_status
                AND seller
            and amo_data_key in ('documents_preparation', 'payment_to_seller', 'documents_buyer'
            , 'documents_seller', 'issue_ready', 'documents_issued_to_buyer', 'payment_from_buyer')
    )
    SELECT adk.amo_data_key,
        COALESCE(ss.cnt, 0) AS cnt
    FROM adk
             LEFT JOIN (
        SELECT a.amo_status_sell,
            count(*) AS cnt
        FROM auction a
                 JOIN user_profile up ON up.id_user_profile = a.id_user_profile
                 JOIN profile p ON p.id_profile = up.id_profile
        WHERE 2 = 2
                AND p.id_profile = p_id_profile_sel
                and  ((p_dt_from is null and p_dt_to is null) or
                        carl_auct._dt_end_in_interval(
                            extract (epoch from a.dt_end)::int
                            , p_dt_from, p_dt_to, p_dt_now)
                     )
            -- лоты продавца
            and a.is_deleted = 'N'
            and not a.is_archive
            and not a.hidden
            and a.id_user_profile in (
                select id_user_profile from user_profile where id_profile = p_id_profile_sel)
        GROUP BY a.amo_status_sell
    ) ss ON ss.amo_status_sell = adk.amo_data_key
) t;
$$ language sql;


---------------------------------------------------------------------------------
-- Получить счетчики аукционов пркупателя по АМО-статусам
-- select carl_auct.getLeaderAmoStatCounts(20481);
-- select * from profile where id_profile = 20481;
---------------------------------------------------------------------------------
create or replace function carl_auct.getLeaderAmoStatCounts(p_id_profile_lead int
    , p_dt_from int default null, p_dt_to int default null, p_dt_now int default null)
    returns json security definer as $$
SELECT jsonb_object_agg(amo_data_key, cnt) AS result
FROM (
    WITH adk AS (
        SELECT amo_data_key
        FROM carl_amo.amo_data_dict
        WHERE NOT deleted
                AND is_status
                AND leader
                and amo_data_key in ('documents_preparation', 'documents_buyer', 'documents_seller'
            , 'issue_ready', 'waiting_penalty_payment', 'documents_issued_to_buyer', 'payment_from_buyer')
    )
    SELECT adk.amo_data_key,
        COALESCE(ss.cnt, 0) AS cnt
    FROM adk
             LEFT JOIN (
        SELECT a.amo_status_lead,
            count(*) AS cnt
        FROM auction a
                 -- JOIN user_profile up ON up.id_user_profile = a.id_user_profile
                 -- JOIN profile p ON p.id_profile = up.id_profile
        WHERE 2 = 2
                -- AND p.id_profile = p_id_profile_lead
                and  ((p_dt_from is null and p_dt_to is null) or
                      carl_auct._dt_end_in_interval(
                              extract (epoch from a.dt_end)::int
                          , p_dt_from, p_dt_to, p_dt_now)
                )
                -- аналог lead_only в ГФ
                and a.is_deleted = 'N'
                and a.id_auction
                    in (select id_auction from auction_bid ab
                        where ab.bid_status = 'LEAD'
                                and ab.id_user_profile in
                                    (select id_user_profile from user_profile where id_profile = p_id_profile_lead )
                                and is_deleted = 'N')
        GROUP BY a.amo_status_lead
    ) ss ON ss.amo_status_lead = adk.amo_data_key
) t;
$$ language sql;



drop function if exists carl_comm.getWinLotsAMODataJ(p_start_time bigint, p_end_time bigint);
drop function if exists carl_comm.getWinLotsAMODataJ(p_start_time bigint
    , p_end_time bigint
    , p_id_broker_buy int);

----------------------------------------------------------------------------------
-- Информация по выигранным лотам + Информация по доставке для AMOCRM
-- AMO_Б Если указан p_id_broker_buy то берутся только брокерские покупки
-- и выводим только покупки физов брокера и показываем как физа
-- комиссия 31000
-- АМО-К p_id_broker_buy Null то физов брокера показываем как брокера
-- комиссия для подброкерных лотов по профилю брокера 23500
--
-- если домен втб, то не надо никого подменять брокером
--
--    [{
--         "vin": VIN,
--          "dt_end": Дата завершения аукциона,
--         "mark": Марка,
--         "model": Модель,
--         "price": Стоимость авто в рублях,
--         "reg_num": Гос. Номер,
--         "location": Город погрузки – город нахождения авто или пусто,
--         "body_type": Тип кузова,
--         "commission": Комиссия продавца + комиссия покупателя. Считаем комиссия покупателя = комиссии с лота, комиссию продавца принимаем за 0. Получаем сумму сделки = комиссия на лоте,
--         "buyer_name": ФИО продавца,
--         "id_auction": ИД аукциона,
--         "seller_name": ФИО продавца,
--         "id_user_buyer": ИД пользователя покупателя,
--         "id_user_seller": ИД пользователя продавца,
--         "commission_seller": Комиссия продавца в рублях,
--         "id_profile_buyer": ИД профиля покупателя,
--         "id_profile_seller": ИД профиля продавца,
--         "total": Не на ходу,
--         "auction_type": Тип торгов – Carlink/Carlink24: физик - карлинк24, остальные - карлинк,
--         "delivery": Доставка (да/нет) - пусто,
--         "delivery_cost": Стоимость доставки в рублях – пусто,
--         "unloading_city": Город разгрузки – город доставки: если юрик, берем его город, для физа - пусто.
--         "dt_accept": "Дата подтверждения сделки",
--         "address_residence": "Адрес регистрации (прописка)",
--         "is_fisical": "Физическое лицо? (yes/no)",
--         "id_object": "ИД объекта",
--         "keys": "Количество ключей",
--         "pts": "Наличие оригинала ПТС (yes/no)"
--    }]
-- Пример:
-- -- брокером 31000 АМО-Б
-- select f1 from getWinLotsAMODataJ(null, null, 1) f1;
-- -- поброкером 23500 AMO-K
-- select f1 from getWinLotsAMODataJ(null, null, null) f1;
--
--  -- промокодчик 10000 AMO-K
-- select f1 from getWinLotsAMODataJ(null, null, null) f1;
-- select f1 from getWinLotsAMODataJ(null, null, 1) f1;
--
--  -- юрик 20000 AMO-K
-- select f1 from getWinLotsAMODataJ(null, null, null) f1;
-- select f1 from getWinLotsAMODataJ(null, null, null, 159820) f1;
-- select f1->(0)->'id_profile_buyer' from getWinLotsAMODataJ(null, null, null, 159820) f1;
-- select f1 from getWinLotsAMODataJ(null, null, null, 195002) f1;
-- select * from auction where carl_auct.getAuctObjAttrib(id_auction,'expert_cert') is not null;
----------------------------------------------------------------------------------
create or replace function carl_comm.getWinLotsAMODataJ(p_start_time bigint default null
    , p_end_time bigint default null
    , p_id_broker_buy int default null
    , p_id_auction int default null )
    returns json
    security definer
as $F$
declare
    _j_out json;
    _start_date timestamp;
    _end_date timestamp;
begin
    _start_date := to_timestamp(p_start_time);
    _end_date := to_timestamp(p_end_time);

    select  array_to_json(array_agg(row_to_json(t)))  INTO _j_out from
        (
            select  auct.id_auction                                                                        as id_auction,
                coalesce(to_char((auct.dt_end at time zone 'msk'), 'YYYY-MM-DD"T"HH24:MI:SS'), '')     as dt_end,
                coalesce((attr.values :: jsonb #>> '{characteristics,mark}'), '')                      as mark,
                coalesce((attr.values :: jsonb #>> '{characteristics,model}'), '')                     as model,
                coalesce((attr.values :: jsonb #>> '{properties,VIN}'), '')                            as VIN,
                coalesce((attr.values :: jsonb #>> '{properties,reg_num}'), '')                        as reg_num,
                coalesce((attr.values :: jsonb #>> '{characteristics,body_type}'), '')                 as body_type,
                case when (attr.values :: jsonb #>> '{properties,location}') is not null and
                          (attr.values :: jsonb #>> '{properties,location}') <> ''
                         then (attr.values :: jsonb #>> '{properties,location}')
                     else coalesce(city.name, '')
                    end                     as location,
                case when attr.values#>>'{properties,pickup_location}' is null
                    and draft.draft_face#>>'{auction,pickup_location}' is null
                         then null else
                         case when attr.values#>>'{properties,pickup_location}' is not null then attr.values#>>'{properties,pickup_location}' else draft.draft_face#>>'{auction,pickup_location}' end
                    end  as pickup_location, -- место осмотра
                coalesce(trim(carl_prof.getProfSmartName2(ps.id_profile)), '')                         as seller_name,
                ps.id_profile                                                                          as id_profile_seller,
                us.id_user                                                                             as id_user_seller,
                coalesce(trim(carl_prof.getProfSmartName2(
                        case when p_id_broker_buy is null and p_bro.id_profile is not null
                                 then  p_bro.id_profile else  p_buy.id_profile end
                    )), '')                                                                     as buyer_name,
                case when p_id_broker_buy is null and p_bro.id_profile is not null
                         then  p_bro.id_profile else  p_buy.id_profile end                      as id_profile_buyer,

                case when p_id_broker_buy is null and p_bro.id_user_owner is not null
                         then  p_bro.id_user_owner else u_buy.id_user end                       as  id_user_buyer,
                up_buy.id_user                                                                         as iub,
                up_buy.id_profile                                                                      as ipb,
                bid.bid_value                                                                          as price,
                case when p_id_broker_buy is not null then
                         -- АМО Б
                         -- физ платит брокеру
                         case when p_bro.id_profile is not null then
                                  auct.applied_commission
                              else
                                  null
                             end
                     else
                         -- АМО К
                         case when p_bro.id_profile is not null then
                                  -- подброкерский, брокер платит карлинку
                                  -- TODO: Переделать (убрать кусок после else когда закончатся старые тарифы)
                                  case when (carl_auct.getAuctCommissionTariffJ(auct.id_auction, _get_auct_leader(auct.id_auction))
                                      #>>'{broker}') is not null then (carl_auct.getAuctCommissionTariffJ(auct.id_auction, _get_auct_leader(auct.id_auction))
                                      #>>'{broker,current_commission}')::int
                                       else
                                           -- coalesce(carl_auct.getAuctCommission(ps.id_profile, pb.id_profile, auct.id_auction), 0)
                                           coalesce(carl_auct.getAuctCommission(ps.id_profile
                                                        , case when p_bro.id_profile is null then p_buy.id_profile else p_bro.id_profile end , auct.id_auction), 0)
                                      end
                              else
                                  -- не подброкерский юрик платит карлинку
--                   (carl_auct.getAuctCommissionTariffJ(auct.id_auction, _get_auct_leader(auct.id_auction))
--                        #>>'{buyer,current_commission}')::int
                                  auct.applied_commission
                             end
                    end
                    as commission,
                case when p_id_broker_buy is null then
                         -- АМО-К
                         null
                     else
                         -- АМО-Б
                         -- carl_auct.getAuctCommissionTariffJ(auct.id_auction, p_bro.id_profile)#>>'{current_commission}'
                             carl_auct.getAuctCommissionTariffJ(auct.id_auction, _get_auct_leader(auct.id_auction))
                             #>>'{broker,current_commission}'
                    end                                                                                    as commission_cl,
                ''                                                                                     as commission_seller,
                case when (attr.values::jsonb#>>'{properties,total}') = 'Y' then true else false end   as total,
                -- case when pb.id_individual is not null then 'Carlink24' else 'Carlink' end               as auction_type,
                ''                                                                                     as delivery,
                ''                                                                                     as delivery_cost,
                case when p_buy.id_company is not null then coalesce(buyer_city.name, '') else '' end  as unloading_city,
                coalesce(to_char((log.dt_set at time zone 'msk'), 'YYYY-MM-DD"T"HH24:MI:SS'), '')      as dt_accept,
                case when p_buy.id_company is not null then ''
                     else
                         coalesce(
                                 coalesce(bindiv.address_residence, p_buy.address), ''
                             )
                    end                                                                                    as address_residence,
                case when p_buy.id_individual is not null then 'yes' else 'no' end                     as is_fisical,
                auct.id_object                                                                         as id_object,
                case when (draft.draft_face #>> '{car,properties,keys}') is not null
                    and (draft.draft_face #>> '{car,properties,keys}') <> ''
                    and (draft.draft_face #>> '{car,properties,keys}') <> 'Нет'
                         then (draft.draft_face #>> '{car,properties,keys}')::int
                     else 0
                    end                                                                                    as keys,

                case when ((draft.draft_face #>> '{car,properties,original_docs}') in  ('Y','P')) or
                          (((draft.inspect_report #>> '{docs, pts_data, ptsCopy}') = 'false' or
                            (draft.inspect_report #>> '{docs, pts_data, ptsCopy}') = '' or
                            (draft.inspect_report #>> '{docs, pts_data, ptsCopy}') is null) and
                           (draft.inspect_report #>> '{docs, pts_data, notAvailable}') = 'false')
                         then 'yes'
                     else case when ((draft.draft_face #>> '{car,properties,original_docs}') = 'E') then
                                   'e'
                               else
                                   'no'
                         end
                    end                                                                                    as pts_old,

                carl_comm._getPts(auct.id_auction
                    , obj.id_object_type
                    , (draft.inspect_report#>'{docs, pts_data}')::json
                    , (draft.draft_face#>'{docs, pts_data}')::json
                    , (draft.draft_face #>> '{car,properties,original_docs}')::varchar)  as pts,

                carl_auct._getAuctLeaderReserv(auct.id_auction)                    as reserv,
                carl_auct.getAuctObjAttrib(auct.id_auction,'vat')       as vat_included,
                -- в профиле продавца
                carl_prof.getProfIndivDkpType(ps.id_profile)                         as indiv_dkptype, -- используется для whiteLabel (ЛизПлан)
                carl_prof.getProfDkpType(ps.id_profile)                              as dkptype,
                carl_prof.getProfDkpTypeFL(ps.id_profile)                            as dkptype_fl,
                p_buy.id_broker
                , carl_auct.getAuctParameter(auct.id_auction,'{ext_data}')::json as ext_data
                , carl_auct.getAuctObjAttrib(auct.id_auction,'expert_cert') as expert_cert
                , carl_prof.getProfOwnershipType(p_buy.id_profile) as ownership_type
            from carl_data.auction auct
                     left join carl_data.car_draft draft on auct.id_auction = draft.id_auction
                /*seller*/
                     left join carl_data.user_profile ups on auct.id_user_profile = ups.id_user_profile
                     left join carl_data.users us on ups.id_user = us.id_user
                     left join carl_data.profile ps on ups.id_profile = ps.id_profile
                /*buyer*/
                     left join carl_data.object obj on auct.id_object = obj.id_object
                     left join carl_data.obj_attrib_values attr on obj.id_object = attr.id_object
                     left join carl_data.auction_bid bid on auct.id_auction = bid.id_auction and
                                                            bid.bid_status = 'LEAD' :: en_bid_status and
                                                            bid.is_deleted = 'N'
                     left join carl_data.user_profile up_buy on bid.id_user_profile = up_buy.id_user_profile
                     left join carl_data.users u_buy on u_buy.id_user = up_buy.id_user
                --> если домен втб, то не надо никого подменять брокером
                -- inner join carl_data.profile p_buy on p_buy.id_profile = up_buy.id_profile
                --                                  and ((p_id_broker_buy is null and p_buy.id_broker is null)
                --                                       or (p_id_broker_buy is null or p_buy.id_broker = p_id_broker_buy))
                -- получаем брокера вместо физа
                -- left join profile p_bro on p_bro.id_profile = (select id_profile_owner from broker br where br.id_broker = p_buy.id_broker)

                     inner join carl_data.profile p_buy on p_buy.id_profile = up_buy.id_profile
                        and ((p_id_broker_buy is null and p_buy.id_broker is null)
                            or (p_id_broker_buy is null
                                or (p_buy.id_broker = p_id_broker_buy and u_buy.reg_domain <> 'vtb_leasing')))
                -- получаем брокера вместо физа
                     left join profile p_bro on p_bro.id_profile =
                                                (select id_profile_owner from broker br where br.id_broker = p_buy.id_broker
                                                        and br.id_broker not in (2,3) ) -- выпиливаем vtb_leasing
                     left join carl_data.individual bindiv on p_buy.id_individual = bindiv.id_individual and
                                                              bindiv.is_deleted = 'N'
                     left join carl_data.auct_commission comm on comm.id_auction = auct.id_auction
                     left join carl_data.auct_commission commsel on commsel.id_profile_sel = ps.id_profile
                /**/
                     left join carl_data.city buyer_city on p_buy.id_city = buyer_city.id_city
                -- left join carl_data.city city on city.id_city = (attr.values :: jsonb #>> '{properties,id_location}')::int
                     left join carl_data.city city on
                    city.id_city = coalesce((attr.values :: jsonb #>> '{properties,id_location,id}')::int,
                                            (attr.values :: jsonb #>> '{properties,id_location}')::int)
                     left join (
                            select max(log1.dt_set) as dt_set, log1.id_auction
                            from carl_data.auction_log log1
                            where log1.event_type in ('SUCCESS', 'ACCEPT_OFFER', 'BUYNOW') and
                                    log1.is_deleted = 'N'
                            group by log1.id_auction
                    ) log on log.id_auction = auct.id_auction
            where auct.is_deleted = 'N'
--                 -- если ЛП то берем только в статусе READY и DONE
--                 auct.status in ('SUCCESS', 'BUYNOW')
--                     and (extract(epoch from log.dt_set)::bigint >= p_start_time or p_start_time is null)
--                     and (extract(epoch from log.dt_set)::bigint <= p_end_time or p_end_time is null)
--                     and (p_id_auction is null or auct.id_auction = p_id_auction)

                    -- если ЛП то берем только в статусе READY и DONE
                    and ((auct.id_workflow <> 'LP_AUCTION'  or u_buy.reg_domain <> 'carbargy') -- покупан не ЛП)
                            or (auct.id_workflow = 'LP_AUCTION'
                                    and auct.workflow_status in ('READY', 'DONE')))

                    and auct.status in ('SUCCESS', 'BUYNOW')
--                     and (extract(epoch from log.dt_set)::bigint >= p_start_time or p_start_time is null)
                    and (
                            ((extract (epoch from log.dt_set)::bigint >= p_start_time or p_start_time is null)
                        and (extract (epoch from log.dt_set)::bigint <= p_end_time or p_end_time is null
                        ))
--                     or auct.id_auction in (
--                                  145815
--                                 ,167337
-- )
                    )

                    and (p_id_auction is null or auct.id_auction = p_id_auction)
                -- and auct.id_auction in (145327)

            order by log.dt_set
        ) t;

    return _j_out;

end;
$F$ language plpgsql;


/* -- все bericar машины
select id_auction, status, workflow_status, dt_change_status
from auction a
where _get_auct_id_prof(a.id_auction) = 17
        and workflow_status in ('DONE','READY')
        and id_auction not in (
                               155898,
                               145323
    )
order by id_auction desc;
*/



drop function if exists carl_comm.getUsersProfilesAMODataJ();

----------------------------------------------------------------------------------
-- Список пользователей и профилей
-- если домен втб, то не надо никого подменять брокером
--
-- {
--   "cluser_id": "1",
--   "cluser_firstname": "firstname",
--   "cluser_middlename": "middlename",
--   "cluser_lastname": "lastname",
--   "cluser_phone": "phone",
--   "cluser_email": "email",
--   "cluser_status": "admin/confirmed/confirmed_single/unknown",
--   "cluser_dttcreated": "timestamp",
--   "cluser_lastlogin": "timestamp",
--   "cluser_hasprofiles": "no/yes",
--   "cluser_registration_host": "Хост регистрации",
--    "cluser_refferal_url": "Источник рекламы",
--    "phone_confirmed": "Телефон подтвержден yes/no",
--   "profiles": [
--     {
--       "clprofile_id": "1",
--       "clprofile_type": "company/individual",
--       "clprofile_wantedrole": "buyer/seller/both",
--       "clprofile_role": "buyer/seller/both",
--       "clprofile_name": "name",
--       "clprofile_firstname": "firstname",
--       "clprofile_middlename": "middlename",
--       "clprofile_lastname": "lastname",
--       "clprofile_position": "position",
--       "clprofile_phone": "phone",
--       "clprofile_email": "email",
--       "clprofile_address": "address",
--       "clprofile_status": "draft/signed/ok",
--       "clprofile_datecreated": "timestamp",
--       "clprofile_datesigned": "timestamp",
--       "clprofile_depositrequired": "no/yes",
--       "clprofile_depositbalance": "balance",
--       "clprofile_numberofbids": "1",
--       "clprofile_numberofbuys": "1",
--       "clprofile_numberofsells": "0",
--       "clprofile_sells": "yes/no (есть ли active лоты в данный момент)",
--       "clprofile_lots": "1",
--       "clprofile_city": "Город",
--        "clprofile_inn": "ИНН",
--        "clprofile_passport_series": "Паспорт серия",
--        "clprofile_passport_num": "Паспорт номер",
--        "clprofile_lock": {
--             "clprofile_locked": "Заблокирован ли профиль yes/no",
--             "clprofile_comment": "Комментарий блокировки",
--             "clprofile_dt_lock": "Дата блокировки",
--             "clprofile_dt_unlock": "Дата разблокировки"
--        }
--     }
--   ]
-- }
--
-- Пример:
--   SELECT jsonb_pretty( carl_comm.getUsersProfilesAMODataJ()::jsonb );
--   psql -U carl carlinkng -c "\copy (SELECT carl_comm.getUsersProfilesAMODataJ()) TO STDOUT " | sed 's/\\"/\"/g' > ~/amocarlink.json
-- select  carl_comm.getUsersProfilesAMODataJ();
-- select  carl_comm.getUsersProfilesAMODataJ_NEW();
----------------------------------------------------------------------------------
create or replace function carl_comm.getUsersProfilesAMODataJ(p_id_broker int default null)
    returns json security definer as $$
declare
    _j_out json;
begin
    -- return  carl_comm.getUsersProfilesAMODataJ_OLD(p_id_broker);
    return  carl_comm.getUsersProfilesAMODataJ_NEW(p_id_broker);
end;
$$ language plpgsql;


drop function if exists carl_comm.getUsersProfilesAMODataJ_NEW(p_id_broker int);
drop function if exists carl_comm.getUsersProfilesAMODataJ_NEW_2(p_id_broker int, p_offset int, p_limit int);

-- select carl_comm.getUsersProfilesAMODataJ_NEW(null)
-- select carl_comm.getUsersProfilesAMODataJ();
-- select position('contract' in carl_comm.getUsersProfilesAMODataJ_NEW(null,5000,100)::text);
-- select carl_comm.getUsersProfilesAMODataJ_NEW(null,5000,1)->(0)->'profiles'->(0)->'contract';
-- select carl_comm.getUsersProfilesAMODataJ_NEW_2(null,5000,100);
-- select carl_comm.getUsersProfilesAMODataJ_NEW_2();
create or replace function carl_comm.getUsersProfilesAMODataJ_NEW(p_id_broker int default null, p_offset int default 0,
                                                                  p_limit     int default 100000)
    returns json
    security definer as
$$
declare
    _j_out json;
begin
    select array_to_json(array_agg(row_to_json(t)))
    into _j_out
    from (select s1.*
          from (


          select (u.id_user) :: varchar as cluser_id,
                    coalesce(u.first_name, '') as cluser_firstname,
                    coalesce(u.middle_name, '') as cluser_middlename,
                    coalesce(u.last_name, '') as cluser_lastname,
                    coalesce(u.phone, '') as cluser_phone,
                    coalesce(u.email, '') as cluser_email,
                    coalesce(lower(u.status :: text), '') as cluser_status,
                    coalesce(to_char(u.dt_created, 'YYYY-MM-DD"T"HH24:MI:SS'), '') as cluser_dttcreated,
                    coalesce(to_char(u.dt_last_login, 'YYYY-MM-DD"T"HH24:MI:SS'), '') as cluser_lastlogin,
                    coalesce(ui.registration_host, '') as cluser_registration_host,
                    case when u.status in
                              ('CONFIRMED_SINGLE', 'CONFIRMED', 'ADMIN', 'MANAGER') and
                              u.phone is not null
                             then 'yes'
                         else 'no'
                        end as phone_confirmed,
                    case when ui.refferal_url <> 'Empty' and ui.refferal_url <> '[Empty]' and
                              ui.refferal_url is not null
                             then ui.refferal_url
                         else ''
                        end as cluser_refferal_url,
                    case when count(prof.*) > 0
                             then 'yes'
                         else 'no'
                        end as cluser_hasprofiles,
                    case when count(prof.*) = 0
                             then array [] :: json[]
                         else
                             array_agg(json_build_object(
                                     'clprofile_id', prof.clprofile_id,
                                     'clprofile_type', prof.clprofile_type,
                                     'clprofile_wantedrole', prof.clprofile_wantedrole,
                                     'clprofile_role', prof.clprofile_role,
                                     'clprofile_name', prof.clprofile_name,
                                     'clprofile_firstname', prof.clprofile_firstname,
                                     'clprofile_middlename', prof.clprofile_middlename,
                                     'clprofile_lastname', prof.clprofile_lastname,
                                     'clprofile_position', prof.clprofile_position,
                                     'clprofile_phone', prof.clprofile_phone,
                                     'clprofile_email', prof.clprofile_email,
                                     'clprofile_address', prof.clprofile_address,
                                     'clprofile_address_short', prof.clprofile_address_short,
                                     'clprofile_status', prof.clprofile_status,
                                     'clprofile_datecreated', prof.clprofile_datecreated,
                                     'clprofile_datesigned', prof.clprofile_datesigned,
                                     'clprofile_depositrequired',
                                     prof.clprofile_depositrequired,
                                     'clprofile_depositbalance',
                                     prof.clprofile_depositbalance,
                                     'clprofile_numberofbids', prof.clprofile_numberofbids,
                                     'clprofile_numberofbuys', prof.clprofile_numberofbuys,
                                     'clprofile_numberofsells', prof.clprofile_numberofsells,
                                     'clprofile_sells', prof.clprofile_sells,
                                     'clprofile_lots', prof.clprofile_lots,
                                     'clprofile_id_owner', prof.clprofile_id_user_owner,
                                     'clprofile_city', prof.clprofile_city,
                                     'clprofile_id_city', prof.clprofile_id_city,
                                     'clprofile_inn', prof.clprofile_inn,
                                     'clprofile_passport_series',
                                     prof.clprofile_passport_series,
                                     'clprofile_passport_num', prof.clprofile_passport_num,
                                     'clprofile_passport_issued_by',
                                     prof.clprofile_passport_issued_by,
                                     'clprofile_passport_issue_date',
                                     prof.clprofile_passport_issue_date,
                                     'clprofile_lock', jsonb_build_object(
                                             'clprofile_locked', case when
                                                                          prof.clprofile_parameters #>> '{lock,locked}' is not null and
                                                                          prof.clprofile_parameters #>>
                                                                          '{lock,locked}' =
                                                                          'true'
                                                                          then 'yes'
                                                                      else 'no' end,
                                             'clprofile_comment',
                                             coalesce(prof.clprofile_parameters #>> '{lock,comment}', ''),
                                             'clprofile_dt_lock', case when
                                                                           trim(prof.clprofile_parameters #>> '{lock,dt_lock}') is not null and
                                                                           trim(prof.clprofile_parameters #>> '{lock,dt_lock}') <>
                                                                           ''
                                                                           then to_char(
                                                         to_timestamp((prof.clprofile_parameters #>> '{lock,dt_lock}')::double precision) at time zone
                                                         'msk', 'YYYY-MM-DD"T"HH24:MI:SS')
                                                                       else '' end,
                                             'clprofile_dt_unlock', case when
                                                                             trim(prof.clprofile_parameters #>> '{lock,dt_unlock}') is not null and
                                                                             trim(prof.clprofile_parameters #>> '{lock,dt_unlock}') <>
                                                                             ''
                                                                             then to_char(
                                                         to_timestamp((prof.clprofile_parameters #>> '{lock,dt_unlock}')::double precision) at time zone
                                                         'msk', 'YYYY-MM-DD"T"HH24:MI:SS')
                                                                         else '' end
                                                       ),
                                     'clprofile_survey', prof.clprofile_survey,
                                     'clprofile_prof_categ_sel',
                                     prof.clprofile_prof_categ_sel,
                                     'clprofile_prof_categ_buy',
                                     prof.clprofile_prof_categ_buy,
                                     'id_broker', prof.id_broker,
                                     'clprofile_ogrn', prof.clprofile_ogrn,
                                     'clprofile_account', prof.clprofile_account,
                                     'clprofile_bank_name', prof.clprofile_bank_name,
                                     'clprofile_BIC', prof.clprofile_BIC,
                                     'clprofile_post_index', prof.clprofile_post_index,
                                     'clprofile_country', prof.clprofile_country,
                                     'clprofile_region', prof.clprofile_region,
                                     'clprofile_parameters', prof.clprofile_parameters,
                                     'clprofile_from_amo', case when
                                                                    prof.clprofile_parameters #>> '{from_amo}' is not null and
                                                                    prof.clprofile_parameters #>>
                                                                    '{from_amo}' = 'true'
                                                                    then 'yes'
                                                                else 'no' end,
                                     'vip', prof.is_vip,
                                     'contract', prof.contract::json
                                       ))
                        end as profiles
                        , _get_user_log_domain(u.id_user) as user_log_domain
                        -- , _get_prof_log_domain(prof.clprofile_id::int) as prof_log_domain
                        -- , carl_prof.getProfParameterV(prof.clprofile_id::int, '{employer}') as employer
                        -- , carl_prof.getProfParameterV(prof.clprofile_id::int, '{id_promo}') as id_promo
                        -- , clprofile_id
                from carl_data.users u
                left outer join carl_data.user_info ui on u.id_user = ui.id_user
                inner join --  prof ON prof.id_user = u.id_user
                    (select up.id_user,
                         (p2.id_profile) :: varchar as clprofile_id,
                         (select array_to_json(array_agg(row_to_json(r)))
                          from (select s.id_survey, s.name
                                from survey_profile sp, survey s
                                where not s.deleted and s.id_survey = sp.id_survey and
                                    sp.id_profile = p2.id_profile) r) as clprofile_survey,
                         case when p2.id_company is not null
                                  then 'company'
                              when p2.id_individual is not null
                                  then 'individual'
                              else ''
                             end as clprofile_type,
                         case when
                                  coalesce(cardinality(array_positions(p2.roles, 'buyer')), 0) >
                                  0 and
                                  coalesce(cardinality(array_positions(p2.roles, 'seller')), 0) =
                                  0
                                  then 'buyer'
                              when
                                  coalesce(cardinality(array_positions(p2.roles, 'buyer')), 0) =
                                  0 and
                                  coalesce(cardinality(array_positions(p2.roles, 'seller')), 0) >
                                  0
                                  then 'seller'
                              when
                                  coalesce(cardinality(array_positions(p2.roles, 'buyer')), 0) >
                                  0 and
                                  coalesce(cardinality(array_positions(p2.roles, 'seller')), 0) >
                                  0
                                  then 'both'
                              else ''
                             end as clprofile_role,
                         case
                             when
                                 coalesce(cardinality(array_positions(string_to_array(
                                                                              replace(replace(p2.wanted_roles, '["', ''), '"]', ''),
                                                                              ','),
                                                                      'seller')), 0) > 0 and
                                 coalesce(cardinality(array_positions(string_to_array(
                                                                              replace(replace(p2.wanted_roles, '["', ''), '"]', ''),
                                                                              ','),
                                                                      'buyer')), 0) > 0
                                 then 'both'
                             when
                                 coalesce(cardinality(array_positions(string_to_array(
                                                                              replace(replace(p2.wanted_roles, '["', ''), '"]', ''),
                                                                              ','),
                                                                      'seller')), 0) > 0
                                 then 'seller'
                             when coalesce(cardinality(array_positions(string_to_array(
                                                                               replace(replace(p2.wanted_roles, '["', ''), '"]', ''),
                                                                               ','),
                                                                       'buyer')), 0) > 0
                                 then 'buyer'
                             else ''
                             end as clprofile_wantedrole,
                         coalesce(trim(carl_prof.getProfSmartName2(p2.id_profile)), '') as clprofile_name,
                         coalesce(p2.first_name, '') as clprofile_firstname,
                         coalesce(p2.middle_name, '') as clprofile_middlename,
                         coalesce(p2.last_name, '') as clprofile_lastname,
                         coalesce(p2.position, '') as clprofile_position,
                         coalesce(p2.phone_list, '') as clprofile_phone,
                         coalesce(c2.email, '') as clprofile_email,
                         -- ERV:150721
                         coalesce(c2.ogrn, '') as clprofile_ogrn,
                         coalesce(c2.account, '') as clprofile_account,
                         coalesce(c2.bank_name, '') as clprofile_bank_name,
                         coalesce(c2."BIC", '') as clprofile_BIC,
                         coalesce(p2.post_index, '') as clprofile_post_index,
                         coalesce(carl_dict.getCountryName(p2.id_country), '') as clprofile_country,
                         coalesce(carl_dict.getRegionByCityId(p2.id_city), '') as clprofile_region,
                         coalesce(p2.address, '') as clprofile_address_short,
                         coalesce(
                                 coalesce(country.name, '') ||
                                 case when city.name is not null and city.name <> ''
                                          then ', ' || city.name
                                      else '' end ||
                                 case when p2.address is not null and p2.address <> ''
                                          then ', ' || p2.address
                                      else '' end,
                                 ''
                         ) as clprofile_address,
                         coalesce(city.name, '') as clprofile_city,
                         coalesce(city.id_city::varchar, '') as clprofile_id_city,
                         coalesce(lower(p2.status :: text), '') as clprofile_status,
                         coalesce(to_char(p2.dt_create, 'YYYY-MM-DD"T"HH24:MI:SS'), '') as clprofile_datecreated,
                         coalesce(to_char(p2.dt_signe, 'YYYY-MM-DD"T"HH24:MI:SS'), '') as clprofile_datesigned,
                         case when c2.id_company is not null and upper(c2.ownership_type) = 'ИП'
                                  then 'yes'
                              when c2.id_company is null
                                  then 'yes'
                              when c2.id_company is not null and upper(c2.ownership_type) <> 'ИП'
                                  then 'no'
                              when c2.id_company is not null and c2.ownership_type is null
                                  then 'yes'
                              else ''
                             end as clprofile_depositrequired,
                         (p2.balance_summ) :: varchar as clprofile_depositbalance,
                         coalesce(bid.bids, 0) :: varchar as clprofile_numberofbids,
                         coalesce(al.buy, 0) :: varchar as clprofile_numberofbuys,
                         coalesce(auct.sale, 0) :: varchar as clprofile_numberofsells,
                         case when sell.count_sell > 0 then 'yes' else 'no' end as clprofile_sells,
                         coalesce(all_lots.all_lots_count, 0)::varchar as clprofile_lots,
                         p2.id_user_owner::varchar as clprofile_id_user_owner,
                         p2.parameters as clprofile_parameters,
                         coalesce(c2.inn, '') as clprofile_inn,
                         coalesce(i2.passport_series, '') as clprofile_passport_series,
                         coalesce(i2.passport_num, '') as clprofile_passport_num,
                         coalesce(i2.issued_by, '') as clprofile_passport_issued_by,
                         coalesce(i2.issue_date, '') as clprofile_passport_issue_date,
                         (select name
                          from prof_categ_dict
                          where p2.id_prof_categ_sel = prof_categ_dict.id_prof_categ_dict)
                             as clprofile_prof_categ_sel,
                         (select name
                          from prof_categ_dict
                          where p2.id_prof_categ_buy = prof_categ_dict.id_prof_categ_dict)
                             as clprofile_prof_categ_buy,
                         p2.id_broker :: varchar,
                         p2.is_vip as is_vip,
                        contr.contract as contract
                     from carl_data.profile p2
                     left join carl_data.user_profile up
                        on p2.id_profile = up.id_profile and up.is_deleted = 'N'
                     left join carl_data.profile p
                        on p.id_profile = up.id_profile and p.is_deleted = 'N'
                     left outer join -- bid ON bid.id_profile = p.id_profile
                         (select id_profile,
                              count(*) as bids
                          from carl_data.auction_log
                          where is_deleted = 'N' and
                              (event_type = 'MAKE_BID' :: en_auction_event_type or
                               event_type = 'AUTO_BID' :: en_auction_event_type) and
                              exception is null
                          group by id_profile) bid on bid.id_profile = p.id_profile
                     left outer join -- auct ON auct.id_profile = p.id_profile
                         (select p.id_profile,
                              count(*) as sale
                          from carl_data.auction a,
                              carl_data.user_profile up,
                              carl_data.profile p
                          where a.id_user_profile = up.id_user_profile and
                              up.id_profile = p.id_profile and
                              a.is_deleted = 'N' and
                              up.is_deleted = 'N' and
                              p.is_deleted = 'N' and
                              a.status in
                              ('SUCCESS' :: en_auction_status, 'BUYNOW' :: en_auction_status)
                          group by p.id_profile) auct on auct.id_profile = p.id_profile
                     left outer join -- al ON al.id_profile_buyer = p.id_profile
                         (select id_profile_buyer,
                              count(*) as buy
                          from carl_data.v_auction_lead
                          -- покупанов берем ЛП берем только когда 'READY', 'DONE'
                          where 2 = 2 and
                              (status in ('SUCCESS' :: en_auction_status,
                                          'BUYNOW' :: en_auction_status)
                                  and case when id_workflow = 'LP_AUCTION'
                                               then
                                               workflow_status in ('READY', 'DONE')
                                           else true end)
                          group by id_profile_buyer) al on al.id_profile_buyer = p.id_profile
                     left outer join -- sell ON sell.id_profile = p.id_profile
                        (select p.id_profile as id_profile, count(*) as count_sell
                          from carl_data.auction auct,
                              carl_data.user_profile up,
                              carl_data.profile p
                          where auct.id_user_profile = up.id_user_profile and
                              up.id_profile = p.id_profile and
                              auct.is_deleted = 'N' and
                              up.is_deleted = 'N' and
                              p.is_deleted = 'N' and
                              auct.status = 'ACTIVE' :: en_auction_status
                          group by p.id_profile) sell on sell.id_profile = p.id_profile
                     left outer join -- all_lots ON all_lots.id_profile = p.id_profile
                        (select p.id_profile,
                              count(*) as all_lots_count
                          from carl_data.auction a,
                              carl_data.user_profile up,
                              carl_data.profile p
                          where a.id_user_profile = up.id_user_profile and
                              up.id_profile = p.id_profile and
                              a.is_deleted = 'N' and
                              up.is_deleted = 'N' and
                              p.is_deleted = 'N' and
                              a.status in
                              ('ACTIVE'::en_auction_status, 'FINISHED'::en_auction_status,
                               'SUCCESS' :: en_auction_status, 'FAILED'::en_auction_status,
                               'BUYNOW' :: en_auction_status)
                          group by p.id_profile) all_lots
                        on all_lots.id_profile = p.id_profile
                    left join carl_data.company c2
                        on c2.id_company = p2.id_company and c2.is_deleted = 'N'
                    left join carl_data.individual i2
                        on i2.id_individual = p2.id_individual and i2.is_deleted = 'N'
                    left join carl_data.country country on country.id_country = p2.id_country
                    left join carl_data.city city on city.id_city = p2.id_city

                    left join (select content::text as "contract", id_profile
                                         from carl_data.doc
                                         where is_deleted = 'N' and doc_type = 'CONTRACT'
                                         order by id_doc desc
                                         ) contr on contr.id_profile = p2.id_profile
                     where p2.is_deleted = 'N'
                     group by up.id_user, p2.id_profile, c2.email, country.name, city.name
                         , city.id_city, c2.id_company, al.buy
                         , auct.sale, bid.bids, sell.count_sell, all_lots.all_lots_count
                         , i2.passport_series, i2.passport_num, i2.issued_by, i2.issue_date
                         , contr.contract::text
                     )
                    prof on prof.id_user = u.id_user
               where u.is_deleted = 'N' and _get_user_log_domain(u.id_user) <> 'playcar'
               group by u.id_user
                        , ui.registration_host
                        , ui.refferal_url
                        , _get_user_log_domain(u.id_user)
                        -- , _get_prof_log_domain(prof.clprofile_id::int)
                        -- , carl_prof.getProfParameterV(prof.clprofile_id::int, '{employer}')
                        -- , carl_prof.getProfParameterV(prof.clprofile_id::int, '{id_promo}')
                        -- , clprofile_id


          ) s1 -- left join contr on contr.id_profile = clprofile_id::int
          offset p_offset limit p_limit) t;
    return _j_out;
end
$$ language plpgsql;


/*
-- drop  function getusersprofilesamodataj_OLD(p_id_broker integer);
-- drop  function getusersprofilesamodataj_OLD(integer, int, int);
create or replace function carl_comm.getusersprofilesamodataj_OLD(p_id_broker integer DEFAULT NULL::integer
    , p_offset int default 0, p_limit int default 100000)
 returns json
    security definer
    language plpgsql
as
$$
declare
    _j_out json;
begin
    SELECT array_to_json(array_agg(row_to_json(t)))  INTO _j_out
    FROM (select s1.* --, carl_prof.getProfContract(clprofile_id::int) as contract
          from (select (u.id_user) :: varchar as cluser_id,
                    coalesce(u.first_name, '') as cluser_firstname,
                    coalesce(u.middle_name, '') as cluser_middlename,
                    coalesce(u.last_name, '') as cluser_lastname,
                    coalesce(u.phone, '') as cluser_phone,
                    coalesce(u.email, '') as cluser_email,
                    coalesce(lower(u.status :: text), '') as cluser_status,
                    coalesce(to_char(u.dt_created, 'YYYY-MM-DD"T"HH24:MI:SS'), '') as cluser_dttcreated,
                    coalesce(to_char(u.dt_last_login, 'YYYY-MM-DD"T"HH24:MI:SS'), '') as cluser_lastlogin,
                    coalesce(ui.registration_host, '') as cluser_registration_host,
                    case when u.status in
                              ('CONFIRMED_SINGLE', 'CONFIRMED', 'ADMIN', 'MANAGER') and
                              u.phone is not null
                             then 'yes'
                         else 'no'
                        end as phone_confirmed,
                    case when ui.refferal_url <> 'Empty' and ui.refferal_url <> '[Empty]' and
                              ui.refferal_url is not null
                             then ui.refferal_url
                         else ''
                        end as cluser_refferal_url,
                    case when count(prof.*) > 0
                             then 'yes'
                         else 'no'
                        end as cluser_hasprofiles,
                    case when count(prof.*) = 0
                             then array [] :: json[]
                         else
                             array_agg(json_build_object(
                                     'clprofile_id', prof.clprofile_id,
                                     'clprofile_type', prof.clprofile_type,
                                     'clprofile_wantedrole', prof.clprofile_wantedrole,
                                     'clprofile_role', prof.clprofile_role,
                                     'clprofile_name', prof.clprofile_name,
                                     'clprofile_firstname', prof.clprofile_firstname,
                                     'clprofile_middlename', prof.clprofile_middlename,
                                     'clprofile_lastname', prof.clprofile_lastname,
                                     'clprofile_position', prof.clprofile_position,
                                     'clprofile_phone', prof.clprofile_phone,
                                     'clprofile_email', prof.clprofile_email,
                                     'clprofile_address', prof.clprofile_address,
                                     'clprofile_address_short', prof.clprofile_address_short,
                                     'clprofile_status', prof.clprofile_status,
                                     'clprofile_datecreated', prof.clprofile_datecreated,
                                     'clprofile_datesigned', prof.clprofile_datesigned,
                                     'clprofile_depositrequired',
                                     prof.clprofile_depositrequired,
                                     'clprofile_depositbalance',
                                     prof.clprofile_depositbalance,
                                     'clprofile_numberofbids', prof.clprofile_numberofbids,
                                     'clprofile_numberofbuys', prof.clprofile_numberofbuys,
                                     'clprofile_numberofsells', prof.clprofile_numberofsells,
                                     'clprofile_sells', prof.clprofile_sells,
                                     'clprofile_lots', prof.clprofile_lots,
                                     'clprofile_id_owner', prof.clprofile_id_user_owner,
                                     'clprofile_city', prof.clprofile_city,
                                     'clprofile_id_city', prof.clprofile_id_city,
                                     'clprofile_inn', prof.clprofile_inn,
                                     'clprofile_passport_series',
                                     prof.clprofile_passport_series,
                                     'clprofile_passport_num', prof.clprofile_passport_num,
                                     'clprofile_passport_issued_by',
                                     prof.clprofile_passport_issued_by,
                                     'clprofile_passport_issue_date',
                                     prof.clprofile_passport_issue_date,
                                     'clprofile_lock', jsonb_build_object(
                                             'clprofile_locked', case when
                                                                          prof.clprofile_parameters #>> '{lock,locked}' is not null and
                                                                          prof.clprofile_parameters #>>
                                                                          '{lock,locked}' =
                                                                          'true'
                                                                          then 'yes'
                                                                      else 'no' end,
                                             'clprofile_comment',
                                             coalesce(prof.clprofile_parameters #>> '{lock,comment}', ''),
                                             'clprofile_dt_lock', case when
                                                                           trim(prof.clprofile_parameters #>> '{lock,dt_lock}') is not null and
                                                                           trim(prof.clprofile_parameters #>> '{lock,dt_lock}') <>
                                                                           ''
                                                                           then to_char(
                                                         to_timestamp((prof.clprofile_parameters #>> '{lock,dt_lock}')::double precision) at time zone
                                                         'msk', 'YYYY-MM-DD"T"HH24:MI:SS')
                                                                       else '' end,
                                             'clprofile_dt_unlock', case when
                                                                             trim(prof.clprofile_parameters #>> '{lock,dt_unlock}') is not null and
                                                                             trim(prof.clprofile_parameters #>> '{lock,dt_unlock}') <>
                                                                             ''
                                                                             then to_char(
                                                         to_timestamp((prof.clprofile_parameters #>> '{lock,dt_unlock}')::double precision) at time zone
                                                         'msk', 'YYYY-MM-DD"T"HH24:MI:SS')
                                                                         else '' end
                                                       ),
                                     'clprofile_survey', prof.clprofile_survey,
                                     'clprofile_prof_categ_sel',
                                     prof.clprofile_prof_categ_sel,
                                     'clprofile_prof_categ_buy',
                                     prof.clprofile_prof_categ_buy,
                                     'id_broker', prof.id_broker,
                                     'clprofile_ogrn', prof.clprofile_ogrn,
                                     'clprofile_account', prof.clprofile_account,
                                     'clprofile_bank_name', prof.clprofile_bank_name,
                                     'clprofile_BIC', prof.clprofile_BIC,
                                     'clprofile_post_index', prof.clprofile_post_index,
                                     'clprofile_country', prof.clprofile_country,
                                     'clprofile_region', prof.clprofile_region,
                                     'clprofile_parameters', prof.clprofile_parameters,
                                     'clprofile_from_amo', case when
                                                                    prof.clprofile_parameters #>> '{from_amo}' is not null and
                                                                    prof.clprofile_parameters #>>
                                                                    '{from_amo}' = 'true'
                                                                    then 'yes'
                                                                else 'no' end,
                                     'vip', prof.is_vip, 'contract' prof.contract
                                       ))
                        end as profiles
                        , _get_user_log_domain(u.id_user) as user_log_domain
                        , _get_prof_log_domain(prof.clprofile_id::int) as prof_log_domain
                        ,
                    carl_prof.getProfParameterV(prof.clprofile_id::int, '{employer}') as employer
                        ,
                    carl_prof.getProfParameterV(prof.clprofile_id::int, '{id_promo}') as id_promo
                    --  дату дкп и номер дкп
                    -- select getUsersProfilesAMODataJ();
                    --, carl_prof.getProfContract(prof.clprofile_id::int)::text as contract
                        , clprofile_id
                from carl_data.users u
                         left outer join carl_data.user_info ui on u.id_user = ui.id_user
                         inner join --  prof ON prof.id_user = u.id_user
                    (select up.id_user,
                         (p2.id_profile) :: varchar as clprofile_id,
                         (select array_to_json(array_agg(row_to_json(r)))
                          from (select s.id_survey, s.name
                                from survey_profile sp, survey s
                                where not s.deleted and s.id_survey = sp.id_survey and
                                    sp.id_profile = p2.id_profile) r) as clprofile_survey,
                         case when p2.id_company is not null
                                  then 'company'
                              when p2.id_individual is not null
                                  then 'individual'
                              else ''
                             end as clprofile_type,
                         case when
                                  coalesce(cardinality(array_positions(p2.roles, 'buyer')), 0) >
                                  0 and
                                  coalesce(cardinality(array_positions(p2.roles, 'seller')), 0) =
                                  0
                                  then 'buyer'
                              when
                                  coalesce(cardinality(array_positions(p2.roles, 'buyer')), 0) =
                                  0 and
                                  coalesce(cardinality(array_positions(p2.roles, 'seller')), 0) >
                                  0
                                  then 'seller'
                              when
                                  coalesce(cardinality(array_positions(p2.roles, 'buyer')), 0) >
                                  0 and
                                  coalesce(cardinality(array_positions(p2.roles, 'seller')), 0) >
                                  0
                                  then 'both'
                              else ''
                             end as clprofile_role,
                         case
                             when
                                 coalesce(cardinality(array_positions(string_to_array(
                                                                              replace(replace(p2.wanted_roles, '["', ''), '"]', ''),
                                                                              ','),
                                                                      'seller')), 0) > 0 and
                                 coalesce(cardinality(array_positions(string_to_array(
                                                                              replace(replace(p2.wanted_roles, '["', ''), '"]', ''),
                                                                              ','),
                                                                      'buyer')), 0) > 0
                                 then 'both'
                             when
                                 coalesce(cardinality(array_positions(string_to_array(
                                                                              replace(replace(p2.wanted_roles, '["', ''), '"]', ''),
                                                                              ','),
                                                                      'seller')), 0) > 0
                                 then 'seller'
                             when coalesce(cardinality(array_positions(string_to_array(
                                                                               replace(replace(p2.wanted_roles, '["', ''), '"]', ''),
                                                                               ','),
                                                                       'buyer')), 0) > 0
                                 then 'buyer'
                             else ''
                             end as clprofile_wantedrole,
                         coalesce(trim(carl_prof.getProfSmartName2(p2.id_profile)), '') as clprofile_name,
                         coalesce(p2.first_name, '') as clprofile_firstname,
                         coalesce(p2.middle_name, '') as clprofile_middlename,
                         coalesce(p2.last_name, '') as clprofile_lastname,
                         coalesce(p2.position, '') as clprofile_position,
                         coalesce(p2.phone_list, '') as clprofile_phone,
                         coalesce(c2.email, '') as clprofile_email,
                         -- ERV:150721
                         coalesce(c2.ogrn, '') as clprofile_ogrn,
                         coalesce(c2.account, '') as clprofile_account,
                         coalesce(c2.bank_name, '') as clprofile_bank_name,
                         coalesce(c2."BIC", '') as clprofile_BIC,
                         coalesce(p2.post_index, '') as clprofile_post_index,
                         coalesce(carl_dict.getCountryName(p2.id_country), '') as clprofile_country,
                         coalesce(carl_dict.getRegionByCityId(p2.id_city), '') as clprofile_region,
                         coalesce(p2.address, '') as clprofile_address_short,
                         coalesce(
                                 coalesce(country.name, '') ||
                                 case when city.name is not null and city.name <> ''
                                          then ', ' || city.name
                                      else '' end ||
                                 case when p2.address is not null and p2.address <> ''
                                          then ', ' || p2.address
                                      else '' end,
                                 ''
                         ) as clprofile_address,
                         coalesce(city.name, '') as clprofile_city,
                         coalesce(city.id_city::varchar, '') as clprofile_id_city,
                         coalesce(lower(p2.status :: text), '') as clprofile_status,
                         coalesce(to_char(p2.dt_create, 'YYYY-MM-DD"T"HH24:MI:SS'), '') as clprofile_datecreated,
                         coalesce(to_char(p2.dt_signe, 'YYYY-MM-DD"T"HH24:MI:SS'), '') as clprofile_datesigned,
                         case when c2.id_company is not null and upper(c2.ownership_type) = 'ИП'
                                  then 'yes'
                              when c2.id_company is null
                                  then 'yes'
                              when c2.id_company is not null and upper(c2.ownership_type) <> 'ИП'
                                  then 'no'
                              when c2.id_company is not null and c2.ownership_type is null
                                  then 'yes'
                              else ''
                             end as clprofile_depositrequired,
                         (p2.balance_summ) :: varchar as clprofile_depositbalance,
                         coalesce(bid.bids, 0) :: varchar as clprofile_numberofbids,
                         coalesce(al.buy, 0) :: varchar as clprofile_numberofbuys,
                         coalesce(auct.sale, 0) :: varchar as clprofile_numberofsells,
                         case when sell.count_sell > 0 then 'yes' else 'no' end as clprofile_sells,
                         coalesce(all_lots.all_lots_count, 0)::varchar as clprofile_lots,
                         p2.id_user_owner::varchar as clprofile_id_user_owner,
                         p2.parameters as clprofile_parameters,
                         coalesce(c2.inn, '') as clprofile_inn,
                         coalesce(i2.passport_series, '') as clprofile_passport_series,
                         coalesce(i2.passport_num, '') as clprofile_passport_num,
                         coalesce(i2.issued_by, '') as clprofile_passport_issued_by,
                         coalesce(i2.issue_date, '') as clprofile_passport_issue_date,
                         (select name
                          from prof_categ_dict
                          where p2.id_prof_categ_sel = prof_categ_dict.id_prof_categ_dict)
                             as clprofile_prof_categ_sel,
                         (select name
                          from prof_categ_dict
                          where p2.id_prof_categ_buy = prof_categ_dict.id_prof_categ_dict)
                             as clprofile_prof_categ_buy,
                         p2.id_broker :: varchar,
                         p2.is_vip as is_vip

                     from carl_data.profile p2
                              left join carl_data.user_profile up
                     on p2.id_profile = up.id_profile and up.is_deleted = 'N'
                              left join carl_data.profile p
                     on p.id_profile = up.id_profile and p.is_deleted = 'N'
                              left outer join -- bid ON bid.id_profile = p.id_profile
                         (select id_profile,
                              count(*) as bids
                          from carl_data.auction_log
                          where is_deleted = 'N' and
                              (event_type = 'MAKE_BID' :: en_auction_event_type or
                               event_type = 'AUTO_BID' :: en_auction_event_type) and
                              exception is null
                          group by id_profile) bid on bid.id_profile = p.id_profile
                              left outer join -- auct ON auct.id_profile = p.id_profile
                         (select p.id_profile,
                              count(*) as sale
                          from carl_data.auction a,
                              carl_data.user_profile up,
                              carl_data.profile p
                          where a.id_user_profile = up.id_user_profile and
                              up.id_profile = p.id_profile and
                              a.is_deleted = 'N' and
                              up.is_deleted = 'N' and
                              p.is_deleted = 'N' and
                              a.status in
                              ('SUCCESS' :: en_auction_status, 'BUYNOW' :: en_auction_status)
                          group by p.id_profile) auct on auct.id_profile = p.id_profile
                              left outer join -- al ON al.id_profile_buyer = p.id_profile
                         (select id_profile_buyer,
                              count(*) as buy
                          from carl_data.v_auction_lead
                          -- покупанов берем ЛП берем только когда 'READY', 'DONE'
                          where 2 = 2 and
                              (status in ('SUCCESS' :: en_auction_status,
                                          'BUYNOW' :: en_auction_status)
                                  and case when id_workflow = 'LP_AUCTION'
                                               then
                                               workflow_status in ('READY', 'DONE')
                                           else true end)
                          group by id_profile_buyer) al on al.id_profile_buyer = p.id_profile
                              left outer join -- sell ON sell.id_profile = p.id_profile
                         (select p.id_profile as id_profile, count(*) as count_sell
                          from carl_data.auction auct,
                              carl_data.user_profile up,
                              carl_data.profile p
                          where auct.id_user_profile = up.id_user_profile and
                              up.id_profile = p.id_profile and
                              auct.is_deleted = 'N' and
                              up.is_deleted = 'N' and
                              p.is_deleted = 'N' and
                              auct.status = 'ACTIVE' :: en_auction_status
                          group by p.id_profile) sell on sell.id_profile = p.id_profile
                              left outer join -- all_lots ON all_lots.id_profile = p.id_profile
                         (select p.id_profile,
                              count(*) as all_lots_count
                          from carl_data.auction a,
                              carl_data.user_profile up,
                              carl_data.profile p
                          where a.id_user_profile = up.id_user_profile and
                              up.id_profile = p.id_profile and
                              a.is_deleted = 'N' and
                              up.is_deleted = 'N' and
                              p.is_deleted = 'N' and
                              a.status in
                              ('ACTIVE'::en_auction_status, 'FINISHED'::en_auction_status,
                               'SUCCESS' :: en_auction_status, 'FAILED'::en_auction_status,
                               'BUYNOW' :: en_auction_status)
                          group by p.id_profile) all_lots
                     on all_lots.id_profile = p.id_profile
                              left join carl_data.company c2
                     on c2.id_company = p2.id_company and c2.is_deleted = 'N'
                              left join carl_data.individual i2
                     on i2.id_individual = p2.id_individual and i2.is_deleted = 'N'
                              left join carl_data.country country on country.id_country = p2.id_country
                              left join carl_data.city city on city.id_city = p2.id_city
                     where p2.is_deleted = 'N'
                     --> если домен втб, то не надо никого подменять брокером
                     -- and ((p_id_broker is null and p2.id_broker is null)
                     --         or (p2.id_broker = p_id_broker))
--                         and ((p_id_broker is null and (p2.id_broker is null or p2.id_broker = 2))
--                     or (p2.id_broker = p_id_broker))
                     --<
                     group by up.id_user, p2.id_profile, c2.email, country.name, city.name,
                         city.id_city, c2.id_company, al.buy,
                         auct.sale, bid.bids, sell.count_sell, all_lots.all_lots_count,
                         i2.passport_series, i2.passport_num
                             , i2.issued_by, i2.issue_date) prof on prof.id_user = u.id_user
                where u.is_deleted = 'N' and _get_user_log_domain(u.id_user) <> 'playcar'
                group by u.id_user
                        , ui.registration_host
                        , ui.refferal_url
                        , _get_user_log_domain(u.id_user)
                        , _get_prof_log_domain(prof.clprofile_id::int)
                        , carl_prof.getProfParameterV(prof.clprofile_id::int, '{employer}')
                        , carl_prof.getProfParameterV(prof.clprofile_id::int, '{id_promo}')
                        , clprofile_id
              -- , carl_prof.getProfContract(prof.clprofile_id::int)::text
          ) s1
          offset p_offset
          limit p_limit
          ) t;
    return _j_out;
end
$$;
*/


/*
update doc set is_deleted = 'N'
 where id_doc in (
1
,55819
,56886
,56884
,55965
,55961
,56887
,55824
,56251
,56242
,56173
,56248
,57635
,56238
,55817
,55825
,56086
,52560
,55839
,55847
,56158
,56656
,53554
,56433
,56175
,55730
,55831
,52978
,56171
,55837
,56231
,56229
,55731
,56239
,56165
,56237
,41
);

52512
56888
55851

52514
*/


-- select * from doc where id_profile = 35305;

-- select carl_comm.test_compare_profiles_data('getUsersProfilesAMODataJ_OLD'
--   , 'getUsersProfilesAMODataJ_NEW');


-- -- Пример вызова тестовой функции
-- SELECT carl_comm.test_compare_profiles_data(p_id_broker => null);
-- select * from  old_data;
-- select * from  new_data_transformed;
-- -- Количество записей не совпадает! Старая функция: 27503, Новая функция: 27508


--
-- -- Функция для обработки массива JSON
-- CREATE OR REPLACE FUNCTION carl_comm.test_compare_profiles_data(
--     p_id_broker INT DEFAULT NULL,
--     p_offset INT DEFAULT 0,
--     p_limit INT DEFAULT 100000
-- )
--     RETURNS BOOLEAN LANGUAGE plpgsql AS $$
-- DECLARE
--     v_old_data_count INT;
--     v_new_data_count INT;
--     v_diff_count INT;
-- BEGIN
--     DROP TABLE if exists old_data;
--     DROP TABLE if exists new_data_transformed;
--
--     -- Создаем временные таблицы для хранения развернутых и обработанных данных
--     CREATE TEMP TABLE old_data AS
--     SELECT element
--     FROM jsonb_array_elements(carl_comm.getUsersProfilesAMODataJ_OLD(p_id_broker, p_offset, p_limit)::jsonb) AS t(element);
--
--     CREATE TEMP TABLE new_data_transformed AS
--     SELECT (element - 'contract') AS element
--     FROM jsonb_array_elements(carl_comm.getUsersProfilesAMODataJ_NEW(p_id_broker, p_offset, p_limit)::jsonb) AS t(element);
--
--     -- Проверяем, совпадает ли количество записей
--     SELECT count(*) INTO v_old_data_count FROM old_data;
--     SELECT count(*) INTO v_new_data_count FROM new_data_transformed;
--     raise notice '~~~ Количество записей % %', v_old_data_count, v_new_data_count;
--
--     IF v_old_data_count != v_new_data_count THEN
--         RAISE NOTICE 'Количество записей не совпадает! Старая функция: %, Новая функция: %', v_old_data_count, v_new_data_count;
--         -- DROP TABLE old_data;
--         -- DROP TABLE new_data_transformed;
--         RETURN FALSE;
--     END IF;
--
--     -- Проверяем разницу с помощью EXCEPT
--     SELECT count(*) INTO v_diff_count
--     FROM (
--         (SELECT element::text FROM old_data)
--         EXCEPT
--         (SELECT element::text FROM new_data_transformed)
--     ) AS diff;
--
--     IF v_diff_count > 0 THEN
--         RAISE NOTICE 'Найдены расхождения (записи из старой, которых нет в новой): %', v_diff_count;
--         -- DROP TABLE old_data;
--         -- DROP TABLE new_data_transformed;
--         RETURN FALSE;
--     END IF;
--
--     -- Проверяем разницу в обратную сторону
--     SELECT count(*) INTO v_diff_count
--     FROM (
--         (SELECT * FROM new_data_transformed)
--         EXCEPT
--         (SELECT * FROM old_data)
--     ) AS diff;
--
--     IF v_diff_count > 0 THEN
--         RAISE NOTICE 'Найдены расхождения (записи из новой, которых нет в старой): %', v_diff_count;
--         -- DROP TABLE old_data;
--         -- DROP TABLE new_data_transformed;
--         RETURN FALSE;
--     END IF;
--
--     -- Если все проверки пройдены
--     -- DROP TABLE old_data;
--     -- DROP TABLE new_data_transformed;
--     RETURN TRUE;
-- END;
-- $$;

--select carl_comm.test_compare_profiles_data('getUsersProfilesAMODataJ_OLD'
--    , 'getUsersProfilesAMODataJ_NEW');


-- -- Пример вызова тестовой функции
-- SELECT carl_comm.test_compare_profiles_data(p_id_broker => null);
-- select * from  old_data;
-- select * from  new_data_transformed;
-- -- Количество записей не совпадает! Старая функция: 27503, Новая функция: 27508





-- alter function carl_comm.getusersprofilesamodataj(integer) owner to carl;
-- grant execute on function carl_comm.getusersprofilesamodataj(integer) to carl_php;




--  Надо сделать функцию, которая будет принимать таймстемп или ничего, если можно дату внутри посчитать.
-- Возвращать надо профили продавцов с количество созданных лотов за предыдущие 6 месяцев, т.е. например вызов идет 01.10, значит надо считать количество в месяцах 04-09.
-- Status=OK + Roles=Seller + NotDeleted
-- Еще надо добавить в вывод дату последнего создания лота, если она есть, id_prof_categ_sel, форму собственности и название. Т.е. надо получить что-то типа:
-- [
--   {
--     id_profile: 1,
--     id_prof_categ_sel: string,
--     last_start_date: date|string|null
--     ownership_type: string,
--     name: string,
--     lots: []
--   }
-- ]
-- lots - тут структура на твое усмотрение, вообще надо 3 среза  - прыдущий месяц, предыдущие 3, предыдущие 4-6 месяцы. Но можно и просто по каждому месяцу количество сделать, дальше я сам посчитаю, как тебе удобнее и быстрее будет. Желательно, конечно, это сегодня сделать, что бы у меня было время потестить. Отдел продаж хочет запустить эту штуку 15 числа уже.
-- ;
-- select carl_amo.getSellerExpoStats()
create or replace function carl_amo.getSellerExpoStats()
	RETURNS JSONB  security definer as $F$
SELECT jsonb_agg(
    jsonb_build_object(
        'id_profile', id_profile,
        'id_user', id_user_owner,
        'id_prof_categ_sel', id_prof_categ_sel,
        'last_start_date', last_start_date,
        'name', name,
        'ownership_type', ownership_type,
        'prof_categ_name', prof_categ_name,
        'lots', lots
    )
    ORDER BY id_profile, id_user_owner, id_prof_categ_sel, name
) AS profiles
FROM (
    SELECT
        id_profile,
        id_user_owner,
        id_prof_categ_sel,
        MAX(last_start_date) AS last_start_date,
        name,
        ownership_type,
        prof_categ_name,
        jsonb_agg(
            jsonb_build_object(
                'month_ago', month_ago,
                'lots', record_count
            )
            ORDER BY month_ago
        ) AS lots
    FROM (
        SELECT
            p.id_profile,
            p.id_user_owner,
            p.id_prof_categ_sel,
            getProfSmartName2(p.id_profile) AS name,
            pcd.name AS prof_categ_name,
            CASE
                WHEN c.id_company IS NOT NULL THEN c.ownership_type
                ELSE 'person'
            END AS ownership_type,
            MAX(EXTRACT(EPOCH FROM a.dt_start)) AS last_start_date,
            -- MAX(EXTRACT(EPOCH FROM aa.dt_start)) AS last_start_date,  для поиска max_start_date за все вермя , но замедляет запрос до 16 минут
            coalesce(  EXTRACT(MONTH FROM AGE(DATE_TRUNC('month', CURRENT_DATE) ,    DATE_TRUNC('month',  a.dt_start )))::int , -1 ) AS month_ago,
         COUNT(*) AS record_count
        FROM profile p
            LEFT JOIN company c ON c.id_company = p.id_company
        JOIN prof_categ_dict pcd ON pcd.id_prof_categ_dict = p.id_prof_categ_sel
        JOIN user_profile up ON up.id_profile = p.id_profile -- and  up.id_user = p.id_user_owner
            left JOIN auction a ON a.id_user_profile = up.id_user_profile
                                       AND a.dt_start >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '6 months'
                                       AND a.dt_start < DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '0 month'
        --- для поиска max_start_date за все вермя , но замедляет запрос до 16 минут
        -- left JOIN auction aa ON aa.id_user_profile = up.id_user_profile
        WHERE p.status = 'ok'
          AND p.is_deleted = 'N'
          AND roles::text[] @> ARRAY['seller']
--          and coalesce(  EXTRACT(MONTH FROM AGE(DATE_TRUNC('month', CURRENT_DATE) ,    DATE_TRUNC('month',  a.dt_start )))::int , -1 ) > 0
        GROUP BY p.id_profile, p.id_user_owner, p.id_prof_categ_sel, month_ago , getProfSmartName2(p.id_profile),CASE
                WHEN c.id_company IS NOT NULL THEN c.ownership_type
                ELSE 'person'
            END,  pcd.name
    ) AS monthly_data
    GROUP BY id_profile, id_user_owner, id_prof_categ_sel, name, ownership_type, prof_categ_name
) AS profile_data
    ;
$F$ LANGUAGE sql;



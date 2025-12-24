
/**
 * api_auct_sort.sql
 *
 * Сортировки в аукционах
 *
 * Author:  Roman Eremeev
 *
 *
 * Created: 03.04.2018
 * http://dev.carlink.ru:8090/javascript/examples/grapheditor/www/index.htm?xml=CarlWorkflow.xml
 */


/*
1ми показываем is vw
2ми все опен, внутри опенов сортировка сперва те, которые заканчиваются раньше
3я очередь- тендеры, внутри тендеров сортировка сперва те, которые заканчиваются раньше
*/

drop function if exists carl_auct._calcAuctPriority(p_is_vw boolean, p_auction_type en_auction_type, boolean, int);

----------------------------------------------------------------------------------
-- Рассчет приоритета аукциона
-- select carl_auct._calcAuctPriority(true,'OPEN',false,-2000);
----------------------------------------------------------------------------------
create or replace function carl_auct._TEST_calcAuctPriority(p_is_vw boolean, p_auction_type en_auction_type
  , p_is_total boolean, p_user_sort_prior int, p_parsed boolean)
	returns int security definer as $$
declare
  _res int := 0;
begin

  if(p_is_total) then
    _res := _res - 10;
  end if;

  perform carl_auct.calcAuctPriority(p_id_auction);
  select * from carl_auct._tr_calcAuctPriority(p_id_auction);

  -- Вагоны больше не в фаворе
  --   if(p_is_vw) then
  --     _res := _res + 1000;
  --   end if;

	--if(p_auction_type = 'OPEN'::en_auction_type) then
	if(not p_parsed) then
    _res := _res + 100;
	end if;

  return _res + p_user_sort_prior;
end;
$$ language plpgsql;


-- ----------------------------------------------------------------------------------
-- --  Задать user_sort_prior для аукциона p_id_auction как в профиле его создателя
-- --  Возвращает:
-- --  Исключения:
-- --  Пример:
-- ----------------------------------------------------------------------------------
-- create or replace function carl_auct._setUserSortPriorAsProf(p_id_auction int)
-- 	returns void security definer as $$
-- declare
--   _user_sort_prior int;
-- begin
--   --_user_sort_prior := getAuctParameterI(p_id_auction,'{user_sort_prior}',0);
--
--   select t.user_sort_prior into _user_sort_prior from carl_data.auction_profile_tag apt, carl_data.tag t
--     where t.id_tag = apt.id_tag
--       and apt.id_profile = carl_auct._get_auct_id_prof(p_id_auction)
--
--   select carl_auct.setAuctParameter(p_id_auction,'{"user_sort_prior":'||getAuctParameterI(p_id_auction,'{user_sort_prior}',0)||'}')
--
-- end;
-- $$ language sql;


----------------------------------------------------------------------------------
-- Рассчет приоритета аукциона
-- select carl_auct.calcAuctPriority(2640);
----------------------------------------------------------------------------------
create or replace function carl_auct.calcAuctPriority(p_id_auction int)
	returns int security definer as $$
declare
  _res int := 0;
	_auction auction%rowtype;
  _is_total varchar; _user_sort_prior int; _is_vw boolean; _is_parsed boolean;
begin

	select * into _auction from auction where is_deleted = 'N' and id_auction = p_id_auction;
  if(_auction.id_auction is null) then
--     raise exception using message=_getMessage('AUCT_NOT_FOUND_WITH_ID') || coalesce(p_id_auction::varchar,'<NULL>')
--       , errcode=_getErrcode('AUCT_NOT_FOUND_WITH_ID');
    return 0;
  end if;

  _is_total := _getAuctObject(p_id_auction)#>>'{properties,total}';
  _user_sort_prior := getAuctParameterI(p_id_auction,'{user_sort_prior}',0);
  _is_vw := carl_auct.getAuctParameterB(p_id_auction,'{is_vw}', false);
  _is_parsed := case when _auction.is_parsed = 'Y' then true else false end;
  _res := carl_auct._calcAuctPriority(_is_vw
     , _auction.auction_type
     , case when _is_total is null or _is_total = 'N' then false else true end
     , _user_sort_prior
     , _is_parsed);

  return _res;
end;
$$ language plpgsql;


drop function if exists carl_auct._tr_calcAuctPriority(p_id_auction int
  , p_parameters jsonb, p_auction_type en_auction_type);

----------------------------------------------------------------------------------
-- Рассчет приоритета аукциона для триггера
-- select carl_auct._tr_calcAuctPriority(100,null,'OPEN');
----------------------------------------------------------------------------------
create or replace function carl_auct._tr_calcAuctPriority(p_id_auction int
  , p_parameters jsonb, p_auction_type en_auction_type, p_parsed boolean)
	returns int security definer as $$
declare
  _res int := 0;
  _is_total varchar; _user_sort_prior int; _is_vw boolean;
begin
  _is_total := coalesce((_getAuctObject(p_id_auction)#>>'{properties,total}')::varchar,'N');
  _user_sort_prior := coalesce((p_parameters#>>'{user_sort_prior}')::int,0);
  _is_vw := coalesce((p_parameters#>>'{is_vw}')::boolean,false);
  _res := carl_auct._calcAuctPriority(_is_vw
     , p_auction_type
     , case when _is_total is null or _is_total = 'N' then false else true end
     , _user_sort_prior
     , p_parsed);
  return _res;
end;
$$ language plpgsql;


----------------------------------------------------------------------------------
-- Рассчет и обновление приоритета аукциона
-- select carl_auct.updateAuctPriority(null);
----------------------------------------------------------------------------------
create or replace function carl_auct.updateAuctPriority(p_id_auction int)
	returns void security definer as $$
  update auction set sort_priority = carl_auct.calcAuctPriority(id_auction) where is_deleted = 'N'
    and (p_id_auction is null or id_auction = p_id_auction);
$$ language sql;


drop function if exists carl_auct._getDtEndForSort(p_id_auction int);

----------------------------------------------------------------------------------
-- Для сортировки аукционов в живых торгах время окончанеия берется по дате старта торгов
-- select carl_auct._getDtEndForSort(6296);
----------------------------------------------------------------------------------
create or replace function carl_auct._getDtEndForSort(p_id_auction int)
	returns bigint /*ERV:bigint*/ security definer as $$
  select extract( epoch from case when a.id_queue is not null then q.dt_start else a.dt_end end)::bigint /*ERV:bigint*/ from auction a
    left join queue q on (a.id_queue = q.id_queue)
  where id_auction = p_id_auction
$$ language sql;


----------------------------------------------------------------------------------
-- Для сортировки аукционов в живых торгах время начала берется по дате старта торгов
-- select carl_auct._getDtStartForSort(6296);
----------------------------------------------------------------------------------
create or replace function carl_auct._getDtStartForSort(p_id_auction int)
	returns int security definer as $$
  select extract( epoch from case when a.id_queue is not null then q.dt_start else a.dt_start end)::int from auction a
    left join queue q on (a.id_queue = q.id_queue)
  where id_auction = p_id_auction
$$ language sql;


----------------------------------------------------------------------------------
-- Для сортировки аукционов в живых торгах вычисляется порядок сортировки по
-- order_num
-- select carl_auct._getQueSortNumForSort(6296);
----------------------------------------------------------------------------------
create or replace function carl_auct._getQueSortNumForSort(p_id_auction int)
	returns int security definer as $$
  select /*10000*queue.id_queue + */qa.order_num from queue_auction qa
    where qa.id_auction = p_id_auction
$$ language sql;


----------------------------------------------------------------------------------
-- Рассчет и обновление приоритета аукциона
-- select carl_auct.updateAuctPriority(null);
----------------------------------------------------------------------------------
--create or replace function carl_auct._getDtEndForSort(p_id_auction int)
--	returns int security definer as $$
--declare
--  _dt_end timestamp;
--begin
--  select dt_end into _dt_end from auction a where id_auction = p_id_auction;
--  return extract( epoch from _dt_end)::int;
--end;
--$$ language plpgsql;



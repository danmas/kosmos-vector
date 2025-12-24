/**
 * api_auct.sql
 *
 * Author:  Roman Eremeev
 * Created: 29.03.2017
 * http://dev.carlink.ru:8090/javascript/examples/grapheditor/www/index.htm?xml=CarlWorkflow.xml
 */


---------------------------------------------------------------------------------
--  Удаление акциона продавцом
----------------------------------------------------------------------------------
create or replace function carl_auct.deleteAuctionSeller(p_id_user int, p_id_profile int, p_id_auction int)
    returns void
as $$
declare
    _status varchar;
begin
    if(_get_auct_seller_id(p_id_auction) <> p_id_profile) then
        raise exception using message=_getMessage('AUCT_SELLER_BUYNOW_NOT_SELLER_AUCT')
            , errcode=_getErrcode('AUCT_SELLER_BUYNOW_NOT_SELLER_AUCT');
    end if;

    select status into _status from auction where id_auction = p_id_auction;
    if(_status not in ('MODERATED','DRAFT')) then
        raise exception using message=_getMessage('AUCT_CANT_DELETE_AUCT')
            , errcode=_getErrcode('AUCT_CANT_DELETE_AUCT');
    end if;

    update auction set is_deleted='Y'
        where auction.id_auction = p_id_auction;

end;
$$ language plpgsql;



---------------------------------------------------------------------------------
--  Установить delta_sniper для профиля продавца
----------------------------------------------------------------------------------
create or replace function carl_prof.updateProfDeltaSniper(p_id_profile int, p_delta_sniper text)
returns void
as $$
declare
    _delta_sniper interval;
begin
    _delta_sniper := p_delta_sniper::interval;
    update profile set parameters = parameters - 'delta_sniper'
                                        || jsonb_build_object('delta_sniper', p_delta_sniper)
        where id_profile = p_id_profile;

end;
$$ language plpgsql;



---------------------------------------------------------------------------------
--  Получение _delta_sniper по профилю продавца если нет то возвращается из глобальной настройки
--  Возвращвет: интервал
--  Пример:
--   select carl_lot._getLotDataByIdJb(300,'{characteristics,mark}');
----------------------------------------------------------------------------------
create or replace function carl_auct._getDeltaSniper(p_id_auction int)
returns interval immutable
as $$
declare
    _delta_sniper interval;
begin
    select (parameters->>'delta_sniper')::interval into _delta_sniper
        from profile p
        where p.id_profile = carl_auct._get_auct_seller_id(p_id_auction);
    if(_delta_sniper is null) then
        _delta_sniper := carl_comm.getParameter('delta_sniper')::interval;
    end if;
    return _delta_sniper;
end;
$$ language plpgsql;


drop function if exists carl_auct.getDeltaSniper(p_id_auction int);


---------------------------------------------------------------------------------
--  Получение delta_sniper по профилю продавца если нет то возвращается из глобальной настройки
--  Возвращвет: секунды
--  Пример:
--   select carl_auct.getDeltaSniper(83000);
--   select carl_auct.getDeltaSniper(77);
--   select carl_auct.getDeltaSniper(22894);
----------------------------------------------------------------------------------
create or replace function carl_auct.getDeltaSniper(p_id_auction int)
returns int immutable
as $$
declare
    _ret  int;
    _type varchar;
    _cnt  int;
  begin
    select count(*) into _cnt  from auction where id_auction = p_id_auction
        and is_parsed = 'Y';

    if(_cnt > 0) then
        return -1;
    end if;

    _type := carl_auct._get_auct_type(p_id_auction);
    if(_type <> 'OPEN') then
        return 0;
    end if;

    select count(*) into _cnt  from queue_auction where id_auction = p_id_auction;
    if(_cnt > 0) then
        return extract(epoch from
            carl_comm.getParameter('queue_lot_duration','0 sec')::interval)::int;
    end if;

    _ret := extract(epoch from carl_auct._getDeltaSniper(p_id_auction))::int;
    return _ret;
end;
$$ language plpgsql;


----------------------------------------------------------------------------------
-- _start_price
----------------------------------------------------------------------------------
create or replace function carl_auct._get_auct_min_price(p_id_auction int)
  returns int security definer as $$
	select a.min_price from auction a
    where a.id_auction = p_id_auction
$$
language sql;


----------------------------------------------------------------------------------
----------------------------------------------------------------------------------
create or replace function carl_auct._get_auct_start_price(p_id_auction int)
  returns int security definer as $$
	select a.start_price from auction a
    where a.id_auction = p_id_auction
$$
language sql;


----------------------------------------------------------------------------------
----------------------------------------------------------------------------------
create or replace function carl_auct._get_auct_curent_price(p_id_auction int)
  returns int security definer as $$
	select ab.bid_value from auction_bid ab
    where ab.id_auction = p_id_auction
      and ab.bid_status = 'LEAD'
$$
language sql;


----------------------------------------------------------------------------------
-- Возвращает id_profile продавца аукциона p_id_auction
-- select carl_auct.getSellerProfId(6);
----------------------------------------------------------------------------------
create or replace function carl_auct._get_auct_seller_id(p_id_auction int)
  returns int security definer as $$
	select up.id_profile from auction a, user_profile up
    where up.id_user_profile = a.id_user_profile
      and a.id_auction = p_id_auction
$$
language sql;


----------------------------------------------------------------------------------
--  Возвращает id_profile продавца аукциона с p_id_auction
----------------------------------------------------------------------------------
create or replace function carl_auct._get_auct_id_prof(p_id_auction int)
	returns int
security definer as $$
	select up.id_profile from auction a, user_profile up where
    a.id_user_profile = up.id_user_profile --and up.is_deleted = 'N'
    and a.id_auction = p_id_auction and a.is_deleted = 'N'
$$ language sql stable ;


----------------------------------------------------------------------------------
--  Возвращает id_profile продавца аукциона с p_id_auction
-- замена _get_auct_id_prof
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctSeller(p_id_auction int)
	returns int
security definer as $$
	select carl_auct._get_auct_id_prof(p_id_auction);
$$ language sql stable;


-- drop function if existscarl_auct._get_auct_id_user(p_id_auction int);

----------------------------------------------------------------------------------
--  Возвращает id_user аукциона с p_id_auction
----------------------------------------------------------------------------------
create or replace function carl_auct._get_auct_id_user(p_id_auction int)
	returns int
security definer as $$
	select up.id_user from auction a, user_profile up where
    a.id_user_profile = up.id_user_profile
    and up.is_deleted = 'N'
    and a.id_auction = p_id_auction and a.is_deleted = 'N'
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает status аукциона с p_id_auction
--  select _get_auct_status(2000);
----------------------------------------------------------------------------------
create or replace function carl_auct._get_auct_status(p_id_auction int)
	returns varchar
security definer as $$
	select a.status::varchar from auction a where
    a.id_auction = p_id_auction and a.is_deleted = 'N'
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает auction_type аукциона с p_id_auction
--  select _get_auct_type(2000);
----------------------------------------------------------------------------------
create or replace function carl_auct._get_auct_type(p_id_auction int)
	returns varchar
security definer as $$
	select a.auction_type::varchar from auction a where
    a.id_auction = p_id_auction and a.is_deleted = 'N'
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает dt_start аукциона с p_id_auction
--  select _get_auct_type(2000);
----------------------------------------------------------------------------------
create or replace function carl_auct._get_auct_dt_start(p_id_auction int)
	returns auction.dt_start%type
security definer as $$
	select a.dt_start from auction a where
    a.id_auction = p_id_auction and a.is_deleted = 'N'
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает dt_end аукциона с p_id_auction
--  select _get_auct_type(2000);
----------------------------------------------------------------------------------
create or replace function carl_auct._get_auct_dt_end(p_id_auction int)
	returns auction.dt_end%type
security definer as $$
	select a.dt_end from auction a where
    a.id_auction = p_id_auction and a.is_deleted = 'N'
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает true если аукцион с p_id_auction удален
--  select _is_auct_deleted(2000);
----------------------------------------------------------------------------------
create or replace function carl_auct._is_auct_deleted(p_id_auction int)
	returns boolean
security definer as $$
	select a.is_deleted = 'Y' from auction a where
    a.id_auction = p_id_auction
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает id_object аукциона с p_id_auction
----------------------------------------------------------------------------------
create or replace function carl_auct._get_auct_id_object(p_id_auction int)
	returns int
security definer as $$
	select a.id_object from auction a where a.id_auction = p_id_auction and a.is_deleted = 'N'
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает last id_auction для объекта с p_id_object
----------------------------------------------------------------------------------
create or replace function carl_auct.getIdAuctByObjectId(p_id_object int)
	returns int
security definer as $$
	select a.id_auction from auction a where a.id_object = p_id_object and a.is_deleted = 'N'
    order by id_auction desc limit 1
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает состояние процесса аукциона с p_id_auction
--  Исключения:
--  Пример: select carl_auct._getWorkflowStatus(1);
----------------------------------------------------------------------------------
create or replace function carl_auct._getWorkflowStatus(p_id_auction int)
	returns varchar
security definer as $$
  select workflow_status from auction where id_auction = p_id_auction
    and is_deleted = 'N'
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает состояние процесса аукциона с p_id_auction
--  Исключения:
--  Пример: select carl_auct._get_id_workflow(1);
----------------------------------------------------------------------------------
create or replace function carl_auct._get_id_workflow(p_id_auction int)
    returns varchar
    security definer as $$
select id_workflow from auction where id_auction = p_id_auction
        -- and is_deleted = 'N'
$$ language sql;



-- AUCT.HT

-- drop function if existscarl_auct._getProfTargetNameInAuct(p_id_profile int, p_id_auction int);
-- drop function if existscarl_auct._getProfTargetNameInAuct(p_id_user int, p_id_profile int, p_id_auction int);


-- drop function if existscarl_auct._getProfTargetNameInAuct(p_id_user int, p_id_profile int, p_id_auction int);
-- drop function if existscarl_auct._getProfTargetNameInAuct(p_id_user int, p_id_profile int, p_id_auction int, int);
-- drop function if existscarl_auct._getProfTargetNameInAuct(p_id_user int, p_id_profile int, p_id_auction int, boolean );
drop function if exists carl_auct._getProfTargetNameInAuct(p_id_user int, p_id_profile int
  , p_id_auction int, p_is_admin boolean, p_is_bid_owner boolean);

----------------------------------------------------------------------------------
--  Возвращает target name профиля p_id_profile в аукционе p_id_auction
--  p_id_user_see - тот кто получает данные
--  Исключения:
--  Пример:
--  select carl_auct._getProfTargetNameInAuct(3,1242,16863); -- , p_is_admin => false, p_is_bid_owner => true );
-- select * from auction_target_name;
-- select * from profile;
----------------------------------------------------------------------------------
create or replace function carl_auct._getProfTargetNameInAuct(p_id_user int, p_id_profile int
  , p_id_auction int, p_is_admin boolean default false, p_is_bid_owner boolean default false
  , p_params json default null)
	returns varchar
security definer as $$
declare
    _s varchar; _num int; _sql varchar = '1, 2'; _b boolean; _ipes varchar; _id_user_ext varchar;
    _s_uch varchar := 'Участник №'; _s_uch_tr varchar;
begin

  -- Для админа и покупана выводим Псевдоимя если есть
  if(p_is_admin or p_is_bid_owner) then
    return carl_prof.getProfSmartPseudoName(p_id_profile);
  end if;

  -- если в настройках селлера deanonim_for_all=true то отключаем анонимизацию
  if(carl_prof.getProfParameterB(
      carl_auct.getSellerProfId(p_id_auction), '{deanonim_for_all}', false)) then
    return carl_prof.getProfSmartName(p_id_user, p_id_profile);
  end if;

--   if(p_is_bid_owner) then
--     return carl_prof.getProfSmartNameBroker(p_id_user, p_id_profile);
--   end if;

  _id_user_ext := (p_params->>'id_user_ext')::varchar;

  select target_name into _s from auction_target_name
    where id_profile = p_id_profile
      and id_auction = p_id_auction
      and (_id_user_ext is null or _id_user_ext = id_user_ext)
      and is_deleted = 'N';


  if(_s is not null) then
     if(position(_s_uch in _s) > 0) then
        _s_uch_tr := _translatefrombase(_s_uch, 'PROGRAM_CONST');
        _s := replace(_s, _s_uch, _s_uch_tr);
    end if;
    return _s;
  end if;

  _num := trunc(random()*1000)+1;

  _ipes := carl_comm.getParameter('ip_list_buyer_extern_server');

  _sql := 'select case when '|| p_id_profile ||' in ('||_ipes||') then true else false end';
  execute _sql into _b;

  -- if(_b) then
  --  _s := 'Участник на платформе продавца';
  -- else
    _s := _s_uch || ' ' ||_num;
  -- end if;

  insert into auction_target_name (id_profile, id_user_ext, id_auction, num_in_auct, target_name) values
    (p_id_profile, _id_user_ext, p_id_auction, _num, _s);

  if(position(_s_uch in _s) > 0) then
      _s_uch_tr := _translatefrombase(_s_uch, 'PROGRAM_CONST');
      _s := replace(_s, _s_uch, _s_uch_tr);
  end if;
  return _s;

end
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Устанавливает отсрочку платежа для аукциона с p_id_auction
--  такой же как задана в профиле продавца
--  ЕСЛИ НА ПРОФИЛЕ НЕ ЗАДАНО ТО ГЛОБАЛЬНЫХ НАСТРОЕК
--  Исключения:
--  Пример: select setAuctPayDelayAsProf(111);
----------------------------------------------------------------------------------
create or replace function carl_auct.setAuctPayDelayAsProf(p_id_auction int)
	returns void
security definer as $$
declare
  _pay_delay int;
begin
  begin
    _pay_delay := getProfParameterI(getSellerProfId(p_id_auction),'{pay_delay}',-1);
  exception when others then
    _pay_delay := -1;
  end;

  if( _pay_delay is null or _pay_delay = -1 ) then
    _pay_delay := 0;
  end if;
  perform carl_auct.setAuctParameter(p_id_auction, json_build_object('pay_delay',_pay_delay));

end;
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Устанавливает user_sort_prior для аукциона с p_id_auction
--  такой же как задана в профиле продавца
--  Исключения:
--  Пример: select setUserSortPriorAsProf(111);
----------------------------------------------------------------------------------
create or replace function carl_auct.setUserSortPriorAsProf(p_id_auction int)
	returns void
security definer as $$
declare
  _user_sort_prior int;
begin
  _user_sort_prior := getProfParameterI(getSellerProfId(p_id_auction),'{user_sort_prior}',-1);

  if( _user_sort_prior is null or _user_sort_prior = -1 ) then
    _user_sort_prior := 0;
  end if;

  perform carl_auct.setAuctParameter(p_id_auction, json_build_object('user_sort_prior',_user_sort_prior));

end;
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Возвращает отсрочку платежа для аукциона с p_id_auction
--  Пример: select getAuctPayDelay(1111);
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctPayDelay(p_id_auction int)
	returns int
security definer as $$
declare
  _pay_delay int;
begin
  -- _pay_delay := getProfParameterI(getSellerProfId(p_id_auction),'{pay_delay}',-1);
  _pay_delay := getAuctParameterI(p_id_auction,'{pay_delay}',-1);

  if( _pay_delay is null or _pay_delay = -1 ) then
    return null;
  end if;
  return _pay_delay;

end;
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Устанавливает отсрочку платежа для аукциона с p_id_auction
--  такой же как в акукционе p_id_auction_parent
--  Исключения:
--  Пример: select setAuctPayDelayAsAuct(1123,3456);
----------------------------------------------------------------------------------
create or replace function carl_auct.setAuctPayDelayAsAuct(p_id_auction int, p_id_auction_parent int)
	returns void
security definer as $$
declare
begin
  perform carl_auct.setAuctParameter(p_id_auction
    , jsonb_build_object('pay_delay',getProfParameterI(getSellerProfId(p_id_auction_parent),'{pay_delay}',0)));
end
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Возвращает организатора торгов для аукциона p_id_auction
--  если не задан то вернет null
--  Пример: select carl_auct.getAuctTradeMaster(1000);
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctTradeMaster(p_id_auction int)
	returns varchar
security definer as $$
  select carl_prof.getProfParameter(carl_auct._get_auct_id_prof(p_id_auction),'{trade_master}',null)
$$ language sql;


-- drop function if existscarl_auct.getAuctCommission(p_id_profile_sel int, p_id_profile_buy int);

----------------------------------------------------------------------------------
--  Возвращает коммисию продажи для аукциона p_id_auction если она установлена для аукциона
--  иначе продавца с p_id_profile_sel для покупателя с p_id_profile_buy
--  если были заданы значения комиссии как null - то вернутся системные параметры
--
--  БЕЗ учета брокеров
--
--  Исключения: AUCT_PROF_NOT_COMPANY_NOT_INDIVIDUAL
--  Пример:
--  select _is_company(275);
--  select _is_individual(275);
--  select carl_prof.isVip(3);
--  select carl_auct.getAuctCommission(3, 3, 20000);
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctCommissionWithoutBroker(p_id_profile_sel int, p_id_profile_buy int
  , p_id_auction int)
	returns int
security definer as $$
declare
  _for_company int; _for_individual int; _for_buyer int;
 begin

  raise notice '~~~!!!!!!!!!!! 0';

  select for_buyer into _for_buyer from carl_data.auct_commission ac, carl_data.profile_in_group pig
    where pig.id_profile_group = ac.id_profile_group_buy
      and pig.id_profile = p_id_profile_buy
      and id_auction = p_id_auction;

  if(_for_buyer is not null) then
    return _for_buyer;
  end if;

  raise notice '~~~!!!!!!!!!!! 01';

  if( _is_company(p_id_profile_buy) ) then
    if(p_id_auction is not null) then
      select for_company into _for_company from auct_commission
        where id_auction = p_id_auction
          and id_profile_group_buy is null;
      if(_for_company is not null) then
        return _for_company;
      end if;
    end if;

    select for_company into _for_company from auct_commission
      where id_profile_sel = p_id_profile_sel
        and id_profile_group_buy is null;
    if(_for_company is null) then
      return carl_comm.getParameter('commission_for_company')::int;
    else
      return _for_company;
    end if;

  elsif(_is_individual(p_id_profile_buy) ) then

    if(p_id_auction is not null) then
      raise notice '~~~!!!!!!!!!!! 0+2';
      select for_individual into _for_individual from auct_commission
        where id_auction = p_id_auction
          and id_profile_group_buy is null;
      if(_for_individual is not null) then
        raise notice '~~~!!!!!!!!!!! 0+3 _for_individual: %', _for_individual;
        return _for_individual;
      end if;
    end if;
    raise notice '~~~!!!!!!!!!!! 1';
    select for_individual into _for_individual from auct_commission
      where id_profile_sel = p_id_profile_sel
        and id_profile_group_buy is null;
    if(_for_individual is null) then
      raise notice '~~~!!!!!!!!!!! 2';
      return carl_comm.getParameter('commission_for_individual')::int;
    else
      raise notice '~~~!!!!!!!!!!! 3';
      return _for_individual;
    end if;
  end if;

  return 0;
--   raise exception using message=_getMessage('AUCT_PROF_NOT_COMPANY_NOT_INDIVIDUAL')||coalesce(p_id_profile_buy::varchar,'NULL')
--       , errcode=_getErrcode('AUCT_PROF_NOT_COMPANY_NOT_INDIVIDUAL');
end
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Возвращает коммисию продажи для аукциона p_id_auction если она установлена для аукциона
--  иначе продавца с p_id_profile_sel для покупателя с p_id_profile_buy
--  если были заданы значения комиссии как null - то вернутся системные параметры
--
--  09.12.2020 Добавлен учет продаж от брокеров
--
--  Исключения: AUCT_PROF_NOT_COMPANY_NOT_INDIVIDUAL
--  Пример:
--  select _is_company(275);
--  select _is_individual(275);
--  select carl_prof.isVip(3);
--  select carl_auct.getAuctCommission(3, 3, 20000);
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctCommission(p_id_profile_sel int, p_id_profile_buy int
  , p_id_auction int)
	returns int
security definer as $$
declare

  _commission_indiv int; _commission_comp int;
  _commission_bro int;
  _commission_b int;
  _discount_perc int;
  _id_broker int;
begin

  -- подброкер?
  select b.id_broker into _id_broker
    from carl_data.profile p, carl_data.broker b
    where p.id_broker = b.id_broker
      and id_profile = p_id_profile_buy;
  if(_id_broker is not null) then
    select commission, discount_perc into _commission_b, _discount_perc
      from broker where id_broker = _id_broker;
    -- return _carl_commission - coalesce(_discount,0) + coalesce(_commission);
    _commission_indiv := carl_auct._getAuctCommissionWithoutBroker(p_id_profile_sel, -1, p_id_auction);
    return _commission_indiv + _commission_b;
  end if;

  -- брокер?
  select id_broker into _id_broker
    from carl_data.broker b
    where id_profile_owner = p_id_profile_buy;
  if(_id_broker is not null) then
    select commission, discount_perc into _commission_b, _discount_perc
      from broker where id_broker = _id_broker;
    _commission_comp := carl_auct._getAuctCommissionWithoutBroker(p_id_profile_sel, -2, p_id_auction);
    _commission_bro := floor(_commission_comp* (1. - _discount_perc/100.)/10.)*10;
    return _commission_bro ;
  end if;

  return carl_auct._getAuctCommissionWithoutBroker(p_id_profile_sel, p_id_profile_buy, p_id_auction);

end
$$ language plpgsql;


/*
Изменить переменную Скидка. Сейчас она указывается в руб., а надо, чтобы она указывалась в %

КВ для подброкера. comission_indiv + Наценка(broker.commision)
КВ для брокера. comission_comp*(1 - Скидка %(discount_perc) ). Округляем до 10 руб. в сторону уменьшения
*/
-- TODO: Удалить, устарела
----------------------------------------------------------------------------------
--  Возвращает все варианты комиссий для аукциона p_id_auction
--  select carl_auct.getAuctCommissionJ(2000);
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctCommissionJ(p_id_auction int)
	returns json
security definer as $$
declare
  _commission_b int; _discount_perc int;
  _commission_comp int; _commission_indiv int; _id_profile_sel int;
  _commission_princ int; _commission_bro int;
begin

  _id_profile_sel := carl_auct._get_auct_seller_id(p_id_auction);
  _commission_comp := carl_auct._getAuctCommissionWithoutBroker(_id_profile_sel, -2, p_id_auction);
  _commission_indiv := carl_auct._getAuctCommissionWithoutBroker(_id_profile_sel, -1, p_id_auction);

  select commission, discount_perc into _commission_b, _discount_perc from broker limit 1; -- пока только для одного брокера

  _commission_princ := _commission_indiv + _commission_b;
  _commission_bro := floor(_commission_comp* (1. - _discount_perc/100.)/10.)*10;

  return jsonb_build_object('company',_commission_comp
    , 'individual', _commission_indiv
    , 'principal', _commission_princ
    , 'broker',_commission_bro );
end
$$ language plpgsql;


drop function if exists carl_auct.getAuctLeaderCommission2(p_id_profile_sel int, p_id_auction int);
drop function if exists carl_auct.getAuctLeaderCommission2(p_id_auction int);

----------------------------------------------------------------------------------
--  Возвращает коммисию продажи для аукциона p_id_auction если она установлена для аукциона,
--  иначе продавца для покупателя который берется по лидеру
--  если были заданы значения комиссии как null - то вернутся системные параметры
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctLeaderCommission2(p_id_auction int)
	returns int
security definer as $$
  select carl_auct.getAuctCommission(_get_auct_seller_id(p_id_auction), _get_auct_leader_2(p_id_auction), p_id_auction);
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает коммисию продажи для аукциона p_id_auction
--  select getAuctCommissionByIdAuct(14178);
--  select getSellerProfId(371);
--  select carl_auct.getAuctCommission( getSellerProfId(371), 76, 371);
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctCommissionByIdAuct(p_id_auction int)
	returns int
security definer as $$
declare
  _id_profile_buy int;
begin

  _id_profile_buy := getAuctLeaderIdProf(p_id_auction);

  raise notice '~~~ _id_profile_buy %',_id_profile_buy;
  if(_id_profile_buy is null) then
    return 0;
  end if;

  -- return carl_auct.getAuctCommission( getSellerProfId(p_id_auction), _id_profile_buy, p_id_auction);
  return (carl_auct.getAuctCommissionTariffJ(p_id_auction
              , _get_auct_leader(p_id_auction))#>>'{buyer,current_commission}')::int;

end
$$ language plpgsql;


drop function if exists carl_auct.getAuctCommission2(p_id_auction int);

----------------------------------------------------------------------------------
--  Возвращает коммиссии продажи для аукциона p_id_auction
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctCommission2(p_id_auction int)
	returns table(for_company int, for_individual int)
security definer as $$
  select for_company, for_individual from auct_commission where id_auction = p_id_auction
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает коммиссию продавца для аукциона p_id_auction
----------------------------------------------------------------------------------
create or replace function carl_auct.getSellCommission(p_id_auction int)
	returns int
security definer as $$
declare
  _data json; _ret int;
begin

  select amo_data_out_sel#>>'{data}' into _data from auct_amo_data where id_auction = p_id_auction;

  select f#>>'{seller_commission_sum}' into _ret from json_array_elements(_data) f
    where f#>>'{seller_commission_sum}' is not null ;

  return _ret;
end;
$$ language plpgsql;


DROP FUNCTION  if exists carl_auct.getСompanyReserve(integer,integer);
DROP FUNCTION if exists  carl_auct._getСompanyReserve(integer,integer);

----------------------------------------------------------------------------------
--  Возвращает размер резерва юрика для профиля продавца p_id_profile и объекту p_id_object
----------------------------------------------------------------------------------
create function carl_auct._getСompanyReserve(p_id_profile int, p_id_object int)
	returns int
--security definer 
as $F$
declare
  _ret int;
begin

 select reserv_comp into _ret 
  from 
    objtype_profile_reserve opr, object o
  where  id_profile = p_id_profile
  and o.id_object = p_id_object
  -- and opr.id_object_type = (carl_obj.getObjTypeTopParent(o.id_object_type)->>'id')::integer and opr.is_deleted='N';
  and opr.id_object_type = carl_obj._getObjTypeTopParentId(o.id_object_type) and opr.is_deleted='N';

 if found then 
		return _ret; 
 end if;

 select reserv_comp into _ret 
  from 
    objtype_profile_reserve opr, object o
  where  id_profile  is null 
  and o.id_object = p_id_object
  -- and opr.id_object_type=(carl_obj.getObjTypeTopParent(o.id_object_type)->>'id')::integer and opr.is_deleted='N';
  and opr.id_object_type=carl_obj._getObjTypeTopParentId(o.id_object_type) and opr.is_deleted='N';

 if found then 
		return _ret; 	
 end if;

-- raise exception 'не найден размер резерва для юр. лица  id_profile %, id_object_type %', 
--   	p_id_profile , p_id_object_type; 
 return null;
end;
$F$ language plpgsql;


DROP FUNCTION   if exists  carl_auct.getindivreserve(integer,integer);
DROP FUNCTION   if exists  carl_auct._getindivreserve(integer,integer);

----------------------------------------------------------------------------------
--  Возвращает размер резерва физика для профиля продавца p_id_profile и  объекту p_id_object
----------------------------------------------------------------------------------
create function carl_auct._getIndivReserve(p_id_profile int, p_id_object int)
	returns int
--security definer 
as $F$
declare
  _ret int;
begin

 select reserv_indiv into _ret 
  from 
    objtype_profile_reserve opr, object o
  where  id_profile = p_id_profile
  and o.id_object = p_id_object
  -- and opr.id_object_type=(carl_obj.getObjTypeTopParent(o.id_object_type)->>'id')::integer and opr.is_deleted='N';
  and opr.id_object_type=carl_obj._getObjTypeTopParentId(o.id_object_type) and opr.is_deleted='N';

 if found then 
		return _ret; 
 end if;

 select reserv_indiv into _ret 
  from 
    objtype_profile_reserve opr, object o
  where  id_profile  is null 
  and o.id_object = p_id_object
  -- and opr.id_object_type=(carl_obj.getObjTypeTopParent(o.id_object_type)->>'id')::integer and opr.is_deleted='N';
  and opr.id_object_type=carl_obj._getObjTypeTopParentId(o.id_object_type) and opr.is_deleted='N';

 if found then 
		return _ret; 	
 end if;

--raise exception 'не найден размер резерва для физ. лица  id_profile %, id_object_type %', 
--  	p_id_profile , p_id_object_type; 
return null; 

end;
$F$ language plpgsql;


----------------------------------------------------------------------------------
--  Устанавливает размер резервов p_reserv_comp p_reserv_indiv
--  для  профиля продавца p_id_profile и типа объекта p_id_object_type  
--  если какой то из p_reserv_comp p_reserv_indiv передается null 
--  то значение заполняется из таблицы параметров  parameter
-- 	возвращает id_objtype_profile таблицы 
----------------------------------------------------------------------------------
create or replace function ChangeObjtypeProfileReserve( p_id_object_type integer, p_id_profile integer,  p_reserv_comp integer, p_reserv_indiv integer)
	returns int
--security definer 
as $F$
declare
  _ret int; _id int; _default_reserv_comp int;  _default_reserv_indiv int;
begin
	
	if p_id_object_type is null then 
	raise exception 'Укажите тип объекта для изменения';
	end if;

	----------------------------------------------------------------------------------
	-- если то меняем дефолтное занчения для типа ТС 
	-----------------------------------------------------------------------------------
	if p_id_profile is null then
		update objtype_profile_reserve 
			set reserv_comp = coalesce(p_reserv_comp,0), 
			reserv_indiv = coalesce(p_reserv_indiv,0) 
			where id_profile is null and id_object_type=p_id_object_type
			and is_deleted = 'N';

		return 0; 
	end if; 


/*
	select carl_comm.getParameter('reserv_comp')::int, carl_comm.getParameter('reserv_indiv')::int
		into _default_reserv_comp, _default_reserv_indiv; 
	
--	если p_reserv_comp и p_reserv_indiv равны дефолтным то возвращаем дефолтную запись для это типа объекта 
--  с учетом того что такая запись есть для этих сумм и типа 	
	if ( coalesce (p_reserv_comp,_default_reserv_comp) = _default_reserv_comp and coalesce (p_reserv_indiv,_default_reserv_indiv) = _default_reserv_indiv ) 
	then 
	 select id_objtype_profile into _ret 
	 from objtype_profile_reserve
		where id_object_type = p_id_object_type and id_profile is null
			and reserv_comp = _default_reserv_comp and reserv_indiv = _default_reserv_indiv
			and is_deleted ='N'
		; 
--  нашли, сначала удаляем если есть запись возвращаем дефолтный id для этого типа объекта и профиля
	 	if found then  
	 		update objtype_profile_reserve set is_deleted ='Y' 
	 		where id_object_type = p_id_object_type 
	 		and id_profile = p_id_profile;
 			return _ret;  
 		end if; 	 
	end if; 
*/

--	если один из p_reserv_comp или p_reserv_indiv равен null,
--  то этот null заменяем дефолтным значением
	select reserv_comp, reserv_indiv into _default_reserv_comp, _default_reserv_indiv
 	    from objtype_profile_reserve opr
 	    where is_deleted ='N' and id_profile is null  and id_object_type = p_id_object_type;
		   

-- 	типа UPSERT
	insert into objtype_profile_reserve (id_object_type, id_profile, reserv_comp, reserv_indiv) 
	values (p_id_object_type, p_id_profile,  coalesce (p_reserv_comp, _default_reserv_comp), coalesce (p_reserv_indiv, _default_reserv_indiv)  )
	on conflict (id_object_type, id_profile, is_deleted)
	WHERE ((is_deleted)::text = ('N'::character varying(1))::text)
	do update 
	set reserv_comp =  coalesce (p_reserv_comp, _default_reserv_comp), 
	reserv_indiv =  coalesce (p_reserv_indiv, _default_reserv_indiv)
	returning id_objtype_profile into _ret;

	return _ret;

end;
$F$ language plpgsql;


create or replace function removeObjtypeProfileReserve(p_id_object_type integer, p_id_profile integer)
    returns int
--security definer 
as
$F$
declare
    _ret int;
begin

    if p_id_object_type is null or p_id_profile is null then
        raise exception 'Укажите тип объекта и профиль для удаления исключения по резерву';
    end if;

    update objtype_profile_reserve
    set is_deleted ='Y'
    where id_object_type = p_id_object_type
      and id_profile = p_id_profile
      and is_deleted = 'N'
    returning id_objtype_profile into _ret;
    return _ret;
end;
$F$ language plpgsql;


drop function if exists carl_auct._createNewAuction(
    p_seller_name varchar, p_auction_type varchar, p_id_object int, p_id_user_profile int
    , p_dt_start timestamp, p_dt_end timestamp
    , p_step int, p_buy_now int
    , p_min_price int, p_start_price int
    , p_source_url varchar
    , p_reserv_comp int
    , p_reserv_indiv int
    , p_approve_days int
    , p_who_can_buy int
    , p_expert_cert varchar
    , p_update_expert_cert boolean
    , p_is_open_counter  boolean
);

drop function if exists carl_auct._createNewAuction(
	p_seller_name varchar
  , p_auction_type varchar
  , p_id_object int
  , p_id_user_profile int
  , p_dt_start timestamp
  , p_dt_end timestamp
  , p_step int
  , p_buy_now int
  , p_min_price int
  , p_start_price int
  , p_source_url varchar
  , p_reserv_comp int
  , p_reserv_indiv int
  , p_approve_days int
  , p_who_can_buy int
  , p_expert_cert varchar
  , p_update_expert_cert boolean
  , p_is_open_counter  boolean
  , p_reduce_start_price  boolean
	);


----------------------------------------------------------------------------------
-- AUCT.NEW
--  Создание аукциона для ...
--  Возвращает: id_auction нового аукциона
--  Исключения: NO_SUCH_AUCTION_TYPE, STEP_MUST_BE_FOR_OPEN_AUCTION
--  Пример:
----------------------------------------------------------------------------------
create or replace function carl_auct._createNewAuction(
	p_seller_name varchar
  , p_auction_type varchar
  , p_id_object int
  , p_id_user_profile int
  , p_dt_start timestamp
  , p_dt_end timestamp
  , p_step int default null
  , p_buy_now int default null
  , p_min_price int default null
  , p_start_price int default null
  , p_source_url varchar default null
  , p_reserv_comp int default null
  , p_reserv_indiv int default null
  , p_approve_days int default null
  , p_who_can_buy int default null
  , p_expert_cert varchar default null
  , p_update_expert_cert boolean default true
  , p_is_open_counter  boolean default false
  , p_reduce_start_price  boolean default false
	)
	returns int
security definer as $$
declare
  _id_auction   int;
  _cnt int; _s varchar;
  _at en_auction_type;
  _reserv_comp int := p_reserv_comp; _reserv_indiv int := p_reserv_indiv;
  _id_profile int; _id_workflow varchar;
  _can_run varchar; _draft json;
begin
  -- raise notice '~~~ _createNewAuction() -1-_createNewAuction p_id_user_profile: % ', p_id_user_profile;

  if(_reserv_comp is null) then
    select carl_auct._getСompanyReserve(p.id_profile, p_id_object) into _reserv_comp 
    from profile p, user_profile up  
    where
      p.is_deleted = 'N' and up.is_deleted = 'N'
      and up.id_profile = p.id_profile
      and up.id_user_profile = p_id_user_profile;
    if(_reserv_comp is null) then
      _reserv_comp := carl_comm.getParameter('reserv_comp')::int;
    end if;
  end if;

  if(_reserv_indiv is null) then
    select carl_auct._getindivreserve(p.id_profile, p_id_object) into _reserv_indiv  
    from profile p, user_profile up 
    where
      p.is_deleted = 'N' and up.is_deleted = 'N'
      and up.id_profile = p.id_profile
      and up.id_user_profile = p_id_user_profile;
    if(_reserv_indiv is null) then
      _reserv_indiv := carl_comm.getParameter('reserv_indiv')::int;
    end if;
  end if;

  begin
     _at := upper(p_auction_type)::en_auction_type;
  exception when others then
     raise exception using message=_getMessage('NO_SUCH_AUCTION_TYPE')||coalesce(p_auction_type::varchar,'NULL')
              , errcode=_getErrcode('NO_SUCH_AUCTION_TYPE');
  end;

  select count(*) into _cnt from user_profile where id_user_profile = p_id_user_profile;
  if(_cnt = 0) then
			raise exception using message=_getMessage('NO_USER_PROFILE')||coalesce(p_id_user_profile::varchar,'NULL')
                , errcode=_getErrcode('NO_USER_PROFILE');
  end if;

  -- костыль-проверка для лотов из АМО
  if(_at = 'OPEN'::en_auction_type and p_start_price is null) then
    p_start_price := 0;
  end if;

  select p_id_profile into _id_profile  from carl_prof.getiduseridprofile(p_id_user_profile);
  _id_workflow := carl_wf.getDefaultProfileWorkflow(_id_profile)->>'id_workflow';

  -- если p_is_open_counter то принудительно выставляем p_approve_days = 1 -- FIXME: БРАТЬ ИЗ НАСТРОЕК!
  insert into auction (seller_name, auction_type,id_object,id_user_profile,dt_start,dt_end
	, step,buy_now,min_price,start_price,source_url,reserv_comp,reserv_indiv,id_workflow
    , approve_days, dt_approve) values
	(p_seller_name,_at,p_id_object,p_id_user_profile,p_dt_start,p_dt_end,p_step
	,p_buy_now,p_min_price,p_start_price,p_source_url,_reserv_comp,_reserv_indiv,_id_workflow
     , case when p_is_open_counter then null else p_approve_days end  -- null чтобы сработал тригер!
     , case when p_is_open_counter then p_dt_end + interval '1 day' else null end)
	returning id_auction into _id_auction;

  -- костылики для фольксов hide_auct_hist, is_vw
  -- для фольксов запрещаем выставлять контры
  if(_id_workflow = 'VW_AUCTION') then
      perform carl_auct.setAuctParameter(_id_auction,'{"hide_auct_hist":true}');
      perform carl_auct.setAuctParameter(_id_auction,'{"is_vw":true}');
  elsif(_id_workflow = 'LP_AUCTION') then
      perform carl_auct.setAuctParameter(_id_auction,'{"is_lp":true}');
  else
      if(p_is_open_counter) then
          perform carl_auct.setAuctParameter(_id_auction,'{"is_open_counter":true}');
      end if;
  end if;

  if(p_reduce_start_price) then
    perform carl_auct.setAuctParameter(_id_auction,'{"reduce_start_price":true}');
  end if;

  if(p_who_can_buy is not null) then
    perform carl_auct.setAuctWhoCanBuy(_id_auction,p_who_can_buy);
  else
    perform carl_auct.setAuctWhoCanBuy(_id_auction
        , carl_prof.getProfWhoCanBuy(_id_profile));
  end if;

  if(p_update_expert_cert) then
    -- признак expert_cert оставляем как он пришел из пользовательского интерфейса
    if(p_expert_cert is null) then
      _s := carl_prof.getProfParameter(_id_profile,'{expert_cert}','N');
    else
      _s = p_expert_cert;
    end if;

    perform carl_auct.updateAuctObjAttribByIdObj(p_id_object,'expert_cert','"'||_s||'"');
  end if;

  perform carl_auct.setAuctTagAsProf(_id_auction, _id_profile, 1003);

  select draft#>>'{car,properties,can_run}', draft  -- Не на ходу;
    into _can_run, _draft
    from car_draft
    where id_auction = _id_auction;

  -- выставляем метки(тэги) автоматически
  perform carl_auct._calcAndSetAuctLabel(_id_auction);

  -- perform carl_auct.setAuctWcbAsProf(_id_auction, _id_profile, 1003);
  -- выставляем комиссию как в профиле продавца
  -- перешли на тарификатор perform carl_auct.setAuctCommissionAsProf(_id_auction);
  -- выставляем комиссию для групп профилей
  -- перешли на тарификатор perform carl_auct.setAuctCommissionForProfGroup(_id_auction);

  -- выставляем отсрочку платежа как профиле продавца
  perform carl_auct.setAuctPayDelayAsProf(_id_auction);

  if(_reserv_comp is null and _reserv_indiv is null) then
    perform carl_auct.setReservCompIndivAsProf(_id_auction);
  end if;

  -- выставляем user_sort_prior как на профиле продавца
  perform carl_auct.setUserSortPriorAsProf(_id_auction);

  return _id_auction;
end
$$ language plpgsql;


-- drop function if existscarl_auct._createNewAuctionJb(p_jb jsonb);

----------------------------------------------------------------------------------
--  Создание аукциона для .
--  Возвращает: id_auction нового аукциона
--  Исключения: NO_SUCH_AUCTION_TYPE
--  Пример:
----------------------------------------------------------------------------------
create or replace function carl_auct._createNewAuctionJb(p_jb jsonb
  , p_update_expert_cert boolean default true)
	returns int
security definer as $$
	select carl_auct._createNewAuction(
		p_jb#>>'{auction,seller}', p_jb#>>'{auction,auction_type}'
		, (p_jb#>>'{auction,id_object}')::int, (p_jb#>>'{auction,id_user_profile}')::int
		, to_timestamp((p_jb#>>'{auction,dt_start}')::int)::timestamp without time zone
		, to_timestamp((p_jb#>>'{auction,dt_end}')::int)::timestamp without time zone
		, (p_jb#>>'{auction,step}')::int
		, (p_jb#>>'{auction,buy_now}')::int, (p_jb#>>'{auction,min_price}')::int
		, (p_jb#>>'{auction,start_price}')::int
		, p_jb#>>'{auction,source_url}'
		-- , (p_jb#>>'{auction,balance_reserv_sum}')::int
		, (p_jb#>>'{auction,reserv_comp}')::int
		, (p_jb#>>'{auction,reserv_indiv}')::int
    , (p_jb#>>'{auction,approve_days}')::int
    , (p_jb#>>'{auction,who_can_buy}')::int
    , (p_jb#>>'{car,properties,expert_cert}')
    , p_update_expert_cert
    , (p_jb#>>'{auction,is_open_counter}')::boolean
    , (p_jb#>>'{auction,reduce_start_price}')::boolean
  )
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает кол-во ставок по аукциону c p_id_auction
--  Пример:
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctBidCount(p_id_auction int)
	returns int
security definer as $$
  select bid_count from auction where is_deleted = 'N' and id_auction = p_id_auction
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает кол-во ставок по аукциону c p_id_auction
--  Пример:
----------------------------------------------------------------------------------
-- create or replace function carl_auct._getAuctBidCount(p_id_auction int)
-- 	returns bigint
-- security definer as $$
--   select coalesce(bid_count::bigint, 0) from auction where is_deleted = 'N' and id_auction = p_id_auction
-- $$ language sql;


----------------------------------------------------------------------------------
--  Возвращает кол-во ставок по аукциону
--  Пример:
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctBidCount(p_id_auction int)
	returns bigint
security definer as $$
  -- select count(*) from carl_auct._getAuctionHistorySel(p_id_auction) as j where j#>>'{ot}' in ('MAKE_BID','AUTO_BID','BUYNOW')
  select count(*) from auction_log where id_auction = p_id_auction
    and event_type in ('MAKE_BID','AUTO_BID','BUYNOW')
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает кол-во ставок по аукциону + 1
--  TODO: Используется в makeBid() как временное решение
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctBidCountPlus1(p_id_auction int)
	returns bigint
security definer as $$
  select _getAuctBidCount(p_id_auction) + 1
  -- select 1 + 1
$$ language sql;


----------------------------------------------------------------------------------
--  Обновляет кол-во ставок в аукционе
--  Пример: select carl_auct.updateAuctBidCount(2093);
----------------------------------------------------------------------------------
create or replace function carl_auct.updateAuctBidCount(p_id_auction int)
	returns void
security definer as $$
  update auction set bid_count =
    carl_auct._getAuctBidCount(id_auction)
      where is_deleted = 'N'
        and (p_id_auction is null or id_auction = p_id_auction);
$$ language sql;


-- drop function if exists carl_auct._getAuctDataByIdJb(int,int,int,varchar);
drop function if exists carl_auct._getauctdatabyidjb(integer, integer, integer);
drop function if exists carl_auct._getauctbiddatajb(integer, integer, integer, character varying);



-- drop function if existscarl_auct._getAuctInfoByObjIdJb(p_id_object int);

/*----------------------------------------------------------------------------------
--  Возвращает информацию по аукционам с объектом с p_id_object
--  Возвращает:
--  Исключения:
--  Пример:
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctInfoByObjIdJb(p_id_object int)
	returns setof jsonb
security definer as $$
	select _getAuctDataByIdJb(id_auction, null, null, null) from auction where id_object = p_id_object
$$ language sql;
*/

----------------------------------------------------------------------------------
--  Возвращает объект аукциона с p_id_auction
--  Исключения:
--  Пример: select _getAuctObject(100);
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctObject(p_id_auction int) --{
	returns jsonb
security definer as $$
	select av.values from auction a, obj_attrib_values av where
    av.id_object = a.id_object and a.id_auction = p_id_auction
    and a.is_deleted = 'N'
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает id объекта аукциона с p_id_auction
--  Исключения:
--  Пример:
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctIdObject(p_id_auction int) --{
	returns int
security definer as $$
	select a.id_object from auction a where
    a.id_auction = p_id_auction and is_deleted = 'N'
$$ language sql;


------------------------------------------------------------------------------------------------------------------------
-- Является ли профиль p_id_profile лидером аукциона p_id_auction
-- Пример:
--   select carl_auct._is_prof_leader(127,11210);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._is_prof_leader(p_id_profile int, p_id_auction int)
returns boolean
security definer as $$
  select count(*) > 0 from auction a, auction_bid ab
  where ab.id_auction = a.id_auction
    and ab.id_user_profile in
        (select id_user_profile from user_profile where id_profile = p_id_profile)
    and ab.bid_status = 'LEAD'
    and a.id_auction = p_id_auction
$$ language sql;


-- drop function if existscarl_auct._is_buyer_wait_solution(p_id_user int
--  , p_id_profile int, p_id_auction int);

------------------------------------------------------------------------------------------------------------------------
-- Ожидает ли покупатель решения по аукциону (p_id_auction)
-- Пример:
--   select carl_auct._is_buyer_wait_solution(7,17,83);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._is_buyer_wait_solution(p_id_user int
  , p_id_profile int, p_id_auction int)
returns boolean
security definer as $$
    select carl_auct._is_prof_leader(p_id_profile, p_id_auction)
    from carl_data.auction a
    where a.status = 'FINISHED'
      and a.id_auction = p_id_auction
$$ language sql;


----------------------------------------------------------------------------------
-- Возвращает id_broker для профиля p_id_profile
-- Пример:
--         select _get_id_broker(6244);
----------------------------------------------------------------------------------
create or replace function carl_prof._get_id_broker(p_id_profile int)
	returns int security definer as $$
    select id_broker from carl_data.profile where id_profile = p_id_profile
$$ language sql stable;


------------------------------------------------------------------------------------------------------------------------
-- Ожидает ли мой физик решения по аукциону (p_id_auction)
-- Пример:
--   select carl_auct._is_my_phys_wait_solution(11,83);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._is_my_phys_wait_solution(p_id_broker int, p_id_auction int)
returns boolean
security definer as $$
  select carl_prof._get_id_broker(carl_auct._get_auct_leader(p_id_auction)) = p_id_broker
    from carl_data.auction a
      where a.status = 'FINISHED'
      and a.id_auction = p_id_auction
$$ language sql stable ;


------------------------------------------------------------------------------------------------------------------------
-- Есть ли доступные действия пользователю p_id_user профилю p_id_profile в текущем статусе wf в аукционе p_id_auction
-- select carl_auct._is_need_action(7,16, 17867);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._is_need_action(p_id_user int
  , p_id_profile int, p_id_auction int)
returns boolean
security definer as $$
declare
  _j_out_actions json;
  _cnt int;
begin
    select array_to_json(array_agg(row(t.*))) into _j_out_actions
      from (select carl_wf.getUserActions(p_id_user, p_id_profile, p_id_auction)) t;

  _cnt := json_array_length(_j_out_actions);
  if (_cnt > 0) then
    return true;
  end if;

  return false;
end;
$$ language plpgsql;




-- drop function if existscarl_auct._getNotHideAuctHist(p_id_user int, p_id_profile int, p_id_auction int, p_is_vw boolean);
-- drop function if existscarl_auct._isVisibleAuctHist(p_id_user int, p_id_profile int, p_id_auction int, p_is_vw boolean);

----------------------------------------------------------------------------------
-- AUCT.HIDE.HIST
--  Возвращает признак возможности пользователю p_id_user
--  с профилем p_id_profile просмотра ХТ аукциона p_id_auction
-- для админа всегда
-- для продавца если не WV и если это лот его профиля
-- для покупателя(по роли) если не WV
--  Пример:
-- select * from carl_auct._isVisibleAuctHist(1,1,1,false);
-- select * from carl_auct._isVisibleAuctHist(1,12,1);
-- select * from carl_auct._isVisibleAuctHist(6141,1050,15036 );
----------------------------------------------------------------------------------
create or replace function carl_auct._isVisibleAuctHist(p_id_user int, p_id_profile int, p_id_auction int, p_is_vw boolean default false)
	returns boolean
security definer as $$
declare
  _is_admin boolean;
begin
    _is_admin := carl_auth._is_admin(p_id_user);

     -- админ видит всегда
     if(_is_admin) then
       return true;
     end if;

     -- если WV то никогда
     if(p_is_vw) then
       return false;
     end if;

     -- продавец видит свои
     if(carl_auct._is_seller_of_auct(p_id_profile,p_id_auction)) then
       return true;
     end if;

--     -- покупатель видит все где есть его ставки
--      _cnt := carl_auct._getNumAuctBids(p_id_profile, p_id_auction);
--      if(_cnt > 0) then
--        return true;
--      end if;

  -- для покупателя(по роли) если не WV
  if(carl_prof.hasRole(p_id_profile,'buyer') = 'Y') then
      return true;
  end if;

  return false;
end;
$$ language plpgsql;



----------------------------------------------------------------------------------
-- Возвращает вычисденный признак hide_auct_hist по аукциону p_id_auction для
-- p_id_user, p_id_profile
----------------------------------------------------------------------------------
create or replace function carl_auct.isHideAuctHist(p_id_user int, p_id_profile int, p_id_auction int)
	returns boolean
security definer as $$
declare
  _is_vw boolean;
begin
  _is_vw := carl_auct.getAuctParameterB(p_id_auction,'{is_vw}',false);
  return not carl_auct._isVisibleAuctHist(p_id_user, p_id_profile, p_id_auction, _is_vw);
end;
$$ language plpgsql;


-- drop function if existscarl_auct.getAuctById(p_id_user int, p_id_profile int, p_id_auction int, p_roles varchar
--  , p_calc_n_view boolean);

----------------------------------------------------------------------------------
-- AUCT.CARD
-- #КАРТОЧКА_АУКЦИОНА
--
-- Возвращает карточку лота аукциона p_id_auction
-- для админа всегда
-- для продавца если это лот его профиля или лот активный
-- для покупателя если есть его ставки по этому лоту или лот активный
-- для брокера когда есть ставки его физов и они лидируют
--  Пример:
-- select * from carl_auct.getAuctById(3,17,5361,'admin,seller,buyer');
-- select * from carl_auct.getAuctById(1,9,1,'+admin,seller,+buyer');
-- select * from carl_auct.getAuctById(19,87,1540,'+dmin,+eller,+uyer');
-- TODO: убрать лишний параметр p_roles
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctById(p_id_user int, p_id_profile int, p_id_auction int, p_roles varchar
  , p_calc_n_view boolean default false)
	returns json
security definer as $$
declare
	_jb_out jsonb; _jb_car jsonb; _jb_auct jsonb; _jb_bid jsonb; _jb_draft_face_rest jsonb;
  _auction auction%rowtype; _show boolean := false; _cnt int;
  _ar varchar[];
  _ip varchar; _ip_name varchar; _status en_prof_status;
  _is_seller boolean; _is_buyer boolean; _is_admin boolean; _id_broker int;
  _leader varchar; _dt_demo timestamptz;
begin
    _is_seller := carl_prof.hasRole(p_id_profile,'seller') = 'Y';
    _is_buyer := carl_prof.hasRole(p_id_profile,'buyer') = 'Y';
    _is_admin := carl_auth._is_admin_or_manager(p_id_user)
        or carl_prof.hasRole(p_id_profile,'auctioneer') = 'Y';

    select * into _auction from auction where id_auction = p_id_auction
          -- and not (p_id_user = 0 and p_id_profile = 0 and status <> 'ACTIVE')
          and is_deleted = 'N';
    if( _auction.id_auction is null) then
      return null;
    end if;

    -- Активные видят все остальные по старой логике
    if( _auction.status = 'ACTIVE') then
        _show := true;
    end if;

    if(p_calc_n_view) then
      if(not _is_admin
        and not carl_auct._is_seller_of_auct(p_id_profile,p_id_auction)) then
        update carl_data.auction set n_views = n_views + 1 where id_auction = p_id_auction;
      end if;
      select ip, ip_name into _ip, _ip_name from user_login where id_user = p_id_user order by id_user_login desc limit 1;
      insert into carl_data.auction_nview (id_user, id_profile, id_auction, ip, ip_name) values
        (p_id_user, p_id_profile, p_id_auction, _ip, _ip_name);
    end if;

    _ar = string_to_array(p_roles,',');

     -- админ видит всегда
     if(_is_admin) then -- cardinality(array_positions(_ar,'admin')) > 0) then
       _show = true;
     end if;

     -- не админ, но продавец видит свои
     --    и все активные аукционы, которые разрешено покупать
     if(not _show and _is_seller /*cardinality(array_positions(_ar,'seller')) > 0*/) then
       -- raise notice 'seller';
       _show := carl_auct._is_seller_of_auct(p_id_profile,p_id_auction);
 	   _show := _show
                  or (_auction.status = 'ACTIVE'::en_auction_status
                    and carl_auct._canProfBuy(p_id_profile, p_id_auction));
     end if;

     -- не админ, но покупатель видит все где есть его ставки
     --    и все активные аукционы, которые разрешено покупать
     if(not _show and _is_buyer /*cardinality(array_positions(_ar,'buyer')) > 0*/) then
       -- raise notice 'buyer';
       _cnt := carl_auct._getNumAuctBids(p_id_profile, p_id_auction);
       _show := _cnt > 0
                or (_auction.status = 'ACTIVE'::en_auction_status
                    and carl_auct._canProfBuy(p_id_profile, p_id_auction));
     end if;

    -- Если нет роли но есть dt_demo и она не истекла то пускаем
    select status, dt_demo
        into _status, _dt_demo
        from profile
        where id_profile = p_id_profile
            and is_deleted = 'N';

     -- не админ, не покуп и не продав но профиль 'ок' (TEMP профиль)
     -- и не истек демо период
    -- и статус ACTIVE и может видеть
     if(not _show
        and not _is_seller
        and not _is_buyer
        and _status = 'ok'::en_prof_status
        and (_dt_demo is not null and now() < _dt_demo)
        and (_auction.status = 'ACTIVE'::en_auction_status
             and carl_auct._canProfBuy(p_id_profile, p_id_auction))
        ) then
       _show := true;
     end if;

     -- для брокера когда есть ставки его физов и они лидируют
     if(not _show) then
      select id_broker into _id_broker
          from carl_data.broker
          where id_profile_owner = p_id_profile;

      select count(*) > 0 into _show
         from carl_data.auction_bid ab
           , carl_data.user_profile up
           , carl_data.profile p

         where ab.id_user_profile = up.id_user_profile
            and up.id_profile = p.id_profile
            and ab.id_auction = p_id_auction
            -- если отцепили оставляем привязку and up.is_deleted = 'N'
            and ab.is_deleted = 'N'
            and ab.bid_status = 'LEAD'
            and p.id_broker = _id_broker;
     end if;

    -- уходим если нельзя видеть карточку
    -- if(not (p_id_profile = 0 and p_id_user = 0) and not _show) then
    if(not _show) then
      return null;
    end if;

    _jb_car  := carl_lot._getLotDataByIdJb(_auction.id_object);
    _jb_auct := carl_auct._getAuctDataByIdJb(p_id_auction, p_id_user, p_id_profile);
    _jb_bid  := carl_auct._getAuctBidDataJb(p_id_user, p_id_profile, p_id_auction);
    if((_jb_auct#>>'{auction,is_vw}')::boolean) then
      _leader := carl_prof.getprofsmartnameIdivDkp(_get_auct_seller_id(p_id_auction), _get_auct_leader(p_id_auction));
      _jb_auct := jsonb_set(_jb_auct, '{auction,leader}'::text[], to_jsonb(_leader), true);
    end if;

    if(_jb_bid is null) then
        _jb_bid := '{"bid":{}}'::jsonb;
    end if;

    select cd.draft_face::jsonb - 'car' - 'auction' into _jb_draft_face_rest
          from car_draft cd
          where id_auction = p_id_auction
          order by id_auction_draft desc
          limit 1;

		_jb_out := _jb_car || _jb_auct || _jb_bid || coalesce(_jb_draft_face_rest, '{}'::jsonb);
		return _jb_out::json;
end;
$$ language plpgsql;


----------------------------------------------------------------------------------
--  AUCT.TAGS.FILTER
--  Возвращает список для выбора в фильтре по аукциону.
--  Возвращает: setof json
--  Исключения:
--  Пример:
--    select * from getSelectListByFilter('{car,characteristics,model}', _s_filter::json)
--    select * from getSelectListByFilter('{tags}', _s_filter::json)
----------------------------------------------------------------------------------
create or replace function carl_auct.getSelectListByFilter(p_search_path varchar, p_filtr_j json)
	returns setof varchar
security definer as $$
declare
	_s varchar; _val varchar; _search_path varchar; t_ar text[];
begin
  if(p_search_path = '{tags,name}') then
    for _val in  (select name from (
     select distinct name,sortnum from carl_data.tag, auction_profile_tag apt
      where apt.id_tag = tag.id_tag and apt.id_auction in (
        select (getAuctListByFilterJ(p_filtr_j, null, 0, 100000, p_search_path)#>>'{auction,id_auction}')::int)
        )t 
      order by sortnum
      )
    loop
      -- return next _val;
      return next carl_auct._translateFromBase(_val);
    end loop;
  elseif (p_search_path = '{leader}') then
      for _val in (
          select (f#>>'{leader}')::varchar || ' (' || (f#>>'{ip_leader}')::varchar || ')'
            from getAuctListByFilterJ(p_filtr_j, null, 0, 100000) f
            order by 1
        )
      loop
        -- return next _val;
        return next carl_auct._translateFromBase( _val);
      end loop;
  else
      if(position('transmission' in p_search_path) > 0) then
          _search_path := replace(p_search_path,'car,','');
          _s := p_search_path;
          -- raise notice '~~~ 79  % %',p_search_path, _search_path;
          for _val in
              select distinct case when s1.f1 in ('Автомат','АКПП','Полуавтомат','Робот','Вариатор') then 'АКПП'
                                   else case when s1.f1 in ('Механика','МКПП','5-ступенчатая механическая КПП')
                                                 then 'МКПП'
                                             else case when s1.f1 in ('МКПП/АКПП') then 'МКПП/АКПП'
                                                       else s1.f1
                                                 end
                                       end
                    end
                from (select distinct (ff #>> '{car, characteristics, transmission}')::text as f1
                    from getAuctListByFilterJ(p_filtr_j, null, 0, 100000) ff) s1
              order by 1
              loop
                 -- return next _val;
                 return next carl_auct._translateFromBase(_val);
              end loop;
        elsif(position('{car,' in p_search_path) = 1) then
          _search_path := replace(p_search_path,'car,','');
          _s := p_search_path;
          -- raise notice '~~~ 79  % %',p_search_path, _search_path;
          for _val in
            -- select distinct getAuctListByFilterJ(p_filtr_j)#>>_s
            select distinct getAuctListByFilterJ(p_filtr_j, null, 0, 100000, _s)->>_search_path
              order by 1
          loop
            -- return next _val;
            return next carl_auct._translateFromBase(_val);
          end loop;
    elsif(position('{auction,auction_type}' in p_search_path) = 1) then
        _s := p_search_path;
        -- raise notice '~~~ 79  % %',p_search_path, _search_path;
        t_ar := p_search_path;
        for _val in
            -- select distinct getAuctListByFilterJ(p_filtr_j)#>>_s
            select distinct * from (select distinct (getAuctListByFilterJ(p_filtr_j, null, 0, 100000, p_search_path) #>>
                                                     t_ar)::varchar
                                    union all
                                    select distinct 'BUYNOW'
                                    from getAuctListByFilterJ(p_filtr_j, null, 0, 100000) as ff
                                    where (ff #>> '{auction,buy_now}')::int > 0
                                    order by 1) s1
            loop
                -- return next _val;
                return next carl_auct._translateFromBase( _val);
            end loop;
    elsif(position('{auction,' in p_search_path) = 1) then
      _s := p_search_path;
      -- raise notice '~~~ 79  % %',p_search_path, _search_path;
      t_ar := p_search_path;
      for _val in
        -- select distinct getAuctListByFilterJ(p_filtr_j)#>>_s
        select distinct (getAuctListByFilterJ(p_filtr_j, null, 0, 100000, p_search_path)#>>t_ar)::varchar
          order by 1
      loop
        -- return next _val;
        return next carl_auct._translateFromBase( _val);
      end loop;
    else
      null;
    end if;
  end if;
end
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Возвращает статус ставки по p_id_auction_bid
----------------------------------------------------------------------------------
create or replace function carl_auct._getBidStatusById(p_id_auction_bid int) --{
	returns en_bid_status security definer as $$
	select bid_status from auction_bid where id_auction_bid = p_id_auction_bid
		and is_deleted = 'N';
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает статус ставки
----------------------------------------------------------------------------------
create or replace function carl_auct._getLastBidStatus(p_id_user int, p_id_profile int, p_id_auction int) --{
	returns en_bid_status security definer as $$
	select bid_status from auction_bid where
		id_user_profile = (select id_user_profile from user_profile
		where is_deleted = 'N' and id_user = p_id_user and id_profile = p_id_profile
			and is_deleted = 'N') and id_auction = p_id_auction
		order by id_auction_bid desc limit 1
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает статус ставки профиля p_id_profile в аукционе p_id_auction
----------------------------------------------------------------------------------
create or replace function carl_auct._getLastBidStatusOfProf(p_id_profile int, p_id_auction int) --{
	returns en_bid_status security definer as $$
	select bid_status from auction_bid where
		id_user_profile in (select id_user_profile from user_profile
		where is_deleted = 'N'
      and id_profile = p_id_profile
			and is_deleted = 'N')
    and id_auction = p_id_auction
		order by id_auction_bid desc limit 1
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает последнюю ставку юзерпрофиля p_id_user_profile в аукционе p_id_auction
--     p_id_user_profile может быть null тогда для всех
--  СОРТИРОВКА ПО dt_set НЕ РАБОТАЕТ!
----------------------------------------------------------------------------------
create or replace function carl_auct._getLastBidByUP(p_id_user_profile int, p_id_auction int) --{
	returns auction_bid security definer as $$
	select *  from auction_bid where is_deleted = 'N'
		and (p_id_user_profile is null or id_user_profile = p_id_user_profile)
		and id_auction = p_id_auction order by id_auction_bid desc limit 1
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает последнюю ставку в аукционе p_id_auction
--  если профиль p_id_profile из профилей этого аукциона
--  СОРТИРОВКА ПО dt_set НЕ РАБОТАЕТ!
----------------------------------------------------------------------------------
create or replace function carl_auct._getLastBidOfProf(p_id_profile int, p_id_auction int) --{
	returns auction_bid security definer as $$
	select ab.*  from auction_bid ab, auction a
    where a.is_deleted = 'N' and ab.is_deleted = 'N'
      and a.id_auction = p_id_auction
      and ab.id_auction = a.id_auction
      and (ab.id_user_profile in
            (select id_user_profile from user_profile where /*is_deleted = 'N' and*/ id_profile = p_id_profile)
           --or a.id_user_profile in
           -- (select id_user_profile from user_profile where is_deleted = 'N' and id_profile = p_id_profile)
      )
    order by id_auction_bid desc limit 1
$$ language sql;


----------------------------------------------------------------------------------
--  Возвращает максимальную ставку в аукционе p_id_auction
----------------------------------------------------------------------------------
create or replace function carl_auct._getMaxBidValueByAuctId(p_id_auction int) --{
	returns int security definer as $$
	select max(bid_value) from auction_bid where is_deleted = 'N'
		and id_auction = p_id_auction
$$ language sql;


----------------------------------------------------------------------------------
-- Проверка что профиль p_id_profile - продавец аукциона p_id_auction
-- select carl_auct._is_seller_of_auct(8,1);
----------------------------------------------------------------------------------
create or replace function carl_auct._is_seller_of_auct(p_id_profile int, p_id_auction int)
  returns boolean security definer as $$
declare
  _id_profile_sel int;
begin

	select id_profile into _id_profile_sel from
    (select id_user, id_profile from user_profile up, auction a
		  where a.id_user_profile = up.id_user_profile
			  --and up.is_deleted = 'N'
			  and a.id_auction = p_id_auction) s;

  if(_id_profile_sel is not null and _id_profile_sel = p_id_profile) then
    return true;
  end if;
  return false;
end $$
language plpgsql;


----------------------------------------------------------------------------------
-- Проверка что p_id_user int, p_id_profile - продавец аукциона p_id_auction
-- select carl_auct._is_seller_of_auct(6,8,1);
----------------------------------------------------------------------------------
create or replace function carl_auct._is_seller_of_auct(p_id_user int, p_id_profile int, p_id_auction int)
  returns boolean security definer as $$
declare
  _id_user_sel int; _id_profile_sel int;
begin

	select id_user, id_profile into _id_user_sel, _id_profile_sel from
    (select id_user, id_profile from user_profile up, auction a
		  where a.id_user_profile = up.id_user_profile
			  --and up.is_deleted = 'N'
			  and a.id_auction = p_id_auction) s;

  if(_id_user_sel is null or _id_profile_sel is null) then
    return false;
  elseif(_id_user_sel = p_id_user and _id_profile_sel = p_id_profile) then
    return true;
  end if;
  return false;
end $$
language plpgsql;


----------------------------------------------------------------------------------
-- Возвращает id_profile продавца аукциона p_id_auction
-- select carl_auct.getSellerProfId(6);
----------------------------------------------------------------------------------
create or replace function carl_auct.getSellerProfId(p_id_auction int)
  returns int security definer as $$
	select up.id_profile from auction a, user_profile up
    where up.id_user_profile = a.id_user_profile
      and a.id_auction = p_id_auction
$$
language sql;


-- drop function if existscarl_auct._getAuctBidDataJb(int, int, int, varchar);

----------------------------------------------------------------------------------
--  Возвращает информацию по ставке аукциона
--  Возвращает:
--  Исключения:
--  Пример: select carl_auct._getAuctDataByIdJb(3,17,1690);
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctBidDataJb(p_id_user int, p_id_profile int, p_id_auction int, p_search_path varchar default null) --{
	returns jsonb security definer as $$
declare
	-- _id int; _bid_status en_bid_status;
  _bid_value int;
	_max_bid_value int;
	_auction auction%rowtype;
	_auction_bid auction_bid%rowtype;
	_id_user_profile int; _jb_out jsonb;
	_jb_err jsonb; _s text;
	_bool boolean;
begin

	select id_user_profile into _id_user_profile from user_profile
		where id_user = p_id_user and id_profile = p_id_profile
			and is_deleted = 'N'
			;

	if(_id_user_profile is null) then
		_s := '{"bid":{"ERROR":"'||_getMessage('NO_SUCH_PROF_FOR_USER')
			|| format(' id_user= %s id_profile= %s',p_id_user, p_id_profile)||'"}}';
		_jb_err := _s::jsonb;
		--raise notice  ' 0-1 !!! %',_s;
		return _s::jsonb;
       --raise exception using message=_getMessage('NO_SUCH_PROF_FOR_USER')
       --         , errcode=_getErrcode('NO_SUCH_PROF_FOR_USER');
	end if;

	select * into _auction from auction where is_deleted = 'N' and id_auction = p_id_auction;

	if(_auction.id_auction is null) then
       raise exception using message=_getMessage('NOT_FOUND_AUCTION_WITH_ID')||coalesce(p_id_auction::varchar,'NULL')
                , errcode=_getErrcode('NOT_FOUND_AUCTION_WITH_ID');
	end if;

  -- пребид
  if(_auction.status = 'ACTIVE' and (current_timestamp < _auction.dt_start or _auction.dt_start is null) ) then
    select bid_value into _bid_value from carl_data.pre_bid where not deleted
      and id_profile = p_id_profile
      and id_auction = p_id_auction;
    if(_bid_value is not null) then
      return jsonb_build_object('bid',jsonb_build_object('proxy_price',_bid_value));
    end if;
  end if;

	_auction_bid := _getLastBidOfProf(p_id_profile, p_id_auction);

	if(_auction.auction_type = 'OPEN'::en_auction_type or _auction.auction_type = 'BUYNOW'::en_auction_type) then
		if(_auction_bid.id_auction_bid is not null) then
			-- юзер участвует в OPEN
			select jsonb_build_object('bid',row_to_json(r)) into _jb_out from
				(select ab.id_auction_bid id_bid_auction
					, ab.bid_status bid_status, ab.bid_value bid_value, ab.proxy_price
					, extract (epoch from ab.dt_set) dt_set from auction_bid ab where
						ab.id_auction_bid = _auction_bid.id_auction_bid) r;
      --raise notice '~~~ 1 %', _jb_out;
        if(_auction.min_price is not null) then
			    _bool := _auction.min_price = _auction.start_price;
  			  _jb_out := jsonb_set(_jb_out,'{bid,min_eq_start}',_bool::varchar::jsonb, true);
        end if;
		else
			-- юзер не участвует в OPEN
      if(_auction.min_price is null) then
        -- _bool := null;
        if(carl_auct._is_seller_of_auct(/*p_id_user,*/ p_id_profile, p_id_auction)) then
          select max(bid_value) into _max_bid_value from auction_bid where is_deleted = 'N'
            and id_auction = p_id_auction;

          select jsonb_build_object('bid',row_to_json(r)) into _jb_out from
            (select _max_bid_value max_bid_value) r;
        end if;
			end if;

			select jsonb_build_object('bid',row_to_json(r)) into _jb_out from
				(select 'NO_BID' bid_status
					from auction_bid ab where
						ab.id_auction_bid = -1) r;
		end if;
	elsif(_auction.auction_type = 'OFFER'::en_auction_type) then

    if(carl_auct._is_seller_of_auct(/*p_id_user,*/ p_id_profile, p_id_auction)) then
      select max(bid_value) into _max_bid_value from auction_bid where is_deleted = 'N'
        and id_auction = p_id_auction;

      select jsonb_build_object('bid',row_to_json(r)) into _jb_out from
        (select _max_bid_value max_bid_value) r;
    else
      if(_auction_bid.id_auction_bid is not null) then
        -- юзер участвует в OFFER
        select jsonb_build_object('bid',row_to_json(r)) into _jb_out from
          (select ab.id_auction_bid id_bid_auction
            , ab.bid_status bid_status, ab.bid_value bid_value
            , extract (epoch from ab.dt_set) dt_set from auction_bid ab where
              ab.id_auction_bid = _auction_bid.id_auction_bid) r;
      else
        -- юзер не участвует в OFFER
        select jsonb_build_object('bid',row_to_json(r)) into _jb_out from
          (select 'NO_BID' bid_status
            from auction_bid ab where
              ab.id_auction_bid = -1) r;
      end if;
    end if;
	end if;
	if(_jb_err is not null) then
		_jb_out := _jb_out || _jb_err;
	end if;
	return _jb_out;
end
$$ language plpgsql;


-- drop function if existscarl_auct.checkActiveAuctionStatusA(p_id_auction int);

----------------------------------------------------------------------------------
--  Проверяет и меняет статус активного как checkActiveAuctionStatus()
--  только в автономной транзакции
--  Пример: select checkActiveAuctionStatusA(null);
----------------------------------------------------------------------------------
create or replace function carl_auct.checkActiveAuctionStatusA(p_id_auction int, p_take_queue boolean)
	returns json security definer as $$
declare
	_sql text;
begin
		begin
			_sql := 'SELECT carl_auct._checkActiveAuctionStatus('|| quote_nullable(p_id_auction) ||','||p_take_queue||')';
			perform pg_background_launch(_sql);
		exception when others then
			raise notice 'EXTENSION pg_background NOT INSTALLED or increase max_worker_processes!';
			perform carl_auct._checkActiveAuctionStatus(p_id_auction, p_take_queue);
		end;
	return '{"result":"success"}'::json;
end
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Обертка moderateToActive() для процессов
--  Пример: select moderateToActive(null);
----------------------------------------------------------------------------------
create or replace function carl_auct.moderateToActiveWF(p_params json)
	returns json security definer as $$
declare
begin
	return json_build_object('result','ok');
end
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Переводит аукцион c p_id_auction из статуса MODERATED в ACTIVE
--    если p_id_auction is null то проверка по всем модерируемым аукционам
--  Возвращает: событие с массивами id_auction для перешедших в состояние
-- 							ACTIVE (ключ - mod2act)
-- 							{ "event":{"mod2act":[1,2,3]}}
--  Исключения:
--  Пример: select moderateToActive(null);
----------------------------------------------------------------------------------
create or replace function carl_auct.moderateToActive(p_id_auction int default null)
	returns json security definer as $$
declare
	_auction auction%rowtype;
	_mod2act int array;
begin
	for _auction in
		select * from auction where is_deleted = 'N'
			and status = 'MODERATED'::en_auction_status
			and (p_id_auction is null or id_auction = p_id_auction)
	loop
		-- if( _auction.dt_start <= clock_timestamp() and _auction.dt_end >= clock_timestamp())	then

      -- проверяем что есть тариф(выбросится exception)
      perform carl_auct.getAuctAvailableTariffsJ(_auction.id_auction);

			update auction set status='ACTIVE', workflow_status='ACTIVE'
        where id_auction = _auction.id_auction;
			_mod2act := _mod2act || array[_auction.id_auction];
			perform _writeAuctLog('ACTIVE'::en_auction_event_type,null,null,null,_auction.id_auction
				,null,null,null,'{"src":"carl_auct.moderateToActive()"}'::json);
		-- end if;
	end loop;
	return json_build_object('event',json_build_object('mod2act',array_to_json(_mod2act)));
end
$$ language plpgsql;


-- drop function if existscarl_auct.moderateToDraft(int);

----------------------------------------------------------------------------------
--  Переводит аукцион c p_id_auction из статуса MODERATED в DRAFT
--  Возвращает:
--  Исключения: AUCT_NO_DRAFT_FOR_AUCTION
--  Пример: select moderateToDraft(1);
----------------------------------------------------------------------------------
create or replace function carl_auct.moderateToDraft(p_id_auction int)
	returns void security definer as $$
declare
  _cnt int;
begin

  select count(*) into _cnt from car_draft
    where is_deleted = 'N' and id_auction = p_id_auction and status = 'LOT';

  if(_cnt = 1) then
  	update auction set status='DRAFT'::en_auction_status, workflow_status='DRAFT'
      where id_auction = p_id_auction;
    update car_draft set status='DRAFT'::en_draft_status where id_auction = p_id_auction and status = 'LOT';

		perform _writeAuctLog('DRAFT'::en_auction_event_type,null,null,null,p_id_auction
				,null,null,null,'{"src":"carl_auct.moderateToDraft()"}'::json);
  else
    raise exception using message=_getMessage('AUCT_NO_DRAFT_FOR_AUCTION')||coalesce(p_id_auction::varchar,'NULL')
       , errcode=_getErrcode('AUCT_NO_DRAFT_FOR_AUCTION');
	end if;
end
$$ language plpgsql;


----------------------------------------------------------------------------------
-- Выполнение команды p_sql на dblink коннекции p_connection_name
--
-- select _db_link_sql('auto_transaction'
--  , 'user=carl password=1  dbname=carlinkng options=-csearch_path='
--  ,null);
-- psql -U postgres -c 'SHOW config_file'
-- 'auto_transaction'
----------------------------------------------------------------------------------
create or replace function carl_auct._db_link_sql(p_connection_name text, p_connection text, p_sql text)
	returns void security definer as $$
declare
  _sql text;
  _conn_ar text[];
begin
    _conn_ar := dblink_get_connections();

    if(coalesce(cardinality(array_positions(_conn_ar, p_connection_name)),0) = 0) then
        perform dblink_connect(p_connection_name, p_connection);
    end if;

    if(p_sql is not null and p_sql <> '') then
        perform dblink(p_connection_name, p_sql);
        -- select id_call_log into _id_call_log from dblink('control_db', _s) as t1(id_call_log int);
    end if;

end
$$ language plpgsql;


drop function if exists carl_auct.writeAuctLogA(p_event_type en_auction_event_type
	, p_id_user int, p_id_profile int, p_id_user_profile int, p_id_auction int
  , p_input_j json, p_output json, p_exception_j json, p_src_j json
  , p_exec_time interval);

----------------------------------------------------------------------------------
--  Запись события аукциона в лог
--  В автономной транзакции
--  Исключения:
----------------------------------------------------------------------------------
create or replace function carl_auct.writeAuctLogA(p_event_type en_auction_event_type
	, p_id_user int, p_id_profile int, p_id_user_profile int, p_id_auction int
  , p_input_j json, p_output json, p_exception_j json, p_src_j json
  , p_exec_time interval default null
  , p_exec_time_php interval default null
  )
	returns void security definer as $$
declare
  _sql text;
  -- _debug_dblink text := 'hostaddr=127.0.0.1 port=5432 user=carl password=1 dbname=carlinkng options=-csearch_path=';
  _connection_name text := 'auto_transaction';
  _debug_dblink text := 'user=carl password=1  dbname=carlinkng options=-csearch_path=';
begin
	if(p_event_type is null) then
		p_event_type = 'EXCEPTION';
	end if;
	if(p_exception_j is not null) then
		begin
			_sql := 'do $sada$ begin perform carl_auct._writeAuctLog('|| quote_nullable(p_event_type)
				||','|| quote_nullable(p_id_user)||','|| quote_nullable(p_id_profile)
				||','|| quote_nullable(p_id_user_profile)||','|| quote_nullable(p_id_auction)
				||','|| quote_nullable(p_input_j)||','|| quote_nullable(p_output)
				||','|| quote_nullable(p_exception_j)||','|| quote_nullable(p_src_j)
				||','|| quote_nullable(p_exec_time)||'); end; $sada$;';
			-- perform pg_background_launch(_sql);

            -- _debug_dblink := mylog._get_parameter('DW_DBLINK_LOCAL','NOT_FOUND');

            perform  _db_link_sql(_connection_name, _debug_dblink, _sql);

		exception when others then
			raise notice 'EXTENSION dblink NOT INSTALLED or increase max_worker_processes!';
-- 			perform carl_auct._writeAuctLog(p_event_type
-- 				, p_id_user, p_id_profile, p_id_user_profile, p_id_auction
-- 				, p_input_j, p_output, p_exception_j, p_src_j,p_exec_time);
		end;
	else
			perform carl_auct._writeAuctLog(p_event_type
				, p_id_user, p_id_profile, p_id_user_profile, p_id_auction
				, p_input_j, p_output, p_exception_j, p_src_j
			    , p_exec_time, p_exec_time_php);
	end if;
end
$$ language plpgsql;


drop function if exists _writeauctlog(p_event_type en_auction_event_type
    , p_id_user integer, p_id_profile integer, p_id_user_profile integer, p_id_auction integer
    , p_input_j json, p_output json, p_exception_j json, p_src_j json, p_exec_time interval);

----------------------------------------------------------------------------------
--  Запись события аукциона в лог
--  Исключения:
----------------------------------------------------------------------------------
create or replace function carl_auct._writeAuctLog(p_event_type en_auction_event_type
	, p_id_user int, p_id_profile int, p_id_user_profile int, p_id_auction int
  , p_input_j json, p_output json, p_exception_j json, p_src_j json, p_exec_time interval default null
  , p_exec_time_php interval default null)
	returns void security definer as $$
declare
  _log_auction_event boolean;
  _id int; _j_auto_bid json;
begin
	-- пишем всегда
	-- _log_auction_event := true;

	--if(_log_auction_event) then
		if(p_id_user_profile is not null and (p_id_user is null or p_id_profile is null)) then
			select id_user, id_profile into p_id_user, p_id_profile from user_profile
				where is_deleted = 'N' and id_user_profile = p_id_user_profile;
		end if;

		insert into carl_data.auction_log (event_type, id_user, id_profile, id_auction
                , input, output, exception, src, exec_time, exec_time_php)
  		    values (p_event_type, p_id_user, p_id_profile, p_id_auction
                , p_input_j::jsonb, p_output::jsonb, p_exception_j::jsonb, p_src_j::jsonb
                , p_exec_time, p_exec_time_php )
    	returning id_auction_log into _id;

		if(p_event_type = 'MAKE_BID' or p_event_type = 'SET_PROXY') then
            -- perform writelog('~~~ p_output:'|| p_output,'carl_auct._writeAuctLog()','XXX','DEBUG');
			_j_auto_bid := p_output#>'{auto_bid}';
            -- perform writelog('~~~ '|| _j_auto_bid,'carl_auct._writeAuctLog()','XXX','DEBUG');

			if(_j_auto_bid is not null and _j_auto_bid->>'id_user' is not null) then
				insert into carl_data.auction_log (event_type, id_user, id_profile, id_auction
					, input, output, exception, src)
					values ('AUTO_BID'::en_auction_event_type
						, (_j_auto_bid->>'id_user')::int, (_j_auto_bid->>'id_profile')::int, p_id_auction
						, _j_auto_bid::jsonb, _j_auto_bid::jsonb, null, null);
			end if;
		end if;
	--end if;
end;
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Вывод лога аукциона в табличном виде
--  Исключения:
----------------------------------------------------------------------------------
create or replace function carl_auct._showAuctLog(p_id_user int, p_id_profile int, p_id_auction int)
	returns table(_id_auction int, _event_type varchar, _user_do_name varchar, _profile_do_name varchar
    , _dt_set timestamp with time zone
    , _bid_value int, _proxy_price int
    , _user_lead_name varchar, _profile_lead_name varchar
    , _exception json) security definer as $$
declare
	_log_auction_event boolean;
  _output json; _j_lead json;
  _id_user int; _id_profile int; _id_auction int;
begin

	begin
		select current_setting('carl.log_auction_event')::boolean into _log_auction_event;
	exception when others then
		_log_auction_event := true;
	end;

  for _id_auction, _event_type, _id_user, _id_profile, _output, _dt_set, _exception in (
    select id_auction, event_type, id_user, id_profile, output
			, date_trunc('milliseconds',dt_set), exception from auction_log
      where (p_id_user is null or id_user = p_id_user)
				and (p_id_profile is null or _id_profile = p_id_profile)
				and (p_id_auction is null or id_auction = p_id_auction)
			order by id_auction, dt_set)
  loop
    _bid_value := null;

    _user_lead_name := null;
    _profile_lead_name := null;

    _user_do_name := carl_auth.getUserSmartName(_id_user);
    _profile_do_name := carl_prof._getProfSmartName(_id_profile);

    if(_output#>'{events}' is not null) then
      if(_output#>'{notify}'->0#>>'{bid_status}' = 'LEAD') then
        _j_lead    := _output#>'{notify}'->0;
        --raise notice '~~~ %',_j_lead;
        _bid_value := (_j_lead->>'bid_value')::int;
        _user_lead_name := carl_auth.getUserSmartName((_j_lead->>'id_user')::int);
        if(_j_lead->>'id_profile' is not null) then
          _profile_lead_name := carl_prof._getProfSmartName((_j_lead->>'id_profile')::int);
        end if;
      end if;
      if(_output#>'{notify}'->1#>>'{bid_status}' = 'LEAD') then
        _j_lead    := _output#>'{notify}'->1;
        --raise notice '~~~ %',_j_lead;
        _bid_value := (_j_lead->>'bid_value')::int;
        _user_lead_name := carl_auth.getUserSmartName((_j_lead->>'id_user')::int);
        if(_j_lead->>'id_profile' is not null) then
          _profile_lead_name := carl_prof._getProfSmartName((_j_lead->>'id_profile')::int);
        end if;
      else
        --_exception_msg :=
      end if;
    else
    end if;
    return next;
  end loop;

end
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Вывод лога аукциона в табличном виде
--  Исключения:
----------------------------------------------------------------------------------
create or replace function carl_auct.getMyActivityListJ(p_id_user int, p_id_profile int, p_id_auction int)
	returns setof json security definer as $$
	select row_to_json(r) from (select * from carl_auct._showAuctLog(p_id_user, p_id_profile, p_id_auction)) r
$$ language sql;


----------------------------------------------------------------------------------
-- Возвращает имя продавца для аукциона p_id_auction
-- select _getSellerSmartName(1);
----------------------------------------------------------------------------------
create or replace function carl_auct._getSellerSmartName(p_id_auction int)
	returns varchar security definer as $$
	select carl_prof.getProfSmartName(id_user, id_profile) from (select id_user, id_profile from user_profile up, auction a
		where a.id_user_profile = up.id_user_profile
			-- and up.is_deleted = 'N'
			and a.id_auction = p_id_auction) s;
$$ language sql;


/*
----------------------------------------------------------------------------------
--  Ход торгов
--  Исключения:
-- Изменение мин цены: аукцион, продавец, новая сумма, таймстамп
-- Изменение цены купить сейчас: аукцион, продавец, новая сумма, таймстамп
-- Выкуплено по кнопке купить сейчас: аукцион, кто купил, сумма, таймстамп
-- Ставка: авто(да, нет, если да - сумма авто), аукцион, чья ставка, сумма, таймстамп
-- Статус аукциона: статус (закрыт, активен, на модерации), продавец, таймстамп
-- Статус ставки: статус (принята, отклонена), чья ставка, сумма, таймстамп
-- ( 'EXCEPTION','MODERATED','MAKE_BID','SET_PROXY','ACTIVE','BUYNOW','FINISHED','FAILED'
--		,'ACCEPT_OFFER','DECLINE_OFFER','CHANGE_MIN_PRICE','CHANGE_BUYNOW_PRICE')
--
-- select carl_auct.getAuctionHistory(6,8,1); -- продавец
-- select carl_auct.getAuctionHistory(7,9,1); -- продавец

-- Продавец (видит все операции)
-- Покупатель (видит только свои операции и операции продавца)
*/


/*
----------------------------------------------------------------------------------
-- Вспомогательная функция используется в тестах
----------------------------------------------------------------------------------
create or replace function carl_auct.getLeadBidJ(p_id_auction int)
	returns json
as $$
  select row_to_json(r) from (select * from auction_bid where id_auction = p_id_auction
    and is_deleted = 'N' and bid_status = 'LEAD') r
$$
language sql;
*/

drop function if exists carl_auct.acceptOffer(p_id_user int, p_id_profile int, p_id_auction int);

----------------------------------------------------------------------------------
-- Продавец(или Админ ПОКА УБРАЛ) с p_id_user, p_id_profile принимает максимальную ставку
-- в OFFER аукционе p_id_auction
-- p_bv - ставка покупателя (если нет то не вставляем в br)
--
-- Исключения: NOT_FOUND_AUCTION_WITH_ID, AUCT_PROFILE_NOT_OWNER_AUCT, AUCT_NO_LEAD_BID
-- Возвращает: {"br": {"ip": 10, "iu": 8}, "sr": {"ip": 8, "iu": 6}}
--     br - покупатель лидер, sr - продавец
-- select carl_auct.acceptOffer(6,8,1);
----------------------------------------------------------------------------------
create or replace function carl_auct.acceptOffer(p_id_user int, p_id_profile int, p_id_auction int
  , p_bv int default null)
	returns json security definer as $$
declare
	_id_user int; _id_profile int;
	_auction auction%rowtype;
	_id_user_profile_buyer int;
	_bid_value int; _j json; _jb jsonb;
begin
		select * into _auction from auction where is_deleted = 'N'
			and id_auction = p_id_auction;

		if(_auction.id_auction is null) then
				raise exception using message=_getMessage('NOT_FOUND_AUCTION_WITH_ID'
																			||coalesce(p_id_auction::varchar,'<NULL>'))
					, errcode=_getErrcode('NOT_FOUND_AUCTION_WITH_ID');
		end if;

		if(not carl_auct._is_seller_of_auct(p_id_profile, p_id_auction)
      -- and not carl_auth._is_admin(p_id_user)
    ) then
        perform carl_comm.writeLogError(_getMessage('AUCT_PROFILE_NOT_OWNER_AUCT')
 																			||' (uid='||coalesce(p_id_user::varchar,'<NULL>')
                                      || ', pid='||coalesce(p_id_profile::varchar,'<NULL>')
                                       ||',aid='||coalesce(p_id_auction::varchar,'<NULL>')
          , 'carl_auct.acceptOffer()', 'ACCEPT_OFFER');
				raise exception using message=_getMessage('AUCT_PROFILE_NOT_OWNER_AUCT')
					, errcode=_getErrcode('AUCT_PROFILE_NOT_OWNER_AUCT');
		end if;

		-- if( _auction.dt_end >= clock_timestamp() and _auction.status='ACTIVE')	then
  	if(_auction.status <> 'FINISHED') then
        perform carl_comm.writeLogError(_getMessage('AUCT_NOT_FINESHED_CANT_DO_OPERATION')
 																			||' (uid='||coalesce(p_id_user::varchar,'<NULL>')
                                      || ', pid='||coalesce(p_id_profile::varchar,'<NULL>')
                                       ||',aid='||coalesce(p_id_auction::varchar,'<NULL>')
          , 'carl_auct.acceptOffer()', 'ACCEPT_OFFER');
				raise exception using message=_getMessage('AUCT_NOT_FINESHED_CANT_DO_OPERATION')
					, errcode=_getErrcode('AUCT_NOT_FINESHED_CANT_DO_OPERATION');
		end if;

	select id_user_profile, bid_value into _id_user_profile_buyer, _bid_value from auction_bid
		where id_auction = p_id_auction and bid_status = 'LEAD' and is_deleted = 'N';
	if(_id_user_profile_buyer is null) then
        perform carl_comm.writeLogError(_getMessage('AUCT_NO_LEAD_BID')
 																			||' (uid='||coalesce(p_id_user::varchar,'<NULL>')
                                      || ', pid='||coalesce(p_id_profile::varchar,'<NULL>')
                                       ||',aid='||coalesce(p_id_auction::varchar,'<NULL>')
          , 'carl_auct.acceptOffer()', 'ACCEPT_OFFER');
				raise exception using message=_getMessage('AUCT_NO_LEAD_BID')
					, errcode=_getErrcode('AUCT_NO_LEAD_BID');
	end if;

	select up.id_user, up.id_profile into _id_user, _id_profile from user_profile up
		where id_user_profile = _id_user_profile_buyer;

    perform carl_auct._to_SUCCESS(p_id_auction);
    -- update auction set status='SUCCESS'::en_auction_status, workflow_status='SUCCESS'
    --    where id_auction = p_id_auction;

    -- raise notice '~~~0 acceptOffer() % % %', p_id_user, _id_user, _id_user_profile_buyer;
    _jb := jsonb_build_object('sr',json_build_object('iu',  p_id_user, 'ip', p_id_profile));
    -- raise notice '~~~1 acceptOffer() %',_jb;
    if(p_bv is null) then
    _jb := _jb || jsonb_build_object('br',json_build_object('iu',_id_user,'ip',_id_profile));
    else
    _jb := _jb || jsonb_build_object('br',json_build_object('iu',_id_user,'ip',_id_profile, 'bv', p_bv));
    end if;
    -- raise notice '~~~2 acceptOffer() %',_jb;

	perform carl_auct._writeAuctLog('ACCEPT_OFFER'
        , p_id_user
        , p_id_profile
        , _auction.id_user_profile
        , p_id_auction
        , _j,_jb::json
        , null
		,'{"src":"carl_auct.acceptOffer()"}'::json);

	return _jb::json;
end
$$ language plpgsql;


----------------------------------------------------------------------------------
-- Продавец с p_id_user, p_id_profile в OFFER аукционе p_id_auction
-- отклоняет все предложения
-- Возвращает: {"br": {"ip": 10, "iu": 8}, "sr": {"ip": 8, "iu": 6}}
--     br - покупатель лидер, sr - продавец
-- select carl_auct.declineOffer(1,1,1780);
-- carl_auct.balanceUnReserv(_id_profile, p_id_auction);
----------------------------------------------------------------------------------
create or replace function carl_auct.declineOffer(p_id_user int, p_id_profile int, p_id_auction int)
	returns json security definer as $$
declare
	_id_user int; _id_profile int;
	_auction auction%rowtype;
	_id_user_profile_buyer int;
	_bid_value int; _j json; _jb jsonb;
begin
		select * into _auction from auction where is_deleted = 'N'
			and id_auction = p_id_auction;

		if(_auction.id_auction is null) then
			raise exception using message=_getMessage('NOT_FOUND_AUCTION_WITH_ID'
																			||coalesce(p_id_auction::varchar,'<NULL>'))
					, errcode=_getErrcode('NOT_FOUND_AUCTION_WITH_ID');
		end if;

		if(not carl_auct._is_seller_of_auct(p_id_profile, p_id_auction)
            ) then
                perform carl_comm.writeLogError(_getMessage('AUCT_PROFILE_NOT_OWNER_AUCT')
 																			||' (uid='||coalesce(p_id_user::varchar,'<NULL>')
                                      || ', pid='||coalesce(p_id_profile::varchar,'<NULL>')
                                       ||',aid='||coalesce(p_id_auction::varchar,'<NULL>')
          , 'carl_auct.acceptOffer()', 'ACCEPT_OFFER');
				raise exception using message=_getMessage('AUCT_PROFILE_NOT_OWNER_AUCT')
					, errcode=_getErrcode('AUCT_PROFILE_NOT_OWNER_AUCT');
	end if;

  	if(_auction.status <> 'FINISHED') then
        perform carl_comm.writeLogError(_getMessage('AUCT_NOT_FINESHED_CANT_DO_OPERATION')
 																			||' (uid='||coalesce(p_id_user::varchar,'<NULL>')
                                      || ', pid='||coalesce(p_id_profile::varchar,'<NULL>')
                                       ||',aid='||coalesce(p_id_auction::varchar,'<NULL>')
          , 'carl_auct.acceptOffer()', 'ACCEPT_OFFER');
				raise exception using message=_getMessage('AUCT_NOT_FINESHED_CANT_DO_OPERATION')
					, errcode=_getErrcode('AUCT_NOT_FINESHED_CANT_DO_OPERATION');
		end if;

	select id_user_profile, bid_value into _id_user_profile_buyer, _bid_value from auction_bid
		where id_auction = p_id_auction and bid_status = 'LEAD' and is_deleted = 'N';
	if(_id_user_profile_buyer is null) then
        _id_user := null; _id_profile := null;
    else
        select up.id_user, up.id_profile into _id_user, _id_profile from user_profile up
          where id_user_profile = _id_user_profile_buyer;
            perform carl_auct.balanceUnReserv(_id_profile, p_id_auction);
	end if;


	update auction set status='FAILED'::en_auction_status, workflow_status='FAILED'
    where id_auction = p_id_auction;


  _jb := jsonb_build_object('sr',json_build_object('iu',  p_id_user, 'ip', p_id_profile));
  _jb := _jb || jsonb_build_object('br',json_build_object('iu',_id_user,'ip',_id_profile));

	perform carl_auct._writeAuctLog('DECLINE_OFFER'
	    ,p_id_user
	    ,p_id_profile
	    ,_auction.id_user_profile
	    ,p_id_auction
	    ,_j
	    ,_jb::json
	    , null
		,'{"src":"carl_auct.declineOffer()"}'::json);

	return _jb::json;
end
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Удаление аукциона с p_id_auction (если null - то удалятся все)
--  Возвращает: количество удаленных строк
--  Исключения:
----------------------------------------------------------------------------------
create or replace function carl_auct.removeAuction(p_id_auction int) --{
	returns int security definer as $$
declare
	_cnt int;
begin
	update auction_bid set is_deleted = 'Y' where id_auction = p_id_auction;
	perform carl_auct._removeFavoriteByIdAuct(p_id_auction);

	update auction set is_deleted = 'Y'
    where id_auction = p_id_auction;

  GET DIAGNOSTICS _cnt := ROW_COUNT;

	return _cnt;
end
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Изменение данных аукциона с p_id_auction
--  Возвращает: количество измененных строк
--  Исключения:
----------------------------------------------------------------------------------
create or replace function carl_auct._updateAuction(p_id_auction int, p_auction jsonb)
	returns int security definer as $$
declare
  _cnt int;
  _dt_end int; _dt_start int; _auction_type en_auction_type;
  _buy_now int; _min_price int; _start_price int; _who_can_buy int; _approve_days int; _step int;
  _is_open_counter varchar; _reduce_start_price varchar;
begin
  _dt_end := (p_auction->>'dt_end')::int;
  _dt_start := (p_auction->>'dt_start')::int;
  _auction_type := (p_auction->>'auction_type')::en_auction_type;
  _buy_now := (p_auction->>'buy_now')::int;
  _min_price := (p_auction->>'min_price')::int;
  _start_price := (p_auction->>'start_price')::int;
  _who_can_buy := (p_auction->>'who_can_buy')::int;
  _approve_days := (p_auction->>'approve_days')::int;
  _step := (p_auction->>'step')::int;
  _is_open_counter := (p_auction->>'is_open_counter')::varchar;
  _reduce_start_price := (p_auction->>'reduce_start_price')::varchar;

  if (_is_open_counter is not null ) then 
    perform carl_auct.setAuctParameter(p_id_auction,'{"is_open_counter":'||_is_open_counter||'}');
  else
    perform carl_auct.removeAuctParameter(p_id_auction,'is_open_counter');
  end if;

  if (_reduce_start_price is not null ) then
    perform carl_auct.setAuctParameter(p_id_auction,'{"reduce_start_price":'||_reduce_start_price||'}');
  else
    perform carl_auct.removeAuctParameter(p_id_auction,'reduce_start_price');
  end if;

  -- raise notice '~~~ % ', _step;

  if(_is_open_counter = 'true') then
    update auction set dt_end=coalesce(to_timestamp(_dt_end),dt_end)
      , dt_start=coalesce(to_timestamp(_dt_start),dt_start)
      , auction_type=coalesce(_auction_type,auction_type)
      , buy_now=_buy_now
      , min_price=_min_price
      , start_price=_start_price
      , approve_days= null -- null чтобы сработал тригер!
      , dt_approve=dt_end + interval '1 day' -- FIXME: БРАТЬ ИЗ НАСТРОЕК!
      , step = _step
      where id_auction = p_id_auction;
  else
    update auction set dt_end=coalesce(to_timestamp(_dt_end),dt_end)
      , dt_start=coalesce(to_timestamp(_dt_start),dt_start)
      , auction_type=coalesce(_auction_type,auction_type)
      , buy_now=_buy_now
      , min_price=_min_price
      , start_price=_start_price
      , approve_days= _approve_days
      , step = _step
      where id_auction = p_id_auction;
  end if;


  if(_who_can_buy is not null) then
    perform carl_auct.setAuctWhoCanBuy(p_id_auction,_who_can_buy);
  end if;

  GET DIAGNOSTICS _cnt := ROW_COUNT;

	return _cnt;
end
$$ language plpgsql;


----------------------------------------------------------------------------------
-- Ход торгов аукциона p_id_auction для продавца или покупателя
--   с p_id_user int, p_id_profile
-- Продавец (видит все операции)
-- Покупатель (видит только свои операции и операции продавца)
--
--  (ia,iu,ip -id-шники, bv - bid_value, cp - current_price, mp - min_price, bnp - buynow_price
--    , selr - seller name, buyr - buyer name, dt - timestamp operation)
--  Пример:
--    select carl_auct.getAuctionHistory(7,8,1); -- продавец
--    select carl_auct.getAuctionHistory(10,11,1); -- покупатель PROXY
--    select carl_auct.getAuctionHistory(8,9,1); -- покупатель
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctionHistory_2(p_id_user int, p_id_profile int, p_id_auction int
	, p_is_admin boolean default false, p_filter json default null, p_id_auction_log int default null)
	returns setof json
as $$
declare
begin


end;
$$ language plpgsql;


-- drop function if existscarl_auct.getAuctionHistory(p_id_user int, p_id_profile int, p_id_auction int);
-- drop function if existscarl_auct.getAuctionHistory(p_id_user int, p_id_profile int, p_id_auction int, p_id_auction_log int);
-- drop function if existscarl_auct.getAuctionHistory(p_id_user int, p_id_profile int, p_id_auction int
--  , p_is_admin boolean, p_id_auction_log int);

-- drop function if existscarl_auct.getAuctionHistory(p_id_user int, p_id_profile int, p_id_auction int
--  , p_id_auction_log int);

-- drop function if existscarl_auct.getAuctionHistory(p_id_user int, p_id_profile int, p_id_auction int
--  , p_filter json, p_id_auction_log int);

----------------------------------------------------------------------------------
-- Ход торгов аукциона p_id_auction для продавца или покупателя
--   с p_id_user int, p_id_profile
-- Продавец (видит все операции)
-- Покупатель (видит только свои операции и операции продавца)
--
--  (ia,iu,ip -id-шники, bv - bid_value, cp - current_price, mp - min_price, bnp - buynow_price
--    , selr - seller name, buyr - buyer name, dt - timestamp operation)
--  Пример:
--    select carl_auct.getAuctionHistory(7,8,1); -- продавец
--    select carl_auct.getAuctionHistory(10,11,1); -- покупатель PROXY
--    select carl_auct.getAuctionHistory(8,9,1); -- покупатель
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctionHistory_OLD(p_id_user int, p_id_profile int, p_id_auction int
  , p_filter json default null, p_id_auction_log int default null)
	returns setof json security definer as $$
		-- переменные

declare
  _j json; _is_admin boolean; _ip_sel int;
begin
    -- ИЗМЕНЕНО при переходе на AI
    _is_admin := coalesce(carl_auth._is_admin(p_id_user) = 'Y',false);

    if(not _is_admin) then
        -- если у продавца стоит deanonim_hist_auct то он видит
        -- деанонимизированную историю на своих лотах

        _ip_sel := getSellerProfId(p_id_auction);

        if(carl_prof.getProfParameterB(_ip_sel, '{deanonim_hist_auct}', false)) then
          _is_admin := _ip_sel = p_id_profile;
        end if;
    end if;

    --raise notice '~~~ getAuctionHistory_OLD() _is_admin % ',_is_admin;
		for _j in (
      select *
        from carl_auct._getAuctionHistory_1(p_id_user, p_id_profile, p_id_auction, _is_admin, p_filter, p_id_auction_log)
    ) loop
      return next _j;
    end loop;
		end
$$ language plpgsql;


----------------------------------------------------------------------------------
----------------------------------------------------------------------------------
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctionHistory(p_id_user int, p_id_profile int, p_id_auction int
  ,                                                    p_filter  json default null, p_id_auction_log int default null)
  returns setof json security definer as $$
-- переменные
declare
  _j json; _j_prev json;
  _s text;
begin
  for _j in (select *
             from carl_auct.getAuctionHistory_XXX(p_id_user, p_id_profile, p_id_auction
             , p_filter, p_id_auction_log))
  loop
    --_s := format(' p_id_user %s, p_id_profile %s, p_id_auction %s, p_filter %s _j %s'
    --, p_id_user, p_id_profile, p_id_auction, p_filter, _j);
    --perform writelog(_s, 'getAuctionHistory()', 'AUCT_HIST', 'INFO');
    if(_j_prev is not null) then
      if( (_j#>>'{id_auction_log}' = _j_prev#>>'{id_auction_log}')
          and _j#>>'{ot}' = _j_prev#>>'{ot}') then
        _s := format('ДУБЛЬ!!! p_id_user %s, p_id_profile %s, p_id_auction %s, p_filter %s _j %s'
        , p_id_user, p_id_profile, p_id_auction, p_filter, _j);
        perform writelog(_s, 'getAuctionHistory()', 'AUCT_HIST_ERROR', 'INFO');
      end if;
    end if;
    return next _j;
    _j_prev := _j;
  end loop;
end;
$$ language plpgsql;


----------------------------------------------------------------------------------
-- Ход торгов аукциона p_id_auction для продавца или покупателя
--   с p_id_user int, p_id_profile
-- Продавец (видит все операции)
-- Покупатель (видит только свои операции и операции продавца)
--
--  (ia,iu,ip -id-шники, bv - bid_value, cp - current_price, mp - min_price, bnp - buynow_price
--    , selr - seller name, buyr - buyer name, dt - timestamp operation)
--  Пример:
--    select carl_auct.getAuctionHistory(7,8,1); -- продавец
--    select carl_auct.getAuctionHistory(3,17,1); -- админ
--    select carl_auct.getAuctionHistory(10,11,1); -- покупатель PROXY
--    select carl_auct.getAuctionHistory(8,9,1); -- покупатель
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctionHistory_XXX(p_id_user int, p_id_profile int, p_id_auction int
  , p_filter json default null, p_id_auction_log int default null)
	returns setof json security definer as $$
		-- переменные

declare
  _j json;
  _sel_deanonim boolean := false;  _admin_deanonim boolean := false;
  _real_admin boolean; _is_bidder boolean; _context int; _cnt int; _auction_type varchar; _ip_sel int;
  _max_dt_set_al timestamp; _max_dt_set_ah timestamp;
  _lock boolean := false; _id_auction_log_locked int;
begin
    --_real_admin := coalesce(carl_auth._is_admin(p_id_user) = 'Y',false);
    _real_admin := coalesce(carl_auth._is_admin(p_id_user),false);

    -- определяем контекст
    if(not _real_admin) then

        -- если у продавца стоит deanonim_hist_auct то он видит
        -- деанонимизированную историю на своих лотах
        _ip_sel := getSellerProfId(p_id_auction);

        if(carl_prof.getProfParameterB(_ip_sel, '{deanonim_hist_auct}', false)) then
          _sel_deanonim := true;
        end if;

        select count(*) > 0 into _is_bidder from auction_bid ab, user_profile up
          where ab.id_user_profile = up.id_user_profile
            and ab.id_auction = p_id_auction
            and up.is_deleted = 'N'
            and ab.is_deleted = 'N'
            and up.id_profile = p_id_profile;

        select auction_type into _auction_type from auction where id_auction = p_id_auction;
    end if;

    -- admin - 1
    -- seller (без deanonim_hist_auct) - 2
    -- seller(ip) (deanonim_hist_auct) - 3
    -- bidder(ip) OPEN, BUYNOW - 4
    -- bidder(ip) OFFER - 5
    -- other - 100

    if(_real_admin) then _context = 1;
    elseif (_ip_sel = p_id_profile and not _sel_deanonim) then _context = 2;
    elseif (_ip_sel = p_id_profile and _sel_deanonim) then _context = 3;
    elseif (_is_bidder and (_auction_type in ('OPEN','BUYNOW'))) then _context = 4;
    elseif (_is_bidder and (_auction_type in ('OFFER'))) then _context = 5;
    else _context = 100;
    end if;

    select count(*),  max(dt_set) into _cnt, _max_dt_set_ah
      from carl_data.auct_history
      where id_auction = p_id_auction
        and context = _context
        and (context not in (3,4,5) or (context in (3,4,5) and ip_bidder = p_id_profile))
        and ((p_filter is null and filter is null) or (filter = p_filter::varchar))
    ;

    if( _cnt > 0 ) then
      select max(dt_set) into _max_dt_set_al
        from carl_data.auction_log
        where id_auction = p_id_auction;
    end if;

    -- если нужно внести изменения в AH
    if(_cnt = 0 or ( _max_dt_set_ah is not null and _max_dt_set_ah < _max_dt_set_al)) then
      _lock := true;
      -- блокируем историю
      select max(id_auction_log) into _id_auction_log_locked from carl_data.auction_log
        where id_auction = p_id_auction
          and event_type = 'ACTIVE';
      update carl_data.auction_log set input = '{"locked":true}'::jsonb
        where id_auction_log = _id_auction_log_locked;

      --(WAIT)

      -- по-новой перечитываем _cnt, _max_dt_set_ah
      select count(*),  max(dt_set) into _cnt, _max_dt_set_ah
        from carl_data.auct_history
        where id_auction = p_id_auction
          and context = _context
          and (context not in (3,4,5) or (context in (3,4,5) and ip_bidder = p_id_profile))
          and ((p_filter is null and filter is null) or (filter = p_filter::varchar))
      ;

      -- удалем (все) старые записи в AH если в AL появились новые
      if(_max_dt_set_ah is not null and _max_dt_set_ah < _max_dt_set_al) then
          delete from carl_data.auct_history
            where id_auction = p_id_auction
              and context = _context
              and (context not in (3,4,5) or (context in (3,4,5) and ip_bidder = p_id_profile))
              and ((p_filter is null and filter is null) or (filter = p_filter::varchar));
          raise notice '~~~ getAuctionHistory_NEW() delete id_auction % _context %', p_id_auction, _context;
      end if;

      --raise notice '~~~ getAuctionHistory_NEW() _context %, _cnt %', _context, _cnt;

      if(_cnt = 0 or (_max_dt_set_ah is not null and _max_dt_set_ah < _max_dt_set_al)) then

          _admin_deanonim := _real_admin or (_context = 3 and _ip_sel = p_id_profile);

          for _j in (
            select *
              from carl_auct._getAuctionHistory_1(p_id_user, p_id_profile, p_id_auction, _admin_deanonim, p_filter, p_id_auction_log)
          ) loop
            insert into carl_data.auct_history (id_auction, context, ip_bidder, filter, out) values
              (p_id_auction
                , _context
                , case when _context not in (3,4,5) then null else p_id_profile end
                , p_filter::varchar
                , _j);
            --raise notice '~~~ getAuctionHistory_NEW() insert id_auction % _context %', p_id_auction, _context;
            return next _j;
          end loop;

          -- разблокируем историю
          update carl_data.auction_log set input = null
            where id_auction_log = _id_auction_log_locked;
            --where id_auction = p_id_auction
            --  and event_type = 'ACTIVE';
          return;
      end if;
    end if;

    -- чтение
    for _j in (
      select out from carl_data.auct_history
        where id_auction = p_id_auction
          and context = _context
          and (context not in (3,4,5) or (context in (3,4,5) and ip_bidder = p_id_profile))
          and ((p_filter is null and filter is null) or (filter = p_filter::varchar))
        order by id_auct_history
    ) loop
      return next _j;
    end loop;

    -- разблокируем историю
    if(_lock) then
      update carl_data.auction_log set input = null
        where id_auction_log = _id_auction_log_locked;
    end if;

    -- raise notice '~~~ getAuctionHistory() admin/записаны данные в таблицу auct_history';
end;
$$ language plpgsql;


/*
drop function if exists carl_auct.__getAuctHistoryAI(p_id_user int, p_id_profile int, p_id_auction int
  , p_filter json
  , p_real_admin boolean
  , p_admin boolean
  , p_id_auction_log int);

----------------------------------------------------------------------------------
-- Ход торгов аукциона (Искуственный Интеллект)
-- по контексту (p_id_auction, p_filter, p_admin) принимается решение на выборку
-- происходит запись в таблицу ответов или производится обучение
----------------------------------------------------------------------------------
create or replace function carl_auct.__getAuctHistoryAI(p_id_user int
  , p_id_profile int
  , p_id_auction int
  , p_filter json
  , p_real_admin boolean
  , p_seller boolean
  , p_admin_deanonim boolean
  , p_id_auction_log int)
	returns setof json security definer as $$
		-- переменные
declare
  _j json; _cnt int;
begin
      --raise notice '~~~ __getAuctHistoryAI(%,%,%,%,%) context '
      --  , p_id_user, p_id_profile, p_id_auction, p_filter, p_admin;


      select count(*) into _cnt from carl_data.auct_history
          where id_auction = p_id_auction
            and (coalesce(p_real_admin,false) = admin)
            and (coalesce(p_seller,false) = seller)
            and ((p_filter is null and filter is null) or (filter::jsonb = p_filter::jsonb))
      ;
      -- если записей в таблице ответов ещё нет то добавляем их
      if(_cnt = 0) then
        for _j in (
          select *
            from carl_auct._getAuctionHistory_1(p_id_user, p_id_profile, p_id_auction, p_admin_deanonim, p_filter, p_id_auction_log)
        ) loop
          insert into carl_data.auct_history (id_auction, admin, filter, out) values
            (p_id_auction, p_real_admin, p_filter, _j);
        end loop;
        --raise notice '~~~ getAuctionHistory() записаны данные в таблицу auct_history';
      end if;
      -- и по-новой читаем (неэффективно, но для контроля)
      for _j in (
        select out from carl_data.auct_history
          where id_auction = p_id_auction
            and (coalesce(p_real_admin,false) = admin)
            and ((p_filter is null and filter is null) or (filter::jsonb = p_filter::jsonb))
          order by id_auct_history
      ) loop
        return next _j;
      end loop;
      --raise notice '~~~ getAuctionHistory() данные из таблицы auct_history';
      return;
end;
$$ language plpgsql;
*/


-- drop function if existscarl_auct._getAuctionHistoryAdm(p_id_user int, p_id_profile int, p_id_auction int
--  , p_id_auction_log int);
-- drop function if existscarl_auct._getAuctionHistoryAdm(p_id_user int, p_id_profile int, p_id_auction int
--  , p_filter json, p_id_auction_log int);

----------------------------------------------------------------------------------
-- ХТ для админа
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctionHistoryAdm(p_id_user int, p_id_profile int, p_id_auction int
  , p_filter json default null, p_id_auction_log int default null)
	returns setof json security definer as $$
		-- переменные

declare
  _j json;
begin
		for _j in (
      select *
        from carl_auct._getAuctionHistory_1(p_id_user, p_id_profile, p_id_auction, true, p_filter, p_id_auction_log)
    ) loop
      return next _j;
    end loop;
		end
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Возвращает операцию номер p_oper_num из истории Хода торгов
--  аукциона p_id_auction для продавца или покупателя
--  с p_id_user int, p_id_profile
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctionHistory(p_id_user int, p_id_profile int, p_id_auction int
	, p_oper_num int)
	returns json security definer as $$
	select * from carl_auct.getAuctionHistory(p_id_user, p_id_profile, p_id_auction) limit 1 offset p_oper_num
$$ language sql;


-- drop function if existscarl_auct._getAuctionHistorySel(p_id_auction int);

----------------------------------------------------------------------------------
--  Возвращает историю Хода торгов
--  аукциона p_id_auction для продавца
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctionHistorySel(p_id_auction int)
	returns setof json security definer as $$
declare
  _id_user int; _id_profile int; _j json;
begin
  _id_profile := carl_auct._get_auct_id_prof(p_id_auction);
  _id_user := carl_auct._get_auct_id_user(p_id_auction);
  for _j in
	  (select * from carl_auct.getAuctionHistory(_id_user, _id_profile, p_id_auction))
  loop
    return next _j;
  end loop;
end;
$$ language plpgsql;


-- drop function if existscarl_auct.getAuctionHistoryAdm(p_id_auction int);

----------------------------------------------------------------------------------
--  Возвращает историю Хода торгов для Продавца!
--  аукциона p_id_auction для админа
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctionHistoryAdm(p_id_auction int)
	returns setof json security definer as $$
declare
  _id_user int; _id_profile int; _j json;
begin
  _id_profile := carl_auct._get_auct_id_prof(p_id_auction);
  _id_user := carl_auct._get_auct_id_user(p_id_auction);
  for _j in
	  (select * from carl_auct._getAuctionHistoryAdm(_id_user, _id_profile, p_id_auction, null))
  loop
    return next _j;
  end loop;
end;
$$ language plpgsql;

-- drop function if exists carl_auct._getAuctionHistoryAdm(p_id_user int, p_id_profile int, p_id_auction int);

----------------------------------------------------------------------------------
--  Возвращает историю Хода торгов для p_id_user, p_id_profile
--  аукциона p_id_auction для админа
----------------------------------------------------------------------------------
create or replace function carl_auct.__getAuctionHistoryAdm(p_id_user int, p_id_profile int, p_id_auction int)
	returns setof json security definer as $$
declare
  _j json;
begin
  for _j in
	  (select * from carl_auct._getAuctionHistoryAdm(p_id_user, p_id_profile, p_id_auction, null))
  loop
    return next _j;
  end loop;
end;
$$ language plpgsql;


drop function if exists carl_auct.getAuctionHistoryAdmT(p_id_auction int);

----------------------------------------------------------------------------------
--  Возвращает историю Хода торгов для Админа таблицей
--  аукциона p_id_auction для админа
--  select * from getAuctionHistoryAdmT(1567) order by dt desc;
--  select * from getAuctionHistoryAdm(1567);
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctionHistoryAdmT(p_id_user int, p_id_profile int, p_id_auction int)
	returns  table (id_user_buyr int, id_profile_buyr int, operation varchar
    , bid_value int, buyer_name varchar, dt bigint, proxy_price int, is_deleted varchar(1)) security definer as $$
  select (j#>>'{buyr,iu}')::int as id_user_buyr, (j#>>'{buyr,ip}')::int as id_profile_buyr, (j#>>'{ot}')::varchar as operation, (j#>>'{bv}')::int as bid_value, (j#>>'{buyr,nm}')::varchar as buyer
    , (j#>>'{dt}')::bigint as dt, (j#>>'{pp}')::int as proxy_price, (j#>>'{is_deleted}')::varchar(1) as is_deleted
    from carl_auct.__getAuctionHistoryAdm(p_id_user, p_id_profile, p_id_auction) as j;
$$ language sql;


----------------------------------------------------------------------------------
-- Возвращает Ход торгов аукциона p_id_auction для продавца или покупателя
-- с p_id_user p_id_profile
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctionHistoryJb(p_id_user int, p_id_profile int, p_id_auction int)
returns jsonb security definer as $$
  select jsonb_agg(r) from (select s#>>'{ot}' as ot
  , s#>'{buyr,iu}' as iu, s#>'{buyr,ip}' as ip, s#>'{bv}' as bv, s#>'{pp}' as pp
      from carl_auct.getAuctionHistory(p_id_user, p_id_profile, p_id_auction) s) r
$$ language sql;


----------------------------------------------------------------------------------
-- Возвращает сообщения отправленные в ходе торгов аукциона p_id_auction
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctionNotificationsJb(p_id_auction int)
returns jsonb security definer as $$
  select jsonb_agg(r) from (select json_build_object('ot',event_type,'notify', output#>'{notify}') as oper
                         from auction_log where id_auction = p_id_auction order by id_auction_log desc) r
$$ language sql;


-- -- drop function if existscarl_auct.getAuctionHistory(p_id_auction int);


----------------------------------------------------------------------------------
-- Переключение акциона с p_id_auction на пользователя p_id_user с p_id_profile
-- select changeAuctOwner(1025,231,10610);
-- select carl_wf.getDefaultProfileWorkflow(241)->>'id_workflow';
----------------------------------------------------------------------------------
create or replace function carl_auct.changeAuctOwner(p_id_user int, p_id_profile int, p_id_auction int)
	returns void security definer as $$
declare
  _id_user_profile int;
  _auction auction%rowtype;
  _id_workflow varchar;
  _id_user_lock int;
begin

  select * into _auction from auction where id_auction = p_id_auction; -- and is_deleted = 'N';

  if(_auction.is_deleted = 'Y' ) then
			raise exception using message=_getMessage('AUCT_CANT_DO_OPERATION_FOR_DELETED')
                , errcode=_getErrcode('AUCT_CANT_DO_OPERATION_FOR_DELETED');
  end if;

  select id_user_lock into _id_user_lock from car_draft
    where is_deleted = 'N' and id_auction = p_id_auction;

  if(_id_user_lock is not null ) then
			raise exception using message=_getMessage('AUCT_CANT_DO_OPERATION_FOR_LOCKED')
                , errcode=_getErrcode('AUCT_CANT_DO_OPERATION_FOR_LOCKED');
  end if;

  -- для 'DRAFT','MODERATED' можно менять и профиль
  -- если профиль не изменился то можно менять для любого статуса
-- FIXME: !!! Временно !
--   if(carl_auct._get_auct_seller_id(p_id_auction) <> p_id_profile
--     and _auction.status not in ('DRAFT','MODERATED'))  then
-- 			raise exception using message=_getMessage('AUCT_CANT_CHANGE_OWNER_FOR_AUCT_WITH_STATUS')||coalesce(_auction.status::varchar,'NULL')
--                 , errcode=_getErrcode('AUCT_CANT_CHANGE_OWNER_FOR_AUCT_WITH_STATUS');
--   end if;

  _id_user_profile := carl_prof._get_id_user_profile(p_id_user, p_id_profile);

  _id_workflow := carl_wf.getDefaultProfileWorkflow(p_id_profile)->>'id_workflow';

  if(_id_workflow is null and _auction.id_workflow is null) then
    raise exception using message=_getMessage('AUCT_NULL_ID_WORKFLOW_IN_PROF')
        , errcode=_getErrcode('AUCT_NULL_ID_WORKFLOW_IN_PROF');
  end if;

  if(_id_workflow = 'VW_AUCTION') then
  else
    if(_auction.id_workflow is not null) then
      _id_workflow = _auction.id_workflow;
    end if;
  end if;

  update auction set id_user_profile=_id_user_profile
    , seller_name=carl_prof.getProfSmartName2(p_id_profile)
    , id_workflow=_id_workflow
    where id_auction = p_id_auction
  ;

  perform carl_prof.afterUpdProfileName(p_id_profile);

  if(_id_workflow = 'VW_AUCTION') then
    perform carl_auct.setAuctParameter(p_id_auction,'{"hide_auct_hist":true}');
    perform carl_auct.setAuctParameter(p_id_auction,'{"is_vw":true}');
  else
    perform carl_auct.setAuctParameter(p_id_auction,'{"hide_auct_hist":false}');
    perform carl_auct.setAuctParameter(p_id_auction,'{"is_vw":false}');
  end if;

  update car_draft set id_user=p_id_user, id_profile=p_id_profile where is_deleted = 'N' and id_auction = p_id_auction;

end;
$$ language plpgsql;


----------------------------------------------------------------------------------
-- Переключение акциона с p_id_auction на пользователя p_id_user с p_id_profile
----------------------------------------------------------------------------------
create or replace function carl_auct.changeAuctOwner(p_id_user_profile int, p_id_auction int)
	returns void
 security definer as $$
declare
  _id_user int; _id_profile int;
begin
  select id_user, id_profile into _id_user, _id_profile from user_profile
    where id_user_profile = p_id_user_profile;

  perform  carl_auct.changeAuctOwner(_id_user, _id_profile, p_id_auction);
end;
$$ language plpgsql;


------------------------------------------------------------------------------------------------------------------------
-- Статус последнего аукциона для объекта с p_id_object
-- select getLastAuctStatusByObjId(1260);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getLastAuctStatusByObjId(p_id_object int)
	returns varchar security definer as $$
  select a.status::varchar --, a.id_auction, s.cnt
    from auction a,
    (select
      a.id_object,
      count(*) as cnt
    from auction a
      where a.is_deleted = 'N'
    group by a.id_object
    order by cnt desc
  ) s
  where a.is_deleted = 'N'
    and s.id_object = a.id_object
    -- and a.id_workflow = 'STANDART_AUCTION' --''VW_WORKFLOW'
    and a.id_object = p_id_object
  order by a.id_auction desc
  limit 1
$$ language sql;


------------------------------------------------------------------------------------------------------------------------
-- Блокировка ставки аукциона p_id_auction профилем p_id_profile на время выполнения ставки
-- так же блокируется лидер аукциона
-- будет работать на уровне изоляции COMMITED READ
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._lockBid(p_id_profile int, p_id_auction int)
	returns void security definer as $$
declare
  _ip_lead int;
begin
  _ip_lead := carl_auct._get_auct_leader(p_id_auction);

  update auction set bid_locked_by=p_id_profile where id_auction = p_id_auction;
  -- raise notice '~~~ _lockBid(): update auction set bid_locked_by=% where id_auction = % ', p_id_profile, p_id_auction;

  if(_ip_lead is not null) then
    update profile set auct_locked=p_id_auction where id_profile = _ip_lead or id_profile = p_id_profile;
    -- raise notice '~~~ _lockBid(): update profile set auct_locked=% where id_profile = % ', p_id_auction, _ip_lead;
  else
    update profile set auct_locked=p_id_auction where id_profile = p_id_profile;
      -- raise notice '~~~ _lockBid(): update profile set auct_locked=% where id_profile = % ', p_id_auction, p_id_profile;
  end if;
end;
$$ language plpgsql;


------------------------------------------------------------------------------------------------------------------------
-- Разблокировка ставки аукциона p_id_auction профилем p_id_profile на время выполнения ставки
-- будет работать на уровне изоляции COMMITED READ
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._unLockBid(p_id_profile int, p_id_auction int)
	returns void security definer as $$
declare
begin
  null;
  --update profile set auct_locked=null where id_profile = p_id_profile;
  --update auction set bid_locked_by=null where id_auction = p_id_auction;
end;
$$ language plpgsql;


-- drop function if existscarl_auct._lockBid(p_id_profile int, p_id_auction int);

/*
------------------------------------------------------------------------------------------------------------------------
-- Блокировка ставки аукциона p_id_auction профилем p_id_profile на время выполнения ставки
-- будет работать на уровне изоляции COMMITED READ
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._lockBid(p_id_profile int, p_id_auction int)
	returns void security definer as $$
  update auction set bid_locked_by=p_id_profile where id_auction = p_id_auction
$$ language sql;


-- drop function if existscarl_auct._unLockBid(p_id_profile int, p_id_auction int);

------------------------------------------------------------------------------------------------------------------------
-- Блокировка ставки аукциона p_id_auction профилем p_id_profile на время выполнения ставки
-- будет работать на уровне изоляции COMMITED READ
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._unLockBid(p_id_profile int, p_id_auction int)
	returns void security definer as $$
  update auction set bid_locked_by=null where id_auction = p_id_auction
$$ language sql;
*/


------------------------------------------------------------------------------------------------------------------------
-- Блокировка аукциона p_id_auction
-- так же блокируется лидер аукциона
-- будет работать на уровне изоляции COMMITED READ
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._auctLock(p_id_auction int)
	returns void security definer as $$
declare
  _ip_lead int;
begin
  update auction set locked_by=0 where id_auction = p_id_auction;
  raise notice '~~~ _auctLock(): update auction set bid_locked_by=0 where id_auction = % ', p_id_auction;

  _ip_lead := carl_auct._get_auct_leader(p_id_auction);
  if(_ip_lead is not null) then
    update profile set auct_locked=p_id_auction where id_profile = _ip_lead;
    raise notice '~~~ _auctLock(): update profile set auct_locked=% where id_profile = % ', p_id_auction, _ip_lead;
  end if;
end;
$$ language plpgsql;


drop function if exists carl_auct._auctLock(p_id_profile int, p_id_auction int);

------------------------------------------------------------------------------------------------------------------------
-- Блокировка аукциона p_id_auction
-- так же блокируется лидер аукциона
-- будет работать на уровне изоляции COMMITED READ
-- FIXME: УБРАТЬ ЭТУ ФУНКЦИЮ
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._auctLock(p_id_profile int, p_id_auction int)
	returns void security definer as $$
declare
  _ip_lead int;
begin
  perform carl_auct._auctLock(0, p_id_auction);
end;
$$ language plpgsql;


drop function if exists carl_auct._auctUnlock(p_id_auction int);

------------------------------------------------------------------------------------------------------------------------
-- Блокировка аукциона p_id_auction профилем p_id_profile на время выполнения ставки
-- будет работать на уровне изоляции COMMITED READ
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._auctUnlock(p_id_auction int)
	returns void security definer as $$
declare
begin
  null;
  --update auction set locked_by=null where id_auction = p_id_auction
end;
$$ language plpgsql;


-- drop function if existscarl_auct.getProfsWaitingUnreg();
-- drop function if existscarl_auct.getWaitingUnreg();

------------------------------------------------------------------------------------------------------------------------
-- ADMIN
-- Аукционы и профили ожидающие разрезервирования
-- select * from profile p, (select f.id_profile as id_profile from getWaitingUnreg() f) s2 where p.id_profile = s2.id_profile;
-- select * from carl_auct.getWaitingUnreg();
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getWaitingUnreg()
	returns table(id_profile int, id_auction int) security definer as $$
select /*operation_type, */ id_profile, bo2.id_auction from balance_operation bo2,
  ( select max(id_balance_operation) max_id_balance_operation, sl.id_auction
    from balance_operation bo, ( select
      _get_id_profile(ab.id_user_profile) as id_profile,
      a.id_auction
      from auction_bid ab, auction a
      where ab.id_auction = a.id_auction
        and bid_status = 'LEAD'
        and ab.is_deleted = 'N' and a.is_deleted = 'N'
        and a.status in ('SUCCESS','BUYNOW')
        -- and a.id_auction = 1000
    ) sl
  where bo.id_auction = sl.id_auction and bo.id_profile = sl.id_profile
     and bo.operation_type in ('BALANCE_RESERV','BALANCE_UNRESERV')
  group by sl.id_auction
  ) s2
  where bo2.id_balance_operation = s2.max_id_balance_operation
    and bo2.operation_type = 'BALANCE_RESERV'
$$ language sql;


drop type if exists t_seller_counts cascade;
create type t_seller_counts as
  (total int, active int, has_bid int, waiting int, sold int, not_sold int, archive int
  , moderating int, drafts int, no_bids int
  );


-- drop function if existscarl_auct.getAuctSellCountsT(p_id_profile int);
-- drop function if existscarl_auct.getAuctSellCountsT(int, int, timestamp, timestamp);
-- drop function if existscarl_auct.getAuctSellCountsT(p_id_user int, p_id_profile int);
-- drop function if existscarl_auct.getAuctSellCountsT(int, int, int, int);
-- drop function  carl_auct.getAuctSellCountsT(int, int);
-- drop function  carl_auct.getAuctSellCountsT(int, int, int, int);

------------------------------------------------------------------------------------------------------------------------
-- AUCT.ACTIVE
-- Количество аукционов для активностей продавца с id_profile
--
-- FRONT_ACCEPTING - "Ожидает решения комитета" - код для счетчиков waiting_lp
-- BACK_ACCEPTING - "Подтверждение продажи"  - waiting_confirm_lp
-- SUCCESS (WF STATUS) - "Продажа подтверждена" - confirmed_lp
-- NOLS_ACCEPTING- "Загружено в НОЛС" - in_nols
-- READY - "Завершенные продажи" - in_ready
--
-- select * from carl_auct.getAuctSellCountsT(3,17);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctSellCountsT(p_id_user int, p_id_profile int
  , p_dt_from bigint /*ERV:bigint*/ default null, p_dt_to bigint /*ERV:bigint*/ default null)
  returns t_seller_counts security definer as $$
declare
  _rec t_seller_counts;
  _no_bids int;
  _dt_from /*ERV:bigint*/ bigint;
  _dt_to   /*ERV:bigint*/ bigint;
  _dt_now  /*ERV:bigint*/ bigint;
  _jf      json;
begin
  _dt_from := case when p_dt_from is not null then extract (epoch from date_trunc('day',to_timestamp(p_dt_from))) else null end;
  _dt_to   := case when p_dt_to is not null then extract (epoch from date_trunc('day',to_timestamp(p_dt_to))+interval '1 day') else null end;
  _dt_now  := case when p_dt_from is not null then extract (epoch from date_trunc('day',current_timestamp)) else null end;
  -- _no_bids := getAuctListByFilterCount(('{"ft":10, "id_user":'||p_id_user||',"id_profile":'||p_id_profile||'}')::json);
  _jf := jsonb_build_object('ft',10, 'id_user',p_id_user, 'id_profile',p_id_profile, 'dt_end_from', _dt_from, 'dt_end_to',_dt_to);
  _no_bids := getAuctListByFilterCount(_jf);
  -- все
  select * into _rec from
  (select count(*) as total from
    ( select a.id_auction
          from auction a
          inner join object o on (a.id_object = o.id_object)
          inner join obj_attrib_values oav on (o.id_object = oav.id_object)
          left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
          where a.is_deleted = 'N'
              and not (a.is_archive or a.hidden)
              and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
          and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction) or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
          and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
    ) s01
  ) s1 ,
  -- активные
  (
   select count(*) as active from ( select a.id_auction
          from auction a
          inner join object o on (a.id_object = o.id_object)
          inner join obj_attrib_values oav on (o.id_object = oav.id_object)
          left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
          where a.is_deleted = 'N'
              and not (a.is_archive or a.hidden)
              and a.status = 'ACTIVE'
              and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
          and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction) or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
          and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
      ) s02
   ) s2,
  -- есть ставки
  (
 select count(*) as has_bid from ( select a.id_auction, a.id_object, case when a.auction_type = 'OFFER' then null
   when a.auction_type = 'OPEN' and a.bid_count = 0 then a.start_price else ab.bid_value end as s_cur_price
				from auction a
				inner join object o on (a.id_object = o.id_object)
				inner join obj_attrib_values oav on (o.id_object = oav.id_object)
				left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
        where a.is_deleted = 'N'
            and not (a.is_archive or a.hidden)
          and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
          and a.id_auction in (select id_auction from auction_bid ab where ab.is_deleted = 'N'
            and ab.id_auction = a.id_auction)
          and (a.status = 'ACTIVE')
          and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
     ) s03
  ) s3,
  -- ожидают решения
  (
--     select count(*) as waiting from auction a, user_profile up where
--     a.id_user_profile = up.id_user_profile
--     and up.id_profile = p_id_profile
--     and status = 'FINISHED'

 select count(*) as waiting from ( select a.id_auction
				from auction a
				inner join object o on (a.id_object = o.id_object)
				inner join obj_attrib_values oav on (o.id_object = oav.id_object)
				left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
				where a.is_deleted = 'N'
                    and not (a.is_archive or a.hidden)
    				and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
        and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction)
             or carl_auct._canProfBuy(p_id_profile,a.id_auction))
        and (( a.status ='FINISHED'))
        -- для VW учитываются роли и действия WF
        and ( not carl_auct.getAuctParameterB(a.id_auction,'{is_vw}',false)
              or carl_auct._is_need_action(p_id_user,p_id_profile,a.id_auction))
   ) s04
   ) s4,
 -- finished
--  select count(*) as waiting from ( select a.id_auction
--    				from auction a
--    				inner join object o on (a.id_object = o.id_object)
--    				inner join obj_attrib_values oav on (o.id_object = oav.id_object)
--    				-- left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')  where a.is_deleted = 'N'
--           and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
--           and carl_auct._is_need_action(p_id_user,p_id_profile,a.id_auction)
--           and a.status = 'FINISHED'
--           and not (a.hidden)
--          ) s04
--    ) s4,

  -- продано
  (
 select count(*) as sold from ( select a.id_auction, a.id_object, case when a.auction_type = 'OFFER' then null  when a.auction_type = 'OPEN' and a.bid_count = 0 then a.start_price else ab.bid_value end as s_cur_price
				from auction a
				inner join object o on (a.id_object = o.id_object)
				inner join obj_attrib_values oav on (o.id_object = oav.id_object)
				left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
				where a.is_deleted = 'N'
        and not (a.is_archive or a.hidden)

        and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
        and (a.status = 'SUCCESS' or a.status = 'BUYNOW')
        and not (a.hidden)
        and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
     ) s05
  ) s5,
  -- не продано
  (
 select  count(*) as not_sold from ( select a.id_auction, a.id_object, case when a.auction_type = 'OFFER' then null  when a.auction_type = 'OPEN' and a.bid_count = 0 then a.start_price else ab.bid_value end as s_cur_price
				from auction a
				inner join object o on (a.id_object = o.id_object)
				inner join obj_attrib_values oav on (o.id_object = oav.id_object)
				left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
        where a.is_deleted = 'N'
           and not (a.is_archive or a.hidden)
          and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
          and not (a.is_archive or a.hidden)
          and (a.status = 'FAILED')
          and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
   ) s06
  ) s6,
  -- архив
  (
 select count(*) as archive from ( select a.id_auction
				from auction a
				inner join object o on (a.id_object = o.id_object)
				inner join obj_attrib_values oav on (o.id_object = oav.id_object)
				left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
        where a.is_deleted = 'N'
          and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
					and (a.is_archive or a.hidden)
          and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
    ) s07
  ) s7,
  -- moderating
  (select count(*) as moderating from auction a, user_profile up where
    a.id_user_profile = up.id_user_profile
    and up.id_profile = p_id_profile
    and status = 'MODERATED'
    and a.is_deleted = 'N'
    and not (a.is_archive or a.hidden)
    and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )

  ) s8,
  -- draft
  (select count(*) as drafts from auction a, user_profile up where
    a.id_user_profile = up.id_user_profile
    and up.id_profile = p_id_profile
    and status = 'DRAFT'
    and a.is_deleted = 'N'
    and not (a.is_archive or a.hidden)
    and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
  ) s9,
  ( select _no_bids
  ) s10
  ;


  return _rec;
end;
$$ language plpgsql;


drop type if exists t_seller_counts_lp cascade;
create type t_seller_counts_lp as
(total int, active int, has_bid int, not_sold int, archive int
    , moderating int, drafts int, no_bids int
    -- ЛизПлан
    , waiting_lp int, waiting_confirm_lp int, confirmed_lp int, in_nols int, in_ready int, in_done int
);

------------------------------------------------------------------------------------------------------------------------
-- AUCT.ACTIVE
-- Количество аукционов для активностей продавца с id_profile
--
-- FRONT_ACCEPTING - "Ожидает решения комитета" - код для счетчиков waiting_lp
-- BACK_ACCEPTING - "Подтверждение продажи"  - waiting_confirm_lp
-- SUCCESS (WF STATUS) - "Продажа подтверждена" - confirmed_lp
-- NOLS_ACCEPTING- "Загружено в НОЛС" - in_nols
-- READY - "Завершенные продажи" - in_ready
--
-- select * from carl_auct.getAuctSellCountsT_LP(3,17);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctSellCountsT_LP(p_id_user int, p_id_profile int
    , p_dt_from int default null, p_dt_to int default null)
    returns t_seller_counts_lp security definer as $$
declare
    _rec t_seller_counts_lp;
    _no_bids int;
    _dt_from int;
    _dt_to   int;
    _dt_now  int;
    _jf      json;
begin
    _dt_from := case when p_dt_from is not null then extract (epoch from date_trunc('day',to_timestamp(p_dt_from))) else null end;
    _dt_to   := case when p_dt_to is not null then extract (epoch from date_trunc('day',to_timestamp(p_dt_to))+interval '1 day') else null end;
    _dt_now  := case when p_dt_from is not null then extract (epoch from date_trunc('day',current_timestamp)) else null end;
    -- _no_bids := getAuctListByFilterCount(('{"ft":10, "id_user":'||p_id_user||',"id_profile":'||p_id_profile||'}')::json);
    _jf := jsonb_build_object('ft',10
         , 'id_workflow', '{"AND": [ "=''LP_AUCTION''" ]}'
        ,'id_user',p_id_user, 'id_profile',p_id_profile
        , 'dt_end_from', _dt_from, 'dt_end_to',_dt_to);
    _no_bids := getAuctListByFilterCount(_jf);
    -- все
    select * into _rec from
        (select count(*) as total from
            ( select a.id_auction
              from auction a
                       inner join object o on (a.id_object = o.id_object)
                       inner join obj_attrib_values oav on (o.id_object = oav.id_object)
                       left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
              where a.is_deleted = 'N'
                      and not (a.is_archive or a.hidden)
                      -- and getAuctParameterB(a.id_auction,'{is_lp}',false)
                      and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                      and a.id_user_profile in (select id_user_profile from user_profile
                                                                       where id_profile = p_id_profile )
                      and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction)
                               or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
                      and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
            ) s01
        ) s1 ,
        -- активные
        (
            select count(*) as active from ( select a.id_auction
                                             from auction a
                                                      inner join object o on (a.id_object = o.id_object)
                                                      inner join obj_attrib_values oav on (o.id_object = oav.id_object)
                                                      left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
                                             where a.is_deleted = 'N'
                                                     and not (a.is_archive or a.hidden)
                                                     and a.status = 'ACTIVE'
                                                     and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                                                     and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
                                                     and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction) or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
                                                     and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
            ) s02
        ) s2,
        -- есть ставки
        (
            select count(*) as has_bid from ( select a.id_auction, a.id_object, case when a.auction_type = 'OFFER' then null
                                                                                     when a.auction_type = 'OPEN' and a.bid_count = 0 then a.start_price else ab.bid_value end as s_cur_price
                                              from auction a
                                                       inner join object o on (a.id_object = o.id_object)
                                                       inner join obj_attrib_values oav on (o.id_object = oav.id_object)
                                                       left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
                                              where a.is_deleted = 'N'
                                                      and not (a.is_archive or a.hidden)
                                                      and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
                                                      and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                                                      and a.id_auction in (select id_auction from auction_bid ab where ab.is_deleted = 'N'
                                                      and ab.id_auction = a.id_auction)
                                                      and (a.status = 'ACTIVE')
                                                      and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
            ) s03
        ) s3,
        -- не продано
        (
            select  count(*) as not_sold from ( select a.id_auction, a.id_object, case when a.auction_type = 'OFFER' then null  when a.auction_type = 'OPEN' and a.bid_count = 0 then a.start_price else ab.bid_value end as s_cur_price
                                                from auction a
                                                         inner join object o on (a.id_object = o.id_object)
                                                         inner join obj_attrib_values oav on (o.id_object = oav.id_object)
                                                         left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
                                                where a.is_deleted = 'N'
                                                        and not (a.is_archive or a.hidden)
                                                        and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
                                                        and not (a.is_archive or a.hidden)
                                                        and (a.status = 'FAILED')
                                                        and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                                                        and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
            ) s06
        ) s4,
        -- архив
        (
            select count(*) as archive from ( select a.id_auction
                                              from auction a
                                                       inner join object o on (a.id_object = o.id_object)
                                                       inner join obj_attrib_values oav on (o.id_object = oav.id_object)
                                                       left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
                                              where a.is_deleted = 'N'
                                                      and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
                                                      and (a.is_archive or a.hidden)
                                                      and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
                                                      and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
            ) s07
        ) s5,
        -- moderating
        (select count(*) as moderating from auction a, user_profile up where
                a.id_user_profile = up.id_user_profile
                and up.id_profile = p_id_profile
                and status = 'MODERATED'
                and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                and a.is_deleted = 'N'
                and not (a.is_archive or a.hidden)
                and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )

        ) s6,
        -- draft
        (select count(*) as drafts from auction a, user_profile up where
                a.id_user_profile = up.id_user_profile
                and up.id_profile = p_id_profile
                and status = 'DRAFT'
                and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                and a.is_deleted = 'N'
                and not (a.is_archive or a.hidden)
                and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
        ) s7,
        ( select _no_bids

        ) s8

        --
        -- ЛП
        --
        -- "Ожидает решения комитета" - код для счетчиков waiting_lp   FRONT_ACCEPTING - "
            , (
            select count(*) as waiting_lp from ( select a.id_auction
                                             from auction a
                                                      inner join object o on (a.id_object = o.id_object)
                                                      inner join obj_attrib_values oav on (o.id_object = oav.id_object)
                                                      left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
                                             where a.is_deleted = 'N'
                                                     and not (a.is_archive or a.hidden)
                                                 --and a.status = 'SUCCESS'
                                                     and a.workflow_status = 'FRONT_ACCEPTING'
                                                     and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                                                     and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
                                                     and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction) or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
                                                     and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
            ) s02
        ) s9
        --  "Подтверждение продажи"  - waiting_confirm_lp  BACK_ACCEPTING - "П
            , (
            select count(*) as waiting_confirm_lp from ( select a.id_auction
                                             from auction a
                                                      inner join object o on (a.id_object = o.id_object)
                                                      inner join obj_attrib_values oav on (o.id_object = oav.id_object)
                                                      left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
                                             where a.is_deleted = 'N'
                                                     and not (a.is_archive or a.hidden)
                                                 --and a.status = 'SUCCESS'
                                                     and a.workflow_status = 'BACK_ACCEPTING'
                                                     and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                                                     and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
                                                     and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction) or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
                                                     and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
            ) s02
        ) s10
        --"Продажа подтверждена" - confirmed_lp  SUCCESS (WF STATUS)
            , (
            select count(*) as confirmed_lp from ( select a.id_auction
                                             from auction a
                                                      inner join object o on (a.id_object = o.id_object)
                                                      inner join obj_attrib_values oav on (o.id_object = oav.id_object)
                                                      left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
                                             where a.is_deleted = 'N'
                                                     and not (a.is_archive or a.hidden)
                                                 --and a.status = 'SUCCESS'
                                                     and a.workflow_status = 'SUCCESS'
                                                     and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                                                     and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
                                                     and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction) or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
                                                     and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
            ) s02
        ) s11
        -- "Загружено в НОЛС" - in_nols  NOLS_ACCEPTING- "За
            , (
            select count(*) as in_nols from ( select a.id_auction
                                             from auction a
                                                      inner join object o on (a.id_object = o.id_object)
                                                      inner join obj_attrib_values oav on (o.id_object = oav.id_object)
                                                      left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
                                             where a.is_deleted = 'N'
                                                     and not (a.is_archive or a.hidden)
                                                 --and a.status = 'SUCCESS'
                                                     and a.workflow_status = 'NOLS_ACCEPTING'
                                                     and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                                                     and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
                                                     and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction) or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
                                                     and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
            ) s02
        ) s12
-- "Завершенные продажи" - in_ready  READY
            , (
            select count(*) as in_ready from ( select a.id_auction
                                               from auction a
                                                        inner join object o on (a.id_object = o.id_object)
                                                        inner join obj_attrib_values oav on (o.id_object = oav.id_object)
                                                        left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
                                               where a.is_deleted = 'N'
                                                       and not (a.is_archive or a.hidden)
                                                   --and a.status = 'SUCCESS'
                                                       and a.workflow_status = 'READY'
                                                       and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                                                       and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
                                                       and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction) or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
                                                       and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
            ) s02
        ) s13
-- "Cделка завершена CL" - in_done
            , (
            select count(*) as in_done from ( select a.id_auction
                                               from auction a
                                                        inner join object o on (a.id_object = o.id_object)
                                                        inner join obj_attrib_values oav on (o.id_object = oav.id_object)
                                                        left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
                                               where a.is_deleted = 'N'
                                                       and not (a.is_archive or a.hidden)
                                                   --and a.status = 'SUCCESS'
                                                       and a.workflow_status = 'DONE'
                                                       and carl_auct._get_id_workflow(a.id_auction) = 'LP_AUCTION'
                                                       and a.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
                                                       and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction) or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
                                                       and carl_auct._dt_end_in_interval(extract (epoch from a.dt_end)::/*ERV:bigint*/ bigint, _dt_from, _dt_to, _dt_now )
            ) s02
        ) s14
    ;

    return _rec;
end;
$$ language plpgsql;




-- drop function if existscarl_auct.getAuctSellCounts(p_id_profile int);

------------------------------------------------------------------------------------------------------------------------
-- AUCT.ACTIVE
-- Количество аукционов для активностей продавца с id_profile
-- select * from carl_auct.getAuctSellCounts(3,17);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctSellCounts(p_id_user int, p_id_profile int)
	returns json security definer as $$
  select row_to_json(r) from (
     select * from carl_auct.getAuctSellCountsT(p_id_user, p_id_profile)
    ) r
$$ language sql;


------------------------------------------------------------------------------------------------------------------------
-- AUCT.ACTIVE
-- Количество аукционов для активностей продавца с id_profile
-- select * from carl_auct.getAuctSellCountsLP(3,17);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctSellCountsLP(p_id_user int, p_id_profile int)
    returns json security definer as $$
select row_to_json(r) from (
    select * from carl_auct.getAuctSellCountsT_LP(p_id_user, p_id_profile)
) r
$$ language sql;


drop type if exists t_buyer_counts cascade;
create type t_buyer_counts as (total int, active int, bought int, not_bought int, waiting int, lead int, overbid int);

-- drop function if existscarl_auct.getAuctBuyerCountsT(p_id_profile int);
-- drop function if existscarl_auct.getAuctBuyerCountsT(p_id_user int, p_id_profile int);

------------------------------------------------------------------------------------------------------------------------
-- AUCT.ACTIVE
-- Количество аукционов для активностей покупателя с id_profile
-- select * from carl_auct.getAuctBuyerCountsT(3,17);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctBuyerCountsT(p_id_user int, p_id_profile int)
	returns t_buyer_counts security definer as $$
declare
  _rec t_buyer_counts; _is_company boolean;
begin
  _is_company := carl_prof.isCompany(p_id_profile);

  --if(_is_company) then
    select * into _rec from
    (select count(*) as all2 from ( select a.id_auction
 				from auction a
                    -- для согласования с ГФ добавлено:
                         inner join object o on (a.id_object = o.id_object)
                         inner join obj_attrib_values oav on (o.id_object = oav.id_object)
 				left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction  and a.is_deleted = 'N' and ab.is_deleted = 'N')
 				where a.is_deleted = 'N'
 					and a.id_auction
 						in (select id_auction from auction_bid ab
 								where
 							    ab.id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile )
 							and is_deleted = 'N')
                    and (( a.status ='ACTIVE' or  a.status ='FINISHED' or  a.status ='SUCCESS' or  a.status ='BUYNOW' or  a.status ='FAILED'))
          --and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction) or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
    ) s01
    ) s1,
    -- активные
    (select count(*) as active from ( select a.id_auction
          from auction a
              -- для согласования с ГФ добавлено:
                   inner join object o on (a.id_object = o.id_object)
                   inner join obj_attrib_values oav on (o.id_object = oav.id_object)
          left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
          where a.is_deleted = 'N'
            and a.id_auction
              in (select id_auction from auction_bid ab
                  where
                    ab.id_user_profile in (select id_user_profile from user_profile where is_deleted = 'N' and id_profile = p_id_profile )
                and is_deleted = 'N')
                --and( carl_auct._is_seller_of_auct(p_id_profile,a.id_auction) or carl_auct._canProfBuy(p_id_profile,a.id_auction) )
                and (( a.status ='ACTIVE'))
          ) s02
    ) s2,
    -- куплено
    (select count(*) as bought from (
      select a.id_auction
          from auction a
              -- для согласования с ГФ добавлено:
                   inner join object o on (a.id_object = o.id_object)
                   inner join obj_attrib_values oav on (o.id_object = oav.id_object)
          left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction
                                           and a.is_deleted = 'N' and ab.is_deleted = 'N')
          where
          a.is_deleted = 'N'
          and (a.status = 'SUCCESS' or a.status = 'BUYNOW')
          and a.id_auction in (select id_auction from auction_bid ab
                where ab.bid_status = 'LEAD'
                  and ab.id_user_profile in  (select id_user_profile from user_profile where id_profile = p_id_profile )
                  and ab.is_deleted = 'N')
      ) s03
    ) s3,
    -- не куплено
    (select count(*) as not_bought from ( select a.id_auction
          from auction a
              -- для согласования с ГФ добавлено:
                   inner join object o on (a.id_object = o.id_object)
                   inner join obj_attrib_values oav on (o.id_object = oav.id_object)

          left join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N')
          where
          a.is_deleted = 'N'
          and (
            ( (a.status = 'SUCCESS' or a.status = 'BUYNOW' or a.status = 'FINISHED')
              and carl_auct._getAuctLeaderIdProf(a.id_auction) <> p_id_profile
              and a.id_auction in (select id_auction from auction_bid ab
                  where ab.id_user_profile in (select id_user_profile from user_profile where 2=2 --is_deleted = 'N'
                                                                                              and id_profile = p_id_profile )
                      and ab.is_deleted = 'N')
            ) or ( (a.status = 'FAILED')
                and a.id_auction in (select id_auction from auction_bid ab
                  where ab.id_user_profile in (select id_user_profile from user_profile where 2=2 --is_deleted = 'N'
                                                                                              and id_profile = p_id_profile )
                    and ab.is_deleted = 'N')
             )
          )) s04
        ) s4,
        -- ожидают решения
        (select count(*) as waiting from ( select a.id_auction
          from auction a where 1=1
                and carl_auct._is_buyer_wait_solution(p_id_user,p_id_profile,a.id_auction)
                and (a.status = 'FINISHED')
                and a.is_deleted = 'N'
              ) s05
            ) s5
      ,
   -- лидирует
    (select count(*) as lead from ( select a.id_auction
          from auction a
          inner join auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction and ab.is_deleted = 'N'
              and ab.id_user_profile in (select id_user_profile from user_profile where is_deleted = 'N' and id_profile = p_id_profile ))
          where
            a.is_deleted = 'N'
            and (a.status = 'ACTIVE')
      ) s031
    ) s6,
  -- перебит
    (select count(*) as overbid from (select distinct on (a.id_auction) a.id_auction
          from auction a
          inner join auction_bid ab on (ab.id_auction = a.id_auction and ab.is_deleted = 'N'
            and ab.id_user_profile in (select id_user_profile from user_profile where is_deleted = 'N' and id_profile = p_id_profile ))
          where
            a.is_deleted = 'N'
            and (a.status = 'ACTIVE')
            and _get_auct_leader(a.id_auction) <> p_id_profile
      ) s032
    ) s7
    ;
  return _rec;
end;
$$ language plpgsql;


drop type if exists t_broker_counts cascade;
create type t_broker_counts as (total int, bought int, not_bought int, waiting int);

drop function if exists carl_auct.getAuctBrokerCountsT(p_id_user int, p_id_profile_broker int);

------------------------------------------------------------------------------------------------------------------------
-- AUCT.ACTIVE
-- Количество аукционов для активностей брокера
-- select carl_auct.getAuctBrokerCountsT(7,4496);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctBrokerCountsT(p_id_user int, p_id_profile_broker int)
	returns t_broker_counts security definer as $$
declare
  _rec t_broker_counts;
  _id_broker int;
begin

    -- получаем id_broker
    select id_broker into _id_broker from carl_data.broker where id_profile_owner = p_id_profile_broker;

    if(_id_broker is null) then
      _id_broker := -1; -- запрос не должен учитывать брокера
    end if;

    select * into _rec from
    -- total
    (select count(*)::int as all2 from ( select a.id_auction
 				from carl_data.auction a
			inner join carl_data.object o on (a.id_object = o.id_object)
			inner join carl_data.obj_attrib_values oav on (o.id_object = oav.id_object)
			inner join carl_data.auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction  and a.is_deleted = 'N' and ab.is_deleted = 'N')
      where a.is_deleted = 'N'
       and a.status not in ('ACTIVE')
       and a.id_auction = ab.id_auction
       and ab.bid_status = 'LEAD'
       and ab.id_user_profile in (select id_user_profile from user_profile where id_profile in (select id_profile from profile where id_broker = _id_broker))

-- 				and a.id_auction
-- 					in (select id_auction from carl_data.auction_bid ab
-- 							where
-- 						    ab.id_user_profile in (
-- 							select id_user_profile from carl_data.user_profile up1, carl_data.profile p1
-- 								where up1.id_profile = p1.id_profile and p1.id_broker = _id_broker )
-- 						and is_deleted = 'N')
    ) s01
    ) s1,
    -- куплено
    (select count(*)::int as bought from (
      select a.id_auction
          from carl_data.auction a
          left join carl_data.auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction  and a.is_deleted = 'N' and ab.is_deleted = 'N')
          where
          a.is_deleted = 'N'
          and (a.status = 'SUCCESS' or a.status = 'BUYNOW')
 				and a.id_auction in (select id_auction from carl_data.auction_bid ab
 							where ab.bid_status = 'LEAD'
 			  				and ab.id_user_profile in
                    (select id_user_profile from carl_data.user_profile where id_profile in
                           (select id_profile from carl_data.profile where id_broker = _id_broker))  and ab.is_deleted = 'N')
      ) s03
    ) s3,
    -- не куплено
    (select count(*)::int as not_bought from ( select a.id_auction
          from carl_data.auction a
          inner join object o on (a.id_object = o.id_object)
          inner join carl_data.obj_attrib_values oav on (o.id_object = oav.id_object)
          left join carl_data.auction_bid ab on (ab.bid_status='LEAD' and ab.id_auction = a.id_auction  and a.is_deleted = 'N' and ab.is_deleted = 'N')
          where
 				        a.is_deleted = 'N'
           and a.status = 'FAILED'
           and a.id_auction in (select id_auction from auction_bid ab
           where ab.bid_status = 'LEAD'
           and ab.id_user_profile in   (select id_user_profile from user_profile where id_profile in (select id_profile from profile where id_broker = 1))
          )) s04
        ) s4,
      (select count(*) as waiting from ( select a.id_auction
				from auction a
				inner join object o on (a.id_object = o.id_object)
				inner join obj_attrib_values oav on (o.id_object = oav.id_object)
        where a.is_deleted = 'N'
          and carl_auct._is_my_phys_wait_solution(_id_broker, a.id_auction)
          and a.status = 'FINISHED'
    ) s05
   ) s5

    ;
  return _rec;
end;
$$ language plpgsql stable ;


-- drop function if existscarl_auct.getAuctBuyerCounts(id_profile int);
-- drop function if existscarl_auct.getAuctBuyerCounts(p_id_profile int);

------------------------------------------------------------------------------------------------------------------------
-- Количество аукционов для активностей покупателя с id_profile
-- select * from carl_auct.getAuctBuyerCounts(1,198);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctBuyerCounts(p_id_user int, p_id_profile int)
	returns json security definer as $$
  select row_to_json(r) from (
    select * from carl_auct.getAuctBuyerCountsT(p_id_user, p_id_profile)
  ) r
$$ language sql stable ;


------------------------------------------------------------------------------------------------------------------------
-- Количество аукционов для активностей брокера с p_id_profile_broker
-- select * from carl_auct.getAuctBrokerCounts(1,198);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctBrokerCounts(p_id_user int, p_id_profile_broker int)
	returns json security definer as $$
  select row_to_json(r) from (
    select * from carl_auct.getAuctBrokerCountsT(p_id_user, p_id_profile_broker)
  ) r
$$ language sql stable ;


-- drop function if existscarl_auct.getAuctEventDate(p_id_auct int, p_auct_status varchar);

------------------------------------------------------------------------------------------------------------------------
-- Дата последнего перехода аукциона (p_id_auct) в статус (p_auct_status)
-- Пример:
--   select carl_auct.getAuctEventDate(83, 'SUCCESS');
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctEventDate(p_id_auct int, p_auct_status varchar)
  returns timestamp with time zone
  as $$
    SELECT max(log.dt_set)
    FROM carl_data.auction auct, carl_data.auction_log log
    WHERE auct.id_auction = log.id_auction and
      auct.is_deleted='N' and
      log.is_deleted='N' and
      auct.id_auction=p_id_auct and
      auct.status=p_auct_status::en_auction_status
  $$ language sql;


------------------------------------------------------------------------------------------------------------------------
-- Данные для календаря
-- Пример:
--   select carl_auct.getAuctionCalendar(1, 198);
--   select carl_auct.getAuctionCalendar(4, 18);
--   select carl_auct.getAuctionCalendar(4, 16);
--   select carl_auct.getAuctionCalendar(3, 17);
-- {seller_name: "ALD", dt_start: 123134, dt_end: 1323445, sum: 30
--    , auct_type:{"OPEN" : 14, "OFFER" : 16 }
--    , status:{ "ACTIVE" : 26, "FINISHED" : 4 }}
-- Последние хотелки:
--  Скрывать из общей таблицы строки, по которым торги уже завершились
--  Изменить календарный период. Сейчас 5 недель до + текущая. Надо предыдущая неделя - текущая - следующая
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctionCalendar(p_id_user int, p_id_profile int)
  returns setof json security definer as $$
declare
  _seller_name varchar; _dt_start int; _dt_end int; _sum int; _is_queue boolean;
  _ar_auction_type json; _j_ar_auction_type json;
  _ar_status json; _j_ar_status json;
  _j_out json; _id_queue int; _id_seller int; _q_name varchar;
begin

  for _seller_name, _id_seller, _dt_start, _dt_end, _sum, _ar_auction_type
      , _ar_status, _is_queue, _id_queue, _q_name in (
select  -- seller_name
       carl_prof.getProfNameForAuct(id_seller) as seller_name
      , id_seller
      -- , dt_start as dt_start_1
      -- , dt_end as dt_end_1
      , extract(epoch from dt_start) as dt_start
      , extract(epoch from dt_end) as dt_end
      , sum(n)
      , json_object_agg(auction_type, n) ar_auction_type
      , json_object_agg(status, n) ar_status
      , is_queue
      , id_queue
      , q_name
    from (
           select seller_name, id_seller, dt_start, dt_end,
            auction_type, count(1) n, status
            , case when id_queue is null then false else true end as is_queue
            , id_queue
            , q_name
            from (
                   select a.id_auction ia
                      , seller_name
                      , _get_auct_seller_id(a.id_auction) as id_seller
                      , case when a.id_queue is null then
                          a.dt_start::date::timestamp with time zone
                        else
                          q.dt_start::timestamp with time zone
                        end as dt_start
                      , dt_end::date::timestamp with time zone +'23:00:00' as dt_end
                      , auction_type
                      , a.status
                      , a.id_queue
                      , q.name  q_name
                    from auction a
                         left join queue q on q.id_queue = a.id_queue
                    where 2=2
                          and a.is_deleted = 'N'
                          and (a.status in
                               ('ACTIVE'::en_auction_status
                                -- ,'FINISHED'::en_auction_status,'SUCCESS'::en_auction_status,'FAILED'::en_auction_status
                               )
                              )
                          and (
                            -- админ видит всегда
                            carl_auth._is_admin(p_id_user)
                            or (
                              -- не админ, но продавец видит свои
                              --    и все активные аукционы, которые разрешено покупать
                              carl_auct._is_seller_of_auct(p_id_profile, a.id_auction)
                              or (a.status = 'ACTIVE' :: en_auction_status and
                                  carl_auct._canProfBuy(p_id_profile, a.id_auction))
                            )
--                             or (
--                               -- не админ, но покупатель видит все где есть его ставки
--                               --    и все активные аукционы, которые разрешено покупать
--                               carl_auct._getNumAuctBids(p_id_profile, a.id_auction) > 0
--                               or (a.status = 'ACTIVE' :: en_auction_status and
--                                   carl_auct._canProfBuy(p_id_profile, a.id_auction))
--                             )
                          )
                      -- and dt_start::date > to_date('09.06.2018','DD.MM.YYYY')
                      -- and dt_start::date < to_date('15.06.2018','DD.MM.YYYY')
                   ) t
            group by seller_name, id_seller, dt_start, dt_end, auction_type, status, id_queue, q_name
         ) t2
         -- where dt_end > now() - interval '2 week'
         where is_queue  or dt_end < now() + interval '1 week'
        group by seller_name, id_seller, dt_start, dt_end, is_queue, id_queue, q_name

    ) loop
     select json_object_agg(k,s) into _j_ar_auction_type from
         (select key as k, sum(value::int) as s
          from json_each_text(_ar_auction_type) as ar
          group by k
      ) s;
      select json_object_agg(k,s) into _j_ar_status from
         (select key as k, sum(value::int) as s
          from json_each_text(_ar_status) as ar
          group by k
      ) s;

      _j_out := json_build_object('seller_name', _seller_name
          , 'id_seller', _id_seller
          , 'dt_start', _dt_start
          , 'dt_end', _dt_end
          , 'sum', _sum
          , 'auct_type',_j_ar_auction_type::jsonb
          , 'auct_status', _j_ar_status::jsonb
          , 'is_queue', _is_queue
          , 'id_queue', _id_queue
          , 'queue_name', _q_name
          );
      return next _j_out;
    end loop;
end;
$$ language plpgsql;


-- ------------------------------------------------------------------------------------------------------------------------
-- -- Данные для календаря
-- -- Пример:
-- --   select carl_auct.getAuctionCalendar(1, 198);
-- --   select carl_auct.getAuctionCalendar(4, 18);
-- --   select carl_auct.getAuctionCalendar(4, 16);
-- -- {seller_name: "ALD", dt_start: 123134, dt_end: 1323445, sum: 30
-- --    , auct_type:{"OPEN" : 14, "OFFER" : 16 }
-- --    , status:{ "ACTIVE" : 26, "FINISHED" : 4 }}
-- ------------------------------------------------------------------------------------------------------------------------
-- create or replace function carl_auct.getAuctionCalendar(p_id_user int, p_id_profile int)
--   returns setof json security definer as $$
-- declare
-- 	_seller_name varchar; _dt_start int; _dt_end int; _sum int;
--   _ar_auction_type json; _j_ar_auction_type json;
--   _ar_status json; _j_ar_status json;
--   _j_out json;
-- begin
--
--   for _seller_name, _dt_start, _dt_end, _sum, _ar_auction_type, _ar_status in (
--   select seller_name
--       -- , dt_start as dt_start_1
--       -- , dt_end as dt_end_1
--       , extract(epoch from dt_start) as dt_start
--       , extract(epoch from dt_end) as dt_end
--       , sum(n)
--       , json_object_agg(auction_type, n) ar_auction_type
--       , json_object_agg(status, n) ar_status
--     from (
--            select seller_name, dt_start, dt_end,
--             auction_type, count(1) n, status
--             from (
--                    select a.id_auction ia, seller_name, dt_start::date::timestamp with time zone
--                       , dt_end::date::timestamp with time zone +'23:00:00' as dt_end
--                       , auction_type
--                       , status
--                     from auction a
--                     where a.is_deleted = 'N'
--                           and (a.status in
--                                ('ACTIVE'::en_auction_status
--                                 -- ,'FINISHED'::en_auction_status,'SUCCESS'::en_auction_status,'FAILED'::en_auction_status
--                                )
--                               )
--                           and (
--                             -- админ видит всегда
--                             carl_auth._is_admin(p_id_user)
--                             or (
--                               -- не админ, но продавец видит свои
--                               --    и все активные аукционы, которые разрешено покупать
--                               carl_auct._is_seller_of_auct(p_id_profile, a.id_auction)
--                               or (a.status = 'ACTIVE' :: en_auction_status and
--                                   carl_auct._canProfBuy(p_id_profile, a.id_auction))
--                             )
-- --                             or (
-- --                               -- не админ, но покупатель видит все где есть его ставки
-- --                               --    и все активные аукционы, которые разрешено покупать
-- --                               carl_auct._getNumAuctBids(p_id_profile, a.id_auction) > 0
-- --                               or (a.status = 'ACTIVE' :: en_auction_status and
-- --                                   carl_auct._canProfBuy(p_id_profile, a.id_auction))
-- --                             )
--                           )
--                       -- and dt_start::date > to_date('09.06.2018','DD.MM.YYYY')
--                       -- and dt_start::date < to_date('15.06.2018','DD.MM.YYYY')
--                    ) t
--             group by seller_name, dt_start, dt_end, auction_type, status, id_queue
--          ) t2
--          -- where dt_end > now() - interval '2 week'
--          where id_queue is not null or dt_end > now() + interval '1 week'
--     group by seller_name, dt_start, dt_end
--     order by seller_name, dt_start, dt_end
--     ) loop
--      select json_object_agg(k,s) into _j_ar_auction_type from
--          (select key as k, sum(value::int) as s
--           from json_each_text(_ar_auction_type) as ar
--           group by k
--       ) s;
--       select json_object_agg(k,s) into _j_ar_status from
--          (select key as k, sum(value::int) as s
--           from json_each_text(_ar_status) as ar
--           group by k
--       ) s;
--
--       _j_out := json_build_object('seller_name', _seller_name, 'dt_start', _dt_start, 'dt_end', _dt_end, 'sum', _sum, 'auct_type',_j_ar_auction_type::jsonb, 'auct_status', _j_ar_status::jsonb);
--       return next _j_out;
--     end loop;
-- end;
-- $$ language plpgsql;



------------------------------------------------------------------------------------------------------------------------
-- Город лидера аукциона p_id_auction
-- если города нет вернет null
-- Пример:
--   select carl_auct.getAuctLeadCity(316);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctLeadCity(p_id_auction int)
  returns varchar security definer as $$
  select ct.name
    from auction_bid ab, user_profile up, profile p, city ct
    where up.id_user_profile = ab.id_user_profile
        and up.id_profile = p.id_profile
        and ct.id_city = p.id_city
        and ab.bid_status = 'LEAD'
        and ab.id_auction = p_id_auction
$$ language sql;


------------------------------------------------------------------------------------------------------------------------
-- Получаем макс ставку профиля p_id_profile по аукциону p_id_auction
-- Пример:
--   select carl_auct.getMaxBidInAuct(93, 7138);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getMaxBidInAuct(p_id_profile int, p_id_auction int)
  returns int security definer as $$
select max(bid_value) from auction_bid
  where id_auction = p_id_auction and id_user_profile in (select id_user_profile from user_profile where id_profile = p_id_profile)
    and is_deleted = 'N';
$$ language sql;


------------------------------------------------------------------------------------------------------------------------
-- Удаление аукциона
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.deleteAuct(p_id_auction int)
  returns void security definer as $$
  update auction set is_deleted='Y' where id_auction = p_id_auction
$$ language sql;


------------------------------------------------------------------------------------------------------------------------
-- Перевод аукциона в статус SUCCESS BUYNOW
--
-- select params->'autolock_on_success'->>'comment'
--      , (params->'autolock_on_success'->>'duration')::interval
--      , (params->'autolock_on_success'->>'comment')::text
--            || ' Блокировка до '
--            || to_char(current_timestamp + (params->'autolock_on_success'->>'duration')::interval, 'DD.MM.YYYY')
--            || '.'
--      -- , params->'autolock_on_success'
-- from promo
-- ;


------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._to_SUCCESS_BUYNOW(p_id_auction int, p_status varchar)
    returns void security definer as $$
declare
    _id_prof_lead int;
    _comment varchar; _duration interval; _blocked_before bigint;
begin
    _id_prof_lead := carl_auct._get_auct_leader(p_id_auction);

    -- Блокировка профиля промокодчика после покупки
    select -- params->'autolock_on_success'->>'comment'
          (params->'autolock_on_success'->>'comment')::text
               || ' Блокировка до '
               || to_char(current_timestamp + (params->'autolock_on_success'->>'duration')::interval, 'DD.MM.YYYY')
         , (params->'autolock_on_success'->>'duration')::interval
         -- , params->'autolock_on_success'
    into _comment, _duration
    from promo
    where id = (select (parameters->>'id_promo')::int from profile where id_profile = _id_prof_lead)
      and (params->'autolock_on_success'->'enabled')::boolean
    ;
    -- raise exception 'ОТЛАДКА! _blockProf() -1- _duration %', _duration;

    if(_duration is not null) then
        _blocked_before := extract(epoch from current_timestamp + _duration)::bigint;
        perform carl_prof._blockProf(_id_prof_lead
            , _comment
            , _blocked_before
            , true);
        -- raise exception 'ОТЛАДКА! _blockProf()жэ';
    end if;

    -- ели убогий(promo_partial)
    -- высталяем promo_winer
    if(carl_prof.getProfParameterB(_id_prof_lead,'{promo_partial}',false)) then
        perform carl_prof.setProfParameter(_id_prof_lead, '{"promo_winer":true}');
    end if;
    update auction set status=p_status::en_auction_status, workflow_status=p_status
        where id_auction = p_id_auction;
end;
$$ language plpgsql;



------------------------------------------------------------------------------------------------------------------------
-- Перевод аукциона в статус SUCCESS
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._to_SUCCESS(p_id_auction int)
    returns void security definer as $$
declare
    begin
        perform carl_auct._to_SUCCESS_BUYNOW(p_id_auction, 'SUCCESS');
end;
$$ language plpgsql;


------------------------------------------------------------------------------------------------------------------------
-- Перевод аукциона в статус BUYNOW
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._to_BUYNOW(p_id_auction int)
    returns void security definer as $$
declare
begin
    perform carl_auct._to_SUCCESS_BUYNOW(p_id_auction, 'BUYNOW');
end;
$$ language plpgsql;


drop function if exists carl_auct._checkActiveAuctionStatus(int, boolean);

----------------------------------------------------------------------------------
--  Проверяет и меняет статус активного(ных) аукциона для p_id_auction
--    если p_id_auction is null то проверка по всем активным Аукционам
--    если p_take_query = false то не берем аукционы из очереди
--  Возвращает: событие с массивами id_auction для перешедших в состояние
-- 							SUCCESS (ключ - act2suc), FINISHED (ключ - act2fin) и FAILED (ключ - act2fail)
-- 							{"act2suc":[11], "event":{"act2fin":[1,2,3],"act2fail":[7,8]}}
--  Исключения:
-- select carl_auct._checkActiveAuctionStatus(null, false);
----------------------------------------------------------------------------------
create or replace function carl_auct._checkActiveAuctionStatus(p_id_auction int, p_take_query boolean)
	returns json security definer as $$
declare
	_auction auction%rowtype; _bid_value_lead int;
	_cnt int; _act2suc int array; _act2fin int array; _act2fail int array;
  _act2err json array;
  _dummy_user int := 0;
  _dummy_profile int := 0;
  _id_action varchar := 'ACTIVE_TO_FAILED';
  _j json; _err_txt1 text; _err_txt4 text;
  _test_makebid_wait_time_sec text;
  _delta_sniper interval;
  _counteroffer jsonb; -- _parameters jsonb;
  _counteroffer_cf float;
begin

  perform writelog('~~~ _checkActiveAuctionStatus() -1- ','carl_auct._checkActiveAuctionStatus()','QUEUE_DEBUG','INFO');

  _delta_sniper := carl_comm.getParameter('delta_sniper')::interval;

	for _auction in
		select * from carl_data.auction
		         where is_deleted = 'N'
			        and (status = 'ACTIVE'::en_auction_status)
			        and (p_id_auction is null or id_auction = p_id_auction)
                   and (id_auction not in (select id_auction from carl_data.queue_auction qa, queue qq
                                                             where qa.id_queue = qq.id_queue
                                                             and qq.status = 'RUN'
                                                             and qa.paused
                                                             )) -- не берем аукционы из очереди
                    -- and (p_take_query or id_auction not in (select id_auction from carl_data.queue_auction)) -- не берем аукционы из очереди
                    and dt_end + _delta_sniper <= clock_timestamp()
	loop
        raise notice '~~~ -2- _checkActiveAuctionStatus() ';
        -- perform writelog('~~~ _checkActiveAuctionStatus() -2- ','carl_auct._checkActiveAuctionStatus()','QUEUE_DEBUG','INFO');
        begin
            -- if( carl_auct._get_auct_dt_end(_auction.id_auction) <= clock_timestamp())	then
            -- есть ставки?
            select count(*) into _cnt from auction_bid where is_deleted = 'N'
                and id_auction = _auction.id_auction;
            if(_cnt > 0 and _auction.auction_type <> 'BUYNOW') then -- FIXME: при buynow ставка же все равно будет. лишнее условие
                if(_auction.id_workflow = 'VW_AUCTION') then  -- FIXME: Надо ЧЕРЕЗ WORKFLOW
                -- блокируем на время обработки
                    perform carl_auct._auctLock(_auction.id_auction);
                    update auction set status='FINISHED', workflow_status='FRONT_ACCEPTING'
                    where id_auction = _auction.id_auction;
                    _act2fin := _act2fin || array[_auction.id_auction];
                    perform _writeAuctLog('FINISHED'::en_auction_event_type,null,null,null,_auction.id_auction
                        ,null,null,null,'{"src":"carl3_auct.checkActiveAuctionStatus()"}'::json);
                elsif(_auction.id_workflow = 'LP_AUCTION') then  -- FIXME: Надо ЧЕРЕЗ WORKFLOW
                    -- блокируем на время обработки
                    perform carl_auct._auctLock(_auction.id_auction);
                    -- RAISE EXCEPTION '~~~`';
                    update auction set status='FINISHED', workflow_status='FRONT_ACCEPTING'
                        where id_auction = _auction.id_auction;
                    _act2fin := _act2fin || array[_auction.id_auction];
                    perform _writeAuctLog('FINISHED'::en_auction_event_type,null,null,null,_auction.id_auction
                        ,null,null,null,'{"src":"carl3_auct.checkActiveAuctionStatus()"}'::json);
                elseif(_auction.auction_type = 'OFFER'
                         or (_auction.auction_type = 'OPEN' and _auction.min_price is null
                                and _auction.id_workflow <> 'STANDART_AUCTION_OPEN_COUNTER')
                            ) then
                    -- блокируем на время обработки
                    perform carl_auct._auctLock(_auction.id_auction);
                    update auction set status='FINISHED', workflow_status='FINISHED'
                    where id_auction = _auction.id_auction;
                    _act2fin := _act2fin || array[_auction.id_auction];
                    perform _writeAuctLog('FINISHED'::en_auction_event_type,null,null,null,_auction.id_auction
                    ,null,null,null,'{"src":"carl_auct.checkActiveAuctionStatus()"}'::json);
                elseif(_auction.auction_type = 'OPEN') then
                    select bid_value into _bid_value_lead from auction_bid where
                        id_auction = _auction.id_auction and is_deleted = 'N' and bid_status = 'LEAD';
                    raise warning '~~~ checkActiveAuctionStatus() % + %',_auction.min_price, _bid_value_lead;
                    _counteroffer_cf := getParameter('counteroffer_upper_margin_cf')::float ;
                    -- if(_bid_value_lead is not null and _auction.min_price <= _bid_value_lead)
                    if(_bid_value_lead is not null and coalesce(_auction.min_price,   _bid_value_lead * _counteroffer_cf ) <= _bid_value_lead)
                    then
                        raise notice '~~~ checkActiveAuctionStatus() ~~~ SUCCESS';
                        -- блокируем на время обработки
                        perform carl_auct._auctLock(_auction.id_auction);
                        perform carl_auct._to_SUCCESS(_auction.id_auction);
                        -- update auction set status='SUCCESS', workflow_status='SUCCESS'
                        --  where id_auction = _auction.id_auction;
                        _act2suc := _act2suc || array[_auction.id_auction];
                        perform _writeAuctLog('SUCCESS'::en_auction_event_type,null,null,null,_auction.id_auction
                          ,null,null,null,'{"src":"carl_auct.checkActiveAuctionStatus()"}'::json);
                    else
                        -- мин цена не достигнута
                        raise notice '~~~ checkActiveAuctionStatus() ~~~ мин цена не достигнута';
                        if(_auction.id_workflow = 'STANDART_AUCTION_OPEN_COUNTER') then
                          -- идем в контрпредложения
                          -- пересчитываем dt_approve approve_days null чтобы правильно сарботал тригер!
                          _counteroffer := jsonb_build_object('min',carl_auct._get_auct_curent_price(_auction.id_auction)
                            ,'max', coalesce(carl_auct._get_auct_min_price(_auction.id_auction), _bid_value_lead * _counteroffer_cf )::int);
                          raise notice '~~~ checkActiveAuctionStatus() _counteroffer % ', _counteroffer;
                          --     perform writelog('~~~ _checkActiveAuctionStatus() -X- '||_counteroffer::text||'  _bid_value_lead * _counteroffer_cf '||  ((_bid_value_lead * _counteroffer_cf)::int)::text ,'carl_auct._checkActiveAuctionStatus()','COUNTER_OFFER_DEBUG','INFO');
                          _auction.parameters := _auction.parameters - 'counteroffer';
                          update auction set status='FINISHED', workflow_status='FINISHED'
                            , dt_approve = current_timestamp + interval '1 day', approve_days = null
                            , parameters = _auction.parameters || jsonb_build_object('counteroffer',_counteroffer)
                            where id_auction = _auction.id_auction;

                          _act2fin := _act2fin || array[_auction.id_auction];
                          perform _writeAuctLog('FINISHED'::en_auction_event_type,null,null,null,_auction.id_auction
                            ,null,null,null,'{"src":"carl_auct.checkActiveAuctionStatus()"}'::json);
                        else
                          -- блокируем на время обработки
                          perform carl_auct._auctLock(_auction.id_auction);
                          perform carl_wf.executeAction(_dummy_user, _dummy_profile, _auction.id_auction, _id_action);
                          _act2fail := _act2fail || array[_auction.id_auction];
                          -- perform _writeAuctLog('FAILED'::en_auction_event_type,null,null,null,_auction.id_auction
                          --  ,null,null,null,'{"src":"carl_auct.checkActiveAuctionStatus()"}'::json);
                        end if;
                    end if;
                else
                    raise exception 'Тип аукциона не OFFER и не OPEN, а %',_auction.auction_type;
                end if;

            else -- нет ставок
                -- блокируем на время обработки
                perform carl_auct._auctLock(_auction.id_auction);
                perform carl_wf.executeAction(_dummy_user, _dummy_profile, _auction.id_auction, _id_action);
                _act2fail := _act2fail || array[_auction.id_auction];
            end if;
            -- end if;
        exception when others then
          get stacked diagnostics _err_txt1 = message_text,
                            _err_txt4 = pg_exception_context;
          _j := json_build_object('id_auction',_auction.id_auction,'id_action',_id_action,'msg',_err_txt1,'context',_err_txt4);
          _act2err := _act2err || array[_j];
        end;
        perform writelog('~~~ _checkActiveAuctionStatus() -4- ','carl_auct._checkActiveAuctionStatus()','QUEUE_DEBUG','INFO');
        --   -- FIXME: УБРАТЬ.
        --   -- задерживаем окончание на test_makebid_wait_time_sec сек
        --   _test_makebid_wait_time_sec := carl_comm.getParameter('test_makebid_wait_time_sec','-1');
        --   if(_test_makebid_wait_time_sec <> '-1') then
        --     perform pg_sleep(_test_makebid_wait_time_sec::int);
        --   end if;
        perform writelog('~~~ _checkActiveAuctionStatus() -5- ','carl_auct._checkActiveAuctionStatus()','QUEUE_DEBUG','INFO');
        -- разблокируем
        -- perform carl_auct._auctUnlock(_auction.id_auction);
	end loop;

	return json_build_object('event',json_build_object('act2suc',array_to_json(_act2suc)
    , 'act2fin',array_to_json(_act2fin)
		, 'act2fail',array_to_json(_act2fail)
    , 'act2err',array_to_json(_act2err))
  );
end
$$ language plpgsql;


drop function if exists carl_auct.checkActiveAuctionStatus(p_id_auction int);

----------------------------------------------------------------------------------
--  Проверяет и меняет статус активного(ных) аукциона для p_id_auction
--    если p_id_auction is null то проверка по всем активным Аукционам
--    аукцины из очереди не берутся
--  Возвращает: событие с массивами id_auction для перешедших в состояние
-- 							SUCCESS (ключ - act2suc), FINISHED (ключ - act2fin) и FAILED (ключ - act2fail)
-- 							{"act2suc":[11], "event":{"act2fin":[1,2,3],"act2fail":[7,8]}}
--  Исключения:
--  Пример: select carl_auct.checkActiveAuctionStatus(null);
----------------------------------------------------------------------------------
create or replace function carl_auct.checkActiveAuctionStatus(p_id_auction int default null)
	returns json security definer as $$
declare
begin
  return carl_auct._checkActiveAuctionStatus(p_id_auction, true); --ERV:100419  отключили чтобы попробовать закрывать по крону false);
end;
$$ language plpgsql;


----------------------------------------------------------------------------------
--  Установка тестового времени
----------------------------------------------------------------------------------
create or replace function carl_auct.get_current_timestamp()
 returns timestamp with time zone security definer as $$
  select current_timestamp
  -- select timestamptz '2018-11-02 22:00:00'
$$ language sql;


----------------------------------------------------------------------------------
--  Проверка состояния аукционов со статусом ACTIVE, FINISHED
--  ЧАСТЫЕ ВЫЗОВЫ (1 мин)
--  Возвращает: {"event" : {"fin2fail" : [8418,7423], "fin2prefail" : null}}
--
--  select checkAuctionStatus();
----------------------------------------------------------------------------------
create or replace function carl_auct.checkAuctionStatus()
 returns json security definer as $$
declare
    _jb_out jsonb; _s text;
  begin

  -- проверяем только is_open_couner
  _jb_out := carl_auct.checkFinishedAuctionStatus(null, null, true);
  raise notice '~~~ 1 _jb_out  % ',_jb_out;

  _jb_out := (_jb_out#>'{event}')::jsonb
             || (carl_auct.checkActiveAuctionStatus()#>'{event}')::jsonb;
  raise notice '~~~ 2 _jb_out  % ',_jb_out;
  _jb_out := jsonb_build_object('event',_jb_out);

  _s := format('checkAuctionStatus() возвратила %s', _jb_out);
  raise notice '~~~ checkAuctionStatus()  %', _s;
  perform writelog(_s, 'checkAuctionStatus()', 'OPEN_COUNTER', 'INFO');

  return _jb_out::json;
 end;
 $$ language plpgsql;


drop function if exists carl_auct.checkFinishedAuctionStatus(int, int);
drop function if exists carl_auct.checkFinishedAuctionStatus(int, int, boolean);

----------------------------------------------------------------------------------
--  Проверка состояния аукционов со статусом FINISHED
--  если задан p_id_auction то проверка выполняется только для этого аукциона
--  параметр p_days_pre_failed задает кол-во рабочих дней за которое будет выдано
--  предупреждение
--  Если p_conter_open_only то проверяются только аукционы с Котрпредложением
--  раздичаются частые запуски(для проверки контрпредложений) и редкие (остальные, кроме контрпредложений)
--
--  Возвращает: {"event" : {"fin2fail" : [8418,7423], "fin2prefail" : null}}
--
--  select checkFinishedAuctionStatus(8418,1);
--  select checkFinishedAuctionStatus(null);
----------------------------------------------------------------------------------
create or replace function carl_auct.checkFinishedAuctionStatus(p_id_auction int
  , p_days_pre_failed int default null
  , p_open_counter_only boolean default false)
 returns json security definer as $$
declare
	_auction auction%rowtype;
	_cnt int;
  _fin2fail int array; _fin2prefail int array; _fin2err json array;
  _n_wd int;
  _id_profile int;
  _j json; _err_txt1 text; _err_txt4 text;
begin
	for _auction in
		select * from auction where is_deleted = 'N'
			and (status = 'FINISHED'::en_auction_status )
			and (p_id_auction is null or id_auction = p_id_auction)
      -- and case when p_open_counter_only then workflow_status in ('FINISHED', 'SEL_OFFER', 'BUY_OFFER') else true end
      -- and case when not p_open_counter_only then workflow_status not in ('SEL_OFFER', 'BUY_OFFER') else true end
      and case when p_open_counter_only then id_workflow = 'STANDART_AUCTION_OPEN_COUNTER' else true end
	loop
   raise notice '~~~ p_days_pre_failed % , p_open_counter_only %', p_days_pre_failed, p_open_counter_only;

   _n_wd := carl_comm.getWorkDaysBetween((_auction.dt_end)::date
      , (carl_auct.get_current_timestamp())::date);

   begin
   if(p_days_pre_failed is not null) then
     if(_n_wd = _auction.approve_days - p_days_pre_failed) then
       select count(*) into _cnt from auction_log where
         event_type = 'PRE_FAILED'::en_auction_event_type
         and id_auction = _auction.id_auction
         and is_deleted = 'N';
       if(_cnt = 0) then
         perform carl_auct._writeAuctLog('PRE_FAILED'::en_auction_event_type,null,null,null,_auction.id_auction
                ,null,null,null,'{"src":"carl_auct.checkFinishedAuctionStatus()"}'::json);
         _fin2prefail := _fin2prefail || array[_auction.id_auction];
       end if;
     end if;
   else
     -- raise notice '~~~ 1 _auction.approve_days % _n_wd %',_auction.approve_days, _n_wd ;
     if(case when p_open_counter_only then current_timestamp > _auction.dt_approve
          else _n_wd >= _auction.approve_days
        end
      ) then
        -- raise notice '~~~ 1 ';
        update auction set status='FAILED', workflow_status='FAILED'
          where id_auction = _auction.id_auction;

        -- разбаланс
        select up.id_profile into _id_profile from auction_bid ab, user_profile up
          where ab.id_user_profile = up.id_user_profile
                and ab.id_auction = _auction.id_auction
                and ab.bid_status = 'LEAD'
                and ab.is_deleted = 'N'
                and up.is_deleted = 'N';

        if(_id_profile is not null) then
          -- raise notice '~~~ %',_id_profile;
          perform carl_auct.balanceUnReserv(_id_profile, _auction.id_auction);
        end if;

				perform carl_auct._writeAuctLog('FAILED'::en_auction_event_type,null,null,null,_auction.id_auction
					,json_build_object('auto_decline',true),null,null,'{"src":"carl_auct.checkFinishedAuctionStatus()"}'::json);
       _fin2fail := _fin2fail || array[_auction.id_auction];
     end if;
   end if;
   exception when others then
      get stacked diagnostics _err_txt1 = message_text,
  		                _err_txt4 = pg_exception_context;
      _j := json_build_object('id_auction',_auction.id_auction,'msg',_err_txt1,'context',_err_txt4);
      _fin2err := _fin2err || array[_j];
   end;

  end loop;

	return json_build_object('event'
    , json_build_object('fin2fail',array_to_json(_fin2fail)
    , 'fin2prefail',array_to_json(_fin2prefail)
    , 'fin2err',array_to_json(_fin2err)
		));
 end;
 $$ language plpgsql;


----------------------------------------------------------------------------------
--  COMPLEX
--
--  Создание комплексного лота p_id_auction из двух простых (p_id_auction, p_id_auction_2)
--
----------------------------------------------------------------------------------
create or replace function carl_auct.makeComplexAuct(p_id_auction int, p_id_auction_2 int)
 returns json security definer as $$
declare
  _obj jsonb; _obj_2 jsonb;
begin
  _obj := _getAuctObject(p_id_auction);

  _obj_2 := _getAuctObject(p_id_auction_2);

end;
$$ language plpgsql;


----------------------------------------------------------------------------------
--  AUCT.APPROVE
--  Обновление даты принятия решения по аукциону p_id_auction
--    select carl_auct._updateApproveDay(null);
----------------------------------------------------------------------------------
create or replace function carl_auct._updateApproveDay(p_id_auction int) --, p_approve_days int)
 returns void security definer as $$
    update auction set -- approve_days=p_approve_days
       dt_approve=(carl_comm.getNextBusinessDay((dt_end)::date, approve_days))::timestamp with time zone
          where p_id_auction is null or id_auction = p_id_auction
$$ language sql;


----------------------------------------------------------------------------------
--  Получение последнего id_auction по p_id_object
--    select getLastAuctByObjId(55);
----------------------------------------------------------------------------------
create or replace function carl_auct.getLastAuctByObjId(p_id_object int)
 returns int security definer as $$
    select max(id_auction)::int from auction where id_object = p_id_object
      and is_deleted = 'N'
$$ language sql;


-- drop function if existscarl_auct.setLandingLotsBulk();

----------------------------------------------------------------------------------
-- Массовое заполнение таблицы auction_landing активными лотами
-- В случае успеха возвращает количество вставленных записей
-- select carl_auct.setLandingLotsBulk();
----------------------------------------------------------------------------------
create or replace function carl_auct.setLandingLotsBulk()
returns int
security definer as $$
declare
    _max_categ_index int;
    _max_categ_value int;
    _i int; _max_val int; _x int; _y int; _foo int;
    _categ_cnt int [];
    _categ_index int [];
begin
  truncate auction_landing;
  alter sequence auction_landing_id_auction_landing_seq restart with 1;
  select nextval('auction_landing_id_auction_landing_seq') into _foo;

  --------------------------fill data for carlink24.ru -----------------------------------------------------------------

  drop table if exists cat_all;
  for _i in 1..8 loop
    execute 'drop table if exists cat_' || _i;
  end loop;

  create temp table cat_all as
                         select
                         id_auction,
                         domain_landing,
                         category_order,
                         category_name
                       from (
                              select
                                id_auction,
                                category_name,
                                category_order,
                                (case when carl_auct.getAuctWhoCanBuy(out.id_auction) in (2, 3)
                                  then 'carlink24' end) as domain_landing
                              from (
                                     select
                                       lot.id_auction                             as id_auction,
                                       lot.id_object                              as id_object,
                                       lot.category_name                          as category_name,
                                       lot.category_order :: int                  as category_order
                                     from (
                                            select
                                              auct.id_auction,
                                              auct.id_object,
                                              cat.name as category_name,
                                              (case when cat.id_tag = 1001
                                                 then 1 /*Лизинг и банки*/
                                               when cat.id_tag = 1003
                                                 then 2 /*Корпоративные парки*/
                                               when cat.id_tag = 1002
                                                 then 3 /*Представительства*/
                                               when cat.id_tag = 1006
                                                 then 4 /*Официальные дилеры*/
                                               when cat.id_tag = 1004
                                                 then 5 /*Грузовые*/
                                               when cat.id_tag = 9999
                                                 then 6 /*Аварийные*/
                                               when cat.id_tag = 1005
                                                 then 7 /*Такси и прокат*/
                                               when cat.id_tag = 1007
                                                 then 8 /*Страховые*/
                                               end
                                              )        as category_order
                                            from carl_data.auction auct,
                                              (select
                                                 one_cat.id_tag,
                                                 t.name,
                                                 id_auction
                                               from (
                                                      select
                                                        min(t.id_tag) id_tag,
                                                        apt.id_auction
                                                      from carl_data.auction_profile_tag apt, tag t, auction aa
                                                        left join carl_data.obj_attrib_values av on (aa.id_object = av.id_object)
                                                      where t.id_tag = apt.id_tag
                                                            and apt.id_tag IN (1006, 1002, 1003, 1001, 1004, 1005, 1007)
                                                            and aa.id_auction = apt.id_auction
                                                            and av.values #>> '{properties,total}' <> 'Y'
                                                      group by
                                                        apt.id_auction /*группируем, чтобы получить одну категорию, если лот входит в несколько*/
                                                    ) one_cat, tag t
                                               where t.id_tag = one_cat.id_tag
                                               union
                                               select
                                                 9999        as id_tag,
                                                 'Аварийная' as name,
                                                 a.id_auction
                                               from carl_data.auction a, carl_data.obj_attrib_values av
                                               where
                                                 av.id_object = a.id_object
                                                 and a.is_deleted = 'N' and av.values #>> '{properties,total}' = 'Y'
                                              ) cat
                                            where auct.is_deleted = 'N' and auct.status = 'ACTIVE' and auct.id_auction = cat.id_auction
                                          ) lot
                                   ) out
                            ) t
                       where carl_auct.getAuctWhoCanBuy(t.id_auction) in (2, 3);

  for _i in 1..8 loop
    execute 'create temp table cat_' || _i || ' as
              select
               id_auction,
               category_name,
               domain_landing,
               row_number() over() as rownum
              from cat_all where category_order = '|| _i;
  end loop;

  --array of max members for each category [1..8]
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_1)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_2)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_3)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_4)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_5)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_6)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_7)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_8)::int);

  --raise notice '_categ_cnt = %', _categ_cnt;

  _max_categ_index := 0;
  _max_val := 0;

  for _i in 1..cardinality(_categ_cnt)
  loop
   if (_categ_cnt[_i] > _max_val) then
    _max_val := _categ_cnt[_i];
    _max_categ_index := _i;
   end if;
  end loop;

  --raise notice '_max_categ_index = %', _max_categ_index;

  _max_categ_value = _categ_cnt[_max_categ_index];
  --raise notice '_max_categ_value = %', _max_categ_value;

  --array of current indexes for each category [1..8]
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);

if (_max_categ_value is not null and _max_categ_value > 0) then
      for _i in 1.._max_categ_value
      loop
        _x := 1;
        --raise notice '_i = %', _i;
        while _x <= 6
          loop
                --raise notice '_x = %', _x;
                --raise notice '_categ_cnt[_x] = %', _categ_cnt[_x];

                if (_categ_cnt[_x] > 0) then
                        --raise notice 'dSql = %', 'insert into carl_data.auction_landing (id_auction, domain_landing, category_name, auction_order) ' ||
                        --          'select id_auction, domain_landing, category_name,' || _i ||' from cat_'|| _x ||' where rownum = '  || _categ_index[_x];

                        execute 'insert into carl_data.auction_landing (id_auction, domain_landing, category_name, auction_order) ' ||
                                  'select id_auction, domain_landing, category_name,' || currval('auction_landing_id_auction_landing_seq') ||' from cat_'|| _x ||' where rownum = '  || _categ_index[_x];

                        _categ_cnt[_x] := _categ_cnt[_x] - 1;
                        _categ_index[_x] := _categ_index[_x] + 1;
                        _x := _x + 1;
                else
                      begin
                            _y := 1;
                          loop

                            --raise notice '_y = %', _y;
                            --raise notice '_categ_cnt[_y] = %', _categ_cnt[_y];

                            if (_categ_cnt[_y] > 0) then
                                /*raise notice 'dSql = %', 'insert into carl_data.auction_landing (id_auction, domain_landing, category_name, auction_order) ' ||
                                          'select id_auction, domain_landing, category_name,'' || _i ||'' from cat_'|| _y ||' where rownum = ' || _categ_index[_y];
    */
                                  execute 'insert into carl_data.auction_landing (id_auction, domain_landing, category_name, auction_order) ' ||
                                          'select id_auction, domain_landing, category_name,' || currval('auction_landing_id_auction_landing_seq') ||' from cat_'|| _y ||' where rownum = '  || _categ_index[_y];
                                _categ_cnt[_y] := _categ_cnt[_y] - 1;
                                _categ_index[_y] := _categ_index[_y] + 1;
                                _x := _x + 1;
                                exit;
                            end if;
                            _y := _y + 1;
                            if (_y = 8 and _categ_cnt[_y] = 0)
                              then _x := _x + 1;
                            end if;
                            exit when _y > 8;
                          end loop;
                       end;
                end if;
          end loop;

      --raise notice '_categ_cnt = %', _categ_cnt;
      --raise notice '_categ_index = %', _categ_index;

       _i = _i + 1;
      end loop;
  end if;

  --------------------------fill data for carlink.ru -------------------------------------------------------------------

  drop table if exists cat_all;
  for _i in 1..8 loop
    execute 'drop table if exists cat_' || _i;
  end loop;

  create temp table cat_all as
                         select
                         id_auction,
                         domain_landing,
                         category_order,
                         category_name
                       from (
                              select
                                id_auction,
                                category_name,
                                category_order,
                                (case when carl_auct.getAuctWhoCanBuy(out.id_auction) in (1, 2, 3)
                                  then 'carlink' end) as domain_landing
                              from (
                                     select
                                       lot.id_auction                             as id_auction,
                                       lot.id_object                              as id_object,
                                       lot.category_name                          as category_name,
                                       lot.category_order :: int                  as category_order
                                     from (
                                            select
                                              auct.id_auction,
                                              auct.id_object,
                                              cat.name as category_name,
                                              (case when cat.id_tag = 1001
                                                 then 1 /*Лизинг и банки*/
                                               when cat.id_tag = 1003
                                                 then 2 /*Корпоративные парки*/
                                               when cat.id_tag = 1002
                                                 then 3 /*Представительства*/
                                               when cat.id_tag = 1006
                                                 then 4 /*Официальные дилеры*/
                                               when cat.id_tag = 1004
                                                 then 5 /*Грузовые*/
                                               when cat.id_tag = 9999
                                                 then 6 /*Аварийные*/
                                               when cat.id_tag = 1005
                                                 then 7 /*Такси и прокат*/
                                               when cat.id_tag = 1007
                                                 then 8 /*Страховые*/
                                               end
                                              )        as category_order
                                            from carl_data.auction auct,
                                              (select
                                                 one_cat.id_tag,
                                                 t.name,
                                                 id_auction
                                               from (
                                                      select
                                                        min(t.id_tag) id_tag,
                                                        apt.id_auction
                                                      from carl_data.auction_profile_tag apt, tag t, auction aa
                                                        left join carl_data.obj_attrib_values av on (aa.id_object = av.id_object)
                                                      where t.id_tag = apt.id_tag
                                                            and apt.id_tag IN (1006, 1002, 1003, 1001, 1004, 1005, 1007)
                                                            and aa.id_auction = apt.id_auction
                                                            and av.values #>> '{properties,total}' <> 'Y'
                                                      group by
                                                        apt.id_auction /*группируем, чтобы получить одну категорию, если лот входит в несколько*/
                                                    ) one_cat, tag t
                                               where t.id_tag = one_cat.id_tag
                                               union
                                               select
                                                 9999        as id_tag,
                                                 'Аварийная' as name,
                                                 a.id_auction
                                               from carl_data.auction a, carl_data.obj_attrib_values av
                                               where
                                                 av.id_object = a.id_object
                                                 and a.is_deleted = 'N' and av.values #>> '{properties,total}' = 'Y'
                                              ) cat
                                            where auct.is_deleted = 'N' and auct.status = 'ACTIVE' and auct.id_auction = cat.id_auction
                                          ) lot
                                   ) out
                            ) t
                       where carl_auct.getAuctWhoCanBuy(t.id_auction) in (1, 3);

  for _i in 1..8 loop
    execute 'create temp table cat_' || _i || ' as
              select
               id_auction,
               category_name,
               domain_landing,
               row_number() over() as rownum
              from cat_all where category_order = '|| _i;
  end loop;

  _categ_cnt := null;

  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_1)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_2)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_3)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_4)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_5)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_6)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_7)::int);
  _categ_cnt := array_append(_categ_cnt, (select count(*) from cat_8)::int);

  --raise notice '_categ_cnt = %', _categ_cnt;

  _max_categ_index := 0;
  _max_val := 0;

  for _i in 1..cardinality(_categ_cnt)
  loop
   if (_categ_cnt[_i] > _max_val) then
    _max_val := _categ_cnt[_i];
    _max_categ_index := _i;
   end if;
  end loop;

  --raise notice '_max_categ_index = %', _max_categ_index;

  _max_categ_value = _categ_cnt[_max_categ_index];
  --raise notice '_max_categ_value = %', _max_categ_value;

  _categ_index := null;

  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);
  _categ_index := array_append(_categ_index, 1);

  if (_max_categ_value is not null and _max_categ_value > 0) then

        for _i in 1.._max_categ_value
        loop
          _x := 1;
          --raise notice '_i = %', _i;
          while _x <= 6
            loop
                  --raise notice '_x = %', _x;
                  --raise notice '_categ_cnt[_x] = %', _categ_cnt[_x];

                  if (_categ_cnt[_x] > 0) then
                          /*raise notice 'dSql = %', 'insert into carl_data.auction_landing (id_auction, domain_landing, category_name, auction_order) ' ||
                                    'select id_auction, domain_landing, category_name,' || _i ||' from cat_'|| _x ||' where rownum = '  || _categ_index[_x];*/

                          execute 'insert into carl_data.auction_landing (id_auction, domain_landing, category_name, auction_order) ' ||
                                    'select id_auction, domain_landing, category_name,' || currval('auction_landing_id_auction_landing_seq') ||' from cat_'|| _x ||' where rownum = '  || _categ_index[_x];

                          _categ_cnt[_x] := _categ_cnt[_x] - 1;
                          _categ_index[_x] := _categ_index[_x] + 1;
                          _x := _x + 1;
                  else
                        begin
                              _y := 1;
                            loop

                              --raise notice '_y = %', _y;
                              --raise notice '_categ_cnt[_y] = %', _categ_cnt[_y];

                              if (_categ_cnt[_y] > 0) then
                                  --raise notice 'dSql = %', 'insert into carl_data.auction_landing (id_auction, domain_landing, category_name, auction_order) ' ||
                                  --          'select id_auction, domain_landing, category_name,'' || _i ||'' from cat_'|| _y ||' where rownum = ' || _categ_index[_y];

                                    execute 'insert into carl_data.auction_landing (id_auction, domain_landing, category_name, auction_order) ' ||
                                            'select id_auction, domain_landing, category_name,' || currval('auction_landing_id_auction_landing_seq') ||' from cat_'|| _y ||' where rownum = '  || _categ_index[_y];
                                  _categ_cnt[_y] := _categ_cnt[_y] - 1;
                                  _categ_index[_y] := _categ_index[_y] + 1;
                                  _x := _x + 1;
                                  exit;
                              end if;
                              _y := _y + 1;
                              if (_y = 8 and _categ_cnt[_y] = 0) then
                                _x := _x + 1;
                              end if;
                              exit when _y > 8;
                            end loop;
                         end;
                  end if;
            end loop;
        --raise notice '_categ_cnt = %', _categ_cnt;
        --raise notice '_categ_index = %', _categ_index;
         _i = _i + 1;
        end loop;
  end if;

  drop table if exists cat_all;
  for _i in 1..8 loop
    execute 'drop table if exists cat_' || _i;
  end loop;

  return (select count(*) from auction_landing)::int;
end;
  $$ language plpgsql;


drop function if exists carl_auct._getLandingLotsT(p_is_domain24 boolean);

----------------------------------------------------------------------------------
--  Базовая функция отбора лотов для страницы лендинга, возвращает данные в table
--  Возвращает список лотов по алгоритму:
--  1 позицию (нижняя правая) просим зафиксировать под аварийные авто,
--  1 позицию (слева от аварийной) - под грузовые.
--  Оставшиеся позиции показываем авто из Лизинг и Банки/Корпоративные парки/Представительства/Официальные дилеры.
--  Если грузовых или аварийных нет - заполняем теми автомобилями из Лизинг и Банки/Корпоративные парки/Представительства/Официальные дилеры.
--  select * from _getLandingLotsT(true);
----------------------------------------------------------------------------------
create or replace function carl_auct._getLandingLotsT(p_is_domain24 boolean)
  returns TABLE(id_auction int, id_object int, mark varchar, model varchar, modification varchar, year varchar, mileage varchar, category_name varchar
    , order_index int, has_report boolean, main_image varchar, start_price int)
security definer
language sql
as $$
  select
          a.id_auction,
          a.id_object,
          car.mark,
          car.model,
          car.modification,
          car.year,
          car.mileage,
          al.category_name,
          al.auction_order as order_index,
          carl_auct._has_report(a.id_auction) as has_report,
          car.main_image,
          a.start_price
  from carl_data.auction_landing al,
       carl_data.auction a,
        (select
           a.id_auction,
           av.values #>> '{characteristics,mark}'         as mark,
           av.values #>> '{characteristics,model}'        as model,
           av.values #>> '{characteristics,modification}' as modification,
           av.values #>> '{properties,year}'              as year,
           av.values #>> '{properties,mileage}'           as mileage,
           av.values #>> '{properties,main_image}'        as main_image
         from carl_data.auction a, carl_data.obj_attrib_values av
         where av.id_object = a.id_object
        ) car
    where a.id_auction = al.id_auction
      and car.id_auction = al.id_auction
      and a.is_deleted = 'N'
      and al.is_deleted = 'N'
      and al.is_hidden = 'N'
      and ((p_is_domain24 is true and al.domain_landing = 'carlink24') or (p_is_domain24 is false and al.domain_landing = 'carlink'))
$$;


-- drop function if existscarl_auct.getLandingLotsJ(p_is_domain24 boolean);

----------------------------------------------------------------------------------
--  Функция отбора лотов для страницы лендинга carlink или carlink24, возвращает данные в set of json
--  select * from getLandingLotsJ(true);
----------------------------------------------------------------------------------
create or replace function carl_auct.getLandingLotsJ(p_is_domain24 boolean)
   returns SETOF json
 security definer
 language sql
 as $$
    select row_to_json(r)
      from (select id_auction, id_object, mark, model, modification, year, mileage, category_name, order_index
              , has_report, main_image, start_price
            from carl_auct._getLandingLotsT(p_is_domain24)
            where  getauctobjattrib(id_auction, 'mark') not in ('Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Ford', 'GMC', 'Hennessey', 'Hummer', 'Jeep', 'Lincoln', 'Tesla', 'Freightliner', 'Kenworth', 'Mack', 'International', 'Peterbilt', 'Western Star')
            order by order_index)r;
 $$;


-- drop function if existscarl_auct.setLandingLot(p_id_auction_landing int, p_id_auction int, p_domain_landing varchar, p_category_name varchar, p_auction_order int, p_is_hidden char);

----------------------------------------------------------------------------------
-- Функция добавляет или обновляет запись в auction_landing
-- В случае успеха возвращается id_auction_landing
-- select carl_auct.setLandingLot(3, 7465, 'carlink', 'test', 33, 'Y');
----------------------------------------------------------------------------------
create or replace function carl_auct.setLandingLot(p_id_auction_landing int, p_id_auction int, p_domain_landing varchar, p_category_name varchar, p_auction_order int, p_is_hidden char)
  returns int
security definer as $$
declare
  _id_auction_landing int;
  _curr_auction_order int;
  _cnt int;
begin

  if (p_id_auction_landing is null) then
    insert into carl_data.auction_landing (id_auction, domain_landing, category_name, auction_order, is_hidden)
     values (p_id_auction, p_domain_landing, p_category_name, p_auction_order, p_is_hidden)
     returning id_auction_landing into _id_auction_landing;
  else
    select count(*) into _cnt from carl_data.auction_landing where id_auction_landing = p_id_auction_landing;
    if (_cnt = 0) then
        raise exception 'Не найдена запись в auction_landing по ключу id_auction_landing = %', p_id_auction_landing::varchar;
    end if;

    select auction_order into _curr_auction_order from carl_data.auction_landing where id_auction_landing = p_id_auction_landing;

    if (_curr_auction_order is not null) then
      update carl_data.auction_landing set auction_order = _curr_auction_order where auction_order = p_auction_order;
    end if;

    update carl_data.auction_landing
      set is_hidden = p_is_hidden, auction_order = p_auction_order
     where id_auction_landing = p_id_auction_landing
     returning id_auction_landing into _id_auction_landing;
  end if;

  return _id_auction_landing;
end;
$$ language plpgsql;


-- drop function if existscarl_auct.getAuctionCommentJ(p_id_auction int, p_id_profile int);

----------------------------------------------------------------------------------
--  Функция возвращает текст заметки к лоту в json
--  select * from getAuctionCommentJ(9559, 1424);
----------------------------------------------------------------------------------
create or replace function carl_auct.getAuctionCommentJ(p_id_auction int, p_id_profile int)
    returns json
security definer
language sql
as $$

select json_build_object('comment',comment) from carl_data.auction_comment
    where   id_profile = p_id_profile
        and id_auction = p_id_auction
        and is_deleted = 'N';
$$;


-- drop function if existscarl_auct.setAuctionComment(p_id_auction int, p_id_profile int, p_id_user int, p_comment varchar);

----------------------------------------------------------------------------------
--  Функция вставляет/изменяет текст заметки к лоту
--  select * from setAuctionComment(9559, 1424, 8041, 'комментарий к лоту');
----------------------------------------------------------------------------------
create or replace function carl_auct.setAuctionComment(p_id_auction int, p_id_profile int, p_id_user int, p_comment varchar)
    returns int
security definer as $$
declare
  _cnt int;
  _id_auction_comment int;
begin

    select count(*) into _cnt
    from auction_comment
    where id_auction = p_id_auction
      and id_profile = p_id_profile;

    if (_cnt = 0) then
        insert into carl_data.auction_comment(id_auction, id_profile, id_user, comment, dt_change) values
            (p_id_auction, p_id_profile, p_id_user,  substring(p_comment, 1, 800), now()) returning  id_auction_comment into _id_auction_comment;
        else
        update carl_data.auction_comment
            set comment = substring(p_comment, 1, 800),
                id_user = p_id_user,
                dt_change = now(),
                is_deleted = 'N'
            where id_auction = p_id_auction
                and id_profile = p_id_profile
        returning  id_auction_comment into _id_auction_comment;
    end if;

    return _id_auction_comment;
end;
$$ language plpgsql;


-- drop function if existscarl_auct.deleteAuctionComment(p_id_auction int, p_id_profile int, p_id_user int);

----------------------------------------------------------------------------------
--  Функция логически удаляет заметку к лоту
--  select * from deleteAuctionComment(9559, 1424, 8041);
----------------------------------------------------------------------------------
create or replace function carl_auct.deleteAuctionComment(p_id_auction int, p_id_profile int, p_id_user int)
   returns int
security definer as $$
declare
  _cnt int;
  _id_auction_comment int;
begin
    update carl_data.auction_comment
            set is_deleted = 'Y',
                id_user = p_id_user,
                dt_change = now()
            where id_auction = p_id_auction
              and id_profile = p_id_profile
        returning  id_auction_comment into _id_auction_comment;
    return _id_auction_comment;
end;
$$ language plpgsql;


-- drop function if existscarl_auct._getAuctListBySqlT(_p_sql varchar);

----------------------------------------------------------------------------------
--  Функция возвращает список аукционов в виде TABLE по SQL запросу
-- select * from _getAuctListBySqlT('select * from ( select a.id_auction, a.id_object, case when a.auction_type = ''OFFER'' then null  when a.auction_type = ''OPEN'' and a.bid_count = 0 then a.start_price else ab.bid_value end as s_cur_price from auction a inner join object o on (a.id_object = o.id_object) inner join obj_attrib_values oav on (o.id_object = oav.id_object) left join auction_bid ab on (ab.bid_status=''LEAD'' and ab.id_auction = a.id_auction and ab.is_deleted = ''N'')		where a.is_deleted = ''N'' and( carl_auct._is_seller_of_auct(17,a.id_auction) or carl_auct._canProfBuy(17,a.id_auction) ) and (( a.hidden =true) and ( a.status =''ACTIVE'')) order by  a.sort_priority desc nulls last  , a.dt_end desc, a.id_auction ) s1 offset 0 limit 100000');
----------------------------------------------------------------------------------
create or replace function carl_auct._getAuctListBySqlT(_p_sql varchar)
	returns setof record
security definer as $$
begin
  return query execute (_p_sql);
end;
$$ language plpgsql;


-- drop function if existscarl_auct.getLotsSummInfoByFilterJ(p_filtr_j json);

----------------------------------------------------------------------------------
--  Функция возвращает итоговую информацию по лотам, отобранным в фильтре в виде
-- {"ttl_start_price" : 3100900, "ttl_final_price" : 23252700, "ttl_delta_price" : 20151800, "ttl_delta_percent" : 650.00}
-- В случае невычисляемого результата возвращает -1
-- Пример запроса:
--  select * from getLotsSummInfoByFilterJ('{
--   "id_user": 3,
--   "id_profile": 17,
--   "ft": 3,
--   "car": {
--     "properties": {
--       "location": {
--         "OR": [
--           "=''Москва''"
--         ]
--       }
--     },
--     "characteristics": {
--       "mark": {
--         "AND": [
--           "=''BMW''"
--         ]
--       }
--     }
--   }
-- }');
----------------------------------------------------------------------------------
create or replace function carl_auct.getLotsSummInfoByFilterJ(p_filtr_j json)
      returns setof json
security definer as $$
declare
  _j_out json;
  _sql varchar;
begin
  --raise notice '~~~ p_filtr_j %', p_filtr_j;
  select regexp_replace(_s->>'sql', '\*', 'id_auction') into _sql from carl_auct.getSqlAuctListByFilterJ(p_filtr_j) _s;
  --raise notice '~~~ _sql %', _sql;
  select json_build_object('ttl_start_price',total_start_price, 'ttl_final_price',total_final_price, 'ttl_delta_price', total_delta_price ,'ttl_delta_percent', total_delta_percent) into _j_out
  from (
    select
      coalesce(start_price, -1)            total_start_price,
      coalesce(final_price, -1)            total_final_price,
			coalesce((case when final_price = 0 then -1
			 			else final_price - start_price
			 end), -1) 								            total_delta_price,
      (case when (start_price <> 0) then round((100::float * ((final_price :: float - start_price :: float) / start_price))::numeric, 3)::float
       			else -1
			 end)                                 total_delta_percent
    from (
           select
             sum(coalesce(a.start_price,0)) as start_price,
             sum(coalesce(b.bid_value,0))   as final_price
           from carl_data.auction a
                left join carl_data.auction_bid b on (    a.id_auction = b.id_auction
                                                      and b.bid_status = 'LEAD'
                                                      and b.is_deleted = 'N'),
             (select id_auction
              from _getAuctListBySqlT(_sql) as (id_auction int)) ft_a
           where a.id_auction = ft_a.id_auction
         ) r
  )out;
  return next _j_out;
end;
$$ language plpgsql;


-- drop function if existscarl_auct.sellerMakeBuynow(p_id_user_sel int, p_id_profile_sel int, p_id_auction int);

----------------------------------------------------------------------------------
--  #ХИТРОПОПЫЙФУНКЦИОНАЛ
--  Продавец делает ставку "Купить сейчас" текущим лидером
--    в аукционе p_id_auction
----------------------------------------------------------------------------------
create or replace function carl_auct.sellerMakeBuynow(
	  p_id_user_sel int, p_id_profile_sel int, p_id_auction int)
	returns json
as $$
declare
  _bid_value int; _id_user_profile int; _j json;
begin
  if( not carl_auct._is_seller_of_auct(p_id_profile_sel, p_id_auction)) then
    raise exception using message=_getMessage('AUCT_SELLER_BUYNOW_NOT_SELLER_AUCT')
      , errcode=_getErrcode('AUCT_SELLER_BUYNOW_NOT_SELLER_AUCT');
  end if;

  -- находим лидера и цену
  select bid_value, id_user_profile into _bid_value, _id_user_profile from auction_bid where id_auction = p_id_auction
    and bid_status = 'LEAD'
    and is_deleted = 'N';

  if(_id_user_profile is null or _bid_value is null) then
    raise exception using message=_getMessage('AUCT_SELLER_BUYNOW_CANT_FOUND_LEADER')
      , errcode=_getErrcode('AUCT_SELLER_BUYNOW_CANT_FOUND_LEADER');
  end if;

  -- выставляем цену аукциона buynow
  update auction set buy_now = _bid_value where id_auction = p_id_auction;

  -- делаем от лидера buynow
  _j := carl_auct.buyNow(carl_prof._get_id_user(_id_user_profile)
    , carl_prof._get_id_profile(_id_user_profile), p_id_auction);

  return _j;
end;
$$ language plpgsql;


----------------------------------------------------------------------------------
-- Тест блокировки
-- select __testLock(3, 1000);
----------------------------------------------------------------------------------
create or replace function carl_auct.__testLock(p_id_profile int, p_id_auction int)
	returns json security definer as $$
declare
  _test_makebid_wait_time_sec text;
begin
  perform _lockBid(p_id_profile, p_id_auction);

  -- задерживаем окончание на test_makebid_wait_time_sec сек
  _test_makebid_wait_time_sec := carl_comm.getParameter('test_makebid_wait_time_sec','-1');
  if(_test_makebid_wait_time_sec <> '-1') then
    perform pg_sleep(_test_makebid_wait_time_sec::int);
  end if;

  return null;
end;
$$ language plpgsql;


------------------------------------------------------------------------------------------------------------------------
-- Возвращает депозит(баланс резерв) по аукциону p_id_auction для покупателя p_id_profile_buy
-- Пример:
--   select carl_auct.getAuctDeposit(3169, 177);
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.getAuctDeposit(p_id_auction int, p_id_profile_buy int)
  returns int security definer as $$
    select case when carl_prof.isVip(p_id_profile_buy) then 0
           else case when carl_prof._is_company(p_id_profile_buy) then a.reserv_comp else a.reserv_indiv end
      end
      from auction a where id_auction = p_id_auction
$$ language sql;





------------------------------------------------------------------------------------------------------------------------
-- Выставление даты окончания аукцилона p_id_auction из p_newdate
-- Пример:
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.setAuctDtEnd(p_id_auction int, p_newdate varchar)
  returns json security definer as $$
declare
  _dt_end timestamp; _status varchar;
begin
  select status into _status from auction where id_auction = p_id_auction;
  if(_status <> 'ACTIVE') then
    return null;
  end if;

  --_dt_end := to_timestamp(p_newdate,'YYYY-MM-DD HH24:MI:SSZ') at time zone 'Europe/Moscow';
  _dt_end := to_timestamp(p_newdate,'YYYY-MM-DD HH24:MI:SSZ') at time zone 'GMT';
  update auction set dt_end = _dt_end where id_auction = p_id_auction;

  --_dt_end := to_timestamp(p_newdate,'YYYY-MM-DD HH24:MI:SSZ') at time zone 'Europe/Moscow';
  return json_build_object('extend_dt_end',extract(epoch from (_dt_end))::int);
end;
$$ language plpgsql;


------------------------------------------------------------------------------------------------------------------------
-- Выставление шага АКТИВНОГО аукцилона p_id_auction
-- Пример:
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.setActiveAuctStep(p_id_auction int, p_step int)
  returns json security definer as $$
declare
  _status varchar;
begin
  select status into _status from auction where id_auction = p_id_auction;
  if(_status <> 'ACTIVE') then
     return null;
  end if;

  update auction set step = p_step where id_auction = p_id_auction;

  return json_build_object('extend_step',p_step);
end;
$$ language plpgsql;


------------------------------------------------------------------------------------------------------------------------
-- Выставление даты окончания аукцилона p_id_auction из p_newdate
-- Пример:
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct.setAuctDtEnd(p_id_auction int, p_newdate float)
  returns json security definer as $$
declare
  _dt_end timestamp; _i int;
  _s text;

_status varchar;
begin
  select status into _status from auction where id_auction = p_id_auction;
  if(_status <> 'ACTIVE') then
    return null;
  end if;

  _dt_end := to_timestamp(p_newdate::int);
  update auction set dt_end = _dt_end where id_auction = p_id_auction;

  _s := ' _dt_end ' || _dt_end;
  perform writeLog(_s,'setAuctDtEnd()','LOG_PARSER','USER_LOG');

  _i := extract(epoch from carl_auct._get_auct_dt_end(p_id_auction))::int;
  -- raise notice '~~~ setAuctDtEnd() _i % ',_i;

  return json_build_object('extend_dt_end',_i);
end;
$$ language plpgsql;


------------------------------------------------------------------------------------------------------------------------
-- Выставление даты окончания аукцилона p_id_auction из p_dt_end
-- Пример:
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._set_auct_dt_end(p_id_auction int, p_dt_end timestamp with time zone)
  returns void security definer as $$
  update auction set dt_end = p_dt_end where id_auction = p_id_auction;
$$ language sql;


------------------------------------------------------------------------------------------------------------------------
-- Выставление даты окончания аукцилона p_id_auction из p_dt_end
-- Пример:
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_auct._set_auct_start_price(p_id_auction int, p_start_price int)
  returns void security definer as $$
  update auction set start_price = p_start_price where id_auction = p_id_auction;
$$ language sql;


------------------------------------------------------------------------------------------------------------------------
--
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_prof._is_buyer(p_id_profile int)
  returns boolean security definer as $$
  select carl_prof.hasRole(p_id_profile,'buyer') = 'Y' from profile
    where id_profile = p_id_profile
$$ language sql immutable;


------------------------------------------------------------------------------------------------------------------------
--
------------------------------------------------------------------------------------------------------------------------
create or replace function carl_prof._is_seller(p_id_profile int)
  returns boolean security definer as $$
  select carl_prof.hasRole(p_id_profile,'seller') = 'Y' from profile
    where id_profile = p_id_profile
$$ language sql immutable;

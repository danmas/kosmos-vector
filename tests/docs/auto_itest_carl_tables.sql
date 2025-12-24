create table carl_data.auction
(
    id_auction              integer                  default nextval('auction_id_auction_seq'::regclass) not null
        constraint pk_auction
            primary key,
    id_user_profile         integer                                                                      not null
        constraint fk_user_profile_auction
            references carl_data.user_profile
            deferrable initially deferred,
    id_object               integer                                                                      not null
        constraint fk_object
            references carl_data.object
            deferrable initially deferred,
    auction_type            en_auction_type                                                              not null,
    status                  en_auction_status        default 'MODERATED'::en_auction_status              not null,
    dt_start                timestamp with time zone,
    dt_end                  timestamp with time zone,
    buy_now                 integer,
    min_price               integer,
    start_price             integer                  default 0,
    step                    integer,
    is_deleted              char                     default 'N'::bpchar                                 not null,
    is_parsed               varchar(1)               default 'N'::character varying                      not null,
    n_views                 integer                  default 0                                           not null,
    source_url              varchar,
    seller_name             varchar                                                                      not null,
    reserv_comp             integer                  default 0                                           not null,
    id_workflow             varchar                  default 'STANDART_AUCTION'::character varying,
    workflow_status         varchar,
    is_archive              boolean                  default false,
    approve_days            integer,
    parameters              jsonb,
    sort_priority           integer                  default 0,
    bid_count               integer                  default 0,
    reserv_indiv            integer                                                                      not null,
    bid_locked_by           integer,
    locked_by               integer,
    dt_approve              timestamp with time zone,
    dt_change_status        timestamp with time zone default now(),
    id_prof_dealer_code     integer
        constraint prof_dealer_code_fk
            references carl_data.prof_dealer_code
            on delete cascade,
    id_queue                integer,
    dt_create               timestamp with time zone default now(),
    who_can_buy             bigint,
    hidden                  boolean                  default false,
    dt_active               timestamp with time zone,
    amo_status_lead         varchar,
    amo_status_sell         varchar,
    amo_status_broker       varchar,
    amo_status_lead_bro     varchar,
    applied_commission      integer,
    tariff_rules            jsonb,
    menu_parent_object_type integer
        references carl_data.object_type,
    constraint check_auction_step_min_price
        check ((status = 'DRAFT'::en_auction_status) OR (status IS NULL) OR (status = 'MODERATED'::en_auction_status) OR
               (is_deleted = 'Y'::bpchar) OR ((status <> 'DRAFT'::en_auction_status) AND
                                              ((auction_type <> 'OPEN'::en_auction_type) OR
                                               ((auction_type = 'OPEN'::en_auction_type) AND (is_deleted = 'N'::bpchar)) OR
                                               ((auction_type = 'OPEN'::en_auction_type) AND
                                                (is_deleted = 'N'::bpchar) AND
                                                ((id_workflow)::text = 'STANDART_AUCTION_OPEN_OFFER'::text) AND
                                                ((step IS NOT NULL) AND (step > 0)) AND (min_price IS NULL)) OR
                                               ((auction_type = 'OPEN'::en_auction_type) AND
                                                (is_deleted = 'N'::bpchar) AND
                                                ((id_workflow)::text = 'STANDART_AUCTION_OPEN'::text) AND
                                                ((step IS NOT NULL) AND (step > 0) AND
                                                 ((min_price IS NOT NULL) AND (min_price >= 0)))) OR
                                               ((auction_type = 'OPEN'::en_auction_type) AND
                                                (is_deleted = 'N'::bpchar) AND
                                                ((id_workflow)::text = 'STANDART_AUCTION_OPEN_COUNTER'::text) AND
                                                ((step IS NOT NULL) AND (step > 0) AND
                                                 (((parameters #>> '{wo_minprice}'::text[]))::boolean OR
                                                  ((min_price IS NOT NULL) AND (min_price >= 0))))))))
);

comment on column carl_data.auction.id_user_profile is 'Продавец';

comment on column carl_data.auction.auction_type is 'Тип аукциона';

comment on column carl_data.auction.status is 'Статус аукциона';

comment on column carl_data.auction.dt_start is 'Начало аукциона';

comment on column carl_data.auction.dt_end is 'Завершение аукциона';

comment on column carl_data.auction.is_parsed is 'Признак того, что аукцион из парсера';

comment on column carl_data.auction.n_views is 'Число просмотров';

comment on column carl_data.auction.source_url is 'ссылка на источник(для загруженных из внешней системы)';

comment on column carl_data.auction.seller_name is 'Отображаемое название профиля продавца';

comment on column carl_data.auction.reserv_comp is 'Сумма резервирования баланса';

comment on column carl_data.auction.id_workflow is 'Тип процесса аукциона';

comment on column carl_data.auction.workflow_status is 'Состояние процесса аукциона';

comment on column carl_data.auction.approve_days is 'Время принятия решения по аукциону в днях.';

comment on column carl_data.auction.parameters is 'Дополнительные параметры аукциона';

comment on column carl_data.auction.sort_priority is 'Приоритет в сортировке';

comment on column carl_data.auction.bid_count is 'Кол-во ставок';

comment on column carl_data.auction.bid_locked_by is 'id_profile заблокировавшего аукцион на время выполнения ставки';

comment on column carl_data.auction.locked_by is 'Блокировка аукциона на время выполнения функции.';

comment on column carl_data.auction.dt_approve is 'Дата время принятия решения по аукциону';

comment on column carl_data.auction.dt_change_status is 'Дата время принятия изменения статуса аукциона';

comment on column carl_data.auction.id_prof_dealer_code is 'Диллерский код определяющий место хранения';

comment on column carl_data.auction.id_queue is 'Идентификатор потоковых торгов в которых участвует аукцион.';

comment on column carl_data.auction.dt_active is 'Время перевода лота в состояние ACTIVE';

comment on column carl_data.auction.amo_status_broker is 'АМО статус для подброкера лидера';

comment on column carl_data.auction.amo_status_lead_bro is 'АМО статус для подброкера лидера';

alter table carl_data.auction
    owner to carl;

create table carl_data.auction_bid
(
    id_auction_bid  integer       default nextval('auction_bid_id_auction_bid_seq'::regclass) not null
        constraint "Key1"
            primary key
        constraint pk_bid
            unique,
    id_auction      integer
        constraint fk_bid_auction
            references carl_data.auction
            deferrable initially deferred,
    id_user_profile integer                                                                   not null
        constraint fk_profile_bid
            references carl_data.user_profile
            deferrable initially deferred,
    bid_value       integer,
    bid_status      en_bid_status default 'LEAD'::en_bid_status                               not null,
    proxy_price     integer,
    dt_set          timestamp     default statement_timestamp(),
    is_deleted      char          default 'N'::bpchar                                         not null
);

comment on table carl_data.auction_bid is 'Ставки';

comment on column carl_data.auction_bid.bid_value is 'Величина ставки';

comment on column carl_data.auction_bid.bid_status is 'Текущее состояние ставки';

comment on column carl_data.auction_bid.dt_set is 'Время когда сделана ставка';

alter table carl_data.auction_bid
    owner to carl;

create index auction_bid_bid_status_idx
    on carl_data.auction_bid (bid_status);

create index auction_bid_deleted_idx
    on carl_data.auction_bid (is_deleted);

create index idx_bid
    on carl_data.auction_bid (id_user_profile);

create index idx_bid_0
    on carl_data.auction_bid (id_auction);

create unique index idx_uniq_lead_ab
    on carl_data.auction_bid (id_auction, bid_status)
    where (bid_status = 'LEAD'::en_bid_status);

grant delete, insert, references, select, trigger, truncate, update on carl_data.auction_bid to carl_php;

create index "IX_Relationship4"
    on carl_data.auction (id_user_profile);

create index "IX_Relationship5"
    on carl_data.auction (id_object);

create index auction_deleted_idx
    on carl_data.auction (id_workflow);

create index auction_dt_end_idx
    on carl_data.auction (dt_end);

create index auction_dt_start_idx
    on carl_data.auction (dt_start);

create index auction_hidden_idx
    on carl_data.auction (hidden);

create index auction_is_archive_idx
    on carl_data.auction (is_archive);

create index auction_status_idx
    on carl_data.auction (status);

create index auction_workflow_idx
    on carl_data.auction (id_workflow);

create unique index idx_one_parsed_obj_for_act_moder_auct_uniq
    on carl_data.auction (id_object, status, is_parsed)
    where ((id_object IS NOT NULL) AND ((is_parsed)::text = 'Y'::text) AND
           ((status = 'ACTIVE'::en_auction_status) OR (status = 'MODERATED'::en_auction_status)) AND
           (is_deleted = 'N'::bpchar));

create index ind_auct_sort_priority
    on carl_data.auction (sort_priority);

create index ix_auction_amo_status_lead
    on carl_data.auction (amo_status_lead);

create index ix_auction_amo_status_lead_bro
    on carl_data.auction (amo_status_lead_bro);

create index ix_auction_amo_status_sell
    on carl_data.auction (amo_status_sell);

create trigger trg_auct_sort_priority
    before insert or update
    on carl_data.auction
    for each row
execute procedure carl_auct.auct_sort_priority();

grant delete, insert, references, select, trigger, truncate, update on carl_data.auction to carl_php;

create table carl_data.auction_comment
(
    id_auction_comment integer                  default nextval('auction_comment_id_auction_comment_seq'::regclass) not null
        primary key,
    id_auction         integer                                                                                      not null
        constraint auction_comment_auction_id_auction_fk
            references carl_data.auction,
    id_profile         integer                                                                                      not null
        constraint auction_comment_profile_id_profile_fk
            references carl_data.profile,
    id_user            integer                                                                                      not null
        constraint auction_comment_users_id_user_fk
            references carl_data.users,
    comment            varchar,
    dt_create          timestamp with time zone default now(),
    dt_change          timestamp with time zone,
    is_deleted         char                     default 'N'::bpchar
);

comment on table carl_data.auction_comment is 'Заметки на лоте';

alter table carl_data.auction_comment
    owner to carl;

create unique index auction_comment_id_auction_id_profile_uindex
    on carl_data.auction_comment (id_auction, id_profile);

grant delete, insert, references, select, trigger, truncate, update on carl_data.auction_comment to carl_php;

create table carl_data.auction_label
(
    id_auction_label integer default nextval('auction_label_id_auction_label_seq'::regclass) not null
        primary key,
    id_label         integer                                                                 not null
        references carl_data.label
            on delete set null,
    id_auction       integer
                                                                                             references carl_data.auction
                                                                                                 on delete set null,
    constraint uniq_auction_label
        unique (id_label, id_auction)
);

alter table carl_data.auction_label
    owner to carl;

grant delete, insert, references, select, trigger, truncate, update on carl_data.auction_label to carl_php;

create table carl_data.auction_log
(
    id_auction_log integer                  default nextval('auction_log_id_auction_log_seq'::regclass) not null
        primary key,
    event_type     en_auction_event_type    default 'EXCEPTION'::en_auction_event_type,
    id_auction     integer,
    id_user        integer,
    id_profile     integer,
    input          jsonb,
    output         jsonb,
    exception      jsonb,
    src            jsonb,
    exec_time      interval,
    dt_set         timestamp with time zone default clock_timestamp()                                   not null,
    is_msg_sent    varchar(1)               default 'N'::character varying                              not null,
    is_deleted     varchar(1)               default 'N'::character varying,
    exec_time_php  interval
);

comment on table carl_data.auction_log is 'События аукциона';

comment on column carl_data.auction_log.is_msg_sent is 'Признак того, что рассылки выполнены';

alter table carl_data.auction_log
    owner to carl;

create index auction_log_deleted_idx
    on carl_data.auction_log (is_deleted);

create index auction_log_event_type_idx
    on carl_data.auction_log (event_type);

create index ix_auction_log_id_auction
    on carl_data.auction_log (id_auction);

create index auction_log_dtset_idx
    on carl_data.auction_log (dt_set);

grant delete, insert, references, select, trigger, truncate, update on carl_data.auction_log to carl_php;

create type dkp_doc_set as enum ('B2B', 'B2C_DKP', 'B2C_SERVICE', 'B2C_AGENT');

alter type dkp_doc_set owner to carl;

create type dkp_doc_type as enum ('DKP', 'PrincipalDKP', 'AgencyContract');

alter type dkp_doc_type owner to carl;


create function _createnewauctionjb(p_jb jsonb, p_update_expert_cert boolean DEFAULT true) returns integer
    security definer
    language sql
as
$$
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
    , (p_jb#>>'{auction,who_can_buy}')::text
    , (p_jb#>>'{car,properties,expert_cert}')
    , p_update_expert_cert
    , (p_jb#>>'{auction,is_open_counter}')::boolean
    , (p_jb#>>'{auction,reduce_start_price}')::boolean
  )
$$;

alter function _createnewauctionjb(jsonb, boolean) owner to carl;

grant execute on function _createnewauctionjb(jsonb, boolean) to carl_php;

create function _createruntestqueue() returns void
    security definer
    language plpgsql
as
$$
declare
begin
     delete from carl_data.queue_auction;
     delete from carl_data.queue;
     delete from queue_check_result;

     --select * from queue;
     --select * from queue_auction;

     perform carl_auct.createQueue('Q1', extract(epoch from clock_timestamp() + interval '5 second')::int);
     perform carl_auct.createQueue('Q2', extract(epoch from clock_timestamp() + interval '15 second')::int);
     perform carl_auct.createQueue('Q3', extract(epoch from clock_timestamp() + interval '5 second')::int);
     perform carl_auct.getQueCurrent(getQueByName('Q3'));

     update auction set status='MODERATED' where id_auction = 522;
     perform carl_auct.addAuctInQueue(getQueByName('Q1'),522);
     update auction set status='MODERATED' where id_auction = 525;
     perform carl_auct.addAuctInQueue(getQueByName('Q3'),525);
     update auction set status='MODERATED' where id_auction = 604;
     perform carl_auct.addAuctInQueue(getQueByName('Q3'),604);

     --select carl_auct.getQueCurrent(getQueByName('Q1'));
     --select carl_auct.getQueCurrent(getQueByName('Q2'));
     -- select carl_auct._set_que_current(getQueByName('Q3'),null);
     --select carl_auct.getQueCurrent(getQueByName('Q3'));
     --select _get_auct_dt_end(carl_auct.getQueCurrent(getQueByName('Q3')));
     --select _get_queue_status(getQueByName('Q3'));

     -- select carl_auct._run_que_lot(getQueByName('Q3'), 525, clock_timestamp(), clock_timestamp() + interval '15 second');
     -- select carl_comm.getParameter('queue_lot_duration','30 second')::interval;

     --select * from queue_auction;
     --select * from queue;

    -- запуск
    -- select carl_auct.doQueue(getQueByName('Q3'));
    perform carl_auct.checkQueue(getQueByName('Q3'));
end;
$$;

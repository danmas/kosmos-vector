-- 1
create table carl_data.inspect_report
(
    id_inspect_report   integer                  default nextval('inspect_report_id_inspect_report_seq'::regclass) not null
        constraint pk_inspect_report
            primary key,
    key                 bigint                                                                                     not null,
    id_user             integer                                                                                    not null,
    id_object_type      integer                                                                                    not null,
    report              jsonb,
    is_deleted          varchar(1)               default 'N'::character varying                                    not null,
    dt_create           timestamp with time zone default clock_timestamp()                                         not null,
    dt_update           timestamp with time zone default clock_timestamp()                                         not null,
    upd                 integer,
    id_auction          integer,
    api_key             varchar,
    id_access_group     integer,
    public              boolean                  default false,
    search_hash         text,
    verified            boolean                  default false                                                     not null,
    paid                boolean                  default false,
    id_user_verify      integer,
    expert_cert         boolean                  default false,
    api_key_organ       varchar,
    progress            jsonb,
    vin                 varchar,
    status              varchar,
    report_mark         text generated always as (COALESCE((report #>> '{car,characteristics,mark,name}'::text[]),
                                                           (report #>> '{tech_data,currCarMark}'::text[]))) stored,
    report_transmission varchar generated always as (_getreporttransmission(id_inspect_report)) stored,
    city                varchar
);

comment on column carl_data.inspect_report.report is 'Акт осмотра';

comment on column carl_data.inspect_report.upd is 'Время обновления из Акта (UTC)';

comment on column carl_data.inspect_report.id_auction is 'id лота сделанного на основе данного репорта';

comment on column carl_data.inspect_report.public is 'Признак видимости всем.';

comment on column carl_data.inspect_report.search_hash is 'Отфильтрованные значения из поля report';

comment on column carl_data.inspect_report.verified is 'Признак того, что отчет проверен.';

comment on column carl_data.inspect_report.id_user_verify is 'Пользователь изменивший статус "проверено"';

comment on column carl_data.inspect_report.expert_cert is 'Признак "осмотрено Карлинк"';

alter table carl_data.inspect_report
    owner to carl;

create index idx_inspect_report
    on carl_data.inspect_report using gin (report);

create unique index idx_inspect_report_key_uindex
    on carl_data.inspect_report (key, is_deleted)
    where ((key IS NOT NULL) AND ((is_deleted)::text = 'N'::text));

create index idx_inspect_report_status
    on carl_data.inspect_report (status);

create index idx_inspect_report_vin
    on carl_data.inspect_report (vin);

create index idx_search_hash_gin
    on carl_data.inspect_report using gin (search_hash carl_data.gin_trgm_ops);

create index inspect_report_key_index
    on carl_data.inspect_report (key);

create index ir_idaccsgrp_idx
    on carl_data.inspect_report (id_access_group);

create index ix_city
    on carl_data.inspect_report (city);

create trigger trg_inspect_report_api_key
    before insert or update
    on carl_data.inspect_report
    for each row
execute procedure ???();

create trigger trg_iu_inspect_report
    before insert or update
    on carl_data.inspect_report
    for each row
execute procedure ???();

create policy fp_d on carl_data.inspect_report
    as permissive
    for delete
    using _is_row_permit(id_user, id_access_group);

create policy fp_i on carl_data.inspect_report
    as permissive
    for insert
    with check true;

create policy fp_s on carl_data.inspect_report
    as permissive
    for select
    using _is_sel_inspect_report_row_permit(id_user, id_access_group, public);

create policy fp_u on carl_data.inspect_report
    as permissive
    for update
    using _is_row_permit(id_user, id_access_group);

grant delete, insert, references, select, trigger, truncate, update on carl_data.inspect_report to carl_php;


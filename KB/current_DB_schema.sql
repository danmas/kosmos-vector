-- Unknown how to generate base type type

alter type vector owner to supabase_admin;

-- Unknown how to generate base type type

alter type halfvec owner to supabase_admin;

-- Unknown how to generate base type type

alter type sparsevec owner to supabase_admin;

create table file_info
(
    id           serial
        primary key,
    filename     text                                             not null
        unique,
    context_code text                     default 'DEFAULT'::text not null,
    file_hash    text,
    created_at   timestamp with time zone default CURRENT_TIMESTAMP,
    modified_at  timestamp with time zone default CURRENT_TIMESTAMP
);

alter table file_info
    owner to postgres;

grant select, update, usage on sequence file_info_id_seq to anon;

grant select, update, usage on sequence file_info_id_seq to authenticated;

grant select, update, usage on sequence file_info_id_seq to service_role;

grant delete, insert, references, select, trigger, truncate, update on file_info to anon;

grant delete, insert, references, select, trigger, truncate, update on file_info to authenticated;

grant delete, insert, references, select, trigger, truncate, update on file_info to service_role;

create table files
(
    id           uuid      default gen_random_uuid() not null
        primary key,
    context_code text      default 'UNKNOWN'::text   not null,
    filename     text                                not null,
    file_url     text                                not null,
    content      text,
    modified_at  timestamp with time zone            not null,
    created_at   timestamp default now()             not null
);

alter table files
    owner to postgres;

create table ai_item
(
    id           serial
        primary key,
    full_name    text                                             not null,
    context_code text                     default 'DEFAULT'::text not null,
    created_at   timestamp with time zone default CURRENT_TIMESTAMP,
    updated_at   timestamp with time zone default CURRENT_TIMESTAMP,
    type         text                     default 'текст'::text,
    s_name       text,
    h_name       text,
    file_id      uuid                                             not null
        references files
            on delete cascade,
    constraint ai_item_full_name_context_code_pk
        unique (full_name, context_code)
);

comment on table ai_item is 'Основные элементы AI системы';

comment on column ai_item.full_name is 'Полное имя элемента';

comment on column ai_item.context_code is 'Код контекста элемента';

comment on constraint ai_item_full_name_context_code_pk on ai_item is 'Full_name + context_code';

alter table ai_item
    owner to postgres;

grant select, update, usage on sequence ai_item_id_seq to anon;

grant select, update, usage on sequence ai_item_id_seq to authenticated;

grant select, update, usage on sequence ai_item_id_seq to service_role;

create index idx_ai_item_context_code
    on ai_item (context_code);

create index idx_ai_item_full_name
    on ai_item (full_name);

grant delete, insert, references, select, trigger, truncate, update on ai_item to anon;

grant delete, insert, references, select, trigger, truncate, update on ai_item to authenticated;

grant delete, insert, references, select, trigger, truncate, update on ai_item to service_role;

create table chunk_vector
(
    id              uuid                     default gen_random_uuid() not null
        primary key,
    file_id         uuid                                               not null
        constraint file_vectors_file_id_fkey
            references files
            on delete cascade,
    embedding       vector(1536),
    chunk_content   jsonb                                              not null,
    chunk_index     integer,
    created_at      timestamp                default now()             not null,
    content         jsonb,
    type            text                     default 'текст'::text,
    level           text                     default '0-исходник'::text,
    parent_chunk_id uuid
        constraint file_vectors_parent_chunk_id_fkey
            references chunk_vector
            on delete cascade,
    s_name          text,
    h_name          text,
    full_name       text,
    ai_item_id      integer
        constraint fk_file_vectors_ai_item
            references ai_item
            on delete set null,
    updated_at      timestamp with time zone default now()
);

comment on column chunk_vector.parent_chunk_id is 'ID родительского чанка (для чанков 1-го и 2-го уровней)';

comment on column chunk_vector.ai_item_id is 'Ссылка на элемент AI системы';

alter table chunk_vector
    owner to postgres;

create table chunks_info
(
    id          uuid      default gen_random_uuid() not null
        primary key,
    file_id     uuid                                not null
        references chunk_vector
            on delete cascade,
    chunk_count integer   default 0                 not null,
    created_at  timestamp default now()
);

alter table chunks_info
    owner to postgres;

grant delete, insert, references, select, trigger, truncate, update on chunks_info to anon;

grant delete, insert, references, select, trigger, truncate, update on chunks_info to authenticated;

grant delete, insert, references, select, trigger, truncate, update on chunks_info to service_role;

create index chunk_vector_created_at_index
    on chunk_vector (created_at desc);

create index idx_chunk_vector_ai_item_id
    on chunk_vector (ai_item_id);

create index idx_chunk_vector_embedding
    on chunk_vector using ivfflat (embedding vector_cosine_ops);

create index idx_chunk_vector_file_id
    on chunk_vector (file_id);

create index idx_chunk_vector_level
    on chunk_vector (level);

create index idx_chunk_vector_parent_chunk_id
    on chunk_vector (parent_chunk_id);

create index idx_chunk_vector_type
    on chunk_vector (type);

grant delete, insert, references, select, trigger, truncate, update on chunk_vector to anon;

grant delete, insert, references, select, trigger, truncate, update on chunk_vector to authenticated;

grant delete, insert, references, select, trigger, truncate, update on chunk_vector to service_role;

create index idx_files_context_code
    on files (context_code);

grant delete, insert, references, select, trigger, truncate, update on files to anon;

grant delete, insert, references, select, trigger, truncate, update on files to authenticated;

grant delete, insert, references, select, trigger, truncate, update on files to service_role;

create table ai_comment
(
    id           serial
        primary key,
    context_code text not null,
    full_name    text not null,
    comment      text,
    created_at   timestamp with time zone default CURRENT_TIMESTAMP,
    updated_at   timestamp with time zone default CURRENT_TIMESTAMP,
    unique (context_code, full_name)
);

alter table ai_comment
    owner to postgres;

grant select, update, usage on sequence ai_comment_id_seq to anon;

grant select, update, usage on sequence ai_comment_id_seq to authenticated;

grant select, update, usage on sequence ai_comment_id_seq to service_role;

create index idx_ai_comment_context_full_name
    on ai_comment (context_code, full_name);

grant delete, insert, references, select, trigger, truncate, update on ai_comment to anon;

grant delete, insert, references, select, trigger, truncate, update on ai_comment to authenticated;

grant delete, insert, references, select, trigger, truncate, update on ai_comment to service_role;

create table link_type
(
    id          serial
        primary key,
    code        text not null
        unique,
    label       text not null,
    description text,
    is_active   boolean   default true,
    created_at  timestamp default CURRENT_TIMESTAMP,
    updated_at  timestamp default CURRENT_TIMESTAMP
);

alter table link_type
    owner to postgres;

grant select, update, usage on sequence link_type_id_seq to anon;

grant select, update, usage on sequence link_type_id_seq to authenticated;

grant select, update, usage on sequence link_type_id_seq to service_role;

grant delete, insert, references, select, trigger, truncate, update on link_type to anon;

grant delete, insert, references, select, trigger, truncate, update on link_type to authenticated;

grant delete, insert, references, select, trigger, truncate, update on link_type to service_role;

create table link
(
    id                serial
        primary key,
    context_code      text    not null,
    source            text    not null,
    target            text    not null,
    link_type_id      integer not null
        references link_type,
    file_id           uuid,
    source_ai_item_id uuid,
    target_ai_item_id uuid,
    created_at        timestamp default CURRENT_TIMESTAMP,
    updated_at        timestamp default CURRENT_TIMESTAMP
);

alter table link
    owner to postgres;

grant select, update, usage on sequence link_id_seq to anon;

grant select, update, usage on sequence link_id_seq to authenticated;

grant select, update, usage on sequence link_id_seq to service_role;

create index idx_link_context_source
    on link (context_code, source);

create index idx_link_context_target
    on link (context_code, target);

create index idx_link_context_type
    on link (context_code, link_type_id);

create index idx_link_context_target_type
    on link (context_code, target, link_type_id);

create unique index idx_link_unique
    on link (context_code, source, target, link_type_id);

grant delete, insert, references, select, trigger, truncate, update on link to anon;

grant delete, insert, references, select, trigger, truncate, update on link to authenticated;

grant delete, insert, references, select, trigger, truncate, update on link to service_role;

create table agent_script
(
    id                 serial
        primary key,
    context_code       text not null,
    question           text not null,
    script             text not null,
    created_at         timestamp with time zone default CURRENT_TIMESTAMP,
    updated_at         timestamp with time zone default CURRENT_TIMESTAMP,
    usage_count        integer                  default 0,
    is_valid           boolean                  default false,
    last_result        jsonb,
    question_embedding vector(1536)
);

alter table agent_script
    owner to postgres;

grant select, update, usage on sequence agent_script_id_seq to anon;

grant select, update, usage on sequence agent_script_id_seq to authenticated;

grant select, update, usage on sequence agent_script_id_seq to service_role;

create unique index idx_agent_script_unique
    on agent_script (context_code, question);

create index idx_agent_script_question_fts
    on agent_script using gin (to_tsvector('russian'::regconfig, question));

create index idx_agent_script_question_embedding
    on agent_script using ivfflat (question_embedding vector_cosine_ops);

grant delete, insert, references, select, trigger, truncate, update on agent_script to anon;

grant delete, insert, references, select, trigger, truncate, update on agent_script to authenticated;

grant delete, insert, references, select, trigger, truncate, update on agent_script to service_role;

create table tag
(
    id           serial
        primary key,
    context_code text                     default 'DEFAULT'::text not null,
    code         text                                             not null,
    name         text                                             not null,
    description  text,
    created_at   timestamp with time zone default now(),
    updated_at   timestamp with time zone default now(),
    constraint tag_context_code_unique
        unique (context_code, code)
);

alter table tag
    owner to postgres;

grant select, update, usage on sequence tag_id_seq to anon;

grant select, update, usage on sequence tag_id_seq to authenticated;

grant select, update, usage on sequence tag_id_seq to service_role;

grant delete, insert, references, select, trigger, truncate, update on tag to anon;

grant delete, insert, references, select, trigger, truncate, update on tag to authenticated;

grant delete, insert, references, select, trigger, truncate, update on tag to service_role;

create table ai_item_tag
(
    ai_item_full_name    text    not null,
    ai_item_context_code text    not null,
    tag_id               integer not null
        references tag,
    created_at           timestamp with time zone default now(),
    primary key (ai_item_full_name, ai_item_context_code, tag_id),
    constraint fk_ai_item_tag_ai_item
        foreign key (ai_item_full_name, ai_item_context_code) references ai_item (full_name, context_code)
);

alter table ai_item_tag
    owner to postgres;

create index idx_ai_item_tag_ai_item_full_name_context
    on ai_item_tag (ai_item_full_name, ai_item_context_code);

create index idx_ai_item_tag_tag_id
    on ai_item_tag (tag_id);

grant delete, insert, references, select, trigger, truncate, update on ai_item_tag to anon;

grant delete, insert, references, select, trigger, truncate, update on ai_item_tag to authenticated;

grant delete, insert, references, select, trigger, truncate, update on ai_item_tag to service_role;

create function vector_in(cstring, oid, integer) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_in(cstring, oid, integer) owner to supabase_admin;

grant execute on function vector_in(cstring, oid, integer) to postgres;

grant execute on function vector_in(cstring, oid, integer) to anon;

grant execute on function vector_in(cstring, oid, integer) to authenticated;

grant execute on function vector_in(cstring, oid, integer) to service_role;

create function vector_out(vector) returns cstring
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_out(vector) owner to supabase_admin;

grant execute on function vector_out(vector) to postgres;

grant execute on function vector_out(vector) to anon;

grant execute on function vector_out(vector) to authenticated;

grant execute on function vector_out(vector) to service_role;

create function vector_typmod_in(cstring[]) returns integer
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_typmod_in(cstring[]) owner to supabase_admin;

grant execute on function vector_typmod_in(cstring[]) to postgres;

grant execute on function vector_typmod_in(cstring[]) to anon;

grant execute on function vector_typmod_in(cstring[]) to authenticated;

grant execute on function vector_typmod_in(cstring[]) to service_role;

create function vector_recv(internal, oid, integer) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_recv(internal, oid, integer) owner to supabase_admin;

grant execute on function vector_recv(internal, oid, integer) to postgres;

grant execute on function vector_recv(internal, oid, integer) to anon;

grant execute on function vector_recv(internal, oid, integer) to authenticated;

grant execute on function vector_recv(internal, oid, integer) to service_role;

create function vector_send(vector) returns bytea
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_send(vector) owner to supabase_admin;

grant execute on function vector_send(vector) to postgres;

grant execute on function vector_send(vector) to anon;

grant execute on function vector_send(vector) to authenticated;

grant execute on function vector_send(vector) to service_role;

create function l2_distance(vector, vector) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function l2_distance(vector, vector) owner to supabase_admin;

grant execute on function l2_distance(vector, vector) to postgres;

grant execute on function l2_distance(vector, vector) to anon;

grant execute on function l2_distance(vector, vector) to authenticated;

grant execute on function l2_distance(vector, vector) to service_role;

create function inner_product(vector, vector) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function inner_product(vector, vector) owner to supabase_admin;

grant execute on function inner_product(vector, vector) to postgres;

grant execute on function inner_product(vector, vector) to anon;

grant execute on function inner_product(vector, vector) to authenticated;

grant execute on function inner_product(vector, vector) to service_role;

create function cosine_distance(vector, vector) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function cosine_distance(vector, vector) owner to supabase_admin;

grant execute on function cosine_distance(vector, vector) to postgres;

grant execute on function cosine_distance(vector, vector) to anon;

grant execute on function cosine_distance(vector, vector) to authenticated;

grant execute on function cosine_distance(vector, vector) to service_role;

create function l1_distance(vector, vector) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function l1_distance(vector, vector) owner to supabase_admin;

grant execute on function l1_distance(vector, vector) to postgres;

grant execute on function l1_distance(vector, vector) to anon;

grant execute on function l1_distance(vector, vector) to authenticated;

grant execute on function l1_distance(vector, vector) to service_role;

create function vector_dims(vector) returns integer
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_dims(vector) owner to supabase_admin;

grant execute on function vector_dims(vector) to postgres;

grant execute on function vector_dims(vector) to anon;

grant execute on function vector_dims(vector) to authenticated;

grant execute on function vector_dims(vector) to service_role;

create function vector_norm(vector) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_norm(vector) owner to supabase_admin;

grant execute on function vector_norm(vector) to postgres;

grant execute on function vector_norm(vector) to anon;

grant execute on function vector_norm(vector) to authenticated;

grant execute on function vector_norm(vector) to service_role;

create function l2_normalize(vector) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function l2_normalize(vector) owner to supabase_admin;

grant execute on function l2_normalize(vector) to postgres;

grant execute on function l2_normalize(vector) to anon;

grant execute on function l2_normalize(vector) to authenticated;

grant execute on function l2_normalize(vector) to service_role;

create function binary_quantize(vector) returns bit
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function binary_quantize(vector) owner to supabase_admin;

grant execute on function binary_quantize(vector) to postgres;

grant execute on function binary_quantize(vector) to anon;

grant execute on function binary_quantize(vector) to authenticated;

grant execute on function binary_quantize(vector) to service_role;

create function subvector(vector, integer, integer) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function subvector(vector, integer, integer) owner to supabase_admin;

grant execute on function subvector(vector, integer, integer) to postgres;

grant execute on function subvector(vector, integer, integer) to anon;

grant execute on function subvector(vector, integer, integer) to authenticated;

grant execute on function subvector(vector, integer, integer) to service_role;

create function vector_add(vector, vector) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_add(vector, vector) owner to supabase_admin;

grant execute on function vector_add(vector, vector) to postgres;

grant execute on function vector_add(vector, vector) to anon;

grant execute on function vector_add(vector, vector) to authenticated;

grant execute on function vector_add(vector, vector) to service_role;

create function vector_sub(vector, vector) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_sub(vector, vector) owner to supabase_admin;

grant execute on function vector_sub(vector, vector) to postgres;

grant execute on function vector_sub(vector, vector) to anon;

grant execute on function vector_sub(vector, vector) to authenticated;

grant execute on function vector_sub(vector, vector) to service_role;

create function vector_mul(vector, vector) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_mul(vector, vector) owner to supabase_admin;

grant execute on function vector_mul(vector, vector) to postgres;

grant execute on function vector_mul(vector, vector) to anon;

grant execute on function vector_mul(vector, vector) to authenticated;

grant execute on function vector_mul(vector, vector) to service_role;

create function vector_concat(vector, vector) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_concat(vector, vector) owner to supabase_admin;

grant execute on function vector_concat(vector, vector) to postgres;

grant execute on function vector_concat(vector, vector) to anon;

grant execute on function vector_concat(vector, vector) to authenticated;

grant execute on function vector_concat(vector, vector) to service_role;

create function vector_lt(vector, vector) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_lt(vector, vector) owner to supabase_admin;

grant execute on function vector_lt(vector, vector) to postgres;

grant execute on function vector_lt(vector, vector) to anon;

grant execute on function vector_lt(vector, vector) to authenticated;

grant execute on function vector_lt(vector, vector) to service_role;

create function vector_le(vector, vector) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_le(vector, vector) owner to supabase_admin;

grant execute on function vector_le(vector, vector) to postgres;

grant execute on function vector_le(vector, vector) to anon;

grant execute on function vector_le(vector, vector) to authenticated;

grant execute on function vector_le(vector, vector) to service_role;

create function vector_eq(vector, vector) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_eq(vector, vector) owner to supabase_admin;

grant execute on function vector_eq(vector, vector) to postgres;

grant execute on function vector_eq(vector, vector) to anon;

grant execute on function vector_eq(vector, vector) to authenticated;

grant execute on function vector_eq(vector, vector) to service_role;

create function vector_ne(vector, vector) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_ne(vector, vector) owner to supabase_admin;

grant execute on function vector_ne(vector, vector) to postgres;

grant execute on function vector_ne(vector, vector) to anon;

grant execute on function vector_ne(vector, vector) to authenticated;

grant execute on function vector_ne(vector, vector) to service_role;

create function vector_ge(vector, vector) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_ge(vector, vector) owner to supabase_admin;

grant execute on function vector_ge(vector, vector) to postgres;

grant execute on function vector_ge(vector, vector) to anon;

grant execute on function vector_ge(vector, vector) to authenticated;

grant execute on function vector_ge(vector, vector) to service_role;

create function vector_gt(vector, vector) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_gt(vector, vector) owner to supabase_admin;

grant execute on function vector_gt(vector, vector) to postgres;

grant execute on function vector_gt(vector, vector) to anon;

grant execute on function vector_gt(vector, vector) to authenticated;

grant execute on function vector_gt(vector, vector) to service_role;

create function vector_cmp(vector, vector) returns integer
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_cmp(vector, vector) owner to supabase_admin;

grant execute on function vector_cmp(vector, vector) to postgres;

grant execute on function vector_cmp(vector, vector) to anon;

grant execute on function vector_cmp(vector, vector) to authenticated;

grant execute on function vector_cmp(vector, vector) to service_role;

create function vector_l2_squared_distance(vector, vector) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_l2_squared_distance(vector, vector) owner to supabase_admin;

grant execute on function vector_l2_squared_distance(vector, vector) to postgres;

grant execute on function vector_l2_squared_distance(vector, vector) to anon;

grant execute on function vector_l2_squared_distance(vector, vector) to authenticated;

grant execute on function vector_l2_squared_distance(vector, vector) to service_role;

create function vector_negative_inner_product(vector, vector) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_negative_inner_product(vector, vector) owner to supabase_admin;

grant execute on function vector_negative_inner_product(vector, vector) to postgres;

grant execute on function vector_negative_inner_product(vector, vector) to anon;

grant execute on function vector_negative_inner_product(vector, vector) to authenticated;

grant execute on function vector_negative_inner_product(vector, vector) to service_role;

create function vector_spherical_distance(vector, vector) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_spherical_distance(vector, vector) owner to supabase_admin;

grant execute on function vector_spherical_distance(vector, vector) to postgres;

grant execute on function vector_spherical_distance(vector, vector) to anon;

grant execute on function vector_spherical_distance(vector, vector) to authenticated;

grant execute on function vector_spherical_distance(vector, vector) to service_role;

create function vector_accum(double precision[], vector) returns double precision[]
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_accum(double precision[], vector) owner to supabase_admin;

grant execute on function vector_accum(double precision[], vector) to postgres;

grant execute on function vector_accum(double precision[], vector) to anon;

grant execute on function vector_accum(double precision[], vector) to authenticated;

grant execute on function vector_accum(double precision[], vector) to service_role;

create function vector_avg(double precision[]) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_avg(double precision[]) owner to supabase_admin;

grant execute on function vector_avg(double precision[]) to postgres;

grant execute on function vector_avg(double precision[]) to anon;

grant execute on function vector_avg(double precision[]) to authenticated;

grant execute on function vector_avg(double precision[]) to service_role;

create function vector_combine(double precision[], double precision[]) returns double precision[]
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_combine(double precision[], double precision[]) owner to supabase_admin;

grant execute on function vector_combine(double precision[], double precision[]) to postgres;

grant execute on function vector_combine(double precision[], double precision[]) to anon;

grant execute on function vector_combine(double precision[], double precision[]) to authenticated;

grant execute on function vector_combine(double precision[], double precision[]) to service_role;

create function vector(vector, integer, boolean) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector(vector, integer, boolean) owner to supabase_admin;

grant execute on function vector(vector, integer, boolean) to postgres;

grant execute on function vector(vector, integer, boolean) to anon;

grant execute on function vector(vector, integer, boolean) to authenticated;

grant execute on function vector(vector, integer, boolean) to service_role;

create function array_to_vector(integer[], integer, boolean) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_vector(integer[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_vector(integer[], integer, boolean) to postgres;

grant execute on function array_to_vector(integer[], integer, boolean) to anon;

grant execute on function array_to_vector(integer[], integer, boolean) to authenticated;

grant execute on function array_to_vector(integer[], integer, boolean) to service_role;

create function array_to_vector(real[], integer, boolean) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_vector(real[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_vector(real[], integer, boolean) to postgres;

grant execute on function array_to_vector(real[], integer, boolean) to anon;

grant execute on function array_to_vector(real[], integer, boolean) to authenticated;

grant execute on function array_to_vector(real[], integer, boolean) to service_role;

create function array_to_vector(double precision[], integer, boolean) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_vector(double precision[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_vector(double precision[], integer, boolean) to postgres;

grant execute on function array_to_vector(double precision[], integer, boolean) to anon;

grant execute on function array_to_vector(double precision[], integer, boolean) to authenticated;

grant execute on function array_to_vector(double precision[], integer, boolean) to service_role;

create function array_to_vector(numeric[], integer, boolean) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_vector(numeric[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_vector(numeric[], integer, boolean) to postgres;

grant execute on function array_to_vector(numeric[], integer, boolean) to anon;

grant execute on function array_to_vector(numeric[], integer, boolean) to authenticated;

grant execute on function array_to_vector(numeric[], integer, boolean) to service_role;

create function vector_to_float4(vector, integer, boolean) returns real[]
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_to_float4(vector, integer, boolean) owner to supabase_admin;

grant execute on function vector_to_float4(vector, integer, boolean) to postgres;

grant execute on function vector_to_float4(vector, integer, boolean) to anon;

grant execute on function vector_to_float4(vector, integer, boolean) to authenticated;

grant execute on function vector_to_float4(vector, integer, boolean) to service_role;

create function ivfflathandler(internal) returns index_am_handler
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function ivfflathandler(internal) owner to supabase_admin;

grant execute on function ivfflathandler(internal) to postgres;

grant execute on function ivfflathandler(internal) to anon;

grant execute on function ivfflathandler(internal) to authenticated;

grant execute on function ivfflathandler(internal) to service_role;

create function hnswhandler(internal) returns index_am_handler
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function hnswhandler(internal) owner to supabase_admin;

grant execute on function hnswhandler(internal) to postgres;

grant execute on function hnswhandler(internal) to anon;

grant execute on function hnswhandler(internal) to authenticated;

grant execute on function hnswhandler(internal) to service_role;

create function ivfflat_halfvec_support(internal) returns internal
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function ivfflat_halfvec_support(internal) owner to supabase_admin;

grant execute on function ivfflat_halfvec_support(internal) to postgres;

grant execute on function ivfflat_halfvec_support(internal) to anon;

grant execute on function ivfflat_halfvec_support(internal) to authenticated;

grant execute on function ivfflat_halfvec_support(internal) to service_role;

create function ivfflat_bit_support(internal) returns internal
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function ivfflat_bit_support(internal) owner to supabase_admin;

grant execute on function ivfflat_bit_support(internal) to postgres;

grant execute on function ivfflat_bit_support(internal) to anon;

grant execute on function ivfflat_bit_support(internal) to authenticated;

grant execute on function ivfflat_bit_support(internal) to service_role;

create function hnsw_halfvec_support(internal) returns internal
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function hnsw_halfvec_support(internal) owner to supabase_admin;

grant execute on function hnsw_halfvec_support(internal) to postgres;

grant execute on function hnsw_halfvec_support(internal) to anon;

grant execute on function hnsw_halfvec_support(internal) to authenticated;

grant execute on function hnsw_halfvec_support(internal) to service_role;

create function hnsw_bit_support(internal) returns internal
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function hnsw_bit_support(internal) owner to supabase_admin;

grant execute on function hnsw_bit_support(internal) to postgres;

grant execute on function hnsw_bit_support(internal) to anon;

grant execute on function hnsw_bit_support(internal) to authenticated;

grant execute on function hnsw_bit_support(internal) to service_role;

create function hnsw_sparsevec_support(internal) returns internal
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function hnsw_sparsevec_support(internal) owner to supabase_admin;

grant execute on function hnsw_sparsevec_support(internal) to postgres;

grant execute on function hnsw_sparsevec_support(internal) to anon;

grant execute on function hnsw_sparsevec_support(internal) to authenticated;

grant execute on function hnsw_sparsevec_support(internal) to service_role;

create function halfvec_in(cstring, oid, integer) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_in(cstring, oid, integer) owner to supabase_admin;

grant execute on function halfvec_in(cstring, oid, integer) to postgres;

grant execute on function halfvec_in(cstring, oid, integer) to anon;

grant execute on function halfvec_in(cstring, oid, integer) to authenticated;

grant execute on function halfvec_in(cstring, oid, integer) to service_role;

create function halfvec_out(halfvec) returns cstring
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_out(halfvec) owner to supabase_admin;

grant execute on function halfvec_out(halfvec) to postgres;

grant execute on function halfvec_out(halfvec) to anon;

grant execute on function halfvec_out(halfvec) to authenticated;

grant execute on function halfvec_out(halfvec) to service_role;

create function halfvec_typmod_in(cstring[]) returns integer
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_typmod_in(cstring[]) owner to supabase_admin;

grant execute on function halfvec_typmod_in(cstring[]) to postgres;

grant execute on function halfvec_typmod_in(cstring[]) to anon;

grant execute on function halfvec_typmod_in(cstring[]) to authenticated;

grant execute on function halfvec_typmod_in(cstring[]) to service_role;

create function halfvec_recv(internal, oid, integer) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_recv(internal, oid, integer) owner to supabase_admin;

grant execute on function halfvec_recv(internal, oid, integer) to postgres;

grant execute on function halfvec_recv(internal, oid, integer) to anon;

grant execute on function halfvec_recv(internal, oid, integer) to authenticated;

grant execute on function halfvec_recv(internal, oid, integer) to service_role;

create function halfvec_send(halfvec) returns bytea
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_send(halfvec) owner to supabase_admin;

grant execute on function halfvec_send(halfvec) to postgres;

grant execute on function halfvec_send(halfvec) to anon;

grant execute on function halfvec_send(halfvec) to authenticated;

grant execute on function halfvec_send(halfvec) to service_role;

create function l2_distance(halfvec, halfvec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function l2_distance(halfvec, halfvec) owner to supabase_admin;

grant execute on function l2_distance(halfvec, halfvec) to postgres;

grant execute on function l2_distance(halfvec, halfvec) to anon;

grant execute on function l2_distance(halfvec, halfvec) to authenticated;

grant execute on function l2_distance(halfvec, halfvec) to service_role;

create function inner_product(halfvec, halfvec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function inner_product(halfvec, halfvec) owner to supabase_admin;

grant execute on function inner_product(halfvec, halfvec) to postgres;

grant execute on function inner_product(halfvec, halfvec) to anon;

grant execute on function inner_product(halfvec, halfvec) to authenticated;

grant execute on function inner_product(halfvec, halfvec) to service_role;

create function cosine_distance(halfvec, halfvec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function cosine_distance(halfvec, halfvec) owner to supabase_admin;

grant execute on function cosine_distance(halfvec, halfvec) to postgres;

grant execute on function cosine_distance(halfvec, halfvec) to anon;

grant execute on function cosine_distance(halfvec, halfvec) to authenticated;

grant execute on function cosine_distance(halfvec, halfvec) to service_role;

create function l1_distance(halfvec, halfvec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function l1_distance(halfvec, halfvec) owner to supabase_admin;

grant execute on function l1_distance(halfvec, halfvec) to postgres;

grant execute on function l1_distance(halfvec, halfvec) to anon;

grant execute on function l1_distance(halfvec, halfvec) to authenticated;

grant execute on function l1_distance(halfvec, halfvec) to service_role;

create function vector_dims(halfvec) returns integer
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_dims(halfvec) owner to supabase_admin;

grant execute on function vector_dims(halfvec) to postgres;

grant execute on function vector_dims(halfvec) to anon;

grant execute on function vector_dims(halfvec) to authenticated;

grant execute on function vector_dims(halfvec) to service_role;

create function l2_norm(halfvec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function l2_norm(halfvec) owner to supabase_admin;

grant execute on function l2_norm(halfvec) to postgres;

grant execute on function l2_norm(halfvec) to anon;

grant execute on function l2_norm(halfvec) to authenticated;

grant execute on function l2_norm(halfvec) to service_role;

create function l2_normalize(halfvec) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function l2_normalize(halfvec) owner to supabase_admin;

grant execute on function l2_normalize(halfvec) to postgres;

grant execute on function l2_normalize(halfvec) to anon;

grant execute on function l2_normalize(halfvec) to authenticated;

grant execute on function l2_normalize(halfvec) to service_role;

create function binary_quantize(halfvec) returns bit
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function binary_quantize(halfvec) owner to supabase_admin;

grant execute on function binary_quantize(halfvec) to postgres;

grant execute on function binary_quantize(halfvec) to anon;

grant execute on function binary_quantize(halfvec) to authenticated;

grant execute on function binary_quantize(halfvec) to service_role;

create function subvector(halfvec, integer, integer) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function subvector(halfvec, integer, integer) owner to supabase_admin;

grant execute on function subvector(halfvec, integer, integer) to postgres;

grant execute on function subvector(halfvec, integer, integer) to anon;

grant execute on function subvector(halfvec, integer, integer) to authenticated;

grant execute on function subvector(halfvec, integer, integer) to service_role;

create function halfvec_add(halfvec, halfvec) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_add(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_add(halfvec, halfvec) to postgres;

grant execute on function halfvec_add(halfvec, halfvec) to anon;

grant execute on function halfvec_add(halfvec, halfvec) to authenticated;

grant execute on function halfvec_add(halfvec, halfvec) to service_role;

create function halfvec_sub(halfvec, halfvec) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_sub(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_sub(halfvec, halfvec) to postgres;

grant execute on function halfvec_sub(halfvec, halfvec) to anon;

grant execute on function halfvec_sub(halfvec, halfvec) to authenticated;

grant execute on function halfvec_sub(halfvec, halfvec) to service_role;

create function halfvec_mul(halfvec, halfvec) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_mul(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_mul(halfvec, halfvec) to postgres;

grant execute on function halfvec_mul(halfvec, halfvec) to anon;

grant execute on function halfvec_mul(halfvec, halfvec) to authenticated;

grant execute on function halfvec_mul(halfvec, halfvec) to service_role;

create function halfvec_concat(halfvec, halfvec) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_concat(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_concat(halfvec, halfvec) to postgres;

grant execute on function halfvec_concat(halfvec, halfvec) to anon;

grant execute on function halfvec_concat(halfvec, halfvec) to authenticated;

grant execute on function halfvec_concat(halfvec, halfvec) to service_role;

create function halfvec_lt(halfvec, halfvec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_lt(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_lt(halfvec, halfvec) to postgres;

grant execute on function halfvec_lt(halfvec, halfvec) to anon;

grant execute on function halfvec_lt(halfvec, halfvec) to authenticated;

grant execute on function halfvec_lt(halfvec, halfvec) to service_role;

create function halfvec_le(halfvec, halfvec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_le(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_le(halfvec, halfvec) to postgres;

grant execute on function halfvec_le(halfvec, halfvec) to anon;

grant execute on function halfvec_le(halfvec, halfvec) to authenticated;

grant execute on function halfvec_le(halfvec, halfvec) to service_role;

create function halfvec_eq(halfvec, halfvec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_eq(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_eq(halfvec, halfvec) to postgres;

grant execute on function halfvec_eq(halfvec, halfvec) to anon;

grant execute on function halfvec_eq(halfvec, halfvec) to authenticated;

grant execute on function halfvec_eq(halfvec, halfvec) to service_role;

create function halfvec_ne(halfvec, halfvec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_ne(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_ne(halfvec, halfvec) to postgres;

grant execute on function halfvec_ne(halfvec, halfvec) to anon;

grant execute on function halfvec_ne(halfvec, halfvec) to authenticated;

grant execute on function halfvec_ne(halfvec, halfvec) to service_role;

create function halfvec_ge(halfvec, halfvec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_ge(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_ge(halfvec, halfvec) to postgres;

grant execute on function halfvec_ge(halfvec, halfvec) to anon;

grant execute on function halfvec_ge(halfvec, halfvec) to authenticated;

grant execute on function halfvec_ge(halfvec, halfvec) to service_role;

create function halfvec_gt(halfvec, halfvec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_gt(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_gt(halfvec, halfvec) to postgres;

grant execute on function halfvec_gt(halfvec, halfvec) to anon;

grant execute on function halfvec_gt(halfvec, halfvec) to authenticated;

grant execute on function halfvec_gt(halfvec, halfvec) to service_role;

create function halfvec_cmp(halfvec, halfvec) returns integer
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_cmp(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_cmp(halfvec, halfvec) to postgres;

grant execute on function halfvec_cmp(halfvec, halfvec) to anon;

grant execute on function halfvec_cmp(halfvec, halfvec) to authenticated;

grant execute on function halfvec_cmp(halfvec, halfvec) to service_role;

create function halfvec_l2_squared_distance(halfvec, halfvec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_l2_squared_distance(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_l2_squared_distance(halfvec, halfvec) to postgres;

grant execute on function halfvec_l2_squared_distance(halfvec, halfvec) to anon;

grant execute on function halfvec_l2_squared_distance(halfvec, halfvec) to authenticated;

grant execute on function halfvec_l2_squared_distance(halfvec, halfvec) to service_role;

create function halfvec_negative_inner_product(halfvec, halfvec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_negative_inner_product(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_negative_inner_product(halfvec, halfvec) to postgres;

grant execute on function halfvec_negative_inner_product(halfvec, halfvec) to anon;

grant execute on function halfvec_negative_inner_product(halfvec, halfvec) to authenticated;

grant execute on function halfvec_negative_inner_product(halfvec, halfvec) to service_role;

create function halfvec_spherical_distance(halfvec, halfvec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_spherical_distance(halfvec, halfvec) owner to supabase_admin;

grant execute on function halfvec_spherical_distance(halfvec, halfvec) to postgres;

grant execute on function halfvec_spherical_distance(halfvec, halfvec) to anon;

grant execute on function halfvec_spherical_distance(halfvec, halfvec) to authenticated;

grant execute on function halfvec_spherical_distance(halfvec, halfvec) to service_role;

create function halfvec_accum(double precision[], halfvec) returns double precision[]
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_accum(double precision[], halfvec) owner to supabase_admin;

grant execute on function halfvec_accum(double precision[], halfvec) to postgres;

grant execute on function halfvec_accum(double precision[], halfvec) to anon;

grant execute on function halfvec_accum(double precision[], halfvec) to authenticated;

grant execute on function halfvec_accum(double precision[], halfvec) to service_role;

create function halfvec_avg(double precision[]) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_avg(double precision[]) owner to supabase_admin;

grant execute on function halfvec_avg(double precision[]) to postgres;

grant execute on function halfvec_avg(double precision[]) to anon;

grant execute on function halfvec_avg(double precision[]) to authenticated;

grant execute on function halfvec_avg(double precision[]) to service_role;

create function halfvec_combine(double precision[], double precision[]) returns double precision[]
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_combine(double precision[], double precision[]) owner to supabase_admin;

grant execute on function halfvec_combine(double precision[], double precision[]) to postgres;

grant execute on function halfvec_combine(double precision[], double precision[]) to anon;

grant execute on function halfvec_combine(double precision[], double precision[]) to authenticated;

grant execute on function halfvec_combine(double precision[], double precision[]) to service_role;

create function halfvec(halfvec, integer, boolean) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec(halfvec, integer, boolean) owner to supabase_admin;

grant execute on function halfvec(halfvec, integer, boolean) to postgres;

grant execute on function halfvec(halfvec, integer, boolean) to anon;

grant execute on function halfvec(halfvec, integer, boolean) to authenticated;

grant execute on function halfvec(halfvec, integer, boolean) to service_role;

create function halfvec_to_vector(halfvec, integer, boolean) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_to_vector(halfvec, integer, boolean) owner to supabase_admin;

grant execute on function halfvec_to_vector(halfvec, integer, boolean) to postgres;

grant execute on function halfvec_to_vector(halfvec, integer, boolean) to anon;

grant execute on function halfvec_to_vector(halfvec, integer, boolean) to authenticated;

grant execute on function halfvec_to_vector(halfvec, integer, boolean) to service_role;

create function vector_to_halfvec(vector, integer, boolean) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_to_halfvec(vector, integer, boolean) owner to supabase_admin;

grant execute on function vector_to_halfvec(vector, integer, boolean) to postgres;

grant execute on function vector_to_halfvec(vector, integer, boolean) to anon;

grant execute on function vector_to_halfvec(vector, integer, boolean) to authenticated;

grant execute on function vector_to_halfvec(vector, integer, boolean) to service_role;

create function array_to_halfvec(integer[], integer, boolean) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_halfvec(integer[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_halfvec(integer[], integer, boolean) to postgres;

grant execute on function array_to_halfvec(integer[], integer, boolean) to anon;

grant execute on function array_to_halfvec(integer[], integer, boolean) to authenticated;

grant execute on function array_to_halfvec(integer[], integer, boolean) to service_role;

create function array_to_halfvec(real[], integer, boolean) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_halfvec(real[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_halfvec(real[], integer, boolean) to postgres;

grant execute on function array_to_halfvec(real[], integer, boolean) to anon;

grant execute on function array_to_halfvec(real[], integer, boolean) to authenticated;

grant execute on function array_to_halfvec(real[], integer, boolean) to service_role;

create function array_to_halfvec(double precision[], integer, boolean) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_halfvec(double precision[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_halfvec(double precision[], integer, boolean) to postgres;

grant execute on function array_to_halfvec(double precision[], integer, boolean) to anon;

grant execute on function array_to_halfvec(double precision[], integer, boolean) to authenticated;

grant execute on function array_to_halfvec(double precision[], integer, boolean) to service_role;

create function array_to_halfvec(numeric[], integer, boolean) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_halfvec(numeric[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_halfvec(numeric[], integer, boolean) to postgres;

grant execute on function array_to_halfvec(numeric[], integer, boolean) to anon;

grant execute on function array_to_halfvec(numeric[], integer, boolean) to authenticated;

grant execute on function array_to_halfvec(numeric[], integer, boolean) to service_role;

create function halfvec_to_float4(halfvec, integer, boolean) returns real[]
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_to_float4(halfvec, integer, boolean) owner to supabase_admin;

grant execute on function halfvec_to_float4(halfvec, integer, boolean) to postgres;

grant execute on function halfvec_to_float4(halfvec, integer, boolean) to anon;

grant execute on function halfvec_to_float4(halfvec, integer, boolean) to authenticated;

grant execute on function halfvec_to_float4(halfvec, integer, boolean) to service_role;

create function hamming_distance(bit, bit) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function hamming_distance(bit, bit) owner to supabase_admin;

grant execute on function hamming_distance(bit, bit) to postgres;

grant execute on function hamming_distance(bit, bit) to anon;

grant execute on function hamming_distance(bit, bit) to authenticated;

grant execute on function hamming_distance(bit, bit) to service_role;

create function jaccard_distance(bit, bit) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function jaccard_distance(bit, bit) owner to supabase_admin;

grant execute on function jaccard_distance(bit, bit) to postgres;

grant execute on function jaccard_distance(bit, bit) to anon;

grant execute on function jaccard_distance(bit, bit) to authenticated;

grant execute on function jaccard_distance(bit, bit) to service_role;

create function sparsevec_in(cstring, oid, integer) returns sparsevec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_in(cstring, oid, integer) owner to supabase_admin;

grant execute on function sparsevec_in(cstring, oid, integer) to postgres;

grant execute on function sparsevec_in(cstring, oid, integer) to anon;

grant execute on function sparsevec_in(cstring, oid, integer) to authenticated;

grant execute on function sparsevec_in(cstring, oid, integer) to service_role;

create function sparsevec_out(sparsevec) returns cstring
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_out(sparsevec) owner to supabase_admin;

grant execute on function sparsevec_out(sparsevec) to postgres;

grant execute on function sparsevec_out(sparsevec) to anon;

grant execute on function sparsevec_out(sparsevec) to authenticated;

grant execute on function sparsevec_out(sparsevec) to service_role;

create function sparsevec_typmod_in(cstring[]) returns integer
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_typmod_in(cstring[]) owner to supabase_admin;

grant execute on function sparsevec_typmod_in(cstring[]) to postgres;

grant execute on function sparsevec_typmod_in(cstring[]) to anon;

grant execute on function sparsevec_typmod_in(cstring[]) to authenticated;

grant execute on function sparsevec_typmod_in(cstring[]) to service_role;

create function sparsevec_recv(internal, oid, integer) returns sparsevec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_recv(internal, oid, integer) owner to supabase_admin;

grant execute on function sparsevec_recv(internal, oid, integer) to postgres;

grant execute on function sparsevec_recv(internal, oid, integer) to anon;

grant execute on function sparsevec_recv(internal, oid, integer) to authenticated;

grant execute on function sparsevec_recv(internal, oid, integer) to service_role;

create function sparsevec_send(sparsevec) returns bytea
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_send(sparsevec) owner to supabase_admin;

grant execute on function sparsevec_send(sparsevec) to postgres;

grant execute on function sparsevec_send(sparsevec) to anon;

grant execute on function sparsevec_send(sparsevec) to authenticated;

grant execute on function sparsevec_send(sparsevec) to service_role;

create function l2_distance(sparsevec, sparsevec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function l2_distance(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function l2_distance(sparsevec, sparsevec) to postgres;

grant execute on function l2_distance(sparsevec, sparsevec) to anon;

grant execute on function l2_distance(sparsevec, sparsevec) to authenticated;

grant execute on function l2_distance(sparsevec, sparsevec) to service_role;

create function inner_product(sparsevec, sparsevec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function inner_product(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function inner_product(sparsevec, sparsevec) to postgres;

grant execute on function inner_product(sparsevec, sparsevec) to anon;

grant execute on function inner_product(sparsevec, sparsevec) to authenticated;

grant execute on function inner_product(sparsevec, sparsevec) to service_role;

create function cosine_distance(sparsevec, sparsevec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function cosine_distance(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function cosine_distance(sparsevec, sparsevec) to postgres;

grant execute on function cosine_distance(sparsevec, sparsevec) to anon;

grant execute on function cosine_distance(sparsevec, sparsevec) to authenticated;

grant execute on function cosine_distance(sparsevec, sparsevec) to service_role;

create function l1_distance(sparsevec, sparsevec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function l1_distance(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function l1_distance(sparsevec, sparsevec) to postgres;

grant execute on function l1_distance(sparsevec, sparsevec) to anon;

grant execute on function l1_distance(sparsevec, sparsevec) to authenticated;

grant execute on function l1_distance(sparsevec, sparsevec) to service_role;

create function l2_norm(sparsevec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function l2_norm(sparsevec) owner to supabase_admin;

grant execute on function l2_norm(sparsevec) to postgres;

grant execute on function l2_norm(sparsevec) to anon;

grant execute on function l2_norm(sparsevec) to authenticated;

grant execute on function l2_norm(sparsevec) to service_role;

create function l2_normalize(sparsevec) returns sparsevec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function l2_normalize(sparsevec) owner to supabase_admin;

grant execute on function l2_normalize(sparsevec) to postgres;

grant execute on function l2_normalize(sparsevec) to anon;

grant execute on function l2_normalize(sparsevec) to authenticated;

grant execute on function l2_normalize(sparsevec) to service_role;

create function sparsevec_lt(sparsevec, sparsevec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_lt(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function sparsevec_lt(sparsevec, sparsevec) to postgres;

grant execute on function sparsevec_lt(sparsevec, sparsevec) to anon;

grant execute on function sparsevec_lt(sparsevec, sparsevec) to authenticated;

grant execute on function sparsevec_lt(sparsevec, sparsevec) to service_role;

create function sparsevec_le(sparsevec, sparsevec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_le(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function sparsevec_le(sparsevec, sparsevec) to postgres;

grant execute on function sparsevec_le(sparsevec, sparsevec) to anon;

grant execute on function sparsevec_le(sparsevec, sparsevec) to authenticated;

grant execute on function sparsevec_le(sparsevec, sparsevec) to service_role;

create function sparsevec_eq(sparsevec, sparsevec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_eq(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function sparsevec_eq(sparsevec, sparsevec) to postgres;

grant execute on function sparsevec_eq(sparsevec, sparsevec) to anon;

grant execute on function sparsevec_eq(sparsevec, sparsevec) to authenticated;

grant execute on function sparsevec_eq(sparsevec, sparsevec) to service_role;

create function sparsevec_ne(sparsevec, sparsevec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_ne(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function sparsevec_ne(sparsevec, sparsevec) to postgres;

grant execute on function sparsevec_ne(sparsevec, sparsevec) to anon;

grant execute on function sparsevec_ne(sparsevec, sparsevec) to authenticated;

grant execute on function sparsevec_ne(sparsevec, sparsevec) to service_role;

create function sparsevec_ge(sparsevec, sparsevec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_ge(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function sparsevec_ge(sparsevec, sparsevec) to postgres;

grant execute on function sparsevec_ge(sparsevec, sparsevec) to anon;

grant execute on function sparsevec_ge(sparsevec, sparsevec) to authenticated;

grant execute on function sparsevec_ge(sparsevec, sparsevec) to service_role;

create function sparsevec_gt(sparsevec, sparsevec) returns boolean
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_gt(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function sparsevec_gt(sparsevec, sparsevec) to postgres;

grant execute on function sparsevec_gt(sparsevec, sparsevec) to anon;

grant execute on function sparsevec_gt(sparsevec, sparsevec) to authenticated;

grant execute on function sparsevec_gt(sparsevec, sparsevec) to service_role;

create function sparsevec_cmp(sparsevec, sparsevec) returns integer
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_cmp(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function sparsevec_cmp(sparsevec, sparsevec) to postgres;

grant execute on function sparsevec_cmp(sparsevec, sparsevec) to anon;

grant execute on function sparsevec_cmp(sparsevec, sparsevec) to authenticated;

grant execute on function sparsevec_cmp(sparsevec, sparsevec) to service_role;

create function sparsevec_l2_squared_distance(sparsevec, sparsevec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_l2_squared_distance(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function sparsevec_l2_squared_distance(sparsevec, sparsevec) to postgres;

grant execute on function sparsevec_l2_squared_distance(sparsevec, sparsevec) to anon;

grant execute on function sparsevec_l2_squared_distance(sparsevec, sparsevec) to authenticated;

grant execute on function sparsevec_l2_squared_distance(sparsevec, sparsevec) to service_role;

create function sparsevec_negative_inner_product(sparsevec, sparsevec) returns double precision
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_negative_inner_product(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function sparsevec_negative_inner_product(sparsevec, sparsevec) to postgres;

grant execute on function sparsevec_negative_inner_product(sparsevec, sparsevec) to anon;

grant execute on function sparsevec_negative_inner_product(sparsevec, sparsevec) to authenticated;

grant execute on function sparsevec_negative_inner_product(sparsevec, sparsevec) to service_role;

create function sparsevec(sparsevec, integer, boolean) returns sparsevec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec(sparsevec, integer, boolean) owner to supabase_admin;

grant execute on function sparsevec(sparsevec, integer, boolean) to postgres;

grant execute on function sparsevec(sparsevec, integer, boolean) to anon;

grant execute on function sparsevec(sparsevec, integer, boolean) to authenticated;

grant execute on function sparsevec(sparsevec, integer, boolean) to service_role;

create function vector_to_sparsevec(vector, integer, boolean) returns sparsevec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function vector_to_sparsevec(vector, integer, boolean) owner to supabase_admin;

grant execute on function vector_to_sparsevec(vector, integer, boolean) to postgres;

grant execute on function vector_to_sparsevec(vector, integer, boolean) to anon;

grant execute on function vector_to_sparsevec(vector, integer, boolean) to authenticated;

grant execute on function vector_to_sparsevec(vector, integer, boolean) to service_role;

create function sparsevec_to_vector(sparsevec, integer, boolean) returns vector
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_to_vector(sparsevec, integer, boolean) owner to supabase_admin;

grant execute on function sparsevec_to_vector(sparsevec, integer, boolean) to postgres;

grant execute on function sparsevec_to_vector(sparsevec, integer, boolean) to anon;

grant execute on function sparsevec_to_vector(sparsevec, integer, boolean) to authenticated;

grant execute on function sparsevec_to_vector(sparsevec, integer, boolean) to service_role;

create function halfvec_to_sparsevec(halfvec, integer, boolean) returns sparsevec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function halfvec_to_sparsevec(halfvec, integer, boolean) owner to supabase_admin;

grant execute on function halfvec_to_sparsevec(halfvec, integer, boolean) to postgres;

grant execute on function halfvec_to_sparsevec(halfvec, integer, boolean) to anon;

grant execute on function halfvec_to_sparsevec(halfvec, integer, boolean) to authenticated;

grant execute on function halfvec_to_sparsevec(halfvec, integer, boolean) to service_role;

create function sparsevec_to_halfvec(sparsevec, integer, boolean) returns halfvec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function sparsevec_to_halfvec(sparsevec, integer, boolean) owner to supabase_admin;

grant execute on function sparsevec_to_halfvec(sparsevec, integer, boolean) to postgres;

grant execute on function sparsevec_to_halfvec(sparsevec, integer, boolean) to anon;

grant execute on function sparsevec_to_halfvec(sparsevec, integer, boolean) to authenticated;

grant execute on function sparsevec_to_halfvec(sparsevec, integer, boolean) to service_role;

create function array_to_sparsevec(integer[], integer, boolean) returns sparsevec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_sparsevec(integer[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_sparsevec(integer[], integer, boolean) to postgres;

grant execute on function array_to_sparsevec(integer[], integer, boolean) to anon;

grant execute on function array_to_sparsevec(integer[], integer, boolean) to authenticated;

grant execute on function array_to_sparsevec(integer[], integer, boolean) to service_role;

create function array_to_sparsevec(real[], integer, boolean) returns sparsevec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_sparsevec(real[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_sparsevec(real[], integer, boolean) to postgres;

grant execute on function array_to_sparsevec(real[], integer, boolean) to anon;

grant execute on function array_to_sparsevec(real[], integer, boolean) to authenticated;

grant execute on function array_to_sparsevec(real[], integer, boolean) to service_role;

create function array_to_sparsevec(double precision[], integer, boolean) returns sparsevec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_sparsevec(double precision[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_sparsevec(double precision[], integer, boolean) to postgres;

grant execute on function array_to_sparsevec(double precision[], integer, boolean) to anon;

grant execute on function array_to_sparsevec(double precision[], integer, boolean) to authenticated;

grant execute on function array_to_sparsevec(double precision[], integer, boolean) to service_role;

create function array_to_sparsevec(numeric[], integer, boolean) returns sparsevec
    immutable
    strict
    parallel safe
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function array_to_sparsevec(numeric[], integer, boolean) owner to supabase_admin;

grant execute on function array_to_sparsevec(numeric[], integer, boolean) to postgres;

grant execute on function array_to_sparsevec(numeric[], integer, boolean) to anon;

grant execute on function array_to_sparsevec(numeric[], integer, boolean) to authenticated;

grant execute on function array_to_sparsevec(numeric[], integer, boolean) to service_role;

create function match_documents(query_embedding vector, match_count integer DEFAULT NULL::integer, filter jsonb DEFAULT '{}'::jsonb)
    returns TABLE(id bigint, content text, metadata jsonb, similarity double precision)
    language plpgsql
as
$$
#variable_conflict use_column
begin
  return query
  select
    id,
    content,
    metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where metadata @> filter
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;

alter function match_documents(vector, integer, jsonb) owner to postgres;

grant execute on function match_documents(vector, integer, jsonb) to anon;

grant execute on function match_documents(vector, integer, jsonb) to authenticated;

grant execute on function match_documents(vector, integer, jsonb) to service_role;

create function match_documents384(query_embedding vector, match_count integer DEFAULT NULL::integer, filter jsonb DEFAULT '{}'::jsonb)
    returns TABLE(id bigint, content text, metadata jsonb, similarity double precision)
    language plpgsql
as
$$
#variable_conflict use_column
begin
  return query
  select
    id,
    content,
    metadata,
    1 - (documents384.embedding <=> query_embedding) as similarity
  from documents384
  where metadata @> filter
  order by documents384.embedding <=> query_embedding
  limit match_count;
end;
$$;

alter function match_documents384(vector, integer, jsonb) owner to postgres;

grant execute on function match_documents384(vector, integer, jsonb) to anon;

grant execute on function match_documents384(vector, integer, jsonb) to authenticated;

grant execute on function match_documents384(vector, integer, jsonb) to service_role;

create function find_similar_documents(query_embedding vector, similarity_threshold double precision, max_results integer)
    returns TABLE(id uuid, file_url text, content text, similarity double precision)
    language plpgsql
as
$$
BEGIN
    RETURN QUERY
        SELECT
            fv.id,
            fv.file_url,
            fv.content,
            1 - (fv.embedding <=> query_embedding) AS similarity
        FROM
            chunk_vector fv
        WHERE
            1 - (fv.embedding <=> query_embedding) > similarity_threshold
        ORDER BY
            fv.embedding <=> query_embedding
        LIMIT max_results;
END;
$$;

alter function find_similar_documents(vector, double precision, integer) owner to postgres;

grant execute on function find_similar_documents(vector, double precision, integer) to anon;

grant execute on function find_similar_documents(vector, double precision, integer) to authenticated;

grant execute on function find_similar_documents(vector, double precision, integer) to service_role;

create function update_updated_at() returns trigger
    language plpgsql
as
$$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

alter function update_updated_at() owner to postgres;

create trigger trg_link_type_updated_at
    before update
    on link_type
    for each row
execute procedure update_updated_at();

create trigger trg_link_updated_at
    before update
    on link
    for each row
execute procedure update_updated_at();

create trigger trg_agent_script_updated_at
    before update
    on agent_script
    for each row
execute procedure update_updated_at();

create trigger trg_tag_updated_at
    before update
    on tag
    for each row
execute procedure update_updated_at();

grant execute on function update_updated_at() to anon;

grant execute on function update_updated_at() to authenticated;

grant execute on function update_updated_at() to service_role;

create operator <-> (procedure = l2_distance, leftarg = vector, rightarg = vector, commutator = <->);

alter operator <->(vector, vector) owner to supabase_admin;

create operator <#> (procedure = vector_negative_inner_product, leftarg = vector, rightarg = vector, commutator = <#>);

alter operator <#>(vector, vector) owner to supabase_admin;

create operator <=> (procedure = cosine_distance, leftarg = vector, rightarg = vector, commutator = <=>);

alter operator <=>(vector, vector) owner to supabase_admin;

create operator <+> (procedure = l1_distance, leftarg = vector, rightarg = vector, commutator = <+>);

alter operator <+>(vector, vector) owner to supabase_admin;

create operator + (procedure = vector_add, leftarg = vector, rightarg = vector, commutator = +);

alter operator +(vector, vector) owner to supabase_admin;

create operator - (procedure = vector_sub, leftarg = vector, rightarg = vector);

alter operator -(vector, vector) owner to supabase_admin;

create operator * (procedure = vector_mul, leftarg = vector, rightarg = vector, commutator = *);

alter operator *(vector, vector) owner to supabase_admin;

create operator || (procedure = vector_concat, leftarg = vector, rightarg = vector);

alter operator ||(vector, vector) owner to supabase_admin;

create operator <-> (procedure = l2_distance, leftarg = halfvec, rightarg = halfvec, commutator = <->);

alter operator <->(halfvec, halfvec) owner to supabase_admin;

create operator <#> (procedure = halfvec_negative_inner_product, leftarg = halfvec, rightarg = halfvec, commutator = <#>);

alter operator <#>(halfvec, halfvec) owner to supabase_admin;

create operator <=> (procedure = cosine_distance, leftarg = halfvec, rightarg = halfvec, commutator = <=>);

alter operator <=>(halfvec, halfvec) owner to supabase_admin;

create operator <+> (procedure = l1_distance, leftarg = halfvec, rightarg = halfvec, commutator = <+>);

alter operator <+>(halfvec, halfvec) owner to supabase_admin;

create operator + (procedure = halfvec_add, leftarg = halfvec, rightarg = halfvec, commutator = +);

alter operator +(halfvec, halfvec) owner to supabase_admin;

create operator - (procedure = halfvec_sub, leftarg = halfvec, rightarg = halfvec);

alter operator -(halfvec, halfvec) owner to supabase_admin;

create operator * (procedure = halfvec_mul, leftarg = halfvec, rightarg = halfvec, commutator = *);

alter operator *(halfvec, halfvec) owner to supabase_admin;

create operator || (procedure = halfvec_concat, leftarg = halfvec, rightarg = halfvec);

alter operator ||(halfvec, halfvec) owner to supabase_admin;

create operator <~> (procedure = hamming_distance, leftarg = bit, rightarg = bit, commutator = <~>);

alter operator <~>(bit, bit) owner to supabase_admin;

create operator <%> (procedure = jaccard_distance, leftarg = bit, rightarg = bit, commutator = <%>);

alter operator <%>(bit, bit) owner to supabase_admin;

create operator <-> (procedure = l2_distance, leftarg = sparsevec, rightarg = sparsevec, commutator = <->);

alter operator <->(sparsevec, sparsevec) owner to supabase_admin;

create operator <#> (procedure = sparsevec_negative_inner_product, leftarg = sparsevec, rightarg = sparsevec, commutator = <#>);

alter operator <#>(sparsevec, sparsevec) owner to supabase_admin;

create operator <=> (procedure = cosine_distance, leftarg = sparsevec, rightarg = sparsevec, commutator = <=>);

alter operator <=>(sparsevec, sparsevec) owner to supabase_admin;

create operator <+> (procedure = l1_distance, leftarg = sparsevec, rightarg = sparsevec, commutator = <+>);

alter operator <+>(sparsevec, sparsevec) owner to supabase_admin;

create aggregate avg(vector) (
    sfunc = vector_accum,
    stype = double precision[],
    finalfunc = vector_avg,
    combinefunc = vector_combine,
    initcond = '{0}',
    parallel = safe
    );

alter aggregate avg(vector) owner to supabase_admin;

grant execute on function avg(vector) to postgres;

grant execute on function avg(vector) to anon;

grant execute on function avg(vector) to authenticated;

grant execute on function avg(vector) to service_role;

create aggregate sum(vector) (
    sfunc = vector_add,
    stype = vector,
    combinefunc = vector_add,
    parallel = safe
    );

alter aggregate sum(vector) owner to supabase_admin;

grant execute on function sum(vector) to postgres;

grant execute on function sum(vector) to anon;

grant execute on function sum(vector) to authenticated;

grant execute on function sum(vector) to service_role;

create aggregate avg(halfvec) (
    sfunc = halfvec_accum,
    stype = double precision[],
    finalfunc = halfvec_avg,
    combinefunc = halfvec_combine,
    initcond = '{0}',
    parallel = safe
    );

alter aggregate avg(halfvec) owner to supabase_admin;

grant execute on function avg(halfvec) to postgres;

grant execute on function avg(halfvec) to anon;

grant execute on function avg(halfvec) to authenticated;

grant execute on function avg(halfvec) to service_role;

create aggregate sum(halfvec) (
    sfunc = halfvec_add,
    stype = halfvec,
    combinefunc = halfvec_add,
    parallel = safe
    );

alter aggregate sum(halfvec) owner to supabase_admin;

grant execute on function sum(halfvec) to postgres;

grant execute on function sum(halfvec) to anon;

grant execute on function sum(halfvec) to authenticated;

grant execute on function sum(halfvec) to service_role;

create operator family vector_ops using btree;

alter operator family vector_ops using btree add
    operator 4 >=(vector, vector),
    operator 1 <(vector, vector),
    operator 2 <=(vector, vector),
    operator 3 =(vector, vector),
    operator 5 >(vector, vector),
    function 1(vector, vector) vector_cmp(vector, vector);

alter operator family vector_ops using btree owner to supabase_admin;

create operator class vector_ops default for type vector using btree as
    operator 3 =(vector, vector),
    operator 1 <(vector, vector),
    operator 5 >(vector, vector),
    operator 2 <=(vector, vector),
    operator 4 >=(vector, vector),
    function 1(vector, vector) vector_cmp(vector, vector);

alter operator class vector_ops using btree owner to supabase_admin;

create operator family vector_l2_ops using ivfflat;

alter operator family vector_l2_ops using ivfflat add
    operator 1 <->(vector, vector) for order by float_ops,
    function 1(vector, vector) vector_l2_squared_distance(vector, vector),
    function 3(vector, vector) l2_distance(vector, vector);

alter operator family vector_l2_ops using ivfflat owner to supabase_admin;

create operator class vector_l2_ops default for type vector using ivfflat as
    operator 1 <->(vector, vector) for order by float_ops,
    function 1(vector, vector) vector_l2_squared_distance(vector, vector),
    function 3(vector, vector) l2_distance(vector, vector);

alter operator class vector_l2_ops using ivfflat owner to supabase_admin;

create operator family vector_ip_ops using ivfflat;

alter operator family vector_ip_ops using ivfflat add
    operator 1 <#>(vector, vector) for order by float_ops,
    function 4(vector, vector) vector_norm(vector),
    function 1(vector, vector) vector_negative_inner_product(vector, vector),
    function 3(vector, vector) vector_spherical_distance(vector, vector);

alter operator family vector_ip_ops using ivfflat owner to supabase_admin;

create operator class vector_ip_ops for type vector using ivfflat as
    operator 1 <#>(vector, vector) for order by float_ops,
    function 1(vector, vector) vector_negative_inner_product(vector, vector),
    function 4(vector, vector) vector_norm(vector),
    function 3(vector, vector) vector_spherical_distance(vector, vector);

alter operator class vector_ip_ops using ivfflat owner to supabase_admin;

create operator family vector_cosine_ops using ivfflat;

alter operator family vector_cosine_ops using ivfflat add
    operator 1 <=>(vector, vector) for order by float_ops,
    function 3(vector, vector) vector_spherical_distance(vector, vector),
    function 1(vector, vector) vector_negative_inner_product(vector, vector),
    function 2(vector, vector) vector_norm(vector),
    function 4(vector, vector) vector_norm(vector);

alter operator family vector_cosine_ops using ivfflat owner to supabase_admin;

create operator class vector_cosine_ops for type vector using ivfflat as
    operator 1 <=>(vector, vector) for order by float_ops,
    function 4(vector, vector) vector_norm(vector),
    function 1(vector, vector) vector_negative_inner_product(vector, vector),
    function 2(vector, vector) vector_norm(vector),
    function 3(vector, vector) vector_spherical_distance(vector, vector);

alter operator class vector_cosine_ops using ivfflat owner to supabase_admin;

create operator family vector_l2_ops using hnsw;

alter operator family vector_l2_ops using hnsw add
    operator 1 <->(vector, vector) for order by float_ops,
    function 1(vector, vector) vector_l2_squared_distance(vector, vector);

alter operator family vector_l2_ops using hnsw owner to supabase_admin;

create operator class vector_l2_ops for type vector using hnsw as
    operator 1 <->(vector, vector) for order by float_ops,
    function 1(vector, vector) vector_l2_squared_distance(vector, vector);

alter operator class vector_l2_ops using hnsw owner to supabase_admin;

create operator family vector_ip_ops using hnsw;

alter operator family vector_ip_ops using hnsw add
    operator 1 <#>(vector, vector) for order by float_ops,
    function 1(vector, vector) vector_negative_inner_product(vector, vector);

alter operator family vector_ip_ops using hnsw owner to supabase_admin;

create operator class vector_ip_ops for type vector using hnsw as
    operator 1 <#>(vector, vector) for order by float_ops,
    function 1(vector, vector) vector_negative_inner_product(vector, vector);

alter operator class vector_ip_ops using hnsw owner to supabase_admin;

create operator family vector_cosine_ops using hnsw;

alter operator family vector_cosine_ops using hnsw add
    operator 1 <=>(vector, vector) for order by float_ops,
    function 1(vector, vector) vector_negative_inner_product(vector, vector),
    function 2(vector, vector) vector_norm(vector);

alter operator family vector_cosine_ops using hnsw owner to supabase_admin;

create operator class vector_cosine_ops for type vector using hnsw as
    operator 1 <=>(vector, vector) for order by float_ops,
    function 1(vector, vector) vector_negative_inner_product(vector, vector),
    function 2(vector, vector) vector_norm(vector);

alter operator class vector_cosine_ops using hnsw owner to supabase_admin;

create operator family vector_l1_ops using hnsw;

alter operator family vector_l1_ops using hnsw add
    operator 1 <+>(vector, vector) for order by float_ops,
    function 1(vector, vector) l1_distance(vector, vector);

alter operator family vector_l1_ops using hnsw owner to supabase_admin;

create operator class vector_l1_ops for type vector using hnsw as
    operator 1 <+>(vector, vector) for order by float_ops,
    function 1(vector, vector) l1_distance(vector, vector);

alter operator class vector_l1_ops using hnsw owner to supabase_admin;

create operator family halfvec_ops using btree;

alter operator family halfvec_ops using btree add
    operator 3 =(halfvec, halfvec),
    operator 4 >=(halfvec, halfvec),
    operator 5 >(halfvec, halfvec),
    operator 2 <=(halfvec, halfvec),
    operator 1 <(halfvec, halfvec),
    function 1(halfvec, halfvec) halfvec_cmp(halfvec, halfvec);

alter operator family halfvec_ops using btree owner to supabase_admin;

create operator class halfvec_ops default for type halfvec using btree as
    operator 1 <(halfvec, halfvec),
    operator 4 >=(halfvec, halfvec),
    operator 5 >(halfvec, halfvec),
    operator 3 =(halfvec, halfvec),
    operator 2 <=(halfvec, halfvec),
    function 1(halfvec, halfvec) halfvec_cmp(halfvec, halfvec);

alter operator class halfvec_ops using btree owner to supabase_admin;

create operator family halfvec_l2_ops using ivfflat;

alter operator family halfvec_l2_ops using ivfflat add
    operator 1 <->(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) halfvec_l2_squared_distance(halfvec, halfvec),
    function 3(halfvec, halfvec) l2_distance(halfvec, halfvec),
    function 5(halfvec, halfvec) ivfflat_halfvec_support(internal);

alter operator family halfvec_l2_ops using ivfflat owner to supabase_admin;

create operator class halfvec_l2_ops for type halfvec using ivfflat as
    operator 1 <->(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) halfvec_l2_squared_distance(halfvec, halfvec),
    function 3(halfvec, halfvec) l2_distance(halfvec, halfvec),
    function 5(halfvec, halfvec) ivfflat_halfvec_support(internal);

alter operator class halfvec_l2_ops using ivfflat owner to supabase_admin;

create operator family halfvec_ip_ops using ivfflat;

alter operator family halfvec_ip_ops using ivfflat add
    operator 1 <#>(halfvec, halfvec) for order by float_ops,
    function 3(halfvec, halfvec) halfvec_spherical_distance(halfvec, halfvec),
    function 1(halfvec, halfvec) halfvec_negative_inner_product(halfvec, halfvec),
    function 4(halfvec, halfvec) l2_norm(halfvec),
    function 5(halfvec, halfvec) ivfflat_halfvec_support(internal);

alter operator family halfvec_ip_ops using ivfflat owner to supabase_admin;

create operator class halfvec_ip_ops for type halfvec using ivfflat as
    operator 1 <#>(halfvec, halfvec) for order by float_ops,
    function 4(halfvec, halfvec) l2_norm(halfvec),
    function 1(halfvec, halfvec) halfvec_negative_inner_product(halfvec, halfvec),
    function 5(halfvec, halfvec) ivfflat_halfvec_support(internal),
    function 3(halfvec, halfvec) halfvec_spherical_distance(halfvec, halfvec);

alter operator class halfvec_ip_ops using ivfflat owner to supabase_admin;

create operator family halfvec_cosine_ops using ivfflat;

alter operator family halfvec_cosine_ops using ivfflat add
    operator 1 <=>(halfvec, halfvec) for order by float_ops,
    function 2(halfvec, halfvec) l2_norm(halfvec),
    function 4(halfvec, halfvec) l2_norm(halfvec),
    function 1(halfvec, halfvec) halfvec_negative_inner_product(halfvec, halfvec),
    function 5(halfvec, halfvec) ivfflat_halfvec_support(internal),
    function 3(halfvec, halfvec) halfvec_spherical_distance(halfvec, halfvec);

alter operator family halfvec_cosine_ops using ivfflat owner to supabase_admin;

create operator class halfvec_cosine_ops for type halfvec using ivfflat as
    operator 1 <=>(halfvec, halfvec) for order by float_ops,
    function 4(halfvec, halfvec) l2_norm(halfvec),
    function 2(halfvec, halfvec) l2_norm(halfvec),
    function 5(halfvec, halfvec) ivfflat_halfvec_support(internal),
    function 3(halfvec, halfvec) halfvec_spherical_distance(halfvec, halfvec),
    function 1(halfvec, halfvec) halfvec_negative_inner_product(halfvec, halfvec);

alter operator class halfvec_cosine_ops using ivfflat owner to supabase_admin;

create operator family halfvec_l2_ops using hnsw;

alter operator family halfvec_l2_ops using hnsw add
    operator 1 <->(halfvec, halfvec) for order by float_ops,
    function 3(halfvec, halfvec) hnsw_halfvec_support(internal),
    function 1(halfvec, halfvec) halfvec_l2_squared_distance(halfvec, halfvec);

alter operator family halfvec_l2_ops using hnsw owner to supabase_admin;

create operator class halfvec_l2_ops for type halfvec using hnsw as
    operator 1 <->(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) halfvec_l2_squared_distance(halfvec, halfvec),
    function 3(halfvec, halfvec) hnsw_halfvec_support(internal);

alter operator class halfvec_l2_ops using hnsw owner to supabase_admin;

create operator family halfvec_ip_ops using hnsw;

alter operator family halfvec_ip_ops using hnsw add
    operator 1 <#>(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) halfvec_negative_inner_product(halfvec, halfvec),
    function 3(halfvec, halfvec) hnsw_halfvec_support(internal);

alter operator family halfvec_ip_ops using hnsw owner to supabase_admin;

create operator class halfvec_ip_ops for type halfvec using hnsw as
    operator 1 <#>(halfvec, halfvec) for order by float_ops,
    function 3(halfvec, halfvec) hnsw_halfvec_support(internal),
    function 1(halfvec, halfvec) halfvec_negative_inner_product(halfvec, halfvec);

alter operator class halfvec_ip_ops using hnsw owner to supabase_admin;

create operator family halfvec_cosine_ops using hnsw;

alter operator family halfvec_cosine_ops using hnsw add
    operator 1 <=>(halfvec, halfvec) for order by float_ops,
    function 3(halfvec, halfvec) hnsw_halfvec_support(internal),
    function 2(halfvec, halfvec) l2_norm(halfvec),
    function 1(halfvec, halfvec) halfvec_negative_inner_product(halfvec, halfvec);

alter operator family halfvec_cosine_ops using hnsw owner to supabase_admin;

create operator class halfvec_cosine_ops for type halfvec using hnsw as
    operator 1 <=>(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) halfvec_negative_inner_product(halfvec, halfvec),
    function 2(halfvec, halfvec) l2_norm(halfvec),
    function 3(halfvec, halfvec) hnsw_halfvec_support(internal);

alter operator class halfvec_cosine_ops using hnsw owner to supabase_admin;

create operator family halfvec_l1_ops using hnsw;

alter operator family halfvec_l1_ops using hnsw add
    operator 1 <+>(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) l1_distance(halfvec, halfvec),
    function 3(halfvec, halfvec) hnsw_halfvec_support(internal);

alter operator family halfvec_l1_ops using hnsw owner to supabase_admin;

create operator class halfvec_l1_ops for type halfvec using hnsw as
    operator 1 <+>(halfvec, halfvec) for order by float_ops,
    function 3(halfvec, halfvec) hnsw_halfvec_support(internal),
    function 1(halfvec, halfvec) l1_distance(halfvec, halfvec);

alter operator class halfvec_l1_ops using hnsw owner to supabase_admin;

create operator family bit_hamming_ops using ivfflat;

alter operator family bit_hamming_ops using ivfflat add
    operator 1 <~>(bit, bit) for order by float_ops,
    function 1(bit, bit) hamming_distance(bit, bit),
    function 5(bit, bit) ivfflat_bit_support(internal),
    function 3(bit, bit) hamming_distance(bit, bit);

alter operator family bit_hamming_ops using ivfflat owner to supabase_admin;

create operator class bit_hamming_ops for type bit using ivfflat as
    operator 1 <~>(bit, bit) for order by float_ops,
    function 5(bit, bit) ivfflat_bit_support(internal),
    function 3(bit, bit) hamming_distance(bit, bit),
    function 1(bit, bit) hamming_distance(bit, bit);

alter operator class bit_hamming_ops using ivfflat owner to supabase_admin;

create operator family bit_hamming_ops using hnsw;

alter operator family bit_hamming_ops using hnsw add
    operator 1 <~>(bit, bit) for order by float_ops,
    function 1(bit, bit) hamming_distance(bit, bit),
    function 3(bit, bit) hnsw_bit_support(internal);

alter operator family bit_hamming_ops using hnsw owner to supabase_admin;

create operator class bit_hamming_ops for type bit using hnsw as
    operator 1 <~>(bit, bit) for order by float_ops,
    function 1(bit, bit) hamming_distance(bit, bit),
    function 3(bit, bit) hnsw_bit_support(internal);

alter operator class bit_hamming_ops using hnsw owner to supabase_admin;

create operator family bit_jaccard_ops using hnsw;

alter operator family bit_jaccard_ops using hnsw add
    operator 1 <%>(bit, bit) for order by float_ops,
    function 1(bit, bit) jaccard_distance(bit, bit),
    function 3(bit, bit) hnsw_bit_support(internal);

alter operator family bit_jaccard_ops using hnsw owner to supabase_admin;

create operator class bit_jaccard_ops for type bit using hnsw as
    operator 1 <%>(bit, bit) for order by float_ops,
    function 1(bit, bit) jaccard_distance(bit, bit),
    function 3(bit, bit) hnsw_bit_support(internal);

alter operator class bit_jaccard_ops using hnsw owner to supabase_admin;

create operator family sparsevec_ops using btree;

alter operator family sparsevec_ops using btree add
    operator 4 >=(sparsevec, sparsevec),
    operator 5 >(sparsevec, sparsevec),
    operator 1 <(sparsevec, sparsevec),
    operator 3 =(sparsevec, sparsevec),
    operator 2 <=(sparsevec, sparsevec),
    function 1(sparsevec, sparsevec) sparsevec_cmp(sparsevec, sparsevec);

alter operator family sparsevec_ops using btree owner to supabase_admin;

create operator class sparsevec_ops default for type sparsevec using btree as
    operator 3 =(sparsevec, sparsevec),
    operator 4 >=(sparsevec, sparsevec),
    operator 5 >(sparsevec, sparsevec),
    operator 2 <=(sparsevec, sparsevec),
    operator 1 <(sparsevec, sparsevec),
    function 1(sparsevec, sparsevec) sparsevec_cmp(sparsevec, sparsevec);

alter operator class sparsevec_ops using btree owner to supabase_admin;

create operator family sparsevec_l2_ops using hnsw;

alter operator family sparsevec_l2_ops using hnsw add
    operator 1 <->(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) sparsevec_l2_squared_distance(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) hnsw_sparsevec_support(internal);

alter operator family sparsevec_l2_ops using hnsw owner to supabase_admin;

create operator class sparsevec_l2_ops for type sparsevec using hnsw as
    operator 1 <->(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) sparsevec_l2_squared_distance(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) hnsw_sparsevec_support(internal);

alter operator class sparsevec_l2_ops using hnsw owner to supabase_admin;

create operator family sparsevec_ip_ops using hnsw;

alter operator family sparsevec_ip_ops using hnsw add
    operator 1 <#>(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) sparsevec_negative_inner_product(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) hnsw_sparsevec_support(internal);

alter operator family sparsevec_ip_ops using hnsw owner to supabase_admin;

create operator class sparsevec_ip_ops for type sparsevec using hnsw as
    operator 1 <#>(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) sparsevec_negative_inner_product(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) hnsw_sparsevec_support(internal);

alter operator class sparsevec_ip_ops using hnsw owner to supabase_admin;

create operator family sparsevec_cosine_ops using hnsw;

alter operator family sparsevec_cosine_ops using hnsw add
    operator 1 <=>(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) sparsevec_negative_inner_product(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) hnsw_sparsevec_support(internal),
    function 2(sparsevec, sparsevec) l2_norm(sparsevec);

alter operator family sparsevec_cosine_ops using hnsw owner to supabase_admin;

create operator class sparsevec_cosine_ops for type sparsevec using hnsw as
    operator 1 <=>(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) sparsevec_negative_inner_product(sparsevec, sparsevec),
    function 2(sparsevec, sparsevec) l2_norm(sparsevec),
    function 3(sparsevec, sparsevec) hnsw_sparsevec_support(internal);

alter operator class sparsevec_cosine_ops using hnsw owner to supabase_admin;

create operator family sparsevec_l1_ops using hnsw;

alter operator family sparsevec_l1_ops using hnsw add
    operator 1 <+>(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) l1_distance(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) hnsw_sparsevec_support(internal);

alter operator family sparsevec_l1_ops using hnsw owner to supabase_admin;

create operator class sparsevec_l1_ops for type sparsevec using hnsw as
    operator 1 <+>(sparsevec, sparsevec) for order by float_ops,
    function 3(sparsevec, sparsevec) hnsw_sparsevec_support(internal),
    function 1(sparsevec, sparsevec) l1_distance(sparsevec, sparsevec);

alter operator class sparsevec_l1_ops using hnsw owner to supabase_admin;

-- Cyclic dependencies found

create operator <> (procedure = halfvec_ne, leftarg = halfvec, rightarg = halfvec, commutator = <>, negator = =, join = eqjoinsel, restrict = eqsel);

alter operator <>(halfvec, halfvec) owner to supabase_admin;

create operator = (procedure = halfvec_eq, leftarg = halfvec, rightarg = halfvec, commutator = =, negator = <>, join = eqjoinsel, restrict = eqsel);

alter operator =(halfvec, halfvec) owner to supabase_admin;

-- Cyclic dependencies found

create operator <> (procedure = sparsevec_ne, leftarg = sparsevec, rightarg = sparsevec, commutator = <>, negator = =, join = eqjoinsel, restrict = eqsel);

alter operator <>(sparsevec, sparsevec) owner to supabase_admin;

create operator = (procedure = sparsevec_eq, leftarg = sparsevec, rightarg = sparsevec, commutator = =, negator = <>, join = eqjoinsel, restrict = eqsel);

alter operator =(sparsevec, sparsevec) owner to supabase_admin;

-- Cyclic dependencies found

create operator <> (procedure = vector_ne, leftarg = vector, rightarg = vector, commutator = <>, negator = =, join = eqjoinsel, restrict = eqsel);

alter operator <>(vector, vector) owner to supabase_admin;

create operator = (procedure = vector_eq, leftarg = vector, rightarg = vector, commutator = =, negator = <>, join = eqjoinsel, restrict = eqsel);

alter operator =(vector, vector) owner to supabase_admin;

-- Cyclic dependencies found

create operator < (procedure = halfvec_lt, leftarg = halfvec, rightarg = halfvec, commutator = >, negator = >=, join = scalarltjoinsel, restrict = scalarltsel);

alter operator <(halfvec, halfvec) owner to supabase_admin;

-- Cyclic dependencies found

create operator > (procedure = halfvec_gt, leftarg = halfvec, rightarg = halfvec, commutator = <, negator = <=, join = scalargtjoinsel, restrict = scalargtsel);

alter operator >(halfvec, halfvec) owner to supabase_admin;

-- Cyclic dependencies found

create operator <= (procedure = halfvec_le, leftarg = halfvec, rightarg = halfvec, commutator = >=, negator = >, join = scalarlejoinsel, restrict = scalarlesel);

alter operator <=(halfvec, halfvec) owner to supabase_admin;

create operator >= (procedure = halfvec_ge, leftarg = halfvec, rightarg = halfvec, commutator = <=, negator = <, join = scalargejoinsel, restrict = scalargesel);

alter operator >=(halfvec, halfvec) owner to supabase_admin;

-- Cyclic dependencies found

create operator < (procedure = sparsevec_lt, leftarg = sparsevec, rightarg = sparsevec, commutator = >, negator = >=, join = scalarltjoinsel, restrict = scalarltsel);

alter operator <(sparsevec, sparsevec) owner to supabase_admin;

-- Cyclic dependencies found

create operator > (procedure = sparsevec_gt, leftarg = sparsevec, rightarg = sparsevec, commutator = <, negator = <=, join = scalargtjoinsel, restrict = scalargtsel);

alter operator >(sparsevec, sparsevec) owner to supabase_admin;

-- Cyclic dependencies found

create operator <= (procedure = sparsevec_le, leftarg = sparsevec, rightarg = sparsevec, commutator = >=, negator = >, join = scalarlejoinsel, restrict = scalarlesel);

alter operator <=(sparsevec, sparsevec) owner to supabase_admin;

create operator >= (procedure = sparsevec_ge, leftarg = sparsevec, rightarg = sparsevec, commutator = <=, negator = <, join = scalargejoinsel, restrict = scalargesel);

alter operator >=(sparsevec, sparsevec) owner to supabase_admin;

-- Cyclic dependencies found

create operator < (procedure = vector_lt, leftarg = vector, rightarg = vector, commutator = >, negator = >=, join = scalarltjoinsel, restrict = scalarltsel);

alter operator <(vector, vector) owner to supabase_admin;

-- Cyclic dependencies found

create operator > (procedure = vector_gt, leftarg = vector, rightarg = vector, commutator = <, negator = <=, join = scalargtjoinsel, restrict = scalargtsel);

alter operator >(vector, vector) owner to supabase_admin;

-- Cyclic dependencies found

create operator <= (procedure = vector_le, leftarg = vector, rightarg = vector, commutator = >=, negator = >, join = scalarlejoinsel, restrict = scalarlesel);

alter operator <=(vector, vector) owner to supabase_admin;

create operator >= (procedure = vector_ge, leftarg = vector, rightarg = vector, commutator = <=, negator = <, join = scalargejoinsel, restrict = scalargesel);

alter operator >=(vector, vector) owner to supabase_admin;


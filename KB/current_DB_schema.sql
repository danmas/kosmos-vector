create database postgres
    with owner postgres;

grant connect, create, temporary on database postgres to dashboard_user;

-- Unknown how to generate base type type

alter type public.vector owner to supabase_admin;

-- Unknown how to generate base type type

alter type public.halfvec owner to supabase_admin;

-- Unknown how to generate base type type

alter type public.sparsevec owner to supabase_admin;

create table public.file_info
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

alter table public.file_info
    owner to postgres;

grant select, update, usage on sequence public.file_info_id_seq to anon;

grant select, update, usage on sequence public.file_info_id_seq to authenticated;

grant select, update, usage on sequence public.file_info_id_seq to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.file_info to anon;

grant delete, insert, references, select, trigger, truncate, update on public.file_info to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.file_info to service_role;

create table public.files
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

alter table public.files
    owner to postgres;

create table public.ai_item
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
        references public.files
            on delete cascade,
    constraint ai_item_full_name_context_code_pk
        unique (full_name, context_code)
);

comment on table public.ai_item is 'Основные элементы AI системы';

comment on column public.ai_item.full_name is 'Полное имя элемента';

comment on column public.ai_item.context_code is 'Код контекста элемента';

comment on constraint ai_item_full_name_context_code_pk on public.ai_item is 'Full_name + context_code';

alter table public.ai_item
    owner to postgres;

grant select, update, usage on sequence public.ai_item_id_seq to anon;

grant select, update, usage on sequence public.ai_item_id_seq to authenticated;

grant select, update, usage on sequence public.ai_item_id_seq to service_role;

create index idx_ai_item_context_code
    on public.ai_item (context_code);

create index idx_ai_item_full_name
    on public.ai_item (full_name);

grant delete, insert, references, select, trigger, truncate, update on public.ai_item to anon;

grant delete, insert, references, select, trigger, truncate, update on public.ai_item to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.ai_item to service_role;

create table public.chunk_vector
(
    id              uuid                     default gen_random_uuid() not null
        primary key,
    file_id         uuid                                               not null
        constraint file_vectors_file_id_fkey
            references public.files
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
            references public.chunk_vector
            on delete cascade,
    s_name          text,
    h_name          text,
    full_name       text,
    ai_item_id      integer
        constraint fk_file_vectors_ai_item
            references public.ai_item
            on delete set null,
    updated_at      timestamp with time zone default now()
);

comment on column public.chunk_vector.parent_chunk_id is 'ID родительского чанка (для чанков 1-го и 2-го уровней)';

comment on column public.chunk_vector.ai_item_id is 'Ссылка на элемент AI системы';

alter table public.chunk_vector
    owner to postgres;

create table public.chunks_info
(
    id          uuid      default gen_random_uuid() not null
        primary key,
    file_id     uuid                                not null
        references public.chunk_vector
            on delete cascade,
    chunk_count integer   default 0                 not null,
    created_at  timestamp default now()
);

alter table public.chunks_info
    owner to postgres;

grant delete, insert, references, select, trigger, truncate, update on public.chunks_info to anon;

grant delete, insert, references, select, trigger, truncate, update on public.chunks_info to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.chunks_info to service_role;

create index chunk_vector_created_at_index
    on public.chunk_vector (created_at desc);

create index idx_chunk_vector_ai_item_id
    on public.chunk_vector (ai_item_id);

create index idx_chunk_vector_embedding
    on public.chunk_vector using ivfflat (embedding public.vector_cosine_ops);

create index idx_chunk_vector_file_id
    on public.chunk_vector (file_id);

create index idx_chunk_vector_level
    on public.chunk_vector (level);

create index idx_chunk_vector_parent_chunk_id
    on public.chunk_vector (parent_chunk_id);

create index idx_chunk_vector_type
    on public.chunk_vector (type);

grant delete, insert, references, select, trigger, truncate, update on public.chunk_vector to anon;

grant delete, insert, references, select, trigger, truncate, update on public.chunk_vector to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.chunk_vector to service_role;

create index idx_files_context_code
    on public.files (context_code);

grant delete, insert, references, select, trigger, truncate, update on public.files to anon;

grant delete, insert, references, select, trigger, truncate, update on public.files to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.files to service_role;

create table test_1.file_vectors
(
    id               uuid                     default gen_random_uuid() not null
        primary key,
    file_url         text                                               not null
        constraint file_vectors_file_url_pk
            unique,
    embedding        vector(1536),
    created_at       timestamp                default now(),
    dt_file_modified timestamp with time zone default now()             not null,
    content          text
);

comment on column test_1.file_vectors.dt_file_modified is 'Когда изменился файл в файловой системе';

comment on column test_1.file_vectors.content is 'Текстовое содержимое документа для поиска';

alter table test_1.file_vectors
    owner to postgres;

create table test_1.chunks_info
(
    id          uuid      default gen_random_uuid() not null
        primary key,
    file_id     uuid                                not null
        references test_1.file_vectors
            on delete cascade,
    chunk_count integer   default 0                 not null,
    created_at  timestamp default now()
);

alter table test_1.chunks_info
    owner to postgres;

create unique index test_1_chunks_info_pkey
    on test_1.chunks_info (id);

create index file_vectors_embedding_idx
    on test_1.file_vectors using ivfflat (embedding);

create index idx_file_vectors_content
    on test_1.file_vectors using gin (to_tsvector('russian'::regconfig, content));

create table public.ai_comment
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

alter table public.ai_comment
    owner to postgres;

grant select, update, usage on sequence public.ai_comment_id_seq to anon;

grant select, update, usage on sequence public.ai_comment_id_seq to authenticated;

grant select, update, usage on sequence public.ai_comment_id_seq to service_role;

create index idx_ai_comment_context_full_name
    on public.ai_comment (context_code, full_name);

grant delete, insert, references, select, trigger, truncate, update on public.ai_comment to anon;

grant delete, insert, references, select, trigger, truncate, update on public.ai_comment to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.ai_comment to service_role;

create table public.link_type
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

alter table public.link_type
    owner to postgres;

grant select, update, usage on sequence public.link_type_id_seq to anon;

grant select, update, usage on sequence public.link_type_id_seq to authenticated;

grant select, update, usage on sequence public.link_type_id_seq to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.link_type to anon;

grant delete, insert, references, select, trigger, truncate, update on public.link_type to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.link_type to service_role;

create table public.link
(
    id                serial
        primary key,
    context_code      text    not null,
    source            text    not null,
    target            text    not null,
    link_type_id      integer not null
        references public.link_type,
    file_id           uuid,
    source_ai_item_id uuid,
    target_ai_item_id uuid,
    created_at        timestamp default CURRENT_TIMESTAMP,
    updated_at        timestamp default CURRENT_TIMESTAMP
);

alter table public.link
    owner to postgres;

grant select, update, usage on sequence public.link_id_seq to anon;

grant select, update, usage on sequence public.link_id_seq to authenticated;

grant select, update, usage on sequence public.link_id_seq to service_role;

create index idx_link_context_source
    on public.link (context_code, source);

create index idx_link_context_target
    on public.link (context_code, target);

create index idx_link_context_type
    on public.link (context_code, link_type_id);

create index idx_link_context_target_type
    on public.link (context_code, target, link_type_id);

create unique index idx_link_unique
    on public.link (context_code, source, target, link_type_id);

grant delete, insert, references, select, trigger, truncate, update on public.link to anon;

grant delete, insert, references, select, trigger, truncate, update on public.link to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.link to service_role;

create table public.agent_script
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

alter table public.agent_script
    owner to postgres;

grant select, update, usage on sequence public.agent_script_id_seq to anon;

grant select, update, usage on sequence public.agent_script_id_seq to authenticated;

grant select, update, usage on sequence public.agent_script_id_seq to service_role;

create unique index idx_agent_script_unique
    on public.agent_script (context_code, question);

create index idx_agent_script_question_fts
    on public.agent_script using gin (to_tsvector('russian'::regconfig, question));

create index idx_agent_script_question_embedding
    on public.agent_script using ivfflat (question_embedding public.vector_cosine_ops);

grant delete, insert, references, select, trigger, truncate, update on public.agent_script to anon;

grant delete, insert, references, select, trigger, truncate, update on public.agent_script to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.agent_script to service_role;

create table public.tag
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

alter table public.tag
    owner to postgres;

grant select, update, usage on sequence public.tag_id_seq to anon;

grant select, update, usage on sequence public.tag_id_seq to authenticated;

grant select, update, usage on sequence public.tag_id_seq to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.tag to anon;

grant delete, insert, references, select, trigger, truncate, update on public.tag to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.tag to service_role;

create table public.ai_item_tag
(
    ai_item_full_name    text    not null,
    ai_item_context_code text    not null,
    tag_id               integer not null
        references public.tag,
    created_at           timestamp with time zone default now(),
    primary key (ai_item_full_name, ai_item_context_code, tag_id),
    constraint fk_ai_item_tag_ai_item
        foreign key (ai_item_full_name, ai_item_context_code) references public.ai_item (full_name, context_code)
);

alter table public.ai_item_tag
    owner to postgres;

create index idx_ai_item_tag_ai_item_full_name_context
    on public.ai_item_tag (ai_item_full_name, ai_item_context_code);

create index idx_ai_item_tag_tag_id
    on public.ai_item_tag (tag_id);

grant delete, insert, references, select, trigger, truncate, update on public.ai_item_tag to anon;

grant delete, insert, references, select, trigger, truncate, update on public.ai_item_tag to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.ai_item_tag to service_role;

create function public.vector_in(cstring, oid, integer) returns vector
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

alter function public.vector_in(cstring, oid, integer) owner to supabase_admin;

grant execute on function public.vector_in(cstring, oid, integer) to postgres;

grant execute on function public.vector_in(cstring, oid, integer) to anon;

grant execute on function public.vector_in(cstring, oid, integer) to authenticated;

grant execute on function public.vector_in(cstring, oid, integer) to service_role;

create function public.vector_out(vector) returns cstring
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

alter function public.vector_out(vector) owner to supabase_admin;

grant execute on function public.vector_out(vector) to postgres;

grant execute on function public.vector_out(vector) to anon;

grant execute on function public.vector_out(vector) to authenticated;

grant execute on function public.vector_out(vector) to service_role;

create function public.vector_typmod_in(cstring[]) returns integer
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

alter function public.vector_typmod_in(cstring[]) owner to supabase_admin;

grant execute on function public.vector_typmod_in(cstring[]) to postgres;

grant execute on function public.vector_typmod_in(cstring[]) to anon;

grant execute on function public.vector_typmod_in(cstring[]) to authenticated;

grant execute on function public.vector_typmod_in(cstring[]) to service_role;

create function public.vector_recv(internal, oid, integer) returns vector
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

alter function public.vector_recv(internal, oid, integer) owner to supabase_admin;

grant execute on function public.vector_recv(internal, oid, integer) to postgres;

grant execute on function public.vector_recv(internal, oid, integer) to anon;

grant execute on function public.vector_recv(internal, oid, integer) to authenticated;

grant execute on function public.vector_recv(internal, oid, integer) to service_role;

create function public.vector_send(vector) returns bytea
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

alter function public.vector_send(vector) owner to supabase_admin;

grant execute on function public.vector_send(vector) to postgres;

grant execute on function public.vector_send(vector) to anon;

grant execute on function public.vector_send(vector) to authenticated;

grant execute on function public.vector_send(vector) to service_role;

create function public.l2_distance(vector, vector) returns double precision
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

alter function public.l2_distance(vector, vector) owner to supabase_admin;

grant execute on function public.l2_distance(vector, vector) to postgres;

grant execute on function public.l2_distance(vector, vector) to anon;

grant execute on function public.l2_distance(vector, vector) to authenticated;

grant execute on function public.l2_distance(vector, vector) to service_role;

create function public.inner_product(vector, vector) returns double precision
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

alter function public.inner_product(vector, vector) owner to supabase_admin;

grant execute on function public.inner_product(vector, vector) to postgres;

grant execute on function public.inner_product(vector, vector) to anon;

grant execute on function public.inner_product(vector, vector) to authenticated;

grant execute on function public.inner_product(vector, vector) to service_role;

create function public.cosine_distance(vector, vector) returns double precision
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

alter function public.cosine_distance(vector, vector) owner to supabase_admin;

grant execute on function public.cosine_distance(vector, vector) to postgres;

grant execute on function public.cosine_distance(vector, vector) to anon;

grant execute on function public.cosine_distance(vector, vector) to authenticated;

grant execute on function public.cosine_distance(vector, vector) to service_role;

create function public.l1_distance(vector, vector) returns double precision
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

alter function public.l1_distance(vector, vector) owner to supabase_admin;

grant execute on function public.l1_distance(vector, vector) to postgres;

grant execute on function public.l1_distance(vector, vector) to anon;

grant execute on function public.l1_distance(vector, vector) to authenticated;

grant execute on function public.l1_distance(vector, vector) to service_role;

create function public.vector_dims(vector) returns integer
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

alter function public.vector_dims(vector) owner to supabase_admin;

grant execute on function public.vector_dims(vector) to postgres;

grant execute on function public.vector_dims(vector) to anon;

grant execute on function public.vector_dims(vector) to authenticated;

grant execute on function public.vector_dims(vector) to service_role;

create function public.vector_norm(vector) returns double precision
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

alter function public.vector_norm(vector) owner to supabase_admin;

grant execute on function public.vector_norm(vector) to postgres;

grant execute on function public.vector_norm(vector) to anon;

grant execute on function public.vector_norm(vector) to authenticated;

grant execute on function public.vector_norm(vector) to service_role;

create function public.l2_normalize(vector) returns vector
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

alter function public.l2_normalize(vector) owner to supabase_admin;

grant execute on function public.l2_normalize(vector) to postgres;

grant execute on function public.l2_normalize(vector) to anon;

grant execute on function public.l2_normalize(vector) to authenticated;

grant execute on function public.l2_normalize(vector) to service_role;

create function public.binary_quantize(vector) returns bit
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

alter function public.binary_quantize(vector) owner to supabase_admin;

grant execute on function public.binary_quantize(vector) to postgres;

grant execute on function public.binary_quantize(vector) to anon;

grant execute on function public.binary_quantize(vector) to authenticated;

grant execute on function public.binary_quantize(vector) to service_role;

create function public.subvector(vector, integer, integer) returns vector
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

alter function public.subvector(vector, integer, integer) owner to supabase_admin;

grant execute on function public.subvector(vector, integer, integer) to postgres;

grant execute on function public.subvector(vector, integer, integer) to anon;

grant execute on function public.subvector(vector, integer, integer) to authenticated;

grant execute on function public.subvector(vector, integer, integer) to service_role;

create function public.vector_add(vector, vector) returns vector
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

alter function public.vector_add(vector, vector) owner to supabase_admin;

grant execute on function public.vector_add(vector, vector) to postgres;

grant execute on function public.vector_add(vector, vector) to anon;

grant execute on function public.vector_add(vector, vector) to authenticated;

grant execute on function public.vector_add(vector, vector) to service_role;

create function public.vector_sub(vector, vector) returns vector
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

alter function public.vector_sub(vector, vector) owner to supabase_admin;

grant execute on function public.vector_sub(vector, vector) to postgres;

grant execute on function public.vector_sub(vector, vector) to anon;

grant execute on function public.vector_sub(vector, vector) to authenticated;

grant execute on function public.vector_sub(vector, vector) to service_role;

create function public.vector_mul(vector, vector) returns vector
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

alter function public.vector_mul(vector, vector) owner to supabase_admin;

grant execute on function public.vector_mul(vector, vector) to postgres;

grant execute on function public.vector_mul(vector, vector) to anon;

grant execute on function public.vector_mul(vector, vector) to authenticated;

grant execute on function public.vector_mul(vector, vector) to service_role;

create function public.vector_concat(vector, vector) returns vector
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

alter function public.vector_concat(vector, vector) owner to supabase_admin;

grant execute on function public.vector_concat(vector, vector) to postgres;

grant execute on function public.vector_concat(vector, vector) to anon;

grant execute on function public.vector_concat(vector, vector) to authenticated;

grant execute on function public.vector_concat(vector, vector) to service_role;

create function public.vector_lt(vector, vector) returns boolean
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

alter function public.vector_lt(vector, vector) owner to supabase_admin;

grant execute on function public.vector_lt(vector, vector) to postgres;

grant execute on function public.vector_lt(vector, vector) to anon;

grant execute on function public.vector_lt(vector, vector) to authenticated;

grant execute on function public.vector_lt(vector, vector) to service_role;

create function public.vector_le(vector, vector) returns boolean
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

alter function public.vector_le(vector, vector) owner to supabase_admin;

grant execute on function public.vector_le(vector, vector) to postgres;

grant execute on function public.vector_le(vector, vector) to anon;

grant execute on function public.vector_le(vector, vector) to authenticated;

grant execute on function public.vector_le(vector, vector) to service_role;

create function public.vector_eq(vector, vector) returns boolean
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

alter function public.vector_eq(vector, vector) owner to supabase_admin;

grant execute on function public.vector_eq(vector, vector) to postgres;

grant execute on function public.vector_eq(vector, vector) to anon;

grant execute on function public.vector_eq(vector, vector) to authenticated;

grant execute on function public.vector_eq(vector, vector) to service_role;

create function public.vector_ne(vector, vector) returns boolean
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

alter function public.vector_ne(vector, vector) owner to supabase_admin;

grant execute on function public.vector_ne(vector, vector) to postgres;

grant execute on function public.vector_ne(vector, vector) to anon;

grant execute on function public.vector_ne(vector, vector) to authenticated;

grant execute on function public.vector_ne(vector, vector) to service_role;

create function public.vector_ge(vector, vector) returns boolean
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

alter function public.vector_ge(vector, vector) owner to supabase_admin;

grant execute on function public.vector_ge(vector, vector) to postgres;

grant execute on function public.vector_ge(vector, vector) to anon;

grant execute on function public.vector_ge(vector, vector) to authenticated;

grant execute on function public.vector_ge(vector, vector) to service_role;

create function public.vector_gt(vector, vector) returns boolean
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

alter function public.vector_gt(vector, vector) owner to supabase_admin;

grant execute on function public.vector_gt(vector, vector) to postgres;

grant execute on function public.vector_gt(vector, vector) to anon;

grant execute on function public.vector_gt(vector, vector) to authenticated;

grant execute on function public.vector_gt(vector, vector) to service_role;

create function public.vector_cmp(vector, vector) returns integer
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

alter function public.vector_cmp(vector, vector) owner to supabase_admin;

grant execute on function public.vector_cmp(vector, vector) to postgres;

grant execute on function public.vector_cmp(vector, vector) to anon;

grant execute on function public.vector_cmp(vector, vector) to authenticated;

grant execute on function public.vector_cmp(vector, vector) to service_role;

create function public.vector_l2_squared_distance(vector, vector) returns double precision
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

alter function public.vector_l2_squared_distance(vector, vector) owner to supabase_admin;

grant execute on function public.vector_l2_squared_distance(vector, vector) to postgres;

grant execute on function public.vector_l2_squared_distance(vector, vector) to anon;

grant execute on function public.vector_l2_squared_distance(vector, vector) to authenticated;

grant execute on function public.vector_l2_squared_distance(vector, vector) to service_role;

create function public.vector_negative_inner_product(vector, vector) returns double precision
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

alter function public.vector_negative_inner_product(vector, vector) owner to supabase_admin;

grant execute on function public.vector_negative_inner_product(vector, vector) to postgres;

grant execute on function public.vector_negative_inner_product(vector, vector) to anon;

grant execute on function public.vector_negative_inner_product(vector, vector) to authenticated;

grant execute on function public.vector_negative_inner_product(vector, vector) to service_role;

create function public.vector_spherical_distance(vector, vector) returns double precision
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

alter function public.vector_spherical_distance(vector, vector) owner to supabase_admin;

grant execute on function public.vector_spherical_distance(vector, vector) to postgres;

grant execute on function public.vector_spherical_distance(vector, vector) to anon;

grant execute on function public.vector_spherical_distance(vector, vector) to authenticated;

grant execute on function public.vector_spherical_distance(vector, vector) to service_role;

create function public.vector_accum(double precision[], vector) returns double precision[]
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

alter function public.vector_accum(double precision[], vector) owner to supabase_admin;

grant execute on function public.vector_accum(double precision[], vector) to postgres;

grant execute on function public.vector_accum(double precision[], vector) to anon;

grant execute on function public.vector_accum(double precision[], vector) to authenticated;

grant execute on function public.vector_accum(double precision[], vector) to service_role;

create function public.vector_avg(double precision[]) returns vector
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

alter function public.vector_avg(double precision[]) owner to supabase_admin;

grant execute on function public.vector_avg(double precision[]) to postgres;

grant execute on function public.vector_avg(double precision[]) to anon;

grant execute on function public.vector_avg(double precision[]) to authenticated;

grant execute on function public.vector_avg(double precision[]) to service_role;

create function public.vector_combine(double precision[], double precision[]) returns double precision[]
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

alter function public.vector_combine(double precision[], double precision[]) owner to supabase_admin;

grant execute on function public.vector_combine(double precision[], double precision[]) to postgres;

grant execute on function public.vector_combine(double precision[], double precision[]) to anon;

grant execute on function public.vector_combine(double precision[], double precision[]) to authenticated;

grant execute on function public.vector_combine(double precision[], double precision[]) to service_role;

create function public.vector(vector, integer, boolean) returns vector
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

alter function public.vector(vector, integer, boolean) owner to supabase_admin;

grant execute on function public.vector(vector, integer, boolean) to postgres;

grant execute on function public.vector(vector, integer, boolean) to anon;

grant execute on function public.vector(vector, integer, boolean) to authenticated;

grant execute on function public.vector(vector, integer, boolean) to service_role;

create function public.array_to_vector(integer[], integer, boolean) returns vector
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

alter function public.array_to_vector(integer[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_vector(integer[], integer, boolean) to postgres;

grant execute on function public.array_to_vector(integer[], integer, boolean) to anon;

grant execute on function public.array_to_vector(integer[], integer, boolean) to authenticated;

grant execute on function public.array_to_vector(integer[], integer, boolean) to service_role;

create function public.array_to_vector(real[], integer, boolean) returns vector
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

alter function public.array_to_vector(real[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_vector(real[], integer, boolean) to postgres;

grant execute on function public.array_to_vector(real[], integer, boolean) to anon;

grant execute on function public.array_to_vector(real[], integer, boolean) to authenticated;

grant execute on function public.array_to_vector(real[], integer, boolean) to service_role;

create function public.array_to_vector(double precision[], integer, boolean) returns vector
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

alter function public.array_to_vector(double precision[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_vector(double precision[], integer, boolean) to postgres;

grant execute on function public.array_to_vector(double precision[], integer, boolean) to anon;

grant execute on function public.array_to_vector(double precision[], integer, boolean) to authenticated;

grant execute on function public.array_to_vector(double precision[], integer, boolean) to service_role;

create function public.array_to_vector(numeric[], integer, boolean) returns vector
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

alter function public.array_to_vector(numeric[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_vector(numeric[], integer, boolean) to postgres;

grant execute on function public.array_to_vector(numeric[], integer, boolean) to anon;

grant execute on function public.array_to_vector(numeric[], integer, boolean) to authenticated;

grant execute on function public.array_to_vector(numeric[], integer, boolean) to service_role;

create function public.vector_to_float4(vector, integer, boolean) returns real[]
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

alter function public.vector_to_float4(vector, integer, boolean) owner to supabase_admin;

grant execute on function public.vector_to_float4(vector, integer, boolean) to postgres;

grant execute on function public.vector_to_float4(vector, integer, boolean) to anon;

grant execute on function public.vector_to_float4(vector, integer, boolean) to authenticated;

grant execute on function public.vector_to_float4(vector, integer, boolean) to service_role;

create function public.ivfflathandler(internal) returns index_am_handler
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function public.ivfflathandler(internal) owner to supabase_admin;

grant execute on function public.ivfflathandler(internal) to postgres;

grant execute on function public.ivfflathandler(internal) to anon;

grant execute on function public.ivfflathandler(internal) to authenticated;

grant execute on function public.ivfflathandler(internal) to service_role;

create function public.hnswhandler(internal) returns index_am_handler
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function public.hnswhandler(internal) owner to supabase_admin;

grant execute on function public.hnswhandler(internal) to postgres;

grant execute on function public.hnswhandler(internal) to anon;

grant execute on function public.hnswhandler(internal) to authenticated;

grant execute on function public.hnswhandler(internal) to service_role;

create function public.ivfflat_halfvec_support(internal) returns internal
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function public.ivfflat_halfvec_support(internal) owner to supabase_admin;

grant execute on function public.ivfflat_halfvec_support(internal) to postgres;

grant execute on function public.ivfflat_halfvec_support(internal) to anon;

grant execute on function public.ivfflat_halfvec_support(internal) to authenticated;

grant execute on function public.ivfflat_halfvec_support(internal) to service_role;

create function public.ivfflat_bit_support(internal) returns internal
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function public.ivfflat_bit_support(internal) owner to supabase_admin;

grant execute on function public.ivfflat_bit_support(internal) to postgres;

grant execute on function public.ivfflat_bit_support(internal) to anon;

grant execute on function public.ivfflat_bit_support(internal) to authenticated;

grant execute on function public.ivfflat_bit_support(internal) to service_role;

create function public.hnsw_halfvec_support(internal) returns internal
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function public.hnsw_halfvec_support(internal) owner to supabase_admin;

grant execute on function public.hnsw_halfvec_support(internal) to postgres;

grant execute on function public.hnsw_halfvec_support(internal) to anon;

grant execute on function public.hnsw_halfvec_support(internal) to authenticated;

grant execute on function public.hnsw_halfvec_support(internal) to service_role;

create function public.hnsw_bit_support(internal) returns internal
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function public.hnsw_bit_support(internal) owner to supabase_admin;

grant execute on function public.hnsw_bit_support(internal) to postgres;

grant execute on function public.hnsw_bit_support(internal) to anon;

grant execute on function public.hnsw_bit_support(internal) to authenticated;

grant execute on function public.hnsw_bit_support(internal) to service_role;

create function public.hnsw_sparsevec_support(internal) returns internal
    language c
as
$$
begin
-- missing source code
end;
$$;

alter function public.hnsw_sparsevec_support(internal) owner to supabase_admin;

grant execute on function public.hnsw_sparsevec_support(internal) to postgres;

grant execute on function public.hnsw_sparsevec_support(internal) to anon;

grant execute on function public.hnsw_sparsevec_support(internal) to authenticated;

grant execute on function public.hnsw_sparsevec_support(internal) to service_role;

create function public.halfvec_in(cstring, oid, integer) returns halfvec
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

alter function public.halfvec_in(cstring, oid, integer) owner to supabase_admin;

grant execute on function public.halfvec_in(cstring, oid, integer) to postgres;

grant execute on function public.halfvec_in(cstring, oid, integer) to anon;

grant execute on function public.halfvec_in(cstring, oid, integer) to authenticated;

grant execute on function public.halfvec_in(cstring, oid, integer) to service_role;

create function public.halfvec_out(halfvec) returns cstring
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

alter function public.halfvec_out(halfvec) owner to supabase_admin;

grant execute on function public.halfvec_out(halfvec) to postgres;

grant execute on function public.halfvec_out(halfvec) to anon;

grant execute on function public.halfvec_out(halfvec) to authenticated;

grant execute on function public.halfvec_out(halfvec) to service_role;

create function public.halfvec_typmod_in(cstring[]) returns integer
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

alter function public.halfvec_typmod_in(cstring[]) owner to supabase_admin;

grant execute on function public.halfvec_typmod_in(cstring[]) to postgres;

grant execute on function public.halfvec_typmod_in(cstring[]) to anon;

grant execute on function public.halfvec_typmod_in(cstring[]) to authenticated;

grant execute on function public.halfvec_typmod_in(cstring[]) to service_role;

create function public.halfvec_recv(internal, oid, integer) returns halfvec
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

alter function public.halfvec_recv(internal, oid, integer) owner to supabase_admin;

grant execute on function public.halfvec_recv(internal, oid, integer) to postgres;

grant execute on function public.halfvec_recv(internal, oid, integer) to anon;

grant execute on function public.halfvec_recv(internal, oid, integer) to authenticated;

grant execute on function public.halfvec_recv(internal, oid, integer) to service_role;

create function public.halfvec_send(halfvec) returns bytea
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

alter function public.halfvec_send(halfvec) owner to supabase_admin;

grant execute on function public.halfvec_send(halfvec) to postgres;

grant execute on function public.halfvec_send(halfvec) to anon;

grant execute on function public.halfvec_send(halfvec) to authenticated;

grant execute on function public.halfvec_send(halfvec) to service_role;

create function public.l2_distance(halfvec, halfvec) returns double precision
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

alter function public.l2_distance(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.l2_distance(halfvec, halfvec) to postgres;

grant execute on function public.l2_distance(halfvec, halfvec) to anon;

grant execute on function public.l2_distance(halfvec, halfvec) to authenticated;

grant execute on function public.l2_distance(halfvec, halfvec) to service_role;

create function public.inner_product(halfvec, halfvec) returns double precision
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

alter function public.inner_product(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.inner_product(halfvec, halfvec) to postgres;

grant execute on function public.inner_product(halfvec, halfvec) to anon;

grant execute on function public.inner_product(halfvec, halfvec) to authenticated;

grant execute on function public.inner_product(halfvec, halfvec) to service_role;

create function public.cosine_distance(halfvec, halfvec) returns double precision
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

alter function public.cosine_distance(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.cosine_distance(halfvec, halfvec) to postgres;

grant execute on function public.cosine_distance(halfvec, halfvec) to anon;

grant execute on function public.cosine_distance(halfvec, halfvec) to authenticated;

grant execute on function public.cosine_distance(halfvec, halfvec) to service_role;

create function public.l1_distance(halfvec, halfvec) returns double precision
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

alter function public.l1_distance(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.l1_distance(halfvec, halfvec) to postgres;

grant execute on function public.l1_distance(halfvec, halfvec) to anon;

grant execute on function public.l1_distance(halfvec, halfvec) to authenticated;

grant execute on function public.l1_distance(halfvec, halfvec) to service_role;

create function public.vector_dims(halfvec) returns integer
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

alter function public.vector_dims(halfvec) owner to supabase_admin;

grant execute on function public.vector_dims(halfvec) to postgres;

grant execute on function public.vector_dims(halfvec) to anon;

grant execute on function public.vector_dims(halfvec) to authenticated;

grant execute on function public.vector_dims(halfvec) to service_role;

create function public.l2_norm(halfvec) returns double precision
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

alter function public.l2_norm(halfvec) owner to supabase_admin;

grant execute on function public.l2_norm(halfvec) to postgres;

grant execute on function public.l2_norm(halfvec) to anon;

grant execute on function public.l2_norm(halfvec) to authenticated;

grant execute on function public.l2_norm(halfvec) to service_role;

create function public.l2_normalize(halfvec) returns halfvec
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

alter function public.l2_normalize(halfvec) owner to supabase_admin;

grant execute on function public.l2_normalize(halfvec) to postgres;

grant execute on function public.l2_normalize(halfvec) to anon;

grant execute on function public.l2_normalize(halfvec) to authenticated;

grant execute on function public.l2_normalize(halfvec) to service_role;

create function public.binary_quantize(halfvec) returns bit
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

alter function public.binary_quantize(halfvec) owner to supabase_admin;

grant execute on function public.binary_quantize(halfvec) to postgres;

grant execute on function public.binary_quantize(halfvec) to anon;

grant execute on function public.binary_quantize(halfvec) to authenticated;

grant execute on function public.binary_quantize(halfvec) to service_role;

create function public.subvector(halfvec, integer, integer) returns halfvec
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

alter function public.subvector(halfvec, integer, integer) owner to supabase_admin;

grant execute on function public.subvector(halfvec, integer, integer) to postgres;

grant execute on function public.subvector(halfvec, integer, integer) to anon;

grant execute on function public.subvector(halfvec, integer, integer) to authenticated;

grant execute on function public.subvector(halfvec, integer, integer) to service_role;

create function public.halfvec_add(halfvec, halfvec) returns halfvec
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

alter function public.halfvec_add(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_add(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_add(halfvec, halfvec) to anon;

grant execute on function public.halfvec_add(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_add(halfvec, halfvec) to service_role;

create function public.halfvec_sub(halfvec, halfvec) returns halfvec
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

alter function public.halfvec_sub(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_sub(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_sub(halfvec, halfvec) to anon;

grant execute on function public.halfvec_sub(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_sub(halfvec, halfvec) to service_role;

create function public.halfvec_mul(halfvec, halfvec) returns halfvec
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

alter function public.halfvec_mul(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_mul(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_mul(halfvec, halfvec) to anon;

grant execute on function public.halfvec_mul(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_mul(halfvec, halfvec) to service_role;

create function public.halfvec_concat(halfvec, halfvec) returns halfvec
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

alter function public.halfvec_concat(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_concat(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_concat(halfvec, halfvec) to anon;

grant execute on function public.halfvec_concat(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_concat(halfvec, halfvec) to service_role;

create function public.halfvec_lt(halfvec, halfvec) returns boolean
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

alter function public.halfvec_lt(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_lt(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_lt(halfvec, halfvec) to anon;

grant execute on function public.halfvec_lt(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_lt(halfvec, halfvec) to service_role;

create function public.halfvec_le(halfvec, halfvec) returns boolean
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

alter function public.halfvec_le(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_le(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_le(halfvec, halfvec) to anon;

grant execute on function public.halfvec_le(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_le(halfvec, halfvec) to service_role;

create function public.halfvec_eq(halfvec, halfvec) returns boolean
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

alter function public.halfvec_eq(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_eq(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_eq(halfvec, halfvec) to anon;

grant execute on function public.halfvec_eq(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_eq(halfvec, halfvec) to service_role;

create function public.halfvec_ne(halfvec, halfvec) returns boolean
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

alter function public.halfvec_ne(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_ne(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_ne(halfvec, halfvec) to anon;

grant execute on function public.halfvec_ne(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_ne(halfvec, halfvec) to service_role;

create function public.halfvec_ge(halfvec, halfvec) returns boolean
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

alter function public.halfvec_ge(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_ge(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_ge(halfvec, halfvec) to anon;

grant execute on function public.halfvec_ge(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_ge(halfvec, halfvec) to service_role;

create function public.halfvec_gt(halfvec, halfvec) returns boolean
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

alter function public.halfvec_gt(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_gt(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_gt(halfvec, halfvec) to anon;

grant execute on function public.halfvec_gt(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_gt(halfvec, halfvec) to service_role;

create function public.halfvec_cmp(halfvec, halfvec) returns integer
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

alter function public.halfvec_cmp(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_cmp(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_cmp(halfvec, halfvec) to anon;

grant execute on function public.halfvec_cmp(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_cmp(halfvec, halfvec) to service_role;

create function public.halfvec_l2_squared_distance(halfvec, halfvec) returns double precision
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

alter function public.halfvec_l2_squared_distance(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_l2_squared_distance(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_l2_squared_distance(halfvec, halfvec) to anon;

grant execute on function public.halfvec_l2_squared_distance(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_l2_squared_distance(halfvec, halfvec) to service_role;

create function public.halfvec_negative_inner_product(halfvec, halfvec) returns double precision
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

alter function public.halfvec_negative_inner_product(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_negative_inner_product(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_negative_inner_product(halfvec, halfvec) to anon;

grant execute on function public.halfvec_negative_inner_product(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_negative_inner_product(halfvec, halfvec) to service_role;

create function public.halfvec_spherical_distance(halfvec, halfvec) returns double precision
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

alter function public.halfvec_spherical_distance(halfvec, halfvec) owner to supabase_admin;

grant execute on function public.halfvec_spherical_distance(halfvec, halfvec) to postgres;

grant execute on function public.halfvec_spherical_distance(halfvec, halfvec) to anon;

grant execute on function public.halfvec_spherical_distance(halfvec, halfvec) to authenticated;

grant execute on function public.halfvec_spherical_distance(halfvec, halfvec) to service_role;

create function public.halfvec_accum(double precision[], halfvec) returns double precision[]
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

alter function public.halfvec_accum(double precision[], halfvec) owner to supabase_admin;

grant execute on function public.halfvec_accum(double precision[], halfvec) to postgres;

grant execute on function public.halfvec_accum(double precision[], halfvec) to anon;

grant execute on function public.halfvec_accum(double precision[], halfvec) to authenticated;

grant execute on function public.halfvec_accum(double precision[], halfvec) to service_role;

create function public.halfvec_avg(double precision[]) returns halfvec
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

alter function public.halfvec_avg(double precision[]) owner to supabase_admin;

grant execute on function public.halfvec_avg(double precision[]) to postgres;

grant execute on function public.halfvec_avg(double precision[]) to anon;

grant execute on function public.halfvec_avg(double precision[]) to authenticated;

grant execute on function public.halfvec_avg(double precision[]) to service_role;

create function public.halfvec_combine(double precision[], double precision[]) returns double precision[]
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

alter function public.halfvec_combine(double precision[], double precision[]) owner to supabase_admin;

grant execute on function public.halfvec_combine(double precision[], double precision[]) to postgres;

grant execute on function public.halfvec_combine(double precision[], double precision[]) to anon;

grant execute on function public.halfvec_combine(double precision[], double precision[]) to authenticated;

grant execute on function public.halfvec_combine(double precision[], double precision[]) to service_role;

create function public.halfvec(halfvec, integer, boolean) returns halfvec
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

alter function public.halfvec(halfvec, integer, boolean) owner to supabase_admin;

grant execute on function public.halfvec(halfvec, integer, boolean) to postgres;

grant execute on function public.halfvec(halfvec, integer, boolean) to anon;

grant execute on function public.halfvec(halfvec, integer, boolean) to authenticated;

grant execute on function public.halfvec(halfvec, integer, boolean) to service_role;

create function public.halfvec_to_vector(halfvec, integer, boolean) returns vector
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

alter function public.halfvec_to_vector(halfvec, integer, boolean) owner to supabase_admin;

grant execute on function public.halfvec_to_vector(halfvec, integer, boolean) to postgres;

grant execute on function public.halfvec_to_vector(halfvec, integer, boolean) to anon;

grant execute on function public.halfvec_to_vector(halfvec, integer, boolean) to authenticated;

grant execute on function public.halfvec_to_vector(halfvec, integer, boolean) to service_role;

create function public.vector_to_halfvec(vector, integer, boolean) returns halfvec
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

alter function public.vector_to_halfvec(vector, integer, boolean) owner to supabase_admin;

grant execute on function public.vector_to_halfvec(vector, integer, boolean) to postgres;

grant execute on function public.vector_to_halfvec(vector, integer, boolean) to anon;

grant execute on function public.vector_to_halfvec(vector, integer, boolean) to authenticated;

grant execute on function public.vector_to_halfvec(vector, integer, boolean) to service_role;

create function public.array_to_halfvec(integer[], integer, boolean) returns halfvec
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

alter function public.array_to_halfvec(integer[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_halfvec(integer[], integer, boolean) to postgres;

grant execute on function public.array_to_halfvec(integer[], integer, boolean) to anon;

grant execute on function public.array_to_halfvec(integer[], integer, boolean) to authenticated;

grant execute on function public.array_to_halfvec(integer[], integer, boolean) to service_role;

create function public.array_to_halfvec(real[], integer, boolean) returns halfvec
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

alter function public.array_to_halfvec(real[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_halfvec(real[], integer, boolean) to postgres;

grant execute on function public.array_to_halfvec(real[], integer, boolean) to anon;

grant execute on function public.array_to_halfvec(real[], integer, boolean) to authenticated;

grant execute on function public.array_to_halfvec(real[], integer, boolean) to service_role;

create function public.array_to_halfvec(double precision[], integer, boolean) returns halfvec
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

alter function public.array_to_halfvec(double precision[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_halfvec(double precision[], integer, boolean) to postgres;

grant execute on function public.array_to_halfvec(double precision[], integer, boolean) to anon;

grant execute on function public.array_to_halfvec(double precision[], integer, boolean) to authenticated;

grant execute on function public.array_to_halfvec(double precision[], integer, boolean) to service_role;

create function public.array_to_halfvec(numeric[], integer, boolean) returns halfvec
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

alter function public.array_to_halfvec(numeric[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_halfvec(numeric[], integer, boolean) to postgres;

grant execute on function public.array_to_halfvec(numeric[], integer, boolean) to anon;

grant execute on function public.array_to_halfvec(numeric[], integer, boolean) to authenticated;

grant execute on function public.array_to_halfvec(numeric[], integer, boolean) to service_role;

create function public.halfvec_to_float4(halfvec, integer, boolean) returns real[]
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

alter function public.halfvec_to_float4(halfvec, integer, boolean) owner to supabase_admin;

grant execute on function public.halfvec_to_float4(halfvec, integer, boolean) to postgres;

grant execute on function public.halfvec_to_float4(halfvec, integer, boolean) to anon;

grant execute on function public.halfvec_to_float4(halfvec, integer, boolean) to authenticated;

grant execute on function public.halfvec_to_float4(halfvec, integer, boolean) to service_role;

create function public.hamming_distance(bit, bit) returns double precision
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

alter function public.hamming_distance(bit, bit) owner to supabase_admin;

grant execute on function public.hamming_distance(bit, bit) to postgres;

grant execute on function public.hamming_distance(bit, bit) to anon;

grant execute on function public.hamming_distance(bit, bit) to authenticated;

grant execute on function public.hamming_distance(bit, bit) to service_role;

create function public.jaccard_distance(bit, bit) returns double precision
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

alter function public.jaccard_distance(bit, bit) owner to supabase_admin;

grant execute on function public.jaccard_distance(bit, bit) to postgres;

grant execute on function public.jaccard_distance(bit, bit) to anon;

grant execute on function public.jaccard_distance(bit, bit) to authenticated;

grant execute on function public.jaccard_distance(bit, bit) to service_role;

create function public.sparsevec_in(cstring, oid, integer) returns sparsevec
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

alter function public.sparsevec_in(cstring, oid, integer) owner to supabase_admin;

grant execute on function public.sparsevec_in(cstring, oid, integer) to postgres;

grant execute on function public.sparsevec_in(cstring, oid, integer) to anon;

grant execute on function public.sparsevec_in(cstring, oid, integer) to authenticated;

grant execute on function public.sparsevec_in(cstring, oid, integer) to service_role;

create function public.sparsevec_out(sparsevec) returns cstring
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

alter function public.sparsevec_out(sparsevec) owner to supabase_admin;

grant execute on function public.sparsevec_out(sparsevec) to postgres;

grant execute on function public.sparsevec_out(sparsevec) to anon;

grant execute on function public.sparsevec_out(sparsevec) to authenticated;

grant execute on function public.sparsevec_out(sparsevec) to service_role;

create function public.sparsevec_typmod_in(cstring[]) returns integer
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

alter function public.sparsevec_typmod_in(cstring[]) owner to supabase_admin;

grant execute on function public.sparsevec_typmod_in(cstring[]) to postgres;

grant execute on function public.sparsevec_typmod_in(cstring[]) to anon;

grant execute on function public.sparsevec_typmod_in(cstring[]) to authenticated;

grant execute on function public.sparsevec_typmod_in(cstring[]) to service_role;

create function public.sparsevec_recv(internal, oid, integer) returns sparsevec
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

alter function public.sparsevec_recv(internal, oid, integer) owner to supabase_admin;

grant execute on function public.sparsevec_recv(internal, oid, integer) to postgres;

grant execute on function public.sparsevec_recv(internal, oid, integer) to anon;

grant execute on function public.sparsevec_recv(internal, oid, integer) to authenticated;

grant execute on function public.sparsevec_recv(internal, oid, integer) to service_role;

create function public.sparsevec_send(sparsevec) returns bytea
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

alter function public.sparsevec_send(sparsevec) owner to supabase_admin;

grant execute on function public.sparsevec_send(sparsevec) to postgres;

grant execute on function public.sparsevec_send(sparsevec) to anon;

grant execute on function public.sparsevec_send(sparsevec) to authenticated;

grant execute on function public.sparsevec_send(sparsevec) to service_role;

create function public.l2_distance(sparsevec, sparsevec) returns double precision
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

alter function public.l2_distance(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.l2_distance(sparsevec, sparsevec) to postgres;

grant execute on function public.l2_distance(sparsevec, sparsevec) to anon;

grant execute on function public.l2_distance(sparsevec, sparsevec) to authenticated;

grant execute on function public.l2_distance(sparsevec, sparsevec) to service_role;

create function public.inner_product(sparsevec, sparsevec) returns double precision
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

alter function public.inner_product(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.inner_product(sparsevec, sparsevec) to postgres;

grant execute on function public.inner_product(sparsevec, sparsevec) to anon;

grant execute on function public.inner_product(sparsevec, sparsevec) to authenticated;

grant execute on function public.inner_product(sparsevec, sparsevec) to service_role;

create function public.cosine_distance(sparsevec, sparsevec) returns double precision
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

alter function public.cosine_distance(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.cosine_distance(sparsevec, sparsevec) to postgres;

grant execute on function public.cosine_distance(sparsevec, sparsevec) to anon;

grant execute on function public.cosine_distance(sparsevec, sparsevec) to authenticated;

grant execute on function public.cosine_distance(sparsevec, sparsevec) to service_role;

create function public.l1_distance(sparsevec, sparsevec) returns double precision
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

alter function public.l1_distance(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.l1_distance(sparsevec, sparsevec) to postgres;

grant execute on function public.l1_distance(sparsevec, sparsevec) to anon;

grant execute on function public.l1_distance(sparsevec, sparsevec) to authenticated;

grant execute on function public.l1_distance(sparsevec, sparsevec) to service_role;

create function public.l2_norm(sparsevec) returns double precision
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

alter function public.l2_norm(sparsevec) owner to supabase_admin;

grant execute on function public.l2_norm(sparsevec) to postgres;

grant execute on function public.l2_norm(sparsevec) to anon;

grant execute on function public.l2_norm(sparsevec) to authenticated;

grant execute on function public.l2_norm(sparsevec) to service_role;

create function public.l2_normalize(sparsevec) returns sparsevec
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

alter function public.l2_normalize(sparsevec) owner to supabase_admin;

grant execute on function public.l2_normalize(sparsevec) to postgres;

grant execute on function public.l2_normalize(sparsevec) to anon;

grant execute on function public.l2_normalize(sparsevec) to authenticated;

grant execute on function public.l2_normalize(sparsevec) to service_role;

create function public.sparsevec_lt(sparsevec, sparsevec) returns boolean
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

alter function public.sparsevec_lt(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.sparsevec_lt(sparsevec, sparsevec) to postgres;

grant execute on function public.sparsevec_lt(sparsevec, sparsevec) to anon;

grant execute on function public.sparsevec_lt(sparsevec, sparsevec) to authenticated;

grant execute on function public.sparsevec_lt(sparsevec, sparsevec) to service_role;

create function public.sparsevec_le(sparsevec, sparsevec) returns boolean
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

alter function public.sparsevec_le(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.sparsevec_le(sparsevec, sparsevec) to postgres;

grant execute on function public.sparsevec_le(sparsevec, sparsevec) to anon;

grant execute on function public.sparsevec_le(sparsevec, sparsevec) to authenticated;

grant execute on function public.sparsevec_le(sparsevec, sparsevec) to service_role;

create function public.sparsevec_eq(sparsevec, sparsevec) returns boolean
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

alter function public.sparsevec_eq(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.sparsevec_eq(sparsevec, sparsevec) to postgres;

grant execute on function public.sparsevec_eq(sparsevec, sparsevec) to anon;

grant execute on function public.sparsevec_eq(sparsevec, sparsevec) to authenticated;

grant execute on function public.sparsevec_eq(sparsevec, sparsevec) to service_role;

create function public.sparsevec_ne(sparsevec, sparsevec) returns boolean
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

alter function public.sparsevec_ne(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.sparsevec_ne(sparsevec, sparsevec) to postgres;

grant execute on function public.sparsevec_ne(sparsevec, sparsevec) to anon;

grant execute on function public.sparsevec_ne(sparsevec, sparsevec) to authenticated;

grant execute on function public.sparsevec_ne(sparsevec, sparsevec) to service_role;

create function public.sparsevec_ge(sparsevec, sparsevec) returns boolean
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

alter function public.sparsevec_ge(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.sparsevec_ge(sparsevec, sparsevec) to postgres;

grant execute on function public.sparsevec_ge(sparsevec, sparsevec) to anon;

grant execute on function public.sparsevec_ge(sparsevec, sparsevec) to authenticated;

grant execute on function public.sparsevec_ge(sparsevec, sparsevec) to service_role;

create function public.sparsevec_gt(sparsevec, sparsevec) returns boolean
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

alter function public.sparsevec_gt(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.sparsevec_gt(sparsevec, sparsevec) to postgres;

grant execute on function public.sparsevec_gt(sparsevec, sparsevec) to anon;

grant execute on function public.sparsevec_gt(sparsevec, sparsevec) to authenticated;

grant execute on function public.sparsevec_gt(sparsevec, sparsevec) to service_role;

create function public.sparsevec_cmp(sparsevec, sparsevec) returns integer
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

alter function public.sparsevec_cmp(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.sparsevec_cmp(sparsevec, sparsevec) to postgres;

grant execute on function public.sparsevec_cmp(sparsevec, sparsevec) to anon;

grant execute on function public.sparsevec_cmp(sparsevec, sparsevec) to authenticated;

grant execute on function public.sparsevec_cmp(sparsevec, sparsevec) to service_role;

create function public.sparsevec_l2_squared_distance(sparsevec, sparsevec) returns double precision
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

alter function public.sparsevec_l2_squared_distance(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.sparsevec_l2_squared_distance(sparsevec, sparsevec) to postgres;

grant execute on function public.sparsevec_l2_squared_distance(sparsevec, sparsevec) to anon;

grant execute on function public.sparsevec_l2_squared_distance(sparsevec, sparsevec) to authenticated;

grant execute on function public.sparsevec_l2_squared_distance(sparsevec, sparsevec) to service_role;

create function public.sparsevec_negative_inner_product(sparsevec, sparsevec) returns double precision
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

alter function public.sparsevec_negative_inner_product(sparsevec, sparsevec) owner to supabase_admin;

grant execute on function public.sparsevec_negative_inner_product(sparsevec, sparsevec) to postgres;

grant execute on function public.sparsevec_negative_inner_product(sparsevec, sparsevec) to anon;

grant execute on function public.sparsevec_negative_inner_product(sparsevec, sparsevec) to authenticated;

grant execute on function public.sparsevec_negative_inner_product(sparsevec, sparsevec) to service_role;

create function public.sparsevec(sparsevec, integer, boolean) returns sparsevec
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

alter function public.sparsevec(sparsevec, integer, boolean) owner to supabase_admin;

grant execute on function public.sparsevec(sparsevec, integer, boolean) to postgres;

grant execute on function public.sparsevec(sparsevec, integer, boolean) to anon;

grant execute on function public.sparsevec(sparsevec, integer, boolean) to authenticated;

grant execute on function public.sparsevec(sparsevec, integer, boolean) to service_role;

create function public.vector_to_sparsevec(vector, integer, boolean) returns sparsevec
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

alter function public.vector_to_sparsevec(vector, integer, boolean) owner to supabase_admin;

grant execute on function public.vector_to_sparsevec(vector, integer, boolean) to postgres;

grant execute on function public.vector_to_sparsevec(vector, integer, boolean) to anon;

grant execute on function public.vector_to_sparsevec(vector, integer, boolean) to authenticated;

grant execute on function public.vector_to_sparsevec(vector, integer, boolean) to service_role;

create function public.sparsevec_to_vector(sparsevec, integer, boolean) returns vector
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

alter function public.sparsevec_to_vector(sparsevec, integer, boolean) owner to supabase_admin;

grant execute on function public.sparsevec_to_vector(sparsevec, integer, boolean) to postgres;

grant execute on function public.sparsevec_to_vector(sparsevec, integer, boolean) to anon;

grant execute on function public.sparsevec_to_vector(sparsevec, integer, boolean) to authenticated;

grant execute on function public.sparsevec_to_vector(sparsevec, integer, boolean) to service_role;

create function public.halfvec_to_sparsevec(halfvec, integer, boolean) returns sparsevec
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

alter function public.halfvec_to_sparsevec(halfvec, integer, boolean) owner to supabase_admin;

grant execute on function public.halfvec_to_sparsevec(halfvec, integer, boolean) to postgres;

grant execute on function public.halfvec_to_sparsevec(halfvec, integer, boolean) to anon;

grant execute on function public.halfvec_to_sparsevec(halfvec, integer, boolean) to authenticated;

grant execute on function public.halfvec_to_sparsevec(halfvec, integer, boolean) to service_role;

create function public.sparsevec_to_halfvec(sparsevec, integer, boolean) returns halfvec
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

alter function public.sparsevec_to_halfvec(sparsevec, integer, boolean) owner to supabase_admin;

grant execute on function public.sparsevec_to_halfvec(sparsevec, integer, boolean) to postgres;

grant execute on function public.sparsevec_to_halfvec(sparsevec, integer, boolean) to anon;

grant execute on function public.sparsevec_to_halfvec(sparsevec, integer, boolean) to authenticated;

grant execute on function public.sparsevec_to_halfvec(sparsevec, integer, boolean) to service_role;

create function public.array_to_sparsevec(integer[], integer, boolean) returns sparsevec
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

alter function public.array_to_sparsevec(integer[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_sparsevec(integer[], integer, boolean) to postgres;

grant execute on function public.array_to_sparsevec(integer[], integer, boolean) to anon;

grant execute on function public.array_to_sparsevec(integer[], integer, boolean) to authenticated;

grant execute on function public.array_to_sparsevec(integer[], integer, boolean) to service_role;

create function public.array_to_sparsevec(real[], integer, boolean) returns sparsevec
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

alter function public.array_to_sparsevec(real[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_sparsevec(real[], integer, boolean) to postgres;

grant execute on function public.array_to_sparsevec(real[], integer, boolean) to anon;

grant execute on function public.array_to_sparsevec(real[], integer, boolean) to authenticated;

grant execute on function public.array_to_sparsevec(real[], integer, boolean) to service_role;

create function public.array_to_sparsevec(double precision[], integer, boolean) returns sparsevec
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

alter function public.array_to_sparsevec(double precision[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_sparsevec(double precision[], integer, boolean) to postgres;

grant execute on function public.array_to_sparsevec(double precision[], integer, boolean) to anon;

grant execute on function public.array_to_sparsevec(double precision[], integer, boolean) to authenticated;

grant execute on function public.array_to_sparsevec(double precision[], integer, boolean) to service_role;

create function public.array_to_sparsevec(numeric[], integer, boolean) returns sparsevec
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

alter function public.array_to_sparsevec(numeric[], integer, boolean) owner to supabase_admin;

grant execute on function public.array_to_sparsevec(numeric[], integer, boolean) to postgres;

grant execute on function public.array_to_sparsevec(numeric[], integer, boolean) to anon;

grant execute on function public.array_to_sparsevec(numeric[], integer, boolean) to authenticated;

grant execute on function public.array_to_sparsevec(numeric[], integer, boolean) to service_role;

create function public.match_documents(query_embedding vector, match_count integer DEFAULT NULL::integer, filter jsonb DEFAULT '{}'::jsonb)
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

alter function public.match_documents(vector, integer, jsonb) owner to postgres;

grant execute on function public.match_documents(vector, integer, jsonb) to anon;

grant execute on function public.match_documents(vector, integer, jsonb) to authenticated;

grant execute on function public.match_documents(vector, integer, jsonb) to service_role;

create function public.match_documents384(query_embedding vector, match_count integer DEFAULT NULL::integer, filter jsonb DEFAULT '{}'::jsonb)
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

alter function public.match_documents384(vector, integer, jsonb) owner to postgres;

grant execute on function public.match_documents384(vector, integer, jsonb) to anon;

grant execute on function public.match_documents384(vector, integer, jsonb) to authenticated;

grant execute on function public.match_documents384(vector, integer, jsonb) to service_role;

create function test_1.find_similar_documents(query_embedding vector, similarity_threshold double precision, max_results integer)
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
            test_1.file_vectors fv
        WHERE
            1 - (fv.embedding <=> query_embedding) > similarity_threshold
        ORDER BY
            fv.embedding <=> query_embedding
        LIMIT max_results;
END;
$$;

comment on function test_1.find_similar_documents(vector, double precision, integer) is 'Функция для поиска семантически похожих документов';

alter function test_1.find_similar_documents(vector, double precision, integer) owner to postgres;

create function public.find_similar_documents(query_embedding vector, similarity_threshold double precision, max_results integer)
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

alter function public.find_similar_documents(vector, double precision, integer) owner to postgres;

grant execute on function public.find_similar_documents(vector, double precision, integer) to anon;

grant execute on function public.find_similar_documents(vector, double precision, integer) to authenticated;

grant execute on function public.find_similar_documents(vector, double precision, integer) to service_role;

create function public.update_updated_at() returns trigger
    language plpgsql
as
$$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

alter function public.update_updated_at() owner to postgres;

create trigger trg_link_type_updated_at
    before update
    on public.link_type
    for each row
execute procedure public.update_updated_at();

create trigger trg_link_updated_at
    before update
    on public.link
    for each row
execute procedure public.update_updated_at();

create trigger trg_agent_script_updated_at
    before update
    on public.agent_script
    for each row
execute procedure public.update_updated_at();

create trigger trg_tag_updated_at
    before update
    on public.tag
    for each row
execute procedure public.update_updated_at();

grant execute on function public.update_updated_at() to anon;

grant execute on function public.update_updated_at() to authenticated;

grant execute on function public.update_updated_at() to service_role;

create operator public.<-> (procedure = public.l2_distance, leftarg = vector, rightarg = vector, commutator = public.<->);

alter operator public.<->(vector, vector) owner to supabase_admin;

create operator public.<#> (procedure = public.vector_negative_inner_product, leftarg = vector, rightarg = vector, commutator = public.<#>);

alter operator public.<#>(vector, vector) owner to supabase_admin;

create operator public.<=> (procedure = public.cosine_distance, leftarg = vector, rightarg = vector, commutator = public.<=>);

alter operator public.<=>(vector, vector) owner to supabase_admin;

create operator public.<+> (procedure = public.l1_distance, leftarg = vector, rightarg = vector, commutator = public.<+>);

alter operator public.<+>(vector, vector) owner to supabase_admin;

create operator public.+ (procedure = public.vector_add, leftarg = vector, rightarg = vector, commutator = public.+);

alter operator public.+(vector, vector) owner to supabase_admin;

create operator public.- (procedure = public.vector_sub, leftarg = vector, rightarg = vector);

alter operator public.-(vector, vector) owner to supabase_admin;

create operator public.* (procedure = public.vector_mul, leftarg = vector, rightarg = vector, commutator = public.*);

alter operator public.*(vector, vector) owner to supabase_admin;

create operator public.|| (procedure = public.vector_concat, leftarg = vector, rightarg = vector);

alter operator public.||(vector, vector) owner to supabase_admin;

create operator public.<-> (procedure = public.l2_distance, leftarg = halfvec, rightarg = halfvec, commutator = public.<->);

alter operator public.<->(halfvec, halfvec) owner to supabase_admin;

create operator public.<#> (procedure = public.halfvec_negative_inner_product, leftarg = halfvec, rightarg = halfvec, commutator = public.<#>);

alter operator public.<#>(halfvec, halfvec) owner to supabase_admin;

create operator public.<=> (procedure = public.cosine_distance, leftarg = halfvec, rightarg = halfvec, commutator = public.<=>);

alter operator public.<=>(halfvec, halfvec) owner to supabase_admin;

create operator public.<+> (procedure = public.l1_distance, leftarg = halfvec, rightarg = halfvec, commutator = public.<+>);

alter operator public.<+>(halfvec, halfvec) owner to supabase_admin;

create operator public.+ (procedure = public.halfvec_add, leftarg = halfvec, rightarg = halfvec, commutator = public.+);

alter operator public.+(halfvec, halfvec) owner to supabase_admin;

create operator public.- (procedure = public.halfvec_sub, leftarg = halfvec, rightarg = halfvec);

alter operator public.-(halfvec, halfvec) owner to supabase_admin;

create operator public.* (procedure = public.halfvec_mul, leftarg = halfvec, rightarg = halfvec, commutator = public.*);

alter operator public.*(halfvec, halfvec) owner to supabase_admin;

create operator public.|| (procedure = public.halfvec_concat, leftarg = halfvec, rightarg = halfvec);

alter operator public.||(halfvec, halfvec) owner to supabase_admin;

create operator public.<~> (procedure = public.hamming_distance, leftarg = bit, rightarg = bit, commutator = public.<~>);

alter operator public.<~>(bit, bit) owner to supabase_admin;

create operator public.<%> (procedure = public.jaccard_distance, leftarg = bit, rightarg = bit, commutator = public.<%>);

alter operator public.<%>(bit, bit) owner to supabase_admin;

create operator public.<-> (procedure = public.l2_distance, leftarg = sparsevec, rightarg = sparsevec, commutator = public.<->);

alter operator public.<->(sparsevec, sparsevec) owner to supabase_admin;

create operator public.<#> (procedure = public.sparsevec_negative_inner_product, leftarg = sparsevec, rightarg = sparsevec, commutator = public.<#>);

alter operator public.<#>(sparsevec, sparsevec) owner to supabase_admin;

create operator public.<=> (procedure = public.cosine_distance, leftarg = sparsevec, rightarg = sparsevec, commutator = public.<=>);

alter operator public.<=>(sparsevec, sparsevec) owner to supabase_admin;

create operator public.<+> (procedure = public.l1_distance, leftarg = sparsevec, rightarg = sparsevec, commutator = public.<+>);

alter operator public.<+>(sparsevec, sparsevec) owner to supabase_admin;

create aggregate public.avg(vector) (
    sfunc = public.vector_accum,
    stype = double precision[],
    finalfunc = public.vector_avg,
    combinefunc = public.vector_combine,
    initcond = '{0}',
    parallel = safe
    );

alter aggregate public.avg(vector) owner to supabase_admin;

grant execute on function public.avg(vector) to postgres;

grant execute on function public.avg(vector) to anon;

grant execute on function public.avg(vector) to authenticated;

grant execute on function public.avg(vector) to service_role;

create aggregate public.sum(vector) (
    sfunc = public.vector_add,
    stype = vector,
    combinefunc = public.vector_add,
    parallel = safe
    );

alter aggregate public.sum(vector) owner to supabase_admin;

grant execute on function public.sum(vector) to postgres;

grant execute on function public.sum(vector) to anon;

grant execute on function public.sum(vector) to authenticated;

grant execute on function public.sum(vector) to service_role;

create aggregate public.avg(halfvec) (
    sfunc = public.halfvec_accum,
    stype = double precision[],
    finalfunc = public.halfvec_avg,
    combinefunc = public.halfvec_combine,
    initcond = '{0}',
    parallel = safe
    );

alter aggregate public.avg(halfvec) owner to supabase_admin;

grant execute on function public.avg(halfvec) to postgres;

grant execute on function public.avg(halfvec) to anon;

grant execute on function public.avg(halfvec) to authenticated;

grant execute on function public.avg(halfvec) to service_role;

create aggregate public.sum(halfvec) (
    sfunc = public.halfvec_add,
    stype = halfvec,
    combinefunc = public.halfvec_add,
    parallel = safe
    );

alter aggregate public.sum(halfvec) owner to supabase_admin;

grant execute on function public.sum(halfvec) to postgres;

grant execute on function public.sum(halfvec) to anon;

grant execute on function public.sum(halfvec) to authenticated;

grant execute on function public.sum(halfvec) to service_role;

create operator family public.vector_ops using btree;

alter operator family public.vector_ops using btree add
    operator 4 public.>=(vector, vector),
    operator 1 public.<(vector, vector),
    operator 2 public.<=(vector, vector),
    operator 3 public.=(vector, vector),
    operator 5 public.>(vector, vector),
    function 1(vector, vector) public.vector_cmp(vector, vector);

alter operator family public.vector_ops using btree owner to supabase_admin;

create operator class public.vector_ops default for type vector using btree as
    operator 3 public.=(vector, vector),
    operator 1 public.<(vector, vector),
    operator 5 public.>(vector, vector),
    operator 2 public.<=(vector, vector),
    operator 4 public.>=(vector, vector),
    function 1(vector, vector) public.vector_cmp(vector, vector);

alter operator class public.vector_ops using btree owner to supabase_admin;

create operator family public.vector_l2_ops using ivfflat;

alter operator family public.vector_l2_ops using ivfflat add
    operator 1 public.<->(vector, vector) for order by float_ops,
    function 1(vector, vector) public.vector_l2_squared_distance(vector, vector),
    function 3(vector, vector) public.l2_distance(vector, vector);

alter operator family public.vector_l2_ops using ivfflat owner to supabase_admin;

create operator class public.vector_l2_ops default for type vector using ivfflat as
    operator 1 public.<->(vector, vector) for order by float_ops,
    function 1(vector, vector) public.vector_l2_squared_distance(vector, vector),
    function 3(vector, vector) public.l2_distance(vector, vector);

alter operator class public.vector_l2_ops using ivfflat owner to supabase_admin;

create operator family public.vector_ip_ops using ivfflat;

alter operator family public.vector_ip_ops using ivfflat add
    operator 1 public.<#>(vector, vector) for order by float_ops,
    function 4(vector, vector) public.vector_norm(vector),
    function 1(vector, vector) public.vector_negative_inner_product(vector, vector),
    function 3(vector, vector) public.vector_spherical_distance(vector, vector);

alter operator family public.vector_ip_ops using ivfflat owner to supabase_admin;

create operator class public.vector_ip_ops for type vector using ivfflat as
    operator 1 public.<#>(vector, vector) for order by float_ops,
    function 1(vector, vector) public.vector_negative_inner_product(vector, vector),
    function 4(vector, vector) public.vector_norm(vector),
    function 3(vector, vector) public.vector_spherical_distance(vector, vector);

alter operator class public.vector_ip_ops using ivfflat owner to supabase_admin;

create operator family public.vector_cosine_ops using ivfflat;

alter operator family public.vector_cosine_ops using ivfflat add
    operator 1 public.<=>(vector, vector) for order by float_ops,
    function 3(vector, vector) public.vector_spherical_distance(vector, vector),
    function 1(vector, vector) public.vector_negative_inner_product(vector, vector),
    function 2(vector, vector) public.vector_norm(vector),
    function 4(vector, vector) public.vector_norm(vector);

alter operator family public.vector_cosine_ops using ivfflat owner to supabase_admin;

create operator class public.vector_cosine_ops for type vector using ivfflat as
    operator 1 public.<=>(vector, vector) for order by float_ops,
    function 4(vector, vector) public.vector_norm(vector),
    function 1(vector, vector) public.vector_negative_inner_product(vector, vector),
    function 2(vector, vector) public.vector_norm(vector),
    function 3(vector, vector) public.vector_spherical_distance(vector, vector);

alter operator class public.vector_cosine_ops using ivfflat owner to supabase_admin;

create operator family public.vector_l2_ops using hnsw;

alter operator family public.vector_l2_ops using hnsw add
    operator 1 public.<->(vector, vector) for order by float_ops,
    function 1(vector, vector) public.vector_l2_squared_distance(vector, vector);

alter operator family public.vector_l2_ops using hnsw owner to supabase_admin;

create operator class public.vector_l2_ops for type vector using hnsw as
    operator 1 public.<->(vector, vector) for order by float_ops,
    function 1(vector, vector) public.vector_l2_squared_distance(vector, vector);

alter operator class public.vector_l2_ops using hnsw owner to supabase_admin;

create operator family public.vector_ip_ops using hnsw;

alter operator family public.vector_ip_ops using hnsw add
    operator 1 public.<#>(vector, vector) for order by float_ops,
    function 1(vector, vector) public.vector_negative_inner_product(vector, vector);

alter operator family public.vector_ip_ops using hnsw owner to supabase_admin;

create operator class public.vector_ip_ops for type vector using hnsw as
    operator 1 public.<#>(vector, vector) for order by float_ops,
    function 1(vector, vector) public.vector_negative_inner_product(vector, vector);

alter operator class public.vector_ip_ops using hnsw owner to supabase_admin;

create operator family public.vector_cosine_ops using hnsw;

alter operator family public.vector_cosine_ops using hnsw add
    operator 1 public.<=>(vector, vector) for order by float_ops,
    function 1(vector, vector) public.vector_negative_inner_product(vector, vector),
    function 2(vector, vector) public.vector_norm(vector);

alter operator family public.vector_cosine_ops using hnsw owner to supabase_admin;

create operator class public.vector_cosine_ops for type vector using hnsw as
    operator 1 public.<=>(vector, vector) for order by float_ops,
    function 1(vector, vector) public.vector_negative_inner_product(vector, vector),
    function 2(vector, vector) public.vector_norm(vector);

alter operator class public.vector_cosine_ops using hnsw owner to supabase_admin;

create operator family public.vector_l1_ops using hnsw;

alter operator family public.vector_l1_ops using hnsw add
    operator 1 public.<+>(vector, vector) for order by float_ops,
    function 1(vector, vector) public.l1_distance(vector, vector);

alter operator family public.vector_l1_ops using hnsw owner to supabase_admin;

create operator class public.vector_l1_ops for type vector using hnsw as
    operator 1 public.<+>(vector, vector) for order by float_ops,
    function 1(vector, vector) public.l1_distance(vector, vector);

alter operator class public.vector_l1_ops using hnsw owner to supabase_admin;

create operator family public.halfvec_ops using btree;

alter operator family public.halfvec_ops using btree add
    operator 3 public.=(halfvec, halfvec),
    operator 4 public.>=(halfvec, halfvec),
    operator 5 public.>(halfvec, halfvec),
    operator 2 public.<=(halfvec, halfvec),
    operator 1 public.<(halfvec, halfvec),
    function 1(halfvec, halfvec) public.halfvec_cmp(halfvec, halfvec);

alter operator family public.halfvec_ops using btree owner to supabase_admin;

create operator class public.halfvec_ops default for type halfvec using btree as
    operator 1 public.<(halfvec, halfvec),
    operator 4 public.>=(halfvec, halfvec),
    operator 5 public.>(halfvec, halfvec),
    operator 3 public.=(halfvec, halfvec),
    operator 2 public.<=(halfvec, halfvec),
    function 1(halfvec, halfvec) public.halfvec_cmp(halfvec, halfvec);

alter operator class public.halfvec_ops using btree owner to supabase_admin;

create operator family public.halfvec_l2_ops using ivfflat;

alter operator family public.halfvec_l2_ops using ivfflat add
    operator 1 public.<->(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) public.halfvec_l2_squared_distance(halfvec, halfvec),
    function 3(halfvec, halfvec) public.l2_distance(halfvec, halfvec),
    function 5(halfvec, halfvec) public.ivfflat_halfvec_support(internal);

alter operator family public.halfvec_l2_ops using ivfflat owner to supabase_admin;

create operator class public.halfvec_l2_ops for type halfvec using ivfflat as
    operator 1 public.<->(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) public.halfvec_l2_squared_distance(halfvec, halfvec),
    function 3(halfvec, halfvec) public.l2_distance(halfvec, halfvec),
    function 5(halfvec, halfvec) public.ivfflat_halfvec_support(internal);

alter operator class public.halfvec_l2_ops using ivfflat owner to supabase_admin;

create operator family public.halfvec_ip_ops using ivfflat;

alter operator family public.halfvec_ip_ops using ivfflat add
    operator 1 public.<#>(halfvec, halfvec) for order by float_ops,
    function 3(halfvec, halfvec) public.halfvec_spherical_distance(halfvec, halfvec),
    function 1(halfvec, halfvec) public.halfvec_negative_inner_product(halfvec, halfvec),
    function 4(halfvec, halfvec) public.l2_norm(halfvec),
    function 5(halfvec, halfvec) public.ivfflat_halfvec_support(internal);

alter operator family public.halfvec_ip_ops using ivfflat owner to supabase_admin;

create operator class public.halfvec_ip_ops for type halfvec using ivfflat as
    operator 1 public.<#>(halfvec, halfvec) for order by float_ops,
    function 4(halfvec, halfvec) public.l2_norm(halfvec),
    function 1(halfvec, halfvec) public.halfvec_negative_inner_product(halfvec, halfvec),
    function 5(halfvec, halfvec) public.ivfflat_halfvec_support(internal),
    function 3(halfvec, halfvec) public.halfvec_spherical_distance(halfvec, halfvec);

alter operator class public.halfvec_ip_ops using ivfflat owner to supabase_admin;

create operator family public.halfvec_cosine_ops using ivfflat;

alter operator family public.halfvec_cosine_ops using ivfflat add
    operator 1 public.<=>(halfvec, halfvec) for order by float_ops,
    function 2(halfvec, halfvec) public.l2_norm(halfvec),
    function 4(halfvec, halfvec) public.l2_norm(halfvec),
    function 1(halfvec, halfvec) public.halfvec_negative_inner_product(halfvec, halfvec),
    function 5(halfvec, halfvec) public.ivfflat_halfvec_support(internal),
    function 3(halfvec, halfvec) public.halfvec_spherical_distance(halfvec, halfvec);

alter operator family public.halfvec_cosine_ops using ivfflat owner to supabase_admin;

create operator class public.halfvec_cosine_ops for type halfvec using ivfflat as
    operator 1 public.<=>(halfvec, halfvec) for order by float_ops,
    function 4(halfvec, halfvec) public.l2_norm(halfvec),
    function 2(halfvec, halfvec) public.l2_norm(halfvec),
    function 5(halfvec, halfvec) public.ivfflat_halfvec_support(internal),
    function 3(halfvec, halfvec) public.halfvec_spherical_distance(halfvec, halfvec),
    function 1(halfvec, halfvec) public.halfvec_negative_inner_product(halfvec, halfvec);

alter operator class public.halfvec_cosine_ops using ivfflat owner to supabase_admin;

create operator family public.halfvec_l2_ops using hnsw;

alter operator family public.halfvec_l2_ops using hnsw add
    operator 1 public.<->(halfvec, halfvec) for order by float_ops,
    function 3(halfvec, halfvec) public.hnsw_halfvec_support(internal),
    function 1(halfvec, halfvec) public.halfvec_l2_squared_distance(halfvec, halfvec);

alter operator family public.halfvec_l2_ops using hnsw owner to supabase_admin;

create operator class public.halfvec_l2_ops for type halfvec using hnsw as
    operator 1 public.<->(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) public.halfvec_l2_squared_distance(halfvec, halfvec),
    function 3(halfvec, halfvec) public.hnsw_halfvec_support(internal);

alter operator class public.halfvec_l2_ops using hnsw owner to supabase_admin;

create operator family public.halfvec_ip_ops using hnsw;

alter operator family public.halfvec_ip_ops using hnsw add
    operator 1 public.<#>(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) public.halfvec_negative_inner_product(halfvec, halfvec),
    function 3(halfvec, halfvec) public.hnsw_halfvec_support(internal);

alter operator family public.halfvec_ip_ops using hnsw owner to supabase_admin;

create operator class public.halfvec_ip_ops for type halfvec using hnsw as
    operator 1 public.<#>(halfvec, halfvec) for order by float_ops,
    function 3(halfvec, halfvec) public.hnsw_halfvec_support(internal),
    function 1(halfvec, halfvec) public.halfvec_negative_inner_product(halfvec, halfvec);

alter operator class public.halfvec_ip_ops using hnsw owner to supabase_admin;

create operator family public.halfvec_cosine_ops using hnsw;

alter operator family public.halfvec_cosine_ops using hnsw add
    operator 1 public.<=>(halfvec, halfvec) for order by float_ops,
    function 3(halfvec, halfvec) public.hnsw_halfvec_support(internal),
    function 2(halfvec, halfvec) public.l2_norm(halfvec),
    function 1(halfvec, halfvec) public.halfvec_negative_inner_product(halfvec, halfvec);

alter operator family public.halfvec_cosine_ops using hnsw owner to supabase_admin;

create operator class public.halfvec_cosine_ops for type halfvec using hnsw as
    operator 1 public.<=>(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) public.halfvec_negative_inner_product(halfvec, halfvec),
    function 2(halfvec, halfvec) public.l2_norm(halfvec),
    function 3(halfvec, halfvec) public.hnsw_halfvec_support(internal);

alter operator class public.halfvec_cosine_ops using hnsw owner to supabase_admin;

create operator family public.halfvec_l1_ops using hnsw;

alter operator family public.halfvec_l1_ops using hnsw add
    operator 1 public.<+>(halfvec, halfvec) for order by float_ops,
    function 1(halfvec, halfvec) public.l1_distance(halfvec, halfvec),
    function 3(halfvec, halfvec) public.hnsw_halfvec_support(internal);

alter operator family public.halfvec_l1_ops using hnsw owner to supabase_admin;

create operator class public.halfvec_l1_ops for type halfvec using hnsw as
    operator 1 public.<+>(halfvec, halfvec) for order by float_ops,
    function 3(halfvec, halfvec) public.hnsw_halfvec_support(internal),
    function 1(halfvec, halfvec) public.l1_distance(halfvec, halfvec);

alter operator class public.halfvec_l1_ops using hnsw owner to supabase_admin;

create operator family public.bit_hamming_ops using ivfflat;

alter operator family public.bit_hamming_ops using ivfflat add
    operator 1 public.<~>(bit, bit) for order by float_ops,
    function 1(bit, bit) public.hamming_distance(bit, bit),
    function 5(bit, bit) public.ivfflat_bit_support(internal),
    function 3(bit, bit) public.hamming_distance(bit, bit);

alter operator family public.bit_hamming_ops using ivfflat owner to supabase_admin;

create operator class public.bit_hamming_ops for type bit using ivfflat as
    operator 1 public.<~>(bit, bit) for order by float_ops,
    function 5(bit, bit) public.ivfflat_bit_support(internal),
    function 3(bit, bit) public.hamming_distance(bit, bit),
    function 1(bit, bit) public.hamming_distance(bit, bit);

alter operator class public.bit_hamming_ops using ivfflat owner to supabase_admin;

create operator family public.bit_hamming_ops using hnsw;

alter operator family public.bit_hamming_ops using hnsw add
    operator 1 public.<~>(bit, bit) for order by float_ops,
    function 1(bit, bit) public.hamming_distance(bit, bit),
    function 3(bit, bit) public.hnsw_bit_support(internal);

alter operator family public.bit_hamming_ops using hnsw owner to supabase_admin;

create operator class public.bit_hamming_ops for type bit using hnsw as
    operator 1 public.<~>(bit, bit) for order by float_ops,
    function 1(bit, bit) public.hamming_distance(bit, bit),
    function 3(bit, bit) public.hnsw_bit_support(internal);

alter operator class public.bit_hamming_ops using hnsw owner to supabase_admin;

create operator family public.bit_jaccard_ops using hnsw;

alter operator family public.bit_jaccard_ops using hnsw add
    operator 1 public.<%>(bit, bit) for order by float_ops,
    function 1(bit, bit) public.jaccard_distance(bit, bit),
    function 3(bit, bit) public.hnsw_bit_support(internal);

alter operator family public.bit_jaccard_ops using hnsw owner to supabase_admin;

create operator class public.bit_jaccard_ops for type bit using hnsw as
    operator 1 public.<%>(bit, bit) for order by float_ops,
    function 1(bit, bit) public.jaccard_distance(bit, bit),
    function 3(bit, bit) public.hnsw_bit_support(internal);

alter operator class public.bit_jaccard_ops using hnsw owner to supabase_admin;

create operator family public.sparsevec_ops using btree;

alter operator family public.sparsevec_ops using btree add
    operator 4 public.>=(sparsevec, sparsevec),
    operator 5 public.>(sparsevec, sparsevec),
    operator 1 public.<(sparsevec, sparsevec),
    operator 3 public.=(sparsevec, sparsevec),
    operator 2 public.<=(sparsevec, sparsevec),
    function 1(sparsevec, sparsevec) public.sparsevec_cmp(sparsevec, sparsevec);

alter operator family public.sparsevec_ops using btree owner to supabase_admin;

create operator class public.sparsevec_ops default for type sparsevec using btree as
    operator 3 public.=(sparsevec, sparsevec),
    operator 4 public.>=(sparsevec, sparsevec),
    operator 5 public.>(sparsevec, sparsevec),
    operator 2 public.<=(sparsevec, sparsevec),
    operator 1 public.<(sparsevec, sparsevec),
    function 1(sparsevec, sparsevec) public.sparsevec_cmp(sparsevec, sparsevec);

alter operator class public.sparsevec_ops using btree owner to supabase_admin;

create operator family public.sparsevec_l2_ops using hnsw;

alter operator family public.sparsevec_l2_ops using hnsw add
    operator 1 public.<->(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) public.sparsevec_l2_squared_distance(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) public.hnsw_sparsevec_support(internal);

alter operator family public.sparsevec_l2_ops using hnsw owner to supabase_admin;

create operator class public.sparsevec_l2_ops for type sparsevec using hnsw as
    operator 1 public.<->(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) public.sparsevec_l2_squared_distance(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) public.hnsw_sparsevec_support(internal);

alter operator class public.sparsevec_l2_ops using hnsw owner to supabase_admin;

create operator family public.sparsevec_ip_ops using hnsw;

alter operator family public.sparsevec_ip_ops using hnsw add
    operator 1 public.<#>(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) public.sparsevec_negative_inner_product(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) public.hnsw_sparsevec_support(internal);

alter operator family public.sparsevec_ip_ops using hnsw owner to supabase_admin;

create operator class public.sparsevec_ip_ops for type sparsevec using hnsw as
    operator 1 public.<#>(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) public.sparsevec_negative_inner_product(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) public.hnsw_sparsevec_support(internal);

alter operator class public.sparsevec_ip_ops using hnsw owner to supabase_admin;

create operator family public.sparsevec_cosine_ops using hnsw;

alter operator family public.sparsevec_cosine_ops using hnsw add
    operator 1 public.<=>(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) public.sparsevec_negative_inner_product(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) public.hnsw_sparsevec_support(internal),
    function 2(sparsevec, sparsevec) public.l2_norm(sparsevec);

alter operator family public.sparsevec_cosine_ops using hnsw owner to supabase_admin;

create operator class public.sparsevec_cosine_ops for type sparsevec using hnsw as
    operator 1 public.<=>(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) public.sparsevec_negative_inner_product(sparsevec, sparsevec),
    function 2(sparsevec, sparsevec) public.l2_norm(sparsevec),
    function 3(sparsevec, sparsevec) public.hnsw_sparsevec_support(internal);

alter operator class public.sparsevec_cosine_ops using hnsw owner to supabase_admin;

create operator family public.sparsevec_l1_ops using hnsw;

alter operator family public.sparsevec_l1_ops using hnsw add
    operator 1 public.<+>(sparsevec, sparsevec) for order by float_ops,
    function 1(sparsevec, sparsevec) public.l1_distance(sparsevec, sparsevec),
    function 3(sparsevec, sparsevec) public.hnsw_sparsevec_support(internal);

alter operator family public.sparsevec_l1_ops using hnsw owner to supabase_admin;

create operator class public.sparsevec_l1_ops for type sparsevec using hnsw as
    operator 1 public.<+>(sparsevec, sparsevec) for order by float_ops,
    function 3(sparsevec, sparsevec) public.hnsw_sparsevec_support(internal),
    function 1(sparsevec, sparsevec) public.l1_distance(sparsevec, sparsevec);

alter operator class public.sparsevec_l1_ops using hnsw owner to supabase_admin;

-- Cyclic dependencies found

create operator public.<> (procedure = public.halfvec_ne, leftarg = halfvec, rightarg = halfvec, commutator = public.<>, negator = public.=, join = eqjoinsel, restrict = eqsel);

alter operator public.<>(halfvec, halfvec) owner to supabase_admin;

create operator public.= (procedure = public.halfvec_eq, leftarg = halfvec, rightarg = halfvec, commutator = public.=, negator = public.<>, join = eqjoinsel, restrict = eqsel);

alter operator public.=(halfvec, halfvec) owner to supabase_admin;

-- Cyclic dependencies found

create operator public.<> (procedure = public.sparsevec_ne, leftarg = sparsevec, rightarg = sparsevec, commutator = public.<>, negator = public.=, join = eqjoinsel, restrict = eqsel);

alter operator public.<>(sparsevec, sparsevec) owner to supabase_admin;

create operator public.= (procedure = public.sparsevec_eq, leftarg = sparsevec, rightarg = sparsevec, commutator = public.=, negator = public.<>, join = eqjoinsel, restrict = eqsel);

alter operator public.=(sparsevec, sparsevec) owner to supabase_admin;

-- Cyclic dependencies found

create operator public.<> (procedure = public.vector_ne, leftarg = vector, rightarg = vector, commutator = public.<>, negator = public.=, join = eqjoinsel, restrict = eqsel);

alter operator public.<>(vector, vector) owner to supabase_admin;

create operator public.= (procedure = public.vector_eq, leftarg = vector, rightarg = vector, commutator = public.=, negator = public.<>, join = eqjoinsel, restrict = eqsel);

alter operator public.=(vector, vector) owner to supabase_admin;

-- Cyclic dependencies found

create operator public.< (procedure = public.halfvec_lt, leftarg = halfvec, rightarg = halfvec, commutator = public.>, negator = public.>=, join = scalarltjoinsel, restrict = scalarltsel);

alter operator public.<(halfvec, halfvec) owner to supabase_admin;

-- Cyclic dependencies found

create operator public.> (procedure = public.halfvec_gt, leftarg = halfvec, rightarg = halfvec, commutator = public.<, negator = public.<=, join = scalargtjoinsel, restrict = scalargtsel);

alter operator public.>(halfvec, halfvec) owner to supabase_admin;

-- Cyclic dependencies found

create operator public.<= (procedure = public.halfvec_le, leftarg = halfvec, rightarg = halfvec, commutator = public.>=, negator = public.>, join = scalarlejoinsel, restrict = scalarlesel);

alter operator public.<=(halfvec, halfvec) owner to supabase_admin;

create operator public.>= (procedure = public.halfvec_ge, leftarg = halfvec, rightarg = halfvec, commutator = public.<=, negator = public.<, join = scalargejoinsel, restrict = scalargesel);

alter operator public.>=(halfvec, halfvec) owner to supabase_admin;

-- Cyclic dependencies found

create operator public.< (procedure = public.sparsevec_lt, leftarg = sparsevec, rightarg = sparsevec, commutator = public.>, negator = public.>=, join = scalarltjoinsel, restrict = scalarltsel);

alter operator public.<(sparsevec, sparsevec) owner to supabase_admin;

-- Cyclic dependencies found

create operator public.> (procedure = public.sparsevec_gt, leftarg = sparsevec, rightarg = sparsevec, commutator = public.<, negator = public.<=, join = scalargtjoinsel, restrict = scalargtsel);

alter operator public.>(sparsevec, sparsevec) owner to supabase_admin;

-- Cyclic dependencies found

create operator public.<= (procedure = public.sparsevec_le, leftarg = sparsevec, rightarg = sparsevec, commutator = public.>=, negator = public.>, join = scalarlejoinsel, restrict = scalarlesel);

alter operator public.<=(sparsevec, sparsevec) owner to supabase_admin;

create operator public.>= (procedure = public.sparsevec_ge, leftarg = sparsevec, rightarg = sparsevec, commutator = public.<=, negator = public.<, join = scalargejoinsel, restrict = scalargesel);

alter operator public.>=(sparsevec, sparsevec) owner to supabase_admin;

-- Cyclic dependencies found

create operator public.< (procedure = public.vector_lt, leftarg = vector, rightarg = vector, commutator = public.>, negator = public.>=, join = scalarltjoinsel, restrict = scalarltsel);

alter operator public.<(vector, vector) owner to supabase_admin;

-- Cyclic dependencies found

create operator public.> (procedure = public.vector_gt, leftarg = vector, rightarg = vector, commutator = public.<, negator = public.<=, join = scalargtjoinsel, restrict = scalargtsel);

alter operator public.>(vector, vector) owner to supabase_admin;

-- Cyclic dependencies found

create operator public.<= (procedure = public.vector_le, leftarg = vector, rightarg = vector, commutator = public.>=, negator = public.>, join = scalarlejoinsel, restrict = scalarlesel);

alter operator public.<=(vector, vector) owner to supabase_admin;

create operator public.>= (procedure = public.vector_ge, leftarg = vector, rightarg = vector, commutator = public.<=, negator = public.<, join = scalargejoinsel, restrict = scalargesel);

alter operator public.>=(vector, vector) owner to supabase_admin;


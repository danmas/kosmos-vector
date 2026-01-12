create table if not exists public.file_info
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

create table if not exists public.files
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

create table if not exists public.ai_item
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

create index if not exists idx_ai_item_context_code
    on public.ai_item (context_code);

create index if not exists idx_ai_item_full_name
    on public.ai_item (full_name);

grant delete, insert, references, select, trigger, truncate, update on public.ai_item to anon;

grant delete, insert, references, select, trigger, truncate, update on public.ai_item to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.ai_item to service_role;

create table if not exists public.chunk_vector
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

create table if not exists public.chunks_info
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

create index if not exists chunk_vector_created_at_index
    on public.chunk_vector (created_at desc);

create index if not exists idx_chunk_vector_ai_item_id
    on public.chunk_vector (ai_item_id);

create index if not exists idx_chunk_vector_embedding
    on public.chunk_vector using ivfflat (embedding public.vector_cosine_ops);

create index if not exists idx_chunk_vector_file_id
    on public.chunk_vector (file_id);

create index if not exists idx_chunk_vector_level
    on public.chunk_vector (level);

create index if not exists idx_chunk_vector_parent_chunk_id
    on public.chunk_vector (parent_chunk_id);

create index if not exists idx_chunk_vector_type
    on public.chunk_vector (type);

grant delete, insert, references, select, trigger, truncate, update on public.chunk_vector to anon;

grant delete, insert, references, select, trigger, truncate, update on public.chunk_vector to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.chunk_vector to service_role;

create index if not exists idx_files_context_code
    on public.files (context_code);

grant delete, insert, references, select, trigger, truncate, update on public.files to anon;

grant delete, insert, references, select, trigger, truncate, update on public.files to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.files to service_role;

create table if not exists public.ai_comment
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

create index if not exists idx_ai_comment_context_full_name
    on public.ai_comment (context_code, full_name);

grant delete, insert, references, select, trigger, truncate, update on public.ai_comment to anon;

grant delete, insert, references, select, trigger, truncate, update on public.ai_comment to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.ai_comment to service_role;

create table if not exists public.link_type
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

create trigger trg_link_type_updated_at
    before update
    on public.link_type
    for each row
execute procedure public.update_updated_at();

grant delete, insert, references, select, trigger, truncate, update on public.link_type to anon;

grant delete, insert, references, select, trigger, truncate, update on public.link_type to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.link_type to service_role;

create table if not exists public.link
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

create index if not exists idx_link_context_source
    on public.link (context_code, source);

create index if not exists idx_link_context_target
    on public.link (context_code, target);

create index if not exists idx_link_context_type
    on public.link (context_code, link_type_id);

create index if not exists idx_link_context_target_type
    on public.link (context_code, target, link_type_id);

create unique index if not exists idx_link_unique
    on public.link (context_code, source, target, link_type_id);

create trigger trg_link_updated_at
    before update
    on public.link
    for each row
execute procedure public.update_updated_at();

grant delete, insert, references, select, trigger, truncate, update on public.link to anon;

grant delete, insert, references, select, trigger, truncate, update on public.link to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.link to service_role;

create table if not exists public.agent_script
(
    id           serial
        primary key,
    context_code text not null,
    question     text not null,
    script       text not null,
    created_at   timestamp with time zone default CURRENT_TIMESTAMP,
    updated_at   timestamp with time zone default CURRENT_TIMESTAMP,
    usage_count  integer                  default 0,
    is_valid     boolean                  default false
);

alter table public.agent_script
    owner to postgres;

grant select, update, usage on sequence public.agent_script_id_seq to anon;

grant select, update, usage on sequence public.agent_script_id_seq to authenticated;

grant select, update, usage on sequence public.agent_script_id_seq to service_role;

create unique index if not exists idx_agent_script_unique
    on public.agent_script (context_code, question);

create index if not exists idx_agent_script_question_fts
    on public.agent_script using gin (to_tsvector('russian'::regconfig, question));

create trigger trg_agent_script_updated_at
    before update
    on public.agent_script
    for each row
execute procedure public.update_updated_at();

grant delete, insert, references, select, trigger, truncate, update on public.agent_script to anon;

grant delete, insert, references, select, trigger, truncate, update on public.agent_script to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.agent_script to service_role;



CREATE TABLE IF NOT EXISTS public.tag (
    id           SERIAL PRIMARY KEY,
    context_code TEXT NOT NULL DEFAULT 'DEFAULT',
    code         TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT tag_context_code_unique UNIQUE (context_code, code)
);

CREATE TRIGGER trg_tag_updated_at
    BEFORE UPDATE ON public.tag
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.ai_item_tag (
    ai_item_full_name    TEXT NOT NULL,
    ai_item_context_code TEXT NOT NULL,
    tag_id               INTEGER NOT NULL REFERENCES public.tag (id),

    created_at           TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (ai_item_full_name, ai_item_context_code, tag_id),

    CONSTRAINT fk_ai_item_tag_ai_item
        FOREIGN KEY (ai_item_full_name, ai_item_context_code)
            REFERENCES public.ai_item (full_name, context_code)
);

CREATE INDEX idx_ai_item_tag_ai_item_full_name_context ON public.ai_item_tag (ai_item_full_name, ai_item_context_code);
CREATE INDEX idx_ai_item_tag_tag_id                    ON public.ai_item_tag (tag_id);

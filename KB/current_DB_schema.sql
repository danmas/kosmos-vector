create table public.documents
(
    id        bigserial
        primary key,
    content   text,
    metadata  jsonb,
    embedding vector(1536)
);

alter table public.documents
    owner to postgres;

grant select, update, usage on sequence public.documents_id_seq to anon;

grant select, update, usage on sequence public.documents_id_seq to authenticated;

grant select, update, usage on sequence public.documents_id_seq to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.documents to anon;

grant delete, insert, references, select, trigger, truncate, update on public.documents to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.documents to service_role;

create table public.documents384
(
    id        bigserial
        primary key,
    file_name text,
    content   text,
    metadata  jsonb,
    embedding vector(384)
);

alter table public.documents384
    owner to postgres;

grant select, update, usage on sequence public.documents384_id_seq to anon;

grant select, update, usage on sequence public.documents384_id_seq to authenticated;

grant select, update, usage on sequence public.documents384_id_seq to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.documents384 to anon;

grant delete, insert, references, select, trigger, truncate, update on public.documents384 to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.documents384 to service_role;

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

create table public.rag_documents
(
    id           serial
        primary key,
    filename     text                                             not null,
    context_code text                     default 'UNKNOWN'::text not null,
    created_at   timestamp with time zone default CURRENT_TIMESTAMP,
    modified_at  timestamp with time zone default CURRENT_TIMESTAMP,
    chunks_count integer                  default 0
);

alter table public.rag_documents
    owner to postgres;

grant select, update, usage on sequence public.rag_documents_id_seq to anon;

grant select, update, usage on sequence public.rag_documents_id_seq to authenticated;

grant select, update, usage on sequence public.rag_documents_id_seq to service_role;

create table public.rag_chunks
(
    id            uuid default gen_random_uuid() not null
        primary key,
    document_id   integer
        references public.rag_documents
            on delete cascade,
    chunk_content text                           not null,
    chunk_index   integer                        not null,
    embedding     vector(1536),
    unique (document_id, chunk_index)
);

alter table public.rag_chunks
    owner to postgres;

grant delete, insert, references, select, trigger, truncate, update on public.rag_chunks to anon;

grant delete, insert, references, select, trigger, truncate, update on public.rag_chunks to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.rag_chunks to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.rag_documents to anon;

grant delete, insert, references, select, trigger, truncate, update on public.rag_documents to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.rag_documents to service_role;

create table public.tasks
(
    id         serial
        primary key,
    title      varchar(255) not null,
    status     boolean   default false,
    user_id    uuid
        references ??? (),
    created_at timestamp default now()
);

alter table public.tasks
    owner to postgres;

grant select, update, usage on sequence public.tasks_id_seq to anon;

grant select, update, usage on sequence public.tasks_id_seq to authenticated;

grant select, update, usage on sequence public.tasks_id_seq to service_role;

create policy "Users can manage their own tasks" on public.tasks
    as permissive
    for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

grant delete, insert, references, select, trigger, truncate, update on public.tasks to anon;

grant delete, insert, references, select, trigger, truncate, update on public.tasks to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.tasks to service_role;

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

create trigger trg_link_type_updated_at
    before update
    on public.link_type
    for each row
execute procedure public.update_updated_at();

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
    file_id           integer,
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

create trigger trg_link_updated_at
    before update
    on public.link
    for each row
execute procedure public.update_updated_at();

grant delete, insert, references, select, trigger, truncate, update on public.link to anon;

grant delete, insert, references, select, trigger, truncate, update on public.link to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.link to service_role;


-------------------------------------------------------------
--- AGENT-SCRIPT
-------------------------------------------------------------

CREATE TABLE public.agent_script (
    id serial PRIMARY KEY,
    context_code text NOT NULL,
    question text NOT NULL,
    script text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    usage_count int DEFAULT 0,
    is_valid boolean DEFAULT false,
    last_result jsonb DEFAULT NULL
);

CREATE UNIQUE INDEX idx_agent_script_unique 
    ON public.agent_script (context_code, question);

CREATE INDEX idx_agent_script_question_fts 
    ON public.agent_script USING gin (to_tsvector('russian', question));

-- Функция (если ещё нет в БД)
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер на agent_script
CREATE TRIGGER trg_agent_script_updated_at
    BEFORE UPDATE ON public.agent_script
    FOR EACH ROW
    EXECUTE PROCEDURE public.update_updated_at();
create database kosmos_db
    with owner carl;

create sequence kosmos.ai_item_id_seq;

alter sequence kosmos.ai_item_id_seq owner to carl;

create sequence kosmos.file_info_id_seq;

alter sequence kosmos.file_info_id_seq owner to carl;

create sequence kosmos.item_type_id_seq;

alter sequence kosmos.item_type_id_seq owner to carl;

create sequence kosmos.tag_id_seq;

alter sequence kosmos.tag_id_seq owner to carl;

create sequence kosmos.prompt_config_history_id_seq;

alter sequence kosmos.prompt_config_history_id_seq owner to carl;

create sequence kosmos.ai_comment_id_seq;

alter sequence kosmos.ai_comment_id_seq owner to carl;

create sequence kosmos.link_type_id_seq;

alter sequence kosmos.link_type_id_seq owner to carl;

create sequence kosmos.link_id_seq;

alter sequence kosmos.link_id_seq owner to carl;

create sequence kosmos.agent_script_id_seq;

alter sequence kosmos.agent_script_id_seq owner to carl;

create table kosmos.item_type
(
    id           integer                  default nextval('kosmos.item_type_id_seq'::regclass) not null
        primary key,
    context_code text                     default 'DEFAULT'::text                              not null,
    code         text                                                                          not null,
    name         text                                                                          not null,
    description  text,
    is_system    boolean                  default false                                        not null,
    created_at   timestamp with time zone default now(),
    updated_at   timestamp with time zone default now(),
    constraint item_type_context_code_unique
        unique (context_code, code)
);

alter table kosmos.item_type
    owner to carl;

create index idx_item_type_context_code
    on kosmos.item_type (context_code);

create table kosmos.agent_script
(
    id                 integer                  default nextval('kosmos.agent_script_id_seq'::regclass) not null
        primary key,
    context_code       text                                                                             not null,
    question           text                                                                             not null,
    script             text                                                                             not null,
    created_at         timestamp with time zone default CURRENT_TIMESTAMP,
    updated_at         timestamp with time zone default CURRENT_TIMESTAMP,
    usage_count        integer                  default 0,
    is_valid           boolean                  default false,
    last_result        jsonb,
    question_embedding vector(1536)
);

alter table kosmos.agent_script
    owner to carl;

create index idx_agent_script_question_embedding
    on kosmos.agent_script using ivfflat (question_embedding kosmos.vector_cosine_ops);

create unique index idx_agent_script_unique
    on kosmos.agent_script (context_code, question);

create index idx_agent_script_question_fts
    on kosmos.agent_script using gin (to_tsvector('russian'::regconfig, question));

create table kosmos.chunk_vector
(
    id              uuid                     default gen_random_uuid() not null
        primary key,
    file_id         uuid                                               not null,
    embedding       vector(1536),
    chunk_content   jsonb                                              not null,
    chunk_index     integer,
    created_at      timestamp                default now()             not null,
    content         jsonb,
    type            text                     default 'текст'::text,
    level           text                     default '0-исходник'::text,
    parent_chunk_id uuid,
    s_name          text,
    h_name          text,
    full_name       text,
    ai_item_id      integer,
    updated_at      timestamp with time zone default now()
);

alter table kosmos.chunk_vector
    owner to carl;

create index chunk_vector_created_at_index
    on kosmos.chunk_vector (created_at desc);

create index idx_chunk_vector_ai_item_id
    on kosmos.chunk_vector (ai_item_id);

create index idx_chunk_vector_embedding
    on kosmos.chunk_vector using ivfflat (embedding kosmos.vector_cosine_ops);

create index idx_chunk_vector_file_id
    on kosmos.chunk_vector (file_id);

create index idx_chunk_vector_level
    on kosmos.chunk_vector (level);

create index idx_chunk_vector_parent_chunk_id
    on kosmos.chunk_vector (parent_chunk_id);

create index idx_chunk_vector_type
    on kosmos.chunk_vector (type);

create table kosmos.prompt_config_history
(
    id              integer                  default nextval('kosmos.prompt_config_history_id_seq'::regclass) not null
        primary key,
    config_snapshot jsonb                                                                                     not null,
    created_at      timestamp with time zone default CURRENT_TIMESTAMP,
    version         integer                                                                                   not null
        constraint unique_version
            unique,
    comment         text
);

alter table kosmos.prompt_config_history
    owner to carl;

create index idx_prompt_config_history_created_at
    on kosmos.prompt_config_history (created_at desc);

create index idx_prompt_config_history_version
    on kosmos.prompt_config_history (version desc);

create table kosmos.ai_item_tag
(
    ai_item_full_name    text    not null,
    ai_item_context_code text    not null,
    tag_id               integer not null,
    created_at           timestamp with time zone default now(),
    primary key (ai_item_full_name, ai_item_context_code, tag_id)
);

alter table kosmos.ai_item_tag
    owner to carl;

create index idx_ai_item_tag_ai_item_full_name_context
    on kosmos.ai_item_tag (ai_item_full_name, ai_item_context_code);

create index idx_ai_item_tag_tag_id
    on kosmos.ai_item_tag (tag_id);

create table kosmos.tag
(
    id           integer                  default nextval('kosmos.tag_id_seq'::regclass) not null
        primary key,
    context_code text                     default 'DEFAULT'::text                        not null,
    code         text                                                                    not null,
    name         text                                                                    not null,
    description  text,
    created_at   timestamp with time zone default now(),
    updated_at   timestamp with time zone default now(),
    constraint tag_context_code_unique
        unique (context_code, code)
);

alter table kosmos.tag
    owner to carl;

create table kosmos.ai_item
(
    id            integer                  default nextval('kosmos.ai_item_id_seq'::regclass) not null
        primary key,
    full_name     text                                                                        not null,
    context_code  text                     default 'DEFAULT'::text                            not null,
    created_at    timestamp with time zone default CURRENT_TIMESTAMP,
    updated_at    timestamp with time zone default CURRENT_TIMESTAMP,
    type          text                     default 'текст'::text,
    s_name        text,
    h_name        text,
    file_id       uuid                                                                        not null,
    content_hash  text,
    needs_rebuild boolean                  default false,
    constraint ai_item_full_name_context_code_pk
        unique (full_name, context_code)
);

alter table kosmos.ai_item
    owner to carl;

create index idx_ai_item_context_code
    on kosmos.ai_item (context_code);

create index idx_ai_item_full_name
    on kosmos.ai_item (full_name);

create index idx_ai_item_needs_rebuild
    on kosmos.ai_item (context_code, needs_rebuild)
    where (needs_rebuild = true);

create index idx_ai_item_type
    on kosmos.ai_item (type);

create table kosmos.files
(
    id           uuid      default gen_random_uuid() not null
        primary key,
    context_code text      default 'UNKNOWN'::text   not null,
    filename     text                                not null,
    file_url     text                                not null,
    content      text,
    modified_at  timestamp with time zone            not null,
    created_at   timestamp default now()             not null,
    file_hash    text,
    constraint files_filename_context_code_unique
        unique (filename, context_code)
);

alter table kosmos.files
    owner to carl;

create index idx_files_context_code
    on kosmos.files (context_code);

create table kosmos.file_info
(
    id           integer                  default nextval('kosmos.file_info_id_seq'::regclass) not null
        primary key,
    filename     text                                                                          not null
        unique,
    context_code text                     default 'DEFAULT'::text                              not null,
    file_hash    text,
    created_at   timestamp with time zone default CURRENT_TIMESTAMP,
    modified_at  timestamp with time zone default CURRENT_TIMESTAMP
);

alter table kosmos.file_info
    owner to carl;

create table kosmos.ai_comment
(
    id           integer                  default nextval('kosmos.ai_comment_id_seq'::regclass) not null
        primary key,
    context_code text                                                                           not null,
    full_name    text                                                                           not null,
    comment      text,
    created_at   timestamp with time zone default CURRENT_TIMESTAMP,
    updated_at   timestamp with time zone default CURRENT_TIMESTAMP,
    unique (context_code, full_name)
);

alter table kosmos.ai_comment
    owner to carl;

create index idx_ai_comment_context_full_name
    on kosmos.ai_comment (context_code, full_name);

create table kosmos.chunks_info
(
    id          uuid      default gen_random_uuid() not null
        primary key,
    file_id     uuid                                not null,
    chunk_count integer   default 0                 not null,
    created_at  timestamp default now()
);

alter table kosmos.chunks_info
    owner to carl;

create table kosmos.link
(
    id                integer   default nextval('kosmos.link_id_seq'::regclass) not null
        primary key,
    context_code      text                                                      not null,
    source            text                                                      not null,
    target            text                                                      not null,
    link_type_id      integer                                                   not null,
    file_id           uuid,
    source_ai_item_id uuid,
    target_ai_item_id uuid,
    created_at        timestamp default CURRENT_TIMESTAMP,
    updated_at        timestamp default CURRENT_TIMESTAMP
);

alter table kosmos.link
    owner to carl;

create index idx_link_context_source
    on kosmos.link (context_code, source);

create index idx_link_context_target
    on kosmos.link (context_code, target);

create index idx_link_context_type
    on kosmos.link (context_code, link_type_id);

create index idx_link_context_target_type
    on kosmos.link (context_code, target, link_type_id);

create unique index idx_link_unique
    on kosmos.link (context_code, source, target, link_type_id);

create table kosmos.link_type
(
    id          integer   default nextval('kosmos.link_type_id_seq'::regclass) not null
        primary key,
    code        text                                                           not null
        unique,
    label       text                                                           not null,
    description text,
    is_active   boolean   default true,
    created_at  timestamp default CURRENT_TIMESTAMP,
    updated_at  timestamp default CURRENT_TIMESTAMP
);

alter table kosmos.link_type
    owner to carl;


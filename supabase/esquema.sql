-- =============================================================
-- Sistema de Tutorías: esquema para Supabase
-- Ejecútelo una vez en Supabase → SQL Editor → New query → Run.
-- Es seguro volver a ejecutarlo: no borra datos existentes.
--
-- Cada fila lleva tutor_id. Las políticas RLS hacen que cada tutor
-- solo pueda leer y modificar sus propias filas, aunque alguien
-- manipule el código del navegador.
-- =============================================================

-- ---------- Perfiles (uno por cuenta) ----------
create table if not exists public.perfiles (
    id                uuid primary key references auth.users (id) on delete cascade,
    nombre            text not null default '',
    telefono          text not null default '',
    materias          text not null default '',
    precio_grupal     numeric(12, 2) not null default 8000  check (precio_grupal >= 0),
    precio_individual numeric(12, 2) not null default 16000 check (precio_individual >= 0),
    max_grupal        integer not null default 5 check (max_grupal between 1 and 30),
    creado            timestamptz not null default now()
);

-- ---------- Clases ----------
create table if not exists public.clases (
    id         text primary key,
    tutor_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
    fecha      date not null,
    horario    text not null check (horario ~ '^\d{2}:\d{2}-\d{2}:\d{2}$'),
    tipo       text not null check (tipo in ('grupal', 'individual')),
    precio     numeric(12, 2) not null check (precio >= 0),
    notas      text not null default '',
    finalizado boolean not null default false,
    creado     timestamptz not null default now(),
    unique (id, tutor_id)
);

-- ---------- Estudiantes inscritos en cada clase ----------
create table if not exists public.inscripciones (
    id       text primary key,
    tutor_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    clase_id text not null,
    nombre   text not null,
    materia  text not null default '',
    orden    integer not null default 0,
    unique (id, tutor_id),
    -- La clave compuesta impide inscribir estudiantes en clases de otro tutor.
    foreign key (clase_id, tutor_id) references public.clases (id, tutor_id) on delete cascade
);

-- ---------- Pagos ----------
create table if not exists public.pagos (
    id             text primary key,
    tutor_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
    inscripcion_id text not null,
    monto          numeric(12, 2) not null,
    fecha          date not null,
    foreign key (inscripcion_id, tutor_id) references public.inscripciones (id, tutor_id) on delete cascade
);

create index if not exists clases_tutor_fecha_idx on public.clases (tutor_id, fecha);
create index if not exists inscripciones_tutor_idx on public.inscripciones (tutor_id);
create index if not exists inscripciones_clase_idx on public.inscripciones (clase_id, tutor_id);
create index if not exists pagos_tutor_idx on public.pagos (tutor_id);
create index if not exists pagos_inscripcion_idx on public.pagos (inscripcion_id, tutor_id);

-- ---------- Seguridad por fila (RLS) ----------
alter table public.perfiles      enable row level security;
alter table public.clases        enable row level security;
alter table public.inscripciones enable row level security;
alter table public.pagos         enable row level security;

drop policy if exists "perfil propio" on public.perfiles;
create policy "perfil propio" on public.perfiles
    for all to authenticated
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

drop policy if exists "clases propias" on public.clases;
create policy "clases propias" on public.clases
    for all to authenticated
    using (tutor_id = (select auth.uid()))
    with check (tutor_id = (select auth.uid()));

drop policy if exists "inscripciones propias" on public.inscripciones;
create policy "inscripciones propias" on public.inscripciones
    for all to authenticated
    using (tutor_id = (select auth.uid()))
    with check (tutor_id = (select auth.uid()));

drop policy if exists "pagos propios" on public.pagos;
create policy "pagos propios" on public.pagos
    for all to authenticated
    using (tutor_id = (select auth.uid()))
    with check (tutor_id = (select auth.uid()));

-- Los visitantes sin sesión no tienen ningún acceso.
revoke all on public.perfiles, public.clases, public.inscripciones, public.pagos from anon;
grant select, insert, update, delete on public.perfiles, public.clases, public.inscripciones, public.pagos to authenticated;

-- ---------- Crear el perfil automáticamente al registrarse ----------
create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.perfiles (id, nombre)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'nombre', new.raw_user_meta_data ->> 'full_name', ''))
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
    after insert on auth.users
    for each row execute function public.crear_perfil();

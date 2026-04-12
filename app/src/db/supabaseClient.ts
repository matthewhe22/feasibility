/**
 * supabaseClient.ts
 * Returns a Supabase client when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 * are set, otherwise returns null so the app falls back to IndexedDB.
 *
 * SQL to create the projects table in your Supabase project:
 *
 *   create table projects (
 *     id        bigint generated always as identity primary key,
 *     name      text        not null,
 *     description text      not null default '',
 *     created_at timestamptz not null default now(),
 *     updated_at timestamptz not null default now(),
 *     admin      jsonb       not null,
 *     inputs     jsonb       not null,
 *     dashboard_data jsonb
 *   );
 *
 * No row-level security needed for a shared-key setup — all users share one
 * anon key and see all projects.  If you want per-user isolation in the future,
 * add auth and RLS policies.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

export const isSupabaseConfigured = !!supabase;

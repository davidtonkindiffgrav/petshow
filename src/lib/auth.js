import { supabase } from './supabase.js'

export async function getAuth() {
  const raw = import.meta.env.BASE_URL
  const base = raw.endsWith('/') ? raw : raw + '/'

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { session: null, profile: null, base }

  const { data: profile } = await supabase
    .from('profiles')
    .select('roles, display_name, first_name, last_name, organiser_type, organisation_id')
    .eq('id', session.user.id)
    .single()

  return { session, profile, base }
}

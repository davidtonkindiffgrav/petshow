import { supabase } from './supabase.js'

export async function getAuth() {
  const raw = import.meta.env.BASE_URL
  const base = raw.endsWith('/') ? raw : raw + '/'

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { session: null, profile: null, base }

  const { data: profile } = await supabase
    .from('profiles')
    .select('roles, display_name, first_name, last_name, organiser_type, organisation_id, avatar_url, bio, default_timezone, default_currency, suspended_at')
    .eq('id', session.user.id)
    .single()

  // A suspended account is fully locked out. Handled here, self-contained,
  // same shape as the !session branch above — not a new return field —
  // because getAuth() is called from ~20 pages across every role and none
  // of them branch on anything beyond `if (!auth.session)` today. Adding a
  // new field would mean every call site has to remember to check it.
  if (profile?.suspended_at) {
    await supabase.auth.signOut()
    window.location.replace(base + 'login?suspended=1')
    return { session: null, profile: null, base }
  }

  // Fall back to auth metadata if profile columns aren't populated yet
  if (profile && !profile.first_name) {
    const meta = session.user.user_metadata || {}
    profile.first_name   = meta.first_name   || null
    profile.last_name    = meta.last_name    || null
    profile.display_name = profile.display_name || meta.display_name || null
    // Persist so subsequent logins don't need the fallback
    if (meta.first_name) {
      await supabase.from('profiles')
        .update({ first_name: meta.first_name, last_name: meta.last_name || null, display_name: profile.display_name })
        .eq('id', session.user.id)
    }
  }

  return { session, profile, base }
}

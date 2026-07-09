import { getAuth } from './auth.js'
import { supabase } from './supabase.js'

// Client-side gate for /admin/* pages. This is UX only — the real security
// boundary is the admin-api Edge Function independently re-deriving admin
// status server-side from the caller's JWT on every request.
export async function getAdminAuth() {
  const auth = await getAuth()
  if (!auth.session) {
    window.location.replace(auth.base + 'login')
    return auth
  }
  if (!auth.profile?.roles?.includes('admin')) {
    // Redirect to the generic role-chooser rather than a distinct "forbidden"
    // page — don't reveal that /admin exists to non-admin accounts.
    window.location.replace(auth.base + 'choose')
    return auth
  }
  return auth
}

export async function callAdminApi(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/admin-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, payload }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json
}

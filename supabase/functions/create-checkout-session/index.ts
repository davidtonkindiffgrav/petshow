import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Verify JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const token = authHeader.replace('Bearer ', '');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error('Unauthorized');

    // 2. Parse body
    const { show_id, entries } = await req.json();
    if (!show_id || !Array.isArray(entries) || !entries.length) throw new Error('Missing required fields');
    for (const e of entries) {
      if (!e.animal_name) throw new Error('Each entry must have an animal_name');
    }

    // 3. Verify show is open
    const { data: show, error: showErr } = await supabase
      .from('shows')
      .select('id, title, entry_fee, currency, status, entry_close_date')
      .eq('id', show_id)
      .single();
    if (showErr || !show) throw new Error('Show not found');
    if (show.status !== 'published') throw new Error('Show is not published');
    if (show.entry_close_date && new Date(show.entry_close_date) < new Date()) throw new Error('Entries are closed');

    // 4. Service fee & grand total
    const { data: feeRows } = await supabase
      .from('platform_settings')
      .select('key, value')
      .eq('key', `service_fee_${show.currency}`);
    const svcFee     = parseFloat(feeRows?.[0]?.value ?? '1.10') || 1.10;
    const perEntryFee = (show.entry_fee || 0) + svcFee;
    const entryCount  = entries.length;
    const grandTotal  = perEntryFee * entryCount;

    // 5. Clean up any previous pending entries for this user/show (abandoned checkouts)
    await supabase
      .from('show_entries')
      .delete()
      .eq('show_id', show_id)
      .eq('user_id', user.id)
      .eq('status', 'pending');

    // 7. Starting entry number
    const { data: maxRow } = await supabase
      .from('show_entries')
      .select('entry_number')
      .eq('show_id', show_id)
      .order('entry_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const startNumber = (maxRow?.entry_number || 0) + 1;

    // 8. Insert all entries as pending
    const rows = entries.map((e: any, i: number) => ({
      show_id,
      user_id:        user.id,
      category_id:    e.category_id    || null,
      animal_name:    e.animal_name,
      breed:          e.breed          || null,
      photo_url:      e.photo_url      || null,
      exhibitor_name: e.exhibitor_name || null,
      status:         'pending',
      entry_number:   startNumber + i,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('show_entries')
      .insert(rows)
      .select('id');
    if (insertErr || !inserted?.length) throw new Error('Failed to create entries: ' + (insertErr?.message || ''));

    const entryIds = inserted.map((e: any) => e.id);
    const siteUrl  = Deno.env.get('SITE_URL') || 'https://davidtonkindiffgrav.github.io/petshow';

    // 7. Free show — confirm all immediately
    if (grandTotal <= 0) {
      await supabase
        .from('show_entries')
        .update({ status: 'confirmed', entry_fee_paid: 0 })
        .in('id', entryIds);
      return new Response(
        JSON.stringify({ redirect: `${siteUrl}/participant` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 8. Paid show — create one Stripe Checkout Session for the grand total
    const catIds = entries.map((e: any) => e.category_id).filter(Boolean);
    const catMap: Record<string, string> = {};
    if (catIds.length) {
      const { data: cats } = await supabase.from('show_categories').select('id, name').in('id', catIds);
      for (const c of (cats || [])) catMap[c.id] = c.name;
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-04-10' });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: entries.map((e: any) => {
        const cat  = e.category_id ? catMap[e.category_id] : null;
        const desc = [show.title, cat].filter(Boolean).join(' · ');
        return {
          price_data: {
            currency:     show.currency.toLowerCase(),
            unit_amount:  Math.round(perEntryFee * 100),
            product_data: { name: e.animal_name, description: desc },
          },
          quantity: 1,
        };
      }),
      success_url: `${siteUrl}/participant`,
      cancel_url:  `${siteUrl}/participant/enter?show=${show_id}&cancelled=1`,
      metadata:    { show_id, entry_count: String(entryCount) },
    });

    // 9. Store session ID on all entries
    await supabase
      .from('show_entries')
      .update({ stripe_session_id: session.id })
      .in('id', entryIds);

    return new Response(
      JSON.stringify({ checkout_url: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

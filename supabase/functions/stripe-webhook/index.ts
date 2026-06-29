import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

serve(async (req: Request) => {
  const sig  = req.headers.get('stripe-signature');
  const body = await req.text();

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-04-10' });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, Deno.env.get('STRIPE_WEBHOOK_SECRET')!);
  } catch (err: any) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session    = event.data.object as Stripe.Checkout.Session;
    const amountPaid = (session.amount_total || 0) / 100;
    const entryCount = parseInt(session.metadata?.entry_count || '1', 10);
    const perEntry   = entryCount > 0 ? amountPaid / entryCount : amountPaid;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error } = await supabase
      .from('show_entries')
      .update({ status: 'confirmed', entry_fee_paid: perEntry })
      .eq('stripe_session_id', session.id);

    if (error) console.error('Failed to confirm entries:', error.message);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

import Stripe from 'stripe';

export default async function handler(req, res){
  try{
    if(req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
    const token = req.query.token || '';
    if(!process.env.REPORT_TOKEN || token !== process.env.REPORT_TOKEN){
      return res.status(401).json({error:'Unauthorized'});
    }
    const org = req.query.org || '';
    const from = req.query.from; const to = req.query.to;
    if(!org || !from || !to) return res.status(400).json({error:'Missing org/from/to'});

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });
    const fromTs = Math.floor(new Date(from + 'T00:00:00Z').getTime()/1000);
    const toTs = Math.floor(new Date(to + 'T23:59:59Z').getTime()/1000);

    const sessions = [];
    let params = { limit: 100, created: { gte: fromTs, lte: toTs }, expand: ['data.line_items', 'data.payment_intent'] };
    while (true){
      const page = await stripe.checkout.sessions.list(params);
      sessions.push(...page.data);
      if(!page.has_more) break;
      params.starting_after = page.data[page.data.length-1].id;
    }

    const rows = [];
    rows.push(['created','org','session_id','purchaser_name','purchaser_email','item_name','quantity','unit_amount_cents','amount_total_cents','attendees_json']);
    for (const s of sessions){
      const pi = s.payment_intent;
      const meta = (pi && pi.metadata) ? pi.metadata : {};
      if (org && meta.org !== org) continue;
      const purchaser_name = meta.purchaser_name || '';
      const purchaser_email = meta.purchaser_email || '';
      const attendees_json = (meta.attendees_json || '').replace(/\\n/g,' ').slice(0, 4000);
      const items = (s.line_items && s.line_items.data) ? s.line_items.data : [];
      for (const li of items){
        rows.push([
          String(s.created), meta.org || '', s.id, purchaser_name, purchaser_email,
          li.description || (li.price && li.price.nickname) || (li.price && li.price.product) || '',
          String(li.quantity || 1),
          String((li.price && (li.price.unit_amount ?? li.amount_subtotal)) ?? 0),
          String(li.amount_total ?? 0),
          attendees_json
        ]);
      }
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="report_${org}_${from}_to_${to}.csv"`);
    return res.status(200).send(csv);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'Failed to generate report'});
  }
}

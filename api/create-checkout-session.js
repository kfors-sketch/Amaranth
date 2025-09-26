// /api/create-checkout-session.js (CommonJS)
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });

// 👇 Add this helper just after the require/stripe init
const getBaseUrl = (req) => {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
};

function loadJSON(org, name) {
  const p = path.join(process.cwd(), 'data', org, name + '.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function computeSurcharge(base, settings) {
  const S = (settings && settings.surcharge) || {};
  if (!S.enabled) return 0;
  const P = Number(S.fee_percent || 0), F = Number(S.fee_fixed_cents || 0), CAP = Number(S.cap_percent || 0);
  if (P <= 0 && F <= 0) return 0;
  const total = Math.ceil((base + F) / (1 - P));
  let sur = total - base;
  if (CAP > 0) {
    const capByPct = Math.floor(base * CAP);
    if (sur > capByPct) sur = capByPct;
  }
  return sur;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { org, order } = req.body || {};
    if (!org) return res.status(400).json({ error: 'Missing org' });
    if (!order) return res.status(400).json({ error: 'Missing order' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe key not configured' });

    const settings = loadJSON(org, 'settings');
    const products = loadJSON(org, 'products');
    const banquets = loadJSON(org, 'banquets');

    let line_items = [];
    const metadata = {
      org,
      purchaser_name: order?.purchaser?.name || '',
      purchaser_title: order?.purchaser?.title || '',
      purchaser_phone: order?.purchaser?.phone || '',
      purchaser_email: order?.purchaser?.email || '',
      attendees_json: JSON.stringify(order?.attendees || []).slice(0, 4999)
    };

    // Tickets
    const ticketMap = new Map();
    (banquets.events || []).forEach(ev => (ev.tickets || []).forEach(t => ticketMap.set(t.handle, t)));
    (order.attendees || []).forEach(att =>
      (att.selections || []).forEach(sel => {
        if (sel?.handle && ticketMap.has(sel.handle)) {
          const price = Number(ticketMap.get(sel.handle).price_cents || 0);
          line_items.push({
            price_data: { currency: 'usd', unit_amount: price, product_data: { name: `Ticket (${sel.handle})`, description: `Meal:${sel.meal || ''} | Diet:${sel.dietary || ''}` } },
            quantity: 1
          });
          const s = computeSurcharge(price, settings);
          if (s > 0) line_items.push({ price_data: { currency: 'usd', unit_amount: s, product_data: { name: 'Card processing fee' } }, quantity: 1 });
        }
      })
    );

    // Store items
    const byHandle = Object.fromEntries((products.items || []).map(p => [p.handle, p]));
    if (order.store) {
      for (const [h, qtyRaw] of Object.entries(order.store)) {
        const qty = Math.max(0, Number(qtyRaw || 0));
        const p = byHandle[h];
        if (p && qty > 0) {
          line_items.push({ price_data: { currency: 'usd', unit_amount: Number(p.price_cents || 0), product_data: { name: p.name } }, quantity: qty });
          const s = computeSurcharge(Number(p.price_cents || 0), settings);
          if (s > 0) line_items.push({ price_data: { currency: 'usd', unit_amount: s, product_data: { name: 'Card processing fee' } }, quantity: qty });
        }
      }
    }

    // Extra donation (no surcharge by default)
    if (order.extra_donation_cents && order.extra_donation_cents > 0) {
      const amt = Number(order.extra_donation_cents || 0);
      line_items.push({ price_data: { currency: 'usd', unit_amount: amt, product_data: { name: 'Extra Donation' } }, quantity: 1 });
    }

    const customer = await stripe.customers.create({
      name: order?.purchaser?.name,
      email: order?.purchaser?.email,
      phone: order?.purchaser?.phone,
      address: order?.purchaser?.address
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customer.id,
      line_items,
      success_url: successUrl,
      cancel_url: cancelUrl,
      automatic_tax: { enabled: true },
      payment_intent_data: { metadata }
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to create session' });
  }
};

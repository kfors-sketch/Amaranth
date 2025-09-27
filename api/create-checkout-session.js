// api/create-checkout-session.js
// Works on Vercel serverless. Uses amount-in-cents (no Stripe Price IDs needed).

const successBase = process.env.SUCCESS_BASE_URL || 'https://'+process.env.VERCEL_URL;
const cancelBase  = process.env.CANCEL_BASE_URL  || 'https://'+process.env.VERCEL_URL;

function money(c){ return `$${(Number(c||0)/100).toFixed(2)}`; }

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 🔑 Environment key check
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      console.error('STRIPE_SECRET_KEY missing for env');
      return res.status(500).json({ error: 'Stripe key not configured (STRIPE_SECRET_KEY missing).' });
    }

    const stripe = require('stripe')(key);

    const { org, order } = req.body || {};
    if (!org || !order) {
      return res.status(400).json({ error: 'Missing org or order in request body.' });
    }

    const line_items = [];
    const meta = {
      org,
      purchaser_name: order?.purchaser?.name || '',
      purchaser_email: order?.purchaser?.email || '',
    };

    // 🧍‍♀️ Attendee tickets
    (order.attendees || []).forEach((a, ai) => {
      (a.selections || []).forEach((sel, evIdx) => {
        if (sel && sel.handle && sel.price_cents > 0) {
          const title = `Event ${evIdx+1} — ${a.name||('Attendee '+(ai+1))}`;
          line_items.push({
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: Number(sel.price_cents),
              product_data: {
                name: title,
                description: sel.meal ? `Meal: ${sel.meal}` : undefined,
                metadata: { org, type: 'banquet', evIdx: String(evIdx), attendee_index: String(ai) },
              },
            },
          });
        }
      });

      // Optional per-attendee registration
      if (a.registration) {
        const regCents = Number(order?.registration_price_cents || 0); // optional; we’ll also derive from store if needed
        // If you prefer pulling from products JSON, you can pass it in body; otherwise skip this block.
      }
    });

    // 🛍️ Store items (including directory, corsage, merch)
    const store = order.store || {};
    const storeNotes = order.store_notes || {};
    for (const [handle, qtyRaw] of Object.entries(store)) {
      const qty = Number(qtyRaw || 0);
      if (!qty) continue;

      // We need a price in cents for each handle. If you already pass it, great.
      // If not, include a minimal fallback map here or send price_cents in body for each store item.
      const priceCentsMap = order.store_price_cents_map || {}; // { handle: cents }
      const cents = Number(priceCentsMap[handle] || 0);
      if (!cents) {
        console.warn('Missing cents for store handle:', handle);
        return res.status(400).json({ error: `Missing price for ${handle}.` });
      }

      const descNote = storeNotes[handle] ? `Note: ${storeNotes[handle]}` : undefined;
      line_items.push({
        quantity: qty,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: handle,
            description: descNote,
            metadata: { org, type: 'store', handle },
          },
        },
      });
    }

    // 🎁 Extra donation (optional)
    const dn = Number(order.extra_donation_cents || 0);
    if (dn > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: dn,
          product_data: {
            name: 'Extra Donation',
            metadata: { org, type: 'donation' },
          },
        },
      });
    }

    if (line_items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    // ✅ Create session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      metadata: meta,
      success_url: `${successBase}/${org}/thanks.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cancelBase}/${org}/order.html?canceled=1`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
